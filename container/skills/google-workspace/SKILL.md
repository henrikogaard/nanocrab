---
name: google-workspace
description: Access Gmail and Google Calendar via MCP tools. Search/send emails, create/list calendar events.
allowed-tools: mcp__google-workspace__*
---

# Google Workspace (Gmail + Calendar)

Access Gmail and Google Calendar through the Google Workspace MCP server.

## Available Tools

### Gmail

- **search_emails** — Search emails by query (from, to, subject, labels, date range)
- **read_email** — Read full email content by message ID
- **send_email** — Send an email (to, subject, body, cc, bcc)
- **reply_to_email** — Reply to an existing email thread
- **list_labels** — List all Gmail labels
- **modify_labels** — Add/remove labels from a message

### Google Calendar

- **list_events** — List upcoming events (optional date range, calendar ID)
- **create_event** — Create a calendar event (title, start, end, attendees, description)
- **update_event** — Update an existing event
- **delete_event** — Delete a calendar event
- **list_calendars** — List available calendars

## Authentication

Authentication is handled automatically via the credential proxy. The MCP server uses OAuth tokens injected at runtime — no manual token management needed.

## Examples

```
# Search recent emails from a specific sender
Use search_emails with query "from:boss@company.com after:2025/01/01"

# Send an email
Use send_email with to="user@example.com", subject="Meeting notes", body="..."

# Check today's calendar
Use list_events with timeMin=today, timeMax=tomorrow

# Create a meeting
Use create_event with title="Team sync", start="2025-04-28T10:00:00", end="2025-04-28T10:30:00", attendees=["team@company.com"]
```

## Notes

- Email searches use Gmail's search syntax (same as the Gmail search bar)
- Calendar times should be in ISO 8601 format
- The default calendar is the user's primary calendar
- Large email bodies may be truncated — use read_email for full content
