/** Parse Cursor SDK replay text from thinking blocks into subagent tool rows. */

export interface CursorThinkingActivity {
	tool: string;
	args: string;
}

const PROSE_PREFIX = /^(i will|i'll|let me|first,?|next,?|then,?|now,?)\b/i;

/** First meaningful line of thinking content (skip leading blank lines). */
export function firstThinkingLine(content: string): string {
	for (const line of content.split("\n")) {
		const t = line.trim();
		if (t) return t;
	}
	return "";
}

/**
 * Map Cursor SDK thinking replay to a tool label + args preview.
 * Returns undefined for non-tool prose (e.g. "I will read …").
 */
export function parseCursorThinkingActivity(content: string): CursorThinkingActivity | undefined {
	const line = firstThinkingLine(content);
	if (!line || line.length < 2) return undefined;
	if (PROSE_PREFIX.test(line) && !line.startsWith("$")) return undefined;

	if (line.startsWith("$ ")) {
		const cmd = line.slice(2).trim();
		const tool = /^\s*(ls|grep|find|glob)\b/i.test(cmd)
			? cmd.split(/\s+/)[0]!.toLowerCase()
			: "bash";
		return { tool, args: cmd };
	}

	const readMatch = /^read\s+(.+)/i.exec(line);
	if (readMatch) {
		return { tool: "read", args: readMatch[1]!.trim() };
	}

	const editMatch = /^(write|edit)\s+(.+)/i.exec(line);
	if (editMatch) {
		return { tool: editMatch[1]!.toLowerCase(), args: editMatch[2]!.trim() };
	}

	if (/^grep\b/i.test(line)) {
		return { tool: "grep", args: line.replace(/^grep\s+/i, "") };
	}

	if (/^find\b/i.test(line) || /\bglob\b/i.test(line)) {
		return { tool: "find", args: line };
	}

	if (/^ls\b/i.test(line)) {
		return { tool: "ls", args: line.replace(/^ls\s+/i, "") };
	}

	if (/tool call|cursor-replay|pi__/i.test(line)) {
		return { tool: "cursor", args: line.slice(0, 200) };
	}

	return undefined;
}

export function previewFromThinkingDelta(delta: string): string {
	const line = firstThinkingLine(delta);
	return line.length > 120 ? line.slice(0, 120) + "…" : line;
}
