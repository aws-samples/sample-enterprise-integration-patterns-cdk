#!/usr/bin/env node
/**
 * Projects the canonical agent config in `skills/` and `agents/` into the
 * tool-specific locations that Kiro and Claude Code actually read.
 *
 *   skills/<name>/**            ->  .kiro/skills/<name>/**
 *                               ->  .claude/skills/<name>/**
 *   agents/<name>.md            ->  .kiro/agents/<name>.json
 *   + agents/<name>.targets.json    .claude/agents/<name>.md
 *
 * Skill content is copied verbatim: the frontmatter is restricted to the six
 * Agent Skills spec fields, which both tools accept unchanged.
 *
 * Usage:
 *   node scripts/sync-agent-config.mjs           # write
 *   node scripts/sync-agent-config.mjs --check   # verify, non-zero exit on drift
 */

import { readFileSync, writeFileSync, mkdirSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, dirname, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const CHECK = process.argv.includes('--check');

const TARGETS = {
  kiro: { skills: '.kiro/skills', agents: '.kiro/agents' },
  claude: { skills: '.claude/skills', agents: '.claude/agents' },
};

// ── helpers ───────────────────────────────────────────────────────────────────

/** Parse flat YAML frontmatter. Indented (nested) keys are skipped by design. */
function parseFrontmatter(src, label) {
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(src);
  if (!m) throw new Error(`${label}: missing YAML frontmatter delimited by ---`);
  const data = {};
  for (const line of m[1].split(/\r?\n/)) {
    if (!line.trim() || line.trimStart().startsWith('#')) continue;
    if (/^\s/.test(line)) continue; // nested key, not needed
    const i = line.indexOf(':');
    if (i === -1) continue;
    const key = line.slice(0, i).trim();
    let val = line.slice(i + 1).trim();
    if (/^(['"]).*\1$/.test(val)) val = val.slice(1, -1);
    data[key] = val;
  }
  return { data, body: m[2] };
}

/** Emit a YAML scalar, quoting only when the value would otherwise be ambiguous. */
function yamlScalar(value) {
  const s = String(value);
  const needsQuote = /^[\s>|&*!%@`'"#[{-]/.test(s) || /:\s/.test(s) || /\s#/.test(s) || s.includes('\n');
  if (!needsQuote) return s;
  return `"${s.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

/** Every file under `dir`, as paths relative to `dir`, sorted. */
function walk(dir, base = dir, out = []) {
  for (const entry of readdirSync(dir).sort()) {
    if (entry === '.DS_Store') continue;
    const abs = join(dir, entry);
    if (statSync(abs).isDirectory()) walk(abs, base, out);
    else out.push(relative(base, abs).split(sep).join('/'));
  }
  return out;
}

// ── build the expected output set ──────────────────────────────────────────────

const expected = new Map(); // repo-relative path -> file content
const managedDirs = [];     // dirs whose entire contents this script owns

const skillsDir = join(ROOT, 'skills');
const agentsDir = join(ROOT, 'agents');

const skillNames = existsSync(skillsDir)
  ? readdirSync(skillsDir).filter((n) => statSync(join(skillsDir, n)).isDirectory()).sort()
  : [];

for (const name of skillNames) {
  const src = join(skillsDir, name);
  const skillMd = join(src, 'SKILL.md');
  if (!existsSync(skillMd)) throw new Error(`skills/${name}: no SKILL.md`);

  const { data } = parseFrontmatter(readFileSync(skillMd, 'utf8'), `skills/${name}/SKILL.md`);
  if (data.name !== name) {
    throw new Error(
      `skills/${name}/SKILL.md: frontmatter name "${data.name}" must match the folder name "${name}"`,
    );
  }
  if (!/^[a-z0-9-]{1,64}$/.test(name)) {
    throw new Error(`skills/${name}: name must be lowercase letters, numbers and hyphens, max 64 chars`);
  }
  if (!data.description) throw new Error(`skills/${name}/SKILL.md: description is required`);
  if (data.description.length > 1024) {
    throw new Error(`skills/${name}/SKILL.md: description is ${data.description.length} chars, max 1024`);
  }

  for (const target of Object.values(TARGETS)) {
    managedDirs.push(`${target.skills}/${name}`);
    for (const rel of walk(src)) {
      expected.set(`${target.skills}/${name}/${rel}`, readFileSync(join(src, rel), 'utf8'));
    }
  }
}

const agentFiles = existsSync(agentsDir)
  ? readdirSync(agentsDir).filter((n) => n.endsWith('.md')).sort()
  : [];

for (const file of agentFiles) {
  const name = file.replace(/\.md$/, '');
  const { data, body } = parseFrontmatter(readFileSync(join(agentsDir, file), 'utf8'), `agents/${file}`);
  const prompt = body.trim();

  if (!data.name) throw new Error(`agents/${file}: name is required`);
  if (data.name !== name) {
    throw new Error(`agents/${file}: frontmatter name "${data.name}" must match the filename "${name}"`);
  }
  if (!data.description) throw new Error(`agents/${file}: description is required`);
  if (!prompt) throw new Error(`agents/${file}: body (the system prompt) is empty`);

  const targetsPath = join(agentsDir, `${name}.targets.json`);
  const targets = existsSync(targetsPath) ? JSON.parse(readFileSync(targetsPath, 'utf8')) : {};
  const kiro = targets.kiro ?? {};
  const claude = targets.claude ?? {};

  // Kiro requires the skill to be declared explicitly — custom agents do not
  // auto-load skills the way the default agent does.
  const skillResources = data.skill
    ? [`skill://.kiro/skills/${data.skill}/SKILL.md`]
    : skillNames.map((n) => `skill://.kiro/skills/${n}/SKILL.md`);

  const kiroAgent = {
    name,
    description: data.description,
    prompt,
    ...(kiro.tools ? { tools: kiro.tools } : {}),
    ...(kiro.allowedTools ? { allowedTools: kiro.allowedTools } : {}),
    resources: [...skillResources, ...(kiro.resources ?? [])],
    ...(kiro.permissions ? { permissions: kiro.permissions } : {}),
    ...(kiro.welcomeMessage ? { welcomeMessage: kiro.welcomeMessage } : {}),
  };
  expected.set(`${TARGETS.kiro.agents}/${name}.json`, `${JSON.stringify(kiroAgent, null, 2)}\n`);

  // Claude Code preloads skill content via the `skills` frontmatter field.
  const fm = [
    `name: ${yamlScalar(name)}`,
    `description: ${yamlScalar(data.description)}`,
  ];
  if (claude.tools) fm.push(`tools: ${claude.tools.join(', ')}`);
  const preload = data.skill ? [data.skill] : skillNames;
  if (preload.length) fm.push('skills:', ...preload.map((n) => `  - ${n}`));

  expected.set(
    `${TARGETS.claude.agents}/${name}.md`,
    `---\n${fm.join('\n')}\n---\n\n${prompt}\n`,
  );
}

// ── write or check ────────────────────────────────────────────────────────────

if (expected.size === 0) {
  console.error('Nothing to sync: no skills/ or agents/ sources found.');
  process.exit(1);
}

const problems = [];

// Stale files inside a directory this script fully owns.
for (const dir of [...new Set(managedDirs)]) {
  const abs = join(ROOT, dir);
  if (!existsSync(abs)) continue;
  for (const rel of walk(abs)) {
    const key = `${dir}/${rel}`;
    if (!expected.has(key)) problems.push(`stale (no longer in canonical source): ${key}`);
  }
}

let written = 0;
for (const [rel, content] of [...expected].sort()) {
  const abs = join(ROOT, rel);
  const current = existsSync(abs) ? readFileSync(abs, 'utf8') : null;
  if (current === content) continue;
  if (CHECK) {
    problems.push(current === null ? `missing: ${rel}` : `out of date: ${rel}`);
  } else {
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, content);
    written++;
  }
}

if (CHECK) {
  if (problems.length) {
    console.error('Agent config is out of sync with the canonical sources:\n');
    for (const p of problems) console.error(`  - ${p}`);
    console.error('\nRun `npm run sync:agents` and commit the result.');
    process.exit(1);
  }
  console.log(
    `Agent config in sync: ${skillNames.length} skill(s), ${agentFiles.length} agent(s), ${expected.size} generated files.`,
  );
} else {
  if (problems.length) {
    console.warn('Warning: stale files found. Delete them manually:\n');
    for (const p of problems) console.warn(`  - ${p}`);
    console.warn('');
  }
  console.log(
    `Synced ${skillNames.length} skill(s) and ${agentFiles.length} agent(s) to .kiro/ and .claude/ ` +
      `(${written} file(s) written, ${expected.size - written} already current).`,
  );
}
