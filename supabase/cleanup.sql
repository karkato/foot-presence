-- ============================================================
-- Nettoyage : code mort (sessions.sql jamais réellement appliqué)
-- et surcharges ambiguës de update_player_profile / create_player
--
-- Note (sécurité, sessions désormais supprimé du repo) : le fichier
-- sessions.sql référencé dans les commentaires ci-dessous n'existe plus
-- dans le dépôt (voir supabase/security.sql, qui reprend et durcit ses
-- 6 RPC "matches" et l'ensemble de ses gardes admin sans le système de
-- tokens). Ces commentaires sont conservés tels quels comme trace de la
-- décision et du diagnostic de désync qui ont mené à ce nettoyage.
-- ============================================================

-- Le système de tokens de session (sessions.sql) n'a jamais été adopté :
-- seule la table a été créée, aucune des fonctions p_token n'existe en
-- base (resolve_token, logout_player, register_player(...,p_token) etc.
-- sont absentes de pg_proc) et le front n'appelle nulle part p_token.
DROP TABLE IF EXISTS sessions;

-- Surcharge obsolète (setup.sql) : coexistait avec la version à 4
-- paramètres (audit.sql) et rendait tout appel sans p_actor_id ambigu
-- ("function update_player_profile(...) is not unique"). C'est ce qui
-- bloquait le changement de PIN/pseudo en self-service (Profil > Config),
-- amenant le joueur à se retrouver avec un PIN jamais réellement mis à jour.
DROP FUNCTION IF EXISTS update_player_profile(uuid, text, text);

-- Même désync sur create_player : pas de bug actif (le seul appelant,
-- player-form.component.ts, passe toujours p_actor_id) mais même dette,
-- nettoyée par cohérence.
DROP FUNCTION IF EXISTS create_player(uuid, text, text, text, boolean);

-- ============================================================
-- Vérifications post-nettoyage
-- ============================================================

-- Ne doit plus renvoyer qu'UNE ligne pour update_player_profile et create_player
SELECT proname, pg_get_function_identity_arguments(oid) AS args
FROM pg_proc
WHERE proname IN ('update_player_profile', 'create_player', 'login_player')
ORDER BY proname;

-- La table sessions ne doit plus exister
SELECT EXISTS (
  SELECT FROM information_schema.tables WHERE table_name = 'sessions'
) AS sessions_table_exists;

-- Policies actuelles sur matches — vérifie s'il reste une écriture
-- publique non prévue (héritage possible de sessions.sql, jamais nettoyé ;
-- security.sql supprime cette policy explicitement, voir sa propre
-- section de vérification post-migration)
SELECT polname, polcmd, pg_get_expr(polqual, polrelid) AS using_expr,
       pg_get_expr(polwithcheck, polrelid) AS with_check_expr
FROM pg_policy
WHERE polrelid = 'matches'::regclass;
