import { CustomEditor, type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import {
	type AutocompleteItem,
	type AutocompleteProvider,
	fuzzyFilter,
} from "@earendil-works/pi-tui";

const DELIMITERS = new Set([" ", "\t", "\n"]);
const DOLLAR_SKILL_PATTERN = /(?:^|(?<=\s))\$([a-z0-9][a-z0-9-]*)/g;

type SkillCommand = {
	name: string;
	description?: string;
};

type SkillShortcutInputEvent = {
	text: string;
};

type SkillShortcutInputResult =
	| { action: "transform"; text: string }
	| { action: "continue" };

export function extractDollarPrefix(textBeforeCursor: string): string | null {
	for (let i = textBeforeCursor.length - 1; i >= 0; i--) {
		if (DELIMITERS.has(textBeforeCursor[i]!)) {
			const token = textBeforeCursor.slice(i + 1);
			return token.startsWith("$") ? token : null;
		}
	}

	return textBeforeCursor.startsWith("$") ? textBeforeCursor : null;
}

export function transformSkillShortcuts(text: string, skillNames: readonly string[]): string {
	const knownSkills = new Set(skillNames);

	return text.replace(DOLLAR_SKILL_PATTERN, (match, name: string) => {
		return knownSkills.has(name) ? match.replace(`$${name}`, `/skill:${name}`) : match;
	});
}

export function createSkillShortcutInputHandler(
	getSkillNames: () => readonly string[],
): (event: SkillShortcutInputEvent) => SkillShortcutInputResult {
	return (event) => {
		const transformed = transformSkillShortcuts(event.text, getSkillNames());

		if (transformed !== event.text) {
			return { action: "transform", text: transformed };
		}

		return { action: "continue" };
	};
}

class SkillShortcutAutocomplete implements AutocompleteProvider {
	private readonly inner: AutocompleteProvider;
	private readonly getSkillCommands: () => SkillCommand[];

	constructor(inner: AutocompleteProvider, getSkillCommands: () => SkillCommand[]) {
		this.inner = inner;
		this.getSkillCommands = getSkillCommands;
	}

	async getSuggestions(
		lines: string[],
		cursorLine: number,
		cursorCol: number,
		options: { signal: AbortSignal; force?: boolean },
	) {
		const textBeforeCursor = (lines[cursorLine] ?? "").slice(0, cursorCol);
		const dollarPrefix = extractDollarPrefix(textBeforeCursor);

		if (dollarPrefix !== null) {
			const query = dollarPrefix.slice(1);
			const items = this.getSkillCommands().map((command) => ({
				value: command.name,
				label: command.name,
				...(command.description ? { description: command.description } : {}),
			}));
			const filtered = fuzzyFilter(items, query, (item) => item.value);

			return { items: filtered, prefix: dollarPrefix };
		}

		return this.inner.getSuggestions(lines, cursorLine, cursorCol, options);
	}

	applyCompletion(
		lines: string[],
		cursorLine: number,
		cursorCol: number,
		item: AutocompleteItem,
		prefix: string,
	) {
		if (prefix.startsWith("$")) {
			const line = lines[cursorLine] ?? "";
			const before = line.slice(0, cursorCol - prefix.length);
			const after = line.slice(cursorCol);
			const separator = after.startsWith(" ") || after.startsWith("\t") || after.length === 0 ? "" : " ";
			const completedLine = `${before}$${item.value}${separator}${after}`;

			return {
				lines: [...lines.slice(0, cursorLine), completedLine, ...lines.slice(cursorLine + 1)],
				cursorLine,
				cursorCol: before.length + item.value.length + 1 + separator.length,
			};
		}

		return this.inner.applyCompletion(lines, cursorLine, cursorCol, item, prefix);
	}

	shouldTriggerFileCompletion?(lines: string[], cursorLine: number, cursorCol: number): boolean {
		return this.inner.shouldTriggerFileCompletion?.(lines, cursorLine, cursorCol) ?? false;
	}
}

class SkillShortcutEditor extends CustomEditor {
	private getSkillCommands: () => SkillCommand[] = () => [];

	setSkillCommandGetter(getSkillCommands: () => SkillCommand[]) {
		this.getSkillCommands = getSkillCommands;
	}

	override setAutocompleteProvider(provider: AutocompleteProvider) {
		super.setAutocompleteProvider(new SkillShortcutAutocomplete(provider, () => this.getSkillCommands()));
	}

	override handleInput(data: string): void {
		const wasShowingAutocomplete = this.isShowingAutocomplete();

		super.handleInput(data);

		if (wasShowingAutocomplete) return;
		if (data.length !== 1 || data.charCodeAt(0) < 32) return;

		const editor = this as unknown as {
			state?: { lines: string[]; cursorLine: number; cursorCol: number };
			tryTriggerAutocomplete?: () => void;
		};
		const lines = editor.state?.lines;
		const cursorLine = editor.state?.cursorLine;
		const cursorCol = editor.state?.cursorCol;
		if (!lines || cursorLine === undefined || cursorCol === undefined) return;

		const textBeforeCursor = (lines[cursorLine] ?? "").slice(0, cursorCol);
		if (extractDollarPrefix(textBeforeCursor) !== null) {
			editor.tryTriggerAutocomplete?.();
		}
	}
}

export default function (pi: ExtensionAPI) {
	const getSkillCommands = () =>
		pi
			.getCommands()
			.filter((command) => command.source === "skill")
			.map((command) => ({
				name: command.name.replace(/^skill:/, ""),
				description: command.description,
			}));
	const getSkillNames = () => getSkillCommands().map((command) => command.name);

	pi.on("session_start", (_event, ctx) => {
		ctx.ui.setEditorComponent((tui, theme, keybindings) => {
			const editor = new SkillShortcutEditor(tui, theme, keybindings);
			editor.setSkillCommandGetter(getSkillCommands);
			return editor;
		});
	});

	pi.on("input", createSkillShortcutInputHandler(getSkillNames));
}
