# Contributing to Pennivo

Thank you for your interest in contributing to Pennivo!

## Contributor License Agreement (CLA)

By submitting a pull request, you agree that:

1. You have the right to submit the contribution.
2. You grant Paya Ebrahimi a perpetual, worldwide, non-exclusive, royalty-free, irrevocable license to use, reproduce, modify, distribute, and sublicense your contribution as part of Pennivo.
3. You understand that your contribution will be licensed under the MIT License.

## Getting Started

1. Fork the repository
2. Clone your fork
3. Install dependencies: `pnpm install`
4. Create a branch: `git checkout -b my-feature`
5. Make your changes
6. Run type checks: `pnpm typecheck`
7. Run tests: `pnpm test`
8. Run lint and format checks: `pnpm lint && pnpm format:check`
9. Commit and push
10. Open a pull request

Before pushing, you can run the full CI sequence locally:

```bash
pnpm preflight
```

## Code Style

- TypeScript with strict mode
- Functional React components with hooks
- CSS custom properties for theming
- Named exports preferred over default exports
- Formatting is enforced by Prettier (`pnpm format` to auto-fix)
- Linting is enforced by ESLint (`pnpm lint:fix` to auto-fix)

## Reporting Issues

Use [GitHub Issues](https://github.com/Payaeb/pennivo/issues) to report bugs or request features.
