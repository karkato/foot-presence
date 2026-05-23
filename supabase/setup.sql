-- ============================================================
-- foot-presence — Setup initial
-- À exécuter dans l'éditeur SQL de Supabase
-- ============================================================

-- Extension pour le hachage bcrypt
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ============================================================
-- Tables
-- ============================================================

CREATE TABLE IF NOT EXISTS groups (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  slug text UNIQUE NOT NULL,
  created_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS players (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id uuid REFERENCES groups(id) ON DELETE CASCADE NOT NULL,
  username text NOT NULL,
  display_name text,
  pin_hash text NOT NULL,
  is_admin boolean DEFAULT false,
  created_at timestamptz DEFAULT now(),
  UNIQUE(group_id, username)
);

CREATE TABLE IF NOT EXISTS matches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id uuid REFERENCES groups(id) ON DELETE CASCADE NOT NULL,
  title text NOT NULL,
  match_date date NOT NULL,
  match_time time NOT NULL,
  max_players int NOT NULL DEFAULT 22,
  registration_deadline timestamptz,
  is_closed boolean DEFAULT false,
  created_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS registrations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  match_id uuid REFERENCES matches(id) ON DELETE CASCADE NOT NULL,
  player_id uuid REFERENCES players(id) NOT NULL,
  registered_by uuid REFERENCES players(id) NOT NULL,
  registered_at timestamptz DEFAULT now(),
  is_withdrawn boolean DEFAULT false,
  UNIQUE(match_id, player_id)
);

-- ============================================================
-- Vue ordonnée (rang calculé dynamiquement)
-- ============================================================

CREATE OR REPLACE VIEW match_registrations_ranked AS
SELECT
  r.*,
  COALESCE(p.display_name, p.username) AS display_name,
  ROW_NUMBER() OVER (
    PARTITION BY r.match_id ORDER BY r.registered_at ASC
  ) AS rank
FROM registrations r
JOIN players p ON p.id = r.player_id
WHERE r.is_withdrawn = false;

-- ============================================================
-- Fonctions RPC
-- ============================================================

-- Login : vérifie pseudo + PIN, retourne le joueur
CREATE OR REPLACE FUNCTION login_player(p_username text, p_pin text, p_group_id uuid)
RETURNS json AS $$
DECLARE player_row players%ROWTYPE;
BEGIN
  SELECT * INTO player_row FROM players
  WHERE username = p_username AND group_id = p_group_id;
  IF NOT FOUND THEN RETURN NULL; END IF;
  IF crypt(p_pin, player_row.pin_hash) = player_row.pin_hash THEN
    RETURN row_to_json(player_row);
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- S'inscrire à un match (avec gestion procuration max 2, limite ignorée pour les admins)
CREATE OR REPLACE FUNCTION register_player(p_match_id uuid, p_player_id uuid, p_registered_by uuid)
RETURNS json AS $$
DECLARE
  proxy_count int;
  is_registrar_admin boolean;
  result registrations%ROWTYPE;
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
  RETURN row_to_json(result);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Se retirer d'un match
CREATE OR REPLACE FUNCTION withdraw_player(p_match_id uuid, p_player_id uuid)
RETURNS void AS $$
BEGIN
  UPDATE registrations SET is_withdrawn = true
  WHERE match_id = p_match_id AND player_id = p_player_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Mettre à jour le profil (display_name et/ou PIN)
CREATE OR REPLACE FUNCTION update_player_profile(
  p_player_id uuid,
  p_display_name text DEFAULT NULL,
  p_new_pin text DEFAULT NULL
)
RETURNS json AS $$
DECLARE result players%ROWTYPE;
BEGIN
  UPDATE players
  SET
    display_name = CASE WHEN p_display_name IS NOT NULL THEN p_display_name ELSE display_name END,
    pin_hash = CASE WHEN p_new_pin IS NOT NULL THEN crypt(p_new_pin, gen_salt('bf')) ELSE pin_hash END
  WHERE id = p_player_id
  RETURNING * INTO result;
  RETURN row_to_json(result);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Créer un joueur (admin) avec hachage du PIN
CREATE OR REPLACE FUNCTION create_player(
  p_group_id uuid,
  p_username text,
  p_pin text,
  p_display_name text DEFAULT NULL,
  p_is_admin boolean DEFAULT false
)
RETURNS json AS $$
DECLARE result players%ROWTYPE;
BEGIN
  INSERT INTO players (group_id, username, display_name, pin_hash, is_admin)
  VALUES (p_group_id, p_username, p_display_name, crypt(p_pin, gen_salt('bf')), p_is_admin)
  RETURNING * INTO result;
  RETURN row_to_json(result);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Supprimer une inscription (admin uniquement)
CREATE OR REPLACE FUNCTION admin_remove_registration(p_admin_id uuid, p_match_id uuid, p_player_id uuid)
RETURNS void AS $$
BEGIN
  IF NOT COALESCE((SELECT is_admin FROM players WHERE id = p_admin_id), false) THEN
    RAISE EXCEPTION 'not_admin';
  END IF;
  DELETE FROM registrations WHERE match_id = p_match_id AND player_id = p_player_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================
-- Row Level Security
-- Lecture libre (anon key) — les écritures passent par les RPCs
-- ============================================================

ALTER TABLE groups ENABLE ROW LEVEL SECURITY;
ALTER TABLE players ENABLE ROW LEVEL SECURITY;
ALTER TABLE matches ENABLE ROW LEVEL SECURITY;
ALTER TABLE registrations ENABLE ROW LEVEL SECURITY;

-- Lecture publique de toutes les tables
CREATE POLICY "groups: lecture publique" ON groups FOR SELECT USING (true);
CREATE POLICY "players: lecture publique" ON players FOR SELECT USING (true);
CREATE POLICY "matches: lecture publique" ON matches FOR SELECT USING (true);
CREATE POLICY "registrations: lecture publique" ON registrations FOR SELECT USING (true);

-- Écriture sur matches (admin via client direct)
CREATE POLICY "matches: écriture publique" ON matches FOR ALL USING (true) WITH CHECK (true);

-- Les écritures sur players et registrations passent par SECURITY DEFINER (RPCs)

-- ============================================================
-- Realtime — activer sur registrations
-- ============================================================

-- Dans l'interface Supabase : Database > Replication > Tables
-- Activer le Realtime pour la table "registrations"
-- Ou via SQL (nécessite les droits superuser) :
-- ALTER PUBLICATION supabase_realtime ADD TABLE registrations;
