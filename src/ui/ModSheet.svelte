<script lang="ts">
  import { untrack } from 'svelte'
  import type { TableSession } from '../app/session.svelte'
  import { bettingMoves, betLimits, inHandPhase } from '../engine'
  import type { Move } from '../engine'
  import { fmt } from './fmt'
  import Sheet from './Sheet.svelte'

  interface Props {
    session: TableSession
    onClose: () => void
  }

  let { session, onClose }: Props = $props()

  const st = $derived(session.state)
  const names = $derived(session.names)
  const between = $derived(st.phase === 'betweenHands')
  const toAct = $derived(st.seatToAct)
  const requests = $derived(session.rebuyRequests)

  let error = $state('')
  let confirming = $state<'void' | 'close' | null>(null)

  let chipSeat = $state(0)
  let chipAmount = $state(untrack(() => session.state.config.buyIn))
  let fromSeat = $state(0)
  let toSeat = $state(1)
  let moveAmount = $state(0)
  let small = $state(untrack(() => session.state.smallBlind))
  let big = $state(untrack(() => session.state.bigBlind))

  function run(move: Move, close = false) {
    const err = session.submit(move)
    error = err ? err.charAt(0).toUpperCase() + err.slice(1) + '.' : ''
    confirming = null
    if (!err && close) onClose()
  }

  const proxyMoves = $derived(toAct === null ? [] : bettingMoves(st, toAct).filter((m) => m.type === 'fold' || m.type === 'check' || m.type === 'call'))
  const proxyLabel = (m: Move) =>
    m.type === 'fold' ? 'Fold' : m.type === 'check' ? 'Check' : `Call ${fmt(Math.min(betLimits(st, toAct!).toCall, st.players[toAct!].stack))}`
</script>

<Sheet title="Run the table" {onClose}>
  {#if error}<p class="error">{error}</p>{/if}

  {#if requests.length > 0}
    <section>
      <h3>Asking for chips</h3>
      {#each requests as seat (seat)}
        <div class="line">
          <span class="grow">{names[seat]}</span>
          {#if between}
            <button class="btn btn--gold btn--small" onclick={() => run({ type: 'rebuy', seat, amount: st.config.buyIn })}>Add {fmt(st.config.buyIn)}</button>
          {:else}
            <span class="dim">after this hand</span>
          {/if}
        </div>
      {/each}
    </section>
  {/if}

  {#if inHandPhase(st.phase)}
    {#if toAct !== null && toAct !== session.mySeat}
      <section>
        <h3>Act for {names[toAct]}</h3>
        <p class="dim">For when their phone is dead or they stepped away.</p>
        <div class="row">
          {#each proxyMoves as m (m.type)}
            <button class="btn btn--line" onclick={() => run({ ...m, proxy: true }, true)}>{proxyLabel(m)}</button>
          {/each}
        </div>
      </section>
    {/if}

    <section>
      <h3>Misdeal</h3>
      <p class="dim">Cancels this hand and gives everyone back what they put in. The button stays where it is.</p>
      {#if confirming === 'void'}
        <div class="row">
          <button class="btn btn--red" onclick={() => run({ type: 'voidHand' }, true)}>Yes, cancel the hand</button>
          <button class="btn btn--line" onclick={() => (confirming = null)}>Keep playing</button>
        </div>
      {:else}
        <button class="btn btn--line" onclick={() => (confirming = 'void')}>Cancel this hand</button>
      {/if}
    </section>

    <p class="dim">Chips, blinds and seats can be changed between hands.</p>
  {:else}
    <section>
      <h3>Add or take off chips</h3>
      <p class="dim">A rebuy or a cash-out. It counts toward what that player has bought in for.</p>
      <div class="grid2">
        <label class="field">
          <span>Player</span>
          <select bind:value={chipSeat}>
            {#each names as name, seat (seat)}<option value={seat}>{name} ({fmt(st.players[seat].stack)})</option>{/each}
          </select>
        </label>
        <label class="field">
          <span>Chips (negative to take off)</span>
          <input type="number" inputmode="numeric" step="1" bind:value={chipAmount} />
        </label>
      </div>
      <button class="btn" disabled={!Number.isInteger(chipAmount) || chipAmount === 0} onclick={() => run({ type: 'rebuy', seat: chipSeat, amount: chipAmount })}>
        {chipAmount < 0 ? `Take ${fmt(-chipAmount || 0)} from` : `Add ${fmt(chipAmount || 0)} to`}
        {names[chipSeat]}
      </button>
    </section>

    <section>
      <h3>Fix a mistake</h3>
      <p class="dim">Moves chips from one stack to another, for a pot that went to the wrong player.</p>
      <div class="grid3">
        <label class="field">
          <span>From</span>
          <select bind:value={fromSeat}>
            {#each names as name, seat (seat)}<option value={seat}>{name}</option>{/each}
          </select>
        </label>
        <label class="field">
          <span>To</span>
          <select bind:value={toSeat}>
            {#each names as name, seat (seat)}<option value={seat}>{name}</option>{/each}
          </select>
        </label>
        <label class="field">
          <span>Chips</span>
          <input type="number" inputmode="numeric" min="1" step="1" bind:value={moveAmount} />
        </label>
      </div>
      <button
        class="btn btn--line"
        disabled={!Number.isInteger(moveAmount) || moveAmount <= 0 || fromSeat === toSeat}
        onclick={() => run({ type: 'transfer', from: fromSeat, to: toSeat, amount: moveAmount })}
      >
        Move chips
      </button>
    </section>

    <section>
      <h3>Blinds</h3>
      <div class="grid2">
        <label class="field">
          <span>Small blind</span>
          <input type="number" inputmode="numeric" min="1" step="1" bind:value={small} />
        </label>
        <label class="field">
          <span>Big blind</span>
          <input type="number" inputmode="numeric" min="1" step="1" bind:value={big} />
        </label>
      </div>
      <button
        class="btn btn--line"
        disabled={!Number.isInteger(small) || !Number.isInteger(big) || small < 1 || small > big || (small === st.smallBlind && big === st.bigBlind)}
        onclick={() => run({ type: 'setBlinds', small, big })}
      >
        Set blinds to {small}/{big}
      </button>
    </section>

    <section>
      <h3>Sit out</h3>
      <p class="dim">A player sitting out is skipped until you sit them back in.</p>
      {#each names as name, seat (seat)}
        <div class="line">
          <span class="grow">{name}{#if st.players[seat].stack === 0}<span class="dim"> · no chips</span>{/if}</span>
          <button class="btn btn--line btn--small" onclick={() => run({ type: 'sit', seat, out: !st.players[seat].sittingOut })}>
            {st.players[seat].sittingOut ? 'Sit back in' : 'Sit out'}
          </button>
        </div>
      {/each}
    </section>

    <section>
      <h3>End the night</h3>
      <p class="dim">Closes the table and shows who owes whom.</p>
      {#if confirming === 'close'}
        <div class="row">
          <button class="btn btn--red" onclick={() => run({ type: 'closeTable' }, true)}>Yes, close the table</button>
          <button class="btn btn--line" onclick={() => (confirming = null)}>Keep playing</button>
        </div>
      {:else}
        <button class="btn btn--line" onclick={() => (confirming = 'close')}>Close the table and settle up</button>
      {/if}
    </section>
  {/if}
</Sheet>

<style>
  section { display: flex; flex-direction: column; gap: var(--sp-2); border-top: 1px solid var(--line); padding-top: var(--sp-3); }
  h3 { font-size: var(--fs-lg); }
  p { font-size: var(--fs-sm); }
  .row { display: flex; gap: var(--sp-2); flex-wrap: wrap; }
  .row .btn { flex: 1; }
  .grid2 { display: grid; grid-template-columns: 1fr 1fr; gap: var(--sp-2); }
  .grid3 { display: grid; grid-template-columns: 1fr 1fr 0.8fr; gap: var(--sp-2); }
  .line { display: flex; align-items: center; gap: var(--sp-3); min-height: 44px; }
  .grow { flex: 1; font-weight: 700; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .error { color: var(--gold); font-weight: 700; font-size: var(--fs-md); }
</style>
