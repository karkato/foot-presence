export interface Group {
  id: string;
  name: string;
  slug: string;
  created_at: string;
  guests_enabled: boolean;
  max_guests_per_player: number | null;
  mini_match_enabled: boolean;
}
