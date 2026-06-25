# polish-statusline

Redesigns the pi footer to a Codex CLI–style status bar using active theme colors.

## Behavior

On session start, replaces the built-in footer with a minimal single-line layout:

- Right side: extension statuses from `ctx.ui.setStatus()`, then current path and git branch/status, separated by `│`.

Path basename uses `text`, parent segments `dim`. When `git` is installed and cwd is in a repo, branch status appears right of the path: `⎇ branch` in `accent` (`warning` when detached), `*` unstaged (`warning`), `+` staged (`success`), `⇡N` / `⇣N` ahead/behind (`dim`). Token stats, context usage, model info, and cost are intentionally hidden.

## Commands

- **/polish-statusline** — re-apply footer from saved config
- **/polish-statusline** `codex` | `compact` | `minimal` — accepted for compatibility; all variants render the same minimal footer
- **/polish-statusline** `cycle` — accepted for compatibility
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
