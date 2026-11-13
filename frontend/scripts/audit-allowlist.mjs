// npm audit gate with an explicit allowlist.
//
// `npm audit --audit-level=high` fails the build on ANY high/critical
// vulnerability, including ones with no in-range fix. This script keeps the
// high bar for everything else but exempts exactly the advisories listed in
// ALLOWLISTED, each of which is unfixable by a version bump today:
//
// - GHSA-gcqx-w48m-w2h4 — deepmerge >=4.2.0 (prototype poisoning).
//   No fix available: 4.3.1 is the latest release and still vulnerable.
//   Reaches the tree via @tonconnect/ui.
// - GHSA-mrhx-c7xc-m3w5 — zod <4.6.6 (memory exhaustion, high).
//   Fix needs zod >=4.6.6, but @ton/ton 16.3.0 (latest) declares zod ^3.21.4.
//
// Usage: node scripts/audit-allowlist.mjs
// Exit 0: no high/critical vulnerability outside the allowlist.
// Exit 1: a non-allowlisted high/critical vulnerability exists, or the audit
//         report could not be read (fail closed — never silently pass).
import { spawnSync } from "node:child_process";

const ALLOWLISTED = new Set([
  "ghsa-gcqx-w48m-w2h4", // deepmerge — no fix available
  "ghsa-mrhx-c7xc-m3w5", // zod — fix needs zod 4, @ton/ton pins zod 3
]);

const SEVERITIES = new Set(["high", "critical"]);

function ghsaIds(via) {
  const ids = [];
  for (const entry of via ?? []) {
    if (typeof entry === "object" && entry !== null && typeof entry.url === "string") {
      const m = entry.url.match(/GHSA-[a-z0-9-]+/i);
      if (m) ids.push(m[0].toLowerCase()); // allowlist is lowercase
    }
  }
  return ids;
}

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

const blocking = [];
const allowlisted = [];
for (const [name, v] of Object.entries(report.vulnerabilities)) {
  if (!SEVERITIES.has((v.severity ?? "").toLowerCase())) continue;
  const ids = ghsaIds(v.via);
  if (ids.length > 0 && ids.every((id) => ALLOWLISTED.has(id))) {
    allowlisted.push(`${name} (${ids.join(", ")})`);
  } else {
    blocking.push(
      `${name} [${v.severity}] (${ids.length ? ids.join(", ") : "no advisory id"})`,
    );
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
