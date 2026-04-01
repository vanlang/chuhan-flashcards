import { describe, it, expect, beforeEach, vi } from "vitest";

// Mock localStorage before importing store
const localStorageMock = (() => {
  let store = {};
  return {
    getItem: vi.fn((key) => store[key] ?? null),
    setItem: vi.fn((key, val) => { store[key] = String(val); }),
    clear: () => { store = {}; },
    _store: store,
  };
})();

Object.defineProperty(global, "localStorage", { value: localStorageMock });

import { loadState, saveState, loadSettings, saveSettings } from "./store.js";

beforeEach(() => {
  localStorageMock.clear();
  vi.clearAllMocks();
});

describe("loadState", () => {
  it("returns {} when localStorage is empty", () => {
    expect(loadState()).toEqual({});
  });

  it("returns parsed state when valid JSON exists", () => {
    const data = { "心": { interval: 1, easeFactor: 2.5, repetitions: 1, nextReview: 9999 } };
    localStorageMock.setItem("chuhan_states", JSON.stringify(data));
    expect(loadState()).toEqual(data);
  });

  it("returns {} and does not throw when JSON is corrupted", () => {
    localStorageMock.setItem("chuhan_states", "[broken json{{{");
    expect(() => loadState()).not.toThrow();
    expect(loadState()).toEqual({});
  });
});

describe("saveState", () => {
  it("persists state to localStorage", () => {
    const data = { "天": { interval: 6, easeFactor: 2.5, repetitions: 2, nextReview: 12345 } };
    saveState(data);
    expect(loadState()).toEqual(data);
  });

  it("does not throw when localStorage throws QuotaExceededError", () => {
    localStorageMock.setItem.mockImplementationOnce(() => {
      const err = new Error("QuotaExceeded");
      err.name = "QuotaExceededError";
      throw err;
    });
    expect(() => saveState({ "心": {} })).not.toThrow();
  });
});

describe("loadSettings", () => {
  it("returns defaults when nothing stored", () => {
    const s = loadSettings();
    expect(s.dailyNewLimit).toBe(10);
  });

  it("merges stored settings with defaults", () => {
    localStorageMock.setItem("chuhan_settings", JSON.stringify({ dailyNewLimit: 20 }));
    expect(loadSettings().dailyNewLimit).toBe(20);
  });

  it("returns defaults on corrupted settings JSON", () => {
    localStorageMock.setItem("chuhan_settings", "{{bad}}");
    expect(() => loadSettings()).not.toThrow();
    expect(loadSettings().dailyNewLimit).toBe(10);
  });
});

describe("saveSettings", () => {
  it("persists settings", () => {
    saveSettings({ dailyNewLimit: 25 });
    expect(loadSettings().dailyNewLimit).toBe(25);
  });
});
