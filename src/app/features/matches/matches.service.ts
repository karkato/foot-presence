import { Injectable, inject } from '@angular/core';
import { SupabaseService } from '../../core/supabase/supabase.service';
import { Match } from '../../shared/models/match.model';
import { Registration } from '../../shared/models/registration.model';
import { Player } from '../../shared/models/player.model';

export interface AuditEntry {
  id: string;
  action: string;
  target_type: string;
  target_id: string | null;
  details: Record<string, string>;
  created_at: string;
  actor_name: string;
}

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

  async withdrawPlayer(matchId: string, playerId: string, actorId: string): Promise<void> {
    const { error } = await this.supabase.rpc('withdraw_player', {
      p_match_id: matchId,
      p_player_id: playerId,
      p_withdrawn_by: actorId,
    });
    if (error) throw error;
  }

  async createMatch(match: Omit<Match, 'id' | 'created_at'>, actorId?: string): Promise<Match> {
    const { data, error } = await this.supabase
      .from('matches')
      .insert(match)
      .select()
      .single();
    if (error) throw error;
    if (actorId) {
      await this.supabase.rpc('log_action', {
        p_actor_id: actorId,
        p_action: 'create_match',
        p_target_type: 'match',
        p_target_id: data.id,
        p_details: { title: match.title },
      });
    }
    return data;
  }

  async updateMatch(
    matchId: string,
    updates: Partial<Match>,
    actorId?: string,
    details?: Record<string, unknown>
  ): Promise<void> {
    const { error } = await this.supabase
      .from('matches')
      .update(updates)
      .eq('id', matchId);
    if (error) throw error;
    if (actorId) {
      const action =
        updates.is_closed !== undefined
          ? updates.is_closed ? 'close_match' : 'reopen_match'
          : 'update_match';
      await this.supabase.rpc('log_action', {
        p_actor_id: actorId,
        p_action: action,
        p_target_type: 'match',
        p_target_id: matchId,
        p_details: details ?? {},
      });
    }
  }

  async deleteMatch(matchId: string, actorId?: string, title?: string): Promise<void> {
    const { error } = await this.supabase.from('matches').delete().eq('id', matchId);
    if (error) throw error;
    if (actorId) {
      await this.supabase.rpc('log_action', {
        p_actor_id: actorId,
        p_action: 'delete_match',
        p_target_type: 'match',
        p_target_id: matchId,
        p_details: title ? { title } : {},
      });
    }
  }

  async setPlusOnes(matchId: string, playerId: string, count: number): Promise<void> {
    const { error } = await this.supabase.rpc('set_plus_ones', {
      p_match_id: matchId,
      p_player_id: playerId,
      p_count: count,
    });
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

  async getAuditLog(groupId: string): Promise<AuditEntry[]> {
    const { data, error } = await this.supabase.rpc('get_audit_log', {
      p_group_id: groupId,
      p_limit: 30,
    });
    if (error) throw error;
    return (data as unknown as AuditEntry[]) ?? [];
  }
}
