export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export interface Database {
  public: {
    Tables: {
      groups: {
        Row: { id: string; name: string; slug: string; created_at: string };
        Insert: { id?: string; name: string; slug: string; created_at?: string };
        Update: { id?: string; name?: string; slug?: string; created_at?: string };
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
        Args: { p_player_id: string; p_display_name?: string | null; p_new_pin?: string | null; p_actor_id?: string | null };
        Returns: Json;
      };
      set_plus_ones: {
        Args: { p_match_id: string; p_player_id: string; p_count: number };
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
          p_actor_id?: string | null;
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
        Args: { p_match_id: string; p_player_id: string; p_team: number | null };
        Returns: undefined;
      };
      set_match_score: {
        Args: { p_match_id: string; p_score_a: number; p_score_b: number; p_actor_id: string };
        Returns: undefined;
      };
      get_player_stats: {
        Args: { p_player_id: string };
        Returns: Json;
      };
      get_player_history: {
        Args: { p_player_id: string };
        Returns: Json;
      };
    };
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
}
