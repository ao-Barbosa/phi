#!/usr/bin/env bun

import { execFileSync } from "node:child_process";

const allowValue = process.env.PHI_ALLOW_LOCKFILE_CHANGE;
const allowed = allowValue === "1" || allowValue === "true" || allowValue === "yes";

function git(args) {
	return execFileSync("git", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
}

const stagedFiles = git(["diff", "--cached", "--name-only"])
	.split("\n")
	.map((line) => line.trim())
	.filter(Boolean);

if (!stagedFiles.includes("bun.lock")) {
	process.exit(0);
}

if (allowed) {
	console.error("bun.lock is staged; PHI_ALLOW_LOCKFILE_CHANGE is set, allowing commit.");
	process.exit(0);
}

console.error("bun.lock is staged.");
console.error("");
console.error("Review lockfile changes before committing:");
console.error("  - confirm every new/updated package is intentional");
console.error("  - confirm the bunfig.toml age gate was active for resolution");
console.error("  - bun never runs dependency lifecycle scripts, so no script review is needed");
console.error("  - re-run bun install --frozen-lockfile from a clean tree to verify reproducibility");

let summary = [];
try {
	const diff = git(["diff", "--cached", "--unified=0", "--", "bun.lock"]);
	const changed = diff
		.split("\n")
		.filter((line) => (line.startsWith("+") || line.startsWith("-")) && !line.startsWith("+++") && !line.startsWith("---"))
		.map((line) => line.trim())
		.filter(Boolean);
	summary = changed.slice(0, 40);
	if (changed.length > 40) summary.push(`... ${changed.length - 40} more changed lines`);
} catch {
	summary = [];
}

if (summary.length > 0) {
	console.error("");
	console.error("Changed lockfile lines:");
	for (const line of summary) console.error(`  ${line}`);
}

console.error("");
console.error("If this lockfile change is intentional, commit with:");
console.error("  PHI_ALLOW_LOCKFILE_CHANGE=1 git commit ...");
process.exit(1);
