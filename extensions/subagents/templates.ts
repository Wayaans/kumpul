import fs from "node:fs";
import path from "node:path";
import { parseFrontmatter } from "@earendil-works/pi-coding-agent";
import { getProjectSubagentPath, sanitizeDiscoveryCwd } from "./registry.ts";
import { parseModelRef, THINKING_LEVELS, containsControlCharacters } from "./types.ts";

const PROJECT_TEMPLATES_RELATIVE = path.join(".pi", "kumpul", "templates");
const COPY_SUFFIXES = ["copy", "copy-two", "copy-three", "copy-four", "copy-five", "copy-six", "copy-seven", "copy-eight", "copy-nine", "copy-ten"];

export interface SubagentTemplate {
	name: string;
	description: string;
	model?: string;
	thinking?: string;
	activeSkills?: string[];
	filePath: string;
	hasPreamble: boolean;
}

export interface TemplateDiscoveryOptions {
	includeProject?: boolean;
}

function diagnostic(message: string): void {
	console.warn(`[subagents] ${message}`);
}

function asString(value: unknown): string | undefined {
	return typeof value === "string" ? value.trim() : undefined;
}

function parseList(value: unknown): string[] | undefined {
	if (typeof value !== "string") return undefined;
	const list = value.split(",").map((t) => t.trim()).filter(Boolean);
	return list.length > 0 ? [...new Set(list)].sort((a, b) => a.localeCompare(b)) : undefined;
}

function isCanonicalResourceName(name: string): boolean {
	return /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(name);
}

function validateTemplateName(name: string): string | null {
	if (!name) return "name must be a non-empty string";
	if (containsControlCharacters(name)) return "name must not contain control characters";
	if (/\d/.test(name)) return "name must not contain digits";
	if (!isCanonicalResourceName(name)) return "name must be lower kebab-case";
	return null;
}

function findProjectTemplatesDir(cwd: string): string | null {
	let currentDir = sanitizeDiscoveryCwd(cwd);
	while (true) {
		const candidate = path.join(currentDir, PROJECT_TEMPLATES_RELATIVE);
		try {
			if (fs.statSync(candidate).isDirectory()) return fs.realpathSync(candidate);
		} catch {}
		const parentDir = path.dirname(currentDir);
		if (parentDir === currentDir) return null;
		currentDir = parentDir;
	}
}

export function parseProjectTemplate(filePath: string): SubagentTemplate | null {
	let content: string;
	try {
		content = fs.readFileSync(filePath, "utf-8");
	} catch (error) {
		diagnostic(`Unable to read template file ${filePath}: ${error instanceof Error ? error.message : String(error)}`);
		return null;
	}
	if (!content.trimStart().startsWith("---")) {
		diagnostic(`Skipping invalid template file ${filePath}: missing frontmatter`);
		return null;
	}
	let parsed: { frontmatter: Record<string, unknown>; body: string };
	try {
		parsed = parseFrontmatter<Record<string, unknown>>(content);
	} catch (error) {
		diagnostic(`Invalid frontmatter in ${filePath}: ${error instanceof Error ? error.message : String(error)}`);
		return null;
	}
	const allowedFields = new Set(["name", "description", "model", "thinking", "active_skills"]);
	for (const field of Object.keys(parsed.frontmatter)) {
		if (!allowedFields.has(field)) {
			diagnostic(`Skipping invalid template file ${filePath}: ${field} is not supported in templates`);
			return null;
		}
		if (parsed.frontmatter[field] != null && typeof parsed.frontmatter[field] !== "string") {
			diagnostic(`Skipping invalid template file ${filePath}: ${field} must be a string`);
			return null;
		}
	}
	const name = asString(parsed.frontmatter.name) ?? "";
	const nameError = validateTemplateName(name);
	if (nameError) {
		diagnostic(`Skipping invalid template file ${filePath}: ${nameError}`);
		return null;
	}
	const expectedName = path.basename(filePath, ".md");
	if (name !== expectedName) {
		diagnostic(`Skipping invalid template file ${filePath}: name must match filename stem`);
		return null;
	}
	const description = asString(parsed.frontmatter.description);
	if (!description) {
		diagnostic(`Skipping invalid template file ${filePath}: description must be a non-empty string`);
		return null;
	}
	const model = parsed.frontmatter.model === null ? undefined : asString(parsed.frontmatter.model);
	if (model && !parseModelRef(model)) {
		diagnostic(`Skipping invalid template file ${filePath}: model must be provider/model`);
		return null;
	}
	const thinking = parsed.frontmatter.thinking === null ? undefined : asString(parsed.frontmatter.thinking);
	if (thinking && !THINKING_LEVELS.includes(thinking as never)) {
		diagnostic(`Skipping invalid template file ${filePath}: thinking must be one of ${THINKING_LEVELS.join(", ")}`);
		return null;
	}
	const activeSkills = parseList(parsed.frontmatter.active_skills);
	if (activeSkills?.some((skill) => !isCanonicalResourceName(skill))) {
		diagnostic(`Skipping invalid template file ${filePath}: active_skills contains an invalid canonical skill name`);
		return null;
	}
	return {
		name,
		description,
		...(model ? { model } : {}),
		...(thinking ? { thinking } : {}),
		...(activeSkills ? { activeSkills } : {}),
		filePath: fs.realpathSync(filePath),
		hasPreamble: parsed.body.trim().length > 0,
	};
}

export function discoverProjectTemplates(cwd: string, options: TemplateDiscoveryOptions = { includeProject: true }): SubagentTemplate[] {
	if (options.includeProject === false) return [];
	const dir = findProjectTemplatesDir(cwd);
	if (!dir) return [];
	let entries: fs.Dirent[];
	try {
		entries = fs.readdirSync(dir, { withFileTypes: true });
	} catch {
		return [];
	}
	return entries
		.filter((entry) => entry.name.endsWith(".md") && (entry.isFile() || entry.isSymbolicLink()))
		.map((entry) => parseProjectTemplate(path.join(dir, entry.name)))
		.filter((template): template is SubagentTemplate => template !== null)
		.sort((a, b) => a.name.localeCompare(b.name));
}

function relativeDisplayPath(cwd: string, filePath: string): string {
	const rel = path.relative(sanitizeDiscoveryCwd(cwd), filePath) || filePath;
	return rel.startsWith("..") ? filePath : rel.split(path.sep).join("/");
}

export function buildProjectTemplateGuidance(templates: SubagentTemplate[], cwd: string): string {
	if (templates.length === 0) return "";
	const lines = [
		"Project subagent templates are available. When using one, pass its params exactly to the subagent tool. Use subagent model, thinking, and task_preamble only when applying a project template unless the user explicitly asks.",
		"If a template has preamble_path, read that file first and pass only the markdown body after frontmatter as subagent.task_preamble.",
		"Templates:",
	];
	for (const template of templates) {
		lines.push(`- ${template.name}: ${template.description}`);
		lines.push(`  params:`);
		lines.push(`    alias: "${template.name}"`);
		if (template.model) lines.push(`    model: "${template.model}"`);
		if (template.thinking) lines.push(`    thinking: "${template.thinking}"`);
		if (template.activeSkills) lines.push(`    active_skills: ${JSON.stringify(template.activeSkills)}`);
		if (template.hasPreamble) lines.push(`  preamble_path: ${relativeDisplayPath(cwd, template.filePath)}`);
	}
	return lines.join("\n");
}

function templateDirForCreation(cwd: string): string {
	return path.join(path.dirname(getProjectSubagentPath(cwd)), "templates");
}

function copyName(baseName: string, copyIndex: number): string {
	const suffix = COPY_SUFFIXES[copyIndex - 1];
	return suffix ? `${baseName}-${suffix}` : `${baseName}-${"copy-".repeat(copyIndex).replace(/-$/, "")}`;
}

export function createProjectTemplateStub(cwd: string, requestedName: string): { name: string; filePath: string } {
	const baseName = requestedName.trim();
	const nameError = validateTemplateName(baseName);
	if (nameError) throw new Error(`Invalid template name: ${nameError}`);
	const dir = templateDirForCreation(cwd);
	fs.mkdirSync(dir, { recursive: true });
	let name = baseName;
	let filePath = path.join(dir, `${name}.md`);
	let copyIndex = 0;
	while (fs.existsSync(filePath)) {
		copyIndex += 1;
		name = copyName(baseName, copyIndex);
		filePath = path.join(dir, `${name}.md`);
	}
	const content = `---\nname: ${name}\ndescription: TODO describe when to use this subagent template\nmodel:\nthinking:\nactive_skills:\n---\n\nTODO write task preamble for this template, or delete this body if not needed.\n`;
	fs.writeFileSync(filePath, content, { encoding: "utf-8", mode: 0o600 });
	return { name, filePath: fs.realpathSync(filePath) };
}
