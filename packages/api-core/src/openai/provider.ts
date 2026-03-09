import OpenAI from 'openai';

export type SummaryResult = {
  problemSummary: string;
  solutionSummary: string;
  maintainerSignalSummary: string;
  dedupeSummary: string;
};

export type AiProvider = {
  checkAuth: () => Promise<void>;
  summarizeThread: (params: { model: string; text: string }) => Promise<SummaryResult>;
  embedTexts: (params: { model: string; texts: string[] }) => Promise<number[][]>;
};

function parseSummaryPayload(text: string): SummaryResult {
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) {
    throw new Error('OpenAI summarization did not return JSON');
  }
  const parsed = JSON.parse(match[0]) as Record<string, unknown>;
  return {
    problemSummary: String(parsed.problem_summary ?? ''),
    solutionSummary: String(parsed.solution_summary ?? ''),
    maintainerSignalSummary: String(parsed.maintainer_signal_summary ?? ''),
    dedupeSummary: String(parsed.dedupe_summary ?? ''),
  };
}

export class OpenAiProvider implements AiProvider {
  private readonly client: OpenAI;

  constructor(apiKey: string) {
    this.client = new OpenAI({ apiKey });
  }

  async checkAuth(): Promise<void> {
    await this.client.models.list();
  }

  async summarizeThread(params: { model: string; text: string }): Promise<SummaryResult> {
    const response = await this.client.responses.create({
      model: params.model,
      input: [
        {
          role: 'system',
          content: [
            {
              type: 'input_text',
              text:
                'Summarize this GitHub issue or pull request thread. Return JSON only with keys: problem_summary, solution_summary, maintainer_signal_summary, dedupe_summary.',
            },
          ],
        },
        {
          role: 'user',
          content: [{ type: 'input_text', text: params.text }],
        },
      ],
      max_output_tokens: 900,
    });

    return parseSummaryPayload(response.output_text ?? '');
  }

  async embedTexts(params: { model: string; texts: string[] }): Promise<number[][]> {
    const response = await this.client.embeddings.create({
      model: params.model,
      input: params.texts,
    });

    return response.data.map((item) => item.embedding);
  }
}
