import fs from "node:fs";
import { parseFrontmatter } from "@earendil-works/pi-coding-agent";
import type { AgentConfig } from "./types.ts";

export interface AgentConfigPatch {
	tools?: string[];
	model?: string;
	thinking?: string;
}

function formatList(values: string[]): string {
	return values.join(", ");
}

function frontmatterToYaml(frontmatter: Record<string, unknown>): string {
	const preferredOrder = ["name", "description", "tools", "subagent_agents", "model", "thinking"];
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

	if (patch.tools) frontmatter.tools = formatList(patch.tools);
	if (patch.model) frontmatter.model = patch.model;
	if (patch.thinking) frontmatter.thinking = patch.thinking;

	const body = parsed.body.replace(/^\n+/, "");
	const next = `${frontmatterToYaml(frontmatter)}\n\n${body}`;
	fs.writeFileSync(filePath, next.endsWith("\n") ? next : `${next}\n`, "utf-8");
}

export function draftFromAgent(agent: AgentConfig): AgentConfigPatch {
	return {
		tools: [...agent.tools],
		model: agent.model,
		thinking: agent.thinking,
	};
}

export function validateDraft(agent: AgentConfig, draft: AgentConfigPatch): string | null {
	const tools = draft.tools ?? agent.tools;
	if (tools.includes("subagent") && (!agent.subagentAgents || agent.subagentAgents.length === 0)) {
		return "Agents with the subagent tool need subagent_agents in frontmatter (edit the .md file).";
	}
	if (!draft.model?.includes("/")) return "Model must be provider/model.";
	return null;
}
