import { describe, it, expect } from "vitest";
import { wrapHtmlWithStyles } from "../exportHtml";

const BODY =
  '<p><img src="pennivo-file:///C:/Users/me/notes/pic%201.png" alt="a">' +
  '<img alt="b" src="file:///C:/x/y.png">' +
  "<img src='pennivo-file:///C:/z.png'>" +
  '<img src="https://example.com/r.png" alt="remote"></p>';

describe("wrapHtmlWithStyles local images", () => {
  it("HTML export carries no local path", () => {
    const out = wrapHtmlWithStyles(BODY, "t");
    const body = out.slice(out.indexOf("<article>"));
    expect(body).not.toContain("pennivo-file:");
    expect(body).not.toContain("file:///");
    expect(body).not.toContain("C:/");
  });

  it("HTML export keeps a remote https image", () => {
    const out = wrapHtmlWithStyles(BODY, "t");
    expect(out).toContain('<img src="https://example.com/r.png" alt="remote">');
  });

  it("PDF export keeps local images as file:///", () => {
    const out = wrapHtmlWithStyles(BODY, "t", true);
    expect(out).toContain('src="file:///C:/Users/me/notes/pic%201.png"');
    expect(out).not.toContain("pennivo-file:");
    expect(out).toContain('src="https://example.com/r.png"');
  });
});
