import { Injectable, inject } from '@angular/core';
import { SupabaseService } from '../supabase/supabase.service';
import { Group } from '../../shared/models/group.model';

@Injectable({ providedIn: 'root' })
export class GroupsService {
  private readonly supabase = inject(SupabaseService).client;

  async getGroup(groupId: string): Promise<Group> {
    const { data, error } = await this.supabase
      .from('groups')
      .select('*')
      .eq('id', groupId)
      .single();

    if (error) throw error;
    return data;
  }

  async updateGuestSettings(
    groupId: string,
    actorId: string,
    guestsEnabled: boolean,
    maxGuestsPerPlayer: number | null
  ): Promise<void> {
    const { error } = await this.supabase.rpc('set_group_guest_settings', {
      p_group_id: groupId,
      p_actor_id: actorId,
      p_guests_enabled: guestsEnabled,
      p_max_guests_per_player: maxGuestsPerPlayer,
    });
    if (error) throw error;
  }
}
