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

function markDealsAsNotified(state, deals, now = new Date()) {
  const normalizedState = pruneNotifiedState(state, now);
  const timestamp = now.toISOString();

  for (const deal of deals) {
    normalizedState.notified[dealFingerprint(deal)] = timestamp;
  }

  return normalizedState;
}

function formatDiscordDealMessage(payload, deals, options = {}) {
  const maxItems = Number.isFinite(options.maxItems) ? options.maxItems : 8;
  const searchedAt = payload?.searchedAt ? new Date(payload.searchedAt).toLocaleString("en-GB", { hour12: false }) : "Unknown time";
  const cheapestCount = deals.filter((deal) => deal.category === "cheapest").length;
  const discountedCount = deals.filter((deal) => deal.category === "discounted").length;
  const shownDeals = deals.slice(0, maxItems);

  const content = [
    `**New filament deals found**`,
    `Search finished at ${searchedAt}`,
    `Cheapest: ${cheapestCount} new · Discounted: ${discountedCount} new`,
    "",
    ...shownDeals.map((deal) => {
      const priceLine = `Item ${money(deal.priceValue, deal.currency)} · Total ${money(deal.totalValue, deal.currency)}`;
      const discountLine =
        deal.category === "discounted" && (deal.discountPercent != null || deal.discountText)
          ? ` · ${deal.discountPercent != null ? `Save ${deal.discountPercent}%` : deal.discountText}`
          : "";
      return `• **${deal.sectionLabel} ${deal.category === "discounted" ? "discounted" : "cheapest"}**: ${deal.title}\n  ${priceLine}${discountLine}\n  ${deal.url}`;
    }),
    deals.length > shownDeals.length ? `\n…and ${deals.length - shownDeals.length} more.` : ""
  ].filter(Boolean).join("\n");

  return { content };
}

module.exports = {
  dealFingerprint,
  detectNewDeals,
  flattenDeals,
  formatDiscordDealMessage,
  markDealsAsNotified,
  pruneNotifiedState
};
