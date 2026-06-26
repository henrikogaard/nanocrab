import { describe, expect, it } from 'vitest';
import fs from 'fs';
import path from 'path';

const pushRoutePath = path.join(process.cwd(), 'src/admin/routes/push.ts');

describe('Push notification payload assets', () => {
  it('uses the NanoCrab app mark for server-sent notification icon and badge', () => {
    const source = fs.readFileSync(pushRoutePath, 'utf8');

    expect(source).toContain(
      "const PUSH_ICON_PATH = '/static/nanocrab-mark.png'",
    );
    expect(source).toContain('icon: PUSH_ICON_PATH');
    expect(source).toContain('badge: PUSH_ICON_PATH');
    expect(source).not.toContain("icon: '/icon-192.png'");
    expect(source).not.toContain("badge: '/icon-192.png'");
  });
});
