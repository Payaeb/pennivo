# @pennivo/mcp-server

A [Model Context Protocol](https://modelcontextprotocol.io) server that exposes a
[Pennivo](https://www.pennivo.app/) markdown workspace to AI assistants — Claude
Desktop, Claude Code, Cursor, and any other MCP client. Point it at a folder and
the assistant can read, search, and (opt-in) edit the `.md` files inside it.

> Read tools are on by default; write tools (`write_file`, `create_file`,
> `append_to_file`, `delete_file`, `rename_file`) are opt-in. The Pennivo desktop
> app includes a Settings → MCP panel with per-tool toggles, a one-click "Connect
> to Claude" button, and an activity log.

## Install / run

No install needed — run it with `npx`:

```bash
npx @pennivo/mcp-server --workspace /path/to/your/notes
```

Or install globally for the `pennivo-mcp` bin:

```bash
npm i -g @pennivo/mcp-server
pennivo-mcp --workspace /path/to/your/notes
```

## Connect to Claude Desktop

Add this to your `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "pennivo": {
      "command": "npx",
      "args": ["-y", "@pennivo/mcp-server", "--workspace", "/path/to/your/notes"]
    }
  }
}
```

Restart Claude Desktop and the Pennivo tools appear.

## Tools

| Tool | Access | What it does |
| --- | --- | --- |
| `list_files(path?, recursive?)` | read | List markdown files and folders. |
| `read_file(path)` | read | Read a markdown file as UTF-8. |
| `search(query, scope?, caseSensitive?, wholeWord?, regex?)` | read | Multi-term AND search (whitespace splits terms; a file must contain every term; 2-char minimum). Case-insensitive by default; supports `caseSensitive`, `wholeWord`, and `regex`. Returns ranked per-file groups plus a flat list of matching lines, each with a windowed snippet preview. |
| `write_file(path, content)` | write | Overwrite (or create) a markdown file. |
| `create_file(path?, content)` | write | Create a new file; derives a name from the first line if `path` is omitted. |
| `append_to_file(path, content)` | write | Append to an existing file. |
| `delete_file(path, includeAssets?)` | write | Permanently delete a file (and optionally its image folder). |
| `rename_file(oldPath, newPath)` | write | Rename/move a file; its per-file image folder follows. |

Changes to the workspace emit `notifications/resources/list_changed` so connected
agents see fresh state. A loopback HTTP transport is available via `--http`.

## Resources

| URI | What it returns |
| --- | --- |
| `pennivo://workspace` | Root, file count, and top-level tree. |
| `pennivo://recent` | Recently modified markdown files. |
| `pennivo://file/<path>` | A single file's contents by workspace-relative path. |

## Safety

- **Sandboxed to the workspace.** Every path is resolved and checked — both
  lexically and via `realpath` — to be inside the configured root. Traversal
  (`../`), absolute escapes, and in-workspace symlinks pointing out are rejected.
- **Read-only by default.** Write tools are disabled until explicitly enabled.
- **Auditable.** Pass `--audit-log <file>` to record every tool call (agent,
  tool, workspace-relative path, outcome) as JSON lines.

## Options

```
-w, --workspace <path>   Folder to expose (required). Or set PENNIVO_WORKSPACE.
    --audit-log <file>   Append a JSONL audit log of every tool call.
    --allow <tools>      Comma-separated tools to enable beyond the read-only default.
    --settings <file>    Read permissions live from a JSON file's `mcp` slice (overrides --allow).
    --http               Serve over loopback HTTP instead of stdio.
    --port <n>           HTTP port (default: an ephemeral free port). Implies --http.
-h, --help               Show help.
-v, --version            Print version.
```

## License

MIT © Paya Ebrahimi
