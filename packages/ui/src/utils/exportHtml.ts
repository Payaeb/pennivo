/**
 * Shared HTML export utility.
 *
 * Generates a self-contained HTML document with embedded CSS that mirrors the
 * Pennivo editor theme.  Used by both the desktop (Electron) and mobile
 * (Capacitor) export paths.
 */

/**
 * Wraps raw editor HTML in a full standalone document with embedded styles.
 * The resulting HTML has no external dependencies and renders identically to
 * the in-app preview.
 */
export function wrapHtmlWithStyles(bodyHtml: string, title: string): string {
  // Convert pennivo-file:// protocol URLs to file:// for standalone HTML
  let html = bodyHtml.replace(/pennivo-file:\/\/\//g, "file:///");

  // Override dark-mode fill colors in mermaid SVG <style> blocks for light export background
  html = html.replace(
    /(<style>[^<]*?{[^}]*?)fill:#[Ee][0-9A-Fa-f]{5};/g,
    "$1fill:#1A1A18;",
  );

  // Fix bare domain hrefs — add https:// if no protocol
  html = html.replace(/href="([^"]+)"/g, (match, href: string) => {
    if (
      /^[a-zA-Z][a-zA-Z\d+\-.]*:/.test(href) ||
      href.startsWith("#") ||
      href.startsWith("/") ||
      href.startsWith("./") ||
      href.startsWith("../")
    ) {
      return match;
    }
    return `href="https://${href}"`;
  });

  const safeTitle = title
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data: file:; font-src data:;">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${safeTitle}</title>
<meta name="generator" content="Pennivo">
<style>
:root {
  --font-editor: "Georgia", "Times New Roman", serif;
  --font-mono: "Cascadia Code", "Fira Code", "Consolas", monospace;
  --font-ui: "Segoe UI", system-ui, sans-serif;
  --text-base: 17px;
  --bg: #FAFAF8;
  --bg-surface: #F2F0EC;
  --bg-overlay: #ECEAE5;
  --text-primary: #1A1A18;
  --text-muted: #7A7872;
  --text-faint: #AEACA6;
  --accent: #4A7C59;
  --border-mid: rgba(0,0,0,0.13);
  --radius-sm: 4px;
  --radius-md: 6px;
  --sh-keyword: #7C5EB0;
  --sh-string: #8A6B3D;
  --sh-number: #B06040;
  --sh-comment: #9E9B93;
  --sh-function: #3D7A8A;
  --sh-type: #4A7C59;
  --sh-attr: #7A6B2E;
  --sh-punctuation: #8A8880;
  --sh-meta: #8A6B8A;
  --sh-tag: #6B5038;
}
*, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
body {
  font-family: var(--font-editor);
  font-size: var(--text-base);
  line-height: 1.78;
  color: var(--text-primary);
  background: var(--bg);
  max-width: 680px;
  margin: 0 auto;
  padding: 56px 24px;
  -webkit-font-smoothing: antialiased;
}
p { margin-bottom: 18px; }
h1 { font-size: 32px; font-weight: 700; line-height: 1.25; margin-bottom: 28px; letter-spacing: -0.3px; }
h2 { font-size: 20px; font-weight: 600; line-height: 1.35; margin-top: 36px; margin-bottom: 14px; }
h3 { font-size: 17px; font-weight: 600; margin-top: 28px; margin-bottom: 10px; }
h4, h5, h6 { font-size: var(--text-base); font-weight: 600; margin-top: 20px; margin-bottom: 8px; }
strong { font-weight: 700; }
em { font-style: italic; }
s { text-decoration: line-through; color: var(--text-muted); }
a { color: var(--accent); text-decoration: underline; text-underline-offset: 2px; }
code {
  font-family: var(--font-mono);
  font-size: 0.88em;
  background: var(--bg-overlay);
  border: 1px solid var(--border-mid);
  border-radius: var(--radius-sm);
  padding: 1px 5px;
  color: var(--accent);
}
pre {
  position: relative;
  background: var(--bg-surface);
  border: 1px solid var(--border-mid);
  border-radius: var(--radius-md);
  padding: 16px 20px;
  margin: 20px 0;
  overflow-x: auto;
}
pre code {
  font-size: 13.5px;
  background: none;
  border: none;
  padding: 0;
  color: var(--text-primary);
  border-radius: 0;
}
pre[data-language]::after {
  content: attr(data-language);
  position: absolute;
  top: 6px; right: 10px;
  font-family: var(--font-ui);
  font-size: 10.5px;
  font-weight: 500;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--text-faint);
}
pre[data-language=""]::after { content: none; }
blockquote {
  border-left: 3px solid var(--accent);
  margin: 24px 0;
  padding: 4px 0 4px 20px;
}
blockquote p { color: var(--text-muted); font-style: italic; margin-bottom: 0; }
ul, ol { margin: 0 0 18px 0; padding-left: 28px; }
li { margin-bottom: 5px; line-height: 1.78; }
li[data-checked] {
  list-style: none;
  position: relative;
  margin-left: -28px;
  padding-left: 28px;
}
li[data-checked]::before {
  content: '';
  position: absolute;
  left: 0; top: 7px;
  width: 16px; height: 16px;
  border: 1.5px solid var(--border-mid);
  border-radius: 3px;
}
li[data-checked="true"]::before {
  background: var(--accent);
  border-color: var(--accent);
  background-image: url("data:image/svg+xml,%3Csvg viewBox='0 0 16 16' fill='none' stroke='%23fff' stroke-width='2.2' stroke-linecap='round' stroke-linejoin='round' xmlns='http://www.w3.org/2000/svg'%3E%3Cpolyline points='3.5,8.5 6.5,11.5 12.5,5'/%3E%3C/svg%3E");
  background-size: 12px;
  background-position: center;
  background-repeat: no-repeat;
}
li[data-checked="true"] > * { text-decoration: line-through; color: var(--text-faint); }
table { border-collapse: collapse; width: 100%; margin: 20px 0; font-size: 15px; }
th, td { border: 1px solid var(--border-mid); padding: 8px 14px; text-align: left; }
th {
  background: var(--bg-surface);
  font-weight: 600;
  font-size: 13px;
  color: var(--text-muted);
  text-transform: uppercase;
  letter-spacing: 0.04em;
}
hr { border: none; border-top: 1px solid var(--border-mid); margin: 32px 0; }
img { max-width: 100%; border-radius: var(--radius-md); margin: 12px 0; }
.hljs-keyword, .hljs-selector-tag { color: var(--sh-keyword); }
.hljs-string, .hljs-template-tag, .hljs-template-variable { color: var(--sh-string); }
.hljs-number, .hljs-literal { color: var(--sh-number); }
.hljs-comment, .hljs-doctag { color: var(--sh-comment); font-style: italic; }
.hljs-title.function_, .hljs-title.class_ { color: var(--sh-function); }
.hljs-type, .hljs-built_in { color: var(--sh-type); }
.hljs-attr, .hljs-attribute, .hljs-selector-class, .hljs-selector-id { color: var(--sh-attr); }
.hljs-variable, .hljs-params { color: var(--text-primary); }
.hljs-punctuation, .hljs-operator { color: var(--sh-punctuation); }
.hljs-meta, .hljs-meta .hljs-keyword { color: var(--sh-meta); }
.hljs-name, .hljs-tag { color: var(--sh-tag); }
.hljs-regexp { color: var(--sh-string); }
svg text, svg tspan { fill: var(--text-primary); }
svg .tick text, svg .tick tspan { fill: var(--text-muted); }
svg .nodeLabel, svg .edgeLabel, svg foreignObject div, svg foreignObject span, svg foreignObject p {
  color: var(--text-primary) !important;
  fill: var(--text-primary) !important;
}
@media print {
  body { max-width: none; padding: 0; background: white; }
}
@page { margin: 1in 0.75in; }
</style>
</head>
<body>
<article>${html}</article>
</body>
</html>`;
}
