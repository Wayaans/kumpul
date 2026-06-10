---
id: scratchpad-09062026-save-to-scratchpad-todo-skills
title: Save-to-scratchpad and save-to-todo skills design
created: 2026-06-09
---

## Summary
Grill-me design session for two pi skills in kumpul: save-to-scratchpad compresses session context into token-efficient markdown; save-to-todo creates atomic single-file work units. Skills implemented at skills/save-to-scratchpad/ and skills/save-to-todo/.

## Decisions
- **location:** docs/scratchpads/ and docs/todos/ — durable project artifacts
- **rejected:** docs/0001-* numbering — timestamp+slug scheme preferred
- **rejected:** docs/scratchpads/_active.md rolling pointer — reference latest file instead
- **rejected:** .pi/ or ~/.pi/agent/ storage — project-scoped docs/
- **scratchpad naming:** scratchpad-ddmmyyyy-<slug>.md — lowercase only
- **todo naming:** todo-ddmmyyyyhhmmss.md — timestamp ID, no slug, lowercase
- **refs:** @scratchpad-<id> and @todo-<id> — filename stem, no path in conversation
- **scratchpad frontmatter:** id, title, created only — immutable, no updated/status
- **todo frontmatter:** id, title, created, updated, status, completed — lean, no source/related
- **rejected:** source/related in frontmatter — cross-links live in body ## Related only
- **rejected:** last-worked field — updated + changelog sufficient
- **scratchpad mode:** create-only — every invoke writes new file
- **rejected:** merge/update/append scratchpad modes — @scratchpad-... is reference-only
- **scratchpad sections:** dynamic — include only sections with content, always Summary + Changelog
- **todo model:** one file = one todo — not a checklist doc
- **todo status:** open | close only
- **todo quick save:** write immediately from user arg — no codebase scan, no interview
- **todo refine:** expand in place OR slice into 2–5 vertical slices — agent decides (Option C)
- **refine overrides:** refine expand @todo-... | refine slice @todo-... force behavior
- **from-scratchpad default:** agent picks thin→simple todos, rich→implementation plans (B+C)
- **from-scratchpad overrides:** from-scratchpad simple | from-scratchpad plan
- **detailed/sliced todo body:** writing-plans style — file map, checkbox steps, real code, self-review
- **close auto:** only on refine slice superseding parent
- **close explicit:** user says close @todo-... — sets completed date
- **close offer:** agent asks to close after implementation — never silent auto-close
- **reopen:** supported on user request
- **triggers:** explicit skill invoke or clear save/capture intent only
- **rejected:** implicit auto-save on casual chat or code edits
- **post-save:** announce @ref + path; plan todos mention subagent-driven-development + test-driven-development
- **supporting file split:** format-* for templates, refine-* / reviewer for logic — agreed
- **style reference:** mattpocock/skills for skill writing; obra/superpowers writing-plans for plan todos

## Glossary
- **scratchpad:** token-efficient session capture — decisions, glossary, requirements; pre-PRD/spec material
- **todo:** one file = one atomic work unit; simple goal or full implementation plan
- **quick save:** zero-friction todo create from user text — no exploration
- **refine expand:** same todo file becomes detailed implementation plan
- **refine slice:** close parent, spawn 2–5 thin vertical-slice plan todos with cross-refs
- **from-scratchpad:** read scratchpad → spawn simple or plan todos based on richness
- **tracer bullet:** vertical slice that produces working, testable software alone

## Requirements
- must: capture 100% of decisions from session in scratchpad, ~20% conversation volume
- must: scratchpad include rejected alternatives in Decisions
- must: plan todos have real code blocks, real commands, no placeholders
- must: simple todo infer done-when from arg text only — no codebase on quick save
- must: changelog in body for both scratchpad and todo lifecycle events
- should: slice 2–5 todos max per refine pass
- should: scratchpad-reviewer only on explicit user request
- won't: interview user on quick save or scratchpad capture
- won't: explore codebase on scratchpad save or todo quick save
- won't: duplicate scratchpad content into todos — reference and distill into plan steps
- won't: todo refine write back to scratchpad

## Constraints
- skills live in skills/save-to-scratchpad/ and skills/save-to-todo/ per kumpul layout
- SKILL.md lean (~50–80 lines); templates and refine logic in sibling files
- timestamp ddmmyyyy / ddmmyyyyhhmmss from local time
- body links use ## Related, ## Superseded by, ## Close note sections

## Notes
- workflow: grill-me → save-to-scratchpad → save-to-todo → execute
- save-to-scratchpad files: SKILL.md, format-scratchpad.md, scratchpad-reviewer.md
- save-to-todo files: SKILL.md, format-todo.md, refine-todo.md
- boundary: scratchpad = what & why; todo = do; scratchpad→todos only on explicit request
- missing ref response: "Todo/Scratchpad not found: @... Check docs/todos/ or docs/scratchpads/." — no guessing

## Changelog
- 2026-06-09: initial capture from grill-me session; skills implemented same session
