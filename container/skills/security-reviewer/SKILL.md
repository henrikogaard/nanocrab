---
name: security-reviewer
description: Review configs, MCP servers, providers, tokens, exposed ports, permissions, automations, and deployment risk.
triggers: security, token, secret, credential, mcp, provider, firewall, port, permission, risk, audit
examples: review this MCP server, check exposed ports, is this safe, audit provider settings
risk-level: high
allowed-tools: Bash(git:*), Bash(grep:*), Bash(ss:*), Bash(find:*), mcp__nanocrab__*
---

# Security Reviewer

Use this skill for security and privacy review.

## Checklist

- Secrets exposure.
- Over-broad MCP tools.
- Write-capable provider fallback.
- Public ports and dashboards.
- Container isolation.
- File mounts and permissions.
- Automation actions that publish, upload, send, delete, or mutate.

Lead with concrete risks and mitigations.

