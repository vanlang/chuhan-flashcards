import { describe, it, expect } from "vitest";
import { updateCard, newCardState, BUTTON_TO_QUALITY } from "./sm2.js";

// Fixed timestamp for deterministic tests
const NOW = 1000000000000;
const DAY = 24 * 60 * 60 * 1000;

describe("BUTTON_TO_QUALITY mapping", () => {
  it("maps buttons 1-4 to SM-2 quality values", () => {
    expect(BUTTON_TO_QUALITY[1]).toBe(1);
    expect(BUTTON_TO_QUALITY[2]).toBe(2);
    expect(BUTTON_TO_QUALITY[3]).toBe(4);
    expect(BUTTON_TO_QUALITY[4]).toBe(5);
  });
});

describe("newCardState", () => {
  it("returns zero-state for a new card", () => {
    const s = newCardState();
    expect(s.interval).toBe(0);
    expect(s.repetitions).toBe(0);
    expect(s.easeFactor).toBe(2.5);
    expect(s.nextReview).toBe(0);
  });

  it("includes writingCount: 0", () => {
    expect(newCardState().writingCount).toBe(0);
  });
});

describe("updateCard — invalid button", () => {
  it("throws on unknown button", () => {
    expect(() => updateCard(newCardState(), 5, NOW)).toThrow();
    expect(() => updateCard(newCardState(), 0, NOW)).toThrow();
  });
});

describe("updateCard — first review (repetitions = 0)", () => {
  it("button 4 (Dễ): interval=1, repetitions=1, EF increases", () => {
    const s = updateCard(newCardState(), 4, NOW);
    expect(s.interval).toBe(1);
    expect(s.repetitions).toBe(1);
    expect(s.easeFactor).toBeGreaterThan(2.5);
    expect(s.nextReview).toBe(NOW + DAY);
  });

  it("button 3 (Ổn): interval=1, repetitions=1, EF unchanged", () => {
    const s = updateCard(newCardState(), 3, NOW);
    expect(s.interval).toBe(1);
    expect(s.repetitions).toBe(1);
    expect(s.easeFactor).toBeCloseTo(2.5, 5);
    expect(s.nextReview).toBe(NOW + DAY);
  });

  it("button 2 (Khó): interval=1, repetitions=0 (reset), EF decreases", () => {
    const s = updateCard(newCardState(), 2, NOW);
    expect(s.interval).toBe(1);
    expect(s.repetitions).toBe(0);
    expect(s.easeFactor).toBeLessThan(2.5);
  });

  it("button 1 (Lại): interval=1, repetitions=0 (reset)", () => {
    const s = updateCard(newCardState(), 1, NOW);
    expect(s.interval).toBe(1);
    expect(s.repetitions).toBe(0);
  });
});

describe("updateCard — second review (repetitions = 1)", () => {
  it("button 4 after first success: interval=6", () => {
    const after1 = updateCard(newCardState(), 4, NOW);
    const after2 = updateCard(after1, 4, NOW + DAY);
    expect(after2.interval).toBe(6);
    expect(after2.repetitions).toBe(2);
  });
});

describe("updateCard — third+ review (repetitions >= 2)", () => {
  it("interval = previous interval × EF (rounded)", () => {
    let s = newCardState();
    s = updateCard(s, 4, NOW);              // interval=1, reps=1
    s = updateCard(s, 4, NOW + DAY);       // interval=6, reps=2
    const prevInterval = s.interval;
    const prevEF = s.easeFactor;
    s = updateCard(s, 4, NOW + 7 * DAY);   // interval = 6 × EF
    expect(s.interval).toBe(Math.round(prevInterval * prevEF));
    expect(s.repetitions).toBe(3);
  });
});

describe("updateCard — ease factor floor", () => {
  it("EF never drops below 1.3 even after many failures", () => {
    let s = newCardState();
    for (let i = 0; i < 30; i++) {
      s = updateCard(s, 1, NOW + i * DAY);
    }
    expect(s.easeFactor).toBeGreaterThanOrEqual(1.3);
  });
});

describe("updateCard — nextReview timestamp", () => {
  it("nextReview = now + interval × 86400000", () => {
    const s = updateCard(newCardState(), 4, NOW);
    expect(s.nextReview).toBe(NOW + 1 * DAY);
  });
});

describe("updateCard — immutability", () => {
  it("does not mutate the original state", () => {
    const original = newCardState();
    updateCard(original, 4, NOW);
    expect(original.repetitions).toBe(0);
    expect(original.interval).toBe(0);
  });
});
