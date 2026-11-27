import {
  MAX_SEATS,
  MIN_SEATS,
  MOD_SEAT,
  actorFor,
  applyMove,
  bettingMoves,
  createGame,
  defaultConfig,
  potOf,
  publicHash,
} from '../engine'
import type { GameConfig, GameState, Move, Seat } from '../engine'
import { BeaconSession, brokersFromEnv, connectMqtt, type Beacon, type GameAdapter, type Transport } from '@yujun/game-net'
import { APP } from './persist'

export const RULES_VERSION = '1'
const PROTOCOL = 1

/** What the moderator chooses in the lobby. */
export interface Pick {
  buyIn: number
  small: number
  big: number
}

export const DEFAULT_PICK: Pick = { buyIn: 1000, small: 5, big: 10 }

export function validPick(p: Pick): boolean {
  return [p.buyIn, p.small, p.big].every(Number.isInteger) && p.small >= 1 && p.small <= p.big && p.big <= p.buyIn
}

/** "I would like more chips": stands until the seat's buy-in total changes. */
interface RebuyAsk {
  gameId: string
  buyIns: number
}

/** The game-defined part of a beacon. */
interface Extra {
  pick?: Pick
  /** The moderator's seating order (player keys, clockwise). */
  order?: string[]
  rebuy?: RebuyAsk
}

export type OnlineStatus = 'connecting' | 'lobby' | 'playing' | 'desync' | 'room-full' | 'version-mismatch'

export interface LobbySeat {
  playerKey: string
  name: string
  connected: boolean
  host: boolean
  self: boolean
}

type Wire = Beacon<GameConfig, Move>
type Core = BeaconSession<GameConfig, GameState, Move>

function makeAdapter(host: () => TableSession | null): GameAdapter<GameConfig, GameState, Move> {
  return {
    app: APP,
    protocol: PROTOCOL,
    rulesVersion: RULES_VERSION,
    minSeats: MIN_SEATS,
    maxSeats: MAX_SEATS,
    makeConfig: (players, prev) => {
      const n = Math.max(MIN_SEATS, Math.min(MAX_SEATS, players.length))
      const h = host()
      const pick = prev
        ? { buyIn: prev.buyIn, small: prev.smallBlind, big: prev.bigBlind }
        : h && validPick(h.pick)
          ? h.pick
          : DEFAULT_PICK
      return defaultConfig({
        playerCount: n,
        startingSeat: prev ? (prev.startingSeat + 1) % n : Math.floor(Math.random() * n),
        names: Array.from({ length: n }, (_, i) => players[i]?.name.trim() || `Seat ${i + 1}`),
        rulesVersion: RULES_VERSION,
        buyIn: pick.buyIn,
        bigBlind: pick.big,
        smallBlind: pick.small,
      })
    },
    // the moderator (who hosts) takes seat 0, the rest follow in the order arranged in the lobby
    orderSeats: (players, prev) => {
      const h = host()
      if (prev || !h) return players
      const rank = (key: string) => (key === h.myKey ? -1 : h.orderIndex(key))
      return [...players].sort((a, b) => rank(a.key) - rank(b.key))
    },
    create: (cfg) => ({ state: createGame(cfg) }),
    apply: applyMove,
    hash: publicHash,
    actor: (s) => s.seatToAct ?? MOD_SEAT,
    isOver: (s) => s.result !== null,
    actorFor,
  }
}

/** Let `before` look at every incoming message ahead of the session. */
function tap<M>(inner: Transport<M>, before: (msg: M) => void): Transport<M> {
  return {
    send: (m) => inner.send(m),
    onMessage: (fn) =>
      inner.onMessage((m) => {
        before(m)
        fn(m)
      }),
    onUp: (fn) => inner.onUp(fn),
    close: () => inner.close(),
    channelCount: () => inner.channelCount(),
    channels: () => inner.channels(),
    wake: () => inner.wake(),
  }
}

export interface TestHooks {
  transport?: Transport<Wire>
  now?: () => number
  timers?: boolean
}

/** One phone at the table: the synced game plus lobby options and rebuy requests. */
export class TableSession {
  state = $state<GameState>() as GameState
  readonly room: string
  readonly myKey: string

  private readonly core: Core
  private rev = $state(0)
  private hostPick = $state<Pick>(DEFAULT_PICK)
  private hostOrder = $state<string[]>([])
  private myAsk: RebuyAsk | null = null

  constructor(room: string, creator: boolean, identity: { key: string; name: string }, test: TestHooks = {}) {
    const self: { s: TableSession | null } = { s: null }
    const inner =
      test.transport ??
      connectMqtt<Wire>({
        app: APP,
        protocol: PROTOCOL,
        room: room.toUpperCase(),
        brokers: brokersFromEnv(import.meta.env as Record<string, string | undefined>),
        log: (t) => console.log(`[${APP}] ${t}`),
      })
    const core: Core = new BeaconSession(makeAdapter(() => self.s), {
      room,
      creator,
      identity,
      transport: tap(inner, (b) => self.s?.repairFork(b)),
      now: test.now,
      timers: test.timers,
      log: (t) => console.log(`[${APP}] ${t}`),
    })
    self.s = this
    this.core = core
    this.room = core.room
    this.myKey = core.myKey
    this.state = core.state
    core.subscribe(() => this.sync())
    this.sync()
  }

  private get c(): Core {
    void this.rev
    return this.core
  }

  private sync(): void {
    const core = this.core
    this.state = core.state
    if (!core.started) {
      // nobody has to tap "ready": being in the room is enough
      if (!core.ready) {
        core.setReady(true)
        return
      }
      if (core.isHost) {
        if (!(core.extra as Extra | undefined)?.pick) this.announce()
      } else {
        const extra = core.livePeers.find((p) => p.key === core.hostKey)?.extra as Extra | undefined
        if (extra?.pick && validPick(extra.pick)) this.hostPick = extra.pick
        if (Array.isArray(extra?.order)) this.hostOrder = extra.order
      }
    } else if (this.myAsk && !this.askStands(this.myAsk, core.seat)) {
      this.myAsk = null
      core.setExtra({})
      return
    }
    this.rev++
  }

  /**
   * Two phones can stamp the same move number at once (the moderator steps in
   * just as a player acts). The session layer has no tie-break, so settle it
   * here before it merges: the branch whose move hash sorts lower wins, and
   * the loser rewinds to the fork so the winning moves apply cleanly.
   */
  private repairFork(b: Wire): void {
    const core = this.core
    const snap = core.snapshot
    const g = b?.game
    if (!snap || !g || b.key === this.myKey || g.gameId !== snap.gameId || !Array.isArray(g.log)) return
    for (const theirs of g.log) {
      const mine = snap.log[theirs.seq - 1]
      if (!mine) return
      if (mine.hash === theirs.hash) continue
      const atTailStart = theirs === g.log[0] && g.logBase > 0
      // the fork itself is older than their tail: the longer log wins and we replay it whole
      const lose = atTailStart ? g.logLen > snap.log.length || (g.logLen === snap.log.length && theirs.hash < mine.hash) : theirs.hash < mine.hash
      if (lose) this.rewind(atTailStart ? 0 : theirs.seq - 1)
      return
    }
  }

  private rewind(keep: number): void {
    const core = this.core
    const snap = core.snapshot!
    const log = snap.log.slice(0, keep)
    let st = createGame(snap.cfg)
    for (const w of log) st = applyMove(st, w.actor, w.move)
    console.log(`[${APP}] fork: rewinding to move ${keep}`)
    core.snapshot = { ...snap, log }
    core.state = st
    if (core.status === 'desync') core.status = 'playing'
  }

  /* ---------------- connection ---------------- */

  get status(): OnlineStatus {
    return this.c.status
  }

  get playing(): boolean {
    return this.c.playing
  }

  get isHost(): boolean {
    return this.c.isHost
  }

  relayCount(): number {
    return this.core.channelCount()
  }

  brokerCount(): number {
    return this.core.channels().length
  }

  rescan(): void {
    this.core.rescan()
  }

  get net(): Core {
    return this.core
  }

  /* ---------------- lobby ---------------- */

  /** Position of a key in the moderator's seating order (unknown keys go last). */
  orderIndex(key: string): number {
    const i = this.hostOrder.indexOf(key)
    return i < 0 ? Number.MAX_SAFE_INTEGER : i
  }

  /** Lobby roster in table order: the moderator first, then clockwise. */
  get seats(): LobbySeat[] {
    const rank = (p: { key: string; host: boolean }) => (p.host ? -1 : this.orderIndex(p.key))
    return this.c.players
      .map((p, i) => ({ p, i }))
      .sort((a, b) => rank(a.p) - rank(b.p) || a.i - b.i)
      .map(({ p }) => ({ playerKey: p.key, name: p.name, connected: p.connected, host: p.host, self: p.self }))
  }

  /** Moderator: move a player one place earlier (-1) or later (+1) around the table. */
  moveSeat(key: string, dir: -1 | 1): void {
    if (!this.core.isHost || this.core.started) return
    const keys = this.seats.map((s) => s.playerKey)
    const i = keys.indexOf(key)
    const j = i + dir
    if (i < 1 || j < 1 || j >= keys.length) return
    ;[keys[i], keys[j]] = [keys[j], keys[i]]
    this.hostOrder = keys
    this.announce()
  }

  get pick(): Pick {
    void this.rev
    return this.hostPick
  }

  set pick(p: Pick) {
    this.hostPick = p
    this.announce()
  }

  private announce(): void {
    if (!this.core.isHost || this.core.started) return
    this.core.setExtra({ pick: $state.snapshot(this.hostPick), order: $state.snapshot(this.hostOrder) } satisfies Extra)
  }

  get canStart(): boolean {
    return this.c.canStart && validPick(this.hostPick)
  }

  startGame(): void {
    if (this.canStart) this.core.startGame()
  }

  rename(name: string): void {
    this.core.setName(name)
  }

  /* ---------------- table ---------------- */

  get mySeat(): Seat | null {
    return this.c.seat
  }

  get spectator(): boolean {
    return this.c.spectator
  }

  get isMod(): boolean {
    return this.c.seat === MOD_SEAT
  }

  get names(): string[] {
    return this.state.config.names
  }

  get pot(): number {
    return potOf(this.state)
  }

  get myTurn(): boolean {
    return !this.state.result && this.mySeat !== null && this.state.seatToAct === this.mySeat
  }

  /** Betting moves for my own turn. */
  myMoves(): Move[] {
    return this.mySeat === null ? [] : bettingMoves(this.state, this.mySeat)
  }

  can(move: Move): boolean {
    return this.mySeat !== null && actorFor(this.state, this.mySeat, move) !== null
  }

  /** Returns an error message when the move was refused, else null. */
  submit(move: Move): string | null {
    try {
      this.core.submit(move)
      return null
    } catch (err) {
      return err instanceof Error ? err.message : String(err)
    }
  }

  /** Is the phone in this seat currently connected? */
  online(seat: Seat): boolean {
    const snap = this.c.snapshot
    const key = snap && Object.keys(snap.seats).find((k) => snap.seats[k] === seat)
    return key ? this.core.presence(key) : false
  }

  private askStands(ask: RebuyAsk | undefined, seat: Seat | null): boolean {
    const snap = this.core.snapshot
    if (!ask || !snap || seat === null || this.state.result) return false
    return ask.gameId === snap.gameId && this.state.players[seat]?.buyIns === ask.buyIns
  }

  /** Seats that have asked the moderator for more chips. */
  get rebuyRequests(): Seat[] {
    const snap = this.c.snapshot
    if (!snap) return []
    const out: Seat[] = []
    if (this.askStands(this.myAsk ?? undefined, this.core.seat)) out.push(this.core.seat!)
    for (const p of this.core.livePeers) {
      const seat = snap.seats[p.key]
      if (seat !== undefined && this.askStands((p.extra as Extra | undefined)?.rebuy, seat)) out.push(seat)
    }
    return out.sort((a, b) => a - b)
  }

  get askedRebuy(): boolean {
    void this.rev
    return this.myAsk !== null
  }

  /** Raise (or withdraw) my hand for more chips; the moderator adds them between hands. */
  askRebuy(on: boolean): void {
    const snap = this.core.snapshot
    const seat = this.core.seat
    if (!snap || seat === null) return
    this.myAsk = on ? { gameId: snap.gameId, buyIns: this.state.players[seat].buyIns } : null
    this.core.setExtra(this.myAsk ? ({ rebuy: this.myAsk } satisfies Extra) : {})
  }

  /** Same players, fresh stacks, after the table was closed. */
  requestRematch(): void {
    this.core.requestRematch()
  }

  leave(): void {
    this.core.leave()
  }

  destroy(): void {
    this.core.destroy()
  }
}
