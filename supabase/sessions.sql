-- ============================================================
-- foot-presence — Tokens de session
-- À exécuter APRÈS setup.sql, audit.sql et features.sql
-- ============================================================

-- ============================================================
-- Table sessions
-- ============================================================

CREATE TABLE IF NOT EXISTS sessions (
  token uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  player_id uuid REFERENCES players(id) ON DELETE CASCADE NOT NULL,
  expires_at timestamptz NOT NULL DEFAULT now() + interval '30 days',
  created_at timestamptz DEFAULT now()
);

ALTER TABLE sessions ENABLE ROW LEVEL SECURITY;
-- Aucune policy SELECT : accessible uniquement via les RPCs SECURITY DEFINER

-- ============================================================
-- Helper interne
-- ============================================================

-- Résoudre un token en player_id, raise si invalide ou expiré
CREATE OR REPLACE FUNCTION resolve_token(p_token uuid) RETURNS uuid AS $$
DECLARE actor_id uuid;
BEGIN
  SELECT player_id INTO actor_id FROM sessions
  WHERE token = p_token AND expires_at > now();
  IF NOT FOUND THEN RAISE EXCEPTION 'invalid_session'; END IF;
  RETURN actor_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================
-- Login / Logout
-- ============================================================

-- Remplace la version de setup.sql : crée une session et retourne player + token
CREATE OR REPLACE FUNCTION login_player(p_username text, p_pin text, p_group_id uuid)
RETURNS json AS $$
DECLARE
  player_row players%ROWTYPE;
  session_token uuid;
BEGIN
  SELECT * INTO player_row FROM players
  WHERE username = p_username AND group_id = p_group_id;
  IF NOT FOUND THEN RETURN NULL; END IF;
  IF crypt(p_pin, player_row.pin_hash) = player_row.pin_hash THEN
    INSERT INTO sessions (player_id) VALUES (player_row.id)
    RETURNING token INTO session_token;
    RETURN (to_jsonb(player_row) - 'pin_hash') || jsonb_build_object('session_token', session_token);
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION logout_player(p_token uuid) RETURNS void AS $$
BEGIN
  DELETE FROM sessions WHERE token = p_token;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================
-- RPCs inscription / retrait (remplacent les versions audit.sql)
-- ============================================================

CREATE OR REPLACE FUNCTION register_player(p_match_id uuid, p_player_id uuid, p_token uuid)
RETURNS json AS $$
DECLARE
  proxy_count int;
  is_registrar_admin boolean;
  result registrations%ROWTYPE;
  target_player_name text;
  actor_id uuid;
BEGIN
  actor_id := resolve_token(p_token);
  SELECT is_admin INTO is_registrar_admin FROM players WHERE id = actor_id;

  IF p_player_id != actor_id AND NOT COALESCE(is_registrar_admin, false) THEN
    SELECT COUNT(*) INTO proxy_count FROM registrations
    WHERE match_id = p_match_id
      AND registered_by = actor_id
      AND player_id != actor_id
      AND is_withdrawn = false;
    IF proxy_count >= 2 THEN
      RAISE EXCEPTION 'proxy_limit_reached';
    END IF;
  END IF;

  INSERT INTO registrations (match_id, player_id, registered_by)
  VALUES (p_match_id, p_player_id, actor_id)
  ON CONFLICT (match_id, player_id) DO UPDATE
    SET is_withdrawn = false,
        registered_at = now(),
        registered_by = actor_id
  RETURNING * INTO result;

  SELECT COALESCE(display_name, username) INTO target_player_name FROM players WHERE id = p_player_id;

  INSERT INTO audit_log (group_id, actor_id, action, target_type, target_id, details)
  SELECT p.group_id, actor_id,
    CASE WHEN p_player_id = actor_id THEN 'register' ELSE 'register_proxy' END,
    'registration', result.id,
    jsonb_build_object('match_id', p_match_id, 'player_id', p_player_id, 'player_name', target_player_name)
  FROM players p WHERE p.id = actor_id;

  RETURN row_to_json(result);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION withdraw_player(p_match_id uuid, p_player_id uuid, p_token uuid)
RETURNS void AS $$
DECLARE
  reg_id uuid;
  target_player_name text;
  actor_id uuid;
BEGIN
  actor_id := resolve_token(p_token);

  UPDATE registrations SET is_withdrawn = true
  WHERE match_id = p_match_id AND player_id = p_player_id
  RETURNING id INTO reg_id;

  SELECT COALESCE(display_name, username) INTO target_player_name FROM players WHERE id = p_player_id;

  INSERT INTO audit_log (group_id, actor_id, action, target_type, target_id, details)
  SELECT p.group_id, actor_id,
    CASE WHEN p_player_id = actor_id THEN 'withdraw' ELSE 'withdraw_proxy' END,
    'registration', reg_id,
    jsonb_build_object('match_id', p_match_id, 'player_id', p_player_id, 'player_name', target_player_name)
  FROM players p WHERE p.id = actor_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION admin_remove_registration(p_token uuid, p_match_id uuid, p_player_id uuid)
RETURNS void AS $$
DECLARE
  reg_id uuid;
  target_player_name text;
  actor_id uuid;
BEGIN
  actor_id := resolve_token(p_token);
  IF NOT COALESCE((SELECT is_admin FROM players WHERE id = actor_id), false) THEN
    RAISE EXCEPTION 'not_admin';
  END IF;

  SELECT r.id, COALESCE(p.display_name, p.username)
  INTO reg_id, target_player_name
  FROM registrations r JOIN players p ON p.id = r.player_id
  WHERE r.match_id = p_match_id AND r.player_id = p_player_id;

  DELETE FROM registrations WHERE match_id = p_match_id AND player_id = p_player_id;

  INSERT INTO audit_log (group_id, actor_id, action, target_type, target_id, details)
  SELECT p.group_id, actor_id, 'remove_registration', 'registration', reg_id,
    jsonb_build_object('match_id', p_match_id, 'player_id', p_player_id, 'player_name', target_player_name)
  FROM players p WHERE p.id = actor_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION set_plus_ones(p_match_id uuid, p_player_id uuid, p_count int, p_token uuid)
RETURNS void AS $$
DECLARE actor_id uuid;
BEGIN
  actor_id := resolve_token(p_token);
  UPDATE registrations SET plus_ones = p_count
  WHERE match_id = p_match_id AND player_id = p_player_id AND is_withdrawn = false;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================
-- RPCs profil joueur (remplacent les versions audit.sql)
-- ============================================================

-- Le joueur est déduit du token — plus besoin de p_player_id côté client.
-- Un admin peut modifier un autre joueur en passant p_target_player_id.
CREATE OR REPLACE FUNCTION update_player_profile(
  p_token uuid,
  p_display_name text DEFAULT NULL,
  p_new_pin text DEFAULT NULL,
  p_target_player_id uuid DEFAULT NULL,
  p_is_admin boolean DEFAULT NULL
) RETURNS json AS $$
DECLARE
  result players%ROWTYPE;
  actor_id uuid;
  target_id uuid;
BEGIN
  actor_id := resolve_token(p_token);
  target_id := COALESCE(p_target_player_id, actor_id);

  IF target_id != actor_id THEN
    IF NOT COALESCE((SELECT is_admin FROM players WHERE id = actor_id), false) THEN
      RAISE EXCEPTION 'not_admin';
    END IF;
  END IF;

  UPDATE players SET
    display_name = CASE WHEN p_display_name IS NOT NULL THEN p_display_name ELSE display_name END,
    pin_hash     = CASE WHEN p_new_pin IS NOT NULL THEN crypt(p_new_pin, gen_salt('bf')) ELSE pin_hash END,
    is_admin     = CASE WHEN p_is_admin IS NOT NULL AND target_id != actor_id THEN p_is_admin ELSE is_admin END
  WHERE id = target_id
  RETURNING * INTO result;

  INSERT INTO audit_log (group_id, actor_id, action, target_type, target_id, details)
  SELECT p.group_id, actor_id, 'update_player', 'player', target_id, '{}'::jsonb
  FROM players p WHERE p.id = target_id;

  RETURN to_jsonb(result) - 'pin_hash';
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION create_player(
  p_token uuid,
  p_group_id uuid,
  p_username text,
  p_pin text,
  p_display_name text DEFAULT NULL,
  p_is_admin boolean DEFAULT false
) RETURNS json AS $$
DECLARE
  result players%ROWTYPE;
  actor_id uuid;
BEGIN
  actor_id := resolve_token(p_token);
  IF NOT COALESCE((SELECT is_admin FROM players WHERE id = actor_id AND group_id = p_group_id), false) THEN
    RAISE EXCEPTION 'not_admin';
  END IF;

  INSERT INTO players (group_id, username, display_name, pin_hash, is_admin)
  VALUES (p_group_id, p_username, p_display_name, crypt(p_pin, gen_salt('bf')), p_is_admin)
  RETURNING * INTO result;

  INSERT INTO audit_log (group_id, actor_id, action, target_type, target_id, details)
  VALUES (p_group_id, actor_id, 'create_player', 'player', result.id,
    jsonb_build_object('username', p_username));

  RETURN to_jsonb(result) - 'pin_hash';
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================
-- RPCs matchs (remplacent les écritures REST directes)
-- ============================================================

CREATE OR REPLACE FUNCTION create_match(
  p_token uuid,
  p_group_id uuid,
  p_title text,
  p_match_date date,
  p_match_time time,
  p_max_players int DEFAULT 22,
  p_registration_deadline timestamptz DEFAULT NULL,
  p_team_a_name text DEFAULT 'Équipe A',
  p_team_b_name text DEFAULT 'Équipe B'
) RETURNS json AS $$
DECLARE
  result matches%ROWTYPE;
  actor_id uuid;
BEGIN
  actor_id := resolve_token(p_token);
  IF NOT COALESCE((SELECT is_admin FROM players WHERE id = actor_id AND group_id = p_group_id), false) THEN
    RAISE EXCEPTION 'not_admin';
  END IF;

  INSERT INTO matches (group_id, title, match_date, match_time, max_players, registration_deadline, is_closed, team_a_name, team_b_name)
  VALUES (p_group_id, p_title, p_match_date, p_match_time, p_max_players, p_registration_deadline, false, p_team_a_name, p_team_b_name)
  RETURNING * INTO result;

  INSERT INTO audit_log (group_id, actor_id, action, target_type, target_id, details)
  SELECT p.group_id, actor_id, 'create_match', 'match', result.id,
    jsonb_build_object('title', p_title)
  FROM players p WHERE p.id = actor_id;

  RETURN row_to_json(result);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION update_match(
  p_token uuid,
  p_match_id uuid,
  p_title text,
  p_match_date date,
  p_match_time time,
  p_max_players int,
  p_registration_deadline timestamptz,
  p_team_a_name text,
  p_team_b_name text
) RETURNS void AS $$
DECLARE actor_id uuid;
BEGIN
  actor_id := resolve_token(p_token);
  IF NOT COALESCE((SELECT is_admin FROM players WHERE id = actor_id), false) THEN
    RAISE EXCEPTION 'not_admin';
  END IF;

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
  SELECT p.group_id, actor_id, 'update_match', 'match', p_match_id, '{}'::jsonb
  FROM players p WHERE p.id = actor_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION set_match_closed(p_token uuid, p_match_id uuid, p_closed boolean)
RETURNS void AS $$
DECLARE actor_id uuid;
BEGIN
  actor_id := resolve_token(p_token);
  IF NOT COALESCE((SELECT is_admin FROM players WHERE id = actor_id), false) THEN
    RAISE EXCEPTION 'not_admin';
  END IF;

  UPDATE matches SET is_closed = p_closed WHERE id = p_match_id;

  INSERT INTO audit_log (group_id, actor_id, action, target_type, target_id, details)
  SELECT p.group_id, actor_id,
    CASE WHEN p_closed THEN 'close_match' ELSE 'reopen_match' END,
    'match', p_match_id, '{}'::jsonb
  FROM players p WHERE p.id = actor_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION delete_match(p_token uuid, p_match_id uuid) RETURNS void AS $$
DECLARE
  actor_id uuid;
  match_title text;
  match_group_id uuid;
BEGIN
  actor_id := resolve_token(p_token);
  IF NOT COALESCE((SELECT is_admin FROM players WHERE id = actor_id), false) THEN
    RAISE EXCEPTION 'not_admin';
  END IF;

  SELECT title, group_id INTO match_title, match_group_id FROM matches WHERE id = p_match_id;
  DELETE FROM matches WHERE id = p_match_id;

  INSERT INTO audit_log (group_id, actor_id, action, target_type, target_id, details)
  VALUES (match_group_id, actor_id, 'delete_match', 'match', p_match_id,
    jsonb_build_object('title', match_title));
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION set_mini_match_score(
  p_token uuid,
  p_match_id uuid,
  p_score_a2 int,
  p_score_b2 int,
  p_mini_match_target int
) RETURNS void AS $$
DECLARE actor_id uuid;
BEGIN
  actor_id := resolve_token(p_token);
  IF NOT COALESCE((SELECT is_admin FROM players WHERE id = actor_id), false) THEN
    RAISE EXCEPTION 'not_admin';
  END IF;
  UPDATE matches SET score_a2 = p_score_a2, score_b2 = p_score_b2, mini_match_target = p_mini_match_target
  WHERE id = p_match_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- set_match_score : p_actor_id → p_token (remplace la version features.sql)
CREATE OR REPLACE FUNCTION set_match_score(
  p_match_id uuid,
  p_score_a int,
  p_score_b int,
  p_token uuid
) RETURNS void AS $$
DECLARE actor_id uuid;
BEGIN
  actor_id := resolve_token(p_token);
  IF NOT COALESCE((SELECT is_admin FROM players WHERE id = actor_id), false) THEN
    RAISE EXCEPTION 'not_admin';
  END IF;

  UPDATE matches SET score_a = p_score_a, score_b = p_score_b WHERE id = p_match_id;

  INSERT INTO audit_log (group_id, actor_id, action, target_type, target_id, details)
  SELECT p.group_id, actor_id, 'set_score', 'match', p_match_id,
    jsonb_build_object('score_a', p_score_a, 'score_b', p_score_b)
  FROM players p WHERE p.id = actor_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- assign_team : ajoute p_token (remplace la version features.sql)
CREATE OR REPLACE FUNCTION assign_team(p_match_id uuid, p_player_id uuid, p_team smallint, p_token uuid)
RETURNS void AS $$
DECLARE actor_id uuid;
BEGIN
  actor_id := resolve_token(p_token);
  IF NOT COALESCE((SELECT is_admin FROM players WHERE id = actor_id), false) THEN
    RAISE EXCEPTION 'not_admin';
  END IF;
  UPDATE registrations SET team = p_team
  WHERE match_id = p_match_id AND player_id = p_player_id AND is_withdrawn = false;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================
-- Supprimer la policy d'écriture publique sur matches
-- ============================================================

DROP POLICY IF EXISTS "matches: écriture publique" ON matches;
