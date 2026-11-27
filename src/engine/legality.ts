import { MOD_SEAT } from './types'
import type { GameState, Move, Phase, PlayerState, Seat } from './types'

/** The pot is derived: everything committed this hand. */
export function potOf(state: GameState): number {
  return state.players.reduce((sum, p) => sum + p.handBet, 0)
}

export function isBetting(phase: Phase): boolean {
  return phase === 'preflop' || phase === 'flop' || phase === 'turn' || phase === 'river'
}

/** A hand is in progress (betting or waiting for the moderator's award). */
export function inHandPhase(phase: Phase): boolean {
  return isBetting(phase) || phase === 'showdown'
}

/** Still contesting the pot. */
export function contending(p: PlayerState): boolean {
  return p.dealtIn && !p.folded
}

/** Contesting and still able to bet. */
export function live(p: PlayerState): boolean {
  return contending(p) && !p.allIn
}

/** Will be dealt into the next hand. */
export function active(p: PlayerState): boolean {
  return !p.sittingOut && p.stack > 0
}

export function activeCount(state: GameState): number {
  return state.players.filter(active).length
}

export function toCall(state: GameState, seat: Seat): number {
  return Math.max(0, state.currentBet - state.players[seat].streetBet)
}

export interface BetLimits {
  /** Chips owed to match `currentBet`. */
  toCall: number
  /** Smallest legal `to` for bet/raise (clamped to the stack). */
  minRaiseTo: number
  /** `streetBet + stack`: the all-in `to`. */
  maxRaiseTo: number
  /** May this seat bet/raise at all (reopened and has chips beyond the call)? */
  canRaise: boolean
  pot: number
}

/**
 * The unclamped minimum: a full raise over the current bet. Short all-ins
 * lift `currentBet` without changing the raise size, so this is measured
 * from the bet to match, not from the last full raise.
 */
export function minFullRaiseTo(state: GameState): number {
  return state.currentBet + state.lastRaiseSize
}

export function betLimits(state: GameState, seat: Seat): BetLimits {
  const p = state.players[seat]
  const maxRaiseTo = p.streetBet + p.stack
  return {
    toCall: toCall(state, seat),
    minRaiseTo: Math.min(minFullRaiseTo(state), maxRaiseTo),
    maxRaiseTo,
    canRaise: live(p) && p.actedAtBet === null && maxRaiseTo > state.currentBet,
    pot: potOf(state),
  }
}

/** No bet on this street yet: the unraised blind preflop, or 0 postflop. */
export function canOpenBet(state: GameState): boolean {
  if (state.currentBet === 0) return true
  return state.street === 0 && state.currentBet === state.bigBlind && state.lastFullRaiseTo === state.bigBlind
}

/** Canonical `to` sizes for the UI presets: min, half pot, pot, all-in (clamped and deduplicated). */
export function raiseSizes(state: GameState, seat: Seat): number[] {
  const { toCall: owed, minRaiseTo, maxRaiseTo, canRaise, pot } = betLimits(state, seat)
  if (!canRaise) return []
  const afterCall = pot + owed
  const clamp = (to: number) => Math.min(maxRaiseTo, Math.max(minRaiseTo, to))
  const sizes = [
    minRaiseTo,
    clamp(state.currentBet + Math.floor(afterCall / 2)),
    clamp(state.currentBet + afterCall),
    maxRaiseTo,
  ]
  return [...new Set(sizes)].sort((a, b) => a - b)
}

/** The betting moves open to the seat whose turn it is (bet/raise at the canonical sizes). */
export function bettingMoves(state: GameState, seat: Seat): Move[] {
  if (!isBetting(state.phase) || seat !== state.seatToAct) return []
  const p = state.players[seat]
  const { toCall: owed, maxRaiseTo, canRaise } = betLimits(state, seat)
  const moves: Move[] = [{ type: 'fold' }]
  if (owed === 0) moves.push({ type: 'check' })
  else moves.push({ type: 'call' })
  if (canRaise) {
    const sizes = raiseSizes(state, seat)
    if (canOpenBet(state)) for (const to of sizes) moves.push({ type: 'bet', to })
    else for (const to of sizes) moves.push({ type: 'raise', to })
  }
  if (p.stack > 0 && (canRaise || maxRaiseTo <= state.currentBet)) moves.push({ type: 'allin' })
  return moves
}

/**
 * Every legal move for `seat` as itself: its betting moves on its turn, plus
 * the moderator's table moves (one representative each; `applyMove` checks
 * the arguments). Proxy moves are listed by `bettingMoves(state, seatToAct)`.
 */
export function legalMoves(state: GameState, seat: Seat): Move[] {
  const p = state.players[seat]
  if (!p || state.phase === 'over' || state.result) return []
  const moves = bettingMoves(state, seat)
  if (seat !== MOD_SEAT) return moves

  if (state.phase === 'betweenHands') {
    if (activeCount(state) >= 2) moves.push({ type: 'nextHand' })
    moves.push({ type: 'closeTable' })
    moves.push({ type: 'setBlinds', small: state.smallBlind, big: state.bigBlind })
    moves.push({ type: 'rebuy', seat, amount: state.config.buyIn })
    moves.push({ type: 'sit', seat, out: !p.sittingOut })
    return moves
  }
  moves.push({ type: 'voidHand' })
  if (state.phase === 'showdown') {
    moves.push({ type: 'award', winners: state.pots.map((pot) => [pot.eligible[0]]) })
  }
  return moves
}

/** First seat clockwise after `from` that still owes an action this street, or null. */
export function nextNeedingAction(state: GameState, from: number): Seat | null {
  const n = state.players.length
  for (let k = 1; k <= n; k++) {
    const seat = (from + k) % n
    const p = state.players[seat]
    if (live(p) && p.actedAtBet !== state.currentBet) return seat
  }
  return null
}

/** First active seat at or after `from`, or `from` itself when none. */
export function nextActiveFrom(state: GameState, from: number): Seat {
  const n = state.players.length
  for (let k = 0; k < n; k++) {
    const seat = (((from + k) % n) + n) % n
    if (active(state.players[seat])) return seat
  }
  return ((from % n) + n) % n
}
