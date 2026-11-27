<script lang="ts">
  import QRCode from 'qrcode'
  import type { TableSession } from '../app/session.svelte'
  import { savePlayerName } from '../app/persist'
  import { MAX_SEATS } from '../engine'

  interface Props {
    session: TableSession
    onExit: () => void
  }

  let { session, onExit }: Props = $props()

  const url = $derived(`${location.origin}${location.pathname}#room=${session.room}`)
  let qr = $state('')
  let copied = $state(false)
  let relays = $state(0)

  $effect(() => {
    void QRCode.toString(url, { type: 'svg', margin: 1, color: { dark: '#10201d', light: '#f2ead8' } }).then((svg) => (qr = svg))
  })

  $effect(() => {
    relays = session.relayCount()
    const poll = setInterval(() => (relays = session.relayCount()), 1500)
    return () => clearInterval(poll)
  })

  const seats = $derived(session.seats)
  const hostName = $derived(seats.find((s) => s.host)?.name ?? 'the moderator')
  const pick = $derived(session.pick)

  async function share() {
    try {
      if (navigator.share) await navigator.share({ title: 'Poker Chips', text: `Join my poker table: ${session.room}`, url })
      else {
        await navigator.clipboard.writeText(url)
        copied = true
        setTimeout(() => (copied = false), 1600)
      }
    } catch {
      /* cancelled */
    }
  }

  function rename(e: Event) {
    const name = (e.target as HTMLInputElement).value
    savePlayerName(name)
    session.rename(name)
  }

  function setPick(key: 'buyIn' | 'small' | 'big', e: Event) {
    const v = Math.round(Number((e.target as HTMLInputElement).value))
    session.pick = { ...session.pick, [key]: Number.isFinite(v) ? v : 0 }
  }

  const blocker = $derived.by(() => {
    if (seats.length < 2) return 'Waiting for a second player.'
    if (pick.small < 1 || pick.small > pick.big) return 'The small blind must be at least 1 and no more than the big blind.'
    if (pick.big > pick.buyIn) return 'The big blind cannot be larger than the starting stack.'
    if (seats.some((s) => !s.connected)) return 'Someone lost their connection. Waiting for them to come back.'
    return null
  })
</script>

<main class="page">
  <header class="top">
    <div>
      <p class="dim small">Table code</p>
      <h1 class="code">{session.room}</h1>
    </div>
    <button class="btn btn--line btn--small" onclick={onExit}>Leave</button>
  </header>

  {#if session.status === 'room-full'}
    <p class="notice">This table already has {MAX_SEATS} players. Ask {hostName} to open another one.</p>
  {:else if session.status === 'version-mismatch'}
    <p class="notice">Someone at this table has an older version of the app open. Everyone should reload the page.</p>
  {:else}
    <section class="invite">
      <div class="qr" aria-label="QR code to join this table">{@html qr}</div>
      <div class="invite-text">
        <p>Scan to sit down, or type the code on the home screen.</p>
        <button class="btn btn--small" onclick={share}>{copied ? 'Link copied' : 'Share link'}</button>
      </div>
    </section>

    <section>
      <h2>Seats <span class="dim num">{seats.length}/{MAX_SEATS}</span></h2>
      <p class="dim small">
        {session.isHost ? 'Put everyone in the order you sit, clockwise from you.' : `${hostName} arranges the seats to match the real table.`}
      </p>
      <ol class="seats">
        {#each seats as seat, i (seat.playerKey)}
          <li class:off={!seat.connected}>
            <span class="pos num">{i + 1}</span>
            {#if seat.self}
              <input class="name-input" type="text" maxlength="12" value={seat.name} onchange={rename} aria-label="Your name" />
            {:else}
              <span class="name">{seat.name}</span>
            {/if}
            {#if seat.host}<span class="tag">runs the table</span>{/if}
            {#if !seat.connected}<span class="tag">offline</span>{/if}
            {#if session.isHost && !seat.host}
              <span class="move">
                <button class="arrow" disabled={i <= 1} onclick={() => session.moveSeat(seat.playerKey, -1)} aria-label="Move {seat.name} up">↑</button>
                <button class="arrow" disabled={i >= seats.length - 1} onclick={() => session.moveSeat(seat.playerKey, 1)} aria-label="Move {seat.name} down">↓</button>
              </span>
            {/if}
          </li>
        {/each}
      </ol>
    </section>

    <section>
      <h2>Stakes</h2>
      {#if session.isHost}
        <div class="stakes">
          <label class="field">
            <span>Starting stack</span>
            <input type="number" inputmode="numeric" min="1" step="1" value={pick.buyIn} oninput={(e) => setPick('buyIn', e)} />
          </label>
          <label class="field">
            <span>Small blind</span>
            <input type="number" inputmode="numeric" min="1" step="1" value={pick.small} oninput={(e) => setPick('small', e)} />
          </label>
          <label class="field">
            <span>Big blind</span>
            <input type="number" inputmode="numeric" min="1" step="1" value={pick.big} oninput={(e) => setPick('big', e)} />
          </label>
        </div>
      {:else}
        <p class="stakes-read num">{pick.buyIn.toLocaleString('en-US')} chips each, blinds {pick.small}/{pick.big}</p>
      {/if}
    </section>

    <section class="go">
      {#if session.isHost}
        <button class="btn btn--red big" disabled={!session.canStart} onclick={() => session.startGame()}>Start the table</button>
        <p class="dim small">{blocker ?? 'Nobody can join after you start, so wait until everyone is seated.'}</p>
      {:else}
        <p class="waiting">Waiting for {hostName} to start the table.</p>
      {/if}
      {#if relays === 0}
        <p class="dim small">
          Connecting… <button class="link" onclick={() => session.rescan()}>Try again</button>
        </p>
      {/if}
    </section>
  {/if}
</main>

<style>
  .top { display: flex; justify-content: space-between; align-items: flex-start; gap: var(--sp-3); }
  .small { font-size: var(--fs-sm); }
  .code { font-size: clamp(2.6rem, 14vw, 3.6rem); letter-spacing: 0.06em; }
  h2 { font-size: var(--fs-lg); margin-bottom: var(--sp-1); }
  .notice { font-size: var(--fs-lg); }

  .invite { display: grid; grid-template-columns: 132px 1fr; gap: var(--sp-4); align-items: center; }
  .qr { background: var(--bone); border-radius: var(--r-sm); padding: 6px; aspect-ratio: 1; }
  .qr :global(svg) { display: block; width: 100%; height: 100%; }
  .invite-text { display: flex; flex-direction: column; gap: var(--sp-3); align-items: flex-start; }

  .seats { list-style: none; margin: var(--sp-3) 0 0; padding: 0; border-top: 1px solid var(--line); }
  .seats li { display: flex; align-items: center; gap: var(--sp-3); min-height: var(--tap); border-bottom: 1px solid var(--line); }
  .seats li.off .name { color: var(--bone-dim); }
  .pos { width: 1.4em; color: var(--bone-dim); font-family: var(--font-narrow); }
  .name { font-weight: 700; flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .name-input { flex: 1; min-height: 40px; }
  .tag { font-size: var(--fs-xs); color: var(--gold); white-space: nowrap; }
  .move { display: flex; gap: var(--sp-1); }
  .arrow { width: 44px; height: 40px; border-radius: var(--r-sm); border: 2px solid var(--line); background: transparent; font-weight: 700; }
  .arrow:disabled { opacity: 0.25; }

  .stakes { display: grid; grid-template-columns: 1.3fr 1fr 1fr; gap: var(--sp-2); margin-top: var(--sp-2); }
  .stakes-read { font-size: var(--fs-lg); font-weight: 700; }

  .go { display: flex; flex-direction: column; gap: var(--sp-2); margin-top: auto; }
  .big { min-height: 64px; font-size: var(--fs-lg); font-weight: 900; }
  .waiting { font-size: var(--fs-lg); font-weight: 700; }
  .link { background: none; border: none; padding: 0; text-decoration: underline; color: var(--bone); }
</style>
