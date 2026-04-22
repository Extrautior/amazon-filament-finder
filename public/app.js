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
let floatingMenusEnabled = false;
let floatingResultsNavScrollTop = 0;
let floatingColorNavScrollTop = 0;

const COLOR_DEFINITIONS = [
  {
    key: "black",
    label: "Black",
    pattern: /\bblack\b|\bjet\s+black\b|\bcharcoal\b|\bonyx\b/i,
    shades: [
      { key: "jet-black", label: "Jet Black", pattern: /\bjet\s+black\b/i },
      { key: "matte-black", label: "Matte Black", pattern: /\bmatte\s+black\b/i },
      { key: "charcoal-black", label: "Charcoal Black", pattern: /\bcharcoal\b/i }
    ]
  },
  {
    key: "white",
    label: "White",
    pattern: /\bwhite\b|\bivory\b|\bcream\b/i,
    shades: [
      { key: "cool-white", label: "Cool White", pattern: /\bcool\s+white\b/i },
      { key: "warm-white", label: "Warm White", pattern: /\bwarm\s+white\b/i },
      { key: "ivory-white", label: "Ivory White", pattern: /\bivory\b/i }
    ]
  },
  {
    key: "gray",
    label: "Gray",
    pattern: /\bgray\b|\bgrey\b|\bsilver\b|\bspace\s+gray\b/i,
    shades: [
      { key: "light-gray", label: "Light Gray", pattern: /\blight\s+gr[ae]y\b/i },
      { key: "dark-gray", label: "Dark Gray", pattern: /\bdark\s+gr[ae]y\b/i },
      { key: "space-gray", label: "Space Gray", pattern: /\bspace\s+gr[ae]y\b/i },
      { key: "silver-gray", label: "Silver Gray", pattern: /\bsilver\b/i }
    ]
  },
  {
    key: "blue",
    label: "Blue",
    pattern: /\bblue\b|\bnavy\b|\bsapphire\b|\bcyan\b|\bteal\b|\bsky\s+blue\b/i,
    shades: [
      { key: "light-blue", label: "Light Blue", pattern: /\blight\s+blue\b|\bsky\s+blue\b|\bbaby\s+blue\b/i },
      { key: "dark-blue", label: "Dark Blue", pattern: /\bdark\s+blue\b/i },
      { key: "navy-blue", label: "Navy Blue", pattern: /\bnavy\b/i },
      { key: "royal-blue", label: "Royal Blue", pattern: /\broyal\s+blue\b/i },
      { key: "teal-blue", label: "Teal Blue", pattern: /\bteal\b|\bcyan\b/i }
    ]
  },
  {
    key: "green",
    label: "Green",
    pattern: /\bgreen\b|\bolive\b|\bemerald\b|\bmint\b|\bforest\b|\blime\b/i,
    shades: [
      { key: "olive-green", label: "Olive Green", pattern: /\bolive\b|\barmy\s+green\b/i },
      { key: "light-green", label: "Light Green", pattern: /\blight\s+green\b|\bpastel\s+green\b/i },
      { key: "dark-green", label: "Dark Green", pattern: /\bdark\s+green\b|\bdeep\s+green\b/i },
      { key: "forest-green", label: "Forest Green", pattern: /\bforest\b|\bhunter\s+green\b/i },
      { key: "mint-green", label: "Mint Green", pattern: /\bmint\b/i },
      { key: "lime-green", label: "Lime Green", pattern: /\blime\b|\bneon\s+green\b/i },
      { key: "emerald-green", label: "Emerald Green", pattern: /\bemerald\b/i }
    ]
  },
  {
    key: "red",
    label: "Red",
    pattern: /\bred\b|\bmaroon\b|\bcrimson\b|\bburgundy\b/i,
    shades: [
      { key: "light-red", label: "Light Red", pattern: /\blight\s+red\b/i },
      { key: "dark-red", label: "Dark Red", pattern: /\bdark\s+red\b/i },
      { key: "crimson-red", label: "Crimson Red", pattern: /\bcrimson\b/i },
      { key: "burgundy-red", label: "Burgundy Red", pattern: /\bburgundy\b|\bmaroon\b/i }
    ]
  },
  {
    key: "yellow",
    label: "Yellow",
    pattern: /\byellow\b|\bgold\b|\bamber\b/i,
    shades: [
      { key: "light-yellow", label: "Light Yellow", pattern: /\blight\s+yellow\b/i },
      { key: "dark-yellow", label: "Dark Yellow", pattern: /\bdark\s+yellow\b|\bmustard\b/i },
      { key: "gold-yellow", label: "Gold", pattern: /\bgold\b/i },
      { key: "amber-yellow", label: "Amber", pattern: /\bamber\b/i }
    ]
  },
  {
    key: "orange",
    label: "Orange",
    pattern: /\borange\b|\bcopper\b/i,
    shades: [
      { key: "light-orange", label: "Light Orange", pattern: /\blight\s+orange\b|\bpeach\b/i },
      { key: "dark-orange", label: "Dark Orange", pattern: /\bdark\s+orange\b|\bburnt\s+orange\b/i },
      { key: "copper-orange", label: "Copper", pattern: /\bcopper\b/i }
    ]
  },
  {
    key: "purple",
    label: "Purple",
    pattern: /\bpurple\b|\bviolet\b|\blavender\b/i,
    shades: [
      { key: "light-purple", label: "Light Purple", pattern: /\blight\s+purple\b|\blavender\b/i },
      { key: "dark-purple", label: "Dark Purple", pattern: /\bdark\s+purple\b|\bdeep\s+purple\b/i },
      { key: "violet-purple", label: "Violet", pattern: /\bviolet\b/i }
    ]
  },
  {
    key: "pink",
    label: "Pink",
    pattern: /\bpink\b|\brose\b/i,
    shades: [
      { key: "light-pink", label: "Light Pink", pattern: /\blight\s+pink\b|\bpastel\s+pink\b/i },
      { key: "dark-pink", label: "Dark Pink", pattern: /\bdark\s+pink\b|\bhot\s+pink\b/i },
      { key: "rose-pink", label: "Rose Pink", pattern: /\brose\b/i }
    ]
  },
  {
    key: "brown",
    label: "Brown",
    pattern: /\bbrown\b|\bbronze\b|\bwood\b|\bchocolate\b/i,
    shades: [
      { key: "light-brown", label: "Light Brown", pattern: /\blight\s+brown\b|\btan\b/i },
      { key: "dark-brown", label: "Dark Brown", pattern: /\bdark\s+brown\b|\bchocolate\b/i },
      { key: "wood-brown", label: "Wood Brown", pattern: /\bwood\b/i },
      { key: "bronze-brown", label: "Bronze Brown", pattern: /\bbronze\b/i }
    ]
  },
  {
    key: "transparent",
    label: "Transparent",
    pattern: /\bclear\b|\btransparent\b|\btranslucent\b/i,
    shades: [
      { key: "clear-transparent", label: "Clear", pattern: /\bclear\b/i },
      { key: "frosted-transparent", label: "Frosted", pattern: /\bfrosted\b|\btranslucent\b/i }
    ]
  },
  {
    key: "multi-color",
    label: "Multi-Color",
    pattern: /\brainbow\b|\bmulti(?:-|\s)?color\b|\bmulti(?:-|\s)?colour\b|\bgalaxy\b|\bdual\s+color\b|\btri(?:-|\s)?color\b/i,
    shades: [
      { key: "rainbow-multi", label: "Rainbow", pattern: /\brainbow\b/i },
      { key: "galaxy-multi", label: "Galaxy", pattern: /\bgalaxy\b/i },
      { key: "dual-color-multi", label: "Dual Color", pattern: /\bdual\s+color\b/i },
      { key: "tri-color-multi", label: "Tri-Color", pattern: /\btri(?:-|\s)?color\b/i }
    ]
  }
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

function compareResultPrices(left, right) {
  const leftMissingPrice = left.priceValue == null ? 1 : 0;
  const rightMissingPrice = right.priceValue == null ? 1 : 0;
  if (leftMissingPrice !== rightMissingPrice) {
    return leftMissingPrice - rightMissingPrice;
  }
  if (left.priceValue !== right.priceValue) {
    return (left.priceValue ?? Number.POSITIVE_INFINITY) - (right.priceValue ?? Number.POSITIVE_INFINITY);
  }
  if (left.totalValue !== right.totalValue) {
    return (left.totalValue ?? Number.POSITIVE_INFINITY) - (right.totalValue ?? Number.POSITIVE_INFINITY);
  }
  return String(left.title || "").localeCompare(String(right.title || ""));
}

function detectColorProfile(item) {
  if (item && item.colorLabel && item.shadeLabel) {
    return {
      colorKey: item.colorKey || slugify(item.colorLabel),
      colorLabel: item.colorLabel,
      shadeKey: item.shadeKey || slugify(item.shadeLabel),
      shadeLabel: item.shadeLabel
    };
  }

  const normalizedTitle = String(item?.title || "").trim();
  for (const colorDefinition of COLOR_DEFINITIONS) {
    if (!colorDefinition.pattern.test(normalizedTitle)) {
      continue;
    }

    const shade = colorDefinition.shades.find((entry) => entry.pattern.test(normalizedTitle));
    return {
      colorKey: colorDefinition.key,
      colorLabel: colorDefinition.label,
      shadeKey: shade ? shade.key : colorDefinition.key,
      shadeLabel: shade ? shade.label : colorDefinition.label
    };
  }

  return {
    colorKey: "other-colors",
    colorLabel: "Other Colors",
    shadeKey: "other-colors",
    shadeLabel: "Other Colors"
  };
}

function compareColorLabels(leftLabel, rightLabel) {
  const leftIndex = COLOR_DEFINITIONS.findIndex((entry) => entry.label === leftLabel);
  const rightIndex = COLOR_DEFINITIONS.findIndex((entry) => entry.label === rightLabel);

  if (leftLabel === "Other Colors") {
    return 1;
  }
  if (rightLabel === "Other Colors") {
    return -1;
  }
  if (leftIndex !== -1 && rightIndex !== -1) {
    return leftIndex - rightIndex;
  }
  return leftLabel.localeCompare(rightLabel);
}

function buildShadeGroups(items) {
  const buckets = new Map();
  for (const item of items) {
    const profile = detectColorProfile(item);
    const shadeKey = profile.shadeKey || profile.colorKey;
    if (!buckets.has(shadeKey)) {
      buckets.set(shadeKey, {
        key: shadeKey,
        label: profile.shadeLabel,
        items: []
      });
    }
    buckets.get(shadeKey).items.push(item);
  }

  return [...buckets.values()]
    .map((group) => ({
      ...group,
      items: [...group.items].sort(compareResultPrices)
    }))
    .sort((left, right) => {
      const leftCheapest = left.items[0];
      const rightCheapest = right.items[0];
      if (!leftCheapest || !rightCheapest) {
        return left.label.localeCompare(right.label);
      }
      return compareResultPrices(leftCheapest, rightCheapest);
    });
}

function groupItemsByColor(items) {
  const buckets = new Map();
  for (const item of items) {
    const profile = detectColorProfile(item);
    const colorLabel = profile.colorLabel;
    if (!buckets.has(colorLabel)) {
      buckets.set(colorLabel, []);
    }
    buckets.get(colorLabel).push(item);
  }

  return [...buckets.entries()]
    .sort(([leftLabel], [rightLabel]) => {
      return compareColorLabels(leftLabel, rightLabel);
    })
    .map(([label, groupedItems]) => ({
      label,
      items: [...groupedItems].sort(compareResultPrices),
      shades: buildShadeGroups(groupedItems)
    }));
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
  const colorProfile = detectColorProfile(item);
  return `
    <article class="result-card" data-shade-label="${escapeHtml(colorProfile.shadeLabel)}">
      <div class="result-top">
        <span class="result-rank">#${index + 1}</span>
        <span class="pill pill-free">Free shipping</span>
        ${colorProfile.shadeLabel !== colorProfile.colorLabel ? `<span class="pill pill-shade">${escapeHtml(colorProfile.shadeLabel)}</span>` : ""}
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
        const shadeFilterId = `${colorGroupId}-shade-filter`;
        const visibleShadeOptions = colorGroup.shades.filter((shadeGroup) => shadeGroup.label !== colorGroup.label);
        return `
        <section class="color-group">
          <div id="${escapeHtml(colorGroupId)}" class="color-group-anchor" aria-hidden="true"></div>
          <div class="color-group-header">
            <div class="color-group-title-wrap">
              <h3>${escapeHtml(colorGroup.label)}</h3>
              ${visibleShadeOptions.length ? `
                <label class="shade-select-wrap" for="${escapeHtml(shadeFilterId)}">
                  <span>Shade</span>
                  <select id="${escapeHtml(shadeFilterId)}" class="shade-select" data-shade-filter="${escapeHtml(colorGroupId)}">
                    <option value="all">All shades</option>
                    ${colorGroup.shades.map((shadeGroup) => `
                      <option value="${escapeHtml(shadeGroup.label)}">
                        ${escapeHtml(shadeGroup.label)} (${shadeGroup.items.length})
                      </option>
                    `).join("")}
                  </select>
                </label>
              ` : ""}
            </div>
            <span class="color-group-count" data-color-count="${escapeHtml(colorGroupId)}">${colorGroup.items.length} result${colorGroup.items.length === 1 ? "" : "s"}</span>
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
        <span>${items.length} result${items.length === 1 ? "" : "s"} across ${colorGroups.length} color group${colorGroups.length === 1 ? "" : "s"}</span>
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

function scrollViewportToResults() {
  const shellTop = window.scrollY + resultsShellEl.getBoundingClientRect().top - 24;
  window.scrollTo({
    top: Math.max(0, shellTop),
    behavior: "smooth"
  });
}

function updateFloatingMenuVisibility() {
  const hasResults = !resultsShellEl.hidden && resultCards().length > 0;
  const shellRect = resultsShellEl.getBoundingClientRect();
  const viewportHeight = window.innerHeight || document.documentElement.clientHeight || 0;
  const historyRect = historyEl.hidden ? null : historyEl.getBoundingClientRect();
  const historyThreshold = historyRect ? historyRect.bottom : 0;
  const inView = hasResults && shellRect.top < viewportHeight - 120 && shellRect.bottom > 220;
  const pastHistory = !historyRect || historyThreshold <= 120;
  const enabled = Boolean(inView);

  floatingMenusEnabled = enabled && pastHistory;
  floatingResultsNavEl.classList.toggle("is-visible", floatingMenusEnabled && !floatingResultsNavEl.hidden);
  floatingColorNavEl.classList.toggle("is-visible", floatingMenusEnabled && !floatingColorNavEl.hidden);
}

function renderFloatingResultsNav(cards) {
  if (!cards.length) {
    floatingResultsNavEl.hidden = true;
    floatingResultsNavEl.innerHTML = "";
    floatingResultsNavEl.classList.remove("is-visible");
    floatingResultsNavScrollTop = 0;
    return;
  }

  const previousList = floatingResultsNavEl.querySelector(".results-indicators-floating");
  if (previousList) {
    floatingResultsNavScrollTop = previousList.scrollTop;
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
      scrollViewportToResults();
    });
  }

  const nextList = floatingResultsNavEl.querySelector(".results-indicators-floating");
  if (nextList) {
    nextList.scrollTop = floatingResultsNavScrollTop;
    nextList.addEventListener("scroll", () => {
      floatingResultsNavScrollTop = nextList.scrollTop;
    }, { passive: true });
  }

  updateFloatingMenuVisibility();
}

function renderFloatingColorNav(activeCard) {
  if (!activeCard) {
    floatingColorNavEl.hidden = true;
    floatingColorNavEl.innerHTML = "";
    floatingColorNavEl.classList.remove("is-visible");
    floatingColorNavScrollTop = 0;
    return;
  }

  const jumpButtons = [...activeCard.querySelectorAll("[data-color-target]")];
  if (!jumpButtons.length) {
    floatingColorNavEl.hidden = true;
    floatingColorNavEl.innerHTML = "";
    floatingColorNavEl.classList.remove("is-visible");
    floatingColorNavScrollTop = 0;
    return;
  }

  const previousList = floatingColorNavEl.querySelector(".color-jump-actions-floating");
  if (previousList) {
    floatingColorNavScrollTop = previousList.scrollTop;
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

  const nextList = floatingColorNavEl.querySelector(".color-jump-actions-floating");
  if (nextList) {
    nextList.scrollTop = floatingColorNavScrollTop;
    nextList.addEventListener("scroll", () => {
      floatingColorNavScrollTop = nextList.scrollTop;
    }, { passive: true });
  }

  updateFloatingMenuVisibility();
}

function updateColorGroupCount(groupId, visibleCount) {
  const countEl = resultsEl.querySelector(`[data-color-count="${groupId}"]`);
  if (countEl) {
    countEl.textContent = `${visibleCount} result${visibleCount === 1 ? "" : "s"}`;
  }
}

function updateColorGroupLayout(colorGroup, visibleCount) {
  const grid = colorGroup.querySelector(".color-result-grid");
  if (!grid) {
    return;
  }

  grid.classList.toggle("result-grid-dense", visibleCount >= 4);
  grid.classList.toggle("result-grid-compact", visibleCount < 4);
}

function wireShadeFilters() {
  for (const shadeSelect of resultsEl.querySelectorAll("[data-shade-filter]")) {
    shadeSelect.addEventListener("change", () => {
      const groupId = shadeSelect.dataset.shadeFilter;
      if (!groupId) {
        return;
      }

      const colorGroup = shadeSelect.closest(".color-group");
      if (!colorGroup) {
        return;
      }

      const selectedShade = shadeSelect.value;
      const cards = [...colorGroup.querySelectorAll(".result-card")];
      let visibleCount = 0;

      for (const card of cards) {
        const matches = selectedShade === "all" || card.dataset.shadeLabel === selectedShade;
        card.hidden = !matches;
        if (matches) {
          visibleCount += 1;
        }
      }

      updateColorGroupCount(groupId, visibleCount);
      updateColorGroupLayout(colorGroup, visibleCount);
    });
  }
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
    updateFloatingMenuVisibility();
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
  updateFloatingMenuVisibility();
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
  wireShadeFilters();
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
window.addEventListener("scroll", updateFloatingMenuVisibility, { passive: true });
window.addEventListener("resize", updateFloatingMenuVisibility);

async function initializeApp() {
  const unlocked = await updateSessionState();
  if (unlocked) {
    await loadSearchHistory().catch(() => {});
    await loadLatestResults().catch(() => {});
  }
  await refreshSearchProgress();
  updateFloatingMenuVisibility();
}

void initializeApp();
