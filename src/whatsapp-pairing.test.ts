import { EventEmitter } from 'events';
import fs from 'fs';
import path from 'path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const TEST_ROOT = '/tmp/nanocrab-whatsapp-pairing-test';

vi.mock('./config.js', () => ({
  STORE_DIR: '/tmp/nanocrab-whatsapp-pairing-test/store',
}));

import {
  getWhatsAppPairingStatus,
  resetWhatsAppPairing,
  startWhatsAppPairing,
} from './whatsapp-pairing.js';

function fakeProcess(): any {
  const proc = new EventEmitter() as any;
  proc.killed = false;
  proc.exitCode = null;
  proc.kill = vi.fn(() => {
    proc.killed = true;
    proc.exitCode = 0;
  });
  return proc;
}

describe('whatsapp pairing', () => {
  beforeEach(() => {
    fs.rmSync(TEST_ROOT, { recursive: true, force: true });
    fs.mkdirSync(path.join(TEST_ROOT, 'store'), { recursive: true });
    resetWhatsAppPairing({
      projectRoot: TEST_ROOT,
      storeDir: path.join(TEST_ROOT, 'store'),
    });
  });

  afterEach(() => {
    resetWhatsAppPairing({
      projectRoot: TEST_ROOT,
      storeDir: path.join(TEST_ROOT, 'store'),
    });
  });

  it('reports a fresh install as not configured', () => {
    expect(
      getWhatsAppPairingStatus({
        projectRoot: TEST_ROOT,
        storeDir: path.join(TEST_ROOT, 'store'),
      }),
    ).toMatchObject({ state: 'not_configured', authConfigured: false });
  });

  it('starts QR pairing without exposing auth credentials', () => {
    const proc = fakeProcess();
    const status = startWhatsAppPairing({
      projectRoot: TEST_ROOT,
      storeDir: path.join(TEST_ROOT, 'store'),
      method: 'qr',
      spawnAuth: () => proc,
    });

    expect(status).toMatchObject({
      state: 'starting',
      processRunning: true,
      qrData: null,
    });
    const serialized = JSON.stringify(status);
    expect(serialized).not.toContain('creds');
  });

  it('reports active QR and expiry state from transient QR data', () => {
    const qrPath = path.join(TEST_ROOT, 'store', 'qr-data.txt');
    fs.writeFileSync(qrPath, 'qr-login-token');

    const status = getWhatsAppPairingStatus({
      projectRoot: TEST_ROOT,
      storeDir: path.join(TEST_ROOT, 'store'),
      now: new Date(),
    });

    expect(status).toMatchObject({
      state: 'waiting_for_qr_scan',
      qrData: 'qr-login-token',
    });
    expect(status.qrExpiresAt).toBeTruthy();
  });

  it('reports pairing code state separately from QR data', () => {
    fs.writeFileSync(
      path.join(TEST_ROOT, 'store', 'auth-status.txt'),
      'pairing_code:1234-5678',
    );

    expect(
      getWhatsAppPairingStatus({
        projectRoot: TEST_ROOT,
        storeDir: path.join(TEST_ROOT, 'store'),
      }),
    ).toMatchObject({
      state: 'waiting_for_pairing_code',
      pairingCode: '1234-5678',
      qrData: null,
    });
  });
});
