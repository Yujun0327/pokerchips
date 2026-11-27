<script lang="ts">
  import { Mesh } from '@yujun/game-net/mesh'
  import { TableSession } from '../src/app/session.svelte'
  import Lobby from '../src/ui/Lobby.svelte'
  import SettleUp from '../src/ui/SettleUp.svelte'
  import Table from '../src/ui/Table.svelte'
  import { runScene } from './scenes'

  const q = new URLSearchParams(location.search)
  const n = Number(q.get('n') ?? 4)
  const w = Number(q.get('w') ?? 390)
  const h = Number(q.get('h') ?? 844)
  const NAMES = ['Yujun', 'Mina', 'Theo', 'Priya', 'Lars', 'Chidi', 'Sofia', 'Kenji', 'Amara', 'Noor']

  for (const k of Object.keys(localStorage)) if (k.startsWith('pokerchips:room:DEMO42')) localStorage.removeItem(k)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const mesh = new Mesh<any>()
  const sessions = Array.from(
    { length: n },
    (_, i) => new TableSession('DEMO42', i === 0, { key: `demo-${i}`, name: NAMES[i] }, { transport: mesh.peer(`p${i}`) }),
  )
  setInterval(() => mesh.flush(), 60)
  ;(window as unknown as Record<string, unknown>).__sessions = sessions
  const scene = q.get('scene')
  if (scene) void runScene(scene, sessions)
</script>

<div class="wall">
  {#each sessions as session, i (i)}
    <div class="phone" style="width: {w}px; height: {h}px">
      {#if !session.playing}
        <Lobby {session} onExit={() => {}} />
      {:else if session.state.result}
        <SettleUp {session} onExit={() => {}} />
      {:else}
        <Table {session} onExit={() => {}} />
      {/if}
    </div>
  {/each}
</div>

<style>
  .wall { display: flex; flex-wrap: wrap; gap: 16px; padding: 16px; background: #000; min-height: 100vh; }
  /* a transformed box contains fixed-position sheets, and dvh units are remapped to the frame */
  .phone { position: relative; overflow: hidden; transform: translateZ(0); border: 1px solid #333; background: var(--baize); container-type: size; }
  .phone :global(.table) { height: 100%; }
  .phone :global(.page) { min-height: 100%; height: 100%; overflow-y: auto; }
</style>
