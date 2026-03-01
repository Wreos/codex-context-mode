# Context Mode — Context Window Protection

context-mode MCP tools are available. Use them to keep your context window lean.
Raw shell output, large file reads, and HTTP responses flood context — route them
through the sandbox instead.

## Gather data

For any task requiring multiple shell commands or information gathering, use ONE call:

```
mcp__context-mode__batch_execute(
  commands: [{label: "Name", command: "shell cmd"}, ...],
  queries: ["query1", "query2", ...]   ← 5-8 queries covering everything you need
)
```

Runs all commands, indexes output, returns search results. Do NOT make separate calls.

## Follow-up search

```
mcp__context-mode__search(queries: ["q1", "q2", "q3"])
```

Pass ALL follow-up questions in one call, not separate calls.

## Execute code in sandbox

```
mcp__context-mode__execute(language, code)          ← large outputs (logs, grep, find, ls -R)
mcp__context-mode__execute_file(path, language, code) ← large files instead of reading directly
```

## Fetch URLs

```
mcp__context-mode__fetch_and_index(url, source)   ← instead of curl/wget
```

Then search for results with `mcp__context-mode__search`.

## Index findings

```
mcp__context-mode__index(content, source)   ← store findings for later search
```

## Rules

- **Never** use curl/wget directly — use `fetch_and_index`
- For any output likely >50 lines, use `execute` or `execute_file`
- Use `batch_execute` as the primary gather tool — one call covers an entire task
- Keep final responses under 500 words; write artifacts to files, not inline
