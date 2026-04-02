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

import { loadState, saveState, loadSettings, saveSettings, loadPendingEdits, savePendingEdit, validateEdit, findConflicts, approveSuggestion, rejectSuggestion } from "./store.js";

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

describe("pending edits", () => {
  beforeEach(() => {
    localStorageMock.clear();
  });

  it("returns empty array when no pending edits exist", () => {
    expect(loadPendingEdits()).toEqual([]);
  });

  it("saves and loads a pending edit", () => {
    const suggestion = { meaning: "test", reading: "ts", examples: ["ex1"] };
    savePendingEdit("字", suggestion, "alice");
    const edits = loadPendingEdits();
    expect(edits.length).toBe(1);
    expect(edits[0].char).toBe("字");
    expect(edits[0].author).toBe("alice");
    expect(edits[0].status).toBe("pending");
    expect(edits[0].suggestion).toEqual(suggestion);
  });

  it("replaces existing edit from same author for same character", () => {
    savePendingEdit("字", { meaning: "v1", reading: "ts", examples: ["ex"] }, "alice");
    savePendingEdit("字", { meaning: "v2", reading: "ts", examples: ["ex"] }, "alice");
    const edits = loadPendingEdits();
    expect(edits.length).toBe(1);
    expect(edits[0].suggestion.meaning).toBe("v2");
  });

  it("allows multiple edits from different authors for same character", () => {
    savePendingEdit("字", { meaning: "v1", reading: "ts", examples: ["ex"] }, "alice");
    savePendingEdit("字", { meaning: "v2", reading: "ts", examples: ["ex"] }, "bob");
    const edits = loadPendingEdits();
    expect(edits.length).toBe(2);
  });
});

describe("validateEdit", () => {
  it("rejects empty meaning", () => {
    const error = validateEdit({ meaning: "", reading: "ts", examples: ["ex"] });
    expect(error).toBe("Meaning cannot be empty");
  });

  it("rejects meaning > 100 chars", () => {
    const longMeaning = "a".repeat(101);
    const error = validateEdit({ meaning: longMeaning, reading: "ts", examples: ["ex"] });
    expect(error).toBe("Meaning too long (max 100 chars)");
  });

  it("rejects empty reading", () => {
    const error = validateEdit({ meaning: "test", reading: "", examples: ["ex"] });
    expect(error).toBe("Reading cannot be empty");
  });

  it("rejects reading > 50 chars", () => {
    const longReading = "a".repeat(51);
    const error = validateEdit({ meaning: "test", reading: longReading, examples: ["ex"] });
    expect(error).toBe("Reading too long (max 50 chars)");
  });

  it("rejects empty examples array", () => {
    const error = validateEdit({ meaning: "test", reading: "ts", examples: [] });
    expect(error).toBe("Examples cannot be empty");
  });

  it("rejects empty example string", () => {
    const error = validateEdit({ meaning: "test", reading: "ts", examples: ["ex1", "", "ex3"] });
    expect(error).toBe("Example cannot be empty");
  });

  it("accepts valid edit", () => {
    const error = validateEdit({ meaning: "test", reading: "ts", examples: ["ex1", "ex2"] });
    expect(error).toBeNull();
  });
});

describe("findConflicts", () => {
  it("returns empty array when no conflicts", () => {
    const edits = [
      { char: "字", suggestion: { meaning: "v1", reading: "ts", examples: ["ex"] }, author: "alice", timestamp: 100, status: "pending" },
      { char: "我", suggestion: { meaning: "v2", reading: "ws", examples: ["ex"] }, author: "bob", timestamp: 200, status: "pending" },
    ];
    expect(findConflicts(edits).length).toBe(0);
  });

  it("returns empty array when two edits are identical", () => {
    const suggestion = { meaning: "v1", reading: "ts", examples: ["ex"] };
    const edits = [
      { char: "字", suggestion, author: "alice", timestamp: 100, status: "pending" },
      { char: "字", suggestion, author: "bob", timestamp: 200, status: "pending" },
    ];
    expect(findConflicts(edits).length).toBe(0);
  });

  it("detects conflict on different meaning", () => {
    const edits = [
      { char: "字", suggestion: { meaning: "v1", reading: "ts", examples: ["ex"] }, author: "alice", timestamp: 100, status: "pending" },
      { char: "字", suggestion: { meaning: "v2", reading: "ts", examples: ["ex"] }, author: "bob", timestamp: 200, status: "pending" },
    ];
    const conflicts = findConflicts(edits);
    expect(conflicts.length).toBe(1);
    expect(conflicts[0].char).toBe("字");
  });

  it("detects conflict on different reading", () => {
    const edits = [
      { char: "字", suggestion: { meaning: "v1", reading: "ts1", examples: ["ex"] }, author: "alice", timestamp: 100, status: "pending" },
      { char: "字", suggestion: { meaning: "v1", reading: "ts2", examples: ["ex"] }, author: "bob", timestamp: 200, status: "pending" },
    ];
    expect(findConflicts(edits).length).toBe(1);
  });

  it("detects conflict on different examples", () => {
    const edits = [
      { char: "字", suggestion: { meaning: "v1", reading: "ts", examples: ["ex1"] }, author: "alice", timestamp: 100, status: "pending" },
      { char: "字", suggestion: { meaning: "v1", reading: "ts", examples: ["ex2"] }, author: "bob", timestamp: 200, status: "pending" },
    ];
    expect(findConflicts(edits).length).toBe(1);
  });
});

describe("approveSuggestion", () => {
  it("marks suggestion as approved", () => {
    savePendingEdit("字", { meaning: "v1", reading: "ts", examples: ["ex"] }, "alice");
    approveSuggestion(0);
    const edits = loadPendingEdits();
    expect(edits[0].status).toBe("approved");
  });
});

describe("rejectSuggestion", () => {
  it("removes a suggestion", () => {
    savePendingEdit("字", { meaning: "v1", reading: "ts", examples: ["ex"] }, "alice");
    savePendingEdit("我", { meaning: "v2", reading: "ws", examples: ["ex"] }, "bob");
    rejectSuggestion(0);
    const edits = loadPendingEdits();
    expect(edits.length).toBe(1);
    expect(edits[0].char).toBe("我");
  });
});
