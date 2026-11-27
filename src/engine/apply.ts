import { deepClone } from './clone'
import { betLimits, canOpenBet, inHandPhase, isBetting, live, minFullRaiseTo, potOf } from './legality'
import { clearHand, finishHand, settleTurn } from './resolve'
import { startHand } from './setup'
import { MOD_SEAT } from './types'
import type { GameState, Move, MoveType, PlayerState, Seat } from './types'

const BET_TYPES: readonly MoveType[] = ['fold', 'check', 'call', 'bet', 'raise', 'allin']

export function isBetMove(move: Move): boolean {
  return BET_TYPES.includes(move.type)
}

/**
 * The seat a move by `seat` is recorded under, or null when it may not make
 * it: betting moves belong to the seat to act (the moderator may make them
 * for that seat with `proxy`), everything else belongs to the moderator.
 */
export function actorFor(state: GameState, seat: Seat, move: Move): Seat | null {
  if (state.result) return null
  if (isBetMove(move)) {
    if (state.seatToAct === null) return null
    if ('proxy' in move && move.proxy) return seat === MOD_SEAT ? state.seatToAct : null
    return seat === state.seatToAct ? seat : null
  }
  return seat === MOD_SEAT ? MOD_SEAT : null
}

const isSeat = (state: GameState, seat: unknown): seat is Seat =>
  Number.isInteger(seat) && state.players[seat as number] !== undefined

/**
 * The single pure reducer. Throws on any illegal move (lowercase messages);
 * never mutates `prev`. Every branch depends only on the state and the move
 * itself, so all clients fold the same move log into the identical state.
 */
export function applyMove(prev: GameState, actor: Seat, move: Move): GameState {
  if (prev.result || prev.phase === 'over') throw new Error('table is closed')
  if (!isSeat(prev, actor)) throw new Error('no such seat')

  const state = deepClone(prev)
  const p = state.players[actor]

  if (!isBetMove(move)) {
    if (actor !== MOD_SEAT) throw new Error('only the moderator can do that')
    applyTableMove(state, move)
    return state
  }

  if (!isBetting(state.phase)) throw new Error('not in a betting round')
  if (actor !== state.seatToAct) throw new Error('not your turn')
  const proxy = 'proxy' in move && move.proxy === true
  const { toCall, maxRaiseTo } = betLimits(state, actor)

  switch (move.type) {
    case 'fold': {
      p.folded = true
      p.actedAtBet = state.currentBet
      record(state, actor, 'fold', 0, proxy)
      break
    }
    case 'check': {
      if (toCall > 0) throw new Error('cannot check facing a bet')
      p.actedAtBet = state.currentBet
      record(state, actor, 'check', 0, proxy)
      break
    }
    case 'call': {
      if (toCall === 0) throw new Error('nothing to call')
      const amount = Math.min(toCall, p.stack)
      pay(p, amount)
      p.actedAtBet = state.currentBet
      record(state, actor, 'call', amount, proxy)
      break
    }
    case 'bet': {
      if (!canOpenBet(state)) throw new Error('a bet is already open, raise instead')
      raiseTo(state, actor, move.to, 'bet', proxy)
      break
    }
    case 'raise': {
      if (canOpenBet(state)) throw new Error('nothing to raise, bet instead')
      raiseTo(state, actor, move.to, 'raise', proxy)
      break
    }
    case 'allin': {
      if (p.stack <= 0) throw new Error('no chips to push')
      if (maxRaiseTo > state.currentBet && p.actedAtBet === null) {
        raiseTo(state, actor, maxRaiseTo, 'allin', proxy)
      } else if (maxRaiseTo <= state.currentBet) {
        const amount = p.stack
        pay(p, amount)
        p.actedAtBet = state.currentBet
        record(state, actor, 'allin', amount, proxy)
      } else {
        throw new Error('betting is not reopened for this seat')
      }
      break
    }
    default:
      throw new Error('unknown move')
  }

  settleTurn(state, actor)
  return state
}

function applyTableMove(state: GameState, move: Move): void {
  const between = state.phase === 'betweenHands'
  switch (move.type) {
    case 'nextHand': {
      if (!between) throw new Error('a hand is in progress')
      record(state, MOD_SEAT, 'nextHand', 0)
      startHand(state)
      return
    }
    case 'award': {
      if (state.phase !== 'showdown') throw new Error('nothing to award')
      const pots = state.pots
      if (!Array.isArray(move.winners) || move.winners.length !== pots.length) throw new Error('name winners for every pot')
      move.winners.forEach((seats, i) => {
        if (!Array.isArray(seats) || seats.length === 0) throw new Error('every pot needs a winner')
        if (new Set(seats).size !== seats.length) throw new Error('duplicate winner')
        if (!seats.every((s) => pots[i].eligible.includes(s))) throw new Error('winner is not in that pot')
      })
      record(state, MOD_SEAT, 'award', potOf(state))
      finishHand(state, 'showdown', move.winners)
      return
    }
    case 'voidHand': {
      if (!inHandPhase(state.phase)) throw new Error('no hand to void')
      const pot = potOf(state)
      for (const p of state.players) p.stack += p.handBet
      state.lastHand = {
        handIndex: state.handIndex,
        reason: 'void',
        pot,
        pots: [],
        awards: state.players.map((p) => p.handBet),
        winners: [],
      }
      state.handIndex -= 1
      state.rotate = false
      clearHand(state)
      record(state, MOD_SEAT, 'voidHand', pot)
      return
    }
    case 'rebuy': {
      if (!between) throw new Error('chips change between hands')
      if (!isSeat(state, move.seat)) throw new Error('no such seat')
      if (!Number.isInteger(move.amount) || move.amount === 0) throw new Error('bad amount')
      const p = state.players[move.seat]
      if (p.stack + move.amount < 0) throw new Error('not that many chips to take off')
      p.stack += move.amount
      p.buyIns += move.amount
      record(state, move.seat, 'rebuy', move.amount)
      return
    }
    case 'transfer': {
      if (!between) throw new Error('chips change between hands')
      if (!isSeat(state, move.from) || !isSeat(state, move.to) || move.from === move.to) throw new Error('bad seats')
      if (!Number.isInteger(move.amount) || move.amount <= 0) throw new Error('bad amount')
      if (state.players[move.from].stack < move.amount) throw new Error('not that many chips to move')
      state.players[move.from].stack -= move.amount
      state.players[move.to].stack += move.amount
      record(state, move.to, 'transfer', move.amount)
      return
    }
    case 'setBlinds': {
      if (!between) throw new Error('blinds change between hands')
      if (!Number.isInteger(move.small) || !Number.isInteger(move.big)) throw new Error('blinds must be integers')
      if (move.small < 1 || move.small > move.big) throw new Error('bad blinds')
      state.smallBlind = move.small
      state.bigBlind = move.big
      record(state, MOD_SEAT, 'setBlinds', move.big)
      return
    }
    case 'sit': {
      if (!between) throw new Error('seats change between hands')
      if (!isSeat(state, move.seat)) throw new Error('no such seat')
      state.players[move.seat].sittingOut = move.out === true
      record(state, move.seat, 'sit', 0)
      return
    }
    case 'closeTable': {
      if (!between) throw new Error('finish the hand first')
      record(state, MOD_SEAT, 'closeTable', 0)
      state.phase = 'over'
      state.result = { nets: state.players.map((p) => p.stack - p.buyIns), handsPlayed: state.handsPlayed }
      return
    }
    default:
      throw new Error('unknown move')
  }
}

function record(state: GameState, seat: Seat, type: MoveType, amount: number, proxy = false): void {
  state.lastAction = { seat, type, amount, proxy }
}

function pay(p: PlayerState, amount: number): void {
  p.stack -= amount
  p.streetBet += amount
  p.handBet += amount
  if (p.stack === 0) p.allIn = true
}

/**
 * Bet/raise the street bet to `to`. Strict no-limit reopen: only a full
 * raise (at least the last raise size) resets the other live seats'
 * `actedAtBet`; a short all-in raises `currentBet` but does not reopen.
 */
function raiseTo(state: GameState, actor: Seat, to: number, type: MoveType, proxy: boolean): void {
  const p = state.players[actor]
  if (!Number.isInteger(to)) throw new Error('raise size must be an integer')
  const maxRaiseTo = p.streetBet + p.stack
  if (p.actedAtBet !== null) throw new Error('betting is not reopened for this seat')
  if (maxRaiseTo <= state.currentBet) throw new Error('not enough chips to raise')
  if (to <= state.currentBet) throw new Error('raise must exceed the current bet')
  if (to > maxRaiseTo) throw new Error('raise exceeds the stack')
  if (to < minFullRaiseTo(state) && to !== maxRaiseTo) throw new Error('raise is below the minimum')

  const amount = to - p.streetBet
  pay(p, amount)
  const prevBet = state.currentBet
  state.currentBet = to
  if (to - prevBet >= state.lastRaiseSize) {
    state.lastRaiseSize = to - prevBet
    state.lastFullRaiseTo = to
    state.players.forEach((q, seat) => {
      if (seat !== actor && live(q)) q.actedAtBet = null
    })
  }
  p.actedAtBet = to
  record(state, actor, type, amount, proxy)
}
