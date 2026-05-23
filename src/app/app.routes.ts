import { Routes } from '@angular/router';
import { matchesRoutes } from './features/matches/matches.routes';
import { adminRoutes } from './features/admin/admin.routes';
import { authGuard } from './core/auth/auth.guard';

export const routes: Routes = [
  {
    path: '',
    loadComponent: () =>
      import('./features/groups/group-select/group-select.component').then(
        (m) => m.GroupSelectComponent
      ),
  },
  {
    path: ':groupSlug/login',
    loadComponent: () =>
      import('./features/auth/login/login.component').then((m) => m.LoginComponent),
  },
  {
    path: ':groupSlug/profile',
    canActivate: [authGuard],
    loadComponent: () =>
      import('./features/profile/profile.component').then((m) => m.ProfileComponent),
  },
  {
    path: ':groupSlug',
    children: [...matchesRoutes, ...adminRoutes],
  },
  { path: '**', redirectTo: '' },
];
