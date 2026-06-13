---
name: drive-files-connector
description: Search, summarize, and prepare actions for connected drive/file systems such as kDrive or Google Drive.
triggers: drive, files, kdrive, google drive, document, folder, upload, share, attachment, storage
risk-level: medium
allowed-tools: mcp__google-workspace__*, mcp__infomaniak__*, mcp__infomaniak_*__*, mcp__nanocrab__*
---

# Drive Files Connector

Use this skill when the user asks to find, summarize, organize, export, upload, or share files through connected drive/file MCP servers.

## Workflow

1. Clarify the drive, folder, file type, time range, and desired action when the request is ambiguous.
2. Search narrowly before reading file contents.
3. Summarize candidate files with name, owner/source, modified date, and why they match.
4. For document review or report generation, copy only approved source material into a local artifact workflow.
5. Ask before uploading, deleting, moving, renaming, sharing, changing permissions, or sending files externally.

## Privacy

- Treat drive contents as private user data.
- Prefer summaries and references over raw excerpts.
- Do not broaden searches across unrelated folders or accounts without approval.

## Output

- Include exact file identifiers or paths when available.
- Clearly label read-only findings separately from proposed write actions.
