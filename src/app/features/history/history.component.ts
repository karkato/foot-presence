import { ChangeDetectionStrategy, Component, computed, inject, OnInit, signal } from '@angular/core';
import { RouterLink, ActivatedRoute } from '@angular/router';
import { AuthService } from '../../core/auth/auth.service';
import { MatchesService, MatchHistoryEntry, PlayerStats } from '../matches/matches.service';
import { getDisplayName } from '../../shared/models/player.model';

type Filter = 'all' | 'win' | 'loss' | 'draw';

@Component({
  selector: 'app-history',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink],
  template: `
    <div class="container">
      <a class="back-link" [routerLink]="['/' + groupSlug + '/profile']">← Profil</a>

      <h2>Historique de {{ playerName() }}</h2>

      @if (stats() && stats()!.played > 0) {
        <div class="card stats-card">
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
          </div>
          <div class="ratio-row">
            <span class="ratio-label">Taux de victoire</span>
            <span class="ratio-value">{{ winRatio() }}%</span>
          </div>
        </div>
      }

      @if (loading()) {
        <p class="muted">Chargement...</p>
      } @else if (history().length === 0) {
        <p class="muted">Aucun match joué pour l'instant.</p>
      } @else {
        <div class="tabs">
          <button [class.active]="activeFilter() === 'all'" (click)="activeFilter.set('all')">
            Tous ({{ history().length }})
          </button>
          <button [class.active]="activeFilter() === 'win'" (click)="activeFilter.set('win')">
            V ({{ winCount() }})
          </button>
          <button [class.active]="activeFilter() === 'loss'" (click)="activeFilter.set('loss')">
            D ({{ lossCount() }})
          </button>
          <button [class.active]="activeFilter() === 'draw'" (click)="activeFilter.set('draw')">
            N ({{ drawCount() }})
          </button>
        </div>

        @if (filteredHistory().length === 0) {
          <p class="muted">Aucun résultat pour ce filtre.</p>
        } @else {
          <div class="history-list">
            @for (entry of filteredHistory(); track entry.id) {
              <a class="history-entry card" [routerLink]="['/' + groupSlug + '/match/' + entry.id]">
                <div class="entry-header">
                  <span class="entry-title">{{ entry.title }}</span>
                  <span class="entry-date">{{ formatDate(entry.match_date) }}</span>
                </div>

                @if (entry.score_a !== null && entry.score_b !== null) {
                  <div class="score-row">
                    <span class="team-name" [class.my-team]="entry.team === 0">{{ entry.team_a_name || 'Équipe A' }}</span>
                    <span class="score">{{ entry.score_a }} – {{ entry.score_b }}</span>
                    <span class="team-name" [class.my-team]="entry.team === 1">{{ entry.team_b_name || 'Équipe B' }}</span>
                  </div>
                }

                <div class="entry-footer">
                  @if (entry.team !== null) {
                    <span class="my-team-label">Tu étais : {{ entry.team === 0 ? (entry.team_a_name || 'Équipe A') : (entry.team_b_name || 'Équipe B') }}</span>
                  } @else {
                    <span></span>
                  }
                  <span class="result-badge" [class]="'result-' + (entry.result ?? 'none')">
                    {{ resultLabel(entry.result) }}
                  </span>
                </div>
              </a>
            }
          </div>
        }
      }
    </div>
  `,
  styles: `
    .container { padding: 1rem; max-width: 480px; margin: 0 auto; }
    h2 { margin-top: 0; }
    .muted { color: var(--text-muted); }
    .back-link { display: inline-block; font-size: 0.875rem; font-weight: 600; color: var(--primary); text-decoration: none; margin-bottom: 1rem; }
    .back-link:hover { text-decoration: underline; }
    .card { background: var(--card); border: 1.5px solid var(--border); border-radius: 0.75rem; }

    /* Stats */
    .stats-card { padding: 1.25rem; margin-bottom: 1rem; display: flex; flex-direction: column; gap: 1rem; }
    .stats-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 0.5rem; }
    .stat-block { display: flex; flex-direction: column; align-items: center; gap: 0.2rem; padding: 0.75rem 0.5rem; background: var(--bg); border-radius: 0.5rem; }
    .stat-value { font-size: 1.5rem; font-weight: 900; line-height: 1; }
    .stat-label { font-size: 0.7rem; font-weight: 600; color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.05em; }
    .stat-block.win .stat-value { color: var(--success); }
    .stat-block.loss .stat-value { color: var(--danger); }
    .stat-block.draw .stat-value { color: var(--text-muted); }
    .ratio-row { display: flex; align-items: center; justify-content: space-between; }
    .ratio-label { font-size: 0.85rem; color: var(--text-muted); }
    .ratio-value { font-size: 1rem; font-weight: 700; color: var(--primary); }

    /* Tabs */
    .tabs { display: flex; gap: 0.5rem; margin-bottom: 0.75rem; overflow-x: auto; padding-bottom: 2px; }
    .tabs button {
      flex-shrink: 0; padding: 0.4rem 0.9rem; border: 1.5px solid var(--border);
      border-radius: 2rem; background: var(--card); color: var(--text-muted);
      font-size: 0.85rem; font-weight: 600; cursor: pointer; transition: all 0.15s;
    }
    .tabs button.active { border-color: var(--primary); color: var(--primary); background: color-mix(in srgb, var(--primary) 10%, transparent); }
    .tabs button:hover:not(.active) { border-color: var(--text-muted); color: var(--text); }

    /* History list */
    .history-list { display: flex; flex-direction: column; gap: 0.625rem; }
    .history-entry {
      display: flex; flex-direction: column; gap: 0.6rem;
      padding: 1rem; text-decoration: none; color: var(--text);
      transition: border-color 0.15s;
    }
    .history-entry:hover { border-color: var(--primary); }

    /* Card header */
    .entry-header { display: flex; align-items: baseline; justify-content: space-between; gap: 0.5rem; }
    .entry-title { font-weight: 600; font-size: 0.9rem; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; flex: 1; }
    .entry-date { font-size: 0.8rem; color: var(--text-muted); flex-shrink: 0; }

    /* Score row */
    .score-row { display: flex; align-items: center; justify-content: center; gap: 0.75rem; padding: 0.25rem 0; }
    .team-name { font-size: 0.8rem; color: var(--text-muted); flex: 1; text-align: center; }
    .team-name.my-team { font-weight: 700; color: var(--text); }
    .score { font-size: 1.5rem; font-weight: 900; letter-spacing: 0.05em; flex-shrink: 0; }

    /* Card footer */
    .entry-footer { display: flex; align-items: center; justify-content: space-between; }
    .my-team-label { font-size: 0.78rem; color: var(--text-muted); }

    /* Result badge */
    .result-badge { font-size: 0.85rem; font-weight: 700; padding: 0.25rem 0.7rem; border-radius: 0.4rem; flex-shrink: 0; }
    .result-win { background: color-mix(in srgb, var(--success) 15%, transparent); color: var(--success); }
    .result-loss { background: color-mix(in srgb, var(--danger) 15%, transparent); color: var(--danger); }
    .result-draw, .result-none { background: var(--border); color: var(--text-muted); }
  `,
})
export class HistoryComponent implements OnInit {
  private readonly auth = inject(AuthService);
  private readonly matchesService = inject(MatchesService);
  private readonly route = inject(ActivatedRoute);

  readonly groupSlug = this.route.snapshot.params['groupSlug'] as string;

  history = signal<MatchHistoryEntry[]>([]);
  stats = signal<PlayerStats | null>(null);
  loading = signal(true);
  activeFilter = signal<Filter>('all');

  playerName = computed(() => {
    const p = this.auth.currentPlayer();
    return p ? getDisplayName(p) : '';
  });

  winRatio = computed(() => {
    const s = this.stats();
    if (!s || s.played === 0) return 0;
    return Math.round((s.wins / s.played) * 100);
  });

  winCount = computed(() => this.history().filter(e => e.result === 'win').length);
  lossCount = computed(() => this.history().filter(e => e.result === 'loss').length);
  drawCount = computed(() => this.history().filter(e => e.result === 'draw').length);

  filteredHistory = computed(() => {
    const f = this.activeFilter();
    if (f === 'all') return this.history();
    return this.history().filter(e => e.result === f);
  });

  async ngOnInit(): Promise<void> {
    const player = this.auth.currentPlayer();
    if (!player) return;
    const [history, stats] = await Promise.all([
      this.matchesService.getPlayerHistory(player.id).catch(() => []),
      this.matchesService.getPlayerStats(player.id).catch(() => null),
    ]);
    this.history.set(history);
    this.stats.set(stats);
    this.loading.set(false);
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
}
