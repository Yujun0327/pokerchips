import { active, activeCount, nextActiveFrom } from './legality'
import { settleTurn } from './resolve'
import { MAX_SEATS, MIN_SEATS } from './types'
import type { GameConfig, GameState, PlayerState, Seat } from './types'

/**
 * Deterministic: the same config produces the identical state on every
 * client. The table opens between hands; the moderator starts hand 1.
 */
export function createGame(cfg: GameConfig): GameState {
  if (cfg.playerCount < MIN_SEATS || cfg.playerCount > MAX_SEATS) throw new Error('2 to 10 players')
  if (cfg.names.length !== cfg.playerCount) throw new Error('one name per seat')
  if (cfg.startingSeat < 0 || cfg.startingSeat >= cfg.playerCount) throw new Error('bad starting seat')
  if (![cfg.buyIn, cfg.bigBlind, cfg.smallBlind].every(Number.isInteger)) throw new Error('stakes must be integers')
  if (cfg.smallBlind < 1 || cfg.smallBlind > cfg.bigBlind || cfg.bigBlind > cfg.buyIn) throw new Error('bad stakes')

  const players: PlayerState[] = Array.from({ length: cfg.playerCount }, () => ({
    stack: cfg.buyIn,
    streetBet: 0,
    handBet: 0,
    buyIns: cfg.buyIn,
    dealtIn: false,
    folded: false,
    allIn: false,
    sittingOut: false,
    actedAtBet: null,
  }))

  return {
    config: cfg,
    handIndex: 0,
    handsPlayed: 0,
    sbSeat: null,
    bbSeat: null,
    dealer: cfg.startingSeat,
    rotate: false,
    phase: 'betweenHands',
    street: 0,
    seatToAct: null,
    smallBlind: cfg.smallBlind,
    bigBlind: cfg.bigBlind,
    players,
    currentBet: 0,
    lastRaiseSize: 0,
    lastFullRaiseTo: 0,
    runout: false,
    pots: [],
    lastHand: null,
    lastAction: null,
    result: null,
  }
}

/** Where the button will be for the next hand. */
export function nextDealer(state: GameState): Seat {
  return nextActiveFrom(state, state.rotate ? state.dealer + 1 : state.dealer)
}

/** Blind seats for a hand with the button at `dealer`: heads-up the button posts the small blind. */
export function blindSeats(state: GameState, dealer: Seat = state.dealer): { sb: Seat; bb: Seat } {
  if (activeCount(state) === 2) {
    return { sb: dealer, bb: nextActiveFrom(state, dealer + 1) }
  }
  const sb = nextActiveFrom(state, dealer + 1)
  return { sb, bb: nextActiveFrom(state, sb + 1) }
}

function postBlind(p: PlayerState, blind: number): void {
  const amount = Math.min(blind, p.stack)
  p.stack -= amount
  p.streetBet += amount
  p.handBet += amount
  if (p.stack === 0) p.allIn = true
}

/**
 * Mutates `state` in place (callers own a fresh clone): moves the button,
 * deals in every active seat, posts the blinds and opens the preflop round
 * with the seat after the big blind (heads-up: the button).
 */
export function startHand(state: GameState): void {
  if (activeCount(state) < 2) throw new Error('need two players with chips')
  state.dealer = nextDealer(state)
  for (const p of state.players) {
    p.streetBet = 0
    p.handBet = 0
    p.dealtIn = active(p)
    p.folded = false
    p.allIn = false
    p.actedAtBet = null
  }
  const { sb, bb } = blindSeats(state)
  state.sbSeat = sb
  state.bbSeat = bb
  postBlind(state.players[sb], state.smallBlind)
  postBlind(state.players[bb], state.bigBlind)

  state.handIndex += 1
  state.street = 0
  state.phase = 'preflop'
  state.currentBet = state.bigBlind
  state.lastRaiseSize = state.bigBlind
  state.lastFullRaiseTo = state.bigBlind
  state.runout = false
  state.pots = []
  state.seatToAct = null
  settleTurn(state, bb)
}
