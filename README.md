# Pennivo

A beautiful markdown editor for writers. Edit in WYSIWYG or raw markdown — your words, your way.

## Features (Planned)

- WYSIWYG editing with inline markdown rendering (Typora-style)
- Raw markdown source mode with syntax highlighting
- Light and dark themes
- Image paste from clipboard
- Auto-save
- Distraction-free writing mode
- Export to HTML, PDF, DOCX

## Development

### Prerequisites

- [Node.js](https://nodejs.org/) 20+
- [pnpm](https://pnpm.io/) 10+

### Setup

```bash
pnpm install
pnpm dev
```

### Project Structure

```
packages/
  core/      — Editor engine (framework-agnostic TypeScript)
  ui/        — Shared React components
  desktop/   — Electron desktop application
```

### Scripts

| Command | Description |
|---|---|
| `pnpm dev` | Start the desktop app in development mode |
| `pnpm build` | Build all packages and the desktop app |
| `pnpm test` | Run all tests |
| `pnpm lint` | Lint all source files |
| `pnpm format` | Format all source files |

## License

[MIT](LICENSE) - Paya Ebrahimi
