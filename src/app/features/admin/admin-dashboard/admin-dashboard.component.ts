import {
  ChangeDetectionStrategy,
  Component,
  inject,
  OnInit,
  signal,
} from '@angular/core';
import { Router, ActivatedRoute } from '@angular/router';
import { AuthService } from '../../../core/auth/auth.service';
import { MatchesService } from '../../matches/matches.service';
import { SupabaseService } from '../../../core/supabase/supabase.service';
import { Match } from '../../../shared/models/match.model';
import { Player, getDisplayName } from '../../../shared/models/player.model';

@Component({
  selector: 'app-admin-dashboard',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="container">
      <h2>Administration</h2>

      <!-- Matchs -->
      <section class="section">
        <div class="section-header">
          <h3>Matchs</h3>
          <button class="btn-add" (click)="router.navigate(['match/new'], { relativeTo: route })">
            + Nouveau match
          </button>
        </div>

        @if (loadingMatches()) {
          <p class="muted">Chargement...</p>
        } @else if (matches().length === 0) {
          <p class="muted">Aucun match.</p>
        } @else {
          <ul class="item-list">
            @for (match of matches(); track match.id) {
              <li class="item-card">
                <div class="item-info">
                  <span class="item-title">{{ match.title }}</span>
                  <span class="item-sub">{{ formatDate(match.match_date) }} · {{ formatTime(match.match_time) }}</span>
                </div>
                <div class="item-actions">
                  @if (match.is_closed) {
                    <span class="badge-closed">Fermé</span>
                  } @else {
                    <button class="btn-sm btn-warning" (click)="toggleClose(match)">Fermer</button>
                  }
                  <button class="btn-sm btn-edit" (click)="editMatch(match)">Modifier</button>
                  <button class="btn-sm btn-danger" (click)="deleteMatch(match)">Supprimer</button>
                </div>
              </li>
            }
          </ul>
        }
      </section>

      <!-- Joueurs -->
      <section class="section">
        <div class="section-header">
          <h3>Joueurs</h3>
          <button class="btn-add" (click)="router.navigate(['player/new'], { relativeTo: route })">
            + Nouveau joueur
          </button>
        </div>

        @if (loadingPlayers()) {
          <p class="muted">Chargement...</p>
        } @else if (players().length === 0) {
          <p class="muted">Aucun joueur.</p>
        } @else {
          <ul class="item-list">
            @for (player of players(); track player.id) {
              <li class="item-card">
                <div class="item-info">
                  <span class="item-title">{{ getDisplayName(player) }}</span>
                  <span class="item-sub">@{{ player.username }} @if (player.is_admin) { · admin }</span>
                </div>
                <div class="item-actions">
                  <button class="btn-sm btn-edit" (click)="editPlayer(player)">Modifier</button>
                </div>
              </li>
            }
          </ul>
        }
      </section>
    </div>
  `,
  styles: `
    .container { padding: 1rem; max-width: 680px; margin: 0 auto; }
    h2 { margin-top: 0; }
    .section { margin-bottom: 1.5rem; }
    .section-header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 0.75rem; }
    h3 { margin: 0; }
    .btn-add {
      padding: 0.45rem 0.9rem;
      background: var(--primary);
      color: white;
      border: none;
      border-radius: 0.5rem;
      font-size: 0.85rem;
      font-weight: 600;
      cursor: pointer;
    }
    .muted { color: var(--text-muted); }
    .item-list { list-style: none; padding: 0; margin: 0; display: flex; flex-direction: column; gap: 0.5rem; }
    .item-card {
      background: var(--card);
      border: 1.5px solid var(--border);
      border-radius: 0.6rem;
      padding: 0.75rem 1rem;
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 0.5rem;
      flex-wrap: wrap;
    }
    .item-info { display: flex; flex-direction: column; gap: 0.15rem; }
    .item-title { font-weight: 600; font-size: 0.95rem; }
    .item-sub { font-size: 0.8rem; color: var(--text-muted); }
    .item-actions { display: flex; align-items: center; gap: 0.4rem; flex-wrap: wrap; }
    .btn-sm {
      padding: 0.3rem 0.65rem;
      border: none;
      border-radius: 0.4rem;
      font-size: 0.8rem;
      font-weight: 600;
      cursor: pointer;
    }
    .btn-edit { background: var(--border); color: var(--text); }
    .btn-warning { background: var(--warning); color: white; }
    .btn-danger { background: var(--danger); color: white; }
    .badge-closed {
      font-size: 0.75rem;
      background: var(--border);
      color: var(--text-muted);
      padding: 0.2rem 0.5rem;
      border-radius: 1rem;
      font-weight: 600;
    }
  `,
})
export class AdminDashboardComponent implements OnInit {
  private readonly matchesService = inject(MatchesService);
  private readonly supabase = inject(SupabaseService).client;
  private readonly auth = inject(AuthService);
  readonly router = inject(Router);
  readonly route = inject(ActivatedRoute);

  readonly getDisplayName = getDisplayName;

  matches = signal<Match[]>([]);
  players = signal<Player[]>([]);
  loadingMatches = signal(true);
  loadingPlayers = signal(true);

  async ngOnInit(): Promise<void> {
    const player = this.auth.currentPlayer();
    if (!player) return;
    await Promise.all([
      this.loadMatches(player.group_id),
      this.loadPlayers(player.group_id),
    ]);
  }

  private async loadMatches(groupId: string): Promise<void> {
    try {
      this.matches.set(await this.matchesService.getMatchesByGroup(groupId));
    } finally {
      this.loadingMatches.set(false);
    }
  }

  private async loadPlayers(groupId: string): Promise<void> {
    try {
      this.players.set(await this.matchesService.getGroupPlayers(groupId));
    } finally {
      this.loadingPlayers.set(false);
    }
  }

  editMatch(match: Match): void {
    this.router.navigate([`match/${match.id}`], { relativeTo: this.route });
  }

  editPlayer(player: Player): void {
    this.router.navigate([`player/${player.id}`], { relativeTo: this.route });
  }

  async toggleClose(match: Match): Promise<void> {
    await this.matchesService.updateMatch(match.id, { is_closed: !match.is_closed });
    const player = this.auth.currentPlayer();
    if (player) await this.loadMatches(player.group_id);
  }

  async deleteMatch(match: Match): Promise<void> {
    if (!confirm(`Supprimer "${match.title}" ?`)) return;
    await this.matchesService.deleteMatch(match.id);
    const player = this.auth.currentPlayer();
    if (player) await this.loadMatches(player.group_id);
  }

  formatDate(dateStr: string): string {
    return new Date(dateStr).toLocaleDateString('fr-FR', {
      weekday: 'short', day: 'numeric', month: 'short',
    });
  }
  formatTime(timeStr: string): string { return timeStr.slice(0, 5); }
}
