# Subagents

Isolated child `pi` processes with live TUI progress (tool log, nested children, usage gauge). Derived from [amosblomqvist/pi-subagents](https://github.com/amosblomqvist/pi-subagents).

## Builtin agents

| Agent | Tools | Purpose |
|-------|-------|---------|
| **agent** | read, write, edit, safe_bash, find_docs, fetch_content | General-purpose implementer prompt; model/thinking inherit from parent |
| **reviewer** | read, find, ls, find_docs, fetch_content | Read-only code review prompt; model/thinking inherit from parent |

## Usage

```json
{ "agent": "reviewer", "task": "Review extensions/subagents/index.ts for edge cases" }
```

Optional `alias` labels a run in the TUI without changing which agent config runs (tools, model, system prompt). Use it when reusing the blank **agent** shell with a task-specific prompt instead of an opinionated built-in like **reviewer**:

```json
{
  "agent": "agent",
  "alias": "spec-reviewer",
  "task": "Review whether the implementation matches the spec. Do not trust the implementer's report..."
}
```

`agent` still resolves the registry entry and spawn allowlist; `alias` is display-only (progress rows, tool call header, nested children, errors). Omit `alias` to show the real agent name.

Fan out with multiple `subagent` calls in one turn. Concurrency cap: `config.json` → `maxConcurrency` (default 4, must be >= 1). Nested subagents are capped by `PI_SUBAGENT_DEPTH` (max 2).

## Custom agents

Add markdown with YAML frontmatter:

| Location | Scope |
|----------|--------|
| `extensions/subagents/agents/` | Shipped with kumpul (override by name below) |
| `~/.pi/agent/agents/` | Global |
| `.pi/kumpul/agens/` | Project overrides (nearest walk-up from cwd) |

Project agents in `.pi/kumpul/agens/` are loaded automatically and override package/global agents by name. The `/subagents` setup UI writes changes there, so package defaults stay unchanged.

Required frontmatter: `name`, `description`, `tools`; optional frontmatter: `model`, `thinking`, `subagent_agents`, `extensions`, `skills`. Invalid files are skipped with a diagnostic. `tools` and `subagent_agents` must be comma-separated tool-safe identifiers; `extensions` and `skills` must be comma-separated canonical names (`lower-kebab-case`); `model` must be empty or `provider/model`; empty `model` inherits the parent agent's current model; `thinking` must be empty or one of `off`, `minimal`, `low`, `medium`, `high`, `xhigh`; empty `thinking` inherits the parent thinking level. The child receives its effective model as both active `--model` and child `--models` scope so global model cycling settings do not leak unrelated provider warnings into subagent runs.

Child spawns keep discovery disabled with `--no-extensions` and `--no-skills`. Use `extensions` as an explicit allowlist of extension names to load by name, not path:

```yaml
extensions: find-docs, pi-web-access
```

Extension names resolve from project `.pi/extensions`, currently loaded extension metadata, this package, global extensions, and installed npm package entry points.

Use `skills` as an explicit allowlist of skill names:

```yaml
skills: diagnose, test-driven-development
```

Skills resolve from project skills, currently loaded skill metadata, global skills, and this package. They are loaded with `--skill` so the child can use Pi's normal skill flow, but no skill is invoked at startup. Agents with `skills` must include `read` in `tools` so they can load full `SKILL.md` files on demand.

`cursor/*` models require a Cursor provider extension in `extensions`, for example [pi-cursor-sdk](https://www.npmjs.com/package/pi-cursor-sdk) installed globally (`pi install npm:pi-cursor-sdk`):

```yaml
extensions: pi-cursor-sdk
model: cursor/composer-2.5
```

Child spawns do not auto-load Cursor providers; they use the same explicit extension allowlist path as any other extension.

Live progress for `cursor/*` subagents is derived from Cursor SDK `thinking_*` replay in JSON mode (not `tool_execution_*`, which only native pi tool runs emit). OpenAI/Codex models still use `tool_execution_*`. Cursor may batch replay until a tool finishes; the parent UI heartbeats every 1s so duration and counters tick without excessive re-renders.

Agents that include the `subagent` tool must also set `subagent_agents` to a bounded allowlist. Without it, the agent is rejected.

## Tools

| Tool | Resolved from |
|------|----------------|
| `safe_bash`, `subagent`, `find_docs` | This package |
| `fetch_content` | Active pi tool metadata or installed npm pi-package metadata (e.g. [pi-web-access](https://www.npmjs.com/package/pi-web-access)) |

Unresolved tools, extension names, and skill names fail fast instead of being silently omitted. Raw `bash` is not available to subagents; use `safe_bash`.

`safe_bash` blocks common destructive commands and shell-install patterns (`rm -rf /`, `sudo`, `mkfs`, `curl|sh`, etc.). It is a denylist, not a sandbox; only delegate shell access to agents you trust.

## UI

`/subagents` — centered overlay to enable/disable the extension, toggle per-agent spawn, and edit **tools**, **extensions**, **skills**, **model**, and **thinking**. Edits to package/global agents are saved as project overrides under `.pi/kumpul/agens/<agent>.md`; existing project agents are edited in place. Changes apply after `/reload`.

Extension and skill pickers show only currently resolvable names with source labels (`project`, `loaded`, `package`, `global`, `npm`). Missing saved names are warned about and preserved on save; remove them manually from the `.md` file. Skills are editable only when `read` is enabled, and `read` stays locked while skills are selected.

Ctrl+O toggles collapsed (header + last 15 tool calls) vs expanded (full task, all tool calls, markdown output, nested subagent rows).

## Other extensions

Register at runtime via `globalThis.__pi_subagents.registerAgent(config)` (see upstream README pattern). Map custom tools in `resolve-tools.ts` or install under `~/.pi/agent/extensions/`.

## Disable

Use `/subagents` or project config:

```yaml
# .pi/kumpul/config.yaml
subagents:
  enabled: false
  disabledAgents:
    - reviewer
```
