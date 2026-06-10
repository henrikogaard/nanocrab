---
name: release-manager
description: Prepare releases with version checks, changelogs, migration notes, test summaries, deployment notes, and rollback guidance.
allowed-tools: Bash(git:*), Bash(npm:*), Bash(node:*), Bash(docker:*)
---

# Release Manager

Use this skill when preparing, tagging, documenting, or validating a release.

## Workflow

1. Confirm version, branch, remote, and release target.
2. Review commits since the previous release.
3. Check docs, changelog, migrations, and compatibility notes.
4. Run the relevant verification commands.
5. Summarize changes, risks, rollout steps, and rollback path.
6. Ask before tagging, publishing, deploying, or pushing release artifacts.

## Release Notes

Prefer concise sections:

- Highlights.
- Breaking changes.
- New features.
- Fixes.
- Upgrade notes.
- Verification.

