// One-off end-to-end check: spawn the built CLI over stdio and drive it with a
// real MCP client. Not part of the test suite (it needs a build first). Safe to
// delete; rerun with: node scripts/verify-stdio.mjs
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const pkgDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const cli = path.join(pkgDir, "dist", "bin", "cli.js");

const root = mkdtempSync(path.join(tmpdir(), "pennivo-verify-"));
writeFileSync(
  path.join(root, "hello.md"),
  "# Hello\n\nThe quick brown fox jumps.\n",
);
mkdirSync(path.join(root, "sub"));
writeFileSync(
  path.join(root, "sub", "deep.md"),
  "# Deep\n\nfox in the subfolder.\n",
);

const ok = (label, cond) => console.log(`${cond ? "PASS" : "FAIL"}  ${label}`);
let failures = 0;
const check = (label, cond) => {
  ok(label, cond);
  if (!cond) failures++;
};

const transport = new StdioClientTransport({
  command: process.execPath,
  args: [cli, "--workspace", root],
});
const client = new Client({ name: "verify-client", version: "0.0.0" });

try {
  await client.connect(transport);

  const { tools } = await client.listTools();
  const toolNames = tools.map((t) => t.name);
  check(
    "tools/list includes the read tools",
    ["list_files", "read_file", "search"].every((t) => toolNames.includes(t)),
  );
  check(
    "tools/list includes the write tools",
    [
      "write_file",
      "create_file",
      "append_to_file",
      "delete_file",
      "rename_file",
    ].every((t) => toolNames.includes(t)),
  );

  const deniedWrite = await client.callTool({
    name: "write_file",
    arguments: { path: "hello.md", content: "nope" },
  });
  check(
    "write_file denied under read-only default",
    deniedWrite.isError === true,
  );

  const list = await client.callTool({
    name: "list_files",
    arguments: { recursive: true },
  });
  const listData = JSON.parse(list.content[0].text);
  const flat = JSON.stringify(listData.entries);
  check("list_files finds hello.md", flat.includes("hello.md"));
  check("list_files finds sub/deep.md", flat.includes("sub/deep.md"));

  const read = await client.callTool({
    name: "read_file",
    arguments: { path: "hello.md" },
  });
  check(
    "read_file returns content",
    read.content[0].text.includes("quick brown fox"),
  );

  const search = await client.callTool({
    name: "search",
    arguments: { query: "fox" },
  });
  const searchData = JSON.parse(search.content[0].text);
  check("search finds matches in 2 files", searchData.matchCount >= 2);

  const traversal = await client.callTool({
    name: "read_file",
    arguments: { path: "../../etc/hosts" },
  });
  check("traversal read_file is rejected", traversal.isError === true);

  const ws = await client.readResource({ uri: "pennivo://workspace" });
  check(
    "pennivo://workspace resource reads",
    JSON.parse(ws.contents[0].text).fileCount >= 2,
  );
} finally {
  await client.close();
  rmSync(root, { recursive: true, force: true });
}

console.log(
  failures === 0 ? "\nALL CHECKS PASSED" : `\n${failures} CHECK(S) FAILED`,
);
process.exit(failures === 0 ? 0 : 1);
