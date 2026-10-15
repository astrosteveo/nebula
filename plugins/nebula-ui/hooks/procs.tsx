import { atom, read, update } from 'claude-code'
import type { Elements, EngineInterface, HookStream, ProcessSpawnChunk, ProcessSpawnResult } from 'claude-code'

import type { Proc } from '../types'
import { ACCENT } from './theme'

export const procs = atom({ plugin: 'nebula-ui', key: 'procs' } as const, [] as Proc[])

export const PROCS_PANE = 'nebula-procs'

/** Lines kept of what a process printed. */
const TAIL = 200

/** Processes kept in the list, newest first. */
const KEPT = 30

/** The first thing the wrapper prints, on stderr: the process group to stop. */
const GROUP_MARK = 'nebula-ui-pgid:'

/** How long a stop waits for SIGTERM before SIGKILL. */
const GRACE_MS = 3000

/** How often streamed output is written to state, so a chatty process doesn't redraw on every piece. */
const FLUSH_MS = 250

type Live = { stream: HookStream<ProcessSpawnChunk, ProcessSpawnResult>; isStopping: boolean }

/**
 * The streams being read, by process id. Reading keeps a child alive and `return()` ends it; this is
 * module memory, so a reload of the mod ends every loop (the groups may live on: see `adopt`).
 */
const live = new Map<string, Live>()

async function patch($: EngineInterface, id: string, change: (proc: Proc) => Proc) {
  await update($, procs, list => list.map(proc => (proc.id === id ? change(proc) : proc)))
}

/** Whether any process of the group is still alive (`kill -0` sends nothing). */
async function isGroupAlive($: EngineInterface, pgid: number) {
  try {
    return (await $.process.run(['kill', '-0', '--', `-${pgid}`], { timeoutMs: 2000 })).exitCode === 0
  } catch {
    return false
  }
}

async function signalGroup($: EngineInterface, pgid: number, signal: 'TERM' | 'KILL') {
  try {
    await $.process.run(['kill', `-${signal}`, '--', `-${pgid}`], { timeoutMs: 2000 })
  } catch {
    // Already gone.
  }
}

/**
 * Runs `command` through `sh -c` in the session's directory, in a process group of its own (setsid), and
 * reads what it prints into the list until it ends.
 */
export async function startProc($: EngineInterface, command: string, origin: string | null = null) {
  const id = crypto.randomUUID().slice(0, 8)
  const cwd = await $.session.cwd()
  const startedAt = await $.clock.now()
  const proc: Proc = { id, command, cwd, startedAt, endedAt: null, status: 'running', code: null, pgid: null, tail: [], origin }
  await update($, procs, list => [proc, ...list].slice(0, KEPT))

  const stream = $.process.spawn({
    argv: ['setsid', '-w', 'sh', '-c', `printf '${GROUP_MARK}%s\\n' "$$" >&2; ${command}`],
    cwd,
  })
  const entry: Live = { stream, isStopping: false }
  live.set(id, entry)

  void (async () => {
    const lines: string[] = []
    let partial = ''
    let flushedAt = 0
    const flush = async () => {
      flushedAt = Date.now()
      const tail = [...lines, ...(partial === '' ? [] : [partial])].slice(-TAIL)
      await patch($, id, one => ({ ...one, tail }))
    }

    try {
      for await (const chunk of stream) {
        let text = chunk.text
        if (chunk.stream === 'stderr' && text.includes(GROUP_MARK)) {
          const found = new RegExp(`${GROUP_MARK}(\\d+)\\n?`).exec(text)
          if (found !== null) {
            const pgid = Number(found[1])
            text = text.replace(found[0], '')
            await patch($, id, one => ({ ...one, pgid }))
          }
        }
        const pieces = (partial + text).split('\n')
        partial = pieces.pop() ?? ''
        lines.push(...pieces)
        lines.splice(0, Math.max(0, lines.length - TAIL))
        if (Date.now() - flushedAt >= FLUSH_MS) {
          await flush()
        }
      }
      const { code, signal } = await stream.result
      await flush()
      const endedAt = await $.clock.now()
      await patch($, id, one => ({
        ...one,
        endedAt,
        code,
        status: entry.isStopping || signal !== null ? 'stopped' : code === 0 ? 'exited' : 'failed',
      }))
    } catch (error) {
      await flush()
      const endedAt = await $.clock.now()
      await patch($, id, one => ({
        ...one,
        endedAt,
        status: entry.isStopping ? 'stopped' : 'failed',
        tail: [...one.tail, String(error)].slice(-TAIL),
      }))
    } finally {
      live.delete(id)
    }
  })()

  return id
}

/** Stops a process and everything it started: SIGTERM to its group, SIGKILL after a grace period. */
export async function stopProc($: EngineInterface, id: string) {
  const proc = (await read($, procs)).find(one => one.id === id)
  if (proc === undefined) {
    return
  }
  const entry = live.get(id)
  if (entry !== undefined) {
    entry.isStopping = true
  }
  if (proc.pgid !== null) {
    await signalGroup($, proc.pgid, 'TERM')
    const pgid = proc.pgid
    void (async () => {
      await $.clock.sleep(GRACE_MS)
      if (await isGroupAlive($, pgid)) {
        await signalGroup($, pgid, 'KILL')
      }
    })()
  }
  if (entry !== undefined) {
    await entry.stream.return(undefined as never).catch(() => undefined)
  } else {
    const endedAt = await $.clock.now()
    await patch($, id, one => ({ ...one, status: 'stopped', endedAt }))
  }
}

/** Stops every process still running: at the session's end, so nothing is left behind untracked. */
export async function stopAll($: EngineInterface) {
  const running = (await read($, procs)).filter(proc => proc.status === 'running' || proc.status === 'detached')
  await Promise.all(running.map(proc => stopProc($, proc.id)))
}

/**
 * After a reload of the mod, a process listed as running has no loop reading it: its group may live on.
 * One still alive is marked detached (it can still be stopped); one gone is marked ended.
 */
export async function adopt($: EngineInterface) {
  for (const proc of await read($, procs)) {
    if ((proc.status !== 'running' && proc.status !== 'detached') || live.has(proc.id)) {
      continue
    }
    const isAlive = proc.pgid !== null && (await isGroupAlive($, proc.pgid))
    if (proc.status === 'running' || !isAlive) {
      const now = await $.clock.now()
      await patch($, proc.id, one =>
        isAlive ? { ...one, status: 'detached' } : { ...one, status: 'exited', endedAt: one.endedAt ?? now },
      )
    }
  }
}

export async function clearProc($: EngineInterface, id: string) {
  await update($, procs, list => list.filter(proc => proc.id !== id))
}

export const TONE: Record<Proc['status'], { glyph: string; color: string }> = {
  running: { glyph: '◌', color: 'suggestion' },
  detached: { glyph: '◍', color: 'warning' },
  exited: { glyph: '✓', color: 'success' },
  failed: { glyph: '✗', color: 'error' },
  stopped: { glyph: '■', color: 'warning' },
}

const age = (ms: number) => {
  const seconds = Math.max(0, Math.round(ms / 1000))
  const minutes = Math.floor(seconds / 60)
  const hours = Math.floor(minutes / 60)

  return hours > 0 ? `${hours}h ${minutes % 60}m` : minutes > 0 ? `${minutes}m ${seconds % 60}s` : `${seconds}s`
}

export const statusWord = (proc: Proc, now: number) => {
  switch (proc.status) {
    case 'running':
      return now > proc.startedAt ? `running ${age(now - proc.startedAt)}` : 'running'
    case 'detached':
      return 'running, output detached by a reload'
    case 'exited':
      return `exited after ${age((proc.endedAt ?? now) - proc.startedAt)}`
    case 'failed':
      return `failed${proc.code === null ? '' : ` with ${proc.code}`}`
    case 'stopped':
      return 'stopped'
  }
}

export const isRunning = (proc: Proc) => proc.status === 'running' || proc.status === 'detached'

/** The Processes pane: each process, newest first, with its last lines and its controls. */
export const drawProcs = (
  ui: Elements['terminal'],
  list: Proc[],
  now: number,
  columns: number,
  act: {
    stop: (id: string) => void
    restart: (id: string) => void
    follow: (proc: Proc) => void
    clear: (id: string) => void
    clearEnded: () => void
  },
) => {
  const { Box, Text, Button } = ui
  if (list.length === 0) {
    return (
      <Box flexDirection="column">
        <Text dimColor>Nothing started yet.</Text>
        <Text dimColor>Click a shell command in one of Claude's replies and choose run here.</Text>
      </Box>
    )
  }
  const room = Math.max(10, columns - 4)

  return (
    <Box flexDirection="column" rowGap={1}>
      {list.some(proc => !isRunning(proc)) && (
        <Box flexDirection="row" justifyContent="flex-end">
          <Button key="clear-ended" plain onPress={act.clearEnded}>
            <Text dimColor>✕ clear ended</Text>
          </Button>
        </Box>
      )}
      {list.map(proc => {
        const tone = TONE[proc.status]
        const shown = proc.tail.filter(line => line.trim() !== '').slice(isRunning(proc) ? -8 : -3)

        return (
          <Box flexDirection="column">
            <Box flexDirection="row" gap={1}>
              <Box flexShrink={0}>
                <Text color={tone.color}>{tone.glyph}</Text>
              </Box>
              <Box flexShrink={1} flexGrow={1} overflow="hidden">
                <Text weight="bold" wrap="truncate-end">
                  {proc.command}
                </Text>
              </Box>
              <Box flexShrink={0} gap={1}>
                <Text color={tone.color}>{statusWord(proc, now)}</Text>
                {isRunning(proc) && (
                  <Button key={`stop-${proc.id}`} plain onPress={() => act.stop(proc.id)}>
                    <Text color="error">■ stop</Text>
                  </Button>
                )}
                <Button key={`restart-${proc.id}`} plain onPress={() => act.restart(proc.id)}>
                  <Text color="success">↻</Text>
                </Button>
                <Button key={`follow-${proc.id}`} plain onPress={() => act.follow(proc)}>
                  <Text color={ACCENT}>⤢</Text>
                </Button>
                {!isRunning(proc) && (
                  <Button key={`clear-${proc.id}`} plain onPress={() => act.clear(proc.id)}>
                    <Text dimColor>✕</Text>
                  </Button>
                )}
              </Box>
            </Box>
            {shown.map(line => (
              <Box flexDirection="row">
                <Text color={ACCENT}>▏ </Text>
                {outputLine(ui, line.slice(0, room))}
              </Box>
            ))}
          </Box>
        )
      })}
    </Box>
  )
}

/** Starts a process again with the command and frame it ran from, stopping it first if it still runs. */
export async function restartProc($: EngineInterface, id: string) {
  const proc = (await read($, procs)).find(one => one.id === id)
  if (proc === undefined) {
    return null
  }
  if (isRunning(proc)) {
    await stopProc($, id)
    for (let waited = 0; live.has(id) && waited < 5000; waited += 100) {
      await $.clock.sleep(100)
    }
  }

  return startProc($, proc.command, proc.origin)
}

/** The processes as the model reads them: one line each, newest first, with their last lines. */
export const describeProcs = (list: Proc[], now: number) =>
  list.length === 0
    ? 'No processes have been started from nebula-ui in this session.'
    : list
        .map(proc =>
          [
            `${proc.id}  ${proc.status}  ${statusWord(proc, now)}  in ${proc.cwd}`,
            `  $ ${proc.command}`,
            ...proc.tail.filter(line => line.trim() !== '').slice(-3).map(line => `  | ${line}`),
          ].join('\n'),
        )
        .join('\n\n')

/** One process's output as the model reads it: its status, then its last `lines` lines. */
export const describeOutput = (proc: Proc, now: number, lines: number) =>
  [
    `${proc.id}  ${proc.status}  ${statusWord(proc, now)}  in ${proc.cwd}`,
    `$ ${proc.command}`,
    '',
    ...(proc.tail.length === 0 ? ['(no output yet)'] : proc.tail.slice(-lines)),
  ].join('\n')

const URL = /https?:\/\/[^\s)\]'"<>`]+/g

/** A line of output with each URL a link (a server's 0.0.0.0 opened as localhost). */
export const outputLine = ({ Text, Link }: Elements['terminal'], line: string) => {
  const parts: Array<string | { url: string }> = []
  let at = 0
  for (const found of line.matchAll(URL)) {
    parts.push(line.slice(at, found.index), { url: found[0] })
    at = found.index + found[0].length
  }
  parts.push(line.slice(at))

  return (
    <Text wrap="truncate-end">
      {parts.map(part =>
        typeof part === 'string' ? part : <Link href={part.url.replace('//0.0.0.0', '//localhost')}>{part.url}</Link>,
      )}
    </Text>
  )
}

export const FOLLOW_PANE = 'nebula-proc:'

/** A pane following one process: its status and controls, then as many of its last lines as fit. */
export const drawFollow = (
  ui: Elements['terminal'],
  proc: Proc | undefined,
  now: number,
  rows: number,
  act: { stop: () => void; restart: () => void },
) => {
  const { Box, Text, Button } = ui
  if (proc === undefined) {
    return <Text dimColor>That process is no longer listed.</Text>
  }
  const tone = TONE[proc.status]

  return (
    <Box flexDirection="column">
      <Box flexDirection="row" gap={2}>
        <Text color={tone.color}>
          {tone.glyph} {statusWord(proc, now)}
        </Text>
        {isRunning(proc) && (
          <Button key="stop" plain hotkey="s" onPress={act.stop}>
            <Text color="error">■ stop</Text>
          </Button>
        )}
        <Button key="restart" plain hotkey="r" onPress={act.restart}>
          <Text color="success">↻ restart</Text>
        </Button>
      </Box>
      <Text dimColor wrap="truncate-end">
        $ {proc.command} · {proc.cwd}
      </Text>
      {proc.tail.slice(-Math.max(1, rows - 2)).map(line => outputLine(ui, line))}
    </Box>
  )
}
