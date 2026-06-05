const { RESULT_LIMIT } = require("./config");
const { extractColorProfile } = require("./colorProfile");

function parsePrice(text) {
  if (!text) {
    return null;
  }

  const normalized = text.replace(/,/g, "").replace(/\u200f|\u200e/g, " ");

  const symbolMatch = normalized.match(/([$€£₪])\s?(\d+(?:\.\d{1,2})?)/);
  if (symbolMatch) {
    return {
      currency: symbolMatch[1],
      value: Number(symbolMatch[2])
    };
  }

  const codeMatch = normalized.match(/\b(ILS|USD|EUR|GBP)\b\s?(\d+(?:\.\d{1,2})?)/i);
  if (codeMatch) {
    const currencyMap = {
      ILS: "ILS",
      USD: "$",
      EUR: "EUR",
      GBP: "GBP"
    };
    return {
      currency: currencyMap[codeMatch[1].toUpperCase()] || codeMatch[1].toUpperCase(),
      value: Number(codeMatch[2])
    };
  }

  const trailingCodeMatch = normalized.match(/(\d+(?:\.\d{1,2})?)\s?\b(ILS|USD|EUR|GBP)\b/i);
  if (trailingCodeMatch) {
    const currencyMap = {
      ILS: "ILS",
      USD: "$",
      EUR: "EUR",
      GBP: "GBP"
    };
    return {
      currency: currencyMap[trailingCodeMatch[2].toUpperCase()] || trailingCodeMatch[2].toUpperCase(),
      value: Number(trailingCodeMatch[1])
    };
  }
  return null;
}

function cleanText(text) {
  return (text || "").replace(/\s+/g, " ").trim();
}

function hasExplicitFreeShippingSignal(...texts) {
  return texts.some((text) => /free shipping|free delivery/i.test(text || ""));
}

function hasExplicitPaidShippingSignal(...texts) {
  return texts.some((text) => /\$\s?\d+(?:\.\d{1,2})?\s+shipping|shipping\s+\$\s?\d+(?:\.\d{1,2})?/i.test(text || ""));
}

function parseShippingStatus(...texts) {
  const text = cleanText(texts.filter(Boolean).join(" | "));
  if (/cannot be shipped|does not ship|not available|currently unavailable/i.test(text)) {
    return "not_shippable";
  }
  if (/\$\s?\d+(?:\.\d{1,2})?\s+shipping\s+to\s+Israel|shipping\s+\$\s?\d+(?:\.\d{1,2})?.{0,40}Israel/i.test(text)) {
    return "paid_shipping";
  }
  if (/free\s+(?:delivery|shipping).{0,140}(?:eligible orders over|orders over|over\s+\$49).{0,80}Israel|free\s+(?:delivery|shipping).{0,140}Israel.{0,80}(?:eligible orders over|orders over|over\s+\$49)/i.test(text)) {
    return "free_over_threshold_to_israel";
  }
  if (/free\s+(?:delivery|shipping).{0,160}Israel|Israel.{0,160}free\s+(?:delivery|shipping)/i.test(text)) {
    return "free_to_israel";
  }
  if (hasExplicitFreeShippingSignal(text) && !hasExplicitPaidShippingSignal(text)) {
    return "free_to_israel";
  }
  if (hasExplicitPaidShippingSignal(text)) {
    return "paid_shipping";
  }
  return "unknown";
}

function parseDiscountPercent(text) {
  const normalized = cleanText(text);
  const match = normalized.match(/(?:save|extra)\s+(\d+)%|(\d+)%\s+off/i);
  if (!match) {
    return null;
  }

  return Number(match[1] || match[2]);
}

function hasDiscountSignal(text) {
  return /save\s+\d+%|extra\s+\d+%|\d+%\s+off|coupon|discount|at checkout/i.test(cleanText(text));
}

function materialMatches(material, title) {
  const normalizedTitle = cleanText(title).toUpperCase();
  if (hasNonFilamentExclusion(normalizedTitle)) {
    return false;
  }

  const exact = new RegExp(`\\b${material}\\b`, "i");
  if (!exact.test(normalizedTitle)) {
    if (!(material === "PLA" && /\bPLA\+\b/i.test(normalizedTitle))) {
      return false;
    }
  }

  const spoolInfo = parseSpoolInfo(normalizedTitle);
  if (!spoolInfo) {
    return false;
  }

  const exclusions = {
    PLA: ["PETG", "ABS", "TPU", "ASA"],
    PETG: ["PLA", "ABS", "TPU", "ASA"],
    ABS: ["PLA", "PETG", "TPU", "ASA"],
    TPU: ["PLA", "PETG", "ABS", "ASA"],
    ASA: ["PLA", "PETG", "ABS", "TPU"]
  };

  const excludedMaterials = exclusions[material] || [];

  return !excludedMaterials.some((other) => {
    if (material === "PLA" && /\bPLA\+\b/i.test(normalizedTitle) && other === "PLA") {
      return false;
    }
    return new RegExp(`\\b${other}\\b`, "i").test(normalizedTitle);
  });
}

function hasNonFilamentExclusion(title) {
  return /\b(?:resin|sample|samples|dryer|dry\s+box|nozzle|nozzles|hotend|bed|build\s+plate|storage\s+bag|vacuum\s+bag|glue|adhesive|tube|tubing|connector|extruder|gear|part|parts|refill\s+only)\b/i.test(title);
}

function parseSpoolInfo(title) {
  const text = cleanText(title).toUpperCase();
  if (/\b(?:250\s?G|500\s?G|0\.25\s?KG|0\.5\s?KG|0\.25KG|0\.5KG)\b/i.test(text) && !/\b(?:1\s?KG|2\.2\s?LBS?)\b/i.test(text)) {
    return null;
  }

  let packCount = 1;
  let spoolKg = 1;
  let totalKg = null;

  const xPattern = text.match(/\b(\d{1,2})\s*(?:X|x|\*)\s*(?:1\s?KG|2\.2\s?LBS?)\b/i);
  if (xPattern) {
    packCount = Number(xPattern[1]);
    totalKg = packCount;
  }

  const packPattern = text.match(/\b(\d{1,2})\s*[- ]?\s*(?:PACK|PK)\b|\bPACK\s+OF\s+(\d{1,2})\b/i);
  if (packPattern && /\b(?:1\s?KG|2\.2\s?LBS?)\b/i.test(text)) {
    packCount = Number(packPattern[1] || packPattern[2]);
    totalKg = packCount;
  }

  const totalBundlePattern = text.match(/\b(\d{1,2})\s?KG\s+(?:BUNDLE|PACK|SET)\b|\b(?:BUNDLE|PACK|SET)\s+(?:OF\s+)?(\d{1,2})\s?KG\b/i);
  if (!totalKg && totalBundlePattern) {
    totalKg = Number(totalBundlePattern[1] || totalBundlePattern[2]);
    packCount = totalKg;
  }

  if (!totalKg && /\b(?:1\s?KG|1\s?KILO|1\s?KILOGRAM|2\.2\s?LBS?)\b/i.test(text)) {
    totalKg = 1;
  }

  if (!totalKg || totalKg < 1 || packCount < 1) {
    return null;
  }

  return {
    packCount,
    spoolKg,
    totalKg
  };
}

function extractAsin(url) {
  if (!url) {
    return null;
  }

  const match = url.match(/\/(?:dp|gp\/product)\/([A-Z0-9]{10})/i);
  return match ? match[1].toUpperCase() : null;
}

function computeTotal(priceValue, shippingValue, importFeesValue) {
  return [priceValue, shippingValue, importFeesValue].reduce((sum, value) => sum + (value || 0), 0);
}

function compareCheapestResults(left, right) {
  const leftMissingPrice = left.priceValue == null ? 1 : 0;
  const rightMissingPrice = right.priceValue == null ? 1 : 0;
  if (leftMissingPrice !== rightMissingPrice) {
    return leftMissingPrice - rightMissingPrice;
  }
  if (left.pricePerKg !== right.pricePerKg) {
    return (left.pricePerKg ?? Number.POSITIVE_INFINITY) - (right.pricePerKg ?? Number.POSITIVE_INFINITY);
  }
  if (left.priceValue !== right.priceValue) {
    return (left.priceValue ?? Number.POSITIVE_INFINITY) - (right.priceValue ?? Number.POSITIVE_INFINITY);
  }
  if (left.totalValue !== right.totalValue) {
    return left.totalValue - right.totalValue;
  }
  return left.title.localeCompare(right.title);
}

function normalizeResult(material, raw, options = {}) {
  const title = cleanText(raw.title || "");
  const colorProfile = extractColorProfile(title);
  const shippingText = cleanText(raw.shippingText || "");
  const deliveryText = cleanText(raw.deliveryText || "");
  const badgeText = cleanText(raw.badgeText || "");
  const availabilityNote = cleanText([shippingText, deliveryText, badgeText].filter(Boolean).join(" | "));
  const discountText = cleanText(raw.discountText || "");
  const shipping = parsePrice(shippingText);
  const importFees = parsePrice(cleanText(raw.importFeesText));
  const productPrice = parsePrice(cleanText(raw.priceText));
  const destinationConfirmed = options.destinationConfirmed !== false;
  const freeShippingMode = options.freeShippingMode === true;
  const discountPercent = parseDiscountPercent(discountText);
  const hasDiscount = hasDiscountSignal(discountText);

  const explicitFreeShipping = hasExplicitFreeShippingSignal(shippingText, deliveryText, badgeText);
  const explicitPaidShipping = hasExplicitPaidShippingSignal(shippingText, deliveryText, badgeText);
  const thresholdFreeShipping = raw.thresholdFreeShipping === true;
  const minimumFreeShippingQuantity = Number.isFinite(Number(raw.minimumFreeShippingQuantity))
    ? Number(raw.minimumFreeShippingQuantity)
    : null;
  const freeShippingSubtotal = Number.isFinite(Number(raw.freeShippingSubtotal))
    ? Number(raw.freeShippingSubtotal)
    : null;
  const quantityOneShipping = parsePrice(cleanText(raw.quantityOneShippingText || ""));
  const parsedShippingStatus = parseShippingStatus(shippingText, deliveryText, badgeText);
  const amazonFilteredEligible =
    freeShippingMode &&
    options.filteredEligible === true &&
    parsedShippingStatus !== "not_shippable";
  const shippingStatus = thresholdFreeShipping
    ? "free_over_threshold_to_israel"
    : amazonFilteredEligible && parsedShippingStatus === "unknown"
      ? "free_to_israel"
      : parsedShippingStatus;
  const freeShipping = (
    ["free_to_israel", "free_over_threshold_to_israel"].includes(shippingStatus) ||
    ((explicitFreeShipping && !explicitPaidShipping) || thresholdFreeShipping || amazonFilteredEligible)
  );
  const freeShippingKind = thresholdFreeShipping
    ? "threshold"
    : explicitFreeShipping && !explicitPaidShipping
      ? "single-item"
      : amazonFilteredEligible
        ? "amazon-filter"
        : "none";
  const blockedShipping = /cannot be shipped|does not ship|not available|currently unavailable/i.test(
    availabilityNote
  );
  const explicitIsraelSignal = /Israel/i.test(availabilityNote);
  const shipsToIsrael = !blockedShipping && (
    explicitIsraelSignal ||
    destinationConfirmed ||
    ["free_to_israel", "free_over_threshold_to_israel", "paid_shipping"].includes(shippingStatus)
  );

  const shippingValue = freeShipping ? 0 : shipping ? shipping.value : null;
  const basePriceValue = thresholdFreeShipping && freeShippingSubtotal != null
    ? freeShippingSubtotal
    : productPrice
      ? productPrice.value
      : 0;
  const totalValue = computeTotal(basePriceValue, shippingValue, importFees ? importFees.value : null);
  const spoolInfo = parseSpoolInfo(title) || { packCount: 1, spoolKg: 1, totalKg: 1 };
  const pricePerKg = productPrice && spoolInfo.totalKg
    ? totalValue / spoolInfo.totalKg
    : null;

  return {
    material,
    title,
    colorKey: colorProfile.colorKey,
    colorLabel: colorProfile.colorLabel,
    shadeKey: colorProfile.shadeKey,
    shadeLabel: colorProfile.shadeLabel,
    asin: raw.asin || extractAsin(raw.url),
    url: raw.url,
    imageUrl: raw.imageUrl || "",
    priceValue: productPrice ? productPrice.value : null,
    shippingValue,
    importFeesValue: importFees ? importFees.value : null,
    totalValue,
    packCount: spoolInfo.packCount,
    spoolKg: spoolInfo.spoolKg,
    totalKg: spoolInfo.totalKg,
    pricePerKg,
    currency: productPrice ? productPrice.currency : shipping ? shipping.currency : importFees ? importFees.currency : "$",
    shipsToIsrael,
    freeShipping,
    shippingStatus,
    freeShippingKind,
    minimumFreeShippingQuantity,
    freeShippingSubtotal,
    shippingAtQuantityOne: quantityOneShipping ? quantityOneShipping.value : null,
    hasDiscount,
    discountText,
    discountPercent,
    availabilityNote: availabilityNote || "No shipping note found.",
    sourcePage: raw.sourcePage || "search",
    capturedAt: raw.capturedAt
  };
}

function dedupeAndSort(results) {
  const deduped = new Map();

  for (const result of results) {
    const key = result.asin || `${result.material}:${result.title.toLowerCase()}`;
    const existing = deduped.get(key);
    if (!existing || result.totalValue < existing.totalValue) {
      deduped.set(key, result);
    }
  }

  return selectCheapestWithColorCoverage([...deduped.values()]);
}

function selectCheapestWithColorCoverage(results, limit = RESULT_LIMIT, extraCoverageLimit = 12) {
  const sortedResults = [...results].sort(compareCheapestResults);
  if (!limit || limit <= 0) {
    return sortedResults;
  }
  if (sortedResults.length <= limit) {
    return sortedResults;
  }

  const selected = sortedResults.slice(0, limit);
  const seenColors = new Set(selected.map((result) => result.colorKey || "other-colors"));
  const seenShades = new Set(selected.map((result) => result.shadeKey || result.colorKey || "other-colors"));
  const extras = [];

  for (const result of sortedResults.slice(limit)) {
    if (extras.length >= extraCoverageLimit) {
      break;
    }

    const colorKey = result.colorKey || "other-colors";
    const shadeKey = result.shadeKey || colorKey;
    const addsMissingColor = colorKey !== "other-colors" && !seenColors.has(colorKey);
    const addsMissingShade = shadeKey !== colorKey && !seenShades.has(shadeKey);

    if (!addsMissingColor && !addsMissingShade) {
      continue;
    }

    extras.push(result);
    seenColors.add(colorKey);
    seenShades.add(shadeKey);
  }

  return [...selected, ...extras].sort(compareCheapestResults);
}

function mergeDiscountsIntoCheapestRange(cheapestResults, discountedResults) {
  if (!cheapestResults.length || !discountedResults.length) {
    return cheapestResults;
  }

  const maxCheapestPrice = Math.max(...cheapestResults.map((result) => result.totalValue ?? Number.POSITIVE_INFINITY));
  const merged = new Map();

  for (const result of cheapestResults) {
    const key = result.asin || `${result.material}:${result.title.toLowerCase()}`;
    merged.set(key, result);
  }

  for (const result of discountedResults) {
    const totalValue = result.totalValue ?? Number.POSITIVE_INFINITY;
    if (totalValue > maxCheapestPrice) {
      continue;
    }

    const key = result.asin || `${result.material}:${result.title.toLowerCase()}`;
    const existing = merged.get(key);
    if (!existing || totalValue < (existing.totalValue ?? Number.POSITIVE_INFINITY)) {
      merged.set(key, result);
    }
  }

  return [...merged.values()].sort(compareCheapestResults);
}

function dedupeAndSortDiscounted(results) {
  const deduped = new Map();

  for (const result of results) {
    const key = result.asin || `${result.material}:${result.title.toLowerCase()}`;
    const existing = deduped.get(key);
    if (
      !existing ||
      (result.discountPercent ?? -1) > (existing.discountPercent ?? -1) ||
      (
        (result.discountPercent ?? -1) === (existing.discountPercent ?? -1) &&
        (result.priceValue ?? Number.POSITIVE_INFINITY) < (existing.priceValue ?? Number.POSITIVE_INFINITY)
      )
    ) {
      deduped.set(key, result);
    }
  }

  const sorted = [...deduped.values()]
    .sort((a, b) => {
      const percentDelta = (b.discountPercent ?? -1) - (a.discountPercent ?? -1);
      if (percentDelta !== 0) {
        return percentDelta;
      }
      const aMissingPrice = a.priceValue == null ? 1 : 0;
      const bMissingPrice = b.priceValue == null ? 1 : 0;
      if (aMissingPrice !== bMissingPrice) {
        return aMissingPrice - bMissingPrice;
      }
      if (a.priceValue !== b.priceValue) {
        return (a.priceValue ?? Number.POSITIVE_INFINITY) - (b.priceValue ?? Number.POSITIVE_INFINITY);
      }
      return a.title.localeCompare(b.title);
    });

  return RESULT_LIMIT > 0 ? sorted.slice(0, RESULT_LIMIT) : sorted;
}

function normalizeMaterialResults(material, rawResults, options = {}) {
  const eligibleResults = rawResults
    .filter((item) => materialMatches(material, item.title))
    .map((item) => normalizeResult(material, item, options))
    .filter((item) => item.shipsToIsrael)
    .filter((item) => (options.freeShippingMode ? item.freeShipping : true));
  const discountedResults = dedupeAndSortDiscounted(eligibleResults.filter((item) => item.hasDiscount));
  const cheapestResults = mergeDiscountsIntoCheapestRange(dedupeAndSort(eligibleResults), discountedResults);

  return {
    results: cheapestResults,
    discountedResults
  };
}

module.exports = {
  compareCheapestResults,
  computeTotal,
  dedupeAndSort,
  dedupeAndSortDiscounted,
  extractAsin,
  hasDiscountSignal,
  materialMatches,
  mergeDiscountsIntoCheapestRange,
  normalizeMaterialResults,
  parseDiscountPercent,
  parseShippingStatus,
  parseSpoolInfo,
  parsePrice,
  selectCheapestWithColorCoverage
};
