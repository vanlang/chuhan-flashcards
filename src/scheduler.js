/**
 * scheduler.js — Build and manage the study queue
 *
 * Queue order: all due reviews first (oldest first), then new cards (PDF order)
 * up to the daily new-card limit.
 *
 *                    characters.json (PDF order)
 *                           │
 *              ┌────────────┴────────────┐
 *              ▼                         ▼
 *        Due reviews               New cards
 *     (nextReview ≤ now)       (never seen before)
 *        sorted by              up to dailyLimit
 *        nextReview asc
 *              │                         │
 *              └─────────┬───────────────┘
 *                        ▼
 *                  today's queue
 */

/**
 * Build today's study queue.
 *
 * @param {Array}  cards       — full characters array (from characters.json)
 * @param {object} states      — map of char → SM-2 state (from store.loadState())
 * @param {number} dailyLimit  — max new cards to introduce today
 * @param {number} now         — current timestamp in ms (default: Date.now())
 * @returns {Array}            — ordered array of card objects to study
 */
export function buildQueue(cards, states, dailyLimit, now = Date.now()) {
  if (!cards || cards.length === 0) return [];
  if (dailyLimit === 0) {
    // Still show due reviews even if new card limit is 0
    return getDueReviews(cards, states, now);
  }

  const dueReviews = getDueReviews(cards, states, now);
  const newCards = getNewCards(cards, states, dailyLimit);

  return [...dueReviews, ...newCards];
}

/**
 * Returns cards that are due for review, sorted by nextReview ascending
 * (most overdue first).
 */
function getDueReviews(cards, states, now) {
  return cards
    .filter((card) => {
      const state = states[card.char];
      return state && state.repetitions > 0 && state.nextReview <= now;
    })
    .sort((a, b) => states[a.char].nextReview - states[b.char].nextReview);
}

/**
 * Returns new (never-reviewed) cards in PDF order, up to dailyLimit.
 */
function getNewCards(cards, states, limit) {
  const newCards = cards.filter((card) => {
    const state = states[card.char];
    return !state || state.repetitions === 0;
  });
  return newCards.slice(0, limit);
}

/**
 * Check if a card is due for review.
 */
export function isDue(state, now = Date.now()) {
  if (!state) return false;
  return state.nextReview <= now;
}

/**
 * Count stats for progress display.
 */
export function getStats(cards, states, now = Date.now()) {
  let learned = 0;
  let due = 0;
  let newCount = 0;

  for (const card of cards) {
    const state = states[card.char];
    if (!state || state.repetitions === 0) {
      newCount++;
    } else if (state.nextReview <= now) {
      due++;
      learned++;
    } else {
      learned++;
    }
  }

  return { total: cards.length, learned, due, newCount };
}
