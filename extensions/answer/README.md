# answer

Extract questions from the last assistant message and answer them in an interactive TUI.

## Behavior

1. Reads the last complete assistant message on the current branch.
2. Uses a fast model to extract questions as structured JSON (see **Extraction models** below).
3. Presents an interactive Q&A flow to answer each question.
4. Submits compiled answers as a user message and triggers a turn.

## Commands

- **/answer** — extract and answer questions from the last assistant message

## Shortcuts

- **Ctrl+.** — same as `/answer`

## Extraction models

`/answer` picks the first model in this list that is registered **and** has working auth (API key, OAuth, or configured provider). Models without credentials are skipped. If none match, it uses your **session model** (whatever you have selected in pi). Auth failures on a preferred model also fall back to the session model.

| Priority | Provider        | Model ID            |
|----------|-----------------|---------------------|
| 1        | `openai-codex`  | `gpt-5.3-codex`     |
| 2        | `openai-codex`  | `gpt-5.3`           |
| 3        | `anthropic`     | `claude-haiku-4-5`  |
| 4        | *(session)*     | your current model  |

The loader shows which model ran extraction, e.g. `Extracting questions using gpt-5.3-codex...`.

## Troubleshooting

If you see "Cancelled" after the loader or Q&A UI, you pressed Esc (or Ctrl+C) — that is intentional.

Other failures (auth, API, bad JSON) show as `Question extraction failed: …`.
