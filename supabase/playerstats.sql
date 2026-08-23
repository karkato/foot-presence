-- ============================================================
-- foot-presence — Buts / passes décisives par joueur, mini-match optionnel
-- À exécuter APRÈS seasons.sql
--
-- get_player_stats et get_player_history sont réécrites une seconde
-- fois ici (déjà réécrites dans seasons.sql pour devenir season-aware).
-- C'est le modèle "un fichier = une migration" déjà en vigueur dans ce
-- repo (register_player est défini 3 fois entre setup/audit/security) :
-- chaque fichier reste rejouable seul. La définition qui compte est
-- toujours la dernière exécutée dans l'ordre canonique — voir le
-- commentaire d'ordre dans setup.sql.
-- ============================================================

BEGIN;

-- ============================================================
-- A. Colonnes buts / passes sur registrations
-- ============================================================

ALTER TABLE registrations ADD COLUMN IF NOT EXISTS goals   int NOT NULL DEFAULT 0;
ALTER TABLE registrations ADD COLUMN IF NOT EXISTS assists int NOT NULL DEFAULT 0;

ALTER TABLE registrations DROP CONSTRAINT IF EXISTS registrations_stats_non_negative;
ALTER TABLE registrations ADD CONSTRAINT registrations_stats_non_negative
  CHECK (goals >= 0 AND assists >= 0);

-- Pas de grant à ajuster : registrations a RLS activée avec uniquement
-- une policy SELECT (setup.sql) → toute écriture REST directe est déjà
-- refusée par défaut.

-- ============================================================
-- B. Réglage de groupe : mini-match activable/désactivable
-- ============================================================

ALTER TABLE groups ADD COLUMN IF NOT EXISTS mini_match_enabled boolean NOT NULL DEFAULT false;

-- Remplace set_group_guest_settings par un formulaire de réglages
-- unique (invités + mini-match). Signature différente = nouveau nom de
-- fonction pour éviter toute ambiguïté d'appel pendant la transition ;
-- l'ancienne fonction est retirée explicitement plus bas.
DROP FUNCTION IF EXISTS set_group_guest_settings(uuid, uuid, boolean, int);
DROP FUNCTION IF EXISTS set_group_settings(uuid, uuid, boolean, int, boolean);

CREATE FUNCTION set_group_settings(
  p_group_id uuid,
  p_actor_id uuid,
  p_guests_enabled boolean,
  p_max_guests_per_player int,
  p_mini_match_enabled boolean
) RETURNS void AS $$
DECLARE
  safe_max int;
BEGIN
  PERFORM assert_group_admin(p_actor_id, p_group_id);

  safe_max := CASE WHEN p_max_guests_per_player < 0 THEN NULL ELSE p_max_guests_per_player END;

  UPDATE groups
  SET guests_enabled = p_guests_enabled,
      max_guests_per_player = safe_max,
      mini_match_enabled = p_mini_match_enabled
  WHERE id = p_group_id;

  INSERT INTO audit_log (group_id, actor_id, action, target_type, target_id, details)
  VALUES (p_group_id, p_actor_id, 'update_group_settings', 'group', p_group_id,
    jsonb_build_object('guests_enabled', p_guests_enabled, 'max_guests_per_player', safe_max,
                        'mini_match_enabled', p_mini_match_enabled));
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- set_mini_match_score reste inchangée (security.sql) : le toggle ne
-- contrôle que l'affichage/la saisie côté client, pas l'écriture SQL —
-- ré-activer le mini-match plus tard restitue les valeurs déjà saisies.

-- ============================================================
-- C. assign_team — durcissement (seule RPC d'écriture sans garde
-- d'autorisation du repo) + reset des stats sur changement d'équipe réel
-- ============================================================

DROP FUNCTION IF EXISTS assign_team(uuid, uuid, smallint);
DROP FUNCTION IF EXISTS assign_team(uuid, uuid, smallint, uuid);

CREATE FUNCTION assign_team(p_match_id uuid, p_player_id uuid, p_team smallint, p_actor_id uuid)
RETURNS void AS $$
DECLARE
  v_group_id uuid;
  v_current_team smallint;
BEGIN
  IF p_team IS NOT NULL AND p_team NOT IN (0, 1) THEN
    RAISE EXCEPTION 'invalid_team';
  END IF;

  SELECT group_id INTO v_group_id FROM matches WHERE id = p_match_id;
  IF v_group_id IS NULL THEN
    RAISE EXCEPTION 'match_not_found';
  END IF;

  PERFORM assert_group_admin(p_actor_id, v_group_id);

  -- is_withdrawn = false ici (pas seulement dans l'UPDATE plus bas) :
  -- sans ce filtre, une inscription retirée fait calculer un
  -- "changement d'équipe" fantôme, l'UPDATE (qui filtre bien
  -- is_withdrawn = false) n'écrit rien, et la fonction retourne void
  -- sans erreur — l'admin croit avoir agi alors que rien ne s'est
  -- passé.
  SELECT team INTO v_current_team FROM registrations
  WHERE match_id = p_match_id AND player_id = p_player_id AND is_withdrawn = false;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'not_registered';
  END IF;

  -- Un changement d'équipe réel remet les buts/passes à 0 : sinon les
  -- stats du joueur migreraient dans l'autre équipe et pourraient y
  -- dépasser le score de cette équipe (invariant vérifié seulement à
  -- l'écriture de set_player_match_stats/set_match_score, pas par un
  -- CHECK de table).
  UPDATE registrations SET
    team    = p_team,
    goals   = CASE WHEN p_team IS DISTINCT FROM v_current_team THEN 0 ELSE goals   END,
    assists = CASE WHEN p_team IS DISTINCT FROM v_current_team THEN 0 ELSE assists END
  WHERE match_id = p_match_id AND player_id = p_player_id AND is_withdrawn = false;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================
-- D. set_match_score — garde anti-régression : refuse de baisser le
-- score sous les buts/passes déjà déclarés
-- ============================================================

DROP FUNCTION IF EXISTS set_match_score(uuid, int, int, uuid);

CREATE FUNCTION set_match_score(
  p_match_id uuid,
  p_score_a int,
  p_score_b int,
  p_actor_id uuid
) RETURNS void AS $$
DECLARE
  v_group_id uuid;
  v_ga int; v_gb int; v_aa int; v_ab int;
BEGIN
  -- FOR UPDATE : sérialise avec set_player_match_stats sur ce match (qui
  -- verrouille la même ligne "matches" plus bas). Sans ce verrou, un
  -- admin qui baisse le score et un joueur qui déclare des buts en même
  -- temps peuvent chacun lire l'état "avant" de l'autre et passer tous
  -- les deux leur propre vérification de plafond.
  SELECT group_id INTO v_group_id FROM matches WHERE id = p_match_id FOR UPDATE;
  IF v_group_id IS NULL THEN
    RAISE EXCEPTION 'match_not_found';
  END IF;

  PERFORM assert_group_admin(p_actor_id, v_group_id);

  SELECT COALESCE(SUM(goals)   FILTER (WHERE team = 0), 0), COALESCE(SUM(goals)   FILTER (WHERE team = 1), 0),
         COALESCE(SUM(assists) FILTER (WHERE team = 0), 0), COALESCE(SUM(assists) FILTER (WHERE team = 1), 0)
  INTO v_ga, v_gb, v_aa, v_ab
  FROM registrations WHERE match_id = p_match_id AND is_withdrawn = false;

  IF v_ga > p_score_a OR v_gb > p_score_b OR v_aa > p_score_a OR v_ab > p_score_b THEN
    RAISE EXCEPTION 'stats_exceed_score';
  END IF;

  UPDATE matches SET score_a = p_score_a, score_b = p_score_b
  WHERE id = p_match_id;

  INSERT INTO audit_log (group_id, actor_id, action, target_type, target_id, details)
  VALUES (v_group_id, p_actor_id, 'set_score', 'match', p_match_id,
    jsonb_build_object('score_a', p_score_a, 'score_b', p_score_b));
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================
-- E. set_player_match_stats — saisie des buts/passes (joueur pour lui
-- même, ou admin pour n'importe qui)
-- ============================================================

DROP FUNCTION IF EXISTS set_player_match_stats(uuid, uuid, int, int, uuid);

CREATE FUNCTION set_player_match_stats(
  p_match_id uuid,
  p_player_id uuid,
  p_goals int,
  p_assists int,
  p_actor_id uuid
) RETURNS void AS $$
DECLARE
  v_group_id uuid;
  v_season_id uuid;
  v_score_a int;
  v_score_b int;
  v_team smallint;
  v_withdrawn boolean;
  v_goals int;
  v_assists int;
  v_team_score int;
  v_other_goals int;
  v_other_assists int;
  v_reg_id uuid;
BEGIN
  IF p_actor_id IS NULL THEN
    RAISE EXCEPTION 'not_allowed';
  END IF;

  -- FOR UPDATE : verrouille la ligne "matches" pour la durée de la
  -- transaction, sérialisant avec set_match_score et avec toute autre
  -- saisie concurrente de buts/passes sur ce même match — voir le
  -- commentaire équivalent dans set_match_score.
  SELECT group_id, season_id, score_a, score_b
  INTO v_group_id, v_season_id, v_score_a, v_score_b
  FROM matches WHERE id = p_match_id FOR UPDATE;
  IF v_group_id IS NULL THEN
    RAISE EXCEPTION 'match_not_found';
  END IF;

  -- soi-même OU admin du groupe
  IF p_actor_id <> p_player_id AND NOT is_group_admin(p_actor_id, v_group_id) THEN
    RAISE EXCEPTION 'not_allowed';
  END IF;

  -- fenêtre de saisie : saison courante uniquement, admins inclus
  IF EXISTS (SELECT 1 FROM seasons WHERE id = v_season_id AND ended_at IS NOT NULL) THEN
    RAISE EXCEPTION 'season_archived';
  END IF;

  IF v_score_a IS NULL OR v_score_b IS NULL THEN
    RAISE EXCEPTION 'score_not_set';
  END IF;

  SELECT id, team, is_withdrawn INTO v_reg_id, v_team, v_withdrawn
  FROM registrations WHERE match_id = p_match_id AND player_id = p_player_id;
  IF NOT FOUND OR v_withdrawn THEN
    RAISE EXCEPTION 'not_registered';
  END IF;
  IF v_team IS NULL THEN
    RAISE EXCEPTION 'team_not_assigned';
  END IF;

  v_goals   := GREATEST(0, COALESCE(p_goals, 0));
  v_assists := GREATEST(0, COALESCE(p_assists, 0));

  -- Plafond équipe vérifié côté serveur : c'est l'autorité, le client
  -- n'aide que l'UX.
  SELECT COALESCE(SUM(goals), 0), COALESCE(SUM(assists), 0)
  INTO v_other_goals, v_other_assists
  FROM registrations
  WHERE match_id = p_match_id AND team = v_team AND is_withdrawn = false AND player_id <> p_player_id;

  v_team_score := CASE WHEN v_team = 0 THEN v_score_a ELSE v_score_b END;

  IF v_other_goals + v_goals > v_team_score THEN
    RAISE EXCEPTION 'goals_exceed_score';
  END IF;
  IF v_other_assists + v_assists > v_team_score THEN
    RAISE EXCEPTION 'assists_exceed_score';
  END IF;

  UPDATE registrations SET goals = v_goals, assists = v_assists
  WHERE match_id = p_match_id AND player_id = p_player_id AND is_withdrawn = false;

  INSERT INTO audit_log (group_id, actor_id, action, target_type, target_id, details)
  VALUES (v_group_id, p_actor_id, 'set_player_stats', 'registration', v_reg_id,
    jsonb_build_object('match_id', p_match_id, 'player_id', p_player_id,
                        'goals', v_goals, 'assists', v_assists));
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================
-- E2. withdraw_player / register_player — reset des buts/passes au
-- retrait et à la ré-inscription
--
-- Sans ce reset, le plafond "Σ buts équipe ≤ score" de
-- set_player_match_stats est contournable sans aucun appel hors UI :
-- (1) un joueur déclare des buts jusqu'au plafond de son équipe ;
-- (2) il est retiré (withdraw_player ne touchait ni goals ni assists,
--     et le plafond ne compte que is_withdrawn = false → la place se
--     libère) ; (3) un autre joueur de la même équipe déclare à son
--     tour jusqu'au plafond ; (4) le premier est ré-inscrit
--     (register_player ne réinitialisait pas ses stats) → ses buts
--     réapparaissent, dépassant le score affiché.
-- ============================================================

DROP FUNCTION IF EXISTS withdraw_player(uuid, uuid);
DROP FUNCTION IF EXISTS withdraw_player(uuid, uuid, uuid);

CREATE FUNCTION withdraw_player(p_match_id uuid, p_player_id uuid, p_withdrawn_by uuid)
RETURNS void AS $$
DECLARE
  reg_id uuid;
  target_player_name text;
BEGIN
  UPDATE registrations SET is_withdrawn = true, goals = 0, assists = 0
  WHERE match_id = p_match_id AND player_id = p_player_id
  RETURNING id INTO reg_id;

  SELECT COALESCE(display_name, username) INTO target_player_name FROM players WHERE id = p_player_id;

  INSERT INTO audit_log (group_id, actor_id, action, target_type, target_id, details)
  SELECT p.group_id, p_withdrawn_by,
    CASE WHEN p_player_id = p_withdrawn_by THEN 'withdraw' ELSE 'withdraw_proxy' END,
    'registration', reg_id,
    jsonb_build_object('match_id', p_match_id, 'player_id', p_player_id, 'player_name', target_player_name)
  FROM players p WHERE p.id = p_withdrawn_by;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP FUNCTION IF EXISTS register_player(uuid, uuid, uuid);

CREATE FUNCTION register_player(p_match_id uuid, p_player_id uuid, p_registered_by uuid)
RETURNS json AS $$
DECLARE
  proxy_count int;
  is_registrar_admin boolean;
  result registrations%ROWTYPE;
  target_player_name text;
  v_group_id uuid;
BEGIN
  SELECT group_id INTO v_group_id FROM matches WHERE id = p_match_id;
  IF v_group_id IS NULL THEN
    RAISE EXCEPTION 'match_not_found';
  END IF;

  is_registrar_admin := is_group_admin(p_registered_by, v_group_id);

  IF p_player_id != p_registered_by AND NOT is_registrar_admin THEN
    SELECT COUNT(*) INTO proxy_count FROM registrations
    WHERE match_id = p_match_id
      AND registered_by = p_registered_by
      AND player_id != p_registered_by
      AND is_withdrawn = false;
    IF proxy_count >= 2 THEN
      RAISE EXCEPTION 'proxy_limit_reached';
    END IF;
  END IF;

  INSERT INTO registrations (match_id, player_id, registered_by)
  VALUES (p_match_id, p_player_id, p_registered_by)
  ON CONFLICT (match_id, player_id) DO UPDATE
    SET is_withdrawn = false,
        registered_at = now(),
        registered_by = p_registered_by,
        -- Une ré-inscription repart de zéro : les buts/passes d'un
        -- passage précédent ne doivent pas ressusciter (voir le
        -- commentaire en tête de cette section).
        goals = 0,
        assists = 0
  RETURNING * INTO result;

  SELECT COALESCE(display_name, username) INTO target_player_name FROM players WHERE id = p_player_id;

  INSERT INTO audit_log (group_id, actor_id, action, target_type, target_id, details)
  SELECT p.group_id, p_registered_by,
    CASE WHEN p_player_id = p_registered_by THEN 'register' ELSE 'register_proxy' END,
    'registration', result.id,
    jsonb_build_object('match_id', p_match_id, 'player_id', p_player_id, 'player_name', target_player_name)
  FROM players p WHERE p.id = p_registered_by;

  RETURN row_to_json(result);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Rattrapage pour une base où playerstats.sql aurait déjà tourné une
-- première fois sans ce reset (goals/assists déjà à 0 par défaut sur une
-- base neuve, donc no-op dans le cas courant).
UPDATE registrations SET goals = 0, assists = 0 WHERE is_withdrawn = true AND (goals <> 0 OR assists <> 0);

-- ============================================================
-- F. get_player_stats / get_player_history — ajoutent goals/assists
-- ============================================================

-- Les deux DROP par fonction couvrent : la signature à 1 argument
-- héritée de features.sql (défense en profondeur si une base a rejoué
-- features.sql sans passer par seasons.sql), et la signature à 2
-- arguments que CE fichier recrée (sans le second DROP, rejouer
-- playerstats.sql seul échoue en "function already exists").
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
      'draws', COUNT(*) FILTER (WHERE m.score_a = m.score_b),
      'goals', COALESCE(SUM(r.goals), 0),
      'assists', COALESCE(SUM(r.assists), 0)
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
-- Vérifications post-migration (SELECT non destructifs, hors transaction)
-- ============================================================

-- Une seule signature par fonction migrée/créée (détection de surcharge résiduelle)
SELECT proname, pg_get_function_identity_arguments(oid) AS args FROM pg_proc
WHERE proname IN (
  'assign_team', 'set_match_score', 'set_player_match_stats', 'set_group_settings',
  'withdraw_player', 'register_player',
  'get_player_stats', 'get_player_history', 'get_group_player_stats'
)
ORDER BY proname;

-- goals/assists bien remis à 0 sur toute inscription retirée (attendu : 0)
SELECT count(*) AS withdrawn_with_stats FROM registrations WHERE is_withdrawn = true AND (goals <> 0 OR assists <> 0);

-- Contrôles manuels à exécuter avec de vrais ids une fois le script joué :
-- SELECT set_player_match_stats('<match>', '<joueur>', 99, 0, '<joueur>');          -- attendu : goals_exceed_score
-- SELECT set_player_match_stats('<match>', '<autre>',  1, 0, '<joueur_non_admin>'); -- attendu : not_allowed
