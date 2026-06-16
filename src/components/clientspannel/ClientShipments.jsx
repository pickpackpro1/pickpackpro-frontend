import React, { useEffect, useMemo, useRef, useState } from 'react';
import LayoutClient from './clientlayout/LayoutClient';
import LoadingState from '../common/LoadingState';
import ProductSkuCombobox from '../common/ProductSkuCombobox';
import { Search, ChevronDown, Calendar, Plus, X, Eye, RefreshCw, Upload, FileUp, Trash2, ArrowLeft, Check, ClipboardCheck, Truck, FileText, Tags, Download, Pencil } from 'lucide-react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { getSession } from '../../utils/auth';
import { API_MUTATION_EVENT_NAME } from '../../utils/toast';
import {
  findSavedLineItemForUpload as findMappedSavedLineItemForUpload,
  getLineItemOutboundPackageGroups,
  getItemLabelFileAssignments as getMappedItemLabelFileAssignments,
  getLineItemId as getMappedLineItemId,
  getShipmentItems as getMappedShipmentItems,
  lineItemFileMatches as mappedFileMatchesLineItem,
  normalizeShipment as normalizeMappedShipment,
  normalizeShipmentList as normalizeMappedShipmentList,
} from '../../utils/shipmentMapper';
import {
  normalizeSkuProductOptions,
} from '../../utils/productSkuOptions';
import {
  buildDraftShipmentItems,
  buildSubmittedShipmentItems,
  createDraftItemId,
  deleteDraftFileRecord,
  ensureDraftItemIds,
  getDraftFileRecordId,
  getShipmentDraftFiles,
  getShipmentDraftItems,
  getShipmentDraftPayload,
  mapDraftPayloadItemsToFormItems,
  uploadDraftFnskuLabelFiles,
} from '../../utils/shipmentDrafts';
import {
  SERVICE_SELECT_OPTIONS,
  STANDARD_SERVICE_KEYS as STANDARD_CATALOG_SERVICE_KEYS,
  getServiceDisplayName,
  getServiceKey,
  isBundlingService,
  isOtherServiceCode,
  normalizeServiceCode,
  normalizeServiceList,
} from '../../utils/serviceCatalog';

const DRAFT_CACHE_KEY = 'pickpackpro-shipment-drafts';
const BOX_ALLOCATION_CACHE_KEY = 'pickpackpro-box-allocation-items-v1';
const SHIPMENTS_PER_PAGE = 10;
const BACKEND_BASE_URL = (import.meta.env.VITE_API_BASE_URL || 'https://ali-backend.vercel.app');
const API_BASE_URL = '';
const SUPABASE_STORAGE_PUBLIC_BASE_URL = import.meta.env.VITE_SUPABASE_URL
  ? `${String(import.meta.env.VITE_SUPABASE_URL).replace(/\/+$/, '')}/storage/v1/object/public`
  : '';
const SUPABASE_DEFAULT_STORAGE_BUCKET =
  import.meta.env.VITE_SUPABASE_BUCKET_FNSKU_LABELS ||
  import.meta.env.VITE_SUPABASE_STORAGE_BUCKET ||
  'pickpackpro-files';
const SUPABASE_STORAGE_BUCKET_CANDIDATES = [
  import.meta.env.VITE_SUPABASE_BUCKET_FNSKU_LABELS,
  import.meta.env.VITE_SUPABASE_STORAGE_BUCKET,
  SUPABASE_DEFAULT_STORAGE_BUCKET,
  'fnsku-labels',
  'pickpackpro-files',
].filter((bucket, index, buckets) => bucket && buckets.indexOf(bucket) === index);
const SAFE_FILE_UPLOAD_BYTES = 3 * 1024 * 1024;
const IMAGE_UPLOAD_MAX_DIMENSION = 2400;
const BOX_ITEM_ENRICH_ENABLED = String(import.meta.env.VITE_BOX_ITEM_ENRICH_ENABLED || 'true').toLowerCase() !== 'false';
const FBA_LABEL_ELIGIBLE_STATUS_VALUES = ['submitted', 'pending_arrival', 'received', 'in_progress', 'prepped', 'dispatched'];
const FBA_LABEL_ELIGIBLE_STATUSES = new Set([...FBA_LABEL_ELIGIBLE_STATUS_VALUES, 'pending arrival', 'in progress']);
const FILE_LIKE_KEYS = [
  'file',
  'upload',
  'attachment',
  'document',
  'uploadedFile',
  'uploaded_file',
  'record',
  'row',
];
const BUNDLE_SIZE_NOTE_PREFIX = 'Bundle Sizes:';

const formatFileSize = (bytes = 0) => {
  const size = Number(bytes || 0);
  if (!Number.isFinite(size) || size <= 0) return '0 MB';
  if (size < 1024 * 1024) return `${Math.ceil(size / 1024)} KB`;
  return `${(size / (1024 * 1024)).toFixed(size >= 10 * 1024 * 1024 ? 0 : 1)} MB`;
};

const isPayloadTooLargeMessage = (value = '') =>
  /payload.*too.*large|request entity too large|content too large|413|function_payload_too_large/i.test(String(value || ''));

const getUploadTooLargeMessage = (fileName = 'file') =>
  `${fileName} is too large for upload. Please use a file under ${formatFileSize(SAFE_FILE_UPLOAD_BYTES)}; large images are optimized automatically.`;

const getFnskuLabelTooLargeMessage = (fileName = 'FNSKU label file') =>
  `${fileName} is too large. FNSKU label files must be ${formatFileSize(SAFE_FILE_UPLOAD_BYTES)} or less.`;

const createEmptyProductItem = () => ({
  draftItemId: createDraftItemId(),
  productName: '',
  sku: '',
  expectedQty: '',
  fnskuLabel: '',
  bundleSize: '',
  needsBundling: false,
  serviceType: '',
  serviceQty: '',
  customServiceName: '',
  services: [],
  fileName: '',
  file: null,
});

const initialCreateForm = {
  clientId: '',
  trackingNumber: '',
  boxCount: '0',
  palletCount: '0',
  notes: '',
  expectedArrivalDate: '',
};

const toastStyles = {
  success: 'border-green-200 bg-green-50 text-green-700',
  error: 'border-red-200 bg-red-50 text-red-700',
};

const SERVICE_OPTIONS = SERVICE_SELECT_OPTIONS;
const SELECTABLE_SERVICE_OPTIONS = SERVICE_OPTIONS.filter((option) => !isBundlingService(option.value));
const isOtherServiceValue = isOtherServiceCode;
const formatServiceLabel = getServiceDisplayName;
const normalizeServiceKey = getServiceKey;
const STANDARD_SERVICE_KEYS = STANDARD_CATALOG_SERVICE_KEYS;

const getClientIdFromSession = () => {
  const session = getSession();
  return (
    session?.clientId ||
    session?.client_id ||
    session?.rawUser?.clientId ||
    session?.rawUser?.client_id ||
    session?.rawUser?.client?.id ||
    session?.rawUser?.client?.uuid ||
    session?.rawUser?.client?.clientId ||
    session?.rawUser?.client?.client_id ||
    session?.rawUser?.clients?.id ||
    session?.rawUser?.clients?.uuid ||
    session?.rawUser?.clients?.clientId ||
    session?.rawUser?.clients?.client_id ||
    ''
  );
};

const normalizeIdentityValue = (value = '') =>
  String(value || '').trim().toLowerCase();

const getSessionClientIdentity = () => {
  const session = getSession() || {};
  const rawUser = session?.rawUser || {};
  const client = rawUser?.client || rawUser?.clients || {};

  return {
    role: String(session?.role || rawUser?.role || '').trim().toLowerCase(),
    ids: [
      getClientIdFromSession(),
      rawUser?.clientId,
      rawUser?.client_id,
      client?.id,
      client?.uuid,
      client?.clientId,
      client?.client_id,
    ]
      .map(normalizeIdentityValue)
      .filter(Boolean),
    emails: [session?.email, rawUser?.email, client?.email, client?.contactEmail, client?.contact_email]
      .map(normalizeIdentityValue)
      .filter(Boolean),
    names: [
      session?.name,
      rawUser?.name,
      rawUser?.fullName,
      rawUser?.full_name,
      client?.name,
      client?.companyName,
      client?.company_name,
      client?.businessName,
      client?.business_name,
    ]
      .map(normalizeIdentityValue)
      .filter(Boolean),
  };
};

const buildHeaders = (includeJson = false) => {
  const session = getSession();
  const headers = {};
  if (session?.token) headers['Authorization'] = `Bearer ${session.token}`;
  if (includeJson) headers['Content-Type'] = 'application/json';
  return headers;
};

const appendFormValue = (formData, key, value) => {
  const normalizedValue = String(value || '').trim();
  if (normalizedValue) formData.append(key, normalizedValue);
};

const parseResponse = async (response) => {
  const text = await response.text();
  let payload = null;
  if (text) {
    try { payload = JSON.parse(text); } catch { payload = text; }
  }
  if (!response.ok) {
    const rawMessage =
      payload?.message ||
      payload?.error ||
      payload?.details ||
      (typeof payload === 'string' ? payload : '') ||
      `Request failed with status ${response.status}`;

    if (String(rawMessage).toLowerCase().includes('max clients reached')) {
      throw new Error('Backend database connection limit reached. Please retry in a moment.');
    }

    if (response.status === 413 || isPayloadTooLargeMessage(rawMessage)) {
      throw new Error(getUploadTooLargeMessage());
    }

    throw new Error(rawMessage);
  }
  return payload;
};

const normalizeServiceType = normalizeServiceCode;

const isBundlingServiceValue = (value = '') =>
  isBundlingService(String(value || '').split('/')[0]);

const extractShipments = (payload) => normalizeMappedShipmentList(payload);

const extractList = (payload, keys = []) => {
  if (Array.isArray(payload)) return payload;

  for (const key of keys) {
    if (Array.isArray(payload?.[key])) return payload[key];
    if (Array.isArray(payload?.data?.[key])) return payload.data[key];
  }

  if (Array.isArray(payload?.rows)) return payload.rows;
  if (Array.isArray(payload?.data?.rows)) return payload.data.rows;
  if (Array.isArray(payload?.data)) return payload.data;

  return [];
};

const toArray = (value) => extractList(value);

const isValidLookupValue = (value = '') => {
  const normalized = String(value || '').trim();
  return Boolean(
    normalized &&
      !['n/a', 'na', '-', 'none', 'null', 'undefined'].includes(normalized.toLowerCase())
  );
};

const firstValidLookupValue = (...values) =>
  values.map((value) => String(value || '').trim()).find(isValidLookupValue) || '';

const getShipmentId = (shipment = {}) =>
  firstValidLookupValue(
    shipment?.id,
    shipment?.uuid,
    shipment?.shipmentId,
    shipment?.shipment_id,
    shipment?.reference,
    shipment?.shipmentNumber,
    shipment?.shipment_number
  );

const isUuidValue = (value = '') =>
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(value || '').trim());

const firstUuidValue = (...values) => values.find((value) => isUuidValue(value)) || '';

const getShipmentRecordId = (shipment = {}) =>
  firstUuidValue(shipment?.id, shipment?.uuid, shipment?.shipmentId, shipment?.shipment_id);

const getBoxRecordId = (box = {}) =>
  firstUuidValue(box?.id, box?.uuid, box?.boxId, box?.box_id);

const getShipmentReference = (shipment = {}) =>
  firstValidLookupValue(
    shipment?.reference,
    shipment?.shipmentNumber,
    shipment?.shipment_number,
    shipment?.id,
    shipment?.uuid
  ) || 'N/A';

const getShipmentClientId = (shipment = {}) =>
  firstPresent(
    shipment?.clientId,
    shipment?.client_id,
    shipment?.clientUuid,
    shipment?.client_uuid,
    shipment?.customerId,
    shipment?.customer_id,
    shipment?.accountId,
    shipment?.account_id,
    shipment?.client?.id,
    shipment?.client?.uuid,
    shipment?.client?.clientId,
    shipment?.client?.client_id,
    shipment?.clients?.id,
    shipment?.clients?.uuid,
    shipment?.clients?.clientId,
    shipment?.clients?.client_id,
    shipment?.clientRecord?.id,
    shipment?.clientRecord?.uuid,
    shipment?.client_record?.id,
    shipment?.client_record?.uuid
  );

const getShipmentClientEmail = (shipment = {}) =>
  firstPresent(
    shipment?.clientEmail,
    shipment?.client_email,
    shipment?.customerEmail,
    shipment?.customer_email,
    shipment?.email,
    shipment?.client?.email,
    shipment?.clients?.email,
    shipment?.clientRecord?.email,
    shipment?.client_record?.email
  );

const getShipmentClientName = (shipment = {}) =>
  firstPresent(
    shipment?.clientName,
    shipment?.client_name,
    shipment?.clientCompany,
    shipment?.client_company,
    shipment?.companyName,
    shipment?.company_name,
    shipment?.customerName,
    shipment?.customer_name,
    shipment?.client?.name,
    shipment?.client?.companyName,
    shipment?.client?.company_name,
    shipment?.clients?.name,
    shipment?.clients?.companyName,
    shipment?.clients?.company_name,
    shipment?.clientRecord?.name,
    shipment?.clientRecord?.companyName,
    shipment?.client_record?.name,
    shipment?.client_record?.company_name
  );

const doesShipmentBelongToCurrentClient = (shipment = {}) => {
  const identity = getSessionClientIdentity();
  if (identity.role !== 'client') return true;

  const shipmentIds = [getShipmentClientId(shipment)].map(normalizeIdentityValue).filter(Boolean);
  const shipmentEmails = [getShipmentClientEmail(shipment)].map(normalizeIdentityValue).filter(Boolean);
  const shipmentNames = [getShipmentClientName(shipment)].map(normalizeIdentityValue).filter(Boolean);

  if (shipmentIds.length && identity.ids.length) {
    return shipmentIds.some((id) => identity.ids.includes(id));
  }

  if (shipmentEmails.length && identity.emails.length) {
    return shipmentEmails.some((email) => identity.emails.includes(email));
  }

  if (shipmentNames.length && identity.names.length) {
    return shipmentNames.some((name) => identity.names.includes(name));
  }

  return !shipmentIds.length && !shipmentEmails.length && !shipmentNames.length;
};

const formatListDate = (value = '') => {
  if (!value) return '-';
  const textValue = String(value);
  if (/^\d{4}-\d{2}-\d{2}/.test(textValue)) return textValue.slice(0, 10);
  const parsedDate = new Date(textValue);
  return Number.isNaN(parsedDate.getTime()) ? textValue : parsedDate.toISOString().slice(0, 10);
};

const getShipmentCreatedDate = (shipment = {}) =>
  formatListDate(
    shipment?.createdAt ||
      shipment?.created_at ||
      shipment?.created ||
      shipment?.createdDate ||
      shipment?.created_date ||
      shipment?.submittedAt ||
      shipment?.submitted_at
  );

const LINE_ITEM_KEYS = [
  'items',
  'lineItems',
  'line_items',
  'shipmentItems',
  'shipment_items',
  'shipmentLineItems',
  'shipment_line_items',
  'products',
  'productItems',
  'product_items',
  'lines',
];

const LINE_ITEM_CONTAINERS = ['data', 'shipment', 'row', 'record', 'detail', 'result', 'payload'];

const hasLineItemShape = (item = {}) =>
  Boolean(
    item &&
      typeof item === 'object' &&
      (item?.sku ||
        item?.sellerSku ||
        item?.seller_sku ||
        item?.productName ||
        item?.product_name ||
        item?.fnskuLabel ||
        item?.fnsku_label ||
        item?.expectedQty ||
        item?.expected_qty ||
        item?.quantity ||
        item?.qty ||
        item?.product ||
        item?.products ||
        item?.productId ||
        item?.product_id ||
        item?.skuId ||
        item?.sku_id ||
        item?.services)
  );

const getDirectLineItems = (source = {}) => {
  if (!source || typeof source !== 'object') return [];
  for (const key of LINE_ITEM_KEYS) {
    const value = source[key];
    if (Array.isArray(value) && value.length) return value;
  }

  const genericRows = Array.isArray(source?.rows)
    ? source.rows
    : Array.isArray(source?.data)
      ? source.data
      : [];

  return genericRows.some(hasLineItemShape) ? genericRows : [];
};

const getLineItems = (shipment = {}) => getMappedShipmentItems(shipment);

const firstPresent = (...values) => {
  const value = values.find((currentValue) => {
    if (currentValue === 0) return true;
    if (currentValue === false) return true;
    return currentValue !== undefined && currentValue !== null && String(currentValue).trim() !== '';
  });

  return value === undefined || value === null ? '' : value;
};

const getItemProduct = (item = {}) => {
  const product =
    item?.product ||
    item?.products ||
    item?.productData ||
    item?.product_data ||
    item?.productDetails ||
    item?.product_details ||
    item?.catalogProduct ||
    item?.catalog_product ||
    item?.inventoryItem ||
    item?.inventory_item;
  return product && typeof product === 'object' ? product : {};
};

const getItemProductName = (item = {}) => {
  const product = getItemProduct(item);
  return firstPresent(
    item?.productName,
    item?.product_name,
    item?.productTitle,
    item?.product_title,
    item?.itemName,
    item?.item_name,
    item?.description,
    item?.name,
    item?.title,
    product?.productName,
    product?.product_name,
    product?.productTitle,
    product?.product_title,
    product?.itemName,
    product?.item_name,
    product?.description,
    product?.name,
    product?.title
  );
};

const getItemSku = (item = {}) => {
  const product = getItemProduct(item);
  return firstPresent(
    item?.sku,
    item?.sellerSku,
    item?.seller_sku,
    item?.sellerSKU,
    item?.productSku,
    item?.product_sku,
    item?.skuCode,
    item?.sku_code,
    item?.merchantSku,
    item?.merchant_sku,
    item?.msku,
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
};

const getItemFnsku = (item = {}) => {
  const product = getItemProduct(item);
  return firstPresent(
    item?.fnskuLabel,
    item?.fnsku_label,
    item?.fnsku,
    item?.fbaFnsku,
    item?.fba_fnsku,
    item?.defaultFnsku,
    item?.default_fnsku,
    product?.fnskuLabel,
    product?.fnsku_label,
    product?.fnsku,
    product?.defaultFnsku,
    product?.default_fnsku
  );
};

const getItemExpectedQty = (item = {}) =>
  firstPresent(
    item?.expectedQty,
    item?.expected_qty,
    item?.expectedQuantity,
    item?.expected_quantity,
    item?.qtyExpected,
    item?.qty_expected,
    item?.expectedUnits,
    item?.expected_units,
    item?.unitsExpected,
    item?.units_expected,
    item?.quantity,
    item?.qty,
    item?.count,
    item?.totalUnits,
    item?.total_units,
    item?.units
  );

const getItemReceivedQty = (item = {}) =>
  firstPresent(
    item?.receivedQty,
    item?.received_qty,
    item?.receivedQuantity,
    item?.received_quantity,
    item?.qtyReceived,
    item?.qty_received,
    item?.unitsReceived,
    item?.units_received,
    item?.received,
    item?.actualQty,
    item?.actual_qty,
    item?.actualQuantity,
    item?.actual_quantity,
    item?.actual
  );

const hasQuantityValue = (value) =>
  value !== undefined && value !== null && String(value).trim() !== '' && !Number.isNaN(Number(value));

const firstQuantity = (...values) => {
  const value = values.find(hasQuantityValue);
  return value === undefined || value === null ? '' : value;
};

const firstNonZeroQuantity = (...values) => {
  const value = values.find((candidate) => hasQuantityValue(candidate) && Number(candidate) !== 0);
  return value === undefined || value === null ? '' : value;
};

const formatQuantityValue = (value) => {
  const quantity = Number(value || 0);
  if (!Number.isFinite(quantity)) return '0';
  return Number.isInteger(quantity) ? String(quantity) : quantity.toFixed(2).replace(/\.?0+$/, '');
};

const normalizeDisplayValue = (value = '') => {
  const normalized = String(value || '').trim();
  const lowerValue = normalized.toLowerCase();
  return normalized && !['-', 'n/a', 'na', 'none', 'null', 'undefined', 'no sku'].includes(lowerValue) ? normalized : '';
};

const normalizeSkuMatchValue = (value = '') =>
  String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '');

const skuValuesMatch = (left = '', right = '') => {
  const normalizedLeft = normalizeSkuMatchValue(left);
  const normalizedRight = normalizeSkuMatchValue(right);
  return Boolean(normalizedLeft && normalizedRight && normalizedLeft === normalizedRight);
};

const getDiscrepancyLineItemId = (discrepancy = {}) =>
  firstPresent(
    discrepancy?.lineItemId,
    discrepancy?.line_item_id,
    discrepancy?.shipmentItemId,
    discrepancy?.shipment_item_id,
    discrepancy?.shipmentLineItemId,
    discrepancy?.shipment_line_item_id,
    discrepancy?.itemId,
    discrepancy?.item_id,
    discrepancy?.lineItemUuid,
    discrepancy?.line_item_uuid,
    discrepancy?.shipmentItemUuid,
    discrepancy?.shipment_item_uuid,
    discrepancy?.shipmentLineItemUuid,
    discrepancy?.shipment_line_item_uuid,
    discrepancy?.lineItem?.id,
    discrepancy?.lineItem?.uuid,
    discrepancy?.line_item?.id,
    discrepancy?.line_item?.uuid,
    discrepancy?.shipmentItem?.id,
    discrepancy?.shipmentItem?.uuid,
    discrepancy?.shipment_item?.id,
    discrepancy?.shipment_item?.uuid,
    discrepancy?.shipmentLineItem?.id,
    discrepancy?.shipmentLineItem?.uuid,
    discrepancy?.shipment_line_item?.id,
    discrepancy?.shipment_line_item?.uuid,
    discrepancy?.item?.id
  );

const getDiscrepancyLineItem = (discrepancy = {}) =>
  discrepancy?.lineItem ||
  discrepancy?.line_item ||
  discrepancy?.shipmentItem ||
  discrepancy?.shipment_item ||
  discrepancy?.shipmentLineItem ||
  discrepancy?.shipment_line_item ||
  discrepancy?.item ||
  {};

const getDiscrepancySku = (discrepancy = {}) =>
  firstPresent(
    getItemSku(getDiscrepancyLineItem(discrepancy)),
    getItemSku(discrepancy),
    discrepancy?.sku,
    discrepancy?.sellerSku,
    discrepancy?.seller_sku,
    discrepancy?.lineItemSku,
    discrepancy?.line_item_sku,
    discrepancy?.shipmentItemSku,
    discrepancy?.shipment_item_sku,
    discrepancy?.productSku,
    discrepancy?.product_sku
  );

const findLineItemForDiscrepancy = (discrepancy = {}, lineItems = [], fallbackIndex = -1) => {
  const discrepancyLineItem = getDiscrepancyLineItem(discrepancy);
  const discrepancyLineItemId = String(getDiscrepancyLineItemId(discrepancy) || getItemRecordId(discrepancyLineItem) || '').trim();
  const discrepancySku = String(getDiscrepancySku(discrepancy) || '').trim().toLowerCase();

  return (
    lineItems.find((item) => {
      const itemId = String(getItemRecordId(item) || '').trim();
      const itemSku = String(getItemSku(item) || '').trim().toLowerCase();
      return (
        (discrepancyLineItemId && itemId && discrepancyLineItemId === itemId) ||
        (discrepancySku && itemSku && discrepancySku === itemSku)
      );
    }) ||
    (fallbackIndex >= 0 ? lineItems[fallbackIndex] : null) ||
    (lineItems.length === 1 ? lineItems[0] : null) ||
    discrepancyLineItem ||
    {}
  );
};

const getDiscrepancyExpectedQty = (discrepancy = {}, matchedLineItem = {}) => {
  const discrepancyLineItem = getDiscrepancyLineItem(discrepancy);
  const expectedFromDiscrepancy = firstNonZeroQuantity(
    discrepancy?.expectedQty,
    discrepancy?.expected_qty,
    discrepancy?.expectedQuantity,
    discrepancy?.expected_quantity,
    discrepancy?.qtyExpected,
    discrepancy?.qty_expected,
    discrepancy?.expectedUnits,
    discrepancy?.expected_units,
    discrepancy?.unitsExpected,
    discrepancy?.units_expected,
    discrepancy?.expected
  );
  const expectedFromLineItem = firstNonZeroQuantity(
    getItemExpectedQty(getDiscrepancyLineItem(discrepancy)),
    getItemExpectedQty(matchedLineItem)
  );
  const fallbackExpected = firstQuantity(
    discrepancy?.expectedQty,
    discrepancy?.expected_qty,
    discrepancy?.expectedQuantity,
    discrepancy?.expected_quantity,
    discrepancy?.qtyExpected,
    discrepancy?.qty_expected,
    discrepancy?.expectedUnits,
    discrepancy?.expected_units,
    discrepancy?.unitsExpected,
    discrepancy?.units_expected,
    discrepancy?.expected,
    getItemExpectedQty(discrepancyLineItem),
    getItemExpectedQty(matchedLineItem),
    0
  );

  return firstPresent(expectedFromLineItem, expectedFromDiscrepancy, fallbackExpected, 0);
};

const getDiscrepancyReceivedQty = (discrepancy = {}, matchedLineItem = {}) => {
  const discrepancyLineItem = getDiscrepancyLineItem(discrepancy);
  const receivedFromDiscrepancy = firstNonZeroQuantity(
    discrepancy?.receivedQty,
    discrepancy?.received_qty,
    discrepancy?.receivedQuantity,
    discrepancy?.received_quantity,
    discrepancy?.qtyReceived,
    discrepancy?.qty_received,
    discrepancy?.unitsReceived,
    discrepancy?.units_received,
    discrepancy?.received,
    discrepancy?.actualQty,
    discrepancy?.actual_qty,
    discrepancy?.actualQuantity,
    discrepancy?.actual_quantity,
    discrepancy?.actual,
    discrepancy?.actualReceivedQty,
    discrepancy?.actual_received_qty,
    discrepancy?.receivedUnits,
    discrepancy?.received_units,
    discrepancy?.receivedCount,
    discrepancy?.received_count,
    discrepancy?.countedQty,
    discrepancy?.counted_qty,
    discrepancy?.counted
  );
  const receivedFromLineItem = firstNonZeroQuantity(
    getItemReceivedQty(discrepancyLineItem),
    getItemReceivedQty(matchedLineItem)
  );
  const fallbackReceived = firstQuantity(
    discrepancy?.receivedQty,
    discrepancy?.received_qty,
    discrepancy?.receivedQuantity,
    discrepancy?.received_quantity,
    discrepancy?.qtyReceived,
    discrepancy?.qty_received,
    discrepancy?.unitsReceived,
    discrepancy?.units_received,
    discrepancy?.received,
    discrepancy?.actualQty,
    discrepancy?.actual_qty,
    discrepancy?.actualQuantity,
    discrepancy?.actual_quantity,
    discrepancy?.actual,
    discrepancy?.actualReceivedQty,
    discrepancy?.actual_received_qty,
    discrepancy?.receivedUnits,
    discrepancy?.received_units,
    discrepancy?.receivedCount,
    discrepancy?.received_count,
    discrepancy?.countedQty,
    discrepancy?.counted_qty,
    discrepancy?.counted,
    getItemReceivedQty(discrepancyLineItem),
    getItemReceivedQty(matchedLineItem),
    0
  );

  return firstPresent(receivedFromDiscrepancy, receivedFromLineItem, fallbackReceived, 0);
};

const isTruthyFlag = (value) => {
  if (value === true || value === 1 || value === '1') return true;
  return ['true', 'yes', 'y'].includes(String(value || '').trim().toLowerCase());
};

const isItemBundlingEnabled = (item = {}) =>
  isTruthyFlag(item?.needsBundling) || isTruthyFlag(item?.needs_bundling);

const getItemBundleSize = (item = {}) => {
  if (!isItemBundlingEnabled(item)) return '';

  return firstPresent(
    item?.bundleSize,
    item?.bundle_size,
    item?.bundleQty,
    item?.bundle_qty,
    item?.bundleQuantity,
    item?.bundle_quantity,
    item?.bundle,
    item?.casePack,
    item?.case_pack,
    item?.unitsPerBundle,
    item?.units_per_bundle
  );
};

const isPositiveBundleSize = (value) => {
  const bundleSize = Number(value || 0);
  return Number.isFinite(bundleSize) && bundleSize > 0;
};

const getBundleSizeEntriesFromNotes = (notes = '') => {
  const line = String(notes || '')
    .split('\n')
    .find((currentLine) => currentLine.trim().toLowerCase().startsWith(BUNDLE_SIZE_NOTE_PREFIX.toLowerCase()));

  if (!line) return [];

  try {
    const parsedEntries = JSON.parse(line.trim().slice(BUNDLE_SIZE_NOTE_PREFIX.length).trim());
    return Array.isArray(parsedEntries) ? parsedEntries : [];
  } catch {
    return [];
  }
};

const getBundleSizeForLineItem = (item = {}, entries = []) => {
  const itemSku = normalizeDisplayValue(getItemSku(item)).toLowerCase();
  const itemFnsku = normalizeDisplayValue(getItemFnsku(item)).toLowerCase();
  const matchedEntry = entries.find((entry) => {
    const entrySku = normalizeDisplayValue(entry?.sku).toLowerCase();
    const entryFnsku = normalizeDisplayValue(entry?.fnsku).toLowerCase();

    return (
      (itemSku && entrySku && itemSku === entrySku && (!itemFnsku || !entryFnsku || itemFnsku === entryFnsku)) ||
      (itemFnsku && entryFnsku && itemFnsku === entryFnsku)
    );
  });
  const bundleSize = Number(matchedEntry?.bundleSize || matchedEntry?.bundle_size || 0);

  return isPositiveBundleSize(bundleSize) ? bundleSize : '';
};

const applyBundleSizesFromNotes = (items = [], shipment = {}) => {
  const entries = getBundleSizeEntriesFromNotes(getRawShipmentNotes(shipment));
  if (!entries.length) return items;

  return toArray(items).map((item) => {
    if (!isItemBundlingEnabled(item)) return item;
    if (isPositiveBundleSize(getItemBundleSize(item))) return item;
    const bundleSize = getBundleSizeForLineItem(item, entries);
    return isPositiveBundleSize(bundleSize)
      ? { ...item, bundleSize, bundle_size: bundleSize }
      : item;
  });
};

const isDisplayServiceLabel = (value = '') => {
  const normalized = String(value || '').trim().toLowerCase();
  return Boolean(normalized && !['-', 'n/a', 'na', 'none', 'null', 'undefined'].includes(normalized));
};

const toLabelList = (value) => {
  if (!value) return [];
  if (Array.isArray(value)) {
    return value
      .flatMap((item) => toLabelList(item))
      .filter(isDisplayServiceLabel);
  }
  if (typeof value === 'object') {
    return [
      formatServiceLabel(firstPresent(value?.label, value?.name, value?.serviceName, value?.service_name, value?.serviceType, value?.service_type, value?.type)),
    ].filter(isDisplayServiceLabel);
  }

  return String(value)
    .split(/[;,|]/)
    .map((item) => formatServiceLabel(item))
    .filter(isDisplayServiceLabel);
};

const getItemServices = (item = {}) => {
  const services = [
    ...toLabelList(item?.services),
    ...toLabelList(item?.serviceTypes),
    ...toLabelList(item?.service_types),
    ...toLabelList(item?.serviceType),
    ...toLabelList(item?.service_type),
  ];

  return [...new Set(services.map((service) => String(service).trim()).filter(isDisplayServiceLabel))];
};

const getServiceTaskLineItemId = (service = {}) =>
  firstPresent(
    service?.lineItemId,
    service?.line_item_id,
    service?.shipmentItemId,
    service?.shipment_item_id,
    service?.itemId,
    service?.item_id,
    service?.lineItem?.id,
    service?.line_item?.id,
    service?.shipmentItem?.id,
    service?.shipment_item?.id,
    service?.item?.id
  );

const getServiceTaskSku = (service = {}) =>
  firstPresent(
    service?.sku,
    service?.sellerSku,
    service?.seller_sku,
    service?.lineItem?.sku,
    service?.line_item?.sku,
    service?.shipmentItem?.sku,
    service?.shipment_item?.sku,
    service?.item?.sku
  );

const getServiceTaskLabel = (service = {}) =>
  formatServiceLabel(firstPresent(service?.serviceType, service?.service_type, service?.name, service?.serviceName, service?.service_name, service?.type));

const filterBundlingServiceLabels = (services = []) =>
  services.filter((service) => !isBundlingServiceValue(service));

const isBundlingServiceTask = (service = {}) =>
  isBundlingServiceValue(typeof service === 'object' ? getServiceTaskLabel(service) : service);

const isOtherServiceTask = (service = {}) => {
  const rawType = String(firstPresent(service?.serviceType, service?.service_type, service?.type)).trim().toLowerCase();
  const label = String(getServiceTaskLabel(service) || '').trim().toLowerCase();

  return rawType === 'other' || rawType === 'other_service' || label === 'other' || label.includes('other service');
};

const isCustomServiceTask = (service = {}) => {
  const label = getServiceTaskLabel(service);
  if (!isDisplayServiceLabel(label)) return false;
  return isOtherServiceTask(service) || !STANDARD_SERVICE_KEYS.has(normalizeServiceKey(label));
};

const getServiceTaskStatus = (service = {}) =>
  firstPresent(service?.status, service?.taskStatus, service?.task_status, service?.state) || 'PENDING';

const hasBundlingServiceForItem = (item = {}) =>
  getItemServices(item).some(isBundlingServiceValue);

const shouldDisplayServiceTaskForItem = (service = {}, item = {}) =>
  !isBundlingServiceTask(service) || hasBundlingServiceForItem(item);

const getItemServicesForView = (item = {}, services = [], itemCount = 0) => {
  const itemServices = getItemServices(item);
  if (itemServices.length) return itemServices;

  const itemId = String(getItemRecordId(item) || '').trim();
  const itemSku = String(getItemSku(item) || '').trim().toLowerCase();
  const matchedServices = services.filter((service) => {
    const serviceLineItemId = String(getServiceTaskLineItemId(service) || '').trim();
    const serviceSku = String(getServiceTaskSku(service) || '').trim().toLowerCase();
    return (
      (itemId && serviceLineItemId && itemId === serviceLineItemId) ||
      (itemSku && serviceSku && itemSku === serviceSku) ||
      itemCount === 1
    );
  });

  return [
    ...new Set(
      matchedServices
        .filter((service) => shouldDisplayServiceTaskForItem(service, item))
        .map((service) => getServiceTaskLabel(service))
        .filter(isDisplayServiceLabel)
    ),
  ];
};

const SERVICE_TASK_KEYS = [
  'services',
  'serviceTasks',
  'service_tasks',
  'tasks',
  'shipmentServices',
  'shipment_services',
  'requiredServices',
  'required_services',
  'prepServices',
  'prep_services',
];

const SERVICE_TASK_CONTAINERS = ['data', 'shipment', 'row', 'record', 'detail', 'result', 'payload'];

const extractScalarServiceTasks = (source = {}) =>
  SERVICE_TASK_KEYS.flatMap((key) => {
    const value = source?.[key];
    return Array.isArray(value) || (value && typeof value === 'object') ? [] : toLabelList(value);
  });

const extractServiceTasks = (source = {}) => {
  if (Array.isArray(source)) return source;
  if (!source || typeof source !== 'object') return [];

  const directTasks = extractList(source, SERVICE_TASK_KEYS);
  if (directTasks.length) return directTasks;

  const directScalarTasks = extractScalarServiceTasks(source);
  if (directScalarTasks.length) return directScalarTasks;

  for (const key of SERVICE_TASK_CONTAINERS) {
    const value = source[key];
    if (!value || typeof value !== 'object' || value === source) continue;
    const nestedTasks = extractList(value, SERVICE_TASK_KEYS);
    if (nestedTasks.length) return nestedTasks;

    const nestedScalarTasks = extractScalarServiceTasks(value);
    if (nestedScalarTasks.length) return nestedScalarTasks;
  }

  return [];
};

const mergeServiceTasks = (...taskGroups) => {
  const mergedTasks = new Map();

  taskGroups.flat().filter(Boolean).forEach((service) => {
    const serviceLabel = getServiceTaskLabel(service) || formatServiceLabel(service);
    const key = String(
      service?.id ||
        service?.uuid ||
        service?.taskId ||
        service?.task_id ||
        service?.serviceTaskId ||
        service?.service_task_id ||
        `${getServiceTaskLineItemId(service)}-${getServiceTaskSku(service)}-${serviceLabel}`
    );

    if (!mergedTasks.has(key)) {
      mergedTasks.set(key, service);
    }
  });

  return [...mergedTasks.values()];
};

const getServiceTaskId = (service = {}) =>
  firstPresent(service?.id, service?.uuid, service?.taskId, service?.task_id, service?.serviceTaskId, service?.service_task_id);

const getShipmentServiceLabels = (shipment = {}, serviceTasks = []) => {
  const lineItems = getLineItems(shipment);
  const shipmentServiceTasks = mergeServiceTasks(extractServiceTasks(shipment), extractServiceTasks(serviceTasks));
  const labels = [
    ...lineItems.flatMap((item) => getItemServices(item)),
    ...shipmentServiceTasks.flatMap((service) =>
      typeof service === 'object' ? [getServiceTaskLabel(service)] : toLabelList(service)
    ),
    ...toLabelList(shipment?.serviceTypes),
    ...toLabelList(shipment?.service_types),
    ...toLabelList(shipment?.serviceType),
    ...toLabelList(shipment?.service_type),
    ...toLabelList(shipment?.requiredServices),
    ...toLabelList(shipment?.required_services),
    ...toLabelList(shipment?.prepServices),
    ...toLabelList(shipment?.prep_services),
  ];

  return [...new Set(labels.map((service) => String(service || '').trim()).filter(isDisplayServiceLabel))];
};

const formatShipmentServices = (shipment = {}, serviceTasks = []) => {
  const labels = getShipmentServiceLabels(shipment, serviceTasks);
  return labels.length ? labels.join(', ') : '-';
};

const getItemEntityId = (item = {}) =>
  firstPresent(
    getMappedLineItemId(item),
    item?.id,
    item?.uuid,
    item?.shipmentLineItemId,
    item?.shipment_line_item_id,
    item?.lineItemId,
    item?.line_item_id,
    item?.shipmentItemId,
    item?.shipment_item_id,
    item?.itemId,
    item?.item_id,
    item?.shipmentItem?.id,
    item?.shipmentItem?.uuid,
    item?.shipment_item?.id,
    item?.shipment_item?.uuid,
    item?.lineItem?.id,
    item?.lineItem?.uuid,
    item?.line_item?.id,
    item?.line_item?.uuid,
    item?.item?.id,
    item?.item?.uuid
  );

const getItemRecordId = (item = {}) =>
  firstPresent(
    getItemEntityId(item),
    item?.productItemId,
    item?.product_item_id,
    item?.productId,
    item?.product_id,
    item?.product?.id,
    item?.product?.uuid
  );

const normalizeLineItemForDisplay = (item = {}, fallback = {}) => {
  const productName = getItemProductName(item) || getItemProductName(fallback);
  const sku = getItemSku(item) || getItemSku(fallback);
  const fnsku = getItemFnsku(item) || getItemFnsku(fallback);
  const expectedQty = getItemExpectedQty(item) || getItemExpectedQty(fallback);
  const itemHasBundlingFlag = item?.needsBundling !== undefined || item?.needs_bundling !== undefined;
  const shouldUseBundleSize = isItemBundlingEnabled(item) || (!itemHasBundlingFlag && isItemBundlingEnabled(fallback));
  const itemBundleSize = shouldUseBundleSize ? getItemBundleSize(item) : '';
  const fallbackBundleSize = shouldUseBundleSize ? getItemBundleSize(fallback) : '';
  const bundleSize = shouldUseBundleSize
    ? (Number(itemBundleSize || 0) > 0
        ? itemBundleSize
        : firstPresent(fallbackBundleSize, itemBundleSize, 0))
    : '';
  const services = getItemServices(item).length ? getItemServices(item) : getItemServices(fallback);

  return {
    ...fallback,
    ...item,
    productName,
    product_name: productName,
    sku,
    fnskuLabel: fnsku,
    fnsku_label: fnsku,
    expectedQty,
    expected_qty: expectedQty,
    bundleSize,
    bundle_size: bundleSize,
    services,
  };
};

const sameLineItem = (left = {}, right = {}) => {
  const leftId = String(getItemRecordId(left) || '').trim();
  const rightId = String(getItemRecordId(right) || '').trim();
  const leftSku = String(getItemSku(left) || '').trim().toLowerCase();
  const rightSku = String(getItemSku(right) || '').trim().toLowerCase();
  const leftFnsku = String(getItemFnsku(left) || '').trim().toLowerCase();
  const rightFnsku = String(getItemFnsku(right) || '').trim().toLowerCase();

  return Boolean(
    (leftId && rightId && leftId === rightId) ||
      (leftSku && rightSku && leftSku === rightSku) ||
      (leftFnsku && rightFnsku && leftFnsku === rightFnsku)
  );
};

const parseLineItemOrderValue = (value) => {
  if (value === undefined || value === null || String(value).trim() === '') return null;
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : null;
};

const getLineItemExplicitOrder = (item = {}) => {
  const candidates = [
    item?.itemIndex,
    item?.item_index,
    item?.lineItemIndex,
    item?.line_item_index,
    item?.displayOrder,
    item?.display_order,
    item?.sortOrder,
    item?.sort_order,
    item?.position,
    item?.sequence,
    item?.lineNumber,
    item?.line_number,
  ];

  for (const value of candidates) {
    const order = parseLineItemOrderValue(value);
    if (order !== null) return order;
  }

  return null;
};

const PRODUCT_SEQUENCE_PREFIXES = ['product', 'prod', 'pp', 'p'];
const SKU_SEQUENCE_PREFIXES = ['sku', 'product', 'prod', 'pp', 'p'];
const FNSKU_SEQUENCE_PREFIXES = ['fnsku', 'f', 'sku', 'product', 'prod', 'pp', 'p'];

const parsePrefixedSequence = (value = '', prefixes = []) => {
  const text = String(value || '').trim();
  if (!text) return null;
  const prefixPattern = prefixes.join('|');
  const match = text.match(new RegExp(`^(?:${prefixPattern})[\\s_-]*0*(\\d+)$`, 'i'));
  if (!match) return null;
  const order = Number(match[1]);
  return Number.isFinite(order) ? order : null;
};

const getLineItemReliableSequenceOrder = (item = {}) =>
  parsePrefixedSequence(getItemSku(item), SKU_SEQUENCE_PREFIXES) ??
  parsePrefixedSequence(getItemFnsku(item), FNSKU_SEQUENCE_PREFIXES) ??
  parsePrefixedSequence(getItemProductName(item), PRODUCT_SEQUENCE_PREFIXES);

const getLineItemNaturalOrder = (item = {}) =>
  getLineItemReliableSequenceOrder(item);

const sortLineItemsByRank = (items = [], getRank = () => null) => {
  const itemList = Array.isArray(items) ? items : [];
  if (itemList.length < 2) return itemList;

  const rankedItems = itemList.map((item, index) => ({
    item,
    index,
    rank: getRank(item, index),
  }));
  const allRanked = rankedItems.every(({ rank }) => rank !== null && rank !== undefined);
  const uniqueRanks = new Set(rankedItems.map(({ rank }) => String(rank))).size === rankedItems.length;

  if (!allRanked || !uniqueRanks) return itemList;

  return rankedItems
    .sort((firstItem, secondItem) => firstItem.rank - secondItem.rank || firstItem.index - secondItem.index)
    .map(({ item }) => item);
};

const sortLineItemsForDisplay = (items = [], fallbackItems = []) => {
  const itemList = Array.isArray(items) ? items : [];
  if (itemList.length < 2) return itemList;

  const fallbackList = Array.isArray(fallbackItems) ? fallbackItems : [];
  const fallbackSortedItems = fallbackList.length
    ? sortLineItemsByRank(
        sortLineItemsByRank(fallbackList, getLineItemExplicitOrder),
        getLineItemNaturalOrder
      )
    : [];

  if (fallbackSortedItems.length >= itemList.length) {
    const fallbackOrderedItems = sortLineItemsByRank(itemList, (item) => {
      const fallbackIndex = fallbackSortedItems.findIndex((fallbackItem) => sameLineItem(item, fallbackItem));
      return fallbackIndex >= 0 ? fallbackIndex : null;
    });
    if (fallbackOrderedItems !== itemList) return fallbackOrderedItems;
  }

  const naturalOrderedItems = sortLineItemsByRank(itemList, getLineItemNaturalOrder);
  if (naturalOrderedItems !== itemList) return naturalOrderedItems;

  const explicitOrderedItems = sortLineItemsByRank(itemList, getLineItemExplicitOrder);
  if (explicitOrderedItems !== itemList) return explicitOrderedItems;

  return itemList;
};

const mergeLineItemFallbacks = (fallbacks = []) =>
  fallbacks.filter(Boolean).reduce((merged, fallback) => {
    const nextFallback = { ...merged, ...fallback };
    const mergedBundleSize = getItemBundleSize(merged);
    const fallbackBundleSize = getItemBundleSize(fallback);
    const bundleSize = isItemBundlingEnabled(nextFallback)
      ? (isPositiveBundleSize(fallbackBundleSize)
          ? fallbackBundleSize
          : isPositiveBundleSize(mergedBundleSize)
            ? mergedBundleSize
            : firstPresent(fallbackBundleSize, mergedBundleSize))
      : '';

    if (bundleSize !== '') {
      nextFallback.bundleSize = bundleSize;
      nextFallback.bundle_size = bundleSize;
    } else {
      delete nextFallback.bundleSize;
      delete nextFallback.bundle_size;
    }

    return nextFallback;
  }, {});

const mergeLineItemGroups = (...groups) => {
  const [primaryGroup = [], ...fallbackGroups] = groups.map((group) => (Array.isArray(group) ? group : []));
  const fallbackItems = sortLineItemsForDisplay(fallbackGroups.flat());
  const primaryItems = sortLineItemsForDisplay(
    primaryGroup.length ? primaryGroup : fallbackGroups.find((group) => group.length) || [],
    fallbackItems
  );

  return primaryItems.map((item, index) => {
    const fallback = mergeLineItemFallbacks([
      ...fallbackItems.filter((candidate) => sameLineItem(item, candidate)),
      fallbackItems[index],
    ]);

    return normalizeLineItemForDisplay(item, fallback);
  });
};

const buildSelectedShipmentFallback = (shipment = {}, shipmentId = '') => {
  const resolvedId = getShipmentId(shipment) || shipmentId;
  const lineItems = sortLineItemsForDisplay(getLineItems(shipment));

  return {
    ...shipment,
    id: resolvedId,
    reference: getShipmentReference(shipment) || resolvedId || 'N/A',
    expectedArrivalDate: shipment?.expectedArrivalDate || shipment?.expected_arrival_date || shipment?.expected || '',
    expected_arrival_date: shipment?.expected_arrival_date || shipment?.expectedArrivalDate || shipment?.expected || '',
    arrivedDate: shipment?.arrivedDate || shipment?.receivedAt || shipment?.actual_arrival_date || shipment?.arrived || '',
    actual_arrival_date: shipment?.actual_arrival_date || shipment?.receivedAt || shipment?.arrivedDate || shipment?.arrived || '',
    createdAt: shipment?.createdAt || shipment?.created_at || '',
    created_at: shipment?.created_at || shipment?.createdAt || '',
    created: getShipmentCreatedDate(shipment),
    dispatchedAt: shipment?.dispatchedAt || shipment?.dispatched_at || '',
    dispatched_at: shipment?.dispatched_at || shipment?.dispatchedAt || '',
    items: lineItems,
    lineItems,
    status: shipment?.status || 'draft',
  };
};

const buildShipmentPreview = (shipment = {}, shipmentId = '') => {
  const fallback = buildSelectedShipmentFallback(shipment, shipmentId);
  const cachedDraft = getCachedDraft(fallback, shipment, shipmentId);
  const cachedItems = cachedDraft?.productItems || [];
  const fallbackItems = sortLineItemsForDisplay(getLineItems(fallback), cachedItems);
  const selectedItems = applyBundleSizesFromNotes(
    cachedItems.length ? mergeLineItemGroups(cachedItems, fallbackItems) : fallbackItems,
    fallback
  );
  const cachedNotes = cachedDraft?.createForm ? buildShipmentNotes(cachedDraft.createForm, cachedItems) : '';
  const cachedExpectedArrivalDate = cachedDraft?.createForm?.expectedArrivalDate || '';

  return {
    ...fallback,
    notes: cachedNotes || fallback.notes || fallback.client_notes || '',
    client_notes: cachedNotes || fallback.client_notes || fallback.notes || '',
    expectedArrivalDate: formatDateForInput(
      cachedExpectedArrivalDate ||
        fallback.expectedArrivalDate ||
        fallback.expected_arrival_date ||
        fallback.expected
    ),
    expected_arrival_date: formatDateForInput(
      cachedExpectedArrivalDate ||
        fallback.expected_arrival_date ||
        fallback.expectedArrivalDate ||
        fallback.expected
    ),
    items: selectedItems,
    lineItems: selectedItems,
  };
};

const extractShipmentDetail = (payload) =>
  normalizeMappedShipment(
    payload?.shipment ||
      payload?.data?.shipment ||
      payload?.data?.row ||
      payload?.data ||
      payload ||
      {}
  );

const normalizeShipment = (shipment) => {
  const mappedShipment = normalizeMappedShipment(shipment);
  const lineItems = sortLineItemsForDisplay(getLineItems(mappedShipment));

  return {
    ...mappedShipment,
    id: getShipmentId(mappedShipment),
    reference: getShipmentReference(mappedShipment),
    created: getShipmentCreatedDate(mappedShipment),
    expected: formatListDate(mappedShipment?.expectedArrivalDate || mappedShipment?.expected_arrival_date || mappedShipment?.expected),
    arrived: formatListDate(mappedShipment?.arrivedDate || mappedShipment?.receivedAt || mappedShipment?.actual_arrival_date || mappedShipment?.arrived),
    units:
      mappedShipment?.units ||
      mappedShipment?.totalUnits ||
      mappedShipment?.total_units ||
      lineItems.reduce((sum, item) => sum + Number(getItemExpectedQty(item) || 0), 0) ||
      0,
    services: formatShipmentServices({ ...mappedShipment, items: lineItems, lineItems }),
    status: mappedShipment?.status || 'draft',
    items: lineItems,
    lineItems,
  };
};

const getShipmentSortTime = (shipment = {}) => {
  const value =
    shipment?.createdAt ||
    shipment?.created_at ||
    shipment?.submittedAt ||
    shipment?.submitted_at ||
    shipment?.created ||
    shipment?.createdDate ||
    shipment?.created_date ||
    '';
  const parsedDate = value ? new Date(value) : null;
  return parsedDate && !Number.isNaN(parsedDate.getTime()) ? parsedDate.getTime() : 0;
};

const getShipmentReferenceRank = (shipment = {}) => {
  const match = String(shipment?.reference || shipment?.shipmentNumber || shipment?.shipment_number || '').match(/(\d+)$/);
  return match ? Number(match[1]) : 0;
};

const sortShipmentsForList = (shipmentRows = []) =>
  [...shipmentRows].sort((firstShipment, secondShipment) => {
    const timeDifference = getShipmentSortTime(secondShipment) - getShipmentSortTime(firstShipment);
    if (timeDifference) return timeDifference;

    const referenceDifference = getShipmentReferenceRank(secondShipment) - getShipmentReferenceRank(firstShipment);
    if (referenceDifference) return referenceDifference;

    return String(secondShipment?.reference || '').localeCompare(String(firstShipment?.reference || ''), undefined, {
      numeric: true,
      sensitivity: 'base',
    });
  });

const getShipmentMergeKey = (shipment = {}) =>
  [
    getShipmentRecordId(shipment),
    shipment?.id,
    shipment?.uuid,
    shipment?.shipmentId,
    shipment?.shipment_id,
    shipment?.reference,
    shipment?.shipmentNumber,
    shipment?.shipment_number,
  ]
    .map((value) => String(value || '').trim())
    .find(isValidLookupValue) || '';

const isValidShipmentForList = (shipment = {}) => Boolean(getShipmentMergeKey(shipment));

const getShipmentLookupCandidates = (...shipments) => [
  ...new Set(
    shipments
      .flat()
      .filter(Boolean)
      .flatMap((shipment) => {
        if (typeof shipment !== 'object') return [shipment];
        return [
          getShipmentRecordId(shipment),
          shipment?.id,
          shipment?.uuid,
          shipment?.shipmentId,
          shipment?.shipment_id,
          shipment?.recordId,
          shipment?.record_id,
          getShipmentReference(shipment),
          shipment?.reference,
          shipment?.shipmentNumber,
          shipment?.shipment_number,
        ];
      })
      .map((value) => String(value || '').trim())
      .filter(isValidLookupValue)
  ),
];

const getUuidLookupCandidates = (lookupCandidates = []) => [
  ...new Set(
    lookupCandidates
      .map((value) => String(value || '').trim())
      .filter(isUuidValue)
  ),
];

const mergeShipmentLists = (...shipmentLists) => {
  const mergedShipments = new Map();

  shipmentLists.flat().filter(Boolean).forEach((shipment, index) => {
    const key = getShipmentMergeKey(shipment);
    if (!key) return;

    const previousShipment = mergedShipments.get(key);
    if (!previousShipment) {
      mergedShipments.set(key, shipment);
      return;
    }

    const mergedShipment = { ...previousShipment, ...shipment };
    const mergedItems = mergeLineItemGroups(getLineItems(shipment), getLineItems(previousShipment));
    if (mergedItems.length) {
      mergedShipment.items = mergedItems;
      mergedShipment.lineItems = mergedItems;
    }
    mergedShipments.set(key, mergedShipment);
  });

  return [...mergedShipments.values()];
};

const enrichShipmentsWithServiceTasks = async (shipmentRows = []) => {
  const rowsNeedingServices = shipmentRows.filter((shipment) => {
    const shipmentId = getShipmentLookupCandidates(shipment).find(Boolean);
    return shipmentId && !getShipmentServiceLabels(shipment).length;
  });

  if (!rowsNeedingServices.length) {
    return shipmentRows;
  }

  const serviceResults = await Promise.allSettled(
    rowsNeedingServices.map(async (shipment) => {
      const shipmentId = getShipmentLookupCandidates(shipment).find(Boolean);
      const response = await fetch(`${API_BASE_URL}/api/shipments/${encodeURIComponent(shipmentId)}/services`, {
        method: 'GET',
        headers: buildHeaders(),
        cache: 'no-store',
      });
      const payload = await parseResponse(response);
      return {
        key: getShipmentMergeKey(shipment),
        services: extractServiceTasks(payload),
      };
    })
  );

  const servicesByShipment = new Map();
  serviceResults.forEach((result) => {
    if (result.status === 'fulfilled' && result.value.key && result.value.services.length) {
      servicesByShipment.set(result.value.key, result.value.services);
    }
  });

  if (!servicesByShipment.size) {
    return shipmentRows;
  }

  return shipmentRows.map((shipment) => {
    const serviceTasks = servicesByShipment.get(getShipmentMergeKey(shipment)) || [];
    if (!serviceTasks.length) return shipment;

    return {
      ...shipment,
      serviceTasks,
      service_tasks: serviceTasks,
      services: formatShipmentServices(shipment, serviceTasks),
    };
  });
};

const extractCustomServices = (shipment, serviceTasks = []) => {
  const items = getLineItems(shipment);
  const customServices = items.flatMap((item) =>
    (item?.customServices || item?.custom_services || []).map((service, index) => ({
      id: service?.id || `${getItemRecordId(item) || getItemSku(item) || 'item'}-${index}`,
      lineItemId: getItemRecordId(item) || '',
      sku: getItemSku(item) || '-',
      name: service?.name || service?.serviceName || 'Custom Service',
      price: service?.price,
      status: service?.status || 'PENDING',
    }))
  );
  const existingKeys = new Set(
    customServices.map((service) =>
      `${String(service.lineItemId || '').trim()}-${String(service.name || '').trim().toLowerCase()}`
    )
  );

  extractServiceTasks(serviceTasks)
    .filter(isCustomServiceTask)
    .forEach((service, index) => {
      const serviceLineItemId = String(getServiceTaskLineItemId(service) || '').trim();
      const serviceSku = String(getServiceTaskSku(service) || '').trim().toLowerCase();
      const matchedItem = items.find((item) => {
        const itemId = String(getItemRecordId(item) || '').trim();
        const itemSku = String(getItemSku(item) || '').trim().toLowerCase();
        return (serviceLineItemId && itemId === serviceLineItemId) || (serviceSku && itemSku === serviceSku);
      });
      const lineItemId = serviceLineItemId || getItemRecordId(matchedItem) || '';
      const name = firstPresent(
        service?.customServiceName,
        service?.custom_service_name,
        service?.customName,
        service?.custom_name,
        service?.name,
        service?.serviceName,
        service?.service_name,
        getServiceTaskLabel(service),
        'Other Service'
      );
      const key = `${String(lineItemId || '').trim()}-${String(name || '').trim().toLowerCase()}`;

      if (existingKeys.has(key)) return;
      existingKeys.add(key);

      customServices.push({
        id: getServiceTaskId(service) || `other-service-${lineItemId || serviceSku || index}`,
        lineItemId,
        sku: getItemSku(matchedItem) || getServiceTaskSku(service) || '-',
        name,
        price: service?.price,
        status: getServiceTaskStatus(service),
      });
    });

  return customServices;
};

const itemMatchesReferences = (item = {}, { lineItemId = '', sku = '', fnsku = '' } = {}) => {
  const itemId = String(getItemRecordId(item) || '').trim();
  const itemSku = String(getItemSku(item) || '').trim().toLowerCase();
  const itemFnsku = String(getItemFnsku(item) || '').trim().toLowerCase();
  const referenceLineItemId = String(lineItemId || '').trim();
  const referenceSku = String(sku || '').trim().toLowerCase();
  const referenceFnsku = String(fnsku || '').trim().toLowerCase();

  return Boolean(
    (itemId && referenceLineItemId && itemId === referenceLineItemId) ||
      (itemSku && referenceSku && itemSku === referenceSku) ||
      (itemFnsku && referenceFnsku && itemFnsku === referenceFnsku)
  );
};

const isServiceTaskForItem = (service = {}, item = {}, itemCount = 0) => {
  const lineItemId = getServiceTaskLineItemId(service);
  const sku = getServiceTaskSku(service);

  if (lineItemId || sku) {
    return itemMatchesReferences(item, { lineItemId, sku });
  }

  return itemCount === 1;
};

const isDiscrepancyForItem = (discrepancy = {}, item = {}, lineItems = [], discrepancyIndex = -1) => {
  const lineItemId = getDiscrepancyLineItemId(discrepancy);
  const sku = getDiscrepancySku(discrepancy);

  if (lineItemId || sku) {
    return itemMatchesReferences(item, { lineItemId, sku });
  }

  if (lineItems.length === 1) {
    return sameLineItem(item, lineItems[0]);
  }

  const matchedLineItem = findLineItemForDiscrepancy(discrepancy, lineItems, discrepancyIndex);
  return sameLineItem(item, matchedLineItem);
};

const isCustomServiceForItem = (service = {}, item = {}, itemCount = 0) => {
  const lineItemId = service?.lineItemId || service?.line_item_id || '';
  const sku = service?.sku || '';

  if (lineItemId || sku) {
    return itemMatchesReferences(item, { lineItemId, sku });
  }

  return itemCount === 1;
};

const formatTrackerDate = (value) => {
  if (!value) return 'Pending';
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? String(value)
    : date.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' }) +
        ', ' +
        date.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
};

const getBoxId = (box = {}) => box?.id || box?.uuid || box?.boxId || box?.box_id || '';

const getBoxTitle = (box = {}, index = 0) =>
  firstPresent(box?.name, box?.label, box?.reference, box?.boxNumber, box?.box_number, `Box #${index + 1}`);

const getBoxDisplayTitle = (box = {}, index = 0) => {
  const title = String(getBoxTitle(box, index) || '').trim();
  const typeLabel = String(box?.box_type || box?.boxType || '').toLowerCase() === 'pallet' ? 'Pallet' : 'Box';
  if (/^\d+$/.test(title)) return `${typeLabel} ${title}`;
  return title || `${typeLabel} ${index + 1}`;
};

const getBoxLookupIds = (box = {}) => [
  ...new Set(
    [
      box?.id,
      box?.uuid,
      box?.boxId,
      box?.box_id,
      box?.recordId,
      box?.record_id,
      box?.boxRecordId,
      box?.box_record_id,
      box?.boxNumber,
      box?.box_number,
      box?.reference,
      box?.label,
    ]
      .map((value) => String(value || '').trim())
      .filter(Boolean)
  ),
];

const getBoxItemsLookupId = (box = {}) =>
  getBoxRecordId(box) || getBoxId(box) || getBoxLookupIds(box).find(Boolean);

const getBoxItemLineItemId = (item = {}) =>
  firstPresent(
    item?.shipmentItemId,
    item?.shipment_item_id,
    item?.shipmentLineItemId,
    item?.shipment_line_item_id,
    item?.lineItemId,
    item?.line_item_id,
    item?.itemId,
    item?.item_id,
    item?.productItemId,
    item?.product_item_id,
    item?.shipmentItem?.id,
    item?.shipmentItem?.uuid,
    item?.shipment_item?.id,
    item?.shipment_item?.uuid,
    item?.shipmentLineItem?.id,
    item?.shipmentLineItem?.uuid,
    item?.shipment_line_item?.id,
    item?.shipment_line_item?.uuid,
    item?.lineItem?.id,
    item?.lineItem?.uuid,
    item?.line_item?.id,
    item?.line_item?.uuid,
    item?.item?.id,
    item?.item?.uuid
  );

const getBoxItemSku = (item = {}) =>
  normalizeDisplayValue(
    firstPresent(
      item?.sku,
      item?.sellerSku,
      item?.seller_sku,
      item?.shipmentItemSku,
      item?.shipment_item_sku,
      item?.lineItemSku,
      item?.line_item_sku,
      item?.productSku,
      item?.product_sku,
      item?.product?.sku,
      item?.product?.sellerSku,
      item?.product?.seller_sku,
      getItemSku(item?.shipmentItem || {}),
      getItemSku(item?.shipment_item || {}),
      getItemSku(item?.shipmentLineItem || {}),
      getItemSku(item?.shipment_line_item || {}),
      getItemSku(item?.lineItem || {}),
      getItemSku(item?.line_item || {}),
      getItemSku(item?.item || {})
    )
  );

const getBoxItemQuantity = (item = {}) =>
  firstQuantity(
    item?.quantity,
    item?.qty,
    item?.units,
    item?.itemQuantity,
    item?.item_quantity,
    item?.allocatedQuantity,
    item?.allocated_quantity,
    item?.allocatedQty,
    item?.allocated_qty,
    item?.qtyAllocated,
    item?.qty_allocated,
    item?.packedQuantity,
    item?.packed_quantity,
    item?.boxedQuantity,
    item?.boxed_quantity,
    item?.unitCount,
    item?.unit_count
  );

const BOX_ITEM_KEYS = [
  'items',
  'boxItems',
  'box_items',
  'boxLineItems',
  'box_line_items',
  'contents',
  'boxContents',
  'box_contents',
  'lineItems',
  'line_items',
  'shipmentItems',
  'shipment_items',
  'products',
  'skus',
];

const extractBoxItems = (payload) => {
  const directItems = extractList(payload, BOX_ITEM_KEYS);
  if (directItems.length) return directItems;

  const containers = [
    payload?.box,
    payload?.data?.box,
    payload?.record,
    payload?.data?.record,
    payload?.payload,
    payload?.data?.payload,
  ];

  for (const container of containers) {
    const items = extractList(container, BOX_ITEM_KEYS);
    if (items.length) return items;
  }

  const nestedLists = [
    payload?.items,
    payload?.boxItems,
    payload?.box_items,
    payload?.boxLineItems,
    payload?.box_line_items,
    payload?.contents,
    payload?.boxContents,
    payload?.box_contents,
    payload?.lineItems,
    payload?.line_items,
    payload?.shipmentItems,
    payload?.shipment_items,
    payload?.products,
    payload?.skus,
    payload?.data?.items,
    payload?.data?.boxItems,
    payload?.data?.box_items,
    payload?.data?.boxLineItems,
    payload?.data?.box_line_items,
    payload?.data?.contents,
    payload?.data?.boxContents,
    payload?.data?.box_contents,
    payload?.data?.lineItems,
    payload?.data?.line_items,
    payload?.data?.shipmentItems,
    payload?.data?.shipment_items,
    payload?.data?.products,
    payload?.data?.skus,
  ];

  for (const nestedList of nestedLists) {
    const rows = toArray(nestedList);
    if (rows.length) return rows;
  }

  return [];
};

const getBoxItems = (box = {}) => {
  const directItems = extractBoxItems(box);
  if (directItems.length) return directItems;

  const rawContents = firstPresent(
    box?.contents,
    box?.boxContents,
    box?.box_contents,
    box?.items,
    box?.boxItems,
    box?.box_items,
    box?.boxLineItems,
    box?.box_line_items,
    box?.lineItems,
    box?.line_items,
    box?.shipmentItems,
    box?.shipment_items,
    box?.products,
    box?.skus
  );
  if (Array.isArray(rawContents)) return rawContents;
  if (rawContents && typeof rawContents === 'object') return [rawContents];
  if (typeof rawContents === 'string') {
    try {
      const parsedContents = JSON.parse(rawContents);
      return Array.isArray(parsedContents) ? parsedContents : parsedContents ? [parsedContents] : [];
    } catch {
      return rawContents.trim() ? [{ sku: rawContents.trim() }] : [];
    }
  }

  return [];
};

const parseInlineBoxSkuQuantityText = (value = '') =>
  String(value || '')
    .split(/[,;\n]+/)
    .map((part) => {
      const normalizedPart = part.trim().replace(/^SKU:\s*/i, '');
      if (!normalizedPart) return null;

      const match = normalizedPart.match(/^(.+?)\s*(?:x|:|\*)\s*(\d+(?:\.\d+)?)\s*(?:units?)?$/i);
      const sku = normalizeDisplayValue(match ? match[1] : normalizedPart);

      return sku ? { sku, quantity: match ? match[2] : '' } : null;
    })
    .filter(Boolean);

const getInlineBoxItemQuantity = (item = {}) =>
  item && typeof item === 'object'
    ? firstQuantity(
        item?.quantity,
        item?.qty,
        item?.units,
        item?.itemQuantity,
        item?.item_quantity,
        item?.allocatedQuantity,
        item?.allocated_quantity,
        item?.allocatedQty,
        item?.allocated_qty,
        item?.qtyAllocated,
        item?.qty_allocated,
        item?.packedQuantity,
        item?.packed_quantity,
        item?.boxedQuantity,
        item?.boxed_quantity,
        item?.unitCount,
        item?.unit_count
      )
    : '';

const boxItemHasUsableAllocationData = (item = {}) => {
  if (typeof item === 'string') {
    const parsedRows = parseInlineBoxSkuQuantityText(item);
    return Boolean(parsedRows.length && parsedRows.every((row) => row.quantity !== ''));
  }

  const sku = normalizeDisplayValue(
    firstPresent(
      item?.sku,
      item?.sellerSku,
      item?.seller_sku,
      item?.shipmentItemSku,
      item?.shipment_item_sku,
      item?.lineItemSku,
      item?.line_item_sku,
      item?.productSku,
      item?.product_sku,
      getItemSku(item?.shipmentItem || {}),
      getItemSku(item?.shipment_item || {}),
      getItemSku(item?.lineItem || {}),
      getItemSku(item?.line_item || {}),
      getItemSku(item?.item || {})
    )
  );
  const quantity = getInlineBoxItemQuantity(item);
  if (sku && quantity !== '') return true;

  const parsedRows = parseInlineBoxSkuQuantityText(sku);
  return Boolean(parsedRows.length && parsedRows.every((row) => row.quantity !== ''));
};

const boxHasInlineAllocationData = (box = {}) =>
  getBoxItems(box).length > 0 && getBoxItems(box).every(boxItemHasUsableAllocationData);

const getBoxAllocationCacheKeys = (box = {}, extraKeys = []) => [
  ...new Set(
    [
      ...extraKeys,
      getBoxRecordId(box),
      getBoxId(box),
      box?.boxId,
      box?.box_id,
      box?.recordId,
      box?.record_id,
      box?.reference,
      box?.label,
      box?.boxNumber,
      box?.box_number,
    ]
      .map((value) => String(value || '').trim())
      .filter(Boolean)
  ),
];

const readBoxAllocationCache = () => {
  if (typeof window === 'undefined') return {};

  try {
    const parsed = JSON.parse(localStorage.getItem(BOX_ALLOCATION_CACHE_KEY) || '{}');
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
};

const writeBoxAllocationCache = (cache = {}) => {
  if (typeof window === 'undefined') return;

  try {
    localStorage.setItem(BOX_ALLOCATION_CACHE_KEY, JSON.stringify(cache));
  } catch {
    // Allocation display should keep working even if browser storage is unavailable.
  }
};

const normalizeBoxAllocationItems = (items = []) =>
  toArray(items)
    .map((item) => (item && typeof item === 'object' ? item : { sku: String(item || '').trim() }))
    .map((item) => {
      const sku = getBoxItemSku(item);
      const quantity = getBoxItemQuantity(item);
      const shipmentItemId = String(getBoxItemLineItemId(item) || '').trim();

      return {
        ...item,
        ...(shipmentItemId
          ? {
              shipmentItemId,
              shipment_item_id: shipmentItemId,
              lineItemId: shipmentItemId,
              line_item_id: shipmentItemId,
            }
          : {}),
        ...(sku
          ? {
              sku,
              sellerSku: sku,
              seller_sku: sku,
            }
          : {}),
        ...(quantity !== ''
          ? {
              quantity,
              qty: quantity,
              units: quantity,
            }
          : {}),
      };
    })
    .filter((item) => getBoxItemSku(item) && getBoxItemQuantity(item) !== '');

const getCachedBoxAllocationItems = (box = {}, lineItemList = []) => {
  const cache = readBoxAllocationCache();
  const keys = getBoxAllocationCacheKeys(box);
  const cachedItems = keys.map((key) => cache[key]).find((items) => toArray(items).length);
  return getShipmentScopedBoxItems(normalizeBoxAllocationItems(cachedItems || []), lineItemList);
};

const saveCachedBoxAllocationItems = (box = {}, items = [], extraKeys = []) => {
  const normalizedItems = normalizeBoxAllocationItems(items);
  if (!normalizedItems.length) return;

  const keys = getBoxAllocationCacheKeys(box, extraKeys);
  if (!keys.length) return;

  const cache = readBoxAllocationCache();
  keys.forEach((key) => {
    cache[key] = normalizedItems;
  });
  writeBoxAllocationCache(cache);
};

const findLineItemForBoxItem = (boxItem = {}, lineItemList = []) => {
  const boxItemId = String(getBoxItemLineItemId(boxItem) || '').trim();
  const boxItemSku = getBoxItemSku(boxItem);

  return toArray(lineItemList).find((lineItem) => {
    const lineItemIds = getItemLabelMatchIds(lineItem);
    const lineItemSku = normalizeDisplayValue(getItemSku(lineItem));

    return Boolean(
      (boxItemId && lineItemIds.includes(boxItemId)) ||
        (boxItemSku && lineItemSku && skuValuesMatch(boxItemSku, lineItemSku))
    );
  });
};

const hydrateBoxItemWithLineItem = (boxItem = {}, lineItemList = []) => {
  const matchedLineItem = findLineItemForBoxItem(boxItem, lineItemList);
  const matchedLineItemId = matchedLineItem ? getItemRecordId(matchedLineItem) : '';
  const rawSku = getBoxItemSku(boxItem);
  const matchedSku = getItemSku(matchedLineItem || {});
  const sku = matchedSku || rawSku;
  const quantity = getBoxItemQuantity(boxItem);

  return {
    ...boxItem,
    ...(rawSku && matchedSku && rawSku !== matchedSku
      ? {
          sourceSku: rawSku,
          source_sku: rawSku,
        }
      : {}),
    ...(matchedLineItemId && !getBoxItemLineItemId(boxItem)
      ? {
          shipmentItemId: matchedLineItemId,
          shipment_item_id: matchedLineItemId,
          lineItemId: matchedLineItemId,
          line_item_id: matchedLineItemId,
        }
      : {}),
    ...(sku
      ? {
          sku,
          sellerSku: sku,
          seller_sku: sku,
        }
      : {}),
    ...(quantity !== ''
      ? {
          quantity,
          qty: quantity,
          units: quantity,
        }
      : {}),
  };
};

const hydrateBoxItemsWithLineItems = (boxItems = [], lineItemList = []) =>
  toArray(boxItems).map((boxItem) => hydrateBoxItemWithLineItem(boxItem, lineItemList));

const getShipmentScopedBoxItems = (boxItems = [], lineItemList = []) => {
  const lineItems = toArray(lineItemList);
  const hydratedItems = hydrateBoxItemsWithLineItems(boxItems, lineItems);

  if (!lineItems.length) return hydratedItems;
  return hydratedItems.filter((boxItem) => findLineItemForBoxItem(boxItem, lineItems));
};

const getBoxFbaLabelFileId = (box = {}) =>
  firstPresent(
    box?.fbaShippingLabelFileId,
    box?.fba_shipping_label_file_id,
    box?.fbaLabelFileId,
    box?.fba_label_file_id,
    box?.shippingLabelFileId,
    box?.shipping_label_file_id,
    box?.labelFileId,
    box?.label_file_id,
    box?.fbaLabel?.id,
    box?.fba_label?.id,
    box?.shippingLabel?.id,
    box?.shipping_label?.id,
    box?.label?.id,
    box?.file?.id
  );

const getBoxExplicitFbaLabelFileId = (box = {}) =>
  firstPresent(
    box?.fbaShippingLabelFileId,
    box?.fba_shipping_label_file_id,
    box?.fbaLabelFileId,
    box?.fba_label_file_id,
    box?.shippingLabelFileId,
    box?.shipping_label_file_id,
    box?.labelFileId,
    box?.label_file_id,
    box?.fbaLabel?.id,
    box?.fba_label?.id,
    box?.shippingLabel?.id,
    box?.shipping_label?.id,
    box?.label?.id,
    box?.file?.id
  );

const getBoxRawStatus = (box = {}) =>
  firstPresent(
    box?.status,
    box?.boxStatus,
    box?.box_status,
    box?.state,
    box?.dispatchStatus,
    box?.dispatch_status,
    box?.shipmentStatus,
    box?.shipment_status,
    box?.labelStatus,
    box?.label_status,
    box?.metadata?.status,
    box?.meta?.status
  );

const isBoxDispatchedForFba = (box = {}) => {
  const status = String(getBoxRawStatus(box) || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '_');

  return Boolean(
    box?.dispatched_at ||
      box?.dispatchedAt ||
      box?.dispatch_date ||
      box?.dispatchDate ||
      ['dispatched', 'sealed', 'completed', 'complete'].includes(status)
  );
};

const getBoxStatus = (box = {}) => {
  const rawStatus = getBoxRawStatus(box);
  const normalizedStatus = String(rawStatus || '').trim().toLowerCase().replace(/\s+/g, '_');
  if (['completed', 'complete'].includes(normalizedStatus)) return 'Completed';
  if (isBoxDispatchedForFba(box)) return 'Dispatched';
  return rawStatus || 'No status';
};

const getBoxDisplayStatus = (box = {}, shipmentStatus = '') => {
  const boxStatus = getBoxStatus(box);
  const normalizedBoxStatus = String(boxStatus || '').trim().toLowerCase().replaceAll('_', ' ');
  const normalizedShipmentStatus = String(shipmentStatus || '').trim().toLowerCase().replaceAll('_', ' ');

  if (
    ['', 'no status', 'draft', 'pending', 'pending arrival'].includes(normalizedBoxStatus) &&
    normalizedShipmentStatus === 'completed'
  ) {
    return 'Completed';
  }

  if (normalizedShipmentStatus === 'completed' && normalizedBoxStatus !== 'completed') {
    return 'Completed';
  }

  if (
    ['', 'no status', 'draft', 'pending', 'pending arrival'].includes(normalizedBoxStatus) &&
    normalizedShipmentStatus === 'dispatched'
  ) {
    return 'Dispatched';
  }

  return boxStatus;
};

const getBoxWeight = (box = {}) =>
  firstPresent(
    box?.weight,
    box?.weightKg,
    box?.weight_kg,
    box?.grossWeight,
    box?.gross_weight,
    box?.grossWeightKg,
    box?.gross_weight_kg,
    box?.totalWeight,
    box?.total_weight,
    box?.totalWeightKg,
    box?.total_weight_kg,
    box?.dimensions?.weight,
    box?.metadata?.weight,
    box?.metadata?.weightKg,
    box?.metadata?.weight_kg,
    box?.meta?.weight,
    box?.meta?.weightKg,
    box?.meta?.weight_kg,
    0
  );

const getBoxSize = (box = {}) =>
  firstPresent(box?.boxSize, box?.box_size, box?.size, box?.type, box?.boxType, box?.box_type);

const getBoxType = (box = {}) => {
  const value = String(firstPresent(box?.boxType, box?.box_type, box?.containerType, box?.container_type, box?.type, 'box')).toLowerCase();
  return value === 'pallet' ? 'pallet' : 'box';
};

const getBoxPalletId = (box = {}) =>
  firstPresent(box?.palletId, box?.pallet_id, box?.pallet?.id, box?.pallet?.uuid);

const isBoxInsidePallet = (box = {}) =>
  Boolean(getBoxPalletId(box) || box?.insidePallet || box?.inside_pallet || box?.isChildBox || box?.is_child_box);

const getPalletChildBoxes = (box = {}) => {
  const children = [
    ...extractList(box, ['palletChildren', 'pallet_children', 'childBoxes', 'child_boxes']),
    ...extractList(box?.pallet || {}, ['palletChildren', 'pallet_children', 'childBoxes', 'child_boxes', 'children', 'boxes']),
  ];
  const seen = new Set();

  return children.filter((childBox, index) => {
    if (!childBox || typeof childBox !== 'object') return false;
    const childKey = String(getBoxItemsLookupId(childBox) || getBoxId(childBox) || getBoxDisplayTitle(childBox, index) || index).trim();
    if (seen.has(childKey)) return false;
    seen.add(childKey);
    return true;
  });
};

const getPalletChildCount = (box = {}) => {
  const children = getPalletChildBoxes(box);
  return firstPresent(box?.childBoxCount, box?.child_box_count, box?.palletChildCount, box?.pallet_child_count, children.length);
};

const getBoxDimensionValue = (box = {}, longKey, shortKey) => {
  const dimensions = box?.dimensions || box?.dimension || {};
  return firstPresent(
    dimensions?.[longKey],
    dimensions?.[shortKey],
    box?.[longKey],
    box?.[`${longKey}Cm`],
    box?.[`${longKey}_cm`],
    box?.[shortKey]
  );
};

const getBoxDimensions = (box = {}) => {
  if (typeof box?.dimensions === 'string') return box.dimensions;

  const length = getBoxDimensionValue(box, 'length', 'l');
  const width = getBoxDimensionValue(box, 'width', 'w');
  const height = getBoxDimensionValue(box, 'height', 'h');
  const hasDimensions = [length, width, height].some((value) => String(value || '').trim() !== '');

  return hasDimensions ? `${length || 0}x${width || 0}x${height || 0} CM` : '';
};

const parseFileMeta = (value) => {
  if (!value) return {};
  if (typeof value === 'object') return value;
  if (typeof value !== 'string') return {};
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
};

const getFileMeta = (file = {}) => ({
  ...parseFileMeta(file?.metadata),
  ...parseFileMeta(file?.meta),
});

const getFileUrl = (file = {}) => {
  const meta = getFileMeta(file);
  return firstPresent(
    file?.signedUrl,
    file?.signed_url,
    file?.signedURL,
    file?.previewUrl,
    file?.preview_url,
    file?.url,
    file?.fileUrl,
    file?.file_url,
    file?.publicUrl,
    file?.public_url,
    file?.publicURL,
    file?.storageUrl,
    file?.storage_url,
    file?.secureUrl,
    file?.secure_url,
    file?.downloadUrl,
    file?.download_url,
    file?.downloadURL,
    file?.href,
    file?.src,
    file?.storagePath,
    file?.storage_path,
    file?.filePath,
    file?.file_path,
    file?.path,
    file?.location,
    meta?.signedUrl,
    meta?.signed_url,
    meta?.signedURL,
    meta?.previewUrl,
    meta?.preview_url,
    meta?.url,
    meta?.fileUrl,
    meta?.file_url,
    meta?.publicUrl,
    meta?.public_url,
    meta?.publicURL,
    meta?.storageUrl,
    meta?.storage_url,
    meta?.secureUrl,
    meta?.secure_url,
    meta?.downloadUrl,
    meta?.download_url,
    meta?.downloadURL,
    meta?.href,
    meta?.src,
    meta?.storagePath,
    meta?.storage_path,
    meta?.filePath,
    meta?.file_path,
    meta?.path,
    meta?.location
  );
};

const getFileRawUrlValues = (file = {}) => {
  const meta = getFileMeta(file);
  const values = [
    getFileUrl(file),
    file?.signedUrl,
    file?.signed_url,
    file?.signedURL,
    file?.previewUrl,
    file?.preview_url,
    file?.url,
    file?.fileUrl,
    file?.file_url,
    file?.publicUrl,
    file?.public_url,
    file?.publicURL,
    file?.storageUrl,
    file?.storage_url,
    file?.secureUrl,
    file?.secure_url,
    file?.downloadUrl,
    file?.download_url,
    file?.downloadURL,
    file?.href,
    file?.src,
    file?.storagePath,
    file?.storage_path,
    file?.filePath,
    file?.file_path,
    file?.path,
    file?.location,
    meta?.signedUrl,
    meta?.signed_url,
    meta?.signedURL,
    meta?.previewUrl,
    meta?.preview_url,
    meta?.url,
    meta?.fileUrl,
    meta?.file_url,
    meta?.publicUrl,
    meta?.public_url,
    meta?.publicURL,
    meta?.storageUrl,
    meta?.storage_url,
    meta?.secureUrl,
    meta?.secure_url,
    meta?.downloadUrl,
    meta?.download_url,
    meta?.downloadURL,
    meta?.href,
    meta?.src,
    meta?.storagePath,
    meta?.storage_path,
    meta?.filePath,
    meta?.file_path,
    meta?.path,
    meta?.location,
    getFileName(file),
  ];

  return values
    .map((value) => String(value || '').trim())
    .filter((value) => value && value !== 'download')
    .filter((value, index, currentValues) => currentValues.indexOf(value) === index);
};

const getFileName = (file = {}) => {
  const meta = getFileMeta(file);
  return firstPresent(
    file?.name,
    file?.fileName,
    file?.file_name,
    file?.originalName,
    file?.original_name,
    file?.original_filename,
    file?.storagePath,
    file?.storage_path,
    file?.filePath,
    file?.file_path,
    file?.path,
    file?.url,
    meta?.name,
    meta?.fileName,
    meta?.file_name,
    meta?.originalName,
    meta?.original_name,
    meta?.original_filename,
    meta?.storagePath,
    meta?.storage_path,
    meta?.filePath,
    meta?.file_path,
    meta?.path,
    meta?.url,
    'download'
  );
};

const getFileTypeValue = (file = {}) => {
  const meta = getFileMeta(file);
  return String(
    firstPresent(
      file?.fileType,
      file?.file_type,
      file?.type,
      file?.mimeType,
      file?.mime_type,
      file?.contentType,
      file?.content_type,
      meta?.fileType,
      meta?.file_type,
      meta?.type,
      meta?.mimeType,
      meta?.mime_type,
      meta?.contentType,
      meta?.content_type
    )
  ).toLowerCase();
};

const getFileEntityId = (file = {}) => {
  const meta = getFileMeta(file);
  return firstPresent(
    file?.entityId,
    file?.entity_id,
    file?.itemId,
    file?.item_id,
    file?.lineItemId,
    file?.line_item_id,
    file?.shipmentLineItemId,
    file?.shipment_line_item_id,
    file?.shipmentItemId,
    file?.shipment_item_id,
    file?.linkedEntityId,
    file?.linked_entity_id,
    file?.boxId,
    file?.box_id,
    file?.shipmentId,
    file?.shipment_id,
    meta?.entityId,
    meta?.entity_id,
    meta?.itemId,
    meta?.item_id,
    meta?.lineItemId,
    meta?.line_item_id,
    meta?.shipmentLineItemId,
    meta?.shipment_line_item_id,
    meta?.shipmentItemId,
    meta?.shipment_item_id,
    meta?.linkedEntityId,
    meta?.linked_entity_id,
    meta?.boxId,
    meta?.box_id,
    meta?.shipmentId,
    meta?.shipment_id
  );
};

const getFileEntityType = (file = {}) => {
  const meta = getFileMeta(file);
  return String(firstPresent(file?.entityType, file?.entity_type, file?.linkedEntityType, file?.linked_entity_type, meta?.entityType, meta?.entity_type, meta?.linkedEntityType, meta?.linked_entity_type)).trim().toLowerCase();
};

const normalizeEntityType = (value = '') => String(value || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '_');

const ITEM_FILE_ENTITY_TYPE_LIST = ['item', 'shipment_item', 'shipmentitem', 'shipment_line_item', 'shipmentlineitem', 'line_item', 'lineitem'];
const ITEM_FILE_ENTITY_TYPES = new Set(ITEM_FILE_ENTITY_TYPE_LIST);
const ITEM_FILE_LOOKUP_ENTITY_TYPES = ['item', 'shipment_item', 'shipment_line_item', 'line_item'];
const SHIPMENT_FILE_ENTITY_TYPES = new Set(['shipment']);
const BOX_FILE_ENTITY_TYPES = new Set(['box']);

const isItemFileEntityType = (value = '') => ITEM_FILE_ENTITY_TYPES.has(normalizeEntityType(value));
const isShipmentFileEntityType = (value = '') => SHIPMENT_FILE_ENTITY_TYPES.has(normalizeEntityType(value));
const isBoxFileEntityType = (value = '') => BOX_FILE_ENTITY_TYPES.has(normalizeEntityType(value));

const getFileBoxId = (file = {}) =>
  firstPresent(
    file?.boxId,
    file?.box_id,
    file?.metadata?.boxId,
    file?.metadata?.box_id,
    file?.meta?.boxId,
    file?.meta?.box_id,
    parseFileMeta(file?.metadata)?.boxId,
    parseFileMeta(file?.metadata)?.box_id,
    parseFileMeta(file?.meta)?.boxId,
    parseFileMeta(file?.meta)?.box_id
  );

const toLookupIdList = (value) => {
  if (Array.isArray(value)) return value.flatMap(toLookupIdList);
  if (!value) return [];

  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) return [];

    try {
      const parsed = JSON.parse(trimmed);
      if (parsed !== value) return toLookupIdList(parsed);
    } catch {
      // Fall back to comma-separated IDs below.
    }

    return trimmed.split(',').map((part) => part.trim()).filter(Boolean);
  }

  return [value];
};

const getFileBoxIds = (file = {}) => [
  getFileBoxId(file),
  file?.boxIds,
  file?.box_ids,
  file?.metadata?.boxIds,
  file?.metadata?.box_ids,
  file?.meta?.boxIds,
  file?.meta?.box_ids,
  parseFileMeta(file?.metadata)?.boxIds,
  parseFileMeta(file?.metadata)?.box_ids,
  parseFileMeta(file?.meta)?.boxIds,
  parseFileMeta(file?.meta)?.box_ids,
]
  .flatMap(toLookupIdList)
  .map((value) => String(value || '').trim())
  .filter(Boolean);

const getFileBoxNumber = (file = {}) =>
  firstPresent(
    file?.boxNumber,
    file?.box_number,
    file?.metadata?.boxNumber,
    file?.metadata?.box_number,
    file?.meta?.boxNumber,
    file?.meta?.box_number,
    parseFileMeta(file?.metadata)?.boxNumber,
    parseFileMeta(file?.metadata)?.box_number,
    parseFileMeta(file?.meta)?.boxNumber,
    parseFileMeta(file?.meta)?.box_number
  );

const getFileSearchText = (file = {}) =>
  [
    getFileName(file),
    getFileUrl(file),
    getFileStablePath(file),
    file?.entityId,
    file?.entity_id,
    file?.boxId,
    file?.box_id,
    file?.storagePath,
    file?.storage_path,
    file?.filePath,
    file?.file_path,
    file?.path,
    file?.location,
    typeof file?.metadata === 'string' ? file.metadata : JSON.stringify(file?.metadata || ''),
    typeof file?.meta === 'string' ? file.meta : JSON.stringify(file?.meta || ''),
  ]
    .map((value) => String(value || '').toLowerCase())
    .join(' ');

const normalizeShipmentReferenceToken = (value = '') =>
  String(value || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '');

const extractShipmentReferenceTokens = (value = '') => {
  const text = String(value || '');
  return [...text.matchAll(/shp[\s_-]*\d{8}[\s_-]*\d{4}/gi)]
    .map((match) => normalizeShipmentReferenceToken(match[0]))
    .filter(Boolean);
};

const getShipmentContextReferenceTokens = (shipment = {}, box = {}) => [
  getShipmentReference(shipment),
  shipment?.reference,
  shipment?.shipmentNumber,
  shipment?.shipment_number,
  box?.shipmentReference,
  box?.shipment_reference,
  box?.shipment?.reference,
  box?.shipment?.shipmentNumber,
  box?.shipment?.shipment_number,
]
  .map((value) => String(value || '').trim())
  .filter((value) => value && value.toLowerCase() !== 'n/a')
  .flatMap((value) => {
    const parsedRefs = extractShipmentReferenceTokens(value);
    return parsedRefs.length ? parsedRefs : [normalizeShipmentReferenceToken(value)];
  })
  .filter(Boolean);

const fileMatchesShipmentContext = (file = {}, shipment = {}, box = {}) => {
  const expectedRefs = getShipmentContextReferenceTokens(shipment, box);
  if (!expectedRefs.length) return true;

  const fileRefs = extractShipmentReferenceTokens(getFileSearchText(file));
  if (!fileRefs.length) return true;

  return fileRefs.some((fileRef) => expectedRefs.includes(fileRef));
};

const fileMatchesBoxIdentity = (file = {}, box = {}) => {
  const boxIds = getBoxLookupIds(box).map((value) => String(value || '').trim()).filter(Boolean);
  if (!boxIds.length) return false;

  const fileBoxIds = getFileBoxIds(file);
  if (fileBoxIds.some((fileBoxId) => boxIds.includes(fileBoxId))) return true;

  const fileEntityId = String(getFileEntityId(file) || '').trim();
  if (fileEntityId && boxIds.includes(fileEntityId)) return true;

  return boxIds.some((boxId) => file?.entityId === boxId || file?.entity_id === boxId || file?.boxId === boxId || file?.box_id === boxId);
};

const fileMatchesBox = (file = {}, box = {}) => {
  const boxIds = getBoxLookupIds(box).map((value) => String(value || '').trim()).filter(Boolean);
  if (fileMatchesBoxIdentity(file, box)) return true;

  const searchText = getFileSearchText(file);
  const specificBoxIds = boxIds.filter((boxId) => !/^\d+$/.test(boxId) && boxId.length >= 8);
  if (specificBoxIds.some((boxId) => searchText.includes(boxId.toLowerCase()))) return true;

  const boxNumber = String(firstPresent(box?.box_number, box?.boxNumber)).trim();
  if (!boxNumber) return false;
  const fileBoxNumber = String(getFileBoxNumber(file) || '').trim();
  if (fileBoxNumber && fileBoxNumber === boxNumber) return true;

  return [`box-${boxNumber}`, `box_${boxNumber}`, `box ${boxNumber}`, `box#${boxNumber}`, `box-${boxNumber}-`].some((token) =>
    searchText.includes(token.toLowerCase())
  );
};

const getFileRecordId = (file = {}) =>
  firstPresent(
    file?.id,
    file?.uuid,
    file?.fileId,
    file?.file_id,
    getFileMeta(file)?.id,
    getFileMeta(file)?.uuid,
    getFileMeta(file)?.fileId,
    getFileMeta(file)?.file_id
  );

const getFileStablePath = (file = {}) => {
  const rawPath = firstPresent(
    file?.signedUrl,
    file?.signed_url,
    file?.url,
    file?.fileUrl,
    file?.file_url,
    file?.publicUrl,
    file?.public_url,
    file?.downloadUrl,
    file?.download_url,
    file?.storagePath,
    file?.storage_path,
    file?.filePath,
    file?.file_path,
    file?.path,
    file?.location
  );

  return String(rawPath || '')
    .split('?')[0]
    .replace(/^https?:\/\/[^/]+/i, '')
    .toLowerCase();
};

const getFileDedupeKey = (file = {}, index = 0) => {
  const entityType = getFileEntityType(file);
  const entityId = String(getFileEntityId(file) || '').trim().toLowerCase();
  const fileType = getFileTypeValue(file);
  const fileName = getFileName(file).trim().toLowerCase();
  const fileSize = firstPresent(file?.size, file?.fileSize, file?.file_size, file?.metadata?.size, file?.meta?.size);
  const stablePath = getFileStablePath(file);

  if (fileName && (entityType || entityId)) return `file:${entityType}:${entityId}:${fileName}:${fileSize || ''}`;
  if (fileName && fileType) return `filetype:${fileType}:${fileName}:${fileSize || ''}`;
  if (stablePath) return `path:${stablePath}`;
  return String(file?.id || file?.uuid || `${fileName || 'file'}-${index}`);
};

const shouldReplaceDuplicateFile = (existingFile = {}, nextFile = {}) =>
  Boolean(
    (existingFile?.localPreview && !nextFile?.localPreview) ||
      (!getFileUrl(existingFile) && getFileUrl(nextFile)) ||
      (!existingFile?.signedUrl && !existingFile?.signed_url && (nextFile?.signedUrl || nextFile?.signed_url))
  );

const getItemLabelFileName = (item = {}) =>
  firstPresent(
    item?.fileName,
    item?.file_name,
    item?.labelFileName,
    item?.label_file_name,
    item?.fnskuLabelFileName,
    item?.fnsku_label_file_name,
    item?.fnskuLabelFile?.name,
    item?.fnskuLabelFile?.fileName,
    item?.fnskuLabelFile?.file_name,
    item?.fnsku_label_file?.name,
    item?.fnsku_label_file?.fileName,
    item?.fnsku_label_file?.file_name,
    item?.labelFile?.name,
    item?.labelFile?.fileName,
    item?.labelFile?.file_name,
    item?.label_file?.name,
    item?.label_file?.fileName,
    item?.label_file?.file_name,
    item?.file?.name,
    item?.file?.fileName,
    item?.file?.file_name
  );

const getItemLabelFileId = (item = {}) =>
  firstPresent(
    item?.fnskuLabelFileId,
    item?.fnsku_label_file_id,
    item?.fnskuFileId,
    item?.fnsku_file_id,
    item?.labelFileId,
    item?.label_file_id,
    item?.label?.id,
    item?.label?.uuid,
    item?.labelFile?.id,
    item?.labelFile?.uuid,
    item?.label_file?.id,
    item?.label_file?.uuid,
    item?.fnskuLabelFile?.id,
    item?.fnskuLabelFile?.uuid,
    item?.fnsku_label_file?.id,
    item?.fnsku_label_file?.uuid
  );

const normalizeItemFileMatchValue = (value = '') => {
  const normalized = String(value || '').trim().toLowerCase();
  return normalized && !['-', 'n/a', 'na', 'none', 'null', 'undefined'].includes(normalized) ? normalized : '';
};

const rawFileMatchesLineItem = (file = {}, item = {}) => mappedFileMatchesLineItem(file, item);

const decorateItemLabelFile = (file = {}, item = {}) => {
  const itemId = getItemEntityId(item) || getItemRecordId(item);
  const labelFileId = getItemLabelFileId(item);
  const fileName = firstPresent(getFileName(file), getItemLabelFileName(item), 'FNSKU label');

  return {
    ...file,
    id: getFileRecordId(file) || labelFileId || file?.id || file?.uuid || `${itemId || getItemSku(item) || 'item'}-fnsku-label`,
    fileId: file?.fileId || file?.file_id || labelFileId,
    file_id: file?.file_id || file?.fileId || labelFileId,
    name: file?.name || file?.fileName || file?.file_name || fileName,
    fileName: file?.fileName || file?.name || file?.file_name || fileName,
    file_name: file?.file_name || file?.fileName || file?.name || fileName,
    entityType: file?.entityType || file?.entity_type || 'item',
    entity_type: file?.entity_type || file?.entityType || 'item',
    entityId: file?.entityId || file?.entity_id || itemId,
    entity_id: file?.entity_id || file?.entityId || itemId,
    fileType: file?.fileType || file?.file_type || 'fnsku_label',
    file_type: file?.file_type || file?.fileType || 'fnsku_label',
    sku: file?.sku || file?.sellerSku || file?.seller_sku || getItemSku(item),
    fnsku: file?.fnsku || file?.fnskuLabel || file?.fnsku_label || getItemFnsku(item),
  };
};

const getItemDirectLabelFile = (item = {}) => {
  const nestedFile = [
    item?.fnskuLabelFile,
    item?.fnsku_label_file,
  ].find(hasFileShape);

  if (nestedFile) return decorateItemLabelFile(nestedFile, item);
  return null;
};

const getItemInlineLabelFiles = (item = {}) =>
  mergeFileLists(
    [getItemDirectLabelFile(item)].filter(Boolean),
    mergeFileLists(
      extractList(item?.files, ['files']),
      extractList(item?.attachments, ['files']),
      extractList(item?.uploads, ['files']),
      extractList(item?.labels, ['files']),
      extractList(item?.fnskuLabels, ['files']),
      extractList(item?.fnsku_labels, ['files'])
    ).filter((file) => rawFileMatchesLineItem(file, item))
  ).map((file) => decorateItemLabelFile(file, item));

const isFnskuLabelFile = (file = {}) => {
  const type = getFileTypeValue(file);
  const name = getFileName(file).toLowerCase();
  const entityType = getFileEntityType(file);
  const url = getFileUrl(file).toLowerCase();
  const stablePath = getFileStablePath(file);
  const isFbaBoxLabel =
    type.includes('fba_shipping_label') ||
    type.includes('fba-shipping-label') ||
    type.includes('shipping_label') ||
    (isBoxFileEntityType(entityType) && type.includes('label'));

  const isPdf = type.includes('pdf') || /\.pdf(?:$|\?)/i.test(name) || /\.pdf(?:$|\?)/i.test(url);

  return !isFbaBoxLabel && (type.includes('fnsku') || name.includes('fnsku') || url.includes('fnsku') || stablePath.includes('fnsku') || (isItemFileEntityType(entityType) && (type.includes('label') || isPdf || isImageFile(file) || isCsvFile(file))));
};

const isAnyItemLabelFile = (file = {}) => {
  const type = getFileTypeValue(file);
  const name = getFileName(file).toLowerCase();
  const entityType = getFileEntityType(file);
  const isFbaBoxLabel =
    type.includes('fba_shipping_label') ||
    type.includes('fba-shipping-label') ||
    type.includes('shipping_label') ||
    (isBoxFileEntityType(entityType) && type.includes('label'));

  return !isFbaBoxLabel && (isFnskuLabelFile(file) || type.includes('label') || name.includes('label'));
};

const isPdfFile = (file = {}) => {
  const type = getFileTypeValue(file);
  const name = getFileName(file).toLowerCase();
  const url = getFileUrl(file).toLowerCase();

  return type.includes('pdf') || /\.pdf(?:$|\?)/i.test(name) || /\.pdf(?:$|\?)/i.test(url);
};

const isCsvFile = (file = {}) => {
  const type = getFileTypeValue(file);
  const name = getFileName(file).toLowerCase();
  const url = getFileUrl(file).toLowerCase();

  return type.includes('csv') || /\.csv(?:$|\?)/i.test(name) || /\.csv(?:$|\?)/i.test(url);
};

const getFileSku = (file = {}) =>
  firstPresent(
    file?.sku,
    file?.sellerSku,
    file?.seller_sku,
    file?.productSku,
    file?.product_sku,
    getFileMeta(file)?.sku,
    getFileMeta(file)?.sellerSku,
    getFileMeta(file)?.seller_sku,
    getFileMeta(file)?.productSku,
    getFileMeta(file)?.product_sku
  );

const getFileFnsku = (file = {}) =>
  firstPresent(
    file?.fnsku,
    file?.fnskuLabel,
    file?.fnsku_label,
    file?.fbaFnsku,
    file?.fba_fnsku,
    getFileMeta(file)?.fnsku,
    getFileMeta(file)?.fnskuLabel,
    getFileMeta(file)?.fnsku_label,
    getFileMeta(file)?.fbaFnsku,
    getFileMeta(file)?.fba_fnsku
  );

const getFileProductName = (file = {}) =>
  firstPresent(
    file?.productName,
    file?.product_name,
    file?.itemName,
    file?.item_name,
    getFileMeta(file)?.productName,
    getFileMeta(file)?.product_name,
    getFileMeta(file)?.itemName,
    getFileMeta(file)?.item_name
  );

const isAutoGeneratedProductName = (value = '') =>
  /^product[\s_-]*\d+$/i.test(String(value || '').trim());

const getAutoGeneratedProductAlias = (value = '') => {
  const match = String(value || '').trim().match(/^product[\s_-]*0*(\d+)$/i);
  return match ? `p${Number(match[1])}` : '';
};

const getGeneratedProductSequence = (value = '') =>
  parsePrefixedSequence(value, PRODUCT_SEQUENCE_PREFIXES);

const isGeneratedProductSequenceLabel = (value = '') =>
  getGeneratedProductSequence(value) !== null || isAutoGeneratedProductName(value);

const getConsistentGeneratedProductLabel = (item = {}) => {
  const reliableOrder = getLineItemReliableSequenceOrder(item);
  return reliableOrder !== null && reliableOrder !== undefined ? `p${reliableOrder}` : '';
};

const getItemDisplayProductName = (item = {}, labelFile = null) => {
  const directProductName = firstPresent(
    item?.productName,
    item?.product_name,
    item?.itemName,
    item?.item_name,
    item?.name
  );
  const fileProductName = getFileProductName(labelFile || {});
  const productName = getItemProductName(item);
  const consistentGeneratedProductLabel = getConsistentGeneratedProductLabel(item);
  const primaryProductName = directProductName || productName;

  if (isGeneratedProductSequenceLabel(primaryProductName)) {
    return consistentGeneratedProductLabel || getAutoGeneratedProductAlias(productName) || directProductName || productName;
  }

  if (fileProductName && (!directProductName || isGeneratedProductSequenceLabel(productName))) {
    if (isGeneratedProductSequenceLabel(fileProductName)) {
      return consistentGeneratedProductLabel || fileProductName;
    }

    return fileProductName;
  }

  if (isGeneratedProductSequenceLabel(productName)) {
    return consistentGeneratedProductLabel || getAutoGeneratedProductAlias(productName) || productName;
  }

  return directProductName || fileProductName || productName;
};

const getLabelFileAssignmentKey = (file = {}, index = 0) => {
  const fileId = String(getFileRecordId(file) || '').trim();
  if (fileId) return `id:${fileId}`;

  const stablePath = getFileStablePath(file);
  if (stablePath) return `path:${stablePath}`;

  const fileName = String(getFileName(file) || '').trim().toLowerCase();
  const fileSize = firstPresent(file?.size, file?.fileSize, file?.file_size, getFileMeta(file)?.size);
  return `name:${fileName || 'file'}:${fileSize || ''}:${index}`;
};

const getFileItemIndex = (file = {}) => {
  const value = firstPresent(
    file?.itemIndex,
    file?.item_index,
    file?.lineItemIndex,
    file?.line_item_index,
    getFileMeta(file)?.itemIndex,
    getFileMeta(file)?.item_index,
    getFileMeta(file)?.lineItemIndex,
    getFileMeta(file)?.line_item_index
  );
  const index = Number(value);
  return Number.isInteger(index) && index >= 0 ? index : null;
};

const getFileCreatedTime = (file = {}) => {
  const value = firstPresent(
    file?.createdAt,
    file?.created_at,
    file?.uploadedAt,
    file?.uploaded_at,
    file?.updatedAt,
    file?.updated_at,
    getFileMeta(file)?.createdAt,
    getFileMeta(file)?.created_at,
    getFileMeta(file)?.uploadedAt,
    getFileMeta(file)?.uploaded_at,
    getFileMeta(file)?.updatedAt,
    getFileMeta(file)?.updated_at
  );
  const time = value ? new Date(value).getTime() : 0;
  return Number.isFinite(time) ? time : 0;
};

const getItemLabelMatchIds = (item = {}) => [
  getItemEntityId(item),
  item?.id,
  item?.uuid,
  item?.shipmentLineItemId,
  item?.shipment_line_item_id,
  item?.lineItemId,
  item?.line_item_id,
  item?.shipmentItemId,
  item?.shipment_item_id,
  item?.itemId,
  item?.item_id,
  item?.shipmentItem?.id,
  item?.shipmentItem?.uuid,
  item?.shipment_item?.id,
  item?.shipment_item?.uuid,
  item?.lineItem?.id,
  item?.lineItem?.uuid,
  item?.line_item?.id,
  item?.line_item?.uuid,
  item?.item?.id,
  item?.item?.uuid,
]
  .map((value) => String(value || '').trim())
  .filter(Boolean);

const isExactItemLabelFileMatch = (file = {}, item = {}) => {
  const itemLabelFileId = String(getItemLabelFileId(item) || '').trim();
  const fileRecordId = String(getFileRecordId(file) || '').trim();
  const fileEntityId = String(getFileEntityId(file) || '').trim();
  const fileEntityType = getFileEntityType(file);
  const linkedEntityId = String(firstPresent(file?.linkedEntityId, file?.linked_entity_id, getFileMeta(file)?.linkedEntityId, getFileMeta(file)?.linked_entity_id) || '').trim();
  const linkedEntityType = String(firstPresent(file?.linkedEntityType, file?.linked_entity_type, getFileMeta(file)?.linkedEntityType, getFileMeta(file)?.linked_entity_type) || '').trim().toLowerCase();
  const itemIds = getItemLabelMatchIds(item);

  return Boolean(
    (itemLabelFileId && fileRecordId && itemLabelFileId === fileRecordId) ||
      (isItemFileEntityType(fileEntityType) && fileEntityId && itemIds.includes(fileEntityId)) ||
      (isItemFileEntityType(linkedEntityType) && linkedEntityId && itemIds.includes(linkedEntityId))
  );
};

const fileMatchesAnyLineItem = (file = {}, itemList = []) =>
  itemList.some((item) => rawFileMatchesLineItem(file, item) || isExactItemLabelFileMatch(file, item));

const isSupportedItemLabelFile = (file = {}) => isPdfFile(file) || isImageFile(file) || isCsvFile(file);

const isShipmentLevelItemLabelFile = (file = {}) => {
  const entityType = getFileEntityType(file);
  if (isBoxFileEntityType(entityType) || isItemFileEntityType(entityType) || isFbaBoxLabelFile(file)) return false;
  if (entityType && !isShipmentFileEntityType(entityType)) return false;
  return isSupportedItemLabelFile(file) && (isFnskuLabelFile(file) || isAnyItemLabelFile(file));
};

const isItemLabelCandidateFile = (file = {}, itemList = []) => {
  if (!getFileUrl(file) && !getFileName(file)) return false;
  const entityType = getFileEntityType(file);
  if (isBoxFileEntityType(entityType) || isFbaBoxLabelFile(file)) return false;

  if (isItemFileEntityType(entityType)) return isSupportedItemLabelFile(file) || isAnyItemLabelFile(file);
  if (fileMatchesAnyLineItem(file, itemList)) return isSupportedItemLabelFile(file) || isAnyItemLabelFile(file);
  if (isShipmentLevelItemLabelFile(file)) return true;

  return (isFnskuLabelFile(file) || isAnyItemLabelFile(file)) && itemList.length === 1;
};

const getItemLabelFileAssignments = (items = [], files = [], visibleFiles = []) => {
  const itemList = toArray(items);
  if (!itemList.length) return [];

  const itemInlineFiles = itemList.flatMap((item) => getItemInlineLabelFiles(item));
  const candidateFiles = mergeFileLists(itemInlineFiles, files, visibleFiles)
    .filter((file) => isItemLabelCandidateFile(file, itemList));

  return getMappedItemLabelFileAssignments(itemList, candidateFiles);
};

const getItemUploadMatchKey = (item = {}, index = 0) =>
  String(getItemEntityId(item) || `index:${index}`);

const findSavedLineItemForUpload = (sourceItem = {}, fallbackIndex = 0, savedLineItems = [], usedKeys = new Set()) => {
  return findMappedSavedLineItemForUpload(
    {
      ...sourceItem,
      displayOrder: firstPresent(sourceItem?.displayOrder, sourceItem?.display_order, fallbackIndex),
      itemIndex: firstPresent(sourceItem?.itemIndex, sourceItem?.item_index, fallbackIndex),
    },
    fallbackIndex,
    savedLineItems,
    usedKeys
  );
};

const hasFileShape = (file = {}) =>
  Boolean(
    file &&
      typeof file === 'object' &&
      !Array.isArray(file) &&
      (getFileUrl(file) ||
        file?.id ||
        file?.uuid ||
        file?.name ||
        file?.fileName ||
        file?.file_name ||
        file?.originalName ||
        file?.original_name ||
        file?.storagePath ||
        file?.storage_path ||
        file?.mimeType ||
        file?.mime_type ||
        file?.contentType ||
        file?.content_type)
  );

const extractFiles = (payload) => {
  const files = extractList(payload, ['files', 'fileList', 'file_list', 'attachments', 'uploads']);
  if (files.length) return files;

  const candidates = [
    payload,
    payload?.data,
    payload?.result,
    payload?.payload,
    ...FILE_LIKE_KEYS.flatMap((key) => [payload?.[key], payload?.data?.[key], payload?.result?.[key], payload?.payload?.[key]]),
  ];
  const singleFile = candidates.find(hasFileShape);

  return singleFile ? [singleFile] : [];
};

const fetchFileById = async (fileId, context = {}) => {
  const normalizedFileId = String(fileId || '').trim();
  if (!normalizedFileId) return [];

  const endpoints = [
    `${API_BASE_URL}/api/files?id=${encodeURIComponent(normalizedFileId)}`,
    `${API_BASE_URL}/api/files?fileId=${encodeURIComponent(normalizedFileId)}`,
  ];

  for (const endpoint of endpoints) {
    try {
      const response = await fetch(endpoint, {
        method: 'GET',
        headers: buildHeaders(),
        cache: 'no-store',
      });
      const payload = await parseResponse(response);
      const files = extractFiles(payload);
      console.log('[PickPackPro][Client Files GET]', {
        endpoint,
        status: response.status,
        context: { fileId: normalizedFileId, ...context },
        payload,
        files,
      });
      if (files.length) return files;
    } catch {
      // The backend has used a few file lookup shapes; try the next one.
    }
  }

  return [];
};

const fetchBoxItemsByBoxId = async (box = {}) => {
  if (!BOX_ITEM_ENRICH_ENABLED) return [];

  const boxId = String(getBoxItemsLookupId(box) || '').trim();
  if (!boxId) return [];

  try {
    const response = await fetch(`${API_BASE_URL}/api/boxes/${encodeURIComponent(boxId)}/items`, {
      method: 'GET',
      headers: buildHeaders(),
      cache: 'no-store',
    });
    return extractBoxItems(await parseResponse(response));
  } catch {
    return [];
  }
};

const enrichBoxesWithItems = async (boxes = [], lineItems = []) => {
  if (!boxes.length) return [];

  const results = await Promise.allSettled(
    boxes.map(async (box) => {
      const existingItems = getBoxItems(box);
      const hasUsableItems = boxHasInlineAllocationData(box);

      const boxItems = await fetchBoxItemsByBoxId(box);

      if (boxItems.length) {
        const hydratedBoxItems = getShipmentScopedBoxItems(boxItems, lineItems);
        if (hydratedBoxItems.length) {
          saveCachedBoxAllocationItems(box, hydratedBoxItems);

          return {
            ...box,
            items: hydratedBoxItems,
            boxItems: hydratedBoxItems,
            box_items: hydratedBoxItems,
            boxContents: hydratedBoxItems,
            box_contents: hydratedBoxItems,
            contents: hydratedBoxItems,
          };
        }
      }

      const cachedItems = getCachedBoxAllocationItems(box, lineItems);
      if (cachedItems.length) {
        return {
          ...box,
          items: cachedItems,
          boxItems: cachedItems,
          box_items: cachedItems,
          boxContents: cachedItems,
          box_contents: cachedItems,
          contents: cachedItems,
        };
      }

      if (hasUsableItems) {
        const hydratedExistingItems = getShipmentScopedBoxItems(existingItems, lineItems);
        if (!hydratedExistingItems.length) return box;

        return {
          ...box,
          items: hydratedExistingItems,
          boxItems: hydratedExistingItems,
          box_items: hydratedExistingItems,
          boxContents: hydratedExistingItems,
          box_contents: hydratedExistingItems,
          contents: hydratedExistingItems,
        };
      }

      return box;
    })
  );

  return results.map((result, index) =>
    result.status === 'fulfilled' ? result.value : boxes[index]
  );
};

const isImageUploadFile = (file) => {
  const type = String(file?.type || '').toLowerCase();
  const name = String(file?.name || '').toLowerCase();
  return type.startsWith('image/') || /\.(png|jpe?g|webp|avif|bmp)$/i.test(name);
};

const loadImageFile = (file) =>
  new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const image = new Image();

    image.onload = () => {
      URL.revokeObjectURL(url);
      resolve(image);
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Unable to read this image file.'));
    };
    image.src = url;
  });

const canvasToBlob = (canvas, type, quality) =>
  new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error('Unable to optimize this image file.'));
    }, type, quality);
  });

const compressImageForUpload = async (file) => {
  const image = await loadImageFile(file);
  const sourceWidth = image.naturalWidth || image.width;
  const sourceHeight = image.naturalHeight || image.height;
  const largestSide = Math.max(sourceWidth, sourceHeight, 1);
  const baseName = String(file.name || 'fba-label').replace(/\.[^.]+$/, '') || 'fba-label';
  let bestFile = null;

  for (const maxDimension of [IMAGE_UPLOAD_MAX_DIMENSION, 2000, 1600, 1200]) {
    const scale = Math.min(1, maxDimension / largestSide);
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(sourceWidth * scale));
    canvas.height = Math.max(1, Math.round(sourceHeight * scale));

    const context = canvas.getContext('2d');
    context.fillStyle = '#ffffff';
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(image, 0, 0, canvas.width, canvas.height);

    for (const quality of [0.88, 0.78, 0.68, 0.58]) {
      const blob = await canvasToBlob(canvas, 'image/jpeg', quality);
      const optimizedFile = new File([blob], `${baseName}.jpg`, {
        type: 'image/jpeg',
        lastModified: Date.now(),
      });

      if (!bestFile || optimizedFile.size < bestFile.size) {
        bestFile = optimizedFile;
      }
      if (optimizedFile.size <= SAFE_FILE_UPLOAD_BYTES) {
        return optimizedFile;
      }
    }
  }

  return bestFile;
};

const prepareFileForUpload = async (file, label = 'file') => {
  if (!file) return null;
  if (file.size <= SAFE_FILE_UPLOAD_BYTES) return file;

  if (isImageUploadFile(file)) {
    const optimizedFile = await compressImageForUpload(file);
    if (optimizedFile?.size <= SAFE_FILE_UPLOAD_BYTES) return optimizedFile;
  }

  throw new Error(getUploadTooLargeMessage(file.name || label));
};

const mergeFileLists = (...fileLists) => {
  const merged = new Map();

  fileLists.flat().filter(Boolean).forEach((file, index) => {
    const key = getFileDedupeKey(file, index);
    const existingFile = merged.get(key);

    if (!existingFile || shouldReplaceDuplicateFile(existingFile, file)) {
      merged.set(key, file);
    }
  });

  return [...merged.values()];
};

const mergeDisplayFileList = (files = []) => {
  const merged = new Map();

  extractList(files, ['files']).filter(Boolean).forEach((file, index) => {
    const fileName = getFileName(file).trim().toLowerCase();
    const fileSize = firstPresent(file?.size, file?.fileSize, file?.file_size, file?.metadata?.size, file?.meta?.size);
    const key = fileName && fileName !== 'download'
      ? `name:${fileName}:${fileSize || ''}`
      : getFileStablePath(file) || getFileDedupeKey(file, index);
    const existingFile = merged.get(key);

    if (!existingFile || shouldReplaceDuplicateFile(existingFile, file)) {
      merged.set(key, file);
    }
  });

  return [...merged.values()];
};

const isImageFile = (file = {}) => {
  const type = getFileTypeValue(file);
  const name = getFileName(file).toLowerCase();
  const url = getFileUrl(file).toLowerCase();

  return (
    type.startsWith('image/') ||
    type.includes('image') ||
    /\.(png|jpe?g|gif|webp|avif|bmp|svg)(?:$|\?)/i.test(name) ||
    /\.(png|jpe?g|gif|webp|avif|bmp|svg)(?:$|\?)/i.test(url)
  );
};

const isPickPackProBrandFile = (file = {}) => {
  const fileText = [
    getFileName(file),
    getFileUrl(file),
    getFileStablePath(file),
  ].join(' ').toLowerCase();

  return (
    fileText.includes('ppp-orange-logo') ||
    fileText.includes('orange-logo-wide') ||
    fileText.includes('pickpackpro-logo') ||
    fileText.includes('pick-pack-pro-logo') ||
    /ppp.*logo|logo.*ppp|pickpackpro.*logo|logo.*pickpackpro/.test(fileText) ||
    /pick\s*pack\s*pro.*logo|logo.*pick\s*pack\s*pro/.test(fileText)
  );
};

const isFbaBoxLabelFile = (file = {}) => {
  const type = getFileTypeValue(file);
  const name = getFileName(file).toLowerCase();
  const stablePath = getFileStablePath(file);
  const entityType = getFileEntityType(file);
  const fileText = `${name} ${stablePath}`;
  const hasFbaLabelName =
    /(?:^|[/\s_-])fba[\s_-]*label(?:[\s_.-]|$)/i.test(fileText) ||
    /(?:^|[/\s_-])fba[\s_-]*shipping[\s_-]*label(?:[\s_.-]|$)/i.test(fileText);

  return (
    type.includes('fba_shipping_label') ||
    type.includes('fba-shipping-label') ||
    type.includes('fba_label') ||
    type.includes('shipping_label') ||
    hasFbaLabelName ||
    name.includes('shipping-label') ||
    name.includes('shipping_label') ||
    (isBoxFileEntityType(entityType) && (type.includes('fba') || type.includes('shipping_label')))
  );
};

const getBoxInlineFiles = (box = {}) => [
  ...extractList(box?.files, ['files']),
  ...extractList(box?.attachments, ['files']),
  ...extractList(box?.uploads, ['files']),
  ...extractList(box?.labels, ['files']),
  ...extractList(box?.fbaLabels, ['files']),
  ...extractList(box?.fba_labels, ['files']),
];

const getBoxDirectFbaLabelFile = (box = {}, shipmentContext = {}) => {
  const labelUrl = firstPresent(
    box?.fbaLabelUrl,
    box?.fba_label_url,
    box?.fbaLabel?.url,
    box?.fba_label?.url,
    box?.fbaLabel?.fileUrl,
    box?.fba_label?.file_url,
    box?.fbaShippingLabelUrl,
    box?.fba_shipping_label_url,
    box?.shippingLabelUrl,
    box?.shipping_label_url,
    box?.shippingLabel?.url,
    box?.shipping_label?.url,
    box?.shippingLabel?.fileUrl,
    box?.shipping_label?.file_url,
    box?.labelUrl,
    box?.label_url,
    box?.label?.url,
    box?.label?.fileUrl,
    box?.label?.file_url,
    box?.labelFileUrl,
    box?.label_file_url,
    box?.labelPath,
    box?.label_path,
    box?.fbaLabelPath,
    box?.fba_label_path,
    box?.fbaShippingLabelPath,
    box?.fba_shipping_label_path
  );

  if (!labelUrl) return null;

  const fileName = firstPresent(
    box?.fbaLabelFileName,
    box?.fba_label_file_name,
    box?.fbaLabel?.name,
    box?.fba_label?.name,
    box?.fbaLabel?.fileName,
    box?.fba_label?.file_name,
    box?.fbaShippingLabelFileName,
    box?.fba_shipping_label_file_name,
    box?.shippingLabelFileName,
    box?.shipping_label_file_name,
    box?.shippingLabel?.name,
    box?.shipping_label?.name,
    box?.shippingLabel?.fileName,
    box?.shipping_label?.file_name,
    box?.labelFileName,
    box?.label_file_name,
    box?.label?.name,
    box?.label?.fileName,
    box?.label?.file_name,
    labelUrl
  );
  const boxId = getBoxLookupIds(box).find(Boolean);

  const labelFile = {
    id: getBoxFbaLabelFileId(box) || `box-label-${boxId || fileName}`,
    name: fileName,
    fileName,
    file_name: fileName,
    url: labelUrl,
    fileUrl: labelUrl,
    file_url: labelUrl,
    entityType: 'box',
    entity_type: 'box',
    entityId: boxId,
    entity_id: boxId,
    boxId,
    box_id: boxId,
    fileType: 'fba_shipping_label',
    file_type: 'fba_shipping_label',
  };

  return fileMatchesShipmentContext(labelFile, shipmentContext, box) ? labelFile : null;
};

const hasDirectFbaLabelRecord = (box = {}) =>
  Boolean(getBoxExplicitFbaLabelFileId(box) || getBoxDirectFbaLabelFile(box));

const getBoxFbaLabelFile = (box = {}, files = [], allBoxes = [], boxIndex = 0, shipmentContext = {}) => {
  const directLabelFile = getBoxDirectFbaLabelFile(box, shipmentContext);
  if (directLabelFile) return directLabelFile;

  const boxLookupIds = getBoxLookupIds(box);
  const labelFileId = String(getBoxFbaLabelFileId(box) || '').trim();
  const directFiles = getBoxInlineFiles(box);
  const allFiles = mergeFileLists(directFiles, extractList(files, ['files'])).filter((file) =>
    fileMatchesShipmentContext(file, shipmentContext, box)
  );
  const sameBoxFile = (file = {}) => {
    const entityId = String(getFileEntityId(file) || '').trim();
    return Boolean(
      (entityId && boxLookupIds.includes(entityId)) ||
        boxLookupIds.some((boxId) => file?.boxId === boxId || file?.box_id === boxId) ||
        fileMatchesBoxIdentity(file, box) ||
        directFiles.includes(file)
    );
  };
  const candidateFiles = allFiles
    .filter((file) => {
      const fileRecordId = String(getFileRecordId(file) || '').trim();
      const sameLabelFile = Boolean(labelFileId && fileRecordId === labelFileId);
      const sameBox = sameBoxFile(file);

      return sameLabelFile || (sameBox && isFbaBoxLabelFile(file));
    })
    .sort((firstFile, secondFile) => {
      const firstRecordId = String(getFileRecordId(firstFile) || '').trim();
      const secondRecordId = String(getFileRecordId(secondFile) || '').trim();
      const firstSameLabel = Boolean(labelFileId && firstRecordId === labelFileId);
      const secondSameLabel = Boolean(labelFileId && secondRecordId === labelFileId);
      if (firstSameLabel !== secondSameLabel) return firstSameLabel ? -1 : 1;

      const firstSameBox = sameBoxFile(firstFile);
      const secondSameBox = sameBoxFile(secondFile);
      if (firstSameBox !== secondSameBox) return firstSameBox ? -1 : 1;

      return getFileCreatedTime(secondFile) - getFileCreatedTime(firstFile);
    });
  const fetchedLabelFile = candidateFiles[0] || null;

  if (fetchedLabelFile) return fetchedLabelFile;

  return null;
};

const isFileUsedAsBoxLabel = (file = {}, boxes = [], boxLabelFiles = [], shipmentContext = {}) => {
  const fileId = String(getFileRecordId(file) || '').trim();
  const filePath = getFileStablePath(file);

  if (boxLabelFiles.some((labelFile) => {
    const labelFileId = String(getFileRecordId(labelFile) || '').trim();
    const labelPath = getFileStablePath(labelFile);
    return Boolean((fileId && labelFileId && fileId === labelFileId) || (filePath && labelPath && filePath === labelPath));
  })) {
    return true;
  }

  const entityType = getFileEntityType(file);
  const entityId = String(getFileEntityId(file) || '').trim();
  const fileLooksLikeBoxLabel = isFbaBoxLabelFile(file);

  if (!fileLooksLikeBoxLabel) return false;

  return boxes.some((box) => {
    if (!fileMatchesShipmentContext(file, shipmentContext, box)) return false;

    const boxIds = getBoxLookupIds(box);
    const labelFileId = String(getBoxFbaLabelFileId(box) || '').trim();
    return Boolean(
      (fileId && labelFileId && fileId === labelFileId) ||
        (entityId && boxIds.includes(entityId)) ||
        boxIds.some((boxId) => file?.boxId === boxId || file?.box_id === boxId)
    );
  });
};

const isUsableFileUrlCandidate = (value = '') => {
  const url = String(value || '').trim();
  if (!url) return false;
  if (/^(https?:|data:|blob:)/i.test(url)) return true;
  if (url.startsWith('/')) return true;
  return url.includes('/') || /\.[a-z0-9]{2,8}(?:$|\?)/i.test(url);
};

const isStoragePathCandidate = (url = '') => {
  const normalizedUrl = String(url || '').trim();
  if (!normalizedUrl || normalizedUrl.startsWith('/') || /^(https?:|data:|blob:)/i.test(normalizedUrl)) return false;
  if (/^api\//i.test(normalizedUrl)) return false;
  return /\.[a-z0-9]{2,8}(?:$|\?)/i.test(normalizedUrl);
};

const encodeStoragePath = (path = '') =>
  String(path || '')
    .trim()
    .replace(/^\/+/, '')
    .split('/')
    .map((part) => {
      try {
        return encodeURIComponent(decodeURIComponent(part));
      } catch {
        return encodeURIComponent(part);
      }
    })
    .join('/');

const safeDecodeStoragePath = (path = '') => {
  try {
    return decodeURIComponent(String(path || ''));
  } catch {
    return String(path || '');
  }
};

const buildStoragePublicUrl = (bucket = SUPABASE_DEFAULT_STORAGE_BUCKET, path = '') => {
  const normalizedPath = String(path || '').trim().replace(/^\/+/, '');
  if (!SUPABASE_STORAGE_PUBLIC_BASE_URL || !bucket || !isStoragePathCandidate(normalizedPath)) return '';
  return `${SUPABASE_STORAGE_PUBLIC_BASE_URL}/${bucket}/${encodeStoragePath(normalizedPath)}`;
};

const getSupabasePublicObjectParts = (url = '') => {
  const value = String(url || '').trim();
  const markers = ['/storage/v1/object/public/', '/storage/v1/render/image/public/'];
  const marker = markers.find((currentMarker) => value.includes(currentMarker));
  if (!marker) return {};

  const hashIndex = value.indexOf('#');
  const withoutHash = hashIndex >= 0 ? value.slice(0, hashIndex) : value;
  const queryIndex = withoutHash.indexOf('?');
  const base = queryIndex >= 0 ? withoutHash.slice(0, queryIndex) : withoutHash;
  const markerIndex = base.indexOf(marker);
  const objectPath = base.slice(markerIndex + marker.length);
  const pathParts = objectPath.split('/').filter(Boolean);
  if (pathParts.length < 2) return {};

  return {
    bucket: pathParts[0],
    path: pathParts.slice(1).join('/'),
  };
};

const encodeSupabasePublicObjectUrl = (url = '') => {
  const value = String(url || '').trim();
  const markers = ['/storage/v1/object/public/', '/storage/v1/render/image/public/'];
  const marker = markers.find((currentMarker) => value.includes(currentMarker));
  if (!marker) return '';

  const hashIndex = value.indexOf('#');
  const hash = hashIndex >= 0 ? value.slice(hashIndex) : '';
  const withoutHash = hashIndex >= 0 ? value.slice(0, hashIndex) : value;
  const queryIndex = withoutHash.indexOf('?');
  const query = queryIndex >= 0 ? withoutHash.slice(queryIndex) : '';
  const base = queryIndex >= 0 ? withoutHash.slice(0, queryIndex) : withoutHash;
  const markerIndex = base.indexOf(marker);
  const prefix = base.slice(0, markerIndex + marker.length);
  const objectPath = base.slice(markerIndex + marker.length);

  if (!objectPath || /%25[0-9a-f]{2}/i.test(objectPath)) return encodeURI(value);

  return `${prefix}${encodeStoragePath(objectPath)}${query}${hash}`;
};

const resolveFileUrl = (url = '') => {
  const normalizedUrl = String(url || '').trim();
  if (!normalizedUrl || !isUsableFileUrlCandidate(normalizedUrl)) return '';
  if (/^(data:|blob:)/i.test(normalizedUrl)) return normalizedUrl;
  if (/^https?:/i.test(normalizedUrl)) {
    const encodedStorageUrl = encodeSupabasePublicObjectUrl(normalizedUrl);
    return encodedStorageUrl || encodeURI(normalizedUrl);
  }
  if (isStoragePathCandidate(normalizedUrl)) {
    return buildStoragePublicUrl(SUPABASE_DEFAULT_STORAGE_BUCKET, normalizedUrl) || encodeURI(`${API_BASE_URL}/${normalizedUrl.replace(/^\/+/, '')}`);
  }
  if (normalizedUrl.startsWith('/')) return encodeURI(`${API_BASE_URL}${normalizedUrl}`);
  return encodeURI(`${API_BASE_URL}/${normalizedUrl.replace(/^\/+/, '')}`);
};

const getFileUrlCandidates = (file = {}) => {
  const urlCandidates = getFileRawUrlValues(file).flatMap((rawUrl) => {
    const publicObjectParts = getSupabasePublicObjectParts(rawUrl);
    const rawStoragePath = publicObjectParts.path || (isStoragePathCandidate(rawUrl) ? rawUrl : '');
    const pathParts = String(rawStoragePath || '').split('/').filter(Boolean);
    const bucketFromPath = pathParts.length > 1 && SUPABASE_STORAGE_BUCKET_CANDIDATES.includes(pathParts[0]) ? pathParts[0] : '';
    const storagePath = bucketFromPath ? pathParts.slice(1).join('/') : rawStoragePath;
    const storagePathVariants = [
      storagePath,
      rawStoragePath,
      safeDecodeStoragePath(storagePath),
      safeDecodeStoragePath(rawStoragePath),
    ].filter(Boolean);
    const storageBucketCandidates = [
      publicObjectParts.bucket,
      bucketFromPath,
      ...SUPABASE_STORAGE_BUCKET_CANDIDATES,
    ].filter((bucket, index, buckets) => bucket && buckets.indexOf(bucket) === index);

    return [
      resolveFileUrl(rawUrl),
      encodeSupabasePublicObjectUrl(rawUrl),
      ...storageBucketCandidates.flatMap((bucket) =>
        storagePathVariants.map((path) => buildStoragePublicUrl(bucket, path))
      ),
    ];
  });
  const fileId = String(getFileRecordId(file) || '').trim();
  const backendFileCandidates = fileId
    ? [
        `/api/files/${encodeURIComponent(fileId)}/download`,
        `/api/files/${encodeURIComponent(fileId)}/raw`,
        `/api/files/${encodeURIComponent(fileId)}/view`,
        `/api/files/${encodeURIComponent(fileId)}`,
      ].map(resolveFileUrl)
    : [];

  return [...urlCandidates, ...backendFileCandidates]
    .map((url) => String(url || '').trim())
    .filter(Boolean)
    .filter((url, index, urls) => urls.indexOf(url) === index);
};

const sanitizeFileName = (value = 'download') =>
  String(value || 'download')
    .replace(/[^a-z0-9._-]+/gi, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase() || 'download';

const decorateShipmentLabelFile = (file = {}, { sourceFile, entityType = 'item', entityId = '', item = {}, index = 0, fileType = 'fnsku_label' }) => ({
  ...file,
  name: file?.name || file?.fileName || file?.file_name || sourceFile?.name,
  fileName: file?.fileName || file?.name || file?.file_name || sourceFile?.name,
  file_name: file?.file_name || file?.fileName || file?.name || sourceFile?.name,
  original_filename: file?.original_filename || sourceFile?.name,
  mimeType: file?.mimeType || file?.mime_type || sourceFile?.type,
  mime_type: file?.mime_type || file?.mimeType || sourceFile?.type,
  fileType: file?.fileType || file?.file_type || fileType,
  file_type: file?.file_type || file?.fileType || fileType,
  entityType: file?.entityType || file?.entity_type || entityType,
  entity_type: file?.entity_type || file?.entityType || entityType,
  entityId: file?.entityId || file?.entity_id || entityId,
  entity_id: file?.entity_id || file?.entityId || entityId,
  itemIndex: firstPresent(file?.itemIndex, file?.item_index, getFileMeta(file)?.itemIndex, getFileMeta(file)?.item_index, index),
  item_index: firstPresent(file?.item_index, file?.itemIndex, getFileMeta(file)?.item_index, getFileMeta(file)?.itemIndex, index),
  lineItemIndex: firstPresent(file?.lineItemIndex, file?.line_item_index, getFileMeta(file)?.lineItemIndex, getFileMeta(file)?.line_item_index, index),
  line_item_index: firstPresent(file?.line_item_index, file?.lineItemIndex, getFileMeta(file)?.line_item_index, getFileMeta(file)?.lineItemIndex, index),
  sku: file?.sku || getItemSku(item),
  fnsku: file?.fnsku || getItemFnsku(item),
  productName: firstPresent(file?.productName, file?.product_name, getFileMeta(file)?.productName, getFileMeta(file)?.product_name, getItemProductName(item)),
  product_name: firstPresent(file?.product_name, file?.productName, getFileMeta(file)?.product_name, getFileMeta(file)?.productName, getItemProductName(item)),
});

const reloadSavedShipmentLabelFiles = async (shipmentId, fallbackItems = []) => {
  const detailResponse = await fetch(`${API_BASE_URL}/api/shipments/${encodeURIComponent(shipmentId)}`, {
    method: 'GET',
    headers: buildHeaders(),
    cache: 'no-store',
  });
  const detailPayload = await parseResponse(detailResponse);
  const detail = extractShipmentDetail(detailPayload);
  const detailItems = getLineItems(detail);
  const lineItems = detailItems.length ? detailItems : fallbackItems;
  const itemFileResults = await Promise.allSettled(
    lineItems
      .map((item) => String(getItemEntityId(item) || '').trim())
      .filter(Boolean)
      .map(async (lineItemId) => {
        const filesResponse = await fetch(`${API_BASE_URL}/api/files?entityType=item&entityId=${encodeURIComponent(lineItemId)}`, {
          method: 'GET',
          headers: buildHeaders(),
          cache: 'no-store',
        });
        return extractFiles(await parseResponse(filesResponse));
      })
  );

  return {
    detail,
    itemFiles: itemFileResults.flatMap((result) => (result.status === 'fulfilled' ? result.value : [])),
  };
};

const downloadTextFile = (fileName, content) => {
  const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = fileName;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
};

const parseCsvRows = (text = '') => {
  const rows = [];
  let row = [];
  let value = '';
  let inQuotes = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    const nextChar = text[index + 1];

    if (char === '"' && inQuotes && nextChar === '"') {
      value += '"';
      index += 1;
    } else if (char === '"') {
      inQuotes = !inQuotes;
    } else if (char === ',' && !inQuotes) {
      row.push(value.trim());
      value = '';
    } else if ((char === '\n' || char === '\r') && !inQuotes) {
      if (char === '\r' && nextChar === '\n') index += 1;
      row.push(value.trim());
      if (row.some(Boolean)) rows.push(row);
      row = [];
      value = '';
    } else {
      value += char;
    }
  }

  row.push(value.trim());
  if (row.some(Boolean)) rows.push(row);
  return rows;
};

const normalizeCsvKey = (value = '') => String(value).trim().toLowerCase().replace(/[^a-z0-9]/g, '');

const getCsvValue = (row, keys) => {
  for (const key of keys) {
    const value = row[normalizeCsvKey(key)];
    if (value !== undefined && String(value).trim() !== '') return String(value).trim();
  }
  return '';
};

const toBooleanValue = (value = '') => ['true', 'yes', 'y', '1'].includes(String(value).trim().toLowerCase());

const parseServiceList = (servicesValue = '', serviceType = '', serviceQty = '') => {
  const services = String(servicesValue || '')
    .split(/[;|]/)
    .map((service) => service.trim())
    .filter(Boolean);

  if (services.length) return normalizeServiceList(services);

  const type = String(serviceType || '').trim();
  const qty = String(serviceQty || '').trim();
  if (!type) return [];

  return normalizeServiceList(qty ? `${type} /${qty}qty` : type);
};

const normalizeImportedProductKeyPart = (value = '') =>
  String(value || '').trim().toLowerCase().replace(/\s+/g, ' ');

const getImportedProductItemKey = (item = {}) => {
  const sku = normalizeImportedProductKeyPart(item.sku);
  if (sku) return `sku:${sku}`;

  const fnsku = normalizeImportedProductKeyPart(item.fnskuLabel);
  const productName = normalizeImportedProductKeyPart(item.productName);
  if (fnsku && productName) return `fnsku-product:${fnsku}:${productName}`;
  if (fnsku) return `fnsku:${fnsku}`;
  if (productName) return `product:${productName}`;

  return '';
};

const dedupeImportedProductItems = (items = []) => {
  const seenKeys = new Set();
  let duplicateCount = 0;
  const uniqueItems = [];

  items.forEach((item) => {
    const key = getImportedProductItemKey(item);

    if (key && seenKeys.has(key)) {
      duplicateCount += 1;
      return;
    }

    if (key) seenKeys.add(key);
    uniqueItems.push(item);
  });

  return { uniqueItems, duplicateCount };
};

const mapCsvRowsToProductItems = (rows) => {
  if (rows.length < 2) return [];

  const headers = rows[0].map(normalizeCsvKey);
  return rows.slice(1).map((values) => {
    const row = headers.reduce((acc, header, index) => {
      acc[header] = values[index] || '';
      return acc;
    }, {});

    return {
      draftItemId: createDraftItemId(),
      productName: getCsvValue(row, ['productName', 'product_name', 'product', 'name']),
      sku: getCsvValue(row, ['sku', 'sellerSku', 'seller_sku']),
      expectedQty: getCsvValue(row, ['expectedQty', 'expected_qty', 'qtyExpected', 'qty_expected', 'quantity', 'qty']),
      fnskuLabel: getCsvValue(row, ['fnskuLabel', 'fnsku_label', 'fnsku', 'fbaFnsku']),
      bundleSize: getCsvValue(row, ['bundleSize', 'bundle_size', 'bundle']),
      needsBundling: toBooleanValue(getCsvValue(row, ['needsBundling', 'needs_bundling', 'bundling'])),
      serviceType: '',
      serviceQty: '',
      services: parseServiceList(
        getCsvValue(row, ['services', 'serviceList', 'service_list']),
        getCsvValue(row, ['serviceType', 'service_type']),
        getCsvValue(row, ['serviceQty', 'service_qty'])
      ),
      fileName: '',
    };
  }).filter((item) => item.sku || item.productName || item.expectedQty || item.fnskuLabel);
};

const escapePdfText = (value = '') => String(value).replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');

const downloadPdfFile = (fileName, lines) => {
  const textLines = lines.slice(0, 42);
  const streamLines = ['BT', '/F1 14 Tf', '50 780 Td'];
  textLines.forEach((line, index) => {
    if (index === 1) streamLines.push('/F1 10 Tf');
    streamLines.push(`(${escapePdfText(line)}) Tj`);
    streamLines.push('0 -18 Td');
  });
  streamLines.push('ET');

  const stream = streamLines.join('\n');
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
  ];

  let pdf = '%PDF-1.4\n';
  const offsets = [0];
  objects.forEach((object, index) => {
    offsets.push(pdf.length);
    pdf += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });

  const xrefOffset = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n`;
  pdf += '0000000000 65535 f \n';
  offsets.slice(1).forEach((offset) => {
    pdf += `${String(offset).padStart(10, '0')} 00000 n \n`;
  });
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`;

  const blob = new Blob([pdf], { type: 'application/pdf' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = fileName;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
};

const openOrDownloadFile = (file) => {
  const url = getFileUrlCandidates(file)[0] || resolveFileUrl(getFileUrl(file));
  if (!url) return false;

  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.target = '_blank';
  anchor.rel = 'noreferrer';
  anchor.download = getFileName(file);
  anchor.click();
  return true;
};

const LabelPreviewImage = ({ file, alt = '', className = '' }) => {
  const urls = getFileUrlCandidates(file);
  const [urlIndex, setUrlIndex] = useState(0);

  useEffect(() => {
    setUrlIndex(0);
  }, [file]);

  const src = urls[urlIndex] || '';
  if (!src) {
    return (
      <span className="flex h-24 w-36 items-center justify-center px-2 text-center text-xs font-medium text-gray-500">
        Preview unavailable
      </span>
    );
  }

  return (
    <img
      src={src}
      alt={alt || getFileName(file)}
      className={className}
      onError={() => {
        setUrlIndex((currentIndex) => {
          const nextIndex = currentIndex + 1;
          return nextIndex <= urls.length ? nextIndex : currentIndex;
        });
      }}
    />
  );
};

const readDraftCache = () => {
  try {
    return JSON.parse(localStorage.getItem(DRAFT_CACHE_KEY) || '{}');
  } catch {
    localStorage.removeItem(DRAFT_CACHE_KEY);
    return {};
  }
};

const getDraftCacheKeys = (...shipments) =>
  shipments
    .flatMap((shipment) => [
      shipment && typeof shipment !== 'object' ? shipment : '',
      getShipmentRecordId(shipment),
      getShipmentId(shipment),
      shipment?.reference,
      shipment?.shipmentNumber,
      shipment?.shipment_number,
      shipment?.uuid,
      shipment?.id,
    ])
    .filter(Boolean)
    .map((value) => String(value));

const draftHasPositiveBundleSize = (draft = {}) =>
  toArray(draft?.productItems).some((item) => isPositiveBundleSize(getItemBundleSize(item)));

const getCachedDraft = (...shipments) => {
  const cache = readDraftCache();
  const exactMatches = getDraftCacheKeys(...shipments).map((key) => cache[key]).filter(Boolean);
  const exactMatchWithBundleSize = exactMatches.find(draftHasPositiveBundleSize);
  if (exactMatchWithBundleSize) return exactMatchWithBundleSize;

  return exactMatches[0] || null;
};

const getEditableDraftSnapshot = (...shipments) => {
  const cachedDraft = getCachedDraft(...shipments);
  return cachedDraft?.isDraft === true || cachedDraft?.status === 'draft' ? cachedDraft : null;
};

const canEditDraftShipment = (shipment = {}) =>
  String(shipment?.status || '').toLowerCase() === 'draft' || Boolean(getEditableDraftSnapshot(shipment));

const writeCachedDraft = (shipments, draftData) => {
  const keys = getDraftCacheKeys(...shipments);
  if (!keys.length) return;

  const cache = readDraftCache();
  keys.forEach((key) => {
    cache[key] = draftData;
  });
  localStorage.setItem(DRAFT_CACHE_KEY, JSON.stringify(cache));
};

const removeCachedDraft = (...shipments) => {
  const keys = getDraftCacheKeys(...shipments);
  if (!keys.length) return;

  const cache = readDraftCache();
  keys.forEach((key) => {
    delete cache[key];
  });
  localStorage.setItem(DRAFT_CACHE_KEY, JSON.stringify(cache));
};

const stripNoteLine = (notes = '', prefix = '') =>
  String(notes || '')
    .split('\n')
    .filter((line) => !line.trim().toLowerCase().startsWith(prefix.toLowerCase()))
    .join('\n')
    .trim();

const getNoteValue = (notes = '', prefix = '') => {
  const line = String(notes || '')
    .split('\n')
    .find((currentLine) => currentLine.trim().toLowerCase().startsWith(prefix.toLowerCase()));
  return line ? line.trim().slice(prefix.length).trim() : '';
};

const getRawShipmentNotes = (shipment = {}) =>
  firstPresent(shipment?.client_notes, shipment?.clientNotes, shipment?.notes, shipment?.note);

const getShipmentNoteText = (shipment = {}) =>
  stripNoteLine(
    stripNoteLine(
      stripNoteLine(
        stripNoteLine(
          stripNoteLine(
            stripNoteLine(getRawShipmentNotes(shipment), 'QC inspection requested'),
            BUNDLE_SIZE_NOTE_PREFIX
          ),
          'Tracking:'
        ),
        'Boxes:'
      ),
      'Pallets:'
    ),
    'Boxes/Pallets:'
  );

const getShipmentOrderData = (shipment = {}) => {
  const notes = getRawShipmentNotes(shipment);

  return {
    tracking: firstPresent(
      shipment?.trackingNumber,
      shipment?.tracking_number,
      shipment?.tracking,
      shipment?.carrierTracking,
      shipment?.carrier_tracking,
      getNoteValue(notes, 'Tracking:')
    ),
    boxes: firstPresent(
      shipment?.boxCount,
      shipment?.box_count,
      shipment?.boxesPallets,
      shipment?.boxes_pallets,
      getNoteValue(notes, 'Boxes:'),
      getNoteValue(notes, 'Boxes/Pallets:')
    ),
    pallets: firstPresent(
      shipment?.palletCount,
      shipment?.pallet_count,
      getNoteValue(notes, 'Pallets:')
    ),
  };
};

const formatDateForInput = (value = '') => {
  if (!value) return '';
  const textValue = String(value).trim();
  if (/^[+-]\d{6}-/.test(textValue)) return '';
  if (/^\d{4}-\d{2}-\d{2}/.test(textValue)) return textValue.slice(0, 10);
  const parsedDate = new Date(textValue);
  if (Number.isNaN(parsedDate.getTime())) return '';
  const normalizedDate = parsedDate.toISOString().slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(normalizedDate) ? normalizedDate : '';
};

const buildShipmentNotes = (form = {}, items = []) =>
  [
    String(form.notes || '').trim(),
    String(form.trackingNumber || '').trim() ? `Tracking: ${String(form.trackingNumber).trim()}` : '',
    String(form.boxCount || '').trim() ? `Boxes: ${String(form.boxCount).trim()}` : '',
    String(form.palletCount || '').trim() ? `Pallets: ${String(form.palletCount).trim()}` : '',
  ]
    .filter(Boolean)
    .join('\n');

const mapShipmentItemsToProductItems = (items = []) => {
  const mappedItems = sortLineItemsForDisplay(getLineItems({ items })).map((item) => ({
    draftItemId: item?.draftItemId || item?.draft_item_id || createDraftItemId(),
    productName: getItemProductName(item),
    sku: getItemSku(item),
    expectedQty: String(getItemExpectedQty(item) || ''),
    fnskuLabel: getItemFnsku(item),
    bundleSize: String(getItemBundleSize(item) || ''),
    needsBundling: Boolean(item?.needsBundling || item?.needs_bundling),
    serviceType: '',
    serviceQty: '',
    customServiceName: '',
    services: getItemServices(item).map((service) => String(service || '')),
    fileName: item?.fileName || item?.file_name || '',
  }));

  return mappedItems.length ? mappedItems : [createEmptyProductItem()];
};

const serializeProductItemsForDraft = (items = []) =>
  items.map(({ file, uploadedDraftFile, ...item }) => ({
    ...item,
    bundleSize: item.needsBundling ? item.bundleSize : '',
    fileName: item.fileName || uploadedDraftFile?.fileName || uploadedDraftFile?.file_name || file?.name || '',
  }));

const getShipmentViewStats = (shipment = {}) => {
  const items = sortLineItemsForDisplay(getLineItems(shipment));
  return {
    items,
    totalUnits: items.reduce((sum, item) => sum + Number(getItemExpectedQty(item) || 0), 0),
    services: getShipmentServiceLabels(shipment),
  };
};

const getShipmentStatusBadgeClass = (status = '') => {
  switch (String(status || '').trim().toLowerCase()) {
    case 'draft':
      return 'bg-gray-100 text-gray-700';
    case 'submitted':
      return 'bg-blue-50 text-blue-700';
    case 'pending_arrival':
    case 'pending arrival':
      return 'bg-amber-50 text-amber-700';
    case 'received':
      return 'bg-emerald-50 text-emerald-700';
    case 'in_progress':
    case 'in progress':
      return 'bg-orange-50 text-orange-700';
    case 'prepped':
      return 'bg-purple-50 text-purple-700';
    case 'dispatched':
      return 'bg-indigo-50 text-indigo-700';
    case 'completed':
    case 'complete':
      return 'bg-green-50 text-green-700';
    default:
      return 'bg-slate-100 text-slate-700';
  }
};

const SUB_SHIPMENT_STATUS_LABELS = {
  draft: 'Draft',
  awaiting_fba_labels: 'Awaiting FBA labels',
  ready_to_dispatch: 'Ready to dispatch',
  dispatched: 'Dispatched',
  completed: 'Completed',
  cancelled: 'Cancelled',
};

const extractSubShipments = (payload) =>
  extractList(payload, ['subShipments', 'sub_shipments', 'subshipments']);

const getSubShipmentId = (subShipment = {}) =>
  firstPresent(subShipment?.id, subShipment?.uuid, subShipment?.subShipmentId, subShipment?.sub_shipment_id);

const getSubShipmentReference = (subShipment = {}) =>
  firstPresent(
    subShipment?.reference,
    subShipment?.subShipmentReference,
    subShipment?.sub_shipment_reference,
    subShipment?.sequence_no ? `Sub-shipment ${subShipment.sequence_no}` : '',
    getSubShipmentId(subShipment)
  );

const getSubShipmentStatus = (subShipment = {}) =>
  String(firstPresent(subShipment?.status, 'draft')).trim().toLowerCase();

const getSubShipmentStatusLabel = (status = '') => {
  const normalizedStatus = String(status || '').trim().toLowerCase();
  return SUB_SHIPMENT_STATUS_LABELS[normalizedStatus] || formatServiceLabel(normalizedStatus || 'draft');
};

const getSubShipmentItems = (subShipment = {}) =>
  extractList(subShipment, ['sub_shipment_items', 'subShipmentItems', 'items']);

const getSubShipmentBoxes = (subShipment = {}) =>
  extractList(subShipment, ['outbound_boxes', 'outboundBoxes', 'boxes', 'shipmentBoxes', 'shipment_boxes']);

const getSubShipmentItemLineItem = (item = {}) => {
  const lineItem =
    item?.shipment_line_items ||
    item?.shipmentLineItems ||
    item?.shipmentLineItem ||
    item?.shipment_line_item ||
    item?.lineItem ||
    item?.line_item ||
    item?.item;

  return lineItem && typeof lineItem === 'object' ? lineItem : item;
};

const getSubShipmentItemQuantity = (item = {}) =>
  firstPresent(item?.quantity, item?.qty, item?.units, item?.plannedQty, item?.planned_qty, 0);

const decorateSubShipmentBoxForClient = (box = {}, subShipment = {}) => ({
  ...box,
  subShipmentId: getSubShipmentId(subShipment),
  sub_shipment_id: getSubShipmentId(subShipment),
  subShipmentReference: getSubShipmentReference(subShipment),
  sub_shipment_reference: getSubShipmentReference(subShipment),
  __subShipmentReference: getSubShipmentReference(subShipment),
});

const ClientShipments = ({ awaitingFbaOnly = false }) => {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const isCreateMode = searchParams.get('mode') === 'create';
  const csvInputRef = useRef(null);
  const uploadedFileCacheRef = useRef({});
  const fbaLoadRequestRef = useRef(0);
  const viewLoadRequestRef = useRef(0);
  const fbaUploadPanelRef = useRef(null);
  const [shipments, setShipments] = useState([]);
  const [statusFilter, setStatusFilter] = useState('all');
  const [dateFilter, setDateFilter] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [currentPage, setCurrentPage] = useState(1);
  const [createForm, setCreateForm] = useState(() => ({
    ...initialCreateForm,
    clientId: getClientIdFromSession(),
  }));
  const [productItems, setProductItems] = useState([createEmptyProductItem()]);
  const [skuOptions, setSkuOptions] = useState([]);
  const [isSkuOptionsLoading, setIsSkuOptionsLoading] = useState(false);
  const [editingShipmentId, setEditingShipmentId] = useState('');
  const [selectedShipment, setSelectedShipment] = useState(null);
  const [showViewModal, setShowViewModal] = useState(false);
  const [showTrackModal, setShowTrackModal] = useState(false);
  const [deleteConfirmShipment, setDeleteConfirmShipment] = useState(null);
  const [selectedFbaBoxDetail, setSelectedFbaBoxDetail] = useState(null);
  const [batchFbaUpload, setBatchFbaUpload] = useState(null);
  const [selectedShipmentBoxes, setSelectedShipmentBoxes] = useState([]);
  const [selectedShipmentSubShipments, setSelectedShipmentSubShipments] = useState([]);
  const [selectedShipmentServices, setSelectedShipmentServices] = useState([]);
  const [selectedShipmentDiscrepancies, setSelectedShipmentDiscrepancies] = useState([]);
  const [selectedShipmentFiles, setSelectedShipmentFiles] = useState([]);
  const [loadingShipmentFiles, setLoadingShipmentFiles] = useState(false);
  const [fbaLabelShipments, setFbaLabelShipments] = useState([]);
  const [fbaLabelBoxesMap, setFbaLabelBoxesMap] = useState({});
  const [fbaLabelFilesMap, setFbaLabelFilesMap] = useState({});
  const [loadingFbaSection, setLoadingFbaSection] = useState(false);
  const [uploadingFbaBoxKey, setUploadingFbaBoxKey] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [isRefreshingDetails, setIsRefreshingDetails] = useState(false);
  const [savingAction, setSavingAction] = useState('');
  const [deletingShipmentId, setDeletingShipmentId] = useState('');
  const [uploadingBoxKey, setUploadingBoxKey] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [toast, setToast] = useState(null);

  const showToast = (type, toastMessage) => {
    setToast({ type, message: toastMessage });
  };

  const closeViewModal = () => {
    viewLoadRequestRef.current += 1;
    setShowViewModal(false);
    setSelectedShipment(null);
    setSelectedShipmentBoxes([]);
    setSelectedShipmentSubShipments([]);
    setSelectedShipmentServices([]);
    setSelectedShipmentDiscrepancies([]);
    setSelectedShipmentFiles([]);
    setLoadingShipmentFiles(false);
  };

  const closeCreateShipmentForm = () => {
    setCreateForm({
      ...initialCreateForm,
      clientId: getClientIdFromSession(),
    });
    setProductItems([createEmptyProductItem()]);
    setEditingShipmentId('');
    setSavingAction('');
    navigate('/shipments', { replace: true });
  };

  const getCachedUploadedFiles = (...shipmentsToMatch) => {
    const cacheKeys = getDraftCacheKeys(...shipmentsToMatch);
    return mergeFileLists(cacheKeys.flatMap((key) => uploadedFileCacheRef.current[key] || []));
  };

  const rememberUploadedFiles = (filesToCache = [], ...shipmentsToMatch) => {
    const files = mergeFileLists(filesToCache);
    if (!files.length) return;

    const cacheKeys = getDraftCacheKeys(...shipmentsToMatch);
    cacheKeys.forEach((key) => {
      uploadedFileCacheRef.current[key] = mergeFileLists(uploadedFileCacheRef.current[key] || [], files);
    });
  };

  useEffect(() => {
    if (!toast) return undefined;

    const timer = window.setTimeout(() => {
      setToast(null);
    }, 3500);

    return () => window.clearTimeout(timer);
  }, [toast]);

  const fetchSkuOptionsForClient = async (clientId) => {
    const response = await fetch(`${API_BASE_URL}/api/products`, {
      method: 'GET',
      headers: buildHeaders(),
      cache: 'no-store',
    });
    const payload = await parseResponse(response);
    return normalizeSkuProductOptions(payload, clientId);
  };

  useEffect(() => {
    const clientId = String(createForm.clientId || getClientIdFromSession() || '').trim();
    let isCancelled = false;

    if (!clientId) {
      setSkuOptions([]);
      setIsSkuOptionsLoading(false);
      return undefined;
    }

    const loadSkuOptions = async () => {
      try {
        setIsSkuOptionsLoading(true);
        const options = await fetchSkuOptionsForClient(clientId);
        if (!isCancelled) {
          setSkuOptions(options);
        }
      } catch (requestError) {
        if (!isCancelled) {
          setSkuOptions([]);
          showToast('error', requestError.message || 'Failed to load your SKUs.');
        }
      } finally {
        if (!isCancelled) {
          setIsSkuOptionsLoading(false);
        }
      }
    };

    loadSkuOptions();

    return () => {
      isCancelled = true;
    };
  }, [createForm.clientId]);

  const updateProductItem = (index, key, value) => {
    setProductItems((current) =>
      current.map((item, itemIndex) => {
        if (itemIndex !== index) return item;
        if (key === 'needsBundling') {
          return {
            ...item,
            needsBundling: value,
            bundleSize: value ? (item.needsBundling ? item.bundleSize : '') : '',
          };
        }
        return { ...item, [key]: value };
      })
    );
  };

  const handleSkuChange = (index, value) => {
    setProductItems((current) =>
      current.map((item, itemIndex) => (itemIndex === index ? { ...item, sku: value } : item))
    );
  };

  const handleSkuProductSelect = (index, product) => {
    setProductItems((current) =>
      current.map((item, itemIndex) => {
        if (itemIndex !== index) return item;
        const needsBundling = Boolean(product?.needsBundling || product?.needs_bundling);
        return {
          ...item,
          sku: product?.sku || item.sku,
          productName: product?.productName || item.productName,
          fnskuLabel: product?.fnskuLabel || '',
          needsBundling,
          bundleSize: needsBundling ? String(product?.bundleSize || product?.bundle_size || '') : '',
        };
      })
    );
    setError('');
  };

  const deleteDraftLabelFileForItem = async (item = {}) => {
    const fileRecordId = firstPresent(
      item?.draftFileRecordId,
      item?.fnskuLabelFileId,
      item?.fnsku_label_file_id,
      getDraftFileRecordId(item?.uploadedDraftFile)
    );

    if (!fileRecordId) return;

    try {
      await deleteDraftFileRecord({
        fileRecordId,
        apiBaseUrl: API_BASE_URL,
        buildHeaders,
        parseResponse,
      });
    } catch (requestError) {
      showToast('error', requestError.message || 'Could not remove the previous draft FNSKU label.');
    }
  };

  const handleProductLabelFile = (index, file) => {
    if (!file) return;
    if (file.size > SAFE_FILE_UPLOAD_BYTES) {
      const errorMessage = getFnskuLabelTooLargeMessage(file.name);
      setError(errorMessage);
      showToast('error', errorMessage);
      return;
    }
    void deleteDraftLabelFileForItem(productItems[index]);
    setProductItems((current) =>
      current.map((item, itemIndex) =>
        itemIndex === index
          ? {
              ...item,
              file,
              fileName: file.name,
              fnskuLabelFileName: file.name,
              fnsku_label_file_name: file.name,
              fnskuLabelFileId: '',
              fnsku_label_file_id: '',
              draftFileRecordId: '',
              uploadedDraftFile: null,
            }
          : item
      )
    );
    setError('');
  };

  const handleAddProductItem = () => {
    setProductItems((current) => [...current, createEmptyProductItem()]);
  };

  const handleRemoveProductItem = (index) => {
    void deleteDraftLabelFileForItem(productItems[index]);
    setProductItems((current) => (current.length === 1 ? current : current.filter((_, itemIndex) => itemIndex !== index)));
  };

  const addServiceToItem = (index, serviceValue = '') => {
    if (isOtherServiceValue(serviceValue)) {
      setProductItems((current) =>
        current.map((item, itemIndex) =>
          itemIndex === index ? { ...item, serviceType: 'OTHER', customServiceName: '' } : item
        )
      );
      setError('');
      return;
    }

    const serviceCode = normalizeServiceType(serviceValue);
    if (!serviceCode) return;

    setProductItems((current) =>
      current.map((item, itemIndex) => {
        if (itemIndex !== index) return item;
        const nextServices = normalizeServiceList(item.services, serviceCode);
        return { ...item, services: nextServices, serviceType: '', serviceQty: '', customServiceName: '' };
      })
    );
    setError('');
  };

  const addCustomServiceToItem = (index) => {
    const customService = productItems[index]?.customServiceName?.trim();
    const serviceCode = normalizeServiceType(customService);
    if (!serviceCode) {
      setError('Please type a custom service name.');
      return;
    }

    setProductItems((current) =>
      current.map((item, itemIndex) => {
        if (itemIndex !== index) return item;
        const nextServices = normalizeServiceList(item.services, serviceCode);
        return { ...item, services: nextServices, serviceType: '', serviceQty: '', customServiceName: '' };
      })
    );
    setError('');
  };

  const handleRemoveService = (index, serviceIndex) => {
    setProductItems((current) =>
      current.map((item, itemIndex) =>
        itemIndex === index
          ? { ...item, services: item.services.filter((_, currentServiceIndex) => currentServiceIndex !== serviceIndex) }
          : item
      )
    );
  };

  const handleImportCsvFile = async (file) => {
    if (!file) return;

    try {
      setError('');
      setMessage('');

      const text = await file.text();
      const rows = parseCsvRows(text);
      const importedItems = mapCsvRowsToProductItems(rows);
      const { uniqueItems, duplicateCount } = dedupeImportedProductItems(importedItems);

      if (!uniqueItems.length) {
        throw new Error('CSV file is empty or has invalid format. Please ensure it has the correct headers and data.');
      }

      setProductItems(uniqueItems);
      setMessage(
        `${uniqueItems.length} product line item(s) imported from CSV.${
          duplicateCount ? ` ${duplicateCount} duplicate row(s) skipped.` : ''
        }`
      );
    } catch (requestError) {
      setError(requestError.message || 'CSV import failed.');
    }
  };

  const handleDownloadShipmentGuide = () => {
    downloadPdfFile('submit-shipment-guide.pdf', [
      'PickPackPro - Submit Shipment CSV Guide',
      '',
      'Use the Import CSV button to fill Product Line Items quickly.',
      '',
      'Required columns:',
      'sku, productName, expectedQty',
      '',
      'Optional columns:',
      'fnskuLabel, bundleSize, needsBundling, services, serviceType, serviceQty',
      '',
      'Recommended CSV header:',
      'sku,productName,expectedQty,fnskuLabel,bundleSize,needsBundling,services',
      '',
      'Example row:',
      'SG-LAMP-01,LED Desk Lamp,100,X001ABC234,1,false,FNSKU Labeling;Poly Bag',
      '',
      'Notes:',
      '- Separate multiple services with semicolon or pipe.',
      '- Use yes/true/1 for needsBundling.',
      '- Keep expectedQty as a number greater than zero.',
      '- You can still edit imported rows before submitting.',
    ]);
    setMessage('Guide PDF downloaded.');
  };

  const getBoxDedupeKey = (box = {}, index = 0) =>
    String(
      getBoxRecordId(box) ||
        getBoxId(box) ||
        box?.box_number ||
        box?.boxNumber ||
        box?.reference ||
        box?.label ||
        `box-${index}`
    );

  const mergeBoxPages = (...boxGroups) => {
    const merged = new Map();

    boxGroups.flat().filter(Boolean).forEach((box, index) => {
      const key = getBoxDedupeKey(box, index);
      if (!merged.has(key)) merged.set(key, box);
    });

    return [...merged.values()];
  };

  const fetchShipmentBoxesAllPages = async (shipmentId) => {
    const allBoxes = [];
    const seenKeys = new Set();
    const maxPages = 8;
    const pageSize = 100;

    for (let page = 1; page <= maxPages; page += 1) {
      let payload = null;
      try {
        const response = await fetch(`${API_BASE_URL}/api/shipments/${encodeURIComponent(shipmentId)}/boxes?page=${page}&limit=${pageSize}`, {
          method: 'GET',
          headers: buildHeaders(),
          cache: 'no-store',
        });
        if (response.status === 401 || response.status === 403) {
          const authError = new Error('Unauthorized shipment access.');
          authError.status = response.status;
          throw authError;
        }
        payload = await parseResponse(response);
      } catch (requestError) {
        if (page === 1) throw requestError;
        break;
      }
      const pageBoxes = extractList(payload, ['boxes', 'outbound_boxes', 'outboundBoxes']);

      if (!pageBoxes.length) break;

      let newBoxCount = 0;
      pageBoxes.forEach((box, index) => {
        const key = getBoxDedupeKey(box, allBoxes.length + index);
        if (seenKeys.has(key)) return;
        seenKeys.add(key);
        allBoxes.push(box);
        newBoxCount += 1;
      });

      if (!newBoxCount || pageBoxes.length < pageSize) break;
    }

    return allBoxes;
  };

  const fetchSubShipmentsForShipmentCandidates = async (lookupCandidates = []) => {
    const uniqueLookupCandidates = [...new Set(lookupCandidates.map((value) => String(value || '').trim()).filter(Boolean))];

    for (const lookupId of uniqueLookupCandidates) {
      try {
        const response = await fetch(`${API_BASE_URL}/api/shipments/${encodeURIComponent(lookupId)}/sub-shipments`, {
          method: 'GET',
          headers: buildHeaders(),
          cache: 'no-store',
        });
        if (response.status === 401 || response.status === 403) {
          const authError = new Error('Unauthorized shipment access.');
          authError.status = response.status;
          throw authError;
        }
        const payload = await parseResponse(response);
        const subShipments = extractSubShipments(payload);
        if (!subShipments.length) continue;

        const boxResults = await Promise.allSettled(
          subShipments.map(async (subShipment) => {
            const subShipmentId = getSubShipmentId(subShipment);
            if (!subShipmentId) return getSubShipmentBoxes(subShipment);

            try {
              const boxesResponse = await fetch(`${API_BASE_URL}/api/sub-shipments/${encodeURIComponent(subShipmentId)}/boxes`, {
                method: 'GET',
                headers: buildHeaders(),
                cache: 'no-store',
              });
              if (boxesResponse.status === 401 || boxesResponse.status === 403) return getSubShipmentBoxes(subShipment);
              const boxesPayload = await parseResponse(boxesResponse);
              const boxes = extractList(boxesPayload, ['boxes', 'outbound_boxes', 'outboundBoxes']);
              return boxes.length ? boxes : getSubShipmentBoxes(subShipment);
            } catch {
              return getSubShipmentBoxes(subShipment);
            }
          })
        );

        return subShipments.map((subShipment, index) => {
          const boxes = boxResults[index]?.status === 'fulfilled' ? boxResults[index].value : getSubShipmentBoxes(subShipment);
          const decoratedBoxes = boxes.map((box) => decorateSubShipmentBoxForClient(box, subShipment));
          return {
            ...subShipment,
            boxes: decoratedBoxes,
            outbound_boxes: decoratedBoxes,
            shipmentBoxes: decoratedBoxes,
            shipment_boxes: decoratedBoxes,
          };
        });
      } catch (requestError) {
        if (requestError?.status === 401 || requestError?.status === 403) break;
      }
    }

    return [];
  };

  const fetchShipmentDetailFromCandidates = async (lookupCandidates = []) => {
    const detailLookupCandidates = getUuidLookupCandidates(lookupCandidates);
    for (const lookupId of detailLookupCandidates) {
      try {
        const response = await fetch(`${API_BASE_URL}/api/shipments/${encodeURIComponent(lookupId)}`, {
          method: 'GET',
          headers: buildHeaders(),
          cache: 'no-store',
        });
        if (response.status === 401 || response.status === 403) {
          return { detail: {}, payload: null, unauthorized: true };
        }
        const payload = await parseResponse(response);
        const detail = extractShipmentDetail(payload);
        if (detail && typeof detail === 'object') return { detail, payload };
      } catch {
        // Try the next UUID lookup candidate.
      }
    }

    return { detail: {}, payload: null };
  };

  const fetchBoxesForShipmentCandidates = async (lookupCandidates = []) => {
    const boxLookupCandidates = getUuidLookupCandidates(lookupCandidates);
    if (!boxLookupCandidates.length) return [];

    for (const lookupId of boxLookupCandidates) {
      try {
        const boxes = await fetchShipmentBoxesAllPages(lookupId);
        if (boxes.length) return boxes;
      } catch (requestError) {
        if (requestError?.status === 401 || requestError?.status === 403) break;
        // Try the next shipment identifier.
      }
    }

    return [];
  };

  const loadFbaLabelShipments = async (sourceShipments = shipments) => {
    const requestId = fbaLoadRequestRef.current + 1;
    fbaLoadRequestRef.current = requestId;
    const isCurrentRequest = () => fbaLoadRequestRef.current === requestId;
    const candidates = extractList(sourceShipments, ['shipments'])
      .filter(doesShipmentBelongToCurrentClient)
      .filter((shipment) => FBA_LABEL_ELIGIBLE_STATUSES.has(String(shipment?.status || '').toLowerCase()));

    if (!candidates.length) {
      if (!isCurrentRequest()) return;
      setFbaLabelShipments([]);
      setFbaLabelBoxesMap({});
      setFbaLabelFilesMap({});
      setLoadingFbaSection(false);
      return;
    }

    try {
      setLoadingFbaSection(true);
      const nextBoxesMap = {};
      const nextFilesMap = {};
      const nextShipments = [];

      const shipmentResults = await Promise.allSettled(
        candidates.map(async (shipment) => {
          const lookupCandidates = getShipmentLookupCandidates(shipment);
          if (!lookupCandidates.length) return { shipment, boxes: [] };

          const [detailResult, boxesResult, subShipmentsResult] = await Promise.allSettled([
            fetchShipmentDetailFromCandidates(lookupCandidates),
            fetchBoxesForShipmentCandidates(lookupCandidates),
            fetchSubShipmentsForShipmentCandidates(lookupCandidates),
          ]);

          const detailPayload = detailResult.status === 'fulfilled' ? detailResult.value?.payload : null;
          const detail = detailResult.status === 'fulfilled' ? detailResult.value?.detail || {} : {};
          const detailItems = mergeLineItemGroups(
            getLineItems(detail),
            getLineItems(detailPayload),
            getLineItems(shipment)
          );
          const enrichedShipment = normalizeShipment({
            ...shipment,
            ...detail,
            id: getShipmentRecordId(detail) || getShipmentRecordId(shipment) || getShipmentId(shipment),
            reference: getShipmentReference(detail) || getShipmentReference(shipment),
            items: detailItems,
            lineItems: detailItems,
          });
          const boxes = boxesResult.status === 'fulfilled' ? boxesResult.value : [];
          const subShipments = subShipmentsResult.status === 'fulfilled'
            ? subShipmentsResult.value
            : extractSubShipments(detail);
          const subShipmentBoxes = subShipments.flatMap((subShipment) =>
            getSubShipmentBoxes(subShipment).map((box) => decorateSubShipmentBoxForClient(box, subShipment))
          );
          return { shipment: enrichedShipment, boxes: mergeBoxPages(boxes, subShipmentBoxes) };
        })
      );
      if (!isCurrentRequest()) return;

      const fileLookups = [];
      const shipmentFileLookups = [];
      shipmentResults.forEach((result) => {
        if (result.status !== 'fulfilled') return;
        const { shipment, boxes } = result.value;
        const shipmentId = getShipmentId(shipment);
        const missingBoxes = boxes.filter(
          (box) =>
            !hasDirectFbaLabelRecord(box) &&
            !isBoxDispatchedForFba(box) &&
            String(box?.status || '').toLowerCase() !== 'uploaded' &&
            !box?.labelReady &&
            !box?.label_ready &&
            !box?.fbaLabelUploaded &&
            !box?.fba_label_uploaded &&
            !box?.labelUploaded &&
            !box?.label_uploaded
        );

        if (missingBoxes.length) {
          nextShipments.push(shipment);
          nextBoxesMap[shipmentId] = boxes;
        }

        if (shipmentId && boxes.length) {
          shipmentFileLookups.push({ shipment, shipmentId, boxes });
        }

        boxes.forEach((box) => {
          const boxId = getBoxItemsLookupId(box);
          if (!boxId) return;
          nextFilesMap[boxId] = null;
          fileLookups.push({ shipment, boxId, box });
        });
      });

      setFbaLabelShipments(nextShipments);
      setFbaLabelBoxesMap(nextBoxesMap);
      setFbaLabelFilesMap(nextFilesMap);
      setLoadingFbaSection(false);

      if (!fileLookups.length && !shipmentFileLookups.length) return;

      const [fileResults, shipmentFileResults] = await Promise.all([
        Promise.allSettled(
          fileLookups.map(async ({ shipment, boxId, box }) => {
            const filesResponse = await fetch(`${API_BASE_URL}/api/files?entityType=box&entityId=${encodeURIComponent(boxId)}`, {
              method: 'GET',
              headers: buildHeaders(),
              cache: 'no-store',
            });
            const files = extractFiles(await parseResponse(filesResponse));
            const matchingFiles = files.filter((file) => fileMatchesShipmentContext(file, shipment, box) && fileMatchesBoxIdentity(file, box));
            const file = matchingFiles.find(isFbaBoxLabelFile) || null;
            return {
              boxId,
              file: file
                ? {
                    ...file,
                    entityType: file?.entityType || file?.entity_type || 'box',
                    entity_type: file?.entity_type || file?.entityType || 'box',
                    entityId: file?.entityId || getFileEntityId(file) || boxId,
                    entity_id: file?.entity_id || getFileEntityId(file) || boxId,
                    boxId: file?.boxId || boxId,
                    box_id: file?.box_id || boxId,
                    fileType: file?.fileType || file?.file_type || 'fba_shipping_label',
                    file_type: file?.file_type || file?.fileType || 'fba_shipping_label',
                  }
                : null,
            };
          })
        ),
        Promise.allSettled(
          shipmentFileLookups.map(async ({ shipment, shipmentId, boxes }) => {
            const filesResponse = await fetch(`${API_BASE_URL}/api/files?entityType=shipment&entityId=${encodeURIComponent(shipmentId)}`, {
              method: 'GET',
              headers: buildHeaders(),
              cache: 'no-store',
            });
            const files = extractFiles(await parseResponse(filesResponse)).filter(isFbaBoxLabelFile);
            return { shipment, boxes, files };
          })
        ),
      ]);

      const hydratedFilesMap = { ...nextFilesMap };

      fileResults.forEach((result) => {
        if (result.status === 'fulfilled') {
          hydratedFilesMap[result.value.boxId] = result.value.file;
        }
      });

      shipmentFileResults.forEach((result) => {
        if (result.status !== 'fulfilled') return;
        const { shipment, boxes, files } = result.value;
        boxes.forEach((box) => {
          const boxId = getBoxItemsLookupId(box);
          if (!boxId) return;
          const matchedFile = files.find((file) => fileMatchesShipmentContext(file, shipment, box) && fileMatchesBoxIdentity(file, box));
          if (matchedFile) {
            hydratedFilesMap[boxId] = {
              ...matchedFile,
              boxId,
              box_id: boxId,
              fileType: matchedFile?.fileType || matchedFile?.file_type || 'fba_shipping_label',
              file_type: matchedFile?.file_type || matchedFile?.fileType || 'fba_shipping_label',
            };
          }
        });
      });

      if (!isCurrentRequest()) return;
      setFbaLabelFilesMap(hydratedFilesMap);
    } catch (requestError) {
      if (isCurrentRequest()) setError(requestError.message);
    } finally {
      if (isCurrentRequest()) setLoadingFbaSection(false);
    }
  };

  const loadShipments = async (pinnedShipments = []) => {
    const sessionClientId = getClientIdFromSession();
    const pinnedRows = (Array.isArray(pinnedShipments) ? pinnedShipments : [pinnedShipments])
      .filter(Boolean)
      .map(normalizeShipment)
      .filter(isValidShipmentForList)
      .filter(doesShipmentBelongToCurrentClient);

    try {
      setIsLoading(true);
      setError('');
      const fetchShipmentPages = async (params = {}) => {
        const query = new URLSearchParams(params);
        if (awaitingFbaOnly && sessionClientId) query.set('clientId', sessionClientId);
        const rows = [];
        const maxPages = awaitingFbaOnly ? 10 : 1;
        const pageSize = awaitingFbaOnly ? 100 : null;

        for (let page = 1; page <= maxPages; page += 1) {
          query.set('page', String(page));
          if (pageSize) {
            query.set('limit', String(pageSize));
          } else {
            query.delete('limit');
          }
          const response = await fetch(`${API_BASE_URL}/api/shipments?${query.toString()}`, {
            method: 'GET',
            headers: buildHeaders(),
            cache: 'no-store',
          });
          const pageRows = extractShipments(await parseResponse(response));
          rows.push(...pageRows);
          if (!awaitingFbaOnly || pageRows.length < pageSize) break;
        }

        return rows;
      };

      let loadedPayloads = [];
      if (awaitingFbaOnly && statusFilter === 'all') {
        const pageResults = await Promise.allSettled([
          fetchShipmentPages(),
          ...FBA_LABEL_ELIGIBLE_STATUS_VALUES.map((status) => fetchShipmentPages({ status })),
        ]);
        loadedPayloads = pageResults.flatMap((result) => (result.status === 'fulfilled' ? result.value : []));
      } else {
        loadedPayloads = await fetchShipmentPages(statusFilter !== 'all' ? { status: statusFilter } : {});
      }

      const loadedRows = loadedPayloads
        .map(normalizeShipment)
        .map((shipment) => (getEditableDraftSnapshot(shipment) ? { ...shipment, backendStatus: shipment.status, status: 'draft' } : shipment))
        .filter(isValidShipmentForList)
        .filter(doesShipmentBelongToCurrentClient);
      const shouldPreferPinnedRows = pinnedRows.some(canEditDraftShipment);
      const mergedRows = sortShipmentsForList(
        mergeShipmentLists(...(shouldPreferPinnedRows ? [loadedRows, pinnedRows] : [pinnedRows, loadedRows])).filter(isValidShipmentForList)
      );
      if (awaitingFbaOnly) {
        setShipments(mergedRows);
        loadFbaLabelShipments(mergedRows);
        return;
      }

      const serviceEnrichedRows = await enrichShipmentsWithServiceTasks(mergedRows);
      const sortedRows = sortShipmentsForList(serviceEnrichedRows);
      setShipments(sortedRows);
    } catch (requestError) {
      setError(requestError.message);
      setShipments((currentShipments) =>
        pinnedRows.length
          ? sortShipmentsForList(
              mergeShipmentLists(pinnedRows, currentShipments).filter(isValidShipmentForList)
            )
          : []
      );
      setFbaLabelShipments([]);
      setFbaLabelBoxesMap({});
      setFbaLabelFilesMap({});
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    if (isCreateMode && !awaitingFbaOnly) {
      setIsLoading(false);
      return;
    }

    loadShipments();
  }, [statusFilter, isCreateMode, awaitingFbaOnly]);

  useEffect(() => {
    if (!awaitingFbaOnly) return undefined;

    let refreshTimer = null;

    const scheduleRefresh = () => {
      window.clearTimeout(refreshTimer);
      refreshTimer = window.setTimeout(() => {
        loadShipments();
      }, 700);
    };

    const handleMutation = (event) => {
      const url = String(event?.detail?.url || '');
      if (!url.includes('/api/files') && !url.includes('/api/boxes') && !url.includes('/api/shipments')) return;
      scheduleRefresh();
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') scheduleRefresh();
    };

    window.addEventListener(API_MUTATION_EVENT_NAME, handleMutation);
    window.addEventListener('focus', scheduleRefresh);
    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      window.clearTimeout(refreshTimer);
      window.removeEventListener(API_MUTATION_EVENT_NAME, handleMutation);
      window.removeEventListener('focus', scheduleRefresh);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [awaitingFbaOnly, statusFilter, isCreateMode]);

  const filteredShipments = useMemo(() => shipments.filter((shipment) => {
    const term = searchQuery.toLowerCase();
    const matchesSearch = !term || shipment.reference.toLowerCase().includes(term);
    const matchesDate = !dateFilter || String(shipment.created).includes(dateFilter);
    return matchesSearch && matchesDate;
  }), [shipments, searchQuery, dateFilter]);

  const totalShipmentPages = Math.max(1, Math.ceil(filteredShipments.length / SHIPMENTS_PER_PAGE));
  const currentShipmentPage = Math.min(currentPage, totalShipmentPages);
  const shipmentPageStart = (currentShipmentPage - 1) * SHIPMENTS_PER_PAGE;
  const paginatedShipments = filteredShipments.slice(shipmentPageStart, shipmentPageStart + SHIPMENTS_PER_PAGE);
  const firstVisibleShipment = filteredShipments.length ? shipmentPageStart + 1 : 0;
  const lastVisibleShipment = Math.min(shipmentPageStart + paginatedShipments.length, filteredShipments.length);
  const shipmentPageNumbers = Array.from({ length: totalShipmentPages }, (_, index) => index + 1);

  useEffect(() => {
    setCurrentPage(1);
  }, [statusFilter, searchQuery, dateFilter]);

  useEffect(() => {
    if (currentPage > totalShipmentPages) {
      setCurrentPage(totalShipmentPages);
    }
  }, [currentPage, totalShipmentPages]);

  const handleCreateShipment = async (isDraft = false) => {
    try {
      setSavingAction(isDraft ? 'draft' : 'submit');
      setError('');
      setMessage('');

      const clientId = getClientIdFromSession();

      if (!clientId.trim()) {
        throw new Error('Client UUID is required.');
      }

      const productItemsWithDraftIds = ensureDraftItemIds(productItems);
      setProductItems(productItemsWithDraftIds);
      const items = isDraft
        ? buildDraftShipmentItems(productItemsWithDraftIds)
        : buildSubmittedShipmentItems(productItemsWithDraftIds);

      if (!items.length) {
        throw new Error('At least one product line item is required.');
      }

      const labelFileInputs = productItemsWithDraftIds
        .map((item, index) => ({
          item,
          index,
          file: item.file,
        }))
        .filter(({ file }) => file && typeof file === 'object' && file.name);

      const notes = buildShipmentNotes(createForm, items);
      const rawExpectedArrivalDate = String(createForm.expectedArrivalDate || '').trim();
      const expectedArrivalDate = formatDateForInput(rawExpectedArrivalDate);
      if (rawExpectedArrivalDate && !expectedArrivalDate) {
        throw new Error('Expected date is invalid. Please select a valid date.');
      }
      const requestUrl = editingShipmentId
        ? `${API_BASE_URL}/api/shipments/${encodeURIComponent(editingShipmentId)}`
        : `${API_BASE_URL}/api/shipments`;
      const shipmentFields = {
        notes,
        ...(expectedArrivalDate ? { expectedArrivalDate } : {}),
        isDraft,
        items,
      };
      const requestBody = editingShipmentId
        ? shipmentFields
        : {
            clientId: clientId.trim(),
            ...shipmentFields,
          };
      const existingShipmentForEdit = editingShipmentId
        ? shipments.find((shipment) => getDraftCacheKeys(shipment).includes(String(editingShipmentId)))
        : null;
      const buildLocalDraftSavePayload = () => ({
        shipment: {
          ...existingShipmentForEdit,
          id: getShipmentRecordId(existingShipmentForEdit) || editingShipmentId,
          uuid: existingShipmentForEdit?.uuid || editingShipmentId,
          reference: existingShipmentForEdit?.reference || existingShipmentForEdit?.shipmentNumber || editingShipmentId,
          status: 'draft',
          notes,
          client_notes: notes,
          expectedArrivalDate,
          expected_arrival_date: expectedArrivalDate,
          items,
          lineItems: items,
          shipment_line_items: items,
        },
      });
      const backendStatusForEdit = String(existingShipmentForEdit?.backendStatus || '').toLowerCase();
      const shouldSaveDraftLocallyOnly = Boolean(
        editingShipmentId &&
          isDraft &&
          getEditableDraftSnapshot(existingShipmentForEdit, editingShipmentId) &&
          backendStatusForEdit &&
          backendStatusForEdit !== 'draft'
      );
      let savePayload = null;
      let stagedDraftUploadResult = { uploadedFiles: [], uploadedCount: 0, failedMessages: [] };

      if (!isDraft && editingShipmentId && labelFileInputs.length) {
        stagedDraftUploadResult = await uploadDraftFnskuLabelFiles({
          shipmentId: editingShipmentId,
          items: productItemsWithDraftIds,
          apiBaseUrl: API_BASE_URL,
          buildHeaders,
          parseResponse,
          prepareFileForUpload,
        });

        if (stagedDraftUploadResult.failedMessages.length) {
          throw new Error(stagedDraftUploadResult.failedMessages.join(' '));
        }
      }

      if (shouldSaveDraftLocallyOnly) {
        savePayload = buildLocalDraftSavePayload();
        console.log('[PickPackPro] Shipment save response', {
          status: 200,
          ok: true,
          method: 'LOCAL_DRAFT',
          url: requestUrl,
          requestBody,
          response: savePayload,
        });
      } else {
        const response = await fetch(requestUrl, {
          method: editingShipmentId ? 'PATCH' : 'POST',
          headers: buildHeaders(true),
          body: JSON.stringify(requestBody),
        });
        const responseForDebug = response.clone();
        try {
          savePayload = await parseResponse(response);
          console.log('[PickPackPro] Shipment save response', {
            status: response.status,
            ok: response.ok,
            method: editingShipmentId ? 'PATCH' : 'POST',
            url: requestUrl,
            requestBody,
            response: savePayload,
          });
        } catch (saveError) {
          let errorPayload = null;
          try {
            const errorText = await responseForDebug.text();
            errorPayload = errorText ? JSON.parse(errorText) : null;
          } catch {
            errorPayload = null;
          }
          console.error('[PickPackPro] Shipment save failed', {
            status: response.status,
            ok: response.ok,
            method: editingShipmentId ? 'PATCH' : 'POST',
            url: requestUrl,
            requestBody,
            response: errorPayload,
            error: saveError.message,
          });
          const errorText = [
            saveError.message,
            errorPayload?.message,
            errorPayload?.error,
            errorPayload ? JSON.stringify(errorPayload) : '',
          ].join(' ');

          if (editingShipmentId && isDraft && response.status === 422 && /only draft shipments can be edited/i.test(errorText)) {
            savePayload = buildLocalDraftSavePayload();
            console.warn('[PickPackPro] Backend shipment is not draft; saved edited draft locally.', {
              url: requestUrl,
              requestBody,
              response: errorPayload,
            });
          } else {
            throw saveError;
          }
        }
      }
      const savedShipment = extractShipmentDetail(savePayload);
      const optimisticCreatedAt =
        savedShipment?.createdAt ||
        savedShipment?.created_at ||
        savedShipment?.created ||
        new Date().toISOString();
      const savedShipmentLineItems = getLineItems(savedShipment);
      const savedItemsForDisplay = mergeLineItemGroups(savedShipmentLineItems, items);
      const savedShipmentForList = normalizeShipment({
        ...savedShipment,
        id: editingShipmentId || savedShipment?.id || savedShipment?.uuid || savedShipment?.shipmentId,
        clientId: clientId.trim(),
        client_id: clientId.trim(),
        reference: savedShipment?.reference || savedShipment?.shipmentNumber || savedShipment?.shipment_number || savedShipment?.id,
        createdAt: optimisticCreatedAt,
        created_at: savedShipment?.created_at || optimisticCreatedAt,
        expectedArrivalDate: expectedArrivalDate || savedShipment?.expectedArrivalDate || savedShipment?.expected_arrival_date,
        expected_arrival_date: expectedArrivalDate || savedShipment?.expected_arrival_date || savedShipment?.expectedArrivalDate,
        notes,
        status: isDraft ? 'draft' : savedShipment?.status || 'submitted',
        items: savedItemsForDisplay.length ? savedItemsForDisplay : items,
        lineItems: savedItemsForDisplay.length ? savedItemsForDisplay : items,
      });
      const savedShipmentRecordId =
        getShipmentRecordId(savedShipmentForList) ||
        getShipmentRecordId(savedShipment) ||
        (isUuidValue(editingShipmentId) ? editingShipmentId : '');
      const savedLineItems = savedShipmentLineItems || [];
      const labelUploadWarnings = [];
      let uploadedLabelFiles = [...stagedDraftUploadResult.uploadedFiles];
      let uploadedLabelCount = stagedDraftUploadResult.uploadedCount;

      if (isDraft) {
        savedShipmentForList.status = 'draft';
      } else if (!isDraft && savedShipmentRecordId) {
        try {
          const currentStatus = String(savedShipmentForList.status || savedShipment?.status || '').toLowerCase();
          if (!currentStatus || currentStatus === 'draft') {
            await parseResponse(
              await fetch(`${API_BASE_URL}/api/shipments/${encodeURIComponent(savedShipmentRecordId)}/status`, {
                method: 'PATCH',
                headers: buildHeaders(true),
                body: JSON.stringify({ status: 'submitted' }),
              })
            );
            savedShipmentForList.status = 'submitted';
          }
        } catch (statusError) {
          labelUploadWarnings.push(statusError.message || 'Shipment was created, but status could not be updated.');
        }
      }

      if (labelFileInputs.length && isDraft) {
        if (savedShipmentRecordId) {
          const draftUploadResult = await uploadDraftFnskuLabelFiles({
            shipmentId: savedShipmentRecordId,
            items: productItemsWithDraftIds,
            apiBaseUrl: API_BASE_URL,
            buildHeaders,
            parseResponse,
            prepareFileForUpload,
          });

          uploadedLabelFiles = mergeFileLists(uploadedLabelFiles, draftUploadResult.uploadedFiles);
          uploadedLabelCount += draftUploadResult.uploadedCount;
          labelUploadWarnings.push(...draftUploadResult.failedMessages);
        } else {
          labelUploadWarnings.push('Draft label file upload skipped because shipment database ID was not returned.');
        }
      } else if (labelFileInputs.length && !editingShipmentId) {
        if (savedShipmentRecordId) {
          const usedSavedLineItemKeys = new Set();
          const uploadResults = await Promise.allSettled(
            labelFileInputs.map(async ({ file, item, index }) => {
              const match = findSavedLineItemForUpload(item, index, savedLineItems, usedSavedLineItemKeys);
              const savedLineItem = match.lineItem;
              const sku = getItemSku(item) || item.sku || getItemSku(savedLineItem) || '';
              const fnsku = getItemFnsku(item) || item.fnskuLabel || getItemFnsku(savedLineItem) || '';
              const productName = getItemProductName(item) || item.productName || getItemProductName(savedLineItem) || '';
              const failedSku = sku || fnsku || productName || `line ${index + 1}`;
              const lineItemId = getItemEntityId(savedLineItem);

              if (!lineItemId) {
                const uploadError = new Error(`Could not match FNSKU label to product ${failedSku}. Please upload it from shipment details.`);
                uploadError.sku = failedSku;
                uploadError.unmatched = true;
                throw uploadError;
              }

              const uploadFile = await prepareFileForUpload(file, 'FNSKU label');
              const formData = new FormData();
              formData.append('file', uploadFile, uploadFile.name);
              formData.append('entityType', 'item');
              formData.append('entityId', lineItemId);
              formData.append('fileType', 'fnsku_label');
              formData.append('sku', sku);
              formData.append('fnsku', fnsku);
              formData.append('productName', productName);
              formData.append('product_name', productName);
              formData.append('itemIndex', String(index));
              formData.append('item_index', String(index));
              formData.append('lineItemIndex', String(index));
              formData.append('line_item_index', String(index));
              appendFormValue(formData, 'lineItemId', lineItemId);
              appendFormValue(formData, 'line_item_id', lineItemId);
              appendFormValue(formData, 'shipmentLineItemId', lineItemId);
              appendFormValue(formData, 'shipment_line_item_id', lineItemId);
              appendFormValue(formData, 'shipmentItemId', lineItemId);
              appendFormValue(formData, 'shipment_item_id', lineItemId);
              const metadata = {
                itemIndex: index,
                item_index: index,
                lineItemIndex: index,
                line_item_index: index,
                lineItemId: lineItemId,
                line_item_id: lineItemId,
                shipmentLineItemId: lineItemId,
                shipment_line_item_id: lineItemId,
                shipmentItemId: lineItemId,
                shipment_item_id: lineItemId,
                sku,
                fnsku,
                productName,
                product_name: productName,
              };
              formData.append('metadata', JSON.stringify(metadata));
              formData.append('meta', JSON.stringify(metadata));

              const uploadResponse = await fetch(`${API_BASE_URL}/api/files`, {
                method: 'POST',
                headers: buildHeaders(),
                body: formData,
              });
              let uploadPayload;
              try {
                uploadPayload = await parseResponse(uploadResponse);
              } catch (uploadError) {
                uploadError.sku = failedSku;
                throw uploadError;
              }
              const uploadedFiles = extractFiles(uploadPayload).map((uploadedFile) =>
                decorateShipmentLabelFile(uploadedFile, {
                  sourceFile: uploadFile,
                  entityType: 'item',
                  entityId: lineItemId,
                  item,
                  index,
                })
              );

              return uploadedFiles;
            })
          );

          const backendFiles = uploadResults.flatMap((result) => (result.status === 'fulfilled' ? result.value : []));
          const failedResults = uploadResults.filter((result) => result.status === 'rejected');
          const unmatchedMessages = failedResults
            .filter((result) => result.reason?.unmatched)
            .map((result) => result.reason.message)
            .filter(Boolean);
          const failedUploadSkus = [
            ...new Set(
              failedResults
                .filter((result) => !result.reason?.unmatched)
                .map((result) => result.reason?.sku)
                .filter(Boolean)
            ),
          ];
          uploadedLabelCount = uploadResults.filter((result) => result.status === 'fulfilled').length;
          uploadedLabelFiles = mergeFileLists(backendFiles);

          if (unmatchedMessages.length) {
            labelUploadWarnings.push(...unmatchedMessages);
          }

          if (failedUploadSkus.length) {
            labelUploadWarnings.push(`FNSKU label upload failed for SKU(s): ${failedUploadSkus.join(', ')}.`);
          } else if (failedResults.length && !unmatchedMessages.length) {
            labelUploadWarnings.push(`${failedResults.length} label file(s) could not upload to server.`);
          }

          try {
            const refreshed = await reloadSavedShipmentLabelFiles(savedShipmentRecordId, savedLineItems);
            uploadedLabelFiles = mergeFileLists(uploadedLabelFiles, refreshed.itemFiles);
          } catch (refreshError) {
            labelUploadWarnings.push(refreshError.message || 'Shipment detail refresh failed after label upload.');
          }
        } else {
          labelUploadWarnings.push('Label file upload skipped because shipment database ID was not returned.');
        }

        if (uploadedLabelFiles.length) {
          rememberUploadedFiles(
            uploadedLabelFiles,
            savedShipmentForList,
            savedShipment,
            savedShipmentRecordId,
            savedShipmentForList.id,
            savedShipmentForList.reference
          );
        }
      }

      const savedShipmentWithFiles = uploadedLabelFiles.length
        ? {
            ...savedShipmentForList,
            files: uploadedLabelFiles,
            attachments: uploadedLabelFiles,
          }
        : savedShipmentForList;
      const uploadedDraftFileByItemId = new Map(
        uploadedLabelFiles
          .map((file) => [String(file?.metadata?.draftItemId || '').trim(), file])
          .filter(([draftItemId]) => draftItemId)
      );
      const productItemsForSnapshot = productItemsWithDraftIds.map((item) => {
        const uploadedDraftFile = uploadedDraftFileByItemId.get(String(item.draftItemId || '').trim());
        const uploadedDraftFileId = uploadedDraftFile ? getDraftFileRecordId(uploadedDraftFile) : '';
        const uploadedDraftFileName = uploadedDraftFile?.fileName || uploadedDraftFile?.file_name || '';

        return uploadedDraftFile
          ? {
              ...item,
              file: null,
              fileName: uploadedDraftFileName || item.fileName,
              fnskuLabelFileName: uploadedDraftFileName || item.fnskuLabelFileName,
              fnsku_label_file_name: uploadedDraftFileName || item.fnsku_label_file_name,
              fnskuLabelFileId: uploadedDraftFileId,
              fnsku_label_file_id: uploadedDraftFileId,
              draftFileRecordId: uploadedDraftFileId,
              uploadedDraftFile,
            }
          : item;
      });
      const draftSnapshot = {
        isDraft: Boolean(isDraft),
        status: isDraft ? 'draft' : 'submitted',
        createForm: {
          ...createForm,
          clientId: getClientIdFromSession(),
          expectedArrivalDate: formatDateForInput(createForm.expectedArrivalDate),
        },
        productItems: serializeProductItemsForDraft(productItemsForSnapshot),
      };

      writeCachedDraft(
        [
          editingShipmentId,
          savedShipment,
          savedShipmentForList,
          savedShipmentWithFiles,
          { ...savedShipment, id: editingShipmentId || savedShipment?.id },
          savedShipmentForList.id,
          savedShipmentForList.reference,
        ],
        draftSnapshot
      );

      const successMessage = [
        isDraft ? 'Draft saved' : 'Shipment submitted successfully.',
        uploadedLabelCount ? `${uploadedLabelCount} label file(s) attached.` : '',
        ...labelUploadWarnings,
      ]
        .filter(Boolean)
        .join(' ');
      setMessage(successMessage);
      showToast('success', successMessage);
      setCreateForm({
        ...initialCreateForm,
        clientId: getClientIdFromSession(),
      });
      setProductItems([createEmptyProductItem()]);
      setEditingShipmentId('');
      setStatusFilter('all');
      setSearchQuery('');
      setDateFilter('');
      setCurrentPage(1);
      setShipments((currentShipments) =>
        sortShipmentsForList(mergeShipmentLists([savedShipmentWithFiles], currentShipments))
      );
      await loadShipments(savedShipmentWithFiles);
      navigate('/shipments', { replace: true });
    } catch (requestError) {
      const errorMessage = requestError.message || 'Request failed.';
      setError(errorMessage);
      showToast('error', errorMessage);
    } finally {
      setSavingAction('');
    }
  };

  const loadShipmentDetails = async (shipmentId, fallbackShipment = null, { isCurrentRequest = () => true } = {}) => {
    const resolvedShipmentId = String(shipmentId || getShipmentId(fallbackShipment) || '').trim();

    if (!resolvedShipmentId) {
      throw new Error('Shipment id is missing for this row.');
    }

    const encodedShipmentId = encodeURIComponent(resolvedShipmentId);
    const initialFilesEndpoint = isUuidValue(resolvedShipmentId)
      ? `${API_BASE_URL}/api/files?entityType=shipment&entityId=${encodedShipmentId}`
      : '';
    const initialFilesRequest = initialFilesEndpoint
      ? fetch(initialFilesEndpoint, {
          method: 'GET',
          headers: buildHeaders(),
          cache: 'no-store',
        })
      : Promise.resolve(null);
    const shipmentDetailEndpoint = `${API_BASE_URL}/api/shipments/${encodedShipmentId}`;
    const [shipmentResponse, boxesResponse, subShipmentsResponse, servicesResponse, discrepanciesResponse, filesResponse] = await Promise.allSettled([
      fetch(shipmentDetailEndpoint, {
        method: 'GET',
        headers: buildHeaders(),
        cache: 'no-store',
      }),
      fetchShipmentBoxesAllPages(resolvedShipmentId),
      fetchSubShipmentsForShipmentCandidates([resolvedShipmentId, getShipmentRecordId(fallbackShipment)].filter(Boolean)),
      fetch(`${API_BASE_URL}/api/shipments/${encodedShipmentId}/services`, {
        method: 'GET',
        headers: buildHeaders(),
        cache: 'no-store',
      }),
      fetch(`${API_BASE_URL}/api/shipments/${encodedShipmentId}/discrepancies`, {
        method: 'GET',
        headers: buildHeaders(),
        cache: 'no-store',
      }),
      initialFilesRequest,
    ]);

    if (!isCurrentRequest()) return;

    if (shipmentResponse.status !== 'fulfilled') {
      throw new Error('Failed to load shipment details.');
    }

    const payload = await parseResponse(shipmentResponse.value);
    if (!isCurrentRequest()) return;
    const rawDetail = extractShipmentDetail(payload);
    const detail = rawDetail && typeof rawDetail === 'object' ? rawDetail : {};
    const selectedFallback = buildSelectedShipmentFallback(fallbackShipment || {}, resolvedShipmentId);
    const detailReference =
      detail?.reference ||
      detail?.shipmentNumber ||
      detail?.shipment_number ||
      detail?.id ||
      detail?.uuid;

    const detailRecordId =
      getShipmentRecordId(detail) ||
      getShipmentRecordId(selectedFallback) ||
      (isUuidValue(resolvedShipmentId) ? resolvedShipmentId : '');
    const cachedDraft = getCachedDraft(selectedFallback, detail, resolvedShipmentId);
    const cachedItems = cachedDraft?.productItems || [];
    const payloadItems = getLineItems(payload);
    const detailItems = getLineItems(detail);
    const fallbackItems = getLineItems(selectedFallback);
    const notesForBundleSizes = {
      ...selectedFallback,
      ...detail,
      notes: detail?.notes || detail?.client_notes || selectedFallback.notes || selectedFallback.client_notes || '',
      client_notes: detail?.client_notes || detail?.notes || selectedFallback.client_notes || selectedFallback.notes || '',
    };
    const selectedItems = applyBundleSizesFromNotes(
      cachedItems.length
        ? mergeLineItemGroups(cachedItems, detailItems, payloadItems, fallbackItems)
        : mergeLineItemGroups(detailItems, payloadItems, fallbackItems),
      notesForBundleSizes
    );
    console.log('[PickPackPro][Client View GET]', {
      endpoint: shipmentDetailEndpoint,
      status: shipmentResponse.value.status,
      shipmentId: resolvedShipmentId,
      payload,
      detail,
      itemOrder: selectedItems.map((item, index) => ({
        index,
        product: getItemProductName(item),
        sku: getItemSku(item),
        fnsku: getItemFnsku(item),
        explicitOrder: getLineItemExplicitOrder(item),
        naturalOrder: getLineItemNaturalOrder(item),
      })),
      items: selectedItems,
    });
    const cachedNotes = cachedDraft?.createForm ? buildShipmentNotes(cachedDraft.createForm, cachedItems) : '';
    const cachedExpectedArrivalDate = cachedDraft?.createForm?.expectedArrivalDate || '';
    let loadedSubShipments = subShipmentsResponse.status === 'fulfilled' ? subShipmentsResponse.value : [];
    if (!loadedSubShipments.length) {
      loadedSubShipments = extractSubShipments(detail).map((subShipment) => {
        const boxes = getSubShipmentBoxes(subShipment).map((box) => decorateSubShipmentBoxForClient(box, subShipment));
        return {
          ...subShipment,
          boxes,
          outbound_boxes: boxes,
          shipmentBoxes: boxes,
          shipment_boxes: boxes,
        };
      });
    }
    if (!loadedSubShipments.length && detailRecordId && detailRecordId !== resolvedShipmentId) {
      loadedSubShipments = await fetchSubShipmentsForShipmentCandidates([detailRecordId]);
      if (!isCurrentRequest()) return;
    }

    setSelectedShipment({
      ...selectedFallback,
      ...detail,
      id: detailRecordId || getShipmentId(detail) || selectedFallback.id || resolvedShipmentId,
      reference: detailReference || selectedFallback.reference || resolvedShipmentId,
      notes: cachedNotes || detail?.notes || detail?.client_notes || selectedFallback.notes || selectedFallback.client_notes || '',
      client_notes: cachedNotes || detail?.client_notes || detail?.notes || selectedFallback.client_notes || selectedFallback.notes || '',
      expectedArrivalDate: formatDateForInput(cachedExpectedArrivalDate || detail?.expectedArrivalDate || detail?.expected_arrival_date || selectedFallback.expectedArrivalDate),
      expected_arrival_date: formatDateForInput(cachedExpectedArrivalDate || detail?.expected_arrival_date || detail?.expectedArrivalDate || selectedFallback.expected_arrival_date),
      items: selectedItems,
      lineItems: selectedItems,
      subShipments: loadedSubShipments,
      sub_shipments: loadedSubShipments,
    });

    let loadedBoxes = [];
    let loadedServiceTasks = [];

    if (boxesResponse.status === 'fulfilled') {
      const parentBoxes = extractList(boxesResponse.value, ['boxes']);
      const subShipmentBoxes = loadedSubShipments.flatMap((subShipment) => getSubShipmentBoxes(subShipment));
      loadedBoxes = await enrichBoxesWithItems(mergeBoxPages(parentBoxes, subShipmentBoxes), selectedItems);
      if (!isCurrentRequest()) return;
      setSelectedShipmentBoxes(loadedBoxes);
      setSelectedShipmentSubShipments(loadedSubShipments);
    } else {
      const subShipmentBoxes = loadedSubShipments.flatMap((subShipment) => getSubShipmentBoxes(subShipment));
      loadedBoxes = await enrichBoxesWithItems(subShipmentBoxes, selectedItems);
      if (!isCurrentRequest()) return;
      setSelectedShipmentBoxes(loadedBoxes);
      setSelectedShipmentSubShipments(loadedSubShipments);
    }

    if (servicesResponse.status === 'fulfilled') {
      try {
        const servicesPayload = await parseResponse(servicesResponse.value);
        if (!isCurrentRequest()) return;
        loadedServiceTasks = extractServiceTasks(servicesPayload);
        setSelectedShipmentServices(loadedServiceTasks);
      } catch {
        setSelectedShipmentServices([]);
      }
    } else {
      setSelectedShipmentServices([]);
    }

    if (discrepanciesResponse.status === 'fulfilled') {
      try {
        const discrepanciesPayload = await parseResponse(discrepanciesResponse.value);
        if (!isCurrentRequest()) return;
        setSelectedShipmentDiscrepancies(extractList(discrepanciesPayload, ['discrepancies']));
      } catch {
        setSelectedShipmentDiscrepancies([]);
      }
    } else {
      setSelectedShipmentDiscrepancies([]);
    }

    const loadedFiles = [];

    if (filesResponse.status === 'fulfilled' && filesResponse.value) {
      try {
        const filesPayload = await parseResponse(filesResponse.value);
        if (!isCurrentRequest()) return;
        const files = extractFiles(filesPayload);
        console.log('[PickPackPro][Client Files GET]', {
          endpoint: initialFilesEndpoint,
          status: filesResponse.value.status,
          context: { entityType: 'shipment', entityId: resolvedShipmentId, source: 'initial-shipment-files' },
          payload: filesPayload,
          files,
        });
        loadedFiles.push(...files);
      } catch {
        // Other identifiers below may still return files.
      }
    }

    const fileLookupIds = [
      detailRecordId,
      getShipmentRecordId(detail),
      getShipmentId(detail),
      detailReference,
      getShipmentRecordId(selectedFallback),
      getShipmentId(selectedFallback),
      selectedFallback.reference,
      resolvedShipmentId,
    ]
      .filter(Boolean)
      .map((value) => String(value).trim())
      .filter(Boolean);
    const uniqueFileLookupIds = [...new Set(fileLookupIds)];
    const shipmentFileLookupIds = uniqueFileLookupIds.filter(isUuidValue);
    const lineItemFileLookupIds = [
      ...new Set(
        selectedItems
          .map((item) => String(getItemEntityId(item) || '').trim())
          .filter(Boolean)
      ),
    ];
    const boxFileLookupIds = [
      ...new Set(
        loadedBoxes
          .flatMap((box) => getBoxLookupIds(box))
          .map((boxId) => String(boxId || '').trim())
          .filter(Boolean)
      ),
    ];
    const serviceFileLookupIds = [
      ...new Set(
        loadedServiceTasks
          .map((service) => String(getServiceTaskId(service) || '').trim())
          .filter(isUuidValue)
          .filter(Boolean)
      ),
    ];
    const extraFileLookups = [
      ...shipmentFileLookupIds.map((entityId) => ({ entityType: 'shipment', entityId })),
      ...lineItemFileLookupIds.flatMap((entityId) =>
        ITEM_FILE_LOOKUP_ENTITY_TYPES.map((entityType) => ({ entityType, entityId }))
      ),
      ...boxFileLookupIds.map((entityId) => ({ entityType: 'box', entityId })),
      ...serviceFileLookupIds.map((entityId) => ({ entityType: 'service', entityId })),
    ].filter(
      ({ entityType, entityId }, index, lookups) =>
        lookups.findIndex((lookup) => lookup.entityType === entityType && lookup.entityId === entityId) === index
    );

    if (extraFileLookups.length) {
      const extraFileResponses = await Promise.allSettled(
        extraFileLookups.map(async ({ entityType, entityId }) => {
          const endpoint = `${API_BASE_URL}/api/files?entityType=${encodeURIComponent(entityType)}&entityId=${encodeURIComponent(entityId)}`;
          const response = await fetch(endpoint, {
            method: 'GET',
            headers: buildHeaders(),
            cache: 'no-store',
          });
          const payload = await parseResponse(response);
          const files = extractFiles(payload);
          console.log('[PickPackPro][Client Files GET]', {
            endpoint,
            status: response.status,
            context: { entityType, entityId, source: 'detail-extra-files' },
            payload,
            files,
          });
          return files;
        })
      );

      if (!isCurrentRequest()) return;

      extraFileResponses.forEach((response) => {
        if (response.status === 'fulfilled') loadedFiles.push(...response.value);
      });
    }

    const boxLabelFileLookups = loadedBoxes
      .map((box) => ({
        fileId: String(getBoxFbaLabelFileId(box) || '').trim(),
        boxId: getBoxLookupIds(box).find(Boolean),
      }))
      .filter(({ fileId }) => fileId);

    if (boxLabelFileLookups.length) {
      const boxLabelFileResponses = await Promise.allSettled(
        boxLabelFileLookups.map(async ({ fileId, boxId }) => {
          const files = await fetchFileById(fileId, { source: 'box-label-file-id', entityType: 'box', entityId: boxId });
          return files.map((file) => ({
            ...file,
            id: getFileRecordId(file) || fileId,
            fileId: file?.fileId || fileId,
            file_id: file?.file_id || fileId,
            entityType: file?.entityType || 'box',
            entity_type: file?.entity_type || getFileEntityType(file) || 'box',
            entityId: file?.entityId || getFileEntityId(file) || boxId,
            entity_id: file?.entity_id || getFileEntityId(file) || boxId,
            boxId: file?.boxId || boxId,
            box_id: file?.box_id || boxId,
            fileType: file?.fileType || file?.file_type || 'fba_shipping_label',
            file_type: file?.file_type || file?.fileType || 'fba_shipping_label',
          }));
        })
      );

      if (!isCurrentRequest()) return;

      boxLabelFileResponses.forEach((response) => {
        if (response.status === 'fulfilled') loadedFiles.push(...response.value);
      });
    }

    const itemLabelFileLookups = selectedItems
      .map((item) => ({
        fileId: String(getItemLabelFileId(item) || '').trim(),
        item,
      }))
      .filter(({ fileId }) => fileId);

    if (itemLabelFileLookups.length) {
      const itemLabelFileResponses = await Promise.allSettled(
        itemLabelFileLookups.map(async ({ fileId, item }) => {
          const itemId = getItemEntityId(item) || getItemRecordId(item);
          const files = await fetchFileById(fileId, {
            source: 'item-label-file-id',
            entityType: 'item',
            entityId: itemId,
            sku: getItemSku(item),
            fnsku: getItemFnsku(item),
          });
          return files.map((file) =>
            decorateItemLabelFile(
              {
                ...file,
                id: getFileRecordId(file) || fileId,
                fileId: file?.fileId || fileId,
                file_id: file?.file_id || fileId,
                entityType: file?.entityType || 'item',
                entity_type: file?.entity_type || getFileEntityType(file) || 'item',
                entityId: file?.entityId || getFileEntityId(file) || itemId,
                entity_id: file?.entity_id || getFileEntityId(file) || itemId,
                fileType: file?.fileType || file?.file_type || 'fnsku_label',
                file_type: file?.file_type || file?.fileType || 'fnsku_label',
              },
              item
            )
          );
        })
      );

      if (!isCurrentRequest()) return;

      itemLabelFileResponses.forEach((response) => {
        if (response.status === 'fulfilled') loadedFiles.push(...response.value);
      });
    }

    const cachedUploadedFiles = getCachedUploadedFiles(
      detail,
      selectedFallback,
      resolvedShipmentId,
      detailRecordId,
      detailReference
    );
    const inlineItemLabelFiles = selectedItems.flatMap((item) => getItemInlineLabelFiles(item));
    const selectedFiles = mergeFileLists(loadedFiles, cachedUploadedFiles, inlineItemLabelFiles);
    const labelAssignments = getItemLabelFileAssignments(selectedItems, selectedFiles);
    console.log('[PickPackPro][Client FNSKU Label Sync]', {
      shipmentId: resolvedShipmentId,
      items: selectedItems.map((item, index) => ({
        index,
        id: getItemRecordId(item),
        sku: getItemSku(item),
        fnsku: getItemFnsku(item),
        matchedFile: labelAssignments[index]
          ? {
              name: getFileName(labelAssignments[index]),
              type: getFileTypeValue(labelAssignments[index]),
              entityType: getFileEntityType(labelAssignments[index]),
              entityId: getFileEntityId(labelAssignments[index]),
              sku: getFileSku(labelAssignments[index]),
              fnsku: getFileFnsku(labelAssignments[index]),
              url: getFileUrl(labelAssignments[index]),
            }
          : null,
      })),
      files: selectedFiles.map((file, index) => ({
        index,
        name: getFileName(file),
        type: getFileTypeValue(file),
        entityType: getFileEntityType(file),
        entityId: getFileEntityId(file),
        sku: getFileSku(file),
        fnsku: getFileFnsku(file),
        url: getFileUrl(file),
      })),
    });
    if (!isCurrentRequest()) return;
    setSelectedShipmentFiles(selectedFiles);
    if (loadedFiles.length) {
      rememberUploadedFiles(loadedFiles, detail, selectedFallback, resolvedShipmentId, detailRecordId, detailReference);
    }

  };

  const handleViewShipment = async (shipment) => {
    const requestId = viewLoadRequestRef.current + 1;
    viewLoadRequestRef.current = requestId;
    const isCurrentRequest = () => viewLoadRequestRef.current === requestId;
    const fallbackShipment = typeof shipment === 'object'
      ? buildSelectedShipmentFallback(shipment)
      : buildSelectedShipmentFallback({ id: shipment }, shipment);
    const shipmentId = getShipmentId(fallbackShipment);
    const previewShipment = buildShipmentPreview(fallbackShipment, shipmentId);

    try {
      setError('');
      setSelectedShipment(previewShipment);
      setSelectedShipmentBoxes([]);
      setSelectedShipmentSubShipments([]);
      setSelectedShipmentServices([]);
      setSelectedShipmentDiscrepancies([]);
      setSelectedShipmentFiles([]);
      setLoadingShipmentFiles(true);
      setShowViewModal(true);
      setShowTrackModal(false);
      await loadShipmentDetails(shipmentId, fallbackShipment, { isCurrentRequest });
    } catch (requestError) {
      if (isCurrentRequest()) {
        setSelectedShipment(previewShipment);
        setShowViewModal(true);
        setShowTrackModal(false);
        setError(`${requestError.message || 'Failed to load shipment details.'} Showing available shipment data.`);
      }
    } finally {
      if (isCurrentRequest()) setLoadingShipmentFiles(false);
    }
  };

  const handleRefreshSelectedShipment = async () => {
    if (!selectedShipment) return;

    const shipmentId =
      getShipmentRecordId(selectedShipment) ||
      getShipmentId(selectedShipment) ||
      selectedShipment.reference ||
      '';

    if (!shipmentId) {
      setError('Shipment id is missing for refresh.');
      return;
    }

    try {
      setIsRefreshingDetails(true);
      setLoadingShipmentFiles(true);
      setError('');
      await loadShipmentDetails(shipmentId, selectedShipment);
      await loadShipments();
      showToast('success', 'Shipment details refreshed.');
    } catch (requestError) {
      setError(`${requestError.message || 'Failed to refresh shipment.'} Showing available shipment data.`);
    } finally {
      setIsRefreshingDetails(false);
      setLoadingShipmentFiles(false);
    }
  };

  const handleEditDraft = async (shipment) => {
    if (!canEditDraftShipment(shipment)) return;

    try {
      setIsLoading(true);
      setError('');
      setMessage('');
      const fallbackShipment = typeof shipment === 'object'
        ? buildSelectedShipmentFallback(shipment)
        : {};
      const shipmentId = getShipmentId(fallbackShipment) || shipment;
      const cachedBeforeFetch = getCachedDraft(fallbackShipment, shipmentId);

      let detail = {};
      try {
        detail = extractShipmentDetail(
          await parseResponse(
            await fetch(`${API_BASE_URL}/api/shipments/${encodeURIComponent(shipmentId)}`, {
              method: 'GET',
              headers: buildHeaders(),
              cache: 'no-store',
            })
          )
        );
      } catch (requestError) {
        if (!cachedBeforeFetch) throw requestError;
      }

      const serverDraftPayload = getShipmentDraftPayload(detail);
      const serverDraftItems = getShipmentDraftItems(detail);
      const serverDraftFiles = getShipmentDraftFiles(detail);
      const serverDraftFormItems = mapDraftPayloadItemsToFormItems(serverDraftItems, serverDraftFiles);
      const detailItems = getLineItems(detail);
      const fallbackItems = getLineItems(fallbackShipment);
      const mergedDraftItems = mergeLineItemGroups(detailItems, fallbackItems, cachedBeforeFetch?.productItems || []);
      const draft = buildSelectedShipmentFallback(
        {
          ...fallbackShipment,
          ...detail,
          items: mergedDraftItems,
          lineItems: mergedDraftItems,
        },
        shipmentId
      );
      const cachedDraft = getCachedDraft(fallbackShipment, detail, draft, shipmentId) || cachedBeforeFetch;
      const notes = firstPresent(serverDraftPayload?.notes, draft?.notes, draft?.client_notes);
      const expectedArrivalDate =
        serverDraftPayload?.expectedArrivalDate ||
        serverDraftPayload?.expected_arrival_date ||
        draft?.expectedArrivalDate ||
        draft?.expected_arrival_date ||
        fallbackShipment?.expectedArrivalDate ||
        fallbackShipment?.expected_arrival_date ||
        fallbackShipment?.expected ||
        '';
      const cachedForm = cachedDraft?.createForm;
      const boxCountValue =
        (cachedForm?.boxCount ?? (getNoteValue(notes, 'Boxes:') || getNoteValue(notes, 'Boxes/Pallets:'))) ||
        String(draft?.boxCount || draft?.box_count || '0');
      const palletCountValue =
        (cachedForm?.palletCount ?? getNoteValue(notes, 'Pallets:')) ||
        String(draft?.palletCount || draft?.pallet_count || '0');

      setCreateForm({
        clientId: getClientIdFromSession(),
        trackingNumber: cachedForm?.trackingNumber ?? getNoteValue(notes, 'Tracking:'),
        boxCount: boxCountValue,
        palletCount: palletCountValue,
        notes: cachedForm?.notes ?? stripNoteLine(stripNoteLine(stripNoteLine(stripNoteLine(stripNoteLine(stripNoteLine(notes, 'QC inspection requested'), BUNDLE_SIZE_NOTE_PREFIX), 'Tracking:'), 'Boxes:'), 'Pallets:'), 'Boxes/Pallets:'),
        expectedArrivalDate: formatDateForInput(cachedForm?.expectedArrivalDate || expectedArrivalDate),
      });
      setProductItems(
        serverDraftFormItems.length
          ? serverDraftFormItems
          : cachedDraft?.productItems?.length
            ? ensureDraftItemIds(cachedDraft.productItems)
            : mapShipmentItemsToProductItems(getLineItems(draft))
      );
      setEditingShipmentId(getShipmentRecordId(draft) || getShipmentId(draft) || shipmentId);
      setShowViewModal(false);
      setShowTrackModal(false);
      showToast('success', 'Draft loaded for editing.');
      navigate('/shipments?mode=create');
    } catch (requestError) {
      const errorMessage = requestError.message || 'Failed to load draft for editing.';
      setError(errorMessage);
      showToast('error', errorMessage);
    } finally {
      setIsLoading(false);
    }
  };

  const requestDeleteShipment = (shipment) => {
    const shipmentId = getShipmentRecordId(shipment) || getShipmentId(shipment);

    if (!shipmentId) {
      const errorMessage = 'Shipment id is missing.';
      setError(errorMessage);
      showToast('error', errorMessage);
      return;
    }

    setDeleteConfirmShipment(shipment);
  };

  const handleDeleteShipment = async (shipment) => {
    const shipmentId = getShipmentRecordId(shipment) || getShipmentId(shipment);

    if (!shipmentId) {
      const errorMessage = 'Shipment id is missing.';
      setError(errorMessage);
      showToast('error', errorMessage);
      return;
    }

    try {
      setDeletingShipmentId(shipmentId);
      setError('');
      setMessage('');
      const response = await fetch(`${API_BASE_URL}/api/shipments/${encodeURIComponent(shipmentId)}`, {
        method: 'DELETE',
        headers: buildHeaders(),
      });
      await parseResponse(response);

      const deletedKeys = new Set(getDraftCacheKeys(shipment, { id: shipmentId, reference: shipment?.reference }));
      setShipments((currentShipments) =>
        currentShipments.filter((currentShipment) => {
          const currentKeys = getDraftCacheKeys(currentShipment);
          return !currentKeys.some((key) => deletedKeys.has(key));
        })
      );
      if (selectedShipment && getDraftCacheKeys(selectedShipment).some((key) => deletedKeys.has(key))) {
        setSelectedShipment(null);
        setShowViewModal(false);
        setShowTrackModal(false);
      }

      showToast('success', 'Shipment deleted.');
      setDeleteConfirmShipment(null);
      await loadShipments();
    } catch (requestError) {
      const errorMessage = requestError.message || 'Failed to delete shipment.';
      setError(errorMessage);
      showToast('error', errorMessage);
    } finally {
      setDeletingShipmentId('');
    }
  };

  const handleTrackShipment = async (shipment) => {
    const fallbackShipment = typeof shipment === 'object'
      ? buildSelectedShipmentFallback(shipment)
      : buildSelectedShipmentFallback({ id: shipment }, shipment);
    const shipmentId = getShipmentId(fallbackShipment);
    try {
      setError('');
      setSelectedShipment(fallbackShipment);
      setSelectedShipmentBoxes([]);
      setSelectedShipmentSubShipments([]);
      setSelectedShipmentServices([]);
      setSelectedShipmentDiscrepancies([]);
      setSelectedShipmentFiles([]);
      setShowTrackModal(true);
      setShowViewModal(false);
      await loadShipmentDetails(shipmentId, fallbackShipment);
    } catch (requestError) {
      setError(`${requestError.message} Showing available tracking data.`);
    }
  };

  const handleUploadBoxLabel = async (box, index, file, shipmentOverride = selectedShipment) => {
    if (!file) return;

    const shipmentContext = shipmentOverride || selectedShipment || {};
    const shipmentId = getShipmentRecordId(shipmentContext) || (isUuidValue(getShipmentId(shipmentContext)) ? getShipmentId(shipmentContext) : '');
    const boxId = getBoxItemsLookupId(box);
    const entityType = getBoxType(box) === 'pallet' ? 'pallet' : 'box';
    const entityId = boxId;
    const uploadFileType = 'fba_shipping_label';
    const uploadKey = `${entityType}-${entityId || index}`;

    if (!entityId) {
      setError('Box record is required before uploading an FBA label.');
      return;
    }

    try {
      setError('');
      setMessage('');
      setUploadingBoxKey(uploadKey);

      const uploadFile = await prepareFileForUpload(file, 'FBA label');
      const boxNumber = firstPresent(box?.box_number, box?.boxNumber, index + 1);
      const uploadFileName = sanitizeFileName(`fba-label-box-${boxNumber}-${boxId}-${uploadFile.name}`);
      const clientId = getClientIdFromSession();
      const shipmentReference = getShipmentReference(shipmentContext);
      const metadata = {
        clientId,
        client_id: clientId,
        shipmentId,
        shipment_id: shipmentId,
        shipmentReference,
        shipment_reference: shipmentReference,
        boxId,
        box_id: boxId,
        boxNumber,
        box_number: boxNumber,
      };
      const formData = new FormData();
      formData.append('file', uploadFile, uploadFileName);
      formData.append('entityType', entityType);
      formData.append('entityId', entityId);
      formData.append('fileType', uploadFileType);
      formData.append('metadata', JSON.stringify(metadata));
      formData.append('meta', JSON.stringify(metadata));
      appendFormValue(formData, 'clientId', clientId);
      appendFormValue(formData, 'client_id', clientId);
      appendFormValue(formData, 'shipmentId', shipmentId);
      appendFormValue(formData, 'shipment_id', shipmentId);
      appendFormValue(formData, 'shipmentReference', shipmentReference);
      appendFormValue(formData, 'shipment_reference', shipmentReference);
      appendFormValue(formData, 'boxId', boxId);
      appendFormValue(formData, 'box_id', boxId);
      appendFormValue(formData, 'boxNumber', boxNumber);
      appendFormValue(formData, 'box_number', boxNumber);
      const uploadHeaders = buildHeaders();
      if (clientId) uploadHeaders['X-Client-Id'] = clientId;
      if (shipmentId) uploadHeaders['X-Shipment-Id'] = shipmentId;
      if (boxId) uploadHeaders['X-Box-Id'] = boxId;

      const response = await fetch(`${API_BASE_URL}/api/files`, {
        method: 'POST',
        headers: uploadHeaders,
        body: formData,
        skipApiToast: true,
      });
      const payload = await parseResponse(response);
      const uploadedFile =
        payload?.file ||
        payload?.data?.file ||
        payload?.data ||
        (payload && typeof payload === 'object' ? payload : null) ||
        {};

      if (shipmentId) {
        await loadShipmentDetails(shipmentId, shipmentContext);
      }

      setSelectedShipmentBoxes((current) =>
        extractList(current, ['boxes']).map((currentBox, currentIndex) => {
          const currentBoxId = getBoxItemsLookupId(currentBox);
          const sameBox = boxId ? currentBoxId === boxId : currentIndex === index;
          return sameBox
            ? {
                ...currentBox,
                labelReady: true,
                label_ready: true,
                fbaLabelUploaded: true,
                fba_label_uploaded: true,
                labelUploaded: true,
                label_uploaded: true,
                label_uploaded_at: new Date().toISOString(),
                fba_shipping_label_file_id: uploadedFile?.id || uploadedFile?.uuid || uploadedFile?.fileId || uploadedFile?.file_id || currentBox?.fba_shipping_label_file_id,
                status: 'UPLOADED',
              }
            : currentBox;
        })
      );

      setSelectedShipmentFiles((current) =>
        mergeFileLists(extractList(current, ['files']), [
          {
            ...uploadedFile,
            entityType,
            entity_type: entityType,
            entityId,
            entity_id: entityId,
            fileType: uploadedFile?.fileType || uploadedFile?.file_type || uploadFileType,
            file_type: uploadedFile?.file_type || uploadedFile?.fileType || uploadFileType,
            name: uploadedFile?.name || uploadedFile?.fileName || uploadFileName,
            fileName: uploadedFile?.fileName || uploadedFile?.name || uploadFileName,
            original_filename: uploadedFile?.original_filename || uploadFileName,
          },
        ])
      );

      const successMessage = `FBA label uploaded for ${getBoxTitle(box, index)}.${uploadFile !== file ? ' Large image was optimized before upload.' : ''}`;
      setMessage(successMessage);
      showToast('success', successMessage);
    } catch (requestError) {
      const errorMessage = isPayloadTooLargeMessage(requestError.message) ? getUploadTooLargeMessage(file.name) : requestError.message;
      setError(errorMessage);
      showToast('error', errorMessage);
    } finally {
      setUploadingBoxKey('');
    }
  };

  const handleUploadFbaLabelInSection = async (shipment, box, index, file) => {
    if (!file) return;

    const boxId = getBoxItemsLookupId(box);
    if (!boxId) {
      setError('Box ID missing');
      return;
    }

    if (getBoxType(box) === 'pallet') {
      await handleUploadSingleFbaLabelInSection(shipment, box, index, file);
      return;
    }

    setError('');
    setMessage('');
    setBatchFbaUpload({
      shipment,
      box,
      boxIndex: index,
      file,
      selectedBoxIds: [boxId],
    });
  };

  const handleToggleBatchFbaBox = (boxId) => {
    setBatchFbaUpload((current) => {
      if (!current) return current;
      const selected = new Set(current.selectedBoxIds || []);
      if (selected.has(boxId)) {
        selected.delete(boxId);
      } else {
        selected.add(boxId);
      }
      return { ...current, selectedBoxIds: [...selected] };
    });
  };

  const handleSetAllBatchFbaBoxes = (checked) => {
    setBatchFbaUpload((current) => {
      if (!current) return current;
      return {
        ...current,
        selectedBoxIds: checked ? batchFbaUploadOptions.map((option) => option.boxId) : [],
      };
    });
  };

  const handleConfirmBatchFbaUpload = async () => {
    if (!batchFbaUpload?.file) return;

    const shipment = batchFbaUpload.shipment || {};
    const shipmentId = getShipmentId(shipment);
    const shipmentRecordId = getShipmentRecordId(shipment) || (isUuidValue(shipmentId) ? shipmentId : '');
    const selectedBoxIds = [...new Set(batchFbaUpload.selectedBoxIds || [])].filter(Boolean);

    if (!shipmentRecordId) {
      const errorMessage = 'Shipment record ID missing for FBA label upload.';
      setError(errorMessage);
      showToast('error', errorMessage);
      return;
    }
    if (!selectedBoxIds.length) {
      const errorMessage = 'Select at least one box for this FBA label.';
      setError(errorMessage);
      showToast('error', errorMessage);
      return;
    }

    try {
      setError('');
      setMessage('');
      setUploadingFbaBoxKey(`batch-${shipmentId}`);

      const uploadFile = await prepareFileForUpload(batchFbaUpload.file, 'FBA label');
      const shipmentReference = getShipmentReference(shipment);
      const uploadFileName = sanitizeFileName(`fba-label-${shipmentReference || shipmentRecordId}-${Date.now()}-${uploadFile.name}`);
      const formData = new FormData();
      formData.append('file', uploadFile, uploadFileName);
      formData.append('fileType', 'fba_shipping_label');
      formData.append('shipmentId', shipmentRecordId);
      formData.append('boxIds', JSON.stringify(selectedBoxIds));
      selectedBoxIds.forEach((boxId) => formData.append('boxIds[]', boxId));

      const uploadHeaders = buildHeaders();
      const clientId = getClientIdFromSession();
      if (clientId) uploadHeaders['X-Client-Id'] = clientId;
      if (shipmentRecordId) uploadHeaders['X-Shipment-Id'] = shipmentRecordId;

      const response = await fetch(`${API_BASE_URL}/api/files/fba-labels/apply-to-boxes`, {
        method: 'POST',
        headers: uploadHeaders,
        body: formData,
        skipApiToast: true,
      });
      const payload = await parseResponse(response);
      const responseData = payload?.data || payload || {};
      const uploadedFileId = responseData?.fileId || responseData?.file_id || '';

      setFbaLabelFilesMap((current) => {
        const next = { ...current };
        selectedBoxIds.forEach((boxId) => {
          next[boxId] = {
            id: uploadedFileId,
            fileId: uploadedFileId,
            file_id: uploadedFileId,
            entityType: 'box',
            entity_type: 'box',
            entityId: boxId,
            entity_id: boxId,
            fileType: 'fba_shipping_label',
            file_type: 'fba_shipping_label',
            name: uploadFileName,
            fileName: uploadFileName,
            original_filename: uploadFile.name,
          };
        });
        return next;
      });

      const selectedSet = new Set(selectedBoxIds);
      setFbaLabelBoxesMap((current) => ({
        ...current,
        [shipmentId]: extractList(current[shipmentId], ['boxes']).map((currentBox) => {
          const currentBoxId = getBoxItemsLookupId(currentBox);
          return selectedSet.has(currentBoxId)
            ? {
                ...currentBox,
                fbaLabelUploaded: true,
                fba_label_uploaded: true,
                labelReady: true,
                label_ready: true,
                labelUploaded: true,
                label_uploaded: true,
                label_uploaded_at: new Date().toISOString(),
                fba_shipping_label_file_id: uploadedFileId || currentBox?.fba_shipping_label_file_id,
                status: 'UPLOADED',
              }
            : currentBox;
        }),
      }));

      const successMessage = `FBA label uploaded for ${selectedBoxIds.length} box${selectedBoxIds.length !== 1 ? 'es' : ''}${uploadFile !== batchFbaUpload.file ? '. Large image was optimized before upload.' : ''}`;
      setMessage(successMessage);
      showToast('success', successMessage);
      setBatchFbaUpload(null);
      await loadFbaLabelShipments(shipments);
    } catch (requestError) {
      const errorMessage = isPayloadTooLargeMessage(requestError.message) ? getUploadTooLargeMessage(batchFbaUpload.file.name) : requestError.message;
      setError(errorMessage);
      showToast('error', errorMessage);
    } finally {
      setUploadingFbaBoxKey('');
    }
  };

  const handleUploadSingleFbaLabelInSection = async (shipment, box, index, file) => {
    if (!file) return;

    const boxId = getBoxItemsLookupId(box);
    if (!boxId) {
      setError('Box ID missing');
      return;
    }

    const shipmentId = getShipmentId(shipment);
    const uploadKey = `${shipmentId}-${boxId}`;

    try {
      setError('');
      setUploadingFbaBoxKey(uploadKey);

      const uploadFile = await prepareFileForUpload(file, 'FBA label');
      const boxNumber = firstPresent(box?.box_number, box?.boxNumber, index + 1);
      const uploadFileName = sanitizeFileName(`fba-label-box-${boxNumber}-${boxId}-${uploadFile.name}`);
      const clientId = getClientIdFromSession();
      const shipmentRecordId = getShipmentRecordId(shipment) || (isUuidValue(shipmentId) ? shipmentId : '');
      const shipmentReference = getShipmentReference(shipment);
      const uploadEntityType = getBoxType(box) === 'pallet' ? 'pallet' : 'box';
      const metadata = {
        clientId,
        client_id: clientId,
        shipmentId: shipmentRecordId,
        shipment_id: shipmentRecordId,
        shipmentReference,
        shipment_reference: shipmentReference,
        boxId,
        box_id: boxId,
        boxNumber,
        box_number: boxNumber,
      };
      const formData = new FormData();
      formData.append('file', uploadFile, uploadFileName);
      formData.append('entityType', uploadEntityType);
      formData.append('entityId', boxId);
      formData.append('fileType', 'fba_shipping_label');
      formData.append('metadata', JSON.stringify(metadata));
      formData.append('meta', JSON.stringify(metadata));
      appendFormValue(formData, 'clientId', clientId);
      appendFormValue(formData, 'client_id', clientId);
      appendFormValue(formData, 'shipmentId', shipmentRecordId);
      appendFormValue(formData, 'shipment_id', shipmentRecordId);
      appendFormValue(formData, 'shipmentReference', shipmentReference);
      appendFormValue(formData, 'shipment_reference', shipmentReference);
      appendFormValue(formData, 'boxId', boxId);
      appendFormValue(formData, 'box_id', boxId);
      appendFormValue(formData, 'boxNumber', boxNumber);
      appendFormValue(formData, 'box_number', boxNumber);
      const uploadHeaders = buildHeaders();
      if (clientId) uploadHeaders['X-Client-Id'] = clientId;
      if (shipmentRecordId) uploadHeaders['X-Shipment-Id'] = shipmentRecordId;
      if (boxId) uploadHeaders['X-Box-Id'] = boxId;

      const response = await fetch(`${API_BASE_URL}/api/files`, {
        method: 'POST',
        headers: uploadHeaders,
        body: formData,
        skipApiToast: true,
      });
      const payload = await parseResponse(response);
      const uploadedFile = extractFiles(payload)[0] || payload?.file || payload?.data?.file || payload?.data || {};

      setFbaLabelFilesMap((current) => ({
        ...current,
        [boxId]: {
          ...uploadedFile,
          entityType: uploadEntityType,
          entity_type: uploadEntityType,
          entityId: boxId,
          entity_id: boxId,
          fileType: uploadedFile?.fileType || uploadedFile?.file_type || 'fba_shipping_label',
          file_type: uploadedFile?.file_type || uploadedFile?.fileType || 'fba_shipping_label',
          name: uploadedFile?.name || uploadedFile?.fileName || uploadFileName,
          fileName: uploadedFile?.fileName || uploadedFile?.name || uploadFileName,
          original_filename: uploadedFile?.original_filename || uploadFileName,
        },
      }));

      setFbaLabelBoxesMap((current) => ({
        ...current,
        [shipmentId]: extractList(current[shipmentId], ['boxes']).map((currentBox) =>
          getBoxItemsLookupId(currentBox) === boxId
            ? {
                ...currentBox,
                fbaLabelUploaded: true,
                fba_label_uploaded: true,
                labelReady: true,
                label_ready: true,
                labelUploaded: true,
                label_uploaded: true,
                label_uploaded_at: new Date().toISOString(),
                fba_shipping_label_file_id: uploadedFile?.id || uploadedFile?.uuid || currentBox?.fba_shipping_label_file_id,
                status: 'UPLOADED',
              }
            : currentBox
        ),
      }));

      showToast('success', `FBA label uploaded for Box ${box?.box_number || index + 1}${uploadFile !== file ? '. Large image was optimized before upload.' : ''}`);
      await loadFbaLabelShipments(shipments);
    } catch (requestError) {
      const errorMessage = isPayloadTooLargeMessage(requestError.message) ? getUploadTooLargeMessage(file.name) : requestError.message;
      setError(errorMessage);
      showToast('error', errorMessage);
    } finally {
      setUploadingFbaBoxKey('');
    }
  };

  const handleDownloadDispatchNote = () => {
    const reference = selectedShipment?.reference || selectedShipment?.id || 'shipment';
    const rows = [
      'Dispatch Note',
      `Shipment: ${reference}`,
      `Status: ${selectedShipment?.status || '-'}`,
      `Destination: FBA Warehouse`,
      `Carrier: ${selectedShipment?.carrier || selectedShipment?.carrierName || selectedShipment?.carrier_name || '-'}`,
      `Dispatched: ${selectedShipment?.dispatched_at || selectedShipment?.dispatchedAt || 'Pending'}`,
      '',
      'Boxes',
      ...(trackBoxes.length
        ? trackBoxes.map((box, index) => {
            const weight = box?.weight || box?.weightKg || box?.weight_kg || 0;
            return `${index + 1}. ${getBoxTitle(box, index)} - ${weight} kg`;
          })
        : ['No boxes returned for this shipment yet.']),
    ];

    downloadTextFile(`dispatch-note-${sanitizeFileName(reference)}.txt`, rows.join('\n'));
    setMessage('Dispatch note downloaded.');
  };

  const handleDownloadFnskuLabels = () => {
    const reference = selectedShipment?.reference || selectedShipment?.id || 'shipment';
    const fnskuFiles = trackFiles.filter((file) => {
      const type = getFileTypeValue(file);
      const name = getFileName(file).toLowerCase();
      return type.includes('fnsku') || name.includes('fnsku');
    });

    if (fnskuFiles.length) {
      fnskuFiles.forEach((file) => openOrDownloadFile(file));
      setMessage(`${fnskuFiles.length} FNSKU label file(s) opened.`);
      return;
    }

    const labelRows = lineItems
      .map((item, index) => ({
        index: index + 1,
        sku: item?.sku || item?.sellerSku || item?.seller_sku || '-',
        product: item?.productName || item?.product_name || item?.name || '-',
        fnsku: item?.fnskuLabel || item?.fnsku_label || item?.defaultFnsku || item?.default_fnsku || '',
        quantity: item?.expectedQty || item?.expected_qty || item?.qtyExpected || item?.qty_expected || 0,
      }))
      .filter((item) => item.fnsku || item.sku !== '-');

    if (!labelRows.length) {
      setError('No FNSKU label file or line item data found for this shipment.');
      return;
    }

    const content = [
      `FNSKU Labels - ${reference}`,
      '',
      ...labelRows.map((item) => [
        `Label ${item.index}`,
        `SKU: ${item.sku}`,
        `Product: ${item.product}`,
        `FNSKU: ${item.fnsku || '-'}`,
        `Qty: ${item.quantity}`,
        '',
      ].join('\n')),
    ].join('\n');

    downloadTextFile(`fnsku-labels-${sanitizeFileName(reference)}.txt`, content);
    setMessage('FNSKU labels downloaded.');
  };

  const lineItems = getLineItems(selectedShipment || {});
  const trackBoxes = extractList(selectedShipmentBoxes, ['boxes']);
  const displaySubShipments = selectedShipmentSubShipments.length
    ? selectedShipmentSubShipments
    : extractSubShipments(selectedShipment || {});
  const trackFiles = extractList(selectedShipmentFiles, ['files']);
  const boxLabelFiles = trackBoxes
    .map((box, index) => getBoxFbaLabelFile(box, trackFiles, trackBoxes, index, selectedShipment))
    .filter(Boolean);
  const visibleShipmentFiles = mergeDisplayFileList(trackFiles).filter((file) => !isFileUsedAsBoxLabel(file, trackBoxes, boxLabelFiles, selectedShipment));
  const selectedShipmentViewStats = getShipmentViewStats(selectedShipment || {});
  const detailServices = mergeServiceTasks(
    extractServiceTasks(selectedShipmentServices),
    extractServiceTasks(selectedShipment || {})
  );
  const detailDiscrepancies = extractList(selectedShipmentDiscrepancies, ['discrepancies']);
  const displayTrackBoxes = trackBoxes.filter((box) => !isBoxInsidePallet(box));
  const hasTrackBoxes = displayTrackBoxes.length > 0;
  const isBoxLabelUploaded = (box, index) => {
    const boxId = getBoxId(box);
    const directUploaded = Boolean(
      box?.labelReady ||
      box?.label_ready ||
      box?.fbaLabelUploaded ||
      box?.fba_label_uploaded ||
      box?.labelUploaded ||
      box?.label_uploaded ||
      box?.fba_shipping_label_file_id ||
      box?.label_uploaded_at ||
      String(box?.status || '').toLowerCase() === 'uploaded'
    );

    if (directUploaded) return true;
    if (getBoxFbaLabelFile(box, trackFiles, trackBoxes, index, selectedShipment)) return true;

    return trackFiles.some((file) => {
      const entityId = getFileEntityId(file);

      return entityId === boxId && isFbaBoxLabelFile(file) && fileMatchesShipmentContext(file, selectedShipment, box) && fileMatchesBoxIdentity(file, box);
    });
  };
  const isBoxLabelReadyInSection = (box, filesMap = fbaLabelFilesMap) => {
    const boxId = getBoxItemsLookupId(box);
    const mappedFile = boxId ? filesMap?.[boxId] : null;
    return Boolean(
      isBoxDispatchedForFba(box) ||
        hasDirectFbaLabelRecord(box) ||
        String(box?.status || '').toLowerCase() === 'uploaded' ||
        box?.labelReady ||
        box?.label_ready ||
        box?.fbaLabelUploaded ||
        box?.fba_label_uploaded ||
        box?.labelUploaded ||
        box?.label_uploaded ||
        (mappedFile && isFbaBoxLabelFile(mappedFile) && fileMatchesShipmentContext(mappedFile, selectedShipment, box) && fileMatchesBoxIdentity(mappedFile, box))
    );
  };
  const awaitingFbaRows = fbaLabelShipments
    .map((shipment) => {
      const shipmentId = getShipmentId(shipment);
      const boxes = (fbaLabelBoxesMap[shipmentId] || []).filter((box) => !isBoxInsidePallet(box) && !isBoxLabelReadyInSection(box));
      return { shipment, shipmentId, boxes };
    })
    .filter((row) => row.boxes.length);
  const totalBoxesNeedingLabels = awaitingFbaRows.reduce((sum, row) => {
    return sum + row.boxes.length;
  }, 0);
  const batchFbaUploadOptions = useMemo(() => {
    if (!batchFbaUpload) return [];

    const targetShipmentId = getShipmentId(batchFbaUpload.shipment);
    const targetShipmentRecordId = getShipmentRecordId(batchFbaUpload.shipment);
    const row = awaitingFbaRows.find((currentRow) => {
      const currentShipmentId = getShipmentId(currentRow.shipment);
      const currentShipmentRecordId = getShipmentRecordId(currentRow.shipment);
      return (
        (targetShipmentRecordId && currentShipmentRecordId === targetShipmentRecordId) ||
        currentShipmentId === targetShipmentId
      );
    });

    return (row?.boxes || [])
      .map((box, index) => ({
        box,
        boxId: getBoxItemsLookupId(box),
        index,
      }))
      .filter(({ box, boxId }) => boxId && getBoxType(box) === 'box' && !isBoxInsidePallet(box) && !isBoxLabelReadyInSection(box));
  }, [awaitingFbaRows, batchFbaUpload, fbaLabelFilesMap]);

  const parseBoxSkuQuantityText = (value = '') => {
    const text = String(value || '').trim();
    if (!text) return [];

    return text
      .split(/[,;\n]+/)
      .map((part) => {
        const normalizedPart = part.trim().replace(/^SKU:\s*/i, '');
        if (!normalizedPart) return null;

        const match = normalizedPart.match(/^(.+?)\s*(?:x|:|\*)\s*(\d+(?:\.\d+)?)\s*(?:units?)?$/i);
        const sku = normalizeDisplayValue(match ? match[1] : normalizedPart);

        return sku ? { sku, quantity: match ? match[2] : '' } : null;
      })
      .filter(Boolean);
  };

  const skuTextMatchesItemSku = (itemSku = '', value = '') => {
    const normalizedItemSku = normalizeDisplayValue(itemSku);
    const normalizedValue = normalizeDisplayValue(value);
    if (!normalizedItemSku || !normalizedValue) return false;
    if (skuValuesMatch(normalizedValue, normalizedItemSku)) return true;

    return parseBoxSkuQuantityText(value).some(
      (row) => skuValuesMatch(row?.sku, normalizedItemSku)
    );
  };

  const expandBoxContentRows = (rows = []) =>
    rows.flatMap((row) => {
      const parsedRows = parseBoxSkuQuantityText(row?.sku);
      const originalSku = normalizeDisplayValue(row?.sku).toLowerCase();
      const shouldExpand =
        parsedRows.length > 1 ||
        (parsedRows.length === 1 && normalizeDisplayValue(parsedRows[0]?.sku).toLowerCase() !== originalSku);

      if (!shouldExpand) return [row];

      return parsedRows.map((parsedRow, index) => ({
        ...row,
        id: row?.id ? `${row.id}-${index}` : row?.id,
        sku: parsedRow.sku,
        quantity: firstPresent(parsedRow.quantity, row?.quantity, ''),
        parsedFromSummary: true,
      }));
    });

  const getBoxContentRows = (box = {}, shipment = {}, boxIndex = -1) => {
    const getContentLineItemId = (content = {}) =>
      firstPresent(
        content?.shipmentItemId,
        content?.shipment_item_id,
        content?.lineItemId,
        content?.line_item_id,
        content?.itemId,
        content?.item_id,
        content?.shipmentItem?.id,
        content?.shipment_item?.id,
        content?.lineItem?.id,
        content?.line_item?.id,
        content?.item?.id
      );
    const getContentSku = (content = {}) =>
      normalizeDisplayValue(
        firstPresent(
          content?.sku,
          content?.sellerSku,
          content?.seller_sku,
          content?.shipmentItemSku,
          content?.shipment_item_sku,
          content?.lineItemSku,
          content?.line_item_sku,
          content?.productSku,
          content?.product_sku,
          getItemSku(content?.shipmentItem || {}),
          getItemSku(content?.shipment_item || {}),
          getItemSku(content?.lineItem || {}),
          getItemSku(content?.line_item || {}),
          getItemSku(content?.item || {})
        )
      );
    const getContentQuantity = (content = {}) =>
      firstQuantity(
        content?.quantity,
        content?.qty,
        content?.units,
        content?.itemQuantity,
        content?.item_quantity,
        content?.allocatedQuantity,
        content?.allocated_quantity,
        content?.allocatedQty,
        content?.allocated_qty,
        content?.qtyAllocated,
        content?.qty_allocated,
        content?.packedQuantity,
        content?.packed_quantity,
        content?.boxedQuantity,
        content?.boxed_quantity,
        content?.unitCount,
        content?.unit_count
      );
    const getBoxDirectSku = () =>
      normalizeDisplayValue(
        firstPresent(
          box?.sku,
          box?.sellerSku,
          box?.seller_sku,
          box?.shipmentItemSku,
          box?.shipment_item_sku,
          box?.lineItemSku,
          box?.line_item_sku,
          box?.productSku,
          box?.product_sku,
          box?.primarySku,
          box?.primary_sku,
          box?.metadata?.sku,
          box?.meta?.sku,
          shipment?.sku,
          shipment?.sellerSku,
          shipment?.seller_sku,
          shipment?.shipmentItemSku,
          shipment?.shipment_item_sku,
          shipment?.productSku,
          shipment?.product_sku
        )
      );
    const getBoxDirectQuantity = () =>
      firstQuantity(
        box?.quantity,
        box?.qty,
        box?.units,
        box?.itemQuantity,
        box?.item_quantity,
        box?.allocatedQuantity,
        box?.allocated_quantity,
        box?.allocatedQty,
        box?.allocated_qty,
        box?.qtyAllocated,
        box?.qty_allocated,
        box?.packedQuantity,
        box?.packed_quantity,
        box?.boxedQuantity,
        box?.boxed_quantity,
        box?.unitCount,
        box?.unit_count,
        box?.metadata?.quantity,
        box?.metadata?.qty,
        box?.metadata?.units,
        box?.meta?.quantity,
        box?.meta?.qty,
        box?.meta?.units
      );
    const contents = getBoxItems(box);
    const shipmentItems = getLineItems(shipment);
    const boxDirectSku = getBoxDirectSku();
    const directBoxQuantity = getBoxDirectQuantity();
    const boxLineItemId = firstPresent(box?.shipmentItemId, box?.shipment_item_id, box?.lineItemId, box?.line_item_id, box?.itemId, box?.item_id);
    const fallbackItemByBoxReference = shipmentItems.find((item) => {
      const itemIds = getItemLabelMatchIds(item);
      const itemSku = getItemSku(item);
      return Boolean(
        (boxLineItemId && itemIds.includes(String(boxLineItemId))) ||
          skuTextMatchesItemSku(itemSku, boxDirectSku)
      );
    });
    const fallbackItemByIndex = boxIndex >= 0 && shipmentItems.length ? shipmentItems[Math.min(boxIndex, shipmentItems.length - 1)] : null;
    const fallbackItem = fallbackItemByBoxReference || (shipmentItems.length === 1 ? shipmentItems[0] : null) || fallbackItemByIndex;

    const buildRows = (items = []) => {
      const itemList = toArray(items);
      const canUseBoxLevelQuantityFallback = itemList.length <= 1;

      return itemList.map((content, contentIndex) => {
        const contentRecord = content && typeof content === 'object' ? content : { sku: String(content || '').trim() };
        const shipmentItemId = getContentLineItemId(contentRecord);
        const contentSku = getContentSku(contentRecord);
        const matchedItem = shipmentItems.find((item) => {
          const itemIds = getItemLabelMatchIds(item);
          const itemSku = getItemSku(item);
          return Boolean(
            (shipmentItemId && itemIds.includes(String(shipmentItemId))) ||
              skuTextMatchesItemSku(itemSku, contentSku)
          );
        });
        const canUseRawContentSku = !shipmentItems.length || Boolean(matchedItem);
        const canUseRawBoxSku = !shipmentItems.length || Boolean(fallbackItemByBoxReference);
        const sku = firstPresent(
          getItemSku(matchedItem),
          canUseRawContentSku ? contentSku : '',
          canUseRawBoxSku ? boxDirectSku : '',
          getItemSku(fallbackItem)
        );
        const resolvedQuantity = firstPresent(
          getContentQuantity(contentRecord),
          canUseBoxLevelQuantityFallback ? directBoxQuantity : '',
          canUseBoxLevelQuantityFallback ? getItemExpectedQty(matchedItem) : '',
          canUseBoxLevelQuantityFallback ? getItemExpectedQty(fallbackItem) : '',
          ''
        );

        return {
          ...contentRecord,
          key: firstPresent(contentRecord?.id, contentRecord?.uuid, contentRecord?.boxItemId, contentRecord?.box_item_id, shipmentItemId, contentIndex),
          sku,
          quantity: resolvedQuantity,
          shipmentItemId,
        };
      }).filter((row) => normalizeDisplayValue(row?.sku) || row?.quantity !== '');
    };

    const displayContentRows = expandBoxContentRows(buildRows(contents));

    if (displayContentRows.length) return displayContentRows;

    const cachedRows = expandBoxContentRows(
      buildRows(getCachedBoxAllocationItems(box, shipmentItems))
    );
    if (cachedRows.length) return cachedRows;

    if (boxDirectSku || directBoxQuantity !== '' || fallbackItem) {
      const item = fallbackItem || {};
      return expandBoxContentRows([
        {
          sku: getItemSku(item) || boxDirectSku,
          quantity: firstPresent(directBoxQuantity, getItemExpectedQty(item), ''),
          shipmentItemId: boxLineItemId || getItemRecordId(item),
          fallbackFromShipment: true,
        },
      ]);
    }

    return displayContentRows;
  };
  const getBoxContentsSummary = (box = {}, shipment = {}, boxIndex = -1) => {
    const rows = getBoxContentRows(box, shipment, boxIndex);
    return rows.length
      ? rows.map((row) => `${normalizeDisplayValue(row.sku) || 'SKU pending'}${row.quantity !== '' ? ` x ${row.quantity}` : ''}`).join(', ')
      : '-';
  };
  const getPrimaryBoxSku = (box = {}, shipment = {}, boxIndex = -1) => {
    const row = getBoxContentRows(box, shipment, boxIndex)[0];
    return normalizeDisplayValue(row?.sku);
  };
  const getBoxGroupLabel = (box = {}, shipment = {}, boxIndex = -1) => {
    if (getBoxType(box) === 'pallet') return 'Pallets';

    const skus = [
      ...new Set(
        getBoxContentRows(box, shipment, boxIndex)
          .map((row) => normalizeDisplayValue(row?.sku))
          .filter(Boolean)
      ),
    ];

    if (skus.length > 1) return `Mixed SKUs: ${skus.join(', ')}`;
    return skus[0] || getPrimaryBoxSku(box, shipment, boxIndex) || '';
  };
  const getBoxesGroupedBySku = (boxes = [], shipment = {}) => {
    const groups = new Map();

    boxes.forEach((box, index) => {
      const label = getBoxGroupLabel(box, shipment, index);
      const key = label || 'sku-unallocated';
      const group = groups.get(key) || { key, label, boxes: [] };
      group.boxes.push({ box, originalIndex: index });
      groups.set(key, group);
    });

    return [...groups.values()];
  };
  const getPrimaryBoxQuantity = (box = {}, shipment = {}, boxIndex = -1) => {
    const row = getBoxContentRows(box, shipment, boxIndex)[0];
    return row?.quantity ?? '';
  };
  const getBoxTotalQuantity = (box = {}, shipment = {}, boxIndex = -1) => {
    const quantities = getBoxContentRows(box, shipment, boxIndex)
      .map((row) => row?.quantity)
      .filter((quantity) => quantity !== '' && quantity !== undefined && quantity !== null);

    if (!quantities.length) return getPrimaryBoxQuantity(box, shipment, boxIndex);

    return quantities.reduce((sum, quantity) => {
      const numericQuantity = Number(quantity);
      return Number.isFinite(numericQuantity) ? sum + numericQuantity : sum;
    }, 0);
  };
  const getBoxRawContentItems = (box = {}) => {
    return getBoxItems(box);
  };
  const getBoxDirectLineItemId = (box = {}) =>
    firstPresent(
      box?.shipmentItemId,
      box?.shipment_item_id,
      box?.shipmentLineItemId,
      box?.shipment_line_item_id,
      box?.lineItemId,
      box?.line_item_id,
      box?.itemId,
      box?.item_id
    );
  const getBoxDirectSku = (box = {}) =>
    normalizeDisplayValue(
      firstPresent(
        box?.sku,
        box?.sellerSku,
        box?.seller_sku,
        box?.shipmentItemSku,
        box?.shipment_item_sku,
        box?.lineItemSku,
        box?.line_item_sku,
        box?.productSku,
        box?.product_sku,
        box?.primarySku,
        box?.primary_sku,
        box?.metadata?.sku,
        box?.meta?.sku
      )
    );
  const getBoxContentLineItemId = (content = {}) =>
    firstPresent(
      content?.shipmentItemId,
      content?.shipment_item_id,
      content?.shipmentLineItemId,
      content?.shipment_line_item_id,
      content?.lineItemId,
      content?.line_item_id,
      content?.itemId,
      content?.item_id,
      content?.shipmentItem?.id,
      content?.shipmentItem?.uuid,
      content?.shipment_item?.id,
      content?.shipment_item?.uuid,
      content?.lineItem?.id,
      content?.lineItem?.uuid,
      content?.line_item?.id,
      content?.line_item?.uuid,
      content?.item?.id,
      content?.item?.uuid
    );
  const getBoxContentSku = (content = {}) =>
    normalizeDisplayValue(
      firstPresent(
        content?.sku,
        content?.sellerSku,
        content?.seller_sku,
        content?.shipmentItemSku,
        content?.shipment_item_sku,
        content?.lineItemSku,
        content?.line_item_sku,
        content?.productSku,
        content?.product_sku,
        content?.product?.sku,
        content?.product?.sellerSku,
        content?.product?.seller_sku,
        getItemSku(content?.shipmentItem || {}),
        getItemSku(content?.shipment_item || {}),
        getItemSku(content?.lineItem || {}),
        getItemSku(content?.line_item || {}),
        getItemSku(content?.item || {})
      )
    );
  const isBoxLinkedToItem = (box = {}, item = {}, itemCount = 0, shipment = {}, boxIndex = -1) => {
    const itemIds = getItemLabelMatchIds(item);
    const itemSku = normalizeDisplayValue(getItemSku(item));
    const boxLineItemId = String(getBoxDirectLineItemId(box) || '').trim();
    const boxSku = getBoxDirectSku(box);
    const contentItems = getBoxRawContentItems(box);
    const displayRows = getBoxContentRows(box, shipment, boxIndex);

    if ((boxLineItemId && itemIds.includes(boxLineItemId)) || skuTextMatchesItemSku(itemSku, boxSku)) {
      return true;
    }

    if (contentItems.some((content) => {
      const contentLineItemId = String(getBoxContentLineItemId(content) || '').trim();
      const contentSku = getBoxContentSku(content);
      return Boolean((contentLineItemId && itemIds.includes(contentLineItemId)) || skuTextMatchesItemSku(itemSku, contentSku));
    })) {
      return true;
    }

    if (displayRows.some((row) => {
      const rowLineItemId = String(row?.shipmentItemId || row?.shipment_item_id || row?.lineItemId || row?.line_item_id || '').trim();
      return Boolean((rowLineItemId && itemIds.includes(rowLineItemId)) || skuTextMatchesItemSku(itemSku, row?.sku));
    })) {
      return true;
    }

    return itemCount === 1 && !boxLineItemId && !boxSku && !contentItems.length;
  };
  const getOutboundPackagesForShipmentItem = (item, boxes = trackBoxes, items = selectedShipmentViewStats.items) =>
    getLineItemOutboundPackageGroups({
      item,
      boxes,
      lineItems: items,
      isBoxLinkedToItem: (box, currentItem, boxIndex) =>
        isBoxLinkedToItem(box, currentItem, items.length, selectedShipment || {}, boxIndex),
      isPalletBox: (box) => getBoxType(box) === 'pallet',
      getPalletChildBoxes,
      getBoxKey: (box, boxIndex) => String(getBoxItemsLookupId(box) || getBoxDisplayTitle(box, boxIndex) || boxIndex),
    });
  const getBoxesForShipmentItem = (item, boxes = trackBoxes, items = selectedShipmentViewStats.items) =>
    getOutboundPackagesForShipmentItem(item, boxes, items).boxes;
  const getPalletsForShipmentItem = (item, boxes = trackBoxes, items = selectedShipmentViewStats.items) =>
    getOutboundPackagesForShipmentItem(item, boxes, items).pallets;
  const getUnassignedShipmentBoxes = (boxes = trackBoxes, items = selectedShipmentViewStats.items) =>
    boxes
      .map((box, boxIndex) => ({ box, boxIndex }))
      .filter(({ box, boxIndex }) => !items.some((item) => {
        const packages = getOutboundPackagesForShipmentItem(item, boxes, items);
        const packageRows = [...packages.boxes, ...packages.pallets];
        const currentKey = String(getBoxItemsLookupId(box) || getBoxDisplayTitle(box, boxIndex) || boxIndex);
        return packageRows.some((row) => String(row.key || getBoxItemsLookupId(row.box) || getBoxDisplayTitle(row.box, row.boxIndex) || row.boxIndex) === currentKey);
      }));
  const getBoxRowsForLineItem = (box = {}, shipment = {}, boxIndex = -1, lineItem = null) => {
    const rows = getBoxContentRows(box, shipment, boxIndex);
    if (!lineItem) return rows;

    const lineItemIds = getItemLabelMatchIds(lineItem);
    const lineItemSku = normalizeDisplayValue(getItemSku(lineItem));

    return rows.filter((row) => {
      const rowLineItemId = String(row?.shipmentItemId || row?.shipment_item_id || row?.lineItemId || row?.line_item_id || '').trim();
      return Boolean((rowLineItemId && lineItemIds.includes(rowLineItemId)) || skuTextMatchesItemSku(lineItemSku, row?.sku));
    });
  };

  const getBoxRowsSummary = (rows = []) =>
    rows
      .map((row) => {
        const sku = normalizeDisplayValue(row?.sku);
        const quantity = row?.quantity;

        if (sku && quantity !== '' && quantity !== undefined && quantity !== null) return `${sku}: ${quantity}`;
        return sku || '';
      })
      .filter(Boolean)
      .join(', ');

  const getBoxRowsTotalQuantity = (rows = []) => {
    const quantities = rows
      .map((row) => row?.quantity)
      .filter((quantity) => quantity !== '' && quantity !== undefined && quantity !== null);

    if (!quantities.length) return '';

    return quantities.reduce((sum, quantity) => {
      const numericQuantity = Number(quantity);
      return Number.isFinite(numericQuantity) ? sum + numericQuantity : sum;
    }, 0);
  };

  const renderShipmentBoxCard = (box, index, lineItem = null) => {
    const boxId = getBoxItemsLookupId(box);
    const mappedFbaLabelFile = boxId ? fbaLabelFilesMap[boxId] : null;
    const rawFbaLabelFile = getBoxFbaLabelFile(
      box,
      mergeFileLists(mappedFbaLabelFile ? [mappedFbaLabelFile] : [], trackFiles),
      trackBoxes,
      index,
      selectedShipment
    );
    const fbaLabelFile = rawFbaLabelFile || null;
    const fbaLabelUrl = getFileUrlCandidates(fbaLabelFile)[0] || resolveFileUrl(getFileUrl(fbaLabelFile));
    const fbaLabelImage = fbaLabelFile && fbaLabelUrl && isImageFile(fbaLabelFile);
    const labelReady = Boolean(fbaLabelFile);
    const matchedBoxRows = getBoxRowsForLineItem(box, selectedShipment || {}, index, lineItem);
    const allBoxRows = getBoxRowsForLineItem(box, selectedShipment || {}, index);
    const boxRows = allBoxRows.length ? allBoxRows : matchedBoxRows;
    const contentSummary = getBoxRowsSummary(boxRows);
    const primarySku = lineItem ? normalizeDisplayValue(getItemSku(lineItem)) : getPrimaryBoxSku(box, selectedShipment || {}, index);
    const totalQty = firstPresent(getBoxRowsTotalQuantity(boxRows), getBoxTotalQuantity(box, selectedShipment || {}, index), '');
    const dimensions = getBoxDimensions(box);
    const boxSize = getBoxSize(box);
    const boxWeight = getBoxWeight(box);
    const isPallet = getBoxType(box) === 'pallet';
    const insidePallet = isBoxInsidePallet(box);
    const palletChildren = getPalletChildBoxes(box);
    const palletChildCount = getPalletChildCount(box);

    return (
      <div key={box?.id || box?.uuid || index} className="overflow-hidden rounded-lg border border-gray-200 bg-gray-50">
        <div className="p-3">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <p className="font-medium text-gray-900">{getBoxDisplayTitle(box, index)}{!isPallet && boxSize ? ` - ${boxSize}` : ''}</p>
                {isPallet ? (
                  <span className="rounded-full bg-[#fff7ed] px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-[#ff6900]">Pallet</span>
                ) : null}
                {insidePallet ? (
                  <span className="rounded-full bg-[#eef4ff] px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-[#315c99]">Inside pallet</span>
                ) : null}
              </div>
              {box.__subShipmentReference ? (
                <p className="mt-1 text-xs font-semibold text-[#ff6900]">Sub-shipment: {box.__subShipmentReference}</p>
              ) : null}
              {isPallet ? (
                <p className="mt-1 text-xs text-[#64748b]">
                  {[dimensions, boxWeight ? `${boxWeight} kg` : '', `${palletChildCount || 0} box${Number(palletChildCount) === 1 ? '' : 'es'}`].filter(Boolean).join(' - ') || 'Pallet details pending'}
                </p>
              ) : null}
            </div>
            <span className={`w-fit rounded-full px-2.5 py-1 text-xs font-semibold ${labelReady ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-600'}`}>
              {isPallet ? (labelReady ? 'Pallet Label Ready' : 'Pallet Label Missing') : (labelReady ? 'FBA Label Ready' : 'FBA Label Missing')}
            </span>
          </div>

          <div className="mt-3 grid grid-cols-2 gap-2 text-xs sm:grid-cols-5">
            {(isPallet
              ? [
                  { label: 'Status', value: getBoxDisplayStatus(box, selectedShipment?.status) },
                  { label: 'Pallet Dimensions', value: dimensions || '-' },
                  { label: 'Pallet Weight', value: boxWeight ? `${boxWeight} kg` : '-' },
                  { label: 'Boxes Inside', value: `${palletChildCount || 0} box${Number(palletChildCount) === 1 ? '' : 'es'}` },
                  { label: 'Pallet FBA Label', value: labelReady ? 'Uploaded' : 'Missing' },
                ]
              : [
                  { label: 'Status', value: getBoxDisplayStatus(box, selectedShipment?.status) },
                  { label: 'Dimensions', value: dimensions || '-' },
                  { label: 'Weight', value: boxWeight ? `${boxWeight} kg` : '-' },
                  { label: 'SKU', value: contentSummary || primarySku || 'Pending' },
                  { label: 'Qty', value: totalQty !== '' ? totalQty : 'Pending' },
                ]).map((meta) => (
              <div key={meta.label} className="rounded-md border border-[#dfe7f3] bg-white px-3 py-2">
                <p className="text-[10px] font-semibold uppercase tracking-wide text-[#94a3b8]">{meta.label}</p>
                <p className="mt-1 break-words font-semibold text-[#132347]">{meta.value}</p>
              </div>
            ))}
          </div>

          {isPallet ? (
            <div className="mt-3 rounded-md border border-[#dfe7f3] bg-white p-3">
              <div className="mb-2 flex items-center justify-between gap-3">
                <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">Boxes in pallet</p>
                <span className="rounded-full bg-[#f8fafc] px-2 py-0.5 text-[10px] font-semibold text-[#64748b]">
                  {palletChildCount || 0} box{Number(palletChildCount) === 1 ? '' : 'es'}
                </span>
              </div>
              {palletChildren.length ? (
                <div className="space-y-2">
                  {palletChildren.map((childBox, childIndex) => {
                    const childDimensions = getBoxDimensions(childBox);
                    const childWeight = getBoxWeight(childBox);
                    const childRows = getBoxRowsForLineItem(childBox, selectedShipment || {}, childIndex);
                    const childSummary = getBoxRowsSummary(childRows);
                    const childLabelReady = Boolean(getBoxFbaLabelFile(childBox, trackFiles, trackBoxes, childIndex, selectedShipment));

                    return (
                      <div key={getBoxItemsLookupId(childBox) || childIndex} className="rounded-md border border-[#e8eef7] bg-[#f8fbff] px-3 py-2">
                        <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                          <div className="min-w-0">
                            <p className="text-sm font-semibold text-[#132347]">{getBoxDisplayTitle(childBox, childIndex)}</p>
                            <p className="mt-1 text-xs text-[#64748b]">
                              {[childDimensions, childWeight ? `${childWeight} kg` : '', childSummary].filter(Boolean).join(' - ') || 'Box details pending'}
                            </p>
                          </div>
                          <span className={`w-fit rounded-full px-2.5 py-1 text-xs font-semibold ${childLabelReady ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-600'}`}>
                            {childLabelReady ? 'FBA Label Ready' : 'FBA Label Missing'}
                          </span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div className="rounded-md border border-dashed border-[#d7e0ee] bg-[#f8fbff] px-3 py-4 text-center text-xs text-[#64748b]">
                  No child boxes returned for this pallet.
                </div>
              )}
            </div>
          ) : boxRows.length ? (
            <div className="mt-3 rounded-md border border-gray-200 bg-white">
              {boxRows.map((row, rowIndex) => (
                <div key={row?.id || row?.shipmentItemId || row?.lineItemId || row?.sku || rowIndex} className="flex items-center justify-between gap-3 border-b border-gray-100 px-3 py-2 text-xs last:border-b-0">
                  <span className="font-medium text-[#132347]">SKU: {normalizeDisplayValue(row?.sku) || 'Pending'}</span>
                  <span className="text-gray-600">Qty: {row?.quantity !== '' && row?.quantity !== undefined && row?.quantity !== null ? row.quantity : 'Pending'}</span>
                </div>
              ))}
            </div>
          ) : null}

          <div className="mt-3 rounded-md border border-gray-200 bg-white px-3 py-2">
            <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">FBA Label</p>
            {fbaLabelFile ? (
              <>
                {fbaLabelImage ? (
                  <button type="button" onClick={() => openOrDownloadFile(fbaLabelFile)} className="mt-2 block w-full overflow-hidden rounded-md border border-gray-100 bg-gray-50">
                    <LabelPreviewImage file={fbaLabelFile} alt={getFileName(fbaLabelFile)} className="h-40 w-full object-contain" />
                  </button>
                ) : null}
                <button
                  type="button"
                  onClick={() => openOrDownloadFile(fbaLabelFile)}
                  className="mt-2 text-left text-xs font-semibold text-[#ff6900] hover:text-[#e55d00]"
                >
                  {getFileName(fbaLabelFile)}
                </button>
              </>
            ) : (
              <p className="mt-1 text-xs text-gray-500">No FBA label file returned.</p>
            )}
          </div>
        </div>
      </div>
    );
  };
  const trackerSteps = [
    {
      key: 'submitted',
      label: 'Submitted',
      date: formatTrackerDate(selectedShipment?.created_at || selectedShipment?.createdAt),
      icon: Check,
      active: true,
    },
    {
      key: 'received',
      label: 'Arrived at Warehouse',
      date: formatTrackerDate(selectedShipment?.actual_arrival_date || selectedShipment?.receivedAt || selectedShipment?.arrivedDate),
      icon: Check,
      active: ['received', 'in_progress', 'prepped', 'dispatched', 'completed'].includes(String(selectedShipment?.status || '').toLowerCase()),
    },
    {
      key: 'prepping',
      label: 'Prepping',
      date: String(selectedShipment?.status || '').toLowerCase() === 'in_progress' ? 'In Progress' : 'Pending',
      icon: ClipboardCheck,
      active: ['in_progress', 'prepped', 'dispatched', 'completed'].includes(String(selectedShipment?.status || '').toLowerCase()),
      current: String(selectedShipment?.status || '').toLowerCase() === 'in_progress',
    },
    {
      key: 'dispatched',
      label: 'Dispatched',
      date: formatTrackerDate(selectedShipment?.dispatchedAt || selectedShipment?.dispatched_at),
      icon: Truck,
      active: ['dispatched', 'completed'].includes(String(selectedShipment?.status || '').toLowerCase()),
    },
  ];

  const renderTrackSection = () => (
    <div className="">
      <div className="">
        <button
          type="button"
          onClick={() => {
            setShowTrackModal(false);
            setSelectedShipment(null);
          }}
          className="mb-5 inline-flex items-center gap-2 text-sm font-medium text-[#475569] hover:text-[#132347]"
        >
          <ArrowLeft size={16} />
          back
        </button>

        <div className="mb-6">
          <h1 className="text-[34px] font-semibold leading-none text-[#132347]">Track & Labels</h1>
          <p className="mt-2 text-sm text-[#7a8ca5]">Manage labels and track live shipments across all centers.</p>
        </div>

        {hasTrackBoxes && trackBoxes.some((box, index) => !isBoxLabelUploaded(box, index)) ? (
          <div className="mb-6 flex items-center justify-between rounded-xl border border-[#f5c2c0] bg-[#fde9e8] px-5 py-4">
            <p className="text-sm text-[#b84640]">
              Action Required: Shipment {selectedShipment?.reference || selectedShipment?.id} is missing FBA labels for some boxes. Please upload them to avoid dispatch delays.
            </p>
            <button
              type="button"
              onClick={() => fbaUploadPanelRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })}
              className="rounded-lg bg-[#e15d4c] px-4 py-2 text-sm font-semibold text-white"
            >
              Upload Now
            </button>
          </div>
        ) : null}

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
          <div className="space-y-6">
            <div className="rounded-2xl border border-[#dce5f1] bg-white p-5 shadow-sm">
              <div className="mb-6 flex items-center justify-between">
                <h2 className="text-lg font-semibold text-[#132347]">Live Tracker: {selectedShipment?.reference || selectedShipment?.id}</h2>
                <span className="rounded-full bg-[#fff4df] px-3 py-1 text-xs font-semibold text-[#c9831d]">
                  {String(selectedShipment?.status || 'IN PROGRESS').replaceAll('_', ' ').toUpperCase()}
                </span>
              </div>

              <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
                {trackerSteps.map((step, index) => {
                  const StepIcon = step.icon || Check;
                  const isNextActive = Boolean(trackerSteps[index + 1]?.active);
                  const circleClass = step.current
                    ? 'border-[#f28a2c] bg-white text-[#f28a2c]'
                    : step.active
                      ? 'border-[#f28a2c] bg-[#f28a2c] text-white'
                      : 'border-[#cad4e3] bg-white text-[#94a3b8]';

                  return (
                    <div key={step.key} className="relative">
                      {index < trackerSteps.length - 1 ? (
                        <div className={`absolute left-[calc(50%+18px)] right-[-26px] top-4 h-[2px] ${isNextActive ? 'bg-[#f28a2c]' : 'bg-[#d8dee8]'}`} />
                      ) : null}
                      <div className="relative flex flex-col items-center text-center">
                        <div className={`flex h-10 w-10 items-center justify-center rounded-full border-2 ${circleClass}`}>
                          {step.current || !step.active ? <StepIcon size={18} strokeWidth={2.4} /> : <Check size={19} strokeWidth={3} />}
                        </div>
                        <p className={`mt-3 text-sm font-semibold ${step.current ? 'text-[#f28a2c]' : 'text-[#132347]'}`}>{step.label}</p>
                        <p className="mt-1 text-xs text-[#7a8ca5]">{step.date}</p>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            <div className="rounded-2xl border border-[#dce5f1] bg-white p-5 shadow-sm">
              <div className="mb-5 flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <h3 className="text-lg font-semibold text-[#132347]">Shipment: {selectedShipment?.reference || selectedShipment?.id}</h3>
                  <span className="rounded-full bg-[#fff7ed] px-3 py-1 text-[11px] font-semibold text-[#ff8c2f]">
                    {String(selectedShipment?.status || 'pending').toUpperCase()}
                  </span>
                </div>
                <p className="text-xs text-[#7a8ca5]">
                  {selectedShipment?.dispatched_at || selectedShipment?.dispatchedAt
                    ? `Dispatched on ${formatTrackerDate(selectedShipment?.dispatched_at || selectedShipment?.dispatchedAt)}`
                    : 'Dispatched pending'}
                </p>
              </div>

              <div className="grid grid-cols-2 gap-6 border-b border-[#edf2f7] pb-5 md:grid-cols-4">
                <div>
                  <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[#94a3b8]">Destination</p>
                  <p className="mt-2 text-sm font-medium text-[#132347]">FBA Warehouse</p>
                </div>
                <div>
                  <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[#94a3b8]">Quantity</p>
                  <p className="mt-2 text-sm font-medium text-[#132347]">{lineItems.reduce((sum, item) => sum + Number(item?.expectedQty || item?.expected_qty || 0), 0)} Units</p>
                </div>
                <div>
                  <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[#94a3b8]">Carrier</p>
                  <p className="mt-2 text-sm font-medium text-[#132347]">{selectedShipment?.carrier || selectedShipment?.carrierName || selectedShipment?.carrier_name || '-'}</p>
                </div>
                <div>
                  <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[#94a3b8]">Total Weight</p>
                  <p className="mt-2 text-sm font-medium text-[#132347]">{trackBoxes.reduce((sum, box) => sum + Number(box?.weight || 0), 0).toFixed(1)} kg</p>
                </div>
              </div>

              <div className="flex flex-col gap-4 pt-5 md:flex-row md:items-center md:justify-between">
                <div className="text-sm font-medium text-[#f28a2c]">
                  {trackBoxes.length} boxes prepared for dispatch
                </div>
                <div className="flex items-center gap-3">
                  <button type="button" onClick={handleDownloadDispatchNote} className="inline-flex items-center gap-2 rounded-lg border border-[#fde7d5] px-4 py-2 text-sm font-medium text-[#ff8c2f] hover:bg-[#fff7ed]">
                    <FileText size={14} />
                    Dispatch Note
                  </button>
                  <button type="button" onClick={handleDownloadFnskuLabels} className="inline-flex items-center gap-2 rounded-lg border border-[#fde7d5] px-4 py-2 text-sm font-medium text-[#ff8c2f] hover:bg-[#fff7ed]">
                    <Tags size={14} />
                    FNSKU Labels
                  </button>
                </div>
              </div>
            </div>
          </div>

          <div ref={fbaUploadPanelRef} className="rounded-2xl border border-[#dce5f1] bg-white p-5 shadow-sm">
            <h3 className="mb-4 text-lg font-semibold text-[#132347]">Upload FBA Labels</h3>
            {hasTrackBoxes ? (
              <div className="overflow-hidden rounded-xl border border-[#e8eef7]">
                <div className="grid grid-cols-[1fr_90px_56px] bg-[#f8fbff] px-4 py-3 text-[11px] font-semibold uppercase tracking-[0.14em] text-[#7a8ca5]">
                  <span>Box ID</span>
                  <span>Status</span>
                  <span>Action</span>
                </div>
                {displayTrackBoxes.map((box, index) => {
                  const labelUploaded = isBoxLabelUploaded(box, index);
                  const uploadKey = `box-${getBoxItemsLookupId(box) || index}`;
                  const isUploading = uploadingBoxKey === uploadKey;
                  const isPallet = getBoxType(box) === 'pallet';
                  const palletChildren = getPalletChildBoxes(box);
                  const palletChildCount = getPalletChildCount(box);
                  const dimensionsText = [box?.length_cm, box?.width_cm, box?.height_cm].some((value) => Number(value) > 0)
                    ? `${Number(box?.length_cm || 0)}x${Number(box?.width_cm || 0)}x${Number(box?.height_cm || 0)} CM`
                    : getBoxDimensions(box);
                  const weightText = Number(box?.weight_kg || box?.weight || box?.weightKg || 0) > 0
                    ? `${Number(box?.weight_kg || box?.weight || box?.weightKg)} KG`
                    : '';
                  const contents = Array.isArray(box?.contents) ? box.contents : [];
                  const palletSummary = [
                    dimensionsText,
                    weightText,
                    `${palletChildCount || 0} box${Number(palletChildCount) === 1 ? '' : 'es'}`,
                  ].filter(Boolean).join(' - ');
                  return (
                    <div key={box?.id || index} className="border-t border-[#edf2f7] px-4 py-3 text-sm">
                      <div className="flex items-center justify-between gap-3">
                        <div className="min-w-0 flex-1">
                          <p className="font-medium text-[#132347]">{getBoxDisplayTitle(box, index)}</p>
                          {isPallet ? (
                            <p className="mt-0.5 text-xs text-[#7a8ca5]">
                              {palletSummary || 'Pallet details pending'}
                            </p>
                          ) : [dimensionsText, weightText].filter(Boolean).length ? (
                            <p className="mt-0.5 text-xs text-[#7a8ca5]">
                              {[dimensionsText, weightText].filter(Boolean).join(' · ')}
                            </p>
                          ) : null}
                          {isPallet ? (
                            <p className="mt-0.5 text-xs text-[#7a8ca5]">
                              {palletChildren.length
                                ? `Boxes: ${palletChildren.map((childBox, childIndex) => getBoxDisplayTitle(childBox, childIndex)).join(', ')}`
                                : 'No child boxes returned for this pallet.'}
                            </p>
                          ) : contents.length ? (
                            <p className="mt-0.5 text-xs text-[#7a8ca5]">
                              {contents.map((item) => `${item?.sku || 'SKU'} x ${item?.quantity || 0}`).join(', ')}
                            </p>
                          ) : null}
                        </div>
                        <span className={`shrink-0 text-xs font-semibold ${labelUploaded ? 'text-[#d8a11f]' : 'text-[#e45a5a]'}`}>
                          {isPallet ? (labelUploaded ? 'PALLET LABEL UPLOADED' : 'PALLET LABEL MISSING') : (labelUploaded ? 'UPLOADED' : 'MISSING')}
                        </span>
                        <label className={`inline-flex shrink-0 cursor-pointer items-center justify-center text-[#ff8c2f] hover:text-[#f67d17] ${isUploading ? 'pointer-events-none opacity-50' : ''}`} title="Upload FBA label">
                          {isUploading ? <RefreshCw size={14} className="animate-spin" /> : <Upload size={14} />}
                          <input
                            type="file"
                            accept=".pdf,image/*"
                            className="hidden"
                            onChange={(event) => {
                              const file = event.target.files?.[0] || null;
                              event.target.value = '';
                              handleUploadBoxLabel(box, index, file);
                            }}
                          />
                        </label>
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="rounded-xl border border-dashed border-[#d7e0ee] bg-[#f8fbff] px-4 py-8 text-center text-sm text-[#7a8ca5]">
                No boxes created yet.
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );

  const renderAwaitingFbaLabelsSection = (showEmptyState = false) => (
    <>
      {awaitingFbaOnly && (isLoading || loadingFbaSection) ? (
        <div className="rounded-xl border border-[#e2e8f0] bg-white px-5 py-10 text-center text-sm text-[#6b7280] shadow-sm">
          <LoadingState label="Loading awaiting FBA labels..." delay={0} />
        </div>
      ) : awaitingFbaRows.length > 0 ? (
        <div className={awaitingFbaOnly ? '' : 'mb-8'}>
          <div className="mb-4 flex items-center justify-between gap-4">
            <div>
              <h2 className="text-2xl font-bold text-[#132347]">Awaiting FBA Labels</h2>
              <p className="mt-1 text-sm text-[#6b7280]">
                Upload Amazon FBA shipping labels for the boxes below before they can be dispatched.
              </p>
            </div>
            <span className="shrink-0 rounded-full bg-red-100 px-3 py-1 text-xs font-semibold text-red-600">
              {totalBoxesNeedingLabels} box{totalBoxesNeedingLabels !== 1 ? 'es' : ''} pending
            </span>
          </div>

          <div className="space-y-4">
            {awaitingFbaRows.map(({ shipment, shipmentId, boxes: allBoxes }) => {
              const missingCount = allBoxes.length;

              return (
                <div key={shipmentId} className="overflow-hidden rounded-xl border border-[#e2e8f0] bg-white shadow-sm">
                  <div className="flex items-center justify-between gap-4 border-b border-[#e2e8f0] bg-[#f8fafc] px-5 py-3">
                    <div className="flex items-center gap-3">
                      <span className="text-sm font-semibold text-[#132347]">
                        {shipment.reference || shipmentId}
                      </span>
                      <span className="rounded-full bg-[#fff7ed] px-2 py-0.5 text-[11px] font-semibold uppercase text-[#ff8c2f]">
                        {shipment.status}
                      </span>
                    </div>
                    <span className="text-xs text-[#6b7280]">
                      {missingCount} label{missingCount !== 1 ? 's' : ''} missing
                    </span>
                  </div>

                  <div className="divide-y divide-[#f1f5f9]">
                    {getBoxesGroupedBySku(allBoxes, shipment).map((group) => (
                      <div key={group.key}>
                        <div className="bg-[#f8fafc] px-5 py-2 text-xs font-semibold uppercase tracking-wide text-[#64748b]">
                          {(() => {
                            const palletGroup = group.boxes.every(({ box }) => getBoxType(box) === 'pallet');
                            const unitLabel = palletGroup ? 'pallet' : 'box';
                            return `${group.label || 'SKU allocation pending'} - ${group.boxes.length} ${unitLabel}${group.boxes.length !== 1 ? 's' : ''}`;
                          })()}
                        </div>
                        <div className="divide-y divide-[#f1f5f9]">
                          {group.boxes.map(({ box, originalIndex }) => {
                      const boxIndex = originalIndex;
                      const boxId = getBoxItemsLookupId(box);
                      const labelReady = isBoxLabelReadyInSection(box);
                      const uploadKey = `${shipmentId}-${boxId}`;
                      const isUploading = uploadingFbaBoxKey === uploadKey;
                      const contentsStr = getBoxContentsSummary(box, shipment, boxIndex);
                      const primarySku = getPrimaryBoxSku(box, shipment, boxIndex);
                      const totalQuantity = getBoxTotalQuantity(box, shipment, boxIndex);
                      const boxType = getBoxType(box);
                      const boxNumber = firstPresent(box?.box_number, box?.boxNumber, boxIndex + 1);
                      const boxSize = getBoxSize(box);
                      const isPallet = boxType === 'pallet';
                      const palletChildren = getPalletChildBoxes(box);
                      const palletChildCount = getPalletChildCount(box);
                      const palletDimensions = getBoxDimensions(box);
                      const palletWeight = getBoxWeight(box);
                      const palletSummary = [
                        palletDimensions,
                        palletWeight ? `${palletWeight} KG` : '',
                        `${palletChildCount || 0} box${Number(palletChildCount) === 1 ? '' : 'es'}`,
                      ].filter(Boolean).join(' - ');

                      return (
                        <div
                          key={boxId || boxIndex}
                          role="button"
                          tabIndex={0}
                          onClick={() => setSelectedFbaBoxDetail({ shipment, box, boxIndex })}
                          onKeyDown={(event) => {
                            if (event.key === 'Enter' || event.key === ' ') {
                              event.preventDefault();
                              setSelectedFbaBoxDetail({ shipment, box, boxIndex });
                            }
                          }}
                          className={`grid items-center gap-4 px-5 py-4 md:grid-cols-[auto_minmax(0,1fr)_auto_auto] ${
                            labelReady ? 'bg-white' : 'bg-[#fffbf7]'
                          } cursor-pointer transition-colors hover:bg-[#f8fafc]`}
                        >
                          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-[#f1f5f9] text-sm font-bold text-[#132347]">
                            {boxNumber}
                          </div>

                          <div className="min-w-0">
                            <p className="text-sm font-medium text-[#132347]">
                              {boxType === 'pallet' ? 'Pallet' : 'Box'} #{boxNumber}
                              {!isPallet && boxSize ? ` - ${boxSize}` : ''}
                            </p>
                            {box.__subShipmentReference ? (
                              <p className="mt-0.5 text-xs font-semibold text-[#ff6900]">
                                Sub-shipment: {box.__subShipmentReference}
                              </p>
                            ) : null}
                            {isPallet ? (
                              <>
                                <p className="mt-0.5 text-sm font-semibold text-[#132347]">
                                  {palletSummary || 'Pallet details pending'}
                                </p>
                                {palletChildren.length ? (
                                  <p className="mt-0.5 text-xs text-[#64748b]">
                                    Boxes: {palletChildren.map((childBox, childIndex) => getBoxDisplayTitle(childBox, childIndex)).join(', ')}
                                  </p>
                                ) : (
                                  <p className="mt-0.5 text-xs text-[#64748b]">No child boxes returned for this pallet.</p>
                                )}
                              </>
                            ) : (
                              <>
                                {contentsStr && contentsStr !== '-' ? (
                                  <p className="mt-0.5 text-sm font-semibold text-[#132347]">
                                    Contents: {contentsStr}
                                  </p>
                                ) : primarySku ? (
                                  <p className="mt-0.5 text-sm font-semibold text-[#132347]">SKU: {primarySku}</p>
                                ) : null}
                                {totalQuantity !== '' ? (
                                  <p className="mt-0.5 text-xs text-[#64748b]">Units: {totalQuantity}</p>
                                ) : null}
                              </>
                            )}
                            {/* <p className="mt-0.5 truncate text-xs text-[#6b7280]">
                              {[dimStr, weightStr, contentsStr].filter(Boolean).join(' - ')}
                            </p> */}
                          </div>

                          <div>
                            {labelReady ? (
                              <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-700">
                                <Check size={13} />
                                {isPallet ? 'Pallet Label Uploaded' : 'Label Uploaded'}
                              </span>
                            ) : (
                              <span className="inline-flex items-center gap-1.5 rounded-full bg-red-50 px-3 py-1 text-xs font-semibold text-red-600">
                                {isPallet ? 'Pallet Label Missing' : 'Label Missing'}
                              </span>
                            )}
                          </div>

                          <div>
                            {!labelReady ? (
                              <label
                                onClick={(event) => event.stopPropagation()}
                                className={`inline-flex cursor-pointer items-center gap-2 rounded-lg bg-[#ff9d3a] px-4 py-2 text-xs font-semibold text-white hover:bg-[#f28a18] ${
                                  isUploading || !boxId ? 'pointer-events-none opacity-60' : ''
                                }`}
                              >
                                {isUploading ? 'Uploading...' : 'Upload FBA Label'}
                                <input
                                  type="file"
                                  accept=".pdf,image/*"
                                  className="hidden"
                                  disabled={!boxId || isUploading}
                                  onChange={(event) => {
                                    const file = event.target.files?.[0] || null;
                                    event.target.value = '';
                                    handleUploadFbaLabelInSection(shipment, box, boxIndex, file);
                                  }}
                                />
                              </label>
                            ) : (
                              <button
                                type="button"
                                onClick={(event) => {
                                  event.stopPropagation();
                                  const file = fbaLabelFilesMap[boxId];
                                  if (file) openOrDownloadFile(file);
                                }}
                                disabled={!fbaLabelFilesMap[boxId]}
                                className="rounded-lg border border-[#d1d5db] px-4 py-2 text-xs font-medium text-[#374151] hover:bg-[#f9fafb] disabled:cursor-not-allowed disabled:opacity-60"
                              >
                                View Label
                              </button>
                            )}
                          </div>
                        </div>
                      );
                    })}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ) : showEmptyState ? (
        <div className="rounded-xl border border-[#e2e8f0] bg-white px-5 py-10 text-center text-sm text-[#6b7280] shadow-sm">
          No boxes are currently awaiting FBA labels.
        </div>
      ) : null}
    </>
  );

  return (
    <LayoutClient>
      <div className="min-h-screen ">
        <div className=" mx-auto">
          {toast ? (
            <div className="fixed right-6 top-20 z-[130]">
              <div className={`rounded-lg border px-4 py-3 text-sm shadow-lg ${toastStyles[toast.type] || toastStyles.error}`}>
                {toast.message}
              </div>
            </div>
          ) : null}

          <div className="mb-8 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
            {/* <div>
              <h1 className="mb-2 text-2xl font-bold text-gray-900">
                {awaitingFbaOnly ? 'Awaiting FBA Labels' : isCreateMode ? 'Submit Shipment' : 'My Shipments'}
              </h1>
              {awaitingFbaOnly ? (
                <p className="text-sm text-[#64748b]">Upload Amazon FBA shipping labels for boxes that are ready for client action.</p>
              ) : isCreateMode ? (
                <p className="text-sm text-[#64748b]">Create a new outbound logistics request.</p>
              ) : null}
            </div> */}
            {isCreateMode && !awaitingFbaOnly ? (
              <div className="flex flex-wrap items-center gap-3">
                <button
                  type="button"
                  onClick={() => csvInputRef.current?.click()}
                  className="inline-flex items-center gap-2 rounded-lg border border-[#dbe3ef] bg-white px-4 py-2 text-sm font-semibold text-[#132347] hover:bg-[#f8fafc]"
                >
                  <Upload size={14} />
                  Import CSV
                </button>
                <input
                  ref={csvInputRef}
                  type="file"
                  accept=".csv,text/csv"
                  className="hidden"
                  onChange={(event) => {
                    const file = event.target.files?.[0] || null;
                    event.target.value = '';
                    handleImportCsvFile(file);
                  }}
                />
                <button
                  type="button"
                  onClick={handleDownloadShipmentGuide}
                  className="inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-semibold text-[#ff6900] hover:bg-[#fff7ed]"
                >
                  <Download size={14} />
                  Guide PDF
                </button>
              </div>
            ) : null}
          </div>

          {message ? <p className="mb-4 rounded-lg border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-700">{message}</p> : null}
          {error ? <p className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p> : null}

          {awaitingFbaOnly ? (
            renderAwaitingFbaLabelsSection(true)
          ) : isCreateMode ? (
            <div className={editingShipmentId ? 'fixed inset-0 z-50 overflow-y-auto bg-slate-900/55 px-4 py-6' : 'space-y-6'}>
              {editingShipmentId ? (
                <div className="mx-auto flex max-w-7xl items-center justify-between rounded-t-2xl border border-b-0 border-[#dfe7f3] bg-white px-5 py-4 shadow-2xl">
                  <div>
                    <h2 className="text-lg font-semibold text-[#132347]">Edit Draft Shipment</h2>
                    <p className="mt-1 text-xs text-[#6b7280]">Update the draft and save it before submitting.</p>
                  </div>
                  <button
                    type="button"
                    onClick={closeCreateShipmentForm}
                    className="inline-flex h-9 w-9 items-center justify-center rounded-md border border-[#d5dee9] text-[#64748b] hover:bg-[#f8fafc] hover:text-[#132347]"
                    aria-label="Close edit draft"
                  >
                    <X size={16} />
                  </button>
                </div>
              ) : null}
              <div className={editingShipmentId ? 'mx-auto max-w-7xl space-y-5 border-x border-[#dfe7f3] bg-white p-5 shadow-2xl' : 'space-y-5'}>
                <div className="rounded-2xl border border-[#dfe7f3] bg-white p-5 shadow-sm">
                  <div className="mb-4 flex items-center gap-2 text-[15px] font-semibold text-[#132347]">
                    <span className="text-[#ff6900]">📄</span>
                    Shipment Details
                  </div>
                  <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                    <div>
                      <label className="mb-2 block text-[10px] font-semibold uppercase tracking-[0.14em] text-[#6b7280]">
                        Tracking Number (Optional)
                      </label>
                      <input
                        type="text"
                        placeholder="e.g. UPS-123456789"
                        value={createForm.trackingNumber}
                        onChange={(e) => setCreateForm((prev) => ({ ...prev, trackingNumber: e.target.value }))}
                        className="w-full rounded-lg border border-[#dbe3ef] px-4 py-3 text-sm text-[#132347] outline-none focus:ring-2 focus:ring-[#ff6900]"
                      />
                    </div>
                    <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                      <div>
                        <label className="mb-2 block text-[10px] font-semibold uppercase tracking-[0.14em] text-[#6b7280]">
                          Expected Date
                        </label>
                        <input
                          type="date"
                          value={createForm.expectedArrivalDate}
                          onChange={(e) => setCreateForm((prev) => ({ ...prev, expectedArrivalDate: e.target.value }))}
                          className="w-full rounded-lg border border-[#dbe3ef] px-4 py-3 text-sm text-[#132347] outline-none focus:ring-2 focus:ring-[#ff6900]"
                        />
                      </div>
                      <div>
                        <label className="mb-2 block text-[10px] font-semibold uppercase tracking-[0.14em] text-[#6b7280]">
                          No. Of Boxes
                        </label>
                        <input
                          type="number"
                          min="0"
                          value={createForm.boxCount}
                          onChange={(e) => setCreateForm((prev) => ({ ...prev, boxCount: e.target.value }))}
                          className="w-full rounded-lg border border-[#dbe3ef] px-4 py-3 text-sm text-[#132347] outline-none focus:ring-2 focus:ring-[#ff6900]"
                        />
                      </div>
                      <div>
                        <label className="mb-2 block text-[10px] font-semibold uppercase tracking-[0.14em] text-[#6b7280]">
                          No. Of Pallets
                        </label>
                        <input
                          type="number"
                          min="0"
                          value={createForm.palletCount}
                          onChange={(e) => setCreateForm((prev) => ({ ...prev, palletCount: e.target.value }))}
                          className="w-full rounded-lg border border-[#dbe3ef] px-4 py-3 text-sm text-[#132347] outline-none focus:ring-2 focus:ring-[#ff6900]"
                        />
                      </div>
                    </div>
                    
                    <div className="md:col-span-2">
                      <label className="mb-2 block text-[10px] font-semibold uppercase tracking-[0.14em] text-[#6b7280]">
                        Special Instructions
                      </label>
                      <textarea
                        placeholder="Any specific handling requirements or gate codes..."
                        value={createForm.notes}
                        onChange={(e) => setCreateForm((prev) => ({ ...prev, notes: e.target.value }))}
                        className="min-h-[120px] w-full rounded-lg border border-[#dbe3ef] px-4 py-3 text-sm text-[#132347] outline-none focus:ring-2 focus:ring-[#ff6900]"
                      />
                    </div>
                  </div>
                </div>

                <div className="rounded-2xl border border-[#dfe7f3] bg-white p-5 shadow-sm">
                  <div className="mb-4 flex items-center justify-between">
                    <h3 className="text-[24px] font-semibold text-[#132347]">Product Line Items</h3>
                    <span className="text-xs text-[#6b7280]">{productItems.length} Item Added</span>
                  </div>

                  <div className="space-y-4">
                    {productItems.map((item, index) => (
                      <div key={`product-item-${index}`} className="rounded-2xl border border-[#e4ebf4] p-4">
                        <div className="mb-3 flex items-center justify-end">
                          <button
                            type="button"
                            onClick={() => handleRemoveProductItem(index)}
                            className="inline-flex items-center gap-1 text-xs font-medium text-[#ef4444]"
                          >
                            <Trash2 size={12} />
                            Remove
                          </button>
                        </div>

                        <div className="grid grid-cols-1 gap-4 md:grid-cols-[minmax(0,1fr)_140px]">
                          <div>
                            <label className="mb-2 block text-[10px] font-semibold uppercase tracking-[0.14em] text-[#6b7280]">
                              Product
                            </label>
                            <input
                              type="text"
                              placeholder="SG-LAMP-01 - LED Desk Lamp"
                              value={item.productName}
                              onChange={(e) => updateProductItem(index, 'productName', e.target.value)}
                              className="w-full rounded-lg border border-[#dbe3ef] px-4 py-3 text-sm text-[#132347] outline-none focus:ring-2 focus:ring-[#ff6900]"
                            />
                          </div>
                          <div>
                            <label className="mb-2 block text-[10px] font-semibold uppercase tracking-[0.14em] text-[#6b7280]">
                              FNSKU
                            </label>
                            <input
                              type="text"
                              placeholder="X001ABC234"
                              value={item.fnskuLabel}
                              onChange={(e) => updateProductItem(index, 'fnskuLabel', e.target.value)}
                              className="w-full rounded-lg border border-[#dbe3ef] px-4 py-3 text-sm text-[#132347] outline-none focus:ring-2 focus:ring-[#ff6900]"
                            />
                          </div>
                          <div>
                            <label className="mb-2 block text-[10px] font-semibold uppercase tracking-[0.14em] text-[#6b7280]">
                              SKU
                            </label>
                            <ProductSkuCombobox
                              value={item.sku}
                              options={skuOptions}
                              loading={isSkuOptionsLoading}
                              placeholder={isSkuOptionsLoading ? 'Loading SKUs...' : 'Search or create SKU'}
                              onChange={(value) => handleSkuChange(index, value)}
                              onSelect={(product) => handleSkuProductSelect(index, product)}
                              inputClassName="w-full rounded-lg border border-[#dbe3ef] py-3 pr-4 text-sm text-[#132347] outline-none focus:ring-2 focus:ring-[#ff6900]"
                            />
                          </div>
                          <div>
                            <label className="mb-2 block text-[10px] font-semibold uppercase tracking-[0.14em] text-[#6b7280]">
                              Qty Expected
                            </label>
                            <input
                              type="number"
                              min="1"
                              value={item.expectedQty}
                              onChange={(e) => updateProductItem(index, 'expectedQty', e.target.value)}
                              className="w-full rounded-lg border border-[#dbe3ef] px-4 py-3 text-sm text-[#132347] outline-none focus:ring-2 focus:ring-[#ff6900]"
                            />
                          </div>
                        </div>

                        <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-[minmax(0,1fr)_120px]">
                          <div>
                            <label className="mb-2 block text-[10px] font-semibold uppercase tracking-[0.14em] text-[#6b7280]">
                              FNSKU Label PDF / CSV
                            </label>
                            <label
                              className="flex cursor-pointer items-center justify-between rounded-xl border border-dashed border-[#dbe3ef] px-4 py-3 text-sm text-[#132347]"
                              onDragOver={(event) => {
                                event.preventDefault();
                              }}
                              onDrop={(event) => {
                                event.preventDefault();
                                handleProductLabelFile(index, event.dataTransfer.files?.[0] || null);
                              }}
                            >
                              <span className="flex items-center gap-3">
                                <FileUp size={16} className="text-[#ff6900]" />
                                <span>{item.fileName || 'Drop labels here'}</span>
                              </span>
                              <span className="rounded-md bg-[#f8fafc] px-3 py-1 text-[11px] font-semibold text-[#132347]">Browse</span>
                              <input
                                type="file"
                                accept=".pdf,.csv,application/pdf,text/csv,application/vnd.ms-excel,image/*"
                                className="hidden"
                                onChange={(e) => {
                                  handleProductLabelFile(index, e.target.files?.[0] || null);
                                  e.target.value = '';
                                }}
                              />
                            </label>
                          </div>
                          <div>
                            <label className="mb-2 block text-[10px] font-semibold uppercase tracking-[0.14em] text-[#6b7280]">
                              Bundle Size
                            </label>
                            <input
                              type="number"
                              value={item.needsBundling ? item.bundleSize : ''}
                              onChange={(e) => updateProductItem(index, 'bundleSize', e.target.value)}
                              disabled={!item.needsBundling}
                              className="w-full rounded-lg border border-[#dbe3ef] px-4 py-3 text-sm text-[#132347] outline-none focus:ring-2 focus:ring-[#ff6900] disabled:cursor-not-allowed disabled:bg-[#f8fafc] disabled:text-[#94a3b8] disabled:focus:ring-0"
                            />
                          </div>
                        </div>

                        <label className="mt-4 inline-flex items-center gap-2 text-sm text-[#4b5563]">
                          <input
                            type="checkbox"
                            checked={item.needsBundling}
                            onChange={(e) => updateProductItem(index, 'needsBundling', e.target.checked)}
                            className="h-4 w-4 rounded border-gray-300 text-[#ff6900] focus:ring-[#ff6900]"
                          />
                          Does This Product Need Bundling
                        </label>

                        <div className="mt-5">
                          <label className="mb-2 block text-[10px] font-semibold uppercase tracking-[0.14em] text-[#6b7280]">
                            Services Required
                          </label>
                          <div className="grid grid-cols-1 gap-3">
                            <select
                              value={item.serviceType}
                              onChange={(e) => addServiceToItem(index, e.target.value)}
                              className="rounded-lg border border-[#dbe3ef] px-4 py-3 text-sm text-[#132347] outline-none focus:ring-2 focus:ring-[#ff6900]"
                            >
                              <option value="">Add service</option>
                              {SELECTABLE_SERVICE_OPTIONS.map((service) => (
                                <option key={service.value} value={service.value}>{service.label}</option>
                              ))}
                            </select>
                            {item.serviceType === 'OTHER' ? (
                              <div className="grid grid-cols-1 gap-3 sm:grid-cols-[minmax(0,1fr)_120px]">
                                <input
                                  type="text"
                                  value={item.customServiceName || ''}
                                  onChange={(e) => updateProductItem(index, 'customServiceName', e.target.value)}
                                  onKeyDown={(event) => {
                                    if (event.key === 'Enter') {
                                      event.preventDefault();
                                      addCustomServiceToItem(index);
                                    }
                                  }}
                                  placeholder="Type custom service"
                                  className="min-w-0 rounded-lg border border-[#dbe3ef] px-4 py-3 text-sm text-[#132347] outline-none focus:ring-2 focus:ring-[#ff6900]"
                                />
                                <button
                                  type="button"
                                  onClick={() => addCustomServiceToItem(index)}
                                  className="rounded-lg bg-[#132347] px-4 py-3 text-sm font-semibold text-white hover:bg-[#0f1b38]"
                                >
                                  Add
                                </button>
                              </div>
                            ) : null}
                          </div>

                          {(item.services || []).length ? (
                            <div className="mt-4 flex flex-wrap gap-3">
                              {item.services
                                .map((service, serviceIndex) => ({ service, serviceIndex }))
                                .map(({ service, serviceIndex }) => (
                                  <div key={`${service}-${serviceIndex}`} className="flex items-center gap-3 rounded-lg border border-[#e2e8f0] bg-white px-4 py-3 text-sm text-[#132347]">
                                    <span>{formatServiceLabel(service)}</span>
                                    <button
                                      type="button"
                                      onClick={() => handleRemoveService(index, serviceIndex)}
                                      className="text-gray-400 hover:text-gray-700"
                                    >
                                      <X size={14} />
                                    </button>
                                  </div>
                                ))}
                            </div>
                          ) : null}
                        </div>
                      </div>
                    ))}
                  </div>

                  <button
                    type="button"
                    onClick={handleAddProductItem}
                    className="mt-4 w-full rounded-2xl border border-dashed border-[#d5dfec] bg-[#fafcff] px-5 py-4 text-sm font-semibold text-[#4b5563] hover:border-[#ff9900] hover:text-[#ff9900]"
                  >
                    Add Another Product
                  </button>
                </div>
              </div>

              <div className={editingShipmentId ? 'mx-auto max-w-7xl rounded-b-2xl border border-t-0 border-[#dfe7f3] bg-white p-5 shadow-2xl' : 'rounded-2xl border border-[#dfe7f3] bg-white p-5 shadow-sm'}>
                <div className="flex flex-col gap-3 sm:flex-row sm:justify-end">
                  <button
                    type="button"
                    onClick={() => handleCreateShipment(true)}
                    disabled={Boolean(savingAction)}
                    className="w-full rounded-lg border border-[#d5dee9] bg-white px-4 py-3 text-sm font-semibold text-[#132347] hover:bg-[#f8fafc] disabled:opacity-60 sm:w-40"
                  >
                    {savingAction === 'draft' ? 'Saving...' : 'Save Draft'}
                  </button>
                  <button
                    type="button"
                    onClick={() => handleCreateShipment(false)}
                    disabled={Boolean(savingAction)}
                    className="w-full rounded-lg bg-[#ff9900] px-4 py-3 text-sm font-semibold text-white hover:bg-[#eb8d00] disabled:opacity-60 sm:w-40"
                  >
                    {savingAction === 'submit' ? 'Submitting...' : 'Submit'}
                  </button>
                </div>
              </div>
            </div>
          ) : showTrackModal && selectedShipment ? (
            renderTrackSection()
          ) : (
            <>
          {false && fbaLabelShipments.length > 0 ? (
            <div className="mb-8">
              <div className="mb-4 flex items-center justify-between gap-4">
                <div>
                  <h2 className="text-lg font-semibold text-[#132347]">Awaiting FBA Labels</h2>
                  <p className="mt-1 text-sm text-[#6b7280]">
                    Upload Amazon FBA shipping labels for the boxes below before they can be dispatched.
                  </p>
                </div>
                <span className="shrink-0 rounded-full bg-red-100 px-3 py-1 text-xs font-semibold text-red-600">
                  {totalBoxesNeedingLabels} box{totalBoxesNeedingLabels !== 1 ? 'es' : ''} pending
                </span>
              </div>

              <div className="space-y-4">
                {fbaLabelShipments.map((shipment) => {
                  const shipmentId = getShipmentId(shipment);
                  const allBoxes = fbaLabelBoxesMap[shipmentId] || [];
                  const missingCount = allBoxes.filter((box) => !isBoxLabelReadyInSection(box)).length;

                  return (
                    <div key={shipmentId} className="overflow-hidden rounded-xl border border-[#e2e8f0] bg-white shadow-sm">
                      <div className="flex items-center justify-between gap-4 border-b border-[#e2e8f0] bg-[#f8fafc] px-5 py-3">
                        <div className="flex items-center gap-3">
                          <span className="text-sm font-semibold text-[#132347]">
                            {shipment.reference || shipmentId}
                          </span>
                          <span className="rounded-full bg-[#fff7ed] px-2 py-0.5 text-[11px] font-semibold uppercase text-[#ff8c2f]">
                            {shipment.status}
                          </span>
                        </div>
                        <span className="text-xs text-[#6b7280]">
                          {missingCount} label{missingCount !== 1 ? 's' : ''} missing
                        </span>
                      </div>

                      <div className="divide-y divide-[#f1f5f9]">
                        {allBoxes.map((box, boxIndex) => {
                          const boxId = getBoxItemsLookupId(box);
                          const labelReady = isBoxLabelReadyInSection(box);
                          const uploadKey = `${shipmentId}-${boxId}`;
                          const isUploading = uploadingFbaBoxKey === uploadKey;
                          const dims = [box?.length_cm, box?.width_cm, box?.height_cm]
                            .filter((value) => Number(value) > 0)
                            .map((value) => Number(value))
                            .join('x');
                          const dimStr = dims ? `${dims} CM` : '';
                          const weightStr = Number(box?.weight_kg || 0) > 0 ? `${Number(box.weight_kg)} KG` : '';
                          const contents = Array.isArray(box?.contents) ? box.contents : [];
                          const contentsStr = contents.length
                            ? contents.map((item) => `${item?.sku || 'SKU'} x ${item?.quantity || 0}`).join(', ')
                            : '-';

                          return (
                            <div
                              key={boxId || boxIndex}
                              className={`grid items-center gap-4 px-5 py-4 md:grid-cols-[auto_minmax(0,1fr)_auto_auto] ${
                                labelReady ? 'bg-white' : 'bg-[#fffbf7]'
                              }`}
                            >
                              <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-[#f1f5f9] text-sm font-bold text-[#132347]">
                                {box?.box_number || boxIndex + 1}
                              </div>

                              <div className="min-w-0">
                                <p className="text-sm font-medium text-[#132347]">
                                  {box?.box_type === 'pallet' ? 'Pallet' : 'Box'} #{box?.box_number || boxIndex + 1}
                                  {box?.box_size ? ` - ${box.box_size}` : ''}
                                </p>
                                <p className="mt-0.5 truncate text-xs text-[#6b7280]">
                                  {[dimStr, weightStr, contentsStr].filter(Boolean).join(' · ')}
                                </p>
                              </div>

                              <div>
                                {labelReady ? (
                                  <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-700">
                                    <Check size={13} />
                                    Label Uploaded
                                  </span>
                                ) : (
                                  <span className="inline-flex items-center gap-1.5 rounded-full bg-red-50 px-3 py-1 text-xs font-semibold text-red-600">
                                    Label Missing
                                  </span>
                                )}
                              </div>

                              <div>
                                {!labelReady ? (
                                  <label
                                    className={`inline-flex cursor-pointer items-center gap-2 rounded-lg bg-[#ff9d3a] px-4 py-2 text-xs font-semibold text-white hover:bg-[#f28a18] ${
                                      isUploading || !boxId ? 'pointer-events-none opacity-60' : ''
                                    }`}
                                  >
                                    {isUploading ? 'Uploading...' : 'Upload FBA Label'}
                                    <input
                                      type="file"
                                      accept=".pdf,image/*"
                                      className="hidden"
                                      disabled={!boxId || isUploading}
                                      onChange={(event) => {
                                        const file = event.target.files?.[0] || null;
                                        event.target.value = '';
                                        handleUploadFbaLabelInSection(shipment, box, boxIndex, file);
                                      }}
                                    />
                                  </label>
                                ) : (
                                  <button
                                    type="button"
                                    onClick={() => {
                                      const file = fbaLabelFilesMap[boxId];
                                      if (file) openOrDownloadFile(file);
                                    }}
                                    disabled={!fbaLabelFilesMap[boxId]}
                                    className="rounded-lg border border-[#d1d5db] px-4 py-2 text-xs font-medium text-[#374151] hover:bg-[#f9fafb] disabled:cursor-not-allowed disabled:opacity-60"
                                  >
                                    View Label
                                  </button>
                                )}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ) : null}

          <div className="flex items-center gap-4 mb-6 flex-wrap">
            <div className="relative">
              <select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
                className="appearance-none bg-white border border-gray-200 rounded-lg px-4 py-2.5 pr-10 text-sm font-medium text-gray-700"
              >
                <option value="all">All statuses</option>
                <option value="draft">Draft</option>
                <option value="submitted">Submitted</option>
                <option value="pending_arrival">Pending Arrival</option>
                <option value="received">Received</option>
                <option value="in_progress">In Progress</option>
                <option value="prepped">Prepped</option>
                <option value="dispatched">Dispatched</option>
                <option value="completed">Completed</option>
              </select>
              <ChevronDown size={16} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
            </div>

            <div className="relative">
              <input
                type="text"
                value={dateFilter}
                onChange={(e) => setDateFilter(e.target.value)}
                placeholder="2026-05"
                className="bg-white border border-gray-200 rounded-lg px-4 py-2.5 text-sm font-medium text-gray-700 w-36"
              />
              <Calendar size={16} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
            </div>

            <div className="relative flex-1 min-w-[200px] max-w-md">
              <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
              <input
                type="text"
                placeholder="Search shipments..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full bg-white border border-gray-200 rounded-lg py-2.5 pl-9 pr-4 text-sm"
              />
            </div>

            <button onClick={loadShipments} className="rounded-lg border border-gray-200 bg-white px-4 py-2.5 text-sm font-medium text-gray-700 hover:bg-gray-50">
              Refresh
            </button>
          </div>

          <div className="bg-white rounded-xl border border-gray-200 overflow-hidden shadow-sm">
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-gray-100 bg-gray-50/50">
                    <th className="text-left py-4 px-6 text-xs font-semibold uppercase tracking-wider text-gray-500">REFERENCE</th>
                    <th className="text-left py-4 px-6 text-xs font-semibold uppercase tracking-wider text-gray-500">CREATED DATE</th>
                    <th className="text-left py-4 px-6 text-xs font-semibold uppercase tracking-wider text-gray-500">EXPECTED DATE</th>
                    <th className="text-left py-4 px-6 text-xs font-semibold uppercase tracking-wider text-gray-500">ARRIVED</th>
                    <th className="text-left py-4 px-6 text-xs font-semibold uppercase tracking-wider text-gray-500">UNITS</th>
                    <th className="text-left py-4 px-6 text-xs font-semibold uppercase tracking-wider text-gray-500">SERVICES</th>
                    <th className="text-left py-4 px-6 text-xs font-semibold uppercase tracking-wider text-gray-500">STATUS</th>
                    <th className="text-left py-4 px-6 text-xs font-semibold uppercase tracking-wider text-gray-500">ACTION</th>
                  </tr>
                </thead>
                <tbody>
                  {isLoading ? (
                    <tr>
                      <td colSpan="8" className="px-6 py-10 text-center text-sm text-gray-500">
                        <LoadingState label="Loading shipments..." />
                      </td>
                    </tr>
                  ) : paginatedShipments.length ? paginatedShipments.map((shipment) => (
                    <tr key={shipment.id} className="border-b border-gray-50 hover:bg-gray-50/30 transition-colors last:border-b-0">
                      <td className="py-4 px-6 text-sm font-semibold text-blue-600">{shipment.reference}</td>
                      <td className="py-4 px-6 text-sm text-gray-700">{shipment.created}</td>
                      <td className="py-4 px-6 text-sm text-gray-700">{shipment.expected}</td>
                      <td className="py-4 px-6 text-sm text-gray-700">{shipment.arrived}</td>
                      <td className="py-4 px-6 text-sm font-medium text-gray-900">{Number(shipment.units).toLocaleString()}</td>
                      <td className="py-4 px-6 text-sm text-gray-700">{shipment.services}</td>
                      <td className="py-4 px-6 text-sm">
                        <span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-semibold ${getShipmentStatusBadgeClass(shipment.status)}`}>
                          {shipment.status}
                        </span>
                      </td>
                      <td className="py-4 px-6">
                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            onClick={() => handleViewShipment(shipment)}
                            title="View shipment"
                            aria-label="View shipment"
                            className="inline-flex h-9 w-9 items-center justify-center rounded-md border border-transparent text-[#475569] hover:border-[#dbe3ef] hover:bg-[#f8fafc] hover:text-[#334155]"
                          >
                            <Eye size={14} />
                          </button>
                          <button
                            type="button"
                            onClick={() => handleEditDraft(shipment)}
                            disabled={!canEditDraftShipment(shipment)}
                            title={canEditDraftShipment(shipment) ? 'Edit draft' : 'Only draft shipments can be edited'}
                            aria-label="Edit shipment"
                            className="inline-flex h-9 w-9 items-center justify-center rounded-md border border-[#d5dee9] text-[#475569] hover:bg-[#f8fafc] disabled:cursor-not-allowed disabled:opacity-40"
                          >
                            <Pencil size={14} />
                          </button>
                          <button
                            type="button"
                            onClick={() => requestDeleteShipment(shipment)}
                            disabled={deletingShipmentId === (getShipmentRecordId(shipment) || getShipmentId(shipment))}
                            title="Delete shipment"
                            aria-label="Delete shipment"
                            className="inline-flex h-9 w-9 items-center justify-center rounded-md border border-red-100 text-red-500 hover:bg-red-50 disabled:cursor-wait disabled:opacity-50"
                          >
                            <Trash2 size={14} />
                          </button>
                          <button
                            type="button"
                            onClick={() => handleTrackShipment(shipment)}
                            className="rounded-md border border-[#f7d8c0] px-3 py-1.5 text-sm font-medium text-[#ff8c2f] hover:bg-[#fff7ed]"
                          >
                            Track
                          </button>
                        </div>
                      </td>
                    </tr>
                  )) : (
                    <tr>
                      <td colSpan="8" className="px-6 py-10 text-center text-sm text-gray-500">
                        No shipments found.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
            <div className="flex flex-col gap-3 border-t border-gray-100 bg-white px-6 py-4 text-sm text-gray-500 md:flex-row md:items-center md:justify-between">
              <span>
                Showing {firstVisibleShipment}-{lastVisibleShipment} of {filteredShipments.length} shipments
              </span>
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => setCurrentPage((page) => Math.max(1, page - 1))}
                  disabled={currentShipmentPage === 1 || isLoading}
                  className="rounded-lg border border-gray-200 px-3 py-1.5 font-medium text-gray-600 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  Previous
                </button>
                {shipmentPageNumbers.map((pageNumber) => (
                  <button
                    key={pageNumber}
                    type="button"
                    onClick={() => setCurrentPage(pageNumber)}
                    disabled={isLoading}
                    className={`h-8 min-w-8 rounded-lg border px-2 text-sm font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
                      pageNumber === currentShipmentPage
                        ? 'border-[#ff9900] bg-[#ff9900] text-white'
                        : 'border-gray-200 bg-white text-gray-600 hover:bg-gray-50'
                    }`}
                    aria-current={pageNumber === currentShipmentPage ? 'page' : undefined}
                  >
                    {pageNumber}
                  </button>
                ))}
                <button
                  type="button"
                  onClick={() => setCurrentPage((page) => Math.min(totalShipmentPages, page + 1))}
                  disabled={currentShipmentPage === totalShipmentPages || isLoading}
                  className="rounded-lg border border-gray-200 px-3 py-1.5 font-medium text-gray-600 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  Next
                </button>
              </div>
            </div>
          </div>
            </>
          )}
        </div>
      </div>

      {batchFbaUpload ? (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-lg overflow-hidden rounded-2xl bg-white shadow-xl">
            {(() => {
              const selectedSet = new Set(batchFbaUpload.selectedBoxIds || []);
              const allSelected = batchFbaUploadOptions.length > 0 && batchFbaUploadOptions.every((option) => selectedSet.has(option.boxId));
              const isUploading = uploadingFbaBoxKey === `batch-${getShipmentId(batchFbaUpload.shipment)}`;

              return (
                <>
                  <div className="flex items-start justify-between gap-4 border-b border-[#e2e8f0] px-6 py-4">
                    <div>
                      <h3 className="text-lg font-semibold text-[#132347]">Apply FBA Label</h3>
                      <p className="mt-1 text-xs text-[#6b7280]">
                        {batchFbaUpload.shipment?.reference || getShipmentId(batchFbaUpload.shipment)}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => setBatchFbaUpload(null)}
                      disabled={isUploading}
                      className="rounded-lg p-1 text-[#94a3b8] hover:bg-[#f8fafc] hover:text-[#132347] disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      <X size={20} />
                    </button>
                  </div>

                  <div className="space-y-4 p-6">
                    <div className="rounded-xl border border-[#e2e8f0] bg-[#f8fafc] px-4 py-3">
                      <p className="truncate text-sm font-semibold text-[#132347]">{batchFbaUpload.file?.name}</p>
                      <p className="mt-1 text-xs text-[#6b7280]">Choose every box that should use this label.</p>
                    </div>

                    <label className="flex items-center gap-3 rounded-lg border border-[#e2e8f0] px-4 py-3 text-sm font-semibold text-[#132347]">
                      <input
                        type="checkbox"
                        checked={allSelected}
                        onChange={(event) => handleSetAllBatchFbaBoxes(event.target.checked)}
                        disabled={isUploading || !batchFbaUploadOptions.length}
                        className="h-4 w-4 accent-[#ff9d3a]"
                      />
                      Select all missing boxes in this shipment
                    </label>

                    <div className="max-h-72 overflow-y-auto rounded-xl border border-[#e2e8f0]">
                      {batchFbaUploadOptions.map(({ box, boxId, index }) => {
                        const contentSummary = getBoxContentsSummary(box, batchFbaUpload.shipment, index);
                        const totalQuantity = getBoxTotalQuantity(box, batchFbaUpload.shipment, index);
                        const boxNumber = firstPresent(box?.box_number, box?.boxNumber, index + 1);
                        const boxType = getBoxType(box) === 'pallet' ? 'Pallet' : 'Box';
                        const boxSize = getBoxSize(box);

                        return (
                          <label key={boxId} className="flex cursor-pointer items-center gap-3 border-b border-[#f1f5f9] px-4 py-3 last:border-b-0">
                            <input
                              type="checkbox"
                              checked={selectedSet.has(boxId)}
                              onChange={() => handleToggleBatchFbaBox(boxId)}
                              disabled={isUploading}
                              className="h-4 w-4 accent-[#ff9d3a]"
                            />
                            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[#f1f5f9] text-xs font-bold text-[#132347]">
                              {boxNumber}
                            </span>
                            <span className="min-w-0">
                              <span className="block text-sm font-semibold text-[#132347]">
                                {boxType} #{boxNumber}{boxSize ? ` - ${boxSize}` : ''}
                              </span>
                              {contentSummary && contentSummary !== '-' ? <span className="block text-xs text-[#64748b]">Contents: {contentSummary}</span> : null}
                              {totalQuantity !== '' ? <span className="block text-xs text-[#64748b]">Units: {totalQuantity}</span> : null}
                            </span>
                          </label>
                        );
                      })}
                    </div>

                    <div className="flex justify-end gap-3">
                      <button
                        type="button"
                        onClick={() => setBatchFbaUpload(null)}
                        disabled={isUploading}
                        className="rounded-lg border border-[#d1d5db] px-4 py-2 text-sm font-semibold text-[#374151] hover:bg-[#f9fafb] disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        Cancel
                      </button>
                      <button
                        type="button"
                        onClick={handleConfirmBatchFbaUpload}
                        disabled={isUploading || !selectedSet.size}
                        className="rounded-lg bg-[#ff9d3a] px-4 py-2 text-sm font-semibold text-white hover:bg-[#f28a18] disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        {isUploading ? 'Uploading...' : `Upload for ${selectedSet.size} box${selectedSet.size !== 1 ? 'es' : ''}`}
                      </button>
                    </div>
                  </div>
                </>
              );
            })()}
          </div>
        </div>
      ) : null}

      {deleteConfirmShipment ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-md overflow-hidden rounded-2xl bg-white shadow-xl">
            {(() => {
              const shipmentId = getShipmentRecordId(deleteConfirmShipment) || getShipmentId(deleteConfirmShipment);
              const shipmentLabel = deleteConfirmShipment?.reference || shipmentId || 'this shipment';
              const isDeleting = Boolean(shipmentId && deletingShipmentId === shipmentId);

              return (
                <>
                  <div className="flex items-start gap-3 border-b border-gray-200 px-6 py-5">
                    <span className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-red-50 text-red-600">
                      <Trash2 size={18} />
                    </span>
                    <div>
                      <h3 className="text-lg font-semibold text-[#132347]">Delete Shipment</h3>
                      <p className="mt-1 text-sm text-gray-600">
                        Delete <span className="font-semibold text-gray-900">{shipmentLabel}</span>? This action cannot be undone.
                      </p>
                    </div>
                  </div>
                  <div className="flex justify-end gap-3 px-6 py-4">
                    <button
                      type="button"
                      onClick={() => setDeleteConfirmShipment(null)}
                      disabled={isDeleting}
                      className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      Cancel
                    </button>
                    <button
                      type="button"
                      onClick={() => handleDeleteShipment(deleteConfirmShipment)}
                      disabled={isDeleting}
                      className="rounded-lg bg-red-600 px-4 py-2 text-sm font-semibold text-white hover:bg-red-700 disabled:cursor-wait disabled:opacity-60"
                    >
                      {isDeleting ? 'Deleting...' : 'Delete'}
                    </button>
                  </div>
                </>
              );
            })()}
          </div>
        </div>
      ) : null}

      {selectedFbaBoxDetail ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-[700px] overflow-hidden rounded-2xl bg-white shadow-xl">
            {(() => {
              const { shipment, box, boxIndex } = selectedFbaBoxDetail;
              const contentRows = getBoxContentRows(box, shipment, boxIndex);
              const contentSummary = getBoxContentsSummary(box, shipment, boxIndex);
              const primarySku = getPrimaryBoxSku(box, shipment, boxIndex);
              const totalQuantity = getBoxTotalQuantity(box, shipment, boxIndex);
              const labelReady = isBoxLabelReadyInSection(box);
              const boxType = getBoxType(box);
              const boxSize = getBoxSize(box);
              const dimensions = getBoxDimensions(box);
              const weight = getBoxWeight(box);
              const boxNumber = firstPresent(box?.box_number, box?.boxNumber, boxIndex + 1);
              const isPallet = boxType === 'pallet';
              const palletChildren = getPalletChildBoxes(box);
              const palletChildCount = getPalletChildCount(box);
              const clientName = getShipmentClientName(shipment);
              const clientEmail = getShipmentClientEmail(shipment);

              return (
                <>
                  <div className="flex items-start justify-between gap-4 border-b border-[#e2e8f0] px-6 py-4">
                    <div>
                      <h3 className="text-lg font-semibold text-[#132347]">
                        {boxType === 'pallet' ? 'Pallet' : 'Box'} #{boxNumber}
                      </h3>
                      <p className="mt-1 text-xs text-[#6b7280]">{shipment?.reference || getShipmentId(shipment)}</p>
                      {clientName || clientEmail ? (
                        <p className="mt-1 text-xs font-semibold text-[#132347]">
                          Client: {clientName || '-'}{clientEmail ? ` (${clientEmail})` : ''}
                        </p>
                      ) : null}
                      {!isPallet && (primarySku || contentSummary !== '-') ? (
                        <p className="mt-1 text-sm font-semibold text-[#132347]">
                          Contents: {contentSummary !== '-' ? contentSummary : primarySku}
                        </p>
                      ) : null}
                    </div>
                    <button
                      type="button"
                      onClick={() => setSelectedFbaBoxDetail(null)}
                      className="rounded-lg p-1 text-[#94a3b8] hover:bg-[#f8fafc] hover:text-[#132347]"
                    >
                      <X size={20} />
                    </button>
                  </div>

                  <div className="space-y-5 p-6">
                    <div className={`grid grid-cols-1 gap-3 text-sm ${isPallet ? 'sm:grid-cols-4' : 'sm:grid-cols-5'}`}>
                      {(isPallet
                        ? [
                            { label: 'Type', value: 'Pallet' },
                            { label: 'Pallet Dimensions', value: dimensions || '-' },
                            { label: 'Pallet Weight', value: weight ? `${weight} KG` : '-' },
                            { label: 'Boxes Inside', value: `${palletChildCount || 0} box${Number(palletChildCount) === 1 ? '' : 'es'}` },
                            { label: 'Pallet FBA Label', value: labelReady ? 'Uploaded' : 'Missing' },
                          ]
                        : [
                            { label: 'Type', value: boxType },
                            { label: 'Size', value: boxSize || '-' },
                            { label: 'Dimensions', value: dimensions || '-' },
                            { label: 'Weight', value: weight ? `${weight} KG` : '-' },
                            { label: 'Contents', value: contentSummary !== '-' ? contentSummary : primarySku || 'Pending' },
                            { label: 'Units', value: totalQuantity !== '' ? totalQuantity : 'Pending' },
                          ]).map((meta) => (
                        <div key={meta.label} className="rounded-xl border border-[#e2e8f0] bg-[#f8fafc] p-3">
                          <p className="text-[10px] font-semibold uppercase tracking-wider text-[#94a3b8]">{meta.label}</p>
                          <p className="mt-1 break-words font-semibold text-[#132347]">{meta.value}</p>
                        </div>
                      ))}
                    </div>

                    <div>
                      <div className="mb-2 flex items-center justify-between">
                        <p className="text-sm font-semibold text-[#132347]">{isPallet ? 'Boxes in this pallet' : 'SKU Allocation'}</p>
                        {labelReady ? (
                          <span className="rounded-full bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-700">{isPallet ? 'Pallet Label Uploaded' : 'Label Uploaded'}</span>
                        ) : (
                          <span className="rounded-full bg-red-50 px-3 py-1 text-xs font-semibold text-red-600">{isPallet ? 'Pallet Label Missing' : 'Label Missing'}</span>
                        )}
                      </div>
                      {isPallet ? (
                        palletChildren.length ? (
                          <div className="overflow-hidden rounded-xl border border-[#e2e8f0]">
                            {palletChildren.map((childBox, childIndex) => {
                              const childDimensions = getBoxDimensions(childBox);
                              const childWeight = getBoxWeight(childBox);
                              const childRows = getBoxRowsForLineItem(childBox, shipment, childIndex);
                              const childSummary = getBoxRowsSummary(childRows);
                              const childLabelReady = isBoxLabelReadyInSection(childBox);

                              return (
                                <div key={getBoxItemsLookupId(childBox) || childIndex} className="border-b border-[#f1f5f9] px-4 py-3 last:border-b-0">
                                  <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                                    <div className="min-w-0">
                                      <p className="text-sm font-semibold text-[#132347]">{getBoxDisplayTitle(childBox, childIndex)}</p>
                                      <p className="mt-1 text-xs text-[#64748b]">
                                        {[childDimensions, childWeight ? `${childWeight} KG` : '', childSummary].filter(Boolean).join(' - ') || 'Box details pending'}
                                      </p>
                                    </div>
                                    <span className={`w-fit rounded-full px-2.5 py-1 text-xs font-semibold ${childLabelReady ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-600'}`}>
                                      {childLabelReady ? 'FBA Label Ready' : 'FBA Label Missing'}
                                    </span>
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        ) : (
                          <div className="rounded-xl border border-dashed border-[#d1d5db] bg-[#f8fafc] px-4 py-6 text-center text-sm text-[#6b7280]">
                            No child boxes returned for this pallet.
                          </div>
                        )
                      ) : contentRows.length ? (
                        <div className="overflow-hidden rounded-xl border border-[#e2e8f0]">
                          {contentRows.map((item, index) => (
                            <div key={item?.id || item?.shipmentItemId || index} className="flex items-center justify-between border-b border-[#f1f5f9] px-4 py-3 last:border-b-0">
                              <span className="text-sm font-medium text-[#132347]">SKU: {item?.sku || 'SKU'}</span>
                              <span className="text-sm text-[#6b7280]">{item?.quantity !== '' ? item.quantity : '-'}</span>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <div className="rounded-xl border border-dashed border-[#d1d5db] bg-[#f8fafc] px-4 py-6 text-center text-sm text-[#6b7280]">
                          SKU allocation data was not returned for this box.
                        </div>
                      )}
                    </div>
                  </div>
                </>
              );
            })()}
          </div>
        </div>
      ) : null}

      {showViewModal && selectedShipment ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-2xl rounded-xl bg-white shadow-xl h-[600px] overflow-y-auto">
            <div className="flex items-center justify-between border-b border-gray-200 px-6 py-4">
              <h3 className="text-lg font-semibold text-gray-900">{selectedShipment.reference || selectedShipment.id}</h3>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={handleRefreshSelectedShipment}
                  disabled={isRefreshingDetails}
                  className="rounded-lg border border-gray-200 px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-60"
                  aria-label="Refresh shipment details"
                  title="Refresh shipment details"
                >
                  <RefreshCw size={14} className={isRefreshingDetails ? 'animate-spin' : ''} />
                </button>
                <button onClick={closeViewModal} className="rounded-lg p-1 hover:bg-gray-100">
                  <X size={20} />
                </button>
              </div>
            </div>
            <div className="space-y-4 p-6 text-sm text-gray-700">
              {(() => {
                const viewStats = selectedShipmentViewStats;
                const viewNotes = getShipmentNoteText(selectedShipment);
                const orderData = getShipmentOrderData(selectedShipment);
                const itemCount = viewStats.items.length;
                const itemLabelFiles = getItemLabelFileAssignments(viewStats.items, trackFiles, visibleShipmentFiles);
                const customServicesForView = extractCustomServices(selectedShipment, detailServices);
                const standardServiceTasks = detailServices.filter((service) =>
                  Boolean(
                    !isCustomServiceTask(service) &&
                      (!isBundlingServiceTask(service) ||
                        viewStats.items.some((item) =>
                          isServiceTaskForItem(service, item, itemCount) && hasBundlingServiceForItem(item)
                        ))
                  )
                );
                const unassignedServiceTasks = standardServiceTasks.filter(
                  (service) =>
                    !viewStats.items.some(
                      (item) => isServiceTaskForItem(service, item, itemCount) && shouldDisplayServiceTaskForItem(service, item)
                    )
                );
                const unassignedDiscrepancies = detailDiscrepancies.filter(
                  (discrepancy, index) => !viewStats.items.some((item) => isDiscrepancyForItem(discrepancy, item, viewStats.items, index))
                );
                const unassignedCustomServices = customServicesForView.filter(
                  (service) => !viewStats.items.some((item) => isCustomServiceForItem(service, item, itemCount))
                );
                return (
                  <>
                    <div className="grid grid-cols-1 gap-3 rounded-lg border border-gray-200 bg-gray-50 p-4 md:grid-cols-3">
                      <p>Status: <span className="font-medium text-gray-900">{selectedShipment.status}</span></p>
                      <p>Expected Arrival: <span className="font-medium text-gray-900">{formatDateForInput(selectedShipment.expectedArrivalDate || selectedShipment.expected_arrival_date) || '-'}</span></p>
                      <p>Units: <span className="font-medium text-gray-900">{viewStats.totalUnits}</span></p>
                    </div>
                    {displaySubShipments.length ? (
                      <div>
                        <p className="mb-2 font-medium text-gray-900">Sub-shipments</p>
                        <div className="space-y-3">
                          {displaySubShipments.map((subShipment, subShipmentIndex) => {
                            const status = getSubShipmentStatus(subShipment);
                            const dispatchedDate = firstPresent(subShipment?.dispatched_at, subShipment?.dispatchedAt);
                            const items = getSubShipmentItems(subShipment);

                            return (
                              <div key={getSubShipmentId(subShipment) || subShipmentIndex} className="rounded-lg border border-gray-200 bg-gray-50 p-4">
                                <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                                  <div>
                                    <p className="font-semibold text-gray-900">
                                      {getSubShipmentReference(subShipment) || `Sub-shipment ${subShipmentIndex + 1}`}
                                    </p>
                                    <p className="mt-1 text-xs text-gray-500">
                                      Parent shipment {selectedShipment.reference || selectedShipment.id || '-'}
                                    </p>
                                  </div>
                                  <div className="flex flex-wrap items-center gap-2">
                                    <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${getShipmentStatusBadgeClass(status)}`}>
                                      {getSubShipmentStatusLabel(status)}
                                    </span>
                                    <span className="text-xs text-gray-500">
                                      {dispatchedDate ? `Dispatched ${formatTrackerDate(dispatchedDate)}` : 'Dispatch pending'}
                                    </span>
                                  </div>
                                </div>
                                <div className="mt-3 space-y-2">
                                  {items.length ? (
                                    items.map((item, itemIndex) => {
                                      const lineItem = getSubShipmentItemLineItem(item);
                                      return (
                                        <div key={item?.id || getItemRecordId(lineItem) || itemIndex} className="flex items-center justify-between gap-3 rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm">
                                          <div className="min-w-0">
                                            <p className="truncate font-medium text-gray-900">{getItemDisplayProductName(lineItem) || 'Product'}</p>
                                            <p className="text-xs text-gray-500">SKU {getItemSku(lineItem) || '-'}</p>
                                          </div>
                                          <span className="shrink-0 rounded-full bg-gray-100 px-2.5 py-1 text-xs font-semibold text-gray-700">
                                            {formatQuantityValue(getSubShipmentItemQuantity(item))}
                                          </span>
                                        </div>
                                      );
                                    })
                                  ) : (
                                    <p className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-xs text-gray-600">No products returned for this sub-shipment.</p>
                                  )}
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    ) : null}
                    <div>
                      <p className="mb-2 font-medium text-gray-900">Order Data</p>
                      <div className="grid grid-cols-1 gap-3 rounded-lg border border-gray-200 bg-gray-50 p-4 md:grid-cols-3">
                        <p><span className="text-xs uppercase text-gray-500">Tracking</span><br /><span className="font-medium text-gray-900">{orderData.tracking || '-'}</span></p>
                        <p><span className="text-xs uppercase text-gray-500">Boxes</span><br /><span className="font-medium text-gray-900">{orderData.boxes || '-'}</span></p>
                        <p><span className="text-xs uppercase text-gray-500">Pallets</span><br /><span className="font-medium text-gray-900">{orderData.pallets || '-'}</span></p>
                      </div>
                    </div>
                    {viewNotes ? (
                      <div>
                        <p className="mb-2 font-medium text-gray-900">Notes</p>
                        <p className="whitespace-pre-line rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-sm text-gray-700">{viewNotes}</p>
                      </div>
                    ) : null}
                    {viewStats.services.length ? (
                      <div>
                        <p className="mb-2 font-medium text-gray-900">Services</p>
                        <p className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-sm font-medium text-gray-900">
                          {viewStats.services.join(', ')}
                        </p>
                      </div>
                    ) : null}
                    <div>
                      <p className="mb-2 font-medium text-gray-900">Items</p>
                      {viewStats.items.length ? (
                        <div className="space-y-3">
                          {viewStats.items.map((item, index) => {
                            const itemServices = getItemServicesForView(item, detailServices, itemCount);
                            const itemServiceTasks = standardServiceTasks.filter(
                              (service) => isServiceTaskForItem(service, item, itemCount) && shouldDisplayServiceTaskForItem(service, item)
                            );
                            const itemDiscrepancies = detailDiscrepancies.filter((discrepancy, discrepancyIndex) =>
                              isDiscrepancyForItem(discrepancy, item, viewStats.items, discrepancyIndex)
                            );
                            const itemCustomServices = customServicesForView.filter((service) => isCustomServiceForItem(service, item, itemCount));
                            const labelFile = itemLabelFiles[index] || null;
                            const labelFileUrl = labelFile ? getFileUrlCandidates(labelFile)[0] : '';
                            const labelFileIsImage = Boolean(labelFile && isImageFile(labelFile));
                            const itemDisplayProductName = getItemDisplayProductName(item, labelFile);
                            const itemOutboundBoxes = getBoxesForShipmentItem(item, trackBoxes, viewStats.items);
                            const itemOutboundPallets = getPalletsForShipmentItem(item, trackBoxes, viewStats.items);
                            return (
                              <div key={item?.id || item?.sku || index} className="rounded-lg border border-gray-200 bg-gray-50 p-4">
                                <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
                                  <p><span className="text-xs uppercase text-gray-500">Product</span><br /><span className="font-medium text-gray-900">{itemDisplayProductName || '-'}</span></p>
                                  <p><span className="text-xs uppercase text-gray-500">SKU</span><br /><span className="font-medium text-gray-900">{getItemSku(item) || '-'}</span></p>
                                  <p><span className="text-xs uppercase text-gray-500">FNSKU</span><br /><span className="font-medium text-gray-900">{getItemFnsku(item) || '-'}</span></p>
                                  <p><span className="text-xs uppercase text-gray-500">Expected Qty</span><br /><span className="font-medium text-gray-900">{getItemExpectedQty(item) || 0}</span></p>
                                  <p><span className="text-xs uppercase text-gray-500">Bundle Size</span><br /><span className="font-medium text-gray-900">{getItemBundleSize(item) || '-'}</span></p>
                                  <p><span className="text-xs uppercase text-gray-500">Services</span><br /><span className="font-medium text-gray-900">{itemServices.length ? itemServices.join(', ') : '-'}</span></p>
                                  <p>
                                    <span className="text-xs uppercase text-gray-500">FNSKU Label PDF / CSV</span><br />
                                    {labelFile ? (
                                      <span className="mt-1 block space-y-2">
                                        {labelFileIsImage ? (
                                          <button type="button" onClick={() => openOrDownloadFile(labelFile)} className="block overflow-hidden rounded-md border border-gray-200 bg-white">
                                            <LabelPreviewImage file={labelFile} alt={getFileName(labelFile)} className="h-24 w-36 object-contain" />
                                          </button>
                                        ) : null}
                                        {labelFileUrl ? (
                                          <button
                                            type="button"
                                            onClick={() => openOrDownloadFile(labelFile)}
                                            className="font-medium text-[#ff6900] hover:text-[#e55d00]"
                                          >
                                            {getFileName(labelFile)}
                                          </button>
                                        ) : (
                                          <span className="font-medium text-gray-900">{getFileName(labelFile)}</span>
                                        )}
                                      </span>
                                    ) : loadingShipmentFiles ? (
                                      <span className="font-medium text-gray-500">Loading label...</span>
                                    ) : (
                                      <span className="font-medium text-gray-900">-</span>
                                    )}
                                  </p>
                                </div>
                                <div className="mt-4 space-y-4 border-t border-gray-200 pt-4">
                                  <div>
                                    <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500">Service Tasks</p>
                                    {itemServiceTasks.length ? (
                                      <div className="space-y-2">
                                        {itemServiceTasks.map((service, serviceIndex) => {
                                          const serviceLabel = getServiceTaskLabel(service) || formatServiceLabel(service) || 'Service Task';

                                          return (
                                            <div key={service?.id || service?.taskId || service?.task_id || `${serviceLabel}-${serviceIndex}`} className="rounded-lg border border-gray-200 bg-white px-3 py-2">
                                              <div className="flex items-center justify-between gap-3">
                                                <div>
                                                  <p className="font-medium text-gray-900">{serviceLabel}</p>
                                                </div>
                                                <span className="rounded-full bg-gray-50 px-2 py-1 text-xs font-medium text-gray-700">
                                                  {getServiceTaskStatus(service)}
                                                </span>
                                              </div>
                                            </div>
                                          );
                                        })}
                                      </div>
                                    ) : (
                                      <p className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-xs text-gray-600">No service tasks linked to this item.</p>
                                    )}
                                  </div>

                                    <div>
                                      <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500">Outbound Boxes</p>
                                      {itemOutboundBoxes.length ? (
                                        <div className="space-y-2">
                                          {itemOutboundBoxes.map(({ box, boxIndex }) => renderShipmentBoxCard(box, boxIndex, item))}
                                          </div>
                                        ) : (
                                        <p className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-xs text-gray-600">No outbound boxes linked to this item.</p>
                                      )}
                                    </div>

                                    <div>
                                      <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500">Outbound Pallets</p>
                                      {itemOutboundPallets.length ? (
                                        <div className="space-y-2">
                                          {itemOutboundPallets.map(({ box, boxIndex }) => renderShipmentBoxCard(box, boxIndex, item))}
                                        </div>
                                      ) : (
                                        <p className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-xs text-gray-600">No outbound pallets linked to this item.</p>
                                      )}
                                    </div>

                                  {itemDiscrepancies.length ? (
                                    <div>
                                      <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-amber-700">Discrepancies</p>
                                      <div className="space-y-2">
                                        {itemDiscrepancies.map((discrepancy, discrepancyIndex) => {
                                          const expectedQty = getDiscrepancyExpectedQty(discrepancy, item);
                                          const receivedQty = getDiscrepancyReceivedQty(discrepancy, item);

                                          return (
                                            <div key={discrepancy?.id || discrepancy?.uuid || getDiscrepancyLineItemId(discrepancy) || discrepancyIndex} className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2">
                                              <div className="flex items-center justify-between gap-3">
                                                <p className="font-medium text-amber-900">{getItemSku(item) || getDiscrepancySku(discrepancy) || 'Line Item'}</p>
                                                <span className="rounded-full bg-white px-2 py-1 text-xs font-medium text-amber-700">
                                                  {discrepancy?.status || 'OPEN'}
                                                </span>
                                              </div>
                                              <p className="mt-1 text-xs text-amber-800">
                                                Expected {expectedQty}, received {receivedQty}
                                              </p>
                                            </div>
                                          );
                                        })}
                                      </div>
                                    </div>
                                  ) : null}

                                  {itemCustomServices.length ? (
                                    <div>
                                      <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500">Custom Services</p>
                                      <div className="space-y-2">
                                        {itemCustomServices.map((service) => (
                                          <div key={service.id} className="rounded-lg border border-gray-200 bg-white px-3 py-2">
                                            <div className="flex items-center justify-between gap-3">
                                              <div>
                                                <p className="font-medium text-gray-900">{service.name}</p>
                                                <p className="text-xs text-gray-500">SKU {service.sku || getItemSku(item) || '-'}</p>
                                              </div>
                                              <span className="rounded-full bg-gray-50 px-2 py-1 text-xs font-medium text-gray-700">
                                                {service.status}
                                              </span>
                                            </div>
                                          </div>
                                        ))}
                                      </div>
                                    </div>
                                  ) : null}
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      ) : (
                        <p className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-xs text-gray-600">No line items returned for this shipment.</p>
                      )}
                    </div>

                    {(unassignedServiceTasks.length || unassignedDiscrepancies.length || unassignedCustomServices.length) ? (
                      <div>
                        <p className="mb-2 font-medium text-gray-900">Unassigned Details</p>
                        <div className="space-y-3 rounded-lg border border-dashed border-gray-300 bg-gray-50 p-3">
                          {unassignedServiceTasks.length ? (
                            <div>
                              <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500">Service Tasks</p>
                              <div className="space-y-2">
                                {unassignedServiceTasks.map((service, index) => {
                                  const serviceLabel = getServiceTaskLabel(service) || formatServiceLabel(service) || 'Service Task';

                                  return (
                                    <div key={`${service?.id || service?.taskId || service?.task_id || serviceLabel}-${index}`} className="rounded-lg border border-gray-200 bg-white px-3 py-2">
                                      <div className="flex items-center justify-between gap-3">
                                        <p className="font-medium text-gray-900">{serviceLabel}</p>
                                        <span className="rounded-full bg-gray-50 px-2 py-1 text-xs font-medium text-gray-700">
                                          {getServiceTaskStatus(service)}
                                        </span>
                                      </div>
                                    </div>
                                  );
                                })}
                              </div>
                            </div>
                          ) : null}

                          {unassignedDiscrepancies.length ? (
                            <div>
                              <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-amber-700">Discrepancies</p>
                              <div className="space-y-2">
                                {unassignedDiscrepancies.map((discrepancy, index) => (
                                  <div key={discrepancy?.id || discrepancy?.uuid || getDiscrepancyLineItemId(discrepancy) || index} className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2">
                                    <div className="flex items-center justify-between gap-3">
                                      <p className="font-medium text-amber-900">{getDiscrepancySku(discrepancy) || getDiscrepancyLineItemId(discrepancy) || 'Line Item'}</p>
                                      <span className="rounded-full bg-white px-2 py-1 text-xs font-medium text-amber-700">
                                        {discrepancy?.status || 'OPEN'}
                                      </span>
                                    </div>
                                    <p className="mt-1 text-xs text-amber-800">
                                      Expected {getDiscrepancyExpectedQty(discrepancy)}, received {getDiscrepancyReceivedQty(discrepancy)}
                                    </p>
                                  </div>
                                ))}
                              </div>
                            </div>
                          ) : null}

                          {unassignedCustomServices.length ? (
                            <div>
                              <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500">Custom Services</p>
                              <div className="space-y-2">
                                {unassignedCustomServices.map((service) => (
                                  <div key={service.id} className="rounded-lg border border-gray-200 bg-white px-3 py-2">
                                    <div className="flex items-center justify-between gap-3">
                                      <p className="font-medium text-gray-900">{service.name}</p>
                                      <span className="rounded-full bg-gray-50 px-2 py-1 text-xs font-medium text-gray-700">
                                        {service.status}
                                      </span>
                                    </div>
                                    <p className="text-xs text-gray-500">SKU {service.sku || '-'}</p>
                                  </div>
                                ))}
                              </div>
                            </div>
                          ) : null}
                        </div>
                      </div>
                    ) : null}
                  </>
                );
              })()}
              <div>
                <p className="mb-2 font-medium text-gray-900">Outbound Boxes</p>
                {(() => {
                  const unassignedShipmentBoxes = getUnassignedShipmentBoxes(trackBoxes, selectedShipmentViewStats.items);

                  if (unassignedShipmentBoxes.length) {
                    return (
                      <div className="space-y-3">
                        {unassignedShipmentBoxes.map(({ box, boxIndex }) => renderShipmentBoxCard(box, boxIndex))}
                      </div>
                    );
                  }

                  return (
                    <p className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-xs text-gray-600">
                      {trackBoxes.length ? 'All outbound boxes are shown under their product SKU.' : 'No boxes returned.'}
                    </p>
                  );
                })()}
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {false && showTrackModal && selectedShipment ? (
        <div className="fixed inset-0 z-50 overflow-y-auto bg-[#f3f6fb] p-6">
          <div className="">
            <button
              type="button"
              onClick={() => {
                setShowTrackModal(false);
                setSelectedShipment(null);
              }}
              className="mb-5 text-sm font-medium text-[#475569] hover:text-[#132347]"
            >
              ← back
            </button>

            <div className="mb-6">
              <h1 className="text-[34px] font-semibold leading-none text-[#132347]">Track & Labels</h1>
              <p className="mt-2 text-sm text-[#7a8ca5]">Manage labels and track live shipments across all centers.</p>
            </div>

            {selectedShipmentBoxes.some((box, index) => !isBoxLabelUploaded(box, index)) ? (
              <div className="mb-6 flex items-center justify-between rounded-xl border border-[#f5c2c0] bg-[#fde9e8] px-5 py-4">
                <p className="text-sm text-[#b84640]">
                  Action Required: Shipment {selectedShipment?.reference || selectedShipment?.id} is missing FBA labels for some boxes. Please upload them to avoid dispatch delays.
                </p>
                <button
                  type="button"
                  onClick={() => fbaUploadPanelRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })}
                  className="rounded-lg bg-[#e15d4c] px-4 py-2 text-sm font-semibold text-white"
                >
                  Upload Now
                </button>
              </div>
            ) : null}

            <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
              <div className="space-y-6">
                <div className="rounded-2xl border border-[#dce5f1] bg-white p-5 shadow-sm">
                  <div className="mb-6 flex items-center justify-between">
                    <h2 className="text-lg font-semibold text-[#132347]">Live Tracker: {selectedShipment?.reference || selectedShipment?.id}</h2>
                    <span className="rounded-full bg-[#fff4df] px-3 py-1 text-xs font-semibold text-[#c9831d]">
                      {String(selectedShipment?.status || 'IN PROGRESS').replaceAll('_', ' ').toUpperCase()}
                    </span>
                  </div>

                  <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
                    {trackerSteps.map((step, index) => (
                      <div key={step.key} className="relative">
                        {index < trackerSteps.length - 1 ? (
                          <div className={`absolute left-[calc(50%+18px)] right-[-26px] top-4 h-[2px] ${step.active ? 'bg-[#f28a2c]' : 'bg-[#d8dee8]'}`} />
                        ) : null}
                        <div className="relative flex flex-col items-center text-center">
                          <div className={`flex h-9 w-9 items-center justify-center rounded-full border-2 text-sm font-bold ${
                            step.active ? 'border-[#f28a2c] bg-[#f28a2c] text-white' : 'border-[#cad4e3] bg-white text-[#94a3b8]'
                          }`}>
                            {step.active ? '✓' : '○'}
                          </div>
                          <p className={`mt-3 text-sm font-semibold ${step.current ? 'text-[#f28a2c]' : 'text-[#132347]'}`}>{step.label}</p>
                          <p className="mt-1 text-xs text-[#7a8ca5]">{step.date}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="rounded-2xl border border-[#dce5f1] bg-white p-5 shadow-sm">
                  <div className="mb-5 flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <h3 className="text-lg font-semibold text-[#132347]">Shipment: {selectedShipment?.reference || selectedShipment?.id}</h3>
                      <span className="rounded-full bg-[#fff7ed] px-3 py-1 text-[11px] font-semibold text-[#ff8c2f]">
                        {String(selectedShipment?.status || 'pending').toUpperCase()}
                      </span>
                    </div>
                    <p className="text-xs text-[#7a8ca5]">
                      {selectedShipment?.dispatched_at || selectedShipment?.dispatchedAt
                        ? `Dispatched on ${formatTrackerDate(selectedShipment?.dispatched_at || selectedShipment?.dispatchedAt)}`
                        : 'Dispatched pending'}
                    </p>
                  </div>

                  <div className="grid grid-cols-2 gap-6 border-b border-[#edf2f7] pb-5 md:grid-cols-4">
                    <div>
                      <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[#94a3b8]">Destination</p>
                      <p className="mt-2 text-sm font-medium text-[#132347]">FBA Warehouse</p>
                    </div>
                    <div>
                      <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[#94a3b8]">Quantity</p>
                      <p className="mt-2 text-sm font-medium text-[#132347]">{lineItems.reduce((sum, item) => sum + Number(item?.expectedQty || item?.expected_qty || 0), 0)} Units</p>
                    </div>
                    <div>
                      <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[#94a3b8]">Carrier</p>
                      <p className="mt-2 text-sm font-medium text-[#132347]">{selectedShipment?.carrier || 'UPS Ground'}</p>
                    </div>
                    <div>
                      <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[#94a3b8]">Total Weight</p>
                      <p className="mt-2 text-sm font-medium text-[#132347]">{selectedShipmentBoxes.reduce((sum, box) => sum + Number(box?.weight || 0), 0).toFixed(1)} kg</p>
                    </div>
                  </div>

                  <div className="flex flex-col gap-4 pt-5 md:flex-row md:items-center md:justify-between">
                    <div className="text-sm font-medium text-[#f28a2c]">
                      {selectedShipmentBoxes.length} boxes prepared for dispatch
                    </div>
                    <div className="flex items-center gap-3">
                      <button type="button" className="rounded-lg border border-[#fde7d5] px-4 py-2 text-sm font-medium text-[#ff8c2f] hover:bg-[#fff7ed]">
                        Dispatch Note
                      </button>
                      <button type="button" className="rounded-lg border border-[#fde7d5] px-4 py-2 text-sm font-medium text-[#ff8c2f] hover:bg-[#fff7ed]">
                        FNSKU Labels
                      </button>
                    </div>
                  </div>
                </div>
              </div>

              <div className="rounded-2xl border border-[#dce5f1] bg-white p-5 shadow-sm">
                <h3 className="mb-4 text-lg font-semibold text-[#132347]">Upload FBA Labels</h3>
                <div className="overflow-hidden rounded-xl border border-[#e8eef7]">
                  <div className="grid grid-cols-[1fr_90px_56px] bg-[#f8fbff] px-4 py-3 text-[11px] font-semibold uppercase tracking-[0.14em] text-[#7a8ca5]">
                    <span>Box ID</span>
                    <span>Status</span>
                    <span>Action</span>
                  </div>
                  {(selectedShipmentBoxes.length ? selectedShipmentBoxes : [{ id: 'Box #1' }, { id: 'Box #2' }, { id: 'Box #3' }]).map((box, index) => {
                    const labelUploaded = Boolean(
                      box?.labelReady ||
                      box?.fbaLabelUploaded ||
                      box?.fba_label_uploaded ||
                      String(box?.status || '').toLowerCase() === 'uploaded'
                    );
                    return (
                      <div key={box?.id || index} className="grid grid-cols-[1fr_90px_56px] items-center border-t border-[#edf2f7] px-4 py-3 text-sm">
                        <span className="text-[#132347]">{box?.name || box?.boxNumber || `Box #${index + 1}`}</span>
                        <span className={`text-xs font-semibold ${labelUploaded ? 'text-[#d8a11f]' : 'text-[#e45a5a]'}`}>
                          {labelUploaded ? 'UPLOADED' : 'MISSING'}
                        </span>
                        <button type="button" className="text-[#ff8c2f] hover:text-[#f67d17]">
                          ⤴
                        </button>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </LayoutClient>
  );
};

export default ClientShipments;
