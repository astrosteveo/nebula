# nebula-ui

A modern restyle of Claude Code's terminal UI, built only on the mods API. Every part can be switched on or off from `/nebula`, and the choices are kept across sessions.

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
| Tool rows | `✓  ▸ Bash  npm test  12 lines`: a status glyph, the tool as a pill, its target trimmed to fit, and a summary. Click anywhere on the row to open what the tool returned: Bash output, highlighted file contents for Read, the page for WebFetch, errors, or JSON |
| Explore groups | Folded reads and searches as one line (`Shell` when they're all commands); click to unfold into tool rows |
| Spinner | Says what the turn is doing: `Kneading… thinking` |
| Turn divider | `─── ✦ Baked for 1m 4s ──────` at the end of each turn |
| Notices | Startup notices with an `ℹ` icon |
| Mode chips | Footer modes as `◉ focus` |
| Hint tail | `✦ /nebula` at the end of the hint line |
| Background hint | A shorter `⇣ ctrl+b to run in background` |
| Dashboard band | Model, git branch and changes, context gauge, rate-limit windows with reset times, cost and session age, above the prompt |

Colors follow your theme: the mod paints with theme keys (`permission` as its accent), not fixed colors.

## Limits

- The terminal surface only; the desktop app, VS Code and mobile draw as before.
- The engine's own click-to-expand on a tool row can't be followed by a mod, so nebula-ui's rows expand with their own toggle.
- A setext heading (text underlined with `---`) is read as a horizontal rule.

## Developing

`claude plugin validate plugins/nebula-ui` and `claude plugin test plugins/nebula-ui` check it; `claude --plugin-dir plugins/nebula-ui` loads it from this folder and reloads it as it changes.
