import { renderHook, act } from '@testing-library/react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { useTheme, COLOR_SCHEMES } from '../useTheme';

describe('useTheme', () => {
  beforeEach(() => {
    localStorage.clear();
    document.documentElement.removeAttribute('data-theme');
    document.documentElement.removeAttribute('data-color-scheme');
  });

  it('returns current theme mode', () => {
    const { result } = renderHook(() => useTheme());
    expect(['light', 'dark']).toContain(result.current.mode);
    expect(result.current.theme).toBe(result.current.mode);
  });

  it('toggleTheme switches between light and dark', () => {
    localStorage.setItem('pennivo-theme', 'light');
    const { result } = renderHook(() => useTheme());
    expect(result.current.mode).toBe('light');

    act(() => result.current.toggleTheme());
    expect(result.current.mode).toBe('dark');

    act(() => result.current.toggleTheme());
    expect(result.current.mode).toBe('light');
  });

  it('setMode sets specific mode', () => {
    const { result } = renderHook(() => useTheme());
    act(() => result.current.setMode('dark'));
    expect(result.current.mode).toBe('dark');

    act(() => result.current.setMode('light'));
    expect(result.current.mode).toBe('light');
  });

  it('persists theme choice to localStorage', () => {
    const { result } = renderHook(() => useTheme());
    act(() => result.current.setMode('dark'));
    expect(localStorage.getItem('pennivo-theme')).toBe('dark');
  });

  it('reads persisted theme from localStorage', () => {
    localStorage.setItem('pennivo-theme', 'dark');
    const { result } = renderHook(() => useTheme());
    expect(result.current.mode).toBe('dark');
  });

  it('respects system preference when no stored theme', () => {
    // matchMedia is mocked in setup.ts to return matches: false (light)
    const { result } = renderHook(() => useTheme());
    expect(result.current.mode).toBe('light');
  });

  it('defaults to system dark when matchMedia matches', () => {
    vi.mocked(window.matchMedia).mockImplementation((query: string) => ({
      matches: query === '(prefers-color-scheme: dark)',
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }));
    const { result } = renderHook(() => useTheme());
    expect(result.current.mode).toBe('dark');
  });

  it('returns available color schemes', () => {
    const { result } = renderHook(() => useTheme());
    expect(result.current.colorScheme).toBe('default');
    // COLOR_SCHEMES constant should have all schemes
    expect(COLOR_SCHEMES).toHaveLength(4);
    expect(COLOR_SCHEMES.map(s => s.id)).toEqual(['default', 'sepia', 'nord', 'rosepine']);
  });

  it('setColorScheme changes scheme', () => {
    const { result } = renderHook(() => useTheme());
    act(() => result.current.setColorScheme('nord'));
    expect(result.current.colorScheme).toBe('nord');
    expect(localStorage.getItem('pennivo-color-scheme')).toBe('nord');
  });

  it('cycleColorScheme cycles through schemes', () => {
    const { result } = renderHook(() => useTheme());
    expect(result.current.colorScheme).toBe('default');

    act(() => result.current.cycleColorScheme());
    expect(result.current.colorScheme).toBe('sepia');

    act(() => result.current.cycleColorScheme());
    expect(result.current.colorScheme).toBe('nord');

    act(() => result.current.cycleColorScheme());
    expect(result.current.colorScheme).toBe('rosepine');

    act(() => result.current.cycleColorScheme());
    expect(result.current.colorScheme).toBe('default');
  });

  it('applies data-theme attribute to document', () => {
    const { result } = renderHook(() => useTheme());
    act(() => result.current.setMode('dark'));
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
  });

  it('applies data-color-scheme attribute to document', () => {
    const { result } = renderHook(() => useTheme());
    act(() => result.current.setColorScheme('sepia'));
    expect(document.documentElement.getAttribute('data-color-scheme')).toBe('sepia');
  });
});
