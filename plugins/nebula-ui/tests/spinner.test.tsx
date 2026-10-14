import { expect, test } from 'claude-code/testing'

test('the spinner puts its mode and its word in pills, the engine keeping its glyph, time and tokens', async ($, on) => {
  on('ui.render', { component: 'Spinner' }, ($, e) => {
    const { Text } = $.ui.resolve(e)

    return (
      <Text>
        ✻ {e.props.word}
        {e.props.suffix === '' ? '' : '…'} (12s · ↓ 300 tokens)
      </Text>
    )
  })
  const spinner = await $.ui.mount({
    plugin: 'nebula-ui',
    surface: 'terminal',
    component: 'Spinner',
    props: { word: 'Kneading', message: null, suffix: '…', mode: 'thinking' },
  })

  expect((await spinner.find({ type: 'Text', text: /✦ thinking/ }))?.props).toMatchObject({ color: 'permission' })
  expect((await spinner.find({ type: 'Text', text: / Kneading… / }))?.props).toMatchObject({ color: 'claude' })
  expect(await spinner.find({ type: 'Text', text: /^✻ \u00a0 \(12s/ })).toBeDefined()
})

test('a spinner mode nebula-ui does not know draws a plain pill, not a failure', async ($, on) => {
  on('ui.render', { component: 'Spinner' }, ($, e) => {
    const { Text } = $.ui.resolve(e)

    return <Text>✻ (1s)</Text>
  })
  const spinner = await $.ui.mount({
    plugin: 'nebula-ui',
    surface: 'terminal',
    component: 'Spinner',
    props: { word: 'Kneading', message: null, suffix: '…', mode: 'dreaming' as 'thinking' },
  })

  expect(await spinner.find({ type: 'Text', text: /◆ dreaming/ })).toBeDefined()
})
