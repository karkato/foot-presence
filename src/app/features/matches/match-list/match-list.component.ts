import {
  ChangeDetectionStrategy,
  Component,
  inject,
  OnInit,
  signal,
} from '@angular/core';
import { Router, ActivatedRoute } from '@angular/router';
import { AuthService } from '../../../core/auth/auth.service';
import { MatchesService } from '../matches.service';
import { SupabaseService } from '../../../core/supabase/supabase.service';
import { Match } from '../../../shared/models/match.model';

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
        <ul class="match-list">
          @for (match of matches(); track match.id) {
            <li class="match-card" (click)="openMatch(match)">
              <div class="match-info">
                <span class="match-title">{{ match.title }}</span>
                <span class="match-date">{{ formatDate(match.match_date) }} à {{ formatTime(match.match_time) }}</span>
              </div>
              <div class="match-meta">
                @if (match.is_closed) {
                  <span class="badge badge-closed">Fermé</span>
                }
                <span class="arrow">›</span>
              </div>
            </li>
          }
        </ul>
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
    .match-info { display: flex; flex-direction: column; gap: 0.25rem; }
    .match-title { font-weight: 700; font-size: 1rem; color: var(--text); }
    .match-date { font-size: 0.85rem; color: var(--text-muted); }
    .match-meta { display: flex; align-items: center; gap: 0.5rem; }
    .badge-closed {
      font-size: 0.75rem;
      background: var(--border);
      color: var(--text-muted);
      padding: 0.2rem 0.5rem;
      border-radius: 1rem;
      font-weight: 600;
    }
    .arrow { font-size: 1.5rem; color: var(--text-muted); line-height: 1; }
  `,
})
export class MatchListComponent implements OnInit {
  private readonly matchesService = inject(MatchesService);
  private readonly supabase = inject(SupabaseService).client;
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);

  matches = signal<Match[]>([]);
  loading = signal(true);

  readonly groupSlug = this.route.snapshot.params['groupSlug'] as string;

  async ngOnInit(): Promise<void> {
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
