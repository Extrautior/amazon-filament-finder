const { MATERIALS } = require("./config");

function exportRows(payload) {
  return MATERIALS.flatMap((material) =>
    (payload.resultsByMaterial[material] || []).map((item, index) => ({
      material,
      rank: index + 1,
      title: item.title,
      asin: item.asin || "",
      url: item.url || "",
      imageUrl: item.imageUrl || "",
      priceValue: item.priceValue ?? "",
      shippingValue: item.shippingValue ?? "",
      importFeesValue: item.importFeesValue ?? "",
      totalValue: item.totalValue ?? "",
      currency: item.currency || "",
      freeShipping: item.freeShipping ? "Yes" : "No",
      availabilityNote: item.availabilityNote || "",
      capturedAt: item.capturedAt || ""
    }))
  );
}

function payloadToCsv(payload) {
  const headers = [
    "material",
    "rank",
    "title",
    "asin",
    "url",
    "imageUrl",
    "priceValue",
    "shippingValue",
    "importFeesValue",
    "totalValue",
    "currency",
    "freeShipping",
    "availabilityNote",
    "capturedAt"
  ];
  const escapeCell = (value) => `"${String(value ?? "").replaceAll('"', '""')}"`;

  return [
    headers.join(","),
    ...exportRows(payload).map((row) => headers.map((header) => escapeCell(row[header])).join(","))
  ].join("\n");
}

module.exports = {
  exportRows,
  payloadToCsv
};
