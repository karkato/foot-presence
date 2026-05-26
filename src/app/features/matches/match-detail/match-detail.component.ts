import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  OnDestroy,
  OnInit,
  signal,
} from '@angular/core';
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
  imports: [PlayerRowComponent, RegistrationModalComponent],
  template: `
    @if (loading()) {
      <div class="loading-state">Chargement...</div>
    } @else if (!match()) {
      <div class="loading-state">Match introuvable.</div>
    } @else {
      <div class="container">

        <!-- En-tête du match -->
        <div class="match-header">
          <div class="match-title-row">
            <h2>{{ match()!.title }}</h2>
            @if (match()!.is_closed) {
              <span class="badge-closed">Fermé</span>
            }
          </div>
          <p class="match-meta">
            {{ formatDate(match()!.match_date) }} à {{ formatTime(match()!.match_time) }}
            &nbsp;·&nbsp;
            <strong [class.full]="isFull()">{{ presentCount() }}/{{ match()!.max_players }}</strong>
          </p>

          <!-- Actions de partage -->
          <div class="share-actions">
            <button class="btn-share" (click)="copyMatchLink()">
              🔗 Copier lien
            </button>
            <button class="btn-share" (click)="shareList()">
              📤 Partager liste
            </button>
          </div>
          @if (copyFeedback()) {
            <p class="copy-feedback">{{ copyFeedback() }}</p>
          }
        </div>

        <!-- Listes -->
        <div class="lists-grid">

          <!-- Présents -->
          <section class="list-section">
            <h3>Présents ({{ presentCount() }})</h3>
            @if (presentPlayers().length === 0) {
              <p class="muted">Personne pour l'instant.</p>
            } @else {
              <ul class="player-list">
                @for (entry of expandedPresent(); track entry.rank) {
                  @if (entry.type === 'player') {
                    <app-player-row
                      [reg]="entry.reg"
                      [rank]="entry.rank"
                      [prefix]="String(entry.rank) + '.'"
                      [isCurrent]="isCurrentPlayer(entry.reg)"
                      [canWithdraw]="canWithdraw(entry.reg)"
                      (withdraw)="onWithdraw($event)"
                    />
                  } @else {
                    <li class="guest-row">
                      <span class="guest-rank">{{ entry.rank }}.</span>
                      <span class="guest-name">+1 de {{ entry.hostName }}</span>
                    </li>
                  }
                }
              </ul>
            }
          </section>

          <!-- Désistements -->
          @if (withdrawnPlayers().length > 0) {
            <section class="list-section withdrawn-section">
              <h3>Désistements ({{ withdrawnPlayers().length }})</h3>
              <ul class="player-list">
                @for (reg of withdrawnPlayers(); track reg.id; let i = $index) {
                  <app-player-row
                    [reg]="reg"
                    [rank]="i + 1"
                    [prefix]="'D' + (i + 1) + '.'"
                    [isCurrent]="isCurrentPlayer(reg)"
                    [canWithdraw]="false"
                    [canDelete]="isAdmin()"
                    (delete)="onDeleteRegistration($event)"
                  />
                }
              </ul>
            </section>
          }
        </div>

        <!-- Actions du joueur -->
        @if (!match()!.is_closed) {
          <div class="actions">
            @if (!isRegistered()) {
              <button class="btn-action btn-join" (click)="onRegister()" [disabled]="actionLoading()">
                Je viens
              </button>
            } @else if (!isWithdrawn()) {
              <button class="btn-action btn-withdraw" (click)="onWithdraw(currentPlayerId())" [disabled]="actionLoading()">
                Je me retire
              </button>
            } @else {
              <button class="btn-action btn-join" (click)="onRegister()" [disabled]="actionLoading()">
                Je reviens
              </button>
            }

            @if (canAddProxy()) {
              <button class="btn-action btn-proxy" (click)="showModal.set(true)">
                + Inscrire quelqu'un ({{ proxyCount() }}/2)
              </button>
            }

            @if (isRegistered() && !isWithdrawn()) {
              <div class="plus-ones-control">
                <span class="plus-ones-label">Invités</span>
                <div class="plus-ones-stepper">
                  <button (click)="onAdjustPlusOnes(-1)" [disabled]="myPlusOnes() === 0 || actionLoading()">−</button>
                  <span>{{ myPlusOnes() }}</span>
                  <button (click)="onAdjustPlusOnes(1)" [disabled]="actionLoading()">+</button>
                </div>
              </div>
            }
          </div>

          @if (actionError()) {
            <p class="action-error">{{ actionError() }}</p>
          }
        }

        <!-- Action admin : figer / rouvrir -->
        @if (isAdmin()) {
          <div class="admin-freeze">
            @if (!match()!.is_closed) {
              <button class="btn-freeze" (click)="toggleClose()" [disabled]="actionLoading()">
                Figer la liste
              </button>
            } @else {
              <button class="btn-unfreeze" (click)="toggleClose()" [disabled]="actionLoading()">
                Rouvrir les inscriptions
              </button>
            }
          </div>
        }
      </div>

      <!-- Section admin : gestion des présences -->
      @if (isAdmin()) {
        <div class="admin-section">
          <h3 class="admin-title">Gestion présences</h3>
          <ul class="admin-player-list">
            @for (player of allPlayers(); track player.id) {
              <li
                class="admin-player-row"
                [class.present]="isPlayerPresent(player.id)"
                (click)="adminToggle(player)"
              >
                <span class="admin-checkbox" [class.checked]="isPlayerPresent(player.id)">
                  @if (isPlayerPresent(player.id)) { ✓ }
                </span>
                <span class="admin-name">{{ getDisplayName(player) }}</span>
                @if (isPlayerPresent(player.id)) {
                  <div class="admin-plus-stepper" (click)="$event.stopPropagation()">
                    <button (click)="adminAdjustPlusOnes(player, -1)" [disabled]="getPlayerPlusOnes(player.id) === 0 || actionLoading()">−</button>
                    <span>+{{ getPlayerPlusOnes(player.id) }}</span>
                    <button (click)="adminAdjustPlusOnes(player, 1)" [disabled]="actionLoading()">+</button>
                  </div>
                }
              </li>
            }
          </ul>
        </div>
      }

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
    .loading-state {
      display: flex; align-items: center; justify-content: center;
      min-height: 50vh; color: var(--text-muted); font-size: 1.1rem;
    }
    .container { padding: 1rem; max-width: 600px; margin: 0 auto; }

    .match-header { margin-bottom: 1.25rem; }
    .match-title-row { display: flex; align-items: center; gap: 0.75rem; flex-wrap: wrap; }
    .match-title-row h2 { margin: 0; }
    .badge-closed {
      background: var(--border); color: var(--text-muted);
      font-size: 0.75rem; padding: 0.2rem 0.6rem;
      border-radius: 1rem; font-weight: 600;
    }
    .match-meta { color: var(--text-muted); margin: 0.35rem 0 0.75rem; font-size: 0.9rem; }
    .match-meta strong { color: var(--text); }
    .match-meta strong.full { color: var(--danger); }

    .share-actions { display: flex; gap: 0.5rem; flex-wrap: wrap; }
    .btn-share {
      padding: 0.4rem 0.85rem;
      background: var(--card);
      border: 1.5px solid var(--border);
      border-radius: 0.5rem;
      font-size: 0.85rem;
      cursor: pointer;
      font-weight: 500;
      transition: all 0.15s;
    }
    .btn-share:hover { border-color: var(--primary); color: var(--primary); }
    .copy-feedback { font-size: 0.8rem; color: var(--success); margin: 0.35rem 0 0; }

    .lists-grid { display: flex; flex-direction: column; gap: 1rem; }
    .list-section {
      background: var(--card);
      border-radius: 0.75rem;
      padding: 1rem;
      border: 1.5px solid var(--border);
    }
    .list-section h3 { margin: 0 0 0.75rem; font-size: 0.95rem; color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.04em; }
    .withdrawn-section { opacity: 0.75; }
    .player-list { list-style: none; padding: 0; margin: 0; }
    .muted { color: var(--text-muted); font-size: 0.9rem; padding: 0.5rem 0; }
    .guest-row {
      display: flex;
      align-items: center;
      gap: 0.6rem;
      padding: 0.55rem 0.75rem;
      border-radius: 0.4rem;
      opacity: 0.75;
    }
    .guest-rank { min-width: 2rem; font-size: 0.8rem; font-weight: 700; color: var(--text-muted); text-align: right; }
    .guest-name { font-size: 0.9rem; color: var(--text-muted); font-style: italic; }

    .actions {
      display: flex;
      flex-direction: column;
      gap: 0.6rem;
      margin-top: 1.25rem;
    }
    .btn-action {
      width: 100%;
      padding: 0.85rem;
      border: none;
      border-radius: 0.6rem;
      font-size: 1rem;
      font-weight: 700;
      cursor: pointer;
      transition: all 0.15s;
    }
    .btn-join { background: var(--success); color: white; }
    .btn-join:hover:not(:disabled) { filter: brightness(1.1); }
    .btn-withdraw { background: var(--danger); color: white; }
    .btn-withdraw:hover:not(:disabled) { filter: brightness(1.1); }
    .btn-proxy {
      background: var(--card);
      color: var(--primary);
      border: 1.5px solid var(--primary);
    }
    .btn-proxy:hover { background: var(--primary-light); }
    .btn-action:disabled { opacity: 0.6; cursor: not-allowed; }
    .action-error { color: var(--danger); font-size: 0.9rem; text-align: center; margin-top: 0.5rem; }

    .plus-ones-control {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 0.65rem 1rem;
      background: var(--card);
      border: 1.5px solid var(--border);
      border-radius: 0.6rem;
    }
    .plus-ones-label { font-size: 0.95rem; font-weight: 600; }
    .plus-ones-stepper { display: flex; align-items: center; gap: 1rem; }
    .plus-ones-stepper span { font-size: 1.1rem; font-weight: 700; min-width: 1.5rem; text-align: center; }
    .plus-ones-stepper button {
      width: 2rem; height: 2rem;
      border-radius: 50%;
      border: 1.5px solid var(--border);
      background: var(--bg);
      font-size: 1.2rem;
      line-height: 1;
      cursor: pointer;
      font-weight: 700;
      color: var(--text);
      transition: border-color 0.15s;
    }
    .plus-ones-stepper button:hover:not(:disabled) { border-color: var(--primary); color: var(--primary); }
    .plus-ones-stepper button:disabled { opacity: 0.4; cursor: not-allowed; }

    .admin-freeze { margin-top: 1rem; }
    .btn-freeze {
      width: 100%;
      padding: 0.75rem;
      background: var(--warning);
      color: white;
      border: none;
      border-radius: 0.6rem;
      font-size: 0.95rem;
      font-weight: 700;
      cursor: pointer;
      transition: filter 0.15s;
    }
    .btn-freeze:hover:not(:disabled) { filter: brightness(1.1); }
    .btn-unfreeze {
      width: 100%;
      padding: 0.75rem;
      background: var(--card);
      color: var(--primary);
      border: 1.5px solid var(--primary);
      border-radius: 0.6rem;
      font-size: 0.95rem;
      font-weight: 700;
      cursor: pointer;
      transition: background 0.15s;
    }
    .btn-unfreeze:hover:not(:disabled) { background: var(--primary-light); }
    .btn-freeze:disabled, .btn-unfreeze:disabled { opacity: 0.6; cursor: not-allowed; }

    .admin-section {
      margin-top: 1.5rem;
      background: var(--card);
      border: 1.5px solid var(--border);
      border-radius: 0.75rem;
      padding: 1rem;
    }
    .admin-title {
      margin: 0 0 0.75rem;
      font-size: 0.85rem;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      color: var(--text-muted);
    }
    .admin-player-list { list-style: none; padding: 0; margin: 0; display: flex; flex-direction: column; gap: 0.25rem; }
    .admin-player-row {
      display: flex;
      align-items: center;
      gap: 0.75rem;
      padding: 0.5rem 0.6rem;
      border-radius: 0.4rem;
      cursor: pointer;
      transition: background 0.1s;
    }
    .admin-player-row:hover { background: var(--border); }
    .admin-player-row.present { background: color-mix(in srgb, var(--success) 12%, transparent); }
    .admin-checkbox {
      width: 1.25rem;
      height: 1.25rem;
      border-radius: 0.3rem;
      border: 2px solid var(--border);
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 0.75rem;
      font-weight: 700;
      flex-shrink: 0;
      color: white;
    }
    .admin-checkbox.checked { background: var(--success); border-color: var(--success); }
    .admin-name { font-size: 0.9rem; flex: 1; }
    .admin-plus-stepper {
      display: flex;
      align-items: center;
      gap: 0.5rem;
    }
    .admin-plus-stepper span { font-size: 0.85rem; font-weight: 700; color: var(--primary); min-width: 1.5rem; text-align: center; }
    .admin-plus-stepper button {
      width: 1.6rem; height: 1.6rem;
      border-radius: 50%;
      border: 1.5px solid var(--border);
      background: var(--bg);
      font-size: 1rem;
      line-height: 1;
      cursor: pointer;
      font-weight: 700;
      color: var(--text);
    }
    .admin-plus-stepper button:disabled { opacity: 0.4; cursor: not-allowed; }
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
  copyFeedback = signal('');

  private channel: RealtimeChannel | null = null;
  private feedbackTimeout: ReturnType<typeof setTimeout> | null = null;

  readonly matchId = this.route.snapshot.params['id'] as string;
  readonly groupSlug = this.route.snapshot.params['groupSlug'] as string;

  currentPlayerId = computed(() => this.auth.currentPlayer()?.id ?? '');
  isAdmin = computed(() => this.auth.isAdmin());

  presentPlayers = computed(() =>
    this.registrations()
      .filter((r) => !r.is_withdrawn)
      .sort((a, b) => new Date(a.registered_at).getTime() - new Date(b.registered_at).getTime())
  );

  withdrawnPlayers = computed(() =>
    this.registrations()
      .filter((r) => r.is_withdrawn)
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
  myPlusOnes = computed(() => {
    const reg = this.registrations().find(
      (r) => r.player_id === this.currentPlayerId() && !r.is_withdrawn
    );
    return reg?.plus_ones ?? 0;
  });
  isFull = computed(() => {
    const m = this.match();
    return m ? this.presentCount() >= m.max_players : false;
  });

  isRegistered = computed(() =>
    this.registrations().some((r) => r.player_id === this.currentPlayerId())
  );
  isWithdrawn = computed(() =>
    this.registrations().some(
      (r) => r.player_id === this.currentPlayerId() && r.is_withdrawn
    )
  );

  proxyCount = computed(() =>
    this.registrations().filter(
      (r) =>
        !r.is_withdrawn &&
        r.registered_by === this.currentPlayerId() &&
        r.player_id !== this.currentPlayerId()
    ).length
  );
  canAddProxy = computed(() => this.proxyCount() < 2);

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
    } catch {
      this.match.set(null);
    }
  }

  private async loadRegistrations(): Promise<void> {
    try {
      const regs = await this.matchesService.getRegistrations(this.matchId);
      this.registrations.set(regs);
    } catch {
      this.registrations.set([]);
    }
  }

  private async loadPlayers(): Promise<void> {
    const player = this.auth.currentPlayer();
    if (!player) return;
    try {
      const players = await this.matchesService.getGroupPlayers(player.group_id);
      this.allPlayers.set(players);
    } catch {
      this.allPlayers.set([]);
    }
  }

  private subscribeToRealtime(): void {
    this.channel = this.supabase
      .channel(`match-${this.matchId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'registrations', filter: `match_id=eq.${this.matchId}` },
        () => this.loadRegistrations()
      )
      .subscribe();
  }

  isCurrentPlayer(reg: Registration): boolean {
    return reg.player_id === this.currentPlayerId();
  }

  canWithdraw(reg: Registration): boolean {
    const currentId = this.currentPlayerId();
    const m = this.match();
    if (!m || m.is_closed) return false;
    if (reg.is_withdrawn) return false;
    return reg.player_id === currentId || reg.registered_by === currentId;
  }

  async onRegister(): Promise<void> {
    const player = this.auth.currentPlayer();
    if (!player) return;
    this.actionLoading.set(true);
    this.actionError.set('');
    try {
      await this.matchesService.registerPlayer(this.matchId, player.id, player.id);
      await this.loadRegistrations();
    } catch (err) {
      this.actionError.set('Erreur lors de l\'inscription');
    } finally {
      this.actionLoading.set(false);
    }
  }

  async onWithdraw(playerId: string): Promise<void> {
    const currentPlayer = this.auth.currentPlayer();
    if (!currentPlayer) return;
    this.actionLoading.set(true);
    this.actionError.set('');
    try {
      await this.matchesService.withdrawPlayer(this.matchId, playerId, currentPlayer.id);
      await this.loadRegistrations();
    } catch {
      this.actionError.set('Erreur lors du retrait');
    } finally {
      this.actionLoading.set(false);
    }
  }

  async onRegisterProxy(playerId: string): Promise<void> {
    const currentPlayer = this.auth.currentPlayer();
    if (!currentPlayer) return;
    this.actionError.set('');
    try {
      await this.matchesService.registerPlayer(this.matchId, playerId, currentPlayer.id);
      await this.loadRegistrations();
    } catch (err) {
      const msg = err instanceof Error && err.message.includes('proxy_limit_reached')
        ? 'Limite de 2 procurations atteinte'
        : 'Erreur lors de l\'inscription';
      this.actionError.set(msg);
    }
  }

  copyMatchLink(): void {
    const url = `${window.location.origin}/${this.groupSlug}/match/${this.matchId}`;
    navigator.clipboard.writeText(url).then(() => {
      this.showFeedback('Lien copié !');
    });
  }

  shareList(): void {
    const m = this.match();
    if (!m) return;
    const present = this.expandedPresent()
      .map((entry) => {
        if (entry.type === 'player') {
          return `${entry.rank}. ${getDisplayName(entry.reg.player)}`;
        } else {
          return `${entry.rank}. +1 de ${entry.hostName}`;
        }
      })
      .join('\n');
    const withdrawn = this.withdrawnPlayers()
      .map((r, i) => `D${i + 1}. ${r.player.display_name ?? r.player.username}`)
      .join('\n');

    const text = [
      `⚽ ${m.title} — ${this.presentCount()}/${m.max_players}`,
      '',
      'Présents :',
      present || 'Aucun',
      ...(withdrawn ? ['', 'Désistements :', withdrawn] : []),
    ].join('\n');

    const encoded = encodeURIComponent(text);
    if (navigator.share) {
      navigator.share({ text });
    } else {
      window.open(`https://wa.me/?text=${encoded}`, '_blank');
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
    } catch {
      this.actionError.set('Erreur lors de la mise à jour');
    } finally {
      this.actionLoading.set(false);
    }
  }

  async toggleClose(): Promise<void> {
    const m = this.match();
    const player = this.auth.currentPlayer();
    if (!m || !player) return;
    this.actionLoading.set(true);
    try {
      await this.matchesService.updateMatch(
        m.id,
        { is_closed: !m.is_closed },
        player.id,
        { title: m.title }
      );
      await this.loadMatch();
    } catch {
      this.actionError.set('Erreur lors de la mise à jour');
    } finally {
      this.actionLoading.set(false);
    }
  }

  async onDeleteRegistration(playerId: string): Promise<void> {
    const admin = this.auth.currentPlayer();
    if (!admin) return;
    this.actionLoading.set(true);
    try {
      await this.matchesService.adminRemoveRegistration(admin.id, this.matchId, playerId);
      await this.loadRegistrations();
    } catch {
      this.actionError.set('Erreur lors de la suppression');
    } finally {
      this.actionLoading.set(false);
    }
  }

  isPlayerPresent(playerId: string): boolean {
    return this.registrations().some((r) => r.player_id === playerId && !r.is_withdrawn);
  }

  getPlayerPlusOnes(playerId: string): number {
    const reg = this.registrations().find((r) => r.player_id === playerId && !r.is_withdrawn);
    return reg?.plus_ones ?? 0;
  }

  async adminAdjustPlusOnes(player: Player, delta: number): Promise<void> {
    const newCount = Math.max(0, this.getPlayerPlusOnes(player.id) + delta);
    this.actionLoading.set(true);
    try {
      await this.matchesService.setPlusOnes(this.matchId, player.id, newCount);
      await this.loadRegistrations();
    } catch {
      this.actionError.set('Erreur lors de la mise à jour');
    } finally {
      this.actionLoading.set(false);
    }
  }

  async adminToggle(player: Player): Promise<void> {
    const currentPlayer = this.auth.currentPlayer();
    if (!currentPlayer) return;
    if (this.isPlayerPresent(player.id)) {
      await this.onWithdraw(player.id);
    } else {
      this.actionLoading.set(true);
      this.actionError.set('');
      try {
        await this.matchesService.registerPlayer(this.matchId, player.id, currentPlayer.id);
        await this.loadRegistrations();
      } catch {
        this.actionError.set('Erreur lors de l\'inscription');
      } finally {
        this.actionLoading.set(false);
      }
    }
  }

  private showFeedback(msg: string): void {
    this.copyFeedback.set(msg);
    if (this.feedbackTimeout) clearTimeout(this.feedbackTimeout);
    this.feedbackTimeout = setTimeout(() => this.copyFeedback.set(''), 2500);
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
