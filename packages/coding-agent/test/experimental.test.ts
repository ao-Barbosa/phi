import { afterEach, describe, expect, it } from "vitest";
import { areExperimentalFeaturesEnabled } from "../src/core/experimental.ts";

describe("areExperimentalFeaturesEnabled", () => {
	const originalPiExperimental = process.env.PHI_EXPERIMENTAL;

	afterEach(() => {
		if (originalPiExperimental === undefined) {
			delete process.env.PHI_EXPERIMENTAL;
		} else {
			process.env.PHI_EXPERIMENTAL = originalPiExperimental;
		}
	});

	it("returns false when PHI_EXPERIMENTAL is unset", () => {
		delete process.env.PHI_EXPERIMENTAL;

		expect(areExperimentalFeaturesEnabled()).toBe(false);
	});

	it("returns false when PHI_EXPERIMENTAL is empty", () => {
		process.env.PHI_EXPERIMENTAL = "";

		expect(areExperimentalFeaturesEnabled()).toBe(false);
	});

	it("returns true when PHI_EXPERIMENTAL is set to 1", () => {
		process.env.PHI_EXPERIMENTAL = "1";

		expect(areExperimentalFeaturesEnabled()).toBe(true);
	});

	it("returns false when PHI_EXPERIMENTAL is set to 0", () => {
		process.env.PHI_EXPERIMENTAL = "0";

		expect(areExperimentalFeaturesEnabled()).toBe(false);
	});

	it("returns false when PHI_EXPERIMENTAL is set to a non-1 value", () => {
		process.env.PHI_EXPERIMENTAL = "true";

		expect(areExperimentalFeaturesEnabled()).toBe(false);
	});
});
