<script lang="ts">
  import type { Snippet } from 'svelte'
  import { fade, fly } from 'svelte/transition'
  import { dur, settle } from './motion'

  interface Props {
    title: string
    onClose: () => void
    children: Snippet
  }

  let { title, onClose, children }: Props = $props()

  function backdrop(e: MouseEvent) {
    if (e.target === e.currentTarget) onClose()
  }
</script>

<svelte:window onkeydown={(e) => e.key === 'Escape' && onClose()} />

<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_noninteractive_element_interactions -->
<div class="backdrop" onclick={backdrop} role="dialog" aria-modal="true" aria-label={title} tabindex="-1" transition:fade={{ duration: dur(140) }}>
  <div class="sheet" transition:fly={{ y: 40, duration: dur(220), easing: settle }}>
    <header>
      <h2>{title}</h2>
      <button class="btn btn--line btn--small" onclick={onClose}>Close</button>
    </header>
    {@render children()}
  </div>
</div>

<style>
  .backdrop { position: fixed; inset: 0; z-index: 40; background: rgb(5 15 13 / 0.7); display: flex; align-items: flex-end; justify-content: center; }
  .sheet {
    /* sheets are always dark, even when the table behind has flipped to "your turn" */
    --bg: var(--baize-hi);
    --fg: var(--bone);
    --fg-dim: var(--bone-dim);
    --rule: var(--line);
    background: var(--baize-hi);
    color: var(--bone);
    width: min(100%, 30rem);
    max-height: 92dvh;
    overflow-y: auto;
    border-radius: var(--r-lg) var(--r-lg) 0 0;
    padding: var(--sp-4) max(var(--sp-4), env(safe-area-inset-right)) max(var(--sp-5), env(safe-area-inset-bottom))
      max(var(--sp-4), env(safe-area-inset-left));
    display: flex;
    flex-direction: column;
    gap: var(--sp-4);
  }
  header { display: flex; justify-content: space-between; align-items: center; gap: var(--sp-3); }
  h2 { font-size: var(--fs-xl); }
</style>
