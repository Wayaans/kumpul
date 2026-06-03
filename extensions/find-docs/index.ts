import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { Type } from "@earendil-works/pi-ai";
import { Text } from "@earendil-works/pi-tui";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import {
	DEFAULT_MAX_BYTES,
	DEFAULT_MAX_LINES,
	defineTool,
	formatSize,
	truncateHead,
	withFileMutationQueue,
} from "@earendil-works/pi-coding-agent";

const DEFAULT_CTX7_TIMEOUT_MS = 60_000;

const FindDocsParams = Type.Object({
	query: Type.String({ description: "Documentation question or search query" }),
	library: Type.Optional(Type.String({ description: "Library/framework/package name, e.g. react, nextjs, prisma" })),
	libraryId: Type.Optional(Type.String({ description: "Optional Context7 library ID like /facebook/react" })),
});

type FindDocsToolParams = {
	query: string;
	library?: string;
	libraryId?: string;
};

import {
	extractContext7LibraryId,
	formatFindDocsSummary,
	formatFindDocsTarget,
	isCtx7Bash,
	mergePrioritizedActiveTools,
	type FindDocsDetails,
} from "./utils.ts";

function renderTextResult(result: { content: Array<{ type: string; text?: string }> }) {
	const text = result.content.find((content) => content.type === "text");
	return new Text(text?.type === "text" ? (text.text ?? "") : "", 0, 0);
}

async function makeTextToolResult(text: string, details: Record<string, unknown>) {
	const truncation = truncateHead(text, {
		maxLines: DEFAULT_MAX_LINES,
		maxBytes: DEFAULT_MAX_BYTES,
	});

	const resultDetails: Record<string, unknown> = { ...details };
	let resultText = truncation.content;

	if (truncation.truncated) {
		const tempDir = await mkdtemp(path.join(tmpdir(), "find-docs-"));
		const tempFile = path.join(tempDir, "output.txt");
		await withFileMutationQueue(tempFile, async () => {
			await writeFile(tempFile, text, "utf8");
		});
		resultDetails.truncation = truncation;
		resultDetails.fullOutputPath = tempFile;
		resultText += `\n\n[Output truncated to ${truncation.outputLines} of ${truncation.totalLines} lines (${formatSize(truncation.outputBytes)} of ${formatSize(truncation.totalBytes)}). Full output saved to: ${tempFile}]`;
	}

	return {
		content: [{ type: "text" as const, text: resultText || "No output" }],
		details: resultDetails,
	};
}

async function runCtx7(pi: ExtensionAPI, args: string[], signal?: AbortSignal): Promise<string> {
	try {
		const direct = await pi.exec("ctx7", args, { signal, timeout: DEFAULT_CTX7_TIMEOUT_MS });
		if (direct.code === 0 && direct.stdout.trim()) {
			return direct.stdout.trim();
		}
	} catch {
		// Fall through to npx ctx7@latest.
	}

	const fallback = await pi.exec("npx", ["-y", "ctx7@latest", ...args], {
		signal,
		timeout: DEFAULT_CTX7_TIMEOUT_MS * 2,
	});
	const output = [fallback.stdout, fallback.stderr].filter(Boolean).join("\n").trim();
	if (fallback.code !== 0) {
		if (/quota|monthly quota reached|quota exceeded/i.test(output)) {
			throw new Error(`Context7 quota exhausted. Run ctx7 login for higher limits.\n\n${output}`);
		}
		throw new Error(output || "ctx7 command failed");
	}
	return output;
}

function sameToolList(left: readonly string[], right: readonly string[]): boolean {
	return left.length === right.length && left.every((name, index) => right[index] === name);
}

const findDocsTool = (pi: ExtensionAPI) =>
	defineTool({
		name: "find_docs",
		label: "find_docs",
		description:
			"Find current documentation for a framework or library using Context7 (ctx7). Resolves the library ID first, then fetches relevant docs.",
		parameters: FindDocsParams,

		async execute(_toolCallId, params, signal) {
			const input = params as FindDocsToolParams;
			const libraryId = input.libraryId?.trim();
			let resolvedLibraryId = libraryId && libraryId.startsWith("/") ? libraryId : undefined;
			let libraryOutput = "";

			if (!resolvedLibraryId) {
				if (!input.library) {
					throw new Error("find_docs requires either library or libraryId");
				}
				libraryOutput = await runCtx7(pi, ["library", input.library, input.query], signal);
				resolvedLibraryId = extractContext7LibraryId(libraryOutput);
				if (!resolvedLibraryId) {
					return makeTextToolResult(libraryOutput || "No matching Context7 library found", {
						library: input.library,
						query: input.query,
						resolved: false,
					});
				}
			}

			const docsOutput = await runCtx7(pi, ["docs", resolvedLibraryId, input.query], signal);
			const text = libraryOutput
				? `Resolved library: ${resolvedLibraryId}\n\n${docsOutput}`
				: `Library: ${resolvedLibraryId}\n\n${docsOutput}`;

			return makeTextToolResult(text, {
				library: input.library,
				libraryId: resolvedLibraryId,
				query: input.query,
			});
		},

		renderCall(args, theme) {
			return new Text(
				`${theme.fg("toolTitle", theme.bold("find_docs"))} ${theme.fg("accent", formatFindDocsTarget(args))}`,
				0,
				0,
			);
		},

		renderResult(result, options, theme) {
			const details = result.details as FindDocsDetails | undefined;
			const summary = formatFindDocsSummary(details);
			if (!options.expanded) {
				return new Text(summary ? theme.fg("dim", `↳ ${summary}`) : "", 0, 0);
			}
			return renderTextResult(result);
		},
	});

export default function (pi: ExtensionAPI): void {
	pi.registerTool(findDocsTool(pi));

	const applyToolPriority = (ctx: ExtensionContext): void => {
		const activeTools = pi.getActiveTools();
		const merged = mergePrioritizedActiveTools({
			availableTools: pi.getAllTools().map((tool) => tool.name),
			activeTools,
		});

		if (!sameToolList(activeTools, merged)) {
			pi.setActiveTools(merged);
		}
	};

	pi.on("session_start", async (_event, ctx) => applyToolPriority(ctx));
	pi.on("session_tree", async (_event, ctx) => applyToolPriority(ctx));

	pi.on("before_agent_start", async (event, ctx) => {
		applyToolPriority(ctx);

		const activeTools = new Set(pi.getActiveTools());
		if (!activeTools.has("find_docs")) {
			return;
		}

		const guidanceSection = [
			"## find_docs Tool Preference",
			"Prefer find_docs for current framework and library docs via Context7.",
			"Use bash only when find_docs cannot accomplish the task.",
		].join("\n");

		const baseSystemPrompt = typeof event.systemPrompt === "string" ? event.systemPrompt : "";
		return {
			systemPrompt: baseSystemPrompt ? `${baseSystemPrompt}\n\n${guidanceSection}` : guidanceSection,
		};
	});

	pi.on("tool_call", async (event) => {
		if (event.toolName !== "bash") return;
		const command = String(event.input.command ?? "").trim();
		if (!isCtx7Bash(command)) return;

		const availableTools = new Set(pi.getAllTools().map((tool) => tool.name));
		if (!availableTools.has("find_docs")) return;

		return {
			block: true,
			reason: "Use the find_docs tool instead of bash for Context7 documentation lookups.",
		};
	});
}
