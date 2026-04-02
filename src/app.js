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
let isWritingMode = false;

// ── Canvas state ──────────────────────────────────────────────────────────────

let isDrawing = false;
let strokeDistance = 0;
let lastX = 0;
let lastY = 0;
let pauseTimer = null;
let canvasCtx = null;

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
  const state = cardStates[card.char];
  const writingCount = state?.writingCount ?? 0;
  const isNew = (state?.repetitions ?? 0) === 0;

  if (isNew && writingCount < 10) {
    isWritingMode = true;
    renderWritingCard(card, writingCount);
    return;
  }
  isWritingMode = false;

  document.getElementById("writing-area").classList.add("hidden");

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

function renderWritingCard(card, writingCount) {
  // Hide flip card elements
  document.getElementById("card-front").classList.add("hidden");
  document.getElementById("card-back").classList.add("hidden");
  document.getElementById("rating-row").classList.add("hidden");
  document.getElementById("flip-hint").classList.add("hidden");

  // Show writing area
  const writingArea = document.getElementById("writing-area");
  writingArea.classList.remove("hidden");

  // Populate content
  document.getElementById("writing-card-number").textContent =
    `#${characters.findIndex((c) => c.char === card.char) + 1}`;
  document.getElementById("writing-char").textContent = card.char;
  document.getElementById("writing-reading").textContent = card.reading || "—";
  document.getElementById("writing-meaning").textContent = card.meaning || "—";

  const exEl = document.getElementById("writing-examples");
  if (card.examples && card.examples.length > 0) {
    exEl.textContent = card.examples.join(" · ");
    exEl.style.display = "";
  } else {
    exEl.style.display = "none";
  }

  // Update progress
  updateWritingProgress(writingCount);

  // Reset and init canvas
  initCanvas();
}

function initCanvas() {
  const canvas = document.getElementById("writing-canvas");
  const dpr = window.devicePixelRatio || 1;
  const size = canvas.offsetWidth || 300;

  canvas.width = size * dpr;
  canvas.height = size * dpr;

  canvasCtx = canvas.getContext("2d");
  canvasCtx.scale(dpr, dpr);
  canvasCtx.lineWidth = 4;
  canvasCtx.strokeStyle = "#1a1a1a";
  canvasCtx.lineCap = "round";
  canvasCtx.lineJoin = "round";
  canvasCtx.clearRect(0, 0, size, size);

  // Clear any pending pause timer
  if (pauseTimer) {
    clearTimeout(pauseTimer);
    pauseTimer = null;
  }
  isDrawing = false;
  strokeDistance = 0;
}

function updateWritingProgress(count) {
  document.getElementById("writing-count").textContent = `${count} / 10`;
  document.getElementById("writing-progress-fill").style.width = `${count * 10}%`;
}

function handleWritingComplete() {
  const card = queue[currentIndex];
  const currentState = cardStates[card.char];
  const newState = updateCard(currentState, 3); // "Good" — enters SM-2
  cardStates[card.char] = newState;
  saveState(cardStates);
  currentIndex++;
  isWritingMode = false;
  renderProgress();
  renderCard();
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
        if (isWritingMode) return;
        flipCard();
        break;
      case "1": if (!isWritingMode) rateCard(1); break;
      case "2": if (!isWritingMode) rateCard(2); break;
      case "3": if (!isWritingMode) rateCard(3); break;
      case "4": if (!isWritingMode) rateCard(4); break;
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

  // Writing canvas events (initialized once, guarded by isWritingMode)
  const canvas = document.getElementById("writing-canvas");

  canvas.addEventListener("pointerdown", (e) => {
    if (!isWritingMode || e.isPrimary === false) return;
    e.preventDefault();
    if (pauseTimer) { clearTimeout(pauseTimer); pauseTimer = null; }
    isDrawing = true;
    strokeDistance = 0;
    const rect = canvas.getBoundingClientRect();
    lastX = e.clientX - rect.left;
    lastY = e.clientY - rect.top;
    canvasCtx.beginPath();
    canvasCtx.moveTo(lastX, lastY);
  });

  canvas.addEventListener("pointermove", (e) => {
    if (!isWritingMode || !isDrawing || e.isPrimary === false) return;
    e.preventDefault();
    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const dx = x - lastX;
    const dy = y - lastY;
    strokeDistance += Math.sqrt(dx * dx + dy * dy);
    canvasCtx.beginPath();
    canvasCtx.moveTo(lastX, lastY);
    canvasCtx.lineTo(x, y);
    canvasCtx.stroke();
    lastX = x;
    lastY = y;
  });

  canvas.addEventListener("pointerup", (e) => {
    if (!isWritingMode || e.isPrimary === false) return;
    isDrawing = false;
    if (strokeDistance < 30) return; // ignore accidental taps
    pauseTimer = setTimeout(() => {
      pauseTimer = null;
      const card = queue[currentIndex];
      const newCount = (cardStates[card.char]?.writingCount ?? 0) + 1;
      cardStates[card.char] = { ...cardStates[card.char], writingCount: newCount };
      saveState(cardStates); // persist per-count

      // Flash success
      canvas.classList.add("flash-success");
      setTimeout(() => canvas.classList.remove("flash-success"), 300);

      // Clear canvas for next attempt
      const size = canvas.offsetWidth || 300;
      canvasCtx.clearRect(0, 0, size, size);

      updateWritingProgress(newCount);

      if (newCount >= 10) {
        handleWritingComplete();
      }
    }, 1000);
  });

  canvas.addEventListener("pointerleave", (e) => {
    if (!isWritingMode) return;
    isDrawing = false;
  });
}

// ── Start ─────────────────────────────────────────────────────────────────────

init();
