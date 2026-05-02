import { describe, it, expect } from "vitest";
import { resolveImagePaths, relativizeImagePaths } from "../imagePaths";

// --- resolveImagePaths ---

describe("resolveImagePaths", () => {
  it("relative path becomes pennivo-file:/// URL", () => {
    const md = "![photo](./images/photo.png)";
    const result = resolveImagePaths(md, "C:/docs/note.md");
    expect(result).toBe("![photo](pennivo-file:///C:/docs/images/photo.png)");
  });

  it("already-absolute https URL left unchanged", () => {
    const md = "![img](https://example.com/img.png)";
    expect(resolveImagePaths(md, "C:/docs/note.md")).toBe(md);
  });

  it("already-resolved pennivo-file:/// left unchanged", () => {
    const md = "![img](pennivo-file:///C:/docs/img.png)";
    expect(resolveImagePaths(md, "C:/docs/note.md")).toBe(md);
  });

  it("data: URLs left unchanged", () => {
    const md = "![img](data:image/png;base64,abc123)";
    expect(resolveImagePaths(md, "C:/docs/note.md")).toBe(md);
  });

  it("literal spaces in relative paths are accepted and %20-encoded in the resolved URL", () => {
    // Files saved by older versions of Pennivo (or hand-edited) may have
    // literal spaces in the URL. CommonMark forbids them, but Pennivo has
    // to read them back without dropping the image — encode the spaces so
    // Milkdown can render the image.
    const md = "![photo](./my images/photo.png)";
    const result = resolveImagePaths(md, "C:/docs/note.md");
    expect(result).toBe(
      "![photo](pennivo-file:///C:/docs/my%20images/photo.png)",
    );
  });

  it("works for the production folder pattern with multiple spaces", () => {
    const md =
      "![](./how I feel about what pro war people say-md-images/paste.png)";
    const result = resolveImagePaths(md, "C:/notes/note.md");
    expect(result).toContain(
      "pennivo-file:///C:/notes/how%20I%20feel%20about%20what%20pro%20war%20people%20say-md-images/paste.png",
    );
  });

  it("percent-encoded spaces in paths are resolved correctly", () => {
    const md = "![photo](./my%20images/photo.png)";
    const result = resolveImagePaths(md, "C:/docs/note.md");
    expect(result).toBe(
      "![photo](pennivo-file:///C:/docs/my%20images/photo.png)",
    );
  });

  it("multiple images in one markdown string all resolved", () => {
    const md = "![a](./a.png) text ![b](./b.png)";
    const result = resolveImagePaths(md, "C:/docs/note.md");
    expect(result).toContain("pennivo-file:///C:/docs/a.png");
    expect(result).toContain("pennivo-file:///C:/docs/b.png");
  });

  it("non-image markdown content unchanged", () => {
    const md = "# Hello\n\nSome text [link](url)";
    expect(resolveImagePaths(md, "C:/docs/note.md")).toBe(md);
  });

  it("image with title handled correctly", () => {
    const md = '![alt](./img.png "My Title")';
    const result = resolveImagePaths(md, "C:/docs/note.md");
    expect(result).toContain("pennivo-file:///C:/docs/img.png");
    expect(result).toContain('"My Title"');
  });

  it("http:// URLs left unchanged", () => {
    const md = "![img](http://example.com/img.png)";
    expect(resolveImagePaths(md, "C:/docs/note.md")).toBe(md);
  });

  it("resolves path without ./ prefix", () => {
    const md = "![photo](images/photo.png)";
    const result = resolveImagePaths(md, "C:/docs/note.md");
    expect(result).toBe("![photo](pennivo-file:///C:/docs/images/photo.png)");
  });
});

// --- relativizeImagePaths ---

describe("relativizeImagePaths", () => {
  it("absolute pennivo-file:/// becomes relative path", () => {
    const md = "![photo](pennivo-file:///C:/docs/images/photo.png)";
    const result = relativizeImagePaths(md, "C:/docs/note.md");
    expect(result).toBe("![photo](./images/photo.png)");
  });

  it("URLs outside the file directory left as absolute", () => {
    const md = "![photo](pennivo-file:///D:/other/photo.png)";
    const result = relativizeImagePaths(md, "C:/docs/note.md");
    expect(result).toBe(md);
  });

  it("already-relative paths left unchanged", () => {
    const md = "![photo](./images/photo.png)";
    const result = relativizeImagePaths(md, "C:/docs/note.md");
    expect(result).toBe(md);
  });

  it("%20 preserved in relative path when fileDir has no spaces", () => {
    // When fileDir has no spaces, the non-encoded prefix matches, and %20 stays as-is
    const md = "![photo](pennivo-file:///C:/docs/my%20images/photo.png)";
    const result = relativizeImagePaths(md, "C:/docs/note.md");
    expect(result).toBe("![photo](./my%20images/photo.png)");
  });

  it("multiple images all relativized", () => {
    const md =
      "![a](pennivo-file:///C:/docs/a.png) ![b](pennivo-file:///C:/docs/b.png)";
    const result = relativizeImagePaths(md, "C:/docs/note.md");
    expect(result).toContain("./a.png");
    expect(result).toContain("./b.png");
  });
});

// --- Roundtrip ---

describe("Roundtrip: resolve → relativize", () => {
  it("resolve then relativize returns original relative paths", () => {
    const original = "![photo](./images/photo.png)";
    const filePath = "C:/docs/note.md";
    const resolved = resolveImagePaths(original, filePath);
    const roundtripped = relativizeImagePaths(resolved, filePath);
    expect(roundtripped).toBe(original);
  });

  it("works with nested subdirectories", () => {
    const original = "![photo](./deep/nested/dir/photo.png)";
    const filePath = "C:/projects/my-app/docs/note.md";
    const resolved = resolveImagePaths(original, filePath);
    const roundtripped = relativizeImagePaths(resolved, filePath);
    expect(roundtripped).toBe(original);
  });

  it("%20-encoded paths roundtrip exactly", () => {
    const original = "![photo](./my%20images/photo.png)";
    const filePath = "C:/docs/note.md";
    const resolved = resolveImagePaths(original, filePath);
    const roundtripped = relativizeImagePaths(resolved, filePath);
    expect(roundtripped).toBe(original);
  });

  it("literal-space paths heal to %20-encoded form on roundtrip", () => {
    // Inbound: literal space (legacy / hand-edited).
    // Outbound: %20-encoded (valid CommonMark, parseable by Milkdown).
    const original = "![photo](./my images/photo.png)";
    const filePath = "C:/docs/note.md";
    const resolved = resolveImagePaths(original, filePath);
    const roundtripped = relativizeImagePaths(resolved, filePath);
    expect(roundtripped).toBe("![photo](./my%20images/photo.png)");
  });

  it("production-shape path with multiple spaces roundtrips cleanly", () => {
    const original =
      "![](./how I feel about what pro war people say-md-images/paste.png)";
    const filePath = "C:/notes/note.md";
    const resolved = resolveImagePaths(original, filePath);
    const roundtripped = relativizeImagePaths(resolved, filePath);
    expect(roundtripped).toBe(
      "![](./how%20I%20feel%20about%20what%20pro%20war%20people%20say-md-images/paste.png)",
    );
  });
});
