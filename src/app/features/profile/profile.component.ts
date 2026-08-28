import { ChangeDetectionStrategy, Component, computed, inject, OnInit, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { AuthService } from '../../core/auth/auth.service';
import { SupabaseService } from '../../core/supabase/supabase.service';
import { SeasonsService } from '../../core/seasons/seasons.service';
import { MatchesService, MatchHistoryEntry, PlayerStats } from '../matches/matches.service';
import { Player, getDisplayName } from '../../shared/models/player.model';
import { Season, isCurrentSeason } from '../../shared/models/season.model';
import { mapAuthRpcError } from '../../shared/utils/rpc-error';
import { SeasonPickerComponent } from '../../shared/components/season-picker/season-picker.component';
import { TabBarComponent, TabItem } from '../../shared/components/tab-bar/tab-bar.component';
import { MyStatsComponent } from './my-stats/my-stats.component';

type ProfileTab = 'stats' | 'goals' | 'players' | 'config';

@Component({
  selector: 'app-profile',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, RouterLink, SeasonPickerComponent, TabBarComponent, MyStatsComponent],
  template: `
    <div class="container-form">
      <h2>Mon profil</h2>

      @if (auth.currentPlayer(); as player) {

        <!-- Tabs -->
        <app-tab-bar
          [tabs]="profileTabs"
          [selected]="activeTab()"
          (selectedChange)="activeTab.set($event)"
          ariaLabel="Sections du profil"
        />

        @if (activeTab() === 'stats' || activeTab() === 'goals') {
          <app-season-picker
            [seasons]="seasons()"
            [selectedSeasonId]="selectedSeasonId()"
            (seasonChange)="onSeasonChange($event)"
          />
        }

        <!-- Tab Stats -->
        @if (activeTab() === 'stats') {
          <div id="panel-stats" role="tabpanel" aria-labelledby="tab-stats">

            <!-- Stats -->
            <div class="card stats-card">
              @if (stats() && stats()!.played > 0) {
                <div class="stats-grid">
                  <div class="stat-block">
                    <span class="stat-value">{{ stats()!.played }}</span>
                    <span class="stat-label">Matchs</span>
                  </div>
                  <div class="stat-block win">
                    <span class="stat-value">{{ stats()!.wins }}</span>
                    <span class="stat-label">Victoires</span>
                  </div>
                  <div class="stat-block loss">
                    <span class="stat-value">{{ stats()!.losses }}</span>
                    <span class="stat-label">Défaites</span>
                  </div>
                  <div class="stat-block draw">
                    <span class="stat-value">{{ stats()!.draws }}</span>
                    <span class="stat-label">Nuls</span>
                  </div>
                  <div class="stat-block goals">
                    <span class="stat-value">{{ stats()!.goals }}</span>
                    <span class="stat-label">Buts</span>
                  </div>
                  <div class="stat-block assists">
                    <span class="stat-value">{{ stats()!.assists }}</span>
                    <span class="stat-label">Passes</span>
                  </div>
                </div>
                <div class="ratio-row">
                  <span class="ratio-label">Taux de victoire</span>
                  <span class="ratio-value">{{ winRatio() }}%</span>
                </div>
              } @else {
                <p class="muted">Aucun match joué pour cette saison.</p>
              }
            </div>

            <!-- Derniers matchs -->
            @if (recentHistory().length > 0) {
              <p class="section-label">Derniers matchs</p>
              <div class="recent-list">
                @for (entry of recentHistory(); track entry.id) {
                  <a class="mini-card card" [routerLink]="['/' + groupSlug() + '/match/' + entry.id]">
                    <div class="mini-info">
                      <span class="mini-title">{{ entry.title }}</span>
                      <span class="mini-date">{{ formatDate(entry.match_date) }}</span>
                    </div>
                    @if (entry.score_a !== null && entry.score_b !== null) {
                      <span class="mini-score">{{ entry.score_a }} – {{ entry.score_b }}</span>
                    }
                    <span class="result-badge" [class]="'result-' + (entry.result ?? 'none')">
                      {{ resultLabel(entry.result) }}
                    </span>
                  </a>
                }
              </div>
              <a class="btn-history" [routerLink]="['/' + groupSlug() + '/history']">Voir mon historique complet →</a>
            }

          </div>
        }

        <!-- Tab Buts -->
        @if (activeTab() === 'goals') {
          <div id="panel-goals" role="tabpanel" aria-labelledby="tab-goals">
            @defer (on viewport) {
              <app-my-stats [seasonId]="selectedSeasonId()" />
            } @placeholder {
              <p class="muted">Chargement...</p>
            }
          </div>
        }

        <!-- Tab Config -->
        @if (activeTab() === 'config') {
          <div id="panel-config" role="tabpanel" aria-labelledby="tab-config">

            <!-- Pseudo affiché -->
            <div class="card section">
              <h3 class="section-label">Pseudo affiché</h3>
              <div class="input-row">
                <input type="text" class="field-input" [(ngModel)]="newDisplayName"
                  [placeholder]="player.username" maxlength="30" />
                <button class="btn btn-primary" (click)="saveDisplayName()" [disabled]="saving()">
                  @if (saving()) { ... } @else { OK }
                </button>
              </div>
              @if (displayNameFeedback()) {
                <p class="feedback-success">{{ displayNameFeedback() }}</p>
              }
            </div>

            <!-- Changer PIN -->
            <div class="card section">
              <h3 class="section-label">Changer mon PIN</h3>
              <div class="pin-row">
                <div class="field">
                  <label>Nouveau PIN</label>
                  <input type="password" class="field-input" [(ngModel)]="newPin" inputmode="numeric" maxlength="6" />
                </div>
                <div class="field">
                  <label>Confirmer</label>
                  <input type="password" class="field-input" [(ngModel)]="confirmPin" inputmode="numeric" maxlength="6" />
                </div>
              </div>
              @if (pinError()) { <p class="feedback-error">{{ pinError() }}</p> }
              @if (pinFeedback()) { <p class="feedback-success">{{ pinFeedback() }}</p> }
              <button class="btn btn-primary" (click)="savePin()" [disabled]="savingPin() || !newPin || !confirmPin">
                @if (savingPin()) { ... } @else { Confirmer }
              </button>
            </div>

            <!-- Session -->
            <div class="card section">
              <h3 class="section-label">Session</h3>
              <button class="btn btn-danger btn-full" (click)="logout()">Se déconnecter</button>
            </div>
          </div>
        }

        <!-- Tab Joueurs -->
        @if (activeTab() === 'players') {
          <div id="panel-players" role="tabpanel" aria-labelledby="tab-players" class="card section">
            @if (loadingPlayers()) {
              <p class="muted">Chargement...</p>
            } @else {
              <ul class="player-list">
                @for (p of groupPlayers(); track p.id) {
                  <li class="player-row" [class.current-player]="p.id === player.id">
                    <span class="player-name">{{ displayName(p) }}</span>
                    <div class="player-badges">
                      @if (p.id === player.id) {
                        <span class="badge badge-primary">toi</span>
                      }
                      @if (p.is_admin) {
                        <span class="badge badge-warning">admin</span>
                      }
                    </div>
                  </li>
                }
              </ul>
            }
          </div>
        }
      }
    </div>
  `,
  styles: `
    h2 { margin-top: 0; }
    .muted { font-size: 0.9rem; }
    .card { border: var(--border-1); }
    .section { padding: 1.25rem; margin-bottom: 1rem; }
    .section-label { margin: 0 0 0.6rem; }

    /* Stats */
    .stats-card { padding: 1.25rem; margin-bottom: 1rem; display: flex; flex-direction: column; gap: 1rem; }
    .stats-grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 0.5rem; }
    .stat-block { display: flex; flex-direction: column; align-items: center; gap: 0.2rem; padding: 0.75rem 0.5rem; background: var(--bg); border-radius: 0.5rem; }
    .stat-value { font-size: 1.5rem; font-weight: 900; line-height: 1; }
    .stat-label { font-size: 0.7rem; font-weight: 600; color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.05em; }
    .stat-block.win .stat-value { color: var(--success); }
    .stat-block.loss .stat-value { color: var(--danger); }
    .stat-block.draw .stat-value { color: var(--text-muted); }
    .stat-block.goals .stat-value { color: var(--primary); }
    .stat-block.assists .stat-value { color: var(--warning); }
    .ratio-row { display: flex; align-items: center; justify-content: space-between; }
    .ratio-label { font-size: 0.85rem; color: var(--text-muted); }
    .ratio-value { font-size: 1.1rem; font-weight: 800; color: var(--primary); }
    /* Recent matches */
    .recent-list { display: flex; flex-direction: column; gap: 0.5rem; margin-bottom: 0.75rem; }
    .mini-card {
      display: flex; align-items: center; gap: 0.75rem;
      padding: 0.75rem 1rem; text-decoration: none; color: var(--text);
      transition: border-color 0.15s;
    }
    .mini-card:hover { border-color: var(--primary); }
    .mini-info { display: flex; flex-direction: column; gap: 0.1rem; flex: 1; min-width: 0; }
    .mini-title { font-size: 0.875rem; font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .mini-date { font-size: 0.75rem; color: var(--text-muted); }
    .mini-score { font-size: 0.95rem; font-weight: 700; flex-shrink: 0; }
    .result-badge { font-size: 0.85rem; font-weight: 700; padding: 0.25rem 0.65rem; border-radius: 0.4rem; flex-shrink: 0; }
    .result-win { background: color-mix(in srgb, var(--success) 15%, transparent); color: var(--success); }
    .result-loss { background: color-mix(in srgb, var(--danger) 15%, transparent); color: var(--danger); }
    .result-draw, .result-none { background: var(--border); color: var(--text-muted); }
    .btn-history { display: block; text-align: center; padding: 0.65rem; background: var(--card); border: var(--border-1); border-radius: 0.75rem; font-size: 0.875rem; font-weight: 600; color: var(--primary); text-decoration: none; margin-bottom: 1rem; transition: border-color 0.15s; }
    .btn-history:hover { border-color: var(--primary); }

    /* Form inputs */
    .field { display: flex; flex-direction: column; gap: 0.35rem; flex: 1; min-width: 0; }
    .field label { font-size: 0.8rem; font-weight: 600; color: var(--text-muted); }
    .field-input { padding: 0.65rem 0.85rem; border: var(--border-1); border-radius: 0.5rem; font-size: var(--fs-field); background: var(--card); color: var(--text); font-family: inherit; width: 100%; box-sizing: border-box; }
    .field-input:focus { outline: none; border-color: var(--primary); }
    .input-row { display: flex; gap: 0.5rem; align-items: center; }
    .input-row .field-input { flex: 1; min-width: 0; }
    .pin-row { display: flex; gap: 0.75rem; margin-bottom: 0.75rem; }
    .feedback-success { color: var(--success); font-size: 0.85rem; margin: 0.4rem 0 0; }
    .feedback-error { color: var(--danger); font-size: 0.85rem; margin: 0 0 0.5rem; }

    /* Buttons */
    .btn-primary { padding: 0.65rem 1.25rem; white-space: nowrap; }
    .btn-danger { padding: 0.65rem 1.25rem; }

    /* Players list */
    .player-list { list-style: none; padding: 0; margin: 0; display: flex; flex-direction: column; gap: 0.1rem; }
    .player-row { display: flex; align-items: center; padding: 0.5rem 0.5rem; border-radius: 0.4rem; }
    .player-row.current-player { background: var(--primary-light); font-weight: 700; }
    .player-name { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 0.9rem; }
    .player-badges { display: flex; gap: 0.35rem; flex-shrink: 0; }
    .badge { font-size: 0.7rem; font-weight: 700; padding: 0.1rem 0.45rem; border-radius: 0.3rem; }
    .badge-primary { background: var(--primary); color: white; }
    .badge-warning { background: var(--warning); color: white; }

    @media (min-width: 480px) {
      .stats-grid { grid-template-columns: repeat(3, 1fr); }
    }
  `,
})
export class ProfileComponent implements OnInit {
  readonly auth = inject(AuthService);
  private readonly supabase = inject(SupabaseService).client;
  private readonly matchesService = inject(MatchesService);
  private readonly seasonsService = inject(SeasonsService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);

  newDisplayName = '';
  newPin = '';
  confirmPin = '';

  readonly profileTabs: readonly TabItem<ProfileTab>[] = [
    { value: 'stats', label: 'Stats', panelId: 'panel-stats' },
    { value: 'goals', label: 'Buts', panelId: 'panel-goals' },
    { value: 'players', label: 'Joueurs', panelId: 'panel-players' },
    { value: 'config', label: 'Config', panelId: 'panel-config' },
  ];

  activeTab = signal<ProfileTab>('stats');
  seasons = signal<Season[]>([]);
  selectedSeasonId = signal<string | null>(null);

  saving = signal(false);
  savingPin = signal(false);
  displayNameFeedback = signal('');
  pinFeedback = signal('');
  pinError = signal('');
  groupPlayers = signal<Player[]>([]);
  loadingPlayers = signal(true);
  stats = signal<PlayerStats | null>(null);
  recentHistory = signal<MatchHistoryEntry[]>([]);

  groupSlug = computed(() => this.route.snapshot.params['groupSlug'] as string);
  winRatio = computed(() => {
    const s = this.stats();
    if (!s || s.played === 0) return 0;
    return Math.round((s.wins / s.played) * 100);
  });

  ngOnInit(): void {
    const player = this.auth.currentPlayer();
    if (player) {
      this.newDisplayName = player.display_name ?? '';
      this.loadPlayers(player.group_id);
      this.loadSeasons(player.group_id, player.id);
    }
  }

  private async loadSeasons(groupId: string, playerId: string): Promise<void> {
    try {
      const seasons = await this.seasonsService.getSeasons(groupId);
      this.seasons.set(seasons);
      const current = seasons.find(isCurrentSeason);
      this.selectedSeasonId.set(current?.id ?? seasons[0]?.id ?? null);
    } catch { /* non critique */ }
    this.loadStats(playerId);
    this.loadRecentHistory(playerId);
  }

  onSeasonChange(seasonId: string): void {
    this.selectedSeasonId.set(seasonId);
    const player = this.auth.currentPlayer();
    if (!player) return;
    this.loadStats(player.id);
    this.loadRecentHistory(player.id);
  }

  displayName(player: Player): string { return getDisplayName(player); }

  private async loadPlayers(groupId: string): Promise<void> {
    const { data } = await this.supabase
      .from('players').select('id, group_id, username, display_name, is_admin, created_at')
      .eq('group_id', groupId).order('username');
    this.groupPlayers.set(data ?? []);
    this.loadingPlayers.set(false);
  }

  private async loadStats(playerId: string): Promise<void> {
    try { this.stats.set(await this.matchesService.getPlayerStats(playerId, this.selectedSeasonId())); } catch { /* non critique */ }
  }

  private async loadRecentHistory(playerId: string): Promise<void> {
    try {
      const history = await this.matchesService.getPlayerHistory(playerId, this.selectedSeasonId());
      this.recentHistory.set(history.slice(0, 3));
    } catch { /* non critique */ }
  }

  logout(): void {
    this.auth.logout();
    void this.router.navigate(['/']);
  }

  resultLabel(result: 'win' | 'loss' | 'draw' | null): string {
    if (result === 'win') return 'V';
    if (result === 'loss') return 'D';
    if (result === 'draw') return 'N';
    return '—';
  }

  formatDate(dateStr: string): string {
    return new Date(dateStr).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' });
  }

  async saveDisplayName(): Promise<void> {
    const player = this.auth.currentPlayer();
    if (!player) return;
    this.saving.set(true);
    this.displayNameFeedback.set('');
    try {
      const { error } = await this.supabase.rpc('update_player_profile', {
        p_player_id: player.id,
        p_display_name: this.newDisplayName.trim() || null,
        p_actor_id: player.id,
      });
      if (error) throw error;
      this.auth.updateCurrentPlayer({ display_name: this.newDisplayName.trim() || null });
      this.displayNameFeedback.set('Pseudo mis à jour !');
      setTimeout(() => this.displayNameFeedback.set(''), 2500);
    } catch (err) {
      this.displayNameFeedback.set(mapAuthRpcError(err, 'Erreur lors de la sauvegarde'));
    } finally {
      this.saving.set(false);
    }
  }

  async savePin(): Promise<void> {
    this.pinError.set('');
    if (this.newPin.length < 4) { this.pinError.set('PIN de 4 chiffres minimum'); return; }
    if (this.newPin !== this.confirmPin) { this.pinError.set('Les PINs ne correspondent pas'); return; }
    const player = this.auth.currentPlayer();
    if (!player) return;
    this.savingPin.set(true);
    try {
      const { error } = await this.supabase.rpc('update_player_profile', {
        p_player_id: player.id,
        p_new_pin: this.newPin,
        p_actor_id: player.id,
      });
      if (error) throw error;
      this.newPin = '';
      this.confirmPin = '';
      this.pinFeedback.set('PIN mis à jour !');
      setTimeout(() => this.pinFeedback.set(''), 2500);
    } catch (err) {
      this.pinError.set(mapAuthRpcError(err, 'Erreur lors de la mise à jour du PIN'));
    } finally {
      this.savingPin.set(false);
    }
  }
}
