---
name: github-issue-agent
description: Triage GitHub issues and prepare coding jobs. Use when the user asks NanoCrab to read issues, pick work, plan implementation, or prepare pull requests.
allowed-tools: mcp__nanocrab__*, Bash(gh:*), Bash(git:*)
---

# GitHub Issue Agent

Use this skill when working with GitHub issues, labels, assignments, milestones, branches, and pull request preparation.

## Workflow

1. Identify the repo, issue, label, milestone, or assignment filter.
2. Read issue body, comments, linked PRs, labels, and acceptance criteria.
3. Summarize the work and risk before changing code.
4. Create a staged plan: investigate, plan, await approval, implement, test, await PR approval, open PR.
5. Keep branches focused and avoid unrelated cleanup.
6. Ask before mutating repositories, opening PRs, publishing comments, or closing issues.

## Output

When proposing work, include:

- Issue link or id.
- Goal.
- Files likely involved.
- Risks.
- Test plan.
- Approval needed.

