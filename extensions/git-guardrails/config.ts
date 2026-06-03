import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parse, stringify } from "yaml";
import type { GitGuardrailsConfig } from "./types.ts";

const EXTENSION_DIR = fileURLToPath(new URL(".", import.meta.url));

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

function extractEnabled(document: unknown): boolean | undefined {
	if (Array.isArray(document)) {
		for (const item of document) {
			if (!isRecord(item)) continue;
			const extension = typeof item.extension === "string" ? item.extension.trim().toLowerCase() : "";
			if (extension !== "git-guardrails" && extension !== "git_guardrails") continue;
			if (typeof item.enabled === "boolean") return item.enabled;
		}
		return undefined;
	}

	if (!isRecord(document)) return undefined;

	if (typeof document.enabled === "boolean" && typeof document.extension === "string") {
		const extension = document.extension.trim().toLowerCase();
		if (extension === "git-guardrails" || extension === "git_guardrails") {
			return document.enabled;
		}
	}

	const nested = document["git-guardrails"] ?? document.git_guardrails ?? document.gitGuardrails;
	if (typeof nested === "boolean") return nested;
	if (isRecord(nested) && typeof nested.enabled === "boolean") return nested.enabled;

	return undefined;
}

export function loadMergedGitGuardrailsConfig(cwd: string): GitGuardrailsConfig {
	const defaults = extractEnabled(readYamlFile(getDefaultConfigPath())) ?? false;
	const project = extractEnabled(readYamlFile(getProjectConfigPath(cwd)));
	return { enabled: project ?? defaults };
}

export function updateProjectGitGuardrailsEnabled(
	cwd: string,
	enabled: boolean,
): { path: string; saved: GitGuardrailsConfig } {
	const configPath = getProjectConfigPath(cwd);
	const existingDocument = readYamlFile(configPath);
	const nextDocument = mergeGitGuardrailsEnabled(existingDocument, enabled);

	fs.mkdirSync(path.dirname(configPath), { recursive: true });
	fs.writeFileSync(configPath, stringify(nextDocument), "utf-8");

	return { path: configPath, saved: { enabled } };
}

function mergeGitGuardrailsEnabled(existingDocument: unknown, enabled: boolean): unknown {
	if (Array.isArray(existingDocument)) {
		const filtered = existingDocument.filter((item) => {
			if (!isRecord(item)) return true;
			const extension = typeof item.extension === "string" ? item.extension.trim().toLowerCase() : "";
			return extension !== "git-guardrails" && extension !== "git_guardrails";
		});
		return [...filtered, { extension: "git-guardrails", enabled }];
	}

	if (isRecord(existingDocument)) {
		return {
			...existingDocument,
			"git-guardrails": { enabled },
		};
	}

	return [{ extension: "git-guardrails", enabled }];
}

export function isGitGuardrailsEnabled(cwd: string): boolean {
	return loadMergedGitGuardrailsConfig(cwd).enabled;
}
