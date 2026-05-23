import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  OnInit,
  signal,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute } from '@angular/router';
import { AuthService } from '../../core/auth/auth.service';
import { SupabaseService } from '../../core/supabase/supabase.service';
import { Player, getDisplayName } from '../../shared/models/player.model';

@Component({
  selector: 'app-profile',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule],
  template: `
    <div class="container">
      <h2>Mon profil</h2>

      @if (auth.currentPlayer(); as player) {
        <!-- Pseudo affiché -->
        <section class="card">
          <h3>Pseudo affiché</h3>
          <div class="field-row">
            <input
              type="text"
              [(ngModel)]="newDisplayName"
              [placeholder]="player.username"
              maxlength="30"
            />
            <button
              class="btn-primary"
              (click)="saveDisplayName()"
              [disabled]="saving()"
            >
              @if (saving()) { ... } @else { Enregistrer }
            </button>
          </div>
          @if (displayNameFeedback()) {
            <p class="feedback success">{{ displayNameFeedback() }}</p>
          }
        </section>

        <!-- Changer PIN -->
        <section class="card">
          <h3>Changer mon PIN</h3>
          <div class="pin-fields">
            <div class="field">
              <label>Nouveau PIN</label>
              <input
                type="password"
                [(ngModel)]="newPin"
                inputmode="numeric"
                maxlength="6"
                placeholder="••••"
              />
            </div>
            <div class="field">
              <label>Confirmer</label>
              <input
                type="password"
                [(ngModel)]="confirmPin"
                inputmode="numeric"
                maxlength="6"
                placeholder="••••"
              />
            </div>
          </div>
          @if (pinError()) {
            <p class="feedback error">{{ pinError() }}</p>
          }
          @if (pinFeedback()) {
            <p class="feedback success">{{ pinFeedback() }}</p>
          }
          <button
            class="btn-primary"
            (click)="savePin()"
            [disabled]="savingPin() || !newPin || !confirmPin"
          >
            @if (savingPin()) { ... } @else { Confirmer }
          </button>
        </section>

        <!-- Liste des joueurs -->
        <section class="card">
          <h3>Joueurs du groupe ({{ groupPlayers().length }})</h3>
          @if (loadingPlayers()) {
            <p class="muted">Chargement...</p>
          } @else {
            <ul class="player-list">
              @for (p of groupPlayers(); track p.id) {
                <li [class.me]="p.id === player.id">
                  {{ displayName(p) }}
                  @if (p.id === player.id) { <span class="you-badge">toi</span> }
                  @if (p.is_admin) { <span class="admin-badge">admin</span> }
                </li>
              }
            </ul>
          }
        </section>
      }
    </div>
  `,
  styles: `
    .container { padding: 1rem; max-width: 560px; margin: 0 auto; }
    h2 { margin-top: 0; }
    .card {
      background: var(--card);
      border-radius: 0.75rem;
      padding: 1.25rem;
      border: 1.5px solid var(--border);
      margin-bottom: 1rem;
    }
    h3 { margin: 0 0 1rem; font-size: 0.9rem; text-transform: uppercase; letter-spacing: 0.04em; color: var(--text-muted); }
    .field-row { display: flex; gap: 0.6rem; }
    .field-row input { flex: 1; }
    .pin-fields { display: flex; gap: 0.75rem; margin-bottom: 0.75rem; }
    .field { flex: 1; }
    .field label { display: block; font-size: 0.8rem; font-weight: 600; color: var(--text-muted); margin-bottom: 0.35rem; }
    input {
      width: 100%;
      padding: 0.65rem 0.85rem;
      border: 1.5px solid var(--border);
      border-radius: 0.5rem;
      font-size: 0.95rem;
      background: var(--bg);
      color: var(--text);
      box-sizing: border-box;
    }
    input:focus { outline: none; border-color: var(--primary); }
    .btn-primary {
      padding: 0.65rem 1.1rem;
      background: var(--primary);
      color: white;
      border: none;
      border-radius: 0.5rem;
      font-size: 0.95rem;
      font-weight: 600;
      cursor: pointer;
      white-space: nowrap;
    }
    .btn-primary:disabled { opacity: 0.6; cursor: not-allowed; }
    .feedback { font-size: 0.85rem; margin: 0.5rem 0 0; }
    .success { color: var(--success); }
    .error { color: var(--danger); }
    .muted { color: var(--text-muted); }
    .player-list { list-style: none; padding: 0; margin: 0; display: flex; flex-direction: column; gap: 0.35rem; }
    .player-list li {
      padding: 0.5rem 0.75rem;
      border-radius: 0.4rem;
      font-size: 0.95rem;
      display: flex;
      align-items: center;
      gap: 0.5rem;
    }
    .player-list li.me { background: var(--primary-light); font-weight: 700; }
    .you-badge, .admin-badge {
      font-size: 0.7rem;
      padding: 0.15rem 0.45rem;
      border-radius: 1rem;
      font-weight: 700;
    }
    .you-badge { background: var(--primary); color: white; }
    .admin-badge { background: var(--warning); color: white; }
  `,
})
export class ProfileComponent implements OnInit {
  readonly auth = inject(AuthService);
  private readonly supabase = inject(SupabaseService).client;

  newDisplayName = '';
  newPin = '';
  confirmPin = '';

  saving = signal(false);
  savingPin = signal(false);
  displayNameFeedback = signal('');
  pinFeedback = signal('');
  pinError = signal('');
  groupPlayers = signal<Player[]>([]);
  loadingPlayers = signal(true);

  ngOnInit(): void {
    const player = this.auth.currentPlayer();
    if (player) {
      this.newDisplayName = player.display_name ?? '';
      this.loadPlayers(player.group_id);
    }
  }

  displayName(player: Player): string {
    return getDisplayName(player);
  }

  private async loadPlayers(groupId: string): Promise<void> {
    const { data } = await this.supabase
      .from('players')
      .select('id, group_id, username, display_name, is_admin, created_at')
      .eq('group_id', groupId)
      .order('username');
    this.groupPlayers.set(data ?? []);
    this.loadingPlayers.set(false);
  }

  async saveDisplayName(): Promise<void> {
    const player = this.auth.currentPlayer();
    if (!player) return;
    this.saving.set(true);
    this.displayNameFeedback.set('');
    try {
      await this.supabase.rpc('update_player_profile', {
        p_player_id: player.id,
        p_display_name: this.newDisplayName.trim() || null,
      });
      this.auth.updateCurrentPlayer({ display_name: this.newDisplayName.trim() || null });
      this.displayNameFeedback.set('Pseudo mis à jour !');
      setTimeout(() => this.displayNameFeedback.set(''), 2500);
    } catch {
      this.displayNameFeedback.set('Erreur lors de la sauvegarde');
    } finally {
      this.saving.set(false);
    }
  }

  async savePin(): Promise<void> {
    this.pinError.set('');
    if (this.newPin.length < 4) {
      this.pinError.set('Le PIN doit contenir au moins 4 chiffres');
      return;
    }
    if (this.newPin !== this.confirmPin) {
      this.pinError.set('Les PINs ne correspondent pas');
      return;
    }
    const player = this.auth.currentPlayer();
    if (!player) return;
    this.savingPin.set(true);
    try {
      await this.supabase.rpc('update_player_profile', {
        p_player_id: player.id,
        p_new_pin: this.newPin,
      });
      this.newPin = '';
      this.confirmPin = '';
      this.pinFeedback.set('PIN mis à jour !');
      setTimeout(() => this.pinFeedback.set(''), 2500);
    } catch {
      this.pinError.set('Erreur lors de la mise à jour du PIN');
    } finally {
      this.savingPin.set(false);
    }
  }
}
