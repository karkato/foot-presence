-- ============================================================
-- foot-presence — Saisons : rattachement par date plutôt que par
-- instant de création
-- À exécuter APRÈS setup.sql, audit.sql, features.sql, guestsettings.sql,
-- security.sql, seasons.sql, playerstats.sql, teamnames.sql
--
-- Pourquoi : jusqu'ici, un match était rattaché à "la saison ouverte au
-- moment où create_match tourne" (via ensure_current_season), et rien ne
-- recalculait ce rattachement ensuite. Un admin qui démarre une nouvelle
-- saison le 4 septembre pour un match créé le 3 mais joué le 6 se
-- retrouvait avec ce match coincé dans l'ancienne saison alors qu'il
-- devrait compter dans la nouvelle. Ce fichier fait de match_date la
-- seule source de vérité du rattachement : chaque saison porte désormais
-- une frontière de dates explicite (start_date/end_date), un trigger
-- recalcule season_id à chaque INSERT/UPDATE de match_date, et
-- start_new_season accepte une date de début choisie par l'admin
-- (au lieu de toujours être "maintenant").
--
-- Chaque fonction dont la signature change est précédée d'un DROP
-- FUNCTION IF EXISTS typé (voir security.sql pour le pourquoi : un
-- CREATE OR REPLACE avec un paramètre supplémentaire crée une surcharge,
-- il ne remplace rien).
--
-- Pré-vol (à exécuter séparément avant la migration, à titre de diagnostic) :
-- SELECT group_id, started_at::date, count(*) FROM seasons
-- GROUP BY group_id, started_at::date HAVING count(*) > 1;
-- ============================================================

BEGIN;

-- ============================================================
-- A. Colonnes de dates sur seasons + backfill
-- ============================================================

ALTER TABLE seasons ADD COLUMN IF NOT EXISTS start_date date;
ALTER TABLE seasons ADD COLUMN IF NOT EXISTS end_date date;   -- NULL = saison courante/ouverte

-- Backfill : start_date = date de started_at. end_date d'une saison
-- archivée = start_date de la saison suivante du même groupe moins un
-- jour (pas de trou entre deux saisons), ou à défaut ended_at::date si
-- aucune suivante n'est identifiable (situation de bord, ne devrait pas
-- arriver en pratique puisque start_new_season clôture toujours la
-- précédente avant d'en ouvrir une nouvelle).
WITH ordered AS (
  SELECT
    id,
    group_id,
    started_at,
    ended_at,
    started_at::date AS computed_start_date,
    lead(started_at::date) OVER (PARTITION BY group_id ORDER BY started_at ASC) AS next_start_date
  FROM seasons
  WHERE start_date IS NULL
)
-- GREATEST ci-dessous : si deux saisons d'un même groupe partagent le même
-- started_at::date (double-clic historique sur "démarrer une saison"),
-- next_start_date - 1 serait antérieur à start_date, ce qui ferait
-- échouer la contrainte seasons_end_after_start ajoutée juste après et
-- donc toute la migration. On accepte à la place une saison dégénérée
-- d'un jour plutôt qu'un échec bloquant de la migration.
UPDATE seasons s SET
  start_date = o.computed_start_date,
  end_date = CASE
    WHEN s.ended_at IS NULL THEN NULL
    WHEN o.next_start_date IS NOT NULL THEN GREATEST(o.next_start_date - 1, o.computed_start_date)
    ELSE s.ended_at::date
  END
FROM ordered o
WHERE o.id = s.id;

ALTER TABLE seasons ALTER COLUMN start_date SET NOT NULL;

ALTER TABLE seasons DROP CONSTRAINT IF EXISTS seasons_end_after_start;
ALTER TABLE seasons ADD CONSTRAINT seasons_end_after_start CHECK (end_date IS NULL OR end_date >= start_date);

-- ============================================================
-- B. Helpers internes — jamais appelables directement en RPC
-- ============================================================

DROP FUNCTION IF EXISTS season_for_date(uuid, date);
DROP FUNCTION IF EXISTS resync_group_seasons(uuid);

-- Saison du groupe dont l'intervalle [start_date, end_date] contient
-- p_date. Si aucune saison ne correspond (date antérieure à la première
-- saison connue du groupe), replie sur la saison la plus ancienne du
-- groupe plutôt que de renvoyer NULL — matches.season_id est NOT NULL,
-- un match ne doit jamais devenir orphelin faute de saison couvrant sa
-- date.
CREATE FUNCTION season_for_date(p_group_id uuid, p_date date)
RETURNS uuid AS $$
  SELECT COALESCE(
    (
      SELECT id FROM seasons
      WHERE group_id = p_group_id
        AND start_date <= p_date
        AND (end_date IS NULL OR p_date <= end_date)
      LIMIT 1
    ),
    (
      SELECT id FROM seasons
      WHERE group_id = p_group_id
      ORDER BY start_date ASC
      LIMIT 1
    )
  );
$$ LANGUAGE sql STABLE SECURITY DEFINER;

-- Recalcule season_id de tous les matchs d'un groupe à partir de leur
-- match_date. Appelé après tout changement de frontière de saisons
-- (start_new_season) ; le trigger de la section C gère le cas courant
-- (un seul match qui change de date).
CREATE FUNCTION resync_group_seasons(p_group_id uuid)
RETURNS void AS $$
BEGIN
  UPDATE matches SET season_id = season_for_date(group_id, match_date)
  WHERE group_id = p_group_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Redéfinition : seasons.start_date est NOT NULL depuis la section A
-- ci-dessus, mais le corps historique (supabase/seasons.sql) insérait une
-- nouvelle saison sans le renseigner. Sans ce correctif, un groupe tout
-- neuf (aucune saison, aucun match) qui crée son premier match ferait
-- échouer create_match : ensure_current_season lèverait une violation de
-- contrainte NOT NULL sur l'INSERT. Logique inchangée par ailleurs,
-- start_date = current_date (cohérent avec le défaut de start_new_season
-- ci-dessous) et end_date = NULL (saison ouverte).
DROP FUNCTION IF EXISTS ensure_current_season(uuid);

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
  INSERT INTO seasons (group_id, name, start_date, end_date)
  VALUES (p_group_id, 'Saison ' || (v_count + 1), current_date, NULL)
  RETURNING id INTO v_season_id;
  RETURN v_season_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

REVOKE EXECUTE ON FUNCTION season_for_date(uuid, date) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION resync_group_seasons(uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION ensure_current_season(uuid) FROM PUBLIC, anon, authenticated;

-- ============================================================
-- C. Trigger — recalcule season_id à chaque INSERT/UPDATE de match_date
-- ============================================================

CREATE OR REPLACE FUNCTION trg_set_match_season()
RETURNS trigger AS $$
BEGIN
  NEW.season_id := season_for_date(NEW.group_id, NEW.match_date);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS set_match_season_trigger ON matches;

CREATE TRIGGER set_match_season_trigger
  BEFORE INSERT OR UPDATE OF match_date, group_id ON matches
  FOR EACH ROW EXECUTE FUNCTION trg_set_match_season();

-- ============================================================
-- D. create_match — le trigger ci-dessus fait le vrai rattachement,
-- ensure_current_season ne sert plus qu'à garantir qu'un groupe tout
-- neuf (sans aucune saison) a au moins une saison sur laquelle
-- season_for_date puisse se replier. Signature et valeurs par défaut
-- identiques à teamnames.sql (défauts 'Équipe Rouge'/'Équipe Bleue'),
-- mais season_id n'est plus assigné en dur dans l'INSERT — c'est
-- désormais le trigger set_match_season_trigger (section C) qui s'en
-- charge.
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
BEGIN
  PERFORM assert_group_admin(p_actor_id, p_group_id);

  PERFORM ensure_current_season(p_group_id);

  INSERT INTO matches (group_id, title, match_date, match_time, max_players, registration_deadline, is_closed, team_a_name, team_b_name)
  VALUES (p_group_id, p_title, p_match_date, p_match_time, p_max_players, p_registration_deadline, false, p_team_a_name, p_team_b_name)
  RETURNING * INTO result;

  INSERT INTO audit_log (group_id, actor_id, action, target_type, target_id, details)
  VALUES (p_group_id, p_actor_id, 'create_match', 'match', result.id,
    jsonb_build_object('title', p_title));

  RETURN row_to_json(result);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================
-- E. update_match (supabase/security.sql) : volontairement NON modifié
-- ici. Il ne touche pas season_id — le trigger de la section C prend le
-- relais dès qu'un UPDATE change match_date (ou group_id).
-- ============================================================

-- ============================================================
-- F. start_new_season — date de début choisie par l'admin, redistribue
-- tous les matchs du groupe. set_match_season est supprimée : jamais
-- appelée côté client, et incompatible avec le rattachement désormais
-- automatique (un admin qui la rappellerait manuellement verrait son
-- changement écrasé au prochain UPDATE de match_date par le trigger).
-- ============================================================

DROP FUNCTION IF EXISTS start_new_season(uuid, uuid, text);
DROP FUNCTION IF EXISTS start_new_season(uuid, uuid, text, date);
DROP FUNCTION IF EXISTS set_match_season(uuid, uuid, uuid);

CREATE FUNCTION start_new_season(
  p_actor_id uuid,
  p_group_id uuid,
  p_name text DEFAULT NULL,
  p_start_date date DEFAULT current_date
)
RETURNS json AS $$
DECLARE
  v_count int;
  v_name text;
  v_current_start date;
  result seasons%ROWTYPE;
BEGIN
  PERFORM assert_group_admin(p_actor_id, p_group_id);

  -- Verrou sur la ligne du groupe : sérialise deux appels concurrents à
  -- "démarrer une nouvelle saison" plutôt que de laisser l'index unique
  -- partiel lever une violation de contrainte opaque au second — voir
  -- le commentaire équivalent dans seasons.sql.
  PERFORM 1 FROM groups WHERE id = p_group_id FOR UPDATE;

  SELECT start_date INTO v_current_start FROM seasons
  WHERE group_id = p_group_id AND ended_at IS NULL;

  IF v_current_start IS NOT NULL AND p_start_date <= v_current_start THEN
    RAISE EXCEPTION 'invalid_season_start';
  END IF;

  UPDATE seasons SET ended_at = now(), end_date = p_start_date - 1
  WHERE group_id = p_group_id AND ended_at IS NULL;

  SELECT count(*) INTO v_count FROM seasons WHERE group_id = p_group_id;
  v_name := COALESCE(NULLIF(trim(p_name), ''), 'Saison ' || (v_count + 1));

  INSERT INTO seasons (group_id, name, started_at, start_date, end_date)
  VALUES (p_group_id, v_name, now(), p_start_date, NULL)
  RETURNING * INTO result;

  PERFORM resync_group_seasons(p_group_id);

  INSERT INTO audit_log (group_id, actor_id, action, target_type, target_id, details)
  VALUES (p_group_id, p_actor_id, 'start_season', 'season', result.id,
    jsonb_build_object('name', v_name, 'start_date', p_start_date));

  RETURN row_to_json(result);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================
-- G. Resync global — corrige immédiatement les matchs déjà mal
-- rattachés (créés avant le démarrage d'une saison mais joués après,
-- ou l'inverse), pour tous les groupes existants.
-- ============================================================

COMMIT;

-- ============================================================
-- Vérifications post-migration (SELECT non destructifs, hors transaction)
-- ============================================================

SELECT resync_group_seasons(id) FROM groups;

-- Aucun match orphelin (doit renvoyer 0)
SELECT count(*) AS matches_without_season FROM matches WHERE season_id IS NULL;

-- Aucune saison chevauchante par groupe (doit renvoyer 0 lignes) : pour
-- chaque paire de saisons du même groupe, leurs intervalles ne doivent
-- jamais se recouper.
SELECT a.group_id, a.name AS season_a, b.name AS season_b
FROM seasons a
JOIN seasons b ON a.group_id = b.group_id AND a.id < b.id
WHERE a.start_date <= COALESCE(b.end_date, 'infinity'::date)
  AND b.start_date <= COALESCE(a.end_date, 'infinity'::date);

-- Décompte de matchs par saison, après resync
SELECT g.name AS group_name, s.name AS season_name, s.start_date, s.end_date, count(m.id) AS match_count
FROM groups g
JOIN seasons s ON s.group_id = g.id
LEFT JOIN matches m ON m.season_id = s.id
GROUP BY g.name, s.name, s.start_date, s.end_date
ORDER BY g.name, s.start_date;

-- Une seule signature par fonction migrée/créée (détection de surcharge résiduelle)
SELECT proname, pg_get_function_identity_arguments(oid) AS args FROM pg_proc
WHERE proname IN (
  'season_for_date', 'resync_group_seasons', 'ensure_current_season',
  'create_match', 'start_new_season', 'set_match_season'
)
ORDER BY proname;
