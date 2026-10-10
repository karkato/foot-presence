import { describe, expect, it } from 'vitest';
import { Registration } from '../models/registration.model';
import { canWithdraw, countActiveProxies, expandPresence, splitStartersSubstitutes } from './presence';

function makeReg(overrides: Partial<Registration> & { id: string }): Registration {
  return {
    match_id: 'match-1',
    player_id: overrides.id,
    registered_by: overrides.id,
    registered_at: '2026-01-01T00:00:00Z',
    is_withdrawn: false,
    plus_ones: 0,
    team: null,
    goals: 0,
    assists: 0,
    player: { id: overrides.id, username: overrides.id, display_name: null },
    ...overrides,
  };
}

describe('expandPresence + splitStartersSubstitutes', () => {
  it('inserts one guest entry per plus_one right after its host', () => {
    const regs = [
      makeReg({ id: 'p1', plus_ones: 1 }),
      makeReg({ id: 'p2' }),
      makeReg({ id: 'p3' }),
    ];

    const entries = expandPresence(regs);

    expect(entries).toEqual([
      { type: 'player', reg: regs[0], rank: 1 },
      { type: 'guest', hostName: 'p1', rank: 2 },
      { type: 'player', reg: regs[1], rank: 3 },
      { type: 'player', reg: regs[2], rank: 4 },
    ]);
  });

  it('a plus_one can push the next real player into the substitutes list', () => {
    const regs = [
      makeReg({ id: 'p1', plus_ones: 1 }),
      makeReg({ id: 'p2' }),
      makeReg({ id: 'p3' }),
    ];
    const entries = expandPresence(regs);

    const { starters, substitutes } = splitStartersSubstitutes(entries, 3);

    expect(starters.map(e => e.rank)).toEqual([1, 2, 3]);
    expect(substitutes.map(e => e.rank)).toEqual([4]);
    expect(substitutes[0]).toMatchObject({ type: 'player', reg: regs[2] });
  });

  it('putting everyone in starters when maxPlayers covers every rank', () => {
    const entries = expandPresence([makeReg({ id: 'p1' }), makeReg({ id: 'p2' })]);
    const { starters, substitutes } = splitStartersSubstitutes(entries, 10);
    expect(starters.length).toBe(2);
    expect(substitutes.length).toBe(0);
  });
});

describe('canWithdraw', () => {
  it('forbids withdrawing from a closed match', () => {
    const reg = makeReg({ id: 'p1' });
    expect(canWithdraw(reg, 'p1', true)).toBe(false);
  });

  it('forbids withdrawing an already-withdrawn registration', () => {
    const reg = makeReg({ id: 'p1', is_withdrawn: true });
    expect(canWithdraw(reg, 'p1', false)).toBe(false);
  });

  it('allows the player themselves to withdraw', () => {
    const reg = makeReg({ id: 'p1' });
    expect(canWithdraw(reg, 'p1', false)).toBe(true);
  });

  it('allows whoever registered a proxy to withdraw them', () => {
    const reg = makeReg({ id: 'guest-player', registered_by: 'p1' });
    expect(canWithdraw(reg, 'p1', false)).toBe(true);
  });

  it('forbids an unrelated player from withdrawing someone else', () => {
    const reg = makeReg({ id: 'p1', registered_by: 'p1' });
    expect(canWithdraw(reg, 'p2', false)).toBe(false);
  });
});

describe('countActiveProxies', () => {
  it('counts only active registrations the actor made for someone else', () => {
    const regs = [
      makeReg({ id: 'p1' }), // self-registration, not a proxy
      makeReg({ id: 'guest1', registered_by: 'p1' }),
      makeReg({ id: 'guest2', registered_by: 'p1' }),
      makeReg({ id: 'guest3', registered_by: 'p1', is_withdrawn: true }), // withdrawn, doesn't count
      makeReg({ id: 'guest4', registered_by: 'p2' }), // someone else's proxy
    ];

    expect(countActiveProxies(regs, 'p1')).toBe(2);
  });

  it('returns 0 when the actor has no proxies', () => {
    const regs = [makeReg({ id: 'p1' }), makeReg({ id: 'p2' })];
    expect(countActiveProxies(regs, 'p1')).toBe(0);
  });
});
