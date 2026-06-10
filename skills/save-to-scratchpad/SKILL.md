---
name: save-to-scratchpad
description: >
  Compress current conversation into a new token-efficient scratchpad.
  Use when user invokes save-to-scratchpad, says "save to scratchpad" or
  "capture this", or after grill-me when decisions need persisting.
argument-hint: "Optional topic slug, e.g. add-create-to-users-management"
---

Compress the current conversation into a new scratchpad. Do NOT interview the user. Do NOT explore the codebase.

**Core principle:** Capture 100% of decisions, ~20% of conversation volume.

## When to Use

- User invokes `/skill:save-to-scratchpad` or passes a topic slug
- User says "save to scratchpad", "capture this", "capture decisions"
- After grill-me / grill-with-docs when user wants context persisted

**Do NOT trigger** on routine turns, code edits, or casual chat.

## Process

1. Read [format-scratchpad.md](./format-scratchpad.md) for filename, frontmatter, sections, and compression rules.
2. Synthesize everything important from the current session: decisions (including rejected alternatives), glossary, requirements, constraints, open questions, findings.
3. Create `docs/scratchpads/` if missing.
4. Write a **new** file — create-only, never update an existing scratchpad.
5. Announce save (see Post-save).

## Optional Review

When user says "review scratchpad @scratchpad-...", follow [scratchpad-reviewer.md](./scratchpad-reviewer.md).

## Post-save

```
Saved @scratchpad-<ddmmyyyy>-<slug>
→ docs/scratchpads/scratchpad-<ddmmyyyy>-<slug>.md
```

Optional one-liner: "N decisions, M glossary terms captured." Do not dump body content.
