import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  OnDestroy,
  OnInit,
  signal,
} from '@angular/core';
import { Router, ActivatedRoute } from '@angular/router';
import { AuthService } from '../../../core/auth/auth.service';
import { MatchesService } from '../matches.service';
import { SupabaseService } from '../../../core/supabase/supabase.service';
import { Match } from '../../../shared/models/match.model';
import { MatchWithCount } from '../matches.service';

@Component({
  selector: 'app-match-list',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="container">
      <h2>Matchs</h2>

      @if (loading()) {
        <p class="muted">Chargement...</p>
      } @else if (matches().length === 0) {
        <p class="muted empty">Aucun match prévu pour l'instant.</p>
      } @else {
        @if (upcomingMatches().length === 0) {
          <p class="muted empty">Aucun match à venir.</p>
        } @else {
          <ul class="match-list">
            @for (match of upcomingMatches(); track match.id) {
              <li class="match-card" (click)="openMatch(match)">
                <div class="match-info">
                  <span class="match-title">{{ match.title }}</span>
                  <span class="match-date">{{ formatDate(match.match_date) }} à {{ formatTime(match.match_time) }}</span>
                </div>
                <div class="match-meta">
                  <span class="badge badge-count" [class.badge-full]="match.registration_count >= match.max_players">
                    {{ match.registration_count }}/{{ match.max_players }}
                  </span>
                  @if (match.is_closed) {
                    <span class="badge badge-closed">Fermé</span>
                  }
                  <span class="arrow">›</span>
                </div>
              </li>
            }
          </ul>
        }

        @if (finishedMatches().length > 0) {
          <div class="finished-panel">
            <button
              type="button"
              class="finished-toggle"
              (click)="toggleFinished()"
              [attr.aria-expanded]="showFinished()"
            >
              <span>Matchs terminés ({{ finishedMatches().length }})</span>
              <span class="chevron" [class.open]="showFinished()">›</span>
            </button>
            @if (showFinished()) {
              <ul class="match-list finished-list">
                @for (match of finishedMatches(); track match.id) {
                  <li class="match-card" (click)="openMatch(match)">
                    <div class="match-info">
                      <span class="match-title">{{ match.title }}</span>
                      <span class="match-date">{{ formatDate(match.match_date) }} à {{ formatTime(match.match_time) }}</span>
                    </div>
                    <div class="match-meta">
                      <span class="badge badge-count">
                        {{ match.registration_count }}/{{ match.max_players }}
                      </span>
                      <span class="badge badge-finished">Terminé</span>
                      <span class="arrow">›</span>
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
    .container { padding: 1rem; max-width: 600px; margin: 0 auto; }
    h2 { margin-top: 0; }
    .muted { color: var(--text-muted); }
    .empty { text-align: center; padding: 2rem 0; }
    .match-list { list-style: none; padding: 0; margin: 0; display: flex; flex-direction: column; gap: 0.75rem; }
    .match-card {
      background: var(--card);
      border-radius: 0.75rem;
      padding: 1rem 1.25rem;
      display: flex;
      align-items: center;
      justify-content: space-between;
      cursor: pointer;
      border: 1.5px solid var(--border);
      transition: border-color 0.15s, box-shadow 0.15s;
    }
    .match-card:hover { border-color: var(--primary); box-shadow: var(--shadow-sm); }
    .match-info { display: flex; flex-direction: column; gap: 0.25rem; min-width: 0; }
    .match-title { font-weight: 700; font-size: 1rem; color: var(--text); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 100%; }
    .match-date { font-size: 0.85rem; color: var(--text-muted); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 100%; }
    .match-meta { display: flex; align-items: center; gap: 0.5rem; flex-shrink: 0; }
    .badge {
      font-size: 0.75rem;
      padding: 0.2rem 0.5rem;
      border-radius: 1rem;
      font-weight: 600;
    }
    .badge-count {
      background: var(--primary-light);
      color: var(--primary);
      font-size: 0.9rem;
      padding: 0.3rem 0.75rem;
    }
    .badge-count.badge-full {
      background: #fef3c7;
      color: #d97706;
    }
    .badge-finished {
      background: var(--success);
      color: white;
    }
    .badge-closed {
      background: var(--border);
      color: var(--text-muted);
    }
    .arrow { font-size: 1.5rem; color: var(--text-muted); line-height: 1; }
    .finished-panel { margin-top: 1.5rem; }
    .finished-toggle {
      width: 100%;
      min-height: var(--tap);
      display: flex;
      align-items: center;
      justify-content: space-between;
      background: none;
      border: 1.5px solid var(--border);
      border-radius: 0.75rem;
      padding: 0.75rem 1.25rem;
      font-size: 0.9rem;
      font-weight: 600;
      color: var(--text-muted);
      cursor: pointer;
      transition: border-color 0.15s;
    }
    .finished-toggle:hover { border-color: var(--primary); }
    .chevron { display: inline-block; transform: rotate(90deg); transition: transform 0.15s; }
    .chevron.open { transform: rotate(-90deg); }
    .finished-list { margin-top: 0.75rem; }
  `,
})
export class MatchListComponent implements OnInit, OnDestroy {
  private readonly matchesService = inject(MatchesService);
  private readonly supabase = inject(SupabaseService).client;
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);

  matches = signal<MatchWithCount[]>([]);
  loading = signal(true);
  showFinished = signal(false);

  upcomingMatches = computed(() => this.matches().filter(m => m.score_a === null));
  finishedMatches = computed(() => this.matches().filter(m => m.score_a !== null));

  readonly groupSlug = this.route.snapshot.params['groupSlug'] as string;

  private readonly visibilityHandler = () => {
    if (document.visibilityState === 'visible') this.loadMatches();
  };

  async ngOnInit(): Promise<void> {
    await this.loadMatches();
    document.addEventListener('visibilitychange', this.visibilityHandler);
  }

  ngOnDestroy(): void {
    document.removeEventListener('visibilitychange', this.visibilityHandler);
  }

  private async loadMatches(): Promise<void> {
    try {
      const player = this.auth.currentPlayer();
      if (!player) return;
      const matches = await this.matchesService.getMatchesByGroup(player.group_id);
      this.matches.set(matches);
    } finally {
      this.loading.set(false);
    }
  }

  openMatch(match: Match): void {
    this.router.navigate([`/${this.groupSlug}/match/${match.id}`]);
  }

  toggleFinished(): void {
    this.showFinished.update(v => !v);
  }

  formatDate(dateStr: string): string {
    return new Date(dateStr).toLocaleDateString('fr-FR', {
      weekday: 'long',
      day: 'numeric',
      month: 'long',
    });
  }

  formatTime(timeStr: string): string {
    return timeStr.slice(0, 5);
  }
}
