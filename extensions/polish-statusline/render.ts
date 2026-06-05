import type { AssistantMessage } from "@earendil-works/pi-ai";
import type { ExtensionContext, ReadonlyFooterDataProvider } from "@earendil-works/pi-coding-agent";
import { buildSessionContext, type Theme, type ThemeColor } from "@earendil-works/pi-coding-agent";
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import { isAbsolute, relative, resolve, sep as pathSep } from "node:path";

export type FooterVariant = "codex" | "compact" | "minimal";

const BAR_WIDTH = 10;
const SEP = " │ ";
/** Status key from extensions/codex-usage — rendered on the model line, not the extension-status row. */
const CODEX_USAGE_STATUS_KEY = "codex-usage";

function formatCwd(cwd: string, home: string | undefined): string {
	if (!home) return cwd;
	const resolvedCwd = resolve(cwd);
	const resolvedHome = resolve(home);
	const relativeToHome = relative(resolvedHome, resolvedCwd);
	const isInsideHome =
		relativeToHome === "" ||
		(relativeToHome !== ".." &&
			!relativeToHome.startsWith(`..${pathSep}`) &&
			!isAbsolute(relativeToHome));
	if (!isInsideHome) return cwd;
	return relativeToHome === "" ? "~" : `~${pathSep}${relativeToHome}`;
}

function formatTokens(count: number): string {
	if (count < 1000) return count.toString();
	if (count < 10000) return `${(count / 1000).toFixed(1)}k`;
	if (count < 1000000) return `${Math.round(count / 1000)}k`;
	if (count < 10000000) return `${(count / 1000000).toFixed(1)}M`;
	return `${Math.round(count / 1000000)}M`;
}

function sanitizeStatus(text: string): string {
	return text.replace(/[\r\n\t]/g, " ").replace(/ +/g, " ").trim();
}

function styledPath(cwd: string, theme: Theme): string {
	const home = process.env.HOME || process.env.USERPROFILE;
	const short = formatCwd(cwd, home);
	const slash = Math.max(short.lastIndexOf("/"), short.lastIndexOf(pathSep));
	if (slash < 0) return theme.fg("text", short);
	return theme.fg("dim", short.slice(0, slash + 1)) + theme.fg("text", short.slice(slash + 1));
}

function contextBar(percent: number | null, theme: Theme): string {
	const filled =
		percent !== null ? Math.min(BAR_WIDTH, Math.max(0, Math.round((percent / 100) * BAR_WIDTH))) : 0;
	const color =
		percent === null ? "dim" : percent > 90 ? "error" : percent > 70 ? "warning" : "success";
	let bar = "";
	for (let i = 0; i < BAR_WIDTH; i++) {
		bar += i < filled ? "█" : "░";
	}
	const pctLabel = percent !== null ? `${percent.toFixed(0)}%` : "?%";
	return theme.fg(color, bar) + theme.fg("dim", ` ${pctLabel}`);
}

function divider(theme: Theme): string {
	return theme.fg("borderMuted", SEP);
}

function align(left: string, right: string, width: number, ellipsis: string): string {
	const lw = visibleWidth(left);
	const rw = visibleWidth(right);
	const minPad = 2;
	if (lw + minPad + rw <= width) {
		return left + " ".repeat(width - lw - rw) + right;
	}
	const avail = Math.max(0, width - lw - minPad);
	if (avail <= 0) return truncateToWidth(left, width, ellipsis);
	const truncated = truncateToWidth(right, avail, "");
	return left + " ".repeat(Math.max(0, width - lw - visibleWidth(truncated))) + truncated;
}

const THINKING_COLORS: Record<string, ThemeColor> = {
	off: "thinkingOff",
	minimal: "thinkingMinimal",
	low: "thinkingLow",
	medium: "thinkingMedium",
	high: "thinkingHigh",
	xhigh: "thinkingXhigh",
};

function collectUsage(ctx: ExtensionContext): {
	input: number;
	output: number;
	cacheRead: number;
	cacheWrite: number;
	cost: number;
} {
	let input = 0;
	let output = 0;
	let cacheRead = 0;
	let cacheWrite = 0;
	let cost = 0;
	for (const entry of ctx.sessionManager.getEntries()) {
		if (entry.type === "message" && entry.message.role === "assistant") {
			const m = entry.message as AssistantMessage;
			input += m.usage.input;
			output += m.usage.output;
			cacheRead += m.usage.cacheRead;
			cacheWrite += m.usage.cacheWrite;
			cost += m.usage.cost.total;
		}
	}
	return { input, output, cacheRead, cacheWrite, cost };
}

function tokenSegment(
	usage: ReturnType<typeof collectUsage>,
	ctx: ExtensionContext,
	theme: Theme,
): string {
	const parts: string[] = [];
	if (usage.input) parts.push(`↑${formatTokens(usage.input)}`);
	if (usage.output) parts.push(`↓${formatTokens(usage.output)}`);
	if (usage.cacheRead) parts.push(`R${formatTokens(usage.cacheRead)}`);
	if (usage.cacheWrite) parts.push(`W${formatTokens(usage.cacheWrite)}`);
	const sub =
		ctx.model && ctx.modelRegistry.isUsingOAuth(ctx.model) ? " (sub)" : "";
	if (usage.cost || sub) parts.push(`$${usage.cost.toFixed(3)}${sub}`);
	return theme.fg("dim", parts.join(" "));
}

function codexUsageSegment(footerData: ReadonlyFooterDataProvider, theme: Theme): string | undefined {
	const text = footerData.getExtensionStatuses().get(CODEX_USAGE_STATUS_KEY);
	if (!text) return undefined;
	return theme.fg("dim", sanitizeStatus(text));
}

function modelSegment(ctx: ExtensionContext, theme: Theme, footerData: ReadonlyFooterDataProvider): string {
	const modelId = ctx.model?.id ?? "no-model";
	let label = theme.fg("accent", modelId);
	const session = buildSessionContext(
		ctx.sessionManager.getEntries(),
		ctx.sessionManager.getLeafId(),
	);
	if (ctx.model?.reasoning) {
		const level = session.thinkingLevel || "off";
		const color = THINKING_COLORS[level] ?? "thinkingMedium";
		const thinkingLabel = level === "off" ? "think off" : level;
		label += theme.fg("muted", " · ") + theme.fg(color, thinkingLabel);
	}
	if (footerData.getAvailableProviderCount() > 1 && ctx.model) {
		label = theme.fg("muted", `(${ctx.model.provider}) `) + label;
	}
	const usage = codexUsageSegment(footerData, theme);
	if (usage) {
		label = usage + divider(theme) + label;
	}
	return label;
}

function contextSegment(ctx: ExtensionContext, theme: Theme): string {
	const usage = ctx.getContextUsage();
	const percent = usage?.percent ?? null;
	const window = usage?.contextWindow ?? ctx.model?.contextWindow ?? 0;
	const bar = contextBar(percent, theme);
	const windowLabel = theme.fg("dim", `/${formatTokens(window)}`);
	return bar + windowLabel;
}

function pathLine(ctx: ExtensionContext, theme: Theme, footerData: ReadonlyFooterDataProvider): string {
	const parts: string[] = [styledPath(ctx.sessionManager.getCwd(), theme)];
	const branch = footerData.getGitBranch();
	if (branch) {
		const branchColor = branch === "detached" ? "warning" : "accent";
		parts.push(theme.fg(branchColor, `⎇ ${branch}`));
	}
	const name = ctx.sessionManager.getSessionName();
	if (name) parts.push(theme.fg("muted", name));
	return parts.join(divider(theme));
}

function extensionStatusLine(
	footerData: ReadonlyFooterDataProvider,
	theme: Theme,
	width: number,
): string | undefined {
	const statuses = footerData.getExtensionStatuses();
	if (statuses.size === 0) return undefined;
	const sorted = Array.from(statuses.entries())
		.filter(([key]) => key !== CODEX_USAGE_STATUS_KEY)
		.sort(([a], [b]) => a.localeCompare(b))
		.map(([, text]) => sanitizeStatus(text));
	return truncateToWidth(theme.fg("dim", sorted.join(divider(theme))), width, theme.fg("dim", "..."));
}

export function renderPolishedFooter(
	ctx: ExtensionContext,
	theme: Theme,
	footerData: ReadonlyFooterDataProvider,
	variant: FooterVariant,
	width: number,
): string[] {
	const usage = collectUsage(ctx);
	const tokens = tokenSegment(usage, ctx, theme);
	const context = contextSegment(ctx, theme);
	const model = modelSegment(ctx, theme, footerData);
	const extLine = extensionStatusLine(footerData, theme, width);

	const ellipsis = theme.fg("dim", "...");

	if (variant === "minimal") {
		const row = align(context, model, width, ellipsis);
		return extLine ? [row, extLine] : [row];
	}

	if (variant === "compact") {
		const left = [tokens, context].filter(Boolean).join(divider(theme));
		const path = styledPath(ctx.sessionManager.getCwd(), theme);
		const mid = path + divider(theme) + left;
		const row = align(mid, model, width, ellipsis);
		return extLine ? [row, extLine] : [row];
	}

	// codex (default): path row + stats row
	const pathRow = truncateToWidth(pathLine(ctx, theme, footerData), width, ellipsis);
	const statsLeft = [tokens, context].filter(Boolean).join(divider(theme));
	const statsRow = align(statsLeft, model, width, ellipsis);
	const lines = [pathRow, statsRow];
	if (extLine) lines.push(extLine);
	return lines;
}
