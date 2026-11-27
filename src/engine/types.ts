/** Seat index, 0..playerCount-1, clockwise around the real table. */
export type Seat = number

/** The moderator opened the table and always sits in seat 0. */
export const MOD_SEAT: Seat = 0

export const MIN_SEATS = 2
export const MAX_SEATS = 10

export interface GameConfig {
  playerCount: number
  /** Where the button starts. */
  startingSeat: Seat
  names: string[]
  rulesVersion: string
  /** Chips every seat sits down with. */
  buyIn: number
  bigBlind: number
  smallBlind: number
}

export function defaultConfig(partial: Partial<GameConfig> & { playerCount: number }): GameConfig {
  const n = partial.playerCount
  return {
    startingSeat: 0,
    names: Array.from({ length: n }, (_, i) => `P${i + 1}`),
    rulesVersion: '1',
    buyIn: 1000,
    bigBlind: 10,
    smallBlind: 5,
    ...partial,
  }
}

export interface PlayerState {
  stack: number
  /** Chips put in on the current street; resets every street. */
  streetBet: number
  /** Chips put into the current hand (blinds included); the pot is the sum of these. */
  handBet: number
  /** Everything this seat has bought in for. Net result = stack + handBet - buyIns. */
  buyIns: number
  /** Dealt into the current hand. */
  dealtIn: boolean
  folded: boolean
  allIn: boolean
  /** Skips hands until the moderator sits them back in. */
  sittingOut: boolean
  /**
   * `currentBet` when this seat last acted on this street; null = owes an
   * action (not yet acted, or a full raise happened since). Strict no-limit
   * reopen bookkeeping: a seat with a non-null value may only call or fold.
   */
  actedAtBet: number | null
}

export type BettingPhase = 'preflop' | 'flop' | 'turn' | 'river'
/** `showdown` = betting is finished and the moderator names the winners. */
export type Phase = BettingPhase | 'showdown' | 'betweenHands' | 'over'

export const STREET_PHASES: readonly BettingPhase[] = ['preflop', 'flop', 'turn', 'river']

/** 0 preflop, 1 flop, 2 turn, 3 river. */
export type Street = 0 | 1 | 2 | 3

export interface Pot {
  amount: number
  /** Seats that can win this pot. One seat = uncalled chips that go straight back. */
  eligible: Seat[]
}

export type HandReason = 'showdown' | 'uncontested' | 'void'

/** Public recap of the last finished hand. */
export interface HandResult {
  handIndex: number
  reason: HandReason
  pot: number
  /** Main pot first, then side pots. */
  pots: (Pot & { winners: Seat[] })[]
  /** Chips paid out per seat. */
  awards: number[]
  winners: Seat[]
}

export type BetMoveType = 'fold' | 'check' | 'call' | 'bet' | 'raise' | 'allin'
export type ModMoveType = 'nextHand' | 'award' | 'voidHand' | 'rebuy' | 'transfer' | 'setBlinds' | 'sit' | 'closeTable'
export type MoveType = BetMoveType | ModMoveType

export interface LastAction {
  seat: Seat
  type: MoveType
  /** Chips moved by the action (0 for check/fold/table moves). */
  amount: number
  /** The moderator made this move for the seat. */
  proxy: boolean
}

export interface GameState {
  config: GameConfig
  /** Ordinal of the current hand, 1-based; 0 before the first hand. */
  handIndex: number
  /** Hands finished (voided hands do not count). */
  handsPlayed: number
  /** Blind seats of the current (or last) hand; null before hand 1. */
  sbSeat: Seat | null
  bbSeat: Seat | null
  /** The button of the current (or last) hand. */
  dealer: Seat
  /** Move the button when the next hand starts (false before hand 1 and after a void). */
  rotate: boolean
  phase: Phase
  street: Street
  seatToAct: Seat | null
  smallBlind: number
  bigBlind: number
  players: PlayerState[]
  /** Highest bet on this street: what everyone must match. */
  currentBet: number
  /** Size of the last full bet/raise; the minimum for the next one. */
  lastRaiseSize: number
  /** `to` of the last full bet/raise (the blind preflop, 0 postflop). */
  lastFullRaiseTo: number
  /** Betting stopped early because of all-ins: deal the rest of the board. */
  runout: boolean
  /** Pots waiting for the moderator during `showdown`; empty otherwise. */
  pots: Pot[]
  lastHand: HandResult | null
  lastAction: LastAction | null
  /** Set when the moderator closes the table: net chips per seat. */
  result: { nets: number[]; handsPlayed: number } | null
}

/** `proxy` marks a betting move the moderator makes for the seat to act. */
interface Proxy {
  proxy?: boolean
}

export type Move =
  | ({ type: 'fold' } & Proxy)
  /** Only when nothing is owed. */
  | ({ type: 'check' } & Proxy)
  /** Match the bet (pays min(toCall, stack)). */
  | ({ type: 'call' } & Proxy)
  /** Open the betting on a street with no bet yet (preflop: the unraised blind). */
  | ({ type: 'bet'; to: number } & Proxy)
  /** Raise the street bet to `to` (at least minRaiseTo, or exactly the whole stack). */
  | ({ type: 'raise'; to: number } & Proxy)
  /** Push the whole stack. */
  | ({ type: 'allin' } & Proxy)
  /* ---- moderator only ---- */
  /** Post the blinds and open the betting for a new hand. */
  | { type: 'nextHand' }
  /** Showdown: the winning seat(s) of every pot, in pot order. */
  | { type: 'award'; winners: Seat[][] }
  /** Misdeal: everyone gets their chips back and the hand is replayed. */
  | { type: 'voidHand' }
  /** Add chips bought in (or remove with a negative amount) between hands. */
  | { type: 'rebuy'; seat: Seat; amount: number }
  /** Move chips between two stacks between hands, to fix a mistake. */
  | { type: 'transfer'; from: Seat; to: Seat; amount: number }
  | { type: 'setBlinds'; small: number; big: number }
  | { type: 'sit'; seat: Seat; out: boolean }
  /** End the session and produce the settle-up. */
  | { type: 'closeTable' }
