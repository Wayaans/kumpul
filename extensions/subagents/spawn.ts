import { spawn } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
	DEFAULT_MAX_BYTES,
	DEFAULT_MAX_LINES,
	truncateHead,
	withFileMutationQueue,
} from "@earendil-works/pi-coding-agent";
import type { AgentConfig, AgentProgress, AgentResult } from "./types.ts";
import { displayAgentName } from "./types.ts";
import { MAX_TOOLS_COLLAPSED } from "./types.ts";
import {
	parseCursorThinkingActivity,
	previewFromThinkingDelta,
} from "./cursor-progress.ts";
import {
	BUILTIN_TOOLS,
	resolveCursorProviderExtension,
	resolveCustomToolExtension,
	resolveNamedExtensions,
	resolveNamedSkills,
	type ExtensionNamePaths,
	type SkillPaths,
	type ToolExtensionPaths,
} from "./resolve-tools.ts";
import type { ToolEvent } from "./types.ts";

export const MAX_SUBAGENT_DEPTH = 2;

/** Parent TUI heartbeat while a child pi subagent runs (avoid <1s full re-renders — flicker). */
const SUBAGENT_PROGRESS_HEARTBEAT_MS = 1000;
/** After JSON `agent_end`, give provider/session cleanup a brief chance to exit naturally. */
const SUBAGENT_AGENT_END_GRACE_MS = 100;

export function resolvePiBinary(): { command: string; baseArgs: string[] } {
	const entry = process.argv[1];
	if (entry) {
		try {
			const realEntry = fs.realpathSync(entry);
			if (/\.(?:mjs|cjs|js)$/i.test(realEntry)) {
				return { command: process.execPath, baseArgs: [realEntry] };
			}
		} catch {}
	}
	return { command: "pi", baseArgs: [] };
}

export function formatTokens(n: number): string {
	return n < 1000 ? String(n) : n < 10000 ? `${(n / 1000).toFixed(1)}k` : `${Math.round(n / 1000)}k`;
}

export function formatDuration(ms: number): string {
	if (ms < 1000) return `${ms}ms`;
	if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
	return `${Math.floor(ms / 60000)}m${Math.floor((ms % 60000) / 1000)}s`;
}

export function formatContextUsage(tokens: number, contextWindow: number | undefined): string {
	if (!contextWindow) return `${formatTokens(tokens)} ctx`;
	const pct = (tokens / contextWindow) * 100;
	const maxStr =
		contextWindow >= 1_000_000
			? `${(contextWindow / 1_000_000).toFixed(1)}M`
			: `${Math.round(contextWindow / 1000)}k`;
	return `${pct.toFixed(1)}%/${maxStr}`;
}

function extractTextFromContent(content: unknown): string {
	if (!content) return "";
	if (typeof content === "string") return content;
	if (Array.isArray(content)) {
		return content
			.filter((c: { type?: string }) => c.type === "text")
			.map((c: { text?: string }) => c.text)
			.join("\n");
	}
	return "";
}

function flatten(s: string): string {
	return s.replace(/\s+/g, " ").trim();
}

const MAX_ARG_PREVIEW = 4000;

export function extractToolArgsPreview(args: Record<string, unknown>): string {
	const cap = (s: string) => (s.length > MAX_ARG_PREVIEW ? s.slice(0, MAX_ARG_PREVIEW) + "…" : s);
	if (args.command) return cap(flatten(String(args.command)));
	if (args.path) return cap(flatten(String(args.path)));
	if (args.query) return `"${cap(flatten(String(args.query)))}"`;
	if (args.url) return cap(flatten(String(args.url)));
	if (args.pattern) return cap(flatten(String(args.pattern)));
	if (args.alias) return flatten(String(args.alias));
	if (args.agent) return flatten(String(args.agent));
	if (Array.isArray(args.tasks)) {
		const names = (args.tasks as Array<{ agent?: string; alias?: string }>)
			.map((t) => t?.alias ?? t?.agent ?? "?")
			.join(", ");
		return `parallel(${names})`;
	}
	return cap(flatten(JSON.stringify(args)));
}

export function getCurrentSubagentDepth(): number {
	const raw = process.env.PI_SUBAGENT_DEPTH;
	if (!raw) return 0;
	const depth = Number.parseInt(raw, 10);
	return Number.isFinite(depth) && depth >= 0 ? depth : 0;
}

function buildChildEnv(agent: AgentConfig): NodeJS.ProcessEnv {
	const env: NodeJS.ProcessEnv = {
		...process.env,
		PI_SUBAGENT_DEPTH: String(getCurrentSubagentDepth() + 1),
	};
	if (agent.tools.includes("subagent")) {
		if (!agent.subagentAgents || agent.subagentAgents.length === 0) {
			throw new Error(`Agent ${agent.name} uses subagent without bounded subagent_agents`);
		}
		env.PI_SUBAGENT_ALLOWED = agent.subagentAgents.join(",");
	}
	return env;
}

export async function buildPiArgs(
	agent: AgentConfig,
	task: string,
	toolExtensionPaths: ToolExtensionPaths = new Map(),
	skillPaths: SkillPaths = new Map(),
	cwd: string = process.cwd(),
	extensionNamePaths: ExtensionNamePaths = new Map(),
): Promise<{ args: string[]; tempDir: string; childEnv: NodeJS.ProcessEnv }> {
	const depth = getCurrentSubagentDepth();
	if (depth >= MAX_SUBAGENT_DEPTH) {
		throw new Error(`Subagent depth ${depth} exceeds maximum ${MAX_SUBAGENT_DEPTH}`);
	}
	if (agent.tools.includes("subagent") && (!agent.subagentAgents || agent.subagentAgents.length === 0)) {
		throw new Error(`Agent ${agent.name} uses subagent without bounded subagent_agents`);
	}
	const allowlist: string[] = [];
	const extensionPaths = new Set<string>();
	const unresolvedTools: string[] = [];

	for (const tool of agent.tools) {
		if (BUILTIN_TOOLS.has(tool)) {
			allowlist.push(tool);
		} else {
			const extPath = resolveCustomToolExtension(tool, toolExtensionPaths);
			if (extPath) {
				allowlist.push(tool);
				extensionPaths.add(extPath);
			} else {
				unresolvedTools.push(tool);
			}
		}
	}
	if (unresolvedTools.length > 0) {
		throw new Error(`Unable to resolve tools for agent ${agent.name}: ${unresolvedTools.join(", ")}`);
	}

	const extensionAllowlist = resolveNamedExtensions(agent.extensions, extensionNamePaths, cwd);
	if (extensionAllowlist.unresolved.length > 0) {
		throw new Error(`Unable to resolve extensions for agent ${agent.name}: ${extensionAllowlist.unresolved.join(", ")}`);
	}
	for (const extPath of extensionAllowlist.paths) extensionPaths.add(extPath);

	const skillAllowlist = resolveNamedSkills(agent.skills, skillPaths, cwd);
	if (skillAllowlist.unresolved.length > 0) {
		throw new Error(`Unable to resolve skills for agent ${agent.name}: ${skillAllowlist.unresolved.join(", ")}`);
	}

	if (agent.model.startsWith("cursor/")) {
		const cursorExt = resolveCursorProviderExtension();
		if (!cursorExt) {
			throw new Error(
				`Unable to resolve cursor provider for agent ${agent.name}: pi-cursor-sdk is not installed (pi install npm:pi-cursor-sdk)`,
			);
		}
		extensionPaths.add(cursorExt);
	}

	const piBin = resolvePiBinary();
	const tempDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "pi-sub-"));
	const promptPath = path.join(tempDir, `${agent.name}.md`);
	await withFileMutationQueue(promptPath, async () => {
		await fs.promises.writeFile(promptPath, agent.systemPrompt, { encoding: "utf-8", mode: 0o600 });
	});

	const args = [...piBin.baseArgs, "--mode", "json", "-p", "--no-session", "--no-skills"];
	args.push("--no-extensions");

	if (allowlist.length > 0) {
		args.push("--tools", allowlist.join(","));
	} else {
		args.push("--no-tools");
	}

	for (const extPath of extensionPaths) {
		args.push("--extension", extPath);
	}

	for (const skillPath of skillAllowlist.paths) {
		args.push("--skill", skillPath);
	}

	args.push("--model", agent.model);
	args.push("--thinking", agent.thinking);
	args.push("--append-system-prompt", promptPath);

	const TASK_LIMIT = 8000;
	if (task.length > TASK_LIMIT) {
		const taskPath = path.join(tempDir, "task.md");
		await withFileMutationQueue(taskPath, async () => {
			await fs.promises.writeFile(taskPath, `Task: ${task}`, { encoding: "utf-8", mode: 0o600 });
		});
		args.push(`@${taskPath}`);
	} else {
		args.push(`Task: ${task}`);
	}

	return { args: [piBin.command, ...args], tempDir, childEnv: buildChildEnv(agent) };
}

export function progressSignature(p: AgentProgress): string {
	const tail = p.recentTools.slice(-MAX_TOOLS_COLLAPSED);
	const tailSig = tail
		.map((t) => {
			const childSig =
				t.children
					?.map(
						(c) =>
							`${displayAgentName(c)}:${c.progress.status}:${c.progress.toolCount}:${c.progress.recentTools.length}`,
					)
					.join(";") ?? "";
			return `${t.toolCallId}|${t.status}|${t.tool}|${t.args.slice(0, 80)}|${childSig}`;
		})
		.join(",");
	// Bucket duration so the parent TUI clock ticks without spamming every ms.
	const durationBucket = Math.floor(p.durationMs / SUBAGENT_PROGRESS_HEARTBEAT_MS);
	return `${p.toolCount}|${p.tokens}|${durationBucket}|${p.lastMessage.slice(0, 80)}|${tailSig}`;
}

/** Trailing throttle — always delivers the latest pending call. */
function throttle<T extends (...args: unknown[]) => void>(fn: T, ms: number): T {
	let lastCall = 0;
	let timer: ReturnType<typeof setTimeout> | undefined;
	let latestArgs: unknown[] = [];
	return ((...args: unknown[]) => {
		latestArgs = args;
		const now = Date.now();
		const remaining = ms - (now - lastCall);
		if (remaining <= 0) {
			lastCall = now;
			if (timer) {
				clearTimeout(timer);
				timer = undefined;
			}
			fn(...latestArgs);
			return;
		}
		if (timer) clearTimeout(timer);
		timer = setTimeout(() => {
			lastCall = Date.now();
			timer = undefined;
			fn(...latestArgs);
		}, remaining);
	}) as T;
}

export interface RunSubagentOptions {
	alias?: string;
}

export async function runSubagent(
	agent: AgentConfig,
	task: string,
	cwd: string,
	signal: AbortSignal | undefined,
	onUpdate?: (progress: AgentProgress, usage: AgentResult["usage"]) => void,
	toolExtensionPaths: ToolExtensionPaths = new Map(),
	skillPaths: SkillPaths = new Map(),
	extensionNamePaths: ExtensionNamePaths = new Map(),
	options: RunSubagentOptions = {},
): Promise<AgentResult> {
	const { alias } = options;
	const { args, tempDir, childEnv } = await buildPiArgs(agent, task, toolExtensionPaths, skillPaths, cwd, extensionNamePaths);
	const command = args[0];
	const spawnArgs = args.slice(1);

	const result: AgentResult = {
		agent: agent.name,
		alias,
		task,
		output: "",
		exitCode: 0,
		model: agent.model,
		usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0, turns: 0 },
		progress: {
			agent: agent.name,
			alias,
			status: "running",
			task,
			recentTools: [],
			toolCount: 0,
			tokens: 0,
			durationMs: 0,
			lastMessage: "",
		},
	};

	const startTime = Date.now();
	const progress = result.progress;
	let lastSig = "";
	const trackCursorThinking = agent.model.startsWith("cursor/");

	const findCursorPendingTool = (): ToolEvent | undefined => {
		for (let i = progress.recentTools.length - 1; i >= 0; i--) {
			const t = progress.recentTools[i]!;
			if (t.status === "running" && t.tool === "…") return t;
		}
		return undefined;
	};

	const removeCursorPendingTool = (): void => {
		const pending = findCursorPendingTool();
		if (!pending) return;
		const idx = progress.recentTools.indexOf(pending);
		if (idx >= 0) progress.recentTools.splice(idx, 1);
	};

	const pushUpdate = (force = false) => {
		progress.durationMs = Date.now() - startTime;
		if (!force) {
			const sig = progressSignature(progress);
			if (sig === lastSig) return;
			lastSig = sig;
		}
		onUpdate?.(progress, result.usage);
	};

	const fireUpdate = throttle((force?: unknown) => {
		pushUpdate(force === true);
	}, 150);

	let stderrBuf = "";
	let spawnErrorMsg = "";
	const heartbeat =
		onUpdate &&
		setInterval(() => {
			pushUpdate(true);
		}, SUBAGENT_PROGRESS_HEARTBEAT_MS);

	const exitCode = await new Promise<number>((resolve) => {
		const proc = spawn(command, spawnArgs, {
			cwd,
			stdio: ["ignore", "pipe", "pipe"],
			env: childEnv,
		});

		let buf = "";
		let settled = false;
		let abortListener: (() => void) | undefined;

		const finish = (code: number) => {
			if (settled) return;
			settled = true;
			if (heartbeat) clearInterval(heartbeat);
			if (abortListener) signal?.removeEventListener("abort", abortListener);
			resolve(code);
		};

		const terminateAfterAgentEnd = () => {
			const termTimer = setTimeout(() => {
				if (!proc.killed) proc.kill("SIGTERM");
				const killTimer = setTimeout(() => !proc.killed && proc.kill("SIGKILL"), 3000);
				killTimer.unref?.();
			}, SUBAGENT_AGENT_END_GRACE_MS);
			termTimer.unref?.();
		};

		const processLine = (line: string) => {
			if (!line.trim()) return;
			try {
				const evt = JSON.parse(line) as Record<string, unknown>;
				progress.durationMs = Date.now() - startTime;

				if (evt.type === "tool_execution_start") {
					progress.toolCount++;
					progress.recentTools.push({
						tool: evt.toolName as string,
						args: extractToolArgsPreview((evt.args || {}) as Record<string, unknown>),
						toolCallId: evt.toolCallId as string | undefined,
						status: "running",
					});
					fireUpdate();
				}

				if (evt.type === "tool_execution_update") {
					const partial = evt.partialResult as { details?: { results?: unknown } } | undefined;
					const nested = partial?.details?.results;
					if (evt.toolName === "subagent" && Array.isArray(nested) && evt.toolCallId) {
						const hit = progress.recentTools.find((t) => t.toolCallId === evt.toolCallId);
						if (hit) {
							hit.children = nested as AgentResult[];
							fireUpdate();
						}
					}
				}

				if (evt.type === "tool_execution_end") {
					const hit = evt.toolCallId
						? progress.recentTools.find((t) => t.toolCallId === evt.toolCallId)
						: undefined;
					if (hit) {
						hit.status = "done";
						const finalResult = evt.result as { details?: { results?: unknown } } | undefined;
						const finalChildren = finalResult?.details?.results;
						if (evt.toolName === "subagent" && Array.isArray(finalChildren)) {
							hit.children = finalChildren as AgentResult[];
						}
					}
					fireUpdate(true);
				}

				if (evt.type === "tool_result_end") {
					fireUpdate(true);
				}

				// pi-cursor-sdk runs tools via Cursor SDK; JSON mode emits replay in thinking_* not tool_execution_*.
				if (trackCursorThinking && evt.type === "message_update") {
					const ame = evt.assistantMessageEvent as
						| { type?: string; delta?: string; content?: string }
						| undefined;
					if (ame) {
						if (ame.type === "thinking_start") {
							progress.toolCount++;
							progress.recentTools.push({ tool: "…", args: "", status: "running" });
							fireUpdate();
						} else if (ame.type === "thinking_delta" && typeof ame.delta === "string") {
							const pending = findCursorPendingTool();
							if (pending) {
								const preview = previewFromThinkingDelta(ame.delta);
								if (preview) pending.args = preview;
								fireUpdate();
							}
						} else if (ame.type === "thinking_end" && typeof ame.content === "string") {
							const parsed = parseCursorThinkingActivity(ame.content);
							const pending = findCursorPendingTool();
							if (parsed) {
								if (pending) {
									pending.tool = parsed.tool;
									pending.args = parsed.args;
									pending.status = "done";
								} else {
									progress.toolCount++;
									progress.recentTools.push({
										tool: parsed.tool,
										args: parsed.args,
										status: "done",
									});
								}
								fireUpdate(true);
							} else if (pending) {
								progress.toolCount = Math.max(0, progress.toolCount - 1);
								removeCursorPendingTool();
								fireUpdate();
							}
						}
					}
				}

				if (evt.type === "agent_end") {
					fireUpdate(true);
					finish(0);
					terminateAfterAgentEnd();
					return;
				}

				if (evt.type === "message_end" && evt.message) {
					const message = evt.message as {
						role?: string;
						usage?: {
							input?: number;
							output?: number;
							cacheRead?: number;
							cacheWrite?: number;
							cost?: { total?: number };
							totalTokens?: number;
						};
						model?: string;
						errorMessage?: string;
						content?: unknown;
					};

					if (message.role === "assistant") {
						result.usage.turns++;
						const u = message.usage;
						if (u) {
							result.usage.input += u.input || 0;
							result.usage.output += u.output || 0;
							result.usage.cacheRead += u.cacheRead || 0;
							result.usage.cacheWrite += u.cacheWrite || 0;
							result.usage.cost += u.cost?.total || 0;
							progress.tokens =
								u.totalTokens ||
								(u.input || 0) + (u.output || 0) + (u.cacheRead || 0) + (u.cacheWrite || 0);
						}
						if (message.model) result.model = message.model;
						if (message.errorMessage) progress.error = message.errorMessage;

						const text = extractTextFromContent(message.content);
						if (text) {
							result.output = text;
							const proseLines: string[] = [];
							let inCodeBlock = false;
							for (const line of text.split("\n")) {
								if (line.trimStart().startsWith("```")) {
									inCodeBlock = !inCodeBlock;
									continue;
								}
								if (!inCodeBlock && line.trim()) {
									proseLines.push(line.trim());
								}
							}
							if (proseLines.length > 0) {
								progress.lastMessage = proseLines.slice(0, 3).join(" ");
							}
						}
					}

					fireUpdate(true);
				}
			} catch {
				// Non-JSON lines are expected
			}
		};

		proc.stdout?.on("data", (d: Buffer) => {
			buf += d.toString();
			const lines = buf.split("\n");
			buf = lines.pop() || "";
			lines.forEach(processLine);
		});

		proc.stderr?.on("data", (d: Buffer) => {
			stderrBuf += d.toString();
		});

		proc.on("close", (code) => {
			if (buf.trim()) processLine(buf);
			if (settled) return;
			if (code !== 0 && stderrBuf.trim() && !progress.error) {
				progress.error = stderrBuf.trim();
			}
			finish(code ?? 1);
		});

		proc.on("error", (error) => {
			spawnErrorMsg = error.message;
			if (!progress.error) progress.error = `Failed to spawn pi: ${error.message}`;
			finish(1);
		});

		if (signal) {
			const kill = () => {
				proc.kill("SIGTERM");
				setTimeout(() => !proc.killed && proc.kill("SIGKILL"), 3000);
			};
			abortListener = kill;
			if (signal.aborted) kill();
			else signal.addEventListener("abort", kill, { once: true });
		}
	});

	try {
		fs.rmSync(tempDir, { recursive: true, force: true });
	} catch {}

	result.exitCode = exitCode;
	if (stderrBuf.trim()) result.stderr = stderrBuf.trim();
	if (spawnErrorMsg) result.spawnError = spawnErrorMsg;
	progress.status = exitCode === 0 && !progress.error ? "completed" : "failed";
	progress.durationMs = Date.now() - startTime;
	if (progress.error) result.output = result.output || `Error: ${progress.error}`;

	if (result.output.length > DEFAULT_MAX_BYTES) {
		const trunc = truncateHead(result.output, {
			maxLines: DEFAULT_MAX_LINES,
			maxBytes: DEFAULT_MAX_BYTES,
		});
		result.output = trunc.content;
		if (trunc.truncated) {
			result.output += "\n\n[Output truncated]";
		}
	}

	return result;
}

export function formatSubagentFailure(result: AgentResult): string {
	const parts = [
		`Subagent ${displayAgentName(result)} failed with exit code ${result.exitCode}`,
		result.progress.error ? `error: ${result.progress.error}` : undefined,
		result.spawnError ? `spawn: ${result.spawnError}` : undefined,
		result.stderr ? `stderr: ${result.stderr}` : undefined,
	].filter(Boolean);
	return parts.join("\n");
}

export class Semaphore {
	private inFlight = 0;
	private readonly waiters: Array<() => void> = [];
	private readonly max: number;

	constructor(max: number) {
		this.max = max;
	}

	async run<T>(fn: () => Promise<T>): Promise<T> {
		if (this.inFlight >= this.max) {
			await new Promise<void>((r) => this.waiters.push(r));
		}
		this.inFlight++;
		try {
			return await fn();
		} finally {
			this.inFlight--;
			const next = this.waiters.shift();
			if (next) next();
		}
	}
}
