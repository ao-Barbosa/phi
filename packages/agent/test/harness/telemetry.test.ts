import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createTypedSpanStarter, NOOP_TELEMETRY_CONTEXT, type TelemetryContext } from "@ao-barbosa/phi-telemetry";
import { describe, expect, expectTypeOf, it } from "../../../../test-support/vi.ts";
import { renderAgentTelemetrySchemaMarkdown } from "../../scripts/generate-telemetry-docs.ts";
import { BACKGROUND_CONTEXT, withTelemetryContext } from "../../src/harness/context.ts";
import {
	AGENT_TELEMETRY_SCHEMAS,
	AI_TELEMETRY_SCHEMA,
	type AiSpanEndAttributes,
	type AiSpanStartAttributes,
	HARNESS_TELEMETRY_SCHEMA,
	type HarnessSpanEndAttributes,
	type HarnessSpanStartAttributes,
	startAiSpan,
	startHarnessSpan,
} from "../../src/harness/telemetry.ts";

describe("agent telemetry schemas", () => {
	it("serializes both schemas and generates the checked-in reference", () => {
		expect(() => JSON.stringify(AI_TELEMETRY_SCHEMA)).not.toThrow();
		expect(() => JSON.stringify(HARNESS_TELEMETRY_SCHEMA)).not.toThrow();
		expect(AGENT_TELEMETRY_SCHEMAS).toEqual([AI_TELEMETRY_SCHEMA, HARNESS_TELEMETRY_SCHEMA]);
		expect(Object.keys(HARNESS_TELEMETRY_SCHEMA.spans)).toEqual([
			"phi.harness.run",
			"phi.harness.compaction",
			"phi.harness.navigation",
			"phi.harness.checkpoint",
			"phi.harness.turn",
			"phi.harness.step",
			"phi.harness.tool",
			"phi.harness.hook",
			"phi.harness.sleep",
			"phi.harness.event_handler",
			"phi.session.write",
		]);
		const actual = readFileSync(resolve(import.meta.dirname, "../../docs/telemetry-schema.md"), "utf8");
		expect(actual).toBe(renderAgentTelemetrySchemaMarkdown());
	});

	it("starts AI-request and harness spans through one composed typed starter", async () => {
		const startSpan = createTypedSpanStarter(NOOP_TELEMETRY_CONTEXT, AGENT_TELEMETRY_SCHEMAS);
		await startSpan(
			"phi.harness.step",
			{
				"phi.lane.name": "main",
				"phi.operation.id": "operation",
				"phi.step.kind": "assistant",
				"phi.step.attempt": 1,
			},
			async (stepSpan, startChildSpan) => {
				stepSpan.setAttributes({ "phi.step.outcome": "succeeded" });
				await startChildSpan(
					"phi.ai.request",
					{
						"phi.ai.operation": "stream",
						"phi.ai.provider": "provider",
						"phi.ai.model": "model",
						"phi.ai.api": "api",
						"phi.ai.streaming": true,
					},
					(requestSpan) => {
						requestSpan.setAttributes({ "phi.ai.response.stop_reason": "stop" });
					},
				);
			},
		);
	});

	it("infers exact AI start and optional end attributes", async () => {
		type Start = AiSpanStartAttributes<"phi.ai.request">;
		type End = AiSpanEndAttributes<"phi.ai.request">;
		expectTypeOf<Start>().toMatchTypeOf<{
			"phi.ai.operation": "stream" | "fetch_deferred" | "cancel_deferred" | "generate_images";
			"phi.ai.provider": string;
			"phi.ai.model": string;
			"phi.ai.api": string;
			"phi.ai.streaming": boolean;
			"phi.ai.deferred"?: boolean;
		}>();
		expectTypeOf<End["phi.ai.response.stop_reason"]>().toEqualTypeOf<
			"stop" | "length" | "tool_use" | "error" | "aborted" | "deferred" | undefined
		>();

		const telemetryContext: TelemetryContext = NOOP_TELEMETRY_CONTEXT;
		const context = withTelemetryContext(telemetryContext, BACKGROUND_CONTEXT);
		await startAiSpan(
			"phi.ai.request",
			{
				"phi.ai.operation": "stream",
				"phi.ai.provider": "provider",
				"phi.ai.model": "model",
				"phi.ai.api": "api",
				"phi.ai.streaming": true,
			},
			(span) => {
				span.setAttributes({ "phi.ai.response.stop_reason": "tool_use" });
				// @ts-expect-error pi.ai.request declares no span events
				span.addEvent("chunk");
			},
			context,
		);

		const compileTimeFailures = () => {
			const extraAttributes = {
				"phi.ai.operation": "stream",
				"phi.ai.provider": "provider",
				"phi.ai.model": "model",
				"phi.ai.api": "api",
				"phi.ai.streaming": true,
				"phi.ai.unknown": true,
			} as const;
			// @ts-expect-error variables with unknown attributes are rejected
			void startAiSpan("phi.ai.request", extraAttributes, () => {}, context);
			// @ts-expect-error missing required start attributes
			void startAiSpan("phi.ai.request", { "phi.ai.operation": "stream" }, () => {}, context);
		};
		expectTypeOf(compileTimeFailures).toBeFunction();
	});

	it("infers per-span harness literals and optional completion enrichment", async () => {
		type RunStart = HarnessSpanStartAttributes<"phi.harness.run">;
		type RunEnd = HarnessSpanEndAttributes<"phi.harness.run">;
		type WriteStart = HarnessSpanStartAttributes<"phi.session.write">;
		type WriteEnd = HarnessSpanEndAttributes<"phi.session.write">;
		expectTypeOf<RunStart["phi.operation.kind"]>().toEqualTypeOf<"run">();
		expectTypeOf<RunEnd["phi.operation.outcome"]>().toEqualTypeOf<
			"completed" | "aborted" | "failed" | "suspended" | undefined
		>();
		const writeStart = {
			"phi.session.id": "session",
			"phi.session.item_count": 2,
			"phi.session.item_kinds": ["entry", "value", "list"],
		} satisfies WriteStart;
		const writeEnd = {
			"phi.session.first_seq": 1,
			"phi.session.last_seq": 2,
		} satisfies WriteEnd;
		expectTypeOf(writeStart["phi.session.item_count"]).toEqualTypeOf<number>();
		expectTypeOf(writeEnd["phi.session.last_seq"]).toEqualTypeOf<number>();

		const telemetryContext: TelemetryContext = NOOP_TELEMETRY_CONTEXT;
		const context = withTelemetryContext(telemetryContext, BACKGROUND_CONTEXT);
		await startHarnessSpan(
			"phi.harness.run",
			{
				"phi.session.id": "session",
				"phi.lane.name": "main",
				"phi.operation.id": "operation",
				"phi.operation.kind": "run",
				"phi.operation.recovery": false,
			},
			(span) => {
				span.setAttributes({ "phi.operation.outcome": "completed" });
				span.setAttributes({});
				// @ts-expect-error the harness schema declares no span events
				span.addEvent("result");
			},
			context,
		);

		const compileTimeFailures = () => {
			const extraRunAttributes = {
				"phi.session.id": "session",
				"phi.lane.name": "main",
				"phi.operation.id": "operation",
				"phi.operation.kind": "run",
				"phi.operation.recovery": false,
				"phi.unknown": true,
			} as const;
			// @ts-expect-error variables with unknown attributes are rejected
			void startHarnessSpan("phi.harness.run", extraRunAttributes, () => {}, context);
			void startHarnessSpan(
				"phi.harness.checkpoint",
				{
					"phi.lane.name": "main",
					"phi.operation.id": "operation",
					"phi.checkpoint.kind": "normal",
				},
				(span) => {
					// @ts-expect-error empty end schemas reject every attribute
					span.setAttributes({ "phi.unknown": true });
				},
				context,
			);
			void startHarnessSpan(
				"phi.harness.run",
				{
					"phi.session.id": "session",
					"phi.lane.name": "main",
					"phi.operation.id": "operation",
					// @ts-expect-error run spans accept only the run operation kind
					"phi.operation.kind": "navigation",
					"phi.operation.recovery": false,
				},
				() => {},
				context,
			);
			// @ts-expect-error missing required run start attributes
			void startHarnessSpan("phi.harness.run", {}, () => {}, context);
		};
		expectTypeOf(compileTimeFailures).toBeFunction();
	});
});
