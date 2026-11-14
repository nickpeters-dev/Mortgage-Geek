// Parity harness for the Rent vs. Own sim against the Python reference.
//
// Usage:
//   npm test                                    (runs the reference, then diffs)
//   node scripts/rentVsOwnParity.mjs            (same)
//   node scripts/rentVsOwnParity.mjs <file>     (diff against saved reference output)
//
// Imports src/components/rentVsOwnSim.js directly (it and its imports are plain
// ES modules with explicit .js extensions, so no bundler is needed), runs the JS
// sim at each fixture's inputs, and diffs against the reference output. Fixture
// A must match to the dollar at every printed year (the regression guard); B
// through F within $1; breakeven and band exact everywhere.
//
// What this proves: the JS sim and the independent Python reference agree. It
// does not prove the shared modeling assumptions are right.
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { simulateRentVsOwn, breakevenBand } from "../src/components/rentVsOwnSim.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const refPath = process.argv[2];
let refText;
if (refPath) {
  refText = readFileSync(refPath, "utf-8");
} else {
  try {
    refText = execFileSync("python3", [join(root, "scripts/rent_vs_own_reference.py")], { encoding: "utf-8" });
  } catch (err) {
    console.error(`could not run the Python reference (python3 required): ${err.message}`);
    process.exit(2);
  }
}

// The same inputs the Python reference prints, keyed by fixture name. The JS
// sim takes percents where Python takes fractions.
const FIXTURES = {
  A: { maintRate: 0, costGrowth: 0, renterIns: 0, homeG: 5.4 },
  B: { maintRate: 1, costGrowth: 3, renterIns: 20, homeG: 4.5 },
  C: { downPct: 20, maintRate: 1, costGrowth: 3, renterIns: 20, homeG: 4.5 },
  D: { maintRate: 1, costGrowth: 3, renterIns: 20, homeG: 4.5, inv: 7 },
  E: { maintRate: 1, costGrowth: 0, renterIns: 0, homeG: 5.4 },
  F: { maintRate: 0, costGrowth: 3, renterIns: 20, homeG: 5.4 },
};
const EXACT = new Set(["A"]);
const YEARS = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 15, 20, 25, 30];

// Parse the printed reference into { name: { rows: {year: {...}}, breakeven, band } }.
function parseRef(text) {
  const out = {};
  let cur = null;
  for (const line of text.split("\n")) {
    const head = line.match(/^### (\w+)$/);
    if (head) { cur = { rows: {}, breakeven: undefined, band: undefined }; out[head[1]] = cur; continue; }
    if (!cur) continue;
    const row = line.match(/^\s*(\d+)\s*\|\s*([-\d,]+)\s*\|\s*([-\d,]+)\s*\|\s*([-\d,]+)\s*\|\s*([-\d,]+)\s*\|\s*([-\d,]+)\s*$/);
    if (row) {
      const n = (t) => parseInt(t.replace(/,/g, ""), 10);
      cur.rows[+row[1]] = { owner: n(row[2]), renter: n(row[3]), balance: n(row[5]), side: n(row[6]) };
      continue;
    }
    const be = line.match(/^breakeven year: (\S+)$/);
    if (be) { cur.breakeven = be[1] === "None" ? null : +be[1]; continue; }
    const band = line.match(/^band: (\{.*\})$/);
    if (band) {
      const vals = [...band[1].matchAll(/'[^']+': (None|\d+)/g)].map((m) => (m[1] === "None" ? null : +m[1]));
      const finite = vals.filter((v) => v !== null);
      cur.band = {
        min: finite.length ? Math.min(...finite) : null,
        max: finite.length ? Math.max(...finite) : null,
        anyNever: vals.some((v) => v === null),
      };
    }
  }
  return out;
}

const ref = parseRef(refText);
let failures = 0;
const flag = (ok, msg) => { if (!ok) { failures++; console.log(`  FAIL ${msg}`); } };

for (const [name, inputs] of Object.entries(FIXTURES)) {
  const expected = ref[name];
  if (!expected || Object.keys(expected.rows).length === 0) { failures++; console.log(`${name}: missing from reference output`); continue; }
  const sim = simulateRentVsOwn(inputs);
  const band = breakevenBand(inputs);
  const tol = EXACT.has(name) ? 0 : 1;
  let worst = 0;
  for (const y of YEARS) {
    const e = expected.rows[y];
    const a = sim.years[y];
    const got = { owner: a.ownerWealth, renter: a.renterWealth, balance: a.balance, side: a.ownerFund };
    for (const k of ["owner", "renter", "balance", "side"]) {
      const d = Math.abs(Math.round(got[k]) - e[k]);
      worst = Math.max(worst, d);
      flag(d <= tol, `${name} year ${y} ${k}: js ${Math.round(got[k]).toLocaleString("en-US")} vs ref ${e[k].toLocaleString("en-US")} (diff ${d})`);
    }
  }
  flag(sim.breakevenYear === expected.breakeven, `${name} breakeven: js ${sim.breakevenYear} vs ref ${expected.breakeven}`);
  const bandOk = band.min === expected.band.min && band.max === expected.band.max && band.anyNever === expected.band.anyNever;
  flag(bandOk, `${name} band: js ${JSON.stringify(band)} vs ref ${JSON.stringify(expected.band)}`);
  console.log(`${name}: rows worst diff $${worst} (tol $${tol}), breakeven ${sim.breakevenYear === null ? "never" : sim.breakevenYear}, band min ${band.min} max ${band.max} anyNever ${band.anyNever}`);
}

console.log(failures === 0 ? "\nPARITY PASS: all fixtures match" : `\nPARITY FAIL: ${failures} mismatches`);
process.exit(failures === 0 ? 0 : 1);
