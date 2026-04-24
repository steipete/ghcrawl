import test from 'node:test';
import assert from 'node:assert/strict';

import {
  LLM_KEY_SUMMARY_PROMPT_VERSION,
  LLM_KEY_SUMMARY_SYSTEM_PROMPT,
  llmKeyEmbeddingText,
  llmKeyInputHash,
  parseLlmKeySummary,
} from './llm-key-summary.js';

test('parseLlmKeySummary accepts the strict 3-line contract', () => {
  const summary = parseLlmKeySummary({
    intent: 'Stop downloads from retrying forever after timeout.',
    surface: 'CLI sync downloader and retry loop.',
    mechanism: 'Exit retry loop when timeout state is terminal.',
  });

  assert.equal(summary.intent, 'Stop downloads from retrying forever after timeout.');
  assert.equal(
    llmKeyEmbeddingText(summary),
    [
      'intent: Stop downloads from retrying forever after timeout.',
      'surface: CLI sync downloader and retry loop.',
      'mechanism: Exit retry loop when timeout state is terminal.',
    ].join('\n'),
  );
});

test('parseLlmKeySummary rejects missing or oversized fields', () => {
  assert.throws(
    () =>
      parseLlmKeySummary({
        intent: 'x'.repeat(121),
        surface: 'CLI',
        mechanism: 'Patch retry loop.',
      }),
    /Too big/,
  );
});

test('llmKeyInputHash is deterministic and prompt-version scoped', () => {
  const first = llmKeyInputHash({ title: 'Fix retry', body: 'Retry forever' });
  const second = llmKeyInputHash({ title: 'Fix retry', body: 'Retry forever' });
  const third = llmKeyInputHash({
    promptVersion: `${LLM_KEY_SUMMARY_PROMPT_VERSION}-next`,
    title: 'Fix retry',
    body: 'Retry forever',
  });

  assert.equal(first, second);
  assert.notEqual(first, third);
});

test('LLM_KEY_SUMMARY_SYSTEM_PROMPT requires strict JSON fields', () => {
  assert.match(LLM_KEY_SUMMARY_SYSTEM_PROMPT, /Return only strict JSON/);
  assert.match(LLM_KEY_SUMMARY_SYSTEM_PROMPT, /intent/);
  assert.match(LLM_KEY_SUMMARY_SYSTEM_PROMPT, /surface/);
  assert.match(LLM_KEY_SUMMARY_SYSTEM_PROMPT, /mechanism/);
});
