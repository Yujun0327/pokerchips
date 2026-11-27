import { describe, expect, it } from 'vitest'
import { actorFor, applyMove, betLimits, bettingMoves, legalMoves, potOf, settleUp } from '../src/engine'
import type { GameState, Move } from '../src/engine'
import { MOD, boughtIn, chips, newGame, play, table, withStacks } from './helpers'

const types = (state: GameState, seat: number) => [...new Set(legalMoves(state, seat).map((m) => m.type))].sort()
const stacks = (s: GameState) => s.players.map((p) => p.stack)
const checks = (seats: number[]): [number, Move][] => seats.map((s) => [s, { type: 'check' }])

describe('blinds and order', () => {
  it('opens between hands and waits for the moderator', () => {
    const s = table(4)
    expect(s.phase).toBe('betweenHands')
    expect(s.handIndex).toBe(0)
    expect(types(s, 1)).toEqual([])
    expect(types(s, MOD)).toContain('nextHand')
    expect(() => applyMove(s, 1, { type: 'nextHand' })).toThrow('moderator')
  })

  it('3P: SB = button+1, BB = button+2, button acts first preflop', () => {
    const s = newGame(3)
    expect(s.phase).toBe('preflop')
    expect(s.handIndex).toBe(1)
    expect(s.dealer).toBe(0)
    expect(s.seatToAct).toBe(0)
    expect(stacks(s)).toEqual([10000, 9950, 9900])
    expect(s.players.map((p) => p.streetBet)).toEqual([0, 50, 100])
    expect(s.currentBet).toBe(100)
    expect(potOf(s)).toBe(150)
  })

  it('10P: under the gun is the seat after the big blind', () => {
    const s = newGame(10)
    expect(s.players.filter((p) => p.dealtIn).length).toBe(10)
    expect(s.seatToAct).toBe(3)
  })

  it('heads-up: the button posts the small blind and acts first; the big blind acts first postflop', () => {
    let s = newGame(2)
    expect(s.players.map((p) => p.streetBet)).toEqual([50, 100])
    expect(s.seatToAct).toBe(0)
    s = play(s, [[0, { type: 'call' }], [1, { type: 'check' }]])
    expect(s.phase).toBe('flop')
    expect(s.seatToAct).toBe(1)
    expect(s.currentBet).toBe(0)
  })

  it('the button moves to the next seat with chips each hand', () => {
    let s = newGame(3)
    s = play(s, [[0, { type: 'fold' }], [1, { type: 'fold' }]])
    expect(s.phase).toBe('betweenHands')
    expect(s.lastHand?.reason).toBe('uncontested')
    expect(stacks(s)).toEqual([10000, 9950, 10050])
    s = applyMove(s, MOD, { type: 'nextHand' })
    expect(s.dealer).toBe(1)
    expect(s.handIndex).toBe(2)
    expect(s.seatToAct).toBe(1)
  })

  it('the big blind gets the option when everyone limps', () => {
    let s = newGame(3)
    s = play(s, [[0, { type: 'call' }], [1, { type: 'call' }]])
    expect(s.phase).toBe('preflop')
    expect(s.seatToAct).toBe(2)
    expect(types(s, 2)).toEqual(['allin', 'bet', 'check', 'fold'])
    s = applyMove(s, 2, { type: 'check' })
    expect(s.phase).toBe('flop')
    expect(s.seatToAct).toBe(1)
  })
})

describe('betting rules', () => {
  it('rejects out-of-turn and illegal actions', () => {
    const s = newGame(3)
    expect(() => applyMove(s, 1, { type: 'call' })).toThrow('not your turn')
    expect(() => applyMove(s, 0, { type: 'check' })).toThrow('cannot check')
    expect(() => applyMove(s, 0, { type: 'raise', to: 150 })).toThrow()
    expect(() => applyMove(s, 0, { type: 'bet', to: 150 })).toThrow('below the minimum')
    expect(() => applyMove(s, 0, { type: 'bet', to: 20000 })).toThrow('exceeds the stack')
  })

  it('min-raise is the size of the last raise', () => {
    let s = newGame(3)
    expect(betLimits(s, 0).minRaiseTo).toBe(200)
    s = applyMove(s, 0, { type: 'bet', to: 300 })
    expect(betLimits(s, 1).minRaiseTo).toBe(500)
    expect(() => applyMove(s, 1, { type: 'raise', to: 450 })).toThrow('below the minimum')
    s = applyMove(s, 1, { type: 'raise', to: 500 })
    expect(betLimits(s, 2).toCall).toBe(400)
    expect(betLimits(s, 2).minRaiseTo).toBe(700)
  })

  it('a short all-in does not reopen the betting', () => {
    // seat 1 has 250: its all-in over a 200 bet is not a full raise
    let s = withStacks([10000, 250, 10000])
    s = play(s, [[0, { type: 'bet', to: 200 }], [1, { type: 'allin' }], [2, { type: 'call' }]])
    expect(s.currentBet).toBe(250)
    expect(s.seatToAct).toBe(0)
    expect(bettingMoves(s, 0).map((m) => m.type)).toEqual(['fold', 'call'])
    s = applyMove(s, 0, { type: 'call' })
    expect(s.phase).toBe('flop')
  })

  it('several short all-ins never push the minimum raise below the bet to match', () => {
    let s = withStacks([10000, 10000, 10000, 250, 290, 340])
    // button 0, SB 1, BB 2; seats 3-5 shove 250, 290, 340 over the 100 blind
    s = play(s, [[3, { type: 'allin' }], [4, { type: 'allin' }], [5, { type: 'allin' }]])
    expect(s.currentBet).toBe(340)
    expect(s.seatToAct).toBe(0)
    expect(betLimits(s, 0).minRaiseTo).toBe(490)
    for (const m of bettingMoves(s, 0)) expect(() => applyMove(s, 0, m)).not.toThrow()
  })

  it('walks the streets and stops at showdown after the river', () => {
    let s = newGame(3)
    s = play(s, [[0, { type: 'call' }], [1, { type: 'call' }], [2, { type: 'check' }]])
    for (const phase of ['flop', 'turn', 'river'] as const) {
      expect(s.phase).toBe(phase)
      s = play(s, checks([1, 2, 0]))
    }
    expect(s.phase).toBe('showdown')
    expect(s.seatToAct).toBeNull()
    expect(s.runout).toBe(false)
    expect(s.pots).toEqual([{ amount: 300, eligible: [0, 1, 2] }])
  })
})

describe('showdown and side pots', () => {
  const toShowdown = () => {
    let s = newGame(3)
    s = play(s, [[0, { type: 'call' }], [1, { type: 'call' }], [2, { type: 'check' }]])
    for (let i = 0; i < 3; i++) s = play(s, checks([1, 2, 0]))
    return s
  }

  it('only the moderator awards, and only to eligible seats', () => {
    const s = toShowdown()
    expect(() => applyMove(s, 1, { type: 'award', winners: [[1]] })).toThrow('moderator')
    expect(() => applyMove(s, MOD, { type: 'award', winners: [] })).toThrow()
    expect(() => applyMove(s, MOD, { type: 'award', winners: [[]] })).toThrow('needs a winner')
    expect(() => applyMove(s, MOD, { type: 'award', winners: [[5]] })).toThrow('not in that pot')
    const done = applyMove(s, MOD, { type: 'award', winners: [[2]] })
    expect(done.phase).toBe('betweenHands')
    expect(stacks(done)).toEqual([9900, 9900, 10200])
    expect(done.lastHand?.winners).toEqual([2])
  })

  it('splits a tie and gives the odd chip to the first winner left of the button', () => {
    let s = newGame(3, { smallBlind: 25, bigBlind: 75 })
    // seat 1 (SB) folds its 25: pot = 25 + 75 + 75 = 175
    s = play(s, [[0, { type: 'call' }], [1, { type: 'fold' }], [2, { type: 'check' }]])
    for (let i = 0; i < 3; i++) s = play(s, checks([2, 0]))
    expect(s.pots).toEqual([{ amount: 175, eligible: [0, 2] }])
    s = applyMove(s, MOD, { type: 'award', winners: [[0, 2]] })
    expect(s.lastHand?.awards).toEqual([87, 0, 88])
  })

  it('builds main and side pots from all-ins of different sizes', () => {
    let s = withStacks([1000, 3000, 6000, 10000])
    // button 0, SB 1, BB 2, UTG 3
    s = play(s, [
      [3, { type: 'bet', to: 6000 }],
      [0, { type: 'allin' }],
      [1, { type: 'allin' }],
      [2, { type: 'allin' }],
    ])
    expect(s.phase).toBe('showdown')
    expect(s.runout).toBe(true)
    expect(s.pots).toEqual([
      { amount: 4000, eligible: [0, 1, 2, 3] },
      { amount: 6000, eligible: [1, 2, 3] },
      { amount: 6000, eligible: [2, 3] },
    ])
    // the short stack wins the main, seat 2 wins both side pots
    s = applyMove(s, MOD, { type: 'award', winners: [[0], [2], [2]] })
    expect(stacks(s)).toEqual([4000, 0, 12000, 4000])
    expect(chips(s)).toBe(boughtIn(s))
  })

  it('hands back an uncalled all-in as its own single-seat pot', () => {
    let s = withStacks([10000, 2000])
    s = play(s, [[0, { type: 'allin' }], [1, { type: 'call' }]])
    expect(s.pots).toEqual([
      { amount: 4000, eligible: [0, 1] },
      { amount: 8000, eligible: [0] },
    ])
    expect(() => applyMove(s, MOD, { type: 'award', winners: [[1], [1]] })).toThrow('not in that pot')
    s = applyMove(s, MOD, { type: 'award', winners: [[1], [0]] })
    expect(stacks(s)).toEqual([8000, 4000])
  })

  it('folded chips stay in the pots they reached', () => {
    let s = withStacks([10000, 10000, 500])
    // BB (seat 2) is all-in for 500 after a raise; seat 0 folds 300 dead
    s = play(s, [
      [0, { type: 'bet', to: 300 }],
      [1, { type: 'raise', to: 900 }],
      [2, { type: 'allin' }],
      [0, { type: 'fold' }],
    ])
    expect(s.phase).toBe('showdown')
    expect(s.pots).toEqual([
      { amount: 1300, eligible: [1, 2] },
      { amount: 400, eligible: [1] },
    ])
  })
})

describe('moderator tools', () => {
  it('a busted seat sits out until the moderator adds chips', () => {
    let s = withStacks([10000, 2000])
    s = play(s, [[0, { type: 'allin' }], [1, { type: 'call' }]])
    s = applyMove(s, MOD, { type: 'award', winners: [[0], [0]] })
    expect(stacks(s)).toEqual([12000, 0])
    expect(types(s, MOD)).not.toContain('nextHand')
    expect(() => applyMove(s, MOD, { type: 'nextHand' })).toThrow('two players')
    s = applyMove(s, MOD, { type: 'rebuy', seat: 1, amount: 5000 })
    expect(s.players[1].buyIns).toBe(7000)
    s = applyMove(s, MOD, { type: 'nextHand' })
    expect(s.phase).toBe('preflop')
    expect(chips(s)).toBe(boughtIn(s))
  })

  it('chips only change between hands, and never below zero', () => {
    const live = newGame(3)
    expect(() => applyMove(live, MOD, { type: 'rebuy', seat: 1, amount: 100 })).toThrow('between hands')
    expect(() => applyMove(live, MOD, { type: 'setBlinds', small: 1, big: 2 })).toThrow('between hands')
    const s = table(3)
    expect(() => applyMove(s, MOD, { type: 'rebuy', seat: 1, amount: -10001 })).toThrow()
    expect(() => applyMove(s, MOD, { type: 'transfer', from: 1, to: 2, amount: 10001 })).toThrow()
    const moved = applyMove(s, MOD, { type: 'transfer', from: 1, to: 2, amount: 400 })
    expect(stacks(moved)).toEqual([10000, 9600, 10400])
    expect(chips(moved)).toBe(boughtIn(moved))
  })

  it('a voided hand refunds every chip and keeps the button', () => {
    let s = newGame(3)
    s = play(s, [[0, { type: 'bet', to: 400 }], [1, { type: 'call' }]])
    s = applyMove(s, MOD, { type: 'voidHand' })
    expect(s.phase).toBe('betweenHands')
    expect(stacks(s)).toEqual([10000, 10000, 10000])
    expect(s.handsPlayed).toBe(0)
    expect(s.lastHand?.reason).toBe('void')
    s = applyMove(s, MOD, { type: 'nextHand' })
    expect(s.dealer).toBe(0)
    expect(s.handIndex).toBe(1)
  })

  it('new blinds and sit-outs apply to the next hand', () => {
    let s = table(4)
    s = applyMove(s, MOD, { type: 'setBlinds', small: 100, big: 200 })
    s = applyMove(s, MOD, { type: 'sit', seat: 1, out: true })
    s = applyMove(s, MOD, { type: 'nextHand' })
    expect(s.players[1].dealtIn).toBe(false)
    expect(s.players.map((p) => p.streetBet)).toEqual([0, 0, 100, 200])
    expect(s.seatToAct).toBe(0)
  })

  it('the moderator can act for the seat to act, and for nobody else', () => {
    const s = newGame(3) // seat 0 to act
    expect(actorFor(s, 2, { type: 'fold' })).toBeNull()
    expect(actorFor(s, 2, { type: 'fold', proxy: true })).toBeNull()
    expect(actorFor(s, 0, { type: 'call' })).toBe(0)
    const next = applyMove(s, 0, { type: 'call' }) // seat 1 to act
    expect(actorFor(next, MOD, { type: 'fold', proxy: true })).toBe(1)
    expect(actorFor(next, 1, { type: 'voidHand' })).toBeNull()
    const folded = applyMove(next, 1, { type: 'fold', proxy: true })
    expect(folded.players[1].folded).toBe(true)
    expect(folded.lastAction).toEqual({ seat: 1, type: 'fold', amount: 0, proxy: true })
  })

  it('closing the table reports zero-sum nets', () => {
    let s = newGame(3)
    s = play(s, [[0, { type: 'bet', to: 500 }], [1, { type: 'fold' }], [2, { type: 'fold' }]])
    expect(() => applyMove(newGame(3), MOD, { type: 'closeTable' })).toThrow('finish the hand')
    s = applyMove(s, MOD, { type: 'closeTable' })
    expect(s.result?.nets).toEqual([150, -50, -100])
    expect(() => applyMove(s, MOD, { type: 'nextHand' })).toThrow('closed')
  })
})

describe('settle up', () => {
  it('squares the ledger with few payments', () => {
    const pay = settleUp([500, -200, -300, 0])
    expect(pay).toEqual([
      { from: 2, to: 0, amount: 300 },
      { from: 1, to: 0, amount: 200 },
    ])
    expect(settleUp([0, 0])).toEqual([])
    const nets = [1200, -700, 300, -800]
    const after = [...nets]
    for (const p of settleUp(nets)) {
      after[p.from] += p.amount
      after[p.to] -= p.amount
    }
    expect(after).toEqual([0, 0, 0, 0])
  })
})
