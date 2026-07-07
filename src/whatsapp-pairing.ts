import { ChildProcess, spawn } from 'child_process';
import fs from 'fs';
import path from 'path';

import { STORE_DIR } from './config.js';

export type WhatsAppPairingState =
  | 'not_configured'
  | 'starting'
  | 'waiting_for_qr_scan'
  | 'waiting_for_pairing_code'
  | 'paired'
  | 'connected'
  | 'expired_qr'
  | 'error';

export interface WhatsAppPairingStatus {
  state: WhatsAppPairingState;
  method: 'qr' | 'pairing-code' | null;
  startedAt: string | null;
  updatedAt: string | null;
  qrData: string | null;
  qrUpdatedAt: string | null;
  qrExpiresAt: string | null;
  pairingCode: string | null;
  error: string | null;
  connected: boolean;
  phone: string | null;
  authConfigured: boolean;
  processRunning: boolean;
}

export interface WhatsAppPairingOptions {
  projectRoot?: string;
  storeDir?: string;
  now?: Date;
}

export interface StartWhatsAppPairingOptions extends WhatsAppPairingOptions {
  method: 'qr' | 'pairing-code';
  phone?: string;
  spawnAuth?: (args: string[], cwd: string) => ChildProcess;
}

const QR_TTL_MS = 60000;

let authProcess: ChildProcess | null = null;
let authLogStream: fs.WriteStream | null = null;
let startedAt: string | null = null;
let method: WhatsAppPairingStatus['method'] = null;
let lastError: string | null = null;

function paths(options: WhatsAppPairingOptions = {}): {
  projectRoot: string;
  storeDir: string;
  authDir: string;
  qrFile: string;
  statusFile: string;
  logFile: string;
} {
  const projectRoot = options.projectRoot || process.cwd();
  const storeDir = options.storeDir || STORE_DIR;
  return {
    projectRoot,
    storeDir,
    authDir: path.join(storeDir, 'auth'),
    qrFile: path.join(storeDir, 'qr-data.txt'),
    statusFile: path.join(storeDir, 'auth-status.txt'),
    logFile: path.join(projectRoot, 'logs', 'setup.log'),
  };
}

function readText(filePath: string): string {
  try {
    return fs.readFileSync(filePath, 'utf-8').trim();
  } catch {
    return '';
  }
}

function fileTimestamp(filePath: string): string | null {
  try {
    return fs.statSync(filePath).mtime.toISOString();
  } catch {
    return null;
  }
}

function readAuthPhone(authDir: string): string | null {
  try {
    const creds = JSON.parse(
      fs.readFileSync(path.join(authDir, 'creds.json'), 'utf-8'),
    );
    return creds.me?.id?.split(':')[0]?.split('@')[0] || null;
  } catch {
    return null;
  }
}

function authConfigured(authDir: string): boolean {
  try {
    const creds = JSON.parse(
      fs.readFileSync(path.join(authDir, 'creds.json'), 'utf-8'),
    );
    return !!(creds.registered || creds.me?.id);
  } catch {
    return false;
  }
}

function processRunning(): boolean {
  return !!authProcess && !authProcess.killed && authProcess.exitCode === null;
}

function spawnAuthProcess(args: string[], cwd: string): ChildProcess {
  return spawn('npx', ['tsx', 'src/whatsapp-auth.ts', ...args], {
    cwd,
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: false,
  });
}

function cleanupTransientFiles(storeDir: string): void {
  for (const file of ['qr-data.txt', 'auth-status.txt', 'pairing-code.txt']) {
    try {
      fs.unlinkSync(path.join(storeDir, file));
    } catch {
      // ok
    }
  }
}

export function getWhatsAppPairingStatus(
  options: WhatsAppPairingOptions & { connected?: boolean } = {},
): WhatsAppPairingStatus {
  const p = paths(options);
  const now = options.now || new Date();
  const statusText = readText(p.statusFile);
  const qrData = readText(p.qrFile) || null;
  const qrUpdatedAt = qrData ? fileTimestamp(p.qrFile) : null;
  const qrExpiresAt = qrUpdatedAt
    ? new Date(new Date(qrUpdatedAt).getTime() + QR_TTL_MS).toISOString()
    : null;
  const qrExpired = qrExpiresAt
    ? now.getTime() > new Date(qrExpiresAt).getTime()
    : false;
  const isConfigured = authConfigured(p.authDir);
  const connected = options.connected === true;

  let state: WhatsAppPairingState = isConfigured ? 'paired' : 'not_configured';
  let pairingCode: string | null = null;
  let error = lastError;

  if (connected) {
    state = 'connected';
  } else if (
    statusText === 'authenticated' ||
    statusText === 'already_authenticated'
  ) {
    state = 'paired';
  } else if (statusText.startsWith('pairing_code:')) {
    state = 'waiting_for_pairing_code';
    pairingCode = statusText.replace('pairing_code:', '');
  } else if (statusText.startsWith('failed:')) {
    state = 'error';
    error = statusText.replace('failed:', '') || 'authentication failed';
  } else if (qrData && !qrExpired) {
    state = 'waiting_for_qr_scan';
  } else if (qrData && qrExpired) {
    state = 'expired_qr';
  } else if (processRunning()) {
    state = 'starting';
  }

  return {
    state,
    method,
    startedAt,
    updatedAt: fileTimestamp(p.statusFile) || qrUpdatedAt,
    qrData,
    qrUpdatedAt,
    qrExpiresAt,
    pairingCode,
    error,
    connected,
    phone: readAuthPhone(p.authDir),
    authConfigured: isConfigured,
    processRunning: processRunning(),
  };
}

export function startWhatsAppPairing(
  options: StartWhatsAppPairingOptions,
): WhatsAppPairingStatus {
  const p = paths(options);
  fs.mkdirSync(p.storeDir, { recursive: true });
  fs.mkdirSync(path.dirname(p.logFile), { recursive: true });

  if (processRunning()) {
    return getWhatsAppPairingStatus(options);
  }

  cleanupTransientFiles(p.storeDir);
  method = options.method;
  startedAt = new Date().toISOString();
  lastError = null;

  const args =
    options.method === 'pairing-code'
      ? ['--pairing-code', '--phone', options.phone || '']
      : [];
  authProcess = (options.spawnAuth || spawnAuthProcess)(args, p.projectRoot);
  authLogStream?.end();
  if (authProcess.stdout || authProcess.stderr) {
    authLogStream = fs.createWriteStream(p.logFile, { flags: 'a' });
    authProcess.stdout?.pipe(authLogStream);
    authProcess.stderr?.pipe(authLogStream);
  }
  authProcess.on('error', (err) => {
    lastError = err.message;
  });
  authProcess.on('close', (code) => {
    if (code && !lastError) lastError = `auth process exited with ${code}`;
    authLogStream?.end();
    authLogStream = null;
  });

  return getWhatsAppPairingStatus(options);
}

export function cancelWhatsAppPairing(): void {
  if (processRunning()) {
    authProcess?.kill('SIGTERM');
  }
  authProcess = null;
  authLogStream?.end();
  authLogStream = null;
  startedAt = null;
  method = null;
}

export function resetWhatsAppPairing(
  options: WhatsAppPairingOptions = {},
): void {
  cancelWhatsAppPairing();
  const p = paths(options);
  cleanupTransientFiles(p.storeDir);
  fs.rmSync(p.authDir, { recursive: true, force: true });
  lastError = null;
}
