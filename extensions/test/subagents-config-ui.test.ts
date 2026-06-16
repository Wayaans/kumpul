import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { changedDraftPatch, draftFromAgent } from "../subagents/agent-io.ts";
import { loadMergedSubagentsUiConfig, updateProjectSubagentsUiConfig } from "../subagents/config-io.ts";
import { displayModelValue, displayThinkingValue } from "../subagents/setup-ui.ts";
import { resolveEffectiveAgent } from "../subagents/spawn.ts";
import type { AgentConfig } from "../subagents/types.ts";

function tempDir(prefix: string): string {
	return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function testAgent(overrides: Partial<AgentConfig> = {}): AgentConfig {
	return {
		name: "agent",
		description: "Helper agent",
		tools: ["read"],
		model: "anthropic/test-model",
		thinking: "medium",
		systemPrompt: "Help.",
		filePath: "test.md",
		source: "dynamic",
		...overrides,
	};
}

test("config-io merges extension enabled in trusted project yaml", () => {
	const cwd = tempDir("kumpul-subagents-ui-config-");
	updateProjectSubagentsUiConfig(cwd, { enabled: false });
	const loaded = loadMergedSubagentsUiConfig(cwd, { includeProject: true });
	assert.equal(loaded.enabled, false);
});

test("config-io ignores project yaml when project is untrusted", () => {
	const cwd = tempDir("kumpul-subagents-ui-config-untrusted-");
	updateProjectSubagentsUiConfig(cwd, { enabled: false });
	const loaded = loadMergedSubagentsUiConfig(cwd, { includeProject: false });
	assert.equal(loaded.enabled, true);
});

test("config-io rejects malformed trusted project yaml", () => {
	const cwd = tempDir("kumpul-subagents-ui-config-malformed-");
	const configPath = path.join(cwd, ".pi", "kumpul", "config.yaml");
	fs.mkdirSync(path.dirname(configPath), { recursive: true });
	fs.writeFileSync(configPath, "subagents: [", "utf-8");
	assert.throws(() => loadMergedSubagentsUiConfig(cwd, { includeProject: true }), /Failed to parse subagents config/);
	assert.equal(loadMergedSubagentsUiConfig(cwd, { includeProject: false }).enabled, true);
});

test("config-io saves nested config without stale legacy top-level keys", () => {
	const cwd = tempDir("kumpul-subagents-ui-config-legacy-");
	const configPath = path.join(cwd, ".pi", "kumpul", "config.yaml");
	fs.mkdirSync(path.dirname(configPath), { recursive: true });
	fs.writeFileSync(configPath, "enabled: false\ndisabledAgents:\n  - agent\n", "utf-8");
	updateProjectSubagentsUiConfig(cwd, { enabled: true });
	const content = fs.readFileSync(configPath, "utf-8");
	assert.doesNotMatch(content, /^enabled:/m);
	assert.doesNotMatch(content, /^disabledAgents:/m);
	const loaded = loadMergedSubagentsUiConfig(cwd);
	assert.equal(loaded.enabled, true);
});

test("resolveEffectiveAgent does not inject cursor provider extension", () => {
	const effective = resolveEffectiveAgent(testAgent({ model: "Cursor/composer-2.5", extensions: undefined }), {
		model: "",
		thinking: "off",
	});
	assert.equal(effective.extensions, undefined);
});

test("draftFromAgent includes extension, skill, and active skill allowlists", () => {
	const draft = draftFromAgent(testAgent({ extensions: ["find-docs"], skills: ["diagnose"], activeSkills: ["diagnose"] }));
	assert.deepEqual(draft.extensions, ["find-docs"]);
	assert.deepEqual(draft.skills, ["diagnose"]);
	assert.deepEqual(draft.activeSkills, ["diagnose"]);
});

test("changedDraftPatch ignores restored original values", () => {
	const agent = testAgent({ extensions: ["find-docs"], skills: ["diagnose"], model: "", thinking: "" });
	assert.deepEqual(changedDraftPatch(agent, draftFromAgent(agent)), {});
	assert.deepEqual(changedDraftPatch(agent, { ...draftFromAgent(agent), model: "openai-codex/gpt-5.4-mini" }), {
		model: "openai-codex/gpt-5.4-mini",
	});
});

test("changedDraftPatch compares allowlists semantically", () => {
	const agent = testAgent({ extensions: ["pi-web-access", "find-docs"], skills: ["test-driven-development", "diagnose"] });
	assert.deepEqual(changedDraftPatch(agent, { ...draftFromAgent(agent), extensions: ["find-docs", "pi-web-access"], skills: ["diagnose", "test-driven-development"] }), {});
});

test("setup value displays preserve explicit blank inheritance", () => {
	assert.equal(displayModelValue(""), "inherit current");
	assert.equal(displayModelValue("openai-codex/gpt-5.4-mini"), "openai-codex/gpt-5.4-mini");
	assert.equal(displayThinkingValue(""), "inherit current");
	assert.equal(displayThinkingValue("high"), "high");
});
