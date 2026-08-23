import {
  ChangeDetectionStrategy,
  Component,
  inject,
  OnInit,
  signal,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { AuthService } from '../../../core/auth/auth.service';
import { GroupsService } from '../../../core/groups/groups.service';

@Component({
  selector: 'app-group-settings',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule],
  template: `
    <div class="container">
      @if (loading()) {
        <p class="muted">Chargement...</p>
      } @else {
        <form (ngSubmit)="onSubmit()" class="form">
          <div class="field checkbox-field">
            <label>
              <input type="checkbox" [(ngModel)]="form.guestsEnabled" name="guestsEnabled" />
              Autoriser les invités (+1)
            </label>
          </div>

          <div class="field">
            <label>Invités max par joueur (laisser vide pour illimité)</label>
            <input
              type="number"
              min="0"
              [(ngModel)]="form.maxGuestsPerPlayer"
              name="maxGuestsPerPlayer"
              [disabled]="!form.guestsEnabled"
              placeholder="Illimité"
            />
          </div>

          <div class="field checkbox-field">
            <label>
              <input type="checkbox" [(ngModel)]="form.miniMatchEnabled" name="miniMatchEnabled" />
              Activer le mini-match
            </label>
          </div>

          @if (error()) {
            <p class="error">{{ error() }}</p>
          }
          @if (success()) {
            <p class="feedback-success">{{ success() }}</p>
          }

          <div class="actions">
            <button type="submit" class="btn-primary" [disabled]="saving()">
              @if (saving()) { ... } @else { Enregistrer }
            </button>
          </div>
        </form>
      }
    </div>
  `,
  styles: `
    .container { padding: 0; max-width: 480px; }
    .form { display: flex; flex-direction: column; gap: 1rem; }
    .field { display: flex; flex-direction: column; gap: 0.35rem; }
    .checkbox-field { flex-direction: row; align-items: center; gap: 0.5rem; }
    .checkbox-field label { display: flex; align-items: center; gap: 0.5rem; font-size: 0.95rem; font-weight: 500; cursor: pointer; color: var(--text); }
    label { font-size: 0.85rem; font-weight: 600; color: var(--text-muted); }
    input[type="number"] {
      padding: 0.65rem 0.85rem;
      border: 1.5px solid var(--border);
      border-radius: 0.5rem;
      font-size: 0.95rem;
      background: var(--card);
      color: var(--text);
      max-width: 10rem;
    }
    input:focus { outline: none; border-color: var(--primary); }
    input:disabled { opacity: 0.5; }
    .error { color: var(--danger); font-size: 0.9rem; }
    .feedback-success { color: var(--success); font-size: 0.9rem; }
    .muted { color: var(--text-muted); }
    .actions { display: flex; gap: 0.75rem; justify-content: flex-end; }
    .btn-primary {
      padding: 0.65rem 1.25rem;
      background: var(--primary);
      color: white;
      border: none;
      border-radius: 0.5rem;
      font-size: 0.95rem;
      font-weight: 600;
      cursor: pointer;
    }
    .btn-primary:disabled { opacity: 0.6; cursor: not-allowed; }
  `,
})
export class GroupSettingsComponent implements OnInit {
  private readonly groupsService = inject(GroupsService);
  private readonly auth = inject(AuthService);

  loading = signal(true);
  saving = signal(false);
  error = signal('');
  success = signal('');

  private groupId = '';

  form = {
    guestsEnabled: true,
    maxGuestsPerPlayer: null as number | null,
    miniMatchEnabled: false,
  };

  async ngOnInit(): Promise<void> {
    const player = this.auth.currentPlayer();
    if (!player) return;
    this.groupId = player.group_id;
    try {
      const group = await this.groupsService.getGroup(this.groupId);
      this.form.guestsEnabled = group.guests_enabled;
      this.form.maxGuestsPerPlayer = group.max_guests_per_player;
      this.form.miniMatchEnabled = group.mini_match_enabled;
    } catch {
      this.error.set('Erreur lors du chargement des réglages');
    } finally {
      this.loading.set(false);
    }
  }

  async onSubmit(): Promise<void> {
    const player = this.auth.currentPlayer();
    if (!player) return;
    this.saving.set(true);
    this.error.set('');
    this.success.set('');

    try {
      await this.groupsService.updateGroupSettings(
        this.groupId,
        player.id,
        this.form.guestsEnabled,
        this.form.maxGuestsPerPlayer,
        this.form.miniMatchEnabled
      );
      this.success.set('Réglages enregistrés !');
    } catch {
      this.error.set('Erreur lors de la sauvegarde');
    } finally {
      this.saving.set(false);
    }
  }
}
