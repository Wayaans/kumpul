import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { isToolCallEventType } from "@earendil-works/pi-coding-agent";
import { registerGuardrailsGitCommand } from "./command.ts";
import { isGitGuardrailsEnabled } from "./config.ts";
import { findDangerousGitPattern } from "./patterns.ts";
import { registerGitGuardrailsMessageRenderer } from "./renderer.ts";

export default function (pi: ExtensionAPI, context?: ExtensionContext): void {
	const cwd = context?.cwd ?? process.cwd();

	if (isGitGuardrailsEnabled(cwd)) {
		pi.on("tool_call", async (event) => {
			if (!isToolCallEventType("bash", event)) {
				return;
			}

			const match = findDangerousGitPattern(event.input.command);
			if (!match) {
				return;
			}

			return {
				block: true,
				reason: `git-guardrails blocked ${match.label}. Use /guardrails:git to disable the extension if this operation is intentional.`,
			};
		});
	}

	registerGitGuardrailsMessageRenderer(pi);
	registerGuardrailsGitCommand(pi);
}
