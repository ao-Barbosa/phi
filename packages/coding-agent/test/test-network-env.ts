import { vi } from "../../../test-support/vi.ts";

/** Enable network code paths for tests that replace external I/O with local fixtures or mocks. */
export function allowNetwork(): void {
	vi.stubEnv("PHI_OFFLINE", undefined);
}
