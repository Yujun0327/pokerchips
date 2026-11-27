import { contending, nextNeedingAction, potOf } from './legality'
import { STREET_PHASES } from './types'
import type { GameState, HandReason, PlayerState, Pot, Seat, Street } from './types'

/**
 * After any betting action: finish the hand when one contender remains,
 * end the street when every live contender has acted at the current bet,
 * otherwise hand the action to the next seat that owes one. `from` is the
 * seat the search starts after (the actor, or the blind/dealer on a fresh
 * street).
 */
export function settleTurn(state: GameState, from: Seat): void {
  const contenders = state.players.filter(contending)
  if (contenders.length <= 1) {
    const seat = state.players.findIndex(contending)
    finishHand(state, 'uncontested', slicePots(state).map(() => [seat]))
    return
  }
  const livePlayers = contenders.filter((p) => !p.allIn)
  const matched = (p: PlayerState) => p.streetBet >= state.currentBet
  const roundOver =
    livePlayers.every((p) => p.actedAtBet === state.currentBet) ||
    (livePlayers.length <= 1 && livePlayers.every(matched))
  if (roundOver) {
    endStreet(state)
    return
  }
  if (from === state.seatToAct || state.seatToAct === null) {
    state.seatToAct = nextNeedingAction(state, from)
    if (state.seatToAct === null) endStreet(state)
  }
}

/** Open the next street, or stop for the showdown when nobody can bet any more. */
function endStreet(state: GameState): void {
  const livePlayers = state.players.filter((p) => contending(p) && !p.allIn)
  if (livePlayers.length <= 1 || state.street === 3) {
    state.runout = state.street < 3
    state.pots = slicePots(state)
    state.phase = 'showdown'
    state.seatToAct = null
    return
  }
  state.street = (state.street + 1) as Street
  state.phase = STREET_PHASES[state.street]
  state.currentBet = 0
  state.lastRaiseSize = state.bigBlind
  state.lastFullRaiseTo = 0
  for (const p of state.players) {
    p.streetBet = 0
    p.actedAtBet = null
  }
  state.seatToAct = null
  settleTurn(state, state.dealer)
}

/**
 * Main and side pots by `handBet` level among the contenders. Folded chips
 * fall into the pots they reached; anything above the top level joins the
 * last pot. A pot with a single eligible seat is that seat's uncalled bet.
 */
export function slicePots(state: GameState): Pot[] {
  const contenders = state.players.flatMap((p, seat) => (contending(p) ? [seat] : []))
  const levels = [...new Set(contenders.map((s) => state.players[s].handBet))].sort((a, b) => a - b)
  const pots: Pot[] = []
  let prev = 0
  levels.forEach((level, i) => {
    let amount = state.players.reduce((sum, p) => sum + Math.min(p.handBet, level) - Math.min(p.handBet, prev), 0)
    if (i === levels.length - 1) {
      amount += state.players.reduce((sum, p) => sum + p.handBet - Math.min(p.handBet, level), 0)
    }
    pots.push({ amount, eligible: contenders.filter((s) => state.players[s].handBet >= level) })
    prev = level
  })
  return pots
}

/** Even split; the odd chips go to the first winner clockwise from the button. */
export function splitAmong(state: GameState, awards: number[], amount: number, seats: Seat[]): void {
  if (seats.length === 0 || amount === 0) return
  const share = Math.floor(amount / seats.length)
  let remainder = amount - share * seats.length
  for (const s of seats) awards[s] += share
  const n = state.players.length
  for (let k = 1; k <= n && remainder > 0; k++) {
    const seat = (state.dealer + k) % n
    if (seats.includes(seat)) {
      awards[seat] += remainder
      remainder = 0
    }
  }
}

/** Pay every pot to its winners, clear the hand and wait for the next deal. */
export function finishHand(state: GameState, reason: HandReason, winnersPerPot: Seat[][]): void {
  const pots = slicePots(state)
  const awards = new Array<number>(state.players.length).fill(0)
  const winners: Seat[] = []
  pots.forEach((pot, i) => {
    splitAmong(state, awards, pot.amount, winnersPerPot[i])
    for (const s of winnersPerPot[i]) if (!winners.includes(s)) winners.push(s)
  })
  state.lastHand = {
    handIndex: state.handIndex,
    reason,
    pot: potOf(state),
    pots: pots.map((pot, i) => ({ ...pot, winners: [...winnersPerPot[i]] })),
    awards,
    winners: winners.sort((a, b) => a - b),
  }
  state.players.forEach((p, seat) => {
    p.stack += awards[seat]
  })
  state.handsPlayed += 1
  state.rotate = true
  clearHand(state)
}

/** Reset the per-hand bookkeeping and go back to `betweenHands`. */
export function clearHand(state: GameState): void {
  for (const p of state.players) {
    p.streetBet = 0
    p.handBet = 0
    p.dealtIn = false
    p.folded = false
    p.allIn = false
    p.actedAtBet = null
  }
  state.pots = []
  state.currentBet = 0
  state.lastRaiseSize = 0
  state.lastFullRaiseTo = 0
  state.seatToAct = null
  state.street = 0
  state.phase = 'betweenHands'
}
