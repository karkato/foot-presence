-- ============================================================
-- foot-presence — set_player_admin : RPC dédiée pour le toggle is_admin
-- À exécuter APRÈS setup.sql, audit.sql, features.sql, guestsettings.sql,
-- security.sql, seasons.sql, playerstats.sql, teamnames.sql, seasondates.sql
--
-- Pourquoi : PlayerFormComponent.onSubmit() écrivait is_admin via un
-- UPDATE REST direct sur la table "players" (supabase.from('players')
-- .update({ is_admin }).eq('id', ...)). Or players a RLS activé sans
-- aucune policy INSERT/UPDATE (voir setup.sql, section RLS) — l'UPDATE
-- affecte donc 0 ligne, et l'erreur retournée par PostgREST n'était
-- jamais lue côté client (pas de "if (error) throw error;"). Résultat :
-- promouvoir ou rétrograder un admin échouait silencieusement, sans
-- aucun message d'erreur ni aucune modification en base.
--
-- Décision produit (validée) : une RPC dédiée plutôt qu'une extension de
-- update_player_profile, avec une garde bloquante systématique (jamais de
-- branche self, contrairement à update_player_profile) et un garde-fou
-- anti-lockout empêchant de vider un groupe de tout admin.
--
-- Chaque fonction ci-dessous est précédée d'un DROP FUNCTION IF EXISTS
-- typé, par défense en profondeur (voir security.sql pour le pourquoi).
-- ============================================================

BEGIN;

DROP FUNCTION IF EXISTS set_player_admin(uuid, uuid, boolean);

-- set_player_admin — promeut/rétrograde un joueur. p_actor_id doit
-- TOUJOURS être admin du groupe cible : contrairement à
-- update_player_profile, il n'existe aucune branche "self" qui
-- dispenserait de assert_group_admin. C'est le point de sécurité central
-- de ce correctif : un joueur ne doit jamais pouvoir s'auto-promouvoir.
-- L'auto-rétrogradation par un admin légitime reste en revanche permise
-- (couverte par assert_group_admin, qui vérifie l'acteur AVANT l'effet
-- de la rétrogradation sur lui-même), tant que la garde anti-lockout
-- ci-dessous est satisfaite.
CREATE FUNCTION set_player_admin(
  p_actor_id uuid,
  p_player_id uuid,
  p_is_admin boolean
) RETURNS json AS $$
DECLARE
  result players%ROWTYPE;
  v_group_id uuid;
  v_was_admin boolean;
  v_remaining_admins int;
BEGIN
  -- Convention partagée avec update_player_profile / set_plus_ones
  -- (security.sql) : un acteur non déclaré n'est jamais un admin, donc
  -- l'erreur générique "not_allowed" plutôt que "not_admin" (réservée au
  -- cas où un acteur EST déclaré mais n'a pas les droits).
  IF p_actor_id IS NULL THEN
    RAISE EXCEPTION 'not_allowed';
  END IF;

  SELECT group_id, is_admin INTO v_group_id, v_was_admin FROM players WHERE id = p_player_id;
  IF v_group_id IS NULL THEN
    RAISE EXCEPTION 'player_not_found';
  END IF;

  PERFORM assert_group_admin(p_actor_id, v_group_id);

  -- Garde anti-lockout : refuser de retirer le dernier admin d'un
  -- groupe. On ne bloque que le cas dégénéré (0 admin restant après
  -- l'opération) — l'auto-rétrogradation reste permise tant qu'il reste
  -- au moins un autre admin dans le groupe.
  IF p_is_admin = false AND v_was_admin = true THEN
    SELECT count(*) INTO v_remaining_admins FROM players
    WHERE group_id = v_group_id AND is_admin = true AND id <> p_player_id;
    IF v_remaining_admins = 0 THEN
      RAISE EXCEPTION 'last_admin';
    END IF;
  END IF;

  UPDATE players SET is_admin = p_is_admin
  WHERE id = p_player_id
  RETURNING * INTO result;

  INSERT INTO audit_log (group_id, actor_id, action, target_type, target_id, details)
  VALUES (v_group_id, p_actor_id, 'set_player_admin', 'player', p_player_id,
    jsonb_build_object('is_admin', p_is_admin, 'player_name', COALESCE(result.display_name, result.username)));

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
WHERE proname = 'set_player_admin'
ORDER BY proname;
