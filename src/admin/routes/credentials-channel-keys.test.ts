import { describe, expect, it } from 'vitest';
import fs from 'fs';
import path from 'path';

const credentialsRoutePath = path.join(
  process.cwd(),
  'src/admin/routes/credentials.ts',
);

describe('channel credentials catalog', () => {
  it('exposes Slack and Discord runtime credentials in the admin credential editor', () => {
    const source = fs.readFileSync(credentialsRoutePath, 'utf8');

    expect(source).toContain("key: 'SLACK_BOT_TOKEN'");
    expect(source).toContain("key: 'SLACK_APP_TOKEN'");
    expect(source).toContain("key: 'DISCORD_BOT_TOKEN'");
    expect(source).toContain("label: 'Slack Bot Token'");
    expect(source).toContain("label: 'Slack App Token'");
    expect(source).toContain("label: 'Discord Bot Token'");
  });
});
