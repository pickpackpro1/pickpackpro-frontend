import {
  getProductDefaultFnskuLabelFile,
  getProductDefaultFnskuLabelFileId,
  getProductDefaultFnskuLabelFileName,
  getProductDefaultFnskuLabelFileUrl,
} from './productFields';

const isPresent = (value) => {
  if (value === 0 || value === false) return true;
  return value !== undefined && value !== null && String(value).trim() !== '';
};

const firstPresent = (...values) => {
  const value = values.find(isPresent);
  return value === undefined || value === null ? '' : value;
};

export const normalizeSkuIdentity = (value = '') =>
  String(value || '').trim().toLowerCase();

const getNestedClientId = (source = {}) =>
  firstPresent(
    source?.id,
    source?.uuid,
    source?.clientId,
    source?.client_id,
    source?.customerId,
    source?.customer_id
  );

const getProductId = (product = {}) =>
  firstPresent(product?.id, product?.uuid, product?.productId, product?.product_id);

export const getProductClientId = (product = {}) =>
  firstPresent(
    product?.clientId,
    product?.client_id,
    product?.customerId,
    product?.customer_id,
    getNestedClientId(product?.client),
    getNestedClientId(product?.clients),
    getNestedClientId(product?.customer),
    getNestedClientId(product?.customers)
  );

const getProductSku = (product = {}) =>
  firstPresent(
    product?.sku,
    product?.sellerSku,
    product?.seller_sku,
    product?.sellerSKU,
    product?.productSku,
    product?.product_sku,
    product?.skuCode,
    product?.sku_code,
    product?.merchantSku,
    product?.merchant_sku,
    product?.msku
  );

const getProductName = (product = {}) =>
  firstPresent(
    product?.productName,
    product?.product_name,
    product?.name,
    product?.title,
    product?.label,
    product?.description
  );

const getProductFnsku = (product = {}) =>
  firstPresent(
    product?.defaultFnsku,
    product?.defaultFNSKU,
    product?.default_fnsku,
    product?.fnskuLabel,
    product?.fnsku_label,
    product?.fnsku,
    product?.fbaFnsku,
    product?.fba_fnsku
  );

const toBooleanFlag = (value) => {
  if (value === true || value === 1 || value === '1') return true;
  if (value === false || value === 0 || value === '0') return false;
  return ['true', 'yes', 'y'].includes(String(value || '').trim().toLowerCase());
};

const getProductNeedsBundling = (product = {}) =>
  toBooleanFlag(firstPresent(product?.needsBundling, product?.needs_bundling, false));

const getProductBundleSize = (product = {}) =>
  firstPresent(product?.bundleSize, product?.bundle_size, product?.casePack, product?.case_pack);

const hasProductShape = (value = {}) =>
  Boolean(
    value &&
      typeof value === 'object' &&
      (getProductSku(value) ||
        getProductName(value) ||
        getProductFnsku(value) ||
        getProductClientId(value))
  );

export const extractProductRows = (payload) => {
  if (Array.isArray(payload)) return payload.filter(hasProductShape);

  const directKeys = ['products', 'productRows', 'product_rows', 'rows', 'results', 'items'];
  for (const key of directKeys) {
    const rows = payload?.[key];
    if (Array.isArray(rows) && rows.some(hasProductShape)) return rows;
  }

  const dataKeys = ['products', 'productRows', 'product_rows', 'rows', 'results', 'items'];
  for (const key of dataKeys) {
    const rows = payload?.data?.[key];
    if (Array.isArray(rows) && rows.some(hasProductShape)) return rows;
  }

  if (Array.isArray(payload?.data) && payload.data.some(hasProductShape)) return payload.data;

  return [];
};

export const normalizeSkuProduct = (product = {}) => ({
  id: firstPresent(getProductId(product), getProductSku(product)),
  productId: getProductId(product),
  product_id: getProductId(product),
  sku: String(getProductSku(product) || '').trim(),
  productName: String(getProductName(product) || '').trim(),
  fnskuLabel: String(getProductFnsku(product) || '').trim(),
  needsBundling: getProductNeedsBundling(product),
  needs_bundling: getProductNeedsBundling(product),
  bundleSize: String(getProductBundleSize(product) || '').trim(),
  bundle_size: String(getProductBundleSize(product) || '').trim(),
  defaultFnskuLabelFileId: getProductDefaultFnskuLabelFileId(product),
  default_fnsku_label_file_id: getProductDefaultFnskuLabelFileId(product),
  defaultFnskuLabelFile: getProductDefaultFnskuLabelFile(product),
  default_fnsku_label_file: getProductDefaultFnskuLabelFile(product),
  defaultFnskuLabelFileName: getProductDefaultFnskuLabelFileName(product),
  default_fnsku_label_file_name: getProductDefaultFnskuLabelFileName(product),
  defaultFnskuLabelFileUrl: getProductDefaultFnskuLabelFileUrl(product),
  default_fnsku_label_file_url: getProductDefaultFnskuLabelFileUrl(product),
  clientId: String(getProductClientId(product) || '').trim(),
  raw: product,
});

export const normalizeSkuProductOptions = (payload, clientId = '') => {
  const targetClientId = normalizeSkuIdentity(clientId);
  const seenSkus = new Set();

  return extractProductRows(payload)
    .map(normalizeSkuProduct)
    .filter((option) => option.sku)
    .filter((option) => {
      const optionClientId = normalizeSkuIdentity(option.clientId);
      return !targetClientId || !optionClientId || optionClientId === targetClientId;
    })
    .filter((option) => {
      const skuKey = normalizeSkuIdentity(option.sku);
      if (seenSkus.has(skuKey)) return false;
      seenSkus.add(skuKey);
      return true;
    })
    .sort((firstOption, secondOption) => firstOption.sku.localeCompare(secondOption.sku));
};

export const findSkuOptionBySku = (options = [], sku = '') => {
  const targetSku = normalizeSkuIdentity(sku);
  if (!targetSku) return null;
  return options.find((option) => normalizeSkuIdentity(option?.sku) === targetSku) || null;
};

export const getSkuOptionLabel = (option = {}) =>
  [option?.productName, option?.fnskuLabel].map((value) => String(value || '').trim()).filter(Boolean).join(' - ');

export const getSkuOptionDisplayLabel = (option = {}) =>
  [option?.sku, option?.productName, option?.fnskuLabel].map((value) => String(value || '').trim()).filter(Boolean).join(' - ');

export const extractSkuProductRecord = (payload = {}) => {
  const candidates = [
    payload?.product,
    payload?.data?.product,
    payload?.data?.row,
    payload?.data?.record,
    payload?.row,
    payload?.record,
    payload?.data,
    payload,
  ];

  return (
    candidates.find((candidate) => {
      if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) return false;
      return getProductId(candidate) || getProductSku(candidate) || getProductName(candidate);
    }) || {}
  );
};
