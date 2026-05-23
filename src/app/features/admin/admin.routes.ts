import { Routes } from '@angular/router';
import { authGuard, adminGuard } from '../../core/auth/auth.guard';

export const adminRoutes: Routes = [
  {
    path: 'admin',
    canActivate: [authGuard, adminGuard],
    loadComponent: () =>
      import('./admin-dashboard/admin-dashboard.component').then(
        (m) => m.AdminDashboardComponent
      ),
  },
  {
    path: 'admin/match/:id',
    canActivate: [authGuard, adminGuard],
    loadComponent: () =>
      import('./match-form/match-form.component').then((m) => m.MatchFormComponent),
  },
  {
    path: 'admin/player/:id',
    canActivate: [authGuard, adminGuard],
    loadComponent: () =>
      import('./player-form/player-form.component').then((m) => m.PlayerFormComponent),
  },
];
