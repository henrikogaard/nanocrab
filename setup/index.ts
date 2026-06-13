/**
 * Setup CLI entry point.
 * Usage: npx tsx setup/index.ts --step <name> [args...]
 */
import { logger, redactLogString } from '../src/logger.js';
import { emitStatus } from './status.js';
import { printBanner } from './banner.js';
import { runSetupPreflight } from '../src/setup-preflight.js';
import {
  applySetupStepResult,
  getNextSetupStep,
  markSetupStep,
  readSetupState,
  shouldMarkSetupStepCompleted,
  SetupStepResult,
} from '../src/setup-state.js';

export const SETUP_STATE_FILE = '.setup-state.json';

export const STEPS: Record<
  string,
  () => Promise<{ run: (args: string[]) => Promise<void | SetupStepResult> }>
> = {
  timezone: () => import('./timezone.js'),
  environment: () => import('./environment.js'),
  container: () => import('./container.js'),
  groups: () => import('./groups.js'),
  register: () => import('./register.js'),
  mounts: () => import('./mounts.js'),
  service: () => import('./service.js'),
  verify: () => import('./verify.js'),
  provider: () => import('./provider.js'),
  'codex-auth': () => import('./codex-auth.js'),
  'admin': () => import('./admin.js'),
  'signal-auth': () => import('./signal-auth.js'),
  'whatsapp-auth': () => import('./whatsapp-auth.js'),
};

export const ORDERED_SETUP_STEPS = [
  'environment',
  'timezone',
  'admin',
  'provider',
  'container',
  'mounts',
  'register',
  'service',
  'verify',
];

function printUsage(): void {
  console.error(
    `Usage: npx tsx setup/index.ts --step <${Object.keys(STEPS).join('|')}> [args...]`,
  );
  console.error(`Or:    npm run setup -- --dry-run  (preflight only)`);
  console.error(`Or:    npm run setup:full        (run all steps sequentially)`);
}

async function runDryRun(): Promise<void> {
  printBanner();
  console.log('  Preflight: dry run only; no secrets or generated files are written.\n');
  const result = await runSetupPreflight({ dryRun: true });
  for (const check of result.checks) {
    const icon = check.ok ? 'OK ' : 'FAIL';
    console.log(`  ${icon} ${check.label}: ${check.detail}`);
    if (!check.ok && check.hint) console.log(`       Hint: ${check.hint}`);
  }
  emitStatus('PREFLIGHT', {
    STATUS: result.ok ? 'success' : 'failed',
    CHECKS_TOTAL: result.checks.length,
    CHECKS_PASSED: result.checks.filter((check) => check.ok).length,
    CHECKS_FAILED: result.checks.filter((check) => !check.ok).length,
    DRY_RUN: true,
  });
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  if (args.includes('--dry-run')) {
    await runDryRun();
    return;
  }

  if (args.includes('--preflight')) {
    printBanner();
    const result = await runSetupPreflight();
    for (const check of result.checks) {
      const icon = check.ok ? 'OK ' : 'FAIL';
      console.log(`  ${icon} ${check.label}: ${check.detail}`);
      if (!check.ok && check.hint) console.log(`       Hint: ${check.hint}`);
    }
    emitStatus('PREFLIGHT', {
      STATUS: result.ok ? 'success' : 'failed',
      CHECKS_TOTAL: result.checks.length,
      CHECKS_PASSED: result.checks.filter((check) => check.ok).length,
      CHECKS_FAILED: result.checks.filter((check) => !check.ok).length,
      DRY_RUN: false,
    });
    if (!result.ok) process.exit(1);
    return;
  }

  if (args.includes('--next-step')) {
    const state = readSetupState(SETUP_STATE_FILE, ORDERED_SETUP_STEPS);
    console.log(getNextSetupStep(state, ORDERED_SETUP_STEPS) || '');
    return;
  }

  const stepIdx = args.indexOf('--step');

  if (stepIdx === -1 || !args[stepIdx + 1]) {
    printBanner();
    printUsage();
    process.exit(1);
  }

  const stepName = args[stepIdx + 1];
  const stepArgs = args.filter(
    (a, i) => i !== stepIdx && i !== stepIdx + 1 && a !== '--',
  );

  const loader = STEPS[stepName];
  if (!loader) {
    printBanner();
    console.error(`Unknown step: ${stepName}`);
    console.error(`Available steps: ${Object.keys(STEPS).join(', ')}`);
    process.exit(1);
  }

  printBanner();
  console.log(`  Step: ${stepName}\n`);

  const state = readSetupState(SETUP_STATE_FILE, ORDERED_SETUP_STEPS);
  if (state.steps[stepName]?.status === 'completed') {
    emitStatus(stepName.toUpperCase(), {
      STATUS: 'already_completed',
      STATE: SETUP_STATE_FILE,
    });
    return;
  }

  try {
    if (stepName === 'container') {
      const preflight = await runSetupPreflight();
      if (!preflight.ok) {
        emitStatus('PREFLIGHT', {
          STATUS: 'failed',
          CHECKS_TOTAL: preflight.checks.length,
          CHECKS_PASSED: preflight.checks.filter((check) => check.ok).length,
          CHECKS_FAILED: preflight.checks.filter((check) => !check.ok).length,
        });
        throw new Error('Prerequisite preflight failed');
      }
    }
    markSetupStep(state, stepName, 'running', SETUP_STATE_FILE);
    const mod = await loader();
    const startTime = Date.now();
    const result = await mod.run(stepArgs);
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    applySetupStepResult(state, stepName, result, SETUP_STATE_FILE);
    if (!shouldMarkSetupStepCompleted(result)) {
      const structured = result as SetupStepResult;
      throw new Error(
        structured?.message ||
          structured?.error ||
          structured?.status ||
          'Setup step did not complete successfully',
      );
    }
    emitStatus(stepName.toUpperCase(), {
      STATUS: 'success',
      DURATION_SECS: elapsed,
      STATE: SETUP_STATE_FILE,
    });
  } catch (err) {
    const message = redactLogString(err instanceof Error ? err.message : String(err));
    markSetupStep(state, stepName, 'failed', SETUP_STATE_FILE, message);
    logger.error({ err, step: stepName }, 'Setup step failed');
    emitStatus(stepName.toUpperCase(), {
      STATUS: 'failed',
      ERROR: message,
      STATE: SETUP_STATE_FILE,
    });
    process.exit(1);
  }
}

main();
