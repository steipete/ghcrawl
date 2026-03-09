export type GitHubClient = {
  checkAuth: () => Promise<void>;
  getRepo: (owner: string, repo: string) => Promise<Record<string, unknown>>;
  listRepositoryIssues: (owner: string, repo: string, since?: string) => Promise<Array<Record<string, unknown>>>;
  getPull: (owner: string, repo: string, number: number) => Promise<Record<string, unknown>>;
  listIssueComments: (owner: string, repo: string, number: number) => Promise<Array<Record<string, unknown>>>;
  listPullReviews: (owner: string, repo: string, number: number) => Promise<Array<Record<string, unknown>>>;
  listPullReviewComments: (owner: string, repo: string, number: number) => Promise<Array<Record<string, unknown>>>;
};

type RequestOptions = {
  token: string;
  userAgent?: string;
};

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function makeGitHubClient(options: RequestOptions): GitHubClient {
  const userAgent = options.userAgent ?? 'gitcrawl';

  async function request<T>(url: string): Promise<{ data: T; headers: Headers }> {
    let attempt = 0;
    while (true) {
      attempt += 1;
      const res = await fetch(url, {
        headers: {
          Authorization: `Bearer ${options.token}`,
          Accept: 'application/vnd.github+json',
          'X-GitHub-Api-Version': '2022-11-28',
          'User-Agent': userAgent,
        },
      });

      if (res.ok) {
        return { data: (await res.json()) as T, headers: res.headers };
      }

      if ((res.status === 429 || res.status >= 500) && attempt < 5) {
        await delay(Math.min(1000 * 2 ** (attempt - 1), 8000));
        continue;
      }

      const text = await res.text().catch(() => '');
      throw new Error(`GitHub API failed ${res.status} ${res.statusText}: ${text.slice(0, 2000)}`);
    }
  }

  async function paginate<T>(url: string): Promise<T[]> {
    const out: T[] = [];
    let next: string | null = url;
    while (next) {
      const response: { data: T[]; headers: Headers } = await request<T[]>(next);
      const data = response.data;
      const headers: Headers = response.headers;
      out.push(...data);
      const link: string | null = headers.get('link');
      const match: RegExpMatchArray | null | undefined = link?.match(/<([^>]+)>;\s*rel="next"/);
      next = match?.[1] ?? null;
    }
    return out;
  }

  return {
    async checkAuth() {
      await request('https://api.github.com/rate_limit');
    },
    async getRepo(owner, repo) {
      const { data } = await request<Record<string, unknown>>(`https://api.github.com/repos/${owner}/${repo}`);
      return data;
    },
    async listRepositoryIssues(owner, repo, since) {
      const search = new URLSearchParams({
        state: 'all',
        sort: 'updated',
        direction: 'desc',
        per_page: '100',
      });
      if (since) search.set('since', since);
      return paginate<Record<string, unknown>>(`https://api.github.com/repos/${owner}/${repo}/issues?${search.toString()}`);
    },
    async getPull(owner, repo, number) {
      const { data } = await request<Record<string, unknown>>(`https://api.github.com/repos/${owner}/${repo}/pulls/${number}`);
      return data;
    },
    async listIssueComments(owner, repo, number) {
      return paginate<Record<string, unknown>>(
        `https://api.github.com/repos/${owner}/${repo}/issues/${number}/comments?per_page=100`,
      );
    },
    async listPullReviews(owner, repo, number) {
      return paginate<Record<string, unknown>>(
        `https://api.github.com/repos/${owner}/${repo}/pulls/${number}/reviews?per_page=100`,
      );
    },
    async listPullReviewComments(owner, repo, number) {
      return paginate<Record<string, unknown>>(
        `https://api.github.com/repos/${owner}/${repo}/pulls/${number}/comments?per_page=100`,
      );
    },
  };
}
