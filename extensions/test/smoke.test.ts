import assert from "node:assert/strict";
import test from "node:test";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import findDocsExtension from "../find-docs/index.ts";
import polishStatuslineExtension from "../polish-statusline/index.ts";
import codexUsageExtension from "../codex-usage/index.ts";
import gitGuardrailsExtension from "../git-guardrails/index.ts";
import handoffExtension from "../handoff/index.ts";
import opencodeGoFixExtension from "../opencode-go-fix/index.ts";

function createMockPi(): ExtensionAPI {
	const handlers = new Map<string, Array<(event: unknown, ctx: unknown) => unknown>>();

	return {
		on(event: string, handler: (event: unknown, ctx: unknown) => unknown) {
			const list = handlers.get(event) ?? [];
			list.push(handler);
			handlers.set(event, list);
		},
		registerCommand(name: string, options: { handler: unknown }) {
			assert.ok(name.length > 0);
			assert.ok(typeof options.handler === "function");
		},
		registerMessageRenderer(_customType: string, _renderer: unknown) {},
		registerTool(tool: { name: string }) {
			assert.equal(tool.name, "find_docs");
		},
		getActiveTools() {
			return ["bash", "read", "find_docs"];
		},
		getAllTools() {
			return [{ name: "bash" }, { name: "read" }, { name: "find_docs" }];
		},
		setActiveTools(tools: string[]) {
			assert.ok(Array.isArray(tools));
		},
		sendMessage(_message: unknown) {},
		exec: async () => ({ code: 0, stdout: "", stderr: "" }),
	} as unknown as ExtensionAPI;
}

test("migrated extensions register without throwing", () => {
	const pi = createMockPi();
	const cwd = process.cwd();

	assert.doesNotThrow(() => opencodeGoFixExtension(pi));
	assert.doesNotThrow(() => gitGuardrailsExtension(pi, { cwd } as never));
	assert.doesNotThrow(() => handoffExtension(pi));
	assert.doesNotThrow(() => findDocsExtension(pi));
	assert.doesNotThrow(() => polishStatuslineExtension(pi));
	assert.doesNotThrow(() => codexUsageExtension(pi));
});
