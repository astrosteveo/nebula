import { expect, test } from 'claude-code/testing'

import { fitColumns, parse, width, wrapSpans, wrapText } from '../hooks/markdown'

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
