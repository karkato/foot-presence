import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { AuthService } from './core/auth/auth.service';
import { ToastComponent } from './core/toast/toast.component';
import { UpdateBannerComponent } from './core/update/update-banner.component';

@Component({
  selector: 'app-root',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterOutlet, RouterLink, RouterLinkActive, ToastComponent, UpdateBannerComponent],
  templateUrl: './app.html',
  styleUrl: './app.css',
})
export class App {
  readonly auth = inject(AuthService);

  groupSlug = computed(() => this.auth.currentGroupSlug() ?? '');
  showNav = computed(() => this.auth.isLoggedIn());
}
