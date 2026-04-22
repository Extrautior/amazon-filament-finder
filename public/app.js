const button = document.getElementById("run-search");
const logoutButton = document.getElementById("logout-button");
const loginForm = document.getElementById("login-form");
const passwordInput = document.getElementById("password");
const statusEl = document.getElementById("status");
const resultsEl = document.getElementById("results");
const warningsEl = document.getElementById("warnings");
const metaEl = document.getElementById("meta");
const searchedAtEl = document.getElementById("searched-at");
const marketplaceEl = document.getElementById("marketplace");
const sessionStateEl = document.getElementById("session-state");
const exportCsvButton = document.getElementById("export-csv");
const exportJsonButton = document.getElementById("export-json");
const progressCardEl = document.getElementById("progress-card");
const progressFillEl = document.getElementById("progress-fill");
const progressLabelEl = document.getElementById("progress-label");
const progressPercentEl = document.getElementById("progress-percent");
const progressMetaEl = document.getElementById("progress-meta");

const MATERIALS = ["PLA", "PETG", "ABS", "TPU"];
let searchProgressTimer = null;

function money(value, currency) {
  if (value == null) {
    return "N/A";
  }
  const prefixCurrencies = new Set(["$", "€", "£", "₪"]);
  if (prefixCurrencies.has(currency)) {
    return `${currency}${value.toFixed(2)}`;
  }
  return `${value.toFixed(2)} ${currency}`;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function safeAmazonUrl(value) {
  try {
    const normalized = String(value || "").trim();
    const url = new URL(normalized, "https://www.amazon.com");
    const asinMatch = url.pathname.match(/\/(?:dp|gp\/product)\/([A-Z0-9]{10})/i);
    if (asinMatch) {
      return `https://www.amazon.com/dp/${asinMatch[1].toUpperCase()}`;
    }
    if (!/amazon\./i.test(url.hostname)) {
      return "https://www.amazon.com";
    }
    return url.toString();
  } catch {
    return "https://www.amazon.com";
  }
}

function shortNote(note) {
  const cleaned = (note || "").replace(/\s+/g, " ").trim();
  if (!cleaned) {
    return "Free shipping listing";
  }
  return cleaned.length > 140 ? `${cleaned.slice(0, 137)}...` : cleaned;
}

function safeImageUrl(value) {
  try {
    const url = new URL(String(value || "").trim());
    if (/^https?:$/i.test(url.protocol)) {
      return url.toString();
    }
    return "";
  } catch {
    return "";
  }
}

function setExportEnabled(enabled) {
  exportCsvButton.disabled = !enabled;
  exportJsonButton.disabled = !enabled;
}

function setLockedState(locked) {
  button.disabled = locked;
  exportCsvButton.disabled = locked || exportCsvButton.disabled;
  exportJsonButton.disabled = locked || exportJsonButton.disabled;
}

function stopSearchProgressPolling() {
  if (searchProgressTimer) {
    window.clearInterval(searchProgressTimer);
    searchProgressTimer = null;
  }
}

function renderSearchProgress(payload) {
  const percent = Math.max(0, Math.min(100, Number(payload.percent) || 0));
  progressCardEl.hidden = false;
  progressFillEl.style.width = `${percent}%`;
  progressPercentEl.textContent = `${Math.round(percent)}%`;
  progressLabelEl.textContent = payload.message || "Searching Amazon…";
  progressMetaEl.textContent = payload.activeMaterial
    ? `Currently working on ${payload.activeMaterial}.`
    : payload.running
      ? "Search is still active."
      : payload.phase === "complete"
        ? "The latest search finished."
        : "Waiting for the next search.";
}

async function refreshSearchProgress() {
  try {
    const response = await fetch("/api/search-status");
    if (response.status === 401) {
      stopSearchProgressPolling();
      progressCardEl.hidden = true;
      return;
    }

    const payload = await response.json();
    renderSearchProgress(payload);

    if (!payload.running) {
      stopSearchProgressPolling();
    }
  } catch {
    // Keep the existing UI state if the poll briefly fails.
  }
}

function startSearchProgressPolling() {
  stopSearchProgressPolling();
  void refreshSearchProgress();
  searchProgressTimer = window.setInterval(() => {
    void refreshSearchProgress();
  }, 1500);
}

function openDownload(url) {
  window.location.assign(url);
}

function cardForResult(item, index) {
  const amazonUrl = safeAmazonUrl(item.url);
  const imageUrl = safeImageUrl(item.imageUrl);
  return `
    <article class="result-card">
      <div class="result-top">
        <span class="result-rank">#${index + 1}</span>
        <span class="pill pill-free">Free shipping</span>
      </div>
      ${imageUrl ? `<div class="result-image-wrap"><img class="result-image" src="${escapeHtml(imageUrl)}" alt="${escapeHtml(item.title)}" loading="lazy" /></div>` : ""}
      <h3><a href="${escapeHtml(amazonUrl)}" target="_blank" rel="noreferrer">${escapeHtml(item.title)}</a></h3>
      <p class="result-note">${escapeHtml(shortNote(item.availabilityNote))}</p>
      <dl class="result-metrics">
        <div>
          <dt>Item</dt>
          <dd>${money(item.priceValue, item.currency)}</dd>
        </div>
        <div>
          <dt>Shipping</dt>
          <dd>${money(item.shippingValue, item.currency)}</dd>
        </div>
        <div>
          <dt>Import</dt>
          <dd>${money(item.importFeesValue, item.currency)}</dd>
        </div>
        <div>
          <dt>Total</dt>
          <dd>${money(item.totalValue, item.currency)}</dd>
        </div>
      </dl>
      <a class="open-link" href="${escapeHtml(amazonUrl)}" target="_blank" rel="noreferrer">Open on Amazon</a>
    </article>
  `;
}

function sectionForMaterial(material, items) {
  const cards = items.length
    ? items.map((item, index) => cardForResult(item, index)).join("")
    : `<p class="empty">No free-shipping ${material} results found.</p>`;

  return `
    <article class="material-card">
      <div class="material-header">
        <h2>${material}</h2>
        <span>${items.length} result${items.length === 1 ? "" : "s"}</span>
      </div>
      <div class="result-grid">
        ${cards}
      </div>
    </article>
  `;
}

function renderWarnings(warnings) {
  if (!warnings.length) {
    warningsEl.hidden = true;
    warningsEl.innerHTML = "";
    return;
  }

  warningsEl.hidden = false;
  warningsEl.innerHTML = `
    <h2>Warnings</h2>
    <ul>
      ${warnings.map((warning) => `<li>${escapeHtml(warning)}</li>`).join("")}
    </ul>
  `;
}

function renderResults(payload) {
  metaEl.hidden = false;
  searchedAtEl.textContent = new Date(payload.searchedAt).toLocaleString();
  marketplaceEl.textContent = payload.marketplace;
  resultsEl.innerHTML = MATERIALS.map((material) => sectionForMaterial(material, payload.resultsByMaterial[material] || [])).join("");
  renderWarnings(payload.warnings || []);
  setExportEnabled(true);
}

async function updateSessionState() {
  try {
    const response = await fetch("/admin/session-status");
    if (response.status === 401) {
      sessionStateEl.textContent = "Locked";
      loginForm.hidden = false;
      return false;
    }

    const payload = await response.json();
    sessionStateEl.textContent = payload.status;
    loginForm.hidden = true;
    if (payload.status !== "ready") {
      renderWarnings([payload.message]);
    }
    return true;
  } catch (error) {
    sessionStateEl.textContent = "Unknown";
    renderWarnings([error.message]);
    return false;
  }
}

async function login(password) {
  const response = await fetch("/api/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ password })
  });
  const payload = await response.json();
  if (!response.ok) {
    throw new Error(payload.error || payload.message || "Login failed");
  }
}

async function runSearch() {
  setLockedState(true);
  setExportEnabled(false);
  statusEl.textContent = "Searching Amazon. The shared browser session in the container is collecting prices now.";
  renderSearchProgress({
    percent: 1,
    message: "Starting search…",
    activeMaterial: null,
    running: true
  });
  startSearchProgressPolling();

  try {
    const response = await fetch("/api/search", { method: "POST" });
    const payload = await response.json();
    if (response.status === 401) {
      loginForm.hidden = false;
      throw new Error("Enter the shared password to continue.");
    }
    if (!response.ok) {
      throw new Error(payload.message || payload.error || "Search failed");
    }

    renderResults(payload);
    await refreshSearchProgress();
    await updateSessionState();
    statusEl.textContent = "Search complete.";
  } catch (error) {
    statusEl.textContent = error.message;
    renderWarnings([error.message]);
    await refreshSearchProgress();
  } finally {
    button.disabled = false;
  }
}

loginForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  statusEl.textContent = "Checking password...";

  try {
    await login(passwordInput.value);
    passwordInput.value = "";
    statusEl.textContent = "Unlocked.";
    loginForm.hidden = true;
    await updateSessionState();
  } catch (error) {
    statusEl.textContent = error.message;
  }
});

button.addEventListener("click", runSearch);
logoutButton.addEventListener("click", async () => {
  await fetch("/api/logout", { method: "POST" });
  loginForm.hidden = false;
  sessionStateEl.textContent = "Locked";
  statusEl.textContent = "Logged out.";
});
exportCsvButton.addEventListener("click", () => openDownload("/api/export.csv"));
exportJsonButton.addEventListener("click", () => openDownload("/api/export.json"));

void updateSessionState();
void refreshSearchProgress();
