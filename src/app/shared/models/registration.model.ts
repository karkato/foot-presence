export interface Registration {
  id: string;
  match_id: string;
  player_id: string;
  registered_by: string;
  registered_at: string;
  is_withdrawn: boolean;
  plus_ones: number;
  team: number | null;
  player: {
    id: string;
    username: string;
    display_name: string | null;
  };
}
