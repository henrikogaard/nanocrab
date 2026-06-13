/**
 * Step: container — Build container image and verify with test run.
 * Replaces 03-setup-container.sh
 */
import { execSync } from 'child_process';
import path from 'path';

import { logger } from '../src/logger.js';
import { detectContainerRuntime } from '../src/setup-preflight.js';
import { SetupStepResult } from '../src/setup-state.js';
import { commandExists } from './platform.js';
import { emitStatus } from './status.js';

function parseArgs(args: string[]): { runtime: string } {
  let runtime = '';
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--runtime' && args[i + 1]) {
      runtime = args[i + 1];
      i++;
    }
  }
  return { runtime };
}

export async function run(args: string[]): Promise<SetupStepResult> {
  const projectRoot = process.cwd();
  let { runtime } = parseArgs(args);
  const image = 'nanocrab-agent:latest';
  const logFile = path.join(projectRoot, 'logs', 'setup.log');
  if (!runtime) runtime = detectContainerRuntime();

  if (!runtime) {
    emitStatus('SETUP_CONTAINER', {
      RUNTIME: 'unknown',
      IMAGE: image,
      BUILD_OK: false,
      TEST_OK: false,
      STATUS: 'failed',
      ERROR: 'missing_runtime_flag',
      LOG: 'logs/setup.log',
    });
    return {
      status: 'input_required',
      message:
        'No container runtime detected. Install/start Docker or pass --runtime apple-container.',
    };
  }

  // Validate runtime availability
  if (runtime === 'apple-container' && !commandExists('container')) {
    emitStatus('SETUP_CONTAINER', {
      RUNTIME: runtime,
      IMAGE: image,
      BUILD_OK: false,
      TEST_OK: false,
      STATUS: 'failed',
      ERROR: 'runtime_not_available',
      LOG: 'logs/setup.log',
    });
    return { status: 'failed', message: 'Apple Container is not available' };
  }

  if (runtime === 'docker') {
    if (!commandExists('docker')) {
      emitStatus('SETUP_CONTAINER', {
        RUNTIME: runtime,
        IMAGE: image,
        BUILD_OK: false,
        TEST_OK: false,
        STATUS: 'failed',
        ERROR: 'runtime_not_available',
        LOG: 'logs/setup.log',
      });
      return { status: 'failed', message: 'Docker is not installed' };
    }
    try {
      execSync('docker info', { stdio: 'ignore' });
    } catch {
      emitStatus('SETUP_CONTAINER', {
        RUNTIME: runtime,
        IMAGE: image,
        BUILD_OK: false,
        TEST_OK: false,
        STATUS: 'failed',
        ERROR: 'runtime_not_available',
        LOG: 'logs/setup.log',
      });
      return { status: 'failed', message: 'Docker is installed but not running' };
    }
  }

  if (!['apple-container', 'docker'].includes(runtime)) {
    emitStatus('SETUP_CONTAINER', {
      RUNTIME: runtime,
      IMAGE: image,
      BUILD_OK: false,
      TEST_OK: false,
      STATUS: 'failed',
      ERROR: 'unknown_runtime',
      LOG: 'logs/setup.log',
    });
    return { status: 'input_required', message: `Unknown runtime: ${runtime}` };
  }

  const buildCmd =
    runtime === 'apple-container' ? 'container build' : 'docker build';
  const runCmd = runtime === 'apple-container' ? 'container' : 'docker';

  // Build
  let buildOk = false;
  logger.info({ runtime }, 'Building container');
  try {
    execSync(`${buildCmd} -t ${image} .`, {
      cwd: path.join(projectRoot, 'container'),
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    buildOk = true;
    logger.info('Container build succeeded');
  } catch (err) {
    logger.error({ err }, 'Container build failed');
  }

  // Test
  let testOk = false;
  if (buildOk) {
    logger.info('Testing container');
    try {
      const output = execSync(
        `echo '{}' | ${runCmd} run -i --rm --entrypoint /bin/echo ${image} "Container OK"`,
        { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] },
      );
      testOk = output.includes('Container OK');
      logger.info({ testOk }, 'Container test result');
    } catch {
      logger.error('Container test failed');
    }
  }

  const status = buildOk && testOk ? 'success' : 'failed';

  emitStatus('SETUP_CONTAINER', {
    RUNTIME: runtime,
    IMAGE: image,
    BUILD_OK: buildOk,
    TEST_OK: testOk,
    STATUS: status,
    LOG: 'logs/setup.log',
  });

  if (status === 'failed') {
    return { status: 'failed', message: 'Container build or test failed' };
  }
  return { status: 'success' };
}
