function exportRows(payload) {
  const sections = payload.searchPlan || Object.keys(payload.resultsByMaterial || {}).map((key) => ({ key, label: key }));

  return sections.flatMap((section) => {
    const cheapestRows = (payload.resultsByMaterial[section.key] || []).map((item, index) => ({
      material: section.label,
      resultType: "cheapest",
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
      hasDiscount: item.hasDiscount ? "Yes" : "No",
      discountText: item.discountText || "",
      discountPercent: item.discountPercent ?? "",
      availabilityNote: item.availabilityNote || "",
      capturedAt: item.capturedAt || ""
    }));
    const discountedRows = (payload.discountedResultsByMaterial?.[section.key] || []).map((item, index) => ({
      material: `${section.label} Discounted Deals`,
      resultType: "discounted",
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
      hasDiscount: item.hasDiscount ? "Yes" : "No",
      discountText: item.discountText || "",
      discountPercent: item.discountPercent ?? "",
      availabilityNote: item.availabilityNote || "",
      capturedAt: item.capturedAt || ""
    }));
    return cheapestRows.concat(discountedRows);
  });
}

function payloadToCsv(payload) {
  const headers = [
    "material",
    "resultType",
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
    "hasDiscount",
    "discountText",
    "discountPercent",
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
