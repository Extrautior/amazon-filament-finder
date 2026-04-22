const test = require("node:test");
const assert = require("node:assert/strict");
const {
  detectNewDeals,
  formatDiscordDealMessage,
  markDealsAsNotified
} = require("../src/dealNotifications");

function payloadForDeals({ searchedAt = "2026-04-22T08:00:00.000Z", cheapest = [], discounted = [] } = {}) {
  return {
    searchedAt,
    marketplace: "amazon.com",
    searchPlan: [{ key: "PLA", label: "PLA", query: "PLA filament" }],
    resultsByMaterial: { PLA: cheapest },
    discountedResultsByMaterial: { PLA: discounted },
    warnings: []
  };
}

test("detectNewDeals only returns deals absent from the previous payload", () => {
  const previous = payloadForDeals({
    cheapest: [{ asin: "B000000001", title: "Old PLA", url: "https://example.test/1", priceValue: 19.99, totalValue: 19.99, currency: "$" }]
  });
  const current = payloadForDeals({
    cheapest: [
      { asin: "B000000001", title: "Old PLA", url: "https://example.test/1", priceValue: 19.99, totalValue: 19.99, currency: "$" },
      { asin: "B000000002", title: "New PLA", url: "https://example.test/2", priceValue: 17.99, totalValue: 17.99, currency: "$" }
    ],
    discounted: [
      {
        asin: "B000000003",
        title: "Discount PLA",
        url: "https://example.test/3",
        priceValue: 24.99,
        totalValue: 24.99,
        currency: "$",
        discountPercent: 25,
        discountText: "Save 25% at checkout"
      }
    ]
  });

  const result = detectNewDeals(current, previous, { notified: {} }, { now: new Date("2026-04-22T08:05:00.000Z") });
  assert.equal(result.newDeals.length, 2);
  assert.equal(result.newDeals[0].title, "New PLA");
  assert.equal(result.newDeals[1].title, "Discount PLA");
});

test("detectNewDeals suppresses already notified deals", () => {
  const current = payloadForDeals({
    cheapest: [{ asin: "B000000002", title: "New PLA", url: "https://example.test/2", priceValue: 17.99, totalValue: 17.99, currency: "$" }]
  });

  const firstPass = detectNewDeals(current, null, { notified: {} }, { now: new Date("2026-04-22T08:05:00.000Z") });
  const state = markDealsAsNotified(firstPass.state, firstPass.newDeals, new Date("2026-04-22T08:05:00.000Z"));
  const secondPass = detectNewDeals(current, null, state, { now: new Date("2026-04-22T08:10:00.000Z") });

  assert.equal(secondPass.newDeals.length, 0);
});

test("formatDiscordDealMessage builds one summary payload", () => {
  const payload = payloadForDeals();
  const message = formatDiscordDealMessage(payload, [
    {
      category: "cheapest",
      sectionLabel: "PLA",
      title: "PLA Deal",
      url: "https://example.test/1",
      priceValue: 18.99,
      totalValue: 18.99,
      currency: "$"
    }
  ]);

  assert.match(message.content, /New filament deals found/);
  assert.match(message.content, /PLA cheapest/);
  assert.match(message.content, /https:\/\/example\.test\/1/);
});
