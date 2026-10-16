import { expect, mock, test } from 'claude-code/testing'

import {
  cellWidth,
  colorRuns,
  commandOf,
  fenceCommand,
  fitColumns,
  linkCommands,
  parse,
  width,
  wrapSpans,
  wrapText,
} from '../hooks/markdown'

const REPLY = [
  '# Plan',
  '',
  'Some **bold** prose.',
  '',
  '```ts',
  'const a = 1',
  '```',
  '',
  '> [!WARNING]',
  '> Mind the gap.',
  '',
  '> a plain quote',
  '',
  '---',
  '',
  '- a list',
  '  ```sh',
  '  nested fence stays with the list',
  '  ```',
].join('\n')

test('a reply splits into the blocks nebula-ui draws and prose the engine draws', async () => {
  expect(parse(REPLY)).toEqual([
    { kind: 'heading', level: 1, text: 'Plan' },
    { kind: 'prose', text: 'Some **bold** prose.' },
    { kind: 'code', language: 'ts', source: 'const a = 1', isOpen: false },
    { kind: 'quote', callout: 'warning', title: '', text: 'Mind the gap.' },
    { kind: 'quote', callout: null, title: '', text: 'a plain quote' },
    { kind: 'rule' },
    { kind: 'prose', text: '- a list\n  ```sh\n  nested fence stays with the list\n  ```' },
  ])
})

test('a fence still streaming is code to the end', async () => {
  expect(parse('```diff\n-a\n+b')).toEqual([{ kind: 'code', language: 'diff', source: '-a\n+b', isOpen: true }])
})

test('a reply draws its fence as highlighted Code and its prose as Markdown', async $ => {
  const reply = await $.ui.mount({
    plugin: 'nebula-ui',
    surface: 'terminal',
    component: 'AssistantMessage',
    props: { text: REPLY, isFirstOfReply: true },
  })

  expect((await reply.find({ type: 'Code' }))?.props).toMatchObject({ source: 'const a = 1', language: 'ts' })
  expect(await reply.find({ type: 'Markdown', text: /Some \*\*bold\*\* prose/ })).toBeDefined()
  expect(await reply.find({ type: 'Text', text: /▲ Warning/ })).toBeDefined()
})

const TABLE = ['| Part | Calls | Note |', '|:-----|------|:----:|', '| `Read` | 12 | **fast** |', '| Bash \\| sh | 3 | slow |'].join('\n')

test('a table keeps its cells, escaped pipes and alignment, and right-aligns numbers', async () => {
  expect(parse(TABLE)).toEqual([
    {
      kind: 'table',
      align: ['left', 'right', 'center'],
      header: ['Part', 'Calls', 'Note'],
      rows: [
        ['`Read`', '12', '**fast**'],
        ['Bash | sh', '3', 'slow'],
      ],
    },
  ])
})

test('inline markers are measured as drawn, and wide columns shrink to fit', async () => {
  expect(width('`Read` and **bold**')).toBe(13)
  expect(fitColumns([40, 10, 4], 30)).toEqual([16, 10, 4])
})

test('a table draws its header in the accent color, cells styled inline', async $ => {
  const reply = await $.ui.mount({
    plugin: 'nebula-ui',
    surface: 'terminal',
    component: 'AssistantMessage',
    props: { text: TABLE, isFirstOfReply: false },
    viewport: { columns: 80, rows: 40 },
  })

  const calls = await reply.findAll({ type: 'Text', text: 'Calls' })
  expect(calls.some(one => one.text === 'Calls' && one.props.color === 'permission')).toBe(true)
  expect((await reply.findAll({ type: 'Text', text: 'fast' })).some(one => one.props.weight === 'bold')).toBe(true)
  expect(await reply.find({ type: 'Text', text: /^╭─+┬─+┬─+╮$/ })).toBeDefined()
})

test('every line of a table is exactly as wide as its border, wrapped cells included', async $ => {
  const wide = ['| Part | Note |', '|---|---|', `| a | ${'word '.repeat(30)}|`, '| b | short |'].join('\n')
  const reply = await $.ui.mount({
    plugin: 'nebula-ui',
    surface: 'terminal',
    component: 'AssistantMessage',
    props: { text: wide, isFirstOfReply: false },
    viewport: { columns: 60, rows: 40 },
  })
  const drawn = (await reply.findAll({ type: 'Text', text: /^[╭│├╰]/ })).filter(one => one.text.length > 1 && /[╮│┤╯]$/.test(one.text))
  const widths = new Set(drawn.map(one => [...one.text].length))

  expect(drawn.length).toBeGreaterThan(5)
  expect(widths.size).toBe(1)
  expect([...widths][0]).toBeLessThanOrEqual(56)
})

test('a short code frame names no length, a long one does', async $ => {
  const short = await $.ui.mount({
    plugin: 'nebula-ui',
    surface: 'terminal',
    component: 'AssistantMessage',
    props: { text: '```ts\nconst a = 1\n```', isFirstOfReply: false },
  })
  const long = await $.ui.mount({
    plugin: 'nebula-ui',
    surface: 'terminal',
    component: 'AssistantMessage',
    props: { text: '```ts\n1\n2\n3\n4\n5\n6\n```', isFirstOfReply: false },
  })

  expect(await short.find({ type: 'Text', text: /line/ })).toBeUndefined()
  expect(await long.find({ type: 'Text', text: /6 lines/ })).toBeDefined()
})

test("wrapping keeps styles across breaks, a line's indentation, and cuts a word longer than a row", async () => {
  expect(wrapSpans([{ text: 'one two three', style: 'bold' }], 8)).toEqual([
    [{ text: 'one two', style: 'bold' }],
    [{ text: 'three', style: 'bold' }],
  ])
  expect(wrapText('  - nested item', 40)).toEqual([[{ text: '  - nested item', style: 'plain' }]])
  expect(wrapSpans([{ text: 'abcdefghij', style: 'plain' }], 4).map(row => row[0]?.text)).toEqual(['abcd', 'efgh', 'ij'])
  expect(wrapText('see `code` here', 40)).toEqual([
    [
      { text: 'see ', style: 'plain' },
      { text: 'code', style: 'code' },
      { text: ' here', style: 'plain' },
    ],
  ])
})

test('a prompt and a quote are drawn as rows of text, one bar glyph each, nothing placed absolutely', async $ => {
  const prompt = await $.ui.mount({
    plugin: 'nebula-ui',
    surface: 'terminal',
    component: 'UserMessage',
    props: { text: `${'word '.repeat(30)}\nsecond line`, origin: { kind: 'composer' }, isExpanded: true },
    viewport: { columns: 40, rows: 24 },
  })
  const rows = await prompt.findAll({ type: 'Text', text: /^▌ / })
  const boxes = await prompt.findAll({ type: 'Box' })

  expect(rows.length).toBeGreaterThanOrEqual(5)
  expect(rows.every(row => [...row.text].length <= 40)).toBe(true)
  expect(boxes.some(box => box.props.position === 'absolute')).toBe(false)
})

test('inline code reads as a command only when it would run something', async () => {
  expect(commandOf('/reload-plugins')).toEqual({ kind: 'slash', text: '/reload-plugins' })
  expect(commandOf('/plugin install nebula-ui@nebula')).toMatchObject({ kind: 'slash' })
  expect(commandOf('! gcloud auth login')).toEqual({ kind: 'bang', text: '!gcloud auth login' })
  expect(commandOf('claude --plugin-dir plugins/nebula-ui')).toMatchObject({ kind: 'shell' })
  expect(commandOf('/home/astrosteveo/Projects')).toBeNull()
  expect(commandOf('plugins/nebula-ui')).toBeNull()
  expect(commandOf('git')).toBeNull()
  expect(commandOf('0.1.6')).toBeNull()
  expect(commandOf('sleep 30 && echo done')).toMatchObject({ kind: 'shell' })
  expect(commandOf('mytool --watch src')).toMatchObject({ kind: 'shell' })
  expect(commandOf('ship it')).toBeNull()
  expect(commandOf('fit(text, 60, false)')).toBeNull()
  expect(commandOf('Run the tests')).toBeNull()
})

test('prose links its commands and leaves other code, and code in links, as written', async () => {
  const { text, commands } = linkCommands('Run `/reload-plugins`, then `git status` in `plugins/nebula-ui` or [`/x`](https://a.b).')

  expect(text).toBe(
    'Run [`/reload-plugins`](https://nebula-ui.invalid/command/0), then [`git status`](https://nebula-ui.invalid/command/1) in `plugins/nebula-ui` or [`/x`](https://a.b).',
  )
  expect([...commands.values()].map(command => command.kind)).toEqual(['slash', 'shell'])
})

test('the frame width setting fills, fits or holds code frames to a width', async ($, on) => {
  mock.store(on)
  const panel = await $.ui.mount({
    plugin: 'nebula-ui',
    surface: 'terminal',
    component: 'Pane',
    requestId: 'nebula-ui',
    props: { title: 'Nebula UI', isFocused: true, bodyColumns: 80, placement: 'inline', scroll: { offset: 0, bodyRows: 20 }, view: {} },
  })
  const frameOf = async () => {
    const reply = await $.ui.mount({
      plugin: 'nebula-ui',
      surface: 'terminal',
      component: 'AssistantMessage',
      props: { text: '```ts\nconst a = 1\n```', isFirstOfReply: false },
      viewport: { columns: 120, rows: 40 },
    })

    return (await reply.findAll({ type: 'Box' })).find(box => box.props.flexDirection === 'column-reverse')?.props
  }

  expect(await frameOf()).not.toHaveProperty('width')
  expect((await panel.find({ key: 'frame-width' }))?.text).toContain('Frame width fill')

  await panel.press({ key: 'frame-width' })
  expect(await frameOf()).toMatchObject({ alignSelf: 'flex-start' })

  await panel.press({ key: 'frame-width' })
  expect(await frameOf()).toMatchObject({ width: 80 })
  expect((await panel.find({ key: 'frame-width' }))?.text).toContain('Frame width 80')
})

test('a fence runs when it holds commands, as one script, and a lone slash command goes to the prompt', async () => {
  expect(fenceCommand('sh', 'python3 -m http.server 8765')).toEqual({ kind: 'shell', text: 'python3 -m http.server 8765' })
  expect(fenceCommand('console', '$ npm install\n# then\n$ npm run dev')).toEqual({ kind: 'shell', text: 'npm install\n# then\nnpm run dev' })
  expect(fenceCommand('', 'git fetch\ngit rebase origin/main')).toMatchObject({ kind: 'shell' })
  expect(fenceCommand('', '/plugin install nebula-ui@nebula')).toEqual({ kind: 'slash', text: '/plugin install nebula-ui@nebula' })
  expect(fenceCommand('ts', 'const a = 1')).toBeNull()
  expect(fenceCommand('', 'some plain notes')).toBeNull()
})

test('wide glyphs take two cells, so a table with them keeps its border', async $ => {
  expect(cellWidth('日本語🚀✅')).toBe(10)
  expect(cellWidth('👨‍👩‍👧')).toBe(2)
  const reply = await $.ui.mount({
    plugin: 'nebula-ui',
    surface: 'terminal',
    component: 'AssistantMessage',
    props: { text: '| Name | Note |\n|---|---|\n| 日本語 🚀 | ok |\n| plain | ✅ |', isFirstOfReply: false },
    viewport: { columns: 60, rows: 40 },
  })
  const drawn = (await reply.findAll({ type: 'Text', text: /^[╭│├╰]/ })).filter(one => one.text.length > 1 && /[╮│┤╯]$/.test(one.text))
  const widths = new Set(drawn.map(one => cellWidth(one.text)))

  expect(drawn.length).toBeGreaterThan(3)
  expect(widths.size).toBe(1)
})

test('a table too wide for its columns is drawn a record at a time, not cut at the edge', async $ => {
  const wide = '| a | b | c | d | e | f | g | h |\n|---|---|---|---|---|---|---|---|\n| 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 |'
  const reply = await $.ui.mount({
    plugin: 'nebula-ui',
    surface: 'terminal',
    component: 'AssistantMessage',
    props: { text: wide, isFirstOfReply: false },
    viewport: { columns: 30, rows: 40 },
  })

  expect(await reply.find({ type: 'Text', text: /^╭/ })).toBeUndefined()
  expect(await reply.find({ type: 'Text', text: /^a: 1$/ })).toBeDefined()
})

test('a fence closes on its own marker, a CRLF reply reads as an LF one, a lone backtick stays a character', async () => {
  expect(parse('```md\n```python\nprint(1)\n```')).toEqual([{ kind: 'code', language: 'md', source: '```python\nprint(1)', isOpen: false }])
  expect(parse('```sh\r\necho hi\r\n```')).toEqual([{ kind: 'code', language: 'sh', source: 'echo hi', isOpen: false }])
  expect(parse('| a | b |\n|---|---|\n| don`t | yes |')).toEqual([
    { kind: 'table', align: ['left', 'left'], header: ['a', 'b'], rows: [['don`t', 'yes']] },
  ])
})

test('a shell fence runs as it is shown: comments and blank lines kept, prompts dropped', async () => {
  expect(fenceCommand('sh', "cat > notes.md <<'EOF'\n# Notes\n\nhello\nEOF")).toEqual({
    kind: 'shell',
    text: "cat > notes.md <<'EOF'\n# Notes\n\nhello\nEOF",
  })
})

test('a shell command with environment assignments reads as the command, a phrase in a sentence does not', async () => {
  expect(commandOf('NODE_ENV=production npm run build')).toEqual({ kind: 'shell', text: 'NODE_ENV=production npm run build' })
  expect(commandOf('find . -name "*.ts"')).toMatchObject({ kind: 'shell' })
  expect(commandOf('export NODE_ENV=production')).toMatchObject({ kind: 'shell' })
  expect(commandOf('find the bug')).toBeNull()
  expect(commandOf('export const')).toBeNull()
})

test('a line of output reads its color codes as styles and drops the other escape codes', async () => {
  expect(colorRuns('\u001b[31mred\u001b[0m plain')).toEqual([{ color: 'error', text: 'red' }, { text: ' plain' }])
  expect(colorRuns('\u001b[1mbold\u001b[22m\u001b[2K gone')).toEqual([
    { bold: true, text: 'bold' },
    { bold: false, dim: false, text: ' gone' },
  ])
})

test('a blank line of a code frame keeps its place, a shell command in prose also runs from a button', async $ => {
  const code = await $.ui.mount({
    plugin: 'nebula-ui',
    surface: 'terminal',
    component: 'AssistantMessage',
    props: { text: '```ts\na\n\nb\n```', isFirstOfReply: false },
  })
  expect((await code.find({ type: 'Code' }))?.props).toMatchObject({ source: 'a\n \nb' })

  const prose = await $.ui.mount({
    plugin: 'nebula-ui',
    surface: 'terminal',
    component: 'AssistantMessage',
    props: { text: 'Run `npm test` before you push.', isFirstOfReply: false },
  })
  expect(await prose.find({ type: 'Button', text: /▶ npm test/ })).toBeDefined()
})
