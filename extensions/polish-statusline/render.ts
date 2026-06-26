import type { AssistantMessage } from "@earendil-works/pi-ai";
import type { ExtensionContext, ReadonlyFooterDataProvider } from "@earendil-works/pi-coding-agent";
import { buildSessionContext, type Theme, type ThemeColor } from "@earendil-works/pi-coding-agent";
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import { isAbsolute, relative, resolve, sep as pathSep } from "node:path";
import { isGitInstalled, readGitRepoStatus } from "./git-status.ts";

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

function gitSegment(
	cwd: string,
	footerData: ReadonlyFooterDataProvider,
	theme: Theme,
): string | undefined {
	if (!isGitInstalled()) return undefined;

	const branch = footerData.getGitBranch();
	if (!branch) return undefined;

	const branchColor = branch === "detached" ? "warning" : "accent";
	const markers: string[] = [];
	const status = readGitRepoStatus(cwd);
	if (status) {
		if (status.unstaged) markers.push(theme.fg("warning", "*"));
		if (status.staged) markers.push(theme.fg("success", "+"));
		if (status.ahead) markers.push(theme.fg("dim", `⇡${status.ahead}`));
		if (status.behind) markers.push(theme.fg("dim", `⇣${status.behind}`));
	}

	const suffix = markers.length ? ` ${markers.join("")}` : "";
	return theme.fg(branchColor, `⎇ ${branch}`) + suffix;
}

function locationSegment(ctx: ExtensionContext, theme: Theme, footerData: ReadonlyFooterDataProvider): string {
	const parts: string[] = [styledPath(ctx.sessionManager.getCwd(), theme)];
	const git = gitSegment(ctx.sessionManager.getCwd(), footerData, theme);
	if (git) parts.push(git);
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
		.sort(([a], [b]) => a.localeCompare(b))
		.map(([, text]) => sanitizeStatus(text));
	return truncateToWidth(theme.fg("dim", sorted.join(divider(theme))), width, theme.fg("dim", "..."));
}

export function renderPolishedFooter(
	ctx: ExtensionContext,
	theme: Theme,
	footerData: ReadonlyFooterDataProvider,
	width: number,
): string[] {
	const ellipsis = theme.fg("dim", "...");
	const statuses = extensionStatusLine(footerData, theme, width);
	const location = locationSegment(ctx, theme, footerData);
	const right = [statuses, location].filter(Boolean).join(divider(theme));
	return [align("", right, width, ellipsis)];
}
