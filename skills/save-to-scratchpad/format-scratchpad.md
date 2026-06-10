# Scratchpad Format

## Filename

```
docs/scratchpads/scratchpad-<ddmmyyyy>-<slug>.md
```

- `ddmmyyyy` — today's date, local time
- `slug` — kebab-case from user arg; if none, derive from first meaningful words of captured context (3–6 words max)
- Lowercase only

**Example:** `docs/scratchpads/scratchpad-09062026-save-to-scratchpad-skill.md`

**Reference:** `@scratchpad-09062026-save-to-scratchpad-skill` (filename stem, no path)

## Frontmatter

```yaml
---
id: scratchpad-<ddmmyyyy>-<slug>
title: <Human-readable title>
created: <YYYY-MM-DD>
---
```

`id` must match the filename stem. No `updated` — scratchpads are immutable (create-only).

## Body Sections

Include only sections that have content. Always start with `## Summary`.

| Section | When to include |
|---------|-----------------|
| `## Summary` | Always — 2–3 lines: what the session was about + current conclusion |
| `## Decisions` | Any decided branch — include rejected alternatives |
| `## Glossary` | Any defined terms |
| `## Requirements` | must / should / won't |
| `## Constraints` | Technical, scope, time limits |
| `## Open questions` | Unresolved items only |
| `## Notes` | Findings, file paths, patterns to reuse |
| `## Changelog` | Always — at least the create entry |

## Section Templates

```markdown
## Summary
<2-3 lines>

## Decisions
- **<decision>:** chose X over Y — <reason ≤10 words>
- **rejected:** Y — <why>

## Glossary
- **<term>:** <one-line definition>

## Requirements
- must: ...
- should: ...
- won't: ...

## Constraints
- ...

## Open questions
- ...

## Notes
- ...

## Changelog
- <YYYY-MM-DD>: initial capture from <source, e.g. grill-me session>
```

## Compression Rules

- Bullets only — no prose paragraphs
- One line per bullet
- No duplication across sections
- Verbatim quotes only for exact wording that matters (API names, user phrases)
- **Keep:** every decided branch, every rejected option, every defined term
- **Drop:** pleasantries, exploration dead ends, tool output dumps, repeated context
- Target: 100% of decisions, ~20% of conversation volume

## Example

```markdown
---
id: scratchpad-09062026-agent-skills
title: Save-to-scratchpad and save-to-todo skills
created: 2026-06-09
---

## Summary
Design session for two pi skills: scratchpad captures session context;
todo captures atomic work units. Scratchpads are create-only.

## Decisions
- **location:** docs/scratchpads/ and docs/todos/ — not .pi/
- **rejected:** numbered 0001-* files — timestamp+slug scheme preferred
- **scratchpad mode:** create-only — rejected merge/update mode

## Glossary
- **scratchpad:** token-efficient session capture, pre-PRD material
- **todo:** one file = one work unit, open or close

## Changelog
- 2026-06-09: initial capture from grill-me session
```
