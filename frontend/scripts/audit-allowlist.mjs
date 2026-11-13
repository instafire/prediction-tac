// npm audit gate with an explicit allowlist.
//
// `npm audit --audit-level=high` fails the build on ANY high/critical
// vulnerability, including ones with no in-range fix. This script keeps the
// high bar for everything else but exempts exactly the advisories listed in
// ALLOWLISTED, each of which is unfixable by a version bump today:
//
// - GHSA-mrhx-c7xc-m3w5 — zod <4.6.6 (memory exhaustion, high).
//   Fix needs zod >=4.6.6, but @ton/ton 16.3.0 (latest) declares zod ^3.21.4.
// - GHSA-gcqx-w48m-w2h4 — deepmerge >=4.2.0 (prototype poisoning).
//   No fix available: 4.3.1 is the latest release and still vulnerable.
//   Reaches the tree via @tonconnect/ui. Rated low, so it does not block the
//   gate today; allowlisted so a future re-rating does not break the build
//   without review.
//
// A package is exempt only when EVERY advisory at the root of its dependency
// chain is allowlisted. In npm audit's JSON report, `via` holds advisory
// objects for the vulnerable package itself, and package names for packages
// that are vulnerable only because they depend on one — those names resolve
// to other entries in the report (e.g. @ton/ton -> zod,
// @tonappchain/ton-lite-client -> @ton/ton, @tonappchain/sdk ->
// @tonappchain/ton-lite-client). Cycles, missing names, and entries with no
// advisory at the root all fail closed.
//
// Usage: node scripts/audit-allowlist.mjs
// Exit 0: no high/critical vulnerability outside the allowlist.
// Exit 1: a non-allowlisted high/critical vulnerability exists, or the audit
//         report could not be read (fail closed — never silently pass).
import { spawnSync } from "node:child_process";

const ALLOWLISTED = new Set([
  "ghsa-gcqx-w48m-w2h4", // deepmerge — low today, no fix available
  "ghsa-mrhx-c7xc-m3w5", // zod — high; fix needs zod 4, @ton/ton pins zod 3
]);

const SEVERITIES = new Set(["high", "critical"]);

const result = spawnSync("npm", ["audit", "--json"], { encoding: "utf8" });
if (!result.stdout) {
  console.error(
    "audit-allowlist: npm audit produced no output" +
      (result.error ? `: ${result.error.message}` : ""),
  );
  process.exit(1);
}
let report;
try {
  report = JSON.parse(result.stdout);
} catch {
  console.error("audit-allowlist: could not parse npm audit JSON output");
  process.exit(1);
}
if (report.error || typeof report.vulnerabilities !== "object" || report.vulnerabilities === null) {
  console.error(
    "audit-allowlist: npm audit did not return a usable report" +
      (report.error ? `: ${JSON.stringify(report.error)}` : ""),
  );
  process.exit(1);
}

// Resolve a vulnerability entry to the advisory IDs at the root of its
// dependency chain. Returns { ok, ids }: ok is false when the chain cannot
// be proven to consist only of allowlisted advisories.
function resolve(name, seen) {
  if (seen.has(name)) return { ok: false, ids: [] }; // cycle: fail closed
  const entry = report.vulnerabilities[name];
  if (!entry || typeof entry !== "object") return { ok: false, ids: [] };
  seen.add(name);
  const via = entry.via ?? [];
  if (via.length === 0) return { ok: false, ids: [] };
  const ids = [];
  for (const item of via) {
    if (typeof item === "object" && item !== null) {
      const m =
        typeof item.url === "string" ? item.url.match(/GHSA-[a-z0-9-]+/i) : null;
      if (!m) return { ok: false, ids: [] };
      ids.push(m[0].toLowerCase());
    } else if (typeof item === "string") {
      const sub = resolve(item, new Set(seen));
      if (!sub.ok) return { ok: false, ids: [] };
      ids.push(...sub.ids);
    } else {
      return { ok: false, ids: [] };
    }
  }
  return { ok: ids.every((id) => ALLOWLISTED.has(id)), ids };
}

const blocking = [];
const allowlisted = [];
for (const [name, v] of Object.entries(report.vulnerabilities)) {
  if (!SEVERITIES.has((v.severity ?? "").toLowerCase())) continue;
  const r = resolve(name, new Set());
  if (r.ok && r.ids.length > 0) {
    allowlisted.push(`${name} (${[...new Set(r.ids)].join(", ")})`);
  } else {
    blocking.push(`${name} [${v.severity}]`);
  }
}
if (allowlisted.length) {
  console.log(`audit-allowlist: exempting allowlisted advisories: ${allowlisted.join("; ")}`);
}
if (blocking.length) {
  console.error(
    `audit-allowlist: FAIL — non-allowlisted high/critical vulnerabilities:\n  - ${blocking.join("\n  - ")}`,
  );
  process.exit(1);
}
console.log("audit-allowlist: PASS — no non-allowlisted high/critical vulnerabilities.");
