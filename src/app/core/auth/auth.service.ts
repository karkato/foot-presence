import { Injectable, inject, signal, computed } from '@angular/core';
import { SupabaseService } from '../supabase/supabase.service';
import { Player, getDisplayName } from '../../shared/models/player.model';

@Injectable({ providedIn: 'root' })
export class AuthService {
  private readonly supabase = inject(SupabaseService).client;

  currentPlayer = signal<Player | null>(
    JSON.parse(localStorage.getItem('fp_player') ?? 'null')
  );
  currentGroupSlug = signal<string | null>(
    localStorage.getItem('fp_group_slug')
  );

  isAdmin = computed(() => this.currentPlayer()?.is_admin ?? false);
  isLoggedIn = computed(() => this.currentPlayer() !== null);
  displayName = computed(() => {
    const p = this.currentPlayer();
    return p ? getDisplayName(p) : '';
  });

  async login(groupSlug: string, username: string, pin: string): Promise<Player> {
    const { data: group, error: groupError } = await this.supabase
      .from('groups')
      .select('id')
      .eq('slug', groupSlug)
      .single();

    if (groupError || !group) throw new Error('Groupe introuvable');

    const { data: player, error } = await this.supabase.rpc('login_player', {
      p_username: username.trim().toLowerCase(),
      p_pin: pin,
      p_group_id: group.id,
    });

    if (error || !player) throw new Error('Pseudo ou PIN incorrect');

    const playerData = player as unknown as Player;
    this.currentPlayer.set(playerData);
    this.currentGroupSlug.set(groupSlug);
    localStorage.setItem('fp_player', JSON.stringify(playerData));
    localStorage.setItem('fp_group_slug', groupSlug);

    return playerData;
  }

  logout(): void {
    this.currentPlayer.set(null);
    this.currentGroupSlug.set(null);
    localStorage.removeItem('fp_player');
    localStorage.removeItem('fp_group_slug');
  }

  updateCurrentPlayer(updates: Partial<Player>): void {
    const current = this.currentPlayer();
    if (!current) return;
    const updated = { ...current, ...updates };
    this.currentPlayer.set(updated);
    localStorage.setItem('fp_player', JSON.stringify(updated));
  }
}
