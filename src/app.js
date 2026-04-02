/**
 * app.js — Main study loop
 *
 * Flow:
 *   load characters.json
 *     → build today's queue (due reviews first, then new cards)
 *     → show card front (character only)
 *     → Space/tap → flip to back (reading + meaning + examples)
 *     → rate 1-4 → SM-2 updates → next card
 *     → queue empty → session-complete screen
 *
 * Keyboard:
 *   Space   — flip card
 *   1/2/3/4 — rate after flip
 *   ?       — toggle shortcut help
 */

import { updateCard, newCardState, BUTTON_TO_QUALITY } from "./sm2.js";
import { buildQueue, getStats } from "./scheduler.js";
import {
  loadState,
  saveState,
  loadSettings,
  saveSettings,
  exportProgress,
  importProgress,
} from "./store.js";

// ── State ─────────────────────────────────────────────────────────────────────

let characters = [];   // full deck from characters.json
let queue = [];        // today's study queue
let currentIndex = 0;
let isFlipped = false;
let cardStates = {};
let settings = {};

// ── Boot ──────────────────────────────────────────────────────────────────────

async function loadCharacters() {
  try {
    const res = await fetch("./data/characters.json");
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } catch (err) {
    document.body.innerHTML = `
      <div class="error-screen">
        <p>Không thể tải dữ liệu thẻ.</p>
        <p class="error-detail">${err.message}</p>
        <button onclick="location.reload()">Thử lại</button>
      </div>`;
    throw err;
  }
}

async function init() {
  characters = await loadCharacters();
  cardStates = loadState();
  settings = loadSettings();

  // Ensure all cards have at least an initial state entry
  for (const card of characters) {
    if (!cardStates[card.char]) {
      cardStates[card.char] = newCardState();
    }
  }

  queue = buildQueue(characters, cardStates, settings.dailyNewLimit);
  currentIndex = 0;
  isFlipped = false;

  renderProgress();
  renderCard();
  bindEvents();
}

// ── Rendering ─────────────────────────────────────────────────────────────────

function renderProgress() {
  const stats = getStats(characters, cardStates);
  const pct = Math.round((stats.learned / stats.total) * 100);

  document.getElementById("progress-fill").style.width = `${pct}%`;
  document.getElementById("progress-text").textContent =
    `${stats.learned} / ${stats.total} thẻ đã học`;
  document.getElementById("today-text").textContent =
    `Hôm nay: ${queue.length} thẻ`;
  document.getElementById("chip-new").textContent = `● ${stats.newCount} mới`;
  document.getElementById("chip-due").textContent = `● ${stats.due} ôn tập`;
}

function renderCard() {
  if (currentIndex >= queue.length) {
    renderSessionComplete();
    return;
  }

  const card = queue[currentIndex];
  isFlipped = false;

  document.getElementById("card-number").textContent =
    `#${characters.findIndex((c) => c.char === card.char) + 1}`;
  document.getElementById("card-char").textContent = card.char;
  document.getElementById("card-back-char").textContent = card.char;
  document.getElementById("card-reading").textContent = card.reading || "—";
  document.getElementById("card-meaning").textContent = card.meaning || "—";

  const examplesEl = document.getElementById("card-examples");
  if (card.examples && card.examples.length > 0) {
    examplesEl.textContent = card.examples.join(" · ");
    examplesEl.style.display = "";
  } else {
    examplesEl.style.display = "none";
  }

  // Show front, hide back and rating
  document.getElementById("card-front").classList.remove("hidden");
  document.getElementById("card-back").classList.add("hidden");
  document.getElementById("rating-row").classList.add("hidden");
  document.getElementById("flip-hint").classList.remove("hidden");
}

function flipCard() {
  if (isFlipped) return;
  isFlipped = true;

  document.getElementById("card-front").classList.add("hidden");
  document.getElementById("card-back").classList.remove("hidden");
  document.getElementById("rating-row").classList.remove("hidden");
  document.getElementById("flip-hint").classList.add("hidden");
}

function renderSessionComplete() {
  document.getElementById("study-area").classList.add("hidden");
  document.getElementById("complete-screen").classList.remove("hidden");
  renderProgress();
}

// ── Rating ────────────────────────────────────────────────────────────────────

function rateCard(button) {
  if (!isFlipped) return;

  const card = queue[currentIndex];
  const currentState = cardStates[card.char];
  const newState = updateCard(currentState, button);

  cardStates[card.char] = newState;
  saveState(cardStates);

  currentIndex++;
  renderProgress();
  renderCard();
}

// ── Events ────────────────────────────────────────────────────────────────────

function bindEvents() {
  // Card flip on click
  document.getElementById("card-area").addEventListener("click", (e) => {
    if (!e.target.closest("#rating-row")) flipCard();
  });

  // Rating buttons
  document.querySelectorAll(".rating-btn").forEach((btn) => {
    btn.addEventListener("click", () => rateCard(Number(btn.dataset.rating)));
  });

  // Keyboard shortcuts
  document.addEventListener("keydown", (e) => {
    if (e.target.tagName === "INPUT") return;
    switch (e.key) {
      case " ":
        e.preventDefault();
        flipCard();
        break;
      case "1": rateCard(1); break;
      case "2": rateCard(2); break;
      case "3": rateCard(3); break;
      case "4": rateCard(4); break;
      case "?":
        document.getElementById("shortcut-help").classList.toggle("hidden");
        break;
    }
  });

  // Settings panel toggle
  document.getElementById("btn-settings").addEventListener("click", () => {
    document.getElementById("settings-panel").classList.toggle("hidden");
  });

  // Help panel toggle
  document.getElementById("btn-help").addEventListener("click", () => {
    document.getElementById("shortcut-help").classList.toggle("hidden");
  });

  // Settings: daily limit
  document.getElementById("daily-limit-input").value = settings.dailyNewLimit;
  document.getElementById("daily-limit-input").addEventListener("change", (e) => {
    const val = Math.max(0, parseInt(e.target.value) || 0);
    settings.dailyNewLimit = val;
    saveSettings(settings);
  });

  // Export / Import
  document.getElementById("btn-export").addEventListener("click", exportProgress);
  document.getElementById("btn-import").addEventListener("click", () => {
    importProgress()
      .then(() => {
        cardStates = loadState();
        settings = loadSettings();
        queue = buildQueue(characters, cardStates, settings.dailyNewLimit);
        currentIndex = 0;
        renderProgress();
        renderCard();
      })
      .catch((err) => alert(`Import thất bại: ${err.message}`));
  });

  // Restart session button
  document.getElementById("btn-restart")?.addEventListener("click", () => {
    queue = buildQueue(characters, cardStates, settings.dailyNewLimit);
    currentIndex = 0;
    document.getElementById("complete-screen").classList.add("hidden");
    document.getElementById("study-area").classList.remove("hidden");
    renderCard();
  });
}

// ── Start ─────────────────────────────────────────────────────────────────────

init();
