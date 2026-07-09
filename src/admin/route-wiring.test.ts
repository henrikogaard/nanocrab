import { describe, expect, it } from 'vitest';
import fs from 'fs';
import path from 'path';

const adminIndexPath = path.join(process.cwd(), 'src/admin/index.ts');
const routesDir = path.join(process.cwd(), 'src/admin/routes');

describe('admin route wiring', () => {
  it('keeps every admin route module mounted by the dashboard server', () => {
    const indexSource = fs.readFileSync(adminIndexPath, 'utf8');
    const routeFiles = fs
      .readdirSync(routesDir)
      .filter((file) => file.endsWith('.ts') && !file.endsWith('.test.ts'))
      .sort();

    const unmounted = routeFiles.filter((file) => {
      const routeName = file.replace(/\.ts$/, '');
      return !indexSource.includes(`./routes/${routeName}.js`);
    });

    expect(unmounted).toEqual([]);
  });
});
