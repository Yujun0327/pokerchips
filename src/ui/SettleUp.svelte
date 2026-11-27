<script lang="ts">
  import type { TableSession } from '../app/session.svelte'
  import { settleUp } from '../engine'
  import { fmt, signed } from './fmt'

  interface Props {
    session: TableSession
    onExit: () => void
  }

  let { session, onExit }: Props = $props()

  const st = $derived(session.state)
  const names = $derived(session.names)
  const nets = $derived(st.result?.nets ?? [])
  const rows = $derived(
    nets
      .map((net, seat) => ({ seat, net, name: names[seat], in: st.players[seat].buyIns, out: st.players[seat].stack }))
      .sort((a, b) => b.net - a.net),
  )
  const payments = $derived(settleUp(nets))
</script>

<main class="page">
  <header>
    <h1>Settle up</h1>
    <p class="dim">{st.result?.handsPlayed === 1 ? '1 hand' : `${st.result?.handsPlayed ?? 0} hands`} played at table {session.room}.</p>
  </header>

  <section>
    <h2>Who pays whom</h2>
    {#if payments.length === 0}
      <p>Everyone finished even. Nothing to pay.</p>
    {:else}
      <ul class="pay">
        {#each payments as p (`${p.from}-${p.to}`)}
          <li>
            <span><strong>{names[p.from]}</strong> pays <strong>{names[p.to]}</strong></span>
            <span class="amt num">{fmt(p.amount)}</span>
          </li>
        {/each}
      </ul>
    {/if}
  </section>

  <section>
    <h2>The night in chips</h2>
    <table>
      <thead>
        <tr><th>Player</th><th class="r">Bought in</th><th class="r">Left with</th><th class="r">Result</th></tr>
      </thead>
      <tbody>
        {#each rows as r (r.seat)}
          <tr>
            <td class="name">{r.name}</td>
            <td class="r num">{fmt(r.in)}</td>
            <td class="r num">{fmt(r.out)}</td>
            <td class="r num net" class:up={r.net > 0} class:down={r.net < 0}>{signed(r.net)}</td>
          </tr>
        {/each}
      </tbody>
    </table>
  </section>

  <section class="go">
    {#if session.isHost}
      <button class="btn btn--red" onclick={() => session.requestRematch()}>Open a new table with the same players</button>
    {/if}
    <button class="btn btn--line" onclick={onExit}>Leave</button>
  </section>
</main>

<style>
  h1 { font-size: clamp(3rem, 16vw, 4.2rem); text-transform: uppercase; letter-spacing: -0.04em; }
  h2 { font-size: var(--fs-lg); margin-bottom: var(--sp-2); }
  .pay { list-style: none; margin: 0; padding: 0; border-top: 1px solid var(--line); }
  .pay li { display: flex; justify-content: space-between; align-items: baseline; gap: var(--sp-3); padding: var(--sp-3) 0; border-bottom: 1px solid var(--line); font-size: var(--fs-lg); }
  .amt { font-weight: 900; color: var(--gold); }
  table { width: 100%; border-collapse: collapse; font-family: var(--font-narrow); }
  th { text-align: left; font-weight: 500; font-size: var(--fs-xs); color: var(--bone-dim); padding-bottom: var(--sp-1); }
  td { padding: var(--sp-2) 0; border-top: 1px solid var(--line); }
  .r { text-align: right; }
  .name { font-weight: 700; max-width: 9ch; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .net { font-weight: 700; }
  .net.up { color: var(--gold); }
  .net.down { color: #ff9c8f; }
  .go { display: flex; flex-direction: column; gap: var(--sp-2); margin-top: auto; }
</style>
