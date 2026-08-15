-- ============================================================
-- foot-presence — Durcissement des autorisations
-- À exécuter APRÈS setup.sql, audit.sql, features.sql, guestsettings.sql
-- (PAS après sessions.sql, qui n'existe plus dans le repo — voir
-- cleanup.sql pour l'historique de cette désync)
-- ============================================================
--
-- Objectif : un seul point de vérité pour "cet acteur est-il admin de ce
-- groupe ?" (helpers ci-dessous), utilisé par toutes les RPC d'écriture
-- privilégiées, et fermeture de la faille RLS qui permettait d'écrire
-- directement sur "matches" via REST avec la clé anon.
--
-- Anti-collision : sessions.sql contenait des variantes p_token de
-- beaucoup de ces mêmes fonctions avec des signatures positionnelles
-- IDENTIQUES (mêmes types, même ordre). Si l'une d'elles avait un jour
-- été partiellement appliquée en base (remplacement silencieux via
-- CREATE OR REPLACE), un simple CREATE OR REPLACE ici pourrait échouer
-- ou ne pas changer ce qu'on croit changer. Chaque fonction ci-dessous
-- est donc précédée d'un DROP FUNCTION IF EXISTS typé.

BEGIN;

-- ============================================================
-- A. Helpers d'autorisation
-- ============================================================

DROP FUNCTION IF EXISTS is_group_admin(uuid, uuid);
DROP FUNCTION IF EXISTS assert_group_admin(uuid, uuid);

CREATE FUNCTION is_group_admin(p_actor_id uuid, p_group_id uuid)
RETURNS boolean AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1 FROM players
    WHERE id = p_actor_id AND group_id = p_group_id AND is_admin = true
  );
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER;

CREATE FUNCTION assert_group_admin(p_actor_id uuid, p_group_id uuid)
RETURNS void AS $$
BEGIN
  IF NOT is_group_admin(p_actor_id, p_group_id) THEN
    RAISE EXCEPTION 'not_admin';
  END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Ces deux helpers ne doivent jamais être appelables directement en RPC
-- depuis le client — uniquement depuis d'autres fonctions SECURITY DEFINER.
REVOKE EXECUTE ON FUNCTION is_group_admin(uuid, uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION assert_group_admin(uuid, uuid) FROM PUBLIC, anon, authenticated;

-- ============================================================
-- B. Migration des fonctions existantes vers les helpers
-- ============================================================

-- admin_remove_registration — désormais scopé groupe
DROP FUNCTION IF EXISTS admin_remove_registration(uuid, uuid, uuid);

CREATE FUNCTION admin_remove_registration(p_admin_id uuid, p_match_id uuid, p_player_id uuid)
RETURNS void AS $$
DECLARE
  reg_id uuid;
  target_player_name text;
  v_group_id uuid;
BEGIN
  SELECT group_id INTO v_group_id FROM matches WHERE id = p_match_id;
  IF v_group_id IS NULL THEN
    RAISE EXCEPTION 'match_not_found';
  END IF;

  PERFORM assert_group_admin(p_admin_id, v_group_id);

  SELECT r.id, COALESCE(p.display_name, p.username)
  INTO reg_id, target_player_name
  FROM registrations r JOIN players p ON p.id = r.player_id
  WHERE r.match_id = p_match_id AND r.player_id = p_player_id;

  DELETE FROM registrations WHERE match_id = p_match_id AND player_id = p_player_id;

  INSERT INTO audit_log (group_id, actor_id, action, target_type, target_id, details)
  SELECT p.group_id, p_admin_id, 'remove_registration', 'registration', reg_id,
    jsonb_build_object('match_id', p_match_id, 'player_id', p_player_id, 'player_name', target_player_name)
  FROM players p WHERE p.id = p_admin_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- set_group_guest_settings — remplace le check inline par le helper
DROP FUNCTION IF EXISTS set_group_guest_settings(uuid, uuid, boolean, int);

CREATE FUNCTION set_group_guest_settings(
  p_group_id uuid,
  p_actor_id uuid,
  p_guests_enabled boolean,
  p_max_guests_per_player int
) RETURNS void AS $$
DECLARE
  safe_max int;
BEGIN
  PERFORM assert_group_admin(p_actor_id, p_group_id);

  safe_max := CASE WHEN p_max_guests_per_player < 0 THEN NULL ELSE p_max_guests_per_player END;

  UPDATE groups
  SET guests_enabled = p_guests_enabled,
      max_guests_per_player = safe_max
  WHERE id = p_group_id;

  INSERT INTO audit_log (group_id, actor_id, action, target_type, target_id, details)
  VALUES (p_group_id, p_actor_id, 'update_group_settings', 'group', p_group_id,
    jsonb_build_object('guests_enabled', p_guests_enabled, 'max_guests_per_player', safe_max));
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- set_plus_ones — l'usage admin reste un bypass conditionnel (pas une garde bloquante)
DROP FUNCTION IF EXISTS set_plus_ones(uuid, uuid, int, uuid);

CREATE FUNCTION set_plus_ones(p_match_id uuid, p_player_id uuid, p_count int, p_actor_id uuid)
RETURNS void AS $$
DECLARE
  is_actor_admin boolean;
  current_count int;
  v_group_id uuid;
  v_guests_enabled boolean;
  v_max_guests int;
  safe_count int := GREATEST(0, p_count);
BEGIN
  IF p_actor_id IS NULL THEN
    RAISE EXCEPTION 'not_allowed';
  END IF;

  SELECT m.group_id, g.guests_enabled, g.max_guests_per_player
  INTO v_group_id, v_guests_enabled, v_max_guests
  FROM matches m JOIN groups g ON g.id = m.group_id
  WHERE m.id = p_match_id;

  is_actor_admin := is_group_admin(p_actor_id, v_group_id);

  SELECT plus_ones INTO current_count FROM registrations
  WHERE match_id = p_match_id AND player_id = p_player_id;

  IF NOT is_actor_admin THEN
    -- durcissement : un non-admin ne peut modifier que ses propres invités
    IF p_actor_id != p_player_id THEN
      RAISE EXCEPTION 'not_allowed';
    END IF;

    IF NOT COALESCE(v_guests_enabled, true) AND safe_count > COALESCE(current_count, 0) THEN
      RAISE EXCEPTION 'guests_disabled';
    END IF;

    IF v_max_guests IS NOT NULL AND safe_count > v_max_guests AND safe_count > COALESCE(current_count, 0) THEN
      RAISE EXCEPTION 'guest_limit_exceeded';
    END IF;
  END IF;

  UPDATE registrations SET plus_ones = safe_count
  WHERE match_id = p_match_id AND player_id = p_player_id AND is_withdrawn = false;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- register_player — le bypass admin de la limite de 2 procurations passe par le helper
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
        registered_by = p_registered_by
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

-- update_player_profile — signature strictement inchangée, garde d'acteur ajoutée
DROP FUNCTION IF EXISTS update_player_profile(uuid, text, text, uuid);

CREATE FUNCTION update_player_profile(
  p_player_id uuid,
  p_display_name text DEFAULT NULL,
  p_new_pin text DEFAULT NULL,
  p_actor_id uuid DEFAULT NULL
) RETURNS json AS $$
DECLARE
  result players%ROWTYPE;
  v_group_id uuid;
BEGIN
  IF p_actor_id IS NULL THEN
    RAISE EXCEPTION 'not_allowed';
  END IF;

  SELECT group_id INTO v_group_id FROM players WHERE id = p_player_id;
  IF v_group_id IS NULL THEN
    RAISE EXCEPTION 'player_not_found';
  END IF;

  IF p_actor_id <> p_player_id THEN
    PERFORM assert_group_admin(p_actor_id, v_group_id);
  END IF;

  UPDATE players
  SET
    display_name = CASE WHEN p_display_name IS NOT NULL THEN p_display_name ELSE display_name END,
    pin_hash = CASE WHEN p_new_pin IS NOT NULL THEN crypt(p_new_pin, gen_salt('bf')) ELSE pin_hash END
  WHERE id = p_player_id
  RETURNING * INTO result;

  -- p_actor_id est garanti non-null et autorisé à ce stade : pas de
  -- COALESCE(p_actor_id, p_player_id), ce qui rendrait la garde
  -- contournable par omission de l'argument.
  INSERT INTO audit_log (group_id, actor_id, action, target_type, target_id, details)
  VALUES (v_group_id, p_actor_id, 'update_player', 'player', p_player_id, '{}'::jsonb);

  RETURN to_jsonb(result) - 'pin_hash';
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- create_player — signature strictement inchangée, garde bloquante en tête de fonction
DROP FUNCTION IF EXISTS create_player(uuid, text, text, text, boolean, uuid);

CREATE FUNCTION create_player(
  p_group_id uuid,
  p_username text,
  p_pin text,
  p_display_name text DEFAULT NULL,
  p_is_admin boolean DEFAULT false,
  p_actor_id uuid DEFAULT NULL
) RETURNS json AS $$
DECLARE result players%ROWTYPE;
BEGIN
  PERFORM assert_group_admin(p_actor_id, p_group_id);

  INSERT INTO players (group_id, username, display_name, pin_hash, is_admin)
  VALUES (p_group_id, p_username, p_display_name, crypt(p_pin, gen_salt('bf')), p_is_admin)
  RETURNING * INTO result;

  INSERT INTO audit_log (group_id, actor_id, action, target_type, target_id, details)
  VALUES (p_group_id, p_actor_id, 'create_player', 'player', result.id,
    jsonb_build_object('username', p_username));

  RETURN to_jsonb(result) - 'pin_hash';
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- set_match_score — aucune garde auparavant, ajout d'une garde scopée
DROP FUNCTION IF EXISTS set_match_score(uuid, int, int, uuid);

CREATE FUNCTION set_match_score(
  p_match_id uuid,
  p_score_a int,
  p_score_b int,
  p_actor_id uuid
) RETURNS void AS $$
DECLARE v_group_id uuid;
BEGIN
  SELECT group_id INTO v_group_id FROM matches WHERE id = p_match_id;
  IF v_group_id IS NULL THEN
    RAISE EXCEPTION 'match_not_found';
  END IF;

  PERFORM assert_group_admin(p_actor_id, v_group_id);

  UPDATE matches SET score_a = p_score_a, score_b = p_score_b
  WHERE id = p_match_id;

  INSERT INTO audit_log (group_id, actor_id, action, target_type, target_id, details)
  VALUES (v_group_id, p_actor_id, 'set_score', 'match', p_match_id,
    jsonb_build_object('score_a', p_score_a, 'score_b', p_score_b));
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================
-- C. RPC "matches" (remplacent les écritures REST directes)
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
  p_team_a_name text DEFAULT 'Équipe A',
  p_team_b_name text DEFAULT 'Équipe B'
) RETURNS json AS $$
DECLARE result matches%ROWTYPE;
BEGIN
  PERFORM assert_group_admin(p_actor_id, p_group_id);

  INSERT INTO matches (group_id, title, match_date, match_time, max_players, registration_deadline, is_closed, team_a_name, team_b_name)
  VALUES (p_group_id, p_title, p_match_date, p_match_time, p_max_players, p_registration_deadline, false, p_team_a_name, p_team_b_name)
  RETURNING * INTO result;

  INSERT INTO audit_log (group_id, actor_id, action, target_type, target_id, details)
  VALUES (p_group_id, p_actor_id, 'create_match', 'match', result.id,
    jsonb_build_object('title', p_title));

  RETURN row_to_json(result);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP FUNCTION IF EXISTS update_match(uuid, uuid, text, date, time, int, timestamptz, text, text);

CREATE FUNCTION update_match(
  p_actor_id uuid,
  p_match_id uuid,
  p_title text,
  p_match_date date,
  p_match_time time,
  p_max_players int,
  p_registration_deadline timestamptz,
  p_team_a_name text,
  p_team_b_name text
) RETURNS void AS $$
DECLARE v_group_id uuid;
BEGIN
  SELECT group_id INTO v_group_id FROM matches WHERE id = p_match_id;
  IF v_group_id IS NULL THEN
    RAISE EXCEPTION 'match_not_found';
  END IF;

  PERFORM assert_group_admin(p_actor_id, v_group_id);

  -- Ne touche volontairement ni is_closed, ni les 5 colonnes de score :
  -- ces champs sont gérés par set_match_closed / set_match_score / set_mini_match_score.
  UPDATE matches SET
    title                 = p_title,
    match_date            = p_match_date,
    match_time            = p_match_time,
    max_players           = p_max_players,
    registration_deadline = p_registration_deadline,
    team_a_name           = p_team_a_name,
    team_b_name           = p_team_b_name
  WHERE id = p_match_id;

  INSERT INTO audit_log (group_id, actor_id, action, target_type, target_id, details)
  VALUES (v_group_id, p_actor_id, 'update_match', 'match', p_match_id,
    jsonb_build_object('title', p_title));
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP FUNCTION IF EXISTS set_match_closed(uuid, uuid, boolean);

CREATE FUNCTION set_match_closed(p_actor_id uuid, p_match_id uuid, p_closed boolean)
RETURNS void AS $$
DECLARE
  v_group_id uuid;
  v_title text;
BEGIN
  SELECT group_id, title INTO v_group_id, v_title FROM matches WHERE id = p_match_id;
  IF v_group_id IS NULL THEN
    RAISE EXCEPTION 'match_not_found';
  END IF;

  PERFORM assert_group_admin(p_actor_id, v_group_id);

  UPDATE matches SET is_closed = p_closed WHERE id = p_match_id;

  INSERT INTO audit_log (group_id, actor_id, action, target_type, target_id, details)
  VALUES (v_group_id, p_actor_id,
    CASE WHEN p_closed THEN 'close_match' ELSE 'reopen_match' END,
    'match', p_match_id, jsonb_build_object('title', v_title));
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP FUNCTION IF EXISTS delete_match(uuid, uuid);

CREATE FUNCTION delete_match(p_actor_id uuid, p_match_id uuid) RETURNS void AS $$
DECLARE
  v_group_id uuid;
  v_title text;
BEGIN
  -- Capturer titre/group_id AVANT le delete : la ligne matches n'existera
  -- plus pour le log une fois le DELETE exécuté.
  SELECT group_id, title INTO v_group_id, v_title FROM matches WHERE id = p_match_id;
  IF v_group_id IS NULL THEN
    RAISE EXCEPTION 'match_not_found';
  END IF;

  PERFORM assert_group_admin(p_actor_id, v_group_id);

  DELETE FROM matches WHERE id = p_match_id;

  INSERT INTO audit_log (group_id, actor_id, action, target_type, target_id, details)
  VALUES (v_group_id, p_actor_id, 'delete_match', 'match', p_match_id,
    jsonb_build_object('title', v_title));
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP FUNCTION IF EXISTS set_mini_match_score(uuid, uuid, int, int, int);

CREATE FUNCTION set_mini_match_score(
  p_actor_id uuid,
  p_match_id uuid,
  p_score_a2 int,
  p_score_b2 int,
  p_mini_match_target int
) RETURNS void AS $$
DECLARE v_group_id uuid;
BEGIN
  SELECT group_id INTO v_group_id FROM matches WHERE id = p_match_id;
  IF v_group_id IS NULL THEN
    RAISE EXCEPTION 'match_not_found';
  END IF;

  PERFORM assert_group_admin(p_actor_id, v_group_id);

  -- Pas de log audit : comportement actuel silencieux conservé (décision explicite).
  UPDATE matches SET score_a2 = p_score_a2, score_b2 = p_score_b2, mini_match_target = p_mini_match_target
  WHERE id = p_match_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================
-- D. Fermeture de la faille RLS sur "matches"
-- ============================================================

DROP POLICY IF EXISTS "matches: écriture publique" ON matches;
REVOKE INSERT, UPDATE, DELETE ON matches FROM anon, authenticated;

COMMIT;

-- ============================================================
-- Vérifications post-migration (SELECT non destructifs, hors transaction)
-- ============================================================

-- Policies restantes sur matches — ne doit plus lister d'écriture publique
SELECT policyname, cmd FROM pg_policies WHERE tablename = 'matches';

-- Grants anon/authenticated sur matches — ne doit plus lister INSERT/UPDATE/DELETE
SELECT grantee, privilege_type FROM information_schema.role_table_grants
WHERE table_name = 'matches' AND grantee IN ('anon', 'authenticated');

-- Une seule signature par fonction migrée/créée (détection de surcharge résiduelle)
SELECT proname, pg_get_function_identity_arguments(oid) AS args FROM pg_proc
WHERE proname IN (
  'is_group_admin', 'assert_group_admin', 'admin_remove_registration',
  'set_group_guest_settings', 'set_plus_ones', 'register_player',
  'update_player_profile', 'create_player', 'set_match_score',
  'create_match', 'update_match', 'set_match_closed', 'delete_match',
  'set_mini_match_score'
)
ORDER BY proname;
