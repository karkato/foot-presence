export interface Season {
  id: string;
  group_id: string;
  name: string;
  started_at: string;
  ended_at: string | null;
  created_at: string;
}

export function isCurrentSeason(season: Season): boolean {
  return season.ended_at === null;
}
