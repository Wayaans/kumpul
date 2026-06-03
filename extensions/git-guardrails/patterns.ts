import type { DangerousGitPattern } from "./types.ts";

const SEGMENT_PREFIX = String.raw`(?:^|(?:&&|\|\||[;&|])\s*|\n\s*)`;
const GIT_PREFIX = String.raw`${SEGMENT_PREFIX}git(?:\s+(?:-[^\s]+(?:\s+\S+)?|--[^\s=]+(?:=\S+)?(?:\s+\S+)?))*\s+`;
const SHELL_WRAPPER_PATTERN = /\b(?:bash|sh|zsh|fish)\s+-\w*c\b\s+(["'])([\s\S]*?)\1/gi;

function gitCommandPattern(pattern: string): RegExp {
	return new RegExp(`${GIT_PREFIX}${pattern}`, "i");
}

function stripKnownPrefixes(command: string): string {
	let current = command.trim();

	while (true) {
		const next = current
			.replace(/^sudo(?:\s+-\S+(?:\s+\S+)?)*\s+/i, "")
			.replace(/^(?:command|builtin|noglob|nocorrect|nohup|time|exec)\s+/i, "")
			.replace(/^env(?:\s+[A-Za-z_][A-Za-z0-9_]*=\S+)+\s+/i, "")
			.replace(/^timeout(?:\s+\S+){1,2}\s+/i, "");

		if (next === current) {
			return current;
		}

		current = next.trim();
	}
}

function buildInspectionCandidates(command: string): string[] {
	const pending = [command];
	const seen = new Set<string>();
	const candidates: string[] = [];

	while (pending.length > 0) {
		const current = pending.pop()?.trim() ?? "";
		if (!current || seen.has(current)) {
			continue;
		}

		seen.add(current);
		candidates.push(current);

		const stripped = stripKnownPrefixes(current);
		if (stripped !== current) {
			pending.push(stripped);
		}

		for (const match of current.matchAll(SHELL_WRAPPER_PATTERN)) {
			const nested = match[2]?.trim();
			if (nested) {
				pending.push(nested);
			}
		}
	}

	return candidates;
}

export const DANGEROUS_GIT_PATTERNS: readonly DangerousGitPattern[] = [
	{
		label: "git push",
		pattern: gitCommandPattern(String.raw`push\b`),
	},
	{
		label: "git reset --hard",
		pattern: gitCommandPattern(String.raw`reset\s+--hard(?:\s|$)`),
	},
	{
		label: "git clean -f / -fd / --force",
		pattern: gitCommandPattern(String.raw`clean\b[^\n;&|]*(?:\s-[^\n;&|]*f|\s+--force(?:\s|$))`),
	},
	{
		label: "git branch -D",
		pattern: gitCommandPattern(String.raw`branch\s+-D\b`),
	},
	{
		label: "git checkout .",
		pattern: gitCommandPattern(String.raw`checkout\s+\.(?:\s|$)`),
	},
	{
		label: "git restore .",
		pattern: gitCommandPattern(String.raw`restore\s+\.(?:\s|$)`),
	},
	{
		label: "push --force",
		pattern: new RegExp(`${SEGMENT_PREFIX}push\\b[^\\n;&|]*\\s+--force(?:\\b|-with-lease\\b)`, "i"),
	},
	{
		label: "reset --hard",
		pattern: new RegExp(`${SEGMENT_PREFIX}reset\\s+--hard(?:\\s|$)`, "i"),
	},
] as const;

export function findDangerousGitPattern(command: string): DangerousGitPattern | null {
	for (const candidateCommand of buildInspectionCandidates(command)) {
		for (const candidate of DANGEROUS_GIT_PATTERNS) {
			if (candidate.pattern.test(candidateCommand)) {
				return candidate;
			}
		}
	}

	return null;
}
