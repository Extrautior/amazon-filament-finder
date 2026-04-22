const button = document.getElementById("run-search");
const statusEl = document.getElementById("status");
const resultsEl = document.getElementById("results");
const warningsEl = document.getElementById("warnings");
const metaEl = document.getElementById("meta");
const searchedAtEl = document.getElementById("searched-at");
const marketplaceEl = document.getElementById("marketplace");
const exportCsvButton = document.getElementById("export-csv");
const exportJsonButton = document.getElementById("export-json");

const MATERIALS = ["PLA", "PETG", "ABS", "TPU"];
let latestPayload = null;

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

function downloadFile(filename, content, contentType) {
  const blob = new Blob([content], { type: contentType });
  const objectUrl = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = objectUrl;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(objectUrl);
}

function exportRows(payload) {
  return MATERIALS.flatMap((material) =>
    (payload.resultsByMaterial[material] || []).map((item, index) => ({
      material,
      rank: index + 1,
      title: item.title,
      asin: item.asin || "",
      url: item.url || "",
      imageUrl: item.imageUrl || "",
      priceValue: item.priceValue ?? "",
      shippingValue: item.shippingValue ?? "",
      importFeesValue: item.importFeesValue ?? "",
      totalValue: item.totalValue ?? "",
      currency: item.currency || "",
      freeShipping: item.freeShipping ? "Yes" : "No",
      availabilityNote: item.availabilityNote || "",
      capturedAt: item.capturedAt || ""
    }))
  );
}

function exportCsv(payload) {
  const rows = exportRows(payload);
  const headers = [
    "material",
    "rank",
    "title",
    "asin",
    "url",
    "imageUrl",
    "priceValue",
    "shippingValue",
    "importFeesValue",
    "totalValue",
    "currency",
    "freeShipping",
    "availabilityNote",
    "capturedAt"
  ];
  const escapeCell = (value) => `"${String(value ?? "").replaceAll('"', '""')}"`;
  const csv = [
    headers.join(","),
    ...rows.map((row) => headers.map((header) => escapeCell(row[header])).join(","))
  ].join("\n");
  downloadFile("amazon-filament-results.csv", csv, "text/csv;charset=utf-8");
}

function exportJson(payload) {
  downloadFile("amazon-filament-results.json", JSON.stringify(payload, null, 2), "application/json;charset=utf-8");
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
      ${warnings.map((warning) => `<li>${warning}</li>`).join("")}
    </ul>
  `;
}

function renderResults(payload) {
  latestPayload = payload;
  metaEl.hidden = false;
  searchedAtEl.textContent = new Date(payload.searchedAt).toLocaleString();
  marketplaceEl.textContent = payload.marketplace;
  resultsEl.innerHTML = MATERIALS.map((material) => sectionForMaterial(material, payload.resultsByMaterial[material] || [])).join("");
  renderWarnings(payload.warnings || []);
  setExportEnabled(true);
}

async function runSearch() {
  button.disabled = true;
  setExportEnabled(false);
  statusEl.textContent = "Searching Amazon. The browser may open while prices and shipping details are collected.";

  try {
    const response = await fetch("/api/search", { method: "POST" });
    const payload = await response.json();
    if (!response.ok) {
      throw new Error(payload.message || payload.error || "Search failed");
    }

    renderResults(payload);
    statusEl.textContent = "Search complete.";
  } catch (error) {
    statusEl.textContent = error.message;
    renderWarnings([error.message]);
    latestPayload = null;
  } finally {
    button.disabled = false;
  }
}

button.addEventListener("click", runSearch);
exportCsvButton.addEventListener("click", () => {
  if (latestPayload) {
    exportCsv(latestPayload);
  }
});
exportJsonButton.addEventListener("click", () => {
  if (latestPayload) {
    exportJson(latestPayload);
  }
});
