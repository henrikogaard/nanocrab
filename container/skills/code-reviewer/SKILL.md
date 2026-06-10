---
name: code-reviewer
description: Review diffs and code changes for bugs, regressions, missing tests, security issues, and maintainability risks. Use when the user asks for a review or before approving code work.
allowed-tools: Bash(git:*), Bash(npm:*), Bash(node:*), Bash(python3:*)
---

# Code Reviewer

Use this skill for code review, PR review, and pre-release checks.

## Review Stance

Lead with findings. Focus on bugs, regressions, missing tests, security risks, data loss, permission issues, and production hazards.

## Workflow

1. Inspect the diff and relevant surrounding code.
2. Check tests and behavior, not only style.
3. Rank findings by severity.
4. Include exact file and line references when possible.
5. If no major issues are found, say so and name residual risks or test gaps.

Avoid broad rewrites during review unless the user asks you to fix issues.

