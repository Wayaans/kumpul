import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { renderPolishedFooter } from "./render.ts";

let activeCtx: ExtensionContext | undefined;
let requestRender: (() => void) | undefined;

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
				if (!activeCtx) return [];
				return renderPolishedFooter(activeCtx, theme, footerData, width);
			},
		};
	});
}

export default function (pi: ExtensionAPI): void {
	pi.on("session_start", async (_event, ctx) => {
		if (!ctx.hasUI) return;
		installFooter(ctx);
	});

	pi.on("turn_end", async () => {
		if (activeCtx) requestRender?.();
	});
	pi.on("model_select", async () => {
		if (activeCtx) requestRender?.();
	});
}
