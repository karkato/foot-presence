-- ============================================================
-- foot-presence — Saisons
-- À exécuter APRÈS setup.sql, audit.sql, features.sql, guestsettings.sql,
-- security.sql
--
-- Objectif : permettre à un admin d'archiver la saison en cours et d'en
-- démarrer une nouvelle, ce qui remet les stats à zéro PAR FILTRAGE (les
-- RPC de stats ne regardent que les matchs de la saison courante) —
-- aucune donnée n'est jamais supprimée, les saisons archivées restent
-- consultables.
--
-- Chaque fonction dont la signature change est précédée d'un DROP
-- FUNCTION IF EXISTS typé (voir security.sql pour le pourquoi : un
-- CREATE OR REPLACE avec un paramètre DEFAULT supplémentaire crée une
-- surcharge, il ne remplace rien).
-- ============================================================

BEGIN;

-- ============================================================
-- A. Table + colonnes
-- ============================================================

CREATE TABLE IF NOT EXISTS seasons (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id   uuid REFERENCES groups(id) ON DELETE CASCADE NOT NULL,
  name       text NOT NULL,
  started_at timestamptz NOT NULL DEFAULT now(),
  ended_at   timestamptz,                       -- NULL = saison courante
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS seasons_group_id_idx ON seasons(group_id);

-- Au plus une saison ouverte par groupe, garanti au niveau base (pas
-- seulement par la RPC) : deux clics concurrents sur "démarrer une
-- nouvelle saison" se serialisent via le FOR UPDATE de start_new_season,
-- mais cet index reste la ceinture-bretelles.
CREATE UNIQUE INDEX IF NOT EXISTS seasons_one_open_per_group
  ON seasons(group_id) WHERE ended_at IS NULL;

-- ON DELETE RESTRICT (pas SET NULL) : season_id est NOT NULL plus bas,
-- une saison référencée par au moins un match ne doit donc jamais être
-- supprimable silencieusement. Sans conséquence en pratique aujourd'hui
-- (aucune RPC ni policy n'autorise de DELETE sur seasons), mais exprime
-- l'intention réelle plutôt qu'un SET NULL qui violerait NOT NULL.
ALTER TABLE matches ADD COLUMN IF NOT EXISTS season_id uuid
  REFERENCES seasons(id) ON DELETE RESTRICT;
CREATE INDEX IF NOT EXISTS matches_season_id_idx ON matches(season_id);
CREATE INDEX IF NOT EXISTS registrations_player_id_idx ON registrations(player_id);

-- ============================================================
-- B. Backfill — une "Saison 1" par groupe, tous les matchs existants dedans
-- ============================================================

INSERT INTO seasons (group_id, name, started_at)
SELECT g.id, 'Saison 1',
       COALESCE((SELECT min(m.match_date)::timestamptz FROM matches m WHERE m.group_id = g.id), now())
FROM groups g
WHERE NOT EXISTS (SELECT 1 FROM seasons s WHERE s.group_id = g.id);

UPDATE matches m SET season_id = s.id
FROM seasons s
WHERE s.group_id = m.group_id AND s.ended_at IS NULL AND m.season_id IS NULL;

-- Sûr uniquement après le backfill ci-dessus, dans la même transaction :
-- aucune INSERT directe sur matches n'est possible (REVOKE INSERT dans
-- security.sql), et create_match (plus bas) garantit désormais un
-- season_id via ensure_current_season.
ALTER TABLE matches ALTER COLUMN season_id SET NOT NULL;

-- ============================================================
-- C. RLS / grants
-- ============================================================

ALTER TABLE seasons ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "seasons: lecture publique" ON seasons;
CREATE POLICY "seasons: lecture publique" ON seasons FOR SELECT USING (true);

-- REVOKE ALL (pas seulement INSERT/UPDATE/DELETE) puis GRANT SELECT,
-- dans cet ordre : Supabase applique des ALTER DEFAULT PRIVILEGES qui
-- accordent TOUT (y compris TRUNCATE/REFERENCES/TRIGGER) à
-- anon/authenticated sur les nouvelles tables du schéma public.
REVOKE ALL ON seasons FROM anon, authenticated;
GRANT SELECT ON seasons TO anon, authenticated;

-- ============================================================
-- D. Helpers (jamais appelables directement en RPC depuis le client)
-- ============================================================

DROP FUNCTION IF EXISTS current_season_id(uuid);
DROP FUNCTION IF EXISTS player_current_season_id(uuid);
DROP FUNCTION IF EXISTS ensure_current_season(uuid);

CREATE FUNCTION current_season_id(p_group_id uuid)
RETURNS uuid AS $$
  SELECT id FROM seasons WHERE group_id = p_group_id AND ended_at IS NULL LIMIT 1;
$$ LANGUAGE sql STABLE SECURITY DEFINER;

CREATE FUNCTION player_current_season_id(p_player_id uuid)
RETURNS uuid AS $$
  SELECT current_season_id(p.group_id) FROM players p WHERE p.id = p_player_id;
$$ LANGUAGE sql STABLE SECURITY DEFINER;

-- Crée une saison "Saison N" si le groupe n'en a aucune d'ouverte
-- (groupe fraîchement créé après le backfill ci-dessus, ou situation de
-- bord jamais censée arriver). Utilisé par create_match.
CREATE FUNCTION ensure_current_season(p_group_id uuid)
RETURNS uuid AS $$
DECLARE
  v_season_id uuid;
  v_count int;
BEGIN
  v_season_id := current_season_id(p_group_id);
  IF v_season_id IS NOT NULL THEN
    RETURN v_season_id;
  END IF;

  SELECT count(*) INTO v_count FROM seasons WHERE group_id = p_group_id;
  INSERT INTO seasons (group_id, name) VALUES (p_group_id, 'Saison ' || (v_count + 1))
  RETURNING id INTO v_season_id;
  RETURN v_season_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

REVOKE EXECUTE ON FUNCTION current_season_id(uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION player_current_season_id(uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION ensure_current_season(uuid) FROM PUBLIC, anon, authenticated;

-- ============================================================
-- E. start_new_season — archive la saison courante, en ouvre une nouvelle
-- ============================================================

DROP FUNCTION IF EXISTS start_new_season(uuid, uuid, text);

CREATE FUNCTION start_new_season(p_actor_id uuid, p_group_id uuid, p_name text DEFAULT NULL)
RETURNS json AS $$
DECLARE
  v_count int;
  v_name text;
  result seasons%ROWTYPE;
BEGIN
  PERFORM assert_group_admin(p_actor_id, p_group_id);

  -- Verrou sur la ligne du groupe : sérialise deux appels concurrents à
  -- "démarrer une nouvelle saison" plutôt que de laisser l'index unique
  -- partiel lever une violation de contrainte opaque au second — mais un
  -- vrai double-clic (deux transactions successives, pas concurrentes)
  -- crée légitimement deux saisons l'une après l'autre : c'est
  -- volontairement laissé au client (bouton désactivé pendant l'appel,
  -- voir season-settings.component.ts) plutôt que deviné ici par une
  -- heuristique de délai qui rejetterait aussi de vrais redémarrages
  -- rapprochés.
  PERFORM 1 FROM groups WHERE id = p_group_id FOR UPDATE;

  UPDATE seasons SET ended_at = now() WHERE group_id = p_group_id AND ended_at IS NULL;

  SELECT count(*) INTO v_count FROM seasons WHERE group_id = p_group_id;
  v_name := COALESCE(NULLIF(trim(p_name), ''), 'Saison ' || (v_count + 1));

  INSERT INTO seasons (group_id, name) VALUES (p_group_id, v_name)
  RETURNING * INTO result;

  INSERT INTO audit_log (group_id, actor_id, action, target_type, target_id, details)
  VALUES (p_group_id, p_actor_id, 'start_season', 'season', result.id,
    jsonb_build_object('name', v_name));

  RETURN row_to_json(result);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================
-- F. create_match — rattachement automatique à la saison courante
-- Signature strictement inchangée.
-- ============================================================

DROP FUNCTION IF EXISTS create_match(uuid, uuid, text, date, time, int, timestamptz, text, text);

CREATE FUNCTION create_match(
  p_actor_id uuid,
  p_group_id uuid,
  p_title text,
  p_match_date date,
  p_match_time time,
  p_max_players int DEFAULT 22,
  p_registration_deadline timestamptz DEFAULT NULL,
  p_team_a_name text DEFAULT 'Équipe Rouge',
  p_team_b_name text DEFAULT 'Équipe Bleue'
) RETURNS json AS $$
DECLARE
  result matches%ROWTYPE;
  v_season_id uuid;
BEGIN
  PERFORM assert_group_admin(p_actor_id, p_group_id);

  v_season_id := ensure_current_season(p_group_id);

  INSERT INTO matches (group_id, title, match_date, match_time, max_players, registration_deadline, is_closed, team_a_name, team_b_name, season_id)
  VALUES (p_group_id, p_title, p_match_date, p_match_time, p_max_players, p_registration_deadline, false, p_team_a_name, p_team_b_name, v_season_id)
  RETURNING * INTO result;

  INSERT INTO audit_log (group_id, actor_id, action, target_type, target_id, details)
  VALUES (p_group_id, p_actor_id, 'create_match', 'match', result.id,
    jsonb_build_object('title', p_title));

  RETURN row_to_json(result);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================
-- G. Rattachement manuel d'un match à une saison (correctif admin)
-- ============================================================

DROP FUNCTION IF EXISTS set_match_season(uuid, uuid, uuid);

CREATE FUNCTION set_match_season(p_actor_id uuid, p_match_id uuid, p_season_id uuid)
RETURNS void AS $$
DECLARE
  v_group_id uuid;
  v_season_group_id uuid;
BEGIN
  SELECT group_id INTO v_group_id FROM matches WHERE id = p_match_id;
  IF v_group_id IS NULL THEN
    RAISE EXCEPTION 'match_not_found';
  END IF;

  PERFORM assert_group_admin(p_actor_id, v_group_id);

  SELECT group_id INTO v_season_group_id FROM seasons WHERE id = p_season_id;
  IF v_season_group_id IS NULL OR v_season_group_id <> v_group_id THEN
    RAISE EXCEPTION 'season_group_mismatch';
  END IF;

  UPDATE matches SET season_id = p_season_id WHERE id = p_match_id;

  INSERT INTO audit_log (group_id, actor_id, action, target_type, target_id, details)
  VALUES (v_group_id, p_actor_id, 'move_match_season', 'match', p_match_id,
    jsonb_build_object('season_id', p_season_id));
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================
-- H. Stats — season-aware
--
-- Dans chaque fonction : p_season_id = NULL résout sur la saison
-- courante du joueur/groupe, PAS sur "toutes les saisons" — un appelant
-- qui oublie le paramètre ne doit pas faire réapparaître tout
-- l'historique. Le repli sur "pas de filtre" ne s'active que si le
-- groupe n'a strictement aucune saison (base non backfillée), pour
-- éviter un écran vide plutôt qu'une fuite de données entre saisons.
-- ============================================================

-- Les deux DROP couvrent la signature à 1 argument (features.sql) et la
-- signature à 2 arguments que CE fichier crée : sans le second, rejouer
-- seasons.sql une deuxième fois échoue en "function already exists with
-- same argument types" (le premier DROP ne matche plus rien après le
-- premier passage) — exactement le genre d'écart de "DROP FUNCTION
-- incomplet" documenté dans security.sql.
DROP FUNCTION IF EXISTS get_player_stats(uuid);
DROP FUNCTION IF EXISTS get_player_stats(uuid, uuid);

CREATE FUNCTION get_player_stats(p_player_id uuid, p_season_id uuid DEFAULT NULL)
RETURNS json AS $$
DECLARE
  v_season uuid;
BEGIN
  v_season := COALESCE(p_season_id, player_current_season_id(p_player_id));

  RETURN (
    SELECT json_build_object(
      'played', COUNT(*),
      'wins', COUNT(*) FILTER (WHERE
        (r.team = 0 AND m.score_a > m.score_b) OR
        (r.team = 1 AND m.score_b > m.score_a)
      ),
      'losses', COUNT(*) FILTER (WHERE
        (r.team = 0 AND m.score_a < m.score_b) OR
        (r.team = 1 AND m.score_b < m.score_a)
      ),
      'draws', COUNT(*) FILTER (WHERE m.score_a = m.score_b)
    )
    FROM registrations r
    JOIN matches m ON m.id = r.match_id
    WHERE r.player_id = p_player_id
      AND r.is_withdrawn = false
      AND r.team IS NOT NULL
      AND m.score_a IS NOT NULL
      AND m.score_b IS NOT NULL
      AND (v_season IS NULL OR m.season_id = v_season)
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP FUNCTION IF EXISTS get_player_history(uuid);
DROP FUNCTION IF EXISTS get_player_history(uuid, uuid);

CREATE FUNCTION get_player_history(p_player_id uuid, p_season_id uuid DEFAULT NULL)
RETURNS json AS $$
DECLARE
  v_season uuid;
BEGIN
  v_season := COALESCE(p_season_id, player_current_season_id(p_player_id));

  RETURN (
    SELECT COALESCE(json_agg(t), '[]'::json)
    FROM (
      SELECT
        m.id,
        m.title,
        m.match_date,
        m.match_time,
        m.score_a,
        m.score_b,
        COALESCE(m.team_a_name, 'Équipe Rouge') AS team_a_name,
        COALESCE(m.team_b_name, 'Équipe Bleue') AS team_b_name,
        r.team,
        m.season_id,
        s.name AS season_name,
        CASE
          WHEN m.score_a IS NULL OR m.score_b IS NULL OR r.team IS NULL THEN NULL
          WHEN (r.team = 0 AND m.score_a > m.score_b) OR (r.team = 1 AND m.score_b > m.score_a) THEN 'win'
          WHEN m.score_a = m.score_b THEN 'draw'
          ELSE 'loss'
        END AS result
      FROM registrations r
      JOIN matches m ON m.id = r.match_id
      LEFT JOIN seasons s ON s.id = m.season_id
      WHERE r.player_id = p_player_id
        AND r.is_withdrawn = false
        AND (v_season IS NULL OR m.season_id = v_season)
      ORDER BY m.match_date DESC, m.match_time DESC
    ) t
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP FUNCTION IF EXISTS get_group_player_stats(uuid);
DROP FUNCTION IF EXISTS get_group_player_stats(uuid, uuid);

CREATE FUNCTION get_group_player_stats(p_group_id uuid, p_season_id uuid DEFAULT NULL)
RETURNS json AS $$
DECLARE
  v_season uuid;
BEGIN
  v_season := COALESCE(p_season_id, current_season_id(p_group_id));

  RETURN (
    SELECT COALESCE(json_agg(t), '[]'::json)
    FROM (
      SELECT
        p.id AS player_id,
        COUNT(r.id) FILTER (
          WHERE r.is_withdrawn = false AND r.team IS NOT NULL AND m.score_a IS NOT NULL
            AND (v_season IS NULL OR m.season_id = v_season)
        ) AS played,
        COUNT(r.id) FILTER (
          WHERE r.is_withdrawn = false AND r.team IS NOT NULL AND m.score_a IS NOT NULL
            AND (v_season IS NULL OR m.season_id = v_season)
            AND ((r.team = 0 AND m.score_a > m.score_b) OR (r.team = 1 AND m.score_b > m.score_a))
        ) AS wins
      FROM players p
      LEFT JOIN registrations r ON r.player_id = p.id
      LEFT JOIN matches m ON m.id = r.match_id
      WHERE p.group_id = p_group_id
      GROUP BY p.id
    ) t
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

COMMIT;

-- ============================================================
-- Vérifications post-migration (SELECT non destructifs, hors transaction)
-- ============================================================

-- Chaque groupe a exactement 1 saison ouverte, tous ses matchs rattachés
SELECT g.name AS group_name, s.name AS season_name, s.ended_at, count(m.id) AS match_count
FROM groups g
JOIN seasons s ON s.group_id = g.id
LEFT JOIN matches m ON m.season_id = s.id
GROUP BY g.name, s.name, s.ended_at
ORDER BY g.name, s.name;

-- Aucun match orphelin (doit renvoyer 0)
SELECT count(*) AS matches_without_season FROM matches WHERE season_id IS NULL;

-- Une seule signature par fonction migrée/créée (détection de surcharge résiduelle)
SELECT proname, pg_get_function_identity_arguments(oid) AS args FROM pg_proc
WHERE proname IN (
  'current_season_id', 'player_current_season_id', 'ensure_current_season',
  'start_new_season', 'set_match_season', 'create_match',
  'get_player_stats', 'get_player_history', 'get_group_player_stats'
)
ORDER BY proname;
