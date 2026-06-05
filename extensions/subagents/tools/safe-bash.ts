/**
 * Safe bash for subagent processes — blocks common dangerous commands.
 */
import { Type } from "@earendil-works/pi-ai";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { createBashTool } from "@earendil-works/pi-coding-agent";

const SHELL = String.raw`(?:/(?:usr/)?bin/)?(?:ba|z|c|k)?sh`;

const DANGEROUS_PATTERNS: RegExp[] = [
	new RegExp(String.raw`\brm\b[^;&|\n]*(?:\s--no-preserve-root\b|\s--\s*)?(?:/(?:\s|$)|/\*(?:\s|$)|~(?:/|\s|$)|["']?\$HOME(?:/|\s|$))`, "i"),
	/\bsudo\b/i,
	/\bmkfs(?:\.[a-z0-9]+)?\b/i,
	/\bdd\s+if=/i,
	/:\(\)\s*\{\s*:\|:&\s*\}\s*;:/,
	/>\s*\/dev\/[sh]d[a-z]/i,
	/\bchmod\s+(-[a-zA-Z]+\s+)?777\s+\//i,
	/\bchown\s+(-[a-zA-Z]+\s+)?root\b/i,
	new RegExp(String.raw`\|\s*(?:sudo\s+)?${SHELL}\b`, "i"),
	new RegExp(String.raw`\b(?:curl|wget)\b[^\n;&|]*(?:\|\s*(?:sudo\s+)?${SHELL}\b|>\s*/(?:etc|usr|bin|sbin)\b)`, "i"),
	new RegExp(String.raw`\b${SHELL}\b\s*<\s*\([^)]*\b(?:curl|wget)\b`, "i"),
	new RegExp(String.raw`\b${SHELL}\b\s+-c\s+["'][^"']*\b(?:curl|wget)\b`, "i"),
	/\beval\s+["']?\$?\([^)]*\b(?:curl|wget)\b/i,
	/`[^`]*\b(?:curl|wget)\b[^`]*`/i,
	/\bshutdown\b/i,
	/\breboot\b/i,
	/\binit\s+0\b/i,
	/\bkill\s+-9\s+1\b/i,
	/\bkillall\b/i,
];

export function isDangerousBashCommand(command: string): string | null {
	const normalized = command.replace(/\\\n/g, " ");
	for (const pattern of DANGEROUS_PATTERNS) {
		if (pattern.test(normalized)) {
			return `Command blocked by safe_bash: matches dangerous pattern ${pattern}`;
		}
	}
	return null;
}

export default function (pi: ExtensionAPI) {
	const bashTool = createBashTool(process.cwd());

	pi.registerTool({
		name: "safe_bash",
		label: "Safe Bash",
		description:
			"Execute a bash command. Blocks common dangerous commands (rm -rf /, sudo, mkfs, curl|sh, etc.); this is a denylist, not a sandbox.",
		parameters: Type.Object({
			command: Type.String({ description: "Bash command to execute" }),
			timeout: Type.Optional(
				Type.Number({ description: "Timeout in seconds (optional)" }),
			),
		}),
		async execute(toolCallId, params, signal, onUpdate) {
			const danger = isDangerousBashCommand(params.command);
			if (danger) {
				throw new Error(danger);
			}
			return bashTool.execute(toolCallId, params, signal, onUpdate);
		},
	});
}
