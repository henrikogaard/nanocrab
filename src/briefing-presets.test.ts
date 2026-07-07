import { describe, expect, it } from 'vitest';

import { getBriefingPreset, listBriefingPresets } from './briefing-presets.js';

describe('briefing presets', () => {
  it('defines daily and weekly briefing jobs', () => {
    expect(listBriefingPresets().map((preset) => preset.id)).toEqual([
      'daily-operations',
      'weekly-operations',
    ]);
    expect(getBriefingPreset('daily-operations')).toMatchObject({
      schedule: 'daily',
      sourceScopes: expect.arrayContaining(['journal', 'memory']),
      requireOutlineApproval: true,
    });
  });
});
