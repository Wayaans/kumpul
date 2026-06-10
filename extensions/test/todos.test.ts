import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
	LEGACY_TODO_DIR_NAME,
	TODO_DIR_NAME,
	migrateLegacyTodosDir,
} from "../todos/index.ts";

async function withTempDir(run: (dir: string) => Promise<void>): Promise<void> {
	const dir = await fs.mkdtemp(path.join(os.tmpdir(), "kumpul-todos-"));
	try {
		await run(dir);
	} finally {
		await fs.rm(dir, { recursive: true, force: true });
	}
}

test("migrateLegacyTodosDir moves files from .pi/todos to docs/todos", async () => {
	await withTempDir(async (cwd) => {
		const legacyDir = path.join(cwd, LEGACY_TODO_DIR_NAME);
		const todosDir = path.join(cwd, TODO_DIR_NAME);
		await fs.mkdir(legacyDir, { recursive: true });
		await fs.writeFile(path.join(legacyDir, "abc12345.md"), "todo content");
		await fs.writeFile(path.join(legacyDir, "settings.json"), '{"gc":false}');

		await migrateLegacyTodosDir(cwd, todosDir);

		assert.equal(await fs.readFile(path.join(todosDir, "abc12345.md"), "utf8"), "todo content");
		assert.equal(await fs.readFile(path.join(todosDir, "settings.json"), "utf8"), '{"gc":false}');
		await assert.rejects(() => fs.access(path.join(legacyDir, "abc12345.md")));
	});
});

test("migrateLegacyTodosDir skips when PI_TODO_PATH is set", async () => {
	const previous = process.env.PI_TODO_PATH;
	process.env.PI_TODO_PATH = "custom/todos";

	try {
		await withTempDir(async (cwd) => {
			const legacyDir = path.join(cwd, LEGACY_TODO_DIR_NAME);
			const customDir = path.join(cwd, "custom/todos");
			await fs.mkdir(legacyDir, { recursive: true });
			await fs.writeFile(path.join(legacyDir, "abc12345.md"), "todo content");

			await migrateLegacyTodosDir(cwd, customDir);

			assert.equal(await fs.readFile(path.join(legacyDir, "abc12345.md"), "utf8"), "todo content");
			await assert.rejects(() => fs.access(path.join(customDir, "abc12345.md")));
		});
	} finally {
		if (previous === undefined) {
			delete process.env.PI_TODO_PATH;
		} else {
			process.env.PI_TODO_PATH = previous;
		}
	}
});

test("migrateLegacyTodosDir does not overwrite existing destination files", async () => {
	await withTempDir(async (cwd) => {
		const legacyDir = path.join(cwd, LEGACY_TODO_DIR_NAME);
		const todosDir = path.join(cwd, TODO_DIR_NAME);
		await fs.mkdir(legacyDir, { recursive: true });
		await fs.mkdir(todosDir, { recursive: true });
		await fs.writeFile(path.join(legacyDir, "abc12345.md"), "legacy");
		await fs.writeFile(path.join(todosDir, "abc12345.md"), "current");

		await migrateLegacyTodosDir(cwd, todosDir);

		assert.equal(await fs.readFile(path.join(todosDir, "abc12345.md"), "utf8"), "current");
		assert.equal(await fs.readFile(path.join(legacyDir, "abc12345.md"), "utf8"), "legacy");
	});
});
