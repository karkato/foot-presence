import { ChangeDetectionStrategy, Component, computed, inject, OnInit, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { AuthService } from '../../../core/auth/auth.service';
import { GroupsService } from '../../../core/groups/groups.service';
import { MatchesService } from '../../matches/matches.service';
import { Match } from '../../../shared/models/match.model';
import { Registration } from '../../../shared/models/registration.model';
import { Group } from '../../../shared/models/group.model';
import { getDisplayName } from '../../../shared/models/player.model';
import { mapAuthRpcError, mapMatchStatsError } from '../../../shared/utils/rpc-error';
import { computeStatsRemaining } from '../../../shared/utils/match-stats';
import { confirmTeamReassignment } from '../../../shared/utils/team-assignment';
import { TEAM_A_COLOR, TEAM_B_COLOR } from '../../../shared/constants/team-config';

@Component({
  selector: 'app-match-stats',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule],
  template: `
    @if (loading()) {
      <div class="center-msg">Chargement...</div>
    } @else if (!match()) {
      <div class="center-msg">Match introuvable.</div>
    } @else {
      <div class="container-md">
        <div class="header">
          <button type="button" class="btn-back" (click)="goBack()">‹ Retour au match</button>
          <h2>{{ match()!.title }}</h2>
          <p class="match-meta">{{ formatDate(match()!.match_date) }} à {{ formatTime(match()!.match_time) }}</p>
        </div>

        <!-- Score principal -->
        <div class="card mb-sm">
          <h3 class="section-label">Score principal</h3>
          <div class="score-steppers">
            <div class="score-team-stepper">
              <span class="team-name">{{ match()!.team_a_name }}</span>
              <div class="stepper">
                <button class="btn-mini" (click)="adjustScore(0, -1)" [disabled]="actionLoading() || scoreA() === 0">−</button>
                <span class="stepper-value">{{ scoreA() }}</span>
                <button class="btn-mini" (click)="adjustScore(0, 1)" [disabled]="actionLoading()">+</button>
              </div>
            </div>
            <span class="score-sep-sm">–</span>
            <div class="score-team-stepper">
              <span class="team-name">{{ match()!.team_b_name }}</span>
              <div class="stepper">
                <button class="btn-mini" (click)="adjustScore(1, -1)" [disabled]="actionLoading() || scoreB() === 0">−</button>
                <span class="stepper-value">{{ scoreB() }}</span>
                <button class="btn-mini" (click)="adjustScore(1, 1)" [disabled]="actionLoading()">+</button>
              </div>
            </div>
          </div>
          @if (scoreFeedback()) { <p class="feedback-success">{{ scoreFeedback() }}</p> }
          @if (scoreError()) { <p class="feedback-error">{{ scoreError() }}</p> }

          @if (miniMatchEnabled()) {
            <h3 class="section-label mt">Mini-match</h3>
            <div class="score-steppers">
              <div class="score-team-stepper">
                <span class="team-name">{{ match()!.team_a_name }}</span>
                <div class="stepper">
                  <button class="btn-mini" (click)="adjustMiniScore(0, -1)" [disabled]="actionLoading() || miniScoreA() === 0">−</button>
                  <span class="stepper-value">{{ miniScoreA() }}</span>
                  <button class="btn-mini" (click)="adjustMiniScore(0, 1)" [disabled]="actionLoading()">+</button>
                </div>
              </div>
              <span class="score-sep-sm">–</span>
              <div class="score-team-stepper">
                <span class="team-name">{{ match()!.team_b_name }}</span>
                <div class="stepper">
                  <button class="btn-mini" (click)="adjustMiniScore(1, -1)" [disabled]="actionLoading() || miniScoreB() === 0">−</button>
                  <span class="stepper-value">{{ miniScoreB() }}</span>
                  <button class="btn-mini" (click)="adjustMiniScore(1, 1)" [disabled]="actionLoading()">+</button>
                </div>
              </div>
              <div class="score-team-stepper">
                <span class="team-name">1er à</span>
                <select class="target-select" [ngModel]="miniTarget()" (ngModelChange)="setMiniTarget($event)" [disabled]="actionLoading()">
                  <option [ngValue]="3">3</option>
                  <option [ngValue]="5">5</option>
                  <option [ngValue]="7">7</option>
                </select>
              </div>
            </div>
            @if (miniScoreFeedback()) { <p class="feedback-success">{{ miniScoreFeedback() }}</p> }
            @if (miniScoreError()) { <p class="feedback-error">{{ miniScoreError() }}</p> }
          }
        </div>

        <!-- Équipes / buts / passes -->
        <div class="card">
          <h3 class="section-label">Buts et passes par équipe</h3>

          @if (unassignedPresent().length > 0) {
            <div class="unassigned-block">
              <p class="muted small">Joueurs sans équipe :</p>
              <ul class="stats-player-list">
                @for (reg of unassignedPresent(); track reg.id) {
                  <li class="stats-player-row">
                    <span class="player-name">{{ getDisplayName(reg.player) }}</span>
                    <div class="team-btns">
                      <button class="team-btn team-btn-a" (click)="setTeam(reg, 0)">A</button>
                      <button class="team-btn team-btn-b" (click)="setTeam(reg, 1)">B</button>
                    </div>
                  </li>
                }
              </ul>
            </div>
          }

          @for (team of teams; track team) {
            <div class="team-block">
              <div class="team-block-header">
                <span class="team-block-name">{{ teamName(team) }}</span>
                @if (match()!.score_a !== null) {
                  <span class="team-remaining">Reliquat : {{ teamGoalsRemaining(team) }} but(s), {{ teamAssistsRemaining(team) }} passe(s)</span>
                }
              </div>
              <ul class="stats-player-list">
                @for (reg of teamRegs(team); track reg.id) {
                  <li class="stats-player-row">
                    <span class="player-name">{{ getDisplayName(reg.player) }}</span>
                    <div class="team-btns">
                      <button class="team-btn team-btn-a" [class.active]="team === 0" (click)="setTeam(reg, 0)">A</button>
                      <button class="team-btn team-btn-b" [class.active]="team === 1" (click)="setTeam(reg, 1)">B</button>
                    </div>
                    @if (match()!.score_a !== null) {
                      <div class="stats-steppers">
                        <span class="stats-icon" title="Buts">⚽</span>
                        <button class="btn-mini" (click)="adjustGoals(reg, -1)" [disabled]="actionLoading() || reg.goals === 0">−</button>
                        <span class="stepper-value-sm">{{ reg.goals }}</span>
                        <button class="btn-mini" (click)="adjustGoals(reg, 1)" [disabled]="actionLoading() || !canIncrementGoals(reg)">+</button>
                        <span class="stats-icon" title="Passes décisives">🅰</span>
                        <button class="btn-mini" (click)="adjustAssists(reg, -1)" [disabled]="actionLoading() || reg.assists === 0">−</button>
                        <span class="stepper-value-sm">{{ reg.assists }}</span>
                        <button class="btn-mini" (click)="adjustAssists(reg, 1)" [disabled]="actionLoading() || !canIncrementAssists(reg)">+</button>
                      </div>
                    }
                  </li>
                } @empty {
                  <p class="muted small">Aucun joueur.</p>
                }
              </ul>
            </div>
          }

          @if (teamsError()) { <p class="feedback-error">{{ teamsError() }}</p> }
          @if (statsError()) { <p class="feedback-error">{{ statsError() }}</p> }
        </div>
      </div>
    }
  `,
  styles: `
    .center-msg { display: flex; align-items: center; justify-content: center; min-height: 50vh; color: var(--text-muted); }
    .card { border: var(--border-1); padding: var(--sp-lg); }
    .mb-sm { margin-bottom: 0.75rem; }

    .header { margin-bottom: 1.25rem; }
    .btn-back {
      background: none; border: none; padding: 0; margin-bottom: 0.5rem; cursor: pointer;
      color: var(--primary); font-size: 0.9rem; font-weight: 600; font-family: inherit;
      min-height: var(--tap-compact);
    }
    h2 { margin: 0 0 0.25rem; font-size: 1.2rem; }
    .match-meta { font-size: 0.85rem; color: var(--text-muted); margin: 0; }

    .section-label.mt { margin-top: 1rem; }
    .feedback-success { color: var(--success); font-size: 0.85rem; margin: 0.4rem 0 0; }
    .feedback-error { color: var(--danger); font-size: 0.85rem; margin: 0.4rem 0 0; }
    .muted.small { font-size: 0.85rem; color: var(--text-muted); }

    .score-steppers { display: flex; align-items: flex-end; gap: 1rem; flex-wrap: wrap; }
    .score-team-stepper { display: flex; flex-direction: column; gap: 0.3rem; min-width: 0; }
    .team-name { font-size: 0.8rem; font-weight: 600; color: var(--text-muted); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 8rem; }
    .stepper { display: flex; align-items: center; gap: 0.5rem; }
    .stepper-value { font-size: 1.4rem; font-weight: 900; min-width: 1.75rem; text-align: center; }
    .stepper-value-sm { font-size: 0.9rem; font-weight: 700; min-width: 1.25rem; text-align: center; }
    .score-sep-sm { font-size: 1.25rem; font-weight: 700; color: var(--text-muted); padding-bottom: 0.6rem; }
    .target-select {
      min-height: var(--tap-compact); padding: 0.4rem; border: var(--border-1); border-radius: 0.5rem;
      background: var(--card); color: var(--text); font-family: inherit; font-size: 0.95rem;
    }

    .btn-mini { width: var(--tap-compact); height: var(--tap-compact); border-radius: 50%; border: var(--border-1); background: var(--card); cursor: pointer; font-size: 1rem; display: flex; align-items: center; justify-content: center; font-family: inherit; line-height: 1; padding: 0; color: var(--text); }
    .btn-mini:disabled { opacity: 0.35; cursor: not-allowed; }

    .unassigned-block { margin-bottom: 1rem; padding-bottom: 0.75rem; border-bottom: 1px dashed var(--border); }
    .team-block { margin-top: 1rem; }
    .team-block-header { display: flex; align-items: baseline; justify-content: space-between; gap: 0.5rem; flex-wrap: wrap; margin-bottom: 0.4rem; }
    .team-block-name { font-weight: 700; font-size: 0.95rem; }
    .team-remaining { font-size: 0.78rem; color: var(--text-muted); }

    .stats-player-list { list-style: none; padding: 0; margin: 0; display: flex; flex-direction: column; gap: 0.2rem; }
    .stats-player-row { display: flex; align-items: center; justify-content: space-between; gap: 0.6rem; padding: 0.5rem 0.25rem; flex-wrap: wrap; row-gap: 0.4rem; border-radius: 0.5rem; }
    .stats-player-row:hover { background: var(--bg); }
    .player-name { font-size: 0.92rem; flex: 1 1 auto; min-width: 6rem; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

    .team-btns { display: flex; gap: 0.4rem; }
    .team-btn { padding: 0.2rem 0.65rem; border: var(--border-1); border-radius: 0.35rem; font-size: 0.8rem; font-weight: 700; cursor: pointer; background: transparent; color: var(--text-muted); font-family: inherit; transition: all 0.1s; min-height: var(--tap-compact); }
    .team-btn-a.active { background: ${TEAM_A_COLOR}; color: white; border-color: ${TEAM_A_COLOR}; }
    .team-btn-b.active { background: ${TEAM_B_COLOR}; color: white; border-color: ${TEAM_B_COLOR}; }

    .stats-steppers { display: flex; align-items: center; gap: 0.3rem; flex-basis: 100%; justify-content: flex-end; }
    .stats-icon { font-size: 0.85rem; margin-left: 0.3rem; }
    .stats-icon:first-child { margin-left: 0; }

    @media (min-width: 768px) {
      .stats-steppers { flex-basis: auto; }
    }
  `,
})
export class MatchStatsComponent implements OnInit {
  private readonly matchesService = inject(MatchesService);
  private readonly auth = inject(AuthService);
  private readonly groupsService = inject(GroupsService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);

  readonly getDisplayName = getDisplayName;
  readonly teams = [0, 1] as const;

  match = signal<Match | null>(null);
  registrations = signal<Registration[]>([]);
  group = signal<Group | null>(null);
  loading = signal(true);
  actionLoading = signal(false);

  scoreA = signal(0);
  scoreB = signal(0);
  miniScoreA = signal(0);
  miniScoreB = signal(0);
  miniTarget = signal(5);

  scoreFeedback = signal('');
  scoreError = signal('');
  miniScoreFeedback = signal('');
  miniScoreError = signal('');
  teamsError = signal('');
  statsError = signal('');

  readonly matchId = this.route.snapshot.params['id'] as string;
  readonly groupSlug = this.route.snapshot.params['groupSlug'] as string;

  miniMatchEnabled = computed(() => this.group()?.mini_match_enabled ?? false);

  presentRegs = computed(() => this.registrations().filter(r => !r.is_withdrawn));
  unassignedPresent = computed(() => this.presentRegs().filter(r => r.team === null));

  async ngOnInit(): Promise<void> {
    await Promise.all([this.loadMatch(), this.loadRegistrations()]);
    await this.loadGroup();
    this.loading.set(false);
  }

  private async loadMatch(): Promise<void> {
    try {
      const m = await this.matchesService.getMatch(this.matchId);
      this.match.set(m);
      this.scoreA.set(m.score_a ?? 0);
      this.scoreB.set(m.score_b ?? 0);
      this.miniScoreA.set(m.score_a2 ?? 0);
      this.miniScoreB.set(m.score_b2 ?? 0);
      this.miniTarget.set(m.mini_match_target ?? 5);
    } catch { this.match.set(null); }
  }

  private async loadRegistrations(): Promise<void> {
    try {
      this.registrations.set(await this.matchesService.getRegistrations(this.matchId));
    } catch { this.registrations.set([]); }
  }

  private async loadGroup(): Promise<void> {
    const groupId = this.match()?.group_id;
    if (!groupId) return;
    try { this.group.set(await this.groupsService.getGroup(groupId)); }
    catch { this.group.set(null); }
  }

  // Sorted once per registrations() change instead of re-filtering +
  // re-sorting (Intl.Collator via localeCompare) on every template read --
  // teamRegs/teamGoalsRemaining/canIncrementGoals/canIncrementAssists are
  // all called multiple times per change-detection pass (up to ~2x per
  // present player), which made the previous per-call filter+sort run
  // dozens of times per pass on a full roster.
  regsByTeam = computed<Record<0 | 1, Registration[]>>(() => {
    const byTeam: Record<0 | 1, Registration[]> = { 0: [], 1: [] };
    for (const reg of this.presentRegs()) {
      if (reg.team === 0 || reg.team === 1) byTeam[reg.team].push(reg);
    }
    const byName = (a: Registration, b: Registration) => getDisplayName(a.player).localeCompare(getDisplayName(b.player));
    byTeam[0].sort(byName);
    byTeam[1].sort(byName);
    return byTeam;
  });

  private teamGoalsTotal = computed<Record<0 | 1, number>>(() => ({
    0: this.regsByTeam()[0].reduce((sum, r) => sum + r.goals, 0),
    1: this.regsByTeam()[1].reduce((sum, r) => sum + r.goals, 0),
  }));

  private teamAssistsTotal = computed<Record<0 | 1, number>>(() => ({
    0: this.regsByTeam()[0].reduce((sum, r) => sum + r.assists, 0),
    1: this.regsByTeam()[1].reduce((sum, r) => sum + r.assists, 0),
  }));

  teamName(team: 0 | 1): string {
    const m = this.match();
    if (!m) return '';
    return team === 0 ? m.team_a_name : m.team_b_name;
  }

  teamRegs(team: 0 | 1): Registration[] {
    return this.regsByTeam()[team];
  }

  private teamScore(team: 0 | 1): number {
    const m = this.match();
    if (!m || m.score_a === null) return 0;
    return team === 0 ? m.score_a : (m.score_b ?? 0);
  }

  teamGoalsRemaining(team: 0 | 1): number {
    return computeStatsRemaining(this.teamScore(team), this.teamGoalsTotal()[team]);
  }

  teamAssistsRemaining(team: 0 | 1): number {
    return computeStatsRemaining(this.teamScore(team), this.teamAssistsTotal()[team]);
  }

  canIncrementGoals(reg: Registration): boolean {
    if (reg.team !== 0 && reg.team !== 1) return false;
    const otherTotal = this.teamGoalsTotal()[reg.team] - reg.goals;
    return reg.goals < computeStatsRemaining(this.teamScore(reg.team), otherTotal);
  }

  canIncrementAssists(reg: Registration): boolean {
    if (reg.team !== 0 && reg.team !== 1) return false;
    const otherTotal = this.teamAssistsTotal()[reg.team] - reg.assists;
    return reg.assists < computeStatsRemaining(this.teamScore(reg.team), otherTotal);
  }

  async adjustScore(team: 0 | 1, delta: number): Promise<void> {
    const admin = this.auth.currentPlayer();
    if (!admin) return;
    const nextA = team === 0 ? Math.max(0, this.scoreA() + delta) : this.scoreA();
    const nextB = team === 1 ? Math.max(0, this.scoreB() + delta) : this.scoreB();
    this.actionLoading.set(true);
    this.scoreError.set('');
    try {
      await this.matchesService.setMatchScore(this.matchId, nextA, nextB, admin.id);
      this.scoreA.set(nextA);
      this.scoreB.set(nextB);
      await Promise.all([this.loadMatch(), this.loadRegistrations()]);
      this.showFeedback(this.scoreFeedback, 'Score enregistré !');
    } catch (err) {
      this.scoreError.set(mapMatchStatsError(err, "Erreur lors de l'enregistrement"));
    } finally { this.actionLoading.set(false); }
  }

  async adjustMiniScore(team: 0 | 1, delta: number): Promise<void> {
    const admin = this.auth.currentPlayer();
    if (!admin) return;
    const nextA = team === 0 ? Math.max(0, this.miniScoreA() + delta) : this.miniScoreA();
    const nextB = team === 1 ? Math.max(0, this.miniScoreB() + delta) : this.miniScoreB();
    await this.saveMiniScore(nextA, nextB, this.miniTarget());
  }

  async setMiniTarget(target: number): Promise<void> {
    await this.saveMiniScore(this.miniScoreA(), this.miniScoreB(), target);
  }

  private async saveMiniScore(scoreA2: number, scoreB2: number, target: number): Promise<void> {
    const admin = this.auth.currentPlayer();
    if (!admin) return;
    this.actionLoading.set(true);
    this.miniScoreError.set('');
    try {
      await this.matchesService.setMiniMatchScore(this.matchId, scoreA2, scoreB2, target, admin.id);
      this.miniScoreA.set(scoreA2);
      this.miniScoreB.set(scoreB2);
      this.miniTarget.set(target);
      this.showFeedback(this.miniScoreFeedback, 'Mini-match enregistré !');
    } catch (err) {
      this.miniScoreError.set(mapAuthRpcError(err, "Erreur lors de l'enregistrement"));
    } finally { this.actionLoading.set(false); }
  }

  async setTeam(reg: Registration, team: 0 | 1): Promise<void> {
    const admin = this.auth.currentPlayer();
    if (!admin) return;
    if (reg.team === team) return;
    if (!confirmTeamReassignment(reg)) return;
    this.actionLoading.set(true);
    this.teamsError.set('');
    try {
      await this.matchesService.assignTeam(this.matchId, reg.player_id, team, admin.id);
      await this.loadRegistrations();
    } catch (err) {
      this.teamsError.set(mapAuthRpcError(err, "Impossible de modifier l'équipe"));
    } finally { this.actionLoading.set(false); }
  }

  async adjustGoals(reg: Registration, delta: number): Promise<void> {
    if (delta > 0 && !this.canIncrementGoals(reg)) return;
    await this.saveStats(reg, Math.max(0, reg.goals + delta), reg.assists);
  }

  async adjustAssists(reg: Registration, delta: number): Promise<void> {
    if (delta > 0 && !this.canIncrementAssists(reg)) return;
    await this.saveStats(reg, reg.goals, Math.max(0, reg.assists + delta));
  }

  private async saveStats(reg: Registration, goals: number, assists: number): Promise<void> {
    const admin = this.auth.currentPlayer();
    if (!admin) return;
    this.actionLoading.set(true);
    this.statsError.set('');
    try {
      await this.matchesService.setPlayerMatchStats(this.matchId, reg.player_id, goals, assists, admin.id);
      await this.loadRegistrations();
    } catch (err) {
      this.statsError.set(mapMatchStatsError(err, 'Erreur lors de la mise à jour des stats'));
    } finally { this.actionLoading.set(false); }
  }

  private feedbackTimeout: ReturnType<typeof setTimeout> | null = null;
  private showFeedback(target: typeof this.scoreFeedback, msg: string): void {
    target.set(msg);
    if (this.feedbackTimeout) clearTimeout(this.feedbackTimeout);
    this.feedbackTimeout = setTimeout(() => target.set(''), 2500);
  }

  goBack(): void {
    this.router.navigate([`/${this.groupSlug}/match/${this.matchId}`]);
  }

  formatDate(dateStr: string): string {
    return new Date(dateStr).toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' });
  }
  formatTime(timeStr: string): string { return timeStr.slice(0, 5); }
}
