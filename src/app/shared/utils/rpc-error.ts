/**
 * Extracts the error message from an unknown RPC error in a structural
 * way (duck-typed on a `message` property), not a nominal one
 * (`instanceof Error`).
 *
 * The `{ data, error }` returned by `@supabase/postgrest-js`'s
 * `.rpc(...)` is a PLAIN object, not an `Error` instance — `PostgrestError
 * extends Error` is only instantiated on the `.throwOnError()` code path,
 * which this project never uses (every caller does `if (error) throw
 * error;`, re-throwing the plain object itself). `instanceof Error` is
 * therefore always false here; any error mapping must check for a
 * `message` property instead.
 */
export function rpcMessage(err: unknown): string {
  if (typeof err === 'object' && err !== null && 'message' in err) {
    return String((err as { message: unknown }).message ?? '');
  }
  return '';
}

/**
 * Maps well-known authorization errors raised by SECURITY DEFINER RPCs
 * (see supabase/security.sql: assert_group_admin / update_player_profile)
 * to a French user-facing message.
 *
 * This only covers the generic authorization vocabulary shared across
 * RPCs (`not_admin`, `not_allowed`). RPC-specific error codes (e.g. the
 * guest-limit errors in set_plus_ones) keep their own dedicated mapping
 * next to their call site.
 */
export function mapAuthRpcError(err: unknown, fallback: string): string {
  const message = rpcMessage(err);
  if (message.includes('not_admin')) return 'Action réservée aux administrateurs.';
  if (message.includes('not_allowed')) return 'Action non autorisée.';
  return fallback;
}

/**
 * Maps errors raised by set_player_match_stats and set_match_score
 * (supabase/playerstats.sql) to a French user-facing message. Shared
 * between the profile's "Buts" tab and the match-detail admin panel —
 * both call these RPCs and need to surface the same vocabulary.
 */
export function mapMatchStatsError(err: unknown, fallback: string): string {
  const message = rpcMessage(err);
  if (message.includes('goals_exceed_score')) {
    return "Le total des buts de l'équipe dépasserait le score du match.";
  }
  if (message.includes('assists_exceed_score')) {
    return "Le total des passes de l'équipe dépasserait le score du match.";
  }
  if (message.includes('season_archived')) {
    return 'Cette saison est archivée : les stats ne sont plus modifiables.';
  }
  if (message.includes('score_not_set')) {
    return "Le score du match n'a pas encore été saisi.";
  }
  if (message.includes('team_not_assigned')) {
    return "Aucune équipe ne t'a été assignée sur ce match.";
  }
  if (message.includes('not_registered')) {
    return "Tu n'es pas inscrit sur ce match.";
  }
  if (message.includes('stats_exceed_score')) {
    return 'Des buts déjà déclarés dépassent ce nouveau score — corrige d\'abord les buts des joueurs.';
  }
  return mapAuthRpcError(err, fallback);
}
