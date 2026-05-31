import {
  ChangeDetectionStrategy,
  Component,
  inject,
  OnInit,
  signal,
} from '@angular/core';
import { Router, ActivatedRoute } from '@angular/router';
import { AuthService } from '../../../core/auth/auth.service';
import { MatchesService, AuditEntry } from '../../matches/matches.service';
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

      <!-- Tabs -->
      <div class="tabs">
        <button class="tab" [class.active]="activeTab() === 'matches'" (click)="activeTab.set('matches')">Matchs</button>
        <button class="tab" [class.active]="activeTab() === 'players'" (click)="activeTab.set('players')">Joueurs</button>
        <button class="tab" [class.active]="activeTab() === 'audit'" (click)="activeTab.set('audit')">Historique</button>
      </div>

      <!-- Matchs -->
      @if (activeTab() === 'matches') {
        <section class="section">
          <div class="section-header">
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
      }

      <!-- Joueurs -->
      @if (activeTab() === 'players') {
        <section class="section">
          <div class="section-header">
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
      }

      <!-- Historique -->
      @if (activeTab() === 'audit') {
        <section class="section">
          <div class="section-header">
            <button class="btn-refresh" (click)="reloadAudit()">Actualiser</button>
          </div>
          @if (loadingAudit()) {
            <p class="muted">Chargement...</p>
          } @else if (auditLog().length === 0) {
            <p class="muted">Aucune activité enregistrée.</p>
          } @else {
            <ul class="audit-list">
              @for (entry of auditLog(); track entry.id) {
                <li class="audit-item">
                  <span class="audit-time">{{ timeAgo(entry.created_at) }}</span>
                  <span class="audit-desc">{{ formatAction(entry) }}</span>
                </li>
              }
            </ul>
          }
        </section>
      }
    </div>
  `,
  styles: `
    .container { padding: 1rem; max-width: 680px; margin: 0 auto; }
    h2 { margin-top: 0; }
    .tabs { display: flex; gap: 0.25rem; background: var(--card); border: 1.5px solid var(--border); border-radius: 0.6rem; padding: 0.25rem; margin-bottom: 1.25rem; }
    .tab { flex: 1; padding: 0.5rem; border: none; background: none; border-radius: 0.4rem; font-size: 0.9rem; font-weight: 600; cursor: pointer; color: var(--text-muted); transition: all 0.15s; }
    .tab.active { background: var(--primary); color: white; }
    .section { margin-bottom: 1.5rem; }
    .section-header { display: flex; align-items: center; justify-content: flex-end; margin-bottom: 0.75rem; }
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
    .btn-refresh {
      padding: 0.35rem 0.75rem;
      background: none;
      border: 1.5px solid var(--border);
      border-radius: 0.4rem;
      font-size: 0.8rem;
      cursor: pointer;
      color: var(--text-muted);
      font-family: inherit;
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
    .audit-list { list-style: none; padding: 0; margin: 0; display: flex; flex-direction: column; gap: 0; }
    .audit-item {
      display: flex;
      gap: 0.75rem;
      padding: 0.5rem 0;
      border-bottom: 1px solid var(--border);
      font-size: 0.875rem;
    }
    .audit-item:last-child { border-bottom: none; }
    .audit-time { color: var(--text-muted); white-space: nowrap; min-width: 80px; font-size: 0.8rem; }
    .audit-desc { color: var(--text); }
  `,
})
export class AdminDashboardComponent implements OnInit {
  private readonly matchesService = inject(MatchesService);
  private readonly supabase = inject(SupabaseService).client;
  private readonly auth = inject(AuthService);
  readonly router = inject(Router);
  readonly route = inject(ActivatedRoute);

  readonly getDisplayName = getDisplayName;

  activeTab = signal<'matches' | 'players' | 'audit'>('matches');

  matches = signal<Match[]>([]);
  players = signal<Player[]>([]);
  auditLog = signal<AuditEntry[]>([]);
  loadingMatches = signal(true);
  loadingPlayers = signal(true);
  loadingAudit = signal(true);

  async ngOnInit(): Promise<void> {
    const player = this.auth.currentPlayer();
    if (!player) return;
    await Promise.all([
      this.loadMatches(player.group_id),
      this.loadPlayers(player.group_id),
      this.loadAudit(player.group_id),
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

  private async loadAudit(groupId: string): Promise<void> {
    try {
      this.auditLog.set(await this.matchesService.getAuditLog(groupId));
    } finally {
      this.loadingAudit.set(false);
    }
  }

  async reloadAudit(): Promise<void> {
    const player = this.auth.currentPlayer();
    if (!player) return;
    this.loadingAudit.set(true);
    await this.loadAudit(player.group_id);
  }

  editMatch(match: Match): void {
    this.router.navigate([`match/${match.id}`], { relativeTo: this.route });
  }

  editPlayer(player: Player): void {
    this.router.navigate([`player/${player.id}`], { relativeTo: this.route });
  }

  async toggleClose(match: Match): Promise<void> {
    const player = this.auth.currentPlayer();
    if (!player) return;
    await this.matchesService.updateMatch(
      match.id,
      { is_closed: !match.is_closed },
      player.id,
      { title: match.title }
    );
    await this.loadMatches(player.group_id);
    await this.loadAudit(player.group_id);
  }

  async deleteMatch(match: Match): Promise<void> {
    if (!confirm(`Supprimer "${match.title}" ?`)) return;
    const player = this.auth.currentPlayer();
    if (!player) return;
    await this.matchesService.deleteMatch(match.id, player.id, match.title);
    await this.loadMatches(player.group_id);
    await this.loadAudit(player.group_id);
  }

  formatDate(dateStr: string): string {
    return new Date(dateStr).toLocaleDateString('fr-FR', {
      weekday: 'short', day: 'numeric', month: 'short',
    });
  }

  formatTime(timeStr: string): string { return timeStr.slice(0, 5); }

  timeAgo(dateStr: string): string {
    const diff = Date.now() - new Date(dateStr).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return 'A l\'instant';
    if (mins < 60) return `${mins} min`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return `${hours}h`;
    const days = Math.floor(hours / 24);
    if (days === 1) return 'Hier';
    return `${days}j`;
  }

  formatAction(entry: AuditEntry): string {
    const actor = entry.actor_name ?? 'Inconnu';
    const d = entry.details;
    switch (entry.action) {
      case 'register': return `${actor} s'est inscrit`;
      case 'register_proxy': return `${actor} a inscrit ${d['player_name'] ?? '...'}`;
      case 'withdraw': return `${actor} s'est retiré`;
      case 'withdraw_proxy': return `${actor} a retiré ${d['player_name'] ?? '...'}`;
      case 'remove_registration': return `${actor} a supprimé l'inscription de ${d['player_name'] ?? '...'}`;
      case 'create_match': return `${actor} a créé "${d['title'] ?? 'match'}"`;
      case 'update_match': return `${actor} a modifié un match`;
      case 'delete_match': return `${actor} a supprimé "${d['title'] ?? 'match'}"`;
      case 'close_match': return `${actor} a figé un match`;
      case 'reopen_match': return `${actor} a rouvert un match`;
      case 'create_player': return `${actor} a créé le joueur "${d['username'] ?? '...'}"`;
      case 'update_player': return `${actor} a mis à jour un profil`;
      default: return `${actor} : ${entry.action}`;
    }
  }
}
