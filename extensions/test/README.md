# Extension tests

Unit tests for kumpul extensions. This directory is **not** loaded as a pi extension (no `index.ts`).

## Run

From the repo root:

```bash
npm test
```

Or typecheck and test together:

```bash
npm run check && npm test
```

## Layout

| File | Covers |
|------|--------|
| `opencode-go-fix.test.ts` | Provider payload patches |
| `git-guardrails.test.ts` | Pattern matching, config merge, status messages |
| `find-docs.test.ts` | Formatting, tool priority, ctx7 bash detection |
| `smoke.test.ts` | Extension registration smoke test |

Add new tests here — do not scatter test files inside individual extension directories.
