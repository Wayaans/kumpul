import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parse, stringify } from "yaml";
import type { FooterVariant } from "./render.ts";
import type { PolishStatuslineConfig } from "./types.ts";

const EXTENSION_DIR = fileURLToPath(new URL(".", import.meta.url));
const EXTENSION_IDS = new Set(["polish-statusline", "polish_statusline", "polishstatusline"]);
const VARIANTS = new Set<FooterVariant>(["codex", "compact", "minimal"]);

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseVariant(value: unknown): FooterVariant | undefined {
	if (typeof value !== "string") return undefined;
	const v = value.trim().toLowerCase();
	return VARIANTS.has(v as FooterVariant) ? (v as FooterVariant) : undefined;
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

function extractFromRecord(record: Record<string, unknown>): Partial<PolishStatuslineConfig> {
	const out: Partial<PolishStatuslineConfig> = {};
	if (typeof record.enabled === "boolean") out.enabled = record.enabled;
	const variant = parseVariant(record.variant);
	if (variant) out.variant = variant;
	return out;
}

function extractConfig(document: unknown): Partial<PolishStatuslineConfig> {
	if (Array.isArray(document)) {
		const merged: Partial<PolishStatuslineConfig> = {};
		for (const item of document) {
			if (!isRecord(item)) continue;
			const extension = typeof item.extension === "string" ? item.extension : "";
			if (!matchesExtensionId(extension)) continue;
			Object.assign(merged, extractFromRecord(item));
		}
		return merged;
	}

	if (!isRecord(document)) return {};

	if (typeof document.extension === "string" && matchesExtensionId(document.extension)) {
		return extractFromRecord(document);
	}

	// Extension default config.yaml (flat enabled / variant keys)
	if (document.extension === undefined && (document.enabled !== undefined || document.variant !== undefined)) {
		return extractFromRecord(document);
	}

	const nested =
		document["polish-statusline"] ?? document.polish_statusline ?? document.polishStatusline;
	if (typeof nested === "boolean") return { enabled: nested };
	if (isRecord(nested)) return extractFromRecord(nested);

	return {};
}

const DEFAULTS: PolishStatuslineConfig = { enabled: true, variant: "codex" };

export function loadMergedPolishStatuslineConfig(cwd: string): PolishStatuslineConfig {
	const fromDefault = extractConfig(readYamlFile(getDefaultConfigPath()));
	const fromProject = extractConfig(readYamlFile(getProjectConfigPath(cwd)));
	return {
		enabled: fromProject.enabled ?? fromDefault.enabled ?? DEFAULTS.enabled,
		variant: fromProject.variant ?? fromDefault.variant ?? DEFAULTS.variant,
	};
}

export function updateProjectPolishStatuslineConfig(
	cwd: string,
	patch: Partial<PolishStatuslineConfig>,
): { path: string; saved: PolishStatuslineConfig } {
	const configPath = getProjectConfigPath(cwd);
	const current = loadMergedPolishStatuslineConfig(cwd);
	const saved: PolishStatuslineConfig = {
		enabled: patch.enabled ?? current.enabled,
		variant: patch.variant ?? current.variant,
	};
	const nextDocument = mergePolishStatuslineConfig(readYamlFile(configPath), saved);

	fs.mkdirSync(path.dirname(configPath), { recursive: true });
	fs.writeFileSync(configPath, stringify(nextDocument), "utf-8");

	return { path: configPath, saved };
}

function mergePolishStatuslineConfig(existingDocument: unknown, saved: PolishStatuslineConfig): unknown {
	if (Array.isArray(existingDocument)) {
		const filtered = existingDocument.filter((item) => {
			if (!isRecord(item)) return true;
			const extension = typeof item.extension === "string" ? item.extension : "";
			return !matchesExtensionId(extension);
		});
		return [
			...filtered,
			{ extension: "polish-statusline", enabled: saved.enabled, variant: saved.variant },
		];
	}

	if (isRecord(existingDocument)) {
		return {
			...existingDocument,
			"polish-statusline": { enabled: saved.enabled, variant: saved.variant },
		};
	}

	return [{ extension: "polish-statusline", enabled: saved.enabled, variant: saved.variant }];
}
