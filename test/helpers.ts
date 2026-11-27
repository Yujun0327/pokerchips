import { applyMove, createGame, defaultConfig } from '../src/engine'
import type { GameConfig, GameState, Move, Seat } from '../src/engine'

export const MOD = 0

/** A table between hands (blinds 50/100, 10,000 each unless overridden). */
export function table(playerCount: number, overrides: Partial<GameConfig> = {}): GameState {
  return createGame(defaultConfig({ playerCount, buyIn: 10000, bigBlind: 100, smallBlind: 50, ...overrides }))
}

/** A table with hand 1 dealt (button on seat 0). */
export function newGame(playerCount: number, overrides: Partial<GameConfig> = {}): GameState {
  return applyMove(table(playerCount, overrides), MOD, { type: 'nextHand' })
}

/** Hand 1 dealt with these stacks; buy-ins are adjusted so the ledger still balances. */
export function withStacks(stacks: number[]): GameState {
  let s = table(stacks.length)
  stacks.forEach((stack, seat) => {
    if (stack !== 10000) s = applyMove(s, MOD, { type: 'rebuy', seat, amount: stack - 10000 })
  })
  return applyMove(s, MOD, { type: 'nextHand' })
}

export function play(state: GameState, steps: [Seat, Move][]): GameState {
  let s = state
  for (const [seat, move] of steps) s = applyMove(s, seat, move)
  return s
}

/** Every chip on the table: stacks plus the pot. */
export function chips(state: GameState): number {
  return state.players.reduce((sum, p) => sum + p.stack + p.handBet, 0)
}

export function boughtIn(state: GameState): number {
  return state.players.reduce((sum, p) => sum + p.buyIns, 0)
}

/** Deterministic PRNG for the playouts. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
