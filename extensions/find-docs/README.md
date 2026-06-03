# find-docs

Context7 documentation lookup via a dedicated top-level tool.

## Tools

- **find_docs** — resolve a library ID and fetch current docs through Context7 (`ctx7` CLI, with `npx ctx7@latest` fallback).

Parameters: `query`, optional `library`, optional `libraryId`.

## Behavior

- Prioritizes `find_docs` ahead of built-in read/edit/write/bash when active.
- Blocks bash invocations of `ctx7` / `npx ctx7` when `find_docs` is available.
- Adds a short system-prompt hint to prefer `find_docs` over shell.

## Install

Requires `ctx7` on PATH or network access for the `npx ctx7@latest` fallback. No extension-local npm dependencies.
