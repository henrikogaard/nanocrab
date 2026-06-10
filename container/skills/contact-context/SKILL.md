---
name: contact-context
description: Maintain useful context about people, teams, alliances, customers, vendors, and recurring collaborators. Use when the user asks who someone is or how to handle a relationship.
triggers: contact, person, people, team, alliance, customer, vendor, member, relationship, collaborator
examples: who is this person, what do we know about that alliance, remember this player's role, summarize this customer
risk-level: high
allowed-tools: mcp__nanocrab__*
---

# Contact Context

Use this skill when managing durable context about people or organizations.

## Rules

1. Treat personal data as sensitive by default.
2. Separate confirmed facts, user opinions, and operational notes.
3. Prefer private visibility unless the user explicitly wants shared context.
4. Do not infer sensitive traits.
5. Ask before storing or sharing information about a person.

## Output

When summarizing a contact, include known role, relationship, recent context, open follow-ups, source/provenance, and confidence.

