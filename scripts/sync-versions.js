#!/usr/bin/env bun

/**
 * Validates lockstep versions for published packages, then synchronizes
 * internal dependency versions in all workspace packages, including private ones.
 *
 * Modes:
 *   bun scripts/sync-versions.js [packageRoot]
 *     Sync inter-package ranges to the current lockstep version (default).
 *   bun scripts/sync-versions.js patch|minor|major [packageRoot]
 *     Bump every workspace package, then sync (replaces `npm version --workspaces`).
 *   bun scripts/sync-versions.js set <version> [packageRoot]
 *     Set every workspace package to an explicit version, then sync.
 */

import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { findPackageDirectories } from "./package-workspaces.mjs";

const BUMP_TYPES = new Set(["patch", "minor", "major"]);

function parseMode(argv) {
	const [first, second, third] = argv;
	if (first !== undefined && BUMP_TYPES.has(first)) return { mode: "bump", bump: first, packageRoot: second ?? "packages" };
	if (first === "set" && typeof second === "string") return { mode: "set", version: second, packageRoot: third ?? "packages" };
	return { mode: "sync", packageRoot: first ?? "packages" };
}

function parseVersion(version) {
	const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(version ?? "");
	if (!match) return undefined;
	return { major: Number(match[1]), minor: Number(match[2]), patch: Number(match[3]) };
}

function bumpVersion(version, bump) {
	const parsed = parseVersion(version);
	if (!parsed) throw new Error(`Cannot bump non-semver version: ${version}`);
	if (bump === "major") return `${parsed.major + 1}.0.0`;
	if (bump === "minor") return `${parsed.major}.${parsed.minor + 1}.0`;
	return `${parsed.major}.${parsed.minor}.${parsed.patch + 1}`;
}

const { mode, bump, version: explicitVersion, packageRoot } = parseMode(process.argv.slice(2));

const GENERATED_PACKAGE_SUFFIXES = [join("coding-agent", "install-lock")];

const workspacePackages = findPackageDirectories(packageRoot)
	.filter((directory) => !GENERATED_PACKAGE_SUFFIXES.some((suffix) => directory.endsWith(suffix)))
	.map((directory) => {
	const path = join(directory, "package.json");
	return { data: JSON.parse(readFileSync(path, "utf8")), path };
});
const publishedPackages = workspacePackages.filter((pkg) => pkg.data.private !== true);

console.log("Current versions:");
for (const pkg of [...publishedPackages].sort((a, b) => a.data.name.localeCompare(b.data.name))) {
	console.log(`  ${pkg.data.name}: ${pkg.data.version}`);
}

const versions = new Set(publishedPackages.map((pkg) => pkg.data.version));
if (versions.size > 1) {
	console.error("\nERROR: Not all non-private packages have the same version.");
	console.error("Expected lockstep versioning. Run one of:");
	console.error("  bun run version:patch");
	console.error("  bun run version:minor");
	console.error("  bun run version:major");
	process.exit(1);
}

if (mode !== "sync") {
	const current = publishedPackages[0]?.data.version;
	if (!current) throw new Error("No published workspace packages found.");
	const next = mode === "bump" && bump ? bumpVersion(current, bump) : explicitVersion;
	if (!parseVersion(next)) throw new Error(`Invalid explicit version: ${next}`);
	console.log(`\nSetting every workspace package to ${next}...`);
	for (const pkg of workspacePackages) {
		if (pkg.data.version !== next) {
			pkg.data.version = next;
			writeFileSync(pkg.path, `${JSON.stringify(pkg.data, null, "\t")}\n`);
		}
	}
}

const versionMap = new Map(workspacePackages.map((pkg) => [pkg.data.name, pkg.data.version]));

console.log("\nAll non-private packages are at the same version (lockstep).");

let totalUpdates = 0;
const updatedPackages = new Set();
for (const pkg of workspacePackages) {
	for (const dependencyType of ["dependencies", "devDependencies"]) {
		const dependencies = pkg.data[dependencyType];
		if (!dependencies) {
			continue;
		}

		for (const [dependencyName, currentSpecifier] of Object.entries(dependencies)) {
			// Registry aliases such as `npm:@ao-barbosa/phi-ai@0.1.2` are never workspace-linked,
			// so lockstep bumping them would point at a version that is not published yet.
			const version = versionMap.get(dependencyName);
			const newSpecifier = version ? `^${version}` : null;
			if (!newSpecifier || currentSpecifier === newSpecifier) {
				continue;
			}

			console.log(`\n${pkg.data.name}:`);
			console.log(
				`  ${dependencyName}: ${currentSpecifier} → ${newSpecifier}${dependencyType === "devDependencies" ? " (devDependencies)" : ""}`,
			);
			dependencies[dependencyName] = newSpecifier;
			updatedPackages.add(pkg);
			totalUpdates++;
		}
	}
}

for (const pkg of updatedPackages) {
	writeFileSync(pkg.path, `${JSON.stringify(pkg.data, null, "\t")}\n`);
}

if (totalUpdates === 0) {
	console.log("\nAll inter-package dependencies are already in sync.");
} else {
	console.log(`\nUpdated ${totalUpdates} dependency version(s).`);
}
