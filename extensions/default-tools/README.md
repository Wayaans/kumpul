# default-tools

Enables pi's built-in `grep`, `find`, and `ls` tools on every session start (they are registered but off by default).

## Behavior

On `session_start` and `session_tree`, adds any of `grep`, `find`, `ls` that exist and are not already active. Extension tools are untouched.

## Install

No extension-local dependencies.
