-- ============================================================
-- foot-presence — Taux de victoire du classement rapporté aux matchs
-- de la saison, pas aux seuls matchs joués par le joueur
-- À exécuter APRÈS setup.sql, audit.sql, features.sql, guestsettings.sql,
-- security.sql, seasons.sql, playerstats.sql, teamnames.sql, seasondates.sql
--
-- Pourquoi : get_group_player_stats renvoyait `played` (matchs disputés
-- par le joueur) comme dénominateur du taux de victoire côté front
-- (buildLeaderboardRows). Un joueur ayant disputé 1 match sur 10 dans la
-- saison et l'ayant gagné affichait donc 100%, à égalité apparente avec
-- un joueur ayant joué et gagné ses 10 matchs. On ajoute `season_matches`
-- (nombre de matchs de la saison déjà scorés, tous joueurs confondus) pour
-- que le front calcule wins / season_matches à la place de wins / played.
-- `played` est conservé tel quel : toujours affiché ("X matchs joués").
--
-- Au passage : seasons.sql (rebind matches/saisons) avait redéfini cette
-- fonction sans reporter `goals`/`assists` présents dans la version de
-- playerstats.sql -- régression silencieuse (le front recevait undefined
-- pour les buts/passes du classement). Corrigé ici en les réintégrant.
-- ============================================================

BEGIN;

DROP FUNCTION IF EXISTS get_group_player_stats(uuid, uuid);

CREATE FUNCTION get_group_player_stats(p_group_id uuid, p_season_id uuid DEFAULT NULL)
RETURNS json AS $$
DECLARE
  v_season uuid;
  v_season_matches int;
BEGIN
  v_season := COALESCE(p_season_id, current_season_id(p_group_id));

  -- Matchs déjà joués (score renseigné) de la saison, tous joueurs
  -- confondus -- un match futur sans score ne pénalise donc personne.
  SELECT count(*) INTO v_season_matches
  FROM matches m
  WHERE m.group_id = p_group_id
    AND m.score_a IS NOT NULL
    AND (v_season IS NULL OR m.season_id = v_season);

  RETURN (
    SELECT COALESCE(json_agg(t), '[]'::json)
    FROM (
      SELECT
        p.id AS player_id,
        v_season_matches AS season_matches,
        COUNT(r.id) FILTER (
          WHERE r.is_withdrawn = false AND r.team IS NOT NULL AND m.score_a IS NOT NULL
            AND (v_season IS NULL OR m.season_id = v_season)
        ) AS played,
        COUNT(r.id) FILTER (
          WHERE r.is_withdrawn = false AND r.team IS NOT NULL AND m.score_a IS NOT NULL
            AND (v_season IS NULL OR m.season_id = v_season)
            AND ((r.team = 0 AND m.score_a > m.score_b) OR (r.team = 1 AND m.score_b > m.score_a))
        ) AS wins,
        COALESCE(SUM(r.goals) FILTER (
          WHERE r.is_withdrawn = false AND r.team IS NOT NULL AND m.score_a IS NOT NULL
            AND (v_season IS NULL OR m.season_id = v_season)
        ), 0) AS goals,
        COALESCE(SUM(r.assists) FILTER (
          WHERE r.is_withdrawn = false AND r.team IS NOT NULL AND m.score_a IS NOT NULL
            AND (v_season IS NULL OR m.season_id = v_season)
        ), 0) AS assists
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
-- Vérification post-migration (SELECT non destructif)
-- ============================================================

-- Une seule signature pour la fonction (détection de surcharge résiduelle)
SELECT proname, pg_get_function_identity_arguments(oid) AS args FROM pg_proc
WHERE proname = 'get_group_player_stats';
