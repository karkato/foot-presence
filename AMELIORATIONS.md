# 📋 Foot-Presence — Améliorations & Roadmap

> Analyse complète du projet réalisée le 12/06/2026.
> Cocher les cases au fur et à mesure de l'implémentation.

## Vue d'ensemble

Le projet est globalement très propre : standalone partout, OnPush systématique, signals + computed bien utilisés, control flow natif, lazy loading des routes, zoneless (défaut Angular 21), dark mode via `prefers-color-scheme`, PWA configurée. Les points d'amélioration sont surtout côté **sécurité Supabase** et quelques modernisations Angular.

---

## 🔴 Sécurité — priorité haute

### 1. Les hash bcrypt des PIN sont lisibles publiquement
- [x] **À corriger en premier — 10 minutes**

La policy `players: lecture publique` (`supabase/setup.sql:188`) autorise `SELECT` sur **toutes les colonnes**. N'importe qui avec l'anon key (visible dans le bundle JS) peut faire `GET /rest/v1/players?select=username,pin_hash` et récupérer tous les hash pour les bruteforcer hors-ligne (un PIN à 4 chiffres = 10 000 essais, trivial même avec bcrypt).

Correctif (column-level grants, sans toucher au front) :
```sql
REVOKE SELECT ON players FROM anon, authenticated;
GRANT SELECT (id, group_id, username, display_name, is_admin, created_at) ON players TO anon, authenticated;
```

### 2. `login_player` renvoie le `pin_hash` dans la réponse
- [x] **À corriger en même temps que le point 1**

`row_to_json(player_row)` (`supabase/setup.sql:81`) inclut `pin_hash`, et `AuthService` stocke ce JSON tel quel dans `localStorage`. Le hash du joueur traîne donc dans son navigateur.

Correctif : renvoyer un objet sans le hash :
```sql
RETURN to_jsonb(player_row) - 'pin_hash';
```

### 3. Aucune RPC d'écriture ne vérifie l'identité de l'appelant
- [ ] **Décision : pas de sessions pour le moment — à implémenter si besoin plus tard**

Tout repose sur le `p_player_id` / `p_actor_id` que le client envoie. Avec l'anon key, n'importe qui peut :
- appeler `update_player_profile` pour **changer le PIN de n'importe quel joueur** (y compris un admin → prise de contrôle totale) ;
- appeler `create_player(..., is_admin := true)` ;
- désinscrire les autres via `withdraw_player`, modifier les scores via `set_match_score`, etc. ;
- modifier/supprimer tous les matchs directement via REST (policy `matches: écriture publique FOR ALL USING (true)`).

Durcissement pragmatique pour une app perso :
1. Table `sessions(token uuid PK, player_id uuid, expires_at timestamptz)`.
2. `login_player` génère et retourne un token de session.
3. Le client stocke le token et le passe à chaque RPC d'écriture.
4. Chaque RPC déduit `actor_id` du token côté serveur (au lieu de faire confiance au client) et vérifie les droits (joueur lui-même / admin).
5. Supprimer la policy d'écriture publique sur `matches` au profit de RPC admin.

### 4. `update_player_profile` sans vérification admin
- [ ] Même avec le token (point 3), vérifier que seul le joueur lui-même ou un admin du groupe peut modifier un profil. Actuellement `p_actor_id` est purement déclaratif et ne sert qu'au log.

### 5. Écritures directes sur tables qui échouent silencieusement *(ajout audit 06/07/2026)*
- [ ] `MatchesService.setMiniMatchScore()` et `PlayerFormComponent` (toggle `is_admin`) écrivent en direct via `supabase.from(...).update()`. Or les policies RLS d'écriture sur `matches` sont supprimées dans `sessions.sql` et `players` n'a pas de policy UPDATE → ces `update` sont refusés silencieusement (0 ligne modifiée, aucune erreur). Créer des RPC `set_mini_match_score` et `set_player_admin` avec vérification admin.

### 6. Validation PIN absente à la création de joueur *(ajout audit 06/07/2026)*
- [ ] `PlayerFormComponent` ne valide ni la longueur ni le format numérique du PIN, contrairement à `ProfileComponent.savePin()` qui exige ≥ 4 chiffres. Un admin peut créer un compte avec un PIN à 1 chiffre. Ajouter la même validation (PIN 4-6 chiffres numériques, username non vide) + messages d'erreur.

---

## 🟠 Qualité / modernisation Angular

### 5. `registration_deadline` n'est jamais appliquée
- [ ] Le champ est saisi dans le formulaire admin (`match-form.component.ts`) mais aucune logique (ni SQL ni UI) ne ferme les inscriptions passée la deadline.
  - Soit l'appliquer dans `register_player` (`RAISE EXCEPTION 'deadline_passed'`),
  - soit retirer le champ du formulaire.
  - Bonus UI : compte à rebours sur la page match.

### 6. Migrer vers `resource()` (Angular 21)
- [ ] Tous les composants font le pattern `OnInit` + signal `loading` + `try/catch` manuel. `resource({ loader: ... })` donne gratuitement loading/error/reload et réduirait pas mal de code (notamment `MatchDetailComponent`, ~700 lignes).

### 7. Route params via `input()`
- [ ] `withComponentInputBinding()` est déjà activé dans `app.config.ts`, mais les composants lisent `route.snapshot.params`. Utiliser `groupSlug = input.required<string>()` — plus idiomatique et réactif.

### 8. Découper `MatchDetailComponent`
- [ ] C'est un monolithe (~700 lignes) : score admin, panneau présences, liste, actions joueur.
  - Extraire `ScoreAdminComponent` et `PresencePanelComponent`.
  - Mettre un `@defer` sur les sections admin (invisibles pour 90 % des utilisateurs).

### 9. Lookups O(n) dans le template du panneau admin
- [ ] `isPlayerPresent()`, `getPlayerTeam()`, `getPlayerPlusOnes()` font un `find()` par joueur à chaque rendu. Remplacer par un `computed()` retournant une `Map<playerId, Registration>`.

### 10. `formatDate()` appelé dans les templates
- [ ] Recrée un `Date` + `toLocaleDateString` à chaque change detection. Utiliser `DatePipe` (mémoïsé) ou pré-formater dans un `computed()`.

### 11. Erreurs avalées silencieusement
- [ ] Plusieurs `catch { /* silently fail */ }` dans les actions admin de `MatchDetailComponent`. Créer un petit `ToastService` global (signal + composant dans `App`) pour donner du feedback quand une action échoue.

### 12. Realtime non rétabli au retour d'arrière-plan
- [ ] Sur mobile, le channel Supabase meurt souvent quand l'app passe en background. `MatchListComponent` gère ça avec `visibilitychange`, mais pas `MatchDetailComponent`. Ajouter le même handler avec re-`subscribe` + reload des inscriptions.

### 13. Gestion des mises à jour PWA
- [ ] Sans `SwUpdate`, les utilisateurs peuvent rester bloqués sur une vieille version. Créer un service qui écoute `versionUpdates` et affiche « Nouvelle version disponible — recharger ».

### 14. Index DB manquants
- [ ] Volumes faibles aujourd'hui, mais gratuit à ajouter :
```sql
CREATE INDEX IF NOT EXISTS idx_registrations_match ON registrations(match_id);
CREATE INDEX IF NOT EXISTS idx_matches_group_date ON matches(group_id, match_date);
CREATE INDEX IF NOT EXISTS idx_audit_group_date ON audit_log(group_id, created_at DESC);
```

### 15. Code mort côté SQL
- [ ] La RPC `get_group_player_stats` (`features.sql`) et la vue `match_registrations_ranked` (`setup.sql`) ne sont utilisées nulle part côté front. Soit les exploiter (voir leaderboard ci-dessous), soit les supprimer.

### 16. Zéro test
- [ ] Quelques tests sur la logique pure protégeraient les parties subtiles :
  - calcul `starters` / `substitutes` / rangs avec `plus_ones` ;
  - `canWithdraw` ;
  - limite de procurations.

---

## 💡 Idées de nouveautés

### Quick wins (le SQL existe déjà en partie)
- [ ] **Classement du groupe (leaderboard)** : `get_group_player_stats` est déjà écrit ! Page avec matchs joués, % victoires, série en cours.
- [ ] **Badge ratio à côté des présents** : afficher le win-rate de chaque joueur dans la liste du match (intention initiale de cette RPC).
- [ ] **Bouton « Ajouter au calendrier »** : générer un fichier `.ics` côté client (zéro dépendance).

### Engagement
- [ ] **Notifications push** (le plus gros gain pour une app de présence) :
  - nouveau match créé ;
  - « tu passes titulaire » quand un remplaçant monte suite à un désistement ;
  - rappel J-1 si pas encore inscrit.
  - Stack : Web Push + Supabase Edge Function + le service worker déjà en place.
- [ ] **Vote MVP** après le match : chaque présent vote, résultat affiché sur la fiche match + alimentation des stats.
- [ ] **Buteurs/passeurs** : saisie admin des buts par joueur → top buteur dans le leaderboard.
- [ ] **Streaks et badges** : « 5 matchs d'affilée », « 10 victoires », « jamais désisté »…

### Organisation
- [ ] **Matchs récurrents** : « tous les jeudis 20h » → création auto du prochain match à la clôture du précédent (`pg_cron` ou Edge Function schedulée).
- [ ] **Générateur d'équipes équilibrées** : bouton admin qui répartit les présents en A/B en équilibrant les win-rates — la donnée `team` et les stats existent déjà.
- [ ] **Promotion automatique des remplaçants** : quand un titulaire se retire, le 1er remplaçant passe titulaire + notification push « tu es titulaire ! ».
- [ ] **Cagnotte / qui a payé** : case « payé » par présent + montant du terrain divisé automatiquement — remplace le Tricount du groupe.
- [ ] **Sondage de date** : proposer 2-3 créneaux et laisser voter avant de créer le match (style Doodle minimal).

### Confort
- [ ] **Toggle thème clair/sombre manuel** (en plus du `prefers-color-scheme` actuel), persisté en localStorage.
- [ ] **Partage WhatsApp enrichi** : à la création d'un match, proposer directement le message pré-formaté avec le lien.

---

## 🎯 Ordre de priorité conseillé

1. **Correctifs sécurité 1 et 2** — deux requêtes SQL, ~10 minutes, faille réelle.
2. **Token de session** (point 3) — vrai durcissement de toutes les écritures.
3. **Notifications push** — la killer feature pour ce type d'app.
4. **Leaderboard** — quick win, le SQL existe déjà.
5. Le reste au fil de l'eau.