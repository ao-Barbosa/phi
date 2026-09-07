import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { RunnerTestCase } from "vitest";
import { expect, it } from "../../../../test-support/vi.ts";
import {
	persistEvalArtifactReferences,
	type RecordArtifactFn,
	recordEvalSessionArtifact,
	recordEvalSourceArtifact,
} from "../../src/vitest-evals/artifacts.ts";

// Bun has no vitest task context: collect records onto the fake task instead.
function createRecorder(): RecordArtifactFn {
	return (task, artifact): Promise<void> => {
		(task as unknown as { artifacts: unknown[] }).artifacts.push(artifact);
		return Promise.resolve();
	};
}

function createTask(): RunnerTestCase & { artifacts: unknown[] } {
	return { artifacts: [] } as unknown as RunnerTestCase & { artifacts: unknown[] };
}

it("records session and source artifacts against the explicit test task", async () => {
	const task = createTask();
	const record = createRecorder();
	const runId = "run-1";
	await recordEvalSessionArtifact(
		task,
		{
			artifacts: { runId, piSessionJsonl: '{"type":"session"}\n' },
		},
		record,
	);
	await recordEvalSourceArtifact(
		task,
		runId,
		{
			name: "hello.ts",
			contentType: "text/typescript",
			body: "export default function () {}\n",
			bodyEncoding: "utf-8",
		},
		record,
	);

	expect(task.artifacts).toContainEqual(
		expect.objectContaining({
			type: "@ao-barbosa/phi-evals:session",
			runId,
			attachments: [
				expect.objectContaining({
					name: "session.jsonl",
					body: '{"type":"session"}\n',
					bodyEncoding: "utf-8",
					contentType: "application/jsonl",
				}),
			],
		}),
	);
	expect(task.artifacts).toContainEqual(
		expect.objectContaining({
			type: "@ao-barbosa/phi-evals:source",
			runId,
			attachments: [
				expect.objectContaining({
					name: "hello.ts",
					body: "export default function () {}\n",
					bodyEncoding: "utf-8",
					contentType: "text/typescript",
				}),
			],
		}),
	);
});

it("persists and selects attachments belonging to the reported run", async () => {
	const root = await mkdtemp(join(tmpdir(), "phi-eval-artifact-report-test-"));
	try {
		const references = await persistEvalArtifactReferences(
			[
				{
					type: "@ao-barbosa/phi-evals:session",
					runId: "run-1",
					attachments: [
						{
							name: "session.jsonl",
							body: '{"type":"session"}\n',
							bodyEncoding: "utf-8",
							contentType: "application/jsonl",
						},
					],
				},
				{
					type: "@ao-barbosa/phi-evals:session",
					runId: "run-2",
					attachments: [],
				},
				{
					type: "@ao-barbosa/phi-evals:source",
					runId: "run-1",
					attachments: [
						{
							name: "hello.ts",
							body: "export default function () {}\n",
							bodyEncoding: "utf-8",
							contentType: "text/typescript",
						},
					],
				},
				{ type: "internal:annotation", annotation: { message: "other", type: "info" } },
			],
			"run-1",
			root,
		);
		expect(references).toEqual([
			{ name: "session.jsonl", path: expect.stringMatching(/^sessions[\\/][a-f0-9]{64}[\\/]session\.jsonl$/) },
			{ name: "hello.ts", path: expect.stringMatching(/^sources[\\/][a-f0-9]{64}[\\/]hello\.ts$/) },
		]);
		for (const { name, path } of references) {
			const expected = name === "session.jsonl" ? '{"type":"session"}\n' : "export default function () {}\n";
			expect(await readFile(join(root, path), "utf8")).toBe(expected);
		}
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});
