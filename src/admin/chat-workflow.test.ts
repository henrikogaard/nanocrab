import { describe, it, expect } from 'vitest';
import { extractStructuredMarkers, stripStructuredMarkers } from './chat-workflow.js';

describe('extractStructuredMarkers', () => {
  it('extracts tool_call marker', () => {
    const markers = extractStructuredMarkers('<tool_call id="tc_1" name="read_file" input=\'{"path":"src/config.ts"}\' />');
    expect(markers).toHaveLength(1);
    if (markers[0].type === 'tool_call') {
      expect(markers[0].id).toBe('tc_1');
      expect(markers[0].name).toBe('read_file');
    } else {
      expect.unreachable('Expected tool_call');
    }
  });

  it('extracts tool_result marker', () => {
    const markers = extractStructuredMarkers('<tool_result id="tc_1" output=\'{"content":"ok"}\' duration="0.342" />');
    expect(markers).toHaveLength(1);
    if (markers[0].type === 'tool_result') {
      expect(markers[0].id).toBe('tc_1');
      expect(markers[0].output).toBe('{"content":"ok"}');
      expect(markers[0].duration).toBe('0.342');
    }
  });

  it('extracts approval_request marker', () => {
    const markers = extractStructuredMarkers('<approval_request id="ar_1" tool="write_file" reason="Modifying config" input=\'{"path":"/etc/config.yaml"}\' />');
    expect(markers).toHaveLength(1);
    if (markers[0].type === 'approval_request') {
      expect(markers[0].tool).toBe('write_file');
      expect(markers[0].reason).toBe('Modifying config');
    }
  });

  it('extracts progress marker', () => {
    const markers = extractStructuredMarkers('<progress phase="researching" pct="15">Researching codebase...</progress>');
    expect(markers).toHaveLength(1);
    if (markers[0].type === 'progress') {
      expect(markers[0].phase).toBe('researching');
      expect(markers[0].pct).toBe(15);
    }
  });

  it('extracts multiple markers in one string', () => {
    const text = [
      '<progress phase="writing" pct="50">Writing...</progress>',
      '<tool_call id="tc_1" name="read_file" input=\'{}\' />',
      '<tool_result id="tc_1" output=\'{}\' duration="0.1" />',
    ].join('\n');
    const markers = extractStructuredMarkers(text);
    expect(markers).toHaveLength(3);
  });

  it('returns empty for text without markers', () => {
    expect(extractStructuredMarkers('Hello world')).toEqual([]);
  });
});

describe('stripStructuredMarkers', () => {
  it('removes all markers from text', () => {
    const text = 'Hello <tool_call id="tc_1" name="read_file" input=\'{}\' /> world';
    expect(stripStructuredMarkers(text)).toBe('Hello  world');
  });

  it('removes progress marker with inner text', () => {
    const text = 'before<progress phase="test" pct="10">message</progress>after';
    expect(stripStructuredMarkers(text)).toBe('beforeafter');
  });
});
