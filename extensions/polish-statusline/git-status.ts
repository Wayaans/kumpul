import { spawnSync } from "node:child_process";

export interface GitRepoStatus {
	staged: boolean;
	unstaged: boolean;
	ahead: number;
	behind: number;
}

let gitInstalled: boolean | undefined;

export function isGitInstalled(): boolean {
	if (gitInstalled === undefined) {
		gitInstalled =
			spawnSync("git", ["--version"], {
				encoding: "utf8",
				stdio: ["ignore", "ignore", "ignore"],
			}).status === 0;
	}
	return gitInstalled;
}

/** Reset cached git availability (tests only). */
export function resetGitInstalledCache(): void {
	gitInstalled = undefined;
}

export function parseGitStatusOutput(output: string): GitRepoStatus | null {
	const lines = output.split("\n");
	const header = lines.find((line) => line.startsWith("## "));
	if (!header) return null;

	let staged = false;
	let unstaged = false;

	for (const line of lines) {
		if (!line || line.startsWith("##")) continue;
		if (line.length < 2) continue;
		if (line.startsWith("??")) {
			unstaged = true;
			continue;
		}
		const x = line[0]!;
		const y = line[1]!;
		if (x !== " ") staged = true;
		if (y !== " ") unstaged = true;
	}

	const aheadMatch = /\[ahead (\d+)/.exec(header);
	const behindMatch = /behind (\d+)/.exec(header);

	return {
		staged,
		unstaged,
		ahead: aheadMatch ? Number.parseInt(aheadMatch[1]!, 10) : 0,
		behind: behindMatch ? Number.parseInt(behindMatch[1]!, 10) : 0,
	};
}

export function readGitRepoStatus(cwd: string): GitRepoStatus | null {
	if (!isGitInstalled()) return null;

	const result = spawnSync(
		"git",
		["--no-optional-locks", "status", "--porcelain=v1", "-b", "--no-renames"],
		{
			cwd,
			encoding: "utf8",
			stdio: ["ignore", "pipe", "ignore"],
		},
	);

	if (result.status !== 0 || !result.stdout) return null;
	return parseGitStatusOutput(result.stdout);
}
