const test = require("node:test");
const assert = require("node:assert/strict");
const {
  materialMatches,
  parsePrice,
  normalizeMaterialResults,
  parseDiscountPercent,
  parseShippingStatus,
  parseSpoolInfo,
  selectCheapestWithColorCoverage,
  mergeDiscountsIntoCheapestRange
} = require("../src/amazonParser");
const { payloadToCsv } = require("../src/export");
const {
  buildSearchPlan,
  extractProductPageDeliveryText,
  extractProductPageRegularPrice,
  buildQuantityProbeList,
  extractAsinFromAmazonHref,
  buildSearchUrl,
  isProfileLockError,
  pickStandardPriceText,
  resolveAmazonUrl
} = require("../src/search");
const { extractColorProfile } = require("../src/colorProfile");

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

test("normalizeMaterialResults filters Israel-eligible items and sorts by delivered price per kg", () => {
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
  assert.equal(results[0].title, "Brand PLA Filament 1kg");
  assert.equal(results[1].title, "Cheap PLA Filament 1kg");
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

test("normalizeMaterialResults trusts Amazon free-shipping filtered results in free-shipping mode", () => {
  const payload = normalizeMaterialResults("PLA", [
    {
      title: "PLA Filament Claimed Eligible 1kg",
      url: "https://www.amazon.com/dp/B000000007",
      priceText: "$15.00",
      shippingText: "$6.99 shipping to Israel",
      deliveryText: "Delivery Friday to Israel",
      importFeesText: "",
      sourcePage: "search",
      capturedAt: "2026-04-21T12:00:00.000Z"
    }
  ], { destinationConfirmed: true, freeShippingMode: true, filteredEligible: true });

  assert.equal(payload.results.length, 1);
  assert.equal(payload.results[0].freeShipping, true);
  assert.equal(payload.results[0].freeShippingKind, "amazon-filter");
});

test("normalizeMaterialResults keeps verified threshold free-shipping items in free-shipping mode", () => {
  const payload = normalizeMaterialResults("PLA", [
    {
      title: "PLA Filament Threshold Free Shipping 1kg",
      url: "https://www.amazon.com/dp/B000000009",
      priceText: "$15.99",
      shippingText: "FREE delivery Monday, June 29",
      deliveryText: "FREE delivery Monday, June 29",
      quantityOneShippingText: "$22.28 Shipping to Israel",
      thresholdFreeShipping: true,
      minimumFreeShippingQuantity: 4,
      freeShippingSubtotal: 63.96,
      importFeesText: "",
      sourcePage: "product-verified",
      capturedAt: "2026-04-21T12:00:00.000Z"
    }
  ], { destinationConfirmed: true, freeShippingMode: true, filteredEligible: true });

  assert.equal(payload.results.length, 1);
  assert.equal(payload.results[0].freeShipping, true);
  assert.equal(payload.results[0].freeShippingKind, "threshold");
  assert.equal(payload.results[0].minimumFreeShippingQuantity, 4);
  assert.equal(payload.results[0].freeShippingSubtotal, 63.96);
  assert.equal(payload.results[0].shippingAtQuantityOne, 22.28);
  assert.equal(payload.results[0].totalValue, 63.96);
});

test("normalizeMaterialResults keeps explicit free-delivery results in free-shipping mode", () => {
  const payload = normalizeMaterialResults("PLA", [
    {
      title: "PLA Filament Explicit Free Delivery 1kg",
      url: "https://www.amazon.com/dp/B000000008",
      priceText: "$18.00",
      shippingText: "FREE delivery to Israel",
      deliveryText: "FREE delivery to Israel",
      importFeesText: "",
      sourcePage: "search",
      capturedAt: "2026-04-21T12:00:00.000Z"
    }
  ], { destinationConfirmed: true, freeShippingMode: true, filteredEligible: true });

  assert.equal(payload.results.length, 1);
  assert.equal(payload.results[0].freeShipping, true);
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
  assert.equal(materialMatches("PETG", "Comgrow PETG 3D Printer Filament 2kg (4.4LBS) Black+Black"), true);
});

test("parseSpoolInfo accepts full 1kg spool bundles", () => {
  assert.deepEqual(parseSpoolInfo("PLA Filament 2 Pack 1kg Spool"), {
    packCount: 2,
    spoolKg: 1,
    totalKg: 2
  });
  assert.deepEqual(parseSpoolInfo("PETG Filament 4 x 1KG Bundle"), {
    packCount: 4,
    spoolKg: 1,
    totalKg: 4
  });
  assert.deepEqual(parseSpoolInfo("PLA Filament 10KG Bundle"), {
    packCount: 10,
    spoolKg: 1,
    totalKg: 10
  });
  assert.deepEqual(parseSpoolInfo("Comgrow PETG 3D Printer Filament 2kg (4.4LBS) Black+Black"), {
    packCount: 2,
    spoolKg: 1,
    totalKg: 2
  });
});

test("materialMatches rejects accessories, samples, and mixed-material listings", () => {
  assert.equal(materialMatches("PLA", "PLA Filament Dryer Box 1kg"), false);
  assert.equal(materialMatches("PLA", "PLA Filament 500g Sample Pack"), false);
  assert.equal(materialMatches("PLA", "PLA ASA Filament Bundle 1kg"), false);
  assert.equal(materialMatches("ASA", "ASA Filament 1kg Spool"), true);
});

test("parseShippingStatus classifies Israel shipping states", () => {
  assert.equal(parseShippingStatus("FREE delivery to Israel"), "free_to_israel");
  assert.equal(
    parseShippingStatus("FREE delivery Sunday to Israel on eligible orders over $49"),
    "free_over_threshold_to_israel"
  );
  assert.equal(parseShippingStatus("$6.99 Shipping to Israel"), "paid_shipping");
  assert.equal(parseShippingStatus("This item cannot be shipped to your selected delivery location"), "not_shippable");
  assert.equal(parseShippingStatus("Delivery date unavailable"), "unknown");
});

test("normalizeMaterialResults sorts bundles by effective price per kg", () => {
  const payload = normalizeMaterialResults("PLA", [
    {
      title: "PLA Filament Single 1kg",
      url: "https://www.amazon.com/dp/B000000020",
      priceText: "$12.00",
      shippingText: "FREE delivery to Israel",
      deliveryText: "FREE delivery to Israel",
      importFeesText: "",
      capturedAt: "2026-04-21T12:00:00.000Z"
    },
    {
      title: "PLA Filament 4 Pack 1kg",
      url: "https://www.amazon.com/dp/B000000021",
      priceText: "$36.00",
      shippingText: "FREE delivery to Israel",
      deliveryText: "FREE delivery to Israel",
      importFeesText: "",
      capturedAt: "2026-04-21T12:00:00.000Z"
    }
  ], { freeShippingMode: true });

  assert.equal(payload.results[0].title, "PLA Filament 4 Pack 1kg");
  assert.equal(payload.results[0].totalKg, 4);
  assert.equal(payload.results[0].pricePerKg, 9);
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
      query: "ASA filament",
      queries: ["ASA filament"]
    }
  ]);
});

test("buildSearchPlan includes bundle query seeds for material searches", () => {
  const [plan] = buildSearchPlan({ materials: ["PLA"] });

  assert.ok(plan.queries.includes("PLA filament 1kg"));
  assert.ok(plan.queries.includes("PLA filament 2kg"));
  assert.ok(plan.queries.includes("PLA filament 4.4lbs"));
  assert.ok(plan.queries.includes("PLA multipack filament"));
  assert.ok(plan.queries.includes("Comgrow PLA filament"));
  assert.ok(plan.queries.includes("PLA filament bundle 1kg"));
});

test("buildSearchUrl uses Amazon free-shipping filter and price sort", () => {
  const url = new URL(buildSearchUrl("PLA filament 1kg"));

  assert.equal(url.hostname, "www.amazon.com");
  assert.equal(url.pathname, "/s");
  assert.equal(url.searchParams.get("k"), "PLA filament 1kg");
  assert.equal(url.searchParams.get("rh"), "p_n_is_free_shipping:10236242011");
  assert.equal(url.searchParams.get("s"), "price-asc-rank");
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

test("pickStandardPriceText rejects Prime savings prices even when they appear first", () => {
  const priceText = pickStandardPriceText([
    {
      text: "$11.99",
      context: "Prime savings price $11.99 Join Prime to buy this item at $11.99"
    },
    {
      text: "$15.99",
      context: "$15.99 FREE delivery to Israel Add to cart"
    }
  ]);

  assert.equal(priceText, "$15.99");
});

test("pickStandardPriceText avoids coupon-adjusted and list prices when a normal price exists", () => {
  const priceText = pickStandardPriceText([
    {
      text: "$19.99",
      context: "List Price: $19.99 Save 20%"
    },
    {
      text: "$12.99",
      context: "$12.99 with coupon"
    },
    {
      text: "$15.99",
      context: "$15.99 FREE delivery to Israel"
    }
  ]);

  assert.equal(priceText, "$15.99");
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

test("extractProductPageRegularPrice reads regular price when Amazon shows Prime member pricing first", () => {
  const pageText = `
    Prime Member Price
    $11
    99
    This price is exclusively for Amazon Prime members.
    Regular Price
    $13
    99
    FREE delivery Sunday, May 31 to Israel on eligible orders over $49
  `;

  assert.equal(extractProductPageRegularPrice(pageText), "$13.99");
});

test("extractProductPageRegularPrice ignores regular labels without Prime-member pricing", () => {
  const pageText = `
    Regular Price
    $13
    99
    FREE delivery to Israel
  `;

  assert.equal(extractProductPageRegularPrice(pageText), "");
});

test("extractProductPageDeliveryText captures free delivery over eligible Israel orders", () => {
  const pageText = `
    Regular Price
    $13
    99
    FREE delivery Sunday, May 31 to Israel on eligible orders over $49
    Ships from Amazon
  `;

  assert.match(extractProductPageDeliveryText(pageText), /FREE delivery Sunday/);
});

test("extractProductPageDeliveryText captures quantity-threshold free delivery without repeated Israel text", () => {
  const pageText = `
    No Import Charges & $22.28 Shipping to Israel Details
    FREE delivery Monday, June 29
    Or fastest delivery Tuesday, June 2
    Deliver to daniel - Rishon Leziyon 75
  `;

  assert.match(extractProductPageDeliveryText(pageText), /FREE delivery Monday/);
});

test("buildQuantityProbeList targets likely free-shipping thresholds without slow full scans", () => {
  assert.deepEqual(buildQuantityProbeList("$15.99"), [1, 2, 3, 4, 5]);
  assert.deepEqual(buildQuantityProbeList("$24.99"), [1, 2, 3, 4]);
  assert.deepEqual(buildQuantityProbeList("$30.99"), [1, 2, 3, 4]);
});

test("extractAsinFromAmazonHref reads sponsored Amazon redirect URLs", () => {
  const sponsoredUrl = "https://www.amazon.com/sspa/click?url=%2FFANCYPOP-Filament-Printing-Dimensional-Accuracy%2Fdp%2FB0G6DVCHXC%2Fref%3Dsr_1_1_sspa";

  assert.equal(extractAsinFromAmazonHref(sponsoredUrl), "B0G6DVCHXC");
  assert.equal(resolveAmazonUrl(sponsoredUrl), "https://www.amazon.com/dp/B0G6DVCHXC");
});

test("extractColorProfile detects specific shades inside a base color", () => {
  assert.deepEqual(extractColorProfile("PLA filament Olive Green 1kg"), {
    colorKey: "green",
    colorLabel: "Green",
    shadeKey: "olive-green",
    shadeLabel: "Olive Green"
  });

  assert.deepEqual(extractColorProfile("PETG filament Light Blue spool 1kg"), {
    colorKey: "blue",
    colorLabel: "Blue",
    shadeKey: "light-blue",
    shadeLabel: "Light Blue"
  });
});

test("selectCheapestWithColorCoverage expands the shortlist when it uncovers new colors or shades", () => {
  const shortlisted = selectCheapestWithColorCoverage([
    {
      title: "PLA Black spool 1kg",
      colorKey: "black",
      colorLabel: "Black",
      shadeKey: "black",
      shadeLabel: "Black",
      priceValue: 10,
      totalValue: 10
    },
    {
      title: "PLA Gray spool 1kg",
      colorKey: "gray",
      colorLabel: "Gray",
      shadeKey: "gray",
      shadeLabel: "Gray",
      priceValue: 11,
      totalValue: 11
    },
    {
      title: "PLA Olive Green spool 1kg",
      colorKey: "green",
      colorLabel: "Green",
      shadeKey: "olive-green",
      shadeLabel: "Olive Green",
      priceValue: 12,
      totalValue: 12
    },
    {
      title: "PLA Dark Green spool 1kg",
      colorKey: "green",
      colorLabel: "Green",
      shadeKey: "dark-green",
      shadeLabel: "Dark Green",
      priceValue: 13,
      totalValue: 13
    }
  ], 2, 4);

  assert.equal(shortlisted.length, 4);
  assert.deepEqual(shortlisted.map((item) => item.shadeLabel), ["Black", "Gray", "Olive Green", "Dark Green"]);
});

test("selectCheapestWithColorCoverage keeps every result when limit is zero", () => {
  const shortlisted = selectCheapestWithColorCoverage([
    { title: "PLA C 1kg", priceValue: 3, totalValue: 3, pricePerKg: 3 },
    { title: "PLA A 1kg", priceValue: 1, totalValue: 1, pricePerKg: 1 },
    { title: "PLA B 1kg", priceValue: 2, totalValue: 2, pricePerKg: 2 }
  ], 0);

  assert.deepEqual(shortlisted.map((item) => item.title), ["PLA A 1kg", "PLA B 1kg", "PLA C 1kg"]);
});

test("mergeDiscountsIntoCheapestRange keeps cheap discounted items in the cheapest color-grouped list", () => {
  const cheapest = [
    {
      material: "PLA",
      title: "PLA Black 1kg",
      asin: "B000000001",
      priceValue: 12,
      totalValue: 12,
      colorKey: "black"
    },
    {
      material: "PLA",
      title: "PLA White 1kg",
      asin: "B000000002",
      priceValue: 16,
      totalValue: 16,
      colorKey: "white"
    }
  ];
  const discounted = [
    {
      material: "PLA",
      title: "PLA Green Discount 1kg",
      asin: "B000000003",
      priceValue: 14,
      totalValue: 14,
      colorKey: "green",
      hasDiscount: true
    },
    {
      material: "PLA",
      title: "PLA Expensive Discount 1kg",
      asin: "B000000004",
      priceValue: 25,
      totalValue: 25,
      colorKey: "red",
      hasDiscount: true
    }
  ];

  const merged = mergeDiscountsIntoCheapestRange(cheapest, discounted);

  assert.deepEqual(merged.map((item) => item.title), [
    "PLA Black 1kg",
    "PLA Green Discount 1kg",
    "PLA White 1kg"
  ]);
});
