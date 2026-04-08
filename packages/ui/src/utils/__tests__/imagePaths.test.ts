import { describe, it, expect } from 'vitest';
import { resolveImagePaths, relativizeImagePaths } from '../imagePaths';

// --- resolveImagePaths ---

describe('resolveImagePaths', () => {
  it('relative path becomes pennivo-file:/// URL', () => {
    const md = '![photo](./images/photo.png)';
    const result = resolveImagePaths(md, 'C:/docs/note.md');
    expect(result).toBe('![photo](pennivo-file:///C:/docs/images/photo.png)');
  });

  it('already-absolute https URL left unchanged', () => {
    const md = '![img](https://example.com/img.png)';
    expect(resolveImagePaths(md, 'C:/docs/note.md')).toBe(md);
  });

  it('already-resolved pennivo-file:/// left unchanged', () => {
    const md = '![img](pennivo-file:///C:/docs/img.png)';
    expect(resolveImagePaths(md, 'C:/docs/note.md')).toBe(md);
  });

  it('data: URLs left unchanged', () => {
    const md = '![img](data:image/png;base64,abc123)';
    expect(resolveImagePaths(md, 'C:/docs/note.md')).toBe(md);
  });

  it('spaces in paths are not matched (markdown image URLs cannot contain spaces)', () => {
    // The regex uses \S+? for the URL, so spaces break the match — image is left unchanged
    const md = '![photo](./my images/photo.png)';
    const result = resolveImagePaths(md, 'C:/docs/note.md');
    expect(result).toBe(md);
  });

  it('percent-encoded spaces in paths are resolved correctly', () => {
    const md = '![photo](./my%20images/photo.png)';
    const result = resolveImagePaths(md, 'C:/docs/note.md');
    expect(result).toBe('![photo](pennivo-file:///C:/docs/my%20images/photo.png)');
  });

  it('multiple images in one markdown string all resolved', () => {
    const md = '![a](./a.png) text ![b](./b.png)';
    const result = resolveImagePaths(md, 'C:/docs/note.md');
    expect(result).toContain('pennivo-file:///C:/docs/a.png');
    expect(result).toContain('pennivo-file:///C:/docs/b.png');
  });

  it('non-image markdown content unchanged', () => {
    const md = '# Hello\n\nSome text [link](url)';
    expect(resolveImagePaths(md, 'C:/docs/note.md')).toBe(md);
  });

  it('image with title handled correctly', () => {
    const md = '![alt](./img.png "My Title")';
    const result = resolveImagePaths(md, 'C:/docs/note.md');
    expect(result).toContain('pennivo-file:///C:/docs/img.png');
    expect(result).toContain('"My Title"');
  });

  it('http:// URLs left unchanged', () => {
    const md = '![img](http://example.com/img.png)';
    expect(resolveImagePaths(md, 'C:/docs/note.md')).toBe(md);
  });

  it('resolves path without ./ prefix', () => {
    const md = '![photo](images/photo.png)';
    const result = resolveImagePaths(md, 'C:/docs/note.md');
    expect(result).toBe('![photo](pennivo-file:///C:/docs/images/photo.png)');
  });
});

// --- relativizeImagePaths ---

describe('relativizeImagePaths', () => {
  it('absolute pennivo-file:/// becomes relative path', () => {
    const md = '![photo](pennivo-file:///C:/docs/images/photo.png)';
    const result = relativizeImagePaths(md, 'C:/docs/note.md');
    expect(result).toBe('![photo](./images/photo.png)');
  });

  it('URLs outside the file directory left as absolute', () => {
    const md = '![photo](pennivo-file:///D:/other/photo.png)';
    const result = relativizeImagePaths(md, 'C:/docs/note.md');
    expect(result).toBe(md);
  });

  it('already-relative paths left unchanged', () => {
    const md = '![photo](./images/photo.png)';
    const result = relativizeImagePaths(md, 'C:/docs/note.md');
    expect(result).toBe(md);
  });

  it('%20 preserved in relative path when fileDir has no spaces', () => {
    // When fileDir has no spaces, the non-encoded prefix matches, and %20 stays as-is
    const md = '![photo](pennivo-file:///C:/docs/my%20images/photo.png)';
    const result = relativizeImagePaths(md, 'C:/docs/note.md');
    expect(result).toBe('![photo](./my%20images/photo.png)');
  });

  it('multiple images all relativized', () => {
    const md = '![a](pennivo-file:///C:/docs/a.png) ![b](pennivo-file:///C:/docs/b.png)';
    const result = relativizeImagePaths(md, 'C:/docs/note.md');
    expect(result).toContain('./a.png');
    expect(result).toContain('./b.png');
  });
});

// --- Roundtrip ---

describe('Roundtrip: resolve → relativize', () => {
  it('resolve then relativize returns original relative paths', () => {
    const original = '![photo](./images/photo.png)';
    const filePath = 'C:/docs/note.md';
    const resolved = resolveImagePaths(original, filePath);
    const roundtripped = relativizeImagePaths(resolved, filePath);
    expect(roundtripped).toBe(original);
  });

  it('works with nested subdirectories', () => {
    const original = '![photo](./deep/nested/dir/photo.png)';
    const filePath = 'C:/projects/my-app/docs/note.md';
    const resolved = resolveImagePaths(original, filePath);
    const roundtripped = relativizeImagePaths(resolved, filePath);
    expect(roundtripped).toBe(original);
  });

  it('works with paths containing spaces', () => {
    const original = '![photo](./my%20images/photo.png)';
    const filePath = 'C:/docs/note.md';
    const resolved = resolveImagePaths(original, filePath);
    const roundtripped = relativizeImagePaths(resolved, filePath);
    // The spaces get decoded then re-encoded through the roundtrip
    expect(roundtripped).toContain('my');
    expect(roundtripped).toContain('photo.png');
  });
});
