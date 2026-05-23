import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import { Registration } from '../../../../shared/models/registration.model';
import { getDisplayName } from '../../../../shared/models/player.model';

@Component({
  selector: 'app-player-row',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <li class="player-row" [class.current]="isCurrent()">
      <span class="rank">{{ prefix() }}</span>
      <span class="name">{{ displayName() }}</span>
      @if (canWithdraw()) {
        <button class="btn-withdraw" (click)="withdraw.emit(reg().player_id)" title="Retirer">
          ✕
        </button>
      }
      @if (canDelete()) {
        <button class="btn-delete" (click)="delete.emit(reg().player_id)" title="Supprimer">
          Supprimer
        </button>
      }
    </li>
  `,
  styles: `
    .player-row {
      display: flex;
      align-items: center;
      gap: 0.6rem;
      padding: 0.55rem 0.75rem;
      border-radius: 0.4rem;
      transition: background 0.1s;
    }
    .player-row:hover { background: var(--bg); }
    .player-row.current { background: var(--primary-light); font-weight: 700; }
    .rank {
      min-width: 2rem;
      font-size: 0.8rem;
      font-weight: 700;
      color: var(--text-muted);
      text-align: right;
    }
    .name { flex: 1; font-size: 0.95rem; }
    .btn-withdraw {
      background: none;
      border: none;
      color: var(--danger);
      cursor: pointer;
      font-size: 0.8rem;
      padding: 0.2rem 0.4rem;
      border-radius: 0.3rem;
      opacity: 0.5;
      transition: opacity 0.15s;
    }
    .btn-withdraw:hover { opacity: 1; }
    .btn-delete {
      background: var(--danger);
      color: white;
      border: none;
      cursor: pointer;
      font-size: 0.75rem;
      font-weight: 600;
      padding: 0.2rem 0.55rem;
      border-radius: 0.3rem;
      transition: filter 0.15s;
    }
    .btn-delete:hover { filter: brightness(1.1); }
  `,
})
export class PlayerRowComponent {
  reg = input.required<Registration>();
  rank = input.required<number>();
  prefix = input.required<string>();
  isCurrent = input<boolean>(false);
  canWithdraw = input<boolean>(false);
  canDelete = input<boolean>(false);

  withdraw = output<string>();
  delete = output<string>();

  displayName(): string {
    const r = this.reg();
    return getDisplayName(r.player);
  }
}
