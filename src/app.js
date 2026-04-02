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
  loadPendingEdits,
  savePendingEdit,
  validateEdit,
  clearApprovedEdits,
  approveSuggestion,
  rejectSuggestion,
  findConflicts,
} from "./store.js";

// ── State ─────────────────────────────────────────────────────────────────────

let characters = [];   // full deck from characters.json
let queue = [];        // today's study queue
let currentIndex = 0;
let isFlipped = false;
let cardStates = {};
let settings = {};
let isWritingMode = false;
let pendingEdits = [];  // collaborative editing queue
let collaboratorName = null; // author name for this session
let currentContextChar = null; // char being edited via context menu

// ── HanziWriter instance ──────────────────────────────────────────────────────

let writer = null;

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
  pendingEdits = loadPendingEdits();

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
  updatePendingBadge();
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

  // Start guided stroke-order quiz
  startQuiz(card);
}

function startQuiz(card) {
  const target = document.getElementById("hz-target");
  target.innerHTML = "";

  if (writer) {
    try { writer.cancelQuiz(); } catch (_) {}
    writer = null;
  }

  writer = HanziWriter.create("hz-target", card.char, {
    width: 280,
    height: 280,
    padding: 10,
    showCharacter: true,
    showOutline: true,
    strokeColor: "#555555",
    outlineColor: "#dddddd",
    highlightColor: "#22c55e",
    drawingColor: "#111111",
    drawingWidth: 4,
    strokeAnimationSpeed: 1,
    delayBetweenStrokes: 300,
    charDataLoader(char, onLoad, onError) {
      fetch(`https://cdn.jsdelivr.net/npm/hanzi-writer-data@2.0/${char}.json`)
        .then((r) => { if (!r.ok) throw new Error(r.status); return r.json(); })
        .then(onLoad)
        .catch((err) => {
          console.warn(`HanziWriter: no data for "${char}", skipping writing mode`);
          // Fallback: auto-complete writing for this card
          handleWritingComplete();
        });
    },
  });

  writer.quiz({
    onMistake() {},        // HanziWriter flashes red automatically
    onCorrectStroke() {},  // HanziWriter flashes green automatically
    onComplete() {
      const newCount = (cardStates[card.char]?.writingCount ?? 0) + 1;
      cardStates[card.char] = { ...cardStates[card.char], writingCount: newCount };
      saveState(cardStates);
      updateWritingProgress(newCount);

      if (newCount >= 10) {
        handleWritingComplete();
      } else {
        setTimeout(() => startQuiz(card), 600);
      }
    },
  });
}

function updateWritingProgress(count) {
  document.getElementById("writing-count").textContent = `${count} / 10`;
  document.getElementById("writing-progress-fill").style.width = `${count * 10}%`;
}

function handleWritingComplete() {
  // Mark writing as complete so renderCard() won't re-enter writing mode
  const card = queue[currentIndex];
  if (card) {
    cardStates[card.char] = { ...cardStates[card.char], writingCount: 10 };
    saveState(cardStates);
  }
  isWritingMode = false;
  renderCard();
  flipCard();  // Auto-flip to study side (meaning/reading visible)
}

function flipCard() {
  isFlipped = !isFlipped;

  if (isFlipped) {
    document.getElementById("card-front").classList.add("hidden");
    document.getElementById("card-back").classList.remove("hidden");
    document.getElementById("rating-row").classList.remove("hidden");
    document.getElementById("flip-hint").classList.add("hidden");
  } else {
    document.getElementById("card-front").classList.remove("hidden");
    document.getElementById("card-back").classList.add("hidden");
    document.getElementById("rating-row").classList.add("hidden");
    document.getElementById("flip-hint").classList.remove("hidden");
  }
}

function renderSessionComplete() {
  document.getElementById("study-area").classList.add("hidden");
  document.getElementById("complete-screen").classList.remove("hidden");
  renderProgress();
}

// ── Pending Edits (Collaboration) ─────────────────────────────────────────────

function updatePendingBadge() {
  const pending = pendingEdits.filter(e => e.status === "pending").length;
  const badgeBtn = document.getElementById("btn-pending");
  if (pending > 0) {
    badgeBtn.style.display = "";
    document.getElementById("pending-count").textContent = pending;
  } else {
    badgeBtn.style.display = "none";
  }
}

function showToast(message) {
  // Simple toast notification
  const existing = document.querySelector(".toast");
  if (existing) existing.remove();

  const toast = document.createElement("div");
  toast.className = "toast";
  toast.textContent = message;
  document.body.appendChild(toast);

  setTimeout(() => toast.remove(), 2000);
}

function showContextMenu(e, char) {
  e.preventDefault();
  if (isWritingMode) return;

  currentContextChar = char;
  const menu = document.getElementById("context-menu");
  menu.style.left = e.clientX + "px";
  menu.style.top = e.clientY + "px";
  menu.classList.remove("hidden");
}

function closeContextMenu() {
  document.getElementById("context-menu").classList.add("hidden");
}

function showEditModal(char) {
  if (!collaboratorName) {
    // First time: ask for name, default to "anonymous" if blank
    const name = prompt("Bạn là ai? (tên hoặc email)") || "anonymous";
    collaboratorName = name;
    sessionStorage.setItem("collaboratorName", name);
  }

  const card = characters.find(c => c.char === char);
  if (!card) return;

  const modal = document.getElementById("edit-modal");
  const form = document.getElementById("edit-form");

  // Pre-fill with current card data
  form.elements["meaning"].value = card.meaning || "";
  form.elements["reading"].value = card.reading || "";
  form.elements["examples"].value = (card.examples || []).join(" · ");

  // Store char for form submission
  form.dataset.char = char;

  modal.showModal();
}

function handleEditSubmit(e) {
  e.preventDefault();
  const form = e.target;
  const char = form.dataset.char;

  const suggestion = {
    meaning: form.elements["meaning"].value.trim(),
    reading: form.elements["reading"].value.trim(),
    examples: form.elements["examples"].value.split(" · ").map(s => s.trim()).filter(s => s),
  };

  const error = validateEdit(suggestion);
  if (error) {
    showToast(`❌ ${error}`);
    return; // form stays open
  }

  // Use stored collaborator name or fall back to "you"
  const author = collaboratorName || "you";
  savePendingEdit(char, suggestion, author);
  pendingEdits = loadPendingEdits();

  showToast("✓ Gợi ý sửa được lưu");
  document.getElementById("edit-modal").close();
  updatePendingBadge();
}

function showMergeView() {
  pendingEdits = loadPendingEdits();
  const panel = document.getElementById("merge-panel");
  const container = document.getElementById("edit-list");
  const summary = document.getElementById("merge-summary");

  // Count pending
  const pendingCount = pendingEdits.filter(e => e.status === "pending").length;
  const approvedCount = pendingEdits.filter(e => e.status === "approved").length;

  summary.textContent = `${pendingCount} đang chờ · ${approvedCount} đã chọn`;

  if (pendingEdits.length === 0) {
    container.innerHTML = "<div class='no-edits'>Không có gợi ý nào.</div>";
    panel.showModal();
    return;
  }

  // Find conflicts
  const conflicts = findConflicts(pendingEdits);
  const conflictChars = new Set(conflicts.map(c => c.char));

  // Render each edit
  container.innerHTML = pendingEdits
    .map((edit, idx) => renderEditRow(edit, idx, conflictChars.has(edit.char)))
    .join("");

  // Attach event listeners
  document.querySelectorAll(".edit-approve").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      const idx = Number(e.target.dataset.index);
      handleApprove(idx);
    });
  });

  document.querySelectorAll(".edit-reject").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      const idx = Number(e.target.dataset.index);
      handleReject(idx);
    });
  });

  panel.showModal();
}

function renderEditRow(edit, index, isConflict) {
  const card = characters.find(c => c.char === edit.char);
  if (!card) return ""; // skip if character not found

  const statusClass = edit.status === "approved" ? "approved" : "pending";
  const conflictBadge = isConflict ? `<span class="conflict-badge">⚠ CONFLICT</span>` : "";

  return `
    <div class="edit-row ${statusClass}" data-index="${index}">
      <div class="edit-header">
        <span class="edit-char">${edit.char}</span>
        ${conflictBadge}
        <span class="edit-author">${edit.author}</span>
        <span class="edit-time">${formatTime(edit.timestamp)}</span>
      </div>
      <div class="edit-diff">
        <div class="diff-field">
          <span class="label">Nghĩa:</span>
          <span class="old">${card.meaning || "—"}</span>
          <span class="arrow">→</span>
          <span class="new">${edit.suggestion.meaning}</span>
        </div>
        <div class="diff-field">
          <span class="label">Phát âm:</span>
          <span class="old">${card.reading || "—"}</span>
          <span class="arrow">→</span>
          <span class="new">${edit.suggestion.reading}</span>
        </div>
        <div class="diff-field">
          <span class="label">Ví dụ:</span>
          <span class="old">${(card.examples || []).join(" · ") || "—"}</span>
          <span class="arrow">→</span>
          <span class="new">${edit.suggestion.examples.join(" · ")}</span>
        </div>
      </div>
      <div class="edit-actions">
        <button class="btn-small edit-approve" data-index="${index}" ${edit.status === "approved" ? "disabled" : ""}>
          ✓ Chọn
        </button>
        <button class="btn-small edit-reject" data-index="${index}" ${edit.status === "rejected" ? "disabled" : ""}>
          ✗ Từ chối
        </button>
      </div>
    </div>
  `;
}

function formatTime(timestamp) {
  const now = Date.now();
  const diff = now - timestamp;
  const mins = Math.floor(diff / 60000);
  const hours = Math.floor(diff / 3600000);
  const days = Math.floor(diff / 86400000);

  if (mins < 1) return "vừa xong";
  if (mins < 60) return `${mins}m trước`;
  if (hours < 24) return `${hours}h trước`;
  if (days < 7) return `${days}d trước`;
  return new Date(timestamp).toLocaleDateString("vi-VN");
}

function handleApprove(index) {
  approveSuggestion(index);
  pendingEdits = loadPendingEdits();
  showMergeView(); // refresh view
}

function handleReject(index) {
  rejectSuggestion(index);
  pendingEdits = loadPendingEdits();
  updatePendingBadge();
  showMergeView(); // refresh view
}

function handleExport() {
  // Collect approved edits
  const approvedEdits = pendingEdits.filter(e => e.status === "approved");
  if (approvedEdits.length === 0) {
    showToast("❌ Không có gợi ý nào được chọn để xuất.");
    return;
  }

  // Show export preview
  showExportPreview(approvedEdits);
}

function showExportPreview(approvedEdits) {
  const preview = document.getElementById("export-preview");
  const summary = document.getElementById("preview-summary");
  const changes = document.getElementById("preview-changes");

  // Summary
  summary.innerHTML = `
    <div class="summary-stat">
      <span class="stat-label">Thẻ sẽ cập nhật:</span>
      <span class="stat-value">${approvedEdits.length}</span>
    </div>
  `;

  // List changes
  changes.innerHTML = approvedEdits
    .map(edit => {
      const card = characters.find(c => c.char === edit.char);
      if (!card) return "";
      return `
        <div class="change-item">
          <div class="change-char">${edit.char}</div>
          <div class="change-details">
            <div class="change-field">
              <span class="old">${card.meaning || "—"}</span>
              <span class="arrow">→</span>
              <span class="new">${edit.suggestion.meaning}</span>
            </div>
          </div>
        </div>
      `;
    })
    .join("");

  // Store approved edits for confirmation
  window._exportApprovedEdits = approvedEdits;

  // Show preview and close merge view
  document.getElementById("merge-panel").close();
  preview.showModal();
}

function confirmExport() {
  const approvedEdits = window._exportApprovedEdits || [];

  // Build merged characters.json
  const merged = JSON.parse(JSON.stringify(characters)); // deep clone
  approvedEdits.forEach(edit => {
    const char = merged.find(c => c.char === edit.char);
    if (char) {
      // Only apply the suggestion if the character still exists
      char.meaning = edit.suggestion.meaning;
      char.reading = edit.suggestion.reading;
      char.examples = edit.suggestion.examples;
    }
  });

  // Download as JSON
  const payload = JSON.stringify(merged, null, 2);
  const blob = new Blob([payload], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `characters-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  URL.revokeObjectURL(url);

  // Clear approved edits from pending
  clearApprovedEdits();
  pendingEdits = loadPendingEdits();

  showToast(`✓ Xuất ${approvedEdits.length} gợi ý`);
  document.getElementById("export-preview").close();
  updatePendingBadge();
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
  // Restore collaborator name from session storage
  const savedName = sessionStorage.getItem("collaboratorName");
  if (savedName) collaboratorName = savedName;

  // Card right-click for context menu
  document.getElementById("card-area").addEventListener("contextmenu", (e) => {
    const card = queue[currentIndex];
    if (card) showContextMenu(e, card.char);
  });

  // Card flip on left-click only (blocked in writing mode and right-click)
  document.getElementById("card-area").addEventListener("click", (e) => {
    if (e.button !== 0) return;  // ignore right-click / middle-click
    closeContextMenu();
    if (isWritingMode) return;
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

  // Skip writing practice button
  document.getElementById("btn-skip-writing")?.addEventListener("click", () => {
    handleWritingComplete();
  });

  // Restart session button
  document.getElementById("btn-restart")?.addEventListener("click", () => {
    queue = buildQueue(characters, cardStates, settings.dailyNewLimit);
    currentIndex = 0;
    document.getElementById("complete-screen").classList.add("hidden");
    document.getElementById("study-area").classList.remove("hidden");
    renderCard();
  });

  // Context menu buttons
  document.getElementById("context-edit").addEventListener("click", () => {
    if (currentContextChar) showEditModal(currentContextChar);
    closeContextMenu();
  });

  document.getElementById("context-flip").addEventListener("click", () => {
    flipCard();
    closeContextMenu();
  });

  document.getElementById("context-cancel").addEventListener("click", closeContextMenu);

  // Close context menu when clicking elsewhere
  document.addEventListener("click", (e) => {
    if (!e.target.closest("#context-menu")) closeContextMenu();
  });

  // Edit modal form submission
  document.getElementById("edit-form").addEventListener("submit", handleEditSubmit);

  // Edit modal close button
  document.querySelector(".modal-close").addEventListener("click", () => {
    document.getElementById("edit-modal").close();
  });

  // Pending badge button → show merge view
  document.getElementById("btn-pending").addEventListener("click", showMergeView);

  // Merge panel close button
  document.querySelector("#merge-panel .modal-close").addEventListener("click", () => {
    document.getElementById("merge-panel").close();
  });

  // Export button
  document.getElementById("export-btn").addEventListener("click", handleExport);

  // Clear rejected button (removes all rejected edits from view)
  document.getElementById("clear-rejected-btn").addEventListener("click", () => {
    pendingEdits = pendingEdits.filter(e => e.status !== "rejected");
    showMergeView(); // refresh
  });

  // Export preview close button
  document.querySelector("#export-preview .modal-close").addEventListener("click", () => {
    document.getElementById("export-preview").close();
  });

  // Confirm export button
  document.getElementById("confirm-export-btn").addEventListener("click", confirmExport);

}

// ── Start ─────────────────────────────────────────────────────────────────────

init();
