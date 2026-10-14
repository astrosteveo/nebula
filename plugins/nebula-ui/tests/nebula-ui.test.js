import { expect, mock, test } from 'claude-code/testing';
const PLUGIN = 'nebula-ui';
const bashRow = {
    tool_use_id: 'toolu_1',
    tool: 'Bash',
    input: { command: 'npm test\n  --watch' },
    isRunning: true,
    isErrored: false,
    isInterrupted: false,
};
const panel = {
    title: 'Nebula UI',
    isFocused: true,
    bodyColumns: 80,
    placement: 'inline',
    scroll: { offset: 0, bodyRows: 20 },
    view: {},
};
test('a tool row shows the tool as a pill, the first line of its target and its status', async ($) => {
    const row = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', component: 'ToolUse', props: bashRow });
    const line = (await row.find({ type: 'Button' }))?.text ?? '';
    expect(line).toContain('npm test');
    expect(line).not.toContain('--watch');
    expect(await row.find({ text: 'running' })).toBeDefined();
    expect(await row.find({ text: / Bash / })).toBeDefined();
});
test('the turn divider formats the duration', async ($) => {
    const line = await $.ui.mount({
        plugin: PLUGIN,
        surface: 'terminal',
        component: 'TurnDuration',
        props: { word: 'Baked', durationMs: 64_000 },
    });
    expect(await line.find({ text: /Baked for 1m 4s/ })).toBeDefined();
});
test('the panel switches a part off and back on', async ($, on) => {
    mock.store(on);
    const pane = await $.ui.mount({
        plugin: PLUGIN,
        surface: 'terminal',
        component: 'Pane',
        requestId: 'nebula-ui',
        props: panel,
    });
    expect((await pane.find({ key: 'ToolUse' }))?.text).toContain('◉ Tool rows');
    await pane.press({ key: 'ToolUse' });
    expect((await pane.find({ key: 'ToolUse' }))?.text).toContain('○ Tool rows');
    await pane.press({ key: 'ToolUse' });
    expect((await pane.find({ key: 'ToolUse' }))?.text).toContain('◉ Tool rows');
});
test('a finished row opens on its chevron to show what the tool returned', async ($) => {
    const row = await $.ui.mount({
        plugin: PLUGIN,
        surface: 'terminal',
        component: 'ToolUse',
        props: { ...bashRow, isRunning: false, output: { stdout: 'ok\nall good', stderr: '', interrupted: false } },
    });
    expect(await row.find({ type: 'Text', text: /▸ Bash/ })).toBeDefined();
    expect(await row.find({ type: 'Text', text: '2 lines' })).toBeDefined();
    expect(await row.find({ type: 'Code' })).toBeUndefined();
    await row.press({ key: 'open-toolu_1' });
    expect(await row.find({ type: 'Text', text: /▾ Bash/ })).toBeDefined();
    expect((await row.find({ type: 'Code' }))?.props).toMatchObject({ source: 'ok\nall good' });
});
test('a long target is trimmed so the whole row stays one clickable line', async ($) => {
    const path = `/home/someone/${'deep/'.repeat(40)}file.ts`;
    const row = await $.ui.mount({
        plugin: PLUGIN,
        surface: 'terminal',
        component: 'ToolUse',
        props: { ...bashRow, tool: 'Read', input: { file_path: path }, isRunning: false, output: undefined },
        viewport: { columns: 80, rows: 24 },
    });
    const line = (await row.find({ type: 'Button' }))?.text ?? '';
    expect([...line].length).toBeLessThanOrEqual(76);
    expect(line).toContain('/home/some');
    expect(line).toContain('…');
    expect(line).toContain('file.ts');
});
test('a slash command echo gets the prompt bar, the command in the accent color', async ($) => {
    const row = await $.ui.mount({
        plugin: PLUGIN,
        surface: 'terminal',
        component: 'UserMessage',
        props: { text: '/plugin install nebula-ui', origin: { kind: 'unclassified' }, isExpanded: true },
    });
    const runs = await row.findAll({ type: 'Text', text: '/plugin' });
    expect(runs.some(run => run.text === '/plugin' && run.props.color === 'permission')).toBe(true);
    expect(await row.find({ type: 'Text', text: /▌/ })).toBeDefined();
});
test('a teammate message is left to the engine', async ($) => {
    const mount = $.ui.mount({
        plugin: PLUGIN,
        surface: 'terminal',
        component: 'UserMessage',
        props: { text: 'hi', origin: { kind: 'peer' }, isExpanded: false, from: { name: 'reviewer' } },
    });
    await expect(mount).rejects.toThrow(/no implementation for ui.render/);
});
test('a command prints behind an accent bar, an error behind a red one', async ($) => {
    const props = { command: 'reload-plugins', args: '', text: 'Reloaded: 5 plugins', isErrored: false };
    const done = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', component: 'CommandOutput', props });
    expect(await done.find({ type: 'Markdown', text: 'Reloaded: 5 plugins' })).toBeDefined();
    expect((await done.find({ type: 'Text', text: /▎/ }))?.props).toMatchObject({ color: 'permission' });
    expect(await done.find({ type: 'Text', text: /✗/ })).toBeUndefined();
    const failed = await $.ui.mount({
        plugin: PLUGIN,
        surface: 'terminal',
        component: 'CommandOutput',
        props: { ...props, text: 'No such plugin', isErrored: true },
    });
    expect((await failed.find({ type: 'Text', text: /▎/ }))?.props).toMatchObject({ color: 'error' });
    expect(await failed.find({ type: 'Text', text: /✗ failed/ })).toBeDefined();
});
