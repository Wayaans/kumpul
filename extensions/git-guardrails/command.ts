import type { AutocompleteItem } from "@earendil-works/pi-tui";
import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { getProjectConfigPath, isGitGuardrailsEnabled, updateProjectGitGuardrailsEnabled } from "./config.ts";
import { createGitGuardrailsStatusMessage } from "./renderer.ts";
import type { GitGuardrailsCommandAction } from "./types.ts";

const ACTION_ALIASES: Record<string, GitGuardrailsCommandAction> = {
	toggle: "toggle",
	enable: "enable",
	on: "enable",
	disable: "disable",
	off: "disable",
	status: "status",
};

const COMPLETIONS: AutocompleteItem[] = [
	{ value: "toggle", label: "toggle" },
	{ value: "enable", label: "enable" },
	{ value: "disable", label: "disable" },
	{ value: "status", label: "status" },
];

function getArgumentCompletions(prefix: string): AutocompleteItem[] | null {
	const normalized = prefix.trim().toLowerCase();
	const filtered = COMPLETIONS.filter((item) => item.value.startsWith(normalized));
	return filtered.length > 0 ? filtered : null;
}

function parseAction(args: string): GitGuardrailsCommandAction | null {
	const normalized = args.trim().toLowerCase();
	if (!normalized) return "toggle";
	return ACTION_ALIASES[normalized] ?? null;
}

function notify(ctx: ExtensionCommandContext, message: string, level: "info" | "warning" | "error" = "info"): void {
	if (ctx.hasUI) {
		ctx.ui.notify(message, level);
		return;
	}

	if (level === "error") {
		console.error(message);
		return;
	}

	console.log(message);
}

export function registerGuardrailsGitCommand(pi: ExtensionAPI): void {
	pi.registerCommand("guardrails:git", {
		description: "Show or change git-guardrails command blocking state",
		getArgumentCompletions,
		handler: async (args, ctx) => {
			const action = parseAction(args);
			if (!action) {
				notify(ctx, "Usage: /guardrails:git [toggle|enable|disable|status]", "error");
				return;
			}

			const currentEnabled = isGitGuardrailsEnabled(ctx.cwd);
			const configPath = getProjectConfigPath(ctx.cwd);

			if (action === "status") {
				pi.sendMessage(
					createGitGuardrailsStatusMessage({
						enabled: currentEnabled,
						configPath,
						reloading: false,
					}),
				);
				return;
			}

			const nextEnabled = action === "toggle" ? !currentEnabled : action === "enable";
			const saved = updateProjectGitGuardrailsEnabled(ctx.cwd, nextEnabled);

			pi.sendMessage(
				createGitGuardrailsStatusMessage({
					enabled: nextEnabled,
					configPath: saved.path,
					reloading: true,
				}),
			);

			await ctx.reload();
		},
	});
}
