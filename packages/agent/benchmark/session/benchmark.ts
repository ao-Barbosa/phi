import { strictEqual } from "node:assert/strict";

export interface BenchOptions {
	readonly time?: number;
	readonly iterations?: number;
	readonly warmupTime?: number;
	readonly warmupIterations?: number;
}

interface PendingBenchmark {
	readonly name: string;
	readonly run: () => Promise<void>;
	readonly options: BenchOptions;
}

const pendingBenchmarks: PendingBenchmark[] = [];

/** Group benchmark output under a heading (minimal bun-native replacement for vitest describe). */
export function describe(name: string, body: () => void): void {
	console.log(`\n## ${name}`);
	body();
}

/** Register a benchmark; collected jobs run when the registering file drains the queue. */
export function bench(name: string, run: () => Promise<void>, options: BenchOptions = {}): void {
	pendingBenchmarks.push({ name, run, options });
}

async function runPendingBenchmarks(): Promise<void> {
	const jobs = pendingBenchmarks.splice(0, pendingBenchmarks.length);
	for (const job of jobs) {
		const warmupIterations = job.options.warmupIterations ?? 0;
		for (let index = 0; index < warmupIterations; index++) await job.run();
		const timeBudget = job.options.time ?? 0;
		const maxIterations = job.options.iterations ?? Number.POSITIVE_INFINITY;
		const deadline = timeBudget > 0 ? performance.now() + timeBudget : Number.POSITIVE_INFINITY;
		let iterations = 0;
		const started = performance.now();
		while (iterations < maxIterations && performance.now() < deadline) {
			await job.run();
			iterations++;
		}
		const elapsed = performance.now() - started;
		const average = iterations > 0 ? elapsed / iterations : 0;
		const ops = elapsed > 0 && iterations > 0 ? (iterations / elapsed) * 1000 : 0;
		console.log(`  ${job.name}: ${iterations} iterations, avg ${average.toFixed(3)} ms/op (${ops.toFixed(1)} ops/sec)`);
	}
}

export interface BenchmarkTarget<TFixture extends AsyncDisposable> {
	readonly name: string;
	createFixture(): Promise<TFixture>;
}

const READ_BENCHMARK_OPTIONS = {
	time: 500,
	iterations: 10,
	warmupTime: 100,
	warmupIterations: 5,
} as const;

const WRITE_BENCHMARK_ITERATIONS = 30;
const WRITE_BENCHMARK_WARMUP_ITERATIONS = 5;

const WRITE_BENCHMARK_OPTIONS = {
	time: 0,
	iterations: WRITE_BENCHMARK_ITERATIONS,
	warmupTime: 0,
	warmupIterations: WRITE_BENCHMARK_WARMUP_ITERATIONS,
} as const;

interface NamedBenchmarkDataset {
	readonly name: string;
}

interface ReadBenchmarkScenario<TSubject, TDataset> {
	readonly name: string;
	expectedResult(dataset: TDataset): number;
	run(subject: TSubject, dataset: TDataset): Promise<number>;
}

interface RegisterReadBenchmarksOptions<
	TDataset extends NamedBenchmarkDataset,
	TFixture extends AsyncDisposable,
	TSubject,
> {
	readonly datasets: readonly TDataset[];
	readonly targets: readonly BenchmarkTarget<TFixture>[];
	readonly scenarios: readonly ReadBenchmarkScenario<TSubject, TDataset>[];
	prepare(fixture: TFixture, dataset: TDataset): Promise<void>;
	getSubject(fixture: TFixture): TSubject;
}

interface PreparedReadFixture<TFixture> {
	readonly datasetName: string;
	readonly targetName: string;
	readonly fixture: TFixture;
}

interface NamedBenchmarkScenario {
	readonly name: string;
}

interface RegisterWriteBenchmarksOptions<
	TScenario extends NamedBenchmarkScenario,
	TFixture extends AsyncDisposable,
	TSubject,
> {
	readonly targets: readonly BenchmarkTarget<TFixture>[];
	readonly scenarios: readonly TScenario[];
	prepare(fixture: TFixture, scenario: TScenario): Promise<TSubject>;
	expectedResult(scenario: TScenario): number;
	run(subject: TSubject, scenario: TScenario): Promise<number>;
}

interface PreparedWriteFixtures<TSubject> {
	readonly scenarioName: string;
	readonly targetName: string;
	readonly pendingSubjects: TSubject[];
}

/** Prepares, validates, registers, and disposes one immutable fixture per target and dataset. */
export async function registerReadBenchmarks<
	TDataset extends NamedBenchmarkDataset,
	TFixture extends AsyncDisposable,
	TSubject,
>(options: RegisterReadBenchmarksOptions<TDataset, TFixture, TSubject>): Promise<void> {
	const fixtures: TFixture[] = [];
	const preparedFixtures: PreparedReadFixture<TFixture>[] = [];

	process.once("beforeExit", async () => {
		await Promise.all(fixtures.map((fixture) => fixture[Symbol.asyncDispose]()));
	});

	for (const dataset of options.datasets) {
		for (const target of options.targets) {
			const fixture = await target.createFixture();
			fixtures.push(fixture);
			await options.prepare(fixture, dataset);
			const subject = options.getSubject(fixture);
			for (const scenario of options.scenarios) {
				strictEqual(await scenario.run(subject, dataset), scenario.expectedResult(dataset));
			}
			preparedFixtures.push({ datasetName: dataset.name, targetName: target.name, fixture });
		}
	}

	for (const dataset of options.datasets) {
		for (const scenario of options.scenarios) {
			describe(`${scenario.name} (${dataset.name})`, () => {
				for (const target of options.targets) {
					const prepared = preparedFixtures.find(
						(candidate) => candidate.datasetName === dataset.name && candidate.targetName === target.name,
					);
					if (prepared === undefined) throw new Error("Benchmark fixture was not initialized");
					const subject = options.getSubject(prepared.fixture);

					bench(
						target.name,
						async () => {
							await scenario.run(subject, dataset);
						},
						READ_BENCHMARK_OPTIONS,
					);
				}
			});
		}
	}

	await runPendingBenchmarks();
}

/** Prepares, validates, registers, and disposes one equivalent fixture per write invocation. */
export async function registerWriteBenchmarks<
	TScenario extends NamedBenchmarkScenario,
	TFixture extends AsyncDisposable,
	TSubject,
>(options: RegisterWriteBenchmarksOptions<TScenario, TFixture, TSubject>): Promise<void> {
	const fixtures: TFixture[] = [];
	const preparedFixtures: PreparedWriteFixtures<TSubject>[] = [];

	process.once("beforeExit", async () => {
		await Promise.all(fixtures.map((fixture) => fixture[Symbol.asyncDispose]()));
	});

	for (const scenario of options.scenarios) {
		for (const target of options.targets) {
			const validationFixture = await target.createFixture();
			fixtures.push(validationFixture);
			const validationSubject = await options.prepare(validationFixture, scenario);
			strictEqual(await options.run(validationSubject, scenario), options.expectedResult(scenario));

			const pendingSubjects: TSubject[] = [];
			for (
				let index = 0;
				index < WRITE_BENCHMARK_WARMUP_ITERATIONS + WRITE_BENCHMARK_ITERATIONS;
				index++
			) {
				const fixture = await target.createFixture();
				fixtures.push(fixture);
				pendingSubjects.push(await options.prepare(fixture, scenario));
			}
			preparedFixtures.push({ scenarioName: scenario.name, targetName: target.name, pendingSubjects });
		}
	}

	for (const scenario of options.scenarios) {
		describe(scenario.name, () => {
			for (const target of options.targets) {
				const prepared = preparedFixtures.find(
					(candidate) => candidate.scenarioName === scenario.name && candidate.targetName === target.name,
				);
				if (prepared === undefined) throw new Error("Benchmark fixtures were not initialized");

				bench(
					target.name,
					async () => {
						const subject = prepared.pendingSubjects.shift();
						if (subject === undefined) throw new Error("Benchmark fixture pool was exhausted");
						await options.run(subject, scenario);
					},
					WRITE_BENCHMARK_OPTIONS,
				);
			}
		});
	}

	await runPendingBenchmarks();
}
