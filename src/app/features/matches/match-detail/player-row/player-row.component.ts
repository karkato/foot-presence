import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import { Registration } from '../../../../shared/models/registration.model';
import { getDisplayName } from '../../../../shared/models/player.model';
import { TEAM_A_COLOR, TEAM_B_COLOR } from '../../../../shared/constants/team-config';

@Component({
  selector: 'app-player-row',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <li class="player-row" [class.current]="isCurrent()">
      <span class="rank">{{ prefix() }}</span>
      <span class="name">{{ displayName() }}</span>
      @if (team() === 0) {
        <span class="team-badge team-a">A</span>
      } @else if (team() === 1) {
        <span class="team-badge team-b">B</span>
      }
      @if (reg().goals > 0) {
        <span class="stat-badge" title="Buts">⚽ {{ reg().goals }}</span>
      }
      @if (reg().assists > 0) {
        <span class="stat-badge" title="Passes décisives">🅰 {{ reg().assists }}</span>
      }
      @if (canWithdraw()) {
        <button class="btn-withdraw" (click)="withdraw.emit(reg().player_id)" title="Retirer">✕</button>
      }
      @if (canDelete()) {
        <button class="btn-delete" (click)="delete.emit(reg().player_id)" aria-label="Supprimer l'inscription" title="Supprimer">🗑</button>
      }
    </li>
  `,
  styles: `
    .player-row {
      display: flex; align-items: center; gap: 0.6rem; flex-wrap: wrap; min-height: var(--tap);
      padding: 0.55rem 0.75rem; border-radius: 0.4rem; transition: background 0.1s;
    }
    .player-row:hover { background: var(--bg); }
    .player-row.current { background: var(--primary-light); font-weight: 700; }
    .rank { min-width: 2rem; font-size: 0.8rem; font-weight: 700; color: var(--text-muted); text-align: right; }
    .name {
      flex: 1; min-width: 0; font-size: 0.95rem;
      overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
    }
    .team-badge {
      font-size: 0.7rem; font-weight: 700; padding: 0.1rem 0.4rem; border-radius: 0.3rem; flex-shrink: 0;
    }
    .team-a { background: ${TEAM_A_COLOR}; color: white; }
    .team-b { background: ${TEAM_B_COLOR}; color: white; }
    .stat-badge { font-size: 0.7rem; font-weight: 700; color: var(--text-muted); white-space: nowrap; flex-shrink: 0; }
    .btn-withdraw {
      background: none; border: none; color: var(--danger); cursor: pointer;
      min-width: var(--tap); min-height: var(--tap); flex-shrink: 0;
      display: inline-flex; align-items: center; justify-content: center;
      font-size: 0.8rem; padding: 0.2rem 0.4rem; border-radius: 0.3rem; opacity: 0.7; transition: opacity 0.15s;
    }
    .btn-withdraw:hover { opacity: 1; }
    .btn-delete {
      background: var(--danger); color: white; border: none; cursor: pointer;
      min-width: var(--tap); min-height: var(--tap); flex-shrink: 0;
      display: inline-flex; align-items: center; justify-content: center;
      font-size: 0.9rem; font-weight: 600; padding: 0.2rem 0.55rem; border-radius: 0.3rem;
    }
  `,
})
export class PlayerRowComponent {
  reg = input.required<Registration>();
  rank = input.required<number>();
  prefix = input.required<string>();
  isCurrent = input<boolean>(false);
  canWithdraw = input<boolean>(false);
  canDelete = input<boolean>(false);
  team = input<number | null>(null);

  withdraw = output<string>();
  delete = output<string>();

  displayName(): string { return getDisplayName(this.reg().player); }
}
