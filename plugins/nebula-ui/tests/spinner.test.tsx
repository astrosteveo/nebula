import { expect, test } from 'claude-code/testing'

test('the spinner keeps the engine line and puts a pill for its mode before it', async ($, on) => {
  on('ui.render', { component: 'Spinner' }, ($, e) => {
    const { Text } = $.ui.resolve(e)

    return <Text>✻ {e.props.word}… (12s · ↓ 300 tokens)</Text>
  })
  const spinner = await $.ui.mount({
    plugin: 'nebula-ui',
    surface: 'terminal',
    component: 'Spinner',
    props: { word: 'Kneading', message: null, suffix: '…', mode: 'thinking' },
  })

  expect((await spinner.find({ type: 'Text', text: /✦ thinking/ }))?.props).toMatchObject({ color: 'permission' })
  expect(await spinner.find({ type: 'Text', text: /Kneading… \(12s/ })).toBeDefined()
})
