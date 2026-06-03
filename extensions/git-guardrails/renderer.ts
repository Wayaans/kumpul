import { Box, Container, Spacer, Text } from "@earendil-works/pi-tui";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Theme } from "@earendil-works/pi-coding-agent";
import type { GitGuardrailsStatusMessageDetails } from "./types.ts";

export const GIT_GUARDRAILS_STATUS_MESSAGE_TYPE = "kumpul-git-guardrails-status";

function createTextStack(lines: string[]): Container {
	const container = new Container();
	for (const line of lines) {
		container.addChild(new Text(line, 0, 0));
	}
	return container;
}

function wrapCustomMessageCard(content: Container | Text, theme: Theme): Box {
	const box = new Box(1, 1, (text) => theme.bg("customMessageBg", text));
	box.addChild(content);
	return box;
}

function createGitGuardrailsStatusComponent(details: GitGuardrailsStatusMessageDetails, theme: Theme) {
	const container = new Container();
	container.addChild(new Text(theme.fg("toolTitle", "/guardrails:git"), 0, 0));
	container.addChild(new Spacer(1));
	container.addChild(new Text(theme.fg("accent", "❯ STATE :"), 0, 0));
	container.addChild(new Text(details.enabled ? theme.fg("success", "enabled") : theme.fg("warning", "disabled"), 0, 0));
	container.addChild(new Spacer(1));
	container.addChild(new Text(theme.fg("accent", "❯ EFFECT :"), 0, 0));
	container.addChild(
		new Text(
			details.enabled ? "dangerous git bash commands are blocked" : "git bash commands are allowed to run normally",
			0,
			0,
		),
	);
	container.addChild(new Spacer(1));
	container.addChild(new Text(theme.fg("accent", "❯ PROJECT OVERRIDE :"), 0, 0));
	container.addChild(new Text(details.configPath, 0, 0));
	container.addChild(new Spacer(1));
	container.addChild(new Text(theme.fg("accent", "❯ RUNTIME :"), 0, 0));
	container.addChild(
		new Text(
			details.reloading ? "reloading now so the new state applies immediately" : "already using the current state",
			0,
			0,
		),
	);
	container.addChild(new Spacer(1));
	container.addChild(new Text(theme.fg("accent", "❯ HINT :"), 0, 0));
	container.addChild(new Text("use /guardrails:git enable|disable|status", 0, 0));
	return container;
}

export function buildGitGuardrailsStatusSummary(details: GitGuardrailsStatusMessageDetails): string {
	return [
		"/guardrails:git",
		`- state: ${details.enabled ? "enabled" : "disabled"}`,
		`- effect: ${details.enabled ? "dangerous git bash commands are blocked" : "git bash commands are allowed to run normally"}`,
		`- project override path: ${details.configPath}`,
		`- runtime: ${details.reloading ? "reloading now so the new state applies immediately" : "already using the current state"}`,
		"- hint: use /guardrails:git enable|disable|status",
	].join("\n");
}

export function createGitGuardrailsStatusMessage(details: GitGuardrailsStatusMessageDetails) {
	return {
		customType: GIT_GUARDRAILS_STATUS_MESSAGE_TYPE,
		content: buildGitGuardrailsStatusSummary(details),
		display: true,
		details,
	} as const;
}

export function registerGitGuardrailsMessageRenderer(pi: ExtensionAPI): void {
	pi.registerMessageRenderer(GIT_GUARDRAILS_STATUS_MESSAGE_TYPE, (message, _options, theme) => {
		const details = message.details as GitGuardrailsStatusMessageDetails | undefined;
		if (!details) {
			const fallback =
				typeof message.content === "string" ? message.content : theme.fg("muted", "No git guardrails status available.");
			return wrapCustomMessageCard(createTextStack([fallback]), theme);
		}
		return wrapCustomMessageCard(createGitGuardrailsStatusComponent(details, theme), theme);
	});
}
