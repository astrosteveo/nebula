# Changelog

All notable changes to nebula-ui. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow [Semantic Versioning](https://semver.org/).

## [Unreleased]

## [0.1.8] - 2026-10-14

The first tagged [release](https://github.com/astrosteveo/nebula/releases/tag/nebula-ui-v0.1.8).

### Added

- Two tools for Claude: `processes` lists what you started from nebula-ui, or reads one's output, and `process_control` starts, stops or restarts one. Claude can check your dev server without you pasting logs.
- `/procs` rows have `↻` restart and `⤢` follow, a pane that streams one process's log.
- URLs in process output are links, and a server bound to `0.0.0.0` opens as `localhost`.
- A demo recording of a real session in `docs/demo`, with the VHS tape that makes it.

### Fixed

- The spinner's pills stay beside its line when Claude Code shows a tip under it.
- If the host refuses the tools, the rest of the mod still loads.

## [0.1.7] - 2026-10-14

### Added

- Commands in a reply's inline code are links. A `/` or `!` command goes to your prompt for your Enter; a shell command opens a dialog to run it here or copy it.
- Code frames have `⧉ copy`, and a frame of shell commands has `▶ run`: it runs in place, with its status and output drawn under the code and `■ stop` on the border while it runs.
- A process manager: `/procs` lists every command started this way, with its output and a stop that ends its whole process group. The dashboard band shows `⚙ N running`, and everything stops when the session ends.
- A frame width setting in `/nebula`: fill, fit the content, or 80, 100 or 120 columns.

## [0.1.6] - 2026-10-14

### Added

- Bash rows and Shell groups start open on what they printed, with a `/nebula` switch to start them closed.

### Removed

- The glyphs in the `/` command menu. Claude Code sends those descriptions to the model as its list of skills, so the decoration cost context on every turn.

### Fixed

- Text drawn from tool output drops terminal color codes and other control characters, which the renderer refuses.

## [0.1.5] - 2026-10-14

### Added

- Grep, Glob, WebSearch and WebFetch rows say what they found and open on the files, matches or links. MCP text results open as markdown.
- Glyphs in the `/` command menu marking built-in, plugin and nebula-ui commands (removed in 0.1.6).

### Fixed

- Bars (prompts, quotes, callouts, command output) and table dividers are drawn as text, so none spills past its block when it's scrolled partly out of view.
- Agent and plan-mode results keep Claude Code's own block under their row.
- An unknown spinner mode draws a plain pill instead of failing.

## [0.1.4] - 2026-10-14

### Changed

- The block under a standalone tool row is drawn by the mod: nothing for a plain run, one line for an error or the files a command changed. A click on it opens the row instead of Claude Code's grey expansion.
- An opened Bash row shows a diff of each file it changed and leaves Claude Code's own notes out of stderr.
- Bash rows drop a leading `cd` or variable step, code frames name their length only from five lines, and an opened row no longer repeats it.

### Fixed

- Frame sides no longer spill past the frame when it's scrolled partly out of view.

## [0.1.3] - 2026-10-14

### Changed

- The spinner's word moves into a pill of its own, in Claude's color, beside the mode pill.

### Fixed

- The spinner's pills sit beside its line, not on the blank row above it.

## [0.1.2] - 2026-10-14

### Added

- A pill before the spinner line saying what the turn is doing: thinking, writing, running tools, preparing or connecting.

## [0.1.1] - 2026-10-14

### Added

- Slash command output sits behind an accent bar, red with a `✗ failed` header for an error.

### Changed

- The prompt bar also marks rows sent from your phone, and rows Claude Code doesn't stamp with an origin.

## [0.1.0] - 2026-10-14

### Added

- The first version: prompt bars, rich markdown with framed code and redrawn tables, tool rows that open on a click to their output, a dashboard band above the prompt, and touches to the spinner, footer and turn divider. Each part switches on or off from `/nebula`.

[Unreleased]: https://github.com/astrosteveo/nebula/compare/nebula-ui-v0.1.8...HEAD
[0.1.8]: https://github.com/astrosteveo/nebula/releases/tag/nebula-ui-v0.1.8
[0.1.7]: https://github.com/astrosteveo/nebula/commit/cb80b96
[0.1.6]: https://github.com/astrosteveo/nebula/commit/4ce3dd0
[0.1.5]: https://github.com/astrosteveo/nebula/commit/5cfc8c0
[0.1.4]: https://github.com/astrosteveo/nebula/commit/4c12356
[0.1.3]: https://github.com/astrosteveo/nebula/commit/a466c4c
[0.1.2]: https://github.com/astrosteveo/nebula/commit/cf97e3b
[0.1.1]: https://github.com/astrosteveo/nebula/commit/64a871d
[0.1.0]: https://github.com/astrosteveo/nebula/commit/79dec5a
