import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { AuthService } from './auth.service';

export const authGuard: CanActivateFn = (route) => {
  const auth = inject(AuthService);
  const router = inject(Router);

  if (!auth.isLoggedIn()) {
    const groupSlug =
      route.params['groupSlug'] ?? route.parent?.params['groupSlug'] ?? '';
    return router.createUrlTree([`/${groupSlug}/login`]);
  }
  return true;
};

export const adminGuard: CanActivateFn = (route) => {
  const auth = inject(AuthService);
  const router = inject(Router);

  if (!auth.isAdmin()) {
    const groupSlug =
      route.params['groupSlug'] ?? route.parent?.params['groupSlug'] ?? '';
    return router.createUrlTree([`/${groupSlug}/matches`]);
  }
  return true;
};
