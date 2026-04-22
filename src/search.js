const fs = require("fs");
const os = require("os");
const path = require("path");
const { chromium } = require("playwright");
const {
  MATERIALS,
  DEFAULT_MARKETPLACE,
  DEFAULT_TIMEOUT_MS,
  PROFILE_COPY_ROOT,
  BROWSER_CHANNEL,
  BROWSER_EXECUTABLE_PATH,
  BROWSER_USER_DATA_DIR,
  BROWSER_PROFILE,
  SEARCH_BASE_URL,
  SEARCH_TERMS
} = require("./config");
const { normalizeMaterialResults, parsePrice } = require("./amazonParser");

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

function safeCopyIfExists(sourcePath, destinationPath) {
  if (!fs.existsSync(sourcePath)) {
    return;
  }
  try {
    fs.cpSync(sourcePath, destinationPath, {
      recursive: true,
      force: true,
      errorOnExist: false
    });
  } catch {
    // Ignore files or folders currently locked by the live browser.
  }
}

function copyProfileContents(sourceDir, destinationDir) {
  ensureDirectory(destinationDir);

  const skipNames = new Set([
    "Cache",
    "Code Cache",
    "GPUCache",
    "GrShaderCache",
    "GraphiteDawnCache",
    "DawnCache",
    "ShaderCache",
    "Crashpad",
    "Safe Browsing",
    "Media Cache",
    "blob_storage",
    "Network",
    "Session Storage",
    "Sessions"
  ]);

  for (const entry of fs.readdirSync(sourceDir, { withFileTypes: true })) {
    if (skipNames.has(entry.name)) {
      continue;
    }

    const sourcePath = path.join(sourceDir, entry.name);
    const destinationPath = path.join(destinationDir, entry.name);
    safeCopyIfExists(sourcePath, destinationPath);
  }
}

function copyProfileForRun() {
  const tempRoot = PROFILE_COPY_ROOT || path.join(os.tmpdir(), "amazon-filament-finder");
  ensureDirectory(tempRoot);
  const runRoot = fs.mkdtempSync(path.join(tempRoot, "run-"));
  const sourceProfilePath = path.join(BROWSER_USER_DATA_DIR, BROWSER_PROFILE);
  const targetProfilePath = path.join(runRoot, BROWSER_PROFILE);

  ensureDirectory(runRoot);
  safeCopyIfExists(path.join(BROWSER_USER_DATA_DIR, "Local State"), path.join(runRoot, "Local State"));
  safeCopyIfExists(path.join(BROWSER_USER_DATA_DIR, "First Run"), path.join(runRoot, "First Run"));
  copyProfileContents(sourceProfilePath, targetProfilePath);

  return {
    runRoot,
    targetProfilePath
  };
}

function cleanupProfileCopy(runRoot) {
  if (!runRoot || !fs.existsSync(runRoot)) {
    return;
  }
  fs.rmSync(runRoot, { recursive: true, force: true });
}

async function collectSearchPageItemsWithRetry(page) {
  let lastError;

  for (let attempt = 0; attempt < 2; attempt += 1) {
    if (page.isClosed()) {
      return [];
    }

    try {
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

async function enrichFromProductPage(context, item) {
  if (!item.url) {
    return item;
  }

  const page = await context.newPage();
  try {
    await page.goto(item.url, { waitUntil: "domcontentloaded", timeout: DEFAULT_TIMEOUT_MS });
    await page.waitForLoadState("networkidle", { timeout: 5000 }).catch(() => {});

    const details = await page.evaluate(() => {
      const textFromSelectors = (selectors) => {
        for (const selector of selectors) {
          const el = document.querySelector(selector);
          if (el && el.textContent) {
            return el.textContent.trim();
          }
        }
        return "";
      };

      const title = textFromSelectors(["#productTitle"]);
      const asin = textFromSelectors(["#ASIN", "input#ASIN"]) || document.querySelector("#ASIN")?.value || "";
      const shippingText = textFromSelectors([
        "#mir-layout-DELIVERY_BLOCK-slot-PRIMARY_DELIVERY_MESSAGE_LARGE .a-text-bold",
        "#mir-layout-DELIVERY_BLOCK-slot-PRIMARY_DELIVERY_MESSAGE_LARGE span",
        "#deliveryBlockMessage .a-color-success",
        "#deliveryBlockMessage span",
        "#delivery-message .a-text-bold",
        "#delivery-message span"
      ]);
      const importFeesText = [...document.querySelectorAll("span, div")]
        .find((node) => /import fees deposit/i.test(node.textContent || ""))
        ?.textContent?.trim() || "";
      const priceText = textFromSelectors([
        "#corePriceDisplay_desktop_feature_div .a-price .a-offscreen",
        ".priceToPay span.a-offscreen",
        "#price_inside_buybox"
      ]);

      return {
        title,
        asin,
        shippingText,
        deliveryText: shippingText,
        importFeesText,
        priceText
      };
    });

    const searchPrice = parsePrice(item.priceText || "");
    const productPrice = parsePrice(details.priceText || "");
    let chosenPriceText = item.priceText;
    if (!chosenPriceText && details.priceText) {
      chosenPriceText = details.priceText;
    } else if (searchPrice && productPrice && productPrice.value < searchPrice.value) {
      // Keep the cheapest visible offer we saw between search and product pages.
      chosenPriceText = details.priceText;
    }

    return {
      ...item,
      ...details,
      title: details.title || item.title,
      priceText: chosenPriceText,
      shippingText: details.shippingText || item.shippingText,
      deliveryText: details.deliveryText || item.deliveryText,
      importFeesText: details.importFeesText || item.importFeesText,
      asin: details.asin || item.asin || null,
      sourcePage: "product"
    };
  } finally {
    await page.close();
  }
}

async function searchMaterial(context, material) {
  const page = await context.newPage();
  const warnings = [];

  try {
    const query = SEARCH_TERMS[material];
    await page.goto(buildSearchUrl(query), { waitUntil: "domcontentloaded", timeout: DEFAULT_TIMEOUT_MS });
    await page.waitForLoadState("networkidle", { timeout: 5000 }).catch(() => {});

    let rawItems = await collectSearchPageItemsWithRetry(page);
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
        const nextItems = await collectSearchPageItemsWithRetry(nextPage);
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

    const enriched = [];
    for (const item of rawItems.slice(0, 120)) {
      const normalizedItem = {
        ...item,
        url: item.asin ? `https://www.amazon.com/dp/${item.asin}` : resolveAmazonUrl(item.url)
      };

      enriched.push(normalizedItem);
    }

    return {
      results: normalizeMaterialResults(material, enriched, {
        destinationConfirmed: true,
        freeShippingMode: true,
        filteredEligible: true
      }),
      warnings
    };
  } finally {
    await page.close().catch(() => {});
  }
}

function validateUserDataDir() {
  if (!fs.existsSync(BROWSER_USER_DATA_DIR)) {
    throw new Error(
      `Browser user data directory not found: ${BROWSER_USER_DATA_DIR}. Set BROWSER_USER_DATA_DIR in a .env or your shell before starting the app.`
    );
  }
}

async function runSearch() {
  validateUserDataDir();

  let context;
  let profileCopyRoot = null;
  try {
    const copiedProfile = copyProfileForRun();
    profileCopyRoot = copiedProfile.runRoot;

    const launchOptions = {
      headless: false,
      viewport: { width: 1440, height: 960 },
      timeout: DEFAULT_TIMEOUT_MS,
      args: [`--profile-directory=${BROWSER_PROFILE}`]
    };
    if (BROWSER_CHANNEL) {
      launchOptions.channel = BROWSER_CHANNEL;
    }
    if (BROWSER_EXECUTABLE_PATH) {
      launchOptions.executablePath = BROWSER_EXECUTABLE_PATH;
    }

    context = await chromium.launchPersistentContext(profileCopyRoot, {
      ...launchOptions
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (/launchPersistentContext|browser has been closed|Target page, context or browser has been closed/i.test(message)) {
      throw new Error(
        `Could not open a temporary copy of your Brave profile "${BROWSER_PROFILE}".`
      );
    }
    throw error;
  }

  const warnings = [];
  const resultsByMaterial = {
    PLA: [],
    PETG: [],
    ABS: [],
    TPU: []
  };

  try {
    for (const material of MATERIALS) {
      try {
        const materialResults = await searchMaterial(context, material);
        resultsByMaterial[material] = materialResults.results;
        warnings.push(...materialResults.warnings);
      } catch (error) {
        warnings.push(`Search failed for ${material}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }

    return {
      searchedAt: new Date().toISOString(),
      marketplace: DEFAULT_MARKETPLACE,
      resultsByMaterial,
      warnings
    };
  } finally {
    if (context) {
      await context.close().catch(() => {});
    }
    cleanupProfileCopy(profileCopyRoot);
  }
}

module.exports = {
  runSearch
};
