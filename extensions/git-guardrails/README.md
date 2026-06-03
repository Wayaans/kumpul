# git-guardrails

Blocks dangerous git commands invoked through bash.

## Commands

- **/guardrails:git** `[toggle|enable|disable|status]` — show or change blocking state (persists to `.pi/kumpul/config.yaml`).

## Blocked patterns

- `git push`, `push --force`
- `git reset --hard`, `reset --hard`
- `git clean -f` / `-fd` / `--force`
- `git branch -D`
- `git checkout .`
- `git restore .`

## Config

Default: **disabled** (`config.yaml` in this directory). Override per project:

```yaml
git-guardrails:
  enabled: true
```

## Install

```bash
npm install
```

Run inside `extensions/git-guardrails/` after clone or when deps change.
