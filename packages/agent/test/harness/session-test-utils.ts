import { existsSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach } from "../../../../test-support/vi.ts";

const tempDirs: string[] = [];

// Test working directory. Absolute POSIX-style cwds resolve to drive-rooted paths
// on Windows, so tests use a drive-rooted cwd there to keep resolution stable.
export const TEST_CWD = process.platform === "win32" ? "C:\\workspace" : "/workspace";
export const TEST_SESSION_DIR = process.platform === "win32" ? "--C--workspace--" : "--workspace--";
export const TEST_CWD_A = `${TEST_CWD}-a`;
export const TEST_CWD_B = `${TEST_CWD}-b`;

export function createTempDir(): string {
	const dir = join(tmpdir(), `phi-agent-session-${Date.now()}-${Math.random().toString(36).slice(2)}`);
	mkdirSync(dir, { recursive: true });
	tempDirs.push(dir);
	return dir;
}

afterEach(() => {
	while (tempDirs.length > 0) {
		const dir = tempDirs.pop()!;
		if (existsSync(dir)) rmSync(dir, { recursive: true, force: true });
	}
});
