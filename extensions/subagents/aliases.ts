import { createHash } from "node:crypto";
import { MYTH_ALIAS_NAMES } from "./types.ts";

function aliasSeed(toolCallId: unknown, task: unknown, cwd: unknown): string {
	return [
		typeof toolCallId === "string" ? toolCallId : "",
		typeof cwd === "string" ? cwd : "",
		typeof task === "string" ? task : "",
	].join("\0");
}

function generatedAlias(toolCallId: unknown, task: unknown, cwd: unknown): string {
	const seed = aliasSeed(toolCallId, task, cwd);
	const hash = createHash("sha256").update(seed).digest();
	return MYTH_ALIAS_NAMES[hash.readUInt32BE(0) % MYTH_ALIAS_NAMES.length]!;
}

export function getGeneratedSubagentAliasForRender(toolCallId: unknown, task: unknown, cwd?: unknown): string {
	return generatedAlias(toolCallId, task, cwd);
}

export function getGeneratedSubagentAliasForExecute(toolCallId: unknown, task: unknown, cwd?: unknown): string {
	return generatedAlias(toolCallId, task, cwd);
}
