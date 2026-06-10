# todos

File-backed todo manager with agent tool and interactive TUI.

## Behavior

- Stores todos as markdown files under `docs/todos/` (override with `PI_TODO_PATH`).
- Each todo is `<id>.md` with JSON front matter (id, title, tags, status, created_at, assigned_to_session) and optional markdown body.
- Session assignment and file locks prevent concurrent edits across pi sessions.
- Garbage-collects closed todos older than 7 days on startup (configurable in `docs/todos/settings.json`).
- On startup, migrates any todos still in legacy `.pi/todos/` into `docs/todos/` (skipped when `PI_TODO_PATH` is set).

## Tool

- **todo** — `list`, `list-all`, `get`, `create`, `update`, `append`, `delete`, `claim`, `release`

## Commands

- **/todos** — interactive todo browser (search, work, refine, close, delete)
