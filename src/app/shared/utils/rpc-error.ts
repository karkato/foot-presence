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
  if (err instanceof Error) {
    if (err.message.includes('not_admin')) return 'Action réservée aux administrateurs.';
    if (err.message.includes('not_allowed')) return 'Action non autorisée.';
  }
  return fallback;
}
