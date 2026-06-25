import type { AssistantMessage } from "@earendil-works/pi-ai";
import type { Component, EditorComponent, EditorTheme, TUI } from "@earendil-works/pi-tui";
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import { CustomEditor, type ExtensionAPI, type ExtensionContext } from "@earendil-works/pi-coding-agent";

let requestRender: (() => void) | undefined;

function stripAnsi(text: string): string {
	return text.replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, "").replace(/\x1b\][^\x07]*(?:\x07|\x1b\\)/g, "");
}

function isEditorHorizontalLine(line: string): boolean {
	const plain = stripAnsi(line).trim();
	return plain.length > 0 && /^[─ ↑↓0-9more]+$/.test(plain) && plain.includes("─");
}

function removeEditorHorizontalLines(lines: string[]): string[] {
	if (lines.length <= 2) return lines;
	const [, ...rest] = lines;
	const bottomIndex = rest.findIndex(isEditorHorizontalLine);
	if (bottomIndex < 0) return rest;
	return rest.filter((_, index) => index !== bottomIndex);
}

function hideEditorHorizontalLines(editor: EditorComponent): EditorComponent {
	const render = editor.render.bind(editor);
	editor.render = (width: number): string[] => removeEditorHorizontalLines(render(width));
	return editor;
}

class BorderlessEditor extends CustomEditor {
	override render(width: number): string[] {
		return removeEditorHorizontalLines(super.render(width));
	}
}

function formatTokens(count: number): string {
	if (count < 1_000) return `${count}`;
	if (count < 1_000_000) return `${Math.round(count / 100) / 10}k`;
	return `${Math.round(count / 100_000) / 10}M`;
}

function getTokenStats(ctx: ExtensionContext): { stats: string[]; context: string } {
	let totalInput = 0;
	let totalOutput = 0;
	let totalCacheRead = 0;
	let totalCacheWrite = 0;
	let totalCost = 0;
	let latestCacheHitRate: number | undefined;

	for (const entry of ctx.sessionManager.getEntries()) {
		if (entry.type !== "message" || entry.message.role !== "assistant") continue;
		const message = entry.message as AssistantMessage;
		totalInput += message.usage.input;
		totalOutput += message.usage.output;
		totalCacheRead += message.usage.cacheRead;
		totalCacheWrite += message.usage.cacheWrite;
		totalCost += message.usage.cost.total;

		const latestPromptTokens = message.usage.input + message.usage.cacheRead + message.usage.cacheWrite;
		latestCacheHitRate = latestPromptTokens > 0 ? (message.usage.cacheRead / latestPromptTokens) * 100 : undefined;
	}

	const stats: string[] = [];
	if (totalInput) stats.push(`↑${formatTokens(totalInput)}`);
	if (totalOutput) stats.push(`↓${formatTokens(totalOutput)}`);
	if (totalCacheRead) stats.push(`R${formatTokens(totalCacheRead)}`);
	if (totalCacheWrite) stats.push(`W${formatTokens(totalCacheWrite)}`);
	if ((totalCacheRead > 0 || totalCacheWrite > 0) && latestCacheHitRate !== undefined) {
		stats.push(`CH${latestCacheHitRate.toFixed(1)}%`);
	}

	const usingSubscription = ctx.model ? ctx.modelRegistry.isUsingOAuth(ctx.model) : false;
	if (totalCost || usingSubscription) {
		stats.push(`$${totalCost.toFixed(3)}${usingSubscription ? " (sub)" : ""}`);
	}

	const usage = ctx.getContextUsage();
	const contextWindow = usage?.contextWindow ?? ctx.model?.contextWindow ?? 0;
	const contextPercent = usage?.percent === null || usage?.percent === undefined ? "?" : usage.percent.toFixed(1);

	return { stats, context: `${contextPercent}%/${formatTokens(contextWindow)}` };
}

function getTokenStatsLine(ctx: ExtensionContext, theme: ExtensionContext["ui"]["theme"]): string {
	const { stats, context } = getTokenStats(ctx);
	const statBlocks = stats.map((stat) => theme.inverse(theme.fg("text", ` ${stat.toUpperCase()} `)));
	const contextBlock = theme.inverse(theme.bold(theme.fg("accent", ` ${context.toUpperCase()} `)));
	const separator = theme.inverse(theme.fg("text", "╎"));
	return [...statBlocks, contextBlock].join(separator);
}

function getModelLine(ctx: ExtensionContext, pi: ExtensionAPI, theme: ExtensionContext["ui"]["theme"]): string {
	const model = ctx.model;
	if (!model) return theme.bg("selectedBg", theme.fg("muted", " NO-MODEL "));

	const provider = theme.inverse(theme.fg("text", ` ${model.provider.toUpperCase()} `));
	const modelId = theme.inverse(theme.bold(theme.fg("accent", ` ${model.id.toUpperCase()} `)));
	const parts = [provider, modelId];

	if (model.reasoning) {
		const level = pi.getThinkingLevel();
		const label = level === "off" ? "THINKING OFF" : level.toUpperCase();
		parts.push(theme.inverse(thinkingLineColor(pi, theme)(` ${label} `)));
	}

	return parts.join("");
}

function lineFill(width: number): string {
	return "─".repeat(Math.max(0, width));
}

function thinkingLineColor(pi: ExtensionAPI, theme: ExtensionContext["ui"]["theme"]): (text: string) => string {
	return theme.getThinkingBorderColor(pi.getThinkingLevel());
}

function renderTopLine(
	right: string,
	width: number,
	lineColor: (text: string) => string,
	textColor: (text: string) => string,
): string {
	if (width <= 0) return "";
	const rightText = right ? ` ${right} ` : "";
	const rightWidth = visibleWidth(rightText);
	const fillWidth = Math.max(0, width - rightWidth);
	return lineColor(lineFill(fillWidth)) + textColor(truncateToWidth(rightText, width - fillWidth, ""));
}

function renderBottomLine(
	left: string,
	width: number,
	lineColor: (text: string) => string,
	textColor: (text: string) => string,
): string {
	if (width <= 0) return "";
	const leftText = left ? ` ${left} ` : "";
	const clippedLeft = truncateToWidth(leftText, width, "");
	const fillWidth = Math.max(0, width - visibleWidth(clippedLeft));
	return textColor(clippedLeft) + lineColor(lineFill(fillWidth));
}

function makeLine(renderText: (width: number) => string): Component {
	return {
		invalidate() {},
		render(width: number): string[] {
			return [renderText(width)];
		},
	};
}

function installEditor(ctx: ExtensionContext): void {
	setTimeout(() => {
		const currentFactory = ctx.ui.getEditorComponent();
		ctx.ui.setEditorComponent((tui: TUI, theme: EditorTheme, keybindings) => {
			if (currentFactory) return hideEditorHorizontalLines(currentFactory(tui, theme, keybindings));
			return new BorderlessEditor(tui, theme, keybindings);
		});
	}, 0);
}

function installWidgets(ctx: ExtensionContext, pi: ExtensionAPI): void {
	ctx.ui.setWidget(
		"editor-bars-top",
		(tui, theme) => {
			requestRender = () => tui.requestRender();
			return {
				invalidate() {},
				render(width: number): string[] {
					return [
						renderTopLine(getTokenStatsLine(ctx, theme), width, thinkingLineColor(pi, theme), (text) => text),
						" ".repeat(Math.max(0, width)),
					];
				},
			};
		},
		{ placement: "aboveEditor" },
	);

	ctx.ui.setWidget(
		"editor-bars-bottom",
		(_tui, theme) => ({
			invalidate() {},
			render(width: number): string[] {
				return [
					" ".repeat(Math.max(0, width)),
					renderBottomLine(getModelLine(ctx, pi, theme), width, thinkingLineColor(pi, theme), (text) => text),
				];
			},
		}),
		{ placement: "belowEditor" },
	);
}

export default function (pi: ExtensionAPI): void {
	pi.on("session_start", async (_event, ctx) => {
		if (!ctx.hasUI) return;
		installEditor(ctx);
		installWidgets(ctx, pi);
	});

	pi.on("turn_end", async () => requestRender?.());
	pi.on("model_select", async () => requestRender?.());
	pi.on("thinking_level_select", async () => requestRender?.());
}
