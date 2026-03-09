#!/usr/bin/env node
import { once } from 'node:events';
import { parseArgs } from 'node:util';

import { createApiServer, GitcrawlService } from '@gitcrawl/api-core';

type CommandName =
  | 'init'
  | 'doctor'
  | 'sync'
  | 'summarize'
  | 'purge-comments'
  | 'embed'
  | 'cluster'
  | 'search'
  | 'neighbors'
  | 'serve';

function usage(): string {
  return `gitcrawl <command> [options]

Commands:
  init
  doctor
  sync <owner/repo> [--since <iso|duration>] [--limit <count>] [--include-comments]
  summarize <owner/repo> [--number <thread>] [--include-comments]
  purge-comments <owner/repo> [--number <thread>]
  embed <owner/repo> [--number <thread>]
  cluster <owner/repo> [--k <count>] [--threshold <score>]
  search <owner/repo> --query <text> [--mode keyword|semantic|hybrid]
  neighbors <owner/repo> --number <thread> [--limit <count>] [--threshold <score>]
  serve
`;
}

export function parseOwnerRepo(value: string): { owner: string; repo: string } {
  const trimmed = value.trim();
  const parts = trimmed.split('/');
  if (parts.length !== 2 || !parts[0] || !parts[1]) {
    throw new Error(`Expected owner/repo, received: ${value}`);
  }
  return { owner: parts[0], repo: parts[1] };
}

export function parseRepoFlags(args: string[]): { owner: string; repo: string; values: Record<string, string | boolean> } {
  const parsed = parseArgs({
    args,
    allowPositionals: true,
    options: {
      owner: { type: 'string' },
      repo: { type: 'string' },
      since: { type: 'string' },
      limit: { type: 'string' },
      'include-comments': { type: 'boolean' },
      number: { type: 'string' },
      query: { type: 'string' },
      mode: { type: 'string' },
      k: { type: 'string' },
      threshold: { type: 'string' },
      port: { type: 'string' },
    },
  });

  if (typeof parsed.values.repo === 'string' && parsed.values.repo.includes('/')) {
    const target = parseOwnerRepo(parsed.values.repo);
    return { ...target, values: parsed.values };
  }

  if (parsed.positionals.length > 0) {
    const target = parseOwnerRepo(parsed.positionals[0]);
    return { ...target, values: parsed.values };
  }

  const owner = parsed.values.owner;
  const repo = parsed.values.repo;
  if (typeof owner === 'string' && typeof repo === 'string') {
    return { owner, repo, values: parsed.values };
  }

  throw new Error('Use --repo owner/repo or provide owner/repo as the first positional argument');
}

export function resolveSinceValue(value: string, now: Date = new Date()): string {
  const trimmed = value.trim();
  const absolute = new Date(trimmed);
  if (!Number.isNaN(absolute.getTime())) {
    return absolute.toISOString();
  }

  const match = trimmed.match(/^(\d+)(s|m|h|d|w|mo|y)$/i);
  if (!match) {
    throw new Error(`Invalid --since value: ${value}. Use an ISO timestamp or duration like 15m, 2h, 7d, or 1mo.`);
  }

  const amount = Number(match[1]);
  const unit = match[2].toLowerCase();
  const resolved = new Date(now);

  switch (unit) {
    case 's':
      resolved.setTime(resolved.getTime() - amount * 1000);
      break;
    case 'm':
      resolved.setTime(resolved.getTime() - amount * 60 * 1000);
      break;
    case 'h':
      resolved.setTime(resolved.getTime() - amount * 60 * 60 * 1000);
      break;
    case 'd':
      resolved.setTime(resolved.getTime() - amount * 24 * 60 * 60 * 1000);
      break;
    case 'w':
      resolved.setTime(resolved.getTime() - amount * 7 * 24 * 60 * 60 * 1000);
      break;
    case 'mo':
      resolved.setUTCMonth(resolved.getUTCMonth() - amount);
      break;
    case 'y':
      resolved.setUTCFullYear(resolved.getUTCFullYear() - amount);
      break;
    default:
      throw new Error(`Unsupported --since unit: ${unit}`);
  }

  return resolved.toISOString();
}

export function formatLogLine(message: string, now: Date = new Date()): string {
  return `[${now.toISOString()}] ${message}`;
}

function writeProgress(message: string): void {
  process.stderr.write(`${formatLogLine(message)}\n`);
}

export async function run(argv: string[], stdout: NodeJS.WritableStream = process.stdout): Promise<void> {
  const [commandRaw, ...rest] = argv;
  const command = commandRaw as CommandName | undefined;
  if (!command) {
    stdout.write(usage());
    return;
  }

  const service = new GitcrawlService();
  try {
    switch (command) {
      case 'init': {
        stdout.write(`${JSON.stringify(service.init(), null, 2)}\n`);
        return;
      }
      case 'doctor': {
        stdout.write(`${JSON.stringify(await service.doctor(), null, 2)}\n`);
        return;
      }
      case 'sync': {
        const { owner, repo, values } = parseRepoFlags(rest);
        const result = await service.syncRepository({
          owner,
          repo,
          since: typeof values.since === 'string' ? resolveSinceValue(values.since) : undefined,
          limit: typeof values.limit === 'string' ? Number(values.limit) : undefined,
          includeComments: values['include-comments'] === true,
          onProgress: writeProgress,
        });
        stdout.write(`${JSON.stringify(result, null, 2)}\n`);
        return;
      }
      case 'summarize': {
        const { owner, repo, values } = parseRepoFlags(rest);
        const result = await service.summarizeRepository({
          owner,
          repo,
          threadNumber: typeof values.number === 'string' ? Number(values.number) : undefined,
          includeComments: values['include-comments'] === true,
          onProgress: writeProgress,
        });
        stdout.write(`${JSON.stringify(result, null, 2)}\n`);
        return;
      }
      case 'purge-comments': {
        const { owner, repo, values } = parseRepoFlags(rest);
        const result = service.purgeComments({
          owner,
          repo,
          threadNumber: typeof values.number === 'string' ? Number(values.number) : undefined,
          onProgress: writeProgress,
        });
        stdout.write(`${JSON.stringify(result, null, 2)}\n`);
        return;
      }
      case 'embed': {
        const { owner, repo, values } = parseRepoFlags(rest);
        const result = await service.embedRepository({
          owner,
          repo,
          threadNumber: typeof values.number === 'string' ? Number(values.number) : undefined,
          onProgress: writeProgress,
        });
        stdout.write(`${JSON.stringify(result, null, 2)}\n`);
        return;
      }
      case 'cluster': {
        const { owner, repo, values } = parseRepoFlags(rest);
        const result = service.clusterRepository({
          owner,
          repo,
          k: typeof values.k === 'string' ? Number(values.k) : undefined,
          minScore: typeof values.threshold === 'string' ? Number(values.threshold) : undefined,
          onProgress: writeProgress,
        });
        stdout.write(`${JSON.stringify(result, null, 2)}\n`);
        return;
      }
      case 'search': {
        const { owner, repo, values } = parseRepoFlags(rest);
        if (typeof values.query !== 'string') {
          throw new Error('Missing --query');
        }
        const mode =
          values.mode === 'keyword' || values.mode === 'semantic' || values.mode === 'hybrid'
            ? values.mode
            : undefined;
        const result = await service.searchRepository({
          owner,
          repo,
          query: values.query,
          mode,
        });
        stdout.write(`${JSON.stringify(result, null, 2)}\n`);
        return;
      }
      case 'neighbors': {
        const { owner, repo, values } = parseRepoFlags(rest);
        if (typeof values.number !== 'string') {
          throw new Error('Missing --number');
        }
        const result = service.listNeighbors({
          owner,
          repo,
          threadNumber: Number(values.number),
          limit: typeof values.limit === 'string' ? Number(values.limit) : undefined,
          minScore: typeof values.threshold === 'string' ? Number(values.threshold) : undefined,
        });
        stdout.write(`${JSON.stringify(result, null, 2)}\n`);
        return;
      }
      case 'serve': {
        const server = createApiServer(service);
        const parsed = parseArgs({
          args: rest,
          options: { port: { type: 'string' } },
        });
        const port = typeof parsed.values.port === 'string' ? Number(parsed.values.port) : service.config.apiPort;
        server.listen(port, '127.0.0.1');
        stdout.write(`gitcrawl API listening on http://127.0.0.1:${port}\n`);
        const stop = async () => {
          server.close();
          service.close();
        };
        process.once('SIGINT', () => void stop());
        process.once('SIGTERM', () => void stop());
        await once(server, 'close');
        return;
      }
      default:
        throw new Error(`Unknown command: ${command}`);
    }
  } finally {
    if (command !== 'serve') {
      service.close();
    }
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  run(process.argv.slice(2)).catch((error) => {
    writeProgress(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
