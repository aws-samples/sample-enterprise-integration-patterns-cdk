# Agent configuration and tooling

How the two shipped agents are wired into each coding tool, how the generated `.kiro/` and `.claude/` directories are produced from the canonical sources, and how to keep them in sync. For what the agents do and which to start with, see [Use with an AI coding agent](../README.md#use-with-an-ai-coding-agent) in the README.

### Kiro

Open the repo as a workspace and accept the trust prompt — workspace agents only load in a trusted
folder.

- **Skills**: either activates on its own when you describe a matching task, or invoke one directly
  with `/integration-discovery` or `/eip-cdk-patterns`.
- **Agents**: click the agent name in the bottom bar of the chat input, then pick
  **integration-advisor** or **eip-architect**. It applies from your next message.

`integration-advisor` opens with a welcome message listing the three ways it can help — assess an
estate, design one interface, or review an existing design — so you can start by picking a number.

Switch agents mid-session by picking the other one from the same menu. Discovery findings stay in the
conversation, so handing off from advisor to architect does not lose context.

### Claude Code

Run `claude` from the repo root.

- **Skills**: Claude loads whichever is relevant, or invoke one with `/integration-discovery` or
  `/eip-cdk-patterns`.
- **Agents**: ask Claude to delegate, for example *"use the integration-advisor agent to assess our
  BizTalk estate"* or *"use the eip-architect agent to design the order export interface"*. Skills are
  preloaded into each agent at startup via its `skills` frontmatter.

If an agent isn't found on first run, restart — a session started before `.claude/agents/` existed
won't detect it.

### Other assistants

Both canonical skills in `skills/` use only the six fields in the Agent Skills spec, so they load
unmodified in any tool that supports the standard (Cursor, Codex, and others). Point your tool at
`skills/integration-discovery/` and `skills/eip-cdk-patterns/`, or copy them to wherever that tool
reads skills from.

The agent prompts in `agents/*.md` are plain markdown with YAML frontmatter. If your tool has no
agent concept, paste the body of `agents/integration-advisor.md` in as a system prompt and point it
at the two skill directories.

### Repository layout

`skills/` and `agents/` are the sources you edit. The two dotfile directories are generated from
them and committed so a fresh clone works in either tool.

```text
skills/integration-discovery/         # canonical skill — edit this
├── SKILL.md                          # welcome, discovery stages, where the library stops
└── references/
    ├── discovery-questions.md        # staged question banks + what each answer decides
    ├── platform-migration-map.md     # BizTalk/MuleSoft/Boomi/TIBCO/Informatica/Workato → construct
    └── interface-assessment-template.md  # the deliverable
skills/eip-cdk-patterns/              # canonical skill — edit this
├── SKILL.md
└── references/
    ├── construct-catalog.md          # all 29 constructs and what each provisions
    └── selection-guide.md            # thresholds + anti-pattern guardrails
agents/
├── integration-advisor.md            # canonical agent — frontmatter + system prompt
├── integration-advisor.targets.json  # per-tool tools, permissions, resources
├── eip-architect.md
└── eip-architect.targets.json

.kiro/{skills,agents}/                # generated — do not edit
.claude/{skills,agents}/              # generated — do not edit
```

Three things the generator handles that are easy to get wrong by hand.

Kiro custom agents don't inherit skills the way the default agent does, so each generated agent
declares `resources: ["skill://..."]` explicitly. Claude Code instead preloads via a `skills:` list.

Which skills an agent gets is controlled by the optional `skill:` frontmatter field. `eip-architect`
sets `skill: eip-cdk-patterns` and receives only that one. `integration-advisor` omits the field on
purpose, which the generator reads as "all skills", so it gets both — discovery needs the construct
catalog to do the mapping.

Neither generated agent pins a `model`, so each tool uses its session default rather than a model ID
that goes stale.

The two agents also have deliberately different permissions. `eip-architect` can write to `lib/`,
`test/` and `bin/`. `integration-advisor` can read anything but only write documentation and
assessment output, and its shell allowlist is narrow and non-mutating — so unlike the architect,
there is no broad `npx cdk *` allow that a deploy or destroy could slip through.

### Maintaining

```bash
npm run sync:agents     # regenerate .kiro/ and .claude/ from skills/ and agents/
npm run check:agents    # fail if they have drifted (runs in CI)
```

Edit the canonical sources, run `sync:agents`, and commit all of it. `check:agents` runs in CI and
fails the build on drift, on a stale generated file, and on an invalid skill name or an
over-length description.

The `eip-architect` agent is granted read access plus writes scoped to `lib/`, `test/`, `bin/` and
markdown. `cdk deploy`, `cdk destroy`, `git push`, `rm -rf` and `sudo` are explicitly denied — it
designs and builds, it does not deploy. Adjust the rules in `agents/eip-architect.targets.json`.

