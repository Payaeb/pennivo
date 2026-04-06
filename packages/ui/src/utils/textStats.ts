export function stripMarkdown(markdown: string): string {
  return markdown
    .replace(/```[\s\S]*?```/g, '')
    .replace(/`[^`]+`/g, '')
    .replace(/#{1,6}\s+/g, '')
    .replace(/!\[.*?\]\(.*?\)/g, '')           // Remove images (alt text is not content)
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')   // Links → keep link text, drop URL
    .replace(/\*{1,2}|_{1,2}|~~/g, '')         // Remove formatting markers
    .replace(/^\s*[-*+>]\s/gm, '')
    .replace(/^\s*\d+\.\s/gm, '')
    .replace(/^\s*-\s*\[[ x]\]\s*/gm, '')     // Remove task list markers
    .replace(/\|/g, '')                         // Remove table pipes
    .replace(/-{3,}/g, '')                      // Remove horizontal rules / table separators
    .trim();
}

export function countWords(markdown: string): number {
  const text = stripMarkdown(markdown);
  if (!text) return 0;
  return text.split(/\s+/).filter(Boolean).length;
}

export function countCharacters(markdown: string): number {
  const text = stripMarkdown(markdown);
  return text.replace(/\s/g, '').length;
}
