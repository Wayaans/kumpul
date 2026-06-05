import type { ExtensionAPI, ExtensionContext, Theme } from "@earendil-works/pi-coding-agent";
import {
	DynamicBorder,
	getSelectListTheme,
	getSettingsListTheme,
} from "@earendil-works/pi-coding-agent";
import {
	Container,
	fuzzyFilter,
	getKeybindings,
	Input,
	Key,
	type Component,
	type SelectItem,
	SelectList,
	type SettingItem,
	SettingsList,
	Text,
	matchesKey,
} from "@earendil-works/pi-tui";
import {
	draftFromAgent,
	validateDraft,
	writeAgentConfig,
	type AgentConfigPatch,
} from "./agent-io.ts";
import {
	isAgentSpawnEnabled,
	loadMergedSubagentsUiConfig,
	updateProjectSubagentsUiConfig,
	type SubagentsUiConfig,
} from "./config-io.ts";
import { discoverFileAgents, loadAgents } from "./registry.ts";
import { discoverSelectableToolNames } from "./resolve-tools.ts";
import type { AgentConfig } from "./types.ts";

const THINKING_LEVELS = ["minimal", "low", "medium", "high", "xhigh"] as const;
const RELOAD_HINT = "Run /reload to apply changes.";
const OVERLAY_WIDTH = 72;
const OVERLAY_MAX_HEIGHT = 26;
const LIST_VISIBLE = 10;

export interface SetupResult {
	saved: boolean;
	message?: string;
}

type Screen =
	| { type: "home" }
	| { type: "agent"; agent: AgentConfig }
	| { type: "tools"; agent: AgentConfig }
	| { type: "model"; agent: AgentConfig };

interface ModelRow {
	key: string;
	label: string;
	description: string;
}

function sourceLabel(source: AgentConfig["source"]): string {
	switch (source) {
		case "package":
			return "package";
		case "user":
			return "user";
		case "project":
			return "project";
		default:
			return source;
	}
}

function agentSummary(agent: AgentConfig, uiConfig: SubagentsUiConfig): string {
	const spawn = isAgentSpawnEnabled(agent.name, uiConfig) ? "spawnable" : "spawn disabled";
	return `${sourceLabel(agent.source)} · ${agent.model} · ${agent.thinking} · ${spawn}`;
}

function pathBasename(filePath: string): string {
	const parts = filePath.split(/[/\\]/);
	return parts[parts.length - 1] ?? filePath;
}

function saveAgentDraft(agent: AgentConfig, draft: AgentConfigPatch): string | null {
	const error = validateDraft(agent, draft);
	if (error) return error;
	const patch: AgentConfigPatch = {};
	if (draft.tools) patch.tools = draft.tools;
	if (draft.model) patch.model = draft.model;
	if (draft.thinking) patch.thinking = draft.thinking;
	if (Object.keys(patch).length === 0) return "No changes to save.";
	writeAgentConfig(agent.filePath, patch);
	return null;
}

function buildModelRows(modelRegistry: ExtensionContext["modelRegistry"]): ModelRow[] {
	modelRegistry.refresh();
	let models = modelRegistry.getAvailable();
	if (models.length === 0) models = modelRegistry.getAll();
	return models
		.map((model) => ({
			key: `${model.provider}/${model.id}`,
			label: model.name && model.name !== model.id ? `${model.id} — ${model.name}` : model.id,
			description: model.provider,
		}))
		.sort((a, b) => a.key.localeCompare(b.key));
}

function compactShell(
	theme: Theme,
	title: string,
	subtitle: string | undefined,
	body: Component,
	hint: string,
): Component {
	const shell = new Container();
	shell.addChild(new DynamicBorder((str) => theme.fg("accent", str)));
	shell.addChild(new Text(`  ${theme.fg("accent", theme.bold(title))}`));
	if (subtitle) shell.addChild(new Text(`  ${theme.fg("muted", subtitle)}`));
	shell.addChild(body);
	shell.addChild(new Text(`  ${theme.fg("dim", hint)}`));
	shell.addChild(new DynamicBorder((str) => theme.fg("accent", str)));
	return shell;
}

export async function showSubagentsSetup(
	pi: ExtensionAPI,
	ctx: ExtensionContext,
	extensionConfig: { allowProjectAgents?: boolean; allowProjectAgentOverrides?: boolean },
): Promise<SetupResult> {
	const fileAgents = discoverFileAgents(ctx.cwd, {
		allowProjectAgents: extensionConfig.allowProjectAgents,
		allowProjectAgentOverrides: extensionConfig.allowProjectAgentOverrides,
	}).filter((agent) => agent.source !== "dynamic");

	if (fileAgents.length === 0) {
		ctx.ui.notify("No subagent definitions found to configure.", "warning");
		return { saved: false };
	}

	let uiConfig = loadMergedSubagentsUiConfig(ctx.cwd);
	let saved = false;
	const drafts = new Map<string, { patch: AgentConfigPatch; dirty: boolean }>();
	const screenStack: Screen[] = [{ type: "home" }];

	const getDraft = (agent: AgentConfig) => {
		let entry = drafts.get(agent.name);
		if (!entry) {
			entry = { patch: draftFromAgent(agent), dirty: false };
			drafts.set(agent.name, entry);
		}
		return entry;
	};

	const result = await ctx.ui.custom<SetupResult | undefined>(
		(tui, theme, _kb, done) => {
			let shell: Component | null = null;
			let inputTarget: { handleInput(data: string): void; invalidate(): void } | null = null;

			const popScreen = () => {
				if (screenStack.length > 1) {
					screenStack.pop();
					rebuild();
					tui.requestRender();
					return;
				}
				done(saved ? { saved: true, message: RELOAD_HINT } : undefined);
			};

			const pushScreen = (screen: Screen) => {
				screenStack.push(screen);
				rebuild();
				tui.requestRender();
			};

			const rebuild = () => {
				const screen = screenStack[screenStack.length - 1]!;
				const built = buildScreen(screen);
				shell = built.shell;
				inputTarget = built.inputTarget;
			};

			const buildScreen = (
				screen: Screen,
			): { shell: Component; inputTarget: { handleInput(data: string): void; invalidate(): void } } => {
				switch (screen.type) {
					case "home":
						return buildHomeScreen();
					case "agent":
						return buildAgentScreen(screen.agent);
					case "tools":
						return buildToolsScreen(screen.agent);
					case "model":
						return buildModelScreen(screen.agent);
				}
			};

			const buildHomeScreen = () => {
				const items: SettingItem[] = [
					{
						id: "extension",
						label: "Subagents extension",
						description: RELOAD_HINT,
						currentValue: uiConfig.enabled ? "enabled" : "disabled",
						values: ["enabled", "disabled"],
					},
					...fileAgents.map((agent) => ({
						id: `agent:${agent.name}`,
						label: agent.name,
						description: agentSummary(agent, uiConfig),
						currentValue: "configure",
						values: ["configure"],
					})),
				];

				const list = new SettingsList(
					items,
					Math.min(items.length, LIST_VISIBLE),
					getSettingsListTheme(),
					(id, newValue) => {
						if (id === "extension") {
							const enabled = newValue === "enabled";
							uiConfig = { ...uiConfig, enabled };
							updateProjectSubagentsUiConfig(ctx.cwd, { enabled });
							saved = true;
							list.updateValue("extension", newValue);
							ctx.ui.notify(`Subagents extension ${enabled ? "enabled" : "disabled"}. ${RELOAD_HINT}`, "info");
							tui.requestRender();
							return;
						}
						const agentName = id.slice("agent:".length);
						const agent = fileAgents.find((a) => a.name === agentName);
						if (agent) pushScreen({ type: "agent", agent });
					},
					() => done(saved ? { saved: true, message: RELOAD_HINT } : undefined),
					{ enableSearch: true },
				);

				const body = new Container();
				body.addChild(list);

				return {
					shell: compactShell(
						theme,
						"Subagents",
						uiConfig.enabled ? `Extension enabled · ${RELOAD_HINT}` : `Extension disabled · ${RELOAD_HINT}`,
						body,
						"enter open · type to search · esc close",
					),
					inputTarget: list,
				};
			};

			const buildAgentScreen = (agent: AgentConfig) => {
				const entry = getDraft(agent);
				const spawnEnabled = !uiConfig.disabledAgents.has(agent.name);

				const items: SettingItem[] = [
					{
						id: "spawn",
						label: "Spawn",
						description: `Allow subagent tool to invoke ${agent.name}. ${RELOAD_HINT}`,
						currentValue: spawnEnabled ? "enabled" : "disabled",
						values: ["enabled", "disabled"],
					},
					{
						id: "tools",
						label: "Tools",
						description: "Built-in and extension tools from the current session.",
						currentValue: `${(entry.patch.tools ?? agent.tools).length} selected`,
						values: ["open"],
					},
					{
						id: "model",
						label: "Model",
						currentValue: entry.patch.model ?? agent.model,
						values: ["open"],
					},
					{
						id: "thinking",
						label: "Thinking",
						currentValue: entry.patch.thinking ?? agent.thinking,
						values: [...THINKING_LEVELS],
					},
					{
						id: "save",
						label: "Save",
						description: `${pathBasename(agent.filePath)} · ${RELOAD_HINT}`,
						currentValue: entry.dirty ? "save changes" : "up to date",
						values: ["save changes", "up to date"],
					},
				];

				const list = new SettingsList(
					items,
					Math.min(items.length, LIST_VISIBLE),
					getSettingsListTheme(),
					(id, newValue) => {
						if (id === "spawn") {
							const next = new Set(uiConfig.disabledAgents);
							if (newValue === "enabled") next.delete(agent.name);
							else next.add(agent.name);
							uiConfig = { ...uiConfig, disabledAgents: next };
							updateProjectSubagentsUiConfig(ctx.cwd, { disabledAgents: next });
							saved = true;
							list.updateValue("spawn", newValue);
							ctx.ui.notify(`${agent.name} spawn ${newValue}. ${RELOAD_HINT}`, "info");
							tui.requestRender();
							return;
						}
						if (id === "tools") {
							pushScreen({ type: "tools", agent });
							return;
						}
						if (id === "model") {
							pushScreen({ type: "model", agent });
							return;
						}
						if (id === "thinking") {
							entry.patch.thinking = newValue;
							entry.dirty = true;
							list.updateValue("thinking", newValue);
							list.updateValue("save", "save changes");
							tui.requestRender();
							return;
						}
						if (id === "save" && newValue === "save changes" && entry.dirty) {
							const error = saveAgentDraft(agent, entry.patch);
							if (error) {
								ctx.ui.notify(error, "error");
								return;
							}
							entry.dirty = false;
							saved = true;
							loadAgents(ctx.cwd, {
								allowProjectAgents: extensionConfig.allowProjectAgents,
								allowProjectAgentOverrides: extensionConfig.allowProjectAgentOverrides,
							});
							const refreshed = discoverFileAgents(ctx.cwd, {
								allowProjectAgents: extensionConfig.allowProjectAgents,
								allowProjectAgentOverrides: extensionConfig.allowProjectAgentOverrides,
							}).find((a) => a.name === agent.name);
							if (refreshed) {
								drafts.set(agent.name, { patch: draftFromAgent(refreshed), dirty: false });
							}
							list.updateValue("save", "up to date");
							list.updateValue("model", entry.patch.model ?? agent.model);
							list.updateValue("tools", `${(entry.patch.tools ?? agent.tools).length} selected`);
							ctx.ui.notify(`Saved ${agent.name}. ${RELOAD_HINT}`, "info");
							tui.requestRender();
						}
					},
					popScreen,
				);

				const body = new Container();
				body.addChild(new Text(`  ${theme.fg("dim", agent.description)}`));
				body.addChild(list);

				return {
					shell: compactShell(
						theme,
						`Configure · ${agent.name}`,
						`${sourceLabel(agent.source)} · ${pathBasename(agent.filePath)}`,
						body,
						"enter change · esc back",
					),
					inputTarget: list,
				};
			};

			const buildToolsScreen = (agent: AgentConfig) => {
				const entry = getDraft(agent);
				const sessionTools = pi.getAllTools();
				const toolNames = discoverSelectableToolNames(sessionTools, agent.tools);
				const selected = new Set(entry.patch.tools ?? agent.tools);
				const items: SettingItem[] = toolNames.map((name) => ({
					id: name,
					label: name,
					currentValue: selected.has(name) ? "enabled" : "disabled",
					values: ["enabled", "disabled"],
				}));

				const list = new SettingsList(
					items,
					Math.min(items.length, LIST_VISIBLE),
					getSettingsListTheme(),
					(id, newValue) => {
						if (newValue === "enabled") selected.add(id);
						else selected.delete(id);
						entry.patch.tools = [...selected].sort((a, b) => a.localeCompare(b));
						entry.dirty = true;
						tui.requestRender();
					},
					popScreen,
					{ enableSearch: true },
				);

				const body = new Container();
				body.addChild(list);

				return {
					shell: compactShell(
						theme,
						"Tools",
						`${toolNames.length} tools · built-in and extensions`,
						body,
						"type to search · space toggle · esc back",
					),
					inputTarget: list,
				};
			};

			const buildModelScreen = (agent: AgentConfig) => {
				const entry = getDraft(agent);
				const modelRows = buildModelRows(ctx.modelRegistry);
				const currentKey = entry.patch.model ?? agent.model;

				let filteredRows = modelRows;
				const toSelectItems = (rows: ModelRow[]): SelectItem[] =>
					rows.map((row) => ({
						value: row.key,
						label: row.key,
						description: row.description,
					}));

				let selectList = new SelectList(
					toSelectItems(filteredRows),
					Math.min(LIST_VISIBLE, Math.max(1, filteredRows.length)),
					getSelectListTheme(),
					{ minPrimaryColumnWidth: 20, maxPrimaryColumnWidth: 44 },
				);

				const currentIndex = filteredRows.findIndex((row) => row.key === currentKey);
				if (currentIndex >= 0) selectList.setSelectedIndex(currentIndex);

				selectList.onSelect = (item) => {
					entry.patch.model = item.value;
					entry.dirty = true;
					popScreen();
				};
				selectList.onCancel = popScreen;

				const searchInput = new Input();
				const applyFilter = (query: string) => {
					filteredRows = query
						? fuzzyFilter(modelRows, query, (row) => `${row.key} ${row.label} ${row.description}`)
						: modelRows;
					selectList = new SelectList(
						toSelectItems(filteredRows),
						Math.min(LIST_VISIBLE, Math.max(1, filteredRows.length)),
						getSelectListTheme(),
						{ minPrimaryColumnWidth: 20, maxPrimaryColumnWidth: 44 },
					);
					const idx = filteredRows.findIndex((row) => row.key === currentKey);
					if (idx >= 0) selectList.setSelectedIndex(idx);
					selectList.onSelect = (item) => {
						entry.patch.model = item.value;
						entry.dirty = true;
						popScreen();
					};
					selectList.onCancel = popScreen;
					body.replaceList(selectList);
				};

				const body = new ModelPickerBody(searchInput, selectList);
				searchInput.onSubmit = () => {
					const item = selectList.getSelectedItem();
					if (item) {
						entry.patch.model = item.value;
						entry.dirty = true;
						popScreen();
					}
				};

				const availableCount = ctx.modelRegistry.getAvailable().length;
				const subtitle =
					availableCount > 0
						? `${availableCount} models with auth · type to search`
						: `${modelRows.length} models · configure auth via /login`;

				const inputTarget = {
					handleInput(data: string) {
						const kb = getKeybindings();
						if (kb.matches(data, "tui.select.up") || matchesKey(data, Key.up) || data === "k") {
							selectList.handleInput(data);
							tui.requestRender();
							return;
						}
						if (kb.matches(data, "tui.select.down") || matchesKey(data, Key.down) || data === "j") {
							selectList.handleInput(data);
							tui.requestRender();
							return;
						}
						if (kb.matches(data, "tui.select.confirm")) {
							selectList.handleInput(data);
							return;
						}
						if (kb.matches(data, "tui.select.cancel") || matchesKey(data, Key.escape)) {
							popScreen();
							return;
						}
						searchInput.handleInput(data);
						applyFilter(searchInput.getValue());
						tui.requestRender();
					},
					invalidate() {
						body.invalidate();
					},
				};

				return {
					shell: compactShell(theme, "Model", subtitle, body, "type to search · enter select · esc back"),
					inputTarget,
				};
			};

			rebuild();

			return {
				render(width: number) {
					return shell?.render(width) ?? [];
				},
				invalidate() {
					shell?.invalidate?.();
					inputTarget?.invalidate();
				},
				handleInput(data: string) {
					inputTarget?.handleInput(data);
					tui.requestRender();
				},
			};
		},
		{
			overlay: true,
			overlayOptions: { anchor: "center", width: OVERLAY_WIDTH, maxHeight: OVERLAY_MAX_HEIGHT },
		},
	);

	return result ?? { saved: false };
}

class ModelPickerBody implements Component {
	private list: SelectList;
	private searchInput: Input;

	constructor(searchInput: Input, list: SelectList) {
		this.searchInput = searchInput;
		this.list = list;
	}

	replaceList(list: SelectList) {
		this.list = list;
	}

	invalidate() {
		this.searchInput.invalidate();
		this.list.invalidate();
	}

	render(width: number): string[] {
		const lines: string[] = [];
		lines.push(...this.searchInput.render(width));
		lines.push("");
		lines.push(...this.list.render(width));
		return lines;
	}
}
