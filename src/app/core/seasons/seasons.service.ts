import { Injectable, inject } from '@angular/core';
import { SupabaseService } from '../supabase/supabase.service';
import { Season } from '../../shared/models/season.model';

@Injectable({ providedIn: 'root' })
export class SeasonsService {
  private readonly supabase = inject(SupabaseService).client;

  async getSeasons(groupId: string): Promise<Season[]> {
    const { data, error } = await this.supabase
      .from('seasons')
      .select('*')
      .eq('group_id', groupId)
      .order('started_at', { ascending: false });

    if (error) throw error;
    return data ?? [];
  }

  async getCurrentSeason(groupId: string): Promise<Season | null> {
    const { data, error } = await this.supabase
      .from('seasons')
      .select('*')
      .eq('group_id', groupId)
      .is('ended_at', null)
      .maybeSingle();

    if (error) throw error;
    return data;
  }

  async startNewSeason(groupId: string, actorId: string, name?: string): Promise<Season> {
    const { data, error } = await this.supabase.rpc('start_new_season', {
      p_actor_id: actorId,
      p_group_id: groupId,
      p_name: name?.trim() || null,
    });
    if (error) throw error;
    return data as unknown as Season;
  }
}
