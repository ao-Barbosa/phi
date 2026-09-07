import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";


/**
 * Normalizes shell-reported paths for cross-platform assertions.
 *
 * MSYS shells (Git Bash) report the temp tree as `/tmp/...` regardless of its
 * Windows location, and use forward slashes. `normalizeShellPath` maps such a
 * value back onto the shell's /tmp mount so tests can compare it against
 * `realpath`/`canonicalPath` results. Non-shell values pass through (slashes
 * still normalized) so the helper is safe to apply unconditionally.
 */
export function normalizeShellPath(shellPath: string): string {
	const posixPath = shellPath.replace(/\\/g, "/");
	if (posixPath === "/tmp" || posixPath.startsWith("/tmp/")) {
		return shellTmpRoot() + posixPath.slice(4);
	}
	return posixPath;
}

// Cached Windows form of the shell's /tmp mount (static per process).
let cachedShellTmpRoot: string | undefined;
function shellTmpRoot(): string {
	if (cachedShellTmpRoot === undefined) {
		try {
			cachedShellTmpRoot = execFileSync("cygpath", ["-w", "/tmp"], { encoding: "utf8" }).trim().replace(/\\/g, "/");
		} catch {
			cachedShellTmpRoot = toPosixPath(tmpdir());
		}
	}
	return cachedShellTmpRoot;
}
/** Renders a Windows path with forward slashes for comparison with shell output. */
export function toPosixPath(windowsPath: string): string {
	return windowsPath.replace(/\\/g, "/");
}
