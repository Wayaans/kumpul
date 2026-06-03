# AGENTS.md

Behavioral guidelines to reduce common LLM coding mistakes. Merge with project-specific instructions as needed. These guidelines bias toward caution over speed; for trivial tasks, use judgment.

### Think before coding

Do not assume. Do not hide confusion. Surface tradeoffs. Before implementing, state your assumptions explicitly; if uncertain, ask. If multiple interpretations exist, present them rather than picking one silently. If a simpler approach exists, say so and push back when warranted. If something is unclear, stop, name what is confusing, and ask.

### Simplicity first

Write the minimum code that solves the problem. Nothing speculative. Do not add features beyond what was asked, abstractions for single-use code, or flexibility and configurability that were not requested. Do not add error handling for impossible scenarios. If you write two hundred lines and it could be fifty, rewrite it. Ask whether a senior engineer would call the result overcomplicated; if yes, simplify.

### Surgical changes

Touch only what you must. Clean up only your own mess. When editing existing code, do not improve adjacent code, comments, or formatting, and do not refactor things that are not broken. Match existing style even if you would do it differently. If you notice unrelated dead code, mention it rather than deleting it. When your changes create orphans, remove imports, variables, and functions that your changes made unused; do not remove pre-existing dead code unless asked. Every changed line should trace directly to the user's request.

### Goal-driven execution

Define success criteria and loop until verified. Transform tasks into verifiable goals: "add validation" becomes write tests for invalid inputs and make them pass; "fix the bug" becomes write a test that reproduces it and make it pass; "refactor X" becomes ensure tests pass before and after. For multi-step tasks, state a brief plan where each step names how you will verify it. Strong success criteria let you loop independently; weak criteria like "make it work" require constant clarification.

These guidelines are working when diffs contain fewer unnecessary changes, fewer rewrites stem from overcomplication, and clarifying questions come before implementation rather than after mistakes.

---

Rules for working in `@wayanary/kumpul` — a personal pi package of extensions, themes, skills, and prompt templates.

Domain terms live in [CONTEXT.md](./CONTEXT.md). Read it before adding resources.

## What this repo is

Kumpul bundles pi-coding-agent resources installable via:

```bash
pi install git:github.com/wayanary/kumpul@main
```

While developing inside this repo, pi loads the package locally via `.pi/settings.json`.

This is **not** a general-purpose library. It is a collection of personal pi resources with strict layout and independence rules.

## Repository layout

```
kumpul/
├── AGENTS.md
├── CONTEXT.md
├── package.json              # @wayanary/kumpul, pi manifest, peers
├── package-lock.json
├── tsconfig.json
├── .gitignore
├── .pi/
│   └── settings.json         # { "packages": [".."] } — dev mode only
├── extensions/
│   └── <kebab-name>/
│       ├── index.ts          # required entry point
│       ├── README.md         # required
│       └── package.json      # only when extension has its own deps
├── themes/
│   └── <name>.json
├── skills/
│   └── <kebab-name>/
│       └── SKILL.md
└── prompts/
    └── <kebab-name>.md
```

## Package manifest

Root `package.json` must include:

```json
{
  "name": "@wayanary/kumpul",
  "private": true,
  "type": "module",
  "keywords": ["pi-package"],
  "pi": {
    "extensions": ["./extensions"],
    "themes": ["./themes"],
    "skills": ["./skills"],
    "prompts": ["./prompts"]
  }
}
```

- Use directory globs — do **not** list individual extension paths in the manifest.
- All extensions under `extensions/` load by default. Disable via `pi config`, not manifest exclusion.

## Toolchain

**Use npm.** Do not introduce Bun, yarn, or pnpm.

| Task | Command |
|------|---------|
| Install deps | `npm install` |
| Typecheck | `npm run check` (`tsc --noEmit`) |
| Test extensions | `npm test` |

- Pi loads `.ts` at runtime via jiti — **no build step**, no bundler.
- Commit `package-lock.json`. Pi runs `npm install` on git install.
- Pi core packages are **peerDependencies** (also in devDependencies for local typecheck):

  `@earendil-works/pi-coding-agent`, `@earendil-works/pi-ai`, `@earendil-works/pi-agent-core`, `@earendil-works/pi-tui`, `typebox`

  Do not put pi core packages in `dependencies`.

## TypeScript

- `"strict": true`, `"module": "NodeNext"`, `"moduleResolution": "NodeNext"`, `"noEmit": true`
- Use `.ts` suffix on relative imports: `import { foo } from "./utils.ts"`
- Extension entry point pattern:

```typescript
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export default function (pi: ExtensionAPI) {
  // register tools, commands, event handlers
}
```

- Use `StringEnum` from `@earendil-works/pi-ai` for string tool parameters (Google API compat).
- Reference [pi extensions docs](https://github.com/earendil-works/pi/tree/main/packages/coding-agent/docs/extensions.md) and `examples/extensions/` in pi-coding-agent before implementing non-trivial behavior.

## Adding an extension

1. Create `extensions/<kebab-name>/` — name matches primary command or purpose.
2. Add `index.ts` (entry point) and `README.md` (required).
3. If the extension needs third-party npm packages, add `extensions/<kebab-name>/package.json` and run `npm install` in that directory. Do **not** add extension-only deps to root `package.json`.
4. Run `npm run check` from repo root.
5. Test locally: run `pi` from this repo (`.pi/settings.json` loads `./`).

### Extension README must include

1. One-line purpose
2. Commands and/or tools registered
3. Install note if the extension has its own `package.json` (`npm install` in that dir)

### Extension independence

- Each extension is self-contained. **No shared `lib/` directory.**
- No imports from sibling extensions.
- If two extensions need the same logic, duplicate it or extract to an external npm package — not an internal shared module.

### Extension loading

- New extension directories are auto-discovered — no manifest update needed.
- Flat files (`extensions/foo.ts`) are **not** used. Always a subdirectory with `index.ts`.

## Adding a theme

1. Create `themes/<name>.json`.
2. Set `"name": "<name>"` inside the JSON to match the filename (without `.json`).
3. Include all required color tokens per [pi themes docs](https://github.com/earendil-works/pi/tree/main/packages/coding-agent/docs/themes.md).
4. Use unprefixed kebab-case names (e.g. `dark.json`, not `kumpul-dark.json`).

## Adding a skill

1. Create `skills/<kebab-name>/SKILL.md`.
2. Skills live **only** in top-level `skills/` — never inside extension directories.
3. Use unprefixed kebab-case folder names (e.g. `skills/grill-me/`).
4. Follow [pi skills docs](https://github.com/earendil-works/pi/tree/main/packages/coding-agent/docs/skills.md) for frontmatter and structure.

## Adding a prompt template

1. Create `prompts/<kebab-name>.md`.
2. Prompts live **only** in top-level `prompts/` — never inside extension directories.
3. Filename (minus `.md`) is the prompt id. Unprefixed kebab-case (e.g. `code-review.md`).

## Naming

| Resource | Convention | Example |
|----------|------------|---------|
| Extension dir | kebab-case | `permission-gate/` |
| Theme file | kebab-case, unprefixed | `dark.json` |
| Skill folder | kebab-case, unprefixed | `grill-me/` |
| Prompt file | kebab-case, unprefixed | `code-review.md` |

Collision with other installed pi packages is accepted — keep names short and descriptive.

## Dependencies

| Dep type | Where |
|----------|-------|
| Pi core (`pi-coding-agent`, `typebox`, etc.) | Root `peerDependencies` + `devDependencies` |
| Shared by multiple extensions | Root `dependencies` (rare — prefer extension-local) |
| Used by one extension only | That extension's `package.json` |

After changing root deps: `npm install` and commit `package-lock.json`.
After changing extension-local deps: `npm install` inside the extension dir.

## Local development

- `.pi/settings.json` with `"packages": [".."]` is committed for dev mode. Do not remove it. Paths are relative to `.pi/`, so `..` is the package root.
- Do not put package logic into `.pi/` — only settings wiring.
- Global install on other machines: `git:github.com/wayanary/kumpul@main` in `~/.pi/agent/settings.json`.

## What not to do

- Do not add a `lib/` or shared internal module directory.
- Do not co-locate skills or prompts inside extension directories.
- Do not use flat extension files at `extensions/*.ts`.
- Do not add a build/bundle step.
- Do not switch to Bun or add `bun.lock`.
- Do not list pi core packages in `dependencies`.
- Do not prefix resource names with `kumpul-`.
- Do not whitelist extensions individually in `package.json` `"pi"` manifest.

## Validation

Before finishing extension work:

```bash
npm run check
npm test
```

Extension unit tests live in `extensions/test/` (not loaded by pi). Add new tests there instead of scattering them inside extension directories.

Manual verification when behavior changes:

- Run `pi` from this repo and confirm the extension loads.
- Use `/reload` after editing extension code.
- If extension has local deps, confirm `npm install` was run in its directory.

## Documentation

When adding or changing user-facing behavior, update the resource's README (extensions) or inline docs (skills/prompts frontmatter). Keep [CONTEXT.md](./CONTEXT.md) aligned if new domain terms are introduced.
