import { cancel, confirm, intro, isCancel, note, outro, password, select, text } from '@clack/prompts';
import {
  loadConfig,
  readPersistedConfig,
  writePersistedConfig,
  isLikelyGitHubToken,
  isLikelyOpenAiApiKey,
} from '@gitcrawl/api-core';

type InitSecretMode = 'plaintext' | 'op';

export type InitWizardResult = {
  configPath: string;
  changed: boolean;
};

export type InitPrompter = {
  intro: (message: string) => Promise<void> | void;
  note: (message: string, title?: string) => Promise<void> | void;
  select: (options: {
    message: string;
    initialValue?: string;
    options: Array<{ value: string; label: string; hint?: string }>;
  }) => Promise<string | symbol>;
  text: (options: { message: string; placeholder?: string; validate?: (value: string) => string | undefined }) => Promise<string | symbol>;
  confirm: (options: { message: string; initialValue?: boolean }) => Promise<boolean | symbol>;
  password: (options: { message: string; validate?: (value: string) => string | undefined }) => Promise<string | symbol>;
  outro: (message: string) => Promise<void> | void;
  cancel: (message: string) => void;
};

export function createClackInitPrompter(): InitPrompter {
  return {
    intro,
    note,
    select,
    text,
    confirm,
    password,
    outro,
    cancel,
  };
}

export async function runInitWizard(
  options: {
    cwd?: string;
    env?: NodeJS.ProcessEnv;
    reconfigure?: boolean;
    prompter?: InitPrompter;
    isInteractive?: boolean;
  } = {},
): Promise<InitWizardResult> {
  const cwd = options.cwd ?? process.cwd();
  const env = options.env ?? process.env;
  const reconfigure = options.reconfigure ?? false;
  const prompter = options.prompter ?? createClackInitPrompter();
  const current = loadConfig({ cwd, env });
  const stored = readPersistedConfig({ cwd, env });

  const hasStoredGithub = Boolean(stored.data.githubToken);
  const hasStoredOpenAi = Boolean(stored.data.openaiApiKey);
  if (!reconfigure && hasStoredGithub && hasStoredOpenAi) {
    return { configPath: current.configPath, changed: false };
  }

  const isInteractive = options.isInteractive ?? (process.stdin.isTTY && process.stdout.isTTY);
  if (!isInteractive) {
    throw new Error(`gitcrawl init requires a TTY. Create ${current.configPath} manually or set environment variables first.`);
  }

  await prompter.intro('gitcrawl init');
  await prompter.note(
    [
      `Config file: ${current.configPath}`,
      '',
      'Secret storage modes:',
      '- Plaintext config: writes both keys to ~/.config/gitcrawl/config.json',
      '- 1Password CLI: keeps keys out of the config file and expects you to run gitcrawl through an op wrapper',
      '',
      'GitHub token recommendation:',
      '- Fine-grained PAT scoped to the repos you want to crawl',
      '- Repository permissions: Metadata (read), Issues (read), Pull requests (read)',
      '- For private repos with a classic PAT, repo is the safe fallback',
      '',
      'OpenAI key recommendation:',
      '- Standard API key for the project/account you want to bill',
    ].join('\n'),
    'Setup',
  );

  const nextConfig = { ...stored.data };
  let changed = false;

  const secretMode = await prompter.select({
    message: 'How should gitcrawl get your GitHub and OpenAI secrets?',
    initialValue: stored.data.secretProvider ?? (hasStoredGithub && hasStoredOpenAi ? 'plaintext' : 'op'),
    options: [
      {
        value: 'plaintext',
        label: 'Store plaintext keys in ~/.config/gitcrawl/config.json',
        hint: 'simpler, but you are responsible for any bills caused by misuse',
      },
      {
        value: 'op',
        label: 'Keep keys in 1Password CLI and run through op',
        hint: 'recommended if you already use op',
      },
    ],
  });
  if (isCancel(secretMode) || (secretMode !== 'plaintext' && secretMode !== 'op')) {
    prompter.cancel('init cancelled');
    throw new Error('init cancelled');
  }

  if (secretMode === 'plaintext') {
    await prompter.note(
      [
        'Plaintext storage warning:',
        '- gitcrawl will write both API keys to ~/.config/gitcrawl/config.json',
        '- anyone who can read that file can use your keys',
        '- any OpenAI/API bills caused by misuse are your responsibility',
      ].join('\n'),
      'Security',
    );

    if (reconfigure || !hasStoredGithub) {
      const detectedGithub = env.GITHUB_TOKEN;
      let githubToken = stored.data.githubToken;
      let usedDetectedGithub = false;
      if (detectedGithub && (!githubToken || reconfigure)) {
        const useDetected = await prompter.confirm({
          message: 'Persist the detected GITHUB_TOKEN environment value to the gitcrawl config file?',
          initialValue: true,
        });
        if (isCancel(useDetected)) {
          prompter.cancel('init cancelled');
          throw new Error('init cancelled');
        }
        if (useDetected) {
          if (isLikelyGitHubToken(detectedGithub)) {
            githubToken = detectedGithub;
            usedDetectedGithub = true;
          } else {
            await prompter.note('The detected GITHUB_TOKEN value does not look like a GitHub PAT, so init will prompt for it instead.', 'GitHub token');
          }
        }
      }
      if (!githubToken || (reconfigure && !usedDetectedGithub)) {
        const value = await prompter.password({
          message: 'GitHub personal access token',
          validate: (candidate) => (isLikelyGitHubToken(candidate) ? undefined : 'Enter a GitHub PAT like ghp_... or github_pat_...'),
        });
        if (isCancel(value)) {
          prompter.cancel('init cancelled');
          throw new Error('init cancelled');
        }
        githubToken = value;
      }
      nextConfig.githubToken = githubToken;
      changed = true;
    }

    if (reconfigure || !hasStoredOpenAi) {
      const detectedOpenAi = env.OPENAI_API_KEY;
      let openaiApiKey = stored.data.openaiApiKey;
      let usedDetectedOpenAi = false;
      if (detectedOpenAi && (!openaiApiKey || reconfigure)) {
        const useDetected = await prompter.confirm({
          message: 'Persist the detected OPENAI_API_KEY environment value to the gitcrawl config file?',
          initialValue: true,
        });
        if (isCancel(useDetected)) {
          prompter.cancel('init cancelled');
          throw new Error('init cancelled');
        }
        if (useDetected) {
          if (isLikelyOpenAiApiKey(detectedOpenAi)) {
            openaiApiKey = detectedOpenAi;
            usedDetectedOpenAi = true;
          } else {
            await prompter.note('The detected OPENAI_API_KEY value does not look like an OpenAI API key, so init will prompt for it instead.', 'OpenAI key');
          }
        }
      }
      if (!openaiApiKey || (reconfigure && !usedDetectedOpenAi)) {
        const value = await prompter.password({
          message: 'OpenAI API key',
          validate: (candidate) => (isLikelyOpenAiApiKey(candidate) ? undefined : 'Enter an OpenAI API key like sk-...'),
        });
        if (isCancel(value)) {
          prompter.cancel('init cancelled');
          throw new Error('init cancelled');
        }
        openaiApiKey = value;
      }
      nextConfig.openaiApiKey = openaiApiKey;
      changed = true;
    }

    nextConfig.secretProvider = 'plaintext';
    nextConfig.opVaultName = undefined;
    nextConfig.opItemName = undefined;
  } else {
    const vaultName = await prompter.text({
      message: '1Password vault name',
      placeholder: stored.data.opVaultName ?? 'Private',
      validate: (value) => (value.trim().length > 0 ? undefined : 'Enter the 1Password vault name'),
    });
    if (isCancel(vaultName)) {
      prompter.cancel('init cancelled');
      throw new Error('init cancelled');
    }
    const itemName = await prompter.text({
      message: '1Password item name',
      placeholder: stored.data.opItemName ?? 'gitcrawl',
      validate: (value) => (value.trim().length > 0 ? undefined : 'Enter the 1Password item name'),
    });
    if (isCancel(itemName)) {
      prompter.cancel('init cancelled');
      throw new Error('init cancelled');
    }

    nextConfig.secretProvider = 'op';
    nextConfig.opVaultName = vaultName.trim();
    nextConfig.opItemName = itemName.trim();
    nextConfig.githubToken = undefined;
    nextConfig.openaiApiKey = undefined;
    changed = true;

    const opReferenceBase = `op://${nextConfig.opVaultName}/${nextConfig.opItemName}`;
    await prompter.note(
      [
        'Create a 1Password Secure Note with:',
        `- Vault: ${nextConfig.opVaultName}`,
        `- Item: ${nextConfig.opItemName}`,
        '',
        'Add concealed fields named exactly:',
        '- GITHUB_TOKEN',
        '- OPENAI_API_KEY',
        '',
        'Secret refs:',
        `- ${opReferenceBase}/GITHUB_TOKEN`,
        `- ${opReferenceBase}/OPENAI_API_KEY`,
      ].join('\n'),
      '1Password Setup',
    );
    await prompter.note(
      [
        'After saving that Secure Note, run:',
        '- pnpm op:doctor',
        '- pnpm op:tui',
        '- pnpm op:shell',
        '',
        'Optional ~/.zshrc helper:',
        'gitcrawl-op() {',
        '  pnpm op:exec -- "$@"',
        '}',
      ].join('\n'),
      'Next Commands',
    );
    const ready = await prompter.confirm({
      message: 'I created the Secure Note and I am ready to save this gitcrawl config.',
      initialValue: true,
    });
    if (isCancel(ready) || ready !== true) {
      prompter.cancel('init cancelled');
      throw new Error('init cancelled');
    }
  }

  const result = writePersistedConfig(nextConfig, { cwd, env });
  await prompter.outro(`Saved gitcrawl config to ${result.configPath}`);
  return { configPath: result.configPath, changed };
}
