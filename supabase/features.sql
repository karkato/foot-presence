-- ============================================================
-- foot-presence — Scores + Équipes + Stats
-- À exécuter APRÈS setup.sql ET audit.sql
-- ============================================================

-- Scores et noms des équipes sur les matchs
ALTER TABLE matches ADD COLUMN IF NOT EXISTS score_a int;
ALTER TABLE matches ADD COLUMN IF NOT EXISTS score_b int;
ALTER TABLE matches ADD COLUMN IF NOT EXISTS team_a_name text DEFAULT 'Équipe A';
ALTER TABLE matches ADD COLUMN IF NOT EXISTS team_b_name text DEFAULT 'Équipe B';

-- Mini-match bonus
ALTER TABLE matches ADD COLUMN IF NOT EXISTS score_a2 int;
ALTER TABLE matches ADD COLUMN IF NOT EXISTS score_b2 int;
ALTER TABLE matches ADD COLUMN IF NOT EXISTS mini_match_target int;

-- Équipe du joueur sur chaque inscription (0 = équipe A, 1 = équipe B)
ALTER TABLE registrations ADD COLUMN IF NOT EXISTS team smallint;

-- ============================================================
-- RPCs
-- ============================================================

-- Assigner un joueur à une équipe (NULL pour retirer)
CREATE OR REPLACE FUNCTION assign_team(p_match_id uuid, p_player_id uuid, p_team smallint)
RETURNS void AS $$
BEGIN
  UPDATE registrations SET team = p_team
  WHERE match_id = p_match_id AND player_id = p_player_id AND is_withdrawn = false;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Enregistrer le score d'un match + log
CREATE OR REPLACE FUNCTION set_match_score(
  p_match_id uuid,
  p_score_a int,
  p_score_b int,
  p_actor_id uuid
) RETURNS void AS $$
BEGIN
  UPDATE matches SET score_a = p_score_a, score_b = p_score_b
  WHERE id = p_match_id;

  INSERT INTO audit_log (group_id, actor_id, action, target_type, target_id, details)
  SELECT p.group_id, p_actor_id, 'set_score', 'match', p_match_id,
    jsonb_build_object('score_a', p_score_a, 'score_b', p_score_b)
  FROM players p WHERE p.id = p_actor_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Stats d'un joueur (J/V/D/N) — matchs avec score ET équipe assignée uniquement
CREATE OR REPLACE FUNCTION get_player_stats(p_player_id uuid)
RETURNS json AS $$
BEGIN
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
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Historique complet d'un joueur (tous matchs joués, scorés ou non)
CREATE OR REPLACE FUNCTION get_player_history(p_player_id uuid)
RETURNS json AS $$
BEGIN
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
        COALESCE(m.team_a_name, 'Équipe A') AS team_a_name,
        COALESCE(m.team_b_name, 'Équipe B') AS team_b_name,
        r.team,
        CASE
          WHEN m.score_a IS NULL OR m.score_b IS NULL OR r.team IS NULL THEN NULL
          WHEN (r.team = 0 AND m.score_a > m.score_b) OR (r.team = 1 AND m.score_b > m.score_a) THEN 'win'
          WHEN m.score_a = m.score_b THEN 'draw'
          ELSE 'loss'
        END AS result
      FROM registrations r
      JOIN matches m ON m.id = r.match_id
      WHERE r.player_id = p_player_id
        AND r.is_withdrawn = false
      ORDER BY m.match_date DESC, m.match_time DESC
    ) t
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Stats de tous les joueurs d'un groupe (pour afficher le ratio dans les listes de présents)
CREATE OR REPLACE FUNCTION get_group_player_stats(p_group_id uuid)
RETURNS json AS $$
BEGIN
  RETURN (
    SELECT COALESCE(json_agg(t), '[]'::json)
    FROM (
      SELECT
        p.id AS player_id,
        COUNT(r.id) FILTER (
          WHERE r.is_withdrawn = false AND r.team IS NOT NULL AND m.score_a IS NOT NULL
        ) AS played,
        COUNT(r.id) FILTER (
          WHERE r.is_withdrawn = false AND r.team IS NOT NULL AND m.score_a IS NOT NULL
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
