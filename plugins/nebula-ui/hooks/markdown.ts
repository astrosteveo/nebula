/**
 * Splits a reply's markdown into the blocks nebula-ui draws itself (fences,
 * headings, tables, quotes and callouts, rules) and runs of prose, which stay
 * with the engine's own Markdown renderer so lists, links and paragraphs keep
 * working.
 */

export type Callout = 'note' | 'tip' | 'important' | 'warning' | 'caution'

export type Align = 'left' | 'center' | 'right'

export type Block =
  | { kind: 'prose'; text: string }
  | { kind: 'code'; language: string; source: string; isOpen: boolean }
  | { kind: 'heading'; level: number; text: string }
  | { kind: 'table'; align: Align[]; header: string[]; rows: string[][] }
  | { kind: 'quote'; callout: Callout | null; title: string; text: string }
  | { kind: 'rule' }

export type Span = { text: string; style: 'plain' | 'code' | 'bold' | 'italic' | 'strike' | 'link' | 'command' }

const FENCE = /^( {0,3})(`{3,}|~{3,})\s*([^\s`]*)/
const HEADING = /^ {0,3}(#{1,6})\s+(.*?)(?:\s+#+)?\s*$/
const RULE = /^ {0,3}([-*_])(?:\s*\1){2,}\s*$/
const QUOTE = /^ {0,3}>\s?(.*)$/
/** A list item, or a line indented under one: a fence indented after it belongs to the list. */
const LIST_ITEM = /^\s*([-*+]|\d+[.)])\s|^\s+\S/
const CALLOUT = /^\[!(note|tip|important|warning|caution)\]\s*(.*)$/i
const TABLE_DIVIDER = /^ {0,3}\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|?\s*$/
const NUMERIC = /^[~≈<>+\-−$€£]*\s*[\d.,]+\s*(%|x|ms|s|m|h|k|kb|mb|gb|tb)?$/i

const INLINE =
  /(`+)(.+?)\1|\*\*(.+?)\*\*|__(.+?)__|~~(.+?)~~|\*(?!\s)(.+?)\*|(?<![\w])_(?!\s)(.+?)_(?![\w])|\[([^\]]+)\]\(([^)\s]+)\)/g

/** A line's inline markdown as styled runs: code, bold, italic, strike, link text. Not nested. */
export const spans = (text: string): Span[] => {
  const out: Span[] = []
  let at = 0
  for (const match of text.matchAll(INLINE)) {
    if (match.index > at) {
      out.push({ text: text.slice(at, match.index), style: 'plain' })
    }
    const [, , code, bold, boldU, strike, italic, italicU, link] = match
    const run: Span =
      code !== undefined
        ? { text: code.trim(), style: 'code' }
        : bold !== undefined || boldU !== undefined
          ? { text: (bold ?? boldU)!, style: 'bold' }
          : strike !== undefined
            ? { text: strike, style: 'strike' }
            : italic !== undefined || italicU !== undefined
              ? { text: (italic ?? italicU)!, style: 'italic' }
              : { text: link!, style: 'link' }
    out.push(run)
    at = match.index + match[0].length
  }
  if (at < text.length) {
    out.push({ text: text.slice(at), style: 'plain' })
  }

  return out
}

/** Columns the text takes once its inline markers are drawn as styles. */
export const width = (text: string) => spans(text).reduce((sum, run) => sum + [...run.text].length, 0)

/** A table row's cells: split on pipes outside code spans, `\|` kept as a pipe. */
const cells = (line: string) => {
  const row = line.trim().replace(/^\|/, '').replace(/(?<!\\)\|$/, '')
  const out: string[] = []
  let cell = ''
  let ticks = 0
  for (let i = 0; i < row.length; i++) {
    const char = row[i]!
    if (char === '\\' && row[i + 1] === '|') {
      cell += '|'
      i++
    } else if (char === '`') {
      ticks = ticks === 0 ? 1 : 0
      cell += char
    } else if (char === '|' && ticks === 0) {
      out.push(cell.trim())
      cell = ''
    } else {
      cell += char
    }
  }
  out.push(cell.trim())

  return out
}

const alignOf = (divider: string): Align => {
  const left = divider.startsWith(':')
  const right = divider.endsWith(':')

  return left && right ? 'center' : right ? 'right' : 'left'
}

/** Each column's alignment: the divider's markers, else right for a column of numbers. */
const alignments = (dividers: string[], rows: string[][]) =>
  dividers.map((divider, column) => {
    const marked = divider.startsWith(':') || divider.endsWith(':')
    const values = rows.map(row => row[column] ?? '').filter(value => value !== '')
    const isNumeric = values.length > 0 && values.every(value => NUMERIC.test(value))

    return marked ? alignOf(divider) : isNumeric ? 'right' : 'left'
  })

const dedent = (lines: string[], indent: number) =>
  lines.map(line => line.slice(Math.min(indent, line.length - line.trimStart().length)))

export const parse = (text: string): Block[] => {
  const lines = text.split('\n')
  const blocks: Block[] = []
  let prose: string[] = []

  const flush = () => {
    const joined = prose.join('\n').trim()
    if (joined !== '') {
      blocks.push({ kind: 'prose', text: joined })
    }
    prose = []
  }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!

    const fence = FENCE.exec(line)
    if (fence !== null) {
      const marker = fence[2]!
      const body: string[] = []
      i++
      while (i < lines.length && !lines[i]!.trim().startsWith(marker)) {
        body.push(lines[i]!)
        i++
      }
      const lastProse = prose.findLast(one => one.trim() !== '') ?? ''
      if (fence[1]!.length > 0 && LIST_ITEM.test(lastProse)) {
        prose.push(line, ...body, ...(i < lines.length ? [lines[i]!] : []))
        continue
      }
      flush()
      blocks.push({
        kind: 'code',
        language: fence[3]!.toLowerCase(),
        source: dedent(body, fence[1]!.length).join('\n'),
        isOpen: i >= lines.length,
      })
      continue
    }

    const next = lines[i + 1]
    if (line.includes('|') && next !== undefined && TABLE_DIVIDER.test(next) && next.includes('-')) {
      const header = cells(line)
      const dividers = cells(next)
      if (dividers.length === header.length) {
        flush()
        const rows: string[][] = []
        i += 2
        while (i < lines.length && lines[i]!.includes('|') && lines[i]!.trim() !== '') {
          const row = cells(lines[i]!)
          rows.push(header.map((_, column) => row[column] ?? ''))
          i++
        }
        i--
        blocks.push({ kind: 'table', align: alignments(dividers, rows), header, rows })
        continue
      }
    }

    const heading = HEADING.exec(line)
    if (heading !== null) {
      flush()
      blocks.push({ kind: 'heading', level: heading[1]!.length, text: heading[2]! })
      continue
    }

    if (RULE.test(line)) {
      flush()
      blocks.push({ kind: 'rule' })
      continue
    }

    if (QUOTE.test(line)) {
      flush()
      const body: string[] = []
      while (i < lines.length) {
        const quoted = QUOTE.exec(lines[i]!)
        if (quoted === null) {
          break
        }
        body.push(quoted[1]!)
        i++
      }
      i--
      const callout = CALLOUT.exec(body[0] ?? '')
      if (callout !== null) {
        body.shift()
      }
      blocks.push({
        kind: 'quote',
        callout: callout === null ? null : (callout[1]!.toLowerCase() as Callout),
        title: callout?.[2] ?? '',
        text: body.join('\n').trim(),
      })
      continue
    }

    prose.push(line)
  }
  flush()

  return blocks
}

/**
 * Column widths that fit `room` columns of content: each column's widest cell,
 * the widest shrunk a column at a time (to no less than 6) until they fit.
 */
export const fitColumns = (natural: number[], room: number) => {
  const widths = natural.map(one => Math.max(1, one))
  let total = widths.reduce((sum, one) => sum + one, 0)
  while (total > room) {
    const widest = widths.indexOf(Math.max(...widths))
    if (widths[widest]! <= 6) {
      break
    }
    widths[widest] = widths[widest]! - 1
    total--
  }

  return widths
}

/** Columns a run of text takes: one per code point (wide glyphs are rare in what nebula-ui wraps). */
const columnsOf = (text: string) => [...text].length

/**
 * Styled runs word-wrapped into rows of at most `room` columns, styles kept across the breaks: a word
 * longer than a row is cut, spaces at a break are dropped. An empty input is one empty row.
 */
export const wrapSpans = (runs: Span[], room: number): Span[][] => {
  const limit = Math.max(1, room)
  const rows: Span[][] = [[]]
  let used = 0
  let hasWords = false

  const add = (text: string, style: Span['style']) => {
    const row = rows[rows.length - 1]!
    const last = row[row.length - 1]
    if (last !== undefined && last.style === style) {
      last.text += text
    } else {
      row.push({ text, style })
    }
    used += columnsOf(text)
  }

  const breakRow = () => {
    const row = rows[rows.length - 1]!
    const last = row[row.length - 1]
    if (last !== undefined) {
      last.text = last.text.replace(/\s+$/, '')
    }
    rows.push([])
    used = 0
  }

  for (const run of runs) {
    for (const token of run.text.split(/(\s+)/)) {
      if (token === '') {
        continue
      }
      if (/^\s+$/.test(token)) {
        if (!hasWords) {
          // A line's own indentation stays.
          add(token.slice(0, limit - 1), run.style)
        } else if (used > 0 && used + columnsOf(token) <= limit) {
          add(token, run.style)
        } else if (used > 0) {
          breakRow()
        }
        continue
      }
      hasWords = true
      let word = [...token]
      if (used > 0 && used + word.length > limit) {
        breakRow()
      }
      while (word.length > limit) {
        add(word.slice(0, limit).join(''), run.style)
        breakRow()
        word = word.slice(limit)
      }
      if (word.length > 0) {
        add(word.join(''), run.style)
      }
    }
  }

  return rows.map(row => row.filter(run => run.text !== ''))
}

/** Text with newlines wrapped line by line; inline markdown read as styles unless `isPlain`. */
export const wrapText = (text: string, room: number, isPlain = false): Span[][] =>
  text.split('\n').flatMap(line => wrapSpans(isPlain ? [{ text: line, style: 'plain' }] : spans(line), room))

/** Columns a row of runs takes. */
export const rowWidth = (row: Span[]) => row.reduce((sum, run) => sum + columnsOf(run.text), 0)

/** A command a reply names in inline code: a slash command or `! shell` for this session, or a shell command. */
export type Command = { kind: 'slash' | 'bang' | 'shell'; text: string }

/** First words that make inline code a shell command worth copying (a path or a name is left alone). */
const SHELL_WORDS = new Set(
  (
    'claude git gh npm npx pnpm yarn bun bunx deno node python python3 pip pip3 uv uvx cargo rustup go make cmake ' +
    'docker podman kubectl brew apt sudo curl wget ssh scp rsync ls cd cat rg fd grep sed awk tsc eza bat code ' +
    'just mise nvm export source chmod mkdir rm cp mv touch echo tar unzip systemctl journalctl pacman yay paru ' +
    'sleep watch tail head find env time timeout xargs which kill pkill ps top htop du df less man ping jq yq ' +
    'sqlite3 psql mysql redis-cli ruby gem bundle rails php composer java mvn gradle dotnet swift zig nix ' +
    'terraform aws gcloud az firebase vercel netlify flyctl vite pytest jest vitest eslint prettier ruff black ' +
    'mypy poetry pipx conda tmux zsh bash sh fish nvim vim nano http nc dig open xdg-open godot gdh'
  ).split(' '),
)

/** A flag or a piece of shell syntax, which make code read as a command whatever its first word. */
const SHELL_SHAPE = /(?:^|\s)--?[a-z0-9]|&&|\|\||[|;>]|\$[A-Za-z_{(]/i

/** A program's name: lowercase, as typed at a prompt (not `Name`, `fn(x)` or `a.b.c`). */
const PROGRAM = /^[a-z][a-z0-9_+-]*$/

/** What a piece of inline code would run, or null when it reads as a name, a path or a value. */
export const commandOf = (code: string): Command | null => {
  const text = code.trim()
  if (/^\/[a-z][\w:-]*(?:\s|$)/i.test(text)) {
    return { kind: 'slash', text }
  }
  if (/^!\s*\S/.test(text)) {
    return { kind: 'bang', text: `!${text.slice(1).trimStart()}` }
  }
  const first = text.split(/\s+/)[0] ?? ''

  const isCommand = /\s/.test(text) && (SHELL_WORDS.has(first) || (PROGRAM.test(first) && SHELL_SHAPE.test(text)))

  return isCommand ? { kind: 'shell', text } : null
}

/** Where a command's link points: a host that never resolves, so nothing opens if a click reaches the terminal. */
const COMMAND_HOST = 'https://nebula-ui.invalid/command/'

/**
 * Prose with each command in inline code made a link the mod answers, and the commands by their link.
 * Code already inside a link's text is left as written.
 */
export const linkCommands = (prose: string) => {
  const commands = new Map<string, Command>()
  const text = prose.replace(/(\[?)`([^`\n]+)`/g, (whole, bracket: string, code: string) => {
    const command = bracket === '' ? commandOf(code) : null
    if (command === null) {
      return whole
    }
    const href = `${COMMAND_HOST}${commands.size}`
    commands.set(href, command)

    return `[\`${code}\`](${href})`
  })

  return { text, commands }
}

/** Fence languages that hold shell commands. */
const SHELL_FENCES = new Set(['sh', 'bash', 'shell', 'zsh', 'console', 'terminal', 'fish'])

/**
 * What a code fence would run, or null. A shell fence is one script (prompts `$ ` and comment lines dropped);
 * a fence without a language counts when every line reads as a command; one `/` or `!` line goes to the prompt.
 */
export const fenceCommand = (language: string, source: string): Command | null => {
  const lines = source
    .split('\n')
    .map(line => line.replace(/^\s*\$\s+/, ''))
    .filter(line => line.trim() !== '' && !line.trim().startsWith('#'))
  if (lines.length === 0) {
    return null
  }
  const single = lines.length === 1 ? commandOf(lines[0]!) : null
  if (single !== null && single.kind !== 'shell') {
    return single
  }
  if (SHELL_FENCES.has(language)) {
    return { kind: 'shell', text: lines.join('\n') }
  }
  if (language === '' && lines.every(line => commandOf(line)?.kind === 'shell')) {
    return { kind: 'shell', text: lines.join('\n') }
  }

  return null
}
