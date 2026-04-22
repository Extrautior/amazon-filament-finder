const { RESULT_LIMIT } = require("./config");

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
  const exact = new RegExp(`\\b${material}\\b`, "i");
  if (!exact.test(normalizedTitle)) {
    if (!(material === "PLA" && /\bPLA\+\b/i.test(normalizedTitle))) {
      return false;
    }
  }

  if (!/\b(?:1\s?(?:KG|KILO|KILOGRAM)|2\.2\s?LBS?)\b/i.test(normalizedTitle)) {
    return false;
  }

  const exclusions = {
    PLA: ["PETG", "ABS", "TPU"],
    PETG: ["PLA", "ABS", "TPU"],
    ABS: ["PLA", "PETG", "TPU"],
    TPU: ["PLA", "PETG", "ABS"]
  };

  const excludedMaterials = exclusions[material] || [];

  return !excludedMaterials.some((other) => {
    if (material === "PLA" && /\bPLA\+\b/i.test(normalizedTitle) && other === "PLA") {
      return false;
    }
    return new RegExp(`\\b${other}\\b`, "i").test(normalizedTitle);
  });
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

function normalizeResult(material, raw, options = {}) {
  const title = cleanText(raw.title || "");
  const availabilityNote = cleanText([raw.shippingText, raw.deliveryText, raw.badgeText].filter(Boolean).join(" | "));
  const discountText = cleanText(raw.discountText || "");
  const shipping = parsePrice(cleanText(raw.shippingText));
  const importFees = parsePrice(cleanText(raw.importFeesText));
  const productPrice = parsePrice(cleanText(raw.priceText));
  const destinationConfirmed = options.destinationConfirmed !== false;
  const freeShippingMode = options.freeShippingMode === true;
  const filteredEligible = options.filteredEligible === true;
  const discountPercent = parseDiscountPercent(discountText);
  const hasDiscount = hasDiscountSignal(discountText);

  const freeShipping =
    filteredEligible ||
    /free shipping/i.test(raw.shippingText || "") ||
    /free delivery/i.test(raw.deliveryText || "") ||
    /free shipping/i.test(raw.badgeText || "");
  const blockedShipping = /cannot be shipped|unavailable|does not ship|not available|currently unavailable/i.test(
    availabilityNote
  );
  const explicitIsraelSignal = /Israel/i.test(availabilityNote);
  const shipsToIsrael = !blockedShipping && (filteredEligible || freeShippingMode || destinationConfirmed || explicitIsraelSignal);

  const shippingValue = freeShipping ? 0 : shipping ? shipping.value : null;
  const totalValue = computeTotal(productPrice ? productPrice.value : 0, shippingValue, importFees ? importFees.value : null);

  return {
    material,
    title,
    asin: raw.asin || extractAsin(raw.url),
    url: raw.url,
    imageUrl: raw.imageUrl || "",
    priceValue: productPrice ? productPrice.value : null,
    shippingValue,
    importFeesValue: importFees ? importFees.value : null,
    totalValue,
    currency: productPrice ? productPrice.currency : shipping ? shipping.currency : importFees ? importFees.currency : "$",
    shipsToIsrael,
    freeShipping,
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

  return [...deduped.values()]
    .sort((a, b) => {
      const aMissingPrice = a.priceValue == null ? 1 : 0;
      const bMissingPrice = b.priceValue == null ? 1 : 0;
      if (aMissingPrice !== bMissingPrice) {
        return aMissingPrice - bMissingPrice;
      }
      if (a.priceValue !== b.priceValue) {
        return (a.priceValue ?? Number.POSITIVE_INFINITY) - (b.priceValue ?? Number.POSITIVE_INFINITY);
      }
      if (a.totalValue !== b.totalValue) {
        return a.totalValue - b.totalValue;
      }
      return a.title.localeCompare(b.title);
    })
    .slice(0, RESULT_LIMIT);
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

  return [...deduped.values()]
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
    })
    .slice(0, RESULT_LIMIT);
}

function normalizeMaterialResults(material, rawResults, options = {}) {
  const eligibleResults = rawResults
    .filter((item) => materialMatches(material, item.title))
    .map((item) => normalizeResult(material, item, options))
    .filter((item) => item.shipsToIsrael)
    .filter((item) => ((options.freeShippingMode && !options.filteredEligible) ? item.freeShipping : true));

  return {
    results: dedupeAndSort(eligibleResults),
    discountedResults: dedupeAndSortDiscounted(eligibleResults.filter((item) => item.hasDiscount))
  };
}

module.exports = {
  computeTotal,
  dedupeAndSort,
  dedupeAndSortDiscounted,
  extractAsin,
  hasDiscountSignal,
  materialMatches,
  normalizeMaterialResults,
  parseDiscountPercent,
  parsePrice
};
