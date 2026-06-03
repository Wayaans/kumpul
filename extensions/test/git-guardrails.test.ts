import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { parse, stringify } from "yaml";
import {
	loadMergedGitGuardrailsConfig,
	updateProjectGitGuardrailsEnabled,
} from "../git-guardrails/config.ts";
import { findDangerousGitPattern } from "../git-guardrails/patterns.ts";
import {
	buildGitGuardrailsStatusSummary,
	createGitGuardrailsStatusMessage,
	GIT_GUARDRAILS_STATUS_MESSAGE_TYPE,
} from "../git-guardrails/renderer.ts";

test("git-guardrails defaults to disabled", () => {
	const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "kumpul-git-guardrails-default-"));
	const config = loadMergedGitGuardrailsConfig(cwd);

	assert.equal(config.enabled, false);
});

test("git-guardrails merges project overrides from array and legacy keys", () => {
	const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "kumpul-git-guardrails-project-"));
	fs.mkdirSync(path.join(cwd, ".pi", "kumpul"), { recursive: true });
	const configPath = path.join(cwd, ".pi", "kumpul", "config.yaml");

	fs.writeFileSync(configPath, stringify([{ extension: "git-guardrails", enabled: true }]), "utf-8");
	assert.equal(loadMergedGitGuardrailsConfig(cwd).enabled, true);

	fs.writeFileSync(configPath, stringify({ gitGuardrails: { enabled: false } }), "utf-8");
	assert.equal(loadMergedGitGuardrailsConfig(cwd).enabled, false);
});

test("git-guardrails project writes preserve other config entries", () => {
	const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "kumpul-git-guardrails-write-"));
	fs.mkdirSync(path.join(cwd, ".pi", "kumpul"), { recursive: true });
	const configPath = path.join(cwd, ".pi", "kumpul", "config.yaml");

	fs.writeFileSync(
		configPath,
		stringify({
			handoff: { enabled: true },
			"find-docs": { enabled: false },
		}),
		"utf-8",
	);

	const saved = updateProjectGitGuardrailsEnabled(cwd, true);
	assert.equal(saved.saved.enabled, true);

	const parsed = parse(fs.readFileSync(configPath, "utf-8")) as Record<string, unknown>;
	assert.deepEqual(parsed.handoff, { enabled: true });
	assert.deepEqual(parsed["find-docs"], { enabled: false });
	assert.deepEqual(parsed["git-guardrails"], { enabled: true });
});

test("git-guardrails project writes replace prior git-guardrails array entries", () => {
	const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "kumpul-git-guardrails-array-"));
	fs.mkdirSync(path.join(cwd, ".pi", "kumpul"), { recursive: true });
	const configPath = path.join(cwd, ".pi", "kumpul", "config.yaml");

	fs.writeFileSync(
		configPath,
		stringify([
			{ extension: "git-guardrails", enabled: false },
			{ extension: "handoff", enabled: true },
		]),
		"utf-8",
	);

	updateProjectGitGuardrailsEnabled(cwd, true);

	const parsed = parse(fs.readFileSync(configPath, "utf-8")) as Array<Record<string, unknown>>;
	const gitEntries = parsed.filter((entry) => entry.extension === "git-guardrails");
	assert.equal(gitEntries.length, 1);
	assert.equal(gitEntries[0]?.enabled, true);
	assert.equal(parsed.some((entry) => entry.extension === "handoff" && entry.enabled === true), true);
});

test("git-guardrails detects dangerous git commands and ignores safe ones", () => {
	assert.equal(findDangerousGitPattern("git push origin main")?.label, "git push");
	assert.equal(findDangerousGitPattern("git status && git reset --hard HEAD~1")?.label, "git reset --hard");
	assert.equal(findDangerousGitPattern("git clean -fdx")?.label, "git clean -f / -fd / --force");
	assert.equal(findDangerousGitPattern("git branch -D feature")?.label, "git branch -D");
	assert.equal(findDangerousGitPattern("sudo git push origin main")?.label, "git push");
	assert.equal(findDangerousGitPattern("bash -lc \"git push origin main\"")?.label, "git push");
	assert.equal(findDangerousGitPattern("git status"), null);
	assert.equal(findDangerousGitPattern("printf 'git push'"), null);
});

test("git-guardrails status summary shows enabled state and reload info", () => {
	const summary = buildGitGuardrailsStatusSummary({
		enabled: true,
		configPath: "/tmp/.pi/kumpul/config.yaml",
		reloading: true,
	});

	assert.match(summary, /\/guardrails:git/);
	assert.match(summary, /state: enabled/);
	assert.match(summary, /dangerous git bash commands are blocked/);
	assert.match(summary, /reloading now so the new state applies immediately/);
});

test("git-guardrails status message uses the persistent custom message payload", () => {
	const details = {
		enabled: true,
		configPath: "/tmp/.pi/kumpul/config.yaml",
		reloading: false,
	} as const;

	const message = createGitGuardrailsStatusMessage(details);

	assert.equal(message.customType, GIT_GUARDRAILS_STATUS_MESSAGE_TYPE);
	assert.equal(message.display, true);
	assert.equal(message.details, details);
	assert.match(String(message.content), /state: enabled/);
});
