# Subagents

Isolated child `pi` processes with live TUI progress (tool log, nested children, usage gauge). Derived from [amosblomqvist/pi-subagents](https://github.com/amosblomqvist/pi-subagents).

## Single subagent template

Kumpul ships one subagent template: **agent**. The tool API does not expose an `agent` selector; every call uses the same template and labels the run with `alias`.

Default tools: `read`, `write`, `edit`, `safe_bash`, `find`, `grep`, `ls`, `find_docs`.

The default template is intentionally small. The child process still receives pi's normal system prompt, project context files, and the appended subagent prompt.

## Usage

```json
{
  "alias": "code-reviewer",
  "task": "Review extensions/subagents/index.ts for edge cases. Read-only: do not edit files."
}
```

`alias` is optional. If omitted, the parent generates a local random Greek mythology name such as `athena`, `hermes`, or `daedalus`. Explicit aliases must not contain digits.

`model`, `thinking`, and `task_preamble` are per-call overrides intended for project templates (see below). `task_preamble` is inserted into the child input after active skill commands and before `Task: ...`.

Use `active_skills` to force skills at child startup, equivalent to starting the child input with `/skill:<name>`:

```json
{
  "alias": "diagnoser",
  "active_skills": ["diagnose"],
  "task": "Debug this failing test and report the minimal fix."
}
```

`active_skills` are automatically included in the child skill allowlist. Skills still require `read` in the configured tool list.

Fan out with multiple `subagent` calls in one turn. Concurrency cap: `config.json` → `maxConcurrency` (default 4, must be >= 1). Nested subagents are capped by `PI_SUBAGENT_DEPTH` (max 2).

## Project templates

Trusted projects can define delegation recipes for the main agent at:

```text
.pi/kumpul/templates/*.md
```

Template files are hand-written. `/subagents` includes a **Create project template** action that writes a valid stub; if the requested name already exists, it creates `name-copy.md`, `name-copy-two.md`, etc. Templates are discovered on each user message, so no `/reload` is needed after edits.

Format:

```yaml
---
name: implementer
description: Implements structured plans with high code quality
model: openai-codex/gpt-5.4
thinking: xhigh
active_skills: test-driven-development
---

You are the implementer subagent.
Follow the plan exactly.
```

Frontmatter:

- required: `name`, `description`
- optional: `model`, `thinking`, `active_skills`
- unsupported: `tools`, `skills`, `extensions`
- `name` must match the filename stem and obey alias rules, including no digits

The main agent sees template metadata only. If the template body is non-empty, metadata includes `preamble_path`; the main agent should read that file only when using the template, then pass the markdown body after frontmatter as `task_preamble`.

Template mapping:

| Template field | `subagent` param |
|----------------|------------------|
| `name` | `alias` |
| `model` | `model` |
| `thinking` | `thinking` |
| `active_skills` | `active_skills` |
| body | `task_preamble` |

## Project override

The package default can be overridden per trusted project at:

```text
.pi/kumpul/subagent.md
```

Project overrides are ignored unless pi marks the project trusted.

Format:

```yaml
---
description: General-purpose subagent template
tools: edit, find, find_docs, grep, ls, read, safe_bash, write
extensions:
skills:
active_skills:
model: openai-codex/gpt-5.3-codex-spark
thinking: medium
---

You are a subagent. Follow the delegated task exactly.
```

Frontmatter:

- required: `description`, `tools`
- optional: `extensions`, `skills`, `active_skills`, `model`, `thinking`
- `tools` must be comma-separated tool-safe identifiers
- `extensions`, `skills`, and `active_skills` must be comma-separated canonical names (`lower-kebab-case`)
- empty `model` inherits the parent agent's current model
- empty `thinking` inherits the parent thinking level

## Child resources

Child spawns keep discovery disabled with `--no-extensions` and `--no-skills`. Use `extensions` as an explicit allowlist of extension names to load by name, not path:

```yaml
extensions: find-docs, pi-web-access
```

Use `skills` as an explicit allowlist of skills the child may load on demand:

```yaml
skills: diagnose, test-driven-development
```

Use `active_skills` for skills that should be invoked immediately at subagent startup:

```yaml
active_skills: diagnose
```

`cursor/*` models require a Cursor provider extension in `extensions`, for example [pi-cursor-sdk](https://www.npmjs.com/package/pi-cursor-sdk) installed globally (`pi install npm:pi-cursor-sdk`):

```yaml
extensions: pi-cursor-sdk
model: cursor/composer-2.5
```

## Tools

| Tool | Resolved from |
|------|---------------|
| `safe_bash`, `subagent`, `find_docs` | This package |
| `fetch_content` | Not bundled; install/configure [pi-web-access](https://www.npmjs.com/package/pi-web-access) and add it to the subagent config if needed |

Unresolved tools, extension names, and skill names fail fast instead of being silently omitted. Raw `bash` is not available by default; use `safe_bash`.

`safe_bash` blocks common destructive commands and shell-install patterns (`rm -rf /`, `rm -rf .`, `rm -rf *`, `git clean -fdx`, `pkill`, `sudo`, `mkfs`, `curl|sh`, etc.). It is a denylist, not a sandbox; only delegate shell access to agents you trust.

## UI

`/subagents` — centered overlay to enable/disable the extension, edit the single runtime template's **tools**, **extensions**, **skills**, **active skills**, **model**, and **thinking**, and create project template stubs. Runtime config changes are saved as a trusted project override at `.pi/kumpul/subagent.md` and apply after `/reload`.

Extension and skill pickers show only currently resolvable names with source labels (`project`, `loaded`, `package`, `global`, `npm`). Missing saved names are warned about and preserved on save; remove them manually from the `.md` file. Skills and active skills are editable only when `read` is enabled, and `read` stays locked while skills are selected.

Ctrl+O toggles collapsed (header + last 15 tool calls) vs expanded (full task, all tool calls, markdown output, nested subagent rows). Large child output is truncated in the tool result with a temp-file path to the full output.

## Disable

Use `/subagents` or trusted project config:

```yaml
# .pi/kumpul/config.yaml
subagents:
  enabled: false
```
