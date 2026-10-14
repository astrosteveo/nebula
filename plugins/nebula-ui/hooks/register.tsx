import { atom, read, update } from 'claude-code'
import type { Elements, EngineInterface, Register, RenderChildren } from 'claude-code'

import type { Dash, Disabled } from '../types'
import { fitColumns, parse, spans, width } from './markdown'
import type { Block, Callout } from './markdown'
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
  { id: 'Spinner', label: 'Spinner', about: 'says what the turn is doing' },
  { id: 'TurnDuration', label: 'Turn divider', about: 'a rule at the end of each turn' },
  { id: 'InfoNotice', label: 'Notices', about: 'startup notices with an icon' },
  { id: 'SessionMode', label: 'Mode chips', about: 'footer modes as chips' },
  { id: 'PromptHint', label: 'Hint tail', about: 'a /nebula mark in the hint line' },
  { id: 'ToolProgress', label: 'Background hint', about: 'a compact ctrl+b hint' },
  { id: 'AbovePrompt', label: 'Dashboard band', about: 'model, branch, context, limits, cost above the prompt' },
  { id: 'CommandOutput', label: 'Command output', about: 'what a slash command printed, behind an accent bar' },
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
}

const SPINNER_MODES = {
  requesting: 'connecting',
  responding: 'writing',
  thinking: 'thinking',
  'tool-input': 'preparing a tool',
  'tool-use': 'running tools',
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
const describe = (tool: string, input: unknown): string => {
  if (typeof input !== 'object' || input === null) {
    return ''
  }
  const fields = input as Record<string, unknown>
  const named = TARGETS[tool]
  const value = named === undefined ? Object.values(fields).find(one => typeof one === 'string') : fields[named]

  return typeof value === 'string' ? oneLine(value) : ''
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

/** A column of `glyph` as tall as its siblings, drawn over the parent's left edge. */
const BAR_ROWS = 400

const expanded = { plugin: 'nebula-ui', key: 'expanded' } as const

/** Tools whose result the engine already draws under the row (a diff, a summary): no expander. */
const ENGINE_RESULTS = new Set(['Edit', 'Write', 'NotebookEdit', 'MultiEdit', 'TodoWrite'])

/** Lines an opened tool row shows before it says how many more there are. */
const DETAIL_LINES = 40

const JUSTIFY = { left: 'flex-start', center: 'center', right: 'flex-end' } as const

type Ui = Elements['terminal']

const plural = (n: number, word: string) => `${n} ${n === 1 ? word : `${word}s`}`

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

/** A dim word or two after a finished call's target: what it returned, at a glance. */
const summary = (tool: string, output: unknown) => {
  if (tool === 'Read') {
    const lines = field(field(output, 'file'), 'numLines')

    return typeof lines === 'number' ? plural(lines, 'line') : ''
  }
  if (tool === 'Bash') {
    const out = `${text(field(output, 'stdout'))}${text(field(output, 'stderr'))}`.trim()

    return out === '' ? 'no output' : lineCount(out)
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

  const bar = (color: string, glyph = '▌', side: 'left' | 'right' = 'left') => (
    <Box position="absolute" top={0} bottom={0} {...{ [side]: 0 }} width={1} overflow="hidden">
      <Text color={color}>{`${glyph}\n`.repeat(BAR_ROWS)}</Text>
    </Box>
  )

  const edge = (left: string, right: string, label?: string, note?: string) => (
    <Box flexDirection="row">
      <Box flexShrink={0}>
        <Text color="inactive">{left}─</Text>
        {label !== undefined && <Text color={ACCENT}> {label} </Text>}
      </Box>
      <Box flexGrow={1} height={1} overflow="hidden">
        <Text color="inactive">{'─'.repeat(columns)}</Text>
      </Box>
      <Box flexShrink={0}>
        {note !== undefined && <Text color="inactive"> {note} ─</Text>}
        <Text color="inactive">{right}</Text>
      </Box>
    </Box>
  )

  const frame = (body: RenderChildren, label?: string, note?: string) => (
    <Box flexDirection="column">
      {edge('╭', '╮', label, note)}
      <Box position="relative" flexDirection="column" paddingX={2}>
        {bar('inactive', '│')}
        {bar('inactive', '│', 'right')}
        {body}
      </Box>
      {edge('╰', '╯')}
    </Box>
  )

  const code = (source: string, options: { language?: string; path?: string; startLine?: number }) => (
    <Code source={source} {...options} format={options.language === 'diff' ? 'diff' : 'source'} />
  )

  const inline = (line: string) =>
    spans(line).map(run => {
      switch (run.style) {
        case 'code':
          return <Text color={ACCENT}>{run.text}</Text>
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
    })

  const table = (block: Extract<Block, { kind: 'table' }>) => {
    const count = block.header.length
    const natural = block.header.map((cell, column) =>
      Math.max(width(cell), ...block.rows.map(row => width(row[column] ?? ''))),
    )
    const widths = fitColumns(natural, columns - 4 - (3 * count + 1))
    const border = (left: string, middle: string, right: string) => (
      <Text color="inactive">{left + widths.map(one => '─'.repeat(one + 2)).join(middle) + right}</Text>
    )
    const row = (values: string[], isHeader: boolean) => (
      <Box flexDirection="row">
        {values.map((value, column) => {
          const isLast = column === count - 1

          return (
            <Box
              position="relative"
              flexShrink={0}
              width={widths[column]! + (isLast ? 4 : 3)}
              paddingLeft={2}
              paddingRight={isLast ? 2 : 1}
              justifyContent={JUSTIFY[block.align[column] ?? 'left']}
            >
              {bar('inactive', '│')}
              {isLast && bar('inactive', '│', 'right')}
              <Text {...(isHeader ? { weight: 'bold' as const, color: ACCENT } : {})}>{inline(value)}</Text>
            </Box>
          )
        })}
      </Box>
    )

    return (
      <Box flexDirection="column">
        {border('╭', '┬', '╮')}
        {row(block.header, true)}
        {border('├', '┼', '┤')}
        {block.rows.map(values => row(values, false))}
        {border('╰', '┴', '╯')}
      </Box>
    )
  }

  return { line, bar, edge, frame, code, inline, table }
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
    const stderr = clip(text(field(output, 'stderr')))

    return (
      <Box flexDirection="column">
        {stdout.text !== '' && frame(code(stdout.text, {}), 'stdout', stdout.note)}
        {stderr.text !== '' && frame(<Text color="error">{stderr.text}</Text>, 'stderr', stderr.note)}
        {stdout.text === '' && stderr.text === '' && <Text dimColor>no output</Text>}
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
      const command = /^(\/\S+)([\s\S]*)$/.exec(e.props.text)

      return (
        <Box position="relative" marginTop={1} paddingLeft={2}>
          <Box position="absolute" top={0} bottom={0} left={0} width={1} overflow="hidden">
            <Text color={ACCENT}>{'▌\n'.repeat(BAR_ROWS)}</Text>
          </Box>
          {command === null ? (
            <Text>{e.props.text}</Text>
          ) : (
            <Text>
              <Text weight="bold" color={ACCENT}>
                {command[1]}
              </Text>
              {command[2]}
            </Text>
          )}
        </Box>
      )
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
    const { line, bar, frame, code, inline, table } = kit($.ui.resolve(e), e.viewport?.columns ?? 80)

    const draw = (block: Block) => {
      switch (block.kind) {
        case 'prose':
          return <Markdown text={block.text} />
        case 'code':
          return frame(
            code(block.source, block.language === '' ? {} : { language: block.language }),
            block.language === '' ? undefined : block.language,
            lineCount(block.source),
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

          return (
            <Box position="relative" flexDirection="column" paddingLeft={2}>
              {bar(tone?.color ?? 'inactive')}
              {tone !== null && (
                <Text weight="bold" color={tone.color}>
                  {tone.glyph} {block.title === '' ? tone.title : block.title}
                </Text>
              )}
              {block.text !== '' && <Markdown text={block.text} dimColor={tone === null} />}
            </Box>
          )
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
    const brief = isErrored || isRunning ? '' : summary(tool, output)
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
    const { Box, Text, Markdown } = ui
    const { bar } = kit(ui, e.viewport?.columns ?? 80)
    const { text, isErrored } = e.props

    return (
      <Box position="relative" flexDirection="column" marginLeft={2} paddingLeft={2}>
        {bar(isErrored ? 'error' : ACCENT, '▎')}
        {isErrored && (
          <Text weight="bold" color="error">
            ✗ failed
          </Text>
        )}
        <Markdown text={text} />
      </Box>
    )
  })

  on('ui.render', { component: 'Spinner' }, async ($, e, next) => {
    if (e.surface !== 'terminal' || !(await isOn($, 'Spinner'))) {
      return next(e)
    }
    const shown = e.props.message ?? e.props.word
    const mark = shown.endsWith('…') ? ' ' : '… '

    return next({ ...e, props: { ...e.props, suffix: `${mark}${SPINNER_MODES[e.props.mode]}` } })
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
