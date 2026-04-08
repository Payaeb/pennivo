import { describe, it, expect } from 'vitest';
import { fuzzyMatch } from '../fuzzyMatch';

describe('fuzzyMatch', () => {
  it('exact substring match returns match: true with high score', () => {
    const result = fuzzyMatch('bold', 'Toggle Bold');
    expect(result.match).toBe(true);
    expect(result.score).toBeGreaterThan(0);
  });

  it('word-start match scores higher than mid-word match', () => {
    const wordStart = fuzzyMatch('tog', 'Toggle Bold');
    const midWord = fuzzyMatch('old', 'Toggle Bold');
    expect(wordStart.match).toBe(true);
    expect(midWord.match).toBe(true);
    expect(wordStart.score).toBeGreaterThan(midWord.score);
  });

  it('fuzzy match (all chars in order) returns match with lower score', () => {
    const exact = fuzzyMatch('bold', 'Toggle Bold');
    const fuzzy = fuzzyMatch('tgbd', 'Toggle Bold');
    expect(fuzzy.match).toBe(true);
    expect(fuzzy.score).toBeLessThan(exact.score);
  });

  it('non-matching query returns match: false, score: 0', () => {
    const result = fuzzyMatch('xyz', 'Toggle Bold');
    expect(result.match).toBe(false);
    expect(result.score).toBe(0);
  });

  it('empty query matches everything', () => {
    const result = fuzzyMatch('', 'Toggle Bold');
    expect(result.match).toBe(true);
  });

  it('case insensitive matching', () => {
    const result = fuzzyMatch('BOLD', 'toggle bold');
    expect(result.match).toBe(true);
  });
});
