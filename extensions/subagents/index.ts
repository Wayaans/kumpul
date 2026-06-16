/**
 * Subagents — isolated child pi processes with live TUI progress.
 * Derived from https://github.com/amosblomqvist/pi-subagents
 */
import { randomUUID } from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { Type } from "@earendil-works/pi-ai";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { getGeneratedSubagentAliasForExecute } from "./aliases.ts";
import { loadMergedSubagentsUiConfig } from "./config-io.ts";
import { getAgent, loadAgents, sanitizeDiscoveryCwd } from "./registry.ts";
import { showSubagentsSetup } from "./setup-ui.ts";
import {
	renderSubagentCall,
	renderSubagentResult,
} from "./render.ts";
import { formatDuration, formatSubagentFailure, resolveEffectiveAgent, runSubagent, Semaphore } from "./spawn.ts";
import { collectNamedExtensionPaths, collectSkillPaths, collectToolExtensionPaths } from "./resolve-tools.ts";
import { containsControlCharacters, parseModelRef, type AgentResult, type ExtensionConfig, type SubagentDetails } from "./types.ts";

const EXTENSION_DIR = fileURLToPath(new URL(".", import.meta.url));
const CONFIG_PATH = path.join(EXTENSION_DIR, "config.json");
const DEFAULT_MAX_CONCURRENCY = 4;

function isProjectTrusted(ctx: ExtensionContext): boolean {
	return ((ctx as ExtensionContext & { isProjectTrusted?: () => boolean }).isProjectTrusted?.() ?? false);
}

export function normalizeSubagentAlias(raw: unknown): string | undefined {
	if (raw === undefined || raw === null) return undefined;
	if (typeof raw !== "string") throw new Error("subagent alias must be a string");
	const trimmed = raw.trim();
	if (!trimmed) throw new Error("subagent alias must not be empty");
	if (containsControlCharacters(trimmed)) {
		throw new Error("subagent alias must not contain control characters");
	}
	if (/\d/.test(trimmed)) throw new Error("subagent alias must not contain digits");
	return trimmed;
}

function isCanonicalResourceName(name: string): boolean {
	return /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(name);
}

export function normalizeActiveSkills(raw: unknown): string[] {
	if (raw === undefined || raw === null) return [];
	if (!Array.isArray(raw)) throw new Error("subagent active_skills must be an array");
	const skills: string[] = [];
	for (const value of raw) {
		if (typeof value !== "string") throw new Error("subagent active_skills entries must be strings");
		const name = value.trim();
		if (!name || !isCanonicalResourceName(name)) {
			throw new Error("subagent active_skills entries must be canonical skill names");
		}
		if (!skills.includes(name)) skills.push(name);
	}
	return skills;
}

export function parseConfig(raw: unknown): ExtensionConfig {
	if (!raw || typeof raw !== "object") return {};
	const obj = raw as Record<string, unknown>;
	const config: ExtensionConfig = {};
	if (obj.maxConcurrency !== undefined) {
		if (typeof obj.maxConcurrency !== "number" || !Number.isInteger(obj.maxConcurrency) || obj.maxConcurrency < 1) {
			throw new Error("subagents config maxConcurrency must be an integer >= 1");
		}
		config.maxConcurrency = obj.maxConcurrency;
	}
	return config;
}

export function loadConfig(): ExtensionConfig {
	try {
		if (fs.existsSync(CONFIG_PATH)) {
			return parseConfig(JSON.parse(fs.readFileSync(CONFIG_PATH, "utf-8")));
		}
	} catch (error) {
		throw new Error(`Unable to load subagents config: ${error instanceof Error ? error.message : String(error)}`);
	}
	return {};
}

export default function (pi: ExtensionAPI): void {
	const config = loadConfig();
	const semaphore = new Semaphore(config.maxConcurrency ?? DEFAULT_MAX_CONCURRENCY);

	loadAgents(process.cwd(), { includeProject: false });

	pi.registerCommand("subagents", {
		description: "Configure subagents (extension, tools, model, thinking, skills, active skills)",
		handler: async (_args, ctx) => {
			await showSubagentsSetup(pi, ctx);
		},
	});

	pi.registerTool({
		name: "subagent",
		label: "Subagent",
		description:
			"Run a subagent to complete a task. Subagents have NO context from the current conversation — include all necessary context in the task description.",
		promptSnippet: "Run subagents for delegated tasks",
		promptGuidelines: [
			"Use `subagent` for delegated work that benefits from an isolated agent: implementation, review, exploration, debugging, research, planning, or other multi-step tasks. For simple independent I/O, prefer direct parallel tool calls.",
			"Use `alias` to label the subagent's role or purpose (e.g. `code-reviewer`, `implementer`, `explorer`, `researcher`). If omitted, a random Greek mythology name is generated.",
			"Use `active_skills` to force skills at startup when useful (e.g. `[\"diagnose\"]`).",
			"For read-only review, say so explicitly in the task because the subagent may have write tools.",
			"For multiple independent subagent tasks, emit multiple `subagent` tool calls in the same turn — they run in parallel automatically.",
			"Subagents have NO context from the current conversation — include ALL necessary context in the task description.",
		],
		parameters: Type.Object({
			task: Type.String({ description: "Task description" }),
			alias: Type.Optional(Type.String({ description: "Optional display label for this run (e.g. code-reviewer). Must not contain digits." })),
			active_skills: Type.Optional(Type.Array(Type.String({ description: "Skill name to invoke at subagent startup" }))),
			cwd: Type.Optional(Type.String({ description: "Working directory for the agent process" })),
		}),

		async execute(toolCallId, params, signal, onUpdate, ctx) {
			if (!params.task) {
				throw new Error("`subagent` requires `task`. To fan out work, emit multiple `subagent` tool calls in the same turn — they run in parallel.");
			}
			const runId = `subagent_${randomUUID()}`;
			let alias: string;
			try {
				alias = normalizeSubagentAlias(params.alias) ?? getGeneratedSubagentAliasForExecute(toolCallId, params.task, params.cwd);
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				throw new Error(`Subagent ${getGeneratedSubagentAliasForExecute(toolCallId, params.task, params.cwd)} failed to start: ${message}`);
			}
			let contextWindow: number | undefined;
			let result: AgentResult;
			try {
				const cwd = sanitizeDiscoveryCwd(params.cwd ?? ctx.cwd);
				const includeProject = isProjectTrusted(ctx);
				loadAgents(cwd, { includeProject });

				const uiConfig = loadMergedSubagentsUiConfig(cwd, { includeProject });
				if (!uiConfig.enabled) {
					throw new Error("Subagents extension is disabled. Run /subagents to enable, then /reload.");
				}

				const agent = getAgent();
				const inherited = {
					model: ctx.model ? `${ctx.model.provider}/${ctx.model.id}` : "",
					thinking: agent.thinking ? "" : pi.getThinkingLevel(),
				};
				const activeSkills = normalizeActiveSkills(params.active_skills);
				if (activeSkills.length > 0 && !agent.tools.includes("read")) {
					throw new Error("subagent active_skills require read in tools so skills can load SKILL.md files");
				}
				const effectiveAgent = resolveEffectiveAgent({
					...agent,
					activeSkills: [...new Set([...(agent.activeSkills ?? []), ...activeSkills])].sort((a, b) => a.localeCompare(b)),
				}, inherited);
				const modelRef = parseModelRef(effectiveAgent.model);
				contextWindow = modelRef
					? ctx.modelRegistry?.find(modelRef.provider, modelRef.modelId)?.contextWindow
					: undefined;

				const liveResult: AgentResult = {
					id: runId,
					agent: agent.name,
					alias,
					task: params.task,
					output: "",
					exitCode: -1,
					model: effectiveAgent.model,
					contextWindow,
					usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0, turns: 0 },
					progress: {
						id: runId,
						agent: agent.name,
						alias,
						status: "running",
						task: params.task,
						recentTools: [],
						toolCount: 0,
						tokens: 0,
						durationMs: 0,
						lastMessage: "",
					},
				};

				const tools = pi.getAllTools();
				const commands = pi.getCommands();
				const toolExtensionPaths = collectToolExtensionPaths(tools);
				const extensionNamePaths = collectNamedExtensionPaths(tools, commands);
				const skillPaths = collectSkillPaths(commands);
				result = await semaphore.run(() =>
					runSubagent(
						effectiveAgent,
						params.task,
						cwd,
						signal,
						(progress, usage) => {
							liveResult.progress = {
								...progress,
								recentTools: progress.recentTools.map((t) => ({ ...t })),
							};
							liveResult.usage = { ...usage };
							const stats = `${progress.toolCount} tools · ${formatDuration(progress.durationMs)}`;
							onUpdate?.({
								content: [{ type: "text", text: stats }],
								details: {
									results: [
										{
											...liveResult,
											progress: {
												...liveResult.progress,
												recentTools: liveResult.progress.recentTools.map((t) => ({ ...t })),
											},
										},
									],
								} satisfies SubagentDetails,
							});
						},
						toolExtensionPaths,
						skillPaths,
						extensionNamePaths,
						{ id: runId, alias, inherited, includeProject },
					),
					signal,
				);
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				throw new Error(`Subagent ${alias} failed to start: ${message}`);
			}

			result.contextWindow = contextWindow;
			const isError = result.exitCode !== 0 || !!result.progress.error;
			if (isError) {
				throw new Error(formatSubagentFailure(result));
			}
			return {
				content: [{ type: "text", text: result.output || "(no output)" }],
				details: { results: [result] } satisfies SubagentDetails,
			};
		},

		renderCall(args, theme, context) {
			return renderSubagentCall(args, theme, context);
		},

		renderResult(result, options, theme, context) {
			return renderSubagentResult(result, options, theme, context);
		},
	});
}

export type { AgentConfig } from "./types.ts";
