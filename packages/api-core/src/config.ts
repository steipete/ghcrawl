import fs from 'node:fs';
import path from 'node:path';

import dotenv from 'dotenv';

export type GitcrawlConfig = {
  workspaceRoot: string;
  dbPath: string;
  apiPort: number;
  githubToken?: string;
  openaiApiKey?: string;
  summaryModel: string;
  embedModel: string;
  openSearchUrl?: string;
  openSearchIndex: string;
};

function findWorkspaceRoot(start: string): string {
  let current = path.resolve(start);
  while (true) {
    if (fs.existsSync(path.join(current, 'pnpm-workspace.yaml'))) {
      return current;
    }
    const parent = path.dirname(current);
    if (parent === current) return path.resolve(start);
    current = parent;
  }
}

export function loadConfig(options: { cwd?: string; env?: NodeJS.ProcessEnv } = {}): GitcrawlConfig {
  const cwd = options.cwd ?? process.cwd();
  const env = options.env ?? process.env;
  const workspaceRoot = findWorkspaceRoot(cwd);

  dotenv.config({ path: path.join(workspaceRoot, '.env.local'), quiet: true });

  const dbPath = path.resolve(workspaceRoot, env.GITCRAWL_DB_PATH ?? 'data/gitcrawl.db');
  const apiPortRaw = env.GITCRAWL_API_PORT ?? '5179';
  const apiPort = Number(apiPortRaw);
  if (!Number.isSafeInteger(apiPort) || apiPort <= 0) {
    throw new Error(`Invalid GITCRAWL_API_PORT: ${apiPortRaw}`);
  }

  return {
    workspaceRoot,
    dbPath,
    apiPort,
    githubToken: env.GITHUB_TOKEN,
    openaiApiKey: env.OPENAI_API_KEY,
    summaryModel: env.GITCRAWL_SUMMARY_MODEL ?? 'gpt-5-mini',
    embedModel: env.GITCRAWL_EMBED_MODEL ?? 'text-embedding-3-small',
    openSearchUrl: env.GITCRAWL_OPENSEARCH_URL,
    openSearchIndex: env.GITCRAWL_OPENSEARCH_INDEX ?? 'gitcrawl-threads',
  };
}

export function ensureRuntimeDirs(config: GitcrawlConfig): void {
  fs.mkdirSync(path.dirname(config.dbPath), { recursive: true });
}

export function requireGithubToken(config: GitcrawlConfig): string {
  if (!config.githubToken) {
    throw new Error('Missing GITHUB_TOKEN (expected in .env.local or environment)');
  }
  return config.githubToken;
}

export function requireOpenAiKey(config: GitcrawlConfig): string {
  if (!config.openaiApiKey) {
    throw new Error('Missing OPENAI_API_KEY (expected in .env.local or environment)');
  }
  return config.openaiApiKey;
}
