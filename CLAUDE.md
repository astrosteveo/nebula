# nebula

A Claude Code plugin marketplace (`.claude-plugin/marketplace.json`). Its main plugin is **nebula-ui** (`plugins/nebula-ui/`), a mod built on the Claude Code mods API (`hooks/hooks.json` → `hooks/register.tsx`). Other plugins are listed by GitHub source (`gdh`).

## nebula-ui layout

- `hooks/register.tsx`: every hook. Render sites (`ui.render` per component), `/nebula`, `/procs`, the run dialog, the process tools, session start and end.
- `hooks/markdown.ts`: pure functions. Markdown blocks, inline spans, word wrap, command detection. Test these directly.
- `hooks/procs.tsx`: the process manager. Spawn under `setsid`, stop the group, restart, adopt after a reload, and the panes that draw processes.
- `hooks/dashboard.tsx`: the band above the prompt.
- `hooks/theme.ts`: accent presets. `ACCENT` is a live `export let` that every render hook sets through `themed($)` before drawing.
- `types/index.d.ts`: the state contract. Every `$.state` key the module names must be declared here, and the file must be self-contained (no imports).
- `tests/*.test.ts(x)`: run by `claude plugin test`. Each part of the UI has a test that mounts its site.

## Developing

The installed copy reads this folder: edit, then `/reload-plugins` in a session to see the change.

Before any commit, run these from `plugins/nebula-ui`:

```sh
tsc -p .                  # type-check (needs the API types below)
claude plugin validate .  # what the engine would refuse
claude plugin test .      # the suite
```

Also run `claude plugin validate .` from the repo root to check the marketplace manifest.

`tsc` needs this Claude Code build's API types in the gitignored `.claude-plugin/types/`: `claude-code/index.d.ts` (a copy of the plugin-authoring skill's `types/claude-code.d.ts`) and a `tsconfig.json` with `noEmit`. Recopy it after a Claude Code update. Without it, the editor floods the transcript with diagnostics, and a bare `tsc` once wrote stray `.js` next to the sources.

## Mods API rules learned the hard way

The validator or the renderer refuses these. They aren't obvious from the docs.

- A function that takes `$` and lives in another file must be a `function` declaration, not an arrow function.
- A state atom must be declared in the file that reads it, even if another file declares the same one.
- Inside a hook, never name a binding `next`: that name is the continuation.
- Never place anything with `position: "absolute"`. It spills past its site when the site is scrolled partly out of view. Draw bars as rows of text (`barred`) and frames as bordered Boxes, with the label laid over the top border (`column-reverse` and `marginBottom: -1`).
- `next(e)` returns the engine's drawing as an opaque `{ type: 'engine' }`. You can place it but not edit it. An empty spinner word makes the engine pick its own, so pass a no-break space.
- Drawn text admits no control characters except tab and newline. Strip tool output with `printable()`.
- `command.describe` descriptions also go to the model as its skill list, so don't decorate them.
- `$.tool.register` can be refused. Keep it last in `session.start`, inside its own try, so the rest of the mod still loads.

## Shipping ("ship it")

Quick lane: commit straight to `main`.

1. Bump `version` in `plugins/nebula-ui/.claude-plugin/plugin.json`.
2. Turn `## [Unreleased]` in `plugins/nebula-ui/CHANGELOG.md` into the new version's entry, and point its link at the tag.
3. Run the checks above, then commit only the files meant for the release (check `git status`).
4. Tag `nebula-ui-v<version>`, push `main` and the tag, then `gh release create nebula-ui-v<version> --verify-tag` with that changelog entry as its notes.
5. Check that push's CI run (`.github/workflows/nebula-ui.yml`, on Claude Code 2.1.300 and `latest`).

## The demo

`docs/demo/nebula-ui.tape` records a real session with VHS. Re-render it from the repo root after visible changes: `vhs docs/demo/nebula-ui.tape`. It runs two short model turns on the user's account.

The tape unsets the recording session's `CLAUDE_*` markers, sets `FORCE_HYPERLINK=1` and pre-allows its tools. It waits on phrases that only appear in Claude's replies, because a phrase also in the typed prompt matches at once. Check the frames (`ffmpeg -vf fps=1/5`) before committing it.
