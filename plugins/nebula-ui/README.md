# nebula-ui

A modern restyle of Claude Code's terminal UI, built only on the mods API. Every part can be switched on or off from `/nebula`, and the choices are kept across sessions.

![nebula-ui in a real Claude Code session: a tour reply with a table, a callout and a runnable code frame; Claude starting a server and checking it with the process tools; /procs; and the /nebula panel flipping tool rows off and on](../../docs/demo/nebula-ui.gif)

<sub>A real session, recorded with [VHS](https://github.com/charmbracelet/vhs) from [`docs/demo/nebula-ui.tape`](../../docs/demo/nebula-ui.tape) ([MP4](../../docs/demo/nebula-ui.mp4)).</sub>

## Install

```
/plugin marketplace add astrosteveo/nebula
/plugin install nebula-ui@nebula
```

## What it changes

| Part | Change |
|:-----|:-------|
| Prompt bar | Your prompts sit behind a thin accent bar instead of a grey box |
| Rich markdown | Code fences in a frame with the language and line count on the top edge, highlighted; `diff` fences in diff colors; tables redrawn with a rounded frame, an accent header, alignment and inline styles; headings with glyphs; `> [!NOTE]`-style callouts; blockquotes and rules |
| Tool rows | `✓  ▸ Bash  npm test  12 lines`: a status glyph, the tool as a pill, its target trimmed to fit, and a summary (lines of output, files found, search results, an HTTP status). Click anywhere on the row to open what the tool returned: Bash output and a diff of each file the command changed, highlighted file contents for Read, the page for WebFetch, errors, or JSON. Under the row, only an error or the files changed stay, and a click there opens the row too |
| Clickable commands | In a reply, a command in inline code is a link. A click puts `/command` or `! command` in your prompt for your Enter (copied instead if you're typing); a shell command opens a dialog to **run it here** or copy it. Every code frame has `⧉ copy` on its top border, and a frame that holds commands (a `sh`/`bash`/`console` fence, or one whose lines all read as commands) also has `▶ run`, or `↵ prompt` for a lone `/` command. `▶ run` starts the block at once and draws its output in the same frame, under the code, with `■ stop` on the border while it runs. Clicks reach the mod in fullscreen |
| Processes | `/procs` lists every command you ran from a reply: status, runtime, its last lines with URLs as links (a server on `0.0.0.0` opens as `localhost`), and `■ stop` (the whole process group: it's started with `setsid`), `↻ restart` and `⤢ follow`, a pane that streams one process's log. The band shows `⚙ N running`. They stop when the session ends; after `/reload-plugins` one still running is marked detached and can still be stopped |
| Process tools | Claude can see them too: `processes` lists them or reads one's output, and `process_control` starts, stops or restarts one, so "check the dev server" needs no copied logs. The engine asks your permission for them as for any tool |
| Open shell output | Bash rows and `Shell` groups start open on what they printed; a click closes one, and switching this off in `/nebula` starts them closed |
| Explore groups | Folded reads and searches as one line (`Shell` when they're all commands); click to unfold into tool rows |
| Spinner | Two pills, what the turn is doing (`✦ thinking`, `✎ writing`, `⚙ running tools`) and its word (`Kneading…`) in Claude's color, before the engine's animated glyph, time and tokens |
| Turn divider | `─── ✦ Baked for 1m 4s ──────` at the end of each turn |
| Notices | Startup notices with an `ℹ` icon |
| Mode chips | Footer modes as `◉ focus` |
| Hint tail | `✦ /nebula` at the end of the hint line |
| Background hint | A shorter `⇣ ctrl+b to run in background` |
| Command output | What a slash command printed, behind an accent bar (red with `✗ failed` for an error) instead of a dim `⎿` line |
| Dashboard band | Model, git branch and changes, context gauge, rate-limit windows with reset times, cost and session age, above the prompt |

**Frame width** (in `/nebula`, key `w`): code and output frames fill the width (the default), fit their content, or hold to 80, 100 or 120 columns.

Colors follow your theme: the mod paints with theme keys (`permission` as its accent), not fixed colors.

## Limits

- The terminal surface only; the desktop app, VS Code and mobile draw as before.
- The `/` command menu is the engine's own: its descriptions also go to the model as the list of skills, so nebula-ui leaves them as they are.
- The echo of a local slash command (`/plugin`, `/reload-plugins`) keeps the engine's grey row: the API exposes no site for it.
- The engine's own click-to-expand on a tool row can't be followed by a mod, so nebula-ui's rows expand with their own toggle.
- A setext heading (text underlined with `---`) is read as a horizontal rule.
- Quotes, callouts and command output are drawn as wrapped text with inline styles (code, bold, links), so a list or code fence inside one shows as written.

## Changes

See [CHANGELOG.md](CHANGELOG.md) for what each version added, changed and fixed.

## Developing

`claude plugin validate plugins/nebula-ui` and `claude plugin test plugins/nebula-ui` check it; `claude --plugin-dir plugins/nebula-ui` loads it from this folder and reloads it as it changes.
