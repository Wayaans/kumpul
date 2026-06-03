# opencode-go-fix

Provider compatibility patches for OpenCode Go models.

## Behavior

- **qwen3.6-plus** on `opencode-go`: adds Anthropic-style cache breakpoints to system, last conversation, and tool messages; shows cache-read badge in footer.
- **kimi-k2.6** on `opencode-go`: maps `reasoning` to `reasoning_content` in provider payloads.

## Install

No extension-local dependencies.
