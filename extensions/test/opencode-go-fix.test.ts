import assert from "node:assert/strict";
import test from "node:test";
import {
	applyOpenCodeGoKimiReasoningPatch,
	applyQwen36PlusCachePatch,
} from "../opencode-go-fix/index.ts";

test("qwen cache patch adds anthropic cache controls to cache breakpoints", () => {
	const payload = {
		messages: [
			{ role: "system", content: "system prompt" },
			{ role: "user", content: [{ type: "text", text: "hello" }] },
		],
		tools: [{ type: "function", function: { name: "read" } }],
	};

	const patched = applyQwen36PlusCachePatch(payload) as {
		messages: Array<{ content: unknown }>;
		tools: Array<{ cache_control?: unknown }>;
	};

	assert.notEqual(patched, payload);
	assert.deepEqual(patched.messages[0].content, [
		{ type: "text", text: "system prompt", cache_control: { type: "ephemeral" } },
	]);
	assert.deepEqual(patched.messages[1].content, [
		{ type: "text", text: "hello", cache_control: { type: "ephemeral" } },
	]);
	assert.deepEqual(patched.tools[0].cache_control, { type: "ephemeral" });
});

test("opencode-go kimi patch normalizes replayed reasoning fields", () => {
	const payload = {
		messages: [
			{ role: "user", content: "hello" },
			{ role: "assistant", content: "answer", reasoning: "private thinking" },
		],
	};

	const patched = applyOpenCodeGoKimiReasoningPatch(payload) as {
		messages: Array<{ reasoning?: string; reasoning_content?: string }>;
	};

	assert.notEqual(patched, payload);
	assert.equal(patched.messages[1].reasoning, undefined);
	assert.equal(patched.messages[1].reasoning_content, "private thinking");
});

test("opencode-go kimi patch leaves payloads without reasoning untouched", () => {
	const payload = {
		messages: [{ role: "assistant", content: "answer" }],
	};

	assert.equal(applyOpenCodeGoKimiReasoningPatch(payload), payload);
});

test("qwen cache patch preserves already-marked payloads", () => {
	const payload = {
		messages: [
			{ role: "system", content: [{ type: "text", text: "system", cache_control: { type: "ephemeral" } }] },
			{ role: "user", content: [{ type: "text", text: "hello", cache_control: { type: "ephemeral" } }] },
		],
		tools: [{ type: "function", function: { name: "read" }, cache_control: { type: "ephemeral" } }],
	};

	assert.equal(applyQwen36PlusCachePatch(payload), payload);
});

test("qwen cache patch targets the system message even when it is not first", () => {
	const payload = {
		messages: [
			{ role: "user", content: "hello" },
			{ role: "system", content: "system prompt" },
			{ role: "assistant", content: "answer" },
		],
	};

	const patched = applyQwen36PlusCachePatch(payload) as {
		messages: Array<{ content: unknown }>;
	};

	assert.equal(patched.messages[0].content, "hello");
	assert.deepEqual(patched.messages[1].content, [
		{ type: "text", text: "system prompt", cache_control: { type: "ephemeral" } },
	]);
	assert.deepEqual(patched.messages[2].content, [
		{ type: "text", text: "answer", cache_control: { type: "ephemeral" } },
	]);
});
