import { ChangeDetectionStrategy, Component, computed, inject, OnInit, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { AuthService } from '../../../core/auth/auth.service';
import { SeasonsService } from '../../../core/seasons/seasons.service';
import { MatchesService } from '../../matches/matches.service';
import { Season, isCurrentSeason } from '../../../shared/models/season.model';
import { mapAuthRpcError } from '../../../shared/utils/rpc-error';

@Component({
  selector: 'app-season-settings',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule],
  template: `
    <div class="container">
      @if (loading()) {
        <p class="muted">Chargement...</p>
      } @else {
        @if (currentSeason(); as season) {
          <div class="card current-season">
            <span class="season-name">{{ season.name }}</span>
            <span class="season-meta">depuis le {{ formatDate(season.started_at) }}</span>
            <span class="season-meta">{{ matchCount(season.id) }} match(s)</span>
          </div>
        }

        <div class="field">
          <label>Nom de la nouvelle saison (optionnel)</label>
          <input type="text" [(ngModel)]="newSeasonName" placeholder="Saison {{ nextSeasonNumber() }}" maxlength="40" />
        </div>

        @if (error()) {
          <p class="feedback-error">{{ error() }}</p>
        }
        @if (success()) {
          <p class="feedback-success">{{ success() }}</p>
        }

        <button class="btn-warning" (click)="onStartNewSeason()" [disabled]="starting()">
          @if (starting()) { ... } @else { Démarrer une nouvelle saison }
        </button>

        @if (archivedSeasons().length > 0) {
          <p class="section-label">Saisons archivées</p>
          <ul class="archived-list">
            @for (season of archivedSeasons(); track season.id) {
              <li class="archived-item">
                <span class="archived-name">{{ season.name }}</span>
                <span class="archived-range">
                  {{ formatDate(season.started_at) }} → {{ formatDate(season.ended_at!) }}
                  · {{ matchCount(season.id) }} match(s)
                </span>
              </li>
            }
          </ul>
        }
      }
    </div>
  `,
  styles: `
    .container { padding: 0; max-width: 480px; }
    .muted { color: var(--text-muted); }
    .card { background: var(--card); border: 1.5px solid var(--border); border-radius: 0.75rem; }
    .current-season { display: flex; flex-direction: column; gap: 0.25rem; padding: 1rem; margin-bottom: 1.25rem; }
    .season-name { font-size: 1.1rem; font-weight: 800; }
    .season-meta { font-size: 0.85rem; color: var(--text-muted); }
    .field { display: flex; flex-direction: column; gap: 0.35rem; margin-bottom: 1rem; }
    .field label { font-size: 0.85rem; font-weight: 600; color: var(--text-muted); }
    .field input {
      padding: 0.65rem 0.85rem; border: 1.5px solid var(--border); border-radius: 0.5rem;
      font-size: 0.95rem; background: var(--card); color: var(--text); font-family: inherit;
    }
    .field input:focus { outline: none; border-color: var(--primary); }
    .feedback-error { color: var(--danger); font-size: 0.9rem; }
    .feedback-success { color: var(--success); font-size: 0.9rem; }
    .btn-warning {
      width: 100%; padding: 0.7rem 1.25rem; background: var(--warning); color: white; border: none;
      border-radius: 0.5rem; font-size: 0.95rem; font-weight: 700; cursor: pointer; font-family: inherit;
    }
    .btn-warning:disabled { opacity: 0.6; cursor: not-allowed; }
    .section-label { font-size: 0.75rem; font-weight: 700; text-transform: uppercase; letter-spacing: 0.08em; color: var(--text-muted); margin: 1.5rem 0 0.6rem; }
    .archived-list { list-style: none; padding: 0; margin: 0; display: flex; flex-direction: column; gap: 0.4rem; }
    .archived-item { display: flex; flex-direction: column; gap: 0.1rem; padding: 0.5rem 0.6rem; border-radius: 0.4rem; background: var(--bg); }
    .archived-name { font-size: 0.9rem; font-weight: 700; }
    .archived-range { font-size: 0.8rem; color: var(--text-muted); }
  `,
})
export class SeasonSettingsComponent implements OnInit {
  private readonly auth = inject(AuthService);
  private readonly seasonsService = inject(SeasonsService);
  private readonly matchesService = inject(MatchesService);

  loading = signal(true);
  starting = signal(false);
  error = signal('');
  success = signal('');
  newSeasonName = '';

  seasons = signal<Season[]>([]);
  matchCounts = signal<Record<string, number>>({});

  currentSeason = computed(() => this.seasons().find(isCurrentSeason) ?? null);
  archivedSeasons = computed(() =>
    this.seasons().filter(s => !isCurrentSeason(s)).sort((a, b) => b.started_at.localeCompare(a.started_at))
  );
  nextSeasonNumber = computed(() => this.seasons().length + 1);

  private groupId = '';

  async ngOnInit(): Promise<void> {
    const player = this.auth.currentPlayer();
    if (!player) return;
    this.groupId = player.group_id;
    await this.load();
  }

  private async load(): Promise<void> {
    this.loading.set(true);
    try {
      const [seasons, matches] = await Promise.all([
        this.seasonsService.getSeasons(this.groupId),
        this.matchesService.getMatchesByGroup(this.groupId),
      ]);
      this.seasons.set(seasons);
      const counts: Record<string, number> = {};
      for (const m of matches) counts[m.season_id] = (counts[m.season_id] ?? 0) + 1;
      this.matchCounts.set(counts);
    } catch {
      this.error.set('Erreur lors du chargement des saisons');
    } finally {
      this.loading.set(false);
    }
  }

  matchCount(seasonId: string): number {
    return this.matchCounts()[seasonId] ?? 0;
  }

  async onStartNewSeason(): Promise<void> {
    const player = this.auth.currentPlayer();
    if (!player) return;
    const current = this.currentSeason();
    const label = current ? `"${current.name}"` : 'la saison en cours';
    if (!confirm(
      `Archiver ${label} et démarrer une nouvelle saison ? Les statistiques repartiront de zéro. ` +
      `Aucun match ni aucune donnée n'est supprimé — les saisons passées restent consultables.`
    )) return;

    this.starting.set(true);
    this.error.set('');
    this.success.set('');
    try {
      const created = await this.seasonsService.startNewSeason(this.groupId, player.id, this.newSeasonName);
      this.newSeasonName = '';
      this.success.set(`${created.name} démarrée !`);
      await this.load();
      setTimeout(() => this.success.set(''), 3000);
    } catch (err) {
      this.error.set(mapAuthRpcError(err, "Erreur lors du démarrage de la nouvelle saison"));
    } finally {
      this.starting.set(false);
    }
  }

  formatDate(dateStr: string): string {
    return new Date(dateStr).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' });
  }
}
