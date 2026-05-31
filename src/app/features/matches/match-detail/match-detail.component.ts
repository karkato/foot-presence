import {
  ChangeDetectionStrategy, Component, computed, inject, OnDestroy, OnInit, signal,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { RealtimeChannel } from '@supabase/supabase-js';
import { AuthService } from '../../../core/auth/auth.service';
import { SupabaseService } from '../../../core/supabase/supabase.service';
import { MatchesService } from '../matches.service';
import { Match } from '../../../shared/models/match.model';
import { Registration } from '../../../shared/models/registration.model';
import { Player, getDisplayName } from '../../../shared/models/player.model';
import { PlayerRowComponent } from './player-row/player-row.component';
import { RegistrationModalComponent } from './registration-modal/registration-modal.component';

type PresentEntry =
  | { type: 'player'; reg: Registration; rank: number }
  | { type: 'guest'; hostName: string; rank: number };

@Component({
  selector: 'app-match-detail',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [PlayerRowComponent, RegistrationModalComponent, FormsModule],
  template: `
    @if (loading()) {
      <div class="center-msg">Chargement...</div>
    } @else if (!match()) {
      <div class="center-msg">Match introuvable.</div>
    } @else {
      <div class="container">

        <!-- En-tête -->
        <div class="header">
          <div class="header-top">
            <h2>{{ match()!.title }}</h2>
            @if (match()!.score_a !== null) {
              <span class="badge-finished">Terminé</span>
            } @else if (match()!.is_closed) {
              <span class="badge-closed">Fermé</span>
            }
          </div>
          <p class="match-meta">
            {{ formatDate(match()!.match_date) }} à {{ formatTime(match()!.match_time) }}
            &nbsp;·&nbsp;
            <strong [class.text-danger]="isFull()">{{ presentCount() }}/{{ match()!.max_players }}</strong>
          </p>
          <div class="action-row">
            <button class="btn-stroked" (click)="copyMatchLink()">Copier lien</button>
            <button class="btn-stroked" (click)="shareList()">Copier liste</button>
          </div>
          @if (copyFeedback()) {
            <p class="feedback-success">{{ copyFeedback() }}</p>
          }
        </div>

        <!-- Score affiché si existant -->
        @if (match()!.score_a !== null && match()!.score_b !== null) {
          <div class="score-display card">
            <div class="score-team">
              <span class="score-name">{{ match()!.team_a_name }}</span>
              <span class="score-value">{{ match()!.score_a }}</span>
            </div>
            <span class="score-sep">–</span>
            <div class="score-team">
              <span class="score-name">{{ match()!.team_b_name }}</span>
              <span class="score-value">{{ match()!.score_b }}</span>
            </div>
          </div>
          @if (match()!.score_a2 !== null && match()!.score_b2 !== null) {
            <div class="mini-match-display card">
              <span class="mini-match-label">Mini-match (premier à {{ match()!.mini_match_target }})</span>
              <div class="mini-match-score">
                <span class="mini-score-name">{{ match()!.team_a_name }}</span>
                <span class="mini-score-value">{{ match()!.score_a2 }} – {{ match()!.score_b2 }}</span>
                <span class="mini-score-name">{{ match()!.team_b_name }}</span>
              </div>
            </div>
          }
        }

        <!-- Présents -->
        <div class="card mb-sm">
          <h3 class="section-label">Présents ({{ presentCount() }})</h3>
          @if (presentPlayers().length === 0) {
            <p class="muted">Personne pour l'instant.</p>
          } @else {
            <ul class="player-list">
              @for (entry of starters(); track entry.rank) {
                @if (entry.type === 'player') {
                  <app-player-row [reg]="entry.reg" [rank]="entry.rank" [prefix]="String(entry.rank) + '.'"
                    [isCurrent]="isCurrentPlayer(entry.reg)" [canWithdraw]="canWithdraw(entry.reg)"
                    [team]="entry.reg.team" (withdraw)="onWithdraw($event)" />
                } @else {
                  <li class="guest-row">
                    <span class="rank-label">{{ entry.rank }}.</span>
                    <span class="muted italic">+1 de {{ entry.hostName }}</span>
                  </li>
                }
              }
            </ul>
            @if (substitutes().length > 0) {
              <div class="sub-divider">
                <div class="divider-line"></div>
                <span>Remplaçants ({{ substitutes().length }})</span>
                <div class="divider-line"></div>
              </div>
              <ul class="player-list">
                @for (entry of substitutes(); track entry.rank) {
                  @if (entry.type === 'player') {
                    <app-player-row [reg]="entry.reg" [rank]="entry.rank" [prefix]="String(entry.rank) + '.'"
                      [isCurrent]="isCurrentPlayer(entry.reg)" [canWithdraw]="canWithdraw(entry.reg)"
                      [team]="entry.reg.team" (withdraw)="onWithdraw($event)" />
                  } @else {
                    <li class="guest-row">
                      <span class="rank-label">{{ entry.rank }}.</span>
                      <span class="muted italic">+1 de {{ entry.hostName }}</span>
                    </li>
                  }
                }
              </ul>
            }
          }
        </div>

        <!-- Désistements -->
        @if (withdrawnPlayers().length > 0) {
          <div class="card mb-sm withdrawn-card">
            <h3 class="section-label">Désistements ({{ withdrawnPlayers().length }})</h3>
            <ul class="player-list">
              @for (reg of withdrawnPlayers(); track reg.id; let i = $index) {
                <app-player-row [reg]="reg" [rank]="i + 1" [prefix]="'D' + (i + 1) + '.'"
                  [isCurrent]="isCurrentPlayer(reg)" [canWithdraw]="false"
                  [canDelete]="isAdmin()" (delete)="onDeleteRegistration($event)" />
              }
            </ul>
          </div>
        }

        <!-- Actions joueur -->
        @if (!match()!.is_closed && !isFinished()) {
          <div class="player-actions">
            @if (!isRegistered()) {
              <button class="btn-primary btn-full" (click)="onRegister()" [disabled]="actionLoading()">Je viens</button>
            } @else if (!isWithdrawn()) {
              <button class="btn-danger btn-full" (click)="onWithdraw(currentPlayerId())" [disabled]="actionLoading()">Je me retire</button>
            } @else {
              <button class="btn-primary btn-full" (click)="onRegister()" [disabled]="actionLoading()">Je reviens</button>
            }
            @if (isRegistered() && !isWithdrawn()) {
              <div class="proxy-row">
                @if (canAddProxy()) {
                  <button class="btn-stroked proxy-btn" (click)="showModal.set(true)">
                    + Inscrire quelqu'un ({{ proxyCount() }}/2)
                  </button>
                }
                <div class="plus-ones-row card">
                  <span class="plus-ones-label">Invités</span>
                  <div class="plus-ones-controls">
                    <button class="btn-icon" (click)="onAdjustPlusOnes(-1)" [disabled]="myPlusOnes() === 0 || actionLoading()">−</button>
                    <span class="plus-ones-count">{{ myPlusOnes() }}</span>
                    <button class="btn-icon" (click)="onAdjustPlusOnes(1)" [disabled]="actionLoading()">+</button>
                  </div>
                </div>
              </div>
            }
          </div>
          @if (actionError()) {
            <p class="feedback-error">{{ actionError() }}</p>
          }
        }

        <!-- Admin : figer/rouvrir -->
        @if (isAdmin() && !isFinished()) {
          <div class="admin-row">
            @if (!match()!.is_closed) {
              <button class="btn-stroked btn-full" (click)="toggleClose()" [disabled]="actionLoading()">
                Figer la liste
              </button>
            } @else {
              <button class="btn-stroked btn-full" (click)="toggleClose()" [disabled]="actionLoading()">
                Rouvrir les inscriptions
              </button>
            }
          </div>
        }

        <!-- Admin : score -->
        @if (isAdmin()) {
          <div class="card admin-section">
            <h3 class="section-label">Score principal</h3>
            <div class="score-inputs">
              <div class="score-input-group">
                <label>{{ match()!.team_a_name }}</label>
                <input type="number" min="0" [(ngModel)]="scoreA" class="score-input" />
              </div>
              <span class="score-sep-sm">–</span>
              <div class="score-input-group">
                <label>{{ match()!.team_b_name }}</label>
                <input type="number" min="0" [(ngModel)]="scoreB" class="score-input" />
              </div>
              <button class="btn-primary" (click)="saveScore()" [disabled]="actionLoading()">
                Enregistrer
              </button>
            </div>
            @if (scoreFeedback()) {
              <p class="feedback-success">{{ scoreFeedback() }}</p>
            }

            <h3 class="section-label" style="margin-top:1rem">Mini-match</h3>
            <div class="score-inputs">
              <div class="score-input-group">
                <label>{{ match()!.team_a_name }}</label>
                <input type="number" min="0" [(ngModel)]="miniScoreA" class="score-input" />
              </div>
              <span class="score-sep-sm">–</span>
              <div class="score-input-group">
                <label>{{ match()!.team_b_name }}</label>
                <input type="number" min="0" [(ngModel)]="miniScoreB" class="score-input" />
              </div>
              <div class="score-input-group">
                <label>1er à</label>
                <select [(ngModel)]="miniTarget" class="score-input">
                  <option [ngValue]="3">3</option>
                  <option [ngValue]="5">5</option>
                  <option [ngValue]="7">7</option>
                </select>
              </div>
              <button class="btn-primary" (click)="saveMiniScore()" [disabled]="actionLoading()">
                Enregistrer
              </button>
            </div>
            @if (miniScoreFeedback()) {
              <p class="feedback-success">{{ miniScoreFeedback() }}</p>
            }
          </div>
        }

        <!-- Admin : panneau présences -->
        @if (isAdmin() && !isFinished()) {
          <div class="card admin-section">
            <button class="presence-toggle" (click)="showAdminPanel.set(!showAdminPanel())">
              <span class="section-label" style="margin:0">Gérer les présences</span>
              <div class="presence-toggle-right">
                <span class="presence-count">{{ presentCount() }}/{{ match()!.max_players }}</span>
                <span class="toggle-icon">{{ showAdminPanel() ? '▲' : '▼' }}</span>
              </div>
            </button>
            @if (showAdminPanel()) {
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
          </div>
        }
      </div>

      <!-- Modal procuration -->
      @if (showModal()) {
        <app-registration-modal
          [allPlayers]="allPlayers()"
          [registrations]="registrations()"
          (close)="showModal.set(false)"
          (register)="onRegisterProxy($event)"
        />
      }
    }
  `,
  styles: `
    .center-msg { display: flex; align-items: center; justify-content: center; min-height: 50vh; color: var(--text-muted); }
    .container { padding: 1rem; max-width: 600px; margin: 0 auto; }
    .card { background: var(--card); border: 1.5px solid var(--border); border-radius: 0.75rem; padding: 1rem; }
    .mb-sm { margin-bottom: 0.75rem; }
    .muted { color: var(--text-muted); }
    .italic { font-style: italic; }
    .text-danger { color: var(--danger); }

    /* Header */
    .header { margin-bottom: 1.25rem; }
    .header-top { display: flex; align-items: center; gap: 0.75rem; flex-wrap: wrap; margin-bottom: 0.25rem; }
    .header-top h2 { margin: 0; font-size: 1.2rem; }
    .badge-closed { font-size: 0.75rem; font-weight: 600; background: var(--border); color: var(--text-muted); padding: 0.2rem 0.6rem; border-radius: 1rem; }
    .badge-finished { font-size: 0.75rem; font-weight: 600; background: var(--success); color: white; padding: 0.2rem 0.6rem; border-radius: 1rem; }
    .match-meta { font-size: 0.85rem; color: var(--text-muted); margin: 0 0 0.75rem; }
    .action-row { display: flex; gap: 0.5rem; flex-wrap: wrap; }
    .feedback-success { color: var(--success); font-size: 0.85rem; margin: 0.4rem 0 0; }
    .feedback-error { color: var(--danger); font-size: 0.85rem; text-align: center; margin: 0.5rem 0 0; }

    /* Buttons */
    .btn-primary { padding: 0.65rem 1.25rem; background: var(--primary); color: white; border: none; border-radius: 0.5rem; font-size: 0.95rem; font-weight: 600; cursor: pointer; font-family: inherit; }
    .btn-primary:disabled { opacity: 0.6; cursor: not-allowed; }
    .btn-danger { padding: 0.65rem 1.25rem; background: var(--danger); color: white; border: none; border-radius: 0.5rem; font-size: 0.95rem; font-weight: 600; cursor: pointer; font-family: inherit; }
    .btn-danger:disabled { opacity: 0.6; cursor: not-allowed; }
    .btn-stroked { padding: 0.6rem 1.1rem; background: transparent; border: 1.5px solid var(--border); border-radius: 0.5rem; font-size: 0.9rem; font-weight: 500; cursor: pointer; color: var(--text); font-family: inherit; }
    .btn-stroked:hover { border-color: var(--primary); }
    .btn-full { width: 100%; }
    .btn-icon { width: 2rem; height: 2rem; border-radius: 50%; border: 1.5px solid var(--border); background: var(--card); color: var(--text); cursor: pointer; font-size: 1.1rem; display: flex; align-items: center; justify-content: center; font-family: inherit; }
    .btn-icon:disabled { opacity: 0.4; cursor: not-allowed; }
    .btn-close { background: none; border: none; font-size: 1rem; cursor: pointer; color: var(--text-muted); padding: 0.25rem; }

    /* Score display */
    .score-display { display: flex; align-items: center; justify-content: center; gap: 1.5rem; margin-bottom: 0.75rem; text-align: center; }
    .score-team { display: flex; flex-direction: column; align-items: center; gap: 0.15rem; }
    .score-name { font-size: 0.75rem; font-weight: 600; color: var(--text-muted); }
    .score-value { font-size: 2.25rem; font-weight: 900; line-height: 1; }
    .score-sep { font-size: 1.5rem; font-weight: 700; color: var(--text-muted); }

    /* Player list */
    .section-label { font-size: 0.75rem; font-weight: 700; text-transform: uppercase; letter-spacing: 0.08em; color: var(--text-muted); margin: 0 0 0.75rem; }
    .player-list { list-style: none; padding: 0; margin: 0; }
    .guest-row { display: flex; align-items: center; gap: 0.6rem; padding: 0.55rem 0.75rem; opacity: 0.7; }
    .rank-label { min-width: 2rem; text-align: right; font-size: 0.8rem; font-weight: 700; color: var(--text-muted); }
    .sub-divider { display: flex; align-items: center; gap: 0.5rem; margin: 0.75rem 0; font-size: 0.75rem; font-weight: 700; text-transform: uppercase; letter-spacing: 0.06em; color: var(--warning); }
    .divider-line { flex: 1; height: 1px; background: var(--warning); opacity: 0.3; }
    .withdrawn-card { opacity: 0.7; }

    /* Player actions */
    .player-actions { display: flex; flex-direction: column; gap: 0.5rem; margin-top: 1rem; }
    .proxy-row { display: flex; gap: 0.5rem; align-items: stretch; }
    .proxy-btn { flex: 1; }
    .plus-ones-row { display: flex; align-items: center; justify-content: space-between; padding: 0.5rem 1rem; }
    .plus-ones-label { font-size: 0.9rem; font-weight: 600; }
    .plus-ones-controls { display: flex; align-items: center; gap: 0.75rem; }
    .plus-ones-count { font-weight: 700; font-size: 1.1rem; min-width: 1.5rem; text-align: center; }

    /* Admin sections */
    .admin-row { margin-top: 0.75rem; }
    .admin-section { margin-top: 0.75rem; }
    .score-inputs { display: flex; align-items: flex-end; gap: 0.75rem; flex-wrap: wrap; }
    .score-input-group { display: flex; flex-direction: column; gap: 0.25rem; }
    .score-input-group label { font-size: 0.8rem; font-weight: 600; color: var(--text-muted); }
    .score-input { width: 4rem; text-align: center; font-size: 1.1rem; font-weight: 700; padding: 0.5rem; border: 1.5px solid var(--border); border-radius: 0.5rem; background: var(--card); color: var(--text); font-family: inherit; }
    .score-input:focus { outline: none; border-color: var(--primary); }
    .mini-match-display { display: flex; flex-direction: column; align-items: center; gap: 0.35rem; margin-bottom: 0.75rem; padding: 0.75rem 1rem; }
    .mini-match-label { font-size: 0.72rem; font-weight: 700; text-transform: uppercase; letter-spacing: 0.07em; color: var(--text-muted); }
    .mini-match-score { display: flex; align-items: center; gap: 0.75rem; }
    .mini-score-name { font-size: 0.8rem; font-weight: 600; color: var(--text-muted); }
    .mini-score-value { font-size: 1.4rem; font-weight: 900; color: var(--text); }
    .score-sep-sm { font-size: 1.25rem; font-weight: 700; color: var(--text-muted); padding-bottom: 0.5rem; }
    .presence-count { background: var(--primary); color: white; font-size: 0.75rem; font-weight: 700; padding: 0.15rem 0.6rem; border-radius: 1rem; }
    .presence-toggle { width: 100%; display: flex; align-items: center; justify-content: space-between; background: none; border: none; padding: 0; cursor: pointer; }
    .presence-toggle-right { display: flex; align-items: center; gap: 0.6rem; }
    .toggle-icon { font-size: 0.75rem; color: var(--text-muted); }
    .admin-player-list { list-style: none; padding: 0; margin: 0.75rem 0 0; display: flex; flex-direction: column; gap: 0.15rem; }
    .admin-player-row { display: flex; align-items: center; justify-content: space-between; padding: 0.6rem 0.5rem; border-radius: 0.5rem; transition: background 0.1s; }
    .admin-player-row:hover { background: var(--bg); }
    .admin-player-row.is-present { background: var(--primary-light); }
    .admin-player-check { display: flex; align-items: center; gap: 0.6rem; cursor: pointer; flex: 1; }
    .admin-player-check input[type="checkbox"] { width: 1.1rem; height: 1.1rem; cursor: pointer; accent-color: var(--primary); }
    .player-name { font-size: 0.95rem; }
    .admin-player-controls { display: flex; align-items: center; gap: 0.6rem; }
    .plus-ones-mini { display: flex; align-items: center; gap: 0.3rem; }
    .plus-ones-mini-count { font-size: 0.8rem; font-weight: 700; min-width: 1.75rem; text-align: center; color: var(--text-muted); }
    .btn-mini { width: 1.5rem; height: 1.5rem; border-radius: 50%; border: 1.5px solid var(--border); background: var(--card); cursor: pointer; font-size: 0.9rem; display: flex; align-items: center; justify-content: center; font-family: inherit; line-height: 1; padding: 0; color: var(--text); }
    .btn-mini:disabled { opacity: 0.35; cursor: not-allowed; }
    .team-btns { display: flex; gap: 0.4rem; }
    .team-btn { padding: 0.2rem 0.65rem; border: 1.5px solid var(--border); border-radius: 0.35rem; font-size: 0.8rem; font-weight: 700; cursor: pointer; background: transparent; color: var(--text-muted); font-family: inherit; transition: all 0.1s; }
    .team-btn-a.active { background: var(--primary); color: white; border-color: var(--primary); }
    .team-btn-b.active { background: var(--warning); color: white; border-color: var(--warning); }
  `,
})
export class MatchDetailComponent implements OnInit, OnDestroy {
  private readonly matchesService = inject(MatchesService);
  private readonly supabase = inject(SupabaseService).client;
  private readonly auth = inject(AuthService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);

  readonly String = String;
  readonly getDisplayName = getDisplayName;

  match = signal<Match | null>(null);
  registrations = signal<Registration[]>([]);
  allPlayers = signal<Player[]>([]);
  loading = signal(true);
  actionLoading = signal(false);
  actionError = signal('');
  showModal = signal(false);
  showAdminPanel = signal(false);
  copyFeedback = signal('');
  scoreFeedback = signal('');
  miniScoreFeedback = signal('');
  scoreA = 0;
  scoreB = 0;
  miniScoreA = 0;
  miniScoreB = 0;
  miniTarget = 5;

  private channel: RealtimeChannel | null = null;
  private feedbackTimeout: ReturnType<typeof setTimeout> | null = null;

  readonly matchId = this.route.snapshot.params['id'] as string;
  readonly groupSlug = this.route.snapshot.params['groupSlug'] as string;

  currentPlayerId = computed(() => this.auth.currentPlayer()?.id ?? '');
  isAdmin = computed(() => this.auth.isAdmin());

  presentPlayers = computed(() =>
    this.registrations().filter(r => !r.is_withdrawn)
      .sort((a, b) => new Date(a.registered_at).getTime() - new Date(b.registered_at).getTime())
  );

  withdrawnPlayers = computed(() =>
    this.registrations().filter(r => r.is_withdrawn)
      .sort((a, b) => new Date(a.registered_at).getTime() - new Date(b.registered_at).getTime())
  );

  presentCount = computed(() =>
    this.presentPlayers().reduce((sum, r) => sum + 1 + (r.plus_ones ?? 0), 0)
  );

  expandedPresent = computed(() => {
    let rank = 0;
    const entries: PresentEntry[] = [];
    for (const reg of this.presentPlayers()) {
      entries.push({ type: 'player', reg, rank: ++rank });
      for (let i = 0; i < (reg.plus_ones ?? 0); i++) {
        entries.push({ type: 'guest', hostName: getDisplayName(reg.player), rank: ++rank });
      }
    }
    return entries;
  });

  starters = computed(() => {
    const max = this.match()?.max_players ?? Infinity;
    return this.expandedPresent().filter(e => e.rank <= max);
  });

  substitutes = computed(() => {
    const max = this.match()?.max_players ?? Infinity;
    return this.expandedPresent().filter(e => e.rank > max);
  });

  myPlusOnes = computed(() =>
    this.registrations().find(r => r.player_id === this.currentPlayerId() && !r.is_withdrawn)?.plus_ones ?? 0
  );

  isFull = computed(() => {
    const m = this.match();
    return m ? this.presentCount() >= m.max_players : false;
  });

  isFinished = computed(() => this.match()?.score_a !== null && this.match()?.score_a !== undefined);
  isRegistered = computed(() => this.registrations().some(r => r.player_id === this.currentPlayerId()));
  isWithdrawn = computed(() => this.registrations().some(r => r.player_id === this.currentPlayerId() && r.is_withdrawn));

  proxyCount = computed(() =>
    this.registrations().filter(r => !r.is_withdrawn && r.registered_by === this.currentPlayerId() && r.player_id !== this.currentPlayerId()).length
  );
  canAddProxy = computed(() => this.proxyCount() < 2);

  sortedPlayers = computed(() => {
    const presentIds = new Set(this.presentPlayers().map(r => r.player_id));
    return [...this.allPlayers()].sort((a, b) => {
      const diff = (presentIds.has(a.id) ? 0 : 1) - (presentIds.has(b.id) ? 0 : 1);
      return diff !== 0 ? diff : a.username.localeCompare(b.username);
    });
  });

  async ngOnInit(): Promise<void> {
    await Promise.all([this.loadMatch(), this.loadRegistrations()]);
    await this.loadPlayers();
    this.loading.set(false);
    this.subscribeToRealtime();
  }

  ngOnDestroy(): void {
    this.channel?.unsubscribe();
    if (this.feedbackTimeout) clearTimeout(this.feedbackTimeout);
  }

  private async loadMatch(): Promise<void> {
    try {
      const m = await this.matchesService.getMatch(this.matchId);
      this.match.set(m);
      this.scoreA = m.score_a ?? 0;
      this.scoreB = m.score_b ?? 0;
      this.miniScoreA = m.score_a2 ?? 0;
      this.miniScoreB = m.score_b2 ?? 0;
      this.miniTarget = m.mini_match_target ?? 5;
    } catch { this.match.set(null); }
  }

  private async loadRegistrations(): Promise<void> {
    try { this.registrations.set(await this.matchesService.getRegistrations(this.matchId)); }
    catch { this.registrations.set([]); }
  }

  private async loadPlayers(): Promise<void> {
    const player = this.auth.currentPlayer();
    if (!player) return;
    try { this.allPlayers.set(await this.matchesService.getGroupPlayers(player.group_id)); }
    catch { this.allPlayers.set([]); }
  }

  private subscribeToRealtime(): void {
    this.channel = this.supabase.channel(`match-${this.matchId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'registrations', filter: `match_id=eq.${this.matchId}` },
        () => this.loadRegistrations())
      .subscribe();
  }

  isCurrentPlayer(reg: Registration): boolean { return reg.player_id === this.currentPlayerId(); }

  canWithdraw(reg: Registration): boolean {
    const currentId = this.currentPlayerId();
    const m = this.match();
    if (!m || m.is_closed || reg.is_withdrawn) return false;
    return reg.player_id === currentId || reg.registered_by === currentId;
  }

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
    const newCount = Math.max(0, this.getPlayerPlusOnes(playerId) + delta);
    try {
      await this.matchesService.setPlusOnes(this.matchId, playerId, newCount);
      await this.loadRegistrations();
    } catch { /* silently fail */ }
  }

  async adminToggle(playerId: string): Promise<void> {
    const admin = this.auth.currentPlayer();
    if (!admin) return;
    try {
      if (this.isPlayerPresent(playerId)) {
        await this.matchesService.adminRemoveRegistration(admin.id, this.matchId, playerId);
      } else {
        await this.matchesService.registerPlayer(this.matchId, playerId, admin.id);
      }
      await this.loadRegistrations();
    } catch { /* silently fail */ }
  }

  async adminSetTeam(playerId: string, team: number): Promise<void> {
    const currentTeam = this.getPlayerTeam(playerId);
    const newTeam = currentTeam === team ? null : team;
    try {
      await this.matchesService.assignTeam(this.matchId, playerId, newTeam);
      await this.loadRegistrations();
    } catch { /* silently fail */ }
  }

  async onRegister(): Promise<void> {
    const player = this.auth.currentPlayer();
    if (!player) return;
    this.actionLoading.set(true);
    this.actionError.set('');
    try {
      await this.matchesService.registerPlayer(this.matchId, player.id, player.id);
      await this.loadRegistrations();
    } catch { this.actionError.set('Erreur lors de l\'inscription'); }
    finally { this.actionLoading.set(false); }
  }

  async onWithdraw(playerId: string): Promise<void> {
    const currentPlayer = this.auth.currentPlayer();
    if (!currentPlayer) return;
    this.actionLoading.set(true);
    this.actionError.set('');
    try {
      await this.matchesService.withdrawPlayer(this.matchId, playerId, currentPlayer.id);
      await this.loadRegistrations();
    } catch { this.actionError.set('Erreur lors du retrait'); }
    finally { this.actionLoading.set(false); }
  }

  async onRegisterProxy(playerId: string): Promise<void> {
    const currentPlayer = this.auth.currentPlayer();
    if (!currentPlayer) return;
    this.actionError.set('');
    try {
      await this.matchesService.registerPlayer(this.matchId, playerId, currentPlayer.id);
      await this.loadRegistrations();
    } catch (err) {
      this.actionError.set(err instanceof Error && err.message.includes('proxy_limit_reached')
        ? 'Limite de 2 procurations atteinte' : 'Erreur lors de l\'inscription');
    }
  }

  async onAdjustPlusOnes(delta: number): Promise<void> {
    const player = this.auth.currentPlayer();
    if (!player) return;
    const newCount = Math.max(0, this.myPlusOnes() + delta);
    this.actionLoading.set(true);
    try {
      await this.matchesService.setPlusOnes(this.matchId, player.id, newCount);
      await this.loadRegistrations();
    } catch { this.actionError.set('Erreur lors de la mise à jour'); }
    finally { this.actionLoading.set(false); }
  }

  async toggleClose(): Promise<void> {
    const m = this.match();
    const player = this.auth.currentPlayer();
    if (!m || !player) return;
    this.actionLoading.set(true);
    try {
      await this.matchesService.updateMatch(m.id, { is_closed: !m.is_closed }, player.id, { title: m.title });
      await this.loadMatch();
    } catch { this.actionError.set('Erreur lors de la mise à jour'); }
    finally { this.actionLoading.set(false); }
  }

  async onDeleteRegistration(playerId: string): Promise<void> {
    const admin = this.auth.currentPlayer();
    if (!admin) return;
    this.actionLoading.set(true);
    try {
      await this.matchesService.adminRemoveRegistration(admin.id, this.matchId, playerId);
      await this.loadRegistrations();
    } catch { this.actionError.set('Erreur lors de la suppression'); }
    finally { this.actionLoading.set(false); }
  }

  async saveMiniScore(): Promise<void> {
    this.actionLoading.set(true);
    try {
      await this.matchesService.setMiniMatchScore(this.matchId, this.miniScoreA, this.miniScoreB, this.miniTarget);
      await this.loadMatch();
      this.miniScoreFeedback.set('Mini-match enregistré !');
      setTimeout(() => this.miniScoreFeedback.set(''), 2500);
    } catch { this.miniScoreFeedback.set('Erreur lors de l\'enregistrement'); }
    finally { this.actionLoading.set(false); }
  }

  async saveScore(): Promise<void> {
    const player = this.auth.currentPlayer();
    if (!player) return;
    this.actionLoading.set(true);
    try {
      await this.matchesService.setMatchScore(this.matchId, this.scoreA, this.scoreB, player.id);
      await this.loadMatch();
      this.scoreFeedback.set('Score enregistré !');
      setTimeout(() => this.scoreFeedback.set(''), 2500);
    } catch { this.scoreFeedback.set('Erreur lors de l\'enregistrement'); }
    finally { this.actionLoading.set(false); }
  }

  copyMatchLink(): void {
    const url = `${window.location.origin}/${this.groupSlug}/match/${this.matchId}`;
    navigator.clipboard.writeText(url).then(() => this.showFeedback('Lien copié !'));
  }

  shareList(): void {
    const m = this.match();
    if (!m) return;
    const lines: string[] = [`⚽ ${m.title} — ${this.presentCount()}/${m.max_players}`, ''];
    lines.push(`Titulaires (${this.starters().length}) :`,
      ...this.starters().map(e => e.type === 'player' ? `${e.rank}. ${getDisplayName(e.reg.player)}` : `${e.rank}. +1 de ${e.hostName}`));
    if (this.substitutes().length > 0)
      lines.push('', `Remplaçants (${this.substitutes().length}) :`,
        ...this.substitutes().map(e => e.type === 'player' ? `${e.rank}. ${getDisplayName(e.reg.player)}` : `${e.rank}. +1 de ${e.hostName}`));
    const withdrawn = this.withdrawnPlayers().map((r, i) => `D${i + 1}. ${r.player.display_name ?? r.player.username}`).join('\n');
    if (withdrawn) lines.push('', 'Désistements :', withdrawn);
    navigator.clipboard.writeText(lines.join('\n')).then(() => this.showFeedback('Liste copiée !'));
  }

  private showFeedback(msg: string): void {
    this.copyFeedback.set(msg);
    if (this.feedbackTimeout) clearTimeout(this.feedbackTimeout);
    this.feedbackTimeout = setTimeout(() => this.copyFeedback.set(''), 2500);
  }

  formatDate(dateStr: string): string {
    return new Date(dateStr).toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' });
  }
  formatTime(timeStr: string): string { return timeStr.slice(0, 5); }
}
