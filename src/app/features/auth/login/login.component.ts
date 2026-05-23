import {
  ChangeDetectionStrategy,
  Component,
  inject,
  signal,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { AuthService } from '../../../core/auth/auth.service';

@Component({
  selector: 'app-login',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule],
  template: `
    <div class="login-page">
      <div class="login-card">
        <div class="login-logo">⚽</div>
        <h1>Foot Présence</h1>
        <p class="login-group">{{ groupSlug }}</p>

        <form (ngSubmit)="onSubmit()" #f="ngForm">
          <div class="field">
            <label for="username">Pseudo</label>
            <input
              id="username"
              type="text"
              name="username"
              [(ngModel)]="username"
              autocomplete="username"
              autocapitalize="none"
              placeholder="ton pseudo"
              required
            />
          </div>

          <div class="field">
            <label for="pin">PIN</label>
            <input
              id="pin"
              type="password"
              name="pin"
              [(ngModel)]="pin"
              autocomplete="current-password"
              inputmode="numeric"
              maxlength="6"
              placeholder="••••"
              required
            />
          </div>

          @if (error()) {
            <p class="error-msg">{{ error() }}</p>
          }

          <button type="submit" class="btn-primary" [disabled]="loading()">
            @if (loading()) { Connexion... } @else { Se connecter }
          </button>
        </form>
      </div>
    </div>
  `,
  styles: `
    .login-page {
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 1rem;
      background: var(--bg);
    }
    .login-card {
      background: var(--card);
      border-radius: 1rem;
      padding: 2rem;
      width: 100%;
      max-width: 360px;
      box-shadow: var(--shadow-md);
      text-align: center;
    }
    .login-logo { font-size: 3rem; margin-bottom: 0.5rem; }
    h1 { margin: 0 0 0.25rem; font-size: 1.5rem; color: var(--text); }
    .login-group {
      color: var(--primary);
      font-weight: 600;
      margin-bottom: 1.5rem;
      font-size: 0.9rem;
      text-transform: uppercase;
      letter-spacing: 0.05em;
    }
    .field { text-align: left; margin-bottom: 1rem; }
    label { display: block; font-size: 0.85rem; font-weight: 600; color: var(--text-muted); margin-bottom: 0.4rem; }
    input {
      width: 100%;
      padding: 0.65rem 0.85rem;
      border: 1.5px solid var(--border);
      border-radius: 0.5rem;
      font-size: 1rem;
      background: var(--bg);
      color: var(--text);
      box-sizing: border-box;
      transition: border-color 0.2s;
    }
    input:focus { outline: none; border-color: var(--primary); }
    .error-msg { color: var(--danger); font-size: 0.9rem; margin-bottom: 0.75rem; }
    .btn-primary {
      width: 100%;
      padding: 0.75rem;
      background: var(--primary);
      color: white;
      border: none;
      border-radius: 0.5rem;
      font-size: 1rem;
      font-weight: 600;
      cursor: pointer;
      margin-top: 0.5rem;
      transition: background 0.2s;
    }
    .btn-primary:hover:not(:disabled) { background: var(--primary-dark); }
    .btn-primary:disabled { opacity: 0.6; cursor: not-allowed; }
  `,
})
export class LoginComponent {
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);

  readonly groupSlug = this.route.snapshot.params['groupSlug'] as string;

  username = '';
  pin = '';
  loading = signal(false);
  error = signal('');

  async onSubmit(): Promise<void> {
    if (!this.username.trim() || !this.pin.trim()) return;
    this.loading.set(true);
    this.error.set('');

    try {
      await this.auth.login(this.groupSlug, this.username, this.pin);
      this.router.navigate([`/${this.groupSlug}/matches`]);
    } catch (err) {
      this.error.set(err instanceof Error ? err.message : 'Erreur de connexion');
    } finally {
      this.loading.set(false);
    }
  }
}
