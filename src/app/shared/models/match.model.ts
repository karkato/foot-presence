export interface Match {
  id: string;
  group_id: string;
  title: string;
  match_date: string;
  match_time: string;
  max_players: number;
  registration_deadline: string | null;
  is_closed: boolean;
  created_at: string;
}
