import { describe, expect, it } from 'vitest'
import { applyMove, bettingMoves, legalMoves, potOf, publicHash } from '../src/engine'
import type { GameState, Move } from '../src/engine'
import { MOD, boughtIn, chips, mulberry32, table } from './helpers'

/** One random legal step: the seat to act bets, otherwise the moderator runs the table. */
function step(s: GameState, rng: () => number): { actor: number; move: Move } {
  const pick = <T,>(xs: T[]): T => xs[Math.floor(rng() * xs.length)]
  if (s.seatToAct !== null) {
    if (rng() < 0.01) return { actor: MOD, move: { type: 'voidHand' } }
    const moves = bettingMoves(s, s.seatToAct)
    // fold less often so hands reach showdowns and side pots
    const keep = moves.filter((m) => m.type !== 'fold' || rng() < 0.3)
    return { actor: s.seatToAct, move: pick(keep.length ? keep : moves) }
  }
  if (s.phase === 'showdown') {
    const winners = s.pots.map((pot) => {
      const some = pot.eligible.filter(() => rng() < 0.4)
      return some.length ? some : [pick(pot.eligible)]
    })
    return { actor: MOD, move: { type: 'award', winners } }
  }
  // between hands: top up the broke, sometimes shuffle seats and blinds
  const broke = s.players.findIndex((p) => p.stack === 0)
  if (broke >= 0 && rng() < 0.7) return { actor: MOD, move: { type: 'rebuy', seat: broke, amount: 5000 } }
  if (rng() < 0.05) return { actor: MOD, move: { type: 'setBlinds', small: s.smallBlind * 2, big: s.bigBlind * 2 } }
  if (rng() < 0.05) {
    const seat = Math.floor(rng() * s.players.length)
    return { actor: MOD, move: { type: 'sit', seat, out: !s.players[seat].sittingOut } }
  }
  if (legalMoves(s, MOD).some((m) => m.type === 'nextHand')) return { actor: MOD, move: { type: 'nextHand' } }
  const idle = s.players.findIndex((p) => p.sittingOut || p.stack === 0)
  return s.players[idle].sittingOut
    ? { actor: MOD, move: { type: 'sit', seat: idle, out: false } }
    : { actor: MOD, move: { type: 'rebuy', seat: idle, amount: 5000 } }
}

describe('random sessions', () => {
  for (const n of [2, 3, 6, 10]) {
    it(`${n} seats: chips are conserved through 300 hands`, () => {
      const rng = mulberry32(100 + n)
      let s = table(n)
      const log: { actor: number; move: Move }[] = []
      for (let i = 0; i < 20000 && s.handsPlayed < 300; i++) {
        const next = step(s, rng)
        s = applyMove(s, next.actor, next.move)
        log.push(next)
        expect(chips(s)).toBe(boughtIn(s))
        expect(s.players.every((p) => p.stack >= 0 && p.handBet >= 0)).toBe(true)
        if (s.phase === 'showdown') expect(s.pots.reduce((a, p) => a + p.amount, 0)).toBe(potOf(s))
        if (s.phase === 'betweenHands') expect(potOf(s)).toBe(0)
      }
      expect(s.handsPlayed).toBe(300)
      s = applyMove(s, MOD, { type: 'closeTable' })
      expect(s.result!.nets.reduce((a, b) => a + b, 0)).toBe(0)

      // the same log replays to the same state on another client
      let replay = table(n)
      for (const { actor, move } of log) replay = applyMove(replay, actor, move)
      expect(publicHash(applyMove(replay, MOD, { type: 'closeTable' }))).toBe(publicHash(s))
    })
  }
})
