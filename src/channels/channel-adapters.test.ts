import { describe, expect, it } from 'vitest';
import fs from 'fs';
import path from 'path';

const channelIndexPath = path.join(process.cwd(), 'src/channels/index.ts');

describe('channel adapter barrel', () => {
  it('self-registers every supported runtime channel', () => {
    const source = fs.readFileSync(channelIndexPath, 'utf8');

    expect(source).toContain("import './discord.js'");
    expect(source).toContain("import './slack.js'");
    expect(source).toContain("import './telegram.js'");
    expect(source).toContain("import './signal.js'");
    expect(source).toContain("import './whatsapp.js'");
    expect(source).toContain("import './web.js'");
  });
});
