import crypto from 'node:crypto';

import { z } from 'zod';

export const LLM_KEY_SUMMARY_PROMPT_VERSION = 'llm-key-summary-v1';

export const LLM_KEY_SUMMARY_SYSTEM_PROMPT = `You produce stable deduplication keys for GitHub issues and pull requests.
Return only strict JSON with exactly these fields:
intent: one sentence, max 120 chars, what outcome is being requested or changed.
surface: one sentence, max 120 chars, affected user/API/module/file area.
mechanism: one sentence, max 160 chars, cause or implementation approach.
Use concrete nouns from the input. Do not mention uncertainty. Do not add advice.`;

export const llmKeySummarySchema = z.object({
  intent: z.string().trim().min(1).max(120),
  surface: z.string().trim().min(1).max(120),
  mechanism: z.string().trim().min(1).max(160),
});

export type LlmKeySummary = z.infer<typeof llmKeySummarySchema>;

export function parseLlmKeySummary(value: unknown): LlmKeySummary {
  return llmKeySummarySchema.parse(value);
}

export function llmKeyEmbeddingText(summary: LlmKeySummary): string {
  return [`intent: ${summary.intent}`, `surface: ${summary.surface}`, `mechanism: ${summary.mechanism}`].join('\n');
}

export function llmKeyInputHash(input: {
  promptVersion?: string;
  title: string;
  body: string | null;
  commentsText?: string | null;
  diffText?: string | null;
}): string {
  return crypto
    .createHash('sha256')
    .update(
      JSON.stringify({
        promptVersion: input.promptVersion ?? LLM_KEY_SUMMARY_PROMPT_VERSION,
        title: input.title,
        body: input.body ?? '',
        commentsText: input.commentsText ?? '',
        diffText: input.diffText ?? '',
      }),
    )
    .digest('hex');
}
