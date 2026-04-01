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
