// Markdown image pattern: ![alt](src) or ![alt](src "title")
// Group 1: prefix `![alt](`  Group 2: URL  Group 3: optional title + `)`
//
// CommonMark says image URLs can't contain literal spaces (must be %20 or
// wrapped in <>). But Pennivo was historically writing relative paths with
// literal spaces — for files in folders like "my notes-md-images/" — and
// older files on disk still have them. To keep those readable, we permit
// any non-`)`/non-`"` chars in the URL group; the resolve/relativize
// helpers normalize both forms (literal-space and %20) back to %20 so
// downstream Milkdown can parse them.
const MD_IMAGE_REGEX = /(!\[[^\]]*]\()([^)"]+?)((?:\s+"[^"]*")?\))/g;

function encodeSpaces(s: string): string {
  return s.replace(/ /g, "%20");
}

/**
 * Convert relative image paths (e.g. `./images/foo.png`) to absolute
 * `pennivo-file:///` URLs for display in the editor. Literal spaces in the
 * URL are %20-encoded so CommonMark parsers (Milkdown) can handle them.
 */
export function resolveImagePaths(markdown: string, filePath: string): string {
  const fileDir = filePath.replace(/\\/g, "/").replace(/\/[^/]+$/, "");
  return markdown.replace(MD_IMAGE_REGEX, (_match, prefix, src, suffix) => {
    // Already absolute — leave as-is (caller is responsible for encoding).
    if (
      src.startsWith("pennivo-file://") ||
      src.startsWith("http://") ||
      src.startsWith("https://") ||
      src.startsWith("data:")
    ) {
      return `${prefix}${src}${suffix}`;
    }
    const resolved = encodeSpaces(`${fileDir}/${src.replace(/^\.\//, "")}`);
    return `${prefix}pennivo-file:///${resolved}${suffix}`;
  });
}

/**
 * Convert absolute `pennivo-file:///` image URLs back to relative paths for
 * portable markdown storage. Spaces stay %20-encoded so the saved markdown
 * remains valid CommonMark and round-trips through Pennivo (and other
 * tools) without breakage.
 */
export function relativizeImagePaths(
  markdown: string,
  filePath: string,
): string {
  const fileDir = filePath.replace(/\\/g, "/").replace(/\/[^/]+$/, "");
  const prefix = `pennivo-file:///${fileDir}/`;
  const encodedPrefix = encodeSpaces(prefix);
  return markdown.replace(MD_IMAGE_REGEX, (_match, mdPrefix, src, suffix) => {
    if (src.startsWith(prefix)) {
      const relative = `./${encodeSpaces(src.slice(prefix.length))}`;
      return `${mdPrefix}${relative}${suffix}`;
    }
    if (src.startsWith(encodedPrefix)) {
      // Already %20-encoded — preserve as-is (no decode).
      const relative = `./${src.slice(encodedPrefix.length)}`;
      return `${mdPrefix}${relative}${suffix}`;
    }
    return `${mdPrefix}${src}${suffix}`;
  });
}
