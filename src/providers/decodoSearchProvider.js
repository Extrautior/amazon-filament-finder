const DECODO_ENDPOINT = "https://scraper-api.decodo.com/v2/scrape";
const FREE_SHIPPING_FILTER = "p_n_is_free_shipping:10236242011";
const SEARCH_SEED_TEMPLATES = [
  "{material} filament 1kg",
  "{material} 3d printer filament 1kg",
  "{material} 2 pack filament 1kg",
  "{material} filament bundle 1kg"
];

function buildFilteredAmazonSearchUrl(query, page = 1) {
  const url = new URL("https://www.amazon.com/s");
  url.searchParams.set("k", query);
  url.searchParams.set("rh", FREE_SHIPPING_FILTER);
  url.searchParams.set("s", "price-asc-rank");
  url.searchParams.set("page", String(page));
  return url.toString();
}

function buildMaterialQueries(material) {
  return SEARCH_SEED_TEMPLATES.map((template) => template.replace("{material}", material));
}

function authHeader(token) {
  const trimmed = String(token || "").trim();
  if (!trimmed) {
    return "";
  }
  if (trimmed.includes(":")) {
    return `Basic ${Buffer.from(trimmed).toString("base64")}`;
  }
  return /^basic\s+/i.test(trimmed) ? trimmed : `Basic ${trimmed}`;
}

function cleanText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function pickFirst(...values) {
  for (const value of values) {
    if (value != null && cleanText(value) !== "") {
      return value;
    }
  }
  return "";
}

function extractAsin(value) {
  const text = String(value || "");
  const urlMatch = text.match(/\/(?:dp|gp\/product|product)\/([A-Z0-9]{10})/i);
  if (urlMatch) {
    return urlMatch[1].toUpperCase();
  }
  const asinMatch = text.match(/\b([A-Z0-9]{10})\b/);
  return asinMatch ? asinMatch[1].toUpperCase() : "";
}

function normalizePriceText(value, currency = "$") {
  if (value == null || value === "") {
    return "";
  }
  if (typeof value === "number") {
    return `${currency}${value.toFixed(2)}`;
  }
  return cleanText(value);
}

function normalizeDecodoItem(item) {
  const link = pickFirst(item.url, item.link, item.product_url, item.asin_url);
  const asin = cleanText(pickFirst(item.asin, item.product_asin, extractAsin(link)));
  const title = cleanText(pickFirst(item.title, item.name, item.product_title, item.product_name));
  const priceValue = pickFirst(
    item.price,
    item.extracted_price,
    item.current_price,
    item.price_value,
    item.buybox_price
  );
  const deliveryText = cleanText(
    pickFirst(
      item.delivery,
      item.delivery_info,
      item.shipping,
      item.shipping_info,
      item.fulfillment?.standard_delivery?.text,
      item.fulfillment?.fastest_delivery?.text
    )
  );
  const importFeesText = cleanText(pickFirst(item.import_fees, item.import_fees_text, item.importFeesText));
  const discountText = cleanText(pickFirst(item.discount, item.coupon, item.coupon_text, item.promotion));
  const imageUrl = pickFirst(item.image, item.image_url, item.thumbnail, item.main_image, item.main_image_url);
  const currency = cleanText(pickFirst(item.currency, item.price_currency)) || "$";

  return {
    asin,
    title,
    url: asin ? `https://www.amazon.com/dp/${asin}` : link,
    imageUrl,
    priceText: normalizePriceText(priceValue, currency),
    shippingText: deliveryText,
    deliveryText,
    importFeesText,
    badgeText: cleanText(pickFirst(item.badge, item.badge_text, item.shipping_badge)),
    discountText,
    sourcePage: "decodo-search",
    capturedAt: new Date().toISOString()
  };
}

function arrayLooksLikeResults(items) {
  return items.some((item) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      return false;
    }
    return Boolean(
      pickFirst(item.asin, item.product_asin, item.title, item.name, item.product_title, item.url, item.link)
    );
  });
}

function findResultArrays(value, arrays = []) {
  if (!value || typeof value !== "object") {
    return arrays;
  }

  if (Array.isArray(value)) {
    if (arrayLooksLikeResults(value)) {
      arrays.push(value);
      return arrays;
    }
    for (const entry of value) {
      findResultArrays(entry, arrays);
    }
    return arrays;
  }

  for (const key of [
    "organic_results",
    "search_results",
    "results",
    "items",
    "products",
    "parsed"
  ]) {
    if (Array.isArray(value[key]) && arrayLooksLikeResults(value[key])) {
      arrays.push(value[key]);
    }
  }

  for (const nested of Object.values(value)) {
    findResultArrays(nested, arrays);
  }
  return arrays;
}

function mapDecodoResponse(responsePayload) {
  const arrays = findResultArrays(responsePayload);
  const uniqueObjects = new Set();
  const mapped = [];

  for (const array of arrays) {
    for (const item of array) {
      if (!item || typeof item !== "object" || uniqueObjects.has(item)) {
        continue;
      }
      uniqueObjects.add(item);
      const normalized = normalizeDecodoItem(item);
      if (normalized.asin && normalized.title && normalized.priceText) {
        mapped.push(normalized);
      }
    }
  }

  return mapped;
}

async function fetchDecodoSearchPage({ token, geo, query, page, fetchImpl = fetch }) {
  const authorization = authHeader(token);
  if (!authorization) {
    throw new Error("DECODO_AUTH_TOKEN is required when SEARCH_PROVIDER is hybrid or decodo.");
  }

  const amazonUrl = buildFilteredAmazonSearchUrl(query, page);
  const response = await fetchImpl(DECODO_ENDPOINT, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      Authorization: authorization
    },
    body: JSON.stringify({
      target: "amazon",
      url: amazonUrl,
      geo,
      parse: true
    })
  });

  const text = await response.text();
  let payload;
  try {
    payload = text ? JSON.parse(text) : {};
  } catch {
    throw new Error(`Decodo returned non-JSON response for ${query} page ${page}.`);
  }

  if (!response.ok) {
    const message = payload?.message || payload?.error || response.statusText;
    throw new Error(`Decodo request failed for ${query} page ${page}: ${message}`);
  }

  return {
    amazonUrl,
    payload,
    items: mapDecodoResponse(payload)
  };
}

module.exports = {
  buildFilteredAmazonSearchUrl,
  buildMaterialQueries,
  fetchDecodoSearchPage,
  mapDecodoResponse,
  normalizeDecodoItem
};
