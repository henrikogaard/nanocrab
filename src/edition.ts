/**
 * NanoCrab identity.
 *
 * NanoCrab is a standalone product. Some legacy protocol and service names
 * still use nanocrab while migration work continues, but those names are local
 * compatibility shims rather than upstream integration points.
 */
import fs from 'fs';
import path from 'path';

export const EDITION_NAME = 'NanoCrab Edition'; // Full name
export const EDITION_SHORT = 'NanoCrab'; // Display title
export const EDITION_VERSION = '2.0-RC8';

// Read application version from package.json.
let _appVersion = 'unknown';
try {
  const pkg = JSON.parse(
    fs.readFileSync(path.join(process.cwd(), 'package.json'), 'utf-8'),
  );
  _appVersion = pkg.version || 'unknown';
} catch {}

export const APP_VERSION = _appVersion;
export const NANOCRAB_VERSION = APP_VERSION;
