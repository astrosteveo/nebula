# nebula

Claude Code mods and plugins by Steven Mosley.

## Install

```
/plugin marketplace add astrosteveo/nebula
/plugin install <mod>@nebula
```

## Layout

- Small mods live in `plugins/<name>/`, each with its own `.claude-plugin/plugin.json`, and are listed in `.claude-plugin/marketplace.json` with `"source": "./plugins/<name>"`.
- Plugins that ship alongside a standalone tool (like `gdh`) live in that tool's repo and are listed here with a GitHub source.
