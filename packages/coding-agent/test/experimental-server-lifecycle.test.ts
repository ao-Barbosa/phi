import { afterEach, describe, expect, test, vi } from "../../../test-support/vi.ts";
import { ServerLifetime } from "../src/experimental/server.ts";

afterEach(() => {
	vi.useRealTimers();
});

describe("server lifecycle", () => {
	test("holds a foreground server until explicit shutdown", () => {
		vi.useFakeTimers();
		const retire = vi.fn();
		const lifetime = new ServerLifetime(true);
		lifetime.start(retire);
		vi.advanceTimersByTime(60_000);
		expect(retire).not.toHaveBeenCalled();
		lifetime.stop();
	});

	test("retires an automatic server if no first client arrives", () => {
		vi.useFakeTimers();
		const retire = vi.fn();
		const lifetime = new ServerLifetime(false);
		lifetime.start(retire);
		vi.advanceTimersByTime(10_999);
		expect(retire).not.toHaveBeenCalled();
		vi.advanceTimersByTime(1);
		expect(retire).toHaveBeenCalledTimes(1);
		lifetime.stop();
	});

	test("requires both client and worker demand to disappear", () => {
		vi.useFakeTimers();
		const retire = vi.fn();
		const lifetime = new ServerLifetime(false);
		lifetime.start(retire);
		lifetime.setConnectionCount(1);
		lifetime.setWorkerCount(1);
		lifetime.setConnectionCount(0);
		vi.advanceTimersByTime(10_000);
		expect(retire).not.toHaveBeenCalled();

		lifetime.setWorkerCount(0);
		vi.advanceTimersByTime(999);
		expect(retire).not.toHaveBeenCalled();
		vi.advanceTimersByTime(1);
		expect(retire).toHaveBeenCalledTimes(1);
		lifetime.stop();
	});
});
