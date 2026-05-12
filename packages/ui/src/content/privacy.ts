// Pennivo privacy notice — bundled string source for the in-app
// PrivacyDialog. Keep IN SYNC with `PRIVACY.md` at the repo root, which is
// the canonical public copy. The two surfaces should always match.
//
// Why a TS file instead of an import-from-fs at runtime: this string is
// bundled into the renderer chunk so the privacy notice is viewable
// completely offline, with no IPC round-trip and no GitHub URL that could
// 404 / require auth.

export const PRIVACY_TEXT = `# Pennivo Privacy Notice

Last updated: 2026-05-11

Pennivo is an offline-first editor. Your documents stay on your device unless you explicitly configure something that moves them.

## Where your data lives

- **Documents** stay where you put them. Pennivo edits files in place; we don't copy your workspace anywhere.
- **Snapshots** (per-file edit history) live locally by default at:
  - Windows: \`%APPDATA%\\Pennivo\\snapshots\\\`
  - macOS: \`~/Library/Application Support/Pennivo/snapshots/\`
  - Linux: \`~/.config/Pennivo/snapshots/\`
- **Trash** (soft-deleted files) lives next to snapshots in \`<userData>/trash/\`. Entries are kept for the configured retention period (default 30 days), then permanently deleted on the next launch sweep.

## Optional archive folder

Settings -> Recovery lets you point an "archive folder" at any location on your system — an external drive, a NAS, or a cloud-synced folder like OneDrive, iCloud Drive, or Dropbox. When you do, snapshots in the tiers you assigned to it are also written there. The destination is wherever you chose. If it's a cloud-synced folder, your cloud provider handles the sync — Pennivo doesn't.

When the archive folder is a third-party cloud-synced location, that provider's terms of service and privacy policy govern the data once it arrives in their system. Pennivo neither stores nor handles that data on its own infrastructure; it only writes the snapshot files to the local path you chose.

If the archive folder becomes unreachable (drive unplugged, cloud signed out), Pennivo queues archive writes and flushes them when the path returns. A warm-amber chip in the titlebar signals the queue state.

## Device identity

Each install generates a random UUID stored in \`<userData>/device.json\` and a default display name from the OS hostname. You can rename the device in Settings -> Recovery -> "This device is called…". The device ID is local-only — no telemetry, no analytics, no MAC address, no machine fingerprinting.

## What Pennivo never does

- Pennivo never sends your documents anywhere unless you explicitly configured an archive destination.
- No analytics, no crash reporting, no usage telemetry. Auto-update checks the GitHub Releases feed for a newer installer; that request carries only the standard HTTP headers your OS sends.
- No account, no sign-in, no cloud sync.

## Third-party services Pennivo touches

Pennivo's auto-update feature checks the GitHub Releases API for new installer versions. GitHub's standard request handling applies to those checks (see github.com/site/privacy). The check is anonymous — Pennivo sends no account or device identifier with it.

If you email hello@pennivo.app, your message is delivered through Cloudflare Email Routing to the maintainer's mailbox. Cloudflare's privacy policy applies to that delivery.

Pennivo itself operates no servers, no databases, and no analytics endpoints.

## "As is" — no warranty, limitation of liability

Pennivo is open-source software released under the MIT License (see the \`LICENSE\` file in the source repository). The software is provided "AS IS", without warranty of any kind, express or implied, including but not limited to the warranties of merchantability, fitness for a particular purpose, and noninfringement.

To the maximum extent permitted by applicable law, the authors and contributors disclaim all liability for any data loss, document corruption, missed snapshots, failed restores, incorrect merges, archive-write failures, or other damages arising from use of the software. You are responsible for maintaining your own backups of important documents.

If a snapshot, restore, merge, or trash operation produces an unexpected result, the safest action is to stop using the affected file and contact the maintainer through the channels in the Questions section below.

## Updates to this notice

Pennivo may update this notice as the software changes. The "Last updated" date at the top reflects the most recent change. Material changes will be called out in the release notes published with the corresponding Pennivo release. Continued use of Pennivo after an update means you've accepted the revised notice.

## Questions

Open an issue on [github.com/payaeb/pennivo](https://github.com/payaeb/pennivo) or email hello@pennivo.app.
`;
