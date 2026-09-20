import { getDisplayName } from '../models/player.model';

export interface StatsHolder {
  goals: number;
  assists: number;
  player: { display_name: string | null; username: string };
}

/**
 * Confirms with the admin before reassigning a player who already has
 * declared goals/assists on the match. This is a business rule, not just a
 * UI nicety: assign_team (supabase/playerstats.sql) silently resets both
 * to 0 server-side on a real team change, so skipping this check would let
 * an admin lose declared stats without warning.
 *
 * Shared between match-detail.component.ts (presence panel's quick A/B
 * buttons) and match-stats.component.ts (dedicated result-entry screen) --
 * both can trigger a team reassignment and must apply the exact same rule.
 */
export function confirmTeamReassignment(reg: StatsHolder): boolean {
  if (reg.goals === 0 && reg.assists === 0) return true;
  return confirm(
    `${getDisplayName(reg.player)} a déjà des buts/passes déclarés. Changer son équipe les remettra à 0. Continuer ?`
  );
}
