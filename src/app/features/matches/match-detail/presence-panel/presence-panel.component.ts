import { ChangeDetectionStrategy, Component, computed, inject, input, output, signal } from '@angular/core';
import { AuthService } from '../../../../core/auth/auth.service';
import { MatchesService } from '../../matches.service';
import { Player, getDisplayName } from '../../../../shared/models/player.model';
import { Registration } from '../../../../shared/models/registration.model';
import { mapAuthRpcError, rpcMessage } from '../../../../shared/utils/rpc-error';
import { confirmTeamReassignment } from '../../../../shared/utils/team-assignment';
import { TEAM_A_COLOR, TEAM_B_COLOR } from '../../../../shared/constants/team-config';

@Component({
  selector: 'app-presence-panel',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="card admin-section">
      <button class="presence-toggle" (click)="showPanel.set(!showPanel())">
        <span class="section-label" style="margin:0">Gérer les présences</span>
        <div class="presence-toggle-right">
          <span class="presence-count">{{ presentCount() }}/{{ maxPlayers() }}</span>
          <span class="toggle-icon">{{ showPanel() ? '▲' : '▼' }}</span>
        </div>
      </button>
      @if (showPanel()) {
        <ul class="admin-player-list">
          @for (player of sortedPlayers(); track player.id) {
            @let present = isPlayerPresent(player.id);
            @let team = getPlayerTeam(player.id);
            <li class="admin-player-row" [class.is-present]="present">
              <label class="admin-player-check">
                <input type="checkbox" [checked]="present" (change)="adminToggle(player.id)" />
                <span class="player-name">{{ getDisplayName(player) }}</span>
              </label>
              @if (present) {
                <div class="admin-player-controls">
                  <div class="plus-ones-mini">
                    <button class="btn-mini" (click)="adminAdjustPlusOnes(player.id, -1)"
                      [disabled]="getPlayerPlusOnes(player.id) === 0">−</button>
                    <span class="plus-ones-mini-count">+{{ getPlayerPlusOnes(player.id) }}</span>
                    <button class="btn-mini" (click)="adminAdjustPlusOnes(player.id, 1)">+</button>
                  </div>
                  <div class="team-btns">
                    <button class="team-btn team-btn-a" [class.active]="team === 0"
                      (click)="adminSetTeam(player.id, 0)">A</button>
                    <button class="team-btn team-btn-b" [class.active]="team === 1"
                      (click)="adminSetTeam(player.id, 1)">B</button>
                  </div>
                </div>
              }
            </li>
          }
        </ul>
      }
      @if (actionError()) {
        <p class="feedback-error">{{ actionError() }}</p>
      }
    </div>
  `,
  styles: `
    .card { border: var(--border-1); padding: var(--sp-lg); }
    .admin-section { margin-top: 0.75rem; }
    .feedback-error { color: var(--danger); font-size: 0.85rem; text-align: center; margin: 0.5rem 0 0; }
    .presence-count { background: var(--primary); color: white; font-size: 0.75rem; font-weight: 700; padding: 0.15rem 0.6rem; border-radius: 1rem; }
    .presence-toggle { width: 100%; display: flex; align-items: center; justify-content: space-between; background: none; border: none; padding: 0; cursor: pointer; min-height: var(--tap); }
    .presence-toggle-right { display: flex; align-items: center; gap: 0.6rem; }
    .toggle-icon { font-size: 0.75rem; color: var(--text-muted); }
    .admin-player-list { list-style: none; padding: 0; margin: 0.75rem 0 0; display: flex; flex-direction: column; gap: 0.15rem; }
    .admin-player-row { display: flex; align-items: center; justify-content: space-between; padding: 0.6rem 0.5rem; border-radius: 0.5rem; transition: background 0.1s; flex-wrap: wrap; row-gap: var(--sp-sm); }
    .admin-player-row:hover { background: var(--bg); }
    .admin-player-row.is-present { background: var(--primary-light); }
    .admin-player-check { display: flex; align-items: center; gap: 0.6rem; cursor: pointer; flex: 1 1 auto; min-width: 0; min-height: var(--tap-compact); }
    .admin-player-check input[type="checkbox"] { width: 1.25rem; height: 1.25rem; cursor: pointer; accent-color: var(--primary); flex-shrink: 0; }
    .player-name { font-size: 0.95rem; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .admin-player-controls { display: flex; align-items: center; gap: 0.6rem; flex-wrap: wrap; justify-content: flex-end; flex-basis: 100%; }
    .plus-ones-mini { display: flex; align-items: center; gap: 0.3rem; }
    .plus-ones-mini-count { font-size: 0.8rem; font-weight: 700; min-width: 1.75rem; text-align: center; color: var(--text-muted); }
    .btn-mini { width: var(--tap-compact); height: var(--tap-compact); border-radius: 50%; border: var(--border-1); background: var(--card); cursor: pointer; font-size: 0.9rem; display: flex; align-items: center; justify-content: center; font-family: inherit; line-height: 1; padding: 0; color: var(--text); }
    .btn-mini:disabled { opacity: 0.35; cursor: not-allowed; }
    .team-btns { display: flex; gap: 0.4rem; }
    .team-btn { padding: 0.2rem 0.65rem; border: var(--border-1); border-radius: 0.35rem; font-size: 0.8rem; font-weight: 700; cursor: pointer; background: transparent; color: var(--text-muted); font-family: inherit; transition: all 0.1s; min-height: var(--tap-compact); }
    .team-btn-a.active { background: ${TEAM_A_COLOR}; color: white; border-color: ${TEAM_A_COLOR}; }
    .team-btn-b.active { background: ${TEAM_B_COLOR}; color: white; border-color: ${TEAM_B_COLOR}; }

    @media (min-width: 768px) {
      .admin-player-controls { flex-basis: auto; }
    }
  `,
})
export class PresencePanelComponent {
  private readonly auth = inject(AuthService);
  private readonly matchesService = inject(MatchesService);

  matchId = input.required<string>();
  players = input.required<Player[]>();
  registrations = input.required<Registration[]>();
  maxPlayers = input.required<number>();
  maxGuests = input.required<number | null>();

  registrationsChanged = output<void>();

  readonly getDisplayName = getDisplayName;

  showPanel = signal(false);
  actionError = signal('');

  presentCount = computed(() =>
    this.registrations().filter(r => !r.is_withdrawn).reduce((sum, r) => sum + 1 + (r.plus_ones ?? 0), 0)
  );

  sortedPlayers = computed(() => {
    const presentIds = new Set(this.registrations().filter(r => !r.is_withdrawn).map(r => r.player_id));
    return [...this.players()].sort((a, b) => {
      const diff = (presentIds.has(a.id) ? 0 : 1) - (presentIds.has(b.id) ? 0 : 1);
      return diff !== 0 ? diff : a.username.localeCompare(b.username);
    });
  });

  isPlayerPresent(playerId: string): boolean {
    return this.registrations().some(r => r.player_id === playerId && !r.is_withdrawn);
  }

  getPlayerTeam(playerId: string): number | null {
    return this.registrations().find(r => r.player_id === playerId && !r.is_withdrawn)?.team ?? null;
  }

  getPlayerPlusOnes(playerId: string): number {
    return this.registrations().find(r => r.player_id === playerId && !r.is_withdrawn)?.plus_ones ?? 0;
  }

  async adminAdjustPlusOnes(playerId: string, delta: number): Promise<void> {
    const admin = this.auth.currentPlayer();
    if (!admin) return;
    const newCount = Math.max(0, this.getPlayerPlusOnes(playerId) + delta);
    this.actionError.set('');
    try {
      await this.matchesService.setPlusOnes(this.matchId(), playerId, newCount, admin.id);
      this.registrationsChanged.emit();
    } catch (err) {
      this.actionError.set(this.mapPlusOnesError(err));
    }
  }

  async adminToggle(playerId: string): Promise<void> {
    const admin = this.auth.currentPlayer();
    if (!admin) return;
    try {
      if (this.isPlayerPresent(playerId)) {
        await this.matchesService.adminRemoveRegistration(admin.id, this.matchId(), playerId);
      } else {
        await this.matchesService.registerPlayer(this.matchId(), playerId, admin.id);
      }
      this.registrationsChanged.emit();
    } catch { /* silently fail */ }
  }

  async adminSetTeam(playerId: string, team: number): Promise<void> {
    const admin = this.auth.currentPlayer();
    if (!admin) return;
    const currentTeam = this.getPlayerTeam(playerId);
    if (currentTeam === team) return;
    const reg = this.registrations().find(r => r.player_id === playerId && !r.is_withdrawn);
    if (reg && !confirmTeamReassignment(reg)) return;
    this.actionError.set('');
    try {
      await this.matchesService.assignTeam(this.matchId(), playerId, team, admin.id);
      this.registrationsChanged.emit();
    } catch (err) {
      this.actionError.set(mapAuthRpcError(err, "Impossible de modifier l'équipe"));
      this.registrationsChanged.emit();
    }
  }

  private mapPlusOnesError(err: unknown): string {
    const message = rpcMessage(err);
    if (message.includes('guests_disabled')) return 'Les invités sont désactivés pour ce groupe';
    if (message.includes('guest_limit_exceeded')) {
      const max = this.maxGuests();
      return max !== null ? `Limite de ${max} invité(s) par joueur atteinte` : 'Limite d\'invités atteinte';
    }
    if (message.includes('not_allowed')) return 'Action non autorisée';
    return 'Erreur lors de la mise à jour';
  }
}
