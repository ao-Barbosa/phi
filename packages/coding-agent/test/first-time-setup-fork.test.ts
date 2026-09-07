import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { afterEach, beforeEach, describe, expect, it, mock } from "../../../test-support/vi.ts";

import * as configOriginal from "../src/config.ts";

mock.module("../src/config.ts", async () => {
	return {
		...configOriginal,
		PACKAGE_NAME: "@example/pi-coding-agent",
	};
});

import { shouldRunFirstTimeSetup } from "../src/cli/startup-ui.ts";

describe("shouldRunFirstTimeSetup in forked distributions", () => {
	const originalPiExperimental = process.env.PHI_EXPERIMENTAL;
	let tempDir: string;
	let settingsPath: string;

	beforeEach(() => {
		tempDir = mkdtempSync(join(tmpdir(), "phi-first-time-setup-fork-"));
		settingsPath = join(tempDir, "settings.json");
		process.env.PHI_EXPERIMENTAL = "1";
	});

	afterEach(() => {
		rmSync(tempDir, { recursive: true, force: true });
		if (originalPiExperimental === undefined) {
			delete process.env.PHI_EXPERIMENTAL;
		} else {
			process.env.PHI_EXPERIMENTAL = originalPiExperimental;
		}
	});

	it("returns false for a forked package", () => {
		expect(shouldRunFirstTimeSetup(settingsPath)).toBe(false);
	});
});
