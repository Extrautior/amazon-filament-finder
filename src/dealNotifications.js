function slug(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function dealFingerprint(deal) {
  return [
    deal.category,
    deal.sectionKey,
    deal.asin || slug(deal.title),
    deal.category === "discounted" ? (deal.discountPercent ?? deal.discountText ?? "") : ""
  ].join("|");
}

function flattenDeals(payload) {
  if (!payload || typeof payload !== "object") {
    return [];
  }

  const sections = Array.isArray(payload.searchPlan) ? payload.searchPlan : [];
  const cheapest = [];
  const discounted = [];

  for (const section of sections) {
    const sectionKey = section.key;
    const sectionLabel = section.label;

    for (const item of payload.resultsByMaterial?.[sectionKey] || []) {
      cheapest.push({
        category: "cheapest",
        sectionKey,
        sectionLabel,
        asin: item.asin || "",
        title: item.title || "",
        url: item.url || "",
        priceValue: item.priceValue ?? null,
        totalValue: item.totalValue ?? null,
        currency: item.currency || "$",
        hasDiscount: item.hasDiscount === true,
        discountPercent: item.discountPercent ?? null,
        discountText: item.discountText || ""
      });
    }

    for (const item of payload.discountedResultsByMaterial?.[sectionKey] || []) {
      discounted.push({
        category: "discounted",
        sectionKey,
        sectionLabel,
        asin: item.asin || "",
        title: item.title || "",
        url: item.url || "",
        priceValue: item.priceValue ?? null,
        totalValue: item.totalValue ?? null,
        currency: item.currency || "$",
        hasDiscount: item.hasDiscount === true,
        discountPercent: item.discountPercent ?? null,
        discountText: item.discountText || ""
      });
    }
  }

  return cheapest.concat(discounted);
}

function previousFingerprintSet(previousPayload) {
  return new Set(flattenDeals(previousPayload).map((deal) => dealFingerprint(deal)));
}

function pruneNotifiedState(state, now = new Date(), retentionDays = 14) {
  const cutoff = now.getTime() - retentionDays * 24 * 60 * 60 * 1000;
  const source = state && typeof state === "object" && state.notified ? state.notified : {};
  const notified = Object.fromEntries(
    Object.entries(source).filter(([, timestamp]) => {
      const parsed = Date.parse(timestamp);
      return Number.isFinite(parsed) && parsed >= cutoff;
    })
  );

  return { notified };
}

function detectNewDeals(currentPayload, previousPayload, state, options = {}) {
  const now = options.now instanceof Date ? options.now : new Date();
  const retentionDays = Number.isFinite(options.retentionDays) ? options.retentionDays : 14;
  const currentDeals = flattenDeals(currentPayload);
  const previousDeals = previousFingerprintSet(previousPayload);
  const normalizedState = pruneNotifiedState(state, now, retentionDays);

  const newDeals = currentDeals.filter((deal) => {
    const fingerprint = dealFingerprint(deal);
    return !previousDeals.has(fingerprint) && !normalizedState.notified[fingerprint];
  });

  return {
    newDeals,
    state: normalizedState
  };
}

function money(value, currency) {
  if (value == null) {
    return "N/A";
  }

  const prefixCurrencies = new Set(["$", "EUR", "GBP", "₪"]);
  if (prefixCurrencies.has(currency)) {
    return currency === "EUR" || currency === "GBP"
      ? `${value.toFixed(2)} ${currency}`
      : `${currency}${value.toFixed(2)}`;
  }

  return `${value.toFixed(2)} ${currency}`;
}

function truncate(value, maxLength) {
  const normalized = String(value || "").replace(/\s+/g, " ").trim();
  if (normalized.length <= maxLength) {
    return normalized;
  }
  return `${normalized.slice(0, Math.max(0, maxLength - 3)).trim()}...`;
}

function markDealsAsNotified(state, deals, now = new Date()) {
  const normalizedState = pruneNotifiedState(state, now);
  const timestamp = now.toISOString();

  for (const deal of deals) {
    normalizedState.notified[dealFingerprint(deal)] = timestamp;
  }

  return normalizedState;
}

function dealLine(deal, maxLength = 280) {
  const prefix = `${deal.sectionLabel} ${deal.category === "discounted" ? "discounted" : "cheapest"}`;
  const priceBits = [`Item ${money(deal.priceValue, deal.currency)}`, `Total ${money(deal.totalValue, deal.currency)}`];
  if (deal.category === "discounted" && (deal.discountPercent != null || deal.discountText)) {
    priceBits.push(deal.discountPercent != null ? `Save ${deal.discountPercent}%` : truncate(deal.discountText, 32));
  }

  const url = truncate(deal.url, 140);
  const baseLines = [
    `• **${prefix}** ${truncate(deal.title, 100)}`,
    `  ${priceBits.join(" · ")}`,
    `  ${url}`
  ];

  let block = baseLines.join("\n");
  if (block.length <= maxLength) {
    return block;
  }

  const availableTitleLength = Math.max(24, 100 - (block.length - maxLength));
  baseLines[0] = `• **${prefix}** ${truncate(deal.title, availableTitleLength)}`;
  block = baseLines.join("\n");
  if (block.length <= maxLength) {
    return block;
  }

  const availableUrlLength = Math.max(48, 140 - (block.length - maxLength));
  baseLines[2] = `  ${truncate(deal.url, availableUrlLength)}`;
  return baseLines.join("\n");
}

function buildDiscordHeader(payload, deals) {
  const searchedAt = payload?.searchedAt ? new Date(payload.searchedAt).toLocaleString("en-GB", { hour12: false }) : "Unknown time";
  const cheapestCount = deals.filter((deal) => deal.category === "cheapest").length;
  const discountedCount = deals.filter((deal) => deal.category === "discounted").length;

  return [
    `**New filament deals found**`,
    `Search finished at ${searchedAt}`,
    `Cheapest: ${cheapestCount} new · Discounted: ${discountedCount} new`
  ];
}

function formatDiscordDealMessages(payload, deals, options = {}) {
  const maxItems = Number.isFinite(options.maxItems) ? options.maxItems : 6;
  const maxLength = Number.isFinite(options.maxLength) ? options.maxLength : 1800;
  const shownDeals = deals.slice(0, maxItems);
  const headerLines = buildDiscordHeader(payload, deals);
  const messages = [];
  let currentLines = [...headerLines, ""];
  const primaryHeaderLength = currentLines.join("\n").length;
  const secondaryHeader = ["**More new filament deals**", ""];
  const secondaryHeaderLength = secondaryHeader.join("\n").length;

  for (const deal of shownDeals) {
    const nextBlock = dealLine(deal, Math.max(220, maxLength - 120));
    const candidate = [...currentLines, nextBlock].join("\n");
    const activeHeaderLength = messages.length === 0 ? primaryHeaderLength : secondaryHeaderLength;
    const hasExistingBlocks = currentLines.join("\n").length > activeHeaderLength;
    if (candidate.length > maxLength && hasExistingBlocks) {
      messages.push({ content: currentLines.join("\n") });
      currentLines = [...secondaryHeader, nextBlock];
      continue;
    }

    currentLines.push(nextBlock);
  }

  if (deals.length > shownDeals.length) {
    const tailLine = `…and ${deals.length - shownDeals.length} more deal${deals.length - shownDeals.length === 1 ? "" : "s"} from the same run.`;
    const candidate = [...currentLines, "", tailLine].join("\n");
    const activeHeaderLength = messages.length === 0 ? primaryHeaderLength : secondaryHeaderLength;
    const hasExistingBlocks = currentLines.join("\n").length > activeHeaderLength;
    if (candidate.length > maxLength && hasExistingBlocks) {
      messages.push({ content: currentLines.join("\n") });
      currentLines = [...secondaryHeader, tailLine];
    } else {
      currentLines.push("", tailLine);
    }
  }

  if (currentLines.filter(Boolean).length) {
    messages.push({ content: currentLines.join("\n") });
  }

  return messages;
}

module.exports = {
  dealFingerprint,
  detectNewDeals,
  flattenDeals,
  formatDiscordDealMessages,
  markDealsAsNotified,
  pruneNotifiedState
};
