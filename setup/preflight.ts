/**
 * Step: preflight — clean-install readiness checks before long-running setup.
 */
import { buildSetupReadiness } from '../src/setup-readiness.js';
import { logger } from '../src/logger.js';
import { emitStatus } from './status.js';

function printLine(message = ''): void {
  process.stdout.write(`${message}\n`);
}

export async function run(_args: string[]): Promise<void> {
  const readiness = buildSetupReadiness();

  printLine('');
  for (const line of readiness.asciiArt) printLine(line);
  printLine('');
  printLine(`${readiness.productName} setup preflight`);
  printLine(readiness.headline);
  printLine('');

  for (const item of readiness.checks) {
    const marker =
      item.status === 'pass'
        ? '[PASS]'
        : item.status === 'warn'
          ? '[WARN]'
          : '[FAIL]';
    printLine(`${marker} ${item.label}`);
    printLine(`       ${item.detail}`);
    if (item.status !== 'pass' && item.remediation) {
      printLine(`       Fix: ${item.remediation}`);
    }
    if (item.status !== 'pass' && item.resumeNote) {
      printLine(`       Resume: ${item.resumeNote}`);
    }
  }

  printLine('');
  printLine(readiness.secretPolicy);

  logger.info(
    {
      overall: readiness.overall,
      failed: readiness.failed,
      warnings: readiness.warnings,
    },
    'Setup preflight complete',
  );

  emitStatus('PREFLIGHT', {
    STATUS: readiness.overall === 'fail' ? 'failed' : 'success',
    OVERALL: readiness.overall,
    FAILED: readiness.failed,
    WARNINGS: readiness.warnings,
    LOG: 'logs/setup.log',
  });

  if (readiness.overall === 'fail') process.exit(1);
}
