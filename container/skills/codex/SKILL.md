---
name: codex
description: Use OpenAI Codex CLI for coding tasks. Codex is an autonomous coding agent from OpenAI. Use when the user asks to use Codex or wants an alternative AI perspective on a coding task.
allowed-tools: Bash(codex:*)
---

# OpenAI Codex CLI

Codex is an AI coding agent from OpenAI, installed globally in the container.

## Authentication

Codex supports two auth methods:

1. **ChatGPT OAuth** (recommended) — uses your ChatGPT Plus/Pro subscription, no API credits needed
2. **API Key** — uses `OPENAI_API_KEY` with standard API billing

If authenticated via OAuth, Codex stores tokens in `~/.codex/` which is persisted across container runs.

To authenticate with ChatGPT (run once, headless-friendly):

```bash
codex login --device-auth
```

This prints a URL and device code. The user visits the URL, enters the code, and Codex stores the token. After this, no API key is needed for Codex.

## Usage

Run Codex in non-interactive (quiet) mode:

```bash
codex --quiet "your prompt here"
```

## Important Flags

- `--quiet` or `-q` — **Required.** Runs without interactive UI. Without this, Codex will hang waiting for TTY input.
- `--full-auto` — Auto-approve all file changes (use with caution)
- `--model` — Choose model (default: o4-mini)

## Examples

```bash
# Write a script
codex -q "Write a Python script that fetches weather data from OpenWeatherMap API"

# Fix a bug in a file
codex -q "Fix the bug in app.py where the login function doesn't handle empty passwords"

# Full auto mode for trusted tasks
codex -q --full-auto "Add unit tests for utils.ts"
```

## Usage Tracking

After running Codex, log the usage for cost tracking:

```bash
echo '{"timestamp":"'$(date -u +%Y-%m-%dT%H:%M:%S.000Z)'","provider":"openai","service":"codex","model":"o4-mini","estimatedCost":0.01}' >> /workspace/project/store/provider-usage.jsonl 2>/dev/null || true
```

## Notes

- Codex runs in `/workspace/group` (the current working directory)
- Auth: prefers OAuth token in `~/.codex/`, falls back to `OPENAI_API_KEY` env var
- Codex creates and modifies files directly — review changes after it runs
- For large tasks, prefer using Codex for the coding part, then review and send results yourself
