const fs = require("fs");
const { execFileSync } = require("child_process");
const {
  MATERIALS,
  DEFAULT_MARKETPLACE,
  DEFAULT_TIMEOUT_MS,
  AMAZON_SESSION_DIR,
  SEARCH_BASE_URL,
  SEARCH_TERMS,
  HEADLESS,
  BROWSER_CHANNEL,
  BROWSER_EXECUTABLE_PATH,
  BROWSER_ARGS
} = require("./config");
const { normalizeMaterialResults } = require("./amazonParser");

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

  const selectedMaterials = materials.length ? materials : MATERIALS;
  for (const material of selectedMaterials) {
    plan.push({
      key: material,
      label: material,
      query: SEARCH_TERMS[material]
    });
  }

  if (customTerm) {
    plan.push({
      key: slugify(customTerm),
      label: customTerm,
      query: customTerm
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

function resolveAmazonUrl(href) {
  if (!href) {
    return null;
  }

  try {
    const url = new URL(href, "https://www.amazon.com");
    const asinMatch = url.pathname.match(/\/(?:dp|gp\/product)\/([A-Z0-9]{10})/i);
    if (asinMatch) {
      return `https://www.amazon.com/dp/${asinMatch[1].toUpperCase()}`;
    }
    return url.toString();
  } catch {
    return href;
  }
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
    await page.waitForSelector("[data-component-type='s-search-result']", { timeout: DEFAULT_TIMEOUT_MS });
    return (await page.$$eval("[data-component-type='s-search-result']", (cards) =>
      cards.map((card) => {
        const titleEl = card.querySelector("h2 span");
        const linkEl = card.querySelector("h2 a");
        const asin = card.getAttribute("data-asin") || "";
        const imageEl = card.querySelector("img.s-image");
        const offscreenPrice = card.querySelector(".a-price .a-offscreen");
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

        const href = linkEl ? linkEl.href || linkEl.getAttribute("href") : null;
        const priceText = offscreenPrice ? offscreenPrice.textContent : "";

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

async function searchMaterial(context, searchTarget) {
  const page = await context.newPage();
  const warnings = [];
  const material = searchTarget.label;

  try {
    const query = searchTarget.query;
    await page.goto(buildSearchUrl(query), { waitUntil: "domcontentloaded", timeout: DEFAULT_TIMEOUT_MS });
    await page.waitForLoadState("networkidle", { timeout: 5000 }).catch(() => {});
    await detectBlockingState(page, material);

    const pageUrl = page.url();
    if (!/p_n_is_free_shipping:10236242011/i.test(pageUrl)) {
      warnings.push(`Amazon did not preserve the free-shipping filter for ${material}.`);
    }

    let rawItems = await collectSearchPageItemsWithRetry(page, material);
    if (!rawItems.length) {
      warnings.push(`Amazon closed or replaced the ${material} results page before items could be collected.`);
      return {
        results: [],
        warnings
      };
    }

    let nextPageHref = await page.locator("a.s-pagination-next").first().getAttribute("href").catch(() => null);
    let pageCount = 1;

    while (nextPageHref && rawItems.length < 120 && pageCount < 4) {
      const nextPage = await context.newPage();
      try {
        await nextPage.goto(resolveAmazonUrl(nextPageHref), {
          waitUntil: "domcontentloaded",
          timeout: DEFAULT_TIMEOUT_MS
        });
        await nextPage.waitForLoadState("networkidle", { timeout: 5000 }).catch(() => {});
        await detectBlockingState(nextPage, material);
        const nextItems = await collectSearchPageItemsWithRetry(nextPage, material);
        if (!nextItems.length) {
          warnings.push(`Amazon closed or replaced a later ${material} results page before items could be collected.`);
          nextPageHref = null;
          pageCount += 1;
          continue;
        }
        rawItems = rawItems.concat(nextItems);
        nextPageHref = await nextPage.locator("a.s-pagination-next").first().getAttribute("href").catch(() => null);
        pageCount += 1;
      } finally {
        await nextPage.close().catch(() => {});
      }
    }

    const results = normalizeMaterialResults(material, rawItems.map((item) => ({
      ...item,
      url: item.asin ? `https://www.amazon.com/dp/${item.asin}` : resolveAmazonUrl(item.url)
    })), {
      destinationConfirmed: true,
      freeShippingMode: true,
      filteredEligible: true
    });

    if (!results.length) {
      warnings.push(`Zero parseable ${material} results remained after filtering.`);
    }

    return {
      results,
      warnings
    };
  } finally {
    await page.close().catch(() => {});
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

async function runSearch(options = {}) {
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

    const warnings = [];
    const resultsByMaterial = Object.fromEntries(searchPlan.map((target) => [target.key, []]));

    for (const [index, searchTarget] of searchPlan.entries()) {
      const basePercent = 18 + Math.floor((index / searchPlan.length) * 72);
      emitProgress(onProgress, {
        phase: "material-start",
        percent: basePercent,
        activeMaterial: searchTarget.label,
        message: `Searching ${searchTarget.label} listings on Amazon.`
      });

      try {
        const materialResults = await searchMaterial(context, searchTarget);
        resultsByMaterial[searchTarget.key] = materialResults.results;
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
      searchPlan,
      resultsByMaterial,
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

async function openSessionBrowser() {
  const context = await launchSessionContext({ headless: false });
  const page = context.pages()[0] || (await context.newPage());
  await page.goto("https://www.amazon.com", { waitUntil: "domcontentloaded", timeout: DEFAULT_TIMEOUT_MS });
  return context;
}

module.exports = {
  buildSearchPlan,
  SessionBusyError,
  SessionRequiredError,
  getSessionStatus,
  isProfileLockError,
  openSessionBrowser,
  runSearch
};
