import type { Seat } from './types'

export interface Payment {
  from: Seat
  to: Seat
  amount: number
}

/**
 * The fewest-ish payments that square a zero-sum ledger: the biggest loser
 * pays the biggest winner until everyone is at zero.
 */
export function settleUp(nets: number[]): Payment[] {
  const left = nets.map((net, seat) => ({ seat, net }))
  const payments: Payment[] = []
  for (;;) {
    const debtor = left.reduce((a, b) => (b.net < a.net ? b : a))
    const creditor = left.reduce((a, b) => (b.net > a.net ? b : a))
    const amount = Math.min(-debtor.net, creditor.net)
    if (amount <= 0) return payments
    payments.push({ from: debtor.seat, to: creditor.seat, amount })
    debtor.net += amount
    creditor.net -= amount
  }
}
