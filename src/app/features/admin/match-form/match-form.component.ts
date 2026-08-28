import { ChangeDetectionStrategy, Component, inject, OnInit, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { AuthService } from '../../../core/auth/auth.service';
import { MatchesService } from '../../matches/matches.service';
import { mapAuthRpcError } from '../../../shared/utils/rpc-error';
import { DEFAULT_TEAM_A_NAME, DEFAULT_TEAM_B_NAME } from '../../../shared/constants/team-config';

@Component({
  selector: 'app-match-form',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule],
  template: `
    <div class="container-form">
      <h2>{{ isEdit() ? 'Modifier le match' : 'Nouveau match' }}</h2>

      <form (ngSubmit)="onSubmit()" class="form">
        <div class="field">
          <label>Titre</label>
          <input type="text" [(ngModel)]="form.title" name="title" required placeholder="Match du dimanche" />
        </div>
        <div class="row">
          <div class="field">
            <label>Date</label>
            <input type="date" [(ngModel)]="form.match_date" name="match_date" required />
          </div>
          <div class="field">
            <label>Heure</label>
            <input type="time" [(ngModel)]="form.match_time" name="match_time" required />
          </div>
        </div>
        <div class="field">
          <label>Nombre max de joueurs</label>
          <input type="number" [(ngModel)]="form.max_players" name="max_players" min="2" max="50" required />
        </div>
        <div class="field">
          <label>Limite d'inscription (optionnel)</label>
          <input type="datetime-local" [(ngModel)]="form.registration_deadline" name="registration_deadline" />
        </div>
        <div class="row">
          <div class="field">
            <label>Nom équipe A</label>
            <input type="text" [(ngModel)]="form.team_a_name" name="team_a_name" [placeholder]="defaultTeamAName" maxlength="30" />
          </div>
          <div class="field">
            <label>Nom équipe B</label>
            <input type="text" [(ngModel)]="form.team_b_name" name="team_b_name" [placeholder]="defaultTeamBName" maxlength="30" />
          </div>
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
    h2 { margin-top: 0; }
    .form { display: flex; flex-direction: column; gap: 1rem; }
    .row { display: flex; flex-direction: column; gap: 0.75rem; }
    @media (min-width: 768px) { .row { flex-direction: row; } }
    .row .field { flex: 1; min-width: 0; }
    .field { display: flex; flex-direction: column; gap: 0.35rem; min-width: 0; }
    label { font-size: 0.85rem; font-weight: 600; color: var(--text-muted); }
    input {
      padding: 0.65rem 0.85rem; border: var(--border-1);
      border-radius: 0.5rem; font-size: var(--fs-field); background: var(--card); color: var(--text);
      min-height: var(--tap);
    }
    input:focus { outline: none; border-color: var(--primary); }
    input:focus-visible { outline: 2px solid var(--primary); outline-offset: 2px; }
    .error { color: var(--danger); font-size: 0.9rem; }
    .actions { display: flex; gap: 0.75rem; justify-content: flex-end; }
    .btn-cancel {
      padding: 0.65rem 1.25rem; background: var(--border); border: none;
      border-radius: 0.5rem; font-size: 0.95rem; cursor: pointer;
      min-height: var(--tap); display: inline-flex; align-items: center; justify-content: center;
    }
    .btn-primary {
      padding: 0.65rem 1.25rem; background: var(--primary); color: white;
      border: none; border-radius: 0.5rem; font-size: 0.95rem; font-weight: 600; cursor: pointer;
      min-height: var(--tap); display: inline-flex; align-items: center; justify-content: center;
    }
    .btn-primary:disabled { opacity: 0.6; cursor: not-allowed; }
  `,
})
export class MatchFormComponent implements OnInit {
  private readonly matchesService = inject(MatchesService);
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);

  isEdit = signal(false);
  saving = signal(false);
  error = signal('');
  matchId = '';

  readonly defaultTeamAName = DEFAULT_TEAM_A_NAME;
  readonly defaultTeamBName = DEFAULT_TEAM_B_NAME;

  form = {
    title: '', match_date: '', match_time: '10:00', max_players: 22,
    registration_deadline: '', team_a_name: DEFAULT_TEAM_A_NAME, team_b_name: DEFAULT_TEAM_B_NAME,
  };

  async ngOnInit(): Promise<void> {
    const id = this.route.snapshot.params['id'];
    if (id && id !== 'new') {
      this.isEdit.set(true);
      this.matchId = id;
      const match = await this.matchesService.getMatch(id);
      this.form = {
        title: match.title, match_date: match.match_date, match_time: match.match_time,
        max_players: match.max_players,
        registration_deadline: match.registration_deadline ? match.registration_deadline.slice(0, 16) : '',
        team_a_name: match.team_a_name ?? DEFAULT_TEAM_A_NAME,
        team_b_name: match.team_b_name ?? DEFAULT_TEAM_B_NAME,
      };
    }
  }

  async onSubmit(): Promise<void> {
    const player = this.auth.currentPlayer();
    if (!player) return;
    this.saving.set(true);
    this.error.set('');
    const payload = {
      title: this.form.title.trim(),
      match_date: this.form.match_date, match_time: this.form.match_time,
      max_players: Number(this.form.max_players),
      registration_deadline: this.form.registration_deadline || null,
      team_a_name: this.form.team_a_name.trim() || DEFAULT_TEAM_A_NAME,
      team_b_name: this.form.team_b_name.trim() || DEFAULT_TEAM_B_NAME,
    };
    try {
      if (this.isEdit()) {
        await this.matchesService.updateMatch(this.matchId, payload, player.id);
      } else {
        await this.matchesService.createMatch(payload, player.group_id, player.id);
      }
      this.goBack();
    } catch (err) {
      this.error.set(mapAuthRpcError(err, 'Erreur lors de la sauvegarde'));
    } finally {
      this.saving.set(false);
    }
  }

  goBack(): void { this.router.navigate(['../../'], { relativeTo: this.route }); }
}
