#!/usr/bin/env node

const [major] = process.versions.node.split('.').map(Number);

if (major < 20 || major >= 26) {
  console.error(
    [
      `NanoCrab supports Node >=20 <26 for local development and tests. Current runtime: ${process.version}.`,
      'Use the repo runtime before running DB-backed tests, for example:',
      '  mise exec node@24 -- npm test',
      'or:',
      '  nvm use',
      '',
      'This guard prevents better-sqlite3 native binding failures from being mistaken for product regressions.',
    ].join('\n'),
  );
  process.exit(1);
}
