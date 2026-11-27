<script lang="ts">
  import { loadPlayerName, savePlayerName } from '../app/persist'

  interface Props {
    onCreateRoom: () => void
    onJoinRoom: (code: string) => void
  }

  let { onCreateRoom, onJoinRoom }: Props = $props()

  let code = $state('')
  let myName = $state(loadPlayerName())

  function rename(e: Event) {
    myName = (e.target as HTMLInputElement).value
    savePlayerName(myName)
  }

  function join(e: Event) {
    e.preventDefault()
    if (code.trim().length >= 4) onJoinRoom(code.trim())
  }
</script>

<main class="page home">
  <header>
    <div class="stack" aria-hidden="true">
      <i style="--c: var(--gold)"></i><i style="--c: var(--bone)"></i><i style="--c: var(--red)"></i><i style="--c: var(--bone)"></i><i
        style="--c: var(--red)"
      ></i>
    </div>
    <h1>Poker<br />Chips</h1>
    <p class="lede">Deal real cards. Bet on your phones. Everyone sees the same pot, and one of you pays out the winner.</p>
  </header>

  <section class="form">
    <label class="field">
      <span>Your name at the table</span>
      <input type="text" maxlength="12" value={myName} placeholder="Name" autocomplete="nickname" oninput={rename} />
    </label>

    <button class="btn btn--red big" onclick={onCreateRoom}>Open a table</button>
    <p class="dim note">You run the table: you start each hand and name the winner at showdown.</p>

    <form class="join" onsubmit={join}>
      <label class="field">
        <span>Or join with a table code</span>
        <input type="text" maxlength="8" bind:value={code} placeholder="ABC234" autocapitalize="characters" autocomplete="off" spellcheck="false" />
      </label>
      <button class="btn" type="submit" disabled={code.trim().length < 4}>Join</button>
    </form>
  </section>

  <footer class="dim">
    <p>Two to ten players. No-limit betting with blinds and side pots. No accounts; chips are only numbers.</p>
    <p>build {__BUILD_STAMP__}</p>
  </footer>
</main>

<style>
  .home { justify-content: space-between; }
  header { display: flex; flex-direction: column; gap: var(--sp-4); padding-top: 4vh; }
  h1 { font-size: clamp(4rem, 24vw, 6.5rem); line-height: 0.86; letter-spacing: -0.045em; text-transform: uppercase; }
  .lede { font-size: var(--fs-lg); line-height: 1.25; max-width: 22ch; }

  /* a short stack of chips seen edge-on */
  .stack { display: flex; flex-direction: column; gap: 3px; width: 76px; }
  .stack i {
    display: block;
    height: 11px;
    border-radius: 3px;
    background: repeating-linear-gradient(90deg, var(--c) 0 14px, var(--baize-deep) 14px 19px);
  }

  .form { display: flex; flex-direction: column; gap: var(--sp-3); }
  .big { min-height: 64px; font-size: var(--fs-lg); font-weight: 900; }
  .note { font-size: var(--fs-sm); margin-bottom: var(--sp-4); }
  .join { display: grid; grid-template-columns: 1fr auto; gap: var(--sp-2); align-items: end; }
  .join input { text-transform: uppercase; letter-spacing: 0.14em; }
  footer { font-size: var(--fs-xs); display: flex; flex-direction: column; gap: var(--sp-1); }
</style>
