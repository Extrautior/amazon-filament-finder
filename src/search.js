const fs = require("fs");
const { execFileSync } = require("child_process");
const {
  MATERIALS,
  DEFAULT_MARKETPLACE,
  DEFAULT_TIMEOUT_MS,
  AMAZON_SESSION_DIR,
  SEARCH_BASE_URL,
  SEARCH_TERMS,
  SEARCH_PROVIDER,
  DECODO_AUTH_TOKEN,
  DECODO_GEO,
  DECODO_MAX_REQUESTS_PER_RUN,
  BROWSER_VERIFY_LIMIT_SCHEDULED,
  BROWSER_VERIFY_LIMIT_MANUAL,
  BROWSER_MAX_SEARCH_RESULT_PAGES,
  BROWSER_MAX_RAW_RESULT_ITEMS,
  BROWSER_MAX_QUERIES_PER_MATERIAL,
  BROWSER_SINGLE_MATERIAL_MAX_QUERIES,
  BROWSER_RESULT_SELECTOR_TIMEOUT_MS,
  BROWSER_SEARCH_CONCURRENCY,
  HEADLESS,
  BROWSER_CHANNEL,
  BROWSER_EXECUTABLE_PATH,
  BROWSER_ARGS
} = require("./config");
const { normalizeMaterialResults } = require("./amazonParser");
const {
  buildMaterialQueries,
  fetchDecodoSearchPage
} = require("./providers/decodoSearchProvider");

const AUTH_COOKIE_NAMES = new Set([
  "at-main",
  "sess-at-main",
  "session-id",
  "session-id-time",
  "session-token",
  "ubid-main",
  "x-main"
]);

class SessionRequiredError extends Error {
  constructor(message) {
    super(message);
    this.name = "SessionRequiredError";
  }
}

class SessionBusyError extends Error {
  constructor(message) {
    super(message);
    this.name = "SessionBusyError";
  }
}

const SESSION_LOCK_FILES = ["SingletonLock", "SingletonSocket", "SingletonCookie"];
const MAX_FREE_SHIPPING_QUANTITY_CHECK = 6;

function getChromium() {
  return require("playwright").chromium;
}

function slugify(value) {
  const normalized = String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return normalized || `search-${Date.now()}`;
}

function buildSearchPlan(options = {}) {
  const materials = Array.isArray(options.materials) ? options.materials.filter((material) => SEARCH_TERMS[material]) : [];
  const customTerm = String(options.customTerm || "").trim();
  const plan = [];

  if (materials.length) {
    for (const material of materials) {
      plan.push({
        key: material,
        label: material,
        query: SEARCH_TERMS[material],
        queries: buildMaterialQueries(material)
      });
    }
  } else if (!customTerm) {
    for (const material of MATERIALS) {
      plan.push({
        key: material,
        label: material,
        query: SEARCH_TERMS[material],
        queries: buildMaterialQueries(material)
      });
    }
  }

  if (customTerm) {
    plan.push({
      key: slugify(customTerm),
      label: customTerm,
      query: customTerm,
      queries: [customTerm]
    });
  }

  return plan;
}

function buildSearchUrl(query) {
  const url = new URL(SEARCH_BASE_URL);
  url.searchParams.set("k", query);
  url.searchParams.set("rh", "p_n_is_free_shipping:10236242011");
  url.searchParams.set("s", "price-asc-rank");
  url.searchParams.set("dc", "");
  return url.toString();
}

function extractAsinFromAmazonHref(href) {
  if (!href) {
    return "";
  }

  const candidates = [String(href)];
  try {
    const url = new URL(href, "https://www.amazon.com");
    for (const value of url.searchParams.values()) {
      candidates.push(value);
      try {
        candidates.push(decodeURIComponent(value));
      } catch {
        // Ignore malformed Amazon tracking parameters.
      }
    }
  } catch {
    try {
      candidates.push(decodeURIComponent(String(href)));
    } catch {
      // Ignore malformed Amazon tracking URLs.
    }
  }

  for (const candidate of candidates) {
    const match = String(candidate).match(/\/(?:dp|gp\/product)\/([A-Z0-9]{10})/i);
    if (match) {
      return match[1].toUpperCase();
    }
  }

  return "";
}

function resolveAmazonUrl(href) {
  if (!href) {
    return null;
  }

  try {
    const asin = extractAsinFromAmazonHref(href);
    if (asin) {
      return `https://www.amazon.com/dp/${asin}`;
    }

    const url = new URL(href, "https://www.amazon.com");
    return url.toString();
  } catch {
    return href;
  }
}

function pickStandardPriceText(priceCandidates = []) {
  const candidates = Array.isArray(priceCandidates)
    ? priceCandidates
        .map((candidate) => ({
          text: String(candidate?.text || "").trim(),
          context: String(candidate?.context || "").trim()
        }))
        .filter((candidate) => candidate.text)
    : [];

  if (!candidates.length) {
    return "";
  }

  const primeOnlyPattern =
    /prime\s+(exclusive|price|savings?)|with\s+prime|prime\s+member|membership|member\s+price|join\s+prime|exclusive\s+with\s+prime|prime\s+discount/i;
  const businessOnlyPattern =
    /business\s+price|business\s+exclusive|with\s+business\s+prime/i;
  const clippedCouponPattern =
    /with\s+coupon|coupon\s+applied|after\s+coupon/i;
  const listPricePattern =
    /list\s+price|was\s+\$|typical\s+price|save\s+\d+%/i;

  const scoredCandidates = candidates.map((candidate, index) => {
    let score = 0;
    if (primeOnlyPattern.test(candidate.context)) {
      score += 100;
    }
    if (businessOnlyPattern.test(candidate.context)) {
      score += 80;
    }
    if (clippedCouponPattern.test(candidate.context)) {
      score += 35;
    }
    if (listPricePattern.test(candidate.context)) {
      score += 25;
    }
    if (/free shipping|free delivery|delivery/i.test(candidate.context)) {
      score -= 12;
    }
    if (/add to cart|buying options/i.test(candidate.context)) {
      score -= 4;
    }
    return { ...candidate, index, score };
  });

  scoredCandidates.sort((left, right) => left.score - right.score || left.index - right.index);
  return scoredCandidates[0].text;
}

function extractLabeledDollarPrice(text, label) {
  const normalized = String(text || "")
    .replace(/,/g, "")
    .replace(/\u200f|\u200e/g, " ")
    .replace(/[ \t]+/g, " ");
  const escapedLabel = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = normalized.match(new RegExp(`${escapedLabel}\\s*\\$\\s*(\\d+(?:\\.\\d{1,2})?)(?:\\s+(\\d{2}))?`, "i"));
  if (!match) {
    return "";
  }

  if (match[1].includes(".")) {
    return `$${match[1]}`;
  }

  return `$${match[1]}${match[2] ? `.${match[2]}` : ""}`;
}

function extractProductPageRegularPrice(pageText) {
  const text = String(pageText || "");
  if (!/prime\s+member\s+price|exclusive\s+prime\s+price|exclusively\s+for\s+amazon\s+prime\s+members/i.test(text)) {
    return "";
  }

  return extractLabeledDollarPrice(text, "Regular Price");
}

function extractProductPageDeliveryText(pageText) {
  const text = String(pageText || "").replace(/\s+/g, " ");
  const freeDeliveryMatch = text.match(/FREE delivery.{0,180}?(?:Israel|eligible orders over \$\d+|Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)/i);
  if (freeDeliveryMatch) {
    return freeDeliveryMatch[0];
  }

  const paidShippingMatch = text.match(/\$\s?\d+(?:\.\d{1,2})?\s+Shipping to Israel/i);
  return paidShippingMatch ? paidShippingMatch[0] : "";
}

function isFreeDeliveryText(text) {
  return /FREE delivery|FREE shipping/i.test(String(text || ""));
}

function buildQuantityProbeList(priceText) {
  const priceMatch = String(priceText || "").replace(/,/g, "").match(/\$\s?(\d+(?:\.\d{1,2})?)/);
  const unitPrice = priceMatch ? Number(priceMatch[1]) : null;
  const probes = new Set([1, 2, 3, 4]);

  if (unitPrice && unitPrice > 0) {
    for (const threshold of [49, 50]) {
      const thresholdQuantity = Math.ceil(threshold / unitPrice);
      probes.add(thresholdQuantity);
      probes.add(thresholdQuantity + 1);
    }
  } else {
    probes.add(4);
  }

  return [...probes]
    .filter((quantity) => Number.isInteger(quantity) && quantity >= 1 && quantity <= MAX_FREE_SHIPPING_QUANTITY_CHECK)
    .sort((left, right) => left - right);
}

async function setProductQuantity(page, quantity) {
  if (quantity <= 1) {
    return true;
  }

  const select = page.locator("select#quantity, #quantity").first();
  const currentText = await select.textContent({ timeout: 1500 }).catch(() => "");
  if (!currentText || !new RegExp(`\\b${quantity}\\b`).test(currentText)) {
    return false;
  }

  const beforeText = await page.locator("body").innerText({ timeout: 3000 }).catch(() => "");
  const selectByLabel = await select.selectOption({ label: String(quantity) }).catch(() => null);
  if (!selectByLabel) {
    const selectByZeroBasedValue = await select.selectOption(String(quantity - 1)).catch(() => null);
    if (!selectByZeroBasedValue) {
      const selectByValue = await select.selectOption(String(quantity)).catch(() => null);
      if (!selectByValue) {
        return false;
      }
    }
  }

  await page.waitForFunction(
    ({ previous }) => {
      const bodyText = document.body ? document.body.innerText : "";
      return bodyText !== previous;
    },
    { previous: beforeText },
    { timeout: 2500 }
  ).catch(() => {});
  await page.waitForTimeout(700).catch(() => {});
  return true;
}

async function probeFreeShippingThreshold(page, item) {
  const probes = buildQuantityProbeList(item.priceText);
  let quantityOneDeliveryText = "";

  for (const quantity of probes) {
    const quantityWasSet = await setProductQuantity(page, quantity);
    if (!quantityWasSet) {
      continue;
    }

    const pageText = await page.locator("body").innerText({ timeout: 5000 }).catch(() => "");
    const deliveryText = extractProductPageDeliveryText(pageText);
    if (quantity === 1) {
      quantityOneDeliveryText = deliveryText;
    }
    if (quantity > 1 && isFreeDeliveryText(deliveryText)) {
      const unitPriceMatch = String(item.priceText || "").replace(/,/g, "").match(/\$\s?(\d+(?:\.\d{1,2})?)/);
      const unitPrice = unitPriceMatch ? Number(unitPriceMatch[1]) : null;
      return {
        deliveryText,
        quantityOneDeliveryText,
        minimumFreeShippingQuantity: quantity,
        freeShippingSubtotal: unitPrice ? Number((unitPrice * quantity).toFixed(2)) : null
      };
    }
  }

  return {
    deliveryText: "",
    quantityOneDeliveryText,
    minimumFreeShippingQuantity: null,
    freeShippingSubtotal: null
  };
}

function ensureDirectory(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function sessionLockPaths() {
  return SESSION_LOCK_FILES.map((fileName) => `${AMAZON_SESSION_DIR}/${fileName}`);
}

function sessionLocksExist() {
  return sessionLockPaths().some((candidate) => fs.existsSync(candidate));
}

function isProfileLockError(error) {
  const message = error instanceof Error ? error.message : String(error);
  return /ProcessSingleton|profile directory|SingletonLock|already in use/i.test(message);
}

function isSessionProfileBusy() {
  try {
    const output = execFileSync("ps", ["-eo", "pid=,args="], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"]
    });

    return output
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .some((line) => /chrom/i.test(line) && line.includes(AMAZON_SESSION_DIR));
  } catch {
    return sessionLocksExist();
  }
}

function clearStaleSessionLocks() {
  if (isSessionProfileBusy()) {
    return false;
  }

  let removedAny = false;
  for (const candidate of sessionLockPaths()) {
    if (!fs.existsSync(candidate)) {
      continue;
    }

    try {
      fs.rmSync(candidate, { force: true });
      removedAny = true;
    } catch {
      // Ignore cleanup failures and let launch validation decide the next step.
    }
  }

  return removedAny;
}

function buildLaunchOptions(headlessOverride) {
  const launchOptions = {
    headless: headlessOverride,
    viewport: { width: 1440, height: 960 },
    timeout: DEFAULT_TIMEOUT_MS,
    args: BROWSER_ARGS
  };

  if (BROWSER_CHANNEL) {
    launchOptions.channel = BROWSER_CHANNEL;
  }
  if (BROWSER_EXECUTABLE_PATH) {
    launchOptions.executablePath = BROWSER_EXECUTABLE_PATH;
  }

  return launchOptions;
}

async function launchSessionContext({ headless = HEADLESS } = {}) {
  ensureDirectory(AMAZON_SESSION_DIR);

  let firstLockError = null;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      return await getChromium().launchPersistentContext(AMAZON_SESSION_DIR, buildLaunchOptions(headless));
    } catch (error) {
      if (!isProfileLockError(error)) {
        throw error;
      }

      firstLockError = error;
      if (clearStaleSessionLocks()) {
        continue;
      }

      throw new SessionBusyError(
        "The shared Amazon browser session is already in use. Close any leftover setup browser windows and retry in a moment."
      );
    }
  }

  if (firstLockError) {
    throw new SessionBusyError(
      "The shared Amazon browser session is still locked. Retry in a moment or refresh the session setup if a setup browser was left open."
    );
  }
}

async function inspectAmazonSession(context) {
  const cookies = await context.cookies(["https://www.amazon.com"]);
  const amazonCookies = cookies.filter((cookie) => /amazon\./i.test(cookie.domain));
  const likelyAuthenticated = amazonCookies.some((cookie) => AUTH_COOKIE_NAMES.has(cookie.name));

  if (!amazonCookies.length) {
    return {
      status: "missing",
      message: "No Amazon session cookies were found. Run the session setup flow and log in again.",
      cookieCount: 0,
      likelyAuthenticated: false
    };
  }

  if (!likelyAuthenticated) {
    return {
      status: "needs-reauth",
      message: "Amazon cookies exist, but the shared session may have expired. Reauthenticate the session.",
      cookieCount: amazonCookies.length,
      likelyAuthenticated: false
    };
  }

  return {
    status: "ready",
    message: "Amazon session looks ready.",
    cookieCount: amazonCookies.length,
    likelyAuthenticated: true
  };
}

async function getSessionStatus() {
  if (SEARCH_PROVIDER !== "browser") {
    return {
      status: DECODO_AUTH_TOKEN ? "ready" : "missing",
      message: DECODO_AUTH_TOKEN
        ? "Decodo API credentials are configured. Browser verification is optional in hybrid mode."
        : "DECODO_AUTH_TOKEN is missing. Add it to the service environment before running hybrid searches.",
      cookieCount: 0,
      likelyAuthenticated: Boolean(DECODO_AUTH_TOKEN),
      provider: SEARCH_PROVIDER
    };
  }

  let context;
  try {
    context = await launchSessionContext({ headless: true });
    return await inspectAmazonSession(context);
  } catch (error) {
    if (error instanceof SessionBusyError) {
      return {
        status: "busy",
        message: error.message,
        cookieCount: 0,
        likelyAuthenticated: false
      };
    }

    return {
      status: "error",
      message: error instanceof Error ? error.message : String(error),
      cookieCount: 0,
      likelyAuthenticated: false
    };
  } finally {
    if (context) {
      await context.close().catch(() => {});
    }
  }
}

async function detectBlockingState(page, material) {
  const currentUrl = page.url();
  if (/ap\/signin/i.test(currentUrl)) {
    throw new SessionRequiredError("Amazon redirected the shared browser session to sign in again.");
  }

  const pageText = await page.locator("body").innerText().catch(() => "");
  if (/Enter the characters you see below|Type the characters you see in this image/i.test(pageText)) {
    throw new Error(`Amazon presented a CAPTCHA while loading ${material}.`);
  }
}

async function collectSearchPageItemsWithRetry(page, material) {
  let lastError;

  for (let attempt = 0; attempt < 2; attempt += 1) {
    if (page.isClosed()) {
      return [];
    }

    try {
      await detectBlockingState(page, material);
      return await collectSearchPageItems(page);
    } catch (error) {
      lastError = error;
      if (page.isClosed()) {
        return [];
      }
      await page.waitForLoadState("domcontentloaded", { timeout: 5000 }).catch(() => {});
      await page.waitForLoadState("networkidle", { timeout: 5000 }).catch(() => {});
    }
  }

  if (lastError && /Target page, context or browser has been closed/i.test(String(lastError))) {
    return [];
  }

  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

async function collectSearchPageItems(page) {
  try {
    await page.waitForSelector("[data-component-type='s-search-result']", { timeout: BROWSER_RESULT_SELECTOR_TIMEOUT_MS });
    return (await page.$$eval("[data-component-type='s-search-result']", (cards) =>
      cards.map((card) => {
        const extractAsinFromHref = (href) => {
          if (!href) {
            return "";
          }

          const candidates = [String(href)];
          try {
            const url = new URL(href, "https://www.amazon.com");
            for (const value of url.searchParams.values()) {
              candidates.push(value);
              try {
                candidates.push(decodeURIComponent(value));
              } catch {
                // Ignore malformed Amazon tracking parameters.
              }
            }
          } catch {
            try {
              candidates.push(decodeURIComponent(String(href)));
            } catch {
              // Ignore malformed Amazon tracking URLs.
            }
          }

          for (const candidate of candidates) {
            const match = String(candidate).match(/\/(?:dp|gp\/product)\/([A-Z0-9]{10})/i);
            if (match) {
              return match[1].toUpperCase();
            }
          }

          return "";
        };
        const pickStandardPrice = (priceCandidates) => {
          const primeOnlyPattern =
            /prime\s+(exclusive|price|savings?)|with\s+prime|prime\s+member|membership|member\s+price|join\s+prime|exclusive\s+with\s+prime|prime\s+discount/i;
          const businessOnlyPattern =
            /business\s+price|business\s+exclusive|with\s+business\s+prime/i;
          const clippedCouponPattern =
            /with\s+coupon|coupon\s+applied|after\s+coupon/i;
          const listPricePattern =
            /list\s+price|was\s+\$|typical\s+price|save\s+\d+%/i;
          const normalized = (priceCandidates || [])
            .map((candidate, index) => ({
              text: String(candidate && candidate.text ? candidate.text : "").trim(),
              context: String(candidate && candidate.context ? candidate.context : "").trim(),
              index
            }))
            .filter((candidate) => candidate.text);

          if (!normalized.length) {
            return "";
          }

          const scoredCandidates = normalized.map((candidate) => {
            let score = 0;
            if (primeOnlyPattern.test(candidate.context)) {
              score += 100;
            }
            if (businessOnlyPattern.test(candidate.context)) {
              score += 80;
            }
            if (clippedCouponPattern.test(candidate.context)) {
              score += 35;
            }
            if (listPricePattern.test(candidate.context)) {
              score += 25;
            }
            if (/free shipping|free delivery|delivery/i.test(candidate.context)) {
              score -= 12;
            }
            if (/add to cart|buying options/i.test(candidate.context)) {
              score -= 4;
            }
            return { ...candidate, score };
          });

          scoredCandidates.sort((left, right) => left.score - right.score || left.index - right.index);
          return scoredCandidates[0].text;
        };
        const titleEl = card.querySelector("h2 span");
        const linkEl = card.querySelector("h2 a");
        const href = linkEl ? linkEl.href || linkEl.getAttribute("href") : null;
        const asin = card.getAttribute("data-asin") || extractAsinFromHref(href);
        const imageEl = card.querySelector("img.s-image");
        const priceCandidates = [...card.querySelectorAll(".a-price")]
          .map((priceNode) => {
            const offscreen = priceNode.querySelector(".a-offscreen");
            if (!offscreen || !(offscreen.textContent || "").trim()) {
              return null;
            }

            const priceContainer =
              priceNode.closest("[data-cy='price-recipe'], [data-cy='secondary-offer-recipe'], .s-price-instructions-style") ||
              priceNode.closest(".a-section, .a-row") ||
              priceNode;
            const contextParts = [
              priceContainer.textContent || "",
              priceContainer.previousElementSibling ? priceContainer.previousElementSibling.textContent || "" : "",
              priceContainer.nextElementSibling ? priceContainer.nextElementSibling.textContent || "" : "",
              priceNode.parentElement ? priceNode.parentElement.textContent || "" : ""
            ];
            const contextText = contextParts.join(" ");
            return {
              text: offscreen.textContent,
              context: contextText
            };
          })
          .filter(Boolean);
        const shippingEl =
          card.querySelector("[data-cy='delivery-recipe']") ||
          card.querySelector(".a-color-base.a-text-bold") ||
          card.querySelector(".a-row.a-size-base.a-color-secondary");
        const importFeesEl = [...card.querySelectorAll("span, div")].find((node) =>
          /import fees/i.test(node.textContent || "")
        );
        const badgeEl = [...card.querySelectorAll("span")].find((node) =>
          /free shipping|free delivery|delivery/i.test(node.textContent || "")
        );
        const discountEl = [...card.querySelectorAll("span, div")].find((node) =>
          /save\s+\d+%|extra\s+\d+%|\d+%\s+off|coupon|discount|at checkout/i.test(node.textContent || "")
        );

        const priceText = pickStandardPrice(priceCandidates);

        return {
          asin,
          title: titleEl ? titleEl.textContent : "",
          url: href,
          imageUrl: imageEl ? imageEl.getAttribute("src") || imageEl.getAttribute("data-src") || "" : "",
          priceText,
          shippingText: shippingEl ? shippingEl.textContent : "",
          deliveryText: shippingEl ? shippingEl.textContent : "",
          importFeesText: importFeesEl ? importFeesEl.textContent : "",
          badgeText: badgeEl ? badgeEl.textContent : "",
          discountText: discountEl ? discountEl.textContent : "",
          sourcePage: "search",
          capturedAt: new Date().toISOString()
        };
      })
    )).filter((item) => item.asin && item.title && item.priceText);
  } catch (error) {
    if (/Target page, context or browser has been closed/i.test(String(error))) {
      return [];
    }
    throw error;
  }
}

async function verifyProductPagePricing(context, item, material) {
  if (!item.asin) {
    return item;
  }

  const page = await context.newPage();
  try {
    await page.goto(`https://www.amazon.com/dp/${item.asin}`, {
      waitUntil: "domcontentloaded",
      timeout: DEFAULT_TIMEOUT_MS
    });
    await page.waitForLoadState("networkidle", { timeout: 4000 }).catch(() => {});
    await detectBlockingState(page, material);

    const pageText = await page.locator("body").innerText({ timeout: 5000 }).catch(() => "");
    const regularPriceText = extractProductPageRegularPrice(pageText);
    const deliveryText = extractProductPageDeliveryText(pageText);
    const thresholdProbe = isFreeDeliveryText(deliveryText)
      ? null
      : await probeFreeShippingThreshold(page, { ...item, priceText: regularPriceText || item.priceText });

    if (!regularPriceText && !deliveryText && !thresholdProbe?.deliveryText) {
      return item;
    }

    return {
      ...item,
      priceText: regularPriceText || item.priceText,
      quantityOneShippingText: thresholdProbe?.quantityOneDeliveryText || "",
      thresholdFreeShipping: Boolean(thresholdProbe?.deliveryText),
      minimumFreeShippingQuantity: thresholdProbe?.minimumFreeShippingQuantity || null,
      freeShippingSubtotal: thresholdProbe?.freeShippingSubtotal || null,
      shippingText: thresholdProbe?.deliveryText || deliveryText || item.shippingText,
      deliveryText: thresholdProbe?.deliveryText || deliveryText || item.deliveryText,
      badgeText: thresholdProbe?.deliveryText || deliveryText || item.badgeText,
      sourcePage: regularPriceText || thresholdProbe?.deliveryText ? "product-verified" : item.sourcePage
    };
  } catch {
    return item;
  } finally {
    await page.close().catch(() => {});
  }
}

async function collectBrowserSearchQuery(context, searchTarget, query, warnings) {
  let page;
  const material = searchTarget.label;
  let rawItems = [];
  const seenAsins = new Set();

  try {
    page = await context.newPage();
    await page.goto(buildSearchUrl(query), { waitUntil: "domcontentloaded", timeout: DEFAULT_TIMEOUT_MS });
    await page.waitForLoadState("networkidle", { timeout: 5000 }).catch(() => {});
    await detectBlockingState(page, material);

    let firstItems = [];
    try {
      firstItems = await collectSearchPageItemsWithRetry(page, material);
    } catch (error) {
      warnings.push(`Skipped "${query}": ${error instanceof Error ? error.message : String(error)}`);
      return [];
    }
    if (!firstItems.length) {
      warnings.push(`Amazon closed or replaced the ${material} results page for "${query}" before items could be collected.`);
      return [];
    }

    for (const item of firstItems) {
      const asin = item.asin || extractAsinFromItem(item);
      if (asin) {
        seenAsins.add(asin);
      }
      rawItems.push({ ...item, searchQuery: query, sourceUrl: page.url() });
    }

    let nextPageHref = await page.locator("a.s-pagination-next").first().getAttribute("href").catch(() => null);
    let pageCount = 1;

    while (nextPageHref && rawItems.length < BROWSER_MAX_RAW_RESULT_ITEMS && pageCount < BROWSER_MAX_SEARCH_RESULT_PAGES) {
      const nextPage = await context.newPage();
      try {
        await nextPage.goto(resolveAmazonUrl(nextPageHref), {
          waitUntil: "domcontentloaded",
          timeout: DEFAULT_TIMEOUT_MS
        });
        await nextPage.waitForLoadState("networkidle", { timeout: 5000 }).catch(() => {});
        await detectBlockingState(nextPage, material);
        let nextItems = [];
        try {
          nextItems = await collectSearchPageItemsWithRetry(nextPage, material);
        } catch (error) {
          warnings.push(`Stopped later pages for "${query}": ${error instanceof Error ? error.message : String(error)}`);
          nextPageHref = null;
          pageCount += 1;
          continue;
        }
        if (!nextItems.length) {
          warnings.push(`Amazon closed or replaced a later ${material} results page for "${query}" before items could be collected.`);
          nextPageHref = null;
          pageCount += 1;
          continue;
        }

        let newAsins = 0;
        for (const item of nextItems) {
          const asin = item.asin || extractAsinFromItem(item);
          if (asin && seenAsins.has(asin)) {
            continue;
          }
          if (asin) {
            seenAsins.add(asin);
            newAsins += 1;
          }
          rawItems.push({ ...item, searchQuery: query, sourceUrl: nextPage.url() });
        }

        if (newAsins === 0) {
          break;
        }

        nextPageHref = await nextPage.locator("a.s-pagination-next").first().getAttribute("href").catch(() => null);
        pageCount += 1;
      } finally {
        await nextPage.close().catch(() => {});
      }
    }

    if (nextPageHref && pageCount >= BROWSER_MAX_SEARCH_RESULT_PAGES) {
      warnings.push(`Stopped "${query}" after ${BROWSER_MAX_SEARCH_RESULT_PAGES} browser result pages. Raise BROWSER_MAX_SEARCH_RESULT_PAGES to crawl deeper.`);
    }
    if (rawItems.length >= BROWSER_MAX_RAW_RESULT_ITEMS) {
      warnings.push(`Stopped "${query}" after ${BROWSER_MAX_RAW_RESULT_ITEMS} raw browser items. Raise BROWSER_MAX_RAW_RESULT_ITEMS to keep more.`);
    }

    return rawItems;
  } catch (error) {
    warnings.push(`Skipped "${query}": ${error instanceof Error ? error.message : String(error)}`);
    return [];
  } finally {
    if (page) {
      await page.close().catch(() => {});
    }
  }
}

async function searchMaterial(context, searchTarget, options = {}) {
  const warnings = [];
  const material = searchTarget.label;
  let queries = Array.isArray(searchTarget.queries) && searchTarget.queries.length
    ? searchTarget.queries
    : [searchTarget.query];
  const maxQueries = Number.isFinite(Number(options.maxQueries)) ? Number(options.maxQueries) : 0;
  if (maxQueries > 0 && queries.length > maxQueries) {
    warnings.push(`Using the first ${maxQueries} of ${queries.length} ${material} query seeds. Increase BROWSER_MAX_QUERIES_PER_MATERIAL for deeper Search All runs.`);
    queries = queries.slice(0, maxQueries);
  }

  const rawItems = [];
  let nextQueryIndex = 0;
  const workerCount = Math.max(1, Math.min(BROWSER_SEARCH_CONCURRENCY, queries.length));

  async function runWorker() {
    while (nextQueryIndex < queries.length) {
      const query = queries[nextQueryIndex];
      nextQueryIndex += 1;
      rawItems.push(...await collectBrowserSearchQuery(context, searchTarget, query, warnings));
    }
  }

  await Promise.all(Array.from({ length: workerCount }, () => runWorker()));

  try {
    const dedupedRawItems = dedupeRawItems(rawItems);
    const materialResults = normalizeMaterialResults(material, dedupedRawItems.map((item) => ({
      ...item,
      url: item.asin ? `https://www.amazon.com/dp/${item.asin}` : resolveAmazonUrl(item.url)
    })), {
      destinationConfirmed: true,
      freeShippingMode: true,
      filteredEligible: true
    });

    if (!materialResults.results.length) {
      warnings.push(`Zero parseable ${material} results remained after filtering.`);
    }

    return {
      results: materialResults.results,
      discountedResults: materialResults.discountedResults,
      warnings
    };
  } catch (error) {
    warnings.push(`Failed to normalize ${material} browser results: ${error instanceof Error ? error.message : String(error)}`);
    return {
      results: [],
      discountedResults: [],
      warnings
    };
  }
}

function emitProgress(onProgress, update) {
  if (typeof onProgress === "function") {
    onProgress({
      timestamp: new Date().toISOString(),
      ...update
    });
  }
}

async function runBrowserSearch(options = {}) {
  const { onProgress } = options;
  const searchPlan = buildSearchPlan(options);
  let context;
  try {
    emitProgress(onProgress, {
      phase: "starting",
      percent: 5,
      activeMaterial: null,
      message: "Opening the shared Amazon browser session."
    });
    context = await launchSessionContext();

    emitProgress(onProgress, {
      phase: "checking-session",
      percent: 12,
      activeMaterial: null,
      message: "Checking the saved Amazon login session."
    });
    const sessionStatus = await inspectAmazonSession(context);
    if (sessionStatus.status !== "ready") {
      throw new SessionRequiredError(sessionStatus.message);
    }
    await context.close().catch(() => {});
    context = null;

    const warnings = [];
    const resultsByMaterial = Object.fromEntries(searchPlan.map((target) => [target.key, []]));
    const discountedResultsByMaterial = Object.fromEntries(searchPlan.map((target) => [target.key, []]));
    const maxQueriesPerMaterial = searchPlan.length <= 1
      ? BROWSER_SINGLE_MATERIAL_MAX_QUERIES
      : BROWSER_MAX_QUERIES_PER_MATERIAL;

    for (const [index, searchTarget] of searchPlan.entries()) {
      const basePercent = 18 + Math.floor((index / searchPlan.length) * 72);
      emitProgress(onProgress, {
        phase: "material-start",
        percent: basePercent,
        activeMaterial: searchTarget.label,
        message: `Searching ${searchTarget.label} listings on Amazon.`
      });

      let materialContext;
      try {
        materialContext = await launchSessionContext();
        const materialResults = await searchMaterial(materialContext, searchTarget, {
          maxQueries: maxQueriesPerMaterial
        });
        resultsByMaterial[searchTarget.key] = materialResults.results;
        discountedResultsByMaterial[searchTarget.key] = materialResults.discountedResults;
        warnings.push(...materialResults.warnings);
        emitProgress(onProgress, {
          phase: "material-complete",
          percent: 18 + Math.floor(((index + 1) / searchPlan.length) * 72),
          activeMaterial: searchTarget.label,
          message: `Finished ${searchTarget.label}. Found ${materialResults.results.length} matching results.`
        });
      } catch (error) {
        if (error instanceof SessionRequiredError) {
          throw error;
        }
        warnings.push(`Search failed for ${searchTarget.label}: ${error instanceof Error ? error.message : String(error)}`);
        emitProgress(onProgress, {
          phase: "material-error",
          percent: 18 + Math.floor(((index + 1) / searchPlan.length) * 72),
          activeMaterial: searchTarget.label,
          message: `Finished ${searchTarget.label} with warnings.`
        });
      } finally {
        if (materialContext) {
          await materialContext.close().catch(() => {});
        }
      }
    }

    emitProgress(onProgress, {
      phase: "finalizing",
      percent: 96,
      activeMaterial: null,
      message: "Finalizing grouped results."
    });

    return {
      searchedAt: new Date().toISOString(),
      marketplace: DEFAULT_MARKETPLACE,
      searchProvider: "browser",
      searchPlan,
      resultsByMaterial,
      discountedResultsByMaterial,
      warnings
    };
  } finally {
    if (context) {
      await context.close().catch(() => {});
    }
    emitProgress(onProgress, {
      phase: "complete",
      percent: 100,
      activeMaterial: null,
      message: "Search complete."
    });
  }
}

function dedupeRawItems(rawItems) {
  const deduped = new Map();

  for (const item of rawItems) {
    const asin = item.asin || extractAsinFromItem(item);
    const key = asin || `${item.title || ""}:${item.priceText || ""}`.toLowerCase();
    if (!key) {
      continue;
    }

    const existing = deduped.get(key);
    if (!existing || String(item.deliveryText || item.shippingText || "").length > String(existing.deliveryText || existing.shippingText || "").length) {
      deduped.set(key, {
        ...item,
        asin: asin || item.asin
      });
    }
  }

  return [...deduped.values()];
}

function extractAsinFromItem(item) {
  if (item?.asin) {
    return item.asin;
  }
  const match = String(item?.url || "").match(/\/(?:dp|gp\/product)\/([A-Z0-9]{10})/i);
  return match ? match[1].toUpperCase() : "";
}

function itemNeedsBrowserVerification(item, index) {
  const text = `${item.title || ""} ${item.shippingText || ""} ${item.deliveryText || ""} ${item.badgeText || ""}`;
  if (index < 3) {
    return true;
  }
  if (!/(free|shipping|delivery|Israel|eligible orders)/i.test(text)) {
    return true;
  }
  return /\b(?:bundle|pack|multi|2\s*x|3\s*x|4\s*x|\d+\s?pack)\b/i.test(text);
}

async function verifyHybridCandidates(rawItems, material, verifyLimit, warnings) {
  if (!verifyLimit || verifyLimit <= 0 || !rawItems.length) {
    return rawItems;
  }

  const candidates = rawItems
    .map((item, index) => ({ item, index }))
    .filter(({ item, index }) => itemNeedsBrowserVerification(item, index))
    .slice(0, verifyLimit);

  if (!candidates.length) {
    return rawItems;
  }

  let context;
  try {
    context = await launchSessionContext({ headless: true });
    const sessionStatus = await inspectAmazonSession(context);
    if (sessionStatus.status !== "ready") {
      warnings.push(`Skipped browser verification for ${material}: ${sessionStatus.message}`);
      return rawItems;
    }

    const updated = [...rawItems];
    for (const { item, index } of candidates) {
      updated[index] = await verifyProductPagePricing(context, item, material);
    }
    return updated;
  } catch (error) {
    warnings.push(`Skipped browser verification for ${material}: ${error instanceof Error ? error.message : String(error)}`);
    return rawItems;
  } finally {
    if (context) {
      await context.close().catch(() => {});
    }
  }
}

async function collectDecodoMaterial(searchTarget, budgetState, options = {}) {
  const warnings = [];
  const rawItems = [];
  const seenAsins = new Set();
  const queries = Array.isArray(searchTarget.queries) && searchTarget.queries.length
    ? searchTarget.queries
    : [searchTarget.query];
  const maxPagesPerQuery = options.maxPagesPerQuery || budgetState.max;

  for (const query of queries) {
    for (let pageNumber = 1; pageNumber <= maxPagesPerQuery; pageNumber += 1) {
      if (budgetState.used >= budgetState.max) {
        warnings.push(`Stopped ${searchTarget.label} early after using the Decodo request budget (${budgetState.max}).`);
        return { rawItems: dedupeRawItems(rawItems), warnings };
      }

      budgetState.used += 1;
      const pageResult = await fetchDecodoSearchPage({
        token: options.decodoAuthToken || DECODO_AUTH_TOKEN,
        geo: options.decodoGeo || DECODO_GEO,
        query,
        page: pageNumber,
        fetchImpl: options.fetchImpl
      });

      let newAsins = 0;
      for (const item of pageResult.items) {
        const asin = item.asin || extractAsinFromItem(item);
        if (asin && seenAsins.has(asin)) {
          continue;
        }
        if (asin) {
          seenAsins.add(asin);
          newAsins += 1;
        }
        rawItems.push({
          ...item,
          searchQuery: query,
          sourceUrl: pageResult.amazonUrl
        });
      }

      if (!pageResult.items.length || newAsins === 0) {
        break;
      }
    }
  }

  return { rawItems: dedupeRawItems(rawItems), warnings };
}

async function runHybridSearch(options = {}) {
  const { onProgress } = options;
  const searchPlan = buildSearchPlan(options);
  const warnings = [];
  const resultsByMaterial = Object.fromEntries(searchPlan.map((target) => [target.key, []]));
  const discountedResultsByMaterial = Object.fromEntries(searchPlan.map((target) => [target.key, []]));
  const budgetState = {
    used: 0,
    max: options.decodoRequestBudget || DECODO_MAX_REQUESTS_PER_RUN
  };
  const verifyLimit = options.browserVerifyLimit ?? (
    options.trigger === "manual" ? BROWSER_VERIFY_LIMIT_MANUAL : BROWSER_VERIFY_LIMIT_SCHEDULED
  );

  emitProgress(onProgress, {
    phase: "starting",
    percent: 5,
    activeMaterial: null,
    message: "Starting Decodo-backed Amazon search."
  });

  for (const [index, searchTarget] of searchPlan.entries()) {
    const basePercent = 10 + Math.floor((index / searchPlan.length) * 82);
    emitProgress(onProgress, {
      phase: "material-start",
      percent: basePercent,
      activeMaterial: searchTarget.label,
      message: `Searching filtered ${searchTarget.label} listings with Decodo.`
    });

    try {
      const collected = await collectDecodoMaterial(searchTarget, budgetState, options);
      warnings.push(...collected.warnings);
      const verifiedItems = await verifyHybridCandidates(
        collected.rawItems,
        searchTarget.label,
        verifyLimit,
        warnings
      );
      const materialResults = normalizeMaterialResults(searchTarget.label, verifiedItems, {
        destinationConfirmed: false,
        freeShippingMode: true,
        filteredEligible: true
      });

      resultsByMaterial[searchTarget.key] = materialResults.results;
      discountedResultsByMaterial[searchTarget.key] = materialResults.discountedResults;
      if (!materialResults.results.length) {
        warnings.push(`Zero parseable ${searchTarget.label} results remained after filtering.`);
      }
    } catch (error) {
      warnings.push(`Search failed for ${searchTarget.label}: ${error instanceof Error ? error.message : String(error)}`);
    }

    emitProgress(onProgress, {
      phase: "material-complete",
      percent: 10 + Math.floor(((index + 1) / searchPlan.length) * 82),
      activeMaterial: searchTarget.label,
      message: `Finished ${searchTarget.label}.`
    });
  }

  emitProgress(onProgress, {
    phase: "finalizing",
    percent: 96,
    activeMaterial: null,
    message: "Finalizing grouped results."
  });

  emitProgress(onProgress, {
    phase: "complete",
    percent: 100,
    activeMaterial: null,
    message: "Search complete."
  });

  return {
    searchedAt: new Date().toISOString(),
    marketplace: DEFAULT_MARKETPLACE,
    searchProvider: "hybrid-decodo",
    decodoRequestsUsed: budgetState.used,
    searchPlan,
    resultsByMaterial,
    discountedResultsByMaterial,
    warnings
  };
}

async function runSearch(options = {}) {
  const provider = String(options.searchProvider || SEARCH_PROVIDER || "hybrid").toLowerCase();
  if (provider === "browser") {
    return runBrowserSearch(options);
  }
  if (provider === "hybrid" || provider === "decodo") {
    return runHybridSearch(options);
  }
  throw new Error(`Unsupported SEARCH_PROVIDER "${provider}". Use "hybrid", "decodo", or "browser".`);
}

async function openSessionBrowser() {
  const context = await launchSessionContext({ headless: false });
  const page = context.pages()[0] || (await context.newPage());
  await page.goto("https://www.amazon.com", { waitUntil: "domcontentloaded", timeout: DEFAULT_TIMEOUT_MS });
  return context;
}

module.exports = {
  buildSearchPlan,
  extractProductPageDeliveryText,
  extractProductPageRegularPrice,
  pickStandardPriceText,
  SessionBusyError,
  SessionRequiredError,
  getSessionStatus,
  isProfileLockError,
  openSessionBrowser,
  buildQuantityProbeList,
  extractAsinFromAmazonHref,
  buildSearchUrl,
  resolveAmazonUrl,
  runSearch
};
