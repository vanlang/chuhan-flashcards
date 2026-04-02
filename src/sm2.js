/**
 * sm2.js — Pure SM-2 spaced repetition algorithm
 *
 * SM-2 quality scale (mapped from UI buttons):
 *   Button "Lại"  (1) → quality 1 — complete blackout / incorrect
 *   Button "Khó"  (2) → quality 2 — incorrect but familiar
 *   Button "Ổn"   (3) → quality 4 — correct with difficulty
 *   Button "Dễ"   (4) → quality 5 — correct and easy
 *
 * State shape per card:
 *   { interval: number (days), easeFactor: number, repetitions: number, nextReview: number (ms timestamp), writingCount: number }
 */

export const BUTTON_TO_QUALITY = { 1: 1, 2: 2, 3: 4, 4: 5 };

const EASE_FACTOR_MIN = 1.3;
const EASE_FACTOR_DEFAULT = 2.5;

/**
 * Create initial state for a new (unseen) card.
 */
export function newCardState() {
  return {
    interval: 0,
    easeFactor: EASE_FACTOR_DEFAULT,
    repetitions: 0,
    nextReview: 0, // due immediately
    writingCount: 0,
  };
}

/**
 * Update card state after a review.
 *
 * @param {object} state  — current card state
 * @param {number} button — 1 | 2 | 3 | 4 (UI button pressed)
 * @param {number} now    — current timestamp in ms (default: Date.now())
 * @returns {object}      — new card state (immutable — original is not mutated)
 *
 * SM-2 interval rules:
 *   quality < 3 (buttons 1, 2) → reset: interval=1, repetitions=0
 *   repetitions === 0          → interval = 1 day
 *   repetitions === 1          → interval = 6 days
 *   repetitions >= 2           → interval = previous_interval × easeFactor
 *
 * Ease factor update (only when quality >= 3):
 *   EF' = EF + (0.1 - (5 - quality) × (0.08 + (5 - quality) × 0.02))
 *   Minimum EF = 1.3
 */
export function updateCard(state, button, now = Date.now()) {
  const quality = BUTTON_TO_QUALITY[button];
  if (quality === undefined) {
    throw new Error(`Invalid button: ${button}. Must be 1, 2, 3, or 4.`);
  }

  let { interval, easeFactor, repetitions } = state;

  if (quality < 3) {
    // Incorrect — reset progress
    interval = 1;
    repetitions = 0;
    // Ease factor decreases on failure
    easeFactor = Math.max(
      EASE_FACTOR_MIN,
      easeFactor + (0.1 - (5 - quality) * (0.08 + (5 - quality) * 0.02))
    );
  } else {
    // Correct — advance
    if (repetitions === 0) {
      interval = 1;
    } else if (repetitions === 1) {
      interval = 6;
    } else {
      interval = Math.round(interval * easeFactor);
    }
    repetitions += 1;

    // Update ease factor
    easeFactor = Math.max(
      EASE_FACTOR_MIN,
      easeFactor + (0.1 - (5 - quality) * (0.08 + (5 - quality) * 0.02))
    );
  }

  const nextReview = now + interval * 24 * 60 * 60 * 1000;

  return { interval, easeFactor, repetitions, nextReview };
}
