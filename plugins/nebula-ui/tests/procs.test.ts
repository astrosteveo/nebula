import { expect, mock, test } from 'claude-code/testing'
import type { On } from 'claude-code'

const PLUGIN = 'nebula-ui'
const pane = (bodyColumns = 100) => ({
  title: 'Processes',
  isFocused: false,
  bodyColumns,
  placement: 'inline' as const,
  scroll: { offset: 0, bodyRows: 30 },
  view: {},
})

/** The pane ids the engine was asked to open, in order, since the last engine was set up. */
let opened: string[] = []

const engine = (on: On, kills: string[][], decision: 'allow' | 'ask' | 'deny' = 'allow') => {
  mock.store(on)
  const clock = mock.clock(on, { now: 1_000_000 })
  opened = []
  on('session.cwd', () => ({ value: '/repo' }))
  on('tool.check', () => ({ decision }))
  on('ui.open', (_, e) => {
    opened.push(e.id)

    return { value: { isPlaced: true } }
  })
  on('ui.close', () => ({ value: undefined }))
  on('ui.toast', () => ({ value: undefined }))
  on('prompt.read', () => ({ value: { text: '', cursor: 0 } }))
  on('process.run', ($, e) => {
    kills.push([...e.argv])

    return {
      value: { exitCode: 0, stdout: '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false },
    }
  })

  return clock
}

test('run here starts the command in its own group and lists what it printed and how it ended', async ($, on) => {
  const kills: string[][] = []
  engine(on, kills)
  let argv: readonly string[] = []
  on('process.spawn', async function* ($, e) {
    argv = e.argv
    yield { stream: 'stderr' as const, text: 'nebula-ui-pgid:4242\n' }
    yield { stream: 'stdout' as const, text: 'ready on :3000\n' }

    return { value: { code: 0, signal: null } }
  })
  const reply = await $.ui.mount({
    plugin: PLUGIN,
    surface: 'terminal',
    component: 'AssistantMessage',
    props: { text: 'Start it with `npm run dev`.', isFirstOfReply: true },
  })
  await reply.press({ key: 'commands-0', link: { href: 'https://nebula-ui.invalid/command/0' } })
  const dialog = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', component: 'Pane', requestId: 'nebula-run', props: pane() })
  await dialog.press({ key: 'run' })

  expect(argv.slice(0, 4)).toEqual(['setsid', '-w', 'sh', '-c'])
  expect(argv[4]).toContain('npm run dev')

  const procs = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', component: 'Pane', requestId: 'nebula-procs', props: pane() })
  const text = (await procs.findAll({ type: 'Text' })).map(one => one.text).join('\n')
  expect(text).toContain('npm run dev')
  expect(text).toContain('ready on :3000')
  expect(text).toContain('exited')
  expect(text).not.toContain('nebula-ui-pgid')
})

test('run on a shell fence starts it at once and draws its output in that frame, stop in place of run', async ($, on) => {
  const kills: string[][] = []
  engine(on, kills)
  on('process.spawn', async function* () {
    yield { stream: 'stderr' as const, text: 'nebula-ui-pgid:99\n' }
    yield { stream: 'stdout' as const, text: 'Serving HTTP on 0.0.0.0 port 8765\n' }

    return { value: { code: 0, signal: null } }
  })
  const reply = await $.ui.mount({
    plugin: PLUGIN,
    surface: 'terminal',
    component: 'AssistantMessage',
    requestId: 'msg_1',
    props: { text: '```sh\npython3 -m http.server 8765\n```', isFirstOfReply: true },
  })
  await reply.press({ key: 'run-0' })
  const text = (await reply.findAll({ type: 'Text' })).map(one => one.text).join('\n')

  expect((await reply.find({ type: 'Code' }))?.props).toMatchObject({ source: 'python3 -m http.server 8765' })
  expect(text).toContain('Serving HTTP on 0.0.0.0 port 8765')
  expect(text).toContain('✓ exited')
  expect(await reply.find({ key: 'run-0' })).toBeDefined()
})

test('Claude can list the processes, read one, restart it, and start a new one', async ($, on) => {
  const kills: string[][] = []
  const clock = engine(on, kills)
  let spawned = 0
  on('process.spawn', async function* () {
    spawned += 1
    yield { stream: 'stderr' as const, text: `nebula-ui-pgid:${100 + spawned}\n` }
    yield { stream: 'stdout' as const, text: `run ${spawned}: listening on http://0.0.0.0:8765/\n` }

    return { value: { code: 0, signal: null } }
  })

  const started = await $.tool.call({ tool: 'mcp__nebula-ui__process_control', action: 'start', command: 'npm run dev' })
  const id = /Started (\w+)/.exec(String(started.result))?.[1]
  expect(id).toBeDefined()
  // A start answers once the process runs; its output is read after.
  await clock.settle()

  const list = await $.tool.call({ tool: 'mcp__nebula-ui__processes' })
  expect(String(list.result)).toContain('$ npm run dev')
  expect(String(list.result)).toContain('run 1: listening')

  const output = await $.tool.call({ tool: 'mcp__nebula-ui__processes', id, lines: 5 })
  expect(String(output.result)).toContain('exited')

  const restarted = await $.tool.call({ tool: 'mcp__nebula-ui__process_control', action: 'restart', id })
  expect(String(restarted.result)).toMatch(/Restarted as \w+: npm run dev/)
  await clock.settle()
  expect(spawned).toBe(2)

  const missing = await $.tool.call({ tool: 'mcp__nebula-ui__processes', id: 'nope' })
  expect(missing.deny).toContain('No process nope')
})

test('a URL in process output is a link, a server bound to 0.0.0.0 opened as localhost', async ($, on) => {
  const kills: string[][] = []
  engine(on, kills)
  on('process.spawn', async function* () {
    yield { stream: 'stdout' as const, text: 'Serving HTTP on 0.0.0.0 port 8765 (http://0.0.0.0:8765/) ...\n' }

    return { value: { code: 0, signal: null } }
  })
  const reply = await $.ui.mount({
    plugin: PLUGIN,
    surface: 'terminal',
    component: 'AssistantMessage',
    requestId: 'msg_2',
    props: { text: '```sh\npython3 -m http.server 8765\n```', isFirstOfReply: true },
  })
  await reply.press({ key: 'run-0' })

  expect((await reply.find({ type: 'Link' }))?.props).toMatchObject({ href: 'http://localhost:8765/' })
})

test('a start the engine would ask about is refused, and nothing runs', async ($, on) => {
  const kills: string[][] = []
  engine(on, kills, 'ask')
  let spawned = 0
  on('process.spawn', async function* () {
    spawned += 1
    return { value: { code: 0, signal: null } }
  })

  const started = await $.tool.call({ tool: 'mcp__nebula-ui__process_control', action: 'start', command: 'rm -rf build' })

  expect(started.deny).toContain('needs your approval')
  expect(spawned).toBe(0)
})

test('the follow button opens its pane under an id the engine accepts', async ($, on) => {
  const kills: string[][] = []
  const clock = engine(on, kills)
  on('process.spawn', async function* () {
    yield { stream: 'stdout' as const, text: 'tick\n' }

    return { value: { code: 0, signal: null } }
  })
  const started = await $.tool.call({ tool: 'mcp__nebula-ui__process_control', action: 'start', command: 'sleep 1' })
  const id = /Started (\w+)/.exec(String(started.result))?.[1] ?? ''
  await clock.settle()

  const procs = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', component: 'Pane', requestId: 'nebula-procs', props: pane() })
  await procs.press({ key: `follow-${id}` })

  expect(opened).toEqual([`nebula-proc-${id}`])
})

test("a process's color codes are stored as text, so the pane draws its output", async ($, on) => {
  const kills: string[][] = []
  const clock = engine(on, kills)
  on('process.spawn', async function* () {
    yield { stream: 'stdout' as const, text: '\u001b[32mready\u001b[0m in 12ms\n' }

    return { value: { code: 0, signal: null } }
  })
  await $.tool.call({ tool: 'mcp__nebula-ui__process_control', action: 'start', command: 'npm run dev' })
  await clock.settle()

  const procs = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', component: 'Pane', requestId: 'nebula-procs', props: pane() })
  const text = (await procs.findAll({ type: 'Text' })).map(one => one.text).join('\n')

  expect(text).toContain('ready in 12ms')
  expect(text).not.toContain('\u001b')
})
