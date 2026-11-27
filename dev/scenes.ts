// Scripted scenes for screenshots: /dev/?n=6&scene=turn
import type { TableSession } from '../src/app/session.svelte'

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

function click(phone: number, text: string): void {
  const root = document.querySelectorAll('.phone')[phone]
  const btn = [...(root?.querySelectorAll('button') ?? [])].find((b) => b.textContent?.trim().startsWith(text))
  if (!btn) console.warn(`no button "${text}" on phone ${phone}`)
  btn?.click()
}

export async function runScene(scene: string, sessions: TableSession[]): Promise<void> {
  const mod = sessions[0]
  const acting = () => sessions.find((s) => s.myTurn)
  const phoneOf = (s: TableSession) => sessions.indexOf(s)
  await sleep(600)
  if (scene === 'lobby') return
  mod.pick = { buyIn: 2000, small: 10, big: 20 }
  await sleep(300)
  mod.startGame()
  await sleep(300)
  if (scene === 'open') return
  mod.submit({ type: 'nextHand' })
  await sleep(300)
  if (scene === 'deal') return
  // a little action: raise, a few calls and a fold
  acting()?.submit({ type: 'bet', to: 60 })
  await sleep(150)
  acting()?.submit({ type: 'call' })
  await sleep(150)
  if (sessions.length > 3) acting()?.submit({ type: 'fold' })
  await sleep(150)
  if (scene === 'turn') return
  if (scene === 'raise') {
    click(phoneOf(acting()!), 'Raise')
    return
  }
  if (scene === 'modhand') {
    click(0, 'Run table')
    return
  }
  // everyone left shoves or calls: side pots
  for (let i = 0; i < 20 && acting(); i++) {
    const a = acting()!
    const seat = a.mySeat!
    // uneven stacks make side pots: odd seats call, even seats shove
    a.submit(a.myMoves().some((m) => m.type === 'allin') && seat % 2 === 0 ? { type: 'allin' } : { type: 'call' })
    await sleep(120)
  }
  for (let i = 0; i < 40 && acting(); i++) {
    acting()!.submit(acting()!.myMoves().find((m) => m.type === 'check' || m.type === 'call')!)
    await sleep(100)
  }
  if (scene === 'showdown') return
  if (scene === 'award') {
    click(0, 'Choose the winner')
    return
  }
  const st = mod.state
  mod.submit({ type: 'award', winners: st.pots.map((p) => [p.eligible[p.eligible.length - 1]]) })
  await sleep(300)
  if (scene === 'between') return
  if (scene === 'ask') {
    const broke = sessions.find((s) => s.mySeat !== null && s.state.players[s.mySeat].stack === 0)
    broke?.askRebuy(true)
    await sleep(300)
    click(0, 'Run table')
    return
  }
  if (scene === 'mod') {
    click(0, 'Run table')
    return
  }
  mod.submit({ type: 'closeTable' })
}
