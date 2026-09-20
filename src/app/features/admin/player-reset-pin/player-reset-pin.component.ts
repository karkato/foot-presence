import { ChangeDetectionStrategy, ChangeDetectorRef, Component, inject, OnInit, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { AuthService } from '../../../core/auth/auth.service';
import { SupabaseService } from '../../../core/supabase/supabase.service';
import { MatchesService } from '../../matches/matches.service';
import { getDisplayName } from '../../../shared/models/player.model';
import { validatePin } from '../../../shared/utils/pin';
import { mapAuthRpcError } from '../../../shared/utils/rpc-error';

@Component({
  selector: 'app-player-reset-pin',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule],
  template: `
    <div class="container-form">
      @if (loading()) {
        <p class="muted">Chargement...</p>
      } @else if (!playerName()) {
        <p class="muted">Joueur introuvable.</p>
      } @else {
        <h2>Réinitialiser le PIN de {{ playerName() }}</h2>
        <p class="hint">Le nouveau PIN sera appliqué immédiatement. Communique-le au joueur par un autre canal : il n'est ni affiché ni enregistré ailleurs que sur cet écran.</p>

        <form (ngSubmit)="onSubmit()" class="form">
          <div class="field">
            <label>Nouveau PIN</label>
            <input
              type="password"
              [(ngModel)]="newPin"
              name="newPin"
              inputmode="numeric"
              maxlength="6"
              placeholder="••••"
              autocomplete="off"
              required
            />
          </div>
          <div class="field">
            <label>Confirmer le PIN</label>
            <input
              type="password"
              [(ngModel)]="confirmPin"
              name="confirmPin"
              inputmode="numeric"
              maxlength="6"
              placeholder="••••"
              autocomplete="off"
              required
            />
          </div>

          @if (error()) { <p class="error">{{ error() }}</p> }
          @if (feedback()) { <p class="feedback-success">{{ feedback() }}</p> }

          <div class="actions">
            <button type="button" class="btn-cancel" (click)="goBack()">{{ feedback() ? 'Retour' : 'Annuler' }}</button>
            <button type="submit" class="btn btn-primary" [disabled]="saving() || !newPin || !confirmPin">
              @if (saving()) { ... } @else { Réinitialiser }
            </button>
          </div>
        </form>
      }
    </div>
  `,
  styles: `
    h2 { margin-top: 0; }
    .hint { font-size: 0.85rem; color: var(--text-muted); margin: 0 0 1rem; }
    .form { display: flex; flex-direction: column; gap: 1rem; }
    .field { display: flex; flex-direction: column; gap: 0.35rem; }
    label { font-size: 0.85rem; font-weight: 600; color: var(--text-muted); }
    input[type="password"] {
      padding: 0.65rem 0.85rem;
      border: var(--border-1);
      border-radius: 0.5rem;
      font-size: var(--fs-field);
      background: var(--card);
      color: var(--text);
    }
    input:focus { outline: none; border-color: var(--primary); }
    .error { color: var(--danger); font-size: 0.9rem; }
    .feedback-success { color: var(--success); font-size: 0.9rem; }
    .actions { display: flex; gap: 0.75rem; justify-content: flex-end; }
    .btn-cancel {
      min-height: var(--tap);
      display: inline-flex;
      align-items: center;
      justify-content: center;
      padding: 0.65rem 1.25rem;
      background: var(--border);
      border: none;
      border-radius: 0.5rem;
      font-size: 0.95rem;
      cursor: pointer;
    }
    .btn-primary { padding: 0.65rem 1.25rem; }
  `,
})
export class PlayerResetPinComponent implements OnInit {
  private readonly supabase = inject(SupabaseService).client;
  private readonly matchesService = inject(MatchesService);
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly cdr = inject(ChangeDetectorRef);

  private playerId = '';

  loading = signal(true);
  saving = signal(false);
  error = signal('');
  feedback = signal('');
  playerName = signal('');

  newPin = '';
  confirmPin = '';

  async ngOnInit(): Promise<void> {
    this.playerId = this.route.snapshot.params['id'];
    const { data, error } = await this.supabase
      .from('players')
      .select('id, group_id, username, display_name, is_admin, created_at')
      .eq('id', this.playerId)
      .single();
    if (!error && data) {
      this.playerName.set(getDisplayName(data));
    }
    this.loading.set(false);
    this.cdr.markForCheck();
  }

  async onSubmit(): Promise<void> {
    this.error.set('');
    this.feedback.set('');

    const formatError = validatePin(this.newPin);
    if (formatError) {
      this.error.set(formatError);
      return;
    }
    if (this.newPin !== this.confirmPin) {
      this.error.set('Les PINs ne correspondent pas');
      return;
    }

    const actor = this.auth.currentPlayer();
    if (!actor) return;

    this.saving.set(true);
    try {
      await this.matchesService.resetPlayerPin(this.playerId, this.newPin, actor.id);
      this.newPin = '';
      this.confirmPin = '';
      this.feedback.set('Le nouveau PIN a été appliqué.');
    } catch (err) {
      this.error.set(mapAuthRpcError(err, 'Erreur lors de la réinitialisation du PIN'));
    } finally {
      this.saving.set(false);
    }
  }

  goBack(): void {
    this.router.navigate(['../../'], { relativeTo: this.route });
  }
}
