const test = require("node:test");
const assert = require("node:assert/strict");
const {
  buildFilteredAmazonSearchUrl,
  mapDecodoResponse
} = require("../src/providers/decodoSearchProvider");
const { runSearch } = require("../src/search");

test("buildFilteredAmazonSearchUrl preserves Amazon free-shipping filter and price sort", () => {
  const url = new URL(buildFilteredAmazonSearchUrl("PLA filament 1kg", 3));

  assert.equal(url.hostname, "www.amazon.com");
  assert.equal(url.pathname, "/s");
  assert.equal(url.searchParams.get("k"), "PLA filament 1kg");
  assert.equal(url.searchParams.get("rh"), "p_n_is_free_shipping:10236242011");
  assert.equal(url.searchParams.get("s"), "price-asc-rank");
  assert.equal(url.searchParams.get("page"), "3");
});

test("mapDecodoResponse maps common parsed Amazon search result shapes", () => {
  const mapped = mapDecodoResponse({
    results: {
      organic_results: [
        {
          asin: "B0TEST0001",
          title: "PLA Filament Black 1kg",
          link: "https://www.amazon.com/dp/B0TEST0001",
          price: "$18.99",
          delivery_info: "FREE delivery to Israel",
          image_url: "https://images.example.test/item.jpg"
        }
      ]
    }
  });

  assert.equal(mapped.length, 1);
  assert.equal(mapped[0].asin, "B0TEST0001");
  assert.equal(mapped[0].priceText, "$18.99");
  assert.equal(mapped[0].deliveryText, "FREE delivery to Israel");
});

test("runSearch hybrid flow dedupes ASINs and stops at request budget", async () => {
  const requests = [];
  const fetchImpl = async (_url, options) => {
    const body = JSON.parse(options.body);
    requests.push(body);
    return {
      ok: true,
      status: 200,
      text: async () => JSON.stringify({
        results: [
          {
            asin: "B0TEST0002",
            title: "PLA Filament 2 Pack 1kg",
            link: "https://www.amazon.com/dp/B0TEST0002",
            price: "$30.00",
            delivery_info: "FREE delivery to Israel on eligible orders over $49"
          },
          {
            asin: "B0TEST0002",
            title: "PLA Filament 2 Pack 1kg Duplicate",
            link: "https://www.amazon.com/dp/B0TEST0002",
            price: "$31.00",
            delivery_info: "FREE delivery to Israel on eligible orders over $49"
          }
        ]
      })
    };
  };

  const payload = await runSearch({
    searchProvider: "hybrid",
    materials: ["PLA"],
    decodoAuthToken: "test-token",
    decodoRequestBudget: 1,
    browserVerifyLimit: 0,
    fetchImpl
  });

  assert.equal(requests.length, 1);
  assert.equal(payload.decodoRequestsUsed, 1);
  assert.equal(payload.resultsByMaterial.PLA.length, 1);
  assert.equal(payload.resultsByMaterial.PLA[0].asin, "B0TEST0002");
  assert.equal(payload.resultsByMaterial.PLA[0].totalKg, 2);
  assert.match(payload.warnings.join(" "), /request budget/);
});
