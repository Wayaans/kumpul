import * as fs from "node:fs";
import * as path from "node:path";
import { parseFrontmatter } from "@earendil-works/pi-coding-agent";
import { parseModelRef, THINKING_LEVELS, type AgentConfig } from "./types.ts";

const PROJECT_SUBAGENT_RELATIVE = path.join(".pi", "kumpul", "subagent.md");

export interface AgentDiscoveryOptions {
	includeProject?: boolean;
}

export const DEFAULT_AGENT_CONFIG: AgentConfig = {
	name: "agent",
	description: "General-purpose subagent template — follows the delegated task exactly",
	tools: ["edit", "find", "find_docs", "grep", "ls", "read", "safe_bash", "write"],
	model: "openai-codex/gpt-5.3-codex-spark",
	thinking: "medium",
	systemPrompt: `You are a subagent. You operate in an isolated context — you have no knowledge of any prior conversation.

Work efficiently and effectively to complete the assigned task. All necessary context must be provided in the task description. Follow the task instructions exactly.

Guidelines:
- Use \`safe_bash\` for running commands (tests, builds, installs, etc.)
- Use \`find_docs\` for library/API documentation questions
`,
	filePath: "<package-default>",
	source: "package",
};

let agent: AgentConfig = DEFAULT_AGENT_CONFIG;

function diagnostic(message: string): void {
	console.warn(`[subagents] ${message}`);
}

function asString(value: unknown): string | undefined {
	return typeof value === "string" ? value.trim() : undefined;
}

function parseList(value: unknown): string[] | undefined {
	if (typeof value !== "string") return undefined;
	const list = value.split(",").map((t) => t.trim()).filter(Boolean);
	return list.length > 0 ? list : undefined;
}

function isSafeName(name: string): boolean {
	return /^[a-zA-Z0-9_-]+$/.test(name);
}

function isCanonicalResourceName(name: string): boolean {
	return /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(name);
}

function uniqueSorted(values: string[]): string[] {
	return [...new Set(values)].sort((a, b) => a.localeCompare(b));
}

function validateAgentConfig(config: AgentConfig): string | null {
	if (config.name !== "agent") return "name must be agent";
	if (typeof config.description !== "string" || config.description.trim() === "") return "description must be a non-empty string";
	if (!Array.isArray(config.tools) || config.tools.length === 0) return "tools must be a non-empty comma-separated list";
	if (config.tools.some((tool) => typeof tool !== "string" || !tool || !isSafeName(tool))) return "tools contains an invalid tool name";
	if (typeof config.model !== "string") return "model must be a string";
	if (config.model !== "" && !parseModelRef(config.model)) return "model must be empty or in provider/model form";
	if (typeof config.thinking !== "string" || (config.thinking !== "" && !THINKING_LEVELS.includes(config.thinking as never))) {
		return `thinking must be empty or one of ${THINKING_LEVELS.join(", ")}`;
	}
	if (typeof config.systemPrompt !== "string") return "system prompt must be a string";
	if (config.extensions?.some((name) => typeof name !== "string" || !isCanonicalResourceName(name))) return "extensions contains an invalid canonical extension name";
	if (config.skills?.some((name) => typeof name !== "string" || !isCanonicalResourceName(name))) return "skills contains an invalid canonical skill name";
	if (config.activeSkills?.some((name) => typeof name !== "string" || !isCanonicalResourceName(name))) return "active_skills contains an invalid canonical skill name";
	const skills = [...(config.skills ?? []), ...(config.activeSkills ?? [])];
	if (skills.length > 0 && !config.tools.includes("read")) return "agents with skills need read in tools so they can load SKILL.md files";
	return null;
}

export function sanitizeDiscoveryCwd(cwd: string): string {
	if (typeof cwd !== "string" || cwd.trim() === "") throw new Error("subagent cwd must be a non-empty string");
	const resolved = path.resolve(cwd);
	let real: string;
	try {
		real = fs.realpathSync(resolved);
	} catch (error) {
		throw new Error(`subagent cwd does not exist: ${resolved}`, { cause: error });
	}
	let stat: fs.Stats;
	try {
		stat = fs.statSync(real);
	} catch (error) {
		throw new Error(`subagent cwd is not accessible: ${real}`, { cause: error });
	}
	if (!stat.isDirectory()) throw new Error(`subagent cwd is not a directory: ${real}`);
	return real;
}

function isDirectory(p: string): boolean {
	try { return fs.statSync(p).isDirectory(); } catch { return false; }
}

export function findProjectSubagentPath(cwd: string): string | null {
	let currentDir = sanitizeDiscoveryCwd(cwd);
	while (true) {
		const candidate = path.join(currentDir, PROJECT_SUBAGENT_RELATIVE);
		if (fs.existsSync(candidate)) return candidate;
		const parentDir = path.dirname(currentDir);
		if (parentDir === currentDir) return null;
		currentDir = parentDir;
	}
}

export function getProjectSubagentPath(cwd: string): string {
	const existing = findProjectSubagentPath(cwd);
	if (existing) return existing;
	let currentDir = sanitizeDiscoveryCwd(cwd);
	while (true) {
		if (fs.existsSync(path.join(currentDir, ".git")) || isDirectory(path.join(currentDir, ".pi"))) {
			return path.join(currentDir, PROJECT_SUBAGENT_RELATIVE);
		}
		const parentDir = path.dirname(currentDir);
		if (parentDir === currentDir) return path.join(sanitizeDiscoveryCwd(cwd), PROJECT_SUBAGENT_RELATIVE);
		currentDir = parentDir;
	}
}

export function parseSubagentMarkdown(filePath: string, source: "project" = "project"): AgentConfig | null {
	let content: string;
	try {
		content = fs.readFileSync(filePath, "utf-8");
	} catch (error) {
		diagnostic(`Unable to read subagent file ${filePath}: ${error instanceof Error ? error.message : String(error)}`);
		return null;
	}
	if (!content.trimStart().startsWith("---")) {
		diagnostic(`Skipping invalid subagent file ${filePath}: missing frontmatter`);
		return null;
	}
	let parsed: { frontmatter: Record<string, unknown>; body: string };
	try {
		parsed = parseFrontmatter<Record<string, unknown>>(content);
	} catch (error) {
		diagnostic(`Invalid frontmatter in ${filePath}: ${error instanceof Error ? error.message : String(error)}`);
		return null;
	}
	for (const field of ["model", "thinking", "extensions", "skills", "active_skills", "tools", "description"]) {
		if (Object.hasOwn(parsed.frontmatter, field) && parsed.frontmatter[field] != null && typeof parsed.frontmatter[field] !== "string") {
			diagnostic(`Skipping invalid subagent file ${filePath}: ${field} must be a string`);
			return null;
		}
	}
	const description = asString(parsed.frontmatter.description);
	if (!description) {
		diagnostic(`Skipping invalid subagent file ${filePath}: description must be a non-empty string`);
		return null;
	}
	const tools = parseList(parsed.frontmatter.tools);
	if (!tools) {
		diagnostic(`Skipping invalid subagent file ${filePath}: tools must be a non-empty comma-separated list`);
		return null;
	}
	const activeSkills = parseList(parsed.frontmatter.active_skills) ? uniqueSorted(parseList(parsed.frontmatter.active_skills) ?? []) : undefined;
	const skills = uniqueSorted([...(parseList(parsed.frontmatter.skills) ?? []), ...(activeSkills ?? [])]);
	const config: AgentConfig = {
		...DEFAULT_AGENT_CONFIG,
		description,
		tools,
		model: parsed.frontmatter.model === null ? "" : asString(parsed.frontmatter.model) ?? DEFAULT_AGENT_CONFIG.model,
		thinking: parsed.frontmatter.thinking === null ? "" : asString(parsed.frontmatter.thinking) ?? DEFAULT_AGENT_CONFIG.thinking,
		systemPrompt: parsed.body,
		filePath,
		source,
		...(parseList(parsed.frontmatter.extensions) ? { extensions: parseList(parsed.frontmatter.extensions) } : {}),
		...(skills.length > 0 ? { skills } : {}),
		...(activeSkills ? { activeSkills } : {}),
	};
	const error = validateAgentConfig(config);
	if (error) {
		diagnostic(`Skipping invalid subagent file ${filePath}: ${error}`);
		return null;
	}
	return config;
}

export function getAgent(): AgentConfig { return agent; }
export function getAgents(): AgentConfig[] { return [agent]; }

export function discoverFileAgents(cwd: string, options: AgentDiscoveryOptions = { includeProject: true }): AgentConfig[] {
	const safeCwd = sanitizeDiscoveryCwd(cwd);
	if (options.includeProject !== false) {
		const projectPath = findProjectSubagentPath(safeCwd);
		if (projectPath) {
			const projectAgent = parseSubagentMarkdown(projectPath, "project");
			if (!projectAgent) throw new Error(`Invalid project subagent override: ${projectPath}`);
			return [projectAgent];
		}
	}
	return [DEFAULT_AGENT_CONFIG];
}

export function loadAgents(cwd: string = process.cwd(), options: AgentDiscoveryOptions = { includeProject: true }): AgentConfig[] {
	agent = discoverFileAgents(cwd, options)[0] ?? DEFAULT_AGENT_CONFIG;
	return [agent];
}

export const parseAgentMarkdown = parseSubagentMarkdown;
export function loadAgentsFromDir(dir: string = "", source: "project" = "project"): AgentConfig[] {
	const result: AgentConfig[] = [];
	if (!dir || !fs.existsSync(dir)) return result;
	let entries: fs.Dirent[];
	try {
		entries = fs.readdirSync(dir, { withFileTypes: true });
	} catch {
		return result;
	}
	for (const entry of entries) {
		if (!entry.name.endsWith(".md")) continue;
		if (!entry.isFile() && !entry.isSymbolicLink()) continue;
		const parsed = parseSubagentMarkdown(path.join(dir, entry.name), source);
		if (parsed) result.push(parsed);
	}
	return result;
}
export const findNearestProjectAgentsDir = findProjectSubagentPath;
export function getProjectAgentsDir(cwd: string): string { return path.dirname(getProjectSubagentPath(cwd)); }
