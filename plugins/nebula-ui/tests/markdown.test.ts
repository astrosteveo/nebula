import { expect, test } from 'claude-code/testing'

import { fitColumns, parse, width } from '../hooks/markdown'

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

  expect((await reply.find({ type: 'Text', text: 'Calls' }))?.props).toMatchObject({ color: 'permission' })
  expect((await reply.findAll({ type: 'Text', text: 'fast' })).some(one => one.props.weight === 'bold')).toBe(true)
  expect(await reply.find({ type: 'Text', text: /^╭─+┬─+┬─+╮$/ })).toBeDefined()
})

test('a table row is exactly as wide as its border', async $ => {
  const reply = await $.ui.mount({
    plugin: 'nebula-ui',
    surface: 'terminal',
    component: 'AssistantMessage',
    props: { text: TABLE, isFirstOfReply: false },
    viewport: { columns: 80, rows: 40 },
  })
  const top = (await reply.find({ type: 'Text', text: /^╭/ }))!.text
  const cells = (await reply.findAll({ type: 'Box' })).filter(box => typeof box.props.width === 'number' && box.props.position === 'relative')
  const header = cells.slice(0, 3).reduce((sum, box) => sum + (box.props.width as number), 0)

  expect(header).toBe([...top].length)
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
