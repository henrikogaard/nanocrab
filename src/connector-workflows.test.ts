import { describe, expect, it } from 'vitest';

import { listConnectorWorkflows } from './connector-workflows.js';

describe('connector workflows', () => {
  it('lists email workflows with approval metadata for write-capable actions', () => {
    const workflows = listConnectorWorkflows({ domain: 'email' });

    expect(workflows.map((workflow) => workflow.id)).toEqual(
      expect.arrayContaining(['email-inbox-triage', 'email-send-approved']),
    );
    expect(
      workflows.find((workflow) => workflow.id === 'email-send-approved'),
    ).toMatchObject({
      approvalRequired: true,
      risk: 'high',
      writeScopes: expect.arrayContaining(['gmail:send', 'mail:send']),
    });
  });

  it('lists calendar workflows with approval metadata for event changes', () => {
    const workflows = listConnectorWorkflows({ domain: 'calendar' });

    expect(workflows.map((workflow) => workflow.id)).toEqual(
      expect.arrayContaining([
        'calendar-availability-review',
        'calendar-event-change-approved',
      ]),
    );
    expect(
      workflows.find(
        (workflow) => workflow.id === 'calendar-event-change-approved',
      ),
    ).toMatchObject({
      approvalRequired: true,
      risk: 'high',
      writeScopes: expect.arrayContaining(['calendar:write', 'dav:write']),
    });
  });

  it('lists kDrive document workflows with approval metadata for writes', () => {
    const workflows = listConnectorWorkflows({ domain: 'documents' });

    expect(workflows.map((workflow) => workflow.id)).toEqual(
      expect.arrayContaining(['kdrive-file-search', 'kdrive-write-approved']),
    );
    expect(
      workflows.find((workflow) => workflow.id === 'kdrive-write-approved'),
    ).toMatchObject({
      approvalRequired: true,
      risk: 'high',
      writeScopes: expect.arrayContaining(['kdrive:write']),
    });
  });
});
