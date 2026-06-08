import assert from "node:assert/strict";
import test from "node:test";
import { parseGitStatusOutput } from "../polish-statusline/git-status.ts";

test("parseGitStatusOutput — clean branch", () => {
	const status = parseGitStatusOutput("## main...origin/main\n");
	assert.ok(status);
	assert.equal(status.staged, false);
	assert.equal(status.unstaged, false);
	assert.equal(status.ahead, 0);
	assert.equal(status.behind, 0);
});

test("parseGitStatusOutput — staged, unstaged, ahead, behind", () => {
	const output = [
		"## feature...origin/feature [ahead 2, behind 1]",
		"M  staged.ts",
		" M unstaged.ts",
		"?? new.ts",
	].join("\n");
	const status = parseGitStatusOutput(output);
	assert.ok(status);
	assert.equal(status.staged, true);
	assert.equal(status.unstaged, true);
	assert.equal(status.ahead, 2);
	assert.equal(status.behind, 1);
});

test("parseGitStatusOutput — detached HEAD", () => {
	const status = parseGitStatusOutput("## HEAD (no branch)\n");
	assert.ok(status);
	assert.equal(status.ahead, 0);
	assert.equal(status.behind, 0);
});

test("parseGitStatusOutput — invalid output", () => {
	assert.equal(parseGitStatusOutput("not git status\n"), null);
});
