import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { loadMergedPolishStatuslineConfig, updateProjectPolishStatuslineConfig } from "./config.ts";
import { type FooterVariant, renderPolishedFooter } from "./render.ts";

const VARIANTS: FooterVariant[] = ["codex", "compact", "minimal"];

let enabled = true;
let variant: FooterVariant = "codex";
let activeCtx: ExtensionContext | undefined;
let requestRender: (() => void) | undefined;

function applyConfig(cwd: string): void {
	const config = loadMergedPolishStatuslineConfig(cwd);
	enabled = config.enabled;
	variant = config.variant;
}

function cycleVariant(): FooterVariant {
	const i = VARIANTS.indexOf(variant);
	variant = VARIANTS[(i + 1) % VARIANTS.length]!;
	return variant;
}

function parseVariant(arg: string): FooterVariant | "off" | "cycle" | undefined {
	const v = arg.trim().toLowerCase();
	if (v === "" || v === "cycle") return "cycle";
	if (v === "off" || v === "disable") return "off";
	if (v === "on" || v === "enable") return undefined;
	if (VARIANTS.includes(v as FooterVariant)) return v as FooterVariant;
	return undefined;
}

function installFooter(ctx: ExtensionContext): void {
	activeCtx = ctx;
	ctx.ui.setFooter((tui, theme, footerData) => {
		requestRender = () => tui.requestRender();
		const unsubBranch = footerData.onBranchChange(requestRender);

		return {
			dispose() {
				unsubBranch();
				requestRender = undefined;
			},
			invalidate() {},
			render(width: number): string[] {
				if (!enabled || !activeCtx) return [];
				return renderPolishedFooter(activeCtx, theme, footerData, variant, width);
			},
		};
	});
}

function persist(ctx: ExtensionContext): void {
	updateProjectPolishStatuslineConfig(ctx.cwd, { enabled, variant });
}

export default function (pi: ExtensionAPI): void {
	pi.on("session_start", async (_event, ctx) => {
		if (!ctx.hasUI) return;
		applyConfig(ctx.cwd);
		if (enabled) installFooter(ctx);
	});

	pi.on("turn_end", async () => {
		if (enabled && activeCtx) requestRender?.();
	});
	pi.on("model_select", async () => {
		if (enabled && activeCtx) requestRender?.();
	});

	pi.registerCommand("polish-statusline", {
		description: "Polished Codex-style footer [codex|compact|minimal|cycle|off]",
		handler: async (args, ctx) => {
			const parsed = parseVariant(args);

			if (parsed === "off") {
				enabled = false;
				ctx.ui.setFooter(undefined);
				persist(ctx);
				ctx.ui.notify("Default footer restored (saved)", "info");
				return;
			}

			if (parsed === "cycle") {
				cycleVariant();
			} else if (parsed) {
				variant = parsed;
			}

			enabled = true;
			installFooter(ctx);
			persist(ctx);
			requestRender?.();
			ctx.ui.notify(`Polished footer (${variant}) — saved to .pi/kumpul/config.yaml`, "info");
		},
	});
}
