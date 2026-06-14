import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import type { ToolInfo } from "@earendil-works/pi-coding-agent";

const EXTENSION_DIR = fileURLToPath(new URL(".", import.meta.url));
const KUMPUL_EXTENSIONS_DIR = path.join(EXTENSION_DIR, "..");
const KUMPUL_ROOT = path.join(EXTENSION_DIR, "..", "..");
const KUMPUL_SKILLS_DIR = path.join(KUMPUL_ROOT, "skills");
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

const GLOBAL_AGENT_DIR = path.join(process.env.HOME || "~", ".pi", "agent");
const GLOBAL_EXT_BASE = path.join(GLOBAL_AGENT_DIR, "extensions");
const GLOBAL_NPM_NODE_MODULES = path.join(GLOBAL_AGENT_DIR, "npm", "node_modules");
const GLOBAL_SKILLS_DIR = path.join(GLOBAL_AGENT_DIR, "skills");
const LEGACY_GLOBAL_SKILLS_DIR = path.join(process.env.HOME || "~", ".agents", "skills");

export type ToolExtensionPaths = ReadonlyMap<string, string>;
export type ExtensionNamePaths = ReadonlyMap<string, string>;
export type SkillPaths = ReadonlyMap<string, string>;
export type ResourceSource = "project" | "loaded" | "package" | "global" | "npm";

export interface NamedResourceOption {
	name: string;
	source: ResourceSource;
	path: string;
}

interface SourceInfoLike {
	path?: string;
	source?: string;
	scope?: string;
	origin?: string;
	baseDir?: string;
}

interface CommandInfoLike {
	name: string;
	source?: string;
	sourceInfo?: SourceInfoLike;
}

function existingFile(p: string | undefined): string | undefined {
	return p && fs.existsSync(p) && fs.statSync(p).isFile() ? p : undefined;
}

function isCanonicalResourceName(name: string): boolean {
	return /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(name);
}

function addIfMissing(map: Map<string, string>, name: string | undefined, filePath: string | undefined): void {
	const resolved = existingFile(filePath);
	if (name && resolved && !map.has(name)) map.set(name, resolved);
}

function addOption(
	options: Map<string, NamedResourceOption>,
	name: string | undefined,
	filePath: string | undefined,
	source: ResourceSource,
): void {
	const resolved = existingFile(filePath);
	if (name && isCanonicalResourceName(name) && resolved && !options.has(name)) {
		options.set(name, { name, source, path: resolved });
	}
}

function extensionNameFromPath(filePath: string): string | undefined {
	const parsed = path.parse(filePath);
	if (parsed.name === "index") return path.basename(parsed.dir);
	return path.basename(parsed.dir) === "extensions" ? parsed.name : undefined;
}

function extensionNameFromSourceInfo(sourceInfo: SourceInfoLike | undefined): string | undefined {
	if (sourceInfo?.source && isCanonicalResourceName(sourceInfo.source)) return sourceInfo.source;
	return sourceInfo?.path ? extensionNameFromPath(sourceInfo.path) : undefined;
}

export function collectToolExtensionPaths(tools: ToolInfo[]): Map<string, string> {
	const result = new Map<string, string>();
	for (const tool of tools) {
		addIfMissing(result, tool.name, tool.sourceInfo?.path);
	}
	return result;
}

export function collectNamedExtensionPaths(tools: ToolInfo[], commands: CommandInfoLike[] = []): Map<string, string> {
	const result = new Map<string, string>();
	for (const tool of tools) {
		const sourcePath = existingFile(tool.sourceInfo?.path);
		if (sourcePath) addIfMissing(result, extensionNameFromSourceInfo(tool.sourceInfo), sourcePath);
	}
	for (const command of commands) {
		if (command.source !== "extension") continue;
		const sourcePath = existingFile(command.sourceInfo?.path);
		if (sourcePath) addIfMissing(result, extensionNameFromSourceInfo(command.sourceInfo), sourcePath);
	}
	return result;
}

export function collectSkillPaths(commands: CommandInfoLike[]): Map<string, string> {
	const result = new Map<string, string>();
	for (const command of commands) {
		if (command.source !== undefined && command.source !== "skill") continue;
		if (!command.name.startsWith("skill:")) continue;
		addIfMissing(result, command.name.slice("skill:".length), command.sourceInfo?.path);
	}
	return result;
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

	const installedExtension = existingFile(discoverInstalledExtensionToolPaths().get(tool));
	if (installedExtension) return installedExtension;

	const globalPath = existingFile(path.join(GLOBAL_EXT_BASE, tool.replace(/_/g, "-"), "index.ts"));
	if (globalPath) return globalPath;

	return undefined;
}

function addProjectExtensionCandidates(candidates: string[], cwd: string, name: string): void {
	let currentDir = path.resolve(cwd);
	while (true) {
		candidates.push(path.join(currentDir, ".pi", "extensions", name, "index.ts"));
		candidates.push(path.join(currentDir, ".pi", "extensions", `${name}.ts`));

		const parentDir = path.dirname(currentDir);
		if (parentDir === currentDir) return;
		currentDir = parentDir;
	}
}

export function resolveNamedExtension(
	name: string,
	extensionNamePaths: ExtensionNamePaths = new Map(),
	cwd: string = process.cwd(),
): string | undefined {
	const candidates: string[] = [];
	addProjectExtensionCandidates(candidates, cwd, name);
	for (const candidate of candidates) {
		const resolved = existingFile(candidate);
		if (resolved) return resolved;
	}

	const fromPiMetadata = existingFile(extensionNamePaths.get(name));
	if (fromPiMetadata) return fromPiMetadata;

	candidates.length = 0;
	candidates.push(
		path.join(KUMPUL_EXTENSIONS_DIR, name, "index.ts"),
		path.join(KUMPUL_EXTENSIONS_DIR, `${name}.ts`),
		path.join(GLOBAL_EXT_BASE, name, "index.ts"),
		path.join(GLOBAL_EXT_BASE, `${name}.ts`),
		path.join(GLOBAL_NPM_NODE_MODULES, name, "index.ts"),
		path.join(GLOBAL_NPM_NODE_MODULES, name, "src", "index.ts"),
	);

	for (const candidate of candidates) {
		const resolved = existingFile(candidate);
		if (resolved) return resolved;
	}

	const npmPackagePath = firstNpmPackageExtensionPath(path.join(GLOBAL_NPM_NODE_MODULES, name));
	if (npmPackagePath) return npmPackagePath;
	return undefined;
}

function addSkillCandidates(candidates: string[], dir: string, name: string): void {
	candidates.push(path.join(dir, name, "SKILL.md"));
	candidates.push(path.join(dir, `${name}.md`));
}

function addProjectSkillCandidates(candidates: string[], cwd: string, name: string): void {
	let currentDir = path.resolve(cwd);
	while (true) {
		addSkillCandidates(candidates, path.join(currentDir, ".pi", "skills"), name);
		addSkillCandidates(candidates, path.join(currentDir, ".agents", "skills"), name);

		const parentDir = path.dirname(currentDir);
		if (parentDir === currentDir) return;
		currentDir = parentDir;
	}
}

export function resolveNamedSkill(
	name: string,
	skillPaths: SkillPaths = new Map(),
	cwd: string = process.cwd(),
): string | undefined {
	const candidates: string[] = [];
	addProjectSkillCandidates(candidates, cwd, name);
	for (const candidate of candidates) {
		const resolved = existingFile(candidate);
		if (resolved) return resolved;
	}

	const fromPiMetadata = existingFile(skillPaths.get(name));
	if (fromPiMetadata) return fromPiMetadata;

	candidates.length = 0;
	addSkillCandidates(candidates, GLOBAL_SKILLS_DIR, name);
	addSkillCandidates(candidates, LEGACY_GLOBAL_SKILLS_DIR, name);
	addSkillCandidates(candidates, KUMPUL_SKILLS_DIR, name);

	for (const candidate of candidates) {
		const resolved = existingFile(candidate);
		if (resolved) return resolved;
	}
	return undefined;
}

function resolveNamedList(
	names: string[] | undefined,
	resolveName: (name: string) => string | undefined,
): { paths: string[]; unresolved: string[] } {
	const paths: string[] = [];
	const seen = new Set<string>();
	const unresolved: string[] = [];

	for (const name of names ?? []) {
		const resolved = resolveName(name);
		if (!resolved) {
			unresolved.push(name);
			continue;
		}
		if (!seen.has(resolved)) {
			seen.add(resolved);
			paths.push(resolved);
		}
	}
	return { paths, unresolved };
}

export function resolveNamedExtensions(
	names: string[] | undefined,
	extensionNamePaths: ExtensionNamePaths = new Map(),
	cwd: string = process.cwd(),
): { paths: string[]; unresolved: string[] } {
	return resolveNamedList(names, (name) => resolveNamedExtension(name, extensionNamePaths, cwd));
}

export function resolveNamedSkills(
	names: string[] | undefined,
	skillPaths: SkillPaths = new Map(),
	cwd: string = process.cwd(),
): { paths: string[]; unresolved: string[] } {
	return resolveNamedList(names, (name) => resolveNamedSkill(name, skillPaths, cwd));
}

function addExtensionOptionsFromDir(
	baseDir: string,
	source: ResourceSource,
	options: Map<string, NamedResourceOption>,
): void {
	if (!fs.existsSync(baseDir)) return;
	for (const entry of fs.readdirSync(baseDir)) {
		const entryPath = path.join(baseDir, entry);
		const stat = fs.statSync(entryPath);
		if (stat.isDirectory()) addOption(options, entry, path.join(entryPath, "index.ts"), source);
		else if (stat.isFile() && entry.endsWith(".ts")) addOption(options, path.basename(entry, ".ts"), entryPath, source);
	}
}

function addProjectExtensionOptions(
	cwd: string,
	options: Map<string, NamedResourceOption>,
): void {
	let currentDir = path.resolve(cwd);
	while (true) {
		addExtensionOptionsFromDir(path.join(currentDir, ".pi", "extensions"), "project", options);
		const parentDir = path.dirname(currentDir);
		if (parentDir === currentDir) return;
		currentDir = parentDir;
	}
}

function firstNpmPackageExtensionPath(packageDir: string): string | undefined {
	for (const entry of npmPackageExtensionEntries(packageDir)) {
		const entryPath = path.resolve(packageDir, entry);
		const resolved = existingFile(entryPath);
		if (resolved) return resolved;
		const indexPath = existingFile(path.join(entryPath, "index.ts")) ?? existingFile(path.join(entryPath, "index.js"));
		if (indexPath) return indexPath;
	}
	return undefined;
}

function addNpmExtensionOptions(
	baseDir: string,
	options: Map<string, NamedResourceOption>,
): void {
	if (!fs.existsSync(baseDir)) return;
	for (const entry of fs.readdirSync(baseDir)) {
		const entryPath = path.join(baseDir, entry);
		if (!fs.statSync(entryPath).isDirectory()) continue;
		if (entry.startsWith("@")) continue;
		addOption(options, entry, firstNpmPackageExtensionPath(entryPath), "npm");
	}
}

export function discoverSelectableExtensionOptions(
	tools: ToolInfo[] = [],
	commands: CommandInfoLike[] = [],
	cwd: string = process.cwd(),
): NamedResourceOption[] {
	const options = new Map<string, NamedResourceOption>();
	addProjectExtensionOptions(cwd, options);
	for (const [name, filePath] of collectNamedExtensionPaths(tools, commands)) {
		addOption(options, name, filePath, "loaded");
	}
	addExtensionOptionsFromDir(KUMPUL_EXTENSIONS_DIR, "package", options);
	addExtensionOptionsFromDir(GLOBAL_EXT_BASE, "global", options);
	addNpmExtensionOptions(GLOBAL_NPM_NODE_MODULES, options);
	return [...options.values()].sort((a, b) => a.name.localeCompare(b.name));
}

function addSkillOptionsFromDir(
	baseDir: string,
	source: ResourceSource,
	options: Map<string, NamedResourceOption>,
): void {
	if (!fs.existsSync(baseDir)) return;
	for (const entry of fs.readdirSync(baseDir)) {
		const entryPath = path.join(baseDir, entry);
		let stat: fs.Stats;
		try {
			stat = fs.statSync(entryPath);
		} catch {
			continue;
		}
		if (stat.isDirectory()) addOption(options, entry, path.join(entryPath, "SKILL.md"), source);
		else if (stat.isFile() && entry.endsWith(".md")) addOption(options, path.basename(entry, ".md"), entryPath, source);
	}
}

function addProjectSkillOptions(cwd: string, options: Map<string, NamedResourceOption>): void {
	let currentDir = path.resolve(cwd);
	while (true) {
		addSkillOptionsFromDir(path.join(currentDir, ".pi", "skills"), "project", options);
		addSkillOptionsFromDir(path.join(currentDir, ".agents", "skills"), "project", options);
		const parentDir = path.dirname(currentDir);
		if (parentDir === currentDir) return;
		currentDir = parentDir;
	}
}

export function discoverSelectableSkillOptions(
	commands: CommandInfoLike[] = [],
	cwd: string = process.cwd(),
): NamedResourceOption[] {
	const options = new Map<string, NamedResourceOption>();
	addProjectSkillOptions(cwd, options);
	for (const [name, filePath] of collectSkillPaths(commands)) addOption(options, name, filePath, "loaded");
	addSkillOptionsFromDir(GLOBAL_SKILLS_DIR, "global", options);
	addSkillOptionsFromDir(LEGACY_GLOBAL_SKILLS_DIR, "global", options);
	addSkillOptionsFromDir(KUMPUL_SKILLS_DIR, "package", options);
	return [...options.values()].sort((a, b) => a.name.localeCompare(b.name));
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

function npmPackageExtensionEntries(packageDir: string): string[] {
	const packageJsonPath = path.join(packageDir, "package.json");
	if (!fs.existsSync(packageJsonPath)) return [];
	try {
		const parsed = JSON.parse(fs.readFileSync(packageJsonPath, "utf-8")) as { pi?: { extensions?: unknown } };
		return Array.isArray(parsed.pi?.extensions)
			? parsed.pi.extensions.filter((entry): entry is string => typeof entry === "string")
			: [];
	} catch {
		return [];
	}
}

function addToolPathsFromFile(filePath: string, extensionPath: string, paths: Map<string, string>): void {
	const resolvedExtension = existingFile(extensionPath);
	if (!resolvedExtension) return;
	for (const toolName of readRegisterToolNames(filePath)) {
		if (!paths.has(toolName)) paths.set(toolName, resolvedExtension);
	}
}

function collectExtensionDirToolPaths(baseDir: string, paths: Map<string, string>): void {
	if (!fs.existsSync(baseDir)) return;
	for (const entry of fs.readdirSync(baseDir)) {
		const extDir = path.join(baseDir, entry);
		if (!fs.statSync(extDir).isDirectory()) continue;

		const indexPath = existingFile(path.join(extDir, "index.ts")) ?? existingFile(path.join(extDir, "index.js"));
		if (indexPath) addToolPathsFromFile(indexPath, indexPath, paths);

		const toolsDir = path.join(extDir, "tools");
		if (!fs.existsSync(toolsDir)) continue;
		for (const file of fs.readdirSync(toolsDir)) {
			if (!file.endsWith(".ts") && !file.endsWith(".js")) continue;
			const toolPath = path.join(toolsDir, file);
			addToolPathsFromFile(toolPath, toolPath, paths);
		}
	}
}

function collectExtensionEntryToolPaths(entryPath: string, paths: Map<string, string>): void {
	if (!fs.existsSync(entryPath)) return;
	const stat = fs.statSync(entryPath);
	if (stat.isFile()) {
		addToolPathsFromFile(entryPath, entryPath, paths);
		return;
	}
	if (!stat.isDirectory()) return;

	const indexPath = existingFile(path.join(entryPath, "index.ts")) ?? existingFile(path.join(entryPath, "index.js"));
	if (indexPath) {
		addToolPathsFromFile(indexPath, indexPath, paths);
		const toolsDir = path.join(entryPath, "tools");
		if (!fs.existsSync(toolsDir)) return;
		for (const file of fs.readdirSync(toolsDir)) {
			if (!file.endsWith(".ts") && !file.endsWith(".js")) continue;
			const toolPath = path.join(toolsDir, file);
			addToolPathsFromFile(toolPath, toolPath, paths);
		}
		return;
	}

	collectExtensionDirToolPaths(entryPath, paths);
}

function collectNpmPackageToolPaths(packageDir: string, paths: Map<string, string>): void {
	for (const entry of npmPackageExtensionEntries(packageDir)) {
		collectExtensionEntryToolPaths(path.resolve(packageDir, entry), paths);
	}
}

function collectNpmPackagesToolPaths(baseDir: string, paths: Map<string, string>): void {
	if (!fs.existsSync(baseDir)) return;
	for (const entry of fs.readdirSync(baseDir)) {
		const entryPath = path.join(baseDir, entry);
		if (!fs.statSync(entryPath).isDirectory()) continue;
		if (entry.startsWith("@")) {
			for (const scopedEntry of fs.readdirSync(entryPath)) {
				const packageDir = path.join(entryPath, scopedEntry);
				if (fs.statSync(packageDir).isDirectory()) collectNpmPackageToolPaths(packageDir, paths);
			}
			continue;
		}
		collectNpmPackageToolPaths(entryPath, paths);
	}
}

export function discoverInstalledExtensionToolPaths(): Map<string, string> {
	const paths = new Map<string, string>();
	collectExtensionDirToolPaths(KUMPUL_EXTENSIONS_DIR, paths);
	collectExtensionDirToolPaths(GLOBAL_EXT_BASE, paths);
	collectNpmPackagesToolPaths(GLOBAL_NPM_NODE_MODULES, paths);
	return paths;
}

/** Tool names registered in installed extension directories (kumpul + ~/.pi/agent/extensions + npm pi packages). */
export function discoverInstalledExtensionToolNames(): string[] {
	return [...discoverInstalledExtensionToolPaths().keys()].sort((a, b) => a.localeCompare(b));
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
