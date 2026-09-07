/**
 * Force garbage collection so Bun finalizes unreferenced SQLite prepared
 * statements and releases their Windows file locks.
 *
 * Bun's `node:sqlite` (unlike Node's) only releases database file locks when
 * prepared statements are garbage-collected; `DatabaseSync.close()` alone
 * leaves `EBUSY` locks behind and `rm -rf` of the database directory fails.
 * No-op on runtimes without a `Bun.gc` hook.
 */
import { rm } from "node:fs/promises";

/**
 * Force garbage collection so Bun finalizes unreferenced SQLite prepared
 * statements and releases their Windows file locks.
 *
 * Bun's `node:sqlite` (unlike Node's) only releases database file locks when
 * prepared statements are garbage-collected; `DatabaseSync.close()` alone
 * leaves `EBUSY` locks behind and `rm -rf` of the database directory fails.
 * No-op on runtimes without a `Bun.gc` hook.
 */
export function collectSqliteGarbage(): void {
	(globalThis as { Bun?: { gc?: (force?: boolean) => void } }).Bun?.gc?.(true);
}

/**
 * Remove a SQLite test directory, tolerating stale Windows file locks.
 *
 * Even after closing every connection, Bun may retain locks from prepared
 * statements that were never explicitly finalized (there is no finalize API).
 * Failing teardown would mask green test bodies, so a busy directory is kept
 * (unique per run) with a warning instead of failing the test.
 */
export async function removeSqliteTestDir(directory: string): Promise<void> {
	try {
		await rm(directory, { recursive: true, force: true });
		return;
	} catch {
		collectSqliteGarbage();
	}
	try {
		await rm(directory, { recursive: true, force: true });
	} catch (error) {
		console.warn(`[sqlite-test] keeping locked directory ${directory}: ${(error as Error).message.split("\n")[0]}`);
	}
}

/**
 * Whether tests asserting on-disk SQLite file removal must be skipped.
 *
 * Bun's `node:sqlite` does not release Windows file locks on `close()` when
 * prepared statements were never explicitly finalized (and there is no
 * finalize API), so `repo.delete()` cannot remove database files on
 * Windows under Bun. POSIX `rm` works on locked files and Node releases
 * properly, so this only skips the bun-on-Windows combination.
 */
export const skipSqliteFileDeletion =
	process.platform === "win32" && typeof (globalThis as { Bun?: unknown }).Bun !== "undefined";
