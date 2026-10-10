import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { ToastService } from './toast.service';

@Component({
  selector: 'app-toast',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (toastService.toast(); as toast) {
      <div class="toast" role="alert">{{ toast.message }}</div>
    }
  `,
  styles: `
    .toast {
      position: fixed;
      bottom: 1rem;
      left: 50%;
      transform: translateX(-50%);
      max-width: calc(100vw - 2rem);
      padding: 0.65rem 1.25rem;
      background: var(--danger);
      color: white;
      border-radius: 0.5rem;
      font-size: 0.9rem;
      font-weight: 600;
      text-align: center;
      box-shadow: var(--shadow-md);
      z-index: 1000;
    }

    @media (max-width: 767px) {
      .toast { bottom: calc(76px + env(safe-area-inset-bottom, 0px)); }
    }
  `,
})
export class ToastComponent {
  readonly toastService = inject(ToastService);
}
