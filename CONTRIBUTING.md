# Contributing

## Before You Start

1. **Check for existing work.** Search NanoCrab issues, PRs, and the roadmap before starting. If a related task exists, build on it rather than duplicating effort.

2. **Check alignment.** Read the [Philosophy section in README.md](README.md#philosophy). Source code changes should only be things 90%+ of users need. Skills can be more niche, but should still be useful beyond a single person's setup.

3. **One thing per PR.** Each PR should do one thing — one bug fix, one skill, one simplification. Don't mix unrelated changes in a single PR.

## Source Code Changes

**Accepted:** Bug fixes, security fixes, simplifications, reducing code, and roadmap-backed NanoCrab capabilities.

**Prefer plugins or skills for:** optional integrations, site-specific workflows, private automations, and narrow domain behavior.

## Skills

NanoCrab uses provider-neutral agent skills: markdown files with optional supporting files that teach the active agent provider how to do something. The format is compatible with the Claude Code `SKILL.md` convention, but skills are exposed to Claude, Codex/GPT, and local-model providers.

### Why skills?

Every deployment should have clean and minimal code that does exactly what it needs. Skills let NanoCrab add reusable agent behavior without hard-coding every workflow into the application.

### Skill types

#### 1. Skill Factory drafts

Agent-proposed skills are saved as drafts and reviewed before installation. This is the preferred path for new provider-neutral agent behavior.

**Location:** drafts in `store/skill-drafts/`, approved skills installed into `container/skills/<name>/`

**Examples:** report-writing guidance, design-review heuristics, game-specific summarization, research workflows

**How they work:**

1. An agent proposes complete `SKILL.md` content through `propose_skill_draft`
2. The main group lists and reviews drafts
3. The owner approves the draft, which installs it into `container/skills`

**Contributing a skill:**

1. Add a focused `SKILL.md` with valid frontmatter
2. Keep it provider-neutral unless a provider-specific behavior is unavoidable
3. Include any support files under the skill folder
4. Verify it works inside the agent container

#### 2. Utility skills (with code files)

Standalone tools that ship code files alongside the SKILL.md. The SKILL.md tells the agent how to install the tool; the code lives in the skill directory itself (e.g. in a `scripts/` subfolder).

**Location:** provider skill directory with supporting files

**Examples:** `/claw` (Python CLI in `scripts/claw`)

**Key difference from feature skills:** No branch merge needed. The code is self-contained in the skill directory and gets copied into place during installation.

**Guidelines:**

- Put code in separate files, not inline in the SKILL.md
- Use the provider's skill-directory environment variable, or relative paths from the SKILL.md, to reference files in the skill directory
- SKILL.md contains installation instructions, usage docs, and troubleshooting

#### 3. Operational skills (instruction-only)

Workflows and guides with no code changes. The SKILL.md is the entire skill — the agent follows the instructions to perform a task.

**Location:** provider skill directory on `main`

**Examples:** `/setup`, `/debug`, `/customize`, `/update-skills`

**Guidelines:**

- Pure instructions — no code files, no branch merges
- Use `AskUserQuestion` for interactive prompts
- These stay on `main` and are always available to every user

#### 4. Container skills (agent runtime)

Skills that run inside the agent container, not on the host. These teach the container agent how to use tools, format output, or perform tasks. `container/skills/` is the canonical source; it is mounted at `/workspace/skills` for every provider and mirrored into provider-specific homes such as `.claude/skills` or `.codex/skills` when a container starts.

**Location:** `container/skills/<name>/`

**Examples:** `agent-browser` (web browsing), `capabilities` (/capabilities command), `status` (/status command), `slack-formatting` (Slack mrkdwn syntax)

**Key difference:** These are NOT invoked by the user on the host. They're loaded or discovered by the container agent and influence how the agent behaves.

**Guidelines:**

- Follow the same SKILL.md + frontmatter format
- Use `allowed-tools` frontmatter to scope tool permissions
- Keep them focused — the agent's context window is shared across all container skills

### SKILL.md format

All skills use the `SKILL.md` frontmatter convention:

```markdown
---
name: my-skill
description: What this skill does and when to use it.
---

Instructions here...
```

**Rules:**

- Keep SKILL.md **under 500 lines** — move detail to separate reference files
- `name`: lowercase, alphanumeric + hyphens, max 64 chars
- `description`: required — agents use this to decide when to invoke the skill
- Put code in separate files, not inline in the markdown
- Keep frontmatter simple and portable across providers; provider-specific fields should be optional.

## Plugins

Optional capabilities that need routes, dashboard UI, background jobs, or external dependencies should usually be plugins.

**Location:** `src/admin/plugins/<name>/` for bundled plugins, or gitignored `plugins/<name>/` / private plugin folders for local-only plugins.

Keep plugin state and credentials scoped. Private or operator-specific plugins should not be committed to the generic repo.

## Testing

Test your contribution before submitting. For skills, run the skill end-to-end in an agent container. For code, run the smallest relevant test suite plus `npm run typecheck` and `npm run build`.

## Pull Requests

### Before opening

1. **Link related issues.** If your PR resolves an open issue, include `Closes #123` in the description so it's auto-closed on merge.
2. **Test thoroughly.** Run the feature yourself. For skills, test in the agent container.
3. **Check the right box** in the PR template. Labels are auto-applied based on your selection:

| Checkbox                    | Label          |
| --------------------------- | -------------- |
| Core feature                | `PR: Feature`  |
| Plugin                      | `PR: Plugin`   |
| Utility skill               | `PR: Skill`    |
| Operational/container skill | `PR: Skill`    |
| Fix                         | `PR: Fix`      |
| Simplification              | `PR: Refactor` |
| Documentation               | `PR: Docs`     |

### PR description

Keep it concise. Remove any template sections that don't apply. The description should cover:

- **What** — what the PR adds or changes
- **Why** — the motivation
- **How it works** — brief explanation of the approach
- **How it was tested** — what you did to verify it works
- **Usage** — how the user invokes it (for skills)

Don't pad the description. A few clear sentences are better than lengthy paragraphs.
