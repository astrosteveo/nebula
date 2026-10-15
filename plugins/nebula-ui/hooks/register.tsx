import { atom, read, update } from 'claude-code'
import type { Elements, EngineInterface, Register, RenderChildren } from 'claude-code'

import type { Dash, Disabled, FrameWidth, Proc } from '../types'
import { fenceCommand, fitColumns, linkCommands, parse, rowWidth, spans, width, wrapSpans, wrapText } from './markdown'
import type { Block, Callout, Command, Span } from './markdown'
import { drawBand, gather } from './dashboard'
import {
  FOLLOW_PANE,
  PROCS_PANE,
  TONE,
  adopt,
  clearProc,
  describeOutput,
  describeProcs,
  drawFollow,
  drawProcs,
  isRunning,
  outputLine,
  restartProc,
  startProc,
  statusWord,
  stopAll,
  stopProc,
} from './procs'
import { ACCENT, THEMES, THEME_NAMES, isThemeName, setAccent } from './theme'
import type { ThemeName } from './theme'

const PANEL = 'nebula-ui'

const disabled = atom({ plugin: 'nebula-ui', key: 'disabled' } as const, [] as Disabled)
const dash = atom({ plugin: 'nebula-ui', key: 'dash' } as const, null as Dash | null)
const procList = atom({ plugin: 'nebula-ui', key: 'procs' } as const, [] as Proc[])
const pending = atom({ plugin: 'nebula-ui', key: 'pending' } as const, null as { command: string; origin: string | null } | null)
const frameWidth = atom({ plugin: 'nebula-ui', key: 'frameWidth' } as const, 'fill' as FrameWidth)
const theme = atom({ plugin: 'nebula-ui', key: 'theme' } as const, 'terminal' as ThemeName)

/** Lines of a run's output a code frame shows; /procs keeps more. */
const RUN_LINES = 12

/** The frame widths the panel steps through, in order. */
const FRAME_WIDTHS: FrameWidth[] = ['fill', 'fit', 80, 100, 120]

const isFrameWidth = (value: unknown): value is FrameWidth =>
  value === 'fill' || value === 'fit' || (typeof value === 'number' && value >= 20)

/** The dialog a click on a shell command opens: run it here, or copy it. */
const RUN_PANE = 'nebula-run'

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
  { id: 'ClickCommands', label: 'Clickable commands', about: 'click a command in a reply: / and ! to your prompt, shell to the clipboard' },
  { id: 'ShellOpen', label: 'Open shell output', about: 'Bash rows and Shell groups start open; a click still closes them' },
] as const

type Site = (typeof SITES)[number]['id']

/** The panel's keys, one per part, in order. */
const HOTKEYS = '1234567890abcdefghij'
const isOn = async ($: EngineInterface, site: Site) => !(await read($, disabled)).includes(site)

/**
 * Sets the accent from the person's theme before a drawing: the read also makes the drawing redraw
 * when the theme changes. Every render hook that paints the accent calls it first.
 */
const themed = async ($: EngineInterface) => {
  setAccent(await read($, theme))
}

const stepTheme = async ($: EngineInterface) => {
  const name = await update($, theme, now => THEME_NAMES[(THEME_NAMES.indexOf(now) + 1) % THEME_NAMES.length]!)
  await $.store.set('theme', name)
}

const stepFrameWidth = async ($: EngineInterface) => {
  const width = await update($, frameWidth, now => {
    const at = FRAME_WIDTHS.indexOf(now)

    return FRAME_WIDTHS[(at + 1) % FRAME_WIDTHS.length]!
  })
  await $.store.set('frameWidth', width)
}

const toggle = async ($: EngineInterface, site: Site) => {
  const list = await update($, disabled, off =>
    off.includes(site) ? off.filter(one => one !== site) : [...off, site],
  )
  await $.store.set('disabled', list)
}

/** What the engine's spinner draws in place of its word, which nebula-ui draws in a pill. */
const BLANK_WORD = '\u00a0'

/** The pill before the spinner line: what the turn is doing, by the spinner's mode. */
const SPINNER_MODES = {
  requesting: { glyph: '⇅', label: 'connecting', color: 'inactive' },
  responding: { glyph: '✎', label: 'writing', color: 'success' },
  thinking: {
    glyph: '✦',
    label: 'thinking',
    get color() {
      return ACCENT
    },
  },
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

/** Terminal color and cursor codes (`ESC[31m`) a tool printed: drawn text admits no control characters but tab and newline. */
const ANSI = /\u001b\[[0-9;?]*[ -/]*[@-~]|\u001b\][^\u0007\u001b]*(?:\u0007|\u001b\\)|\u001b[@-Z\\-_]/g

/** Text from a tool, safe to draw: color codes gone, other control characters but tab and newline dropped. */
const printable = (text: string) =>
  text.replace(ANSI, '').replace(/\r\n?/g, '\n').replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, '')

const oneLine = (text: string) => printable(text).split('\n')[0]!.replace(/\s+/g, ' ').trim()

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
  important: {
    glyph: '◆',
    get color() {
      return ACCENT
    },
    title: 'Important',
  },
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
  const lines = printable(text).replace(/\n+$/, '').split('\n')
  const hidden = lines.length - DETAIL_LINES

  return {
    text: lines.slice(0, DETAIL_LINES).join('\n'),
    note: hidden > 0 ? `${plural(hidden, 'more line')}` : lineCount(lines.join('\n')),
  }
}

const field = (value: unknown, key: string): unknown =>
  typeof value === 'object' && value !== null ? (value as Record<string, unknown>)[key] : undefined

const text = (value: unknown) => (typeof value === 'string' ? printable(value) : '')

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
const kit = ({ Box, Text, Code }: Ui, columns: number, frameSize: FrameWidth = 'fill') => {
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
  // `fill` stretches as a column child does, `fit` shrinks to the wider of the content and the top border's
  // words, and a number of columns is held to what the row has room for.
  const sized =
    frameSize === 'fill'
      ? {}
      : frameSize === 'fit'
        ? { alignSelf: 'flex-start' as const }
        : { width: Math.min(frameSize, columns) }

  const frame = (body: RenderChildren, label?: string, note?: string, action?: RenderChildren) => (
    <Box flexDirection="column-reverse" {...sized}>
      <Box flexDirection="column" borderStyle="round" borderColor="inactive" paddingX={1}>
        {body}
      </Box>
      <Box flexDirection="row" justifyContent="space-between" marginX={2} marginBottom={-1} height={1} overflow="hidden">
        <Text color={ACCENT}>{label === undefined ? '' : ` ${label} `}</Text>
        <Box flexDirection="row">
          <Text color="inactive">{note === undefined ? '' : ` ${note} `}</Text>
          {action}
        </Box>
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
const detail = (ui: Ui, columns: number, tool: string, output: unknown, isErrored: boolean, frameSize: FrameWidth) => {
  const { Box, Text, Markdown } = ui
  const { frame, code } = kit(ui, columns - 2, frameSize)

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
    const savedTheme = await $.store.get('theme')
    if (isThemeName(savedTheme)) {
      await update($, theme, () => savedTheme)
    }
    const savedWidth = await $.store.get('frameWidth')
    if (isFrameWidth(savedWidth)) {
      await update($, frameWidth, () => savedWidth)
    }
    await $.command.register({ name: 'procs', description: 'Show the commands started from replies, with their output and a stop button' })
    void gather($)
    void adopt($)
    $.clock.every(15_000, () => {
      void gather($)
      void adopt($)
    })
    // Tools for the model, last and on their own: a host that refuses them keeps everything above.
    try {
      await $.tool.register({
        name: 'processes',
        description:
          "Lists the commands the user started from nebula-ui (a run button on a code frame, a command clicked in a reply, or process_control), with their status and last lines; with an id, that process's recent output. Use it to check on a dev server or watcher the user is running.",
        inputSchema: {
          type: 'object',
          properties: {
            id: { type: 'string', description: 'A process id from the list; leave out to list them all.' },
            lines: { type: 'integer', minimum: 1, maximum: 200, description: 'Lines of output to return for an id (default 60).' },
          },
        },
      })
      await $.tool.register({
        name: 'process_control',
        description:
          "Starts, stops or restarts a process in nebula-ui's process manager, where the user sees it in /procs and can stop it. start runs `command` with sh -c in the session's directory, in its own process group; stop ends the whole group; restart runs the same command again.",
        inputSchema: {
          type: 'object',
          properties: {
            action: { type: 'string', enum: ['start', 'stop', 'restart'] },
            id: { type: 'string', description: 'The process to stop or restart.' },
            command: { type: 'string', description: 'The shell command to start.' },
          },
          required: ['action'],
        },
      })
    } catch (error) {
      $.ui.log(`nebula-ui: process tools not registered: ${String(error)}`, { to: 'debug' })
    }
    // The engine keeps each command's listing for the session; listing them again drops the glyphs an
    // earlier version of nebula-ui gave them, which also reached the model's list of skills.
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
    await themed($)
    if (e.surface !== 'terminal' || e.props.hasSurvey || !(await isOn($, 'AbovePrompt'))) {
      return next(e)
    }
    const figures = await read($, dash)
    const running = (await read($, procList)).filter(isRunning).length
    const { Button, Text } = $.ui.resolve(e)
    const chip =
      running === 0 ? undefined : (
        <Button key="procs" plain onPress={() => void $.ui.open({ id: PROCS_PANE, title: 'Processes' })}>
          <Text color="suggestion">⚙ {running} running</Text>
        </Button>
      )

    return figures === null ? next(e) : drawBand($.ui.resolve(e), figures, chip)
  })

  on('tool.call', { tool: 'mcp__nebula-ui__processes' }, async ($, e) => {
    const list = await read($, procList)
    const now = await $.clock.now()
    const id = typeof e.id === 'string' ? e.id : undefined
    if (id === undefined) {
      return { result: describeProcs(list, now) }
    }
    const proc = list.find(one => one.id === id)
    const lines = typeof e.lines === 'number' ? Math.min(200, Math.max(1, Math.round(e.lines))) : 60

    return proc === undefined ? { deny: `No process ${id}; call processes without an id to list them.` } : { result: describeOutput(proc, now, lines) }
  })

  on('tool.call', { tool: 'mcp__nebula-ui__process_control' }, async ($, e) => {
    const list = await read($, procList)
    const id = typeof e.id === 'string' ? e.id : undefined
    const proc = list.find(one => one.id === id)
    switch (e.action) {
      case 'start': {
        if (typeof e.command !== 'string' || e.command.trim() === '') {
          return { deny: 'start needs a command.' }
        }
        const started = await startProc($, e.command)

        return { result: `Started ${started}: ${e.command}. The user sees it in /procs; read its output with processes.` }
      }
      case 'stop':
        if (proc === undefined) {
          return { deny: `No process ${id ?? '(no id given)'}.` }
        }
        if (!isRunning(proc)) {
          return { result: `${proc.id} had already ${proc.status}.` }
        }
        await stopProc($, proc.id)

        return { result: `Stopped ${proc.id} and its process group.` }
      case 'restart': {
        if (proc === undefined) {
          return { deny: `No process ${id ?? '(no id given)'}.` }
        }
        const restarted = await restartProc($, proc.id)

        return { result: `Restarted as ${restarted}: ${proc.command}.` }
      }
      default:
        return { deny: 'action is start, stop or restart.' }
    }
  })

  on('session.end', async ($, e, next) => {
    // A process started from a reply ends with the session, its children too.
    await stopAll($)

    return next(e)
  })

  on('command.run', { command: 'procs' }, async $ => {
    await $.ui.open({ id: PROCS_PANE, title: 'Processes' })

    return { text: 'Processes pane opened.' }
  })

  on('ui.render', { component: 'Pane', requestId: PROCS_PANE }, async ($, e) => {
    await themed($)
    if (e.surface !== 'terminal') {
      const { Text } = $.ui.resolve(e)

      return <Text dimColor>The Processes pane draws in the terminal.</Text>
    }
    const list = await read($, procList)
    const now = (await read($, dash))?.now ?? (await $.clock.now())

    return drawProcs($.ui.resolve(e), list, now, e.props.bodyColumns, {
      stop: id => void stopProc($, id),
      restart: id => void restartProc($, id),
      follow: proc => void $.ui.open({ id: `${FOLLOW_PANE}${proc.id}`, title: fit(proc.command, 32, false) }),
      clear: id => void clearProc($, id),
      clearEnded: () => void update($, procList, all => all.filter(isRunning)),
    })
  })

  on('ui.render', { component: 'Pane' }, async ($, e, next) => {
    await themed($)
    if (!e.requestId.startsWith(FOLLOW_PANE) || e.surface !== 'terminal') {
      return next(e)
    }
    const id = e.requestId.slice(FOLLOW_PANE.length)
    const proc = (await read($, procList)).find(one => one.id === id)
    const now = (await read($, dash))?.now ?? 0

    return drawFollow($.ui.resolve(e), proc, now, e.props.scroll.bodyRows, {
      stop: () => void stopProc($, id),
      restart: () =>
        void restartProc($, id).then(fresh =>
          fresh === null ? undefined : $.ui.open({ id: `${FOLLOW_PANE}${fresh}`, title: e.props.title }),
        ),
    })
  })

  on('ui.render', { component: 'Pane', requestId: RUN_PANE }, async ($, e) => {
    await themed($)
    const { Box, Text, Button } = $.ui.resolve(e)
    const asked = await read($, pending)
    const cwd = await $.session.cwd()
    if (asked === null) {
      return <Text dimColor>No command to run.</Text>
    }
    const close = async () => {
      await update($, pending, () => null)
      await $.ui.close({ id: RUN_PANE })
    }

    return (
      <Box flexDirection="column" rowGap={1}>
        <Box flexDirection="column">
          <Text dimColor>Run in {cwd}:</Text>
          <Text weight="bold" color={ACCENT}>
            $ {asked.command}
          </Text>
        </Box>
        <Box flexDirection="row" gap={2}>
          <Button
            key="run"
            label="▶ run here"
            hotkey="r"
            variant="primary"
            autoFocus
            onPress={async () => {
              const chosen = await read($, pending)
              await close()
              if (chosen !== null) {
                await startProc($, chosen.command, chosen.origin)
                await $.ui.open({ id: PROCS_PANE, title: 'Processes' })
              }
            }}
          />
          <Button
            key="copy"
            label="⧉ copy"
            hotkey="c"
            onPress={async () => {
              const chosen = await read($, pending)
              await close()
              if (chosen !== null) {
                const copied = await $.ui.copy({ text: chosen.command, surface: e.surface })
                $.ui.toast(copied.isCopied ? `Copied ${chosen.command}` : 'Could not copy')
              }
            }}
          />
          <Button key="cancel" label="cancel" hotkey="x" role="dismiss" onPress={close} />
        </Box>
      </Box>
    )
  })

  on('command.run', { command: 'nebula' }, async $ => {
    await $.ui.open({ id: PANEL, title: 'Nebula UI', focus: true, closeOnEscape: true })

    return { text: 'Nebula UI panel opened.' }
  })

  on('ui.render', { component: 'Pane', requestId: PANEL }, async ($, e) => {
    await themed($)
    const { Box, Text, Button } = $.ui.resolve(e)
    const off = await read($, disabled)
    const width = await read($, frameWidth)
    const themeName = await read($, theme)

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
        <Box marginTop={1}>
          <Button key="theme" plain hotkey="t" onPress={() => stepTheme($)}>
            <Text color={ACCENT}>●</Text> Accent <Text weight="bold">{themeName}</Text>{' '}
            <Text dimColor>{THEMES[themeName].about} (t to change: {THEME_NAMES.join(', ')})</Text>
          </Button>
        </Box>
        <Box>
          <Button key="frame-width" plain hotkey="w" onPress={() => stepFrameWidth($)}>
            <Text color={ACCENT}>▭</Text> Frame width <Text weight="bold">{String(width)}</Text>{' '}
            <Text dimColor>code and output frames: fill, fit to their content, or a width in columns (w to change)</Text>
          </Button>
        </Box>
      </Box>
    )
  })

  on('ui.render', { component: 'UserMessage' }, async ($, e, next) => {
    await themed($)
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
    await themed($)
    if (e.surface !== 'terminal' || e.props.isSummary === true || !(await isOn($, 'AssistantMessage'))) {
      return next(e)
    }
    const ui = $.ui.resolve(e)
    const { Box, Text, Markdown, Button } = ui
    const { line, barred, frame, code, inline, table } = kit($.ui.resolve(e), (e.viewport?.columns ?? 80) - 3, await read($, frameWidth))
    const isClickable = await isOn($, 'ClickCommands')
    const started = isClickable ? await read($, procList) : []
    // The time a run's status counts from: the dashboard's, refreshed with it (no clock call per redraw).
    const now = (await read($, dash))?.now ?? 0
    /** The latest process a code frame of this reply started, if any. */
    const procOf = (index: number) => started.find(proc => proc.origin === `${e.requestId}:${index}`)

    const copy = async (text: string) => {
      const copied = await $.ui.copy({ text, surface: e.surface })
      const lines = text.split('\n').length
      $.ui.toast(copied.isCopied ? `Copied ${lines > 1 ? plural(lines, 'line') : fit(text, 60, false)}` : 'Could not copy')
    }

    // A slash or ! command goes to the prompt box for the person's Enter (copied while they have a draft);
    // a shell command opens a dialog that runs it here, tracked in the Processes pane, or copies it.
    const use = async (command: Command | undefined) => {
      if (command === undefined) {
        return
      }
      if (command.kind === 'shell') {
        await update($, pending, () => ({ command: command.text, origin: null }))
        await $.ui.open({ id: RUN_PANE, title: 'Run a command', focus: true, closeOnEscape: true })

        return
      }
      const draft = (await $.prompt.read()).text
      if (draft.trim() !== '') {
        return copy(command.text)
      }
      const { isFilled } = await $.prompt.fill({ text: command.text, mode: 'replace' })
      $.ui.toast(isFilled ? `${fit(command.text, 60, false)} is in your prompt: Enter runs it` : 'Could not reach the prompt')
    }
    // What a block may take beside the reply's two-column gutter, one column spare.
    const room = (e.viewport?.columns ?? 80) - 3

    // A fence copies; one that holds commands also runs (shell, through the run dialog) or goes to the prompt.
    const fenceActions = (block: Extract<Block, { kind: 'code' }>, index: number) => {
      const command = fenceCommand(block.language, block.source)
      const proc = procOf(index)
      // The fence's button is a deliberate run: it starts the command here, its output drawn in the frame.
      const run = () =>
        command?.kind === 'shell' ? void startProc($, command.text, `${e.requestId}:${index}`) : void use(command ?? undefined)

      return [
        command === null ? null : proc !== undefined && isRunning(proc) ? (
          <Button key={`stop-${index}`} plain onPress={() => void stopProc($, proc.id)}>
            <Text color="error"> ■ stop </Text>
          </Button>
        ) : (
          <Button key={`run-${index}`} plain onPress={run}>
            <Text color="success"> {command.kind === 'shell' ? '▶ run' : '↵ prompt'} </Text>
          </Button>
        ),
        <Button key={`copy-${index}`} plain onPress={() => void copy(block.source)}>
          <Text color={ACCENT}> ⧉ copy </Text>
        </Button>,
      ]
    }

    // The code, and under it what a run of it printed: its status, then its last lines.
    const ranIn = (block: Extract<Block, { kind: 'code' }>, index: number) => {
      const source = code(block.source, block.language === '' ? {} : { language: block.language })
      const proc = procOf(index)
      if (proc === undefined) {
        return source
      }
      const tone = TONE[proc.status]
      const lines = proc.tail.map(printable)
      while (lines.length > 0 && lines[lines.length - 1]!.trim() === '') {
        lines.pop()
      }

      return (
        <Box flexDirection="column">
          {source}
          <Box marginTop={1}>{line('┄', 'inactive')}</Box>
          <Text color={tone.color}>
            {tone.glyph} {statusWord(proc, now)}
          </Text>
          {lines.slice(-RUN_LINES).map(one => outputLine(ui, one))}
        </Box>
      )
    }

    const draw = (block: Block, index: number) => {
      switch (block.kind) {
        case 'prose': {
          const { text, commands } = isClickable ? linkCommands(block.text) : { text: block.text, commands: new Map() }

          return commands.size === 0 ? (
            <Markdown text={block.text} />
          ) : (
            <Markdown
              key={`commands-${index}`}
              text={text}
              pressableLinks={[...commands.keys()]}
              onLinkPress={link => void use(commands.get(link.href))}
            />
          )
        }
        case 'code':
          return frame(
            ranIn(block, index),
            block.language === '' ? undefined : block.language,
            block.source.split('\n').length >= LINE_COUNT_FROM ? lineCount(block.source) : undefined,
            isClickable ? fenceActions(block, index) : undefined,
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
          {parse(e.props.text).map((block, index) => draw(block, index))}
        </Box>
      </Box>
    )
  })

  on('ui.render', { component: 'ToolUse' }, async ($, e, next) => {
    await themed($)
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
    // A row the person never clicked follows the default: open for Bash while 'Open shell output' is on.
    const opensAlone = tool === 'Bash' && (await isOn($, 'ShellOpen'))
    const isOpen = isExpandable && ((await $.state.get({ ...expanded, id: tool_use_id })).value ?? opensAlone)
    // An opened row's frame names the length, so the row itself leaves it out.
    const brief = isErrored || isRunning || isOpen ? '' : summary(tool, output)
    const columns = e.viewport?.columns ?? 80
    const pillText = ` ${isExpandable ? `${isOpen ? '▾' : '▸'} ` : ''}${toolName(tool)} `
    const tail = `${brief === '' ? '' : ` ${brief}`}${status.word === '' ? '' : ` ${status.word}`}`
    const room = columns - ROW_MARGIN - 2 - [...pillText].length - 1 - [...tail].length
    const shown = fit(target, room, PATHLIKE.has(tool))
    const onPress = () =>
      isExpandable ? update($, { ...expanded, id: tool_use_id }, value => !(value ?? opensAlone)) : undefined

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
        {isOpen && (
          <Box paddingLeft={2}>
            {detail(ui, e.viewport?.columns ?? 80, tool, output, isErrored, await read($, frameWidth))}
          </Box>
        )}
      </Box>
    )
  })

  on('ui.render', { component: 'ToolResult' }, async ($, e, next) => {
    await themed($)
    const { tool_use_id, tool, output, isErrored } = e.props
    if (e.surface !== 'terminal' || ENGINE_RESULTS.has(tool) || !(await isOn($, 'ToolUse'))) {
      return next(e)
    }
    const { Box, Text, Button } = $.ui.resolve(e)
    const opensAlone = tool === 'Bash' && (await isOn($, 'ShellOpen'))
    const isOpen = (await $.state.get({ ...expanded, id: tool_use_id })).value ?? opensAlone
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
          onPress={() => update($, { ...expanded, id: tool_use_id }, value => !(value ?? opensAlone))}
        >
          <Text color={isErrored ? 'error' : 'inactive'}>{fit(label, room, false)}</Text>
        </Button>
      </Box>
    )
  })

  on('ui.render', { component: 'ToolGroup' }, async ($, e, next) => {
    await themed($)
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
    const opensAlone = label === 'Shell' && (await isOn($, 'ShellOpen'))
    const isOpen = !isActive && ((await $.state.get({ ...expanded, id: group })).value ?? opensAlone)

    const pillText = ` ${isActive ? '' : `${isOpen ? '▾' : '▸'} `}${label} `
    const counts = ` ${tally(calls)}`
    const failedText = failed > 0 ? ` ${failed} failed` : ''
    const room =
      (e.viewport?.columns ?? 80) - ROW_MARGIN - 2 - [...pillText].length - [...counts].length - [...failedText].length - 1
    const shown = isActive ? fit(lastTarget, room, true) : ''

    const header = (
      <Box marginTop={1}>
        <Button key={group} plain onPress={() => update($, { ...expanded, id: group }, value => !(value ?? opensAlone))}>
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
    await themed($)
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
    await themed($)
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

    // The engine's spinner is a blank row, its line, then sometimes a tip under it: the pills sit one row down,
    // beside the line, whatever follows it.
    return (
      <Box flexDirection="row" alignItems="flex-start" gap={1}>
        <Box flexShrink={0} marginTop={1}>
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
    await themed($)
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
    await themed($)
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
    await themed($)
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
    await themed($)
    if (e.surface !== 'terminal' || e.props.isDraft || !(await isOn($, 'PromptHint'))) {
      return next(e)
    }

    return next({ ...e, props: { ...e.props, tail: '✦ /nebula' } })
  })

  on('ui.render', { component: 'ToolProgress' }, async ($, e, next) => {
    await themed($)
    if (e.surface !== 'terminal' || e.props.kind !== 'background_hint' || !(await isOn($, 'ToolProgress'))) {
      return next(e)
    }

    return next({ ...e, props: { ...e.props, hint: `⇣ ${e.props.hint.replace(/^\(|\)$/g, '')}` } })
  })
}
