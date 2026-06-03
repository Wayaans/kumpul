# polish-statusline

Redesigns the pi footer to a Codex CLI–style status bar using active theme colors.

## Behavior

On session start, replaces the built-in footer with a themed layout:

- **codex** (default): path · branch · session on line 1; tokens │ context bar │ model on line 2
- **compact**: single line with path, tokens, context bar, and model
- **minimal**: context bar and model only

Context usage renders as a `█░` bar colored with `success` / `warning` / `error` from the theme. Path basename uses `text`, parent segments `dim`. Branch uses `accent` (or `warning` when detached). Model id uses `accent`; thinking level uses theme `thinking*` tokens when the model supports reasoning.

Extension statuses from `ctx.ui.setStatus()` still appear on an extra dim line when present.

## Commands

- **/polish-statusline** — re-apply footer from saved config
- **/polish-statusline** `codex` | `compact` | `minimal` — switch variant (persisted)
- **/polish-statusline** `cycle` — rotate variants (persisted)
- **/polish-statusline** `off` — restore pi default footer (persisted)

## Config

Slash-command changes are written to `.pi/kumpul/config.yaml` in the project (survives `/reload` and new sessions). Defaults live in `extensions/polish-statusline/config.yaml`.

```yaml
polish-statusline:
  enabled: true
  variant: compact
```

## Install

Extension-local dependency: run `npm install` in `extensions/polish-statusline/`. Loaded automatically with `@wayanary/kumpul`.
