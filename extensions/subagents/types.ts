export type AgentSource = "package" | "user" | "project" | "dynamic";

export const THINKING_LEVELS = ["off", "minimal", "low", "medium", "high", "xhigh"] as const;

export function parseModelRef(model: string): { provider: string; modelId: string } | null {
	if (model === "") return null;
	const parts = model.split("/");
	if (parts.length !== 2) return null;
	const [provider, modelId] = parts.map((part) => part.trim());
	if (!provider || !modelId) return null;
	return { provider, modelId };
}

export function isCursorModel(model: string): boolean {
	return parseModelRef(model)?.provider.toLowerCase() === "cursor";
}

/** Max tool rows shown in collapsed subagent progress; ctrl+o shows all. */
export const MAX_TOOLS_COLLAPSED = 15;

export interface AgentConfig {
	name: string;
	description: string;
	tools: string[];
	model: string;
	thinking: string;
	systemPrompt: string;
	filePath: string;
	source: AgentSource;
	/** When `subagent` is in tools, restrict spawn targets (enforced via PI_SUBAGENT_ALLOWED). */
	subagentAgents?: string[];
	/** Extra named extensions to load explicitly while extension discovery stays disabled. */
	extensions?: string[];
	/** Named skills to load explicitly while skill discovery stays disabled. */
	skills?: string[];
}

export interface ToolEvent {
	tool: string;
	args: string;
	toolCallId?: string;
	status: "running" | "done";
	children?: AgentResult[];
}

export type AgentDisplaySurface = "tool-call" | "progress" | "error";

export function containsControlCharacters(s: string): boolean {
	return /[\u0000-\u001f\u007f-\u009f]/.test(s);
}

export function sanitizeDisplayText(s: string): string {
	return s.replace(/[\u0000-\u001f\u007f-\u009f]/g, "");
}

function sanitizeAliasForDisplay(alias: string | undefined): string | undefined {
	const sanitized = alias ? sanitizeDisplayText(alias).trim() : undefined;
	return sanitized || undefined;
}

/** Display label for a subagent run on a specific UI/error surface. */
export function displayAgentLabel(r: { agent: string; alias?: string }, surface: AgentDisplaySurface): string {
	return surface === "progress" ? sanitizeDisplayText(r.agent) : sanitizeAliasForDisplay(r.alias) ?? sanitizeDisplayText(r.agent);
}


export interface AgentProgress {
	agent: string;
	/** Optional display label; registry name stays in `agent`. */
	alias?: string;
	status: "pending" | "running" | "completed" | "failed";
	task: string;
	recentTools: ToolEvent[];
	toolCount: number;
	tokens: number;
	durationMs: number;
	lastMessage: string;
	error?: string;
}

export interface AgentResult {
	agent: string;
	/** Optional display label; registry name stays in `agent`. */
	alias?: string;
	task: string;
	output: string;
	exitCode: number;
	progress: AgentProgress;
	model?: string;
	contextWindow?: number;
	stderr?: string;
	spawnError?: string;
	usage: {
		input: number;
		output: number;
		cacheRead: number;
		cacheWrite: number;
		cost: number;
		turns: number;
	};
}

export interface SubagentDetails {
	results: AgentResult[];
}

export interface ExtensionConfig {
	maxConcurrency?: number;
}
