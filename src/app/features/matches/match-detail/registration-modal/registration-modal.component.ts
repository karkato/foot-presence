import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
  OnInit,
  output,
  signal,
} from '@angular/core';
import { Player, getDisplayName } from '../../../../shared/models/player.model';
import { Registration } from '../../../../shared/models/registration.model';
import { AuthService } from '../../../../core/auth/auth.service';

@Component({
  selector: 'app-registration-modal',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="overlay" (click)="close.emit()">
      <div class="modal" (click)="$event.stopPropagation()">
        <div class="modal-header">
          <h3>Inscrire quelqu'un</h3>
          <button class="btn-close" (click)="close.emit()">✕</button>
        </div>

        <p class="proxy-info">
          Procurations utilisées : <strong>{{ proxyUsed() }}/2</strong>
        </p>

        @if (availablePlayers().length === 0) {
          <p class="muted">Tous les joueurs sont déjà inscrits.</p>
        } @else {
          <ul class="player-list">
            @for (player of availablePlayers(); track player.id) {
              <li>
                <button class="player-btn" (click)="select(player)">
                  {{ displayName(player) }}
                </button>
              </li>
            }
          </ul>
        }
      </div>
    </div>
  `,
  styles: `
    .overlay {
      position: fixed;
      inset: 0;
      background: rgba(0,0,0,0.45);
      display: flex;
      align-items: flex-end;
      justify-content: center;
      z-index: 100;
      padding: 0;
    }
    .modal {
      background: var(--card);
      border-radius: 1.25rem 1.25rem 0 0;
      padding: 1.5rem;
      width: 100%;
      max-width: 480px;
      max-height: 70vh;
      overflow-y: auto;
    }
    .modal-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      margin-bottom: 0.75rem;
    }
    h3 { margin: 0; font-size: 1.1rem; }
    .btn-close {
      background: none;
      border: none;
      font-size: 1.1rem;
      cursor: pointer;
      color: var(--text-muted);
      padding: 0.25rem;
    }
    .proxy-info { font-size: 0.9rem; color: var(--text-muted); margin-bottom: 1rem; }
    .muted { color: var(--text-muted); text-align: center; padding: 1rem 0; }
    .player-list { list-style: none; padding: 0; margin: 0; display: flex; flex-direction: column; gap: 0.4rem; }
    .player-btn {
      width: 100%;
      padding: 0.75rem 1rem;
      background: var(--card);
      color: var(--text);
      border: 1.5px solid var(--border);
      border-radius: 0.5rem;
      text-align: left;
      font-size: 0.95rem;
      cursor: pointer;
      transition: all 0.15s;
    }
    .player-btn:hover { border-color: var(--primary); color: var(--primary); }
  `,
})
export class RegistrationModalComponent implements OnInit {
  private readonly auth = inject(AuthService);

  allPlayers = input.required<Player[]>();
  registrations = input.required<Registration[]>();

  close = output<void>();
  register = output<string>();

  proxyUsed = signal(0);

  availablePlayers = computed(() => {
    const presentIds = new Set(
      this.registrations()
        .filter((r) => !r.is_withdrawn)
        .map((r) => r.player_id)
    );
    const currentId = this.auth.currentPlayer()?.id;
    return this.allPlayers().filter(
      (p) => !presentIds.has(p.id) && p.id !== currentId
    );
  });

  ngOnInit(): void {
    const currentId = this.auth.currentPlayer()?.id;
    const count = this.registrations().filter(
      (r) => !r.is_withdrawn && r.registered_by === currentId && r.player_id !== currentId
    ).length;
    this.proxyUsed.set(count);
  }

  displayName(player: Player): string {
    return getDisplayName(player);
  }

  select(player: Player): void {
    this.register.emit(player.id);
    this.close.emit();
  }
}
