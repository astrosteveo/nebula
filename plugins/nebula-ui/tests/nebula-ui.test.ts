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

test('a finished Bash row starts open on what it printed, and a click closes it', async $ => {
  const row = await $.ui.mount({
    plugin: PLUGIN,
    surface: 'terminal',
    component: 'ToolUse',
    props: { ...bashRow, isRunning: false, output: { stdout: 'ok\nall good', stderr: '', interrupted: false } },
  })

  expect(await row.find({ type: 'Text', text: /▾ Bash/ })).toBeDefined()
  expect(await row.find({ type: 'Text', text: 'all good' })).toBeDefined()
  expect((await row.find({ type: 'Button' }))?.text).not.toContain('2 lines')

  await row.press({ key: 'open-toolu_1' })
  expect(await row.find({ type: 'Text', text: /▸ Bash/ })).toBeDefined()
  expect(await row.find({ type: 'Code' })).toBeUndefined()
  expect((await row.find({ type: 'Button' }))?.text).toContain('2 lines')
})

test('with Open shell output off, a Bash row starts closed', async ($, on) => {
  mock.store(on)
  const pane = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', component: 'Pane', requestId: 'nebula-ui', props: panel })
  await pane.press({ key: 'ShellOpen' })
  const row = await $.ui.mount({
    plugin: PLUGIN,
    surface: 'terminal',
    component: 'ToolUse',
    props: { ...bashRow, tool_use_id: 'toolu_9', isRunning: false, output: { stdout: 'ok', stderr: '', interrupted: false } },
  })

  expect(await row.find({ type: 'Text', text: /▸ Bash/ })).toBeDefined()
  expect(await row.find({ type: 'Code' })).toBeUndefined()
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

test('a slash command echo gets the prompt bar, the command in the accent color', async $ => {
  const row = await $.ui.mount({
    plugin: PLUGIN,
    surface: 'terminal',
    component: 'UserMessage',
    props: { text: '/plugin install nebula-ui', origin: { kind: 'unclassified' }, isExpanded: true },
  })

  const runs = await row.findAll({ type: 'Text', text: '/plugin' })
  expect(runs.some(run => run.text === '/plugin' && run.props.color === 'permission')).toBe(true)
  expect(await row.find({ type: 'Text', text: /▌/ })).toBeDefined()
})

test('a teammate message is left to the engine', async $ => {
  const mount = $.ui.mount({
    plugin: PLUGIN,
    surface: 'terminal',
    component: 'UserMessage',
    props: { text: 'hi', origin: { kind: 'peer' }, isExpanded: false, from: { name: 'reviewer' } },
  })

  await expect(mount).rejects.toThrow(/no implementation for ui.render/)
})

test('a command prints behind an accent bar, an error behind a red one', async $ => {
  const props = { command: 'reload-plugins', args: '', text: 'Reloaded: 5 plugins', isErrored: false }
  const done = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', component: 'CommandOutput', props })

  expect(await done.find({ type: 'Text', text: /Reloaded: 5 plugins/ })).toBeDefined()
  const mark = async (row: typeof done) => (await row.findAll({ type: 'Text', text: '▎ ' })).find(one => one.text === '▎ ')
  expect((await mark(done))?.props).toMatchObject({ color: 'permission' })
  expect(await done.find({ type: 'Text', text: /✗/ })).toBeUndefined()

  const failed = await $.ui.mount({
    plugin: PLUGIN,
    surface: 'terminal',
    component: 'CommandOutput',
    props: { ...props, text: 'No such plugin', isErrored: true },
  })

  expect((await mark(failed))?.props).toMatchObject({ color: 'error' })
  expect(await failed.find({ type: 'Text', text: /✗ failed/ })).toBeDefined()
})

test('a Bash row leaves out where the command runs and shows what it does', async $ => {
  const row = await $.ui.mount({
    plugin: PLUGIN,
    surface: 'terminal',
    component: 'ToolUse',
    props: { ...bashRow, input: { command: 'M=/tmp/mod; cd "$M" && claude plugin test .' } },
    viewport: { columns: 120, rows: 24 },
  })
  const line = (await row.find({ type: 'Button' }))?.text ?? ''

  expect(line).toContain('claude plugin test .')
  expect(line).not.toContain('cd ')
  expect(line).not.toContain('M=')
})

const edited = {
  stdout: 'tsc=0',
  stderr: '',
  interrupted: false,
  bashEditDiff: {
    files: [
      {
        filePath: '/repo/hooks/register.tsx',
        hunks: [{ oldStart: 3, oldLines: 1, newStart: 3, newLines: 2, lines: ['-const a = 1', '+// why', '+const a = 2'] }],
      },
    ],
    moreFiles: 0,
  },
}

test('a result block keeps only what the row cannot say, and a click on it opens the row', async ($, on) => {
  mock.store(on)
  const pane = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', component: 'Pane', requestId: 'nebula-ui', props: panel })
  await pane.press({ key: 'ShellOpen' })
  const quiet = await $.ui.mount({
    plugin: PLUGIN,
    surface: 'terminal',
    component: 'ToolResult',
    props: { tool_use_id: 'toolu_2', tool: 'Bash', output: { stdout: 'ok', stderr: '', interrupted: false }, isErrored: false },
  })
  expect(await quiet.find({ type: 'Text' })).toBeUndefined()

  const changed = await $.ui.mount({
    plugin: PLUGIN,
    surface: 'terminal',
    component: 'ToolResult',
    props: { tool_use_id: 'toolu_3', tool: 'Bash', output: edited, isErrored: false },
  })
  expect((await changed.find({ type: 'Button' }))?.text).toContain('± register.tsx +2 −1')

  await changed.press({ key: 'result-toolu_3' })
  expect(await changed.find({ type: 'Button' })).toBeUndefined()
})

test('an opened Bash row shows each file it changed as a diff', async $ => {
  const row = await $.ui.mount({
    plugin: PLUGIN,
    surface: 'terminal',
    component: 'ToolUse',
    props: { ...bashRow, tool_use_id: 'toolu_4', isRunning: false, output: edited },
  })
  const codes = await row.findAll({ type: 'Code' })

  expect(await row.find({ type: 'Text', text: 'tsc=0' })).toBeDefined()
  expect(codes.map(code => code.props.format)).toEqual(['diff'])
  expect(codes[0]?.props.source).toBe('@@ -3,1 +3,2 @@\n-const a = 1\n+// why\n+const a = 2')
})

test('an opened Bash row leaves out the notes the engine adds to stderr', async $ => {
  const row = await $.ui.mount({
    plugin: PLUGIN,
    surface: 'terminal',
    component: 'ToolUse',
    props: {
      ...bashRow,
      tool_use_id: 'toolu_5',
      isRunning: false,
      output: { stdout: 'done', stderr: '\nShell cwd was reset to /repo', interrupted: false },
    },
  })

  expect(await row.find({ type: 'Text', text: /stderr/ })).toBeUndefined()
  expect(await row.find({ type: 'Text', text: /cwd was reset/ })).toBeUndefined()
})

test('a search row says what it found and opens on the files, not JSON', async $ => {
  const row = await $.ui.mount({
    plugin: PLUGIN,
    surface: 'terminal',
    component: 'ToolUse',
    props: {
      ...bashRow,
      tool_use_id: 'toolu_6',
      tool: 'Glob',
      input: { pattern: '**/*.ts' },
      isRunning: false,
      output: { filenames: ['a.ts', 'b.ts', 'c.ts'], numFiles: 3, durationMs: 4, truncated: false },
    },
  })
  expect((await row.find({ type: 'Button' }))?.text).toContain('3 files')

  await row.press({ key: 'open-toolu_6' })
  expect((await row.find({ type: 'Code' }))?.props).toMatchObject({ source: 'a.ts\nb.ts\nc.ts' })
})

test("an MCP tool's text result opens as markdown", async $ => {
  const row = await $.ui.mount({
    plugin: PLUGIN,
    surface: 'terminal',
    component: 'ToolUse',
    props: {
      ...bashRow,
      tool_use_id: 'toolu_7',
      tool: 'mcp__docs__read',
      input: { id: 'abc' },
      isRunning: false,
      output: [{ type: 'text', text: '# Title\nBody' }],
    },
  })
  await row.press({ key: 'open-toolu_7' })

  expect((await row.find({ type: 'Markdown' }))?.props).toMatchObject({ text: '# Title\nBody' })
})

test("an Agent's result block is left to the engine", async $ => {
  const mount = $.ui.mount({
    plugin: PLUGIN,
    surface: 'terminal',
    component: 'ToolResult',
    props: { tool_use_id: 'toolu_8', tool: 'Agent', output: { content: [{ type: 'text', text: 'done' }] }, isErrored: false },
  })

  await expect(mount).rejects.toThrow(/no implementation for ui.render/)
})

test('a tool error printed in color draws as plain text', async $ => {
  const row = await $.ui.mount({
    plugin: PLUGIN,
    surface: 'terminal',
    component: 'ToolUse',
    props: {
      ...bashRow,
      tool_use_id: 'toolu_10',
      isRunning: false,
      isErrored: true,
      output: 'Exit code 1\n\u001b[31m[bat error]\u001b[0m: missing.md: No such file\r\n',
    },
  })
  const drawn = (await row.findAll({ type: 'Text' })).map(one => one.text).join('\n')

  expect(drawn).toContain('[bat error]: missing.md: No such file')
  expect(drawn).not.toMatch(/[\u0000-\u0008\u000b-\u001f]/)
})

test('a click on a slash command in a reply fills the prompt; a shell command asks to run or copy', async ($, on) => {
  let filled = ''
  let copied = ''
  const opened: string[] = []
  on('prompt.read', () => ({ value: { text: '', cursor: 0 } }))
  on('prompt.fill', ($, e) => {
    filled = e.text

    return { isFilled: true }
  })
  on('ui.copy', ($, e) => {
    copied = e.text

    return { value: { isCopied: true } }
  })
  on('ui.open', ($, e) => {
    opened.push(e.id)

    return { value: { isPlaced: true } }
  })
  on('ui.close', () => ({ value: undefined }))
  on('ui.toast', () => ({ value: undefined }))
  on('session.cwd', () => ({ value: '/repo' }))
  const reply = await $.ui.mount({
    plugin: PLUGIN,
    surface: 'terminal',
    component: 'AssistantMessage',
    props: { text: 'Run `/reload-plugins`, or `npm run dev` to serve it.', isFirstOfReply: true },
  })
  const prose = await reply.find({ type: 'Markdown' })
  expect(prose?.props.pressableLinks).toEqual(['https://nebula-ui.invalid/command/0', 'https://nebula-ui.invalid/command/1'])

  await reply.press({ key: 'commands-0', link: { href: 'https://nebula-ui.invalid/command/0' } })
  expect(filled).toBe('/reload-plugins')

  await reply.press({ key: 'commands-0', link: { href: 'https://nebula-ui.invalid/command/1' } })
  expect(opened).toEqual(['nebula-run'])
  expect(copied).toBe('')

  const dialog = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', component: 'Pane', requestId: 'nebula-run', props: panel })
  expect(await dialog.find({ type: 'Text', text: /\$ npm run dev/ })).toBeDefined()

  await dialog.press({ key: 'copy' })
  expect(copied).toBe('npm run dev')
})

test('the accent preset recolors what nebula-ui draws, tables built at load included', async ($, on) => {
  mock.store(on)
  const pane = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', component: 'Pane', requestId: 'nebula-ui', props: panel })
  const barColor = async () => {
    const row = await $.ui.mount({
      plugin: PLUGIN,
      surface: 'terminal',
      component: 'UserMessage',
      props: { text: 'hi', origin: { kind: 'composer' }, isExpanded: true },
    })

    return (await row.findAll({ type: 'Text', text: '▌ ' })).find(one => one.text === '▌ ')?.props.color
  }

  expect(await barColor()).toBe('permission')
  expect((await pane.find({ key: 'theme' }))?.text).toContain('Accent terminal')

  await pane.press({ key: 'theme' })
  expect((await pane.find({ key: 'theme' }))?.text).toContain('Accent claude')
  expect(await barColor()).toBe('claude')

  await pane.press({ key: 'theme' })
  expect((await pane.find({ key: 'theme' }))?.text).toContain('Accent nebula')
  expect(await barColor()).toBe('#b4befe')

  const callout = await $.ui.mount({
    plugin: PLUGIN,
    surface: 'terminal',
    component: 'AssistantMessage',
    props: { text: '> [!IMPORTANT]\n> Read this.', isFirstOfReply: false },
  })
  const titles = await callout.findAll({ type: 'Text', text: /◆ Important/ })
  expect(titles.some(one => one.props.color === '#b4befe')).toBe(true)
})

test("a command's colored output draws its text, not a refusal", async $ => {
  const done = await $.ui.mount({
    plugin: PLUGIN,
    surface: 'terminal',
    component: 'CommandOutput',
    props: { command: 'context', args: '', text: '\u001b[31mred\u001b[0m used', isErrored: false },
  })

  expect(await done.find({ type: 'Text', text: /red/ })).toBeDefined()
  expect(await done.find({ type: 'Text', text: /refused/ })).toBeUndefined()
})
