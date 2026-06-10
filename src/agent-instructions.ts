import fs from 'fs';
import path from 'path';

export const AGENT_INSTRUCTIONS_FILE = 'AGENTS.md';
export const CLAUDE_COMPAT_FILE = 'CLAUDE.md';

export function agentInstructionsPath(groupDir: string): string {
  return path.join(groupDir, AGENT_INSTRUCTIONS_FILE);
}

export function claudeCompatPath(groupDir: string): string {
  return path.join(groupDir, CLAUDE_COMPAT_FILE);
}

export function claudeCompatContent(): string {
  return [
    '# See AGENTS.md',
    '',
    'Canonical agent instructions live in [AGENTS.md](AGENTS.md).',
    'This compatibility file is kept for Claude-specific tooling that still looks for CLAUDE.md.',
    '',
  ].join('\n');
}

export function readAgentInstructions(groupDir: string): string {
  const agentsPath = agentInstructionsPath(groupDir);
  if (fs.existsSync(agentsPath)) {
    return fs.readFileSync(agentsPath, 'utf-8');
  }

  const legacyPath = claudeCompatPath(groupDir);
  if (fs.existsSync(legacyPath)) {
    return fs.readFileSync(legacyPath, 'utf-8');
  }

  return '';
}

export function writeAgentInstructions(
  groupDir: string,
  content: string,
): void {
  fs.mkdirSync(groupDir, { recursive: true });
  fs.writeFileSync(agentInstructionsPath(groupDir), content, 'utf-8');
  fs.writeFileSync(claudeCompatPath(groupDir), claudeCompatContent(), 'utf-8');
}

export function copyAgentInstructionsTemplate(
  templateDir: string,
  targetDir: string,
): boolean {
  const targetPath = agentInstructionsPath(targetDir);
  if (fs.existsSync(targetPath)) return false;

  const targetLegacyPath = claudeCompatPath(targetDir);
  if (fs.existsSync(targetLegacyPath)) {
    fs.copyFileSync(targetLegacyPath, targetPath);
    fs.writeFileSync(targetLegacyPath, claudeCompatContent(), 'utf-8');
    return true;
  }

  const sourcePath = fs.existsSync(agentInstructionsPath(templateDir))
    ? agentInstructionsPath(templateDir)
    : claudeCompatPath(templateDir);

  if (!fs.existsSync(sourcePath)) return false;

  const content = fs.readFileSync(sourcePath, 'utf-8');
  writeAgentInstructions(targetDir, content);
  return true;
}

export function migrateAgentInstructionsDir(groupDir: string): void {
  const agentsPath = agentInstructionsPath(groupDir);
  const legacyPath = claudeCompatPath(groupDir);

  if (!fs.existsSync(agentsPath) && fs.existsSync(legacyPath)) {
    fs.copyFileSync(legacyPath, agentsPath);
  }

  if (fs.existsSync(agentsPath)) {
    fs.writeFileSync(legacyPath, claudeCompatContent(), 'utf-8');
  }
}
