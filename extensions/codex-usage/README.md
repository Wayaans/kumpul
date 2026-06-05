# codex-usage

Shows OpenAI Codex subscription usage (5-hour window) in the footer and via `/codex-limit`.

## Behavior

- When the active model uses `openai-codex` with OAuth, fetches usage from ChatGPT's backend API after each agent turn (60s debounce).
- Publishes `◷ NN%` via `ctx.ui.setStatus()` — with polish-statusline enabled, appears on the model line to the left of the provider prefix (not the extension-status row).
- `/codex-limit` opens an interactive breakdown (5-hour + weekly bars) and can open the usage dashboard in your browser.

## Limits

Requires OAuth (`openai-codex` subscription). Not a quota enforcement layer — informational only. Stale cache is kept on transient fetch failures.

## Commands

- **/codex-limit** — usage detail overlay (openai-codex + OAuth only)

## Subagents

Disabled in child `pi` processes (`PI_SUBAGENT_DEPTH` set).
