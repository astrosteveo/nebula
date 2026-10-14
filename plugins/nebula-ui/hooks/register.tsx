import { atom, read, update } from 'claude-code'
import type { Elements, EngineInterface, Register, RenderChildren } from 'claude-code'

import type { Dash, Disabled } from '../types'
import { fitColumns, parse, rowWidth, spans, width, wrapSpans, wrapText } from './markdown'
import type { Block, Callout, Span } from './markdown'
import { drawBand, gather } from './dashboard'
import { ACCENT } from './theme'

const PANEL = 'nebula-ui'

const disabled = atom({ plugin: 'nebula-ui', key: 'disabled' } as const, [] as Disabled)
const dash = atom({ plugin: 'nebula-ui', key: 'dash' } as const, null as Dash | null)

const SITES = [
  { id: 'UserMessage', label: 'Prompt bar', about: 'your prompts behind an accent bar' },
  { id: 'AssistantMessage', label: 'Rich markdown', about: 'framed code and tables, headings, callouts' },
  { id: 'ToolUse', label: 'Tool rows', about: 'tool pills; click ▸ to open the output' },
  { id: 'ToolGroup', label: 'Explore groups', about: 'folded reads and searches; click ▸ to unfold' },
  { id: 'Spinner', label: 'Spinner', about: 'a pill saying what the turn is doing' },
  { id: 'TurnDuration', label: 'Turn divider', about: 'a rule at the end of each turn' },
  { id: 'InfoNotice', label: 'Notices', about: 'startup notices with an icon' },
  { id: 'SessionMode', label: 'Mode chips', about: 'footer modes as chips' },
  { id: 'PromptHint', label: 'Hint tail', about: 'a /nebula mark in the hint line' },
  { id: 'ToolProgress', label: 'Background hint', about: 'a compact ctrl+b hint' },
  { id: 'AbovePrompt', label: 'Dashboard band', about: 'model, branch, context, limits, cost above the prompt' },
  { id: 'CommandOutput', label: 'Command output', about: 'what a slash command printed, behind an accent bar' },
  { id: 'CommandMenu', label: 'Command menu', about: 'a glyph per command: ◆ built-in, ◇ plugin, ✦ nebula-ui' },
] as const

type Site = (typeof SITES)[number]['id']

/** The panel's keys, one per part, in order. */
const HOTKEYS = '1234567890abcdefghij'
const isOn = async ($: EngineInterface, site: Site) => !(await read($, disabled)).includes(site)

const toggle = async ($: EngineInterface, site: Site) => {
  const list = await update($, disabled, off =>
    off.includes(site) ? off.filter(one => one !== site) : [...off, site],
  )
  await $.store.set('disabled', list)
  if (site === 'CommandMenu') {
    // The engine keeps each command's listing for the session; this asks it to list them again.
    await $.ui.invalidate('command.describe')
  }
}

/** What the engine's spinner draws in place of its word, which nebula-ui draws in a pill. */
const BLANK_WORD = '\u00a0'

/** The pill before the spinner line: what the turn is doing, by the spinner's mode. */
const SPINNER_MODES = {
  requesting: { glyph: '⇅', label: 'connecting', color: 'inactive' },
  responding: { glyph: '✎', label: 'writing', color: 'success' },
  thinking: { glyph: '✦', label: 'thinking', color: ACCENT },
  'tool-input': { glyph: '⋯', label: 'preparing', color: 'suggestion' },
  'tool-use': { glyph: '⚙', label: 'running tools', color: 'suggestion' },
} as const

const NOUNS: Record<string, [string, string]> = {
  Read: ['read', 'reads'],
  Grep: ['search', 'searches'],
  Glob: ['search', 'searches'],
  LS: ['listing', 'listings'],
  Bash: ['command', 'commands'],
  WebFetch: ['fetch', 'fetches'],
  WebSearch: ['web search', 'web searches'],
}

const TARGETS: Record<string, string> = {
  Bash: 'command',
  Read: 'file_path',
  Edit: 'file_path',
  Write: 'file_path',
  NotebookEdit: 'notebook_path',
  Grep: 'pattern',
  Glob: 'pattern',
  WebFetch: 'url',
  WebSearch: 'query',
  Agent: 'description',
  Skill: 'skill',
  ToolSearch: 'query',
}

const PATHLIKE = new Set(['Read', 'Edit', 'Write', 'NotebookEdit', 'WebFetch'])

const oneLine = (text: string) => text.split('\n')[0]!.replace(/\s+/g, ' ').trim()

/** What the call acts on, in one line: Bash's command, Read's path, a search's pattern. */
/** Leading `cd dir &&`, `cd dir;` and `NAME=value;` steps, which say where a command runs, not what it does. */
const PREAMBLE = /^(?:cd\s+(?:"[^"]*"|'[^']*'|\S+)\s*(?:&&|;)\s*|[A-Za-z_][A-Za-z0-9_]*=(?:"[^"]*"|'[^']*'|\S*)\s*;\s*)+/

/** A shell command without its preamble, or as written when the preamble is all there is. */
const withoutPreamble = (command: string) => command.replace(PREAMBLE, '') || command

const describe = (tool: string, input: unknown): string => {
  if (typeof input !== 'object' || input === null) {
    return ''
  }
  const fields = input as Record<string, unknown>
  const named = TARGETS[tool]
  const value = named === undefined ? Object.values(fields).find(one => typeof one === 'string') : fields[named]

  if (typeof value !== 'string') {
    return ''
  }

  return tool === 'Bash' ? withoutPreamble(oneLine(value)) : oneLine(value)
}

/** `mcp__server__tool` as `server · tool`; a built-in as itself. */
const toolName = (tool: string) => {
  const [prefix, server, ...rest] = tool.split('__')

  return prefix === 'mcp' && server !== undefined && rest.length > 0 ? `${server} · ${rest.join('__')}` : tool
}

const tally = (calls: ReadonlyArray<{ tool: string }>) => {
  const counts = new Map<string, { n: number; nouns: [string, string] }>()
  for (const call of calls) {
    const nouns = NOUNS[call.tool] ?? [`${call.tool} call`, `${call.tool} calls`]
    const key = nouns[0]
    const seen = counts.get(key)
    counts.set(key, { n: (seen?.n ?? 0) + 1, nouns })
  }

  return [...counts.values()].map(({ n, nouns }) => `${n} ${n === 1 ? nouns[0] : nouns[1]}`).join(' · ')
}

const duration = (ms: number) => {
  const total = Math.max(0, Math.round(ms / 1000))
  const hours = Math.floor(total / 3600)
  const minutes = Math.floor((total % 3600) / 60)
  const seconds = total % 60
  if (hours > 0) {
    return `${hours}h ${minutes}m`
  }

  return minutes > 0 ? `${minutes}m ${seconds}s` : `${seconds}s`
}

const CALLOUTS: Record<Callout, { glyph: string; color: string; title: string }> = {
  note: { glyph: 'ℹ', color: 'suggestion', title: 'Note' },
  tip: { glyph: '✦', color: 'success', title: 'Tip' },
  important: { glyph: '◆', color: ACCENT, title: 'Important' },
  warning: { glyph: '▲', color: 'warning', title: 'Warning' },
  caution: { glyph: '✗', color: 'error', title: 'Caution' },
}

const HEADINGS = ['◆', '◇', '›']


const expanded = { plugin: 'nebula-ui', key: 'expanded' } as const

/** Tools whose result the engine draws under the row as the point of the call (a diff, a plan, a subagent's answer): no expander. */
const ENGINE_RESULTS = new Set([
  'Edit',
  'Write',
  'NotebookEdit',
  'MultiEdit',
  'TodoWrite',
  'Agent',
  'Task',
  'AskUserQuestion',
  'ExitPlanMode',
  'EnterPlanMode',
])

/** Lines an opened tool row shows before it says how many more there are. */
const DETAIL_LINES = 40

type Ui = Elements['terminal']

const plural = (n: number, word: string) => `${n} ${n === 1 ? word : `${word}s`}`

/** The fewest lines a code frame names its length for; a shorter one is read at a glance. */
const LINE_COUNT_FROM = 5

const lineCount = (source: string) => plural(source === '' ? 0 : source.split('\n').length, 'line')

/** The first `DETAIL_LINES` lines of `text`, and a note naming how many were left out. */
const clip = (text: string) => {
  const lines = text.replace(/\n+$/, '').split('\n')
  const hidden = lines.length - DETAIL_LINES

  return {
    text: lines.slice(0, DETAIL_LINES).join('\n'),
    note: hidden > 0 ? `${plural(hidden, 'more line')}` : lineCount(lines.join('\n')),
  }
}

const field = (value: unknown, key: string): unknown =>
  typeof value === 'object' && value !== null ? (value as Record<string, unknown>)[key] : undefined

const text = (value: unknown) => (typeof value === 'string' ? value : '')

type EditedFile = { path: string; diff: string; added: number; removed: number }

/** The files a Bash command changed, as the engine recorded them (`bashEditDiff`), each as a unified diff. */
const editedFiles = (output: unknown): EditedFile[] => {
  const files = field(field(output, 'bashEditDiff'), 'files')
  if (!Array.isArray(files)) {
    return []
  }

  return files.flatMap(file => {
    const path = text(field(file, 'filePath'))
    const hunks = field(file, 'hunks')
    if (path === '' || !Array.isArray(hunks)) {
      return []
    }
    const lines = hunks.flatMap(hunk => {
      const at = (key: string) => Number(field(hunk, key) ?? 0)
      const body = field(hunk, 'lines')

      return [
        `@@ -${at('oldStart')},${at('oldLines')} +${at('newStart')},${at('newLines')} @@`,
        ...(Array.isArray(body) ? body.map(String) : []),
      ]
    })
    const body = lines.filter(line => !line.startsWith('@@'))

    return [
      {
        path,
        diff: lines.join('\n'),
        added: body.filter(line => line.startsWith('+')).length,
        removed: body.filter(line => line.startsWith('-')).length,
      },
    ]
  })
}

const basename = (path: string) => path.split('/').pop() ?? path

const changeNote = (file: EditedFile) => `${basename(file.path)} +${file.added} −${file.removed}`

/** Lines the engine adds to a command's stderr about itself (`Shell cwd was reset to …`), not the command's own. */
const ENGINE_NOTE = /^Shell cwd was reset to .*$/gm

const withoutEngineNotes = (stderr: string) => stderr.replace(ENGINE_NOTE, '').trim()

/** The text a result carries as content blocks (`{ type: 'text', text }`), alone or under `content`, as MCP tools return it. */
const textOf = (value: unknown): string | null => {
  const blocks = Array.isArray(value) ? value : field(value, 'content')
  if (!Array.isArray(blocks)) {
    return null
  }
  const texts = blocks.map(block => (field(block, 'type') === 'text' ? text(field(block, 'text')) : '')).filter(one => one !== '')

  return texts.length > 0 ? texts.join('\n\n') : null
}

/** The links a WebSearch found, as `[title](url)` pairs. */
const searchLinks = (output: unknown) => {
  const results = field(output, 'results')

  return (Array.isArray(results) ? results : []).flatMap(result => {
    const content = field(result, 'content')

    return (Array.isArray(content) ? content : []).flatMap(hit => {
      const title = text(field(hit, 'title'))
      const url = text(field(hit, 'url'))

      return url === '' ? [] : [{ title: title === '' ? url : title, url }]
    })
  })
}

const filenames = (output: unknown) => {
  const names = field(output, 'filenames')

  return Array.isArray(names) ? names.filter((one): one is string => typeof one === 'string') : []
}

/** A dim word or two after a finished call's target: what it returned, at a glance. */
const summary = (tool: string, output: unknown) => {
  if (tool === 'Read') {
    const lines = field(field(output, 'file'), 'numLines')

    return typeof lines === 'number' ? plural(lines, 'line') : ''
  }
  if (tool === 'Bash') {
    const out = `${text(field(output, 'stdout'))}${withoutEngineNotes(text(field(output, 'stderr')))}`.trim()
    const files = editedFiles(output).length

    return [out === '' ? 'no output' : lineCount(out), ...(files > 0 ? [plural(files, 'file') + ' changed'] : [])].join(' · ')
  }
  if (tool === 'Grep' || tool === 'Glob') {
    const lines = field(output, 'numLines')
    const files = field(output, 'numFiles')

    return typeof lines === 'number' && lines > 0
      ? plural(lines, 'line')
      : typeof files === 'number'
        ? plural(files, 'file')
        : ''
  }
  if (tool === 'WebSearch') {
    return plural(searchLinks(output).length, 'result')
  }
  if (tool === 'WebFetch') {
    const code = field(output, 'code')

    return typeof code === 'number' ? `${code} ${text(field(output, 'codeText'))}`.trim() : ''
  }

  return ''
}

/** Drawing pieces shared by replies and tool rows, sized to `columns`. */
const kit = ({ Box, Text, Code }: Ui, columns: number) => {
  const line = (glyph: string, color: string) => (
    <Box height={1} overflow="hidden">
      <Text color={color}>{glyph.repeat(columns)}</Text>
    </Box>
  )

  const styled = (run: Span) => {
    switch (run.style) {
      case 'code':
        return <Text color={ACCENT}>{run.text}</Text>
      case 'command':
        return (
          <Text weight="bold" color={ACCENT}>
            {run.text}
          </Text>
        )
      case 'bold':
        return <Text weight="bold">{run.text}</Text>
      case 'italic':
        return <Text italic>{run.text}</Text>
      case 'strike':
        return <Text strikethrough>{run.text}</Text>
      case 'link':
        return (
          <Text color="suggestion" underline>
            {run.text}
          </Text>
        )
      default:
        return run.text
    }
  }

  // Bars are drawn as text, one glyph per wrapped row: a bar is exactly as tall as what it marks,
  // and nothing is placed absolutely (which the engine drew whole past a site partly scrolled out of view).
  const barred = (rows: Span[][], color: string, options: { glyph?: string; head?: RenderChildren; isDim?: boolean } = {}) => {
    const mark = <Text color={color}>{options.glyph ?? '▌'} </Text>

    return (
      <Box flexDirection="column">
        {options.head !== undefined && (
          <Text>
            {mark}
            {options.head}
          </Text>
        )}
        {rows.map(row => (
          <Text>
            {mark}
            <Text dimColor={options.isDim === true}>{row.map(styled)}</Text>
          </Text>
        ))}
      </Box>
    )
  }

  // A frame is a bordered Box, which the engine clips like any other when it is partly scrolled out of
  // view (absolutely placed sides were drawn whole from the viewport's edge, spilling past the frame).
  // Its label and note are laid over the top border: column-reverse puts the overlay above the Box, its
  // -1 margin pulls it onto the border row, and as the later child it is painted last.
  const frame = (body: RenderChildren, label?: string, note?: string) => (
    <Box flexDirection="column-reverse">
      <Box flexDirection="column" borderStyle="round" borderColor="inactive" paddingX={1}>
        {body}
      </Box>
      <Box flexDirection="row" justifyContent="space-between" marginX={2} marginBottom={-1} height={1} overflow="hidden">
        <Text color={ACCENT}>{label === undefined ? '' : ` ${label} `}</Text>
        <Text color="inactive">{note === undefined ? '' : ` ${note} `}</Text>
      </Box>
    </Box>
  )

  const code = (source: string, options: { language?: string; path?: string; startLine?: number }) => (
    <Code source={source} {...options} format={options.language === 'diff' ? 'diff' : 'source'} />
  )

  const inline = (line: string) => spans(line).map(styled)

  // A table is drawn as lines of text: every cell wrapped to its column, each row as tall as its tallest
  // cell, the dividers written into each line rather than placed beside it.
  const table = (block: Extract<Block, { kind: 'table' }>) => {
    const count = block.header.length
    const natural = block.header.map((cell, column) =>
      Math.max(width(cell), ...block.rows.map(row => width(row[column] ?? ''))),
    )
    const widths = fitColumns(natural, columns - 4 - (3 * count + 1))
    const border = (left: string, middle: string, right: string) => (
      <Text color="inactive">{left + widths.map(one => '─'.repeat(one + 2)).join(middle) + right}</Text>
    )
    const pad = (row: Span[], column: number) => {
      const room = widths[column]! - rowWidth(row)
      const align = block.align[column] ?? 'left'
      const before = align === 'right' ? room : align === 'center' ? Math.floor(room / 2) : 0

      return [' '.repeat(Math.max(0, before)), ' '.repeat(Math.max(0, room - before))] as const
    }
    const lines = (values: string[], isHeader: boolean) => {
      const cells = values.map((value, column) => wrapSpans(spans(value), widths[column]!))
      const height = Math.max(1, ...cells.map(rows => rows.length))

      return Array.from({ length: height }, (_, index) => (
        <Text wrap="truncate-end">
          {cells.map((rows, column) => {
            const row = rows[index] ?? []
            const [before, after] = pad(row, column)

            return (
              <Text>
                <Text color="inactive">│ </Text>
                {before}
                {isHeader ? (
                  <Text weight="bold" color={ACCENT}>
                    {row.map(styled)}
                  </Text>
                ) : (
                  row.map(styled)
                )}
                {after}{' '}
              </Text>
            )
          })}
          <Text color="inactive">│</Text>
        </Text>
      ))
    }

    return (
      <Box flexDirection="column">
        {border('╭', '┬', '╮')}
        {lines(block.header, true)}
        {border('├', '┼', '┤')}
        {block.rows.flatMap(values => lines(values, false))}
        {border('╰', '┴', '╯')}
      </Box>
    )
  }

  return { line, barred, frame, code, inline, styled, table }
}

/** What an opened tool row shows: the output a model read, framed and highlighted. */
const detail = (ui: Ui, columns: number, tool: string, output: unknown, isErrored: boolean) => {
  const { Box, Text, Markdown } = ui
  const { frame, code } = kit(ui, columns - 2)

  if (typeof output === 'string') {
    const shown = clip(output)

    return frame(<Text color={isErrored ? 'error' : 'text'}>{shown.text}</Text>, isErrored ? 'error' : 'result', shown.note)
  }
  if (tool === 'Bash') {
    const stdout = clip(text(field(output, 'stdout')))
    const stderr = clip(withoutEngineNotes(text(field(output, 'stderr'))))

    const files = editedFiles(output)

    return (
      <Box flexDirection="column">
        {stdout.text !== '' && frame(code(stdout.text, {}), 'stdout', stdout.note)}
        {stderr.text !== '' && frame(<Text color="error">{stderr.text}</Text>, 'stderr', stderr.note)}
        {files.map(file =>
          frame(code(file.diff, { language: 'diff', path: file.path }), basename(file.path), `+${file.added} −${file.removed}`),
        )}
        {stdout.text === '' && stderr.text === '' && files.length === 0 && <Text dimColor>no output</Text>}
      </Box>
    )
  }
  const file = field(output, 'file')
  if (tool === 'Read' && typeof field(file, 'content') === 'string') {
    const path = text(field(file, 'filePath'))
    const start = field(file, 'startLine')
    const shown = clip(text(field(file, 'content')))

    return frame(
      code(shown.text, { path, startLine: typeof start === 'number' ? start : 1 }),
      path.split('/').pop(),
      shown.note,
    )
  }
  if (tool === 'WebFetch' && typeof field(output, 'result') === 'string') {
    const shown = clip(text(field(output, 'result')))

    return frame(<Markdown text={shown.text} />, text(field(output, 'url')), shown.note)
  }
  if (tool === 'Grep' && typeof field(output, 'content') === 'string') {
    const shown = clip(text(field(output, 'content')))

    return frame(code(shown.text, {}), 'matches', shown.note)
  }
  if ((tool === 'Grep' || tool === 'Glob') && filenames(output).length > 0) {
    const shown = clip(filenames(output).join('\n'))

    return frame(code(shown.text, {}), 'files', shown.note)
  }
  if (tool === 'WebSearch' && searchLinks(output).length > 0) {
    const shown = clip(searchLinks(output).map(link => `- [${link.title}](${link.url})`).join('\n'))

    return frame(<Markdown text={shown.text} />, 'results', shown.note)
  }
  const said = textOf(output)
  if (said !== null) {
    const shown = clip(said)

    return frame(<Markdown text={shown.text} />, 'result', shown.note)
  }
  const shown = clip(JSON.stringify(output, null, 2) ?? '')

  return frame(code(shown.text, { language: 'json' }), 'json', shown.note)
}

/** The origins of rows the person wrote: typed, from the phone, or a slash command's echo (unstamped). */
const OWN_ORIGINS = new Set(['composer', 'bridge', 'unclassified'])

/** Columns a tool row leaves free at the right, so a trimmed row never wraps. */
const ROW_MARGIN = 4

/** `text` cut to `room` columns with an ellipsis, at its end or, for a path, its middle. */
const fit = (text: string, room: number, isPath: boolean) => {
  const chars = [...text]
  if (chars.length <= room) {
    return text
  }
  if (room <= 1) {
    return room === 1 ? '…' : ''
  }
  if (!isPath) {
    return `${chars.slice(0, room - 1).join('')}…`
  }
  const head = Math.ceil((room - 1) / 2)

  return `${chars.slice(0, head).join('')}…${chars.slice(chars.length - (room - 1 - head)).join('')}`
}

const taskTone = (status: string | undefined) => {
  switch (status) {
    case 'completed':
      return { glyph: '✓', color: 'success' }
    case 'failed':
      return { glyph: '✗', color: 'error' }
    case 'killed':
    case 'stopped':
      return { glyph: '■', color: 'warning' }
    default:
      return { glyph: '◆', color: 'suggestion' }
  }
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const saved = await $.store.get('disabled')
    if (Array.isArray(saved)) {
      await update($, disabled, () => saved.filter((one): one is string => typeof one === 'string'))
    }
    await $.command.register({
      name: 'nebula',
      description: 'Open the Nebula UI panel to switch each restyled part on or off',
    })
    void gather($)
    $.clock.every(15_000, () => void gather($))
    // Commands the engine listed before this load keep their old descriptions until it lists them again.
    void $.ui.invalidate('command.describe')

    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    const done = await next(e)
    void gather($)

    return done
  })

  on('tool.call', async ($, e, next) => {
    const ran = await next(e)
    void gather($)

    return ran
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.surface !== 'terminal' || e.props.hasSurvey || !(await isOn($, 'AbovePrompt'))) {
      return next(e)
    }
    const figures = await read($, dash)

    return figures === null ? next(e) : drawBand($.ui.resolve(e), figures)
  })

  on('command.describe', async ($, e, next) => {
    const listed = await next(e)
    if (!(await isOn($, 'CommandMenu'))) {
      return listed
    }
    // The menu draws descriptions in its own colors, so a glyph is the decoration a mod can give it.
    const glyph = e.provider.plugin === 'engine' ? '◆' : e.provider.plugin === $.plugin.name ? '✦' : '◇'

    return { ...listed, description: `${glyph} ${listed.description}` }
  })

  on('command.run', { command: 'nebula' }, async $ => {
    await $.ui.open({ id: PANEL, title: 'Nebula UI', focus: true, closeOnEscape: true })

    return { text: 'Nebula UI panel opened.' }
  })

  on('ui.render', { component: 'Pane', requestId: PANEL }, async ($, e) => {
    const { Box, Text, Button } = $.ui.resolve(e)
    const off = await read($, disabled)

    return (
      <Box flexDirection="column">
        <Text weight="bold" color={ACCENT}>
          ✦ Nebula UI
        </Text>
        <Text dimColor>Press a number, or Enter on a row, to switch that part. Esc closes.</Text>
        <Box flexDirection="column" marginTop={1}>
          {SITES.map((site, index) => {
            const isSiteOn = !off.includes(site.id)

            return (
              <Button key={site.id} plain hotkey={HOTKEYS[index]} onPress={() => toggle($, site.id)}>
                <Text color={isSiteOn ? 'success' : 'inactive'}>{isSiteOn ? '◉' : '○'}</Text> {site.label}{' '}
                <Text dimColor>{site.about}</Text>
              </Button>
            )
          })}
        </Box>
      </Box>
    )
  })

  on('ui.render', { component: 'UserMessage' }, async ($, e, next) => {
    if (e.surface !== 'terminal' || !(await isOn($, 'UserMessage'))) {
      return next(e)
    }
    const { Box, Text } = $.ui.resolve(e)

    const isOwn = e.props.task === undefined && e.props.from === undefined && OWN_ORIGINS.has(e.props.origin.kind)
    if (isOwn) {
      const { barred } = kit($.ui.resolve(e), e.viewport?.columns ?? 80)
      const room = (e.viewport?.columns ?? 80) - 3
      // The prompt as typed: no markdown read into it, a leading slash command marked out.
      const rows = e.props.text.split('\n').flatMap((line, index) => {
        const command = index === 0 ? /^(\/\S+)(.*)$/.exec(line) : null
        const runs: Span[] =
          command === null
            ? [{ text: line, style: 'plain' }]
            : [
                { text: command[1]!, style: 'command' },
                { text: command[2]!, style: 'plain' },
              ]

        return wrapSpans(runs, room)
      })

      return <Box marginTop={1}>{barred(rows, ACCENT)}</Box>
    }
    const drawn = await next(e)
    if (e.props.task !== undefined) {
      const tone = taskTone(e.props.task.status)

      return (
        <Box flexDirection="row">
          <Text color={tone.color}>{tone.glyph} </Text>
          <Box flexGrow={1}>{drawn}</Box>
        </Box>
      )
    }

    return drawn
  })

  on('ui.render', { component: 'AssistantMessage' }, async ($, e, next) => {
    if (e.surface !== 'terminal' || e.props.isSummary === true || !(await isOn($, 'AssistantMessage'))) {
      return next(e)
    }
    const { Box, Text, Markdown } = $.ui.resolve(e)
    const { line, barred, frame, code, inline, table } = kit($.ui.resolve(e), e.viewport?.columns ?? 80)
    // What a block may take beside the reply's two-column gutter, one column spare.
    const room = (e.viewport?.columns ?? 80) - 3

    const draw = (block: Block) => {
      switch (block.kind) {
        case 'prose':
          return <Markdown text={block.text} />
        case 'code':
          return frame(
            code(block.source, block.language === '' ? {} : { language: block.language }),
            block.language === '' ? undefined : block.language,
            block.source.split('\n').length >= LINE_COUNT_FROM ? lineCount(block.source) : undefined,
          )
        case 'table':
          return table(block)
        case 'heading':
          if (block.level === 1) {
            return (
              <Box flexDirection="column">
                <Text weight="bold" color={ACCENT}>
                  {HEADINGS[0]} {inline(block.text)}
                </Text>
                {line('━', ACCENT)}
              </Box>
            )
          }

          return (
            <Text weight="bold" color={block.level === 2 ? ACCENT : 'text'}>
              {HEADINGS[Math.min(block.level, 3) - 1]} {inline(block.text)}
            </Text>
          )
        case 'quote': {
          const tone = block.callout === null ? null : CALLOUTS[block.callout]

          return barred(block.text === '' ? [] : wrapText(block.text, room - 2), tone?.color ?? 'inactive', {
            isDim: tone === null,
            ...(tone === null
              ? {}
              : {
                  head: (
                    <Text weight="bold" color={tone.color}>
                      {tone.glyph} {block.title === '' ? tone.title : block.title}
                    </Text>
                  ),
                }),
          })
        }
        case 'rule':
          return line('─', 'inactive')
      }
    }

    return (
      <Box flexDirection="row" marginTop={1}>
        <Box width={2} flexShrink={0}>
          <Text>{e.props.isFirstOfReply ? '●' : ' '}</Text>
        </Box>
        <Box flexDirection="column" flexGrow={1} flexShrink={1} rowGap={1}>
          {parse(e.props.text).map(draw)}
        </Box>
      </Box>
    )
  })

  on('ui.render', { component: 'ToolUse' }, async ($, e, next) => {
    if (e.surface !== 'terminal' || !(await isOn($, 'ToolUse'))) {
      return next(e)
    }
    const ui = $.ui.resolve(e)
    const { Box, Text, Button } = ui
    const { tool_use_id, tool, input, output, isRunning, isErrored, isInterrupted } = e.props
    const status = isInterrupted
      ? { glyph: '⊘', color: 'warning', word: 'interrupted' }
      : isErrored
        ? { glyph: '✗', color: 'error', word: 'failed' }
        : isRunning
          ? { glyph: '◌', color: 'suggestion', word: 'running' }
          : { glyph: '✓', color: 'success', word: '' }
    const target = describe(tool, input)
    const isExpandable = !isRunning && output !== undefined && (isErrored || !ENGINE_RESULTS.has(tool))
    const isOpen = isExpandable && (await $.state.get({ ...expanded, id: tool_use_id })).value === true
    // An opened row's frame names the length, so the row itself leaves it out.
    const brief = isErrored || isRunning || isOpen ? '' : summary(tool, output)
    const columns = e.viewport?.columns ?? 80
    const pillText = ` ${isExpandable ? `${isOpen ? '▾' : '▸'} ` : ''}${toolName(tool)} `
    const tail = `${brief === '' ? '' : ` ${brief}`}${status.word === '' ? '' : ` ${status.word}`}`
    const room = columns - ROW_MARGIN - 2 - [...pillText].length - 1 - [...tail].length
    const shown = fit(target, room, PATHLIKE.has(tool))
    const onPress = () =>
      isExpandable ? update($, { ...expanded, id: tool_use_id }, value => value !== true) : undefined

    return (
      <Box flexDirection="column" marginTop={1}>
        <Button key={`open-${tool_use_id}`} plain onPress={onPress}>
          <Text color={status.color}>{status.glyph}</Text>{' '}
          <Text inverse weight="bold" color={ACCENT}>
            {pillText}
          </Text>
          {shown === '' ? '' : ` ${shown}`}
          {brief !== '' && <Text dimColor> {brief}</Text>}
          {status.word !== '' && <Text color={status.color}> {status.word}</Text>}
        </Button>
        {isOpen && <Box paddingLeft={2}>{detail(ui, e.viewport?.columns ?? 80, tool, output, isErrored)}</Box>}
      </Box>
    )
  })

  on('ui.render', { component: 'ToolResult' }, async ($, e, next) => {
    const { tool_use_id, tool, output, isErrored } = e.props
    if (e.surface !== 'terminal' || ENGINE_RESULTS.has(tool) || !(await isOn($, 'ToolUse'))) {
      return next(e)
    }
    const { Box, Text, Button } = $.ui.resolve(e)
    const isOpen = (await $.state.get({ ...expanded, id: tool_use_id })).value === true
    const files = isErrored ? [] : editedFiles(output)
    // The row says what ran and its line count, and opens on a click to the full output; the block
    // under it keeps only what the row can't say: an error, or the files the command changed.
    if (isOpen || (!isErrored && files.length === 0)) {
      return <Box />
    }
    const error = typeof output === 'string' ? oneLine(output) : ''
    const label = isErrored ? `✗ ${error === '' ? 'failed' : error}` : `± ${files.map(changeNote).join(' · ')}`
    const room = (e.viewport?.columns ?? 80) - ROW_MARGIN - 2

    return (
      <Box paddingLeft={2}>
        <Button
          key={`result-${tool_use_id}`}
          plain
          onPress={() => update($, { ...expanded, id: tool_use_id }, value => value !== true)}
        >
          <Text color={isErrored ? 'error' : 'inactive'}>{fit(label, room, false)}</Text>
        </Button>
      </Box>
    )
  })

  on('ui.render', { component: 'ToolGroup' }, async ($, e, next) => {
    if (e.surface !== 'terminal' || e.props.isExpanded || !(await isOn($, 'ToolGroup'))) {
      return next(e)
    }
    const { Box, Text, Button } = $.ui.resolve(e)
    const { calls, isActive } = e.props
    const failed = calls.filter(call => call.isErrored).length
    const last = calls[calls.length - 1]
    const lastTarget = last === undefined ? '' : describe(last.tool, last.input)
    const label = calls.every(call => call.tool === 'Bash') ? 'Shell' : 'Explore'
    const group = `group:${e.requestId}`
    const isOpen = !isActive && (await $.state.get({ ...expanded, id: group })).value === true

    const pillText = ` ${isActive ? '' : `${isOpen ? '▾' : '▸'} `}${label} `
    const counts = ` ${tally(calls)}`
    const failedText = failed > 0 ? ` ${failed} failed` : ''
    const room =
      (e.viewport?.columns ?? 80) - ROW_MARGIN - 2 - [...pillText].length - [...counts].length - [...failedText].length - 1
    const shown = isActive ? fit(lastTarget, room, true) : ''

    const header = (
      <Box marginTop={1}>
        <Button key={group} plain onPress={() => update($, { ...expanded, id: group }, value => value !== true)}>
          <Text color={isActive ? 'suggestion' : 'success'}>{isActive ? '◌' : '✓'}</Text>{' '}
          <Text inverse weight="bold" color="suggestion">
            {pillText}
          </Text>
          {counts}
          {failedText !== '' && <Text color="error">{failedText}</Text>}
          {shown !== '' && <Text dimColor> {shown}</Text>}
        </Button>
      </Box>
    )

    if (!isOpen) {
      return header
    }

    return (
      <Box flexDirection="column">
        {header}
        <Box paddingLeft={2} flexDirection="column">
          {await next({ ...e, props: { ...e.props, isExpanded: true } })}
        </Box>
      </Box>
    )
  })

  on('ui.render', { component: 'CommandOutput' }, async ($, e, next) => {
    if (e.surface !== 'terminal' || e.props.text.trim() === '' || !(await isOn($, 'CommandOutput'))) {
      return next(e)
    }
    const ui = $.ui.resolve(e)
    const { Box, Text } = ui
    const { barred } = kit(ui, e.viewport?.columns ?? 80)
    const { text, isErrored } = e.props
    const room = (e.viewport?.columns ?? 80) - 5

    return (
      <Box marginLeft={2}>
        {barred(wrapText(text.replace(/\n+$/, ''), room), isErrored ? 'error' : ACCENT, {
          glyph: '▎',
          ...(isErrored
            ? {
                head: (
                  <Text weight="bold" color="error">
                    ✗ failed
                  </Text>
                ),
              }
            : {}),
        })}
      </Box>
    )
  })

  on('ui.render', { component: 'Spinner' }, async ($, e, next) => {
    if (e.surface !== 'terminal' || !(await isOn($, 'Spinner'))) {
      return next(e)
    }
    const { Box, Text } = $.ui.resolve(e)
    const mode: { glyph: string; label: string; color: string } = (
      SPINNER_MODES as Record<string, { glyph: string; label: string; color: string } | undefined>
    )[e.props.mode] ?? { glyph: '◆', label: e.props.mode, color: ACCENT }
    const shown = e.props.message ?? e.props.word
    const word = shown.endsWith('…') ? shown : `${shown}…`
    // The word moves into a pill of its own; the engine still draws its glyph, time and tokens. An empty word
    // makes the engine sample one of its own, so it gets a no-break space: not empty, drawn blank.
    const engine = await next({
      ...e,
      props: { ...e.props, word: BLANK_WORD, message: e.props.message === null ? null : BLANK_WORD, suffix: '' },
    })

    // The engine's line keeps a blank row above itself; aligning to the bottom seats the pills beside its text.
    return (
      <Box flexDirection="row" alignItems="flex-end" gap={1}>
        <Box flexShrink={0}>
          <Text inverse weight="bold" color={mode.color}>
            {' '}
            {mode.glyph} {mode.label}{' '}
          </Text>
          <Text inverse weight="bold" color="claude">
            {' '}
            {word}{' '}
          </Text>
        </Box>
        {engine}
      </Box>
    )
  })

  on('ui.render', { component: 'TurnDuration' }, async ($, e, next) => {
    if (e.surface !== 'terminal' || !(await isOn($, 'TurnDuration'))) {
      return next(e)
    }
    const { Box, Text } = $.ui.resolve(e)
    const columns = e.viewport?.columns ?? 80

    return (
      <Box flexDirection="row" marginTop={1}>
        <Box flexShrink={0}>
          <Text color="inactive">───</Text>
          <Text color={ACCENT}>
            {' '}
            ✦ {e.props.word} for {duration(e.props.durationMs)}{' '}
          </Text>
        </Box>
        <Box flexGrow={1} height={1} overflow="hidden">
          <Text color="inactive">{'─'.repeat(columns)}</Text>
        </Box>
      </Box>
    )
  })

  on('ui.render', { component: 'InfoNotice' }, async ($, e, next) => {
    if (e.surface !== 'terminal' || !(await isOn($, 'InfoNotice'))) {
      return next(e)
    }
    const { Box, Text } = $.ui.resolve(e)
    const { text, command } = e.props

    return (
      <Box flexDirection="row" gap={1}>
        <Text color="suggestion">ℹ</Text>
        <Text dimColor>{text}</Text>
        {command !== null && <Text color="suggestion">{command.startsWith('/') ? command : `/${command}`}</Text>}
      </Box>
    )
  })

  on('ui.render', { component: 'SessionMode' }, async ($, e, next) => {
    if (e.surface !== 'terminal' || e.props.modes.length === 0 || !(await isOn($, 'SessionMode'))) {
      return next(e)
    }
    const { Box, Text } = $.ui.resolve(e)

    return (
      <Box flexDirection="row" gap={2}>
        {e.props.modes.map(mode => (
          <Text color={ACCENT}>◉ {mode}</Text>
        ))}
      </Box>
    )
  })

  on('ui.render', { component: 'PromptHint' }, async ($, e, next) => {
    if (e.surface !== 'terminal' || e.props.isDraft || !(await isOn($, 'PromptHint'))) {
      return next(e)
    }

    return next({ ...e, props: { ...e.props, tail: '✦ /nebula' } })
  })

  on('ui.render', { component: 'ToolProgress' }, async ($, e, next) => {
    if (e.surface !== 'terminal' || e.props.kind !== 'background_hint' || !(await isOn($, 'ToolProgress'))) {
      return next(e)
    }

    return next({ ...e, props: { ...e.props, hint: `⇣ ${e.props.hint.replace(/^\(|\)$/g, '')}` } })
  })
}
