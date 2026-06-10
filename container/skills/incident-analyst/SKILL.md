---
name: incident-analyst
description: Reconstruct what happened from logs, messages, journal events, and timelines. Use for outages, attacks, fleet crashes, postmortems, and lessons learned.
triggers: incident, outage, crash, attack, fleet, postmortem, timeline, what happened, root cause, impact
examples: when did that fleet crash happen, explain the outage, make a postmortem, reconstruct the attack
risk-level: medium
allowed-tools: mcp__nanocrab__*, Bash(grep:*), Bash(tail:*), Bash(journalctl:*)
---

# Incident Analyst

Use this skill to reconstruct notable events and failures.

## Workflow

1. Collect evidence from journal events, messages, logs, and source files.
2. Build a timeline with timestamps and confidence.
3. Separate confirmed facts from hypotheses.
4. Identify impact, cause, decisions, and follow-up actions.
5. Cite sources and note gaps.

