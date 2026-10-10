-- ============================================================
-- foot-presence — Index manquants sur les colonnes de filtrage/tri
-- les plus fréquentes
-- À exécuter à tout moment (CREATE INDEX IF NOT EXISTS, aucune dépendance
-- d'ordre avec les autres migrations)
--
-- Pourquoi : volumes faibles aujourd'hui donc pas encore sensible, mais
-- ces colonnes sont filtrées/triées sur quasi chaque écran (liste des
-- matchs d'un groupe triée par date, historique d'activité admin) --
-- gratuit à ajouter maintenant plutôt que d'attendre que ça devienne un
-- problème réel. idx_registrations_match (suggéré dans AMELIORATIONS.md)
-- est volontairement omis : UNIQUE(match_id, player_id) sur registrations
-- (setup.sql) crée déjà un index dont match_id est la colonne de tête,
-- utilisable pour un filtre sur match_id seul -- un index dédié serait
-- redondant.
-- ============================================================

CREATE INDEX IF NOT EXISTS idx_matches_group_date ON matches(group_id, match_date);
CREATE INDEX IF NOT EXISTS idx_audit_group_date ON audit_log(group_id, created_at DESC);
