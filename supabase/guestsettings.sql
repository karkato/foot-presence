-- ============================================================
-- foot-presence — Réglages invités (+1) par groupe
-- À exécuter APRÈS setup.sql, audit.sql, features.sql
-- (PAS après sessions.sql, qui n'est pas la version active en base)
-- ============================================================

-- ============================================================
-- Colonnes
-- ============================================================

ALTER TABLE groups ADD COLUMN IF NOT EXISTS guests_enabled boolean NOT NULL DEFAULT true;
ALTER TABLE groups ADD COLUMN IF NOT EXISTS max_guests_per_player int;
ALTER TABLE registrations ADD COLUMN IF NOT EXISTS plus_ones int NOT NULL DEFAULT 0;

-- ============================================================
-- RPC : réglages invités d'un groupe (admin uniquement)
-- ============================================================

CREATE OR REPLACE FUNCTION set_group_guest_settings(
  p_group_id uuid,
  p_actor_id uuid,
  p_guests_enabled boolean,
  p_max_guests_per_player int
) RETURNS void AS $$
DECLARE
  safe_max int;
BEGIN
  IF NOT COALESCE((SELECT is_admin FROM players WHERE id = p_actor_id AND group_id = p_group_id), false) THEN
    RAISE EXCEPTION 'not_admin';
  END IF;

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

-- ============================================================
-- RPC : set_plus_ones — refonte avec contrôle serveur
-- ============================================================

DROP FUNCTION IF EXISTS set_plus_ones(uuid, uuid, int);
DROP FUNCTION IF EXISTS set_plus_ones(uuid, uuid, int, uuid);

CREATE FUNCTION set_plus_ones(p_match_id uuid, p_player_id uuid, p_count int, p_actor_id uuid DEFAULT NULL)
RETURNS void AS $$
DECLARE
  is_actor_admin boolean;
  current_count int;
  v_guests_enabled boolean;
  v_max_guests int;
  safe_count int := GREATEST(0, p_count);
BEGIN
  SELECT COALESCE(is_admin, false) INTO is_actor_admin FROM players WHERE id = p_actor_id;

  SELECT g.guests_enabled, g.max_guests_per_player
  INTO v_guests_enabled, v_max_guests
  FROM matches m JOIN groups g ON g.id = m.group_id
  WHERE m.id = p_match_id;

  SELECT plus_ones INTO current_count FROM registrations
  WHERE match_id = p_match_id AND player_id = p_player_id;

  IF NOT is_actor_admin THEN
    -- durcissement : un non-admin ne peut modifier que ses propres invités
    IF p_actor_id IS NOT NULL AND p_actor_id != p_player_id THEN
      RAISE EXCEPTION 'not_allowed';
    END IF;

    IF NOT v_guests_enabled AND safe_count > 0 THEN
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
