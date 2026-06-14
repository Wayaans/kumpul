import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import {
	discoverFileAgents,
	findNearestProjectAgentsDir,
	getProjectAgentsDir,
	loadAgentsFromDir,
	parseAgentMarkdown,
} from "../subagents/registry.ts";
import {
	collectNamedExtensionPaths,
	discoverInstalledExtensionToolNames,
	discoverSelectableExtensionOptions,
	discoverSelectableSkillOptions,
	discoverSelectableToolNames,
	resolveCustomToolExtension,
	resolveNamedExtension,
} from "../subagents/resolve-tools.ts";
import { parseCursorThinkingActivity } from "../subagents/cursor-progress.ts";
import { buildPiArgs, extractToolArgsPreview, formatSubagentFailure, MAX_SUBAGENT_DEPTH, progressSignature, resolveEffectiveAgent, runSubagent } from "../subagents/spawn.ts";
import { renderSubagentCall, toolsToShow } from "../subagents/render.ts";
import { displayAgentName, MAX_TOOLS_COLLAPSED } from "../subagents/types.ts";
import { isDangerousBashCommand } from "../subagents/tools/safe-bash.ts";
import { displayModelValue, displayThinkingValue } from "../subagents/setup-ui.ts";
import {
	canEditSkills,
	changedDraftPatch,
	draftFromAgent,
	mergeSelectedWithMissing,
	splitResolvableAllowlist,
	validateDraft,
	writeAgentConfig,
	writeProjectAgentConfig,
} from "../subagents/agent-io.ts";
import {
	loadMergedSubagentsUiConfig,
	updateProjectSubagentsUiConfig,
} from "../subagents/config-io.ts";
import subagentsExtension, { normalizeSubagentAlias, parseConfig, registerAgent, unregisterAgent } from "../subagents/index.ts";
import type { AgentConfig, AgentProgress } from "../subagents/types.ts";

function tempDir(prefix: string): string {
	return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function withoutSubagentAllowlist<T>(fn: () => T): T {
	const previous = process.env.PI_SUBAGENT_ALLOWED;
	delete process.env.PI_SUBAGENT_ALLOWED;
	try {
		return fn();
	} finally {
		if (previous === undefined) delete process.env.PI_SUBAGENT_ALLOWED;
		else process.env.PI_SUBAGENT_ALLOWED = previous;
	}
}

async function withoutSubagentAllowlistAsync<T>(fn: () => Promise<T>): Promise<T> {
	const previous = process.env.PI_SUBAGENT_ALLOWED;
	delete process.env.PI_SUBAGENT_ALLOWED;
	try {
		return await fn();
	} finally {
		if (previous === undefined) delete process.env.PI_SUBAGENT_ALLOWED;
		else process.env.PI_SUBAGENT_ALLOWED = previous;
	}
}

function testAgent(overrides: Partial<AgentConfig> = {}): AgentConfig {
	return {
		name: "helper",
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

test("resolveCustomToolExtension finds kumpul tools", () => {
	assert.ok(resolveCustomToolExtension("safe_bash")?.endsWith("safe-bash.ts"));
	assert.ok(resolveCustomToolExtension("find_docs")?.includes("find-docs"));
	assert.ok(resolveCustomToolExtension("subagent")?.endsWith("subagents/index.ts"));
});

test("discoverFileAgents keeps package prompts while clearing model and allowlists", () => withoutSubagentAllowlist(() => {
	const agents = discoverFileAgents(tempDir("kumpul-subagents-package-defaults-"));
	const names = agents.map((a) => a.name);
	assert.ok(names.includes("agent"));
	assert.ok(names.includes("reviewer"));
	const agent = agents.find((a) => a.name === "agent");
	assert.equal(agent?.source, "package");
	assert.equal(agent?.model, "");
	assert.equal(agent?.thinking, "");
	assert.match(agent?.systemPrompt ?? "", /You are an agent/);
	assert.equal(agent?.extensions, undefined);
	assert.equal(agent?.skills, undefined);
}));

test("project kumpul agents override package builtins by default", () => withoutSubagentAllowlist(() => {
	const cwd = tempDir("kumpul-subagents-project-");
	fs.mkdirSync(path.join(cwd, ".pi", "kumpul", "agens"), { recursive: true });
	fs.writeFileSync(
		path.join(cwd, ".pi", "kumpul", "agens", "reviewer.md"),
		`---
name: reviewer
description: Project-specific reviewer
tools: read
model: anthropic/claude-haiku-4-5
---
Project reviewer body.`,
		"utf-8",
	);
	fs.writeFileSync(
		path.join(cwd, ".pi", "kumpul", "agens", "project-helper.md"),
		`---
name: project-helper
description: Project helper
tools: read
model: anthropic/claude-haiku-4-5
---
Project helper body.`,
		"utf-8",
	);

	const agents = discoverFileAgents(cwd);
	assert.equal(agents.find((a) => a.name === "project-helper")?.source, "project");
	assert.equal(agents.find((a) => a.name === "reviewer")?.description, "Project-specific reviewer");
}));

test("findNearestProjectAgentsDir walks up", () => {
	const root = tempDir("kumpul-subagents-walk-");
	const nested = path.join(root, "a", "b");
	fs.mkdirSync(path.join(root, ".pi", "kumpul", "agens"), { recursive: true });
	fs.mkdirSync(nested, { recursive: true });
	assert.equal(findNearestProjectAgentsDir(nested), fs.realpathSync(path.join(root, ".pi", "kumpul", "agens")));
	assert.equal(getProjectAgentsDir(nested), fs.realpathSync(path.join(root, ".pi", "kumpul", "agens")));
});

test("parseAgentMarkdown reads subagent_agents", () => {
	const cwd = tempDir("kumpul-subagents-parse-");
	const filePath = path.join(cwd, "test.md");
	fs.writeFileSync(
		filePath,
		`---
name: helper
description: Helper agent
tools: read, subagent
subagent_agents: reviewer
model: anthropic/claude-sonnet-4-6
---
Body.`,
		"utf-8",
	);
	const agent = parseAgentMarkdown(filePath);
	assert.equal(agent?.subagentAgents?.join(","), "reviewer");
});

test("parseAgentMarkdown reads extension and skill allowlists", () => {
	const cwd = tempDir("kumpul-subagents-parse-allowlists-");
	const filePath = path.join(cwd, "test.md");
	fs.writeFileSync(
		filePath,
		`---
name: helper
description: Helper agent
tools: read
extensions: find-docs, pi-web-access
skills: diagnose, test-driven-development
model: anthropic/claude-sonnet-4-6
---
Body.`,
		"utf-8",
	);
	const agent = parseAgentMarkdown(filePath);
	assert.deepEqual(agent?.extensions, ["find-docs", "pi-web-access"]);
	assert.deepEqual(agent?.skills, ["diagnose", "test-driven-development"]);
});

test("frontmatter validation rejects non-canonical extension and skill names", () => {
	const dir = tempDir("kumpul-subagents-canonical-names-");
	fs.writeFileSync(
		path.join(dir, "bad-extension.md"),
		`---
name: helper
description: Helper agent
tools: read
extensions: find_docs
model: anthropic/claude-sonnet-4-6
---
Body.`,
		"utf-8",
	);
	fs.writeFileSync(
		path.join(dir, "bad-skill.md"),
		`---
name: helper
description: Helper agent
tools: read
skills: test_driven_development
model: anthropic/claude-sonnet-4-6
---
Body.`,
		"utf-8",
	);
	assert.equal(parseAgentMarkdown(path.join(dir, "bad-extension.md")), null);
	assert.equal(parseAgentMarkdown(path.join(dir, "bad-skill.md")), null);
});

test("frontmatter validation rejects skills without read access", () => {
	const dir = tempDir("kumpul-subagents-skill-read-");
	const filePath = path.join(dir, "helper.md");
	fs.writeFileSync(
		filePath,
		`---
name: helper
description: Helper agent
tools: grep
skills: diagnose
model: anthropic/claude-sonnet-4-6
---
Body.`,
		"utf-8",
	);
	assert.equal(parseAgentMarkdown(filePath), null);
});

test("frontmatter validation skips invalid markdown", () => {
	const dir = tempDir("kumpul-subagents-skip-");
	fs.writeFileSync(path.join(dir, "bad.md"), "# no frontmatter\n", "utf-8");
	fs.writeFileSync(
		path.join(dir, "bad-description.md"),
		`---
name: bad-description
tools: read
model: anthropic/test
---
Body.`,
		"utf-8",
	);
	fs.writeFileSync(
		path.join(dir, "bad-model-type.md"),
		`---
name: bad-model-type
description: Bad
tools: read
model: 123
---
Body.`,
		"utf-8",
	);
	fs.writeFileSync(
		path.join(dir, "bad-thinking.md"),
		`---
name: bad-thinking
description: Bad
tools: read
model: anthropic/test
thinking: enormous
---
Body.`,
		"utf-8",
	);
	fs.writeFileSync(
		path.join(dir, "bad-nested.md"),
		`---
name: bad-nested
description: Bad
tools: read, subagent
model: anthropic/test
---
Body.`,
		"utf-8",
	);
	assert.equal(loadAgentsFromDir(dir).length, 0);
});

test("registerAgent rejects invalid dynamic agents", () => withoutSubagentAllowlist(() => {
	assert.throws(() => registerAgent(testAgent({ description: "" })), /description/);
	assert.throws(() => registerAgent({ ...testAgent({ name: "bad-source" }), source: "other" as AgentConfig["source"] }), /source/);
	assert.throws(
		() => registerAgent({ ...testAgent({ name: "bad-subagents" }), subagentAgents: "reviewer" as unknown as string[] }),
		/subagent_agents/,
	);
}));

test("parseConfig validates maxConcurrency", () => {
	assert.deepEqual(parseConfig(null), {});
	assert.deepEqual(parseConfig({ maxConcurrency: 2 }), { maxConcurrency: 2 });
	assert.throws(() => parseConfig({ maxConcurrency: 0 }), /maxConcurrency/);
	assert.throws(() => parseConfig({ maxConcurrency: 1.5 }), /maxConcurrency/);
});

test("parseCursorThinkingActivity maps Cursor SDK replay lines", () => {
	assert.deepEqual(parseCursorThinkingActivity("$ grep foo bar.ts\n\nbar.ts:1"), {
		tool: "grep",
		args: "grep foo bar.ts",
	});
	assert.deepEqual(parseCursorThinkingActivity("read extensions/foo.ts\n\ncontents"), {
		tool: "read",
		args: "extensions/foo.ts",
	});
	assert.equal(parseCursorThinkingActivity("I will read spawn.ts."), undefined);
});

test("buildPiArgs pins child model scope to the agent frontmatter model", async () => {
	const agent = testAgent({ model: "openai-codex/gpt-5.4-mini", tools: ["read"] });
	const { args } = await buildPiArgs(agent, "task");
	const modelIdx = args.indexOf("--model");
	const modelsIdx = args.indexOf("--models");
	assert.ok(modelIdx >= 0, "expected --model flag");
	assert.ok(modelsIdx >= 0, "expected --models flag");
	assert.equal(args[modelIdx + 1], "openai-codex/gpt-5.4-mini");
	assert.equal(args[modelsIdx + 1], "openai-codex/gpt-5.4-mini");
});

test("buildPiArgs omits --model, --models, and --thinking when agent values are empty", async () => {
	const { args } = await buildPiArgs(testAgent({ model: "", thinking: "", tools: ["read"] }), "task");
	assert.equal(args.indexOf("--model"), -1);
	assert.equal(args.indexOf("--models"), -1);
	assert.equal(args.indexOf("--thinking"), -1);
});

test("buildPiArgs injects pi-cursor-sdk for cursor/* models", async () => {
	const agent = testAgent({ model: "cursor/composer-2.5", tools: ["read"] });
	const { args } = await buildPiArgs(agent, "task");
	assert.equal(args[args.indexOf("--model") + 1], "cursor/composer-2.5");
	const extensionPaths: string[] = [];
	for (let i = 0; i < args.length; i++) {
		if (args[i] === "--extension") extensionPaths.push(args[i + 1]!);
	}
	assert.equal(extensionPaths.filter((p) => p.includes("pi-cursor-sdk")).length, 1);
});

test("buildPiArgs loads pi-cursor-sdk from the explicit extension allowlist", async () => {
	const agent = testAgent({ model: "cursor/composer-2.5", tools: ["read"], extensions: ["pi-cursor-sdk"] });
	const { args } = await buildPiArgs(agent, "task");
	const extensionPaths: string[] = [];
	for (let i = 0; i < args.length; i++) {
		if (args[i] === "--extension") extensionPaths.push(args[i + 1]!);
	}
	assert.ok(extensionPaths.some((p) => p.includes("pi-cursor-sdk")), "expected pi-cursor-sdk --extension");
});

test("subagent depth env rejects spawning beyond max depth", async () => {
	const previous = process.env.PI_SUBAGENT_DEPTH;
	process.env.PI_SUBAGENT_DEPTH = String(MAX_SUBAGENT_DEPTH);
	try {
		await assert.rejects(buildPiArgs(testAgent(), "task"), /depth/);
	} finally {
		if (previous === undefined) delete process.env.PI_SUBAGENT_DEPTH;
		else process.env.PI_SUBAGENT_DEPTH = previous;
	}
});

test("tool resolution fails fast for unknown tools", async () => {
	await assert.rejects(buildPiArgs(testAgent({ tools: ["missing_tool"] }), "task"), /Unable to resolve tools/);
});

test("buildPiArgs loads named extension allowlist while keeping discovery disabled", async () => {
	const { args } = await buildPiArgs(testAgent({ tools: ["read"], extensions: ["find-docs"] }), "task");
	const noExtensionsIdx = args.indexOf("--no-extensions");
	const extensionIdx = args.indexOf("--extension");
	assert.ok(noExtensionsIdx >= 0, "expected --no-extensions");
	assert.ok(extensionIdx > noExtensionsIdx, "expected explicit extension after --no-extensions");
	assert.match(args[extensionIdx + 1] ?? "", /extensions\/find-docs\/index\.ts$/);
});

test("extension allowlist resolves extension names instead of tool-name collisions", async () => {
	const fakeDir = tempDir("kumpul-subagents-fake-ext-");
	const fakeExtension = path.join(fakeDir, "index.ts");
	fs.writeFileSync(fakeExtension, "export default function () {}\n", "utf-8");
	const { args } = await buildPiArgs(
		testAgent({ tools: ["read"], extensions: ["find-docs"] }),
		"task",
		new Map([["find-docs", fakeExtension]]),
	);
	const extensionIdx = args.indexOf("--extension");
	assert.match(args[extensionIdx + 1] ?? "", /extensions\/find-docs\/index\.ts$/);
	assert.notEqual(args[extensionIdx + 1], fakeExtension);
});

test("extension allowlist resolves project-local extension names from cwd", async () => {
	const cwd = tempDir("kumpul-subagents-project-ext-");
	const extDir = path.join(cwd, ".pi", "extensions", "project-helper");
	fs.mkdirSync(extDir, { recursive: true });
	fs.writeFileSync(path.join(extDir, "index.ts"), "export default function () {}\n", "utf-8");
	const { args } = await buildPiArgs(
		testAgent({ tools: ["read"], extensions: ["project-helper"] }),
		"task",
		new Map(),
		new Map(),
		cwd,
	);
	const extensionIdx = args.indexOf("--extension");
	assert.equal(args[extensionIdx + 1], path.join(extDir, "index.ts"));
});

test("project-local extension names take precedence over loaded metadata", async () => {
	const cwd = tempDir("kumpul-subagents-project-ext-win-");
	const extDir = path.join(cwd, ".pi", "extensions", "project-helper");
	fs.mkdirSync(extDir, { recursive: true });
	fs.writeFileSync(path.join(extDir, "index.ts"), "export default function () {}\n", "utf-8");
	const fakeDir = tempDir("kumpul-subagents-loaded-ext-");
	const fakeExtension = path.join(fakeDir, "index.ts");
	fs.writeFileSync(fakeExtension, "export default function () {}\n", "utf-8");
	const { args } = await buildPiArgs(
		testAgent({ tools: ["read"], extensions: ["project-helper"] }),
		"task",
		new Map(),
		new Map(),
		cwd,
		new Map([["project-helper", fakeExtension]]),
	);
	const extensionIdx = args.indexOf("--extension");
	assert.equal(args[extensionIdx + 1], path.join(extDir, "index.ts"));
});

test("named extension metadata uses explicit source names for nested entrypoints", () => {
	const entrypoint = path.join(tempDir("kumpul-subagents-nested-ext-"), "nested-helper", "src", "index.ts");
	fs.mkdirSync(path.dirname(entrypoint), { recursive: true });
	fs.writeFileSync(entrypoint, "export default function () {}\n", "utf-8");
	const names = collectNamedExtensionPaths([
		{
			name: "nested_tool",
			label: "Nested Tool",
			description: "",
			parameters: {},
			sourceInfo: { path: entrypoint, source: "nested-helper", scope: "user", origin: "top-level" },
		},
	] as never);
	assert.equal(names.get("nested-helper"), entrypoint);
	assert.equal(names.has("src"), false);
});

test("named extension metadata ignores non-extension commands", async () => {
	const skillPath = path.join(tempDir("kumpul-subagents-skill-command-"), "SKILL.md");
	fs.writeFileSync(skillPath, "---\nname: fake-extension\ndescription: Fake.\n---\n", "utf-8");
	const commands = [
		{ name: "skill:fake-extension", source: "skill", sourceInfo: { path: skillPath, source: "fake-extension" } },
	];
	const names = collectNamedExtensionPaths([], commands);
	assert.equal(names.has("fake-extension"), false);
	assert.equal(discoverSelectableExtensionOptions([], commands).some((option) => option.name === "fake-extension"), false);
	await assert.rejects(
		buildPiArgs(testAgent({ tools: ["read"], extensions: ["fake-extension"] }), "task", new Map(), new Map(), process.cwd(), names),
		/Unable to resolve extensions/,
	);
});

test("named extension metadata ignores tool implementation file basenames", () => {
	const toolFile = path.join(tempDir("kumpul-subagents-tool-file-"), "tools", "project-helper.ts");
	fs.mkdirSync(path.dirname(toolFile), { recursive: true });
	fs.writeFileSync(toolFile, "export default function () {}\n", "utf-8");
	const names = collectNamedExtensionPaths([
		{ name: "project_helper", label: "Project Helper", description: "", parameters: {}, sourceInfo: { path: toolFile } },
	] as never);
	assert.equal(names.has("project-helper"), false);
});

test("buildPiArgs loads named skill allowlist without auto-invoking it", async () => {
	const { args } = await buildPiArgs(testAgent({ tools: ["read"], skills: ["test-driven-development"] }), "task");
	const noSkillsIdx = args.indexOf("--no-skills");
	const skillIdx = args.indexOf("--skill");
	assert.ok(noSkillsIdx >= 0, "expected --no-skills");
	assert.ok(skillIdx > noSkillsIdx, "expected explicit skill after --no-skills");
	assert.match(args[skillIdx + 1] ?? "", /skills\/test-driven-development\/SKILL\.md$/);
	assert.ok(args.includes("Task: task"));
	assert.equal(args.some((arg) => arg.startsWith("/skill:")), false);
});

test("skill allowlist resolves project skills before package skills", async () => {
	const cwd = tempDir("kumpul-subagents-project-skill-");
	const skillDir = path.join(cwd, ".pi", "skills", "test-driven-development");
	fs.mkdirSync(skillDir, { recursive: true });
	fs.writeFileSync(
		path.join(skillDir, "SKILL.md"),
		`---
name: test-driven-development
description: Project TDD skill.
---
Project skill body.
`,
		"utf-8",
	);
	const { args } = await buildPiArgs(
		testAgent({ tools: ["read"], skills: ["test-driven-development"] }),
		"task",
		new Map(),
		new Map(),
		cwd,
	);
	const skillIdx = args.indexOf("--skill");
	assert.equal(args[skillIdx + 1], path.join(skillDir, "SKILL.md"));
});

test("project-local skills take precedence over loaded skill metadata", async () => {
	const cwd = tempDir("kumpul-subagents-project-skill-win-");
	const skillDir = path.join(cwd, ".pi", "skills", "diagnose");
	fs.mkdirSync(skillDir, { recursive: true });
	fs.writeFileSync(
		path.join(skillDir, "SKILL.md"),
		`---
name: diagnose
description: Project diagnose skill.
---
Project skill body.
`,
		"utf-8",
	);
	const fakeDir = tempDir("kumpul-subagents-loaded-skill-");
	const fakeSkill = path.join(fakeDir, "SKILL.md");
	fs.writeFileSync(fakeSkill, "---\nname: diagnose\ndescription: Fake.\n---\nFake.\n", "utf-8");
	const { args } = await buildPiArgs(
		testAgent({ tools: ["read"], skills: ["diagnose"] }),
		"task",
		new Map(),
		new Map([["diagnose", fakeSkill]]),
		cwd,
	);
	const skillIdx = args.indexOf("--skill");
	assert.equal(args[skillIdx + 1], path.join(skillDir, "SKILL.md"));
});

test("buildPiArgs fails fast for unknown extension and skill allowlist names", async () => {
	await assert.rejects(
		buildPiArgs(testAgent({ tools: ["read"], extensions: ["missing-extension"] }), "task"),
		/Unable to resolve extensions/,
	);
	await assert.rejects(
		buildPiArgs(testAgent({ tools: ["read"], skills: ["missing-skill"] }), "task"),
		/Unable to resolve skills/,
	);
});

test("validateDraft rejects empty tool allowlists", () => {
	const agent = testAgent({ tools: ["read"] });
	const error = validateDraft(agent, { tools: [], model: agent.model });
	assert.ok(error);
	assert.match(error, /tool/);
});

test("validateDraft rejects drafted skills without read", () => {
	const agent = testAgent({ tools: ["read"] });
	const error = validateDraft(agent, { tools: ["grep"], skills: ["diagnose"], model: agent.model });
	assert.ok(error);
	assert.match(error, /read/);
});

test("validateDraft rejects model and thinking values discovery would skip", () => {
	const agent = testAgent();
	assert.match(validateDraft(agent, { model: "/missing-provider" }) ?? "", /Model/);
	assert.match(validateDraft(agent, { model: "missing-model/" }) ?? "", /Model/);
	assert.match(validateDraft(agent, { model: "cursor/composer/extra" }) ?? "", /Model/);
	assert.match(validateDraft(agent, { thinking: "enormous" }) ?? "", /Thinking/);
	assert.equal(validateDraft(agent, { model: "", thinking: "" }), null);
	assert.equal(validateDraft(agent, { thinking: "off" }), null);
});

test("mergeSelectedWithMissing preserves unresolved saved allowlist names", () => {
	assert.deepEqual(
		mergeSelectedWithMissing(["pi-web-access"], ["find-docs", "missing-extension"], ["find-docs", "pi-web-access"]),
		["pi-web-access", "missing-extension"],
	);
});

test("splitResolvableAllowlist reports missing names even with no options", () => {
	assert.deepEqual(splitResolvableAllowlist(["missing-skill"], []), {
		selected: [],
		missing: ["missing-skill"],
	});
});

test("canEditSkills requires read access", () => {
	assert.equal(canEditSkills(["read"]), true);
	assert.equal(canEditSkills(["grep"]), false);
});

test("validateDraft rejects skilled agents without read", () => {
	const agent = testAgent({ tools: ["read"], skills: ["diagnose"] });
	const error = validateDraft(agent, { tools: ["grep"], model: agent.model });
	assert.ok(error);
	assert.match(error, /read/);
});

test("writeAgentConfig updates frontmatter and preserves body", () => {
	const cwd = tempDir("kumpul-subagents-write-");
	const filePath = path.join(cwd, "helper.md");
	fs.writeFileSync(
		filePath,
		`---
name: helper
description: Helper
tools: read
model: anthropic/claude-sonnet-4-6
thinking: medium
---

Keep this body.`,
		"utf-8",
	);
	writeAgentConfig(filePath, {
		tools: ["read", "grep"],
		model: "",
		thinking: "high",
	});
	const agent = parseAgentMarkdown(filePath);
	assert.deepEqual(agent?.tools, ["read", "grep"]);
	assert.equal(agent?.model, "");
	assert.equal(agent?.thinking, "high");
	assert.match(fs.readFileSync(filePath, "utf-8"), /^model:$/m);
	assert.match(fs.readFileSync(filePath, "utf-8"), /Keep this body\./);
});

test("writeProjectAgentConfig creates project-local overrides from package agents", () => {
	const cwd = tempDir("kumpul-subagents-project-write-");
	const sourcePath = path.join(cwd, "source.md");
	fs.writeFileSync(
		sourcePath,
		`---
name: agent
description: Helper agent
tools: read
model: anthropic/test-model
thinking: medium
custom_field: keep-me
metadata:
  owner: me
---

`,
		"utf-8",
	);
	const filePath = path.join(cwd, ".pi", "kumpul", "agens", "agent.md");
	writeProjectAgentConfig(testAgent({ name: "agent", source: "package", systemPrompt: "", filePath: sourcePath }), filePath, {
		model: "",
		extensions: [],
		skills: [],
	});
	const content = fs.readFileSync(filePath, "utf-8");
	assert.match(content, /^model:$/m);
	assert.match(content, /^custom_field: keep-me$/m);
	assert.match(content, /metadata:\n\s+owner: me/);
	assert.doesNotMatch(content, /^extensions:/m);
	assert.doesNotMatch(content, /^skills:/m);
	assert.equal(parseAgentMarkdown(filePath, "project")?.source, "project");
});

test("writeProjectAgentConfig preserves blank inheritance markers from source frontmatter", () => {
	const cwd = tempDir("kumpul-subagents-project-write-blanks-");
	const sourcePath = path.join(cwd, "source.md");
	fs.writeFileSync(
		sourcePath,
		`---
name: agent
description: Helper agent
tools: read
model:
thinking:
---

Prompt.
`,
		"utf-8",
	);
	const filePath = path.join(cwd, ".pi", "kumpul", "agens", "agent.md");
	writeProjectAgentConfig(testAgent({ name: "agent", model: "", thinking: "", filePath: sourcePath, systemPrompt: "Prompt.\n" }), filePath, {
		tools: ["read", "grep"],
	});
	const content = fs.readFileSync(filePath, "utf-8");
	assert.match(content, /^model:$/m);
	assert.match(content, /^thinking:$/m);
});

test("writeAgentConfig writes and removes extension and skill allowlists", () => {
	const cwd = tempDir("kumpul-subagents-write-resources-");
	const filePath = path.join(cwd, "helper.md");
	fs.writeFileSync(
		filePath,
		`---
name: helper
description: Helper
tools: read
extensions: find-docs
skills: diagnose
model: anthropic/claude-sonnet-4-6
thinking: medium
---

Keep this body.`,
		"utf-8",
	);
	writeAgentConfig(filePath, { extensions: ["pi-web-access"], skills: [] });
	const content = fs.readFileSync(filePath, "utf-8");
	assert.match(content, /extensions: pi-web-access/);
	assert.doesNotMatch(content, /^skills:/m);
	const agent = parseAgentMarkdown(filePath);
	assert.deepEqual(agent?.extensions, ["pi-web-access"]);
	assert.equal(agent?.skills, undefined);
});

test("discoverSelectableExtensionOptions labels resolvable extension sources", () => {
	const cwd = tempDir("kumpul-subagents-extension-options-");
	const projectExt = path.join(cwd, ".pi", "extensions", "project-helper");
	fs.mkdirSync(projectExt, { recursive: true });
	fs.writeFileSync(path.join(projectExt, "index.ts"), "export default function () {}\n", "utf-8");
	const options = discoverSelectableExtensionOptions([], [], cwd);
	assert.equal(options.find((option) => option.name === "project-helper")?.source, "project");
	assert.equal(options.find((option) => option.name === "find-docs")?.source, "package");
	assert.equal(options.some((option) => option.name === "missing-extension"), false);
});

test("discoverSelectableSkillOptions labels resolvable skill sources", () => {
	const cwd = tempDir("kumpul-subagents-skill-options-");
	const projectSkill = path.join(cwd, ".pi", "skills", "project-skill");
	fs.mkdirSync(projectSkill, { recursive: true });
	fs.writeFileSync(path.join(projectSkill, "SKILL.md"), "---\nname: project-skill\ndescription: Project skill.\n---\n", "utf-8");
	const loadedDir = tempDir("kumpul-subagents-loaded-skill-option-");
	const loadedSkill = path.join(loadedDir, "SKILL.md");
	fs.writeFileSync(loadedSkill, "---\nname: loaded-skill\ndescription: Loaded skill.\n---\n", "utf-8");
	const options = discoverSelectableSkillOptions(
		[{ name: "skill:loaded-skill", source: "skill", sourceInfo: { path: loadedSkill } }],
		cwd,
	);
	assert.equal(options.find((option) => option.name === "project-skill")?.source, "project");
	assert.equal(options.find((option) => option.name === "loaded-skill")?.source, "loaded");
	assert.equal(options.find((option) => option.name === "test-driven-development")?.source, "package");
	assert.equal(options.some((option) => option.name === "missing-skill"), false);
});

test("discoverSelectableSkillOptions skips dangling project skill entries", () => {
	const cwd = tempDir("kumpul-subagents-dangling-skill-option-");
	const skillsDir = path.join(cwd, ".agents", "skills");
	fs.mkdirSync(path.join(skillsDir, "valid-skill"), { recursive: true });
	fs.writeFileSync(path.join(skillsDir, "valid-skill", "SKILL.md"), "---\nname: valid-skill\ndescription: Valid skill.\n---\n", "utf-8");
	fs.symlinkSync(path.join(cwd, "missing-target"), path.join(skillsDir, "laravel-specialist"));

	const options = discoverSelectableSkillOptions([], cwd);
	assert.equal(options.find((option) => option.name === "valid-skill")?.source, "project");
});

test("discoverSelectableToolNames includes builtins, session tools, and kumpul extension tools", () => {
	const names = discoverSelectableToolNames([
		{ name: "custom_tool", label: "Custom", description: "", parameters: {} },
	] as never);
	assert.ok(names.includes("read"));
	assert.ok(names.includes("custom_tool"));
	assert.ok(resolveCustomToolExtension("safe_bash"));
	if (resolveCustomToolExtension("safe_bash")) assert.ok(names.includes("safe_bash"));
});

test("discoverInstalledExtensionToolNames scans kumpul extensions", () => {
	const names = discoverInstalledExtensionToolNames();
	assert.ok(names.includes("subagent"));
	assert.ok(names.includes("find_docs"));
});

test("discoverInstalledExtensionToolNames scans resolver-supported npm extension packages", (t) => {
	if (!resolveNamedExtension("pi-web-access")) {
		t.skip("pi-web-access not installed");
		return;
	}
	const names = discoverInstalledExtensionToolNames();
	assert.ok(names.includes("fetch_content"));
});

test("tools discovered from npm extension packages are spawnable", async (t) => {
	const piWebAccess = resolveNamedExtension("pi-web-access");
	if (!piWebAccess) {
		t.skip("pi-web-access not installed");
		return;
	}
	const { args } = await buildPiArgs(testAgent({ tools: ["fetch_content"] }), "task", new Map(), new Map(), process.cwd());
	const extensionIdx = args.indexOf("--extension");
	assert.equal(args[extensionIdx + 1], piWebAccess);
});

test("discoverSelectableToolNames preserves agent configured tools", () => {
	const names = discoverSelectableToolNames([], ["fetch_content"]);
	assert.ok(names.includes("fetch_content"));
});

test("discoverSelectableToolNames omits unconfigured phantom tools", () => {
	const names = discoverSelectableToolNames([]);
	assert.ok(!names.includes("totally_fake_tool_xyz"));
});

test("subagents extension registers without throwing", () => {
	const pi = {
		on() {},
		registerCommand(name: string) {
			assert.equal(name, "subagents");
		},
		registerMessageRenderer() {},
		registerTool(tool: { name: string }) {
			assert.equal(tool.name, "subagent");
		},
		getActiveTools() {
			return [];
		},
		getAllTools() {
			return [];
		},
		setActiveTools() {},
		sendMessage() {},
		exec: async () => ({ code: 0, stdout: "", stderr: "" }),
	} as unknown as ExtensionAPI;

	assert.doesNotThrow(() => subagentsExtension(pi));
});

test("runSubagent resolves on agent_end even when child process stays alive", async () => withoutSubagentAllowlistAsync(async () => {
	const binDir = tempDir("kumpul-subagents-bin-");
	const fakePi = path.join(binDir, "pi");
	fs.writeFileSync(
		fakePi,
		`#!/usr/bin/env node
console.log(JSON.stringify({ type: "message_end", message: { role: "assistant", stopReason: "stop", content: [{ type: "text", text: "final summary" }] } }));
console.log(JSON.stringify({ type: "agent_end", messages: [] }));
setInterval(() => {}, 1000);
`,
		{ encoding: "utf-8", mode: 0o700 },
	);

	const previousPath = process.env.PATH;
	process.env.PATH = `${binDir}${path.delimiter}${previousPath ?? ""}`;
	const abort = new AbortController();
	const run = runSubagent(testAgent({ name: "agent-end", tools: [] }), "finish", process.cwd(), abort.signal);
	let timedOut = false;
	let timeout: ReturnType<typeof setTimeout> | undefined;
	try {
		const timeoutResult = new Promise<undefined>((resolve) => {
			timeout = setTimeout(() => {
				timedOut = true;
				abort.abort();
				resolve(undefined);
			}, 2000);
		});
		const result = await Promise.race([run, timeoutResult]);
		if (timedOut || !result) assert.fail("subagent did not resolve after agent_end");
		assert.equal(result.exitCode, 0);
		assert.equal(result.progress.status, "completed");
		assert.equal(result.output, "final summary");
	} finally {
		if (timeout) clearTimeout(timeout);
		if (timedOut) await run.catch(() => undefined);
		process.env.PATH = previousPath;
	}
}));

test("execute passes and scopes parent model when agent model is empty", async () => withoutSubagentAllowlistAsync(async () => {
	const binDir = tempDir("kumpul-subagents-bin-");
	const fakePi = path.join(binDir, "pi");
	fs.writeFileSync(
		fakePi,
		`#!/usr/bin/env node
const modelIdx = process.argv.indexOf("--model");
if (modelIdx < 0 || process.argv[modelIdx + 1] !== "cursor/composer-2.5") {
  console.error("missing inherited model", JSON.stringify(process.argv));
  process.exit(2);
}
const modelsIdx = process.argv.indexOf("--models");
if (modelsIdx < 0 || process.argv[modelsIdx + 1] !== "cursor/composer-2.5") {
  console.error("missing inherited model scope", JSON.stringify(process.argv));
  process.exit(2);
}
const thinkingIdx = process.argv.indexOf("--thinking");
if (thinkingIdx < 0 || process.argv[thinkingIdx + 1] !== "off") {
  console.error("missing inherited thinking", JSON.stringify(process.argv));
  process.exit(2);
}
const extensionArgs = process.argv.filter((arg, index) => process.argv[index - 1] === "--extension");
if (!extensionArgs.some((arg) => arg.includes("pi-cursor-sdk"))) {
  console.error("missing inherited cursor provider", JSON.stringify(process.argv));
  process.exit(2);
}
console.log(JSON.stringify({ type: "message_end", message: { role: "assistant", stopReason: "stop", content: [{ type: "text", text: "ok" }] } }));
console.log(JSON.stringify({ type: "agent_end", messages: [] }));
`,
		{ encoding: "utf-8", mode: 0o700 },
	);

	const previousPath = process.env.PATH;
	process.env.PATH = `${binDir}${path.delimiter}${previousPath ?? ""}`;
	registerAgent(testAgent({ name: "inherits-main", model: "", thinking: "", tools: ["read"] }));
	try {
		type RegisteredSubagentTool = {
			name: string;
			execute(
				toolCallId: string,
				params: { agent: string; task: string; cwd?: string },
				signal: AbortSignal | undefined,
				onUpdate: undefined,
				ctx: {
					cwd: string;
					model: { provider: string; id: string };
					modelRegistry: { find(): { contextWindow: number } | undefined };
				},
			): Promise<{ content: Array<{ type: string; text: string }> }>;
		};
		let registered: RegisteredSubagentTool | undefined;
		const pi = {
			on() {},
			registerCommand() {},
			registerMessageRenderer() {},
			registerTool(tool: unknown) {
				registered = tool as RegisteredSubagentTool;
			},
			getActiveTools() {
				return [];
			},
			getAllTools() {
				return [];
			},
			getCommands() {
				return [];
			},
			setActiveTools() {},
			sendMessage() {},
			getThinkingLevel() {
				return "off";
			},
			exec: async () => ({ code: 0, stdout: "", stderr: "" }),
		} as unknown as ExtensionAPI;

		subagentsExtension(pi);
		assert.ok(registered);
		const result = await registered.execute("tool-call", { agent: "inherits-main", task: "ok" }, undefined, undefined, {
			cwd: process.cwd(),
			model: { provider: "cursor", id: "composer-2.5" },
			modelRegistry: { find: () => ({ contextWindow: 200000 }) },
		});
		assert.equal(result.content[0]?.text, "ok");
	} finally {
		unregisterAgent("inherits-main");
		process.env.PATH = previousPath;
	}
}));

test("execute throws when subagent process fails", async () => withoutSubagentAllowlistAsync(async () => {
	const binDir = tempDir("kumpul-subagents-bin-");
	const fakePi = path.join(binDir, "pi");
	fs.writeFileSync(
		fakePi,
		`#!/bin/sh
echo '{"type":"message_end","message":{"role":"assistant","errorMessage":"model failed","content":[{"type":"text","text":"bad output"}]}}'
echo 'spawn stderr' >&2
exit 3
`,
		{ encoding: "utf-8", mode: 0o700 },
	);

	const previousPath = process.env.PATH;
	process.env.PATH = `${binDir}${path.delimiter}${previousPath ?? ""}`;
	registerAgent(testAgent({ name: "failer" }));
	try {
		type RegisteredSubagentTool = {
			name: string;
			execute(
				toolCallId: string,
				params: { agent: string; task: string; cwd?: string },
				signal: AbortSignal | undefined,
				onUpdate: undefined,
				ctx: { cwd: string; modelRegistry: { find(): undefined } },
			): Promise<unknown>;
		};
		let registered: RegisteredSubagentTool | undefined;
		const pi = {
			on() {},
			registerCommand() {},
			registerMessageRenderer() {},
			registerTool(tool: unknown) {
				registered = tool as RegisteredSubagentTool;
			},
			getActiveTools() {
				return [];
			},
			getAllTools() {
				return [];
			},
			getCommands() {
				return [];
			},
			setActiveTools() {},
			sendMessage() {},
			exec: async () => ({ code: 0, stdout: "", stderr: "" }),
		} as unknown as ExtensionAPI;

		subagentsExtension(pi);
		assert.ok(registered);
		await assert.rejects(
			registered.execute("tool-call", { agent: "failer", task: "fail" }, undefined, undefined, {
				cwd: process.cwd(),
				modelRegistry: { find: () => undefined },
			}),
			/error: model failed[\s\S]*stderr: spawn stderr/,
		);
	} finally {
		unregisterAgent("failer");
		process.env.PATH = previousPath;
	}
}));
