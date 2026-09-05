import { defineService, type ReplicatedState } from "@ao-barbosa/phi-chord";
import type { LaneTranscriptSnapshot, LaneWatchEvent } from "@ao-barbosa/phi-agent-core";

export interface TranscriptState {
	snapshot: LaneTranscriptSnapshot | null;
	/** The source event is retained for presentation side effects; hydration does not replay it. */
	event: LaneWatchEvent | null;
}

/** Coherent main-lane state replicated through Chord's operation stream. */
export interface Transcript {
	readonly state: ReplicatedState<TranscriptState>;
}

export const Transcript = defineService<Transcript>("pi.transcript");
