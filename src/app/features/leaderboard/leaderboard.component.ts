import { ChangeDetectionStrategy, Component, computed, inject, linkedSignal, resource, signal } from '@angular/core';
import { AuthService } from '../../core/auth/auth.service';
import { SeasonsService } from '../../core/seasons/seasons.service';
import { MatchesService } from '../matches/matches.service';
import { isCurrentSeason } from '../../shared/models/season.model';
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
      @if (!loading()) {
        <p class="muted season-total">{{ seasonMatchesCount() }} match{{ seasonMatchesCount() > 1 ? 's' : '' }} joué{{ seasonMatchesCount() > 1 ? 's' : '' }} cette saison</p>
      }

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
    .season-total { margin: 0.35rem 0 1rem; }
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
export class LeaderboardComponent {
  private readonly auth = inject(AuthService);
  private readonly matchesService = inject(MatchesService);
  private readonly seasonsService = inject(SeasonsService);

  readonly metricTabs: readonly TabItem<LeaderboardMetric>[] = [
    { value: 'goals', label: 'Buts' },
    { value: 'assists', label: 'Passes' },
    { value: 'winRate', label: 'Taux de victoire' },
  ];

  metric = signal<LeaderboardMetric>('goals');

  private readonly groupId = computed(() => this.auth.currentPlayer()?.group_id ?? undefined);

  private readonly seasonsResource = resource({
    params: () => this.groupId(),
    loader: ({ params }) => this.seasonsService.getSeasons(params).catch(() => []),
  });
  seasons = computed(() => this.seasonsResource.value() ?? []);

  // Défaut = saison courante, mais reste modifiable via onSeasonChange tant
  // que seasons() ne change pas (linkedSignal : dérivé, mais overridable).
  selectedSeasonId = linkedSignal<string | null>(() => {
    const seasons = this.seasons();
    return seasons.find(isCurrentSeason)?.id ?? seasons[0]?.id ?? null;
  });

  private readonly playersResource = resource({
    params: () => this.groupId(),
    loader: ({ params }) => this.matchesService.getGroupPlayers(params).catch(() => []),
  });
  players = computed(() => this.playersResource.value() ?? []);

  private readonly statsResource = resource({
    params: () => {
      const groupId = this.groupId();
      return groupId ? { groupId, seasonId: this.selectedSeasonId() } : undefined;
    },
    loader: ({ params }) => this.matchesService.getGroupPlayerStats(params.groupId, params.seasonId).catch(() => []),
  });
  stats = computed(() => this.statsResource.value() ?? []);

  loading = computed(() => this.playersResource.isLoading() || this.statsResource.isLoading());

  // season_matches est le même pour toutes les lignes (total de la
  // saison, pas une stat par joueur) -- n'importe laquelle suffit.
  seasonMatchesCount = computed(() => this.stats()[0]?.season_matches ?? 0);

  currentPlayerId = computed(() => this.auth.currentPlayer()?.id ?? null);

  rankedRows = computed(() => {
    // get_group_player_stats returns every group player, including those
    // with 0 matches this season -- filter those out so the leaderboard only
    // ranks players who actually played, and the empty state can fire.
    const rows = buildLeaderboardRows(this.stats(), this.players()).filter(r => r.played > 0);
    const sorted = sortLeaderboard(rows, this.metric());
    return assignRanks(sorted, this.metric());
  });

  onSeasonChange(seasonId: string): void {
    this.selectedSeasonId.set(seasonId);
  }

  metricValue(row: { goals: number; assists: number; winRate: number }): string {
    const value = row[this.metric()];
    return this.metric() === 'winRate' ? `${value}%` : `${value}`;
  }
}
