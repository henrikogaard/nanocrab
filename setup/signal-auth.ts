/**
 * Step: signal-auth — Signal registration for a dedicated phone number.
 * Handles: register → verify SMS code flow via signal-cli.
 */
import { execSync, spawnSync } from 'child_process';
import fs from 'fs';
import path from 'path';

import { logger } from '../src/logger.js';
import { emitStatus } from './status.js';

function parseArgs(args: string[]): {
  phone: string;
  code: string;
  captcha: string;
  verifyOnly: boolean;
} {
  let phone = '';
  let code = '';
  let captcha = '';
  let verifyOnly = false;
  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case '--phone':
        phone = args[++i];
        break;
      case '--code':
        code = args[++i];
        break;
      case '--captcha':
        captcha = args[++i];
        break;
      case '--verify-only':
        verifyOnly = true;
        break;
    }
  }
  return { phone, code, captcha, verifyOnly };
}

function emitSignalStatus(
  authStatus: string,
  status: string,
  extra: Record<string, string> = {},
): void {
  emitStatus('AUTH_SIGNAL', {
    AUTH_STATUS: authStatus,
    ...extra,
    STATUS: status,
    LOG: 'logs/setup.log',
  });
}

function findSignalCli(): string {
  const envPath = process.env.SIGNAL_CLI_PATH;
  if (envPath) return envPath;

  try {
    const result = spawnSync('which', ['signal-cli'], { encoding: 'utf-8' });
    if (result.status === 0 && result.stdout.trim()) {
      return result.stdout.trim();
    }
  } catch {
    // fall through
  }

  throw new Error(
    'signal-cli not found. Install it: https://github.com/AsamK/signal-cli',
  );
}

function isRegistered(signalCli: string, phone: string): boolean {
  try {
    const result = spawnSync(signalCli, ['-a', phone, 'listDevices'], {
      encoding: 'utf-8',
      timeout: 15000,
    });
    return result.status === 0;
  } catch {
    return false;
  }
}

export async function run(args: string[]): Promise<void> {
  const { phone, code, captcha, verifyOnly } = parseArgs(args);

  if (!phone) {
    emitSignalStatus('failed', 'failed', { ERROR: 'missing_phone_number' });
    process.exit(4);
  }

  const signalCli = findSignalCli();
  logger.info({ phone, signalCli }, 'Starting Signal authentication');

  // Check if already registered
  if (isRegistered(signalCli, phone)) {
    emitSignalStatus('already_authenticated', 'success', {
      PHONE_NUMBER: phone,
    });
    return;
  }

  if (verifyOnly) {
    // Just verify with the code
    if (!code) {
      emitSignalStatus('failed', 'failed', {
        ERROR: 'missing_verification_code',
      });
      process.exit(4);
    }

    const verifyResult = spawnSync(
      signalCli,
      ['-a', phone, 'verify', code],
      { encoding: 'utf-8', timeout: 30000 },
    );

    if (verifyResult.status === 0) {
      emitSignalStatus('authenticated', 'success', { PHONE_NUMBER: phone });
    } else {
      emitSignalStatus('failed', 'failed', {
        ERROR: `verify_failed: ${verifyResult.stderr?.trim() || verifyResult.stdout?.trim() || 'unknown error'}`,
      });
      process.exit(1);
    }
    return;
  }

  // Step 1: Register (sends SMS)
  const registerArgs = ['-a', phone, 'register'];
  if (captcha) {
    registerArgs.push('--captcha', captcha);
  }

  logger.info({ phone }, 'Registering Signal number (SMS verification)...');
  const registerResult = spawnSync(signalCli, registerArgs, {
    encoding: 'utf-8',
    timeout: 30000,
  });

  if (registerResult.status !== 0) {
    const stderr = registerResult.stderr?.trim() || '';

    // Check if captcha is required
    if (stderr.includes('captcha') || stderr.includes('CAPTCHA')) {
      emitSignalStatus('captcha_required', 'waiting', {
        PHONE_NUMBER: phone,
        ERROR:
          'CAPTCHA required. Visit https://signalcaptchas.org/registration/generate.html, solve the captcha, copy the signalcaptcha:// URI, and pass it with --captcha',
      });
      // Write captcha instructions to a file
      const projectRoot = process.cwd();
      fs.writeFileSync(
        path.join(projectRoot, 'store', 'signal-captcha-needed.txt'),
        'Visit https://signalcaptchas.org/registration/generate.html\nSolve the captcha\nCopy the signalcaptcha:// URI\nRe-run with --captcha <URI>',
      );
      process.exit(2);
    }

    emitSignalStatus('failed', 'failed', {
      ERROR: `register_failed: ${stderr || 'unknown error'}`,
    });
    process.exit(1);
  }

  // Step 2: Wait for verification code
  emitSignalStatus('verification_code_required', 'waiting', {
    PHONE_NUMBER: phone,
  });

  // Write status file so callers know we're waiting
  const projectRoot = process.cwd();
  const codeFile = path.join(projectRoot, 'store', 'signal-verify-code.txt');
  fs.mkdirSync(path.dirname(codeFile), { recursive: true });

  // Poll for the verification code file (written by the skill/caller)
  logger.info('Waiting for verification code...');
  for (let i = 0; i < 120; i++) {
    if (fs.existsSync(codeFile)) {
      const verifyCode = fs.readFileSync(codeFile, 'utf-8').trim();
      if (verifyCode) {
        // Clean up
        try {
          fs.unlinkSync(codeFile);
        } catch {
          /* ok */
        }

        // Verify
        const verifyResult = spawnSync(
          signalCli,
          ['-a', phone, 'verify', verifyCode],
          { encoding: 'utf-8', timeout: 30000 },
        );

        if (verifyResult.status === 0) {
          emitSignalStatus('authenticated', 'success', {
            PHONE_NUMBER: phone,
          });
          return;
        } else {
          emitSignalStatus('failed', 'failed', {
            ERROR: `verify_failed: ${verifyResult.stderr?.trim() || 'unknown error'}`,
          });
          process.exit(1);
        }
      }
    }
    await new Promise((r) => setTimeout(r, 1000));
  }

  emitSignalStatus('failed', 'failed', { ERROR: 'verification_code_timeout' });
  process.exit(3);
}
