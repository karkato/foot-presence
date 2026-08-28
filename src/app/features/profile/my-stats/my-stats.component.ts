import { ChangeDetectionStrategy, Component, inject, input, OnChanges, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { AuthService } from '../../../core/auth/auth.service';
import { MatchesService, MatchHistoryEntry } from '../../matches/matches.service';
import { mapMatchStatsError } from '../../../shared/utils/rpc-error';

@Component({
  selector: 'app-my-stats',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule],
  template: `
    <div class="container">
      @if (loading()) {
        <p class="muted">Chargement...</p>
      } @else if (history().length === 0) {
        <p class="muted">Aucun match joué pour cette saison.</p>
      } @else {
        <div class="entries">
          @for (entry of history(); track entry.id) {
            <div class="card entry">
              <div class="entry-header">
                <span class="entry-title">{{ entry.title }}</span>
                <span class="entry-date">{{ formatDate(entry.match_date) }}</span>
                @if (entry.score_a !== null && entry.score_b !== null) {
                  <span class="entry-score">
                    {{ entry.team === 0 ? entry.team_a_name : entry.team_b_name }}
                    {{ entry.team === 0 ? entry.score_a : entry.score_b }}–{{ entry.team === 0 ? entry.score_b : entry.score_a }}
                  </span>
                }
              </div>

              @if (readonlyReason(entry); as reason) {
                <p class="muted small">{{ reason }}</p>
              } @else {
                <div class="entry-form">
                  <div class="field">
                    <label>Buts</label>
                    <input type="number" min="0" [max]="maxGoals(entry)" [(ngModel)]="drafts[entry.id].goals" />
                  </div>
                  <div class="field">
                    <label>Passes</label>
                    <input type="number" min="0" [max]="maxAssists(entry)" [(ngModel)]="drafts[entry.id].assists" />
                  </div>
                  <button class="btn-primary" (click)="save(entry)" [disabled]="saving()[entry.id]">
                    @if (saving()[entry.id]) { ... } @else { OK }
                  </button>
                </div>
                @if (remainingLabel(entry); as label) {
                  <p class="muted small">{{ label }}</p>
                }
                @if (feedback()[entry.id]; as msg) {
                  <p class="feedback" [class.error]="isError()[entry.id]">{{ msg }}</p>
                }
              }
            </div>
          }
        </div>
      }
    </div>
  `,
  styles: `
    .container { display: flex; flex-direction: column; gap: 0.6rem; }
    .muted { color: var(--text-muted); font-size: 0.9rem; }
    .muted.small { font-size: 0.8rem; margin: 0.4rem 0 0; }
    .card { background: var(--card); border: var(--border-1); border-radius: 0.75rem; padding: 0.9rem 1rem; }
    .entries { display: flex; flex-direction: column; gap: 0.6rem; }
    .entry-header { display: flex; align-items: baseline; flex-wrap: wrap; gap: 0.4rem; margin-bottom: 0.4rem; }
    .entry-title { font-weight: 600; font-size: 0.9rem; flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .entry-date { font-size: 0.8rem; color: var(--text-muted); }
    .entry-score { font-size: 0.85rem; font-weight: 700; flex-basis: 100%; }
    .entry-form { display: flex; align-items: flex-end; gap: 0.6rem; flex-wrap: wrap; }
    .field { display: flex; flex-direction: column; gap: 0.25rem; }
    .field label { font-size: 0.78rem; font-weight: 600; color: var(--text-muted); }
    .field input {
      width: 4rem; min-height: var(--tap-compact); text-align: center; padding: 0.5rem; border: var(--border-1); border-radius: 0.5rem;
      font-size: 1rem; font-weight: 700; background: var(--bg); color: var(--text); font-family: inherit;
    }
    .field input:focus { outline: none; border-color: var(--primary); }
    .btn-primary { min-height: var(--tap-compact); padding: 0.55rem 1.1rem; background: var(--primary); color: white; border: none; border-radius: 0.5rem; font-size: 0.9rem; font-weight: 600; cursor: pointer; font-family: inherit; }
    .btn-primary:disabled { opacity: 0.6; cursor: not-allowed; }
    .feedback { font-size: 0.8rem; color: var(--success); margin: 0.4rem 0 0; }
    .feedback.error { color: var(--danger); }
  `,
})
export class MyStatsComponent implements OnChanges {
  private readonly auth = inject(AuthService);
  private readonly matchesService = inject(MatchesService);

  seasonId = input<string | null>(null);

  loading = signal(true);
  history = signal<MatchHistoryEntry[]>([]);
  saving = signal<Record<string, boolean>>({});
  feedback = signal<Record<string, string>>({});
  isError = signal<Record<string, boolean>>({});

  drafts: Record<string, { goals: number; assists: number }> = {};

  async ngOnChanges(): Promise<void> {
    await this.load();
  }

  private async load(): Promise<void> {
    const player = this.auth.currentPlayer();
    if (!player) return;
    this.loading.set(true);
    try {
      const history = await this.matchesService.getPlayerHistory(player.id, this.seasonId());
      this.history.set(history);
      for (const entry of history) {
        this.drafts[entry.id] = { goals: entry.goals, assists: entry.assists };
      }
    } catch {
      this.history.set([]);
    } finally {
      this.loading.set(false);
    }
  }

  maxGoals(entry: MatchHistoryEntry): number | null {
    if (entry.team_score === null) return null;
    return Math.max(0, entry.team_score - entry.team_goals_other);
  }

  maxAssists(entry: MatchHistoryEntry): number | null {
    if (entry.team_score === null) return null;
    return Math.max(0, entry.team_score - entry.team_assists_other);
  }

  remainingLabel(entry: MatchHistoryEntry): string {
    const maxG = this.maxGoals(entry);
    if (maxG === null) return '';
    const draft = this.drafts[entry.id];
    const remaining = maxG - (draft?.goals ?? 0);
    if (remaining <= 0) return '';
    const teamName = entry.team === 0 ? entry.team_a_name : entry.team_b_name;
    return `Il reste ${remaining} but(s) à attribuer pour ${teamName}.`;
  }

  readonlyReason(entry: MatchHistoryEntry): string | null {
    if (entry.team === null) return 'Équipe non assignée pour ce match.';
    if (entry.score_a === null || entry.score_b === null) return "Le score du match n'a pas encore été saisi.";
    return null;
  }

  async save(entry: MatchHistoryEntry): Promise<void> {
    const player = this.auth.currentPlayer();
    const draft = this.drafts[entry.id];
    if (!player || !draft) return;

    this.saving.update(s => ({ ...s, [entry.id]: true }));
    this.feedback.update(f => ({ ...f, [entry.id]: '' }));
    try {
      await this.matchesService.setPlayerMatchStats(entry.id, player.id, draft.goals, draft.assists, player.id);
      this.isError.update(e => ({ ...e, [entry.id]: false }));
      this.feedback.update(f => ({ ...f, [entry.id]: 'Enregistré !' }));
      await this.load();
      setTimeout(() => this.feedback.update(f => ({ ...f, [entry.id]: '' })), 2500);
    } catch (err) {
      this.isError.update(e => ({ ...e, [entry.id]: true }));
      this.feedback.update(f => ({ ...f, [entry.id]: mapMatchStatsError(err, "Erreur lors de l'enregistrement") }));
    } finally {
      this.saving.update(s => ({ ...s, [entry.id]: false }));
    }
  }

  formatDate(dateStr: string): string {
    return new Date(dateStr).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' });
  }
}
