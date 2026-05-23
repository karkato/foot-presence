import {
  ChangeDetectionStrategy,
  Component,
  inject,
  OnInit,
  signal,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { AuthService } from '../../../core/auth/auth.service';
import { SupabaseService } from '../../../core/supabase/supabase.service';
import { Player, getDisplayName } from '../../../shared/models/player.model';

@Component({
  selector: 'app-player-form',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule],
  template: `
    <div class="container">
      <h2>{{ isEdit() ? 'Modifier le joueur' : 'Nouveau joueur' }}</h2>

      <form (ngSubmit)="onSubmit()" class="form">
        @if (!isEdit()) {
          <div class="field">
            <label>Pseudo (identifiant de connexion)</label>
            <input
              type="text"
              [(ngModel)]="form.username"
              name="username"
              required
              autocapitalize="none"
              placeholder="nagz"
            />
          </div>
          <div class="field">
            <label>PIN (4 chiffres min.)</label>
            <input
              type="password"
              [(ngModel)]="form.pin"
              name="pin"
              inputmode="numeric"
              maxlength="6"
              placeholder="••••"
              required
            />
          </div>
        }

        <div class="field">
          <label>Pseudo affiché (optionnel)</label>
          <input
            type="text"
            [(ngModel)]="form.display_name"
            name="display_name"
            placeholder="Nagz"
            maxlength="30"
          />
        </div>

        @if (isEdit()) {
          <div class="field">
            <label>Nouveau PIN (laisser vide pour ne pas changer)</label>
            <input
              type="password"
              [(ngModel)]="form.pin"
              name="pin"
              inputmode="numeric"
              maxlength="6"
              placeholder="••••"
            />
          </div>
        }

        <div class="field checkbox-field">
          <label>
            <input type="checkbox" [(ngModel)]="form.is_admin" name="is_admin" />
            Administrateur
          </label>
        </div>

        @if (error()) {
          <p class="error">{{ error() }}</p>
        }

        <div class="actions">
          <button type="button" class="btn-cancel" (click)="goBack()">Annuler</button>
          <button type="submit" class="btn-primary" [disabled]="saving()">
            @if (saving()) { ... } @else { Enregistrer }
          </button>
        </div>
      </form>
    </div>
  `,
  styles: `
    .container { padding: 1rem; max-width: 480px; margin: 0 auto; }
    h2 { margin-top: 0; }
    .form { display: flex; flex-direction: column; gap: 1rem; }
    .field { display: flex; flex-direction: column; gap: 0.35rem; }
    .checkbox-field { flex-direction: row; align-items: center; gap: 0.5rem; }
    .checkbox-field label { display: flex; align-items: center; gap: 0.5rem; font-size: 0.95rem; font-weight: 500; cursor: pointer; color: var(--text); }
    label { font-size: 0.85rem; font-weight: 600; color: var(--text-muted); }
    input[type="text"], input[type="password"] {
      padding: 0.65rem 0.85rem;
      border: 1.5px solid var(--border);
      border-radius: 0.5rem;
      font-size: 0.95rem;
      background: var(--bg);
      color: var(--text);
    }
    input:focus { outline: none; border-color: var(--primary); }
    .error { color: var(--danger); font-size: 0.9rem; }
    .actions { display: flex; gap: 0.75rem; justify-content: flex-end; }
    .btn-cancel {
      padding: 0.65rem 1.25rem;
      background: var(--border);
      border: none;
      border-radius: 0.5rem;
      font-size: 0.95rem;
      cursor: pointer;
    }
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
export class PlayerFormComponent implements OnInit {
  private readonly supabase = inject(SupabaseService).client;
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);

  isEdit = signal(false);
  saving = signal(false);
  error = signal('');
  playerId = '';

  form = {
    username: '',
    display_name: '',
    pin: '',
    is_admin: false,
  };

  async ngOnInit(): Promise<void> {
    const id = this.route.snapshot.params['id'];
    if (id && id !== 'new') {
      this.isEdit.set(true);
      this.playerId = id;
      const { data } = await this.supabase
        .from('players')
        .select('*')
        .eq('id', id)
        .single();
      if (data) {
        this.form.display_name = data.display_name ?? '';
        this.form.is_admin = data.is_admin;
      }
    }
  }

  async onSubmit(): Promise<void> {
    const currentPlayer = this.auth.currentPlayer();
    if (!currentPlayer) return;
    this.saving.set(true);
    this.error.set('');

    try {
      if (this.isEdit()) {
        await this.supabase.rpc('update_player_profile', {
          p_player_id: this.playerId,
          p_display_name: this.form.display_name.trim() || null,
          p_new_pin: this.form.pin || null,
        });
        if (this.form.is_admin !== undefined) {
          await this.supabase
            .from('players')
            .update({ is_admin: this.form.is_admin })
            .eq('id', this.playerId);
        }
      } else {
        if (!this.form.username.trim() || !this.form.pin) {
          this.error.set('Pseudo et PIN requis');
          return;
        }
        await this.supabase.rpc('create_player', {
          p_group_id: currentPlayer.group_id,
          p_username: this.form.username.trim().toLowerCase(),
          p_pin: this.form.pin,
          p_display_name: this.form.display_name.trim() || null,
          p_is_admin: this.form.is_admin,
        });
      }
      this.goBack();
    } catch (err) {
      const msg = err instanceof Error && err.message.includes('unique')
        ? 'Ce pseudo existe déjà dans le groupe'
        : 'Erreur lors de la sauvegarde';
      this.error.set(msg);
    } finally {
      this.saving.set(false);
    }
  }

  goBack(): void {
    this.router.navigate(['../../'], { relativeTo: this.route });
  }
}
