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

export type Span = { text: string; style: 'plain' | 'code' | 'bold' | 'italic' | 'strike' | 'link' }

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
