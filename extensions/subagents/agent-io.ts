import fs from "node:fs";
import { parseFrontmatter } from "@earendil-works/pi-coding-agent";
import type { AgentConfig } from "./types.ts";

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

function frontmatterToYaml(frontmatter: Record<string, unknown>): string {
	const preferredOrder = ["name", "description", "tools", "subagent_agents", "extensions", "skills", "model", "thinking"];
	const keys = [
		...preferredOrder.filter((key) => Object.hasOwn(frontmatter, key)),
		...Object.keys(frontmatter).filter((key) => !preferredOrder.includes(key)),
	];
	const lines = ["---"];
	for (const key of keys) {
		const value = frontmatter[key];
		if (value === undefined) continue;
		lines.push(`${key}: ${String(value)}`);
	}
	lines.push("---");
	return lines.join("\n");
}

export function writeAgentConfig(filePath: string, patch: AgentConfigPatch): void {
	const content = fs.readFileSync(filePath, "utf-8");
	const parsed = parseFrontmatter<Record<string, unknown>>(content);
	const frontmatter = { ...parsed.frontmatter };

	if (patch.tools !== undefined) frontmatter.tools = formatList(patch.tools);
	if (patch.extensions !== undefined) {
		if (patch.extensions.length > 0) frontmatter.extensions = formatList(patch.extensions);
		else delete frontmatter.extensions;
	}
	if (patch.skills !== undefined) {
		if (patch.skills.length > 0) frontmatter.skills = formatList(patch.skills);
		else delete frontmatter.skills;
	}
	if (patch.model) frontmatter.model = patch.model;
	if (patch.thinking) frontmatter.thinking = patch.thinking;

	const body = parsed.body.replace(/^\n+/, "");
	const next = `${frontmatterToYaml(frontmatter)}\n\n${body}`;
	fs.writeFileSync(filePath, next.endsWith("\n") ? next : `${next}\n`, "utf-8");
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
	if (!model.includes("/")) return "Model must be provider/model.";
	return null;
}
