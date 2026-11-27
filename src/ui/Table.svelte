<script lang="ts">
  import type { TableSession } from '../app/session.svelte'
  import { activeCount, betLimits, canOpenBet, inHandPhase, isBetting, live, nextDealer, raiseSizes } from '../engine'
  import type { Seat } from '../engine'
  import { fmt } from './fmt'
  import ModSheet from './ModSheet.svelte'
  import Sheet from './Sheet.svelte'
  import ShowdownSheet from './ShowdownSheet.svelte'

  interface Props {
    session: TableSession
    onExit: () => void
  }

  let { session, onExit }: Props = $props()

  const st = $derived(session.state)
  const names = $derived(session.names)
  const me = $derived(session.mySeat)
  const myTurn = $derived(session.myTurn)
  const inHand = $derived(inHandPhase(st.phase))
  const betting = $derived(isBetting(st.phase))
  const modName = $derived(names[0])
  const requests = $derived(session.rebuyRequests)

  let sheet = $state<'mod' | 'showdown' | 'menu' | null>(null)
  let raising = $state(false)
  let raiseTo = $state(0)
  let error = $state('')
  let leaving = $state(false)

  /* ---- my turn ---- */
  const limits = $derived(me !== null && myTurn ? betLimits(st, me) : null)
  const opening = $derived(canOpenBet(st))
  const presets = $derived.by(() => {
    if (me === null || !limits?.canRaise) return []
    const [min, half, pot, max] = [limits.minRaiseTo, ...raiseSizes(st, me).slice(1, -1), limits.maxRaiseTo]
    const sizes = raiseSizes(st, me)
    const labels = new Map<number, string>()
    labels.set(sizes[sizes.length - 1], 'All-in')
    if (sizes.length >= 3) labels.set(sizes[sizes.length - 2], 'Pot')
    if (sizes.length >= 4) labels.set(sizes[1], '½ pot')
    labels.set(sizes[0], sizes[0] === max ? 'All-in' : 'Min')
    void [min, half, pot]
    return sizes.map((to) => ({ to, label: labels.get(to)! }))
  })

  // close the raise panel and any stale error whenever the turn moves on
  $effect(() => {
    void st.seatToAct
    void st.handIndex
    raising = false
    error = ''
  })

  // a short buzz when the action reaches me
  $effect(() => {
    if (myTurn) navigator.vibrate?.(180)
  })

  // the award sheet only makes sense during a showdown
  $effect(() => {
    if (sheet === 'showdown' && st.phase !== 'showdown') sheet = null
  })

  // keep the screen awake while the phone lies on the table
  $effect(() => {
    let lock: { release: () => Promise<void> } | null = null
    let gone = false
    const wake = navigator as Navigator & { wakeLock?: { request: (type: 'screen') => Promise<{ release: () => Promise<void> }> } }
    const acquire = () => {
      if (document.hidden || !wake.wakeLock) return
      wake.wakeLock.request('screen').then(
        (l) => (gone ? void l.release() : (lock = l)),
        () => {},
      )
    }
    acquire()
    document.addEventListener('visibilitychange', acquire)
    return () => {
      gone = true
      document.removeEventListener('visibilitychange', acquire)
      void lock?.release().catch(() => {})
    }
  })

  function act(move: Parameters<TableSession['submit']>[0]) {
    const err = session.submit(move)
    error = err ? err.charAt(0).toUpperCase() + err.slice(1) + '.' : ''
    if (!err) raising = false
  }

  function openRaise() {
    if (!limits) return
    raiseTo = limits.minRaiseTo
    raising = true
  }

  function nudge(dir: -1 | 1) {
    if (!limits) return
    raiseTo = Math.min(limits.maxRaiseTo, Math.max(limits.minRaiseTo, raiseTo + dir * st.bigBlind))
  }

  function confirmRaise() {
    if (!limits) return
    const to = Math.round(raiseTo)
    if (to >= limits.maxRaiseTo) act({ type: 'allin' })
    else act(opening ? { type: 'bet', to } : { type: 'raise', to })
  }

  const callAmount = $derived(limits && me !== null ? Math.min(limits.toCall, st.players[me].stack) : 0)

  /* ---- what the table is doing ---- */
  const STREET = { preflop: 'Before the flop', flop: 'Flop', turn: 'Turn', river: 'River', showdown: 'Showdown', betweenHands: '', over: '' } as const

  const freshStreet = $derived(
    betting && (st.street === 0 ? st.lastAction?.type === 'nextHand' : st.currentBet === 0 && st.players.every((p) => !live(p) || p.actedAtBet === null)),
  )

  const lastActionText = $derived.by(() => {
    const a = st.lastAction
    if (!a || !betting) return ''
    const who = a.seat === me ? 'You' : names[a.seat]
    const by = a.proxy ? ` (entered by ${modName})` : ''
    switch (a.type) {
      case 'fold':
        return `${who} folded${by}`
      case 'check':
        return `${who} checked${by}`
      case 'call':
        return `${who} called ${fmt(a.amount)}${by}`
      case 'bet':
        return `${who} bet ${fmt(a.amount)}`
      case 'raise':
        return `${who} raised, putting in ${fmt(a.amount)}`
      case 'allin':
        return `${who} went all-in with ${fmt(a.amount)}`
      default:
        return ''
    }
  })

  const status = $derived.by(() => {
    if (st.phase === 'betweenHands') {
      const h = st.lastHand
      if (!h) return 'Everyone has their chips. Shuffle up.'
      if (h.reason === 'void') return 'Hand cancelled. All chips went back.'
      const parts = h.awards.flatMap((won, seat) => (won > 0 ? [`${seat === me ? 'You' : names[seat]} ${seat === me ? 'take' : 'takes'} ${fmt(won)}`] : []))
      return parts.join(', ') + '.'
    }
    if (st.phase === 'showdown') return st.runout ? 'No more betting. Deal the rest of the board, then show your cards.' : 'Show your cards.'
    if (freshStreet) return ['Deal two cards each.', 'Deal the flop.', 'Deal the turn.', 'Deal the river.'][st.street]
    return lastActionText ? lastActionText + '.' : ''
  })

  function tag(seat: Seat): string {
    if (!inHand) return ''
    const t: string[] = []
    if (seat === st.dealer) t.push('D')
    if (seat === st.sbSeat) t.push('SB')
    else if (seat === st.bbSeat) t.push('BB')
    return t.join(' ')
  }

  function note(seat: Seat): string {
    const p = st.players[seat]
    if (p.sittingOut) return 'sitting out'
    if (inHand) {
      if (!p.dealtIn) return 'not in this hand'
      if (p.folded) return 'folded'
      if (p.allIn) return 'all-in'
    } else if (p.stack === 0) return 'out of chips'
    return ''
  }

  const waitingFor = $derived(st.seatToAct !== null ? names[st.seatToAct] : null)
  const canDeal = $derived(activeCount(st) >= 2)
  const myStack = $derived(me !== null ? st.players[me].stack : 0)
</script>

<main class="table" class:turn={myTurn}>
  <header class="strip">
    <div class="where">
      <strong>{st.handIndex === 0 ? 'New table' : `Hand ${st.handIndex}`}</strong>
      <span class="dim num">Blinds {fmt(st.smallBlind)}/{fmt(st.bigBlind)}</span>
    </div>
    <div class="tools">
      {#if session.isMod}
        <button class="btn btn--line btn--small" onclick={() => (sheet = 'mod')}>
          Run table{#if requests.length > 0}<span class="badge num">{requests.length}</span>{/if}
        </button>
      {/if}
      <button class="btn btn--line btn--small" onclick={() => (sheet = 'menu')} aria-label="Menu">Menu</button>
    </div>
  </header>

  <section class="pot" aria-live="polite">
    {#if inHand}
      <p class="street">{STREET[st.phase]}</p>
      <p class="amount num">{fmt(session.pot)}</p>
    {:else}
      <p class="street">{st.handIndex === 0 ? 'Table' : 'Between hands'}</p>
      <p class="amount room">{session.room}</p>
    {/if}
    <p class="status">{status}</p>
  </section>

  <ol class="rows" style="--n: {names.length}">
    {#each st.players as p, seat (seat)}
      <li class:acting={seat === st.seatToAct} class:faded={(inHand && (!p.dealtIn || p.folded)) || p.sittingOut || (!inHand && p.stack === 0)} class:me={seat === me}>
        <span class="tagcol">{tag(seat) || (!inHand && seat === nextDealer(st) && canDeal ? 'D next' : '')}</span>
        <span class="who">
          <span class="name">{names[seat]}</span>
          {#if seat === me}<span class="you">you</span>{/if}
          {#if !session.online(seat) && seat !== me}<span class="off">offline</span>{/if}
          {#if note(seat)}<span class="note" class:hot={p.allIn && inHand}>{note(seat)}</span>{/if}
        </span>
        <span class="bet num">{(st.phase === 'showdown' ? p.handBet : p.streetBet) > 0 ? fmt(st.phase === 'showdown' ? p.handBet : p.streetBet) : ''}</span>
        <span class="stack num">{fmt(p.stack)}</span>
      </li>
    {/each}
  </ol>

  <footer class="bar">
    {#if error}<p class="error">{error}</p>{/if}

    {#if session.spectator}
      <p class="wait">You are watching this table.</p>
    {:else if myTurn && limits}
      {#if raising}
        <div class="raise">
          <div class="amount-row">
            <button class="step" onclick={() => nudge(-1)} aria-label="Less">−</button>
            <p class="to num">{fmt(Math.round(raiseTo))}</p>
            <button class="step" onclick={() => nudge(1)} aria-label="More">+</button>
          </div>
          <input class="slider" type="range" min={limits.minRaiseTo} max={limits.maxRaiseTo} step="1" bind:value={raiseTo} aria-label="Amount" />
          <div class="presets">
            {#each presets as p (p.to)}
              <button class="btn btn--line btn--small" class:on={Math.round(raiseTo) === p.to} onclick={() => (raiseTo = p.to)}>{p.label}</button>
            {/each}
          </div>
          <div class="actions two">
            <button class="btn btn--line" onclick={() => (raising = false)}>Back</button>
            <button class="btn btn--red" onclick={confirmRaise}>
              {Math.round(raiseTo) >= limits.maxRaiseTo ? `All-in ${fmt(limits.maxRaiseTo)}` : `${opening ? 'Bet' : 'Raise to'} ${fmt(Math.round(raiseTo))}`}
            </button>
          </div>
        </div>
      {:else}
        <p class="yours">Your turn <span class="num stackline">{fmt(myStack)} behind</span></p>
        <div class="actions" class:two={!limits.canRaise}>
          <button class="btn btn--line" onclick={() => act({ type: 'fold' })}>Fold</button>
          {#if limits.toCall === 0}
            <button class="btn" onclick={() => act({ type: 'check' })}>Check</button>
          {:else}
            <button class="btn" onclick={() => act({ type: 'call' })}>{callAmount >= myStack ? 'Call all-in' : 'Call'} <span class="num">{fmt(callAmount)}</span></button>
          {/if}
          {#if limits.canRaise}
            <button class="btn btn--red" onclick={openRaise}>{opening ? 'Bet' : 'Raise'}</button>
          {/if}
        </div>
      {/if}
    {:else if st.phase === 'showdown'}
      {#if session.isMod}
        <button class="btn btn--gold wide" onclick={() => (sheet = 'showdown')}>Choose the winner</button>
      {:else}
        <p class="wait">{modName} is paying out the pot.</p>
      {/if}
    {:else if st.phase === 'betweenHands'}
      {#if session.isMod}
        <button class="btn btn--red wide" disabled={!canDeal} onclick={() => act({ type: 'nextHand' })}>
          {st.handIndex === 0 ? 'Start the first hand' : `Start hand ${st.handIndex + 1}`}
        </button>
        {#if !canDeal}<p class="wait small">At least two players need chips. Add some under Run table.</p>{/if}
      {:else}
        <p class="wait">Waiting for {modName} to start the next hand.</p>
        {#if myStack === 0}
          <button class="btn btn--line wide" onclick={() => session.askRebuy(!session.askedRebuy)}>
            {session.askedRebuy ? `Asked ${modName} for chips. Tap to cancel.` : `Ask ${modName} for more chips`}
          </button>
        {/if}
      {/if}
    {:else}
      <p class="wait">
        {waitingFor ? `${waitingFor}'s turn.` : ''}
        {#if me !== null}<span class="num stackline">You have {fmt(myStack)}</span>{/if}
      </p>
    {/if}
  </footer>
</main>

{#if sheet === 'mod'}
  <ModSheet {session} onClose={() => (sheet = null)} />
{:else if sheet === 'showdown'}
  <ShowdownSheet {session} onClose={() => (sheet = null)} />
{:else if sheet === 'menu'}
  <Sheet title="Table {session.room}" onClose={() => ((sheet = null), (leaving = false))}>
    <p class="dim">{modName} runs this table: starts each hand, pays out the pot and hands out chips.</p>
    {#if me !== null && !session.isMod}
      <button class="btn btn--line" onclick={() => session.askRebuy(!session.askedRebuy)}>
        {session.askedRebuy ? 'Cancel my request for chips' : `Ask ${modName} for more chips`}
      </button>
    {/if}
    {#if leaving}
      <p>Your seat and chips stay at the table, but this phone forgets them. Leave anyway?</p>
      <div class="menu-row">
        <button class="btn btn--red" onclick={onExit}>Leave the table</button>
        <button class="btn btn--line" onclick={() => (leaving = false)}>Stay</button>
      </div>
    {:else}
      <button class="btn btn--line" onclick={() => (leaving = true)}>Leave the table</button>
    {/if}
  </Sheet>
{/if}

<style>
  .table {
    height: 100dvh;
    display: flex;
    flex-direction: column;
    background: var(--bg);
    color: var(--fg);
    padding: env(safe-area-inset-top) env(safe-area-inset-right) 0 env(safe-area-inset-left);
    transition: background 160ms ease, color 160ms ease;
  }
  /* your turn: the whole phone goes bright, so the table can see whose move it is */
  .table.turn {
    --bg: var(--bone);
    --fg: var(--ink);
    --fg-dim: var(--ink-dim);
    --rule: var(--ink-line);
    --raised: #e2d8c1;
  }

  .strip { display: flex; justify-content: space-between; align-items: center; gap: var(--sp-2); padding: var(--sp-2) var(--sp-3); }
  .where { display: flex; flex-direction: column; line-height: 1.15; font-family: var(--font-narrow); min-width: 0; }
  .where span { font-size: var(--fs-xs); }
  .tools { display: flex; gap: var(--sp-2); }
  .badge { background: var(--gold); color: var(--ink); border-radius: 999px; min-width: 1.5em; padding: 0 0.4em; font-size: var(--fs-xs); line-height: 1.5; }

  .pot { text-align: center; padding: 0 var(--sp-3) var(--sp-2); }
  .street { font-size: var(--fs-sm); color: var(--fg-dim); }
  .amount { font-size: clamp(2.8rem, 17vw, 4.4rem); font-weight: 900; line-height: 1; letter-spacing: -0.04em; }
  .amount.room { letter-spacing: 0.04em; font-size: clamp(2.2rem, 13vw, 3.4rem); color: var(--fg-dim); }
  .status { min-height: 2.7em; font-size: var(--fs-sm); display: flex; align-items: center; justify-content: center; text-wrap: balance; }

  .rows { list-style: none; margin: 0; padding: 0; flex: 1; min-height: 0; display: flex; flex-direction: column; border-top: 1px solid var(--rule); overflow-y: auto; }
  .rows li {
    flex: 1 1 0;
    min-height: 30px;
    max-height: 60px;
    display: grid;
    grid-template-columns: 2.6rem minmax(0, 1fr) auto 4.6rem;
    align-items: center;
    gap: var(--sp-2);
    padding: 0 var(--sp-3);
    border-bottom: 1px solid var(--rule);
    font-family: var(--font-narrow);
  }
  .rows li.acting { background: var(--fg); color: var(--bg); }
  .rows li.faded > * { opacity: 0.42; }
  .tagcol { font-size: var(--fs-xs); font-weight: 700; color: var(--gold); white-space: nowrap; }
  .turn .tagcol { color: var(--red-deep); }
  .acting .tagcol { color: inherit; }
  .who { display: flex; align-items: baseline; gap: var(--sp-2); min-width: 0; white-space: nowrap; overflow: hidden; }
  .name { font-weight: 700; font-size: var(--fs-md); overflow: hidden; text-overflow: ellipsis; }
  .you, .off, .note { font-size: var(--fs-xs); opacity: 0.7; }
  .note.hot { color: #ff8a78; opacity: 1; font-weight: 700; }
  .turn .note.hot { color: var(--red-deep); }
  .acting .note.hot { color: inherit; }
  .bet { font-weight: 700; font-size: var(--fs-md); color: var(--gold); text-align: right; }
  .turn .bet { color: var(--red-deep); }
  .acting .bet { color: inherit; }
  .stack { text-align: right; font-size: var(--fs-md); font-weight: 500; }

  .bar {
    padding: var(--sp-3) var(--sp-3) max(var(--sp-3), env(safe-area-inset-bottom));
    display: flex;
    flex-direction: column;
    gap: var(--sp-2);
    background: var(--raised);
    min-height: 104px;
    justify-content: center;
  }
  .wait { text-align: center; font-weight: 700; display: flex; flex-direction: column; gap: 2px; }
  .wait.small { font-weight: 500; font-size: var(--fs-sm); }
  .stackline { font-weight: 500; font-size: var(--fs-sm); color: var(--fg-dim); }
  .yours { display: flex; justify-content: space-between; align-items: baseline; font-weight: 900; font-size: var(--fs-lg); }
  .error { color: var(--red); font-weight: 700; text-align: center; font-size: var(--fs-sm); }
  .wide { width: 100%; min-height: 64px; font-size: var(--fs-lg); font-weight: 900; }

  .actions { display: grid; grid-template-columns: 1fr 1.25fr 1.25fr; gap: var(--sp-2); }
  .actions.two { grid-template-columns: 1fr 1.6fr; }
  .actions .btn { min-height: 68px; font-size: var(--fs-lg); font-weight: 900; padding: 0 var(--sp-2); flex-direction: column; gap: 0; }
  .actions .btn .num { font-size: var(--fs-md); }

  .raise { display: flex; flex-direction: column; gap: var(--sp-3); }
  .amount-row { display: grid; grid-template-columns: var(--tap) 1fr var(--tap); align-items: center; gap: var(--sp-2); }
  .to { text-align: center; font-size: var(--fs-2xl); font-weight: 900; line-height: 1; }
  .step { height: var(--tap); border-radius: var(--r-sm); border: 2px solid var(--rule); background: transparent; font-size: var(--fs-xl); font-weight: 700; }
  .slider { width: 100%; height: 36px; accent-color: var(--red); }
  .presets { display: grid; grid-auto-flow: column; grid-auto-columns: 1fr; gap: var(--sp-2); }
  .presets .on { background: var(--fg); color: var(--bg); border-color: var(--fg); }

  .menu-row { display: grid; grid-template-columns: 1fr 1fr; gap: var(--sp-2); }
</style>
