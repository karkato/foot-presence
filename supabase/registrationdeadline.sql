-- ============================================================
-- foot-presence — Fermeture des inscriptions après registration_deadline
-- À exécuter APRÈS setup.sql, audit.sql, features.sql, guestsettings.sql,
-- security.sql, seasons.sql, playerstats.sql, teamnames.sql, seasondates.sql,
-- leaderboard-season-winrate.sql
--
-- Pourquoi : le champ registration_deadline est saisi dans le formulaire
-- admin depuis le début, mais rien ne l'appliquait -- un joueur pouvait
-- s'inscrire après la limite. On bloque ici register_player une fois la
-- deadline dépassée, pour tout le monde (y compris un admin qui inscrit
-- un autre joueur) : si un admin veut accepter un inscrit tardif, il
-- recule ou supprime la deadline du match (match-form) plutôt que de
-- contourner la règle au cas par cas. withdraw_player n'est pas concerné
-- -- se désister reste toujours possible, deadline ou pas.
-- ============================================================

BEGIN;

DROP FUNCTION IF EXISTS register_player(uuid, uuid, uuid);

CREATE FUNCTION register_player(p_match_id uuid, p_player_id uuid, p_registered_by uuid)
RETURNS json AS $$
DECLARE
  proxy_count int;
  is_registrar_admin boolean;
  result registrations%ROWTYPE;
  target_player_name text;
  v_group_id uuid;
  v_deadline timestamptz;
BEGIN
  SELECT group_id, registration_deadline INTO v_group_id, v_deadline
  FROM matches WHERE id = p_match_id;
  IF v_group_id IS NULL THEN
    RAISE EXCEPTION 'match_not_found';
  END IF;

  IF v_deadline IS NOT NULL AND now() > v_deadline THEN
    RAISE EXCEPTION 'deadline_passed';
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

COMMIT;

-- ============================================================
-- Vérification post-migration (SELECT non destructif)
-- ============================================================

SELECT proname, pg_get_function_identity_arguments(oid) AS args FROM pg_proc
WHERE proname = 'register_player';
