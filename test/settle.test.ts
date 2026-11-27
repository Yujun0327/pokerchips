import { describe, expect, it } from 'vitest'
import { settleUp } from '../src/engine'

describe('settle up, many seats', () => {
  it('ten seats square up in at most nine payments', () => {
    const nets = [900, -400, 250, -350, 0, 600, -700, -150, 50, -200]
    const pay = settleUp(nets)
    expect(pay.length).toBeLessThanOrEqual(9)
    const after = [...nets]
    for (const p of pay) {
      expect(p.amount).toBeGreaterThan(0)
      after[p.from] += p.amount
      after[p.to] -= p.amount
    }
    expect(after.every((n) => n === 0)).toBe(true)
  })
})
