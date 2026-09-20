/**
 * Remaining team quota for a single stat (goals or assists) on a match,
 * given the team's score and the total already declared by the *other*
 * players of that team for that stat. Floors at zero: the server is the
 * real authority on "team total <= score" (see goals_exceed_score /
 * assists_exceed_score in supabase/playerstats.sql), this is purely a UI
 * hint to cap steppers/inputs and avoid a round-trip that would just fail.
 *
 * Shared between my-stats.component.ts (profile "Buts" tab, editing one's
 * own stat) and match-stats.component.ts (admin screen, editing any player's
 * stat) -- both need the exact same "score minus everyone else" formula.
 */
export function computeStatsRemaining(teamScore: number, otherPlayersTotal: number): number {
  return Math.max(0, teamScore - otherPlayersTotal);
}
