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

function wrapEditorLine(line: string, width: number, lineColor: (text: string) => string): string {
	if (width <= 2) return lineColor(lineFill(width));
	const innerWidth = width - 2;
	const clipped = truncateToWidth(line, innerWidth, "");
	const padding = " ".repeat(Math.max(0, innerWidth - visibleWidth(clipped)));
	return lineColor("│") + clipped + padding + lineColor("│");
}

function removeEditorHorizontalLines(lines: string[], width: number, lineColor: (text: string) => string): string[] {
	if (lines.length <= 2) return lines;
	const [, ...rest] = lines;
	const bottomIndex = rest.findIndex(isEditorHorizontalLine);
	const withoutBorders = bottomIndex < 0 ? rest : rest.filter((_, index) => index !== bottomIndex);
	return withoutBorders.map((line) => wrapEditorLine(line, width, lineColor));
}

function hideEditorHorizontalLines(editor: EditorComponent, lineColor: (text: string) => string): EditorComponent {
	const render = editor.render.bind(editor);
	editor.render = (width: number): string[] => removeEditorHorizontalLines(render(width), width, lineColor);
	return editor;
}

class BorderlessEditor extends CustomEditor {
	constructor(
		tui: TUI,
		theme: EditorTheme,
		keybindings: ConstructorParameters<typeof CustomEditor>[2],
		private readonly lineColor: (text: string) => string,
	) {
		super(tui, theme, keybindings);
	}

	override render(width: number): string[] {
		return removeEditorHorizontalLines(super.render(width), width, this.lineColor);
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
	const separator = theme.inverse(theme.fg("text", "│"));
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
		parts.push(theme.inverse(thinkingInfoColor(pi, theme)(` ${label} `)));
	}

	return parts.join("");
}

function lineFill(width: number): string {
	return "─".repeat(Math.max(0, width));
}

function thinkingLineColor(_pi: ExtensionAPI, theme: ExtensionContext["ui"]["theme"]): (text: string) => string {
	return theme.getThinkingBorderColor("off");
}

function thinkingInfoColor(pi: ExtensionAPI, theme: ExtensionContext["ui"]["theme"]): (text: string) => string {
	return theme.getThinkingBorderColor(pi.getThinkingLevel());
}

function renderTopLine(
	right: string,
	width: number,
	lineColor: (text: string) => string,
	textColor: (text: string) => string,
): string {
	if (width <= 0) return "";
	if (width <= 2) return lineColor(lineFill(width));
	const innerWidth = width - 2;
	const rightText = right ? ` ${right} ` : "";
	const rightWidth = visibleWidth(rightText);
	const fillWidth = Math.max(0, innerWidth - rightWidth);
	return lineColor("╭" + lineFill(fillWidth)) + textColor(truncateToWidth(rightText, innerWidth - fillWidth, "")) + lineColor("╮");
}

function renderBoxSpacer(width: number, lineColor: (text: string) => string): string {
	if (width <= 0) return "";
	if (width <= 2) return lineColor(lineFill(width));
	return lineColor("│") + " ".repeat(width - 2) + lineColor("│");
}

function renderBottomLine(
	left: string,
	width: number,
	lineColor: (text: string) => string,
	textColor: (text: string) => string,
): string {
	if (width <= 0) return "";
	if (width <= 2) return lineColor(lineFill(width));
	const innerWidth = width - 2;
	const leftText = left ? ` ${left} ` : "";
	const clippedLeft = truncateToWidth(leftText, innerWidth, "");
	const fillWidth = Math.max(0, innerWidth - visibleWidth(clippedLeft));
	return lineColor("╰") + textColor(clippedLeft) + lineColor(lineFill(fillWidth) + "╯");
}

function makeLine(renderText: (width: number) => string): Component {
	return {
		invalidate() {},
		render(width: number): string[] {
			return [renderText(width)];
		},
	};
}

function installEditor(ctx: ExtensionContext, pi: ExtensionAPI): void {
	setTimeout(() => {
		const currentFactory = ctx.ui.getEditorComponent();
		ctx.ui.setEditorComponent((tui: TUI, theme: EditorTheme, keybindings) => {
			const lineColor = thinkingLineColor(pi, ctx.ui.theme);
			if (currentFactory) return hideEditorHorizontalLines(currentFactory(tui, theme, keybindings), lineColor);
			return new BorderlessEditor(tui, theme, keybindings, lineColor);
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
					const lineColor = thinkingLineColor(pi, theme);
					return [
						renderTopLine(getTokenStatsLine(ctx, theme), width, lineColor, (text) => text),
						renderBoxSpacer(width, lineColor),
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
				const lineColor = thinkingLineColor(pi, theme);
				return [
					renderBoxSpacer(width, lineColor),
					renderBottomLine(getModelLine(ctx, pi, theme), width, lineColor, (text) => text),
				];
			},
		}),
		{ placement: "belowEditor" },
	);
}

export default function (pi: ExtensionAPI): void {
	pi.on("session_start", async (_event, ctx) => {
		if (!ctx.hasUI) return;
		installEditor(ctx, pi);
		installWidgets(ctx, pi);
	});

	pi.on("turn_end", async () => requestRender?.());
	pi.on("model_select", async () => requestRender?.());
	pi.on("thinking_level_select", async () => requestRender?.());
}
