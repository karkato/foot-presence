-- ============================================================
-- foot-presence — Noms d'équipe par défaut : Équipe A/B → Équipe Rouge/Bleue
-- À exécuter APRÈS playerstats.sql
--
-- Les fichiers historiques (features.sql, security.sql, seasons.sql,
-- playerstats.sql) ont été mis à jour avec les nouveaux littéraux
-- 'Équipe Rouge'/'Équipe Bleue', mais cela ne suffit pas pour une base
-- déjà existante :
--   - `ADD COLUMN IF NOT EXISTS ... DEFAULT` est un no-op sur une colonne
--     déjà présente, seul `ALTER COLUMN ... SET DEFAULT` change le
--     défaut réellement stocké en base ;
--   - `create_match` et `get_player_history` doivent être redéfinies ici
--     (DROP FUNCTION IF EXISTS typé + CREATE) pour que la base vivante
--     utilise les nouveaux défauts, exactement comme security.sql/
--     seasons.sql/playerstats.sql l'ont fait pour leurs propres
--     changements de signature.
--
-- Pas de migration rétroactive des données : les matchs déjà créés
-- gardent leurs team_a_name/team_b_name actuels tels quels, seul le
-- défaut appliqué aux FUTURS matchs sans nom explicite change.
-- ============================================================

BEGIN;

-- ============================================================
-- A. Défaut de colonne — affecte les futurs INSERT sans team_a_name/b
-- explicite qui ne passeraient pas par create_match (aucun cas connu
-- aujourd'hui, mais cohérence avec le schéma)
-- ============================================================

ALTER TABLE matches ALTER COLUMN team_a_name SET DEFAULT 'Équipe Rouge';
ALTER TABLE matches ALTER COLUMN team_b_name SET DEFAULT 'Équipe Bleue';

-- ============================================================
-- B. create_match — signature strictement inchangée, seuls les 2
-- défauts de p_team_a_name/p_team_b_name changent. Corps recopié à
-- l'identique de seasons.sql (version vivante).
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
-- C. get_player_history — signature strictement inchangée, seuls les 2
-- COALESCE de team_a_name/team_b_name changent. Corps recopié à
-- l'identique de playerstats.sql (version vivante, avec goals/assists).
-- ============================================================

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
        r.goals,
        r.assists,
        CASE WHEN r.team = 0 THEN m.score_a WHEN r.team = 1 THEN m.score_b ELSE NULL END AS team_score,
        COALESCE((
          SELECT SUM(r2.goals) FROM registrations r2
          WHERE r2.match_id = m.id AND r2.team = r.team AND r2.is_withdrawn = false AND r2.player_id <> r.player_id
        ), 0) AS team_goals_other,
        COALESCE((
          SELECT SUM(r2.assists) FROM registrations r2
          WHERE r2.match_id = m.id AND r2.team = r.team AND r2.is_withdrawn = false AND r2.player_id <> r.player_id
        ), 0) AS team_assists_other,
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

-- Pas de GRANT EXECUTE explicite ici : ni seasons.sql ni playerstats.sql
-- n'en ajoutent pour create_match/get_player_history après leur propre
-- DROP+CREATE. Supabase applique des ALTER DEFAULT PRIVILEGES qui
-- accordent EXECUTE à anon/authenticated sur toute nouvelle fonction du
-- schéma public (voir le commentaire équivalent en seasons.sql section C)
-- — un DROP FUNCTION suivi d'un CREATE FUNCTION recrée l'objet et
-- redéclenche ce défaut, donc rien à re-accorder manuellement.

COMMIT;

-- ============================================================
-- Vérifications post-migration (SELECT non destructifs, hors transaction)
-- ============================================================

-- Une seule signature par fonction migrée (détection de surcharge résiduelle)
SELECT proname, pg_get_function_identity_arguments(oid) AS args FROM pg_proc
WHERE proname IN ('create_match', 'get_player_history')
ORDER BY proname;

-- Défauts de colonne bien mis à jour (attendu : 'Équipe Rouge'::text / 'Équipe Bleue'::text)
SELECT column_name, column_default FROM information_schema.columns
WHERE table_name = 'matches' AND column_name IN ('team_a_name', 'team_b_name');

-- Informatif : matchs existants encore sur les anciens noms par défaut.
-- Pas de migration rétroactive des données, ce nombre est attendu > 0 et
-- ne doit pas bouger suite à l'exécution de ce script.
SELECT count(*) AS matches_still_on_old_default_names FROM matches
WHERE team_a_name = 'Équipe A' OR team_b_name = 'Équipe B';
