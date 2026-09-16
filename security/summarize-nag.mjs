#!/usr/bin/env node
// Aggregates the per-stack cdk-nag CSV reports in nag.out/ into one summary.
//
// cdk-nag writes one CSV per stack, which for 29 patterns means 29 files and
// several hundred rows. This rolls them up so a reviewer can see the shape of the
// findings without opening each file, and so a before/after comparison is one
// command rather than a manual diff.
//
// Resources whose path contains 'Shared' are prerequisites the harness creates to
// satisfy a construct's required props (VPC, secret, security group, event bus).
// They are not part of the library, so they are reported separately.
//
// Usage: node security/summarize-nag.mjs [nag.out] [--json] [--csv <file>]

import * as fs from 'fs';
import * as path from 'path';

const args = process.argv.slice(2);
const outDir = args.find((a) => !a.startsWith('-')) ?? 'nag.out';
const asJson = args.includes('--json');
const csvIdx = args.indexOf('--csv');
const csvOut = csvIdx !== -1 ? args[csvIdx + 1] : null;

if (!fs.existsSync(outDir)) {
  console.error(`No such directory: ${outDir}\nRun \`npm run security:nag\` first.`);
  process.exit(1);
}

/** Minimal RFC-4180 CSV line parser — rule text contains commas inside quotes. */
function parseCsvLine(line) {
  const out = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (inQuotes) {
      if (c === '"') {
        if (line[i + 1] === '"') { cur += '"'; i++; } else { inQuotes = false; }
      } else cur += c;
    } else if (c === '"') inQuotes = true;
    else if (c === ',') { out.push(cur); cur = ''; }
    else cur += c;
  }
  out.push(cur);
  return out;
}

const files = fs.readdirSync(outDir).filter((f) => f.endsWith('NagReport.csv'));
if (files.length === 0) {
  console.error(`No NagReport.csv files in ${outDir}/`);
  process.exit(1);
}

// cdk-nag writes one file per stack named AwsSolutions-<Stack>-NagReport.csv, and the
// rows inside carry no Stack column. Derive it from the filename so findings can be
// attributed to a pattern.
function stackFromFilename(file) {
  return file.replace(/^AwsSolutions-/, '').replace(/-NagReport\.csv$/, '');
}

const rows = [];
for (const file of files) {
  const stack = stackFromFilename(file);
  const text = fs.readFileSync(path.join(outDir, file), 'utf8').trim();
  const [header, ...lines] = text.split(/\r?\n/);
  const cols = parseCsvLine(header);
  for (const line of lines) {
    if (!line.trim()) continue;
    const vals = parseCsvLine(line);
    const row = Object.fromEntries(cols.map((c, i) => [c, vals[i] ?? '']));
    row.Stack = row.Stack || stack;
    rows.push(row);
  }
}

const nonCompliant = rows.filter((r) => r.Compliance === 'Non-Compliant');
const isShared = (r) => (r['Resource ID'] ?? '').includes('Shared');
const library = nonCompliant.filter((r) => !isShared(r));
const prereq = nonCompliant.filter(isShared);

function tally(list, key) {
  const m = new Map();
  for (const r of list) m.set(r[key], (m.get(r[key]) ?? 0) + 1);
  return [...m.entries()].sort((a, b) => b[1] - a[1]);
}

const levelOf = new Map(rows.map((r) => [r['Rule ID'], r['Rule Level']]));

if (asJson) {
  console.log(JSON.stringify({
    stacksScanned: files.length,
    rows: rows.length,
    compliant: rows.length - nonCompliant.length,
    nonCompliant: nonCompliant.length,
    libraryFindings: library.length,
    prerequisiteFindings: prereq.length,
    byRule: Object.fromEntries(tally(library, 'Rule ID')),
    byStack: Object.fromEntries(tally(library, 'Stack')),
  }, null, 2));
} else {
  console.log(`cdk-nag summary — ${outDir}/`);
  console.log(`  stacks scanned      ${files.length}`);
  console.log(`  checks evaluated    ${rows.length}`);
  console.log(`  compliant           ${rows.length - nonCompliant.length}`);
  console.log(`  non-compliant       ${nonCompliant.length}`);
  console.log(`    on library        ${library.length}`);
  console.log(`    on harness prereqs ${prereq.length}  (Shared* — not part of the library)`);
  console.log('');
  console.log('Library findings by rule:');
  for (const [rule, n] of tally(library, 'Rule ID')) {
    console.log(`  ${rule.padEnd(24)} ${String(n).padStart(4)}  [${levelOf.get(rule) ?? '?'}]`);
  }
  console.log('');
  console.log('Library findings by pattern:');
  for (const [stack, n] of tally(library, 'Stack')) {
    console.log(`  ${stack.replace(/^-/, '').padEnd(28)} ${String(n).padStart(4)}`);
  }
}

if (csvOut) {
  const cols = ['Stack', 'Rule ID', 'Resource ID', 'Compliance', 'Rule Level', 'Rule Info'];
  const esc = (v) => (/[",\n]/.test(v ?? '') ? `"${String(v).replace(/"/g, '""')}"` : (v ?? ''));
  const body = [cols.join(',')].concat(
    nonCompliant.map((r) => cols.map((c) => esc(r[c])).join(',')),
  );
  fs.writeFileSync(csvOut, body.join('\n') + '\n');
  console.log(`\nWrote ${nonCompliant.length} non-compliant rows to ${csvOut}`);
}
