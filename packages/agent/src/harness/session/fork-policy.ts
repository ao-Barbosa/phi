/**
 * Final action for current state at one address:
 * - copy: emit the current value in the destination;
 * - exclude: omit it from the destination;
 * - reconstruct: do not copy the row because lane handling emits a coherent replacement.
 */
export type ForkDisposition = "copy" | "exclude" | "reconstruct";

/** Decide the final fork action for one current scalar or list address. */
export function classifyForkAddress(
	address: { readonly namespace: string; readonly key: string },
	scope: "branch" | "tree",
	isEntryCopied: (entryId: string) => boolean,
): ForkDisposition {
	switch (address.namespace) {
		case "phi.session.name":
			return "copy";
		case "phi.entry.label":
			return isEntryCopied(address.key) ? "copy" : "exclude";
		case "phi.branch.tip":
		case "phi.lane.config":
		case "phi.lane.state":
			return "reconstruct";
		case "phi.result":
			return "exclude";
	}
	if (address.namespace.startsWith("phi.op.") || address.namespace.startsWith("phi.pending.")) return "exclude";
	if (address.namespace === "phi" || address.namespace.startsWith("phi.")) {
		throw new Error(`Unknown reserved fork namespace: ${address.namespace}`);
	}
	return scope === "tree" ? "copy" : "exclude";
}
