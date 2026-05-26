-- ============================================================
-- foot-presence — Audit log
-- À exécuter APRÈS setup.sql dans Supabase SQL Editor
-- ============================================================

-- Table historique
CREATE TABLE IF NOT EXISTS audit_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id uuid REFERENCES groups(id) ON DELETE CASCADE NOT NULL,
  actor_id uuid REFERENCES players(id) ON DELETE SET NULL,
  action text NOT NULL,
  -- Valeurs : register | register_proxy | withdraw | withdraw_proxy |
  --           remove_registration | create_match | update_match | delete_match |
  --           close_match | reopen_match | create_player | update_player
  target_type text NOT NULL, -- 'registration' | 'match' | 'player'
  target_id uuid,
  details jsonb DEFAULT '{}',
  created_at timestamptz DEFAULT now()
);

ALTER TABLE audit_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY "audit_log: lecture publique" ON audit_log FOR SELECT USING (true);

-- ============================================================
-- Fonctions utilitaires
-- ============================================================

-- Appelée depuis Angular pour logger les opérations sur les matchs
CREATE OR REPLACE FUNCTION log_action(
  p_actor_id uuid,
  p_action text,
  p_target_type text,
  p_target_id uuid,
  p_details jsonb DEFAULT '{}'
) RETURNS void AS $$
BEGIN
  INSERT INTO audit_log (group_id, actor_id, action, target_type, target_id, details)
  SELECT p.group_id, p_actor_id, p_action, p_target_type, p_target_id, p_details
  FROM players p WHERE p.id = p_actor_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Récupérer l'historique d'un groupe (30 dernières entrées)
CREATE OR REPLACE FUNCTION get_audit_log(p_group_id uuid, p_limit int DEFAULT 30)
RETURNS json AS $$
BEGIN
  RETURN (
    SELECT COALESCE(json_agg(t), '[]'::json)
    FROM (
      SELECT
        al.id,
        al.action,
        al.target_type,
        al.target_id,
        al.details,
        al.created_at,
        COALESCE(p.display_name, p.username) AS actor_name
      FROM audit_log al
      LEFT JOIN players p ON p.id = al.actor_id
      WHERE al.group_id = p_group_id
      ORDER BY al.created_at DESC
      LIMIT p_limit
    ) t
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================
-- RPCs mis à jour (remplacent les versions de setup.sql)
-- ============================================================

-- S'inscrire à un match — maintenant logge l'action
CREATE OR REPLACE FUNCTION register_player(p_match_id uuid, p_player_id uuid, p_registered_by uuid)
RETURNS json AS $$
DECLARE
  proxy_count int;
  is_registrar_admin boolean;
  result registrations%ROWTYPE;
  target_player_name text;
BEGIN
  SELECT is_admin INTO is_registrar_admin FROM players WHERE id = p_registered_by;

  IF p_player_id != p_registered_by AND NOT COALESCE(is_registrar_admin, false) THEN
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

-- Se retirer d'un match — ajoute p_withdrawn_by + log
CREATE OR REPLACE FUNCTION withdraw_player(p_match_id uuid, p_player_id uuid, p_withdrawn_by uuid)
RETURNS void AS $$
DECLARE
  reg_id uuid;
  target_player_name text;
BEGIN
  UPDATE registrations SET is_withdrawn = true
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

-- Supprimer une inscription (admin) — ajoute log
CREATE OR REPLACE FUNCTION admin_remove_registration(p_admin_id uuid, p_match_id uuid, p_player_id uuid)
RETURNS void AS $$
DECLARE
  reg_id uuid;
  target_player_name text;
BEGIN
  IF NOT COALESCE((SELECT is_admin FROM players WHERE id = p_admin_id), false) THEN
    RAISE EXCEPTION 'not_admin';
  END IF;

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

-- Créer un joueur — ajoute p_actor_id optionnel + log
CREATE OR REPLACE FUNCTION create_player(
  p_group_id uuid,
  p_username text,
  p_pin text,
  p_display_name text DEFAULT NULL,
  p_is_admin boolean DEFAULT false,
  p_actor_id uuid DEFAULT NULL
) RETURNS json AS $$
DECLARE result players%ROWTYPE;
BEGIN
  INSERT INTO players (group_id, username, display_name, pin_hash, is_admin)
  VALUES (p_group_id, p_username, p_display_name, crypt(p_pin, gen_salt('bf')), p_is_admin)
  RETURNING * INTO result;

  IF p_actor_id IS NOT NULL THEN
    INSERT INTO audit_log (group_id, actor_id, action, target_type, target_id, details)
    VALUES (p_group_id, p_actor_id, 'create_player', 'player', result.id,
      jsonb_build_object('username', p_username));
  END IF;

  RETURN row_to_json(result);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Mettre à jour le profil — ajoute p_actor_id optionnel + log
CREATE OR REPLACE FUNCTION update_player_profile(
  p_player_id uuid,
  p_display_name text DEFAULT NULL,
  p_new_pin text DEFAULT NULL,
  p_actor_id uuid DEFAULT NULL
) RETURNS json AS $$
DECLARE result players%ROWTYPE;
BEGIN
  UPDATE players
  SET
    display_name = CASE WHEN p_display_name IS NOT NULL THEN p_display_name ELSE display_name END,
    pin_hash = CASE WHEN p_new_pin IS NOT NULL THEN crypt(p_new_pin, gen_salt('bf')) ELSE pin_hash END
  WHERE id = p_player_id
  RETURNING * INTO result;

  INSERT INTO audit_log (group_id, actor_id, action, target_type, target_id, details)
  SELECT p.group_id, COALESCE(p_actor_id, p_player_id), 'update_player', 'player', p_player_id, '{}'::jsonb
  FROM players p WHERE p.id = p_player_id;

  RETURN row_to_json(result);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
