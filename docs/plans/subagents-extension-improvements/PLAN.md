# Subagents Extension Improvements Plan

## Scope

Improve `extensions/subagents/**` based on the audit findings:

- Runtime correctness and installability
- Trust and safety model
- Built-in agent reliability
- Test reliability
- Architecture simplification
- TUI correctness
- Dead-code removal
- Documentation alignment

## Open decisions before implementation

Do not implement until these are answered.

1. **Project trust**
   - Proposed: load `.pi/kumpul/agens` and `.pi/kumpul/config.yaml` only when `ctx.isProjectTrusted()` is true.
   - Need confirmation.

2. **Cursor provider behavior**
   - Proposed: remove automatic `pi-cursor-sdk` injection and require explicit `extensions: pi-cursor-sdk`.
   - Reason: README already says child spawns do not auto-load Cursor providers.
   - Need confirmation.

3. **`fetch_content` in built-in agents**
   - Proposed: remove `fetch_content` from package built-ins unless `pi-web-access` becomes a declared runtime dependency.
   - Need confirmation.

4. **`safe_bash` policy**
   - Proposed short-term: harden denylist and keep name.
   - Proposed long-term: consider rename to `guarded_bash` or replace with allowlist/sandbox.
   - Need confirmation on desired strictness.

5. **Project agent directory spelling**
   - Current: `.pi/kumpul/agens`
   - Proposed: migrate to `.pi/kumpul/agents` with backward-compatible read from `agens`.
   - Need confirmation.

## Success criteria

- `npm run check` passes.
- `npm test` passes on a clean machine without `pi-cursor-sdk` installed.
- Installed package has all runtime dependencies available under production install.
- Untrusted project-local subagent config cannot affect execution.
- Built-in agents work without undeclared external packages.
- `/subagents` cannot save invalid nested-subagent configuration by accident.
- Child-process output truncation preserves a path to full output.
- Queued subagents respect abort signals.
- README matches implemented behavior.

## Phase 1 — Fix correctness and runtime breakage

### 1. Move runtime dependency to `dependencies`

Files:

- `package.json`
- `package-lock.json`

Problem:

- `agent-io.ts` and `config-io.ts` import `yaml` at runtime.
- `yaml` is currently only in `devDependencies`.
- Pi package installs may omit dev dependencies.

Plan:

1. Move `yaml` from `devDependencies` to `dependencies`.
2. Run `npm install`.
3. Verify production dependency visibility.

Verification:

```bash
npm ls yaml --omit=dev
npm run check
npm test
```

### 2. Fix Cursor tests/docs mismatch

Files:

- `extensions/subagents/spawn.ts`
- `extensions/subagents/README.md`
- `extensions/test/subagents.test.ts`
- `extensions/test/subagents-config-ui.test.ts`

Problem:

- README says child spawns do not auto-load Cursor providers.
- `resolveEffectiveAgent()` currently injects `pi-cursor-sdk` for `cursor/*` models.
- Tests fail when `pi-cursor-sdk` is not installed.

Plan if explicit-only policy is approved:

1. Remove implicit `pi-cursor-sdk` injection from `resolveEffectiveAgent()`.
2. Update tests to require explicit extension allowlist.
3. For tests needing resolution, create a fake project/local extension path or skip only when intentionally testing installed-package resolution.
4. Update README if needed to state explicit-only behavior clearly.

Verification:

```bash
npm test -- extensions/test/subagents.test.ts
npm test
```

## Phase 2 — Close trust and safety gaps

### 3. Gate project-local agents and config behind trust

Files:

- `extensions/subagents/index.ts`
- `extensions/subagents/registry.ts`
- `extensions/subagents/config-io.ts`
- `extensions/subagents/setup-ui.ts`
- tests under `extensions/test/`

Problem:

- Project-local config and agent prompts can currently override package/global behavior without checking `ctx.isProjectTrusted()`.
- Pi docs say project-local extension configuration should check `ctx.isProjectTrusted()`.

Plan:

1. Make project discovery explicitly trust-aware.
2. Package and global agents remain available regardless of project trust.
3. Project agents/config apply only when trusted.
4. `/subagents` UI can still write user-initiated project config, but effective runtime loading must honor trust.
5. Add tests for trusted and untrusted behavior.

Potential shape:

```ts
loadAgents(cwd, { includeProject: ctx.isProjectTrusted() })
loadMergedSubagentsUiConfig(cwd, { includeProject: ctx.isProjectTrusted() })
```

Verification:

- Untrusted `.pi/kumpul/agens/reviewer.md` does not override package `reviewer`.
- Trusted project override does apply.
- Untrusted `.pi/kumpul/config.yaml` cannot disable the extension or agents.

### 4. Harden `safe_bash`

Files:

- `extensions/subagents/tools/safe-bash.ts`
- `extensions/test/subagents-render-spawn.test.ts` or new focused test file
- `extensions/subagents/README.md`

Problem:

`safe_bash` currently allows dangerous commands such as:

- `rm -rf .`
- `rm -rf *`
- `git clean -fdx`
- `pkill -9 node`

Plan:

1. Add failing tests for dangerous commands above.
2. Extend denylist or adopt stricter policy based on decision.
3. Keep README explicit that this is not a sandbox.
4. Ensure common safe commands still pass.

Verification:

- Dangerous command tests pass.
- `npm test`, `git status`, `rg foo`, and similar normal commands remain allowed.

## Phase 3 — Make built-ins self-contained

### 5. Resolve `fetch_content` default-agent dependency

Files:

- `extensions/subagents/agents/agent.md`
- `extensions/subagents/agents/reviewer.md`
- `extensions/subagents/README.md`
- tests

Problem:

- Built-in agents include `fetch_content`.
- `fetch_content` is provided by external `pi-web-access`, not this package.
- A fresh install can fail default subagent runs.

Plan if removal is approved:

1. Remove `fetch_content` from built-in agents.
2. Keep `find_docs` because it is provided by this package.
3. Document how users can opt into `fetch_content` by installing/configuring `pi-web-access` and adding it to project/global agent definitions.
4. Update tests that assert default tool lists.

Verification:

- `agent` and `reviewer` resolve on a clean install without `pi-web-access`.

## Phase 4 — Simplify resource resolution architecture

### 6. Replace resolver sprawl with a single inventory module

Files:

- `extensions/subagents/resolve-tools.ts`
- possible new `extensions/subagents/inventory.ts`
- `extensions/subagents/spawn.ts`
- `extensions/subagents/setup-ui.ts`
- tests

Problem:

- `resolve-tools.ts` mixes tool resolution, extension discovery, skill discovery, npm scanning, source regex parsing, and UI option generation.
- `readRegisterToolNames()` uses brittle regex over source text.

Plan:

1. Introduce a typed `ResourceInventory` module.
2. Build inventory once per execution/UI session from:
   - `pi.getAllTools()`
   - `pi.getCommands()`
   - package resources
   - global resources
   - trusted project resources
   - npm package metadata where needed
3. Expose focused operations:
   - `resolveTool(name)`
   - `resolveExtension(name)`
   - `resolveSkill(name)`
   - `listSelectableTools(preservedNames)`
   - `listSelectableExtensions()`
   - `listSelectableSkills()`
4. Prefer pi metadata and package manifests over regex scanning.
5. Keep backwards compatibility for known package-local tool paths.

Verification:

- Existing resolver tests pass.
- Add regression tests for false positives/false negatives in tool discovery.

## Phase 5 — Decompose large modules without behavior change

### 7. Split `spawn.ts`

Current file: `extensions/subagents/spawn.ts` is large and owns too many concepts.

Target structure:

```text
extensions/subagents/spawn/
├── build-args.ts
├── child-process.ts
├── format.ts
├── progress-parser.ts
├── semaphore.ts
└── index.ts
```

Plan:

1. Move code without changing behavior.
2. Keep `runSubagent()`, `buildPiArgs()`, and public test imports stable during first extraction.
3. After tests pass, clean imports and internal helpers.

Verification:

```bash
npm run check
npm test
```

### 8. Split `setup-ui.ts`

Current file: `extensions/subagents/setup-ui.ts` is large and deeply nested.

Target structure:

```text
extensions/subagents/setup-ui/
├── index.ts
├── allowlist-picker.ts
├── agent-screen.ts
├── home-screen.ts
├── model-picker.ts
├── state.ts
└── tools-screen.ts
```

Plan:

1. Extract pure display/value helpers first.
2. Extract screen builders one by one.
3. Keep mutation/state transitions centralized.
4. Prefer small helpers over broad abstractions.

Verification:

- Existing setup/config tests pass.
- Manual `/subagents` smoke test after implementation.

## Phase 6 — Fix UI and TUI correctness

### 9. Support or block nested subagent allowlist editing

Files:

- `extensions/subagents/setup-ui.ts`
- `extensions/subagents/agent-io.ts`
- tests

Problem:

- UI can enable `subagent` as a tool.
- Agents with `subagent` require `subagent_agents`.
- UI does not edit `subagent_agents`, so it can lead users into an invalid save path.

Plan:

Preferred:

1. Add `subagent_agents` picker listing available agents.
2. Save selected allowlist to frontmatter.
3. Validate selected agent names.

Simpler fallback:

1. Disable/hide `subagent` tool toggle unless the agent already has `subagent_agents` in frontmatter.
2. Show help text telling users to hand-edit the markdown.

Verification:

- User can save a valid nested-spawn agent through UI, or UI prevents invalid config.

### 10. Use injected keybindings and official truncation helpers

Files:

- `extensions/subagents/setup-ui.ts`
- `extensions/subagents/render.ts`

Problems:

- `setup-ui.ts` uses global `getKeybindings()` instead of injected keybindings from `ctx.ui.custom()`.
- `render.ts` hand-rolls line truncation.
- Pi TUI docs require rendered lines not exceed width and recommend `truncateToWidth()`.

Plan:

1. Replace global `getKeybindings()` usage with injected keybindings argument.
2. Replace custom truncation with `truncateToWidth()` where possible.
3. Add tests for long strings and ANSI text if practical.

Verification:

- Long rendered lines stay within width.
- Existing render tests pass.

## Phase 7 — Improve child-process behavior

### 11. Make semaphore abort-aware

Files:

- `extensions/subagents/spawn.ts` or new `spawn/semaphore.ts`
- tests

Problem:

- If a subagent is queued behind `maxConcurrency`, aborting does not remove it from the wait queue.

Plan:

1. Change semaphore API to accept optional `AbortSignal`.
2. If signal aborts before acquisition, remove waiter and reject.
3. Preserve current running-child abort behavior.

Verification:

- Queued subagent abort test proves it never starts later.
- Running subagent abort still kills child process.

### 12. Preserve full truncated output

Files:

- `extensions/subagents/spawn.ts`
- tests

Problem:

- Large output is truncated to `[Output truncated]` without a full-output location.
- Pi docs recommend saving full output and telling the model where it is.

Plan:

1. When output exceeds limit, write full output to a temp file.
2. Return truncated content plus path to full output.
3. Include line/byte details if simple to add.

Verification:

- Large-output test confirms:
  - returned output is truncated
  - message includes full-output path
  - file exists and contains full output

## Phase 8 — Remove dead and misleading code

### 13. Remove inert config fields

Files:

- `extensions/subagents/config.json`
- `extensions/subagents/index.ts`
- README/tests if needed

Problem:

- `allowProjectAgents` and `allowProjectAgentOverrides` exist in config but are ignored by `parseConfig()`.

Plan:

1. Remove the unused fields.
2. Keep only `maxConcurrency`, unless project-agent policy fields are intentionally implemented.

Verification:

- `parseConfig()` tests still pass.
- Docs do not imply unsupported config.

### 14. Remove unused exports/imports and stale result fields

Files:

- `extensions/subagents/resolve-tools.ts`
- `extensions/subagents/index.ts`
- `extensions/subagents/setup-ui.ts`
- `extensions/test/subagents.test.ts`

Known cleanup targets:

- `getExtensionDir()` appears unused.
- `toolCallId` in `index.ts` execute signature is unused; rename to `_toolCallId`.
- `SetupResult.message` is returned but ignored.
- `extensions/test/subagents.test.ts` has stale unused imports after test splitting.

Plan:

1. Remove or use each item.
2. Run stricter unused checks as a one-off.

Verification:

```bash
npm run check
npx tsc --noEmit --noUnusedLocals --noUnusedParameters --pretty false
```

Note: the stricter unused check may expose unrelated repo issues; only fix subagents-related ones unless directed otherwise.

### 15. Decide whether `config.yaml` default file should exist

Files:

- `extensions/subagents/config.yaml`
- `extensions/subagents/config-io.ts`
- README

Problem:

- `config.yaml` contains only `enabled: true`, duplicating code defaults.

Plan:

- If kept: document it as a package default template.
- If removed: rely on `DEFAULTS.enabled = true`.

Verification:

- Default enabled behavior remains unchanged.

## Phase 9 — Test organization

### 16. Split oversized test file

Files:

- `extensions/test/subagents.test.ts`
- existing split tests
- possible new focused tests

Problem:

- `subagents.test.ts` is over 1,000 lines and mixes unrelated concerns.

Target split:

```text
extensions/test/subagents-registry.test.ts
extensions/test/subagents-resolve-tools.test.ts
extensions/test/subagents-spawn.test.ts
extensions/test/subagents-agent-io.test.ts
extensions/test/subagents-execute.test.ts
extensions/test/subagents-render-spawn.test.ts
extensions/test/subagents-config-ui.test.ts
```

Plan:

1. Move tests by concern.
2. Keep helpers local or duplicate small helpers per project guideline; do not create shared test lib unless asked.
3. Clean process env/PATH mutations with helper wrappers in each file.

Verification:

```bash
npm test
```

## Phase 10 — Documentation update

Files:

- `extensions/subagents/README.md`
- possibly `CONTEXT.md` only if new domain terms are introduced

Update README for:

- Project trust behavior
- Runtime dependency expectations
- Cursor provider behavior
- Built-in agent tool lists
- `safe_bash` limitations
- Project agent directory path and migration policy
- `subagent_agents` UI behavior
- Full-output truncation path
- Abort/concurrency behavior

Verification:

- README examples match actual code.
- No docs mention removed/dead config fields.

## Final verification

Run:

```bash
npm install
npm run check
npm test
```

Manual verification:

1. Start `pi` in the repo.
2. Run `/subagents`.
3. Toggle extension enabled/disabled.
4. Toggle per-agent spawn.
5. Save an agent override.
6. Run `/reload`.
7. Spawn `reviewer`.
8. Spawn `agent`.
9. Verify disabled agent fails clearly.
10. Verify untrusted project override behavior.
11. Verify nested subagent behavior if enabled.
12. Abort a running subagent.
13. Abort a queued subagent.
14. Trigger large output and inspect full-output temp file.
