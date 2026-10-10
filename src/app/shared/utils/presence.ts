import { Registration } from '../models/registration.model';
import { getDisplayName } from '../models/player.model';

export type PresentEntry =
  | { type: 'player'; reg: Registration; rank: number }
  | { type: 'guest'; hostName: string; rank: number };

export function sortByRegisteredAt(regs: Registration[]): Registration[] {
  return [...regs].sort((a, b) => new Date(a.registered_at).getTime() - new Date(b.registered_at).getTime());
}

/**
 * Turns present registrations into a ranked list, inserting one "guest"
 * entry per plus_one right after its host -- rank is a 1-based position
 * in the présents/remplaçants list, not a registrations() array index.
 */
export function expandPresence(presentRegs: Registration[]): PresentEntry[] {
  let rank = 0;
  const entries: PresentEntry[] = [];
  for (const reg of presentRegs) {
    entries.push({ type: 'player', reg, rank: ++rank });
    for (let i = 0; i < (reg.plus_ones ?? 0); i++) {
      entries.push({ type: 'guest', hostName: getDisplayName(reg.player), rank: ++rank });
    }
  }
  return entries;
}

export function splitStartersSubstitutes(
  entries: PresentEntry[],
  maxPlayers: number,
): { starters: PresentEntry[]; substitutes: PresentEntry[] } {
  return {
    starters: entries.filter(e => e.rank <= maxPlayers),
    substitutes: entries.filter(e => e.rank > maxPlayers),
  };
}

/** Assumes the match is loaded -- callers decide what "no match" means. */
export function canWithdraw(reg: Registration, currentPlayerId: string, isMatchClosed: boolean): boolean {
  if (isMatchClosed || reg.is_withdrawn) return false;
  return reg.player_id === currentPlayerId || reg.registered_by === currentPlayerId;
}

/** Active (non-withdrawn) registrations an actor made for someone else. */
export function countActiveProxies(registrations: Registration[], actorId: string): number {
  return registrations.filter(r => !r.is_withdrawn && r.registered_by === actorId && r.player_id !== actorId).length;
}
