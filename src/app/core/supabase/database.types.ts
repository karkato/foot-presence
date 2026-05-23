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
        };
        Update: {
          id?: string;
          group_id?: string;
          title?: string;
          match_date?: string;
          match_time?: string;
          max_players?: number;
          registration_deadline?: string | null;
          is_closed?: boolean;
          created_at?: string;
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
        };
        Insert: {
          id?: string;
          match_id: string;
          player_id: string;
          registered_by: string;
          registered_at?: string;
          is_withdrawn?: boolean;
          plus_ones?: number;
        };
        Update: {
          id?: string;
          match_id?: string;
          player_id?: string;
          registered_by?: string;
          registered_at?: string;
          is_withdrawn?: boolean;
          plus_ones?: number;
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
        Args: { p_match_id: string; p_player_id: string };
        Returns: undefined;
      };
      update_player_profile: {
        Args: { p_player_id: string; p_display_name?: string | null; p_new_pin?: string | null };
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
        };
        Returns: Json;
      };
    };
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
}
