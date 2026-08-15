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
