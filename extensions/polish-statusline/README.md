# polish-statusline

Redesigns the pi footer to a minimal Codex CLI–style status bar using active theme colors.

## Behavior

On session start, replaces the built-in footer with a single-line layout:

- Right side: extension statuses from `ctx.ui.setStatus()`, then current path and git branch/status, separated by `│`.

Path basename uses `text`, parent segments `dim`. When `git` is installed and cwd is in a repo, branch status appears right of the path: `⎇ branch` in `accent` (`warning` when detached), `*` unstaged (`warning`), `+` staged (`success`), `⇡N` / `⇣N` ahead/behind (`dim`). Token stats, context usage, model info, and cost are intentionally hidden.

No command or variant selection is registered; this footer is always the default for the extension.

## Install

Loaded automatically with `@wayanary/kumpul`.
