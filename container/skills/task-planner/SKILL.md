---
name: task-planner
description: Turn chat requests into tasks, schedules, reminders, follow-ups, and lightweight plans. Use when the user asks to remember to do something, repeat an action, track work, or organize a request.
allowed-tools: mcp__nanocrab__*
---

# Task Planner

Use this skill when a request has future action, scheduling, reminders, recurring work, or a task list hiding inside a conversation.

## Workflow

1. Extract the requested outcome, owner, due time, recurrence, channel, and constraints.
2. If time/date is ambiguous, ask one short clarification.
3. For recurring reminders, confirm frequency and stop condition.
4. Use available task or scheduling tools when the user clearly asks for an actual reminder/task.
5. Keep plans compact and action-oriented.
6. If the same planning pattern repeats, ask whether NanoCrab should draft a skill for it.

## Safety

Do not schedule external messages, publishing, or destructive actions without explicit approval.

