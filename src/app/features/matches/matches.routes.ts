import { Routes } from '@angular/router';
import { authGuard } from '../../core/auth/auth.guard';

export const matchesRoutes: Routes = [
  {
    path: 'matches',
    canActivate: [authGuard],
    loadComponent: () =>
      import('./match-list/match-list.component').then((m) => m.MatchListComponent),
  },
  {
    path: 'match/:id',
    canActivate: [authGuard],
    loadComponent: () =>
      import('./match-detail/match-detail.component').then((m) => m.MatchDetailComponent),
  },
];
