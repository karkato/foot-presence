import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { SwUpdate } from '@angular/service-worker';
import { filter } from 'rxjs';

@Component({
  selector: 'app-update-banner',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (updateAvailable()) {
      <div class="update-banner" role="status">
        <span>Nouvelle version disponible</span>
        <button type="button" (click)="reload()">Recharger</button>
      </div>
    }
  `,
  styles: `
    .update-banner {
      position: fixed;
      top: 0;
      left: 0;
      right: 0;
      z-index: 1000;
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 1rem;
      padding: 0.6rem 1rem;
      padding-top: calc(0.6rem + env(safe-area-inset-top, 0px));
      background: var(--primary);
      color: white;
      font-size: 0.85rem;
      font-weight: 600;
    }
    button {
      padding: 0.3rem 0.9rem;
      border: 1px solid white;
      border-radius: 0.4rem;
      background: transparent;
      color: white;
      font-size: 0.8rem;
      font-weight: 700;
      font-family: inherit;
      cursor: pointer;
    }
  `,
})
export class UpdateBannerComponent {
  private readonly swUpdate = inject(SwUpdate);

  updateAvailable = signal(false);

  constructor() {
    if (!this.swUpdate.isEnabled) return;
    this.swUpdate.versionUpdates
      .pipe(filter(e => e.type === 'VERSION_READY'), takeUntilDestroyed())
      .subscribe(() => this.updateAvailable.set(true));
  }

  reload(): void {
    document.location.reload();
  }
}
