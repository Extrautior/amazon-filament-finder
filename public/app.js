const MATERIALS = ["PLA", "PETG", "ABS", "TPU", "ASA"];

const COLOR_DEFINITIONS = [
  { key: "black", label: "Black", pattern: /\bblack\b|\bjet\s+black\b|\bcharcoal\b|\bonyx\b/i },
  { key: "white", label: "White", pattern: /\bwhite\b|\bivory\b|\bcream\b/i },
  { key: "gray", label: "Gray", pattern: /\bgray\b|\bgrey\b|\bsilver\b|\bspace\s+gray\b/i },
  { key: "blue", label: "Blue", pattern: /\bblue\b|\bnavy\b|\bsapphire\b|\bcyan\b|\bteal\b|\bsky\s+blue\b/i },
  { key: "green", label: "Green", pattern: /\bgreen\b|\bolive\b|\bemerald\b|\bmint\b|\bforest\b|\blime\b/i },
  { key: "red", label: "Red", pattern: /\bred\b|\bmaroon\b|\bcrimson\b|\bburgundy\b/i },
  { key: "yellow", label: "Yellow", pattern: /\byellow\b|\bgold\b|\bamber\b/i },
  { key: "orange", label: "Orange", pattern: /\borange\b|\bcopper\b/i },
  { key: "purple", label: "Purple", pattern: /\bpurple\b|\bviolet\b|\blavender\b/i },
  { key: "pink", label: "Pink", pattern: /\bpink\b|\brose\b/i },
  { key: "brown", label: "Brown", pattern: /\bbrown\b|\bbronze\b|\bwood\b|\bchocolate\b/i },
  { key: "transparent", label: "Clear", pattern: /\bclear\b|\btransparent\b|\btranslucent\b/i },
  { key: "multi", label: "Multi", pattern: /\brainbow\b|\bmulti(?:-|\s)?color\b|\bgalaxy\b|\bdual\s+color\b|\btri(?:-|\s)?color\b/i }
];

const state = {
  activeView: "scrape",
  activeMaterial: "all",
  activeColor: "all",
  activeGroup: "deals",
  resultQuery: "",
  sortMode: "price-asc",
  page: 1,
  pageSize: 24,
  authenticated: false,
  exportEnabled: false,
  history: [],
  payload: null,
  progress: null,
  status: "Ready.",
  warnings: [],
  searching: false,
  selectedHistoryJobId: null
};

let progressTimer = null;
let activeSearchJobId = null;
let resultFetchPending = false;

const app = document.getElementById("app");

function apiUrl(pathname) {
  const url = new URL(pathname, window.location.origin);
  url.searchParams.set("_ts", String(Date.now()));
  return url.toString();
}

async function apiFetch(pathname, options = {}) {
  return fetch(apiUrl(pathname), {
    cache: "no-store",
    credentials: "include",
    ...options,
    headers: {
      Accept: "application/json",
      ...(options.headers || {})
    }
  });
}

async function readJsonResponse(response) {
  const text = await response.text();
  const contentType = response.headers.get("content-type") || "";
  if (!contentType.includes("application/json")) {
    throw new Error("The server returned an unexpected non-JSON response.");
  }
  return JSON.parse(text);
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function money(value, currency = "$") {
  if (value == null || Number.isNaN(Number(value))) {
    return "N/A";
  }
  const amount = Number(value).toFixed(2);
  return ["$", "€", "£", "₪"].includes(currency) ? `${currency}${amount}` : `${amount} ${currency}`;
}

function slugify(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "item";
}

function safeAmazonUrl(value) {
  try {
    const url = new URL(String(value || "").trim(), "https://www.amazon.com");
    const asinMatch = url.pathname.match(/\/(?:dp|gp\/product)\/([A-Z0-9]{10})/i);
    if (asinMatch) {
      return `https://www.amazon.com/dp/${asinMatch[1].toUpperCase()}`;
    }
    return /amazon\./i.test(url.hostname) ? url.toString() : "https://www.amazon.com";
  } catch {
    return "https://www.amazon.com";
  }
}

function safeImageUrl(value) {
  try {
    const url = new URL(String(value || "").trim());
    return /^https?:$/i.test(url.protocol) ? url.toString() : "";
  } catch {
    return "";
  }
}

function detectColorProfile(item) {
  if (item?.colorKey || item?.colorLabel) {
    return {
      key: item.colorKey || slugify(item.colorLabel),
      label: item.colorLabel || item.shadeLabel || "Color"
    };
  }

  const title = String(item?.title || "");
  const match = COLOR_DEFINITIONS.find((entry) => entry.pattern.test(title));
  return match ? { key: match.key, label: match.label } : { key: "unknown", label: "Color" };
}

function detectBrand(item) {
  const title = String(item?.title || "").trim();
  const brands = ["Elegoo", "Sunlu", "Polymaker", "Overture", "Hatchbox", "eSUN", "Creality", "Bambu", "Anycubic", "Prusament"];
  return brands.find((brand) => new RegExp(`\\b${brand}\\b`, "i").test(title)) || title.split(/\s+/)[0] || "Amazon";
}

function detectMaterial(item) {
  const source = `${item?.material || ""} ${item?.title || ""}`;
  return MATERIALS.find((material) => new RegExp(`\\b${material}\\+?\\b`, "i").test(source)) || item?.material || "PLA";
}

function isBundleItem(item) {
  const packCount = Number(item?.packCount || 1);
  const totalKg = Number(item?.totalKg || 1);
  const spoolKg = Number(item?.spoolKg || 1);
  const totalValue = Number(item?.totalValue);
  const pricePerKg = Number(item?.pricePerKg);
  const derivedKg = Number.isFinite(totalValue) && Number.isFinite(pricePerKg) && pricePerKg > 0
    ? totalValue / pricePerKg
    : totalKg;
  const title = String(item?.title || "");
  const explicitMultiSpool = /\b(?:multi\s?pack|\d+\s?pack|\d+\s*(?:x|×)\s*(?:1\s?)?kg|\d+\s+spools?)\b/i.test(title);

  return (
    derivedKg >= 1.5 ||
    totalKg >= 1.5 ||
    (packCount >= 2 && totalKg > spoolKg) ||
    (explicitMultiSpool && (derivedKg > 1.15 || totalKg > 1.15 || packCount >= 2))
  );
}

function sortByPrice(left, right) {
  return (left.pricePerKg ?? Number.POSITIVE_INFINITY) - (right.pricePerKg ?? Number.POSITIVE_INFINITY);
}

function sortItems(items) {
  return [...items].sort((left, right) => {
    if (state.sortMode === "price-desc") {
      return -sortByPrice(left, right);
    }
    if (state.sortMode === "discount-desc") {
      return (Number(right.discountPercent) || 0) - (Number(left.discountPercent) || 0) || sortByPrice(left, right);
    }
    if (state.sortMode === "delivered-asc") {
      return (left.totalValue ?? Number.POSITIVE_INFINITY) - (right.totalValue ?? Number.POSITIVE_INFINITY);
    }
    return sortByPrice(left, right);
  });
}

function allDealItems() {
  if (!state.payload?.resultsByMaterial) {
    return [];
  }
  return Object.entries(state.payload.resultsByMaterial)
    .flatMap(([material, items]) => (items || []).map((item) => ({ ...item, material })))
    .sort(sortByPrice);
}

function discountedItems() {
  if (!state.payload?.discountedResultsByMaterial) {
    return [];
  }
  return Object.entries(state.payload.discountedResultsByMaterial)
    .flatMap(([material, items]) => (items || []).map((item) => ({ ...item, material })))
    .sort(sortByPrice);
}

function visibleItems() {
  let items = state.activeGroup === "discounts"
    ? discountedItems()
    : state.activeGroup === "bundles"
      ? allDealItems().filter(isBundleItem)
      : allDealItems();

  if (state.activeMaterial !== "all") {
    items = items.filter((item) => detectMaterial(item).toUpperCase() === state.activeMaterial);
  }
  if (state.activeColor !== "all") {
    items = items.filter((item) => detectColorProfile(item).key === state.activeColor);
  }
  const query = state.resultQuery.trim().toLowerCase();
  if (query) {
    items = items.filter((item) => {
      const haystack = [
        item.title,
        item.material,
        detectMaterial(item),
        detectBrand(item),
        detectColorProfile(item).label,
        item.asin
      ].join(" ").toLowerCase();
      return haystack.includes(query);
    });
  }
  return sortItems(items);
}

function pagedItems() {
  const items = visibleItems();
  const pageCount = Math.max(1, Math.ceil(items.length / state.pageSize));
  const page = Math.min(Math.max(1, state.page), pageCount);
  const start = (page - 1) * state.pageSize;
  return {
    items: items.slice(start, start + state.pageSize),
    page,
    pageCount,
    total: items.length
  };
}

function materialCounts() {
  const counts = Object.fromEntries(MATERIALS.map((material) => [material, 0]));
  for (const [material, items] of Object.entries(state.payload?.resultsByMaterial || {})) {
    counts[material] = items.length;
  }
  return counts;
}

function groupCounts() {
  return {
    deals: allDealItems().length,
    bundles: allDealItems().filter(isBundleItem).length,
    discounts: discountedItems().length
  };
}

function currentResultsLabel() {
  if (!state.payload) {
    return "No cached results";
  }
  const count = visibleItems().length;
  const material = state.activeMaterial === "all" ? "all materials" : state.activeMaterial;
  return `Showing ${count} results for ${material}`;
}

function render() {
  app.className = `app-shell view-${state.activeView}`;
  app.innerHTML = `
    ${desktopSidebar()}
    <main class="workspace">
      ${topBar()}
      <section class="view-stage">
        ${state.activeView === "gallery" ? galleryView() : ""}
        ${state.activeView === "scrape" ? scrapeView() : ""}
        ${state.activeView === "history" ? historyView() : ""}
      </section>
    </main>
    ${mobileBottomNav()}
    ${loginDialog()}
  `;
  bindEvents();
}

function desktopSidebar() {
  return `
    <aside class="side-shell">
      <div class="brand-block">
        <div class="brand-mark"><span class="material-symbols-outlined">3d_rotation</span></div>
        <div>
          <strong>FilamentScrape</strong>
          <span>v2.1 Precision</span>
        </div>
      </div>
      <nav class="side-links" aria-label="Primary">
        ${navButton("gallery", "inventory_2", "Filament Gallery")}
        ${navButton("scrape", "search_check", "New Amazon Scrape")}
        ${navButton("history", "history", "Scrape History")}
      </nav>
    </aside>
  `;
}

function navButton(view, icon, label) {
  return `
    <button class="side-link ${state.activeView === view ? "active" : ""}" type="button" data-view="${view}">
      <span class="material-symbols-outlined">${icon}</span>
      ${escapeHtml(label)}
    </button>
  `;
}

function topBar() {
  const searchPlaceholder = state.activeView === "history" ? "Search logs..." : "Filter scraped filaments...";
  return `
    <header class="top-shell">
      <div class="mobile-title">
        <span class="material-symbols-outlined">precision_manufacturing</span>
        <strong>FilamentScrape</strong>
      </div>
      <form class="top-search" id="custom-search-form">
        <span class="material-symbols-outlined">search</span>
        <input id="result-filter-term" type="text" value="${escapeHtml(state.resultQuery)}" placeholder="${escapeHtml(searchPlaceholder)}" />
        <button type="submit" title="Filter"><span class="material-symbols-outlined">arrow_forward</span></button>
      </form>
      <div class="top-actions">
        <button id="export-csv" type="button" ${state.exportEnabled ? "" : "disabled"} title="Export CSV"><span class="material-symbols-outlined">csv</span></button>
        <button id="export-json" type="button" ${state.exportEnabled ? "" : "disabled"} title="Export JSON"><span class="material-symbols-outlined">file_download</span></button>
        <button id="run-search" class="primary-action" type="button">Search All</button>
        <button id="logout-button" type="button" title="Log out"><span class="material-symbols-outlined">logout</span></button>
      </div>
    </header>
  `;
}

function loginDialog() {
  if (state.authenticated) {
    return "";
  }
  return `
    <div class="login-scrim">
      <form id="login-form" class="login-card">
        <div class="brand-block login-brand">
          <div class="brand-mark"><span class="material-symbols-outlined">3d_rotation</span></div>
          <div>
            <strong>FilamentScrape</strong>
            <span>Unlock shared scraper</span>
          </div>
        </div>
        <label for="password">Shared app password</label>
        <input id="password" type="password" autocomplete="current-password" required />
        <button type="submit"><span class="material-symbols-outlined">lock_open</span>Unlock</button>
        <p>${escapeHtml(state.status)}</p>
      </form>
    </div>
  `;
}

function galleryView() {
  const counts = materialCounts();
  const groups = groupCounts();
  return `
    <div class="gallery-layout">
      <aside class="filter-panel">
        <div class="filter-head"><h2>Filters</h2><button type="button" data-reset-filters>Reset</button></div>
        <div class="filter-section">
          <h3>Material</h3>
          ${MATERIALS.map((material) => `
            <button class="check-row ${state.activeMaterial === material ? "checked" : ""}" type="button" data-material-filter="${material}">
              <span></span><strong>${material}</strong><em>${counts[material] || 0}</em>
            </button>
          `).join("")}
        </div>
        <div class="filter-section">
          <h3>Brand</h3>
          <select><option>All Brands</option><option>Elegoo</option><option>Sunlu</option><option>Overture</option><option>Polymaker</option></select>
        </div>
        <div class="filter-section">
          <div class="range-label"><h3>Price Range</h3><span>$12 - $35</span></div>
          <div class="range-track"><span></span><i></i><b></b></div>
          <div class="range-inputs"><input value="$12.00" readonly /><input value="$35.00" readonly /></div>
        </div>
        <div class="filter-section">
          <h3>Colors</h3>
          <div class="color-filter-row">
            ${["all", "white", "black", "gray", "red", "blue", "green", "yellow", "orange", "multi", "transparent"].map((color) => `
              <button class="filter-dot ${state.activeColor === color ? "active" : ""} ${color === "all" ? "color-all" : `color-${color}`}" type="button" data-color-filter="${color}" title="${escapeHtml(color)}"></button>
            `).join("")}
          </div>
        </div>
      </aside>
      <section class="gallery-main">
        <div class="gallery-head">
          <div>
            <h1>Filament Deals</h1>
            <p>${escapeHtml(currentResultsLabel())}</p>
          </div>
          <label class="sort-control">Sort by:
            <select id="sort-results">
              <option value="price-asc" ${state.sortMode === "price-asc" ? "selected" : ""}>Price Low to High</option>
              <option value="price-desc" ${state.sortMode === "price-desc" ? "selected" : ""}>Price High to Low</option>
              <option value="discount-desc" ${state.sortMode === "discount-desc" ? "selected" : ""}>Highest Discount %</option>
              <option value="delivered-asc" ${state.sortMode === "delivered-asc" ? "selected" : ""}>Total Delivered</option>
            </select>
          </label>
        </div>
        <div class="group-tabs">
          ${groupTab("deals", "Deals", groups.deals)}
          ${groupTab("bundles", "Bundles", groups.bundles)}
          ${groupTab("discounts", "Discounts", groups.discounts)}
        </div>
        ${productGrid()}
      </section>
    </div>
  `;
}

function groupTab(group, label, count) {
  return `<button class="${state.activeGroup === group ? "active" : ""}" type="button" data-group-filter="${group}">${escapeHtml(label)} <span>${count}</span></button>`;
}

function productGrid() {
  const page = pagedItems();
  if (!state.payload) {
    return `<div class="empty-state"><h2>No cached gallery yet</h2><p>Start a scrape or unlock the app to load the latest cached results.</p></div>`;
  }
  if (!page.total) {
    return `<div class="empty-state"><h2>No matching filament deals</h2><p>Try another material or result group.</p></div>`;
  }
  return `
    <div class="product-grid">${page.items.map(productCard).join("")}</div>
    <div class="pager">
      <span>Showing ${(page.page - 1) * state.pageSize + 1} to ${(page.page - 1) * state.pageSize + page.items.length} of ${page.total}</span>
      <div>
        <button type="button" data-page="prev" ${page.page <= 1 ? "disabled" : ""}><span class="material-symbols-outlined">chevron_left</span></button>
        <strong>Page ${page.page} / ${page.pageCount}</strong>
        <button type="button" data-page="next" ${page.page >= page.pageCount ? "disabled" : ""}><span class="material-symbols-outlined">chevron_right</span></button>
      </div>
    </div>
  `;
}

function productCard(item, index) {
  const color = detectColorProfile(item);
  const material = detectMaterial(item);
  const brand = detectBrand(item);
  const imageUrl = safeImageUrl(item.imageUrl);
  const isBundle = isBundleItem(item);
  const badge = item.hasDiscount
    ? `${item.discountPercent != null ? `${item.discountPercent}%` : "Deal"} OFF`
    : isBundle
      ? "BUNDLE DEAL"
      : "";
  return `
    <article class="filament-card">
      <div class="card-media">
        ${badge ? `<span class="deal-badge ${isBundle ? "blue" : ""}">${escapeHtml(badge)}</span>` : ""}
        <div class="spool-fallback color-${escapeHtml(color.key)}"></div>
        ${imageUrl ? `<img src="${escapeHtml(imageUrl)}" alt="${escapeHtml(item.title)}" loading="lazy" onerror="this.remove()" />` : ""}
        <span class="swatch color-${escapeHtml(color.key)}"></span>
      </div>
      <div class="card-body">
        <div class="card-meta"><span>${escapeHtml(material)}</span><em>${escapeHtml(brand)}</em></div>
        <h3><a href="${escapeHtml(safeAmazonUrl(item.url))}" target="_blank" rel="noreferrer">${escapeHtml(item.title || `Filament result ${index + 1}`)}</a></h3>
        <div class="price-block">
          <small>Total Delivered</small>
          <strong>${money(item.totalValue ?? item.priceValue, item.currency)}</strong>
          <span>${money(item.pricePerKg, item.currency)}/kg</span>
        </div>
        <a class="amazon-link" href="${escapeHtml(safeAmazonUrl(item.url))}" target="_blank" rel="noreferrer">View on Amazon <span class="material-symbols-outlined">open_in_new</span></a>
      </div>
    </article>
  `;
}

function scrapeView() {
  const percent = Math.max(0, Math.min(100, Number(state.progress?.percent) || 0));
  const isActive = Boolean(state.progress?.running || state.searching);
  return `
    <div class="scrape-stage">
      <div class="scrape-copy">
        <h1>
          <span class="desktop-title">${isActive ? "Extraction in Progress" : "Initialize Data Extraction"}</span>
          <span class="mobile-title-text">${isActive ? "Scrape Active" : "New Scrape Task"}</span>
        </h1>
        <p>Enter an Amazon search URL, specific ASINs, or general keywords to begin scraping filament pricing, availability, and specifications.</p>
      </div>
      <form id="scrape-form" class="scrape-card">
        <label for="scrape-target">Target URL or Keywords</label>
        <div class="scrape-input">
          <span class="material-symbols-outlined">link</span>
          <textarea id="scrape-target" rows="4" placeholder="https://amazon.com/dp/B08X...&#10;B09Z1X...&#10;Keywords..."></textarea>
        </div>
        <button class="scrape-submit" type="submit" ${state.searching ? "disabled" : ""}>
          <span class="material-symbols-outlined">${state.searching ? "sync" : "rocket_launch"}</span>
          ${state.searching ? "Initializing..." : "Start Scrape Sequence"}
        </button>
        <button class="scrape-all-button" id="scrape-all-materials" type="button" ${state.searching ? "disabled" : ""}>
          <span class="material-symbols-outlined">manage_search</span>
          Search All Filaments
          <small>PLA · PETG · ABS · ASA · TPU</small>
        </button>
      </form>
      <section class="progress-console ${isActive ? "active" : ""}">
        <header><strong><span class="material-symbols-outlined">sync</span> Scrape Active</strong><span>Task ${activeSearchJobId ? `#${activeSearchJobId.slice(-4)}` : "#4892"}</span></header>
        <div class="terminal">
          <p>&gt; ${escapeHtml(state.progress?.message || "Waiting for scrape command...")}</p>
          <p>&gt; Active material: ${escapeHtml(state.progress?.activeMaterial || "Queued")}</p>
          <p class="ok">&gt; Cached results: ${state.payload ? "available" : "pending"}</p>
        </div>
        <div class="progress-label"><span>Overall Progress</span><strong>${Math.round(percent)}%</strong></div>
        <div class="progress-track"><span style="width: ${percent}%"></span></div>
      </section>
    </div>
  `;
}

function historyView() {
  const total = state.history.reduce((sum, item) => sum + (Number(item.resultCount) || 0), 0);
  return `
    <section class="history-stage">
      <div class="history-head">
        <div><h1>Scrape History</h1><p>Log of recent automated material discovery tasks.</p></div>
        <span>Total Tasks: <strong>${total || state.history.length}</strong></span>
      </div>
      <div class="history-table">
        <div class="history-row header"><span>Date & Time</span><span>Search Term / Parameter</span><span>Results Found</span><span>Action</span></div>
        ${(state.history.length ? state.history : []).map(historyRow).join("") || `<div class="empty-state"><h2>No scrape history yet</h2><p>Run a scrape to populate this log.</p></div>`}
      </div>
      <div class="mobile-history-list">
        ${(state.history.length ? state.history : []).map(mobileHistoryCard).join("") || `<div class="empty-state"><h2>No scrape history yet</h2><p>Run a scrape to populate this log.</p></div>`}
      </div>
    </section>
  `;
}

function historyLabel(item) {
  return Array.isArray(item.labels) && item.labels.length ? item.labels.join(", ") : "Saved scrape";
}

function historyDate(item) {
  if (!item.searchedAt) {
    return ["Unknown", ""];
  }
  const date = new Date(item.searchedAt);
  return [date.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }), date.toLocaleTimeString()];
}

function historyRow(item) {
  const [date, time] = historyDate(item);
  const label = historyLabel(item);
  const material = Array.isArray(item.labels) && item.labels[0] ? item.labels[0] : "RUN";
  const hasResults = Number(item.resultCount) > 0;
  return `
    <button class="history-row" type="button" data-history-job-id="${escapeHtml(item.jobId)}">
      <span><strong>${escapeHtml(date)}</strong><small>${escapeHtml(time)}</small></span>
      <span><em>${escapeHtml(material)}</em>${escapeHtml(label)}</span>
      <span><b class="${hasResults ? "" : "muted"}">${item.resultCount || 0}</b></span>
      <span>${hasResults ? "View Results" : "No Data"}</span>
    </button>
  `;
}

function mobileHistoryCard(item) {
  const [date, time] = historyDate(item);
  const hasResults = Number(item.resultCount) > 0;
  return `
    <button class="mobile-history-card" type="button" data-history-job-id="${escapeHtml(item.jobId)}">
      <div><strong>"${escapeHtml(historyLabel(item))}"</strong><span>${escapeHtml(date)} • ${escapeHtml(time)}</span></div>
      <b class="${hasResults ? "" : "muted"}">${item.resultCount || 0} RES</b>
      <em>${hasResults ? "VIEW RESULTS" : "NO RESULTS"} ${hasResults ? "→" : ""}</em>
    </button>
  `;
}

function mobileBottomNav() {
  return `
    <nav class="mobile-bottom-nav">
      ${mobileNavButton("gallery", "grid_view", "Gallery")}
      ${mobileNavButton("scrape", "search_insights", "Scrape")}
      ${mobileNavButton("history", "history", "History")}
    </nav>
  `;
}

function mobileNavButton(view, icon, label) {
  return `
    <button class="${state.activeView === view ? "active" : ""}" type="button" data-view="${view}">
      <span class="material-symbols-outlined">${icon}</span>
      ${escapeHtml(label)}
    </button>
  `;
}

function bindEvents() {
  for (const button of app.querySelectorAll("[data-view]")) {
    button.addEventListener("click", () => {
      state.activeView = button.dataset.view;
      render();
    });
  }

  app.querySelector("#custom-search-form")?.addEventListener("submit", (event) => {
    event.preventDefault();
    state.resultQuery = app.querySelector("#result-filter-term")?.value.trim() || "";
    state.page = 1;
    if (state.activeView === "scrape") {
      state.activeView = "gallery";
    }
    render();
  });

  app.querySelector("#result-filter-term")?.addEventListener("input", (event) => {
    state.resultQuery = event.target.value || "";
    state.page = 1;
    if (state.activeView !== "scrape") {
      render();
    }
  });

  app.querySelector("#scrape-form")?.addEventListener("submit", (event) => {
    event.preventDefault();
    const term = app.querySelector("#scrape-target")?.value.trim();
    void startSearch(term ? { customTerm: term } : { materials: MATERIALS });
  });

  app.querySelector("#scrape-all-materials")?.addEventListener("click", () => {
    void startSearch({ materials: MATERIALS });
  });

  app.querySelector("#run-search")?.addEventListener("click", () => {
    void startSearch({ materials: MATERIALS });
  });

  app.querySelector("#logout-button")?.addEventListener("click", async () => {
    await apiFetch("/api/logout", { method: "POST" });
    state.authenticated = false;
    state.status = "Logged out.";
    render();
  });

  app.querySelector("#export-csv")?.addEventListener("click", () => window.location.assign("/api/export.csv"));
  app.querySelector("#export-json")?.addEventListener("click", () => window.location.assign("/api/export.json"));

  app.querySelector("#login-form")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const password = app.querySelector("#password")?.value || "";
    await login(password);
  });

  for (const button of app.querySelectorAll("[data-material-filter]")) {
    button.addEventListener("click", () => {
      state.activeMaterial = state.activeMaterial === button.dataset.materialFilter ? "all" : button.dataset.materialFilter;
      state.page = 1;
      render();
    });
  }

  app.querySelector("[data-reset-filters]")?.addEventListener("click", () => {
    state.activeMaterial = "all";
    state.activeColor = "all";
    state.activeGroup = "deals";
    state.resultQuery = "";
    state.sortMode = "price-asc";
    state.page = 1;
    render();
  });

  for (const button of app.querySelectorAll("[data-group-filter]")) {
    button.addEventListener("click", () => {
      state.activeGroup = button.dataset.groupFilter || "deals";
      state.page = 1;
      render();
    });
  }

  for (const button of app.querySelectorAll("[data-color-filter]")) {
    button.addEventListener("click", () => {
      state.activeColor = button.dataset.colorFilter || "all";
      state.page = 1;
      render();
    });
  }

  app.querySelector("#sort-results")?.addEventListener("change", (event) => {
    state.sortMode = event.target.value || "price-asc";
    state.page = 1;
    render();
  });

  for (const button of app.querySelectorAll("[data-page]")) {
    button.addEventListener("click", () => {
      state.page += button.dataset.page === "next" ? 1 : -1;
      render();
    });
  }

  for (const button of app.querySelectorAll("[data-history-job-id]")) {
    button.addEventListener("click", () => {
      void loadLatestResults(button.dataset.historyJobId);
    });
  }
}

async function login(password) {
  state.status = "Checking password...";
  render();
  try {
    const response = await apiFetch("/api/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password })
    });
    const payload = await readJsonResponse(response);
    if (!response.ok) {
      throw new Error(payload.error || payload.message || "Login failed");
    }
    state.authenticated = true;
    state.status = "Unlocked.";
    await initializeAuthenticatedApp();
  } catch (error) {
    state.status = error.message;
    render();
  }
}

async function updateSessionState() {
  try {
    const response = await apiFetch("/admin/session-status");
    if (response.status === 401) {
      state.authenticated = false;
      return false;
    }
    const payload = await readJsonResponse(response);
    state.authenticated = true;
    state.status = payload.status || "Ready.";
    return true;
  } catch (error) {
    state.status = error.message;
    return false;
  }
}

async function loadSearchHistory() {
  const response = await apiFetch("/api/search-history");
  if (response.status === 401) {
    state.history = [];
    return;
  }
  const payload = await readJsonResponse(response);
  if (!response.ok) {
    throw new Error(payload.error || payload.message || "Could not load recent searches");
  }
  state.history = payload.items || [];
}

async function loadLatestResults(jobId = null) {
  const response = await apiFetch(jobId ? `/api/latest-results?jobId=${encodeURIComponent(jobId)}` : "/api/latest-results");
  if (response.status === 401) {
    state.authenticated = false;
    render();
    return;
  }
  const payload = await readJsonResponse(response);
  if (!response.ok) {
    state.exportEnabled = false;
    render();
    return;
  }
  state.payload = payload;
  state.selectedHistoryJobId = payload.jobId || jobId || null;
  state.exportEnabled = true;
  state.page = 1;
  state.activeView = "gallery";
  await loadSearchHistory().catch(() => {});
  render();
}

function stopProgressPolling() {
  if (progressTimer) {
    window.clearInterval(progressTimer);
    progressTimer = null;
  }
}

async function refreshSearchProgress() {
  try {
    const response = await apiFetch("/api/search-status");
    if (response.status === 401) {
      stopProgressPolling();
      state.authenticated = false;
      render();
      return;
    }
    const payload = await readJsonResponse(response);
    state.progress = payload;
    state.searching = Boolean(payload.running);

    if (!payload.running) {
      stopProgressPolling();
      if (payload.phase === "error" && payload.jobId === activeSearchJobId) {
        resultFetchPending = false;
        state.status = payload.message || "Search failed.";
      }
      if (resultFetchPending && activeSearchJobId && payload.latestPayloadJobId === activeSearchJobId) {
        resultFetchPending = false;
        await loadLatestResults();
      } else {
        render();
      }
    } else {
      render();
    }
  } catch (error) {
    state.status = error.message;
    render();
  }
}

function startProgressPolling() {
  stopProgressPolling();
  void refreshSearchProgress();
  progressTimer = window.setInterval(() => {
    void refreshSearchProgress();
  }, 1500);
}

async function startSearch(searchRequest) {
  state.activeView = "scrape";
  state.searching = true;
  state.exportEnabled = false;
  state.progress = { percent: 1, message: "Starting scrape sequence...", running: true };
  render();

  try {
    const response = await apiFetch("/api/search", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(searchRequest)
    });
    const payload = await readJsonResponse(response);
    if (response.status === 401) {
      state.authenticated = false;
      throw new Error("Enter the shared password to continue.");
    }
    if (!response.ok) {
      throw new Error(payload.message || payload.error || "Search failed");
    }
    activeSearchJobId = payload.jobId;
    resultFetchPending = true;
    startProgressPolling();
  } catch (error) {
    resultFetchPending = false;
    state.searching = false;
    state.status = error.message;
    state.progress = { percent: 0, message: error.message, running: false };
    render();
  }
}

async function initializeAuthenticatedApp() {
  await loadSearchHistory().catch(() => {});
  await loadLatestResults().catch(() => {
    state.activeView = "scrape";
    render();
  });
  await refreshSearchProgress().catch(() => {});
}

async function initializeApp() {
  render();
  const unlocked = await updateSessionState();
  if (unlocked) {
    await initializeAuthenticatedApp();
  } else {
    render();
  }
}

void initializeApp();
