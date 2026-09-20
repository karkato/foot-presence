import { Season } from '../models/season.model';

/**
 * Where a match stands in the "closed match -> result entry" workflow, used
 * to route it into the right home-screen section (a venir / en attente de
 * resultat / termine) and to badge it in the admin match list.
 *
 * Priority order matters: `archived` short-circuits every other status (an
 * archived season's matches are read-only -- see `season_archived` in
 * supabase/playerstats.sql -- so their score/team/stats completeness is
 * moot). Below that, the remaining statuses form a single linear
 * progression (upcoming -> awaiting_teams -> awaiting_score ->
 * awaiting_stats -> complete), each one gated on the previous being
 * satisfied.
 */
export type MatchCompletionStatus =
  | 'upcoming'
  | 'awaiting_teams'
  | 'awaiting_score'
  | 'awaiting_stats'
  | 'complete'
  | 'archived';

export interface MatchStatusInput {
  match_date: string;
  score_a: number | null;
  score_b: number | null;
}

/**
 * Per-match aggregates over its non-withdrawn registrations, needed to tell
 * `awaiting_teams` from `awaiting_score` from `awaiting_stats` apart. Built
 * once in MatchesService.getMatchesByGroup from the raw registrations
 * sub-select, so `deriveMatchStatus` stays a pure function of already
 * fetched data -- no extra round-trip per match.
 */
export interface MatchStatusAggregates {
  hasUnassignedPresent: boolean;
  teamAGoalsDeclared: number;
  teamBGoalsDeclared: number;
}

function parseDateOnly(dateStr: string): Date {
  // Manual y/m/d parsing (vs. `new Date(dateStr)`) avoids the classic JS
  // gotcha where a bare "YYYY-MM-DD" string is parsed as UTC midnight, then
  // shifted back a calendar day once rendered/compared in a timezone behind
  // UTC. match_date has no time component, so this must stay a local-time
  // date regardless of the runtime's offset.
  const [year, month, day] = dateStr.split('-').map(Number);
  return new Date(year, (month || 1) - 1, day || 1);
}

function isMatchDateInFuture(matchDate: string): boolean {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return parseDateOnly(matchDate) >= today;
}

/**
 * Pure, side-effect-free derivation -- no DB/service access here on purpose,
 * so it stays trivially testable and reusable across match-list (home
 * sections) and admin-dashboard (per-row badge) without either owning the
 * logic.
 */
export function deriveMatchStatus(
  match: MatchStatusInput,
  aggregates: MatchStatusAggregates,
  seasonEndedAt: string | null,
): MatchCompletionStatus {
  if (seasonEndedAt !== null) return 'archived';

  if (match.score_a === null) {
    if (isMatchDateInFuture(match.match_date)) return 'upcoming';
    return aggregates.hasUnassignedPresent ? 'awaiting_teams' : 'awaiting_score';
  }

  const scoreA = match.score_a;
  const scoreB = match.score_b ?? 0;
  if (aggregates.teamAGoalsDeclared < scoreA || aggregates.teamBGoalsDeclared < scoreB) {
    return 'awaiting_stats';
  }
  return 'complete';
}

export function matchStatusLabel(status: MatchCompletionStatus): string {
  switch (status) {
    case 'upcoming': return 'À venir';
    case 'awaiting_teams': return 'Équipes à assigner';
    case 'awaiting_score': return 'Score à saisir';
    case 'awaiting_stats': return 'Buts/passes à saisir';
    case 'complete': return 'Terminé';
    case 'archived': return 'Archivé';
  }
}

/**
 * Builds a `season_id -> ended_at` lookup from a season list. Shared between
 * match-list and admin-dashboard so neither re-derives its own Map from
 * SeasonsService.getSeasons -- both only ever need `deriveMatchStatus`'s
 * third argument, never the full Season objects.
 */
export function seasonEndedAtLookup(
  seasons: readonly Pick<Season, 'id' | 'ended_at'>[],
): (seasonId: string) => string | null {
  const endedAtById = new Map(seasons.map(s => [s.id, s.ended_at]));
  return (seasonId: string) => endedAtById.get(seasonId) ?? null;
}
