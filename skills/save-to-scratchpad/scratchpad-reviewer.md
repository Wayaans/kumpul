# Scratchpad Reviewer

Optional quality pass. Only run when user explicitly asks to review a scratchpad.

## When

- "review scratchpad @scratchpad-..."
- "clean up @scratchpad-..."

## Process

1. Read the referenced file at `docs/scratchpads/<id>.md`.
2. Check against [format-scratchpad.md](./format-scratchpad.md) compression rules.
3. Fix inline — do not ask unless deleting a decision.

## Checklist

| Check | Action |
|-------|--------|
| Missing decisions from session | Add to `## Decisions` |
| Duplicate content across sections | Deduplicate — keep in most specific section |
| Prose paragraphs | Convert to bullets |
| Empty sections | Remove |
| Missing `## Summary` or `## Changelog` | Add |
| Bloated bullets (>2 lines) | Compress |

## Do NOT

- Restructure sections without reason
- Delete rejected alternatives or decisions without asking
- Add content not in the session context

## Output

```
Reviewed @scratchpad-<id>
- fixed: <brief list of changes, or "no issues">
```
