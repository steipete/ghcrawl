# ghcrawl

`ghcrawl` is a local-first terminal UI and CLI for crawling GitHub issues and pull requests, generating embeddings, and clustering related work.

## Install

```bash
npm install -g ghcrawl
```

This package installs the `ghcrawl` command.

## Quick Start

```bash
ghcrawl init
ghcrawl doctor
ghcrawl refresh owner/repo
ghcrawl tui owner/repo
```

## Documentation

For the full project README, screenshots, setup guide, and release notes, see:

- [GitHub repository](https://github.com/pwrdrvr/ghcrawl)
- [Project README](https://github.com/pwrdrvr/ghcrawl#readme)

## Notes

- `ghcrawl` needs a GitHub API token and an OpenAI API key for normal sync/embed/cluster use.
- The legacy `gitcrawl` command remains as a compatibility alias for now.
