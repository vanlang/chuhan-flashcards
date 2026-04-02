/**
 * store.js — Persist SM-2 card states to localStorage
 *
 * Storage key: "chuhan_states"
 * Format: JSON object mapping char → SM-2 state
 *
 * Handles:
 *   - Empty localStorage (first visit) → returns {}
 *   - Corrupted JSON → returns {} without crashing
 *   - localStorage full (QuotaExceededError) → logs warning, does not crash
 */

const STORAGE_KEY = "chuhan_states";
const SETTINGS_KEY = "chuhan_settings";

const DEFAULT_SETTINGS = {
  dailyNewLimit: 10,
};

// ── Card states ───────────────────────────────────────────────────────────────

/**
 * Load all card states from localStorage.
 * @returns {object} map of char → SM-2 state
 */
export function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    return JSON.parse(raw);
  } catch {
    console.warn("[store] Failed to parse card states — resetting to empty.");
    return {};
  }
}

/**
 * Save all card states to localStorage.
 * @param {object} state — map of char → SM-2 state
 */
export function saveState(state) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch (err) {
    if (err.name === "QuotaExceededError") {
      console.warn("[store] localStorage full — card state not saved.");
    } else {
      console.warn("[store] Failed to save card states:", err);
    }
  }
}

/**
 * Update a single card's state and persist.
 */
export function updateCardState(char, newCardState) {
  const states = loadState();
  states[char] = newCardState;
  saveState(states);
  return states;
}

// ── Settings ──────────────────────────────────────────────────────────────────

export function loadSettings() {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (!raw) return { ...DEFAULT_SETTINGS };
    return { ...DEFAULT_SETTINGS, ...JSON.parse(raw) };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export function saveSettings(settings) {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  } catch (err) {
    console.warn("[store] Failed to save settings:", err);
  }
}

// ── Export / Import ───────────────────────────────────────────────────────────

/**
 * Export all progress as a downloadable JSON file.
 */
export function exportProgress() {
  const states = loadState();
  const settings = loadSettings();
  const payload = JSON.stringify({ states, settings, exportedAt: Date.now() }, null, 2);
  const blob = new Blob([payload], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `chuhan-progress-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

/**
 * Import progress from a JSON file selected by the user.
 * Returns a promise that resolves when import is complete.
 */
export function importProgress() {
  return new Promise((resolve, reject) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".json";
    input.onchange = (e) => {
      const file = e.target.files[0];
      if (!file) return reject(new Error("No file selected"));
      const reader = new FileReader();
      reader.onload = (ev) => {
        try {
          const data = JSON.parse(ev.target.result);
          if (data.states) saveState(data.states);
          if (data.settings) saveSettings(data.settings);
          resolve(data);
        } catch {
          reject(new Error("Invalid progress file"));
        }
      };
      reader.readAsText(file);
    };
    input.click();
  });
}

// ── Pending Edits (Dictionary Collaboration) ────────────────────────────────────

const PENDING_EDITS_KEY = "chuhan_pending_edits";

/**
 * Load all pending edits from localStorage.
 * @returns {Array} array of pending edit objects
 */
export function loadPendingEdits() {
  try {
    const raw = localStorage.getItem(PENDING_EDITS_KEY);
    if (!raw) return [];
    return JSON.parse(raw);
  } catch {
    console.warn("[store] Failed to parse pending edits — resetting to empty.");
    return [];
  }
}

/**
 * Save a new pending edit to localStorage.
 * If the same character already has a pending edit by this author, replace it.
 * @param {string} char — the character being edited
 * @param {object} suggestion — { meaning, reading, examples[] }
 * @param {string} author — who suggested this (user name or "anonymous")
 */
export function savePendingEdit(char, suggestion, author) {
  try {
    const edits = loadPendingEdits();
    const timestamp = Date.now();

    // Replace existing edit for this char by this author, or append
    const existingIndex = edits.findIndex(e => e.char === char && e.author === author);
    const newEdit = { char, suggestion, author, timestamp, status: "pending" };

    if (existingIndex >= 0) {
      edits[existingIndex] = newEdit;
    } else {
      edits.push(newEdit);
    }

    localStorage.setItem(PENDING_EDITS_KEY, JSON.stringify(edits));
  } catch (err) {
    if (err.name === "QuotaExceededError") {
      console.warn("[store] localStorage full — pending edit not saved.");
    } else {
      console.warn("[store] Failed to save pending edit:", err);
    }
  }
}

/**
 * Validate a suggestion before saving.
 * @param {object} suggestion — { meaning, reading, examples[] }
 * @returns {string|null} error message, or null if valid
 */
export function validateEdit(suggestion) {
  const { meaning, reading, examples } = suggestion;

  if (!meaning || meaning.trim() === "") {
    return "Meaning cannot be empty";
  }
  if (meaning.length > 100) {
    return "Meaning too long (max 100 chars)";
  }

  if (!reading || reading.trim() === "") {
    return "Reading cannot be empty";
  }
  if (reading.length > 50) {
    return "Reading too long (max 50 chars)";
  }

  if (!Array.isArray(examples)) {
    return "Examples must be an array";
  }

  return null;
}

/**
 * Mark a pending edit as approved.
 * @param {number} index — index in pending edits array
 */
export function approveSuggestion(index) {
  try {
    const edits = loadPendingEdits();
    if (index >= 0 && index < edits.length) {
      edits[index].status = "approved";
      localStorage.setItem(PENDING_EDITS_KEY, JSON.stringify(edits));
    }
  } catch (err) {
    console.warn("[store] Failed to approve suggestion:", err);
  }
}

/**
 * Remove a pending edit (reject it).
 * @param {number} index — index in pending edits array
 */
export function rejectSuggestion(index) {
  try {
    const edits = loadPendingEdits();
    if (index >= 0 && index < edits.length) {
      edits.splice(index, 1);
      localStorage.setItem(PENDING_EDITS_KEY, JSON.stringify(edits));
    }
  } catch (err) {
    console.warn("[store] Failed to reject suggestion:", err);
  }
}

/**
 * Find conflicts in pending edits.
 * A conflict occurs when two edits exist for the same character with different suggestions.
 * @param {Array} pendingEdits — from loadPendingEdits()
 * @returns {Array} array of conflicts: { char, edits[] }
 */
export function findConflicts(pendingEdits) {
  const grouped = {};

  pendingEdits.forEach((edit, idx) => {
    if (!grouped[edit.char]) {
      grouped[edit.char] = [];
    }
    grouped[edit.char].push({ ...edit, index: idx });
  });

  const conflicts = [];
  for (const [char, edits] of Object.entries(grouped)) {
    if (edits.length > 1) {
      // Check if suggestions differ
      const firstSuggestion = edits[0].suggestion;
      const hasDifference = edits.some(e =>
        e.suggestion.meaning !== firstSuggestion.meaning ||
        e.suggestion.reading !== firstSuggestion.reading ||
        e.suggestion.examples.join("·") !== firstSuggestion.examples.join("·")
      );

      if (hasDifference) {
        conflicts.push({ char, edits });
      }
    }
  }

  return conflicts;
}

/**
 * Clear all approved edits from pending queue after export.
 */
export function clearApprovedEdits() {
  try {
    const edits = loadPendingEdits();
    const remaining = edits.filter(e => e.status !== "approved");
    localStorage.setItem(PENDING_EDITS_KEY, JSON.stringify(remaining));
  } catch (err) {
    console.warn("[store] Failed to clear approved edits:", err);
  }
}
