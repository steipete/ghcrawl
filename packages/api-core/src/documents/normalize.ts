import crypto from 'node:crypto';

export type NormalizedComment = {
  body: string;
  authorLogin: string | null;
  authorType: string | null;
  isBot: boolean;
};

export type NormalizedThread = {
  title: string;
  body: string | null;
  labels: string[];
  comments: NormalizedComment[];
};

function normalizeWhitespace(value: string): string {
  return value.replace(/\r/g, '\n').replace(/\s+/g, ' ').trim();
}

export function isBotLikeAuthor(input: { authorType?: string | null; authorLogin?: string | null; isBot?: boolean }): boolean {
  if (input.isBot) return true;
  if ((input.authorType ?? '').toLowerCase() === 'bot') return true;
  const login = (input.authorLogin ?? '').toLowerCase();
  return login.endsWith('[bot]') || login.includes('renovate') || login.includes('dependabot');
}

export function buildCanonicalDocument(thread: NormalizedThread): { rawText: string; dedupeText: string; contentHash: string } {
  const labels = thread.labels.length > 0 ? `labels: ${thread.labels.join(', ')}` : '';
  const humanComments = thread.comments
    .filter((comment) => !isBotLikeAuthor(comment))
    .map((comment) => {
      const author = comment.authorLogin ? `@${comment.authorLogin}` : 'unknown';
      return `${author}: ${normalizeWhitespace(comment.body)}`;
    })
    .filter(Boolean);

  const title = normalizeWhitespace(thread.title);
  const body = normalizeWhitespace(thread.body ?? '');
  const rawParts = [title, body, labels, ...humanComments].filter(Boolean);
  const dedupeParts = [
    `title: ${title}`,
    body ? `body: ${body}` : '',
    labels ? labels : '',
    humanComments.length > 0 ? `discussion: ${humanComments.join('\n')}` : '',
  ].filter(Boolean);

  const rawText = rawParts.join('\n\n');
  const dedupeText = dedupeParts.join('\n\n');
  const contentHash = crypto.createHash('sha256').update(`${rawText}\n---\n${dedupeText}`).digest('hex');
  return { rawText, dedupeText, contentHash };
}
