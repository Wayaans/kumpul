export type AgentSource = "package" | "user" | "project" | "dynamic";

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
}

export interface ToolEvent {
	tool: string;
	args: string;
	toolCallId?: string;
	status: "running" | "done";
	children?: AgentResult[];
}

export interface AgentProgress {
	agent: string;
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
	/** Trust project-local .pi/agents discovered from cwd. Default: false. */
	allowProjectAgents?: boolean;
	/** Allow trusted project agents to replace built-in agent/reviewer. Default: false. */
	allowProjectAgentOverrides?: boolean;
}
