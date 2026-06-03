import assert from "node:assert/strict";
import test from "node:test";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import findDocsExtension from "../find-docs/index.ts";
import polishStatuslineExtension from "../polish-statusline/index.ts";
import gitGuardrailsExtension from "../git-guardrails/index.ts";
import handoffExtension from "../handoff/index.ts";
import opencodeGoFixExtension from "../opencode-go-fix/index.ts";

function createMockPi(): ExtensionAPI {
	const handlers = new Map<string, Array<(event: unknown, ctx: unknown) => unknown>>();

	return {
		on(event, handler) {
			const list = handlers.get(event) ?? [];
			list.push(handler as (event: unknown, ctx: unknown) => unknown);
			handlers.set(event, list);
		},
		registerCommand(name, options) {
			assert.ok(name.length > 0);
			assert.ok(typeof options.handler === "function");
		},
		registerMessageRenderer(_customType, _renderer) {},
		registerTool(tool) {
			assert.equal(tool.name, "find_docs");
		},
		getActiveTools() {
			return ["bash", "read", "find_docs"];
		},
		getAllTools() {
			return [{ name: "bash" }, { name: "read" }, { name: "find_docs" }];
		},
		setActiveTools(tools) {
			assert.ok(Array.isArray(tools));
		},
		sendMessage(_message) {},
		exec: async () => ({ code: 0, stdout: "", stderr: "" }),
	} as unknown as ExtensionAPI;
}

test("migrated extensions register without throwing", () => {
	const pi = createMockPi();
	const cwd = process.cwd();

	assert.doesNotThrow(() => opencodeGoFixExtension(pi));
	assert.doesNotThrow(() => gitGuardrailsExtension(pi, { cwd } as never));
	assert.doesNotThrow(() => handoffExtension(pi, { cwd } as never));
	assert.doesNotThrow(() => findDocsExtension(pi));
	assert.doesNotThrow(() => polishStatuslineExtension(pi));
});
