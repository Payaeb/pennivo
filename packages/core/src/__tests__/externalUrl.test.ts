import { describe, it, expect } from "vitest";
import { isSafeExternalUrl } from "../externalUrl";

describe("isSafeExternalUrl", () => {
  const refused: Array<[string, unknown]> = [
    ["file drive path", "file:///C:/x.exe"],
    ["file with host", "file://host/share/x"],
    ["file calc", "file:///C:/Windows/System32/calc.exe"],
    ["UNC backslash", "\\\\host\\share\\x"],
    ["UNC scheme-relative", "//host/share"],
    ["javascript", "javascript:alert(1)"],
    ["data", "data:text/html,x"],
    ["ms-msdt", "ms-msdt:x"],
    ["search-ms", "search-ms:x"],
    ["mailto (not opened by this path)", "mailto:a@b.c"],
    ["vbscript", "vbscript:msgbox(1)"],
    ["about", "about:blank"],
    ["leading space", " https://x"],
    ["trailing space", "https://x "],
    ["embedded newline", "https://x.test/\nfile:///C:/x"],
    ["embedded tab", "https://x.test/\t"],
    ["NUL", "https://x.test/\u0000"],
    ["empty", ""],
    ["undefined", undefined],
    ["null", null],
    ["number", 42],
    ["object", { href: "https://x.test" }],
    ["relative path", "docs/readme.md"],
    ["bare host", "example.com"],
    ["scheme only", "https://"],
    ["leading NBSP", " https://x.test"],
    ["DEL char", "https://x.test/\u007f"],
    ["CR", "https://x.test/\r"],
    ["ms-settings", "ms-settings:network"],
    ["ms-excel", "ms-excel:ofe|u|https://x.test/a.xlsx"],
    ["steam", "steam://run/1"],
    ["blob", "blob:https://x.test/uuid"],
    ["ftp", "ftp://x.test/a"],
    ["array", ["https://x.test"]],
    ["10k garbage", "a".repeat(10_000)],
    ["10k http URL", "https://example.com/" + "a".repeat(10_000)],
  ];
  it.each(refused)("refuses %s", (_name, value) => {
    expect(isSafeExternalUrl(value)).toBe(false);
  });

  const allowed = [
    "http://example.com",
    "https://example.com/a b",
    "HTTP://EXAMPLE.COM",
    "https://example.com/path?q=1#frag",
    "https://sub.example.com:8443/x",
    "https://user:pass@example.com/x",
    "HtTpS://Example.com",
    "http://localhost:3000",
    "http://192.168.0.1/x",
    "http:\\\\example.com\\x",
  ];
  it.each(allowed)("allows %s", (value) => {
    expect(isSafeExternalUrl(value)).toBe(true);
  });
});
