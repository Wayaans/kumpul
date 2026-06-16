/**
 * Subagents — isolated child pi processes with live TUI progress.
 * Derived from https://github.com/amosblomqvist/pi-subagents
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { Type } from "@earendil-works/pi-ai";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { isAgentSpawnEnabled, loadMergedSubagentsUiConfig } from "./config-io.ts";
import { getAgents, loadAgents, sanitizeDiscoveryCwd } from "./registry.ts";
import { showSubagentsSetup } from "./setup-ui.ts";
import {
	renderSubagentCall,
	renderSubagentResult,
} from "./render.ts";
import { formatDuration, formatSubagentFailure, resolveEffectiveAgent, runSubagent, Semaphore } from "./spawn.ts";
import { collectNamedExtensionPaths, collectSkillPaths, collectToolExtensionPaths } from "./resolve-tools.ts";
import { containsControlCharacters, parseModelRef, sanitizeDisplayText, type AgentResult, type ExtensionConfig, type SubagentDetails } from "./types.ts";

const EXTENSION_DIR = fileURLToPath(new URL(".", import.meta.url));
const CONFIG_PATH = path.join(EXTENSION_DIR, "config.json");
const DEFAULT_MAX_CONCURRENCY = 4;
export function normalizeSubagentAlias(raw: unknown): string | undefined {
	if (raw === undefined || raw === null) return undefined;
	if (typeof raw !== "string") throw new Error("subagent alias must be a string");
	const trimmed = raw.trim();
	if (!trimmed) throw new Error("subagent alias must not be empty");
	if (containsControlCharacters(trimmed)) {
		throw new Error("subagent alias must not contain control characters");
	}
	return trimmed;
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

	loadAgents(process.cwd());

	pi.registerCommand("subagents", {
		description: "Configure subagents (extension, spawn, tools, model, thinking)",
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
			"Parallel tool calls are your primary parallelism mechanism — put multiple independent read/fetch/search calls in one function_calls block. Don't use subagents to parallelize simple I/O.",
			"Use subagent to delegate reasoning: **agent** as the general subagent for any delegated task, **reviewer** for read-only code review",
			"Use optional `alias` to label what a subagent is doing (e.g. `{ \"agent\": \"agent\", \"alias\": \"spec-reviewer\", \"task\": \"...\" }`) when reusing the blank `agent` shell with a task-specific prompt instead of the opinionated `reviewer` agent",
			"For multiple independent subagent tasks, emit multiple `subagent` tool calls in the same turn — they run in parallel automatically.",
			"Subagents have NO context from the current conversation — include ALL necessary context in the task description",
		],
		parameters: Type.Object({
			agent: Type.String({ description: "Name of the agent to invoke" }),
			task: Type.String({ description: "Task description" }),
			alias: Type.Optional(
				Type.String({
					description:
						"Optional display label for this run (e.g. spec-reviewer). Does not change which agent config runs.",
				}),
			),
			cwd: Type.Optional(Type.String({ description: "Working directory for the agent process" })),
		}),

		async execute(toolCallId, params, signal, onUpdate, ctx) {
			if (!params.agent || !params.task) {
				throw new Error(
					"`subagent` requires both `agent` and `task`. To fan out work, emit multiple `subagent` tool calls in the same turn — they run in parallel.",
				);
			}
			const alias = normalizeSubagentAlias(params.alias);
			const cwd = sanitizeDiscoveryCwd(params.cwd ?? ctx.cwd);
			loadAgents(cwd);

			const uiConfig = loadMergedSubagentsUiConfig(cwd);
			if (!uiConfig.enabled) {
				throw new Error("Subagents extension is disabled. Run /subagents to enable, then /reload.");
			}

			const agent = getAgents().find((a) => a.name === params.agent);
			if (!agent || !isAgentSpawnEnabled(agent.name, uiConfig)) {
				const available =
					getAgents()
						.filter((a) => isAgentSpawnEnabled(a.name, uiConfig))
						.map((a) => a.name)
						.join(", ") || "none";
				throw new Error(`Unknown or disabled agent: ${sanitizeDisplayText(params.agent)}. Available agents: ${available}`);
			}

			const inherited = {
				model: ctx.model ? `${ctx.model.provider}/${ctx.model.id}` : "",
				thinking: agent.thinking ? "" : pi.getThinkingLevel(),
			};
			const effectiveAgent = resolveEffectiveAgent(agent, inherited);
			const modelRef = parseModelRef(effectiveAgent.model);
			const contextWindow = modelRef
				? ctx.modelRegistry.find(modelRef.provider, modelRef.modelId)?.contextWindow
				: undefined;

			const liveResult: AgentResult = {
				agent: params.agent,
				alias,
				task: params.task,
				output: "",
				exitCode: -1,
				model: effectiveAgent.model,
				contextWindow,
				usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0, turns: 0 },
				progress: {
					agent: params.agent,
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
			const result = await semaphore.run(() =>
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
					{ alias, inherited },
				),
			);

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

export { registerAgent, unregisterAgent } from "./registry.ts";
export type { AgentConfig } from "./types.ts";
