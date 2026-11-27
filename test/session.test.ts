// @vitest-environment jsdom
import { beforeEach, describe, expect, it, onTestFinished } from 'vitest'
import { Mesh } from '@yujun/game-net/mesh'
import type { Beacon } from '@yujun/game-net'
import { TableSession } from '../src/app/session.svelte'
import { MOD_SEAT, publicHash } from '../src/engine'
import type { GameConfig, Move } from '../src/engine'
import { boughtIn, chips, mulberry32 } from './helpers'

type Wire = Beacon<GameConfig, Move>

const ROOM = 'CHIPS1'
let clock = 1_000_000
const now = () => clock

class World {
  mesh = new Mesh<Wire>()
  sessions: TableSession[] = []

  add(i: number, creator = false): TableSession {
    const s = new TableSession(ROOM, creator, { key: `key-${i}`, name: `P${i}` }, {
      transport: this.mesh.peer(`peer-${i}-${this.sessions.length}`),
      now,
      timers: false,
    })
    this.sessions.push(s)
    return s
  }

  second(times = 1): void {
    for (let i = 0; i < times; i++) {
      clock += 1000
      for (const s of this.sessions) s.net.tick()
      this.mesh.flush()
    }
  }

  flush(): void {
    this.mesh.flush()
  }

  start(n: number, setup?: (host: TableSession) => void): TableSession[] {
    const host = this.add(0, true)
    for (let i = 1; i < n; i++) this.add(i)
    this.second(2)
    setup?.(host)
    this.second(1)
    host.startGame()
    this.flush()
    return this.sessions
  }

  get mod(): TableSession {
    return this.sessions.find((s) => s.isMod)!
  }

  acting(): TableSession | undefined {
    return this.sessions.find((s) => s.myTurn)
  }
}

beforeEach(() => {
  localStorage.clear()
  clock = 1_000_000
})

/** Random play driven through the sessions until `hands` are finished. */
function playHands(w: World, hands: number, seed: number, lossy = false) {
  const rng = mulberry32(seed)
  const pick = <T,>(xs: T[]): T => xs[Math.floor(rng() * xs.length)]
  const mod = w.mod
  for (let step = 0; step < 40000 && mod.state.handsPlayed < hands; step++) {
    const st = mod.state
    const actor = w.acting()
    if (actor) {
      const moves = actor.myMoves().filter((m) => m.type !== 'fold' || rng() < 0.3)
      expect(actor.submit(pick(moves.length ? moves : actor.myMoves()))).toBeNull()
    } else if (st.phase === 'showdown') {
      expect(mod.submit({ type: 'award', winners: st.pots.map((p) => [pick(p.eligible)]) })).toBeNull()
    } else if (st.phase === 'betweenHands') {
      const broke = st.players.findIndex((p) => p.stack === 0)
      if (broke >= 0) expect(mod.submit({ type: 'rebuy', seat: broke, amount: st.config.buyIn })).toBeNull()
      else expect(mod.submit({ type: 'nextHand' })).toBeNull()
    }
    if (lossy) w.mesh.filter = () => rng() > 0.4
    w.second()
  }
  w.mesh.filter = () => true
  w.second(4)
}

function expectInSync(sessions: TableSession[]) {
  const ref = publicHash(sessions[0].state)
  for (const s of sessions) {
    expect(s.status).toBe('playing')
    expect(publicHash(s.state)).toBe(ref)
  }
}

describe('lobby', () => {
  it('seats ten, mirrors the stakes, and puts the moderator in seat 0', () => {
    const w = new World()
    const sessions = w.start(10, (h) => (h.pick = { buyIn: 2000, small: 10, big: 20 }))
    expect(sessions[3].pick).toEqual({ buyIn: 2000, small: 10, big: 20 })
    expect(sessions.every((s) => s.playing)).toBe(true)
    expect(sessions[0].isMod).toBe(true)
    expect(sessions.map((s) => s.mySeat).sort((a, b) => a! - b!)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9])
    expect(sessions[0].state.config.buyIn).toBe(2000)
    expect(sessions[0].state.bigBlind).toBe(20)
    expect(sessions[0].state.phase).toBe('betweenHands')
    expectInSync(sessions)
  })

  it('an eleventh phone is told the table is full', () => {
    const w = new World()
    for (let i = 0; i < 11; i++) w.add(i, i === 0)
    w.second(3)
    expect(w.sessions.filter((s) => s.status === 'room-full').length).toBe(1)
    expect(w.sessions[0].seats.length).toBe(10)
  })

  it("follows the moderator's seating order", () => {
    const w = new World()
    const [host, a, b, c] = [w.add(0, true), w.add(1), w.add(2), w.add(3)]
    w.second(2)
    expect(host.seats.map((s) => s.name)).toEqual(['P0', 'P1', 'P2', 'P3'])
    host.moveSeat(c.myKey, -1)
    host.moveSeat(c.myKey, -1)
    host.moveSeat(c.myKey, -1) // cannot pass the moderator
    w.second(1)
    expect(b.seats.map((s) => s.name)).toEqual(['P0', 'P3', 'P1', 'P2'])
    host.startGame()
    w.flush()
    expect([host, a, b, c].map((s) => s.mySeat)).toEqual([0, 2, 3, 1])
    expect(host.names).toEqual(['P0', 'P3', 'P1', 'P2'])
  })

  it('refuses to start with broken stakes', () => {
    const w = new World()
    const host = w.add(0, true)
    w.add(1)
    w.second(2)
    host.pick = { buyIn: 100, small: 50, big: 200 }
    w.second(1)
    expect(host.canStart).toBe(false)
    host.pick = { buyIn: 1000, small: 5, big: 10 }
    expect(host.canStart).toBe(true)
  })
})

describe('play across the mesh', () => {
  it('10 phones stay in lockstep through 25 hands', () => {
    const w = new World()
    const sessions = w.start(10)
    playHands(w, 25, 11)
    expectInSync(sessions)
    expect(chips(sessions[0].state)).toBe(boughtIn(sessions[0].state))
  })

  it('10 phones converge through 40% message loss', () => {
    const w = new World()
    const sessions = w.start(10)
    playHands(w, 8, 12, true)
    expectInSync(sessions)
  })

  it('only the seat to act and the moderator can move', () => {
    const w = new World()
    const sessions = w.start(4)
    expect(sessions[2].submit({ type: 'nextHand' })).toBe('not your turn')
    expect(w.mod.submit({ type: 'nextHand' })).toBeNull()
    w.second()
    const waiting = sessions.find((s) => !s.myTurn && !s.isMod)!
    expect(waiting.submit({ type: 'fold' })).toBe('not your turn')
    expect(waiting.submit({ type: 'fold', proxy: true })).toBe('not your turn')
    expectInSync(sessions)
  })

  it('the moderator acts for a phone that went dark', () => {
    const w = new World()
    const sessions = w.start(3)
    w.mod.submit({ type: 'nextHand' })
    w.second()
    const seat = w.mod.state.seatToAct!
    expect(w.mod.submit({ type: 'fold', proxy: true })).toBeNull()
    w.second()
    expect(sessions[1].state.players[seat].folded).toBe(true)
    expect(sessions[1].state.lastAction?.proxy).toBe(true)
    expectInSync(sessions)
  })

  it('a refreshed phone resumes mid-hand, and a latecomer watches', () => {
    const w = new World()
    const sessions = w.start(3)
    playHands(w, 3, 5)
    w.mod.state.players.forEach((p, seat) => {
      if (p.stack === 0) w.mod.submit({ type: 'rebuy', seat, amount: 1000 })
    })
    w.mod.submit({ type: 'nextHand' })
    w.second()
    w.acting()!.submit({ type: 'call' })
    w.second()
    const gone = sessions[2]
    gone.destroy()
    w.sessions = sessions.slice(0, 2)
    const back = w.add(2)
    expect(back.playing).toBe(true)
    expect(back.mySeat).toBe(gone.mySeat)
    w.second(2)
    expect(publicHash(back.state)).toBe(publicHash(sessions[0].state))

    const late = w.add(7)
    w.second(3)
    expect(late.playing).toBe(true)
    expect(late.spectator).toBe(true)
    expect(publicHash(late.state)).toBe(publicHash(sessions[0].state))
  })

  it('repairs a fork when the moderator and a player move at the same instant', () => {
    for (const seed of [1, 2, 3, 4, 5, 6]) {
      localStorage.clear()
      const w = new World()
      const sessions = w.start(4)
      playHands(w, seed, seed) // different histories, so either branch can win the tie-break
      w.mod.state.players.forEach((p, seat) => {
        if (p.stack === 0) w.mod.submit({ type: 'rebuy', seat, amount: 1000 })
      })
      expect(w.mod.submit({ type: 'nextHand' })).toBeNull()
      w.second()
      const actor = w.acting()!
      const proxyOnSelf = actor === w.mod
      // both stamp the next move number before hearing from each other
      expect(actor.submit({ type: 'call' })).toBeNull()
      if (!proxyOnSelf) expect(w.mod.submit({ type: 'fold', proxy: true })).toBeNull()
      w.second(3)
      expectInSync(sessions)
      // and the table keeps going afterwards
      playHands(w, w.mod.state.handsPlayed + 2, seed + 50)
      expectInSync(sessions)
      expect(chips(sessions[0].state)).toBe(boughtIn(sessions[0].state))
    }
  })
})

describe('rebuy requests', () => {
  it('reach the moderator and clear once chips are added', () => {
    const w = new World()
    const sessions = w.start(3)
    const player = sessions.find((s) => !s.isMod)!
    player.askRebuy(true)
    w.second()
    expect(w.mod.rebuyRequests).toEqual([player.mySeat])
    expect(player.askedRebuy).toBe(true)
    w.mod.submit({ type: 'rebuy', seat: player.mySeat!, amount: 500 })
    w.second(2)
    expect(player.askedRebuy).toBe(false)
    expect(w.mod.rebuyRequests).toEqual([])
    expect(player.state.players[player.mySeat!].buyIns).toBe(1500)
  })
})

describe('a long night', () => {
  it('150 hands with 10 phones: beacons stay small and the table closes zero-sum', { timeout: 120_000 }, () => {
    const w = new World()
    const sessions = w.start(10)
    let biggest = 0
    w.mesh.filter = (msg) => {
      biggest = Math.max(biggest, JSON.stringify(msg).length)
      return true
    }
    const rng = mulberry32(77)
    const pick = <T,>(xs: T[]): T => xs[Math.floor(rng() * xs.length)]
    const mod = w.mod
    // jsdom's localStorage keeps every overwritten value alive, which runs the heap out over
    // thousands of saves; refresh-resume is covered above, so this test skips the saving
    const setItem = Storage.prototype.setItem
    Storage.prototype.setItem = () => {}
    onTestFinished(() => void (Storage.prototype.setItem = setItem))
    for (let step = 0; step < 60000 && mod.state.handsPlayed < 150; step++) {
      const st = mod.state
      const actor = w.acting()
      if (actor) actor.submit(pick(actor.myMoves()))
      else if (st.phase === 'showdown') mod.submit({ type: 'award', winners: st.pots.map((p) => [pick(p.eligible)]) })
      else {
        const broke = st.players.findIndex((p) => p.stack === 0)
        mod.submit(broke >= 0 ? { type: 'rebuy', seat: broke, amount: 1000 } : { type: 'nextHand' })
      }
      w.second()
    }
    expect(mod.state.handsPlayed).toBe(150)
    expect(mod.submit({ type: 'closeTable' })).toBeNull()
    w.second(2)
    expectInSync(sessions)
    expect(mod.state.result!.nets.reduce((a, b) => a + b, 0)).toBe(0)
    expect(sessions[4].state.players[MOD_SEAT].buyIns).toBe(mod.state.players[MOD_SEAT].buyIns)

    // steady-state beacons carry only a log tail
    expect(biggest).toBeLessThan(8_000)
    // a phone that lost its storage needs the whole log once: this is the worst case on the wire
    const moves = mod.net.logLength
    const full = JSON.stringify(mod.net.snapshot).length
    process.stderr.write(`150 hands = ${moves} moves, full log ${(full / 1024).toFixed(0)} KB, largest steady beacon ${biggest} B\n`)
    expect(full).toBeLessThan(1_000_000)
  })
})
