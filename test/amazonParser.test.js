const test = require("node:test");
const assert = require("node:assert/strict");
const { materialMatches, parsePrice, normalizeMaterialResults, parseDiscountPercent } = require("../src/amazonParser");
const { payloadToCsv } = require("../src/export");
const { buildSearchPlan, isProfileLockError, pickStandardPriceText } = require("../src/search");

test("parsePrice extracts currency and value", () => {
  assert.deepEqual(parsePrice("$29.99"), { currency: "$", value: 29.99 });
  assert.deepEqual(parsePrice("ILS 147.99"), { currency: "ILS", value: 147.99 });
  assert.deepEqual(parsePrice("₪147.99"), { currency: "₪", value: 147.99 });
});

test("materialMatches keeps strict material matches", () => {
  assert.equal(materialMatches("PLA", "Overture PLA Filament 1kg 1.75mm"), true);
  assert.equal(materialMatches("PLA", "PLA PETG sample bundle 1kg"), false);
  assert.equal(materialMatches("TPU", "ABS tough spool 1kg"), false);
});

test("normalizeMaterialResults filters Israel-eligible items and sorts by total", () => {
  const payload = normalizeMaterialResults("PLA", [
    {
      title: "Brand PLA Filament 1kg",
      url: "https://www.amazon.com/dp/B000000001",
      priceText: "$20.00",
      shippingText: "FREE delivery to Israel",
      deliveryText: "FREE delivery to Israel",
      importFeesText: "$2.00 Import Fees Deposit",
      sourcePage: "search",
      capturedAt: "2026-04-21T12:00:00.000Z"
    },
    {
      title: "Cheap PLA Filament 1kg",
      url: "https://www.amazon.com/dp/B000000002",
      priceText: "$18.00",
      shippingText: "$6.00 shipping to Israel",
      deliveryText: "$6.00 shipping to Israel",
      importFeesText: "",
      sourcePage: "search",
      capturedAt: "2026-04-21T12:00:00.000Z"
    },
    {
      title: "Wrong Material PETG 1kg",
      url: "https://www.amazon.com/dp/B000000003",
      priceText: "$10.00",
      shippingText: "FREE delivery to Israel",
      deliveryText: "FREE delivery to Israel",
      importFeesText: "",
      sourcePage: "search",
      capturedAt: "2026-04-21T12:00:00.000Z"
    }
  ], { destinationConfirmed: true });
  const results = payload.results;

  assert.equal(results.length, 2);
  assert.equal(results[0].title, "Cheap PLA Filament 1kg");
  assert.equal(results[1].title, "Brand PLA Filament 1kg");
});

test("normalizeMaterialResults keeps items without explicit Israel text when the session destination is already confirmed", () => {
  const payload = normalizeMaterialResults("PETG", [
    {
      title: "PETG Filament Black 1kg",
      url: "https://www.amazon.com/dp/B000000004",
      priceText: "$24.00",
      shippingText: "FREE delivery Friday",
      deliveryText: "FREE delivery Friday",
      importFeesText: "",
      sourcePage: "search",
      capturedAt: "2026-04-21T12:00:00.000Z"
    }
  ], { destinationConfirmed: true });
  const results = payload.results;

  assert.equal(results.length, 1);
  assert.equal(results[0].title, "PETG Filament Black 1kg");
});

test("normalizeMaterialResults keeps only free-shipping items in free-shipping mode", () => {
  const payload = normalizeMaterialResults("ABS", [
    {
      title: "ABS Filament Free Shipping 1kg",
      url: "https://www.amazon.com/dp/B000000005",
      priceText: "$22.00",
      shippingText: "FREE delivery Friday",
      deliveryText: "FREE delivery Friday",
      importFeesText: "",
      sourcePage: "search",
      capturedAt: "2026-04-21T12:00:00.000Z"
    },
    {
      title: "ABS Filament Paid Shipping 1kg",
      url: "https://www.amazon.com/dp/B000000006",
      priceText: "$15.00",
      shippingText: "$7.00 shipping",
      deliveryText: "$7.00 shipping",
      importFeesText: "",
      sourcePage: "search",
      capturedAt: "2026-04-21T12:00:00.000Z"
    }
  ], { freeShippingMode: true });
  const results = payload.results;

  assert.equal(results.length, 1);
  assert.equal(results[0].title, "ABS Filament Free Shipping 1kg");
});

test("normalizeMaterialResults splits discounted deals into a separate result group", () => {
  const payload = normalizeMaterialResults("PLA", [
    {
      title: "Discount PLA Filament 1kg",
      url: "https://www.amazon.com/dp/B000000010",
      priceText: "$28.99",
      shippingText: "FREE delivery to Israel",
      deliveryText: "FREE delivery to Israel",
      importFeesText: "",
      discountText: "Save 25% at checkout",
      sourcePage: "search",
      capturedAt: "2026-04-21T12:00:00.000Z"
    },
    {
      title: "Plain PLA Filament 1kg",
      url: "https://www.amazon.com/dp/B000000011",
      priceText: "$19.99",
      shippingText: "FREE delivery to Israel",
      deliveryText: "FREE delivery to Israel",
      importFeesText: "",
      sourcePage: "search",
      capturedAt: "2026-04-21T12:00:00.000Z"
    }
  ], { destinationConfirmed: true, freeShippingMode: true });

  assert.equal(payload.results.length, 2);
  assert.equal(payload.discountedResults.length, 1);
  assert.equal(payload.discountedResults[0].title, "Discount PLA Filament 1kg");
  assert.equal(payload.discountedResults[0].discountPercent, 25);
});

test("materialMatches rejects titles that mention a different material", () => {
  assert.equal(materialMatches("PLA", "PLA filament 1kg sample next to PETG spool"), false);
  assert.equal(materialMatches("PETG", "PETG filament 1kg bundle with ABS tools"), false);
});

test("materialMatches requires a 1kg-style spool size", () => {
  assert.equal(materialMatches("PLA", "PLA Filament 1kg Spool 1.75mm"), true);
  assert.equal(materialMatches("PLA", "PLA Filament 250g Sample Pack"), false);
  assert.equal(materialMatches("PLA", "PLA+ Filament 2.2lbs Spool"), true);
});

test("payloadToCsv exports normalized result rows", () => {
  const csv = payloadToCsv({
    searchedAt: "2026-04-21T12:00:00.000Z",
    marketplace: "amazon.com",
    warnings: [],
    searchPlan: [{ key: "PLA", label: "PLA", query: "PLA filament" }],
    resultsByMaterial: {
      PLA: [
        {
          title: "PLA Filament 1kg",
          asin: "B000000001",
          url: "https://www.amazon.com/dp/B000000001",
          imageUrl: "https://images.example.test/pla.jpg",
          priceValue: 19.99,
          shippingValue: 0,
          importFeesValue: 1.5,
          totalValue: 21.49,
          currency: "$",
          freeShipping: true,
          hasDiscount: true,
          discountText: "Save 25% at checkout",
          discountPercent: 25,
          availabilityNote: "FREE delivery",
          capturedAt: "2026-04-21T12:00:00.000Z"
        }
      ],
      PETG: [],
      ABS: [],
      TPU: []
    },
    discountedResultsByMaterial: {
      PLA: [
        {
          title: "PLA Filament 1kg",
          asin: "B000000001",
          url: "https://www.amazon.com/dp/B000000001",
          imageUrl: "https://images.example.test/pla.jpg",
          priceValue: 19.99,
          shippingValue: 0,
          importFeesValue: 1.5,
          totalValue: 21.49,
          currency: "$",
          freeShipping: true,
          hasDiscount: true,
          discountText: "Save 25% at checkout",
          discountPercent: 25,
          availabilityNote: "FREE delivery",
          capturedAt: "2026-04-21T12:00:00.000Z"
        }
      ]
    }
  });

  assert.match(csv, /material,resultType,rank,title,asin/);
  assert.match(csv, /PLA/);
  assert.match(csv, /discounted/);
  assert.match(csv, /Save 25% at checkout/);
  assert.match(csv, /B000000001/);
});

test("parseDiscountPercent extracts checkout discount percentages", () => {
  assert.equal(parseDiscountPercent("Save 25% at checkout"), 25);
  assert.equal(parseDiscountPercent("Extra 15% off coupon applied at checkout"), 15);
  assert.equal(parseDiscountPercent("No discount text"), null);
});

test("isProfileLockError detects Chromium profile lock failures", () => {
  assert.equal(
    isProfileLockError(new Error("Failed to create a ProcessSingleton for your profile directory.")),
    true
  );
  assert.equal(isProfileLockError(new Error("Random unrelated failure")), false);
});

test("buildSearchPlan uses only the custom term when no materials are selected", () => {
  const plan = buildSearchPlan({ customTerm: "ASA filament" });

  assert.deepEqual(plan, [
    {
      key: "asa-filament",
      label: "ASA filament",
      query: "ASA filament"
    }
  ]);
});

test("pickStandardPriceText prefers the regular listing price over Prime-only pricing", () => {
  const priceText = pickStandardPriceText([
    {
      text: "$17.99",
      context: "Prime exclusive price $17.99 with Prime"
    },
    {
      text: "$23.99",
      context: "$23.99 FREE delivery to Israel"
    }
  ]);

  assert.equal(priceText, "$23.99");
});

test("pickStandardPriceText falls back to the only price when no standard price is present", () => {
  const priceText = pickStandardPriceText([
    {
      text: "$17.99",
      context: "Prime exclusive price $17.99 with Prime"
    }
  ]);

  assert.equal(priceText, "$17.99");
});
