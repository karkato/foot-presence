-- ============================================================
-- foot-presence — admin_reset_player_pin : RPC dédiée pour la
-- réinitialisation du PIN d'un joueur par un admin
-- À exécuter APRÈS setup.sql, audit.sql, features.sql, guestsettings.sql,
-- security.sql, seasons.sql, playerstats.sql, teamnames.sql, seasondates.sql,
-- playeradmin.sql
--
-- Pourquoi : update_player_profile (security.sql) permet déjà à un admin
-- de changer le PIN d'un AUTRE joueur (branche non-self de sa garde
-- assert_group_admin), mais cette capacité est noyée dans le formulaire
-- d'édition complet du joueur (PlayerFormComponent), sans validation de
-- format PIN côté serveur, et l'action est enregistrée dans audit_log sous
-- 'update_player' avec details = '{}' — impossible d'y distinguer un reset
-- PIN d'un simple renommage.
--
-- Décision produit (validée) : réinitialisation PAR UN ADMIN depuis l'app
-- uniquement (pas de self-service par un joueur déconnecté : Player n'a ni
-- email ni téléphone pour prouver son identité hors session). L'admin
-- saisit le nouveau PIN manuellement (pas de génération aléatoire). Un
-- admin PEUT réinitialiser le PIN d'un autre admin du groupe (pas de garde
-- bloquante, contrairement à set_player_admin qui a un garde-fou
-- anti-lockout — un reset de PIN n'a pas d'équivalent "dernier admin" à
-- protéger), mais l'action est tracée explicitement dans l'audit sous une
-- action dédiée 'reset_player_pin' plutôt que noyée dans 'update_player'.
--
-- RPC dédiée plutôt qu'une réutilisation nue d'update_player_profile, pour
-- obtenir cette action d'audit distincte et une validation de format PIN
-- côté serveur (^[0-9]{4,6}$, cohérente avec validatePin() côté client —
-- voir src/app/shared/utils/pin.ts).
--
-- Chaque fonction ci-dessous est précédée d'un DROP FUNCTION IF EXISTS
-- typé, par défense en profondeur (voir security.sql pour le pourquoi).
-- ============================================================

BEGIN;

DROP FUNCTION IF EXISTS admin_reset_player_pin(uuid, uuid, text);

-- admin_reset_player_pin — p_actor_id doit TOUJOURS être admin du groupe
-- cible : comme set_player_admin (playeradmin.sql), il n'existe aucune
-- branche "self" qui dispenserait de assert_group_admin — un reset de PIN
-- passe systématiquement par la garde admin, y compris quand la cible est
-- l'acteur lui-même (cas marginal : un admin qui se reset son propre PIN
-- via cet écran plutôt que via ProfileComponent, reste couvert car
-- assert_group_admin vérifie l'acteur, pas une relation acteur != cible).
CREATE FUNCTION admin_reset_player_pin(
  p_actor_id uuid,
  p_player_id uuid,
  p_new_pin text
) RETURNS json AS $$
DECLARE
  result players%ROWTYPE;
  v_group_id uuid;
BEGIN
  -- Convention partagée avec update_player_profile / set_player_admin
  -- (security.sql / playeradmin.sql) : un acteur non déclaré n'est jamais
  -- un admin, donc l'erreur générique "not_allowed" plutôt que "not_admin"
  -- (réservée au cas où un acteur EST déclaré mais n'a pas les droits).
  IF p_actor_id IS NULL THEN
    RAISE EXCEPTION 'not_allowed';
  END IF;

  SELECT group_id INTO v_group_id FROM players WHERE id = p_player_id;
  IF v_group_id IS NULL THEN
    RAISE EXCEPTION 'player_not_found';
  END IF;

  -- Inconditionnel, jamais de branche self (décision produit) : un admin
  -- peut réinitialiser le PIN d'un autre admin du groupe.
  PERFORM assert_group_admin(p_actor_id, v_group_id);

  IF p_new_pin !~ '^[0-9]{4,6}$' THEN
    RAISE EXCEPTION 'invalid_pin';
  END IF;

  UPDATE players
  SET pin_hash = crypt(p_new_pin, gen_salt('bf'))
  WHERE id = p_player_id
  RETURNING * INTO result;

  -- details ne contient jamais le PIN en clair, uniquement de quoi
  -- identifier la cible dans l'historique d'audit affiché à l'écran.
  INSERT INTO audit_log (group_id, actor_id, action, target_type, target_id, details)
  VALUES (v_group_id, p_actor_id, 'reset_player_pin', 'player', p_player_id,
    jsonb_build_object('player_name', COALESCE(result.display_name, result.username)));

  RETURN to_jsonb(result) - 'pin_hash';
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Pas de GRANT EXECUTE explicite ici : Supabase applique des ALTER
-- DEFAULT PRIVILEGES qui accordent EXECUTE à anon/authenticated sur
-- toute nouvelle fonction du schéma public (voir le commentaire
-- équivalent en teamnames.sql) — le DROP FUNCTION + CREATE FUNCTION
-- ci-dessus recrée l'objet et redéclenche ce défaut, rien à accorder
-- manuellement.

COMMIT;

-- ============================================================
-- Vérifications post-migration (SELECT non destructif, hors transaction)
-- ============================================================

-- Une seule signature (détection de surcharge résiduelle)
SELECT proname, pg_get_function_identity_arguments(oid) AS args FROM pg_proc
WHERE proname = 'admin_reset_player_pin'
ORDER BY proname;
