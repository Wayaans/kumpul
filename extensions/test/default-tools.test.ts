import assert from "node:assert/strict";
import test from "node:test";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import defaultToolsExtension from "../default-tools/index.ts";

function createMockPi(initialActive: string[]): {
	pi: ExtensionAPI;
	active: string[];
	handlers: Map<string, Array<() => void>>;
} {
	const active = [...initialActive];
	const handlers = new Map<string, Array<() => void>>();

	const pi = {
		on(event: string, handler: () => void) {
			const list = handlers.get(event) ?? [];
			list.push(handler);
			handlers.set(event, list);
		},
		getActiveTools() {
			return [...active];
		},
		getAllTools() {
			return [
				{ name: "read" },
				{ name: "bash" },
				{ name: "edit" },
				{ name: "write" },
				{ name: "grep" },
				{ name: "find" },
				{ name: "ls" },
				{ name: "subagent" },
			];
		},
		setActiveTools(tools: string[]) {
			active.splice(0, active.length, ...tools);
		},
	} as unknown as ExtensionAPI;

	return { pi, active, handlers };
}

async function fireEvent(handlers: Map<string, Array<() => void>>, event: string): Promise<void> {
	for (const handler of handlers.get(event) ?? []) {
		await handler();
	}
}

test("default-tools adds grep, find, ls without removing extension tools", async () => {
	const { pi, active, handlers } = createMockPi(["read", "bash", "edit", "write", "subagent"]);
	defaultToolsExtension(pi);

	await fireEvent(handlers, "session_start");

	assert.deepEqual(active, ["read", "bash", "edit", "write", "subagent", "grep", "find", "ls"]);
});

test("default-tools is idempotent when extras are already active", async () => {
	const { pi, active, handlers } = createMockPi([
		"read",
		"bash",
		"edit",
		"write",
		"grep",
		"find",
		"ls",
	]);
	defaultToolsExtension(pi);

	await fireEvent(handlers, "session_start");

	assert.deepEqual(active, ["read", "bash", "edit", "write", "grep", "find", "ls"]);
});

test("default-tools extension registers without throwing", () => {
	const { pi } = createMockPi(["read", "bash", "edit", "write"]);
	assert.doesNotThrow(() => defaultToolsExtension(pi));
});
