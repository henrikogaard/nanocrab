import { Router, Request, Response } from 'express';
import { execFileSync } from 'child_process';
import { randomUUID } from 'crypto';
import fs from 'fs';
import os from 'os';
import path from 'path';

import { STORE_DIR } from '../../config.js';
import { auditLog } from '../security.js';
import { getState } from '../state.js';
import { getAllRegisteredGroups } from '../../db.js';

const router = Router();

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function findRepo(
  repoName: string,
): { hostPath: string; readonly: boolean } | null {
  const groups = getAllRegisteredGroups();
  for (const group of Object.values(groups)) {
    for (const mount of group.containerConfig?.additionalMounts || []) {
      const hostPath = mount.hostPath.replace(
        /^~/,
        process.env.HOME || '/root',
      );
      const name = mount.containerPath || path.basename(hostPath);
      if (name === repoName)
        return { hostPath, readonly: mount.readonly !== false };
    }
  }
  return null;
}

function gitExec(args: string[], cwd: string, timeout = 30000): string {
  return execFileSync('git', args, {
    cwd,
    encoding: 'utf-8',
    timeout,
  }).trim();
}

function requireRepo(
  req: Request,
  res: Response,
): { hostPath: string; readonly: boolean } | null {
  const repo = findRepo(req.params.repo as string);
  if (!repo) {
    res.status(404).json({ error: 'Repo not found' });
    return null;
  }
  return repo;
}

// ---------------------------------------------------------------------------
// Git Operations
// ---------------------------------------------------------------------------

router.get('/git/:repo/status', (req: Request, res: Response) => {
  const repo = requireRepo(req, res);
  if (!repo) return;
  try {
    const status = gitExec(['status', '--porcelain'], repo.hostPath);
    const branch = gitExec(['branch', '--show-current'], repo.hostPath);
    const log = gitExec(['log', '--oneline', '-10'], repo.hostPath);
    const diff = gitExec(['diff', '--stat'], repo.hostPath);
    res.json({
      status: status.split('\n').filter(Boolean),
      branch,
      log: log.split('\n').filter(Boolean),
      diff,
    });
  } catch (err: any) {
    res.status(500).json({ error: err.stderr || err.message });
  }
});

router.get('/git/:repo/diff', (req: Request, res: Response) => {
  const repo = requireRepo(req, res);
  if (!repo) return;
  try {
    const diff = gitExec(['diff'], repo.hostPath);
    const staged = gitExec(['diff', '--cached'], repo.hostPath);
    res.json({ diff, staged });
  } catch (err: any) {
    res.status(500).json({ error: err.stderr || err.message });
  }
});

router.get('/git/:repo/log', (req: Request, res: Response) => {
  const repo = requireRepo(req, res);
  if (!repo) return;
  try {
    const log = gitExec(['log', '--oneline', '-30'], repo.hostPath);
    res.json({ log: log.split('\n').filter(Boolean) });
  } catch (err: any) {
    res.status(500).json({ error: err.stderr || err.message });
  }
});

router.post('/git/:repo/commit', (req: Request, res: Response) => {
  const repo = requireRepo(req, res);
  if (!repo) return;
  if (repo.readonly) {
    res.status(403).json({ error: 'Mount is read-only' });
    return;
  }
  const { message, files } = req.body as { message?: string; files?: string[] };
  if (!message || typeof message !== 'string') {
    res.status(400).json({ error: 'Commit message required' });
    return;
  }
  try {
    if (files && Array.isArray(files) && files.length > 0) {
      gitExec(['add', ...files], repo.hostPath);
    } else {
      gitExec(['add', '-A'], repo.hostPath);
    }
    const result = gitExec(['commit', '-m', message], repo.hostPath);
    auditLog(req, 'git_commit', `${req.params.repo}: ${message}`);
    res.json({ ok: true, output: result });
  } catch (err: any) {
    res.status(500).json({ error: err.stderr || err.message });
  }
});

router.post('/git/:repo/push', (req: Request, res: Response) => {
  const repo = requireRepo(req, res);
  if (!repo) return;
  try {
    const result = gitExec(['push'], repo.hostPath);
    auditLog(req, 'git_push', req.params.repo as string);
    res.json({ ok: true, output: result });
  } catch (err: any) {
    res.status(500).json({ error: err.stderr || err.message });
  }
});

router.post('/git/:repo/pull', (req: Request, res: Response) => {
  const repo = requireRepo(req, res);
  if (!repo) return;
  try {
    const result = gitExec(['pull'], repo.hostPath);
    auditLog(req, 'git_pull', req.params.repo as string);
    res.json({ ok: true, output: result });
  } catch (err: any) {
    res.status(500).json({ error: err.stderr || err.message });
  }
});

router.post('/git/:repo/checkout', (req: Request, res: Response) => {
  const repo = requireRepo(req, res);
  if (!repo) return;
  const { branch } = req.body as { branch?: string };
  if (!branch || typeof branch !== 'string') {
    res.status(400).json({ error: 'Branch name required' });
    return;
  }
  try {
    const result = gitExec(['checkout', branch], repo.hostPath);
    auditLog(req, 'git_checkout', `${req.params.repo}: ${branch}`);
    res.json({ ok: true, output: result });
  } catch (err: any) {
    res.status(500).json({ error: err.stderr || err.message });
  }
});

router.get('/git/:repo/branches', (req: Request, res: Response) => {
  const repo = requireRepo(req, res);
  if (!repo) return;
  try {
    const raw = gitExec(['branch', '-a'], repo.hostPath);
    const branches = raw
      .split('\n')
      .filter(Boolean)
      .map((b) => b.trim());
    const current =
      branches.find((b) => b.startsWith('* '))?.replace('* ', '') || '';
    res.json({
      current,
      branches: branches.map((b) => b.replace(/^\* /, '')),
    });
  } catch (err: any) {
    res.status(500).json({ error: err.stderr || err.message });
  }
});

router.get('/git/:repo/stash', (req: Request, res: Response) => {
  const repo = requireRepo(req, res);
  if (!repo) return;
  try {
    const raw = gitExec(['stash', 'list'], repo.hostPath);
    res.json({ stashes: raw.split('\n').filter(Boolean) });
  } catch (err: any) {
    res.status(500).json({ error: err.stderr || err.message });
  }
});

// ---------------------------------------------------------------------------
// Test Runner
// ---------------------------------------------------------------------------

const testResultsPath = (repo: string) =>
  path.join(STORE_DIR, `test-results-${repo}.json`);

router.post('/test/:repo/run', (req: Request, res: Response) => {
  const repo = requireRepo(req, res);
  if (!repo) return;
  const repoName = req.params.repo as string;
  const start = Date.now();
  let output = '';
  let passed = false;
  try {
    output = execFileSync('npm', ['test'], {
      cwd: repo.hostPath,
      encoding: 'utf-8',
      timeout: 120000,
    });
    passed = true;
  } catch (err: any) {
    output = (err.stdout || '') + '\n' + (err.stderr || '');
    passed = false;
  }
  const duration = Date.now() - start;
  const result = {
    repo: repoName,
    timestamp: new Date().toISOString(),
    passed,
    output: output.trim(),
    duration,
  };
  try {
    fs.writeFileSync(
      testResultsPath(repoName),
      JSON.stringify(result, null, 2),
    );
  } catch {
    /* ignore write errors */
  }
  auditLog(req, 'test_run', `${repoName}: ${passed ? 'passed' : 'failed'}`);
  res.json(result);
});

router.get('/test/:repo/results', (req: Request, res: Response) => {
  const repoName = req.params.repo as string;
  try {
    const data = JSON.parse(
      fs.readFileSync(testResultsPath(repoName), 'utf-8'),
    );
    res.json(data);
  } catch {
    res.status(404).json({ error: 'No test results found' });
  }
});

// ---------------------------------------------------------------------------
// Snippets
// ---------------------------------------------------------------------------

const SNIPPETS_PATH = path.join(STORE_DIR, 'snippets.json');

interface Snippet {
  id: string;
  title: string;
  language: string;
  code: string;
  tags: string[];
  createdAt: string;
}

function loadSnippets(): Snippet[] {
  try {
    return JSON.parse(fs.readFileSync(SNIPPETS_PATH, 'utf-8'));
  } catch {
    return [];
  }
}

function saveSnippets(snippets: Snippet[]): void {
  fs.writeFileSync(SNIPPETS_PATH, JSON.stringify(snippets, null, 2));
}

router.get('/snippets', (_req: Request, res: Response) => {
  res.json(loadSnippets());
});

router.get('/snippets/search', (req: Request, res: Response) => {
  const q = ((req.query.q as string) || '').toLowerCase();
  if (!q) {
    res.json(loadSnippets());
    return;
  }
  const snippets = loadSnippets().filter(
    (s) =>
      s.title.toLowerCase().includes(q) ||
      s.code.toLowerCase().includes(q) ||
      s.tags.some((t) => t.toLowerCase().includes(q)),
  );
  res.json(snippets);
});

router.post('/snippets', (req: Request, res: Response) => {
  const { title, language, code, tags } = req.body as {
    title?: string;
    language?: string;
    code?: string;
    tags?: string[];
  };
  if (!title || !code) {
    res.status(400).json({ error: 'Title and code required' });
    return;
  }
  const snippets = loadSnippets();
  const snippet: Snippet = {
    id: randomUUID(),
    title,
    language: language || 'text',
    code,
    tags: tags || [],
    createdAt: new Date().toISOString(),
  };
  snippets.push(snippet);
  saveSnippets(snippets);
  res.json(snippet);
});

router.put('/snippets/:id', (req: Request, res: Response) => {
  const snippets = loadSnippets();
  const idx = snippets.findIndex((s) => s.id === req.params.id);
  if (idx === -1) {
    res.status(404).json({ error: 'Snippet not found' });
    return;
  }
  const { title, language, code, tags } = req.body;
  if (title !== undefined) snippets[idx].title = title;
  if (language !== undefined) snippets[idx].language = language;
  if (code !== undefined) snippets[idx].code = code;
  if (tags !== undefined) snippets[idx].tags = tags;
  saveSnippets(snippets);
  res.json(snippets[idx]);
});

router.delete('/snippets/:id', (req: Request, res: Response) => {
  const snippets = loadSnippets();
  const idx = snippets.findIndex((s) => s.id === req.params.id);
  if (idx === -1) {
    res.status(404).json({ error: 'Snippet not found' });
    return;
  }
  snippets.splice(idx, 1);
  saveSnippets(snippets);
  res.json({ ok: true });
});

// ---------------------------------------------------------------------------
// Server Monitoring
// ---------------------------------------------------------------------------

const MONITORING_HISTORY_PATH = path.join(
  STORE_DIR,
  'monitoring-history.jsonl',
);

router.get('/monitoring', (_req: Request, res: Response) => {
  const cpus = os.cpus();
  const loadAvg = os.loadavg();
  const memTotal = os.totalmem();
  const memFree = os.freemem();
  const memUsed = memTotal - memFree;

  let disk: { total: number; used: number; available: number } | null = null;
  try {
    const dfOut = execFileSync('df', ['-B1', '/'], {
      encoding: 'utf-8',
      timeout: 5000,
    });
    const lines = dfOut.trim().split('\n');
    if (lines.length >= 2) {
      const parts = lines[1].split(/\s+/);
      disk = {
        total: parseInt(parts[1], 10),
        used: parseInt(parts[2], 10),
        available: parseInt(parts[3], 10),
      };
    }
  } catch {
    /* disk info unavailable */
  }

  res.json({
    timestamp: new Date().toISOString(),
    cpu: {
      cores: cpus.length,
      model: cpus[0]?.model || 'unknown',
      loadAvg,
    },
    memory: {
      total: memTotal,
      used: memUsed,
      free: memFree,
      usedPercent: Math.round((memUsed / memTotal) * 100),
    },
    disk,
    uptime: os.uptime(),
  });
});

router.get('/monitoring/history', (_req: Request, res: Response) => {
  try {
    const raw = fs.readFileSync(MONITORING_HISTORY_PATH, 'utf-8');
    const lines = raw.trim().split('\n').filter(Boolean);
    const last100 = lines
      .slice(-100)
      .map((l) => {
        try {
          return JSON.parse(l);
        } catch {
          return null;
        }
      })
      .filter(Boolean);
    res.json(last100);
  } catch {
    res.json([]);
  }
});

export function recordMonitoringSnapshot(): void {
  const memTotal = os.totalmem();
  const memFree = os.freemem();

  let diskUsed: number | null = null;
  let diskTotal: number | null = null;
  try {
    const dfOut = execFileSync('df', ['-B1', '/'], {
      encoding: 'utf-8',
      timeout: 5000,
    });
    const lines = dfOut.trim().split('\n');
    if (lines.length >= 2) {
      const parts = lines[1].split(/\s+/);
      diskTotal = parseInt(parts[1], 10);
      diskUsed = parseInt(parts[2], 10);
    }
  } catch {
    /* disk info unavailable */
  }

  const snapshot = {
    timestamp: new Date().toISOString(),
    cpu: os.loadavg()[0],
    memUsed: memTotal - memFree,
    memTotal,
    diskUsed,
    diskTotal,
  };

  try {
    fs.appendFileSync(MONITORING_HISTORY_PATH, JSON.stringify(snapshot) + '\n');

    // Keep last 1000 lines
    const raw = fs.readFileSync(MONITORING_HISTORY_PATH, 'utf-8');
    const lines = raw.trim().split('\n').filter(Boolean);
    if (lines.length > 1000) {
      fs.writeFileSync(
        MONITORING_HISTORY_PATH,
        lines.slice(-1000).join('\n') + '\n',
      );
    }
  } catch {
    /* ignore write errors */
  }
}

// ---------------------------------------------------------------------------
// Deploy Pipeline
// ---------------------------------------------------------------------------

const DEPLOY_PATH = path.join(STORE_DIR, 'deploy-pipelines.json');

interface DeployStep {
  name: string;
  command: string;
}

interface Pipeline {
  id: string;
  name: string;
  repo: string;
  steps: DeployStep[];
  lastRun: string | null;
  lastStatus: string | null;
}

function loadPipelines(): Pipeline[] {
  try {
    return JSON.parse(fs.readFileSync(DEPLOY_PATH, 'utf-8'));
  } catch {
    return [];
  }
}

function savePipelines(pipelines: Pipeline[]): void {
  fs.writeFileSync(DEPLOY_PATH, JSON.stringify(pipelines, null, 2));
}

router.get('/deploy', (_req: Request, res: Response) => {
  res.json(loadPipelines());
});

router.post('/deploy', (req: Request, res: Response) => {
  const { name, repo, steps } = req.body as {
    name?: string;
    repo?: string;
    steps?: DeployStep[];
  };
  if (!name || !repo || !steps || !Array.isArray(steps)) {
    res.status(400).json({ error: 'name, repo, and steps required' });
    return;
  }
  const pipelines = loadPipelines();
  const pipeline: Pipeline = {
    id: randomUUID(),
    name,
    repo,
    steps,
    lastRun: null,
    lastStatus: null,
  };
  pipelines.push(pipeline);
  savePipelines(pipelines);
  auditLog(req, 'deploy_pipeline_created', name);
  res.json(pipeline);
});

router.put('/deploy/:id', (req: Request, res: Response) => {
  const pipelines = loadPipelines();
  const idx = pipelines.findIndex((p) => p.id === req.params.id);
  if (idx === -1) {
    res.status(404).json({ error: 'Pipeline not found' });
    return;
  }
  const { name, repo, steps } = req.body;
  if (name !== undefined) pipelines[idx].name = name;
  if (repo !== undefined) pipelines[idx].repo = repo;
  if (steps !== undefined) pipelines[idx].steps = steps;
  savePipelines(pipelines);
  res.json(pipelines[idx]);
});

router.delete('/deploy/:id', (req: Request, res: Response) => {
  const pipelines = loadPipelines();
  const idx = pipelines.findIndex((p) => p.id === req.params.id);
  if (idx === -1) {
    res.status(404).json({ error: 'Pipeline not found' });
    return;
  }
  const removed = pipelines.splice(idx, 1)[0];
  savePipelines(pipelines);
  auditLog(req, 'deploy_pipeline_deleted', removed.name);
  res.json({ ok: true });
});

router.post('/deploy/:id/run', (req: Request, res: Response) => {
  const pipelines = loadPipelines();
  const idx = pipelines.findIndex((p) => p.id === req.params.id);
  if (idx === -1) {
    res.status(404).json({ error: 'Pipeline not found' });
    return;
  }
  const pipeline = pipelines[idx];
  const repo = findRepo(pipeline.repo);
  const cwd = repo?.hostPath || process.cwd();

  const results: Array<{ step: string; success: boolean; output: string }> = [];
  let allPassed = true;

  for (const step of pipeline.steps) {
    try {
      const parts = step.command.split(/\s+/);
      const output = execFileSync(parts[0], parts.slice(1), {
        cwd,
        encoding: 'utf-8',
        timeout: 120000,
      }).trim();
      results.push({ step: step.name, success: true, output });
    } catch (err: any) {
      const output = (err.stdout || '') + '\n' + (err.stderr || '');
      results.push({ step: step.name, success: false, output: output.trim() });
      allPassed = false;
      break; // stop on first failure
    }
  }

  pipelines[idx].lastRun = new Date().toISOString();
  pipelines[idx].lastStatus = allPassed ? 'success' : 'failed';
  savePipelines(pipelines);

  auditLog(
    req,
    'deploy_pipeline_run',
    `${pipeline.name}: ${allPassed ? 'success' : 'failed'}`,
  );
  res.json({ ok: allPassed, results });
});

// ---------------------------------------------------------------------------
// Code Review Rules
// ---------------------------------------------------------------------------

const REVIEW_RULES_PATH = path.join(STORE_DIR, 'review-rules.md');

router.get('/review-rules', (_req: Request, res: Response) => {
  try {
    const content = fs.readFileSync(REVIEW_RULES_PATH, 'utf-8');
    res.json({ content });
  } catch {
    res.json({ content: '' });
  }
});

router.put('/review-rules', (req: Request, res: Response) => {
  const { content } = req.body;
  if (typeof content !== 'string') {
    res.status(400).json({ error: 'Content required' });
    return;
  }
  try {
    fs.writeFileSync(REVIEW_RULES_PATH, content, 'utf-8');
    auditLog(req, 'review_rules_updated', 'Updated code review rules');
    res.json({ ok: true });
  } catch {
    res.status(500).json({ error: 'Failed to write review rules' });
  }
});

// ---------------------------------------------------------------------------
// Developer Guide
// ---------------------------------------------------------------------------

router.get('/guide', (_req: Request, res: Response) => {
  res.json({
    sections: [
      {
        title: 'Getting Started',
        content: `## Mount a Repository\n\n1. Go to **Mounts** and add your project directory as an allowed root\n2. Go to **Groups** and edit your main group's containerConfig to add an additionalMount\n3. The bot can now read and edit files in your repo\n\n## Example:\n\`\`\`json\n{\n  "additionalMounts": [\n    { "hostPath": "~/projects/myapp", "containerPath": "myapp", "readonly": false }\n  ]\n}\n\`\`\``,
      },
      {
        title: 'Delegating Tasks',
        content: `## From Your Phone\n\nSend these to your bot via WhatsApp/Signal/Telegram:\n\n- "Review the last 3 commits in myapp"\n- "Fix the failing tests in myapp"\n- "Add input validation to the user registration endpoint"\n- "Create a PR for the changes you just made"\n- "Run the test suite and report results"\n\n## Scheduled Tasks\n\nSet up recurring dev tasks:\n- "Every morning, check for outdated dependencies"\n- "Run tests at 6am, alert me if they fail"\n- "Review open PRs every afternoon"`,
      },
      {
        title: 'GitHub Integration',
        content: `## Setup\n\n1. Add your \`GITHUB_TOKEN\` in **Credentials** (needs repo scope)\n2. Register enabled coding repos before using issue pickup or autofix\n3. Set up a webhook in **Webhooks** pointing to your server\n\n## Coding Job Reviews\n\nGitHub issue jobs move through staged states: queued, investigate, plan, await_approval, implement, test, await_pr_approval, open_pr, ci_running, completed. Implementation, pushes, and PR creation require job-scoped approval records before mutation.\n\n## What You Can Ask\n\n- "List open issues on my-org/my-repo"\n- "Pick the next autofix issue assigned to me in milestone P0"\n- "Review PR #42 and suggest improvements"\n- "Merge PR #42 after CI passes"`,
      },
      {
        title: 'Code Review Rules',
        content: `## Define Your Standards\n\nWrite your coding standards in **Review Rules**. The bot will follow these when reviewing code:\n\n- Naming conventions\n- Error handling patterns\n- Testing requirements\n- Security best practices\n- Architecture decisions\n\nExample:\n\`\`\`markdown\n- Use TypeScript strict mode\n- All API endpoints must have input validation\n- No console.log in production code\n- Tests required for all new functions\n- Use async/await, never callbacks\n\`\`\``,
      },
      {
        title: 'Deploy Pipeline',
        content: `## Automated Deploys\n\nCreate a deploy pipeline with sequential steps:\n\n1. Pull latest code\n2. Install dependencies\n3. Run tests\n4. Build\n5. Restart service\n\nTrigger from the dashboard or ask the bot:\n"Deploy myapp to production"`,
      },
      {
        title: 'Tips & Tricks',
        content: `## Pro Tips\n\n- **Use persistent containers**: Main groups keep containers warm for instant responses\n- **Mount read-write**: Set \`readonly: false\` to let the bot edit your code\n- **Branch before changes**: Ask the bot to "create a branch called fix/auth-bug, then fix the authentication issue"\n- **Review before merge**: "Show me the diff of the changes you made, then create a PR"\n- **Use scripts in tasks**: Add bash scripts to scheduled tasks to check conditions before waking the agent\n- **Voice commands**: Send a voice message on WhatsApp — the bot transcribes and acts on it\n- **Parallel agents**: Ask the bot to "use agent teams to review the frontend and backend code simultaneously"`,
      },
    ],
  });
});

export default router;
