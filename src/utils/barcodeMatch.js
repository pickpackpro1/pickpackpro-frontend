const text = (value) => String(value ?? '').trim();

export const normalizeScanCode = (value) => text(value).replace(/\s+/g, '').toUpperCase();

// UPC-A (12 digits) and EAN-13 with a leading 0 are the same product code, so compare digits without leading zeros.
const numericKey = (code) => (/^\d+$/.test(code) ? code.replace(/^0+/, '') : null);

export const codesMatch = (left, right) => {
  const a = normalizeScanCode(left);
  const b = normalizeScanCode(right);
  if (!a || !b) return false;
  if (a === b) return true;
  const numericA = numericKey(a);
  const numericB = numericKey(b);
  return Boolean(numericA) && numericA === numericB;
};

export const getScanLineItemId = (item = {}) =>
  text(item?.shipmentItemId || item?.shipment_item_id || item?.lineItemId || item?.line_item_id || item?.id);

export const getScanLineItemBarcode = (item = {}) =>
  text(item?.barcode || item?.product?.barcode || item?.products?.barcode);

export const getScanLineItemFnsku = (item = {}) =>
  text(item?.fnsku || item?.fnskuLabel || item?.fnsku_label || item?.product?.default_fnsku || item?.products?.default_fnsku);

export const getScanLineItemSku = (item = {}) => text(item?.sku || item?.product?.sku || item?.products?.sku);

export const getScanLineItemName = (item = {}) =>
  text(item?.productName || item?.product_name || item?.product?.product_name || item?.products?.product_name) || 'Product';

export const getScanLineItemLabelUrl = (item = {}) => {
  const files = [
    item?.fnskuLabelFile,
    item?.fnsku_label_file,
    item?.labelFile,
    item?.uploaded_files,
    item?.product?.defaultFnskuLabelFile,
    item?.products?.defaultFnskuLabelFile,
  ];
  for (const file of files) {
    const url = text(file?.url || file?.publicUrl || file?.public_url || file?.signedUrl || file?.signed_url);
    if (url) return url;
  }
  return text(item?.fnskuLabelFileUrl || item?.defaultFnskuLabelFileUrl || item?.default_fnsku_label_file_url);
};

// Scans usually hit the retail barcode, but an FNSKU label or SKU sticker should find the line too.
export const findLineItemsByScan = (lineItems = [], code) => {
  const matches = [];
  const seen = new Set();
  for (const item of lineItems) {
    const key = getScanLineItemId(item) || item;
    if (seen.has(key)) continue;
    let matchedBy = '';
    if (codesMatch(getScanLineItemBarcode(item), code)) matchedBy = 'barcode';
    else if (codesMatch(getScanLineItemFnsku(item), code)) matchedBy = 'FNSKU';
    else if (codesMatch(getScanLineItemSku(item), code)) matchedBy = 'SKU';
    if (!matchedBy) continue;
    seen.add(key);
    matches.push({ item, matchedBy });
  }
  return matches;
};
