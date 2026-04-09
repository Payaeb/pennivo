/**
 * Welcome document shown on first launch.
 * Demonstrates Pennivo's features using markdown.
 */
export const WELCOME_CONTENT = `# Welcome to Pennivo

Pennivo is a markdown editor built for writers. This document showcases what you can do.

---

## Formatting

You can write in **bold**, *italic*, or ~~strikethrough~~. Use the toolbar above or keyboard shortcuts like **Ctrl+B** for bold and **Ctrl+I** for italic.

## Headings

Use headings to organize your writing. This document uses H1 for the title, H2 for sections, and H3 for subsections.

### A Subsection

You can have up to six levels of headings, but most documents work best with two or three.

## Lists

Here are some things you can do:

- Write with a clean, distraction-free interface
- Switch between light, dark, sepia, and other themes
- Export to HTML or PDF

Or with numbered steps:

1. Open a file with **Ctrl+O**
2. Edit your content
3. Save with **Ctrl+S**

### Task Lists

- [x] Install Pennivo
- [x] Open the welcome document
- [ ] Write something amazing
- [ ] Try focus mode (**Ctrl+Shift+F**)

## Links and Images

Create links like [Markdown Guide](https://www.markdownguide.org) using **Ctrl+K**.

You can paste images directly from your clipboard, or insert them from files using the toolbar.

## Blockquotes

> "The scariest moment is always just before you start."
> — Stephen King

## Code

Inline code looks like \`this\`. Code blocks support syntax highlighting:

\`\`\`javascript
function greet(name) {
  return \`Hello, \${name}! Welcome to Pennivo.\`;
}
\`\`\`

## Tables

| Feature | Shortcut |
|---------|----------|
| Bold | Ctrl+B |
| Italic | Ctrl+I |
| Save | Ctrl+S |
| Command Palette | Ctrl+Shift+P |

## Diagrams

Pennivo renders Mermaid diagrams inline:

\`\`\`mermaid
graph LR
    A[Write] --> B[Edit]
    B --> C[Export]
    C --> D[Share]
\`\`\`

---

## Getting Started

- Press **Ctrl+N** to create a new file
- Press **Ctrl+Shift+P** to open the command palette
- Press **Ctrl+/** to see all keyboard shortcuts
- Press **Ctrl+,** to open settings

Happy writing!
`;
