import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { getAgentDir, parseFrontmatter } from "@earendil-works/pi-coding-agent";
import type { AgentConfig, AgentSource } from "./types.ts";

const EXTENSION_DIR = fileURLToPath(new URL(".", import.meta.url));
const PACKAGE_AGENTS_DIR = path.join(EXTENSION_DIR, "agents");
const PRIVILEGED_AGENT_NAMES = new Set(["agent", "reviewer"]);
const VALID_THINKING = new Set(["minimal", "low", "medium", "high", "xhigh"]);

export interface DiscoverAgentsOptions {
	allowProjectAgents?: boolean;
	allowProjectAgentOverrides?: boolean;
}

let agents: AgentConfig[] = [];
const dynamicAgents = new Map<string, AgentConfig>();
let discoverOptions: DiscoverAgentsOptions = {};
let lastDiscoverCwd = process.cwd();

function getSubagentAllowlist(): string[] | undefined {
	const raw = process.env.PI_SUBAGENT_ALLOWED;
	if (!raw) return undefined;
	const list = raw.split(",").map((s) => s.trim()).filter(Boolean);
	return list.length > 0 ? list : undefined;
}

function passesAllowlist(name: string): boolean {
	const allowlist = getSubagentAllowlist();
	return !allowlist || allowlist.includes(name);
}

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

function validateAgentConfig(agent: AgentConfig): string | null {
	if (typeof agent.name !== "string" || !agent.name || !isSafeName(agent.name)) {
		return "name must be a non-empty tool-safe identifier";
	}
	if (typeof agent.description !== "string" || agent.description.trim() === "") {
		return "description must be a non-empty string";
	}
	if (!Array.isArray(agent.tools) || agent.tools.length === 0) return "tools must be a non-empty comma-separated list";
	if (agent.tools.some((tool) => typeof tool !== "string" || !tool || !isSafeName(tool))) {
		return "tools contains an invalid tool name";
	}
	if (typeof agent.model !== "string" || !agent.model.includes("/") || agent.model.startsWith("/") || agent.model.endsWith("/")) {
		return "model must be in provider/model form";
	}
	if (typeof agent.thinking !== "string" || !VALID_THINKING.has(agent.thinking)) {
		return `thinking must be one of ${Array.from(VALID_THINKING).join(", ")}`;
	}
	if (typeof agent.systemPrompt !== "string") return "system prompt must be a string";
	if (typeof agent.filePath !== "string" || agent.filePath.trim() === "") return "filePath must be a non-empty string";
	if (!["package", "user", "project", "dynamic"].includes(agent.source)) return "source is invalid";
	if (agent.subagentAgents !== undefined && !Array.isArray(agent.subagentAgents)) {
		return "subagent_agents must be a comma-separated list";
	}
	if (agent.tools.includes("subagent") && (!agent.subagentAgents || agent.subagentAgents.length === 0)) {
		return "agents with the subagent tool must set bounded subagent_agents";
	}
	if (agent.subagentAgents?.some((name) => typeof name !== "string" || !isSafeName(name))) {
		return "subagent_agents contains an invalid agent name";
	}
	if (agent.extensions !== undefined && !Array.isArray(agent.extensions)) {
		return "extensions must be a comma-separated list";
	}
	if (agent.extensions?.some((name) => typeof name !== "string" || !isCanonicalResourceName(name))) {
		return "extensions contains an invalid canonical extension name";
	}
	if (agent.skills !== undefined && !Array.isArray(agent.skills)) {
		return "skills must be a comma-separated list";
	}
	if (agent.skills?.some((name) => typeof name !== "string" || !isCanonicalResourceName(name))) {
		return "skills contains an invalid canonical skill name";
	}
	if (agent.skills && agent.skills.length > 0 && !agent.tools.includes("read")) {
		return "agents with skills must include the read tool";
	}
	return null;
}

export function validateRegisteredAgent(config: AgentConfig): void {
	const error = validateAgentConfig(config);
	if (error) throw new Error(`Invalid agent ${config.name || "(unnamed)"}: ${error}`);
}

export function sanitizeDiscoveryCwd(cwd: string): string {
	if (typeof cwd !== "string" || cwd.trim() === "") {
		throw new Error("subagent cwd must be a non-empty string");
	}
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

export function getAgents(): AgentConfig[] {
	return agents;
}

export function registerAgent(config: Omit<AgentConfig, "source"> & Partial<Pick<AgentConfig, "source">>): void {
	const agent: AgentConfig = { ...config, source: config.source ?? "dynamic" };
	validateRegisteredAgent(agent);
	if (!passesAllowlist(agent.name)) return;
	if (agents.find((a) => a.name === agent.name) || dynamicAgents.has(agent.name)) {
		throw new Error(`Agent already registered: ${agent.name}`);
	}
	dynamicAgents.set(agent.name, agent);
	rebuildAgentList();
}

export function unregisterAgent(name: string): void {
	dynamicAgents.delete(name);
	rebuildAgentList();
}

function rebuildAgentList(): void {
	const fileAgents = discoverFileAgents(lastDiscoverCwd, discoverOptions);
	const map = new Map<string, AgentConfig>();
	for (const agent of fileAgents) {
		map.set(agent.name, agent);
	}
	for (const agent of dynamicAgents.values()) {
		map.set(agent.name, agent);
	}
	agents = Array.from(map.values());
}

export function loadAgents(cwd: string = process.cwd(), options: DiscoverAgentsOptions = discoverOptions): AgentConfig[] {
	lastDiscoverCwd = sanitizeDiscoveryCwd(cwd);
	discoverOptions = options;
	rebuildAgentList();
	return agents;
}

export function parseAgentMarkdown(filePath: string, source: AgentSource = "user"): AgentConfig | null {
	let content: string;
	try {
		content = fs.readFileSync(filePath, "utf-8");
	} catch (error) {
		diagnostic(`Unable to read agent file ${filePath}: ${error instanceof Error ? error.message : String(error)}`);
		return null;
	}

	let parsed: { frontmatter: Record<string, unknown>; body: string };
	try {
		parsed = parseFrontmatter<Record<string, unknown>>(content);
	} catch (error) {
		diagnostic(`Invalid frontmatter in ${filePath}: ${error instanceof Error ? error.message : String(error)}`);
		return null;
	}

	for (const field of ["model", "thinking", "subagent_agents"]) {
		if (Object.hasOwn(parsed.frontmatter, field) && typeof parsed.frontmatter[field] !== "string") {
			diagnostic(`Skipping invalid agent file ${filePath}: ${field} must be a string`);
			return null;
		}
	}
	for (const field of ["extensions", "skills"]) {
		if (
			Object.hasOwn(parsed.frontmatter, field) &&
			parsed.frontmatter[field] !== null &&
			parsed.frontmatter[field] !== undefined &&
			typeof parsed.frontmatter[field] !== "string"
		) {
			diagnostic(`Skipping invalid agent file ${filePath}: ${field} must be a string`);
			return null;
		}
	}

	const name = asString(parsed.frontmatter.name);
	const tools = parseList(parsed.frontmatter.tools);
	const subagentAgents = parseList(parsed.frontmatter.subagent_agents);
	const extensions = parseList(parsed.frontmatter.extensions);
	const skills = parseList(parsed.frontmatter.skills);
	const agent: AgentConfig = {
		name: name ?? "",
		description: asString(parsed.frontmatter.description) ?? "",
		tools: tools ?? [],
		model: asString(parsed.frontmatter.model) ?? "anthropic/claude-sonnet-4-6",
		thinking: asString(parsed.frontmatter.thinking) ?? "medium",
		systemPrompt: parsed.body,
		filePath,
		source,
		...(subagentAgents ? { subagentAgents } : {}),
		...(extensions ? { extensions } : {}),
		...(skills ? { skills } : {}),
	};

	const error = validateAgentConfig(agent);
	if (error) {
		diagnostic(`Skipping invalid agent file ${filePath}: ${error}`);
		return null;
	}

	return agent;
}

export function loadAgentsFromDir(dir: string, source: AgentSource = "user"): AgentConfig[] {
	const result: AgentConfig[] = [];
	if (!fs.existsSync(dir)) return result;

	let entries: fs.Dirent[];
	try {
		entries = fs.readdirSync(dir, { withFileTypes: true });
	} catch (error) {
		diagnostic(`Unable to list agent directory ${dir}: ${error instanceof Error ? error.message : String(error)}`);
		return result;
	}

	for (const entry of entries) {
		if (!entry.name.endsWith(".md")) continue;
		if (!entry.isFile() && !entry.isSymbolicLink()) continue;
		const agent = parseAgentMarkdown(path.join(dir, entry.name), source);
		if (agent && passesAllowlist(agent.name)) {
			result.push(agent);
		}
	}
	return result;
}

function isDirectory(p: string): boolean {
	try {
		return fs.statSync(p).isDirectory();
	} catch {
		return false;
	}
}

export function findNearestProjectAgentsDir(cwd: string): string | null {
	let currentDir = sanitizeDiscoveryCwd(cwd);
	while (true) {
		const candidate = path.join(currentDir, ".pi", "agents");
		if (isDirectory(candidate)) return candidate;

		const parentDir = path.dirname(currentDir);
		if (parentDir === currentDir) return null;
		currentDir = parentDir;
	}
}

/** Package → user global → trusted project (later wins except privileged built-ins). */
export function discoverFileAgents(cwd: string, options: DiscoverAgentsOptions = {}): AgentConfig[] {
	const safeCwd = sanitizeDiscoveryCwd(cwd);
	const map = new Map<string, AgentConfig>();

	for (const agent of loadAgentsFromDir(PACKAGE_AGENTS_DIR, "package")) {
		map.set(agent.name, agent);
	}

	const userDir = path.join(getAgentDir(), "agents");
	for (const agent of loadAgentsFromDir(userDir, "user")) {
		map.set(agent.name, agent);
	}

	if (options.allowProjectAgents) {
		const projectDir = findNearestProjectAgentsDir(safeCwd);
		if (projectDir) {
			for (const agent of loadAgentsFromDir(projectDir, "project")) {
				if (!options.allowProjectAgentOverrides && PRIVILEGED_AGENT_NAMES.has(agent.name)) {
					diagnostic(`Skipping project agent ${agent.name}: overriding built-in privileged agents is disabled`);
					continue;
				}
				map.set(agent.name, agent);
			}
		}
	}

	return Array.from(map.values());
}

(globalThis as Record<string, unknown>).__pi_subagents = {
	registerAgent,
	unregisterAgent,
};
