import { Channel, NewMessage } from './types.js';
import { formatLocalTime } from './timezone.js';
import { logAuditEvent } from './audit-log.js';
import { evaluatePolicy } from './policy-engine.js';

export function escapeXml(s: string): string {
  if (!s) return '';
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function formatMessages(
  messages: NewMessage[],
  timezone: string,
): string {
  const lines = messages.map((m) => {
    const displayTime = formatLocalTime(m.timestamp, timezone);
    const replyAttr = m.reply_to_message_id
      ? ` reply_to="${escapeXml(m.reply_to_message_id)}"`
      : '';
    const replySnippet =
      m.reply_to_message_content && m.reply_to_sender_name
        ? `\n  <quoted_message from="${escapeXml(m.reply_to_sender_name)}">${escapeXml(m.reply_to_message_content)}</quoted_message>`
        : '';
    return `<message sender="${escapeXml(m.sender_name)}" time="${escapeXml(displayTime)}"${replyAttr}>${replySnippet}${escapeXml(m.content)}</message>`;
  });

  const header = `<context timezone="${escapeXml(timezone)}" />\n`;

  return `${header}<messages>\n${lines.join('\n')}\n</messages>`;
}

export function stripInternalTags(text: string): string {
  return text.replace(/<internal>[\s\S]*?<\/internal>/g, '').trim();
}

function formatSignalText(text: string): string {
  return text
    .replace(/```(?:\w+)?\n?([\s\S]*?)```/g, '$1')
    .replace(/`([^`\n]+)`/g, '$1')
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '$1 ($2)')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/\*\*([^*\n][\s\S]*?[^*\n])\*\*/g, '$1')
    .replace(/(^|[^\w*])\*([^*\n][^*\n]*?[^*\n])\*(?=$|[^\w*])/g, '$1$2')
    .replace(/(^|[^\w_])_([^_\n][^_\n]*?[^_\n])_(?=$|[^\w_])/g, '$1$2')
    .trim();
}

export function formatOutbound(rawText: string, jid?: string): string {
  let text = stripInternalTags(rawText);
  if (jid?.startsWith('sig:')) {
    text = formatSignalText(text);
  }
  if (!text) return '';
  return text;
}

export function routeOutbound(
  channels: Channel[],
  jid: string,
  text: string,
): Promise<void> {
  const start = Date.now();
  const policy = evaluatePolicy({
    actor: 'router',
    actionType: 'channel.send',
    resource: jid,
    context: { jid, textLength: text.length },
  });
  logAuditEvent({
    actor: 'router',
    actionType: 'channel.send',
    resource: jid,
    decision: policy.decision,
    context: policy,
  });
  if (policy.decision === 'denied' || policy.decision === 'requires_approval') {
    logAuditEvent({
      actor: 'router',
      actionType: 'policy.denial',
      resource: jid,
      decision: policy.decision,
      durationMs: Date.now() - start,
      context: policy,
    });
    throw new Error(`Outbound send blocked by policy: ${policy.explanation}`);
  }
  const channel = channels.find((c) => c.ownsJid(jid) && c.isConnected());
  if (!channel) throw new Error(`No channel for JID: ${jid}`);
  return channel
    .sendMessage(jid, text)
    .then(() => {
      logAuditEvent({
        actor: 'router',
        actionType: 'channel.send',
        resource: jid,
        decision: 'allowed',
        durationMs: Date.now() - start,
        context: { channel: channel.name, textLength: text.length },
      });
    })
    .catch((err) => {
      logAuditEvent({
        actor: 'router',
        actionType: 'channel.send',
        resource: jid,
        decision: 'error',
        durationMs: Date.now() - start,
        error: err,
        context: { channel: channel.name, textLength: text.length },
      });
      throw err;
    });
}

export function findChannel(
  channels: Channel[],
  jid: string,
): Channel | undefined {
  return channels.find((c) => c.ownsJid(jid));
}
