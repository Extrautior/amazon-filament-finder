const test = require("node:test");
const assert = require("node:assert/strict");
const { materialMatches, parsePrice, normalizeMaterialResults } = require("../src/amazonParser");
const { payloadToCsv } = require("../src/export");
const { isProfileLockError } = require("../src/search");

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
  const results = normalizeMaterialResults("PLA", [
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

  assert.equal(results.length, 2);
  assert.equal(results[0].title, "Cheap PLA Filament 1kg");
  assert.equal(results[1].title, "Brand PLA Filament 1kg");
});

test("normalizeMaterialResults keeps items without explicit Israel text when the session destination is already confirmed", () => {
  const results = normalizeMaterialResults("PETG", [
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

  assert.equal(results.length, 1);
  assert.equal(results[0].title, "PETG Filament Black 1kg");
});

test("normalizeMaterialResults keeps only free-shipping items in free-shipping mode", () => {
  const results = normalizeMaterialResults("ABS", [
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

  assert.equal(results.length, 1);
  assert.equal(results[0].title, "ABS Filament Free Shipping 1kg");
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
          availabilityNote: "FREE delivery",
          capturedAt: "2026-04-21T12:00:00.000Z"
        }
      ],
      PETG: [],
      ABS: [],
      TPU: []
    }
  });

  assert.match(csv, /material,rank,title,asin/);
  assert.match(csv, /PLA/);
  assert.match(csv, /B000000001/);
});

test("isProfileLockError detects Chromium profile lock failures", () => {
  assert.equal(
    isProfileLockError(new Error("Failed to create a ProcessSingleton for your profile directory.")),
    true
  );
  assert.equal(isProfileLockError(new Error("Random unrelated failure")), false);
});
