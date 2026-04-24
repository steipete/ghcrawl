import crypto from 'node:crypto';

const TOKEN_RE = /[a-zA-Z0-9_.$/-]+/g;

export type PullFileMetadata = {
  filename: string;
  status?: string | null;
  previousFilename?: string | null;
  additions: number;
  deletions: number;
  changes: number;
  patch?: string | null;
  sha?: string | null;
};

export type HunkSignature = {
  path: string;
  hunkHash: string;
  contextHash: string;
  addedTokenHash: string;
  removedTokenHash: string;
};

export type CodeSnapshotSignature = {
  files: PullFileMetadata[];
  patchDigest: string;
  hunkSignatures: HunkSignature[];
};

function sha256(value: string): string {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function tokenize(value: string): string[] {
  return Array.from(value.toLowerCase().matchAll(TOKEN_RE)).map((match) => match[0]);
}

function tokenHash(lines: string[]): string {
  return sha256(JSON.stringify(lines.flatMap(tokenize).sort()));
}

export function normalizePullFile(payload: Record<string, unknown>): PullFileMetadata {
  return {
    filename: String(payload.filename ?? ''),
    status: typeof payload.status === 'string' ? payload.status : null,
    previousFilename: typeof payload.previous_filename === 'string' ? payload.previous_filename : null,
    additions: Number(payload.additions ?? 0),
    deletions: Number(payload.deletions ?? 0),
    changes: Number(payload.changes ?? 0),
    patch: typeof payload.patch === 'string' ? payload.patch : null,
    sha: typeof payload.sha === 'string' ? payload.sha : null,
  };
}

export function extractHunkSignatures(path: string, patch: string | null | undefined): HunkSignature[] {
  if (!patch) return [];

  const signatures: HunkSignature[] = [];
  let header: string | null = null;
  let context: string[] = [];
  let added: string[] = [];
  let removed: string[] = [];

  function flush(): void {
    if (!header) return;
    const hunkPayload = JSON.stringify({
      path,
      header,
      contextHash: tokenHash(context),
      addedTokenHash: tokenHash(added),
      removedTokenHash: tokenHash(removed),
    });
    signatures.push({
      path,
      hunkHash: sha256(hunkPayload),
      contextHash: tokenHash(context),
      addedTokenHash: tokenHash(added),
      removedTokenHash: tokenHash(removed),
    });
  }

  for (const line of patch.split('\n')) {
    if (line.startsWith('@@')) {
      flush();
      header = line;
      context = [];
      added = [];
      removed = [];
      continue;
    }
    if (!header || line.startsWith('+++') || line.startsWith('---')) continue;
    if (line.startsWith('+')) {
      added.push(line.slice(1));
    } else if (line.startsWith('-')) {
      removed.push(line.slice(1));
    } else {
      context.push(line.startsWith(' ') ? line.slice(1) : line);
    }
  }
  flush();

  return signatures;
}

export function buildCodeSnapshotSignature(files: Array<Record<string, unknown>>): CodeSnapshotSignature {
  const normalizedFiles = files.map(normalizePullFile).filter((file) => file.filename.length > 0);
  const hunkSignatures = normalizedFiles.flatMap((file) => extractHunkSignatures(file.filename, file.patch));
  const patchDigest = sha256(
    JSON.stringify(
      normalizedFiles.map((file) => ({
        filename: file.filename,
        status: file.status,
        previousFilename: file.previousFilename,
        additions: file.additions,
        deletions: file.deletions,
        patchHash: file.patch ? sha256(file.patch) : null,
      })),
    ),
  );

  return {
    files: normalizedFiles,
    patchDigest,
    hunkSignatures,
  };
}
