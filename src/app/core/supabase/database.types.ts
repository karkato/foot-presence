export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export interface Database {
  public: {
    Tables: {
      groups: {
        Row: {
          id: string;
          name: string;
          slug: string;
          created_at: string;
          guests_enabled: boolean;
          max_guests_per_player: number | null;
          mini_match_enabled: boolean;
        };
        Insert: {
          id?: string;
          name: string;
          slug: string;
          created_at?: string;
          guests_enabled?: boolean;
          max_guests_per_player?: number | null;
          mini_match_enabled?: boolean;
        };
        Update: {
          id?: string;
          name?: string;
          slug?: string;
          created_at?: string;
          guests_enabled?: boolean;
          max_guests_per_player?: number | null;
          mini_match_enabled?: boolean;
        };
        Relationships: [];
      };
      players: {
        Row: {
          id: string;
          group_id: string;
          username: string;
          display_name: string | null;
          pin_hash: string;
          is_admin: boolean;
          created_at: string;
        };
        Insert: {
          id?: string;
          group_id: string;
          username: string;
          display_name?: string | null;
          pin_hash: string;
          is_admin?: boolean;
          created_at?: string;
        };
        Update: {
          id?: string;
          group_id?: string;
          username?: string;
          display_name?: string | null;
          pin_hash?: string;
          is_admin?: boolean;
          created_at?: string;
        };
        Relationships: [];
      };
      seasons: {
        Row: {
          id: string;
          group_id: string;
          name: string;
          started_at: string;
          ended_at: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          group_id: string;
          name: string;
          started_at?: string;
          ended_at?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          group_id?: string;
          name?: string;
          started_at?: string;
          ended_at?: string | null;
          created_at?: string;
        };
        Relationships: [];
      };
      matches: {
        Row: {
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
          season_id: string;
        };
        Insert: {
          id?: string;
          group_id: string;
          title: string;
          match_date: string;
          match_time: string;
          max_players?: number;
          registration_deadline?: string | null;
          is_closed?: boolean;
          created_at?: string;
          score_a?: number | null;
          score_b?: number | null;
          score_a2?: number | null;
          score_b2?: number | null;
          mini_match_target?: number | null;
          team_a_name?: string;
          team_b_name?: string;
          season_id: string;
        };
        Update: {
          id?: string;
          group_id?: string;
          title?: string;
          match_date?: string;
          match_time?: string;
          max_players?: number;
          registration_deadline?: string | null;
          score_a2?: number | null;
          score_b2?: number | null;
          mini_match_target?: number | null;
          is_closed?: boolean;
          created_at?: string;
          score_a?: number | null;
          score_b?: number | null;
          team_a_name?: string;
          team_b_name?: string;
          season_id?: string;
        };
        Relationships: [];
      };
      registrations: {
        Row: {
          id: string;
          match_id: string;
          player_id: string;
          registered_by: string;
          registered_at: string;
          is_withdrawn: boolean;
          plus_ones: number;
          team: number | null;
          goals: number;
          assists: number;
        };
        Insert: {
          id?: string;
          match_id: string;
          player_id: string;
          registered_by: string;
          registered_at?: string;
          is_withdrawn?: boolean;
          plus_ones?: number;
          team?: number | null;
          goals?: number;
          assists?: number;
        };
        Update: {
          id?: string;
          match_id?: string;
          player_id?: string;
          registered_by?: string;
          registered_at?: string;
          is_withdrawn?: boolean;
          plus_ones?: number;
          team?: number | null;
          goals?: number;
          assists?: number;
        };
        Relationships: [];
      };
    };
    Views: {
      match_registrations_ranked: {
        Row: {
          id: string;
          match_id: string;
          player_id: string;
          registered_by: string;
          registered_at: string;
          is_withdrawn: boolean;
          display_name: string;
          rank: number;
        };
        Relationships: [];
      };
    };
    Functions: {
      login_player: {
        Args: { p_username: string; p_pin: string; p_group_id: string };
        Returns: Json;
      };
      register_player: {
        Args: { p_match_id: string; p_player_id: string; p_registered_by: string };
        Returns: Json;
      };
      withdraw_player: {
        Args: { p_match_id: string; p_player_id: string; p_withdrawn_by: string };
        Returns: undefined;
      };
      update_player_profile: {
        Args: { p_player_id: string; p_display_name?: string | null; p_new_pin?: string | null; p_actor_id: string };
        Returns: Json;
      };
      set_plus_ones: {
        Args: { p_match_id: string; p_player_id: string; p_count: number; p_actor_id: string };
        Returns: undefined;
      };
      set_group_settings: {
        Args: {
          p_group_id: string;
          p_actor_id: string;
          p_guests_enabled: boolean;
          p_max_guests_per_player: number | null;
          p_mini_match_enabled: boolean;
        };
        Returns: undefined;
      };
      admin_remove_registration: {
        Args: { p_admin_id: string; p_match_id: string; p_player_id: string };
        Returns: undefined;
      };
      create_player: {
        Args: {
          p_group_id: string;
          p_username: string;
          p_pin: string;
          p_display_name?: string | null;
          p_is_admin?: boolean;
          p_actor_id: string;
        };
        Returns: Json;
      };
      log_action: {
        Args: {
          p_actor_id: string;
          p_action: string;
          p_target_type: string;
          p_target_id: string;
          p_details?: Record<string, unknown>;
        };
        Returns: undefined;
      };
      get_audit_log: {
        Args: { p_group_id: string; p_limit?: number };
        Returns: Json;
      };
      assign_team: {
        Args: { p_match_id: string; p_player_id: string; p_team: number | null; p_actor_id: string };
        Returns: undefined;
      };
      set_match_score: {
        Args: { p_match_id: string; p_score_a: number; p_score_b: number; p_actor_id: string };
        Returns: undefined;
      };
      set_player_match_stats: {
        Args: {
          p_match_id: string;
          p_player_id: string;
          p_goals: number;
          p_assists: number;
          p_actor_id: string;
        };
        Returns: undefined;
      };
      get_player_stats: {
        Args: { p_player_id: string; p_season_id?: string | null };
        Returns: Json;
      };
      get_player_history: {
        Args: { p_player_id: string; p_season_id?: string | null };
        Returns: Json;
      };
      get_group_player_stats: {
        Args: { p_group_id: string; p_season_id?: string | null };
        Returns: Json;
      };
      create_match: {
        Args: {
          p_actor_id: string;
          p_group_id: string;
          p_title: string;
          p_match_date: string;
          p_match_time: string;
          p_max_players?: number;
          p_registration_deadline?: string | null;
          p_team_a_name?: string;
          p_team_b_name?: string;
        };
        Returns: Json;
      };
      update_match: {
        Args: {
          p_actor_id: string;
          p_match_id: string;
          p_title: string;
          p_match_date: string;
          p_match_time: string;
          p_max_players: number;
          p_registration_deadline: string | null;
          p_team_a_name: string;
          p_team_b_name: string;
        };
        Returns: undefined;
      };
      set_match_closed: {
        Args: { p_actor_id: string; p_match_id: string; p_closed: boolean };
        Returns: undefined;
      };
      delete_match: {
        Args: { p_actor_id: string; p_match_id: string };
        Returns: undefined;
      };
      set_mini_match_score: {
        Args: {
          p_actor_id: string;
          p_match_id: string;
          p_score_a2: number;
          p_score_b2: number;
          p_mini_match_target: number;
        };
        Returns: undefined;
      };
      start_new_season: {
        Args: { p_actor_id: string; p_group_id: string; p_name?: string | null };
        Returns: Json;
      };
      set_match_season: {
        Args: { p_actor_id: string; p_match_id: string; p_season_id: string };
        Returns: undefined;
      };
    };
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
}
