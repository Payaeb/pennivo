export function extractFilename(filePath: string): string {
  return filePath.split(/[/\\]/).pop() || 'untitled.md';
}
