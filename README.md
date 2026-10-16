# nebula

Claude Code mods and plugins by Steven Mosley.

## Install

```
/plugin marketplace add astrosteveo/nebula
/plugin install <mod>@nebula
```

## Mods

![nebula-ui in a real Claude Code session](docs/demo/nebula-ui.gif)

- [nebula-ui](plugins/nebula-ui/): a modern restyle of Claude Code's UI (prompt bars, rich markdown and tables, clickable tool rows, a live dashboard band), each part switchable from `/nebula`.

Plugins that aren't mods, such as gdh and github-lite, are in [astrocode](https://github.com/astrosteveo/astrocode).

## Layout

- Small mods live in `plugins/<name>/`, each with its own `.claude-plugin/plugin.json`, and are listed in `.claude-plugin/marketplace.json` with `"source": "./plugins/<name>"`.
