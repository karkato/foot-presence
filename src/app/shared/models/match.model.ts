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
  score_a: number | null;
  score_b: number | null;
  score_a2: number | null;
  score_b2: number | null;
  mini_match_target: number | null;
  team_a_name: string;
  team_b_name: string;
}
