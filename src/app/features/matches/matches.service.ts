import { Injectable, inject } from '@angular/core';
import { SupabaseService } from '../../core/supabase/supabase.service';
import { Match } from '../../shared/models/match.model';
import { Registration } from '../../shared/models/registration.model';
import { Player } from '../../shared/models/player.model';

export interface PlayerStats {
  played: number;
  wins: number;
  losses: number;
  draws: number;
  goals: number;
  assists: number;
}

export interface MatchHistoryEntry {
  id: string;
  title: string;
  match_date: string;
  match_time: string;
  score_a: number | null;
  score_b: number | null;
  team_a_name: string;
  team_b_name: string;
  team: number | null;
  season_id: string;
  season_name: string;
  goals: number;
  assists: number;
  team_score: number | null;
  team_goals_other: number;
  team_assists_other: number;
  result: 'win' | 'loss' | 'draw' | null;
}

export interface AuditEntry {
  id: string;
  action: string;
  target_type: string;
  target_id: string | null;
  details: Record<string, string>;
  created_at: string;
  actor_name: string;
}

export type MatchWithCount = Match & { registration_count: number };

export interface MatchInput {
  title: string;
  match_date: string;
  match_time: string;
  max_players: number;
  registration_deadline: string | null;
  team_a_name: string;
  team_b_name: string;
}

@Injectable({ providedIn: 'root' })
export class MatchesService {
  private readonly supabase = inject(SupabaseService).client;

  async getMatchesByGroup(groupId: string): Promise<MatchWithCount[]> {
    const { data, error } = await this.supabase
      .from('matches')
      .select('*, registrations(id, is_withdrawn, plus_ones)')
      .eq('group_id', groupId)
      .order('match_date', { ascending: false })
      .order('match_time', { ascending: false });

    if (error) throw error;
    return (data ?? []).map(m => {
      const regs = (m.registrations as unknown as { is_withdrawn: boolean; plus_ones: number }[] | null) ?? [];
      const { registrations: _, ...match } = m as typeof m & { registrations: unknown };
      return {
        ...(match as Match),
        registration_count: regs.filter(r => !r.is_withdrawn).reduce((sum, r) => sum + 1 + (r.plus_ones ?? 0), 0),
      };
    });
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

  async createMatch(input: MatchInput, groupId: string, actorId: string): Promise<Match> {
    const { data, error } = await this.supabase.rpc('create_match', {
      p_actor_id: actorId,
      p_group_id: groupId,
      p_title: input.title,
      p_match_date: input.match_date,
      p_match_time: input.match_time,
      p_max_players: input.max_players,
      p_registration_deadline: input.registration_deadline,
      p_team_a_name: input.team_a_name,
      p_team_b_name: input.team_b_name,
    });
    if (error) throw error;
    return data as unknown as Match;
  }

  async updateMatch(matchId: string, input: MatchInput, actorId: string): Promise<void> {
    const { error } = await this.supabase.rpc('update_match', {
      p_actor_id: actorId,
      p_match_id: matchId,
      p_title: input.title,
      p_match_date: input.match_date,
      p_match_time: input.match_time,
      p_max_players: input.max_players,
      p_registration_deadline: input.registration_deadline,
      p_team_a_name: input.team_a_name,
      p_team_b_name: input.team_b_name,
    });
    if (error) throw error;
  }

  async setMatchClosed(matchId: string, closed: boolean, actorId: string): Promise<void> {
    const { error } = await this.supabase.rpc('set_match_closed', {
      p_actor_id: actorId,
      p_match_id: matchId,
      p_closed: closed,
    });
    if (error) throw error;
  }

  async deleteMatch(matchId: string, actorId: string): Promise<void> {
    const { error } = await this.supabase.rpc('delete_match', {
      p_actor_id: actorId,
      p_match_id: matchId,
    });
    if (error) throw error;
  }

  async setPlusOnes(matchId: string, playerId: string, count: number, actorId: string): Promise<void> {
    const { error } = await this.supabase.rpc('set_plus_ones', {
      p_match_id: matchId,
      p_player_id: playerId,
      p_count: count,
      p_actor_id: actorId,
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

  async assignTeam(matchId: string, playerId: string, team: number | null, actorId: string): Promise<void> {
    const { error } = await this.supabase.rpc('assign_team', {
      p_match_id: matchId,
      p_player_id: playerId,
      p_team: team,
      p_actor_id: actorId,
    });
    if (error) throw error;
  }

  async setPlayerMatchStats(
    matchId: string,
    playerId: string,
    goals: number,
    assists: number,
    actorId: string
  ): Promise<void> {
    const { error } = await this.supabase.rpc('set_player_match_stats', {
      p_match_id: matchId,
      p_player_id: playerId,
      p_goals: goals,
      p_assists: assists,
      p_actor_id: actorId,
    });
    if (error) throw error;
  }

  async setMatchScore(matchId: string, scoreA: number, scoreB: number, actorId: string): Promise<void> {
    const { error } = await this.supabase.rpc('set_match_score', {
      p_match_id: matchId,
      p_score_a: scoreA,
      p_score_b: scoreB,
      p_actor_id: actorId,
    });
    if (error) throw error;
  }

  async setMiniMatchScore(
    matchId: string,
    scoreA2: number,
    scoreB2: number,
    target: number,
    actorId: string
  ): Promise<void> {
    const { error } = await this.supabase.rpc('set_mini_match_score', {
      p_actor_id: actorId,
      p_match_id: matchId,
      p_score_a2: scoreA2,
      p_score_b2: scoreB2,
      p_mini_match_target: target,
    });
    if (error) throw error;
  }

  async getPlayerStats(playerId: string, seasonId?: string | null): Promise<PlayerStats> {
    const { data, error } = await this.supabase.rpc('get_player_stats', {
      p_player_id: playerId,
      p_season_id: seasonId ?? null,
    });
    if (error) throw error;
    return (data as unknown as PlayerStats) ?? { played: 0, wins: 0, losses: 0, draws: 0, goals: 0, assists: 0 };
  }

  async getPlayerHistory(playerId: string, seasonId?: string | null): Promise<MatchHistoryEntry[]> {
    const { data, error } = await this.supabase.rpc('get_player_history', {
      p_player_id: playerId,
      p_season_id: seasonId ?? null,
    });
    if (error) throw error;
    return (data as unknown as MatchHistoryEntry[]) ?? [];
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
