import assert from "node:assert/strict";
import test from "node:test";
import { HANDOFF_SYSTEM_PROMPT } from "../handoff/index.ts";

test("handoff system prompt keeps requested format and guidance", () => {
	assert.match(HANDOFF_SYSTEM_PROMPT, /Write a handoff document summarising/);
	assert.match(HANDOFF_SYSTEM_PROMPT, /suggested skills/);
	assert.match(HANDOFF_SYSTEM_PROMPT, /\/skill:<skill-name>/);
	assert.match(HANDOFF_SYSTEM_PROMPT, /Do not duplicate content already captured/);
	assert.match(HANDOFF_SYSTEM_PROMPT, /Redact any sensitive information/);
	assert.match(HANDOFF_SYSTEM_PROMPT, /## Context/);
	assert.match(HANDOFF_SYSTEM_PROMPT, /## Task/);
	assert.doesNotMatch(HANDOFF_SYSTEM_PROMPT, /Save to the temporary directory/);
});
