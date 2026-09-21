import { ChangeDetectionStrategy, Component, computed, inject, OnInit, signal } from '@angular/core';
import { AuthService } from '../../core/auth/auth.service';
import { SeasonsService } from '../../core/seasons/seasons.service';
import { MatchesService } from '../matches/matches.service';
import { Player, GroupPlayerStats } from '../../shared/models/player.model';
import { Season, isCurrentSeason } from '../../shared/models/season.model';
import { SeasonPickerComponent } from '../../shared/components/season-picker/season-picker.component';
import { TabBarComponent, TabItem } from '../../shared/components/tab-bar/tab-bar.component';
import { LeaderboardMetric, buildLeaderboardRows, sortLeaderboard, assignRanks } from '../../shared/utils/leaderboard';

@Component({
  selector: 'app-leaderboard',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [SeasonPickerComponent, TabBarComponent],
  template: `
    <div class="container-md">
      <h2>Classement</h2>

      <app-season-picker
        [seasons]="seasons()"
        [selectedSeasonId]="selectedSeasonId()"
        (seasonChange)="onSeasonChange($event)"
      />

      <app-tab-bar
        [tabs]="metricTabs"
        [selected]="metric()"
        (selectedChange)="metric.set($event)"
        ariaLabel="Métrique du classement"
      />

      @if (loading()) {
        <p class="muted">Chargement...</p>
      } @else if (rankedRows().length === 0) {
        <p class="muted">Aucun match joué pour cette saison.</p>
      } @else {
        <ul class="row-list">
          @for (row of rankedRows(); track row.playerId) {
            <li class="row card" [class.current-player]="row.playerId === currentPlayerId()">
              <span class="rank">{{ row.rank }}</span>
              <span class="name">{{ row.name }}</span>
              <span class="metric-main">{{ metricValue(row) }}</span>
              <span class="metric-secondary">
                {{ row.played }} match{{ row.played > 1 ? 's' : '' }} ·
                {{ row.winRate }}% · {{ row.goals }} B · {{ row.assists }} P
              </span>
            </li>
          }
        </ul>
      }
    </div>
  `,
  styles: `
    h2 { margin-top: 0; }
    .muted { font-size: 0.9rem; }
    .row-list { list-style: none; padding: 0; margin: 0; display: flex; flex-direction: column; gap: 0.5rem; }
    .row {
      display: grid;
      grid-template-columns: 2rem 1fr auto;
      align-items: center;
      gap: 0.25rem 0.75rem;
      padding: 0.75rem 1rem;
      border: var(--border-1);
    }
    .row.current-player { background: var(--primary-light); font-weight: 700; }
    .rank { font-size: 1rem; font-weight: 800; color: var(--text-muted); text-align: center; }
    .name { font-size: 0.95rem; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .metric-main { font-size: 1.1rem; font-weight: 800; color: var(--primary); }
    .metric-secondary {
      grid-column: 2 / -1;
      font-size: 0.75rem;
      color: var(--text-muted);
    }
  `,
})
export class LeaderboardComponent implements OnInit {
  private readonly auth = inject(AuthService);
  private readonly matchesService = inject(MatchesService);
  private readonly seasonsService = inject(SeasonsService);

  readonly metricTabs: readonly TabItem<LeaderboardMetric>[] = [
    { value: 'goals', label: 'Buts' },
    { value: 'assists', label: 'Passes' },
    { value: 'winRate', label: 'Taux de victoire' },
  ];

  loading = signal(true);
  seasons = signal<Season[]>([]);
  selectedSeasonId = signal<string | null>(null);
  metric = signal<LeaderboardMetric>('goals');
  stats = signal<GroupPlayerStats[]>([]);
  players = signal<Player[]>([]);

  currentPlayerId = computed(() => this.auth.currentPlayer()?.id ?? null);

  rankedRows = computed(() => {
    // get_group_player_stats returns every group player, including those
    // with 0 matches this season -- filter those out so the leaderboard only
    // ranks players who actually played, and the empty state can fire.
    const rows = buildLeaderboardRows(this.stats(), this.players()).filter(r => r.played > 0);
    const sorted = sortLeaderboard(rows, this.metric());
    return assignRanks(sorted, this.metric());
  });

  async ngOnInit(): Promise<void> {
    const player = this.auth.currentPlayer();
    if (!player) return;
    try {
      const seasons = await this.seasonsService.getSeasons(player.group_id);
      this.seasons.set(seasons);
      const current = seasons.find(isCurrentSeason);
      this.selectedSeasonId.set(current?.id ?? seasons[0]?.id ?? null);
    } catch { /* non critique */ }
    this.loading.set(true);
    const [players, stats] = await Promise.all([
      this.matchesService.getGroupPlayers(player.group_id).catch(() => []),
      this.matchesService.getGroupPlayerStats(player.group_id, this.selectedSeasonId()).catch(() => []),
    ]);
    this.players.set(players);
    this.stats.set(stats);
    this.loading.set(false);
  }

  onSeasonChange(seasonId: string): void {
    this.selectedSeasonId.set(seasonId);
    const player = this.auth.currentPlayer();
    if (!player) return;
    void this.loadStats(player.group_id);
  }

  metricValue(row: { goals: number; assists: number; winRate: number }): string {
    const value = row[this.metric()];
    return this.metric() === 'winRate' ? `${value}%` : `${value}`;
  }

  private async loadStats(groupId: string): Promise<void> {
    this.loading.set(true);
    this.stats.set(await this.matchesService.getGroupPlayerStats(groupId, this.selectedSeasonId()).catch(() => []));
    this.loading.set(false);
  }
}
