import fs from "node:fs";
import path from "node:path";
import { parse, stringify } from "yaml";
const EXTENSION_IDS = new Set(["subagents", "subagent", "pi-subagents"]);

export interface SubagentsUiConfig {
	enabled: boolean;
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
		throw new Error(`Failed to parse subagents config at ${filePath}: ${message}`);
	}
}

function findProjectRoot(startCwd: string): string {
	let current = path.resolve(startCwd);
	while (true) {
		if (fs.existsSync(path.join(current, ".git")) || fs.existsSync(path.join(current, ".pi"))) return current;
		const parent = path.dirname(current);
		if (parent === current) return path.resolve(startCwd);
		current = parent;
	}
}

export function getProjectConfigPath(cwd: string): string {
	return path.join(findProjectRoot(cwd), ".pi", "kumpul", "config.yaml");
}

function matchesExtensionId(extension: string): boolean {
	return EXTENSION_IDS.has(extension.trim().toLowerCase());
}

function extractFromRecord(record: Record<string, unknown>): Partial<SubagentsUiConfig> {
	return typeof record.enabled === "boolean" ? { enabled: record.enabled } : {};
}

function extractConfig(document: unknown): Partial<SubagentsUiConfig> {
	if (Array.isArray(document)) {
		let enabled: boolean | undefined;
		for (const item of document) {
			if (!isRecord(item)) continue;
			const extension = typeof item.extension === "string" ? item.extension : "";
			if (!matchesExtensionId(extension)) continue;
			if (typeof item.enabled === "boolean") enabled = item.enabled;
		}
		return enabled === undefined ? {} : { enabled };
	}
	if (!isRecord(document)) return {};
	if (typeof document.extension === "string" && matchesExtensionId(document.extension)) return extractFromRecord(document);
	const nested = document.subagents ?? document["pi-subagents"];
	if (typeof nested === "boolean") return { enabled: nested };
	if (isRecord(nested)) return extractFromRecord(nested);
	if (document.extension === undefined && document.enabled !== undefined) return extractFromRecord(document);
	return {};
}

const DEFAULTS: SubagentsUiConfig = { enabled: true };

export function loadMergedSubagentsUiConfig(cwd: string, options: { includeProject?: boolean } = { includeProject: true }): SubagentsUiConfig {
	const fromProject = options.includeProject === false ? {} : extractConfig(readYamlFile(getProjectConfigPath(cwd)));
	return { enabled: fromProject.enabled ?? DEFAULTS.enabled };
}

export function updateProjectSubagentsUiConfig(cwd: string, patch: Partial<SubagentsUiConfig>): { path: string; saved: SubagentsUiConfig } {
	const current = loadMergedSubagentsUiConfig(cwd);
	const saved: SubagentsUiConfig = { enabled: patch.enabled ?? current.enabled };
	const configPath = getProjectConfigPath(cwd);
	const nextDocument = mergeSubagentsConfig(readYamlFile(configPath), saved);
	fs.mkdirSync(path.dirname(configPath), { recursive: true });
	fs.writeFileSync(configPath, stringify(nextDocument), "utf-8");
	return { path: configPath, saved };
}

function mergeSubagentsConfig(existingDocument: unknown, saved: SubagentsUiConfig): unknown {
	if (Array.isArray(existingDocument)) {
		const filtered = existingDocument.filter((item) => {
			if (!isRecord(item)) return true;
			const extension = typeof item.extension === "string" ? item.extension : "";
			return !matchesExtensionId(extension);
		});
		return [...filtered, { extension: "subagents", enabled: saved.enabled }];
	}
	if (isRecord(existingDocument)) {
		const { enabled: _enabled, disabledAgents: _disabledAgents, ...rest } = existingDocument;
		void _enabled;
		void _disabledAgents;
		return { ...rest, subagents: { enabled: saved.enabled } };
	}
	return [{ extension: "subagents", enabled: saved.enabled }];
}

export function isAgentSpawnEnabled(_name: string, config: SubagentsUiConfig): boolean {
	return config.enabled;
}
