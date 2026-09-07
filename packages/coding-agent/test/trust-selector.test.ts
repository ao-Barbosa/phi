import { setKeybindings } from "@ao-barbosa/phi-tui";
import { beforeAll, beforeEach, describe, expect, it, vi } from "../../../test-support/vi.ts";
import { KeybindingsManager } from "../src/core/keybindings.ts";
import { TrustSelectorComponent } from "../src/modes/interactive/components/trust-selector.ts";
import { initTheme } from "../src/modes/interactive/theme/theme.ts";
import { stripAnsi } from "../src/utils/ansi.ts";

const TRUST_PROJECT = process.platform === "win32" ? "C:\\project" : "/project";
const TRUST_PARENT = process.platform === "win32" ? "C:\\parent" : "/parent";
const TRUST_PARENT_PROJECT = process.platform === "win32" ? "C:\\parent\\project" : "/parent/project";
const TRUST_NESTED = process.platform === "win32" ? "C:\\parent\\project\\nested" : "/parent/project/nested";
const TRUST_ROOT = process.platform === "win32" ? "C:\\" : "/";

describe("TrustSelectorComponent", () => {
	beforeAll(() => {
		initTheme("dark");
	});

	beforeEach(() => {
		setKeybindings(new KeybindingsManager());
	});

	it("keeps the saved trusted decision marked while browsing", () => {
		const selector = new TrustSelectorComponent({
			cwd: TRUST_PROJECT,
			savedDecision: { path: TRUST_PROJECT, decision: true },
			projectTrusted: true,
			onSelect: () => {},
			onCancel: () => {},
		});

		let output = stripAnsi(selector.render(120).join("\n"));
		expect(output).toContain(`Saved decision: trusted (${TRUST_PROJECT})`);
		expect(output).toContain("Current session: trusted");
		expect(output).toContain("→ ✓ Trust");

		selector.handleInput("\x1b[B");
		output = stripAnsi(selector.render(120).join("\n"));
		expect(output).toContain("✓ Trust");
		expect(output).toContain("→   Trust parent folder (" + TRUST_ROOT + ")");
		expect(output).not.toContain("✓ Do not trust");
	});

	it("selects a trust decision", () => {
		const onSelect = vi.fn();
		const selector = new TrustSelectorComponent({
			cwd: TRUST_PROJECT,
			savedDecision: null,
			projectTrusted: false,
			onSelect,
			onCancel: () => {},
		});

		selector.handleInput("\n");

		expect(onSelect).toHaveBeenCalledWith({ trusted: true, updates: [{ path: TRUST_PROJECT, decision: true }] });
	});

	it("labels saved ancestor decisions as inherited", () => {
		const selector = new TrustSelectorComponent({
			cwd: TRUST_NESTED,
			savedDecision: { path: TRUST_PARENT, decision: true },
			projectTrusted: true,
			onSelect: () => {},
			onCancel: () => {},
		});

		const output = stripAnsi(selector.render(120).join("\n"));

		expect(output).toContain("Saved decision: trusted (inherited from " + TRUST_PARENT + ")");
	});

	it("adds a trust parent option", () => {
		const onSelect = vi.fn();
		const selector = new TrustSelectorComponent({
			cwd: TRUST_PARENT_PROJECT,
			savedDecision: { path: TRUST_PARENT, decision: true },
			projectTrusted: true,
			onSelect,
			onCancel: () => {},
		});

		const output = stripAnsi(selector.render(120).join("\n"));
		expect(output).toContain("Saved decision: trusted (inherited from " + TRUST_PARENT + ")");
		expect(output).toContain("✓ Trust parent folder (" + TRUST_PARENT + ")");

		selector.handleInput("\n");

		expect(onSelect).toHaveBeenCalledWith({
			trusted: true,
			updates: [
				{ path: TRUST_PARENT, decision: true },
				{ path: TRUST_PARENT_PROJECT, decision: null },
			],
		});
	});
});
