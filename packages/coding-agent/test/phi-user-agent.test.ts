import { describe, expect, it } from "vitest";
import { getPhiUserAgent } from "../src/utils/phi-user-agent.ts";

describe("getPhiUserAgent", () => {
	it("formats the user agent expected by pi.dev", () => {
		const runtime = process.versions.bun ? `bun/${process.versions.bun}` : `node/${process.version}`;
		const userAgent = getPhiUserAgent("1.2.3");

		expect(userAgent).toBe(`phi/1.2.3 (${process.platform}; ${runtime}; ${process.arch})`);
		expect(userAgent).toMatch(/^phi\/[^\s()]+ \([^;()]+;\s*[^;()]+;\s*[^()]+\)$/);
	});
});
