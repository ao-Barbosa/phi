import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { describe, expect, it } from "../../../test-support/vi.ts";

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = resolve(packageRoot, "..", "..");
const aiEntry = resolve(packageRoot, "src/index.ts");
const compatEntry = resolve(packageRoot, "src/compat.ts");
const providersAllEntry = resolve(packageRoot, "src/providers/all.ts");
const anthropicMessagesEntry = resolve(packageRoot, "src/api/anthropic-messages.ts");

const SDK_PACKAGES = ["@anthropic-ai/sdk", "openai", "@google/genai", "@aws-sdk/client-bedrock-runtime"] as const;

function sdkPackageFor(specifier: string): string | undefined {
	return SDK_PACKAGES.find((sdk) => specifier === sdk || specifier.startsWith(`${sdk}/`));
}

interface ImportGraph {
	/** Static (`import`/`require`) edges: from input path to imported specifiers/paths. */
	staticEdges: Map<string, string[]>;
	/** Dynamic (`import()`) edges: from input path to imported specifiers/paths. */
	dynamicEdges: Map<string, string[]>;
}

const graphCache = new Map<string, ImportGraph>();

async function analyzeEntry(entry: string): Promise<ImportGraph> {
	const cached = graphCache.get(entry);
	if (cached) return cached;
	const result = await build({
		entryPoints: [entry],
		bundle: true,
		write: false,
		metafile: true,
		packages: "external",
		platform: "node",
		format: "esm",
		absWorkingDir: repoRoot,
		logLevel: "silent",
	});
	const graph: ImportGraph = { staticEdges: new Map(), dynamicEdges: new Map() };
	const metafile = result.metafile;
	if (!metafile) throw new Error(`esbuild metafile missing for ${entry}`);
	for (const [inputPath, input] of Object.entries(metafile.inputs)) {
		for (const imported of input.imports) {
			const edges = imported.kind === "dynamic-import" ? graph.dynamicEdges : graph.staticEdges;
			const existing = edges.get(inputPath) ?? [];
			existing.push(imported.path);
			edges.set(inputPath, existing);
		}
	}
	graphCache.set(entry, graph);
	return graph;
}

/** Specifiers reachable from entry inputs following static edges only. */
function staticClosure(graph: ImportGraph, entry: string): Set<string> {
	const seen = new Set<string>();
	const queue = [entry];
	while (queue.length > 0) {
		const current = queue.pop() as string;
		const normalized = current.replaceAll("\\", "/");
		const key = [...graph.staticEdges.keys()].find(
			(inputPath) => normalized === inputPath || normalized.endsWith(`/${inputPath}`),
		);
		if (key === undefined || seen.has(key)) continue;
		seen.add(key);
		for (const next of graph.staticEdges.get(key) ?? []) {
			if (!next.startsWith(".") && !next.startsWith("/") && !next.startsWith("node:")) {
				seen.add(next);
				continue;
			}
			queue.push(next);
		}
	}
	return seen;
}

function staticSdkPackages(graph: ImportGraph, entry: string): string[] {
	const closure = staticClosure(graph, entry);
	const found = new Set<string>();
	for (const specifier of closure) {
		const sdk = sdkPackageFor(specifier);
		if (sdk) found.add(sdk);
	}
	return [...found].sort();
}

describe("lazy provider module loading", () => {
	it("does not load provider SDKs when importing the root barrel", async () => {
		const graph = await analyzeEntry(aiEntry);
		expect(staticSdkPackages(graph, aiEntry)).toEqual([]);
	});

	it("does not load provider SDKs when building all builtin providers", async () => {
		const graph = await analyzeEntry(providersAllEntry);
		expect(staticSdkPackages(graph, providersAllEntry)).toEqual([]);
	});

	it("does not load provider SDKs when importing the compat entrypoint", async () => {
		const graph = await analyzeEntry(compatEntry);
		expect(staticSdkPackages(graph, compatEntry)).toEqual([]);
	});

	it("loads only the Anthropic SDK when streaming through the lazy API wrapper", async () => {
		const graph = await analyzeEntry(anthropicMessagesEntry);
		expect(staticSdkPackages(graph, anthropicMessagesEntry)).toEqual(["@anthropic-ai/sdk"]);
	});

	it("loads only the Anthropic SDK when dispatching through streamSimple", async () => {
		const graph = await analyzeEntry(anthropicMessagesEntry);
		expect(staticSdkPackages(graph, anthropicMessagesEntry)).toEqual(["@anthropic-ai/sdk"]);
	});
});
