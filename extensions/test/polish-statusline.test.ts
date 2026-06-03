import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
	getProjectConfigPath,
	loadMergedPolishStatuslineConfig,
	updateProjectPolishStatuslineConfig,
} from "../polish-statusline/config.ts";

function withTempProject(fn: (cwd: string) => void): void {
	const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "polish-statusline-"));
	try {
		fs.mkdirSync(path.join(cwd, ".pi"), { recursive: true });
		fn(cwd);
	} finally {
		fs.rmSync(cwd, { recursive: true, force: true });
	}
}

test("polish-statusline defaults to enabled codex", () => {
	withTempProject((cwd) => {
		const config = loadMergedPolishStatuslineConfig(cwd);
		assert.equal(config.enabled, true);
		assert.equal(config.variant, "codex");
	});
});

test("polish-statusline project config overrides variant", () => {
	withTempProject((cwd) => {
		const configPath = getProjectConfigPath(cwd);
		fs.mkdirSync(path.dirname(configPath), { recursive: true });
		fs.writeFileSync(
			configPath,
			"polish-statusline:\n  enabled: true\n  variant: compact\n",
			"utf-8",
		);

		const config = loadMergedPolishStatuslineConfig(cwd);
		assert.equal(config.variant, "compact");
	});
});

test("polish-statusline updateProject persists variant across reload simulation", () => {
	withTempProject((cwd) => {
		updateProjectPolishStatuslineConfig(cwd, { variant: "minimal", enabled: true });

		const reloaded = loadMergedPolishStatuslineConfig(cwd);
		assert.equal(reloaded.variant, "minimal");
		assert.equal(reloaded.enabled, true);
	});
});

test("polish-statusline updateProject preserves other config entries", () => {
	withTempProject((cwd) => {
		const configPath = getProjectConfigPath(cwd);
		fs.mkdirSync(path.dirname(configPath), { recursive: true });
		fs.writeFileSync(configPath, "other-extension: true\n", "utf-8");

		updateProjectPolishStatuslineConfig(cwd, { variant: "compact" });

		const raw = fs.readFileSync(configPath, "utf-8");
		assert.match(raw, /other-extension:\s*true/);
		assert.match(raw, /variant:\s*compact/);
	});
});
