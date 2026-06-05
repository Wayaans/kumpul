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
import { formatDuration, formatSubagentFailure, runSubagent, Semaphore } from "./spawn.ts";
import { collectToolExtensionPaths } from "./resolve-tools.ts";
import type { AgentResult, ExtensionConfig, SubagentDetails } from "./types.ts";

const EXTENSION_DIR = fileURLToPath(new URL(".", import.meta.url));
const CONFIG_PATH = path.join(EXTENSION_DIR, "config.json");
const DEFAULT_MAX_CONCURRENCY = 4;

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
	if (obj.allowProjectAgents !== undefined) {
		if (typeof obj.allowProjectAgents !== "boolean") throw new Error("subagents config allowProjectAgents must be a boolean");
		config.allowProjectAgents = obj.allowProjectAgents;
	}
	if (obj.allowProjectAgentOverrides !== undefined) {
		if (typeof obj.allowProjectAgentOverrides !== "boolean") {
			throw new Error("subagents config allowProjectAgentOverrides must be a boolean");
		}
		config.allowProjectAgentOverrides = obj.allowProjectAgentOverrides;
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

	loadAgents(process.cwd(), {
		allowProjectAgents: config.allowProjectAgents,
		allowProjectAgentOverrides: config.allowProjectAgentOverrides,
	});

	pi.registerCommand("subagents", {
		description: "Configure subagents (extension, spawn, tools, model, thinking)",
		handler: async (_args, ctx) => {
			await showSubagentsSetup(pi, ctx, {
				allowProjectAgents: config.allowProjectAgents,
				allowProjectAgentOverrides: config.allowProjectAgentOverrides,
			});
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
			"Use subagent to delegate reasoning: **agent** for isolated implementation, **reviewer** for read-only code review",
			"For multiple independent subagent tasks, emit multiple `subagent` tool calls in the same turn — they run in parallel automatically.",
			"Subagents have NO context from the current conversation — include ALL necessary context in the task description",
		],
		parameters: Type.Object({
			agent: Type.String({ description: "Name of the agent to invoke" }),
			task: Type.String({ description: "Task description" }),
			cwd: Type.Optional(Type.String({ description: "Working directory for the agent process" })),
		}),

		async execute(toolCallId, params, signal, onUpdate, ctx) {
			const cwd = sanitizeDiscoveryCwd(params.cwd ?? ctx.cwd);
			loadAgents(cwd, {
				allowProjectAgents: config.allowProjectAgents,
				allowProjectAgentOverrides: config.allowProjectAgentOverrides,
			});

			if (!params.agent || !params.task) {
				throw new Error(
					"`subagent` requires both `agent` and `task`. To fan out work, emit multiple `subagent` tool calls in the same turn — they run in parallel.",
				);
			}

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
				throw new Error(`Unknown or disabled agent: ${params.agent}. Available agents: ${available}`);
			}

			const [provider, modelId] = (agent.model || "").split("/");
			const contextWindow =
				provider && modelId ? ctx.modelRegistry.find(provider, modelId)?.contextWindow : undefined;

			const liveResult: AgentResult = {
				agent: params.agent,
				task: params.task,
				output: "",
				exitCode: -1,
				model: agent.model,
				contextWindow,
				usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0, turns: 0 },
				progress: {
					agent: params.agent,
					status: "running",
					task: params.task,
					recentTools: [],
					toolCount: 0,
					tokens: 0,
					durationMs: 0,
					lastMessage: "",
				},
			};

			const toolExtensionPaths = collectToolExtensionPaths(pi.getAllTools());
			const result = await semaphore.run(() =>
				runSubagent(
					agent,
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
