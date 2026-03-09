import {
  actionRequestSchema,
  actionResponseSchema,
  clustersResponseSchema,
  healthResponseSchema,
  repositoriesResponseSchema,
  searchResponseSchema,
  threadsResponseSchema,
  type ActionRequest,
  type ActionResponse,
  type ClustersResponse,
  type HealthResponse,
  type RepositoriesResponse,
  type SearchMode,
  type SearchResponse,
  type ThreadsResponse,
} from './contracts.js';

export type GitcrawlClient = {
  health: () => Promise<HealthResponse>;
  listRepositories: () => Promise<RepositoriesResponse>;
  listThreads: (params: { owner: string; repo: string; kind?: 'issue' | 'pull_request' }) => Promise<ThreadsResponse>;
  search: (params: { owner: string; repo: string; query: string; mode?: SearchMode }) => Promise<SearchResponse>;
  listClusters: (params: { owner: string; repo: string }) => Promise<ClustersResponse>;
  rerun: (request: ActionRequest) => Promise<ActionResponse>;
};

type FetchLike = typeof fetch;

async function readJson<T>(res: Response, schema: { parse: (value: unknown) => T }): Promise<T> {
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`API request failed ${res.status} ${res.statusText}: ${text.slice(0, 2000)}`);
  }
  const value = (await res.json()) as unknown;
  return schema.parse(value);
}

export function createGitcrawlClient(baseUrl: string, fetchImpl: FetchLike = fetch): GitcrawlClient {
  const normalized = baseUrl.replace(/\/+$/, '');

  return {
    async health() {
      const res = await fetchImpl(`${normalized}/health`);
      return readJson(res, healthResponseSchema);
    },
    async listRepositories() {
      const res = await fetchImpl(`${normalized}/repositories`);
      return readJson(res, repositoriesResponseSchema);
    },
    async listThreads(params) {
      const search = new URLSearchParams({ owner: params.owner, repo: params.repo });
      if (params.kind) search.set('kind', params.kind);
      const res = await fetchImpl(`${normalized}/threads?${search.toString()}`);
      return readJson(res, threadsResponseSchema);
    },
    async search(params) {
      const search = new URLSearchParams({
        owner: params.owner,
        repo: params.repo,
        query: params.query,
      });
      if (params.mode) search.set('mode', params.mode);
      const res = await fetchImpl(`${normalized}/search?${search.toString()}`);
      return readJson(res, searchResponseSchema);
    },
    async listClusters(params) {
      const search = new URLSearchParams({ owner: params.owner, repo: params.repo });
      const res = await fetchImpl(`${normalized}/clusters?${search.toString()}`);
      return readJson(res, clustersResponseSchema);
    },
    async rerun(request) {
      const body = actionRequestSchema.parse(request);
      const res = await fetchImpl(`${normalized}/actions/rerun`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      return readJson(res, actionResponseSchema);
    },
  };
}
