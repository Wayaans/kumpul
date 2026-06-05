import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import type { ToolInfo } from "@earendil-works/pi-coding-agent";

const EXTENSION_DIR = fileURLToPath(new URL(".", import.meta.url));
const KUMPUL_EXTENSIONS_DIR = path.join(EXTENSION_DIR, "..");
const TOOLS_DIR = path.join(EXTENSION_DIR, "tools");

export const BUILTIN_TOOLS = new Set([
	"read",
	"write",
	"edit",
	"grep",
	"find",
	"ls",
]);

const KUMPUL_TOOL_PATHS: Record<string, string> = {
	safe_bash: path.join(TOOLS_DIR, "safe-bash.ts"),
	subagent: path.join(EXTENSION_DIR, "index.ts"),
	find_docs: path.join(KUMPUL_EXTENSIONS_DIR, "find-docs", "index.ts"),
};

const GLOBAL_EXT_BASE = path.join(
	process.env.HOME || "~",
	".pi",
	"agent",
	"extensions",
);

const CURSOR_PROVIDER_CANDIDATES = [
	path.join(GLOBAL_EXT_BASE, "pi-cursor-sdk", "index.ts"),
	path.join(process.env.HOME || "~", ".pi", "agent", "npm", "node_modules", "pi-cursor-sdk", "src", "index.ts"),
];

export type ToolExtensionPaths = ReadonlyMap<string, string>;

function existingFile(p: string | undefined): string | undefined {
	return p && fs.existsSync(p) && fs.statSync(p).isFile() ? p : undefined;
}

export function collectToolExtensionPaths(tools: ToolInfo[]): Map<string, string> {
	const result = new Map<string, string>();
	for (const tool of tools) {
		const sourcePath = existingFile(tool.sourceInfo?.path);
		if (sourcePath) result.set(tool.name, sourcePath);
	}
	return result;
}

/** Extension entry for pi-cursor-sdk (required when agent model is cursor/*). */
export function resolveCursorProviderExtension(): string | undefined {
	for (const candidate of CURSOR_PROVIDER_CANDIDATES) {
		const resolved = existingFile(candidate);
		if (resolved) return resolved;
	}
	return undefined;
}

/** Resolve extension entry path for a custom tool name. */
export function resolveCustomToolExtension(
	tool: string,
	toolExtensionPaths: ToolExtensionPaths = new Map(),
): string | undefined {
	const kumpul = existingFile(KUMPUL_TOOL_PATHS[tool]);
	if (kumpul) return kumpul;

	const fromPiMetadata = existingFile(toolExtensionPaths.get(tool));
	if (fromPiMetadata) return fromPiMetadata;

	const globalPath = existingFile(path.join(GLOBAL_EXT_BASE, tool.replace(/_/g, "-"), "index.ts"));
	if (globalPath) return globalPath;

	return undefined;
}

function readRegisterToolNames(filePath: string): string[] {
	if (!fs.existsSync(filePath)) return [];
	try {
		const content = fs.readFileSync(filePath, "utf-8");
		const names = new Set<string>();
		for (const match of content.matchAll(/registerTool\s*\(\s*\{[\s\S]*?name:\s*["']([^"']+)["']/g)) {
			names.add(match[1]!);
		}
		if (content.includes("registerTool")) {
			for (const match of content.matchAll(/\bname:\s*["']([a-z][a-z0-9_]*)["']/g)) {
				names.add(match[1]!);
			}
		}
		return [...names];
	} catch {
		return [];
	}
}

function scanExtensionDir(baseDir: string, names: Set<string>): void {
	if (!fs.existsSync(baseDir)) return;

	for (const entry of fs.readdirSync(baseDir)) {
		const extDir = path.join(baseDir, entry);
		if (!fs.statSync(extDir).isDirectory()) continue;

		for (const toolName of readRegisterToolNames(path.join(extDir, "index.ts"))) {
			names.add(toolName);
		}

		const toolsDir = path.join(extDir, "tools");
		if (!fs.existsSync(toolsDir)) continue;
		for (const file of fs.readdirSync(toolsDir)) {
			if (!file.endsWith(".ts")) continue;
			for (const toolName of readRegisterToolNames(path.join(toolsDir, file))) {
				names.add(toolName);
			}
		}
	}
}

/** Tool names registered in installed extension directories (kumpul + ~/.pi/agent/extensions). */
export function discoverInstalledExtensionToolNames(): string[] {
	const names = new Set<string>();
	scanExtensionDir(KUMPUL_EXTENSIONS_DIR, names);
	scanExtensionDir(GLOBAL_EXT_BASE, names);
	return [...names].sort((a, b) => a.localeCompare(b));
}

/** Tool names the subagent UI may offer — session tools, installed extensions, and agent config. */
export function discoverSelectableToolNames(
	allTools: ToolInfo[],
	preserveNames: Iterable<string> = [],
): string[] {
	const toolExtensionPaths = collectToolExtensionPaths(allTools);
	const names = new Set<string>(BUILTIN_TOOLS);

	for (const tool of allTools) names.add(tool.name);
	for (const toolName of discoverInstalledExtensionToolNames()) names.add(toolName);
	for (const toolName of Object.keys(KUMPUL_TOOL_PATHS)) {
		if (resolveCustomToolExtension(toolName, toolExtensionPaths)) names.add(toolName);
	}
	for (const name of preserveNames) names.add(name);

	return [...names].sort((a, b) => a.localeCompare(b));
}

export function getExtensionDir(): string {
	return EXTENSION_DIR;
}
