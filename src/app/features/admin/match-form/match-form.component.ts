import { ChangeDetectionStrategy, Component, inject, OnInit, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { AuthService } from '../../../core/auth/auth.service';
import { MatchesService } from '../../matches/matches.service';
import { Match } from '../../../shared/models/match.model';

@Component({
  selector: 'app-match-form',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule],
  template: `
    <div class="container">
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
            <input type="text" [(ngModel)]="form.team_a_name" name="team_a_name" placeholder="Équipe A" maxlength="30" />
          </div>
          <div class="field">
            <label>Nom équipe B</label>
            <input type="text" [(ngModel)]="form.team_b_name" name="team_b_name" placeholder="Équipe B" maxlength="30" />
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
    .container { padding: 1rem; max-width: 480px; margin: 0 auto; }
    h2 { margin-top: 0; }
    .form { display: flex; flex-direction: column; gap: 1rem; }
    .row { display: flex; gap: 0.75rem; }
    .row .field { flex: 1; }
    .field { display: flex; flex-direction: column; gap: 0.35rem; }
    label { font-size: 0.85rem; font-weight: 600; color: var(--text-muted); }
    input {
      padding: 0.65rem 0.85rem; border: 1.5px solid var(--border);
      border-radius: 0.5rem; font-size: 0.95rem; background: var(--card); color: var(--text);
    }
    input:focus { outline: none; border-color: var(--primary); }
    .error { color: var(--danger); font-size: 0.9rem; }
    .actions { display: flex; gap: 0.75rem; justify-content: flex-end; }
    .btn-cancel {
      padding: 0.65rem 1.25rem; background: var(--border); border: none;
      border-radius: 0.5rem; font-size: 0.95rem; cursor: pointer;
    }
    .btn-primary {
      padding: 0.65rem 1.25rem; background: var(--primary); color: white;
      border: none; border-radius: 0.5rem; font-size: 0.95rem; font-weight: 600; cursor: pointer;
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

  form = {
    title: '', match_date: '', match_time: '10:00', max_players: 22,
    registration_deadline: '', team_a_name: 'Équipe A', team_b_name: 'Équipe B',
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
        team_a_name: match.team_a_name ?? 'Équipe A',
        team_b_name: match.team_b_name ?? 'Équipe B',
      };
    }
  }

  async onSubmit(): Promise<void> {
    const player = this.auth.currentPlayer();
    if (!player) return;
    this.saving.set(true);
    this.error.set('');
    const payload = {
      group_id: player.group_id, title: this.form.title.trim(),
      match_date: this.form.match_date, match_time: this.form.match_time,
      max_players: Number(this.form.max_players),
      registration_deadline: this.form.registration_deadline || null,
      is_closed: false,
      team_a_name: this.form.team_a_name.trim() || 'Équipe A',
      team_b_name: this.form.team_b_name.trim() || 'Équipe B',
      score_a: null, score_b: null, score_a2: null, score_b2: null, mini_match_target: null,
    };
    try {
      if (this.isEdit()) {
        await this.matchesService.updateMatch(this.matchId, payload, player.id, { title: payload.title });
      } else {
        await this.matchesService.createMatch(payload, player.id);
      }
      this.goBack();
    } catch {
      this.error.set('Erreur lors de la sauvegarde');
    } finally {
      this.saving.set(false);
    }
  }

  goBack(): void { this.router.navigate(['../../'], { relativeTo: this.route }); }
}
