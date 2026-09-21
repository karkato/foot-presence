import { Player, GroupPlayerStats, getDisplayName } from '../models/player.model';

export type LeaderboardMetric = 'goals' | 'assists' | 'winRate';

export interface LeaderboardRow {
  playerId: string;
  name: string;
  played: number;
  wins: number;
  goals: number;
  assists: number;
  winRate: number;
}

export function computeWinRate(wins: number, played: number): number {
  if (played === 0) return 0;
  return Math.round((wins / played) * 100);
}

/**
 * Joins get_group_player_stats rows to their Player for display. Silently
 * drops stats rows with no matching player (e.g. a player deleted after
 * accumulating stats) rather than crashing the leaderboard.
 */
export function buildLeaderboardRows(stats: GroupPlayerStats[], players: Player[]): LeaderboardRow[] {
  const playerById = new Map(players.map(p => [p.id, p]));
  const rows: LeaderboardRow[] = [];
  for (const s of stats) {
    const player = playerById.get(s.player_id);
    if (!player) continue;
    rows.push({
      playerId: s.player_id,
      name: getDisplayName(player),
      played: s.played,
      wins: s.wins,
      goals: s.goals,
      assists: s.assists,
      winRate: computeWinRate(s.wins, s.played),
    });
  }
  return rows;
}

/**
 * Deterministic tie-breaks per metric so re-renders never reorder rows that
 * are equal on the active metric -- last resort is always the display name.
 */
export function sortLeaderboard(rows: LeaderboardRow[], metric: LeaderboardMetric): LeaderboardRow[] {
  const byName = (a: LeaderboardRow, b: LeaderboardRow) => a.name.localeCompare(b.name);

  switch (metric) {
    case 'goals':
      return [...rows].sort((a, b) =>
        b.goals - a.goals || b.assists - a.assists || a.played - b.played || byName(a, b)
      );
    case 'assists':
      return [...rows].sort((a, b) =>
        b.assists - a.assists || b.goals - a.goals || a.played - b.played || byName(a, b)
      );
    case 'winRate':
      return [...rows].sort((a, b) =>
        b.winRate - a.winRate || b.played - a.played || byName(a, b)
      );
  }
}

/**
 * Assigns ranks to an already-sorted list, giving ties on the active metric
 * the same rank (1, 1, 3 -- not 1, 2, 3).
 */
export function assignRanks(
  sortedRows: LeaderboardRow[],
  metric: LeaderboardMetric,
): (LeaderboardRow & { rank: number })[] {
  const result: (LeaderboardRow & { rank: number })[] = [];
  let rank = 0;
  let previous: LeaderboardRow | null = null;
  sortedRows.forEach((row, index) => {
    if (!previous || row[metric] !== previous[metric]) {
      rank = index + 1;
    }
    result.push({ ...row, rank });
    previous = row;
  });
  return result;
}
