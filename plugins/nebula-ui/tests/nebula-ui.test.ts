import { expect, mock, test } from 'claude-code/testing'

const PLUGIN = 'nebula-ui'

const bashRow = {
  tool_use_id: 'toolu_1',
  tool: 'Bash',
  input: { command: 'npm test\n  --watch' },
  isRunning: true,
  isErrored: false,
  isInterrupted: false,
}

const panel = {
  title: 'Nebula UI',
  isFocused: true,
  bodyColumns: 80,
  placement: 'inline' as const,
  scroll: { offset: 0, bodyRows: 20 },
  view: {},
}

test('a tool row shows the tool as a pill, the first line of its target and its status', async $ => {
  const row = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', component: 'ToolUse', props: bashRow })

  const line = (await row.find({ type: 'Button' }))?.text ?? ''
  expect(line).toContain('npm test')
  expect(line).not.toContain('--watch')
  expect(await row.find({ text: 'running' })).toBeDefined()
  expect(await row.find({ text: / Bash / })).toBeDefined()
})

test('the turn divider formats the duration', async $ => {
  const line = await $.ui.mount({
    plugin: PLUGIN,
    surface: 'terminal',
    component: 'TurnDuration',
    props: { word: 'Baked', durationMs: 64_000 },
  })

  expect(await line.find({ text: /Baked for 1m 4s/ })).toBeDefined()
})

test('the panel switches a part off and back on', async ($, on) => {
  mock.store(on)
  const pane = await $.ui.mount({
    plugin: PLUGIN,
    surface: 'terminal',
    component: 'Pane',
    requestId: 'nebula-ui',
    props: panel,
  })

  expect((await pane.find({ key: 'ToolUse' }))?.text).toContain('◉ Tool rows')

  await pane.press({ key: 'ToolUse' })
  expect((await pane.find({ key: 'ToolUse' }))?.text).toContain('○ Tool rows')

  await pane.press({ key: 'ToolUse' })
  expect((await pane.find({ key: 'ToolUse' }))?.text).toContain('◉ Tool rows')
})

test('a finished row opens on its chevron to show what the tool returned', async $ => {
  const row = await $.ui.mount({
    plugin: PLUGIN,
    surface: 'terminal',
    component: 'ToolUse',
    props: { ...bashRow, isRunning: false, output: { stdout: 'ok\nall good', stderr: '', interrupted: false } },
  })

  expect(await row.find({ type: 'Text', text: /▸ Bash/ })).toBeDefined()
  expect(await row.find({ type: 'Text', text: '2 lines' })).toBeDefined()
  expect(await row.find({ type: 'Code' })).toBeUndefined()

  await row.press({ key: 'open-toolu_1' })
  expect(await row.find({ type: 'Text', text: /▾ Bash/ })).toBeDefined()
  expect((await row.find({ type: 'Code' }))?.props).toMatchObject({ source: 'ok\nall good' })
})

test('a long target is trimmed so the whole row stays one clickable line', async $ => {
  const path = `/home/someone/${'deep/'.repeat(40)}file.ts`
  const row = await $.ui.mount({
    plugin: PLUGIN,
    surface: 'terminal',
    component: 'ToolUse',
    props: { ...bashRow, tool: 'Read', input: { file_path: path }, isRunning: false, output: undefined },
    viewport: { columns: 80, rows: 24 },
  })
  const line = (await row.find({ type: 'Button' }))?.text ?? ''

  expect([...line].length).toBeLessThanOrEqual(76)
  expect(line).toContain('/home/some')
  expect(line).toContain('…')
  expect(line).toContain('file.ts')
})
