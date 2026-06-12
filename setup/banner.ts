const CRAB_ART = `
                 ╱|、
               (˚ˎ 。7
                |、˜〵
                じしˍ,)ノ
    ╔══════════════════════════════════════╗
    ║        🦀  N A N O C R A B          ║
    ║   Standalone Personal AI Assistant   ║
    ╚══════════════════════════════════════╝
`;

const CRAB_SMALL = `
  ╱|、
 (˚ˎ 。7   N A N O C R A B
  |、˜〵   Personal AI Assistant
  じしˍ,)ノ
`;

export function printBanner(): void {
  console.log(CRAB_ART);
}

export function printFooter(elapsedMs?: number): void {
  const time = elapsedMs != null ? ` (${(elapsedMs / 1000).toFixed(1)}s)` : '';
  console.log(`
  ╔══════════════════════════════════════╗
  ║   Setup complete${time.padEnd(14)}║
  ║   Run  npm run start  to launch      ║
  ╚══════════════════════════════════════╝
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
