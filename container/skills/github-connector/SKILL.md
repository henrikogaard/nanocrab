---
name: github-connector
description: Work with GitHub issues, pull requests, repository metadata, CI, and coding-job handoffs through approved GitHub connector paths.
triggers: github, issue, pull request, pr, ci, actions, repository, branch, code review, merge
risk-level: medium
allowed-tools: mcp__github__*, mcp__nanocrab__*, Bash(gh:*), Bash(git:*)
---

# GitHub Connector

Use this skill when the user asks for GitHub issue triage, PR summaries, CI status, repository metadata, or a coding-job handoff.

## Workflow

1. Identify the repository, issue, PR, branch, or workflow run.
2. Prefer read-only inspection first: issue/PR metadata, review comments, check status, labels, and recent activity.
3. Summarize the concrete next action before changing anything.
4. For code changes, create a staged plan and ask before starting autonomous implementation unless the user has already approved the work.
5. Ask before opening, closing, labeling, assigning, merging, pushing, commenting on behalf of the user, or mutating repository contents.

## Safety

- Treat repository writes, CI reruns, issue comments, PR reviews, merges, and branch pushes as external writes.
- Do not expose secrets from logs, workflow output, or repository files.
- Keep private repository context inside the current authorized workspace unless the user approves sharing it.

## Output

- For issues: include scope, acceptance criteria, blockers, and proposed implementation path.
- For PRs: include mergeability, checks, unresolved review comments, and risk.
- For CI: include failing job, relevant log excerpt summary, likely cause, and next verification.
