<script lang="ts">
  import { APP, loadPlayerName, playerKey } from './app/persist'
  import { TableSession } from './app/session.svelte'
  import { makeRoomCode } from '@yujun/game-net'
  import Home from './ui/Home.svelte'
  import Lobby from './ui/Lobby.svelte'
  import SettleUp from './ui/SettleUp.svelte'
  import Table from './ui/Table.svelte'

  let session = $state<TableSession | null>(null)

  const creatorFlag = (room: string) => `${APP}:creator:${room}`

  function roomFromHash(): string | null {
    const m = location.hash.match(/room=([A-Za-z0-9]{4,})/)
    return m ? m[1].toUpperCase() : null
  }

  function syncFromHash() {
    const room = roomFromHash()
    if (room && session?.room !== room) {
      session?.destroy()
      const creator = localStorage.getItem(creatorFlag(room)) !== null
      session = new TableSession(room, creator, { key: playerKey(), name: loadPlayerName() })
    } else if (!room && session) {
      session.destroy()
      session = null
    }
  }

  syncFromHash()
  $effect(() => {
    window.addEventListener('hashchange', syncFromHash)
    return () => window.removeEventListener('hashchange', syncFromHash)
  })

  // debugging handle (harmless in production)
  $effect(() => {
    ;(window as unknown as Record<string, unknown>).__pokerchips = session
  })

  function createRoom() {
    const code = makeRoomCode()
    localStorage.setItem(creatorFlag(code), '1')
    location.hash = `room=${code}`
  }

  function joinRoom(code: string) {
    location.hash = `room=${code.toUpperCase()}`
  }

  function exitToHome() {
    if (!session) return
    localStorage.removeItem(creatorFlag(session.room))
    session.leave()
    session = null
    location.hash = ''
  }
</script>

{#if !session}
  <Home onCreateRoom={createRoom} onJoinRoom={joinRoom} />
{:else if !session.playing}
  <Lobby {session} onExit={exitToHome} />
{:else if session.state.result}
  <SettleUp {session} onExit={exitToHome} />
{:else}
  <Table {session} onExit={exitToHome} />
{/if}
