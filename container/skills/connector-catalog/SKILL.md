---
name: connector-catalog
description: Discover configured MCP connectors, explain connector capabilities, and plan safe setup or permission changes.
triggers: connector, connectors, mcp, catalog, server, tool, tools, permission, setup, credential, oauth, webhook
risk-level: medium
allowed-tools: mcp__nanocrab__*
---

# Connector Catalog

Use this skill when the user asks what connectors exist, which tools are available, why a connector is missing, or how to safely enable an MCP server.

## Workflow

1. Inspect the configured connector catalog, health, permissions, and setup checklist when NanoCrab tools are available.
2. Separate installed, preset, and manual connectors in the answer.
3. Explain which actions are read-only and which actions can write, publish, upload, send, delete, or mutate repositories.
4. For permission changes, propose the narrowest connector, group, agent, and action scope.
5. Ask for explicit approval before changing credentials, connector permissions, webhook targets, OAuth setup, uploads, messages, repository writes, or risky automation.

## Output

- Show connector name, status, credential state, allowed groups/agents, and risky actions.
- Prefer short setup checklists with the next missing step.
- When a connector is unavailable, suggest a fallback only if it preserves privacy and approval rules.
