# codex-context-mode

Stop losing context to large outputs — an MCP server for [Codex CLI](https://github.com/openai/codex).

Forked from [mksglu/claude-context-mode](https://github.com/mksglu/claude-context-mode).

> **Note:** Codex CLI hooks are not yet released. Until they ship, routing is driven by
> `AGENTS.md` instructions instead of automatic interception. Hooks support will be
> added once available ([#2109](https://github.com/openai/codex/issues/2109)).

---

## What it does

- **Sandboxed execution** — runs shell commands and code in 10 languages, returns only stdout
- **FTS5 knowledge base** — indexes output with BM25 ranking, Porter stemming, heading-aware chunking
- **Intent-driven search** — query indexed content across your session
- **URL fetching** — fetches and indexes web pages without flooding context

## Install

```bash
git clone https://github.com/Wreos/codex-context-mode.git ~/.codex/plugins/context-mode
cd ~/.codex/plugins/context-mode
./install.sh
```

`install.sh` does two things:
1. Adds the MCP server to `~/.codex/config.toml`
2. Appends routing instructions to `~/.codex/AGENTS.md`

Then restart Codex.

## Manual install

Add to `~/.codex/config.toml`:

```toml
[mcp_servers.context-mode]
command = "sh"
args = ["/path/to/codex-context-mode/start.sh"]
```

Add the contents of `AGENTS.md` to your `~/.codex/AGENTS.md`.

## MCP tools

| Tool | Description |
|---|---|
| `execute(language, code)` | Run code in sandbox, returns stdout |
| `execute_file(path, language, code)` | Process a file in sandbox |
| `batch_execute(commands, queries)` | Run multiple commands + search in one call |
| `search(queries)` | Search the indexed knowledge base |
| `index(content, source)` | Index content for later search |
| `fetch_and_index(url, source)` | Fetch a URL and index its content |

## Usage

Instead of running shell commands directly, use the MCP tools:

```
# Instead of running find/grep and reading each file individually:
mcp__context-mode__batch_execute(
  commands: [{label: "ts files", command: "find . -name '*.ts' | head -20"}],
  queries: ["component files", "utility functions"]
)
```

## Roadmap

- [ ] `pre_tool_use` hook — automatic interception once Codex ships hooks ([#2109](https://github.com/openai/codex/issues/2109))
- [ ] Stats command
- [ ] Doctor command

## Credits

Original plugin by [Mert Koseoğlu](https://github.com/mksglu) — this is a Codex CLI port.
