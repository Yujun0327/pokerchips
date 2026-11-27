<script lang="ts">
  import { untrack } from 'svelte'
  import type { TableSession } from '../app/session.svelte'
  import type { Seat } from '../engine'
  import { fmt } from './fmt'
  import Sheet from './Sheet.svelte'

  interface Props {
    session: TableSession
    onClose: () => void
  }

  let { session, onClose }: Props = $props()

  const pots = $derived(session.state.pots)
  const names = $derived(session.names)

  /** Winners picked per pot; a pot with one eligible seat is that seat's own chips coming back. */
  let picked = $state<Seat[][]>(untrack(() => session.state.pots.map((p) => (p.eligible.length === 1 ? [...p.eligible] : []))))
  let touched = $state<boolean[]>(untrack(() => session.state.pots.map(() => false)))
  let error = $state('')

  const contested = $derived(pots.filter((p) => p.eligible.length > 1).length)
  const ready = $derived(pots.length > 0 && picked.length === pots.length && picked.every((w) => w.length > 0))

  function potName(i: number): string {
    if (pots[i].eligible.length === 1) return 'Uncalled bet'
    if (contested === 1) return 'Pot'
    return i === 0 ? 'Main pot' : `Side pot ${i}`
  }

  function toggle(i: number, seat: Seat) {
    const has = picked[i].includes(seat)
    picked[i] = has ? picked[i].filter((s) => s !== seat) : [...picked[i], seat].sort((a, b) => a - b)
    touched[i] = true
    // the usual case is one hand winning everything it is in: carry the choice into the pots not yet set by hand
    pots.forEach((pot, j) => {
      if (j === i || touched[j] || pot.eligible.length === 1) return
      const carry = picked[i].filter((s) => pot.eligible.includes(s))
      if (carry.length > 0) picked[j] = carry
    })
  }

  function pay() {
    const err = session.submit({ type: 'award', winners: $state.snapshot(picked) })
    if (err) error = err
    else onClose()
  }
</script>

<Sheet title="Who won?" {onClose}>
  <p class="dim">Tap the winner of each pot. Tap two or more names to split it.</p>

  {#each pots as pot, i (i)}
    <section class="pot">
      <div class="head">
        <h3>{potName(i)}</h3>
        <span class="amount num">{fmt(pot.amount)}</span>
      </div>
      {#if pot.eligible.length === 1}
        <p class="dim">Goes back to {names[pot.eligible[0]]}: nobody called it.</p>
      {:else}
        <div class="choices">
          {#each pot.eligible as seat (seat)}
            <button class="choice" class:on={picked[i]?.includes(seat)} aria-pressed={picked[i]?.includes(seat)} onclick={() => toggle(i, seat)}>
              {names[seat]}
            </button>
          {/each}
        </div>
        {#if picked[i]?.length > 1}
          <p class="dim num">Split {picked[i].length} ways, {fmt(Math.floor(pot.amount / picked[i].length))} each.</p>
        {/if}
      {/if}
    </section>
  {/each}

  {#if error}<p class="error">{error}</p>{/if}
  <button class="btn btn--gold big" disabled={!ready} onclick={pay}>Pay out</button>
</Sheet>

<style>
  .pot { display: flex; flex-direction: column; gap: var(--sp-2); border-top: 1px solid var(--line); padding-top: var(--sp-3); }
  .head { display: flex; justify-content: space-between; align-items: baseline; }
  h3 { font-size: var(--fs-lg); }
  .amount { font-size: var(--fs-xl); font-weight: 900; color: var(--gold); }
  .choices { display: grid; grid-template-columns: repeat(auto-fill, minmax(8.5rem, 1fr)); gap: var(--sp-2); }
  .choice {
    min-height: var(--tap);
    border-radius: var(--r-sm);
    border: 2px solid var(--line);
    background: transparent;
    font-weight: 700;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    padding: 0 var(--sp-2);
  }
  .choice.on { background: var(--gold); border-color: var(--gold); color: var(--ink); }
  .big { min-height: 60px; font-size: var(--fs-lg); font-weight: 900; }
  .error { color: var(--gold); }
</style>
