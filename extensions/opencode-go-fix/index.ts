import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

const TARGET_PROVIDER = "opencode-go";
const QWEN_TARGET_MODEL = "qwen3.6-plus";
const KIMI_TARGET_MODEL = "kimi-k2.6";
export const OPENCODE_GO_FIX_STATUS_KEY = "opencode-go-fix";
const CACHE_CONTROL = { type: "ephemeral" } as const;

type RecordValue = Record<string, unknown>;

export default function (pi: ExtensionAPI): void {
	async function refreshStatus(_event: unknown, ctx: ExtensionContext): Promise<void> {
		updateQwenCacheStatus(ctx);
	}

	pi.on("session_start", refreshStatus);
	pi.on("model_select", refreshStatus);
	pi.on("turn_end", refreshStatus);
	pi.on("session_compact", refreshStatus);
	pi.on("session_tree", refreshStatus);

	pi.on("session_shutdown", async (_event, ctx) => {
		if (!ctx.hasUI) return;
		ctx.ui.setStatus(OPENCODE_GO_FIX_STATUS_KEY, undefined);
	});

	pi.on("before_provider_request", (event, ctx) => {
		if (isQwen36PlusOnOpenCodeGo(ctx)) {
			return applyQwen36PlusCachePatch(event.payload);
		}
		if (isKimiK26OnOpenCodeGo(ctx)) {
			return applyOpenCodeGoKimiReasoningPatch(event.payload);
		}
		return undefined;
	});
}

export function applyQwen36PlusCachePatch(payload: unknown): unknown {
	if (!isRecord(payload)) {
		return payload;
	}

	const copy: RecordValue = { ...payload };
	let changed = false;

	if (Array.isArray(copy.messages)) {
		const messages = copy.messages.map((message) => (isRecord(message) ? { ...message } : message));
		if (markCacheableSystemMessage(messages)) changed = true;
		if (markCacheableLastConversationMessage(messages)) changed = true;
		if (changed) {
			copy.messages = messages;
		}
	}

	if (Array.isArray(copy.tools) && copy.tools.length > 0) {
		const tools = copy.tools.map((tool) => (isRecord(tool) ? { ...tool } : tool));
		const lastTool = tools[tools.length - 1];
		if (isRecord(lastTool) && !hasCacheControl(lastTool)) {
			lastTool.cache_control = CACHE_CONTROL;
			copy.tools = tools;
			changed = true;
		}
	}

	return changed ? copy : payload;
}

export function applyOpenCodeGoKimiReasoningPatch(payload: unknown): unknown {
	if (!isRecord(payload) || !Array.isArray(payload.messages)) {
		return payload;
	}

	let changed = false;
	const messages = payload.messages.map((message) => {
		if (!isRecord(message) || typeof message.reasoning !== "string" || message.reasoning.length === 0) {
			return message;
		}

		const copy: RecordValue = { ...message, reasoning_content: message.reasoning };
		delete copy.reasoning;
		changed = true;
		return copy;
	});

	return changed ? { ...payload, messages } : payload;
}

function updateQwenCacheStatus(ctx: ExtensionContext): void {
	if (!ctx.hasUI) return;

	const status = isQwen36PlusOnOpenCodeGo(ctx)
		? `cache ${formatCompactNumber(getTotalCacheRead(ctx))}`
		: undefined;

	ctx.ui.setStatus(OPENCODE_GO_FIX_STATUS_KEY, status);
}

function getTotalCacheRead(ctx: ExtensionContext): number {
	let total = 0;

	for (const entry of ctx.sessionManager.getEntries()) {
		if (entry.type === "message" && entry.message.role === "assistant") {
			total += entry.message.usage.cacheRead;
		}
	}

	return total;
}

function formatCompactNumber(value: number): string {
	if (value < 1000) return value.toString();
	if (value < 10000) return `${(value / 1000).toFixed(1)}k`;
	if (value < 1000000) return `${Math.round(value / 1000)}k`;
	if (value < 10000000) return `${(value / 1000000).toFixed(1)}M`;
	return `${Math.round(value / 1000000)}M`;
}

function isQwen36PlusOnOpenCodeGo(ctx: ExtensionContext): boolean {
	return isTargetModelOnOpenCodeGo(ctx, QWEN_TARGET_MODEL);
}

function isKimiK26OnOpenCodeGo(ctx: ExtensionContext): boolean {
	return isTargetModelOnOpenCodeGo(ctx, KIMI_TARGET_MODEL);
}

function isTargetModelOnOpenCodeGo(ctx: ExtensionContext, modelId: string): boolean {
	return ctx.model?.provider === TARGET_PROVIDER && ctx.model.id === modelId;
}

function markCacheableSystemMessage(messages: unknown[]): boolean {
	const systemIndex = messages.findIndex((message) => isRecord(message) && message.role === "system");
	if (systemIndex >= 0) {
		return markCacheableMessage(messages, systemIndex);
	}

	return markCacheableMessage(messages, 0);
}

function markCacheableLastConversationMessage(messages: unknown[]): boolean {
	for (let index = messages.length - 1; index >= 0; index -= 1) {
		const message = messages[index];
		if (!isRecord(message)) continue;
		if (message.role === "user" || message.role === "assistant") {
			return markCacheableMessage(messages, index);
		}
	}
	return false;
}

function markCacheableMessage(messages: unknown[], index: number): boolean {
	const message = messages[index];
	if (!isRecord(message) || hasCacheControl(message)) {
		return false;
	}

	if (typeof message.content === "string") {
		message.content = [{ type: "text", text: message.content, cache_control: CACHE_CONTROL }];
		return true;
	}

	if (Array.isArray(message.content)) {
		for (let contentIndex = message.content.length - 1; contentIndex >= 0; contentIndex -= 1) {
			const block = message.content[contentIndex];
			if (!isRecord(block)) continue;
			if (block.type === "text" && typeof block.text === "string" && !hasCacheControl(block)) {
				const content = [...message.content];
				content[contentIndex] = { ...block, cache_control: CACHE_CONTROL };
				message.content = content;
				return true;
			}
		}
	}

	return false;
}

function hasCacheControl(value: RecordValue): boolean {
	return isRecord(value.cache_control);
}

function isRecord(value: unknown): value is RecordValue {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
