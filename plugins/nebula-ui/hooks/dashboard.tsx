import { atom, update } from 'claude-code'
import type { Elements, EngineInterface, RenderElement } from 'claude-code'

import type { Dash } from '../types'
import { ACCENT, tone } from './theme'

export const dash = atom({ plugin: 'nebula-ui', key: 'dash' } as const, null as Dash | null)

/** `git status` in the session's directory as branch, ahead, behind and changed files; null outside a repo. */
async function gitState($: EngineInterface): Promise<Dash['git']> {
  try {
    const run = await $.process.run(['git', 'status', '--porcelain=v2', '--branch'], { timeoutMs: 5000 })
    if (run.exitCode !== 0) {
      return null
    }
    const lines = run.stdout.split('\n')
    const head = lines.find(line => line.startsWith('# branch.head '))?.slice('# branch.head '.length) ?? '?'
    const counts = /^# branch\.ab \+(\d+) -(\d+)/m.exec(run.stdout)

    return {
      branch: head === '(detached)' ? 'detached' : head,
      ahead: Number(counts?.[1] ?? 0),
      behind: Number(counts?.[2] ?? 0),
      changed: lines.filter(line => line !== '' && !line.startsWith('#')).length,
    }
  } catch {
    return null
  }
}

/** Reads the figures the band draws and stores them; never throws, a failed read keeps the last. */
export async function gather($: EngineInterface) {
  try {
    const [usage, model, git, now] = await Promise.all([
      $.session.usage(),
      $.session.model(),
      gitState($),
      $.clock.now(),
    ])
    await update($, dash, () => ({
      model,
      context: {
        percent: usage.context.percent ?? null,
        tokens: usage.context.tokens ?? null,
        window: usage.context.window,
      },
      limits: usage.rateLimits.map(limit => ({
        kind: limit.kind,
        percent: limit.percentUsed,
        resetsAt: limit.resetsAt ?? null,
      })),
      cost: usage.cost?.usd ?? null,
      startedAt: usage.startedAt,
      now,
      git,
    }))
  } catch (error) {
    // The band keeps the figures it has.
    $.ui.log(`nebula-ui: dashboard figures not read: ${String(error)}`, { to: 'debug' })
  }
}

/** `claude-opus-5-5[1m]` as `opus 5.5 · 1m`; a dated id (`claude-haiku-4-5-20251001`) as `haiku 4.5`. */
export const modelName = (id: string) => {
  const suffix = /\[(.*)\]$/.exec(id)?.[1]
  const short = id
    .replace(/\[.*\]$/, '')
    .replace(/^claude-/, '')
    .replace(/-\d{8}$/, '')
    .replace(/-(\d+)-(\d+)$/, ' $1.$2')
    .replace(/-(\d+)$/, ' $1')

  return suffix === undefined ? short : `${short} · ${suffix}`
}

const LIMITS: Record<string, string> = { five_hour: '5h', seven_day: '7d', spend_limit: 'spend' }

const limitName = (kind: string) => LIMITS[kind] ?? kind.replace(/^seven_day_/, '7d ').replace(/_/g, ' ')

/** A span of time as the band shows it: seconds under a minute, then minutes, hours and days. */
const span = (ms: number) => {
  if (!Number.isFinite(ms) || ms < 0) {
    return '0s'
  }
  if (ms < 60_000) {
    return `${Math.floor(ms / 1000)}s`
  }
  const minutes = Math.round(ms / 60_000)
  const hours = Math.floor(minutes / 60)
  const days = Math.floor(hours / 24)

  return days > 0 ? `${days}d ${hours % 24}h` : hours > 0 ? `${hours}h ${minutes % 60}m` : `${minutes}m`
}

const gauge = (percent: number, cells: number) => {
  const filled = Math.min(cells, Math.max(0, Math.round((percent / 100) * cells)))

  return '▰'.repeat(filled) + '▱'.repeat(cells - filled)
}

/** Dollars as the band shows them: two places, and `<$0.01` for a turn cheaper than a cent. */
const money = (usd: number) => (usd > 0 && usd < 0.01 ? '<0.01' : usd.toFixed(2))

/**
 * One row of figures, each behind a dim bar; the row wraps where the band is narrow, and a figure that
 * starts a wrapped row carries its bar with it, so no bar is left at the end of one.
 */
export const drawBand = ({ Box, Text }: Elements['terminal'], d: Dash, extra?: RenderElement) => {
  const items: RenderElement[] = [
    <Text>
      <Text color={ACCENT}>✦ </Text>
      <Text weight="bold">{modelName(d.model)}</Text>
    </Text>,
  ]

  if (d.git !== null) {
    items.push(
      <Text>
        <Text color="suggestion">⎇ </Text>
        {d.git.branch}
        {d.git.changed > 0 && <Text color="warning"> ±{d.git.changed}</Text>}
        {d.git.ahead > 0 && <Text color="success"> ↑{d.git.ahead}</Text>}
        {d.git.behind > 0 && <Text color="error"> ↓{d.git.behind}</Text>}
      </Text>,
    )
  }

  const percent = d.context?.percent
  if (percent !== null && percent !== undefined && Number.isFinite(percent)) {
    items.push(
      <Text>
        <Text dimColor>ctx </Text>
        <Text color={tone(percent)}>{gauge(percent, 10)}</Text> {Math.round(percent)}%
      </Text>,
    )
  }

  for (const limit of d.limits ?? []) {
    if (!Number.isFinite(limit.percent)) {
      continue
    }
    const resets = limit.resetsAt === null ? NaN : Date.parse(limit.resetsAt) - d.now
    items.push(
      <Text>
        <Text dimColor>{limitName(limit.kind)} </Text>
        <Text color={tone(limit.percent)}>{gauge(limit.percent, 6)}</Text> {Math.round(limit.percent)}%
        {Number.isFinite(resets) && resets > 0 && <Text dimColor> ↻ {span(resets)}</Text>}
      </Text>,
    )
  }

  if (d.cost !== null && Number.isFinite(d.cost) && d.cost >= 0) {
    items.push(
      <Text>
        <Text color="success">$</Text>
        {money(d.cost)}
      </Text>,
    )
  }

  items.push(<Text dimColor>⏱ {span(d.now - d.startedAt)}</Text>)

  if (extra !== undefined) {
    items.push(extra)
  }

  return (
    <Box flexDirection="row" flexWrap="wrap" columnGap={1}>
      {items.map((item, index) =>
        index === 0 ? (
          item
        ) : (
          // A row, not a text: the chip is a button, which the engine refuses inside a text.
          <Box flexDirection="row">
            <Text color="inactive">│ </Text>
            {item}
          </Box>
        ),
      )}
    </Box>
  )
}
