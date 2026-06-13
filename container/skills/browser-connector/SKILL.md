---
name: browser-connector
description: Use browser/research connectors for current web context, source checking, screenshots, and lightweight page inspection.
triggers: browser, web, research, search, screenshot, inspect, current, source, citation, page
risk-level: low
allowed-tools: mcp__browser__*, mcp__nanocrab__*, Bash(agent-browser:*)
---

# Browser Connector

Use this skill when the user asks for current web research, source checking, page inspection, browser screenshots, or a short evidence-backed answer.

## Workflow

1. Determine whether the request needs current information or inspection of a specific page.
2. Use read-only browsing first and record source URLs.
3. Prefer primary sources for technical, legal, financial, medical, product, or policy claims.
4. Summarize findings with dates and uncertainty when information may have changed.
5. Ask before submitting forms, logging in, purchasing, posting, downloading sensitive files, or uploading user data.

## Output

- Cite sources for factual claims.
- Mention when a page could not be accessed or when a source is indirect.
- Keep screenshots or extracted details limited to the user's requested scope.
