import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

/** Built-in read-only tools pi registers but does not enable by default. */
const EXTRA_BUILTIN_TOOLS = ["grep", "find", "ls"] as const;

function enableExtraBuiltinTools(pi: ExtensionAPI): void {
	const available = new Set(pi.getAllTools().map((tool) => tool.name));
	const active = pi.getActiveTools();
	const missing = EXTRA_BUILTIN_TOOLS.filter(
		(name) => available.has(name) && !active.includes(name),
	);
	if (missing.length === 0) return;
	pi.setActiveTools([...active, ...missing]);
}

export default function (pi: ExtensionAPI): void {
	const apply = () => enableExtraBuiltinTools(pi);

	pi.on("session_start", async () => apply());
	pi.on("session_tree", async () => apply());
}
