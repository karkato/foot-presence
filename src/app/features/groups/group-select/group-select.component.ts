import {
  ChangeDetectionStrategy,
  Component,
  inject,
  OnInit,
  signal,
} from '@angular/core';
import { Router } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { AuthService } from '../../../core/auth/auth.service';
import { SupabaseService } from '../../../core/supabase/supabase.service';
import { Group } from '../../../shared/models/group.model';

@Component({
  selector: 'app-group-select',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule],
  template: `
    <div class="page-center">
      <div class="card">
        <div class="logo">⚽</div>
        <h1>Foot Présence</h1>
        <p class="subtitle">Choisissez votre groupe</p>

        @if (loading()) {
          <p class="muted">Chargement...</p>
        } @else if (groups().length > 0) {
          <ul class="group-list">
            @for (group of groups(); track group.id) {
              <li>
                <button class="group-btn" (click)="select(group)">
                  {{ group.name }}
                </button>
              </li>
            }
          </ul>
        } @else {
          <p class="muted">Aucun groupe disponible.</p>
        }

        <div class="divider">ou</div>

        <form (ngSubmit)="goToSlug()" class="slug-form">
          <input
            type="text"
            [(ngModel)]="slugInput"
            name="slug"
            placeholder="entrez un slug de groupe"
            autocapitalize="none"
          />
          <button type="submit" class="btn-primary" [disabled]="!slugInput.trim()">
            Rejoindre
          </button>
        </form>
      </div>
    </div>
  `,
  styles: `
    .page-center {
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 1rem;
      background: var(--bg);
    }
    .card {
      background: var(--card);
      border-radius: 1rem;
      padding: 2rem;
      width: 100%;
      max-width: 380px;
      box-shadow: var(--shadow-md);
      text-align: center;
    }
    .logo { font-size: 3rem; margin-bottom: 0.5rem; }
    h1 { margin: 0 0 0.25rem; font-size: 1.5rem; }
    .subtitle { color: var(--text-muted); margin-bottom: 1.5rem; }
    .muted { color: var(--text-muted); }
    .group-list { list-style: none; padding: 0; margin: 0 0 1rem; }
    .group-list li { margin-bottom: 0.5rem; }
    .group-btn {
      width: 100%;
      padding: 0.75rem 1rem;
      background: var(--bg);
      border: 1.5px solid var(--border);
      border-radius: 0.6rem;
      font-size: 1rem;
      font-weight: 600;
      color: var(--text);
      cursor: pointer;
      transition: all 0.15s;
    }
    .group-btn:hover { border-color: var(--primary); color: var(--primary); background: var(--primary-light); }
    .divider {
      color: var(--text-muted);
      font-size: 0.85rem;
      margin: 1rem 0;
      position: relative;
    }
    .divider::before, .divider::after {
      content: '';
      position: absolute;
      top: 50%;
      width: 40%;
      height: 1px;
      background: var(--border);
    }
    .divider::before { left: 0; }
    .divider::after { right: 0; }
    .slug-form { display: flex; gap: 0.5rem; }
    input {
      flex: 1;
      padding: 0.65rem 0.85rem;
      border: 1.5px solid var(--border);
      border-radius: 0.5rem;
      font-size: 0.95rem;
      background: var(--bg);
      color: var(--text);
    }
    input:focus { outline: none; border-color: var(--primary); }
    .btn-primary {
      padding: 0.65rem 1rem;
      background: var(--primary);
      color: white;
      border: none;
      border-radius: 0.5rem;
      font-size: 0.95rem;
      font-weight: 600;
      cursor: pointer;
      white-space: nowrap;
    }
    .btn-primary:disabled { opacity: 0.6; cursor: not-allowed; }
  `,
})
export class GroupSelectComponent implements OnInit {
  private readonly supabase = inject(SupabaseService).client;
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);

  groups = signal<Group[]>([]);
  loading = signal(true);
  slugInput = '';

  ngOnInit(): void {
    const savedSlug = this.auth.currentGroupSlug();
    if (savedSlug && this.auth.isLoggedIn()) {
      this.router.navigate([`/${savedSlug}/matches`]);
      return;
    }
    this.loadGroups();
  }

  private async loadGroups(): Promise<void> {
    const { data } = await this.supabase.from('groups').select('*').order('name');
    this.groups.set(data ?? []);
    this.loading.set(false);
  }

  select(group: Group): void {
    this.router.navigate([`/${group.slug}/login`]);
  }

  goToSlug(): void {
    const slug = this.slugInput.trim();
    if (slug) this.router.navigate([`/${slug}/login`]);
  }
}
