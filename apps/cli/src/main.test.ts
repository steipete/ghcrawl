import test from 'node:test';
import assert from 'node:assert/strict';

import { run } from './main.js';

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
