import { logger } from '../logger.js';

export interface ToolCallMarker {
  type: 'tool_call';
  id: string;
  name: string;
  input: string;
}

export interface ToolResultMarker {
  type: 'tool_result';
  id: string;
  output: string;
  duration: string;
}

export interface ApprovalRequestMarker {
  type: 'approval_request';
  id: string;
  tool: string;
  reason: string;
  input: string;
}

export interface ProgressMarker {
  type: 'progress';
  phase: string;
  pct: number;
  message: string;
}

export type ParsedMarker =
  | ToolCallMarker
  | ToolResultMarker
  | ApprovalRequestMarker
  | ProgressMarker;

const MARKER_RE =
  /<(tool_call|tool_result|approval_request|progress)\s+([^>]*?)(?:\/>|(>)([\s\S]*?)<\/\1>)/g;
const ATTR_RE = /(\w+)\s*=\s*("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*')/g;

function parseAttributes(attrsStr: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  let m: RegExpExecArray | null;
  while ((m = ATTR_RE.exec(attrsStr)) !== null) {
    attrs[m[1]] = m[2].slice(1, -1);
  }
  return attrs;
}

export function extractStructuredMarkers(text: string): ParsedMarker[] {
  const markers: ParsedMarker[] = [];
  let m: RegExpExecArray | null;
  while ((m = MARKER_RE.exec(text)) !== null) {
    const tagName = m[1];
    const attrs = parseAttributes(m[2]);
    const innerText = m[4] || '';
    try {
      switch (tagName) {
        case 'tool_call':
          markers.push({
            type: 'tool_call',
            id: attrs.id,
            name: attrs.name,
            input: attrs.input || '{}',
          });
          break;
        case 'tool_result':
          markers.push({
            type: 'tool_result',
            id: attrs.id,
            output: attrs.output || '{}',
            duration: attrs.duration || '0',
          });
          break;
        case 'approval_request':
          markers.push({
            type: 'approval_request',
            id: attrs.id,
            tool: attrs.tool,
            reason: attrs.reason || '',
            input: attrs.input || '{}',
          });
          break;
        case 'progress':
          markers.push({
            type: 'progress',
            phase: attrs.phase,
            pct: parseInt(attrs.pct || '0', 10),
            message: innerText || attrs.message || '',
          });
          break;
      }
    } catch (err) {
      logger.warn({ err, tagName, attrs }, 'Failed to parse structured marker');
    }
  }
  return markers;
}

export function stripStructuredMarkers(text: string): string {
  return text.replace(
    /<(tool_call|tool_result|approval_request|progress)\s+[^>]*?(?:\/>|>[\s\S]*?<\/\1>)/g,
    '',
  );
}
