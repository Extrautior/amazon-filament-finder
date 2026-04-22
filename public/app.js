const button = document.getElementById("run-search");
const logoutButton = document.getElementById("logout-button");
const loginForm = document.getElementById("login-form");
const passwordInput = document.getElementById("password");
const statusEl = document.getElementById("status");
const resultsEl = document.getElementById("results");
const resultsShellEl = document.getElementById("results-shell");
const floatingResultsNavEl = document.getElementById("floating-results-nav");
const floatingColorNavEl = document.getElementById("floating-color-nav");
const warningsEl = document.getElementById("warnings");
const metaEl = document.getElementById("meta");
const searchedAtEl = document.getElementById("searched-at");
const marketplaceEl = document.getElementById("marketplace");
const sessionStateEl = document.getElementById("session-state");
const cheapestCountEl = document.getElementById("cheapest-count");
const discountCountEl = document.getElementById("discount-count");
const historyEl = document.getElementById("history");
const historyListEl = document.getElementById("history-list");
const exportCsvButton = document.getElementById("export-csv");
const exportJsonButton = document.getElementById("export-json");
const progressCardEl = document.getElementById("progress-card");
const progressFillEl = document.getElementById("progress-fill");
const progressLabelEl = document.getElementById("progress-label");
const progressPercentEl = document.getElementById("progress-percent");
const progressMetaEl = document.getElementById("progress-meta");
const customSearchForm = document.getElementById("custom-search-form");
const customSearchInput = document.getElementById("custom-search-term");
const materialButtons = [...document.querySelectorAll(".material-search")];

let searchProgressTimer = null;
let activeSearchJobId = null;
let resultFetchPending = false;
let selectedHistoryJobId = null;
let currentResultIndex = 0;

const COLOR_GROUPS = [
  { label: "Black", pattern: /\bblack\b/i },
  { label: "White", pattern: /\bwhite\b/i },
  { label: "Gray", pattern: /\bgray\b|\bgrey\b|\bsilver\b/i },
  { label: "Blue", pattern: /\bblue\b|\bnavy\b|\bsapphire\b/i },
  { label: "Red", pattern: /\bred\b|\bmaroon\b|\bcrimson\b/i },
  { label: "Green", pattern: /\bgreen\b|\bolive\b/i },
  { label: "Yellow", pattern: /\byellow\b|\bgold\b|\bamber\b/i },
  { label: "Orange", pattern: /\borange\b|\bcopper\b/i },
  { label: "Purple", pattern: /\bpurple\b|\bviolet\b|\blavender\b/i },
  { label: "Pink", pattern: /\bpink\b|\brose\b/i },
  { label: "Brown", pattern: /\bbrown\b|\bbronze\b|\bwood\b/i },
  { label: "Transparent", pattern: /\bclear\b|\btransparent\b|\btranslucent\b/i },
  { label: "Multi-Color", pattern: /\brainbow\b|\bmulti(?:-|\s)?color\b|\bmulti(?:-|\s)?colour\b|\bgalaxy\b/i }
];

function apiUrl(pathname) {
  const url = new URL(pathname, window.location.origin);
  url.searchParams.set("_ts", String(Date.now()));
  return url.toString();
}

async function apiFetch(pathname, options = {}) {
  const headers = {
    Accept: "application/json",
    ...(options.headers || {})
  };

  return fetch(apiUrl(pathname), {
    cache: "no-store",
    credentials: "include",
    ...options,
    headers
  });
}

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

function slugify(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "group";
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
  for (const materialButton of materialButtons) {
    materialButton.disabled = locked;
  }
  customSearchInput.disabled = locked;
  customSearchForm.querySelector("button").disabled = locked;
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

async function readJsonResponse(response) {
  const contentType = response.headers.get("content-type") || "";
  const text = await response.text();
  if (!contentType.includes("application/json")) {
    throw new Error("The server returned an unexpected non-JSON response.");
  }
  return JSON.parse(text);
}

function openDownload(url) {
  window.location.assign(url);
}

function detectColorLabel(title) {
  const normalizedTitle = String(title || "").trim();
  for (const colorGroup of COLOR_GROUPS) {
    if (colorGroup.pattern.test(normalizedTitle)) {
      return colorGroup.label;
    }
  }
  return "Other Colors";
}

function groupItemsByColor(items) {
  const buckets = new Map();
  for (const item of items) {
    const colorLabel = detectColorLabel(item.title);
    if (!buckets.has(colorLabel)) {
      buckets.set(colorLabel, []);
    }
    buckets.get(colorLabel).push(item);
  }

  return [...buckets.entries()]
    .sort(([leftLabel], [rightLabel]) => {
      if (leftLabel === "Other Colors") {
        return 1;
      }
      if (rightLabel === "Other Colors") {
        return -1;
      }
      return leftLabel.localeCompare(rightLabel);
    })
    .map(([label, groupedItems]) => ({ label, items: groupedItems }));
}

function summarizeHistoryItem(item) {
  const labels = Array.isArray(item.labels) && item.labels.length ? item.labels.join(", ") : "Search";
  const searchedAt = item.searchedAt ? new Date(item.searchedAt).toLocaleString() : "Unknown time";
  return `${labels} · ${item.resultCount} cheapest · ${item.discountedCount} discounted · ${searchedAt}`;
}

function renderHistory(items) {
  if (!Array.isArray(items) || !items.length) {
    historyEl.hidden = true;
    historyListEl.innerHTML = "";
    return;
  }

  historyEl.hidden = false;
  historyListEl.innerHTML = items.map((item) => `
    <button class="history-item${item.jobId === selectedHistoryJobId ? " active" : ""}" type="button" data-history-job-id="${escapeHtml(item.jobId)}">
      <strong>${escapeHtml(Array.isArray(item.labels) && item.labels.length ? item.labels.join(", ") : "Saved search")}</strong>
      <span>${escapeHtml(summarizeHistoryItem(item))}</span>
    </button>
  `).join("");

  for (const historyButton of historyListEl.querySelectorAll("[data-history-job-id]")) {
    historyButton.addEventListener("click", () => {
      const { historyJobId } = historyButton.dataset;
      if (historyJobId) {
        void loadLatestResults(historyJobId);
      }
    });
  }
}

function cardForResult(item, index) {
  const amazonUrl = safeAmazonUrl(item.url);
  const imageUrl = safeImageUrl(item.imageUrl);
  return `
    <article class="result-card">
      <div class="result-top">
        <span class="result-rank">#${index + 1}</span>
        <span class="pill pill-free">Free shipping</span>
        ${item.hasDiscount ? `<span class="pill pill-deal">${escapeHtml(item.discountPercent != null ? `Save ${item.discountPercent}%` : "Discount")}</span>` : ""}
      </div>
      ${imageUrl ? `<div class="result-image-wrap"><img class="result-image" src="${escapeHtml(imageUrl)}" alt="${escapeHtml(item.title)}" loading="lazy" /></div>` : ""}
      <h3><a href="${escapeHtml(amazonUrl)}" target="_blank" rel="noreferrer">${escapeHtml(item.title)}</a></h3>
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

function gridClassName(itemCount, extraClassName = "") {
  const layoutClass = itemCount >= 4 ? "result-grid-dense" : "result-grid-compact";
  return ["result-grid", extraClassName, layoutClass].filter(Boolean).join(" ");
}

function sectionForMaterial(section, items) {
  const colorGroups = groupItemsByColor(items);
  const cards = items.length
    ? colorGroups.map((colorGroup) => {
        const colorGroupId = `${slugify(section.key || section.label)}-${slugify(colorGroup.label)}`;
        return `
        <section class="color-group">
          <div id="${escapeHtml(colorGroupId)}" class="color-group-anchor" aria-hidden="true"></div>
          <div class="color-group-header">
            <h3>${escapeHtml(colorGroup.label)}</h3>
            <span>${colorGroup.items.length} result${colorGroup.items.length === 1 ? "" : "s"}</span>
          </div>
          <div class="${gridClassName(colorGroup.items.length, "color-result-grid")}">
            ${colorGroup.items.map((item, index) => cardForResult(item, index)).join("")}
          </div>
        </section>
      `;
      }).join("")
    : `<p class="empty">No free-shipping ${escapeHtml(section.label)} results found.</p>`;

  const colorJumpNav = colorGroups.length
    ? `
      <aside class="color-jump-nav">
        <span class="color-jump-label">Jump to color</span>
        <div class="color-jump-actions">
          ${colorGroups.map((colorGroup) => {
            const colorGroupId = `${slugify(section.key || section.label)}-${slugify(colorGroup.label)}`;
            return `
              <button class="color-jump-button" type="button" data-color-target="${escapeHtml(colorGroupId)}">
                ${escapeHtml(colorGroup.label)}
              </button>
            `;
          }).join("")}
        </div>
      </aside>
    `
    : "";

  return `
    <article class="material-card">
      <div class="material-header">
        <h2>${escapeHtml(section.label)} Cheapest Results</h2>
        <span>${items.length} result${items.length === 1 ? "" : "s"}</span>
      </div>
      <div class="material-layout${colorGroups.length ? " has-color-sidebar" : ""}">
        ${colorJumpNav}
        <div class="color-groups">
        ${cards}
        </div>
      </div>
    </article>
  `;
}

function discountSectionForMaterial(section, items) {
  const cards = items.length
    ? items.map((item, index) => cardForResult(item, index)).join("")
    : `<p class="empty">No discounted ${escapeHtml(section.label)} deals found.</p>`;

  return `
    <article class="material-card">
      <div class="material-header">
        <h2>${escapeHtml(section.label)} Discounted Deals</h2>
        <span>${items.length} result${items.length === 1 ? "" : "s"}</span>
      </div>
      <div class="${gridClassName(items.length)}">
        ${cards}
      </div>
    </article>
  `;
}

function renderWarnings(warnings) {
  const visibleWarnings = (warnings || []).filter(
    (warning) => !/did not preserve the free-shipping filter/i.test(String(warning || ""))
  );

  if (!visibleWarnings.length) {
    warningsEl.hidden = true;
    warningsEl.innerHTML = "";
    return;
  }

  warningsEl.hidden = false;
  warningsEl.innerHTML = `
    <h2>Warnings</h2>
    <ul>
      ${visibleWarnings.map((warning) => `<li>${escapeHtml(warning)}</li>`).join("")}
    </ul>
  `;
}

function resultSlideLabel(card, index) {
  const title = card.querySelector(".material-header h2")?.textContent?.trim();
  return title || `Group ${index + 1}`;
}

function resultCards() {
  return [...resultsEl.querySelectorAll(".material-card")];
}

function currentResultCard() {
  return resultCards()[currentResultIndex] || null;
}

function renderFloatingResultsNav(cards) {
  if (!cards.length) {
    floatingResultsNavEl.hidden = true;
    floatingResultsNavEl.innerHTML = "";
    return;
  }

  floatingResultsNavEl.hidden = false;
  floatingResultsNavEl.innerHTML = `
    <div class="floating-panel-card">
      <p class="toolbar-label">Result Navigator</p>
      <h2>Browse Groups</h2>
      <div class="results-indicators results-indicators-floating">
        ${cards.map((card, index) => `
          <button
            class="results-indicator${index === currentResultIndex ? " active" : ""}"
            type="button"
            data-result-index="${index}"
            aria-label="Open ${escapeHtml(resultSlideLabel(card, index))}"
            title="${escapeHtml(resultSlideLabel(card, index))}"
          >
            <span class="results-indicator-index">${index + 1}</span>
            <span class="results-indicator-label">${escapeHtml(resultSlideLabel(card, index))}</span>
          </button>
        `).join("")}
      </div>
    </div>
  `;

  for (const indicator of floatingResultsNavEl.querySelectorAll("[data-result-index]")) {
    indicator.addEventListener("click", () => {
      currentResultIndex = Number(indicator.dataset.resultIndex) || 0;
      syncResultsCarousel();
    });
  }
}

function renderFloatingColorNav(activeCard) {
  if (!activeCard) {
    floatingColorNavEl.hidden = true;
    floatingColorNavEl.innerHTML = "";
    return;
  }

  const jumpButtons = [...activeCard.querySelectorAll("[data-color-target]")];
  if (!jumpButtons.length) {
    floatingColorNavEl.hidden = true;
    floatingColorNavEl.innerHTML = "";
    return;
  }

  const sectionTitle = activeCard.querySelector(".material-header h2")?.textContent?.trim() || "Colors";
  floatingColorNavEl.hidden = false;
  floatingColorNavEl.innerHTML = `
    <div class="floating-panel-card">
      <p class="toolbar-label">Color Navigator</p>
      <h2>${escapeHtml(sectionTitle)}</h2>
      <div class="color-jump-actions color-jump-actions-floating">
        ${jumpButtons.map((button) => `
          <button class="color-jump-button" type="button" data-color-target="${escapeHtml(button.dataset.colorTarget || "")}">
            ${escapeHtml(button.textContent || "")}
          </button>
        `).join("")}
      </div>
    </div>
  `;
}

function syncResultsCarousel() {
  const cards = resultCards();
  const total = cards.length;
  const hasResults = total > 0;

  resultsShellEl.hidden = !hasResults;
  if (!hasResults) {
    renderFloatingResultsNav([]);
    renderFloatingColorNav(null);
    currentResultIndex = 0;
    return;
  }

  currentResultIndex = Math.max(0, Math.min(currentResultIndex, total - 1));

  cards.forEach((card, index) => {
    card.dataset.slideIndex = String(index);
    card.classList.toggle("is-active", index === currentResultIndex);
  });

  const activeCard = cards[currentResultIndex];
  if (activeCard) {
    resultsEl.scrollTo({
      left: activeCard.offsetLeft,
      behavior: "smooth"
    });
  }

  renderFloatingResultsNav(cards);
  renderFloatingColorNav(activeCard);
}

function moveResultsCarousel(step) {
  const total = resultCards().length;
  if (!total) {
    return;
  }

  currentResultIndex = Math.max(0, Math.min(currentResultIndex + step, total - 1));
  syncResultsCarousel();
}

function renderResults(payload) {
  if (!payload || typeof payload !== "object" || !payload.resultsByMaterial || !Array.isArray(payload.searchPlan)) {
    throw new Error("The server returned an incomplete search result payload. Refresh and try again.");
  }

  const cheapestCount = Object.values(payload.resultsByMaterial || {}).reduce((sum, items) => sum + items.length, 0);
  const discountedCount = Object.values(payload.discountedResultsByMaterial || {}).reduce((sum, items) => sum + items.length, 0);

  metaEl.hidden = false;
  searchedAtEl.textContent = new Date(payload.searchedAt).toLocaleString();
  marketplaceEl.textContent = payload.marketplace;
  cheapestCountEl.textContent = String(cheapestCount);
  discountCountEl.textContent = String(discountedCount);
  const sections = payload.searchPlan.length
    ? payload.searchPlan
    : Object.keys(payload.resultsByMaterial).map((key) => ({ key, label: key }));
  resultsEl.innerHTML = sections.map((section) => {
    const cheapestSection = sectionForMaterial(section, payload.resultsByMaterial[section.key] || []);
    const discountedSection = discountSectionForMaterial(section, payload.discountedResultsByMaterial?.[section.key] || []);
    return `${cheapestSection}${discountedSection}`;
  }).join("");
  currentResultIndex = 0;
  syncResultsCarousel();
  renderWarnings(payload.warnings || []);
  setExportEnabled(true);
}

async function updateSessionState() {
  try {
    const response = await apiFetch("/admin/session-status");
    if (response.status === 401) {
      sessionStateEl.textContent = "Locked";
      loginForm.hidden = false;
      return false;
    }

    const payload = await readJsonResponse(response);
    sessionStateEl.textContent = payload.status;
    loginForm.hidden = true;
    if (!["ready", "busy"].includes(payload.status)) {
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
  const response = await apiFetch("/api/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ password })
  });
  const payload = await readJsonResponse(response);
  if (!response.ok) {
    throw new Error(payload.error || payload.message || "Login failed");
  }
}

async function loadSearchHistory() {
  const response = await apiFetch("/api/search-history");
  if (response.status === 401) {
    historyEl.hidden = true;
    return;
  }
  const payload = await readJsonResponse(response);
  if (!response.ok) {
    throw new Error(payload.error || payload.message || "Could not load recent searches");
  }
  renderHistory(payload.items || []);
}

async function loadLatestResults(jobId = null) {
  const response = await apiFetch(jobId ? `/api/latest-results?jobId=${encodeURIComponent(jobId)}` : "/api/latest-results");
  const payload = await readJsonResponse(response);
  if (!response.ok) {
    throw new Error(payload.error || payload.message || "Could not load the latest results");
  }
  selectedHistoryJobId = payload.jobId || jobId || null;
  renderResults(payload);
  await loadSearchHistory();
  statusEl.textContent = "Search complete.";
}

async function refreshSearchProgress() {
  try {
    const response = await apiFetch("/api/search-status");
    if (response.status === 401) {
      stopSearchProgressPolling();
      progressCardEl.hidden = true;
      return;
    }

    const payload = await readJsonResponse(response);
    renderSearchProgress(payload);

    if (!payload.running) {
      stopSearchProgressPolling();

      if (payload.phase === "error" && payload.jobId === activeSearchJobId) {
        resultFetchPending = false;
        statusEl.textContent = payload.message;
        renderWarnings([payload.message]);
        setLockedState(false);
      }

      if (
        resultFetchPending &&
        activeSearchJobId &&
        payload.latestPayloadJobId === activeSearchJobId
      ) {
        resultFetchPending = false;
        await loadLatestResults();
        await updateSessionState();
        setLockedState(false);
      }
    }
  } catch (error) {
    if (!resultFetchPending) {
      renderWarnings([error.message]);
    }
  }
}

function startSearchProgressPolling() {
  stopSearchProgressPolling();
  void refreshSearchProgress();
  searchProgressTimer = window.setInterval(() => {
    void refreshSearchProgress();
  }, 1500);
}

async function startSearch(searchRequest) {
  setLockedState(true);
  setExportEnabled(false);
  statusEl.textContent = "Searching Amazon. The shared browser session in the container is collecting prices now.";
  renderSearchProgress({
    percent: 1,
    message: "Starting search…",
    activeMaterial: null,
    running: true
  });

  try {
    const response = await apiFetch("/api/search", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(searchRequest)
    });
    const payload = await readJsonResponse(response);
    if (response.status === 401) {
      loginForm.hidden = false;
      throw new Error("Enter the shared password to continue.");
    }
    if (!response.ok) {
      throw new Error(payload.message || payload.error || "Search failed");
    }

    activeSearchJobId = payload.jobId;
    resultFetchPending = true;
    renderWarnings([]);
    startSearchProgressPolling();
  } catch (error) {
    resultFetchPending = false;
    setLockedState(false);
    statusEl.textContent = error.message;
    renderWarnings([error.message]);
    await refreshSearchProgress();
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
    await loadSearchHistory();
    await loadLatestResults().catch(() => {});
  } catch (error) {
    statusEl.textContent = error.message;
  }
});

button.addEventListener("click", () => {
  void startSearch({ materials: ["PLA", "PETG", "ABS", "TPU"] });
});

for (const materialButton of materialButtons) {
  materialButton.addEventListener("click", () => {
    void startSearch({ materials: [materialButton.dataset.material] });
  });
}

customSearchForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const customTerm = customSearchInput.value.trim();
  if (!customTerm) {
    statusEl.textContent = "Enter a custom search term first.";
    return;
  }

  void startSearch({ customTerm });
});

logoutButton.addEventListener("click", async () => {
  await apiFetch("/api/logout", { method: "POST" });
  loginForm.hidden = false;
  sessionStateEl.textContent = "Locked";
  historyEl.hidden = true;
  statusEl.textContent = "Logged out.";
});
exportCsvButton.addEventListener("click", () => openDownload("/api/export.csv"));
exportJsonButton.addEventListener("click", () => openDownload("/api/export.json"));
resultsEl.addEventListener("click", (event) => {
  const jumpButton = event.target.closest("[data-color-target]");
  if (!jumpButton) {
    return;
  }

  const target = document.getElementById(jumpButton.dataset.colorTarget || "");
  if (!target) {
    return;
  }

  target.scrollIntoView({ behavior: "smooth", block: "start" });
});
floatingColorNavEl.addEventListener("click", (event) => {
  const jumpButton = event.target.closest("[data-color-target]");
  if (!jumpButton) {
    return;
  }

  const target = document.getElementById(jumpButton.dataset.colorTarget || "");
  if (!target) {
    return;
  }

  target.scrollIntoView({ behavior: "smooth", block: "start" });
});

async function initializeApp() {
  const unlocked = await updateSessionState();
  if (unlocked) {
    await loadSearchHistory().catch(() => {});
    await loadLatestResults().catch(() => {});
  }
  await refreshSearchProgress();
}

void initializeApp();
