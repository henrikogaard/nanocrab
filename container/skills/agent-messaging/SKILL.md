---
name: agent-messaging
description: Send messages to other NanoCrab agent groups. Enables cross-agent collaboration and coordination.
allowed-tools: Bash(curl:*)
---

# Agent-to-Agent Messaging

Send messages to other NanoCrab agent groups via the admin API.

## Sending a Message

```bash
curl -s -X POST http://172.17.0.1:9744/api/agents/message \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $NANOCRAB_API_TOKEN" \
  -d '{
    "fromGroup": "YOUR_GROUP_FOLDER",
    "toGroup": "TARGET_GROUP_FOLDER",
    "content": "Your message here"
  }'
```

Replace:

- `YOUR_GROUP_FOLDER` — your group's folder name (check `/workspace/ipc/` path)
- `TARGET_GROUP_FOLDER` — the recipient group's folder name
- The message content can be any text, including structured data or instructions

## Reading Incoming Messages

Check the IPC input directory for incoming agent messages:

```bash
ls /workspace/ipc/input/agent-msg-*.json 2>/dev/null
```

Each message file contains:

```json
{
  "type": "agent_message",
  "id": "uuid",
  "fromGroup": "sender-folder",
  "content": "message text",
  "timestamp": "2025-04-25T12:00:00.000Z"
}
```

After processing a message, delete the file to avoid reprocessing:

```bash
rm /workspace/ipc/input/agent-msg-*.json
```

## Use Cases

- **Task delegation** — Main agent sends sub-tasks to specialized agents
- **Status updates** — Agents report progress to the main agent
- **Data sharing** — Pass processed data between agents
- **Coordination** — Synchronize multi-step workflows across agents

## Notes

- Messages are stored in the database and visible in the admin dashboard
- The `NANOCRAB_API_TOKEN` environment variable is set automatically in containers
- The admin API is accessible from containers via `172.17.0.1:9744` (Docker host gateway)
