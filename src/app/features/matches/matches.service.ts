import { Injectable, inject } from '@angular/core';
import { SupabaseService } from '../../core/supabase/supabase.service';
import { Match } from '../../shared/models/match.model';
import { Registration } from '../../shared/models/registration.model';
import { Player } from '../../shared/models/player.model';

@Injectable({ providedIn: 'root' })
export class MatchesService {
  private readonly supabase = inject(SupabaseService).client;

  async getMatchesByGroup(groupId: string): Promise<Match[]> {
    const { data, error } = await this.supabase
      .from('matches')
      .select('*')
      .eq('group_id', groupId)
      .order('match_date', { ascending: false })
      .order('match_time', { ascending: false });

    if (error) throw error;
    return data ?? [];
  }

  async getMatch(matchId: string): Promise<Match> {
    const { data, error } = await this.supabase
      .from('matches')
      .select('*')
      .eq('id', matchId)
      .single();

    if (error) throw error;
    return data;
  }

  async getRegistrations(matchId: string): Promise<Registration[]> {
    const { data, error } = await this.supabase
      .from('registrations')
      .select('*, player:players!player_id(id, username, display_name)')
      .eq('match_id', matchId)
      .order('registered_at', { ascending: true });

    if (error) throw error;
    return (data ?? []) as unknown as Registration[];
  }

  async getGroupPlayers(groupId: string): Promise<Player[]> {
    const { data, error } = await this.supabase
      .from('players')
      .select('id, group_id, username, display_name, is_admin, created_at')
      .eq('group_id', groupId)
      .order('username');

    if (error) throw error;
    return data ?? [];
  }

  async registerPlayer(matchId: string, playerId: string, registeredBy: string): Promise<void> {
    const { error } = await this.supabase.rpc('register_player', {
      p_match_id: matchId,
      p_player_id: playerId,
      p_registered_by: registeredBy,
    });
    if (error) throw error;
  }

  async withdrawPlayer(matchId: string, playerId: string): Promise<void> {
    const { error } = await this.supabase.rpc('withdraw_player', {
      p_match_id: matchId,
      p_player_id: playerId,
    });
    if (error) throw error;
  }

  async createMatch(match: Omit<Match, 'id' | 'created_at'>): Promise<Match> {
    const { data, error } = await this.supabase
      .from('matches')
      .insert(match)
      .select()
      .single();
    if (error) throw error;
    return data;
  }

  async updateMatch(matchId: string, updates: Partial<Match>): Promise<void> {
    const { error } = await this.supabase
      .from('matches')
      .update(updates)
      .eq('id', matchId);
    if (error) throw error;
  }

  async deleteMatch(matchId: string): Promise<void> {
    const { error } = await this.supabase.from('matches').delete().eq('id', matchId);
    if (error) throw error;
  }

  async adminRemoveRegistration(adminId: string, matchId: string, playerId: string): Promise<void> {
    const { error } = await this.supabase.rpc('admin_remove_registration', {
      p_admin_id: adminId,
      p_match_id: matchId,
      p_player_id: playerId,
    });
    if (error) throw error;
  }
}
