/**
 * Voice message transcription via OpenAI Whisper API.
 * Returns null if OPENAI_API_KEY is not set or transcription fails.
 */
import fs from 'fs';
import path from 'path';

import { STORE_DIR } from './config.js';
import { logger } from './logger.js';

const WHISPER_URL = 'https://api.openai.com/v1/audio/transcriptions';

function logProviderUsage(
  provider: string,
  service: string,
  model: string,
  cost: number,
  durationMs: number,
  details?: string,
): void {
  try {
    const entry = {
      timestamp: new Date().toISOString(),
      provider,
      service,
      model,
      estimatedCost: cost,
      durationMs,
      details,
    };
    const logPath = path.join(STORE_DIR, 'provider-usage.jsonl');
    fs.appendFileSync(logPath, JSON.stringify(entry) + '\n');
  } catch {
    // non-fatal
  }
}

export async function transcribeAudio(
  filePath: string,
): Promise<string | null> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return null;

  const startTime = Date.now();
  try {
    const fileBuffer = fs.readFileSync(filePath);
    const filename = path.basename(filePath);

    const form = new FormData();
    form.append('file', new Blob([fileBuffer]), filename);
    form.append('model', 'whisper-1');

    const res = await fetch(WHISPER_URL, {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}` },
      body: form,
    });

    if (!res.ok) {
      const err = await res.text();
      logger.warn({ status: res.status, err }, 'Whisper transcription failed');
      return null;
    }

    const data = (await res.json()) as { text: string };
    const duration = Date.now() - startTime;
    // Whisper pricing: $0.006/min, estimate from file size (~16KB/sec for ogg)
    const fileSizeKb = fileBuffer.length / 1024;
    const estMinutes = Math.max(0.1, fileSizeKb / (16 * 60));
    logProviderUsage(
      'openai',
      'transcription',
      'whisper-1',
      estMinutes * 0.006,
      duration,
      filename,
    );
    logger.info(
      { filePath, length: data.text.length },
      'Voice message transcribed',
    );
    return data.text;
  } catch (err) {
    logger.error({ err, filePath }, 'Whisper transcription error');
    return null;
  }
}
