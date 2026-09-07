/**
 * Global test setup, loaded via `bun test --preload`.
 *
 * Mirrors the vitest defaults the suite relied on: tests run offline unless
 * they opt out with `allowNetwork()`, and stubbed env vars / globals are
 * restored after every test.
 */
import { afterEach, beforeEach } from "bun:test";
import { restoreTestDoubles } from "./vi.ts";

process.env.PHI_OFFLINE ??= "1";

// Bun runs test files in one process, so unlike vitest workers a direct
// `process.env.X = ...` write in one file leaks into every other file
// (including collection-time skipIf checks). Snapshot and restore the full
// environment around every test to restore per-file isolation.
let savedEnv: Record<string, string | undefined> = {};

beforeEach(() => {
	savedEnv = { ...process.env };
});

afterEach(() => {
	for (const key of Object.keys(process.env)) {
		if (!(key in savedEnv)) delete process.env[key];
	}
	Object.assign(process.env, savedEnv);
	restoreTestDoubles();
});
