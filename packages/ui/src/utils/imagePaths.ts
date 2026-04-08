// Markdown image pattern: ![alt](src) or ![alt](src "title")
// Group 1: prefix `![alt](`  Group 2: URL (no spaces)  Group 3: optional title + `)`
const MD_IMAGE_REGEX = /(!\[[^\]]*]\()(\S+?)((?:\s+"[^"]*")?\))/g;

/**
 * Convert relative image paths (e.g. `./images/foo.png`) to absolute
 * `pennivo-file:///` URLs for display in the editor.
 */
export function resolveImagePaths(markdown: string, filePath: string): string {
  const fileDir = filePath.replace(/\\/g, '/').replace(/\/[^/]+$/, '');
  return markdown.replace(MD_IMAGE_REGEX, (_match, prefix, src, suffix) => {
    // Already absolute — leave as-is
    if (src.startsWith('pennivo-file://') || src.startsWith('http://') || src.startsWith('https://') || src.startsWith('data:')) {
      return `${prefix}${src}${suffix}`;
    }
    // Relative path — resolve against file directory.
    const resolved = `${fileDir}/${src.replace(/^\.\//, '')}`.replace(/ /g, '%20');
    return `${prefix}pennivo-file:///${resolved}${suffix}`;
  });
}

/**
 * Convert absolute `pennivo-file:///` image URLs back to relative paths
 * for portable markdown storage.
 */
export function relativizeImagePaths(markdown: string, filePath: string): string {
  const fileDir = filePath.replace(/\\/g, '/').replace(/\/[^/]+$/, '');
  const prefix = `pennivo-file:///${fileDir}/`;
  const encodedPrefix = prefix.replace(/ /g, '%20');
  return markdown.replace(MD_IMAGE_REGEX, (_match, mdPrefix, src, suffix) => {
    if (src.startsWith(prefix)) {
      const relative = `./${src.slice(prefix.length)}`;
      return `${mdPrefix}${relative}${suffix}`;
    }
    if (src.startsWith(encodedPrefix)) {
      const relative = `./${decodeURIComponent(src.slice(encodedPrefix.length))}`;
      return `${mdPrefix}${relative}${suffix}`;
    }
    return `${mdPrefix}${src}${suffix}`;
  });
}
