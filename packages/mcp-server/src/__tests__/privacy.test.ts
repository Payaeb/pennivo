import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { writeFileSync } from "node:fs";
import path from "node:path";
import {
  connect,
  callTool,
  firstText,
  ALL_ENABLED,
  type Harness,
} from "./harness.js";
import { makeWorkspace, cleanup, writeFile } from "./fixtures.js";
import { redactRoot } from "../tools/shared.js";

const SENTINEL = "SUPER-SECRET-CONTENT-7f3a9";

/** A recorded path must never be absolute or escape the workspace. */
function assertRelativeSafe(p: string | undefined): void {
  if (p === undefined) return;
  expect(p).not.toMatch(/^[/\\]/); // no leading slash
  expect(p).not.toMatch(/^[A-Za-z]:[\\/]/); // no drive letter
  expect(p).not.toContain(".."); // no traversal
}

describe("privacy — audit log", () => {
  let root: string;
  let h: Harness;

  beforeEach(async () => {
    root = makeWorkspace();
    writeFile(root, "notes.md", `# Notes\n\n${SENTINEL}\n`);
    writeFile(root, "sub/deep.md", "# Deep\n\nbody.\n");
    h = await connect(root, { config: ALL_ENABLED });
  });

  afterEach(async () => {
    await h.close();
    cleanup(root);
  });

  it("records every call with a workspace-relative path (never absolute)", async () => {
    await callTool(h, "read_file", { path: "notes.md" });
    await callTool(h, "read_file", { path: "sub/deep.md" });
    await callTool(h, "write_file", { path: "out.md", content: "# Out\n" });
    await h.client.readResource({ uri: "pennivo://workspace" });

    const events = h.audit.recent(50);
    expect(events.length).toBeGreaterThan(0);
    for (const e of events) {
      assertRelativeSafe(e.path);
    }
  });

  it("records a traversal attempt without storing the resolved absolute path", async () => {
    await callTool(h, "read_file", { path: "../../etc/hosts" });
    const e = h.audit.recent(5).find((x) => x.tool === "read_file");
    expect(e).toBeDefined();
    // The audited path is the (relativized) request, and the detail must not
    // reveal the workspace's absolute location.
    expect(e?.detail ?? "").not.toContain(root);
    expect(e?.detail ?? "").not.toMatch(/[A-Za-z]:[\\/]/);
  });

  it("never writes file CONTENT into the audit log", async () => {
    await callTool(h, "read_file", { path: "notes.md" });
    await callTool(h, "write_file", {
      path: "copy.md",
      content: `# Copy\n\n${SENTINEL}\n`,
    });
    await callTool(h, "append_to_file", {
      path: "notes.md",
      content: `${SENTINEL}-appended`,
    });

    const serialized = JSON.stringify(h.audit.recent(50));
    expect(serialized).not.toContain(SENTINEL);
  });

  it("scrubs the workspace root out of raw fs error messages", async () => {
    // Force a real fs error whose message embeds an absolute path: write under
    // a path whose parent is a regular file.
    writeFileSync(path.join(root, "file.md"), "x");
    const res = await callTool(h, "write_file", {
      path: "file.md/child.md",
      content: "x",
    });
    expect(res.isError).toBe(true);
    const text = firstText(res);
    expect(text).not.toContain(root);
    expect(text).not.toMatch(/[A-Za-z]:[\\/]/);
    // Audit detail is scrubbed too.
    const e = h.audit.recent(5).find((x) => x.tool === "write_file");
    expect(e?.detail ?? "").not.toContain(root);
  });
});

describe("privacy — resources expose only relative paths and no content", () => {
  let root: string;
  let h: Harness;

  beforeEach(async () => {
    root = makeWorkspace();
    writeFile(root, "notes.md", `# Notes\n\n${SENTINEL}\n`);
    writeFile(root, "sub/deep.md", "# Deep\n");
    h = await connect(root, { config: ALL_ENABLED });
  });

  afterEach(async () => {
    await h.close();
    cleanup(root);
  });

  it("pennivo://workspace lists relative paths and no file content", async () => {
    const res = await h.client.readResource({ uri: "pennivo://workspace" });
    const text = (res.contents[0] as { text: string }).text;
    const data = JSON.parse(text) as {
      root: string;
      entries: { path: string }[];
    };
    expect(data.root).toBe(".");
    expect(text).not.toContain(root); // no absolute path
    expect(text).not.toContain(SENTINEL); // listing, not content
    const flat = (nodes: { path: string; children?: unknown[] }[]): string[] =>
      nodes.flatMap((n) => [
        n.path,
        ...flat((n.children as typeof nodes) ?? []),
      ]);
    for (const p of flat(data.entries as never)) assertRelativeSafe(p);
  });

  it("pennivo://recent lists relative paths only", async () => {
    const res = await h.client.readResource({ uri: "pennivo://recent" });
    const text = (res.contents[0] as { text: string }).text;
    const data = JSON.parse(text) as { files: { path: string }[] };
    expect(text).not.toContain(root);
    for (const f of data.files) assertRelativeSafe(f.path);
  });
});

describe("privacy — redactRoot", () => {
  it("replaces every slash variant of the root with <workspace>", () => {
    const root = "C:/Users/me/notes";
    expect(redactRoot("open C:/Users/me/notes/a.md failed", root)).toBe(
      "open <workspace>/a.md failed",
    );
    expect(redactRoot("open C:\\Users\\me\\notes\\a.md failed", root)).toBe(
      "open <workspace>\\a.md failed",
    );
  });

  it("leaves unrelated text untouched", () => {
    expect(redactRoot("a generic error with no path", "/root")).toBe(
      "a generic error with no path",
    );
  });
});
