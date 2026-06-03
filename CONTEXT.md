# Kumpul

A personal pi package that bundles extensions, themes, skills, and prompt templates for use with pi-coding-agent.

## Language

**Pi package**:
A distributable bundle of pi resources (extensions, themes, skills, prompt templates) installed via `pi install`. Named `@wayanary/kumpul`.
_Avoid_: Plugin, module bundle

**Extension**:
A TypeScript module that hooks into pi's lifecycle, registers tools, commands, or UI. Each extension lives in its own kebab-case directory under `extensions/` with `index.ts` as the entry point and a `README.md`.
_Avoid_: Plugin, addon

**Extension-local dependency**:
A third-party package used by only one extension, declared in that extension's own `package.json` — not in the root.
_Avoid_: Shared dependency, root dependency

**Extension independence**:
Each extension is self-contained — no shared internal library. Code used by more than one extension is duplicated or extracted to an external npm package.
_Avoid_: Shared lib, internal utils package

**Toolchain**:
npm for dependency management and scripts — no Bun. TypeScript strict mode, typecheck-only (`noEmit`). Pi loads `.ts` at runtime; no build step.
_Avoid_: Bun, yarn, pnpm, bundler, compile step

**Theme**:
A JSON file defining TUI color tokens. Named without prefix — e.g. `dark.json` with internal `"name": "dark"`.
_Avoid_: Color scheme, skin, prefixed name

**Skill**:
A folder containing `SKILL.md` that instructs the model how to perform a specialized task. Folder name is unprefixed kebab-case — e.g. `skills/grill-me/`.
_Avoid_: Rule, instruction file, prefixed name

**Prompt template**:
A reusable markdown file loaded as a named prompt the user or agent can invoke. Named without prefix — e.g. `code-review.md`.
_Avoid_: System prompt, preset, prefixed name

**Resource naming**:
All kumpul resources use short, unprefixed kebab-case names. Collision risk with other pi packages is accepted.
_Avoid_: kumpul- prefix, namespaced name

**Package skill**:
A skill shipped with kumpul, living in the package's top-level skills directory — never inside an extension directory.
_Avoid_: Extension skill, co-located skill

**Package prompt**:
A prompt template shipped with kumpul, living in the package's top-level prompts directory — never inside an extension directory.
_Avoid_: Extension prompt, co-located prompt

**Install source**:
How kumpul is referenced in pi settings — git ref for normal use, local path while developing the package itself.
_Avoid_: Deployment target, publish channel

**Dev mode**:
Working inside the kumpul repo itself — pi loads the package via committed `.pi/settings.json` pointing to `./`, overriding the global git install.
_Avoid_: Hot reload, test mode

**Extension loading**:
All extensions under `extensions/` are loaded by default on package install. Individual extensions are disabled via pi config when needed — not excluded from the manifest.
_Avoid_: Opt-in loading, manifest whitelist
