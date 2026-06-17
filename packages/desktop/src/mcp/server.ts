// Desktop MCP server entry. Bundled by vite into `dist/mcp/server.js` and run
// by the installed Pennivo binary AS NODE (ELECTRON_RUN_AS_NODE=1) — NOT in the
// Electron main process. Running as Node is required because Electron's GUI
// main process does not receive piped stdin on Windows, which an MCP stdio
// server depends on. Importing the package CLI executes it against process.argv
// (the Connect-to-Claude config supplies --workspace / --settings / --audit-log).
import "@pennivo/mcp-server/cli";
