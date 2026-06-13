import {
  APP_VERSION,
  EDITION_NAME,
  EDITION_SHORT,
  EDITION_VERSION,
} from '../src/edition.js';

const CRAB_ART = `
       _     _     _     _     _     _
      / \\___/ \\___/ \\___/ \\___/ \\___/ \\
     (  o   o   N A N O C R A B   o   o )
      \\_/---\\_/---\\_/---\\_/---\\_/---\\_/
          \\_V_/                 \\_V_/

      ${EDITION_SHORT} - ${EDITION_NAME}
      Edition ${EDITION_VERSION} | App ${APP_VERSION}
      Standalone Personal AI Assistant
`;

const CRAB_SMALL = `
  /\\___/\\___/\\
 ( o  NanoCrab o )
  \\/---\\_/---\\/
  ${EDITION_VERSION} | ${APP_VERSION}
`;

export function printBanner(): void {
  console.log(CRAB_ART);
}

export function printFooter(elapsedMs?: number): void {
  const time = elapsedMs != null ? ` (${(elapsedMs / 1000).toFixed(1)}s)` : '';
  console.log(`
  +--------------------------------------+
  |   Setup complete${time.padEnd(14)}|
  |   Run  npm run start  to launch      |
  +--------------------------------------+
`);
}

export function printStepHeader(stepName: string, description: string): void {
  const label = `${stepName.toUpperCase()} — ${description}`;
  console.log(`\n  › ${label}`);
  console.log(`  ${'─'.repeat(Math.min(label.length + 2, 60))}\n`);
}

export function printRecoveryGuide(
  step: string,
  error: string,
  hints: string[],
): void {
  console.error(`\n  ✖ Setup failed at step: ${step}`);
  console.error(`  ${'─'.repeat(50)}`);
  console.error(`  Error: ${error}`);
  if (hints.length > 0) {
    console.error(`\n  Recovery:`);
    for (const hint of hints) {
      console.error(`    • ${hint}`);
    }
    console.error(`\n  After fixing, re-run:  npm run setup:full`);
  }
  console.error();
}

export { CRAB_ART, CRAB_SMALL };
