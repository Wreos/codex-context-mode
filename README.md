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

Original plugin by [Mert Koseoğlu](https://github.com/mksglu) — this is a Codex CLI port by [Wreos](https://github.com/Wreos).

</details>

## The Problem

MCP has become the standard way for AI agents to use external tools. But there is a tension at its core: every tool interaction fills the context window from both sides — definitions on the way in, raw output on the way out.

With [81+ tools active, 143K tokens (72%) get consumed before your first message](https://scottspence.com/posts/optimising-mcp-server-context-usage-in-claude-code). And then the tools start returning data. A single Playwright snapshot burns 56 KB. A `gh issue list` dumps 59 KB. Run a test suite, read a log file, fetch documentation — each response eats into what remains.

Code Mode showed that tool definitions can be compressed by 99.9%. Context Mode applies the same principle to tool outputs — processing them in sandboxes so only summaries reach the model.

## Tools

| Tool | What it does | Context saved |
|---|---|---|
| `batch_execute` | Run multiple commands + search multiple queries in ONE call. | 986 KB → 62 KB |
| `execute` | Run code in 10 languages. Only stdout enters context. | 56 KB → 299 B |
| `execute_file` | Process files in sandbox. Raw content never leaves. | 45 KB → 155 B |
| `index` | Chunk markdown into FTS5 with BM25 ranking. | 60 KB → 40 B |
| `search` | Query indexed content with multiple queries in one call. | On-demand retrieval |
| `fetch_and_index` | Fetch URL, convert to markdown, index. | 60 KB → 40 B |

## How the Sandbox Works

Each `execute` call spawns an isolated subprocess with its own process boundary. Scripts can't access each other's memory or state. The subprocess runs your code, captures stdout, and only that stdout enters the conversation context. The raw data — log files, API responses, snapshots — never leaves the sandbox.

Twelve language runtimes are available: JavaScript, TypeScript, Python, Shell, Ruby, Go, Rust, PHP, Perl, R, Dart, and Elixir. Bun is auto-detected for 3-5x faster JS/TS execution.

Authenticated CLIs work through credential passthrough — `gh`, `aws`, `gcloud`, `kubectl`, `docker` inherit environment variables and config paths without exposing them to the conversation.

When output exceeds 5 KB and an `intent` is provided, Context Mode switches to intent-driven filtering: it indexes the full output into the knowledge base, searches for sections matching your intent, and returns only the relevant matches with a vocabulary of searchable terms for follow-up queries.

## How the Knowledge Base Works

The `index` tool chunks markdown content by headings while keeping code blocks intact, then stores them in a **SQLite FTS5** (Full-Text Search 5) virtual table. Search uses **BM25 ranking** — a probabilistic relevance algorithm that scores documents based on term frequency, inverse document frequency, and document length normalization. **Porter stemming** is applied at index time so "running", "runs", and "ran" match the same stem.

When you call `search`, it returns relevant content snippets focused around matching query terms — not full documents, not approximations, the actual indexed content with smart extraction around what you're looking for. `fetch_and_index` extends this to URLs: fetch, convert HTML to markdown, chunk, index. The raw page never enters context.

## Fuzzy Search

Search uses a three-layer fallback to handle typos, partial terms, and substring matches:

- **Layer 1 — Porter stemming**: Standard FTS5 MATCH with porter tokenizer. "caching" matches "cached", "caches", "cach".
- **Layer 2 — Trigram substring**: FTS5 trigram tokenizer matches partial strings. "useEff" finds "useEffect", "authenticat" finds "authentication".
- **Layer 3 — Fuzzy correction**: Levenshtein distance corrects typos before re-searching. "kuberntes" → "kubernetes", "autentication" → "authentication".

The `searchWithFallback` method cascades through all three layers and annotates results with `matchLayer` so you know which layer resolved the query.

## Smart Snippets

Search results use intelligent extraction instead of truncation. Instead of returning the first N characters (which might miss the important part), Context Mode finds where your query terms appear in the content and returns windows around those matches. If your query is "authentication JWT token", you get the paragraphs where those terms actually appear — not an arbitrary prefix.

## Progressive Search Throttling

The `search` tool includes progressive throttling to prevent context flooding from excessive individual calls:

- **Calls 1-3:** Normal results (2 per query)
- **Calls 4-8:** Reduced results (1 per query) + warning
- **Calls 9+:** Blocked — redirects to `batch_execute`

This encourages batching queries via `search(queries: ["q1", "q2", "q3"])` or `batch_execute` instead of making dozens of individual calls.

## Session Stats

The `stats` tool tracks context consumption in real-time. Network I/O inside the sandbox is automatically tracked for JS/TS executions.

| Metric | Value |
|---|---|
| Session | 1.4 min |
| Tool calls | 1 |
| Total data processed | **9.6MB** |
| Kept in sandbox | **9.6MB** |
| Entered context | 0.3KB |
| Tokens consumed | ~82 |
| **Context savings** | **24,576.0x (99% reduction)** |

| Tool | Calls | Context | Tokens |
|---|---|---|---|
| execute | 1 | 0.3KB | ~82 |
| **Total** | **1** | **0.3KB** | **~82** |

> Without context-mode, **9.6MB** of raw tool output would flood your context window. Instead, **9.6MB** (99%) stayed in sandbox — saving **~2,457,600 tokens** of context space.

## Subagent Routing

When installed as a plugin, Context Mode includes a PreToolUse hook that automatically injects routing instructions into subagent (Task tool) prompts. Subagents learn to use `batch_execute` as their primary tool and `search(queries: [...])` for follow-ups — without any manual configuration.

Bash subagents are automatically upgraded to `general-purpose` so they can access MCP tools. Without this, a `subagent_type: "Bash"` agent only has the Bash tool — it can't call `batch_execute` or `search`, and all raw output floods context.

## The Numbers

Measured across real-world scenarios:

**Playwright snapshot** — 56.2 KB raw → 299 B context (99% saved)
**GitHub Issues (20)** — 58.9 KB raw → 1.1 KB context (98% saved)
**Access log (500 requests)** — 45.1 KB raw → 155 B context (100% saved)
**Context7 React docs** — 5.9 KB raw → 261 B context (96% saved)
**Analytics CSV (500 rows)** — 85.5 KB raw → 222 B context (100% saved)
**Git log (153 commits)** — 11.6 KB raw → 107 B context (99% saved)
**Test output (30 suites)** — 6.0 KB raw → 337 B context (95% saved)
**Repo research (subagent)** — 986 KB raw → 62 KB context (94% saved, 5 calls vs 37)

Over a full session: 315 KB of raw output becomes 5.4 KB. Session time before slowdown goes from ~30 minutes to ~3 hours. Context remaining after 45 minutes: 99% instead of 60%.

[Full benchmark data with 21 scenarios →](BENCHMARK.md)

## Try It

These prompts work out of the box. Run `/context-mode:stats` after each to see the savings.

**Deep repo research** — 5 calls, 62 KB context (raw: 986 KB, 94% saved)
```
Research https://github.com/modelcontextprotocol/servers — architecture, tech stack,
top contributors, open issues, and recent activity. Then run /context-mode:stats.
```

**Git history analysis** — 1 call, 5.6 KB context
```
Clone https://github.com/facebook/react and analyze the last 500 commits:
top contributors, commit frequency by month, and most changed files.
Then run /context-mode:stats.
```

**Web scraping** — 1 call, 3.2 KB context
```
Fetch the Hacker News front page, extract all posts with titles, scores,
and domains. Group by domain. Then run /context-mode:stats.
```

**Large JSON API** — 7.5 MB raw → 0.9 KB context (99% saved)
```
Create a local server that returns a 7.5 MB JSON with 20,000 records and a secret
hidden at index 13000. Fetch the endpoint, find the hidden record, and show me
exactly what's in it. Then run /context-mode:stats.
```

**Documentation search** — 2 calls, 1.8 KB context
```
Fetch the React useEffect docs, index them, and find the cleanup pattern
with code examples. Then run /context-mode:stats.
```

## Requirements

- **Node.js 18+**
- **Codex CLI** (or Claude Code) with MCP support
- Optional: Bun (auto-detected, 3-5x faster JS/TS)
- Optional: Dart SDK (for Dart/Flutter code execution)

## Development

```bash
git clone https://github.com/Wreos/codex-context-mode.git
cd codex-context-mode && npm install
npm test              # run tests
npm run test:all      # full suite
```

## Contributors

<a href="https://github.com/mksglu/claude-context-mode/graphs/contributors">
  <img src="https://contrib.rocks/image?repo=mksglu/claude-context-mode&columns=8&anon=1" />
</a>

### Special Thanks

<a href="https://github.com/mksglu/claude-context-mode/issues/15"><img src="https://github.com/vaban-ru.png" width="32" /></a>

## License

MIT
