/// <reference path="../node_modules/bun-types/test.d.ts" />
/**
 * Minimal `vi` compatibility facade over `bun:test`.
 *
 * Every test file imports its runner API from here instead of `vitest`
 * (see the 2.4 codemod). `describe`/`it`/`test`/`expect`/hooks are
 * re-exported unchanged; only `vi` and `expect.poll` are implemented locally.
 *
 * Fake-timer state is tracked so `waitFor`, `expect.poll`, and the async
 * timer advancers behave under both real and fake timers. `vi.mock` is
 * intentionally absent: use `mock.module` plus a dynamic import instead.
 */
import {
	afterAll,
	afterEach,
	beforeAll,
	beforeEach,
	describe as bunDescribe,
	expect as bunExpect,
	it as bunIt,
	jest,
	mock as bunMock,
	spyOn as bunSpyOn,
	test as bunTest,
} from "bun:test";
import type { Mock } from "bun:test";
export { afterAll, afterEach, beforeAll, beforeEach };

export interface DescribeCall {
	(label: string, fn: () => unknown): void;
	(label: string, options: Record<string, unknown>, fn: () => unknown): void;
	skip: DescribeCall;
	skipIf: (condition: boolean) => DescribeCall;
	runIf: (condition: boolean) => DescribeCall;
}

export type DescribeBranchFn = (condition: boolean) => DescribeCall;

interface NativeDescribe {
	(...args: unknown[]): void;
	skip: unknown;
	skipIf: (condition: boolean) => unknown;
}
function makeDescribe(native: NativeDescribe): DescribeCall {
	const call = ((...args: unknown[]) => {
		(native as (...callArgs: unknown[]) => void)(...args);
	}) as DescribeCall;
	return Object.assign(call, {
		skip: ((...args: unknown[]) => Reflect.apply(native.skip as (...callArgs: unknown[]) => void, native, args)) as unknown as DescribeCall,
		skipIf: ((condition: boolean) => Reflect.apply(native.skipIf, native, [condition])) as unknown as DescribeBranchFn,
		runIf: ((condition: boolean) => Reflect.apply(native.skipIf, native, [!condition])) as unknown as DescribeBranchFn,
	});
}

export const describe: DescribeCall = makeDescribe(bunDescribe as unknown as NativeDescribe);

// --- it/test with vitest-style options ------------------------------------------------
//
// Bun runs `(label, options, fn)` natively but only types `(label, fn, options)`.
// These wrappers add the options-second overloads and forward everything.

export interface TestCallOptions {
	retry?: number;
	timeout?: number;
	repeats?: number;
}

export interface TestCall {
	(label: string, fn: () => unknown): void;
	(label: string, options: TestCallOptions, fn: () => unknown): void;
	(label: string, fn: () => unknown, timeout: number): void;
	skip: TestCall;
	skipIf: SkipIfFn;
	each: typeof bunIt.each;
}

export type SkipIfFn = (condition: boolean) => TestCall;
interface NativeTestCall {
	(...args: unknown[]): void;
	skip: (...args: unknown[]) => void;
	skipIf: (condition: boolean) => unknown;
	each: (...args: unknown[]) => unknown;
}

function makeTestCall(native: NativeTestCall): TestCall {
	// The implementation is looked up on the native object on every call so
	// `this` stays the native scope (bun brand-checks the receiver).
	// Vitest allowed a trailing timeout (`it(name, fn, ms)`); normalize it to
	// bun's options-second form.
	const call = ((...args: unknown[]) => {
		if (args.length === 3 && typeof args[0] === "string" && typeof args[1] === "function" && typeof args[2] === "number") {
			(native as (...callArgs: unknown[]) => void)(args[0], { timeout: args[2] }, args[1]);
			return;
		}
		(native as (...callArgs: unknown[]) => void)(...args);
	}) as TestCall;
	return Object.assign(call, {
		skip: ((...args: unknown[]) => Reflect.apply(native.skip, native, args)) as unknown as TestCall,
		skipIf: ((condition: boolean) => Reflect.apply(native.skipIf, native, [condition])) as unknown as SkipIfFn,
		each: ((...args: unknown[]) => Reflect.apply(native.each, native, args)) as unknown as typeof bunIt.each,
	});
}

export const it: TestCall = makeTestCall(bunIt as unknown as NativeTestCall);
export const test: TestCall = makeTestCall(bunTest as unknown as NativeTestCall);

// --- microtask draining -----------------------------------------------------

function flushMicrotasks(rounds = 20): Promise<void> {
	let chain = Promise.resolve();
	for (let index = 0; index < rounds; index++) chain = chain.then(() => undefined);
	return chain;
}

// --- fake-timer state tracking ----------------------------------------------

let fakeTimersOn = false;
let virtualNow = 0;

function currentTime(): number {
	return fakeTimersOn ? virtualNow : Date.now();
}

async function tickMilliseconds(ms: number): Promise<void> {
	if (fakeTimersOn) {
		jest.advanceTimersByTime(ms);
		virtualNow += ms;
		await flushMicrotasks();
	} else {
		await new Promise<void>((resolve) => setTimeout(resolve, ms));
	}
}

async function pollUntil(evaluate: () => void | Promise<void>, options?: { timeout?: number; interval?: number }): Promise<void> {
	const timeout = options?.timeout ?? 1000;
	const interval = options?.interval ?? 50;
	const deadline = currentTime() + timeout;
	let lastError: unknown = new Error("poll timed out before the first attempt");
	for (;;) {
		try {
			await evaluate();
			return;
		} catch (error) {
			lastError = error;
		}
		if (currentTime() >= deadline) break;
		await tickMilliseconds(interval);
	}
	throw lastError;
}

// --- expect + poll ----------------------------------------------------------

type PollOptions = { timeout?: number; interval?: number };

type PollMatchers = {
	toBe: (expected?: unknown) => Promise<void>;
	toEqual: (expected?: unknown) => Promise<void>;
	toContain: (expected?: unknown) => Promise<void>;
	toBeUndefined: () => Promise<void>;
	toBeGreaterThan: (expected?: number) => Promise<void>;
	// Named matchers above take precedence; the index covers any other matcher
	// at runtime (add a named entry if a test needs it typed).
	[key: string]: (...args: never[]) => Promise<void>;
};

function poll<T>(fn: () => T | Promise<T>, options?: PollOptions): PollMatchers {
	const check = (matcher: string, args: unknown[]) =>
		pollUntil(async () => {
			const value = await fn();
			(bunExpect(value) as unknown as Record<string, (...callArgs: unknown[]) => void>)[matcher](...args);
		}, options);
	return new Proxy({} as PollMatchers, {
		get:
			(_target, property: string) =>
				(...args: unknown[]): Promise<void> =>
					(property === "then" ? undefined : check(property, args)) as Promise<void>,
	});
}

// --- async rejects/resolves ------------------------------------------------------
//
// Bun's `rejects`/`resolves` matchers block the thread when the promise is
// still pending, which deadlocks tests that assert first and settle later
// (e.g. gated service calls). These replacements await settlement
// asynchronously, then delegate the settled outcome to bun's matchers.

type Settlement = { resolved: true; value: unknown } | { resolved: false; error: unknown };

function settlePromise(promise: unknown): Promise<Settlement> {
	if (
		promise === null ||
		(typeof promise !== "object" && typeof promise !== "function") ||
		typeof (promise as Promise<unknown>).then !== "function"
	) {
		throw new Error("rejects/resolves matcher requires a promise");
	}
	return (promise as Promise<unknown>).then(
		(value: unknown) => ({ resolved: true as const, value }),
		(error: unknown) => ({ resolved: false as const, error }),
	);
}

function applyMatcher(target: unknown, negated: boolean, matcher: string, args: unknown[]): void {
	const assertion = bunExpect(target) as unknown as Record<string, unknown>;
	const scope = (negated ? assertion.not : assertion) as Record<string, (...callArgs: unknown[]) => void>;
	const apply = scope[matcher];
	if (typeof apply !== "function") throw new Error(`unsupported matcher in rejects/resolves chain: ${negated ? "not." : ""}${matcher}`);
	Reflect.apply(apply, scope, args);
}

function thrownMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

/** Match a rejection reason the way vitest `rejects.toThrow` does (string / regexp / class). */
function matchThrown(error: unknown, expected?: unknown): void {
	if (expected === undefined) return;
	if (typeof expected === "string") {
		const message = thrownMessage(error);
		if (!message.includes(expected)) {
			throw new Error(`expected error message to contain ${JSON.stringify(expected)}, got ${JSON.stringify(message)}`);
		}
		return;
	}
	if (expected instanceof RegExp) {
		const message = thrownMessage(error);
		if (!expected.test(message)) {
			throw new Error(`expected error message to match ${String(expected)}, got ${JSON.stringify(message)}`);
		}
		return;
	}
	if (typeof expected === "function") {
		if (!(error instanceof (expected as new (...args: never[]) => unknown))) {
			throw new Error(`expected error to be an instance of ${(expected as { name?: unknown }).name ?? "<anonymous>"}`);
		}
		return;
	}
	if (expected instanceof Error) {
		const message = thrownMessage(error);
		if (message !== expected.message) {
			throw new Error(`expected error message ${JSON.stringify(expected.message)}, got ${JSON.stringify(message)}`);
		}
		return;
	}
	applyMatcher(error, false, "toThrow", [expected]);
}

function makeRejects(promise: unknown) {
	const check =
		(matcher: string, args: unknown[], negated = false) =>
			settlePromise(promise).then((outcome) => {
				if (outcome.resolved) {
					throw new Error("expected promise to reject, but it resolved");
				}
				if (matcher === "toThrow" && !negated) {
					matchThrown(outcome.error, args[0]);
					return;
				}
				applyMatcher(outcome.error, negated, matcher, args);
				});
	const matchers = (negated: boolean) => ({
		toBe: (expected?: unknown): Promise<void> => check("toBe", [expected], negated),
		toBeInstanceOf: (expected?: unknown): Promise<void> => check("toBeInstanceOf", [expected], negated),
		toMatchObject: (expected?: unknown): Promise<void> => check("toMatchObject", [expected], negated),
		toThrow: (expected?: unknown): Promise<void> => check("toThrow", [expected], negated),
	});
	return { ...matchers(false), not: matchers(true) };
}

function makeResolves(promise: unknown) {
	const check =
		(matcher: string, args: unknown[], negated = false) =>
			settlePromise(promise).then((outcome) => {
				if (!outcome.resolved) throw outcome.error;
				if (matcher === "toThrow") {
					// Vitest passes `.not.toThrow()` on resolved non-function values.
					if (typeof outcome.value !== "function") {
						if (negated) return;
						throw new Error("received value must be a function");
					}
				}
				applyMatcher(outcome.value, negated, matcher, args);
			});
	const matchers = (negated: boolean) => ({
		toBe: (expected?: unknown): Promise<void> => check("toBe", [expected], negated),
		toBeDefined: (): Promise<void> => check("toBeDefined", [], negated),
		toBeNull: (): Promise<void> => check("toBeNull", [], negated),
		toBeUndefined: (): Promise<void> => check("toBeUndefined", [], negated),
		toContainEqual: (expected?: unknown): Promise<void> => check("toContainEqual", [expected], negated),
		toEqual: (expected?: unknown): Promise<void> => check("toEqual", [expected], negated),
		toMatchObject: (expected?: unknown): Promise<void> => check("toMatchObject", [expected], negated),
		toThrow: (expected?: unknown): Promise<void> => check("toThrow", [expected], negated),
	});
	return { ...matchers(false), not: matchers(true) };
}

type BunExpect = typeof bunExpect;


function expectShim(actual?: unknown): unknown {
	// Shadow (not wrap) the assertion: bun's matchers brand-check `this`,
	// so the object identity must stay intact. rejects/resolves use async
	// versions that do not deadlock on pending promises; oneOf is implemented
	// directly (bun has none). toMatchObject is intentionally NOT shadowed:
	// bun's `not.*` matchers dispatch through the assertion's own methods,
	// so shadowing it corrupts negated checks.
	const assertion = (bunExpect as (value?: unknown) => object)(actual);
	Object.defineProperties(assertion, {
		rejects: { value: makeRejects(actual), enumerable: true, writable: true, configurable: true },
		resolves: { value: makeResolves(actual), enumerable: true, writable: true, configurable: true },
		oneOf: {
			// Bun has no oneOf matcher; implement the membership check directly.
			value: (expected?: unknown): void => {
				const candidates = Array.isArray(expected) ? expected : [expected];
				if (!candidates.some((candidate) => Object.is(candidate, actual))) {
					throw new Error(`expected ${JSON.stringify(actual)} to be one of ${JSON.stringify(candidates)}`);
				}
			},
			enumerable: true,
			writable: true,
			configurable: true,
		},
	});
	return assertion;
}

/**
 * Loose assertion surface. Bun's matcher types are strict (exact generic
 * variance); vitest's accepted anything. These signatures replicate the
 * vitest looseness at the type level; runtime behavior is bun's.
 */
export interface LooseMatchers {
	not: LooseMatchers;
	rejects: ReturnType<typeof makeRejects>;
	resolves: ReturnType<typeof makeResolves>;
	toBe(expected?: unknown): void;
	toEqual(expected?: unknown): void;
	toStrictEqual(expected?: unknown): void;
	toContain(expected?: unknown): void;
	toContainEqual(expected?: unknown): void;
	toMatch(expected?: unknown): void;
	toMatchObject(expected?: unknown): void;
	toThrow(expected?: unknown): void;
	toBeNull(): void;
	toBeUndefined(): void;
	toBeDefined(): void;
	toBeTruthy(): void;
	toBeFalsy(): void;
	toBeNaN(): void;
	toBeGreaterThan(expected?: unknown): void;
	toBeGreaterThanOrEqual(expected?: unknown): void;
	toBeLessThan(expected?: unknown): void;
	toBeLessThanOrEqual(expected?: unknown): void;
	toBeCloseTo(expected?: unknown, precision?: number): void;
	toHaveLength(expected?: unknown): void;
	toHaveProperty(expected?: unknown, value?: unknown): void;
	toBeInstanceOf(expected?: unknown): void;
	toBeTypeOf(expected?: unknown): void;
	toHaveBeenCalled(...args: unknown[]): void;
	toHaveBeenCalledTimes(expected?: unknown): void;
	toHaveBeenCalledWith(...args: unknown[]): void;
	toHaveBeenLastCalledWith(...args: unknown[]): void;
	toHaveBeenNthCalledWith(...args: unknown[]): void;
	toHaveReturned(...args: unknown[]): void;
	toHaveReturnedTimes(expected?: unknown): void;
	toHaveReturnedWith(...args: unknown[]): void;
	toHaveLastReturnedWith(...args: unknown[]): void;
	toHaveNthReturnedWith(...args: unknown[]): void;
	toMatchSnapshot(expected?: unknown): void;
	toMatchInlineSnapshot(expected?: unknown): void;
	toThrowErrorMatchingSnapshot(expected?: unknown): void;
	oneOf(expected?: unknown): void;
	toThrowErrorMatchingInlineSnapshot(expected?: unknown): void;
}

export type ExpectCallable = {
	(actual?: unknown, message?: string): LooseMatchers;
} & Pick<
	typeof bunExpect,
	| "any"
	| "anything"
	| "arrayContaining"
	| "objectContaining"
	| "stringContaining"
	| "stringMatching"
	| "not"
	> & { poll: typeof poll };

export const expect: ExpectCallable = Object.assign(expectShim, bunExpect, { poll }) as unknown as ExpectCallable;

// --- mock tracking (backs restoreAllMocks) ----------------------------------

interface Restorable {
	mockRestore: () => void;
}

const createdMocks = new Set<Restorable>();
// Spies installed by spyOn attach to (often shared) objects. Bun runs all
// files in one process, so a spy left installed leaks into every other file.
// Plain vi.fn() doubles attach to nothing and may intentionally persist
// (module-level mockState re-implemented per test), so only spies auto-restore.
const installedSpies = new Set<Restorable>();

function track<T extends Restorable>(created: T): T {
	createdMocks.add(created);
	return created;
}

type BunMock = typeof bunMock;
export const mock: BunMock = Object.assign(
	((...args: unknown[]) => track((bunMock as (...callArgs: unknown[]) => Restorable)(...args))) as BunMock,
	bunMock,
);

type BunSpyOn = typeof bunSpyOn;
export const spyOn: BunSpyOn = ((...args: unknown[]) => {
	const created = (bunSpyOn as (...callArgs: unknown[]) => Restorable)(...args);
	installedSpies.add(track(created));
	return created;
}) as BunSpyOn;
// --- stubbed globals / env (auto-restored by test-support/setup.ts) ---------

const stubbedEnv = new Map<string, string | undefined>();
const stubbedGlobals = new Map<PropertyKey, { exists: boolean; value: unknown }>();

function stubEnv(name: string, value: string | undefined): string | undefined {
	if (!stubbedEnv.has(name)) {
		stubbedEnv.set(name, Object.hasOwn(process.env, name) ? process.env[name] : undefined);
	}
	if (value === undefined) delete process.env[name];
	else process.env[name] = value;
	return value;
}

function unstubAllEnvs(): void {
	for (const [name, previous] of stubbedEnv) {
		if (previous === undefined) delete process.env[name];
		else process.env[name] = previous;
	}
	stubbedEnv.clear();
}

function stubGlobal(name: PropertyKey, value: unknown): unknown {
	if (!stubbedGlobals.has(name)) {
		stubbedGlobals.set(name, {
			exists: Object.hasOwn(globalThis, name),
			value: (globalThis as Record<PropertyKey, unknown>)[name],
		});
	}
	(globalThis as Record<PropertyKey, unknown>)[name] = value;
	return value;
}

function unstubAllGlobals(): void {
	for (const [name, previous] of stubbedGlobals) {
		if (previous.exists) (globalThis as Record<PropertyKey, unknown>)[name] = previous.value;
		else delete (globalThis as Record<PropertyKey, unknown>)[name];
	}
	stubbedGlobals.clear();
}

/**
 * Restore per-test doubles. Registered as a global afterEach in test-support/setup.ts.
 *
 * Bun runs test files in one process, so unlike vitest workers a spy left
 * installed leaks into every other file. Restoring installed spies replicates
 * per-file isolation; no test in this suite depends on spies surviving
 * across tests (verified by grep for module-level spies).
 */
export function restoreTestDoubles(): void {
	unstubAllEnvs();
	unstubAllGlobals();
	for (const created of installedSpies) {
		try {
			created.mockRestore();
		} catch {
			// Already restored or unrestorable; the double is spent either way.
		}
	}
	installedSpies.clear();
}

// --- timers -----------------------------------------------------------------

function useFakeTimers(config?: { now?: number | Date }): void {
	jest.useFakeTimers();
	fakeTimersOn = true;
	if (config?.now !== undefined) {
		const now = new Date(config.now).getTime();
		jest.setSystemTime(now);
		virtualNow = now;
	} else {
		virtualNow = Date.now();
	}
}

function useRealTimers(): void {
	jest.useRealTimers();
	fakeTimersOn = false;
}

function advanceTimersByTime(ms: number): void {
	jest.advanceTimersByTime(ms);
	if (fakeTimersOn) virtualNow += ms;
}

async function advanceTimersByTimeAsync(ms: number): Promise<void> {
	// Yield first so pending continuations (e.g. a mocked fetch response that
	// schedules a poll timer) run at the current virtual time. Without this the
	// first step advances the clock before the timer exists, and a timer due
	// exactly at the end of the window is missed.
	await flushMicrotasks(50);
	let remaining = ms;
	while (remaining > 0) {
		if (jest.getTimerCount() === 0) {
			if (fakeTimersOn) virtualNow += remaining;
			else jest.advanceTimersByTime(remaining);
			return;
		}
		const step = Math.min(10, remaining);
		jest.advanceTimersByTime(step);
		if (fakeTimersOn) virtualNow += step;
		remaining -= step;
		await flushMicrotasks();
	}
}

async function advanceTimersToNextTimerAsync(): Promise<void> {
	(jest as unknown as { advanceTimersToNextTimer: () => void }).advanceTimersToNextTimer();
	await flushMicrotasks();
}

async function runAllTicks(): Promise<void> {
	await flushMicrotasks(50);
}

function setSystemTime(now?: number | Date): void {
	(jest.setSystemTime as (value?: number | Date) => void)(now);
	if (fakeTimersOn && now !== undefined) virtualNow = new Date(now).getTime();
}

// --- vi ---------------------------------------------------------------------

export const vi = {
	fn: mock,
	spyOn,
	// Evaluated inline: every declaration site precedes its mock.module use,
	// which matches vitest hoisting semantics for this suite.
	hoisted: <T>(factory: () => T): T => factory(),
	stubGlobal,
	stubEnv,
	unstubAllGlobals,
	unstubAllEnvs,
	restoreAllMocks: (): void => {
		for (const created of createdMocks) created.mockRestore();
	},
	mocked: <T extends (...args: never[]) => unknown>(item: T): Mock<T> => item as unknown as Mock<T>,
	waitFor: pollUntil,
	useFakeTimers,
	useRealTimers,
	advanceTimersByTime,
	advanceTimersByTimeAsync,
	advanceTimersToNextTimerAsync,
	runAllTicks,
	getTimerCount: (): number => jest.getTimerCount(),
	setSystemTime,
	// No-op: bun has no module-registry reset, and `bun test --isolate` already
	// gives every file a fresh registry (the vitest behavior this replaces).
	// Within a file, dynamic re-imports return the cached module; do not rely
	// on this for fresh module evaluation.
	resetModules: (): void => {},
};

// --- compile-time type assertions (replaces vitest expectTypeOf) -----------------

type Equal<X, Y> = (<T>() => T extends X ? 1 : 2) extends <T>() => T extends Y ? 1 : 2 ? true : false;

/**
 * Compile-time type assertions. Mismatches fail `tsgo --noEmit`, not the test run.
 * Runtime behavior is a no-op by design.
 */
export interface ExpectTypeOf<T> {
	toEqualTypeOf<U>(...args: Equal<T, U> extends true ? [] : [mismatch: "expected types to be equal"]): void;
	toMatchTypeOf<U>(...args: T extends U ? [] : [mismatch: "expected type to be assignable"]): void;
	toBeFunction(...args: T extends (...args: never[]) => unknown ? [] : [mismatch: "expected a function type"]): void;
	not: {
		toEqualTypeOf<U>(...args: Equal<T, U> extends false ? [] : [mismatch: "expected types to differ"]): void;
		toMatchTypeOf<U>(...args: T extends U ? [mismatch: "expected type to not be assignable"] : []): void;
	};
	returns: T extends (...args: never[]) => unknown
		? ExpectTypeOf<ReturnType<T>>
		: { toEqualTypeOf(...args: [mismatch: "expected a function type"]): void };
}

// Overloads (not an optional parameter): inferring through `?: T` strips
// `undefined` from the inferred type and breaks unions with undefined.
export function expectTypeOf<T>(actual: T): ExpectTypeOf<T>;
export function expectTypeOf<T>(): ExpectTypeOf<T>;
export function expectTypeOf(_value?: unknown): ExpectTypeOf<unknown> {
	const noop = {
		toEqualTypeOf(): void {},
		toMatchTypeOf(): void {},
		toBeFunction(): void {},
	};
	return { ...noop, not: noop, returns: noop } as ExpectTypeOf<unknown>;
}
