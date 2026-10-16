import { expect, mock, test } from 'claude-code/testing'

import { modelName } from '../hooks/dashboard'

test('model ids read as names', async () => {
  expect(modelName('claude-opus-5-5')).toBe('opus 5.5')
  expect(modelName('claude-sonnet-5-5[1m]')).toBe('sonnet 5.5 · 1m')
  expect(modelName('claude-fable-5-1')).toBe('fable 5.1')
  expect(modelName('claude-haiku-4-5-20251001')).toBe('haiku 4.5')
})

test('the band draws the model, branch, context gauge, limits and cost', async ($, on) => {
  mock.store(on)
  mock.clock(on, { now: Date.parse('2026-10-14T12:00:00Z') })
  on('session.usage', () => ({
    value: {
      startedAt: Date.parse('2026-10-14T11:18:00Z'),
      context: { tokens: 68_000, window: 200_000, percent: 34 },
      rateLimits: [{ kind: 'five_hour', percentUsed: 91, resetsAt: '2026-10-14T14:30:00Z' }],
      cost: { usd: 1.237 },
    },
  }))
  on('session.model', () => ({ value: 'claude-opus-5-5' }))
  on('process.run', () => ({
    value: {
      exitCode: 0,
      stdout:
        '# branch.oid abc\n# branch.head main\n# branch.ab +2 -0\n1 .M N... 100644 100644 100644 a b hooks/x.ts\n? new.ts\n',
      stderr: '',
      isStdoutTruncated: false,
      isStderrTruncated: false,
    },
  }))
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('command.register', ($, e) => ({ value: { command: e.name } }))
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })

  const band = await $.ui.mount({
    plugin: 'nebula-ui',
    surface: 'terminal',
    component: 'AbovePrompt',
    props: {
      hasSurvey: false,
      isWorking: false,
      maxRows: 10,
      bodyColumns: 120,
      scroll: { offset: 0, bodyRows: 10 },
      view: {},
    },
  })
  const text = (await band.drawn()) && (await band.findAll({ type: 'Text' })).map(one => one.text).join(' ')

  expect(text).toContain('opus 5.5')
  expect(text).toContain('main')
  expect(text).toContain('±2')
  expect(text).toContain('↑2')
  expect(text).toContain('▰▰▰▱▱▱▱▱▱▱ 34%')
  expect(text).toContain('5h')
  expect(text).toContain('↻ 2h 30m')
  expect(text).toContain('1.24')
  expect(text).toContain('⏱ 42m')
})
