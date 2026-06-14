import fs from "node:fs";
import path from "node:path";
import { parseFrontmatter } from "@earendil-works/pi-coding-agent";
import { stringify } from "yaml";
import { getProjectAgentsDir } from "./registry.ts";
import { parseModelRef, THINKING_LEVELS, type AgentConfig } from "./types.ts";

export interface AgentConfigPatch {
	tools?: string[];
	extensions?: string[];
	skills?: string[];
	model?: string;
	thinking?: string;
}

function formatList(values: string[]): string {
	return values.join(", ");
}

function applyPatch(frontmatter: Record<string, unknown>, patch: AgentConfigPatch): Record<string, unknown> {
	const next = { ...frontmatter };
	if (patch.tools !== undefined) next.tools = formatList(patch.tools);
	if (patch.extensions !== undefined) {
		if (patch.extensions.length > 0) next.extensions = formatList(patch.extensions);
		else delete next.extensions;
	}
	if (patch.skills !== undefined) {
		if (patch.skills.length > 0) next.skills = formatList(patch.skills);
		else delete next.skills;
	}
	if (patch.model !== undefined) next.model = patch.model;
	if (patch.thinking !== undefined) next.thinking = patch.thinking;
	return next;
}

function frontmatterToYaml(frontmatter: Record<string, unknown>): string {
	const preferredOrder = ["name", "description", "tools", "subagent_agents", "extensions", "skills", "model", "thinking"];
	const ordered: Record<string, unknown> = {};
	for (const key of preferredOrder) {
		if (Object.hasOwn(frontmatter, key) && frontmatter[key] !== undefined) ordered[key] = frontmatter[key];
	}
	for (const key of Object.keys(frontmatter)) {
		if (!preferredOrder.includes(key) && frontmatter[key] !== undefined) ordered[key] = frontmatter[key];
	}
	const yaml = stringify(ordered, { lineWidth: 0 }).trimEnd().replace(/: ""$/gm, ":");
	return `---\n${yaml}\n---`;
}

function writeMarkdownFile(filePath: string, frontmatter: Record<string, unknown>, body: string): void {
	const next = `${frontmatterToYaml(frontmatter)}\n\n${body.replace(/^\n+/, "")}`;
	const content = next.endsWith("\n") ? next : `${next}\n`;
	fs.mkdirSync(path.dirname(filePath), { recursive: true });
	const tempPath = path.join(path.dirname(filePath), `.${path.basename(filePath)}.${process.pid}.tmp`);
	fs.writeFileSync(tempPath, content, "utf-8");
	fs.renameSync(tempPath, filePath);
}

export function writeAgentConfig(filePath: string, patch: AgentConfigPatch): void {
	const content = fs.readFileSync(filePath, "utf-8");
	const parsed = parseFrontmatter<Record<string, unknown>>(content);
	writeMarkdownFile(filePath, applyPatch(parsed.frontmatter, patch), parsed.body);
}

export function draftFromAgent(agent: AgentConfig): AgentConfigPatch {
	return {
		tools: [...agent.tools],
		...(agent.extensions ? { extensions: [...agent.extensions] } : {}),
		...(agent.skills ? { skills: [...agent.skills] } : {}),
		model: agent.model,
		thinking: agent.thinking,
	};
}

export function splitResolvableAllowlist(
	names: string[],
	resolvableNames: Iterable<string>,
): { selected: string[]; missing: string[] } {
	const resolvable = new Set(resolvableNames);
	const selected: string[] = [];
	const missing: string[] = [];
	for (const name of names) {
		if (resolvable.has(name)) selected.push(name);
		else missing.push(name);
	}
	return { selected, missing };
}

export function mergeSelectedWithMissing(
	selectedNames: string[],
	currentNames: string[] | undefined,
	resolvableNames: Iterable<string>,
): string[] {
	const { missing } = splitResolvableAllowlist(currentNames ?? [], resolvableNames);
	const result = [...selectedNames];
	for (const name of missing) {
		if (!result.includes(name)) result.push(name);
	}
	return result;
}

export function canEditSkills(tools: string[]): boolean {
	return tools.includes("read");
}

function sameList(a: string[] | undefined, b: string[] | undefined): boolean {
	const left = a ?? [];
	const right = b ?? [];
	return left.length === right.length && left.every((value, index) => value === right[index]);
}

export function changedDraftPatch(agent: AgentConfig, draft: AgentConfigPatch): AgentConfigPatch {
	const patch: AgentConfigPatch = {};
	if (draft.tools !== undefined && !sameList(draft.tools, agent.tools)) patch.tools = draft.tools;
	if (draft.extensions !== undefined && !sameList(draft.extensions, agent.extensions)) patch.extensions = draft.extensions;
	if (draft.skills !== undefined && !sameList(draft.skills, agent.skills)) patch.skills = draft.skills;
	if (draft.model !== undefined && draft.model !== agent.model) patch.model = draft.model;
	if (draft.thinking !== undefined && draft.thinking !== agent.thinking) patch.thinking = draft.thinking;
	return patch;
}

export function writeProjectAgentConfig(sourceAgent: AgentConfig, projectFilePath: string, patch: AgentConfigPatch): void {
	let baseFrontmatter: Record<string, unknown> | undefined;
	try {
		if (fs.existsSync(sourceAgent.filePath)) {
			baseFrontmatter = parseFrontmatter<Record<string, unknown>>(fs.readFileSync(sourceAgent.filePath, "utf-8")).frontmatter;
		}
	} catch {
		baseFrontmatter = undefined;
	}
	baseFrontmatter ??= {
		name: sourceAgent.name,
		description: sourceAgent.description,
		tools: formatList(sourceAgent.tools),
		...(sourceAgent.subagentAgents ? { subagent_agents: formatList(sourceAgent.subagentAgents) } : {}),
		...(sourceAgent.extensions ? { extensions: formatList(sourceAgent.extensions) } : {}),
		...(sourceAgent.skills ? { skills: formatList(sourceAgent.skills) } : {}),
		model: sourceAgent.model,
		thinking: sourceAgent.thinking,
	};
	if (baseFrontmatter.model === null || baseFrontmatter.model === undefined) baseFrontmatter.model = "";
	if (baseFrontmatter.thinking === null || baseFrontmatter.thinking === undefined) baseFrontmatter.thinking = "";
	writeMarkdownFile(projectFilePath, applyPatch(baseFrontmatter, patch), sourceAgent.systemPrompt);
}

export function persistAgentDraft(cwd: string, agent: AgentConfig, draft: AgentConfigPatch): string | null {
	const error = validateDraft(agent, draft);
	if (error) return error;
	const patch = changedDraftPatch(agent, draft);
	if (Object.keys(patch).length === 0) return "No changes to save.";
	if (agent.source === "project") writeAgentConfig(agent.filePath, patch);
	else writeProjectAgentConfig(agent, path.join(getProjectAgentsDir(cwd), `${agent.name}.md`), patch);
	return null;
}

export function validateDraft(agent: AgentConfig, draft: AgentConfigPatch): string | null {
	const tools = draft.tools ?? agent.tools;
	const skills = draft.skills ?? agent.skills ?? [];
	if (tools.length === 0) return "Agents need at least one tool.";
	if (tools.includes("subagent") && (!agent.subagentAgents || agent.subagentAgents.length === 0)) {
		return "Agents with the subagent tool need subagent_agents in frontmatter (edit the .md file).";
	}
	if (skills.length > 0 && !tools.includes("read")) {
		return "Agents with skills need read in tools so they can load SKILL.md files.";
	}
	const model = draft.model ?? agent.model;
	if (model !== "" && !parseModelRef(model)) return "Model must be empty or provider/model.";
	const thinking = draft.thinking ?? agent.thinking;
	if (thinking !== "" && !THINKING_LEVELS.includes(thinking as never)) {
		return `Thinking must be empty or one of ${THINKING_LEVELS.join(", ")}.`;
	}
	return null;
}
