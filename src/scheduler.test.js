import { describe, it, expect } from "vitest";
import { buildQueue, isDue, getStats } from "./scheduler.js";

const NOW = 1000000000000;
const DAY = 24 * 60 * 60 * 1000;

// Helper: make a card object
const card = (char) => ({ char, reading: "TEST", meaning: "test", examples: [] });

// Helper: make a "learned, due" state
const dueState = (interval = 1) => ({
  interval,
  easeFactor: 2.5,
  repetitions: 2,
  nextReview: NOW - DAY, // overdue
});

// Helper: make a "learned, not yet due" state
const futureState = () => ({
  interval: 6,
  easeFactor: 2.5,
  repetitions: 2,
  nextReview: NOW + 5 * DAY,
});

// Helper: new card state (never seen)
const newState = () => ({ interval: 0, easeFactor: 2.5, repetitions: 0, nextReview: 0 });

describe("buildQueue — all new cards", () => {
  it("returns up to dailyLimit new cards in PDF order", () => {
    const cards = ["天", "地", "人", "心", "月"].map(card);
    const states = {};
    cards.forEach((c) => (states[c.char] = newState()));

    const q = buildQueue(cards, states, 3, NOW);
    expect(q).toHaveLength(3);
    expect(q[0].char).toBe("天");
    expect(q[1].char).toBe("地");
    expect(q[2].char).toBe("人");
  });
});

describe("buildQueue — all due reviews", () => {
  it("returns all due cards, no new cards added", () => {
    const cards = ["天", "地", "人"].map(card);
    const states = {};
    cards.forEach((c) => (states[c.char] = dueState()));

    const q = buildQueue(cards, states, 10, NOW);
    expect(q).toHaveLength(3);
    // All should be the due cards (repetitions > 0)
    q.forEach((c) => expect(states[c.char].repetitions).toBeGreaterThan(0));
  });
});

describe("buildQueue — mixed: due reviews + new", () => {
  it("puts due reviews first, then fills with new up to limit", () => {
    const cards = ["天", "地", "人", "心", "月", "水"].map(card);
    const states = {
      "天": dueState(),
      "地": dueState(),
      "人": newState(),
      "心": newState(),
      "月": futureState(), // not due
      "水": newState(),
    };

    const q = buildQueue(cards, states, 3, NOW);
    // 2 due reviews + 2 new (limit=3 new, but only 3 new cards total — and we have 2 due)
    // due first: 天, 地 — then new up to 3: 人, 心, 水
    const dueChars = q.filter((c) => states[c.char].repetitions > 0).map((c) => c.char);
    const newChars = q.filter((c) => states[c.char].repetitions === 0).map((c) => c.char);
    expect(dueChars).toEqual(["天", "地"]);
    expect(newChars).toHaveLength(3);
    expect(newChars[0]).toBe("人"); // PDF order
  });
});

describe("buildQueue — empty deck", () => {
  it("returns empty array", () => {
    expect(buildQueue([], {}, 10, NOW)).toEqual([]);
  });
});

describe("buildQueue — dailyLimit = 0", () => {
  it("returns only due reviews, no new cards", () => {
    const cards = ["天", "地", "人"].map(card);
    const states = {
      "天": dueState(),
      "地": newState(),
      "人": newState(),
    };
    const q = buildQueue(cards, states, 0, NOW);
    expect(q).toHaveLength(1);
    expect(q[0].char).toBe("天");
  });
});

describe("isDue", () => {
  it("returns true when nextReview <= now", () => {
    expect(isDue({ nextReview: NOW - 1 }, NOW)).toBe(true);
    expect(isDue({ nextReview: NOW }, NOW)).toBe(true);
  });

  it("returns false when nextReview > now", () => {
    expect(isDue({ nextReview: NOW + 1 }, NOW)).toBe(false);
  });

  it("returns false for null/undefined state", () => {
    expect(isDue(null, NOW)).toBe(false);
    expect(isDue(undefined, NOW)).toBe(false);
  });
});

describe("getStats", () => {
  it("counts learned, due, and new correctly", () => {
    const cards = ["天", "地", "人", "心"].map(card);
    const states = {
      "天": dueState(),    // learned + due
      "地": futureState(), // learned, not due
      "人": newState(),    // new
      "心": newState(),    // new
    };
    const stats = getStats(cards, states, NOW);
    expect(stats.total).toBe(4);
    expect(stats.learned).toBe(2);
    expect(stats.due).toBe(1);
    expect(stats.newCount).toBe(2);
  });
});
