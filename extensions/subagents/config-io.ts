import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parse, stringify } from "yaml";

const EXTENSION_DIR = fileURLToPath(new URL(".", import.meta.url));
const EXTENSION_IDS = new Set(["subagents", "subagent", "pi-subagents"]);

export interface SubagentsUiConfig {
	enabled: boolean;
	disabledAgents: Set<string>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readYamlFile(filePath: string): unknown {
	if (!fs.existsSync(filePath)) return undefined;

	try {
		return parse(fs.readFileSync(filePath, "utf-8"));
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		console.error(`Warning: failed to parse config at ${filePath}: ${message}`);
		return undefined;
	}
}

function findProjectRoot(startCwd: string): string {
	let current = path.resolve(startCwd);

	while (true) {
		if (fs.existsSync(path.join(current, ".git")) || fs.existsSync(path.join(current, ".pi"))) {
			return current;
		}

		const parent = path.dirname(current);
		if (parent === current) {
			return path.resolve(startCwd);
		}
		current = parent;
	}
}

export function getDefaultConfigPath(): string {
	return path.join(EXTENSION_DIR, "config.yaml");
}

export function getProjectConfigPath(cwd: string): string {
	return path.join(findProjectRoot(cwd), ".pi", "kumpul", "config.yaml");
}

function matchesExtensionId(extension: string): boolean {
	return EXTENSION_IDS.has(extension.trim().toLowerCase());
}

function parseDisabledAgents(value: unknown): string[] {
	if (!Array.isArray(value)) return [];
	return value
		.filter((item): item is string => typeof item === "string")
		.map((item) => item.trim())
		.filter(Boolean);
}

function extractFromRecord(record: Record<string, unknown>): Partial<SubagentsUiConfig> {
	const out: Partial<SubagentsUiConfig> = {};
	if (typeof record.enabled === "boolean") out.enabled = record.enabled;
	if (record.disabledAgents !== undefined) {
		out.disabledAgents = new Set(parseDisabledAgents(record.disabledAgents));
	}
	return out;
}

function extractConfig(document: unknown): Partial<SubagentsUiConfig> {
	if (Array.isArray(document)) {
		const merged: Partial<SubagentsUiConfig> = {};
		for (const item of document) {
			if (!isRecord(item)) continue;
			const extension = typeof item.extension === "string" ? item.extension : "";
			if (!matchesExtensionId(extension)) continue;
			const patch = extractFromRecord(item);
			if (patch.enabled !== undefined) merged.enabled = patch.enabled;
			if (patch.disabledAgents !== undefined) merged.disabledAgents = patch.disabledAgents;
		}
		return merged;
	}

	if (!isRecord(document)) return {};

	if (typeof document.extension === "string" && matchesExtensionId(document.extension)) {
		return extractFromRecord(document);
	}

	if (document.extension === undefined && (document.enabled !== undefined || document.disabledAgents !== undefined)) {
		return extractFromRecord(document);
	}

	const nested = document.subagents ?? document["pi-subagents"];
	if (typeof nested === "boolean") return { enabled: nested };
	if (isRecord(nested)) return extractFromRecord(nested);

	return {};
}

const DEFAULTS: SubagentsUiConfig = { enabled: true, disabledAgents: new Set() };

function cloneDisabledAgents(disabledAgents: Set<string> | undefined): Set<string> {
	return new Set(disabledAgents ?? DEFAULTS.disabledAgents);
}

export function loadMergedSubagentsUiConfig(cwd: string): SubagentsUiConfig {
	const fromDefault = extractConfig(readYamlFile(getDefaultConfigPath()));
	const fromProject = extractConfig(readYamlFile(getProjectConfigPath(cwd)));
	return {
		enabled: fromProject.enabled ?? fromDefault.enabled ?? DEFAULTS.enabled,
		disabledAgents: cloneDisabledAgents(fromProject.disabledAgents ?? fromDefault.disabledAgents),
	};
}

export function updateProjectSubagentsUiConfig(
	cwd: string,
	patch: Partial<SubagentsUiConfig>,
): { path: string; saved: SubagentsUiConfig } {
	const current = loadMergedSubagentsUiConfig(cwd);
	const saved: SubagentsUiConfig = {
		enabled: patch.enabled ?? current.enabled,
		disabledAgents: cloneDisabledAgents(patch.disabledAgents ?? current.disabledAgents),
	};
	const configPath = getProjectConfigPath(cwd);
	const nextDocument = mergeSubagentsConfig(readYamlFile(configPath), saved);

	fs.mkdirSync(path.dirname(configPath), { recursive: true });
	fs.writeFileSync(configPath, stringify(nextDocument), "utf-8");

	return { path: configPath, saved };
}

function mergeSubagentsConfig(existingDocument: unknown, saved: SubagentsUiConfig): unknown {
	const disabledAgents = [...saved.disabledAgents].sort();

	if (Array.isArray(existingDocument)) {
		const filtered = existingDocument.filter((item) => {
			if (!isRecord(item)) return true;
			const extension = typeof item.extension === "string" ? item.extension : "";
			return !matchesExtensionId(extension);
		});
		return [
			...filtered,
			{
				extension: "subagents",
				enabled: saved.enabled,
				...(disabledAgents.length > 0 ? { disabledAgents } : {}),
			},
		];
	}

	if (isRecord(existingDocument)) {
		return {
			...existingDocument,
			subagents: {
				enabled: saved.enabled,
				...(disabledAgents.length > 0 ? { disabledAgents } : {}),
			},
		};
	}

	return [
		{
			extension: "subagents",
			enabled: saved.enabled,
			...(disabledAgents.length > 0 ? { disabledAgents } : {}),
		},
	];
}

export function isAgentSpawnEnabled(name: string, config: SubagentsUiConfig): boolean {
	return config.enabled && !config.disabledAgents.has(name);
}
