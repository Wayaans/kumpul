import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { getMarkdownTheme } from "@earendil-works/pi-coding-agent";
import { Container, Markdown, Spacer, Text, visibleWidth } from "@earendil-works/pi-tui";
import type { AgentResult, ToolEvent } from "./types.ts";
import { displayAgentName, MAX_TOOLS_COLLAPSED } from "./types.ts";
import {
	formatContextUsage,
	formatDuration,
	formatTokens,
} from "./spawn.ts";

type Theme = ExtensionContext["ui"]["theme"];

function getTermWidth(): number {
	return process.stdout.columns || 120;
}

function truncLine(text: string, maxWidth: number): string {
	if (text.includes("\n") || text.includes("\r")) {
		text = text.replace(/\r?\n/g, "↵ ");
	}
	if (visibleWidth(text) <= maxWidth) return text;
	let result = "";
	let width = 0;
	for (let i = 0; i < text.length; i++) {
		const ch = text[i];
		if (ch === "\x1b") {
			const match = text.slice(i).match(/^\x1b\[[0-9;]*m/);
			if (match) {
				result += match[0];
				i += match[0].length - 1;
				continue;
			}
		}
		if (width >= maxWidth - 1) {
			return result + "…";
		}
		result += ch;
		width++;
	}
	return result;
}

export function toolsToShow(
	tools: ToolEvent[],
	expanded: boolean,
): { visible: ToolEvent[]; hidden: number } {
	if (expanded || tools.length <= MAX_TOOLS_COLLAPSED) {
		return { visible: tools, hidden: 0 };
	}
	return { visible: tools.slice(-MAX_TOOLS_COLLAPSED), hidden: tools.length - MAX_TOOLS_COLLAPSED };
}

export function renderAgentProgress(
	r: AgentResult,
	theme: Theme,
	expanded: boolean,
	w: number,
	depth: number = 0,
): Container {
	const c = new Container();
	const prog = r.progress;
	const isRunning = prog.status === "running";
	const isPending = prog.status === "pending";
	const nested = depth > 0;

	const indent = nested ? "  ".repeat(depth) : "";
	const innerW = Math.max(20, w - indent.length);

	const addLine = (content: string) => {
		if (expanded) {
			c.addChild(new Text(indent + content, 0, 0));
		} else {
			c.addChild(new Text(indent + truncLine(content, innerW), 0, 0));
		}
	};

	const icon = isRunning
		? theme.fg("warning", "⟳")
		: isPending
			? theme.fg("dim", "○")
			: r.exitCode === 0
				? theme.fg("success", "✓")
				: theme.fg("error", "✗");
	const stats = `${prog.toolCount} tools · ${formatDuration(prog.durationMs)}`;
	const modelStr = r.model ? theme.fg("dim", ` (${r.model})`) : "";
	addLine(
		`${icon} ${theme.fg("toolTitle", theme.bold(displayAgentName(r)))}${modelStr} — ${theme.fg("dim", stats)}`,
	);

	const renderToolRow = (
		toolName: string,
		args: string,
		children: AgentResult[] | undefined,
		isCurrent: boolean,
	) => {
		const body = args ? `${toolName}: ${args}` : toolName;
		if (isCurrent) {
			addLine(theme.fg("warning", `▸ ${body}`));
		} else {
			addLine(theme.fg("muted", `  ${body}`));
		}
		if (children && children.length > 0) {
			if (expanded) {
				for (const child of children) {
					c.addChild(renderAgentProgress(child, theme, expanded, w, depth + 1));
				}
			} else {
				const running = children.some((child) => child.progress.status === "running");
				addLine(
					theme.fg(
						"dim",
						`  ↳ ${children.length} nested subagent(s)${running ? " (running)" : ""} — ctrl+o`,
					),
				);
			}
		}
	};

	const { visible, hidden } = toolsToShow(prog.recentTools, expanded);
	for (const t of visible) {
		renderToolRow(t.tool, t.args, t.children, t.status === "running");
	}
	if (hidden > 0) {
		addLine(theme.fg("dim", `  … ${hidden} earlier tool call(s) (ctrl+o to show all)`));
	}

	if (prog.lastMessage) {
		if (!nested) c.addChild(new Spacer(1));
		addLine(theme.fg("text", prog.lastMessage));
	}

	if (!nested && !isRunning && r.output && expanded) {
		c.addChild(new Spacer(1));
		c.addChild(new Markdown(r.output, 0, 0, getMarkdownTheme()));
	}

	if (!nested) c.addChild(new Spacer(1));
	const usageParts: string[] = [];
	if (r.usage.input) usageParts.push(theme.fg("dim", `↑${formatTokens(r.usage.input)}`));
	if (r.usage.output) usageParts.push(theme.fg("dim", `↓${formatTokens(r.usage.output)}`));
	if (r.usage.cacheRead) usageParts.push(theme.fg("dim", `R${formatTokens(r.usage.cacheRead)}`));
	if (r.usage.cacheWrite) usageParts.push(theme.fg("dim", `W${formatTokens(r.usage.cacheWrite)}`));
	if (r.usage.cost) usageParts.push(theme.fg("dim", `$${r.usage.cost.toFixed(3)}`));
	if (prog.tokens > 0) {
		const ctxStr = formatContextUsage(prog.tokens, r.contextWindow);
		const pct = r.contextWindow ? (prog.tokens / r.contextWindow) * 100 : 0;
		const coloredCtx =
			pct > 90 ? theme.fg("error", ctxStr) : pct > 70 ? theme.fg("warning", ctxStr) : theme.fg("dim", ctxStr);
		usageParts.push(coloredCtx);
	}
	if (usageParts.length) {
		addLine(usageParts.join(" "));
	}

	if (prog.error) {
		addLine(theme.fg("error", `Error: ${prog.error}`));
	}

	return c;
}

export function renderSubagentCall(
	args: { agent?: string; alias?: string; task?: string; cwd?: string },
	theme: Theme,
	context: { expanded: boolean; lastComponent?: unknown },
) {
	const label = args.agent ? displayAgentName({ agent: args.agent, alias: args.alias }) : undefined;
	if (!context.expanded) {
		if (!label) {
			return new Text(theme.fg("toolTitle", theme.bold("subagent")), 0, 0);
		}
		const taskPreview = args.task
			? (args.task.length > 60 ? args.task.slice(0, 60) + "…" : args.task).replace(/\n/g, " ")
			: "";
		return new Text(
			`${theme.fg("toolTitle", theme.bold("subagent"))} ${theme.fg("accent", label)} ${theme.fg("dim", taskPreview)}`,
			0,
			0,
		);
	}

	const c =
		context.lastComponent instanceof Container
			? (context.lastComponent.clear(), context.lastComponent)
			: new Container();
	const agentLabel = label ? ` ${theme.fg("accent", label)}` : "";
	const cwdLabel = args.cwd ? theme.fg("dim", ` (cwd: ${args.cwd})`) : "";
	c.addChild(new Text(`${theme.fg("toolTitle", theme.bold("subagent"))}${agentLabel}${cwdLabel}`, 0, 0));
	if (args.task) {
		c.addChild(new Spacer(1));
		c.addChild(new Text(theme.fg("text", args.task), 0, 0));
	}
	return c;
}

export function renderSubagentResult(
	result: { content: Array<{ type: string; text?: string }>; details?: unknown },
	options: { expanded?: boolean },
	theme: Theme,
	context: { lastComponent?: unknown },
) {
	const details = result.details as { results?: AgentResult[] } | undefined;
	if (!details?.results?.length) {
		const t = result.content[0];
		const text = t?.type === "text" ? t.text : "(no output)";
		return new Text((text || "").slice(0, 200), 0, 0);
	}

	const w = getTermWidth() - 4;
	const c =
		context.lastComponent instanceof Container
			? (context.lastComponent.clear(), context.lastComponent)
			: new Container();
	c.addChild(renderAgentProgress(details.results[0], theme, !!options.expanded, w));
	return c;
}
