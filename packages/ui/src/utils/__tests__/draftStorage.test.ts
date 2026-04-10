import { describe, it, expect, beforeEach } from "vitest";
import { saveDraft, loadDraft, clearDraft } from "../draftStorage";

// Mock localStorage for Node environment
const store: Record<string, string> = {};
const localStorageMock = {
  getItem: (key: string) => store[key] ?? null,
  setItem: (key: string, value: string) => {
    store[key] = value;
  },
  removeItem: (key: string) => {
    delete store[key];
  },
  clear: () => {
    for (const key of Object.keys(store)) delete store[key];
  },
  get length() {
    return Object.keys(store).length;
  },
  key: (index: number) => Object.keys(store)[index] ?? null,
};

Object.defineProperty(globalThis, "localStorage", {
  value: localStorageMock,
  writable: true,
});

beforeEach(() => {
  localStorageMock.clear();
});

describe("draftStorage", () => {
  it("saveDraft + loadDraft roundtrip preserves content and filePath", () => {
    saveDraft("# Hello", "C:/docs/note.md");
    const draft = loadDraft();
    expect(draft).not.toBeNull();
    expect(draft!.content).toBe("# Hello");
    expect(draft!.filePath).toBe("C:/docs/note.md");
  });

  it("loadDraft returns null when nothing saved", () => {
    expect(loadDraft()).toBeNull();
  });

  it("loadDraft returns null for corrupt JSON", () => {
    localStorageMock.setItem("pennivo-draft", "{not valid json!!!");
    expect(loadDraft()).toBeNull();
  });

  it("clearDraft removes the stored draft", () => {
    saveDraft("content", "path.md");
    clearDraft();
    expect(loadDraft()).toBeNull();
  });

  it("saveDraft with null filePath works", () => {
    saveDraft("# Untitled", null);
    const draft = loadDraft();
    expect(draft).not.toBeNull();
    expect(draft!.filePath).toBeNull();
    expect(draft!.content).toBe("# Untitled");
  });

  it("loadDraft returns null for JSON missing required fields", () => {
    localStorageMock.setItem("pennivo-draft", JSON.stringify({ foo: "bar" }));
    expect(loadDraft()).toBeNull();
  });
});
