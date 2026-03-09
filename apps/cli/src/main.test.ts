import test from 'node:test';
import assert from 'node:assert/strict';

import { formatLogLine, parseOwnerRepo, parseRepoFlags, resolveSinceValue, run } from './main.js';

test('run prints usage with no command', async () => {
  let output = '';
  const stdout = {
    write(chunk: string) {
      output += chunk;
      return true;
    },
  } as unknown as NodeJS.WritableStream;

  await run([], stdout);
  assert.match(output, /gitcrawl <command>/);
});

test('parseOwnerRepo accepts owner slash repo syntax', () => {
  assert.deepEqual(parseOwnerRepo('openclaw/openclaw'), { owner: 'openclaw', repo: 'openclaw' });
});

test('parseRepoFlags accepts repo flag with owner slash repo syntax', () => {
  const parsed = parseRepoFlags(['--repo', 'openclaw/openclaw', '--limit', '1']);
  assert.equal(parsed.owner, 'openclaw');
  assert.equal(parsed.repo, 'openclaw');
  assert.equal(parsed.values.limit, '1');
});

test('parseRepoFlags accepts positional owner slash repo syntax', () => {
  const parsed = parseRepoFlags(['openclaw/openclaw', '--limit', '2']);
  assert.equal(parsed.owner, 'openclaw');
  assert.equal(parsed.repo, 'openclaw');
  assert.equal(parsed.values.limit, '2');
});

test('parseRepoFlags accepts include-comments boolean flag', () => {
  const parsed = parseRepoFlags(['openclaw/openclaw', '--include-comments']);
  assert.equal(parsed.owner, 'openclaw');
  assert.equal(parsed.repo, 'openclaw');
  assert.equal(parsed.values['include-comments'], true);
});

test('resolveSinceValue keeps ISO timestamps', () => {
  assert.equal(resolveSinceValue('2026-03-01T00:00:00Z'), '2026-03-01T00:00:00.000Z');
});

test('resolveSinceValue parses minute duration shorthand', () => {
  const now = new Date('2026-03-09T12:00:00Z');
  assert.equal(resolveSinceValue('15m', now), '2026-03-09T11:45:00.000Z');
});

test('resolveSinceValue parses month duration shorthand', () => {
  const now = new Date('2026-03-09T12:00:00Z');
  assert.equal(resolveSinceValue('1mo', now), '2026-02-09T12:00:00.000Z');
});

test('resolveSinceValue rejects unsupported syntax', () => {
  assert.throws(() => resolveSinceValue('yesterday'), /Invalid --since value/);
});

test('formatLogLine prefixes ISO timestamps with millisecond resolution', () => {
  assert.equal(formatLogLine('[sync] hello', new Date('2026-03-09T12:34:56.789Z')), '[2026-03-09T12:34:56.789Z] [sync] hello');
});
