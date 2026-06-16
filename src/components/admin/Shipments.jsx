import React, { useEffect, useMemo, useRef, useState } from 'react';
import Layout from './adminlayout/Layout';
import LoadingState from '../common/LoadingState';
import FullPageLoader from '../common/FullPageLoader';
import ProductSkuCombobox from '../common/ProductSkuCombobox';
import DiscrepancyResolutionModal from '../common/DiscrepancyResolutionModal';
import { getSession } from '../../utils/auth';
import { getDiscrepancyResolveData, resolveDiscrepancy as resolveDiscrepancyRequest } from '../../utils/discrepancies';
import {
  Search,
  Plus,
  ChevronDown,
  ArrowRight,
  ArrowLeft,
  PackagePlus,
  Trash2,
  FileUp,
  X,
  Eye,
  UserCog,
  ClipboardList,
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { formatToastMessage } from '../../utils/toast';
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
import {
  buildShipmentItemPayload as mapShipmentItemPayload,
  findLineItemLabelFile as findMappedLineItemLabelFile,
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

const API_BASE_URL = '';
const BACKEND_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'https://ali-backend.vercel.app';
const SUPABASE_STORAGE_PUBLIC_BASE_URL = import.meta.env.VITE_SUPABASE_URL
  ? `${String(import.meta.env.VITE_SUPABASE_URL).replace(/\/+$/, '')}/storage/v1/object/public`
  : '';
const SUPABASE_DEFAULT_STORAGE_BUCKET =
  import.meta.env.VITE_SUPABASE_BUCKET_FNSKU_LABELS ||
  import.meta.env.VITE_SUPABASE_STORAGE_BUCKET ||
  'pickpackpro-files';
const SHIPMENTS_PER_PAGE = 10;
const DRAFT_CACHE_KEY = 'pickpackpro-shipment-drafts';
const BOX_ALLOCATION_CACHE_KEY = 'pickpackpro-box-allocation-items-v1';
const BUNDLE_SIZE_NOTE_PREFIX = 'Bundle Sizes:';
const SAFE_FILE_UPLOAD_BYTES = 3 * 1024 * 1024;
const getTodayDate = () => new Date().toISOString().split('T')[0];

const formatFileSize = (bytes = 0) => {
  const size = Number(bytes || 0);
  if (!Number.isFinite(size) || size <= 0) return '0 MB';
  if (size < 1024 * 1024) return `${Math.ceil(size / 1024)} KB`;
  return `${(size / (1024 * 1024)).toFixed(size >= 10 * 1024 * 1024 ? 0 : 1)} MB`;
};

const getFnskuLabelTooLargeMessage = (fileName = 'FNSKU label file') =>
  `${fileName} is too large. FNSKU label files must be ${formatFileSize(SAFE_FILE_UPLOAD_BYTES)} or less.`;

const firstPresent = (...values) => {
  const value = values.find((currentValue) => {
    if (currentValue === 0 || currentValue === false) return true;
    return currentValue !== undefined && currentValue !== null && String(currentValue).trim() !== '';
  });

  return value === undefined || value === null ? '' : value;
};

const initialCreateForm = {
  reference: '',
  clientId: '',
  assignedStaff: '',
  expectedArrivalDate: getTodayDate(),
  notes: '',
};

const createEmptyProductItem = () => ({
  sku: '',
  productName: '',
  expectedQty: '',
  bundleSize: '',
  fnskuLabel: '',
  needsBundling: false,
  serviceType: '',
  serviceQty: '',
  services: [],
  customServiceName: '',
  fileName: '',
  file: null,
});

const serviceRequiredOptions = SERVICE_SELECT_OPTIONS;
const isOtherServiceValue = isOtherServiceCode;
const normalizeServiceType = normalizeServiceCode;
const formatServiceLabel = getServiceDisplayName;
const normalizeServiceKey = getServiceKey;
const STANDARD_SERVICE_KEYS = STANDARD_CATALOG_SERVICE_KEYS;

const buildHeaders = (includeJson = false) => {
  const session = getSession();
  const headers = {};

  if (session?.token) {
    headers['Authorization'] = `Bearer ${session.token}`;
  }

  if (includeJson) {
    headers['Content-Type'] = 'application/json';
  }

  return headers;
};

const parseResponse = async (response) => {
  const text = await response.text();
  let payload = null;

  if (text) {
    try {
      payload = JSON.parse(text);
    } catch {
      payload = text;
    }
  }

  if (!response.ok) {
    const message = formatToastMessage(
      payload?.message ?? payload?.error ?? payload?.details ?? (typeof payload === 'string' ? payload : ''),
      `Request failed with status ${response.status}`
    );

    throw new Error(
      String(message).toLowerCase().includes('max clients reached')
        ? 'Backend database connection limit reached. Please retry in a moment.'
        : message
    );
  }

  return payload;
};

const logAdminViewGetResponse = (label, payload) => {
  console.log('[PickPackPro][Admin View GET]', label, payload);
  return payload;
};

const extractShipments = (payload) => {
  return normalizeMappedShipmentList(payload);
};

const extractClients = (payload) => {
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload?.clients)) return payload.clients;
  if (Array.isArray(payload?.data?.rows)) return payload.data.rows;
  if (Array.isArray(payload?.data)) return payload.data;
  if (Array.isArray(payload?.results)) return payload.results;
  return [];
};

const extractUsers = (payload) => {
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload?.users)) return payload.users;
  if (Array.isArray(payload?.data?.rows)) return payload.data.rows;
  if (Array.isArray(payload?.data)) return payload.data;
  if (Array.isArray(payload?.results)) return payload.results;
  return [];
};

const extractList = (payload, keys = []) => {
  if (Array.isArray(payload)) return payload;

  for (const key of keys) {
    if (Array.isArray(payload?.[key])) return payload[key];
    if (Array.isArray(payload?.data?.[key])) return payload.data[key];
  }

  if (Array.isArray(payload?.rows)) return payload.rows;
  if (Array.isArray(payload?.data?.rows)) return payload.data.rows;
  if (Array.isArray(payload?.data)) return payload.data;
  if (Array.isArray(payload?.results)) return payload.results;

  return [];
};

const toArray = (value) => extractList(value);

const getClientId = (client) =>
  client?.id || client?.uuid || client?.clientId || client?.client_id || '';

const getClientName = (client) =>
  client?.companyName ||
  client?.company_name ||
  client?.company ||
  client?.businessName ||
  client?.business_name ||
  client?.clientName ||
  client?.client_name ||
  client?.name ||
  client?.fullName ||
  client?.full_name ||
  client?.displayName ||
  client?.display_name ||
  client?.user?.name ||
  client?.users?.name ||
  getClientId(client) ||
  'Unnamed Client';

const getClientEmail = (client = {}) =>
  firstPresent(
    client?.email,
    client?.contactEmail,
    client?.contact_email,
    client?.billingEmail,
    client?.billing_email,
    client?.user?.email,
    client?.users?.email,
    client?.profile?.email
  );

const getClientOptionLabel = (client = {}) => {
  const name = getClientName(client);
  const email = getClientEmail(client);

  return email && String(email).trim().toLowerCase() !== String(name).trim().toLowerCase()
    ? `${name} (${email})`
    : name;
};

const normalizeRoleValue = (role = '') => String(role || '').trim().toLowerCase().replace(/\s+/g, '_');

const getClientRecordRoles = (client = {}) => [
  client?.role,
  client?.userRole,
  client?.user_role,
  client?.accountRole,
  client?.account_role,
  client?.user?.role,
  client?.users?.role,
  client?.profile?.role,
  ...(Array.isArray(client?.users) ? client.users.map((user) => user?.role) : []),
]
  .map(normalizeRoleValue)
  .filter(Boolean);

const isSelectableClient = (client = {}) => {
  const roles = getClientRecordRoles(client);
  if (!roles.length) return true;
  if (roles.some((role) => role === 'client' || role === 'customer')) return true;

  return !roles.some((role) => role === 'staff' || role === 'admin');
};

const getUserId = (user) =>
  user?.id || user?.uuid || user?.userId || user?.user_id || '';

const getUserName = (user) =>
  user?.name || user?.fullName || user?.full_name || user?.email || getUserId(user) || 'Unnamed Staff';

const isUuidValue = (value = '') =>
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(value || '').trim());

const firstUuidValue = (...values) => values.find((value) => isUuidValue(value)) || '';

const getShipmentRecordId = (shipment = {}) =>
  firstUuidValue(shipment?.id, shipment?.uuid, shipment?.shipmentId, shipment?.shipment_id);

const getAssignedStaffId = (shipment = {}) =>
  shipment?.staffId ||
  shipment?.staff_id ||
  shipment?.assignedStaffId ||
  shipment?.assigned_staff_id ||
  shipment?.assignedToId ||
  shipment?.assigned_to_id ||
  shipment?.assignedStaff?.id ||
  shipment?.assignedStaff?.uuid ||
  shipment?.assignedTo?.id ||
  shipment?.assignedTo?.uuid ||
  shipment?.assigned_to_user?.id ||
  shipment?.assigned_to_user?.uuid ||
  shipment?.assigned_to?.id ||
  shipment?.assigned_to?.uuid ||
  shipment?.staff?.id ||
  shipment?.staff?.uuid ||
  (isUuidValue(shipment?.assigned_to) ? shipment.assigned_to : '') ||
  '';

const getAssignedStaffName = (shipment = {}) => {
  const assignedToText = typeof shipment?.assigned_to === 'string' ? shipment.assigned_to : '';

  return (
    shipment?.assignedStaff?.name ||
    shipment?.assignedTo?.name ||
    shipment?.assigned_to_user?.name ||
    shipment?.assigned_to?.name ||
    shipment?.staff?.name ||
    (!isUuidValue(assignedToText) ? assignedToText : '') ||
    ''
  );
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

const getShipmentId = (shipment = {}) =>
  shipment?.id ||
  shipment?.uuid ||
  shipment?.shipmentId ||
  shipment?.shipment_id ||
  shipment?.reference ||
  shipment?.shipmentNumber ||
  shipment?.shipment_number ||
  '';

const LINE_ITEM_KEYS = [
  'shipment_line_items',
  'shipmentLineItems',
  'line_items',
  'lineItems',
  'items',
  'shipmentItems',
  'shipment_items',
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
        item?.expectedQty ||
        item?.expected_qty ||
        item?.expectedQuantity ||
        item?.expected_quantity ||
        item?.quantity ||
        item?.qty ||
        item?.units ||
        item?.product ||
        item?.products ||
        item?.shipmentItem ||
        item?.shipment_item)
  );

const getDirectLineItems = (source = {}) => {
  if (!source || typeof source !== 'object') return [];

  for (const key of LINE_ITEM_KEYS) {
    const value = source[key];
    if (Array.isArray(value) && value.some(hasLineItemShape)) return value;
  }

  const rows = Array.isArray(source?.rows)
    ? source.rows
    : Array.isArray(source?.data?.rows)
      ? source.data.rows
      : Array.isArray(source?.data)
        ? source.data
        : [];

  return rows.some(hasLineItemShape) ? rows : [];
};

const getShipmentLineItems = (shipment = {}) => {
  return getMappedShipmentItems(shipment);
};

const getLineItemExpectedQty = (item = {}) =>
  item?.expectedQty ||
  item?.expected_qty ||
  item?.expectedQuantity ||
  item?.expected_quantity ||
  item?.qtyExpected ||
  item?.qty_expected ||
  item?.expectedUnits ||
  item?.expected_units ||
  item?.unitsExpected ||
  item?.units_expected ||
  item?.quantity ||
  item?.qty ||
  item?.count ||
  item?.totalUnits ||
  item?.total_units ||
  item?.units ||
  0;

const getLineItemProduct = (item = {}) => {
  const product = item?.product || item?.products || item?.productData || item?.product_data;
  return product && typeof product === 'object' ? product : {};
};

const getLineItemSku = (item = {}) => {
  const product = getLineItemProduct(item);
  return (
    item?.sku ||
    item?.sellerSku ||
    item?.seller_sku ||
    item?.productSku ||
    item?.product_sku ||
    product?.sku ||
    product?.sellerSku ||
    product?.seller_sku ||
    '-'
  );
};

const getLineItemProductName = (item = {}) => {
  const product = getLineItemProduct(item);
  return (
    item?.productName ||
    item?.product_name ||
    item?.itemName ||
    item?.item_name ||
    item?.name ||
    product?.productName ||
    product?.product_name ||
    product?.name ||
    getLineItemSku(item) ||
    'Product'
  );
};

const getLineItemFnsku = (item = {}) => {
  const product = getLineItemProduct(item);
  return (
    item?.fnskuLabel ||
    item?.fnsku_label ||
    item?.fnsku ||
    item?.defaultFnsku ||
    item?.default_fnsku ||
    product?.fnskuLabel ||
    product?.fnsku_label ||
    product?.fnsku ||
    product?.defaultFnsku ||
    product?.default_fnsku ||
    '-'
  );
};

const isTruthyFlag = (value) => {
  if (value === true || value === 1 || value === '1') return true;
  return ['true', 'yes', 'y'].includes(String(value || '').trim().toLowerCase());
};

const isLineItemBundlingEnabled = (item = {}) =>
  isTruthyFlag(item?.needsBundling) || isTruthyFlag(item?.needs_bundling);

const getLineItemBundleSize = (item = {}) => {
  if (!isLineItemBundlingEnabled(item)) return '';

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

const isBundlingServiceValue = (value = '') => {
  const rawValue = typeof value === 'object'
    ? firstPresent(value?.serviceType, value?.service_type, value?.name, value?.serviceName, value?.service_name, value?.label, value?.type)
    : value;
  return isBundlingService(String(rawValue || '').split('/')[0]);
};

const filterBundlingServiceLabels = (services = []) =>
  services.filter((service) => !isBundlingServiceValue(service));

const getRawShipmentNotes = (shipment = {}) =>
  firstPresent(shipment?.client_notes, shipment?.clientNotes, shipment?.notes, shipment?.note);

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

const normalizeBundleMatchValue = (value = '') => {
  const normalized = String(value || '').trim().toLowerCase();
  return normalized && !['-', 'n/a', 'na', 'none', 'null', 'undefined'].includes(normalized) ? normalized : '';
};

const getBundleSizeForLineItem = (item = {}, entries = []) => {
  const itemSku = normalizeBundleMatchValue(getLineItemSku(item));
  const itemFnsku = normalizeBundleMatchValue(getLineItemFnsku(item));
  const matchedEntry = entries.find((entry) => {
    const entrySku = normalizeBundleMatchValue(entry?.sku);
    const entryFnsku = normalizeBundleMatchValue(entry?.fnsku);

    return (
      (itemSku && entrySku && itemSku === entrySku && (!itemFnsku || !entryFnsku || itemFnsku === entryFnsku)) ||
      (itemFnsku && entryFnsku && itemFnsku === entryFnsku)
    );
  });
  const bundleSize = Number(matchedEntry?.bundleSize || matchedEntry?.bundle_size || 0);

  return isPositiveBundleSize(bundleSize) ? bundleSize : '';
};

const readDraftCache = () => {
  try {
    return JSON.parse(localStorage.getItem(DRAFT_CACHE_KEY) || '{}');
  } catch {
    return {};
  }
};

const getDraftCacheKeys = (...shipments) =>
  shipments
    .flatMap((shipment) => [
      shipment && typeof shipment !== 'object' ? shipment : '',
      shipment?.id,
      shipment?.uuid,
      shipment?.shipmentId,
      shipment?.shipment_id,
      shipment?.reference,
      shipment?.shipmentNumber,
      shipment?.shipment_number,
    ])
    .map((value) => String(value || '').trim())
    .filter(Boolean);

const getBundleSizeEntriesFromDraftCache = (shipment = {}, items = []) => {
  const cache = readDraftCache();
  const itemList = Array.isArray(items) ? items : [];
  const drafts = getDraftCacheKeys(shipment).map((key) => cache[key]).filter(Boolean);

  return drafts.flatMap((draft) =>
    (Array.isArray(draft?.productItems) ? draft.productItems : [])
      .map((item) => ({
        sku: getLineItemSku(item),
        fnsku: getLineItemFnsku(item),
        bundleSize: Number(getLineItemBundleSize(item) || 0),
        hasBundling: isLineItemBundlingEnabled(item),
      }))
      .filter((entry) =>
        entry.hasBundling &&
        isPositiveBundleSize(entry.bundleSize) &&
          itemList.some((item) => getBundleSizeForLineItem(item, [entry]))
      )
      .map(({ hasBundling, ...entry }) => entry)
  );
};

const applyBundleSizesFromNotes = (items = [], shipment = {}) => {
  const entries = getBundleSizeEntriesFromNotes(getRawShipmentNotes(shipment));
  const resolvedEntries = entries.length ? entries : getBundleSizeEntriesFromDraftCache(shipment, items);
  if (!resolvedEntries.length) return items;

  return (Array.isArray(items) ? items : []).map((item) => {
    if (!isLineItemBundlingEnabled(item)) return item;
    if (isPositiveBundleSize(getLineItemBundleSize(item))) return item;
    const bundleSize = getBundleSizeForLineItem(item, resolvedEntries);
    return isPositiveBundleSize(bundleSize)
      ? { ...item, bundleSize, bundle_size: bundleSize }
      : item;
  });
};

const getLineItemDisplayOrder = (item = {}) => {
  const value = firstPresent(
    item?.displayOrder,
    item?.display_order,
    item?.itemIndex,
    item?.item_index,
    item?.lineItemIndex,
    item?.line_item_index,
    item?.sortOrder,
    item?.sort_order,
    item?.position,
    item?.sequence,
    item?.rowNumber,
    item?.row_number
  );
  const order = Number(value);
  return Number.isFinite(order) ? order : null;
};

const PRODUCT_SEQUENCE_PREFIXES = ['product', 'prod', 'pp', 'p'];
const SKU_SEQUENCE_PREFIXES = ['sku', 'product', 'prod', 'pp', 'p'];
const FNSKU_SEQUENCE_PREFIXES = ['fnsku', 'f', 'sku', 'product', 'prod', 'pp', 'p'];

const parseLineItemSequenceOrder = (value = '', prefixes = []) => {
  const text = String(value || '').trim();
  if (!text) return null;
  const match = text.match(new RegExp(`^(?:${prefixes.join('|')})[\\s_-]*0*(\\d+)$`, 'i'));
  if (!match) return null;
  const order = Number(match[1]);
  return Number.isFinite(order) ? order : null;
};

const getLineItemSequenceParts = (item = {}) => ({
  product: parseLineItemSequenceOrder(getLineItemProductName(item), PRODUCT_SEQUENCE_PREFIXES),
  sku: parseLineItemSequenceOrder(getLineItemSku(item), SKU_SEQUENCE_PREFIXES),
  fnsku: parseLineItemSequenceOrder(getLineItemFnsku(item), FNSKU_SEQUENCE_PREFIXES),
});

const getLineItemReliableSequenceOrder = (item = {}) => {
  const sequenceParts = getLineItemSequenceParts(item);
  return sequenceParts.sku ?? sequenceParts.fnsku ?? sequenceParts.product;
};

const getLineItemNaturalDisplayOrder = (item = {}) =>
  getLineItemReliableSequenceOrder(item);

const sortLineItemsForDisplay = (items = []) =>
  (Array.isArray(items) ? [...items] : []).sort((firstItem, secondItem) => {
    const firstNaturalOrder = getLineItemNaturalDisplayOrder(firstItem);
    const secondNaturalOrder = getLineItemNaturalDisplayOrder(secondItem);

    if (firstNaturalOrder !== null && secondNaturalOrder !== null && firstNaturalOrder !== secondNaturalOrder) {
      return firstNaturalOrder - secondNaturalOrder;
    }

    if (firstNaturalOrder !== null && secondNaturalOrder === null) return -1;
    if (firstNaturalOrder === null && secondNaturalOrder !== null) return 1;

    const firstOrder = getLineItemDisplayOrder(firstItem);
    const secondOrder = getLineItemDisplayOrder(secondItem);

    if (firstOrder !== null && secondOrder !== null && firstOrder !== secondOrder) {
      return firstOrder - secondOrder;
    }

    if (firstOrder !== null && secondOrder === null) return -1;
    if (firstOrder === null && secondOrder !== null) return 1;

    return String(getLineItemProductName(firstItem) || getLineItemSku(firstItem) || '').localeCompare(
      String(getLineItemProductName(secondItem) || getLineItemSku(secondItem) || ''),
      undefined,
      { numeric: true, sensitivity: 'base' }
    );
  });

const buildShipmentNotes = (notes = '') => String(notes || '').trim();

const toServiceLabels = (value) => {
  if (!value) return [];
  if (Array.isArray(value)) return value.flatMap(toServiceLabels);
  if (typeof value === 'object') {
    return toServiceLabels(value?.label || value?.name || value?.serviceName || value?.service_name || value?.serviceType || value?.service_type || value?.type);
  }

  return String(value)
    .split(/[;,|]/)
    .map(formatServiceLabel)
    .filter(Boolean);
};

const getLineItemServiceLabels = (item = {}) => [
  ...new Set([
    ...toServiceLabels(item?.services),
    ...toServiceLabels(item?.serviceTypes),
    ...toServiceLabels(item?.service_types),
    ...toServiceLabels(item?.serviceType),
    ...toServiceLabels(item?.service_type),
  ]),
];

const hasSelectedBundlingForLineItem = (item = {}) =>
  getLineItemServiceLabels(item).some(isBundlingServiceValue);

const shouldDisplayServiceForLineItem = (service, item = {}) =>
  !isBundlingServiceValue(typeof service === 'object' ? getServiceTaskLabel(service) : service) ||
  hasSelectedBundlingForLineItem(item);

const getLineItemEntityId = (item = {}) =>
  firstPresent(
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
    item?.lineItem?.id,
    item?.lineItem?.uuid,
    item?.line_item?.id,
    item?.line_item?.uuid,
    item?.shipmentLineItem?.id,
    item?.shipmentLineItem?.uuid,
    item?.shipment_line_item?.id,
    item?.shipment_line_item?.uuid,
    item?.shipmentItem?.id,
    item?.shipmentItem?.uuid,
    item?.shipment_item?.id,
    item?.shipment_item?.uuid,
    item?.item?.id,
    item?.item?.uuid
  );

const getLineItemRecordId = (item = {}) =>
  firstPresent(
    getLineItemEntityId(item),
    item?.productId,
    item?.product_id,
    item?.product?.id,
    item?.product?.uuid
  );

const serviceTaskKeys = [
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

const extractServiceTasks = (source = {}) => {
  if (Array.isArray(source)) return source;
  if (!source || typeof source !== 'object') return [];

  const directTasks = extractList(source, serviceTaskKeys);
  if (directTasks.length) return directTasks;

  const scalarTasks = serviceTaskKeys.flatMap((key) => {
    const value = source?.[key];
    return Array.isArray(value) || (value && typeof value === 'object') ? [] : toServiceLabels(value);
  });
  if (scalarTasks.length) return scalarTasks;

  for (const key of ['data', 'shipment', 'row', 'record', 'detail', 'result', 'payload']) {
    const value = source?.[key];
    if (!value || typeof value !== 'object' || value === source) continue;
    const nestedTasks = extractServiceTasks(value);
    if (nestedTasks.length) return nestedTasks;
  }

  return [];
};

const mergeServiceTasks = (...taskGroups) => {
  const mergedTasks = new Map();

  taskGroups.flatMap((group) => extractServiceTasks(group)).filter(Boolean).forEach((service, index) => {
    const serviceLabel = getServiceTaskLabel(service) || formatServiceLabel(service);
    const key = String(
      getServiceTaskId(service) ||
        `${getServiceTaskLineItemId(service)}-${getServiceTaskSku(service)}-${serviceLabel}-${index}`
    );

    if (!mergedTasks.has(key)) {
      mergedTasks.set(key, service);
    }
  });

  return [...mergedTasks.values()];
};

const getServiceTaskLineItemId = (service = {}) =>
  firstPresent(
    service?.lineItemId,
    service?.line_item_id,
    service?.shipmentLineItemId,
    service?.shipment_line_item_id,
    service?.shipmentItemId,
    service?.shipment_item_id,
    service?.itemId,
    service?.item_id,
    service?.lineItem?.id,
    service?.lineItem?.uuid,
    service?.line_item?.id,
    service?.line_item?.uuid,
    service?.shipmentLineItem?.id,
    service?.shipmentLineItem?.uuid,
    service?.shipment_line_item?.id,
    service?.shipment_line_item?.uuid,
    service?.shipmentItem?.id,
    service?.shipmentItem?.uuid,
    service?.shipment_item?.id,
    service?.shipment_item?.uuid,
    service?.item?.id,
    service?.item?.uuid
  );

const getServiceTaskSku = (service = {}) =>
  firstPresent(
    service?.sku,
    service?.sellerSku,
    service?.seller_sku,
    service?.lineItemSku,
    service?.line_item_sku,
    service?.shipmentLineItemSku,
    service?.shipment_line_item_sku,
    service?.shipmentItemSku,
    service?.shipment_item_sku,
    service?.productSku,
    service?.product_sku,
    service?.lineItem?.sku,
    service?.lineItem?.sellerSku,
    service?.lineItem?.seller_sku,
    service?.line_item?.sku,
    service?.line_item?.sellerSku,
    service?.line_item?.seller_sku,
    service?.shipmentLineItem?.sku,
    service?.shipmentLineItem?.sellerSku,
    service?.shipmentLineItem?.seller_sku,
    service?.shipment_line_item?.sku,
    service?.shipment_line_item?.sellerSku,
    service?.shipment_line_item?.seller_sku,
    service?.shipmentItem?.sku,
    service?.shipmentItem?.sellerSku,
    service?.shipmentItem?.seller_sku,
    service?.shipment_item?.sku,
    service?.shipment_item?.sellerSku,
    service?.shipment_item?.seller_sku,
    service?.item?.sku,
    service?.item?.sellerSku,
    service?.item?.seller_sku
  );

const getServiceTaskLabel = (service = {}) =>
  formatServiceLabel(firstPresent(service?.serviceType, service?.service_type, service?.name, service?.serviceName, service?.service_name, service?.type, service));

const getServiceTaskId = (service = {}) =>
  firstPresent(service?.id, service?.uuid, service?.taskId, service?.task_id, service?.serviceTaskId, service?.service_task_id);

const getServiceTaskStatus = (service = {}) =>
  firstPresent(service?.status, service?.taskStatus, service?.task_status, service?.state) || 'PENDING';

const isDisplayServiceLabel = (value = '') => {
  const normalized = String(value || '').trim().toLowerCase();
  return Boolean(normalized && !['-', 'n/a', 'na', 'none', 'null', 'undefined'].includes(normalized));
};

const firstDisplayValue = (...values) => firstPresent(...values.filter(isDisplayServiceLabel));

const isCustomServiceTask = (service = {}) => {
  const rawType = String(firstPresent(service?.serviceType, service?.service_type, service?.type)).trim().toLowerCase();
  const label = getServiceTaskLabel(service);

  if (!isDisplayServiceLabel(label)) return false;
  return rawType === 'other' || rawType === 'other_service' || label.toLowerCase() === 'other' || !STANDARD_SERVICE_KEYS.has(normalizeServiceKey(label));
};

const itemMatchesReferences = (item = {}, { lineItemId = '', sku = '', fnsku = '' } = {}) => {
  const itemId = String(getLineItemRecordId(item) || '').trim();
  const itemSku = String(getLineItemSku(item) || '').trim().toLowerCase();
  const itemFnsku = String(getLineItemFnsku(item) || '').trim().toLowerCase();
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

  if (lineItemId || sku) return itemMatchesReferences(item, { lineItemId, sku }) || itemCount === 1;
  return itemCount === 1;
};

const getDiscrepancyLineItem = (discrepancy = {}) =>
  discrepancy?.lineItem ||
  discrepancy?.line_item ||
  discrepancy?.shipmentItem ||
  discrepancy?.shipment_item ||
  discrepancy?.shipmentLineItem ||
  discrepancy?.shipment_line_item ||
  discrepancy?.item ||
  {};

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
    discrepancy?.item?.id,
    discrepancy?.item?.uuid,
    getLineItemRecordId(getDiscrepancyLineItem(discrepancy))
  );

const getDiscrepancySku = (discrepancy = {}) =>
  firstDisplayValue(
    getLineItemSku(getDiscrepancyLineItem(discrepancy)),
    getLineItemSku(discrepancy),
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

const sameLineItem = (left = {}, right = {}) => {
  const leftId = String(getLineItemRecordId(left) || '').trim();
  const rightId = String(getLineItemRecordId(right) || '').trim();
  const leftSku = String(getLineItemSku(left) || '').trim().toLowerCase();
  const rightSku = String(getLineItemSku(right) || '').trim().toLowerCase();
  const leftFnsku = String(getLineItemFnsku(left) || '').trim().toLowerCase();
  const rightFnsku = String(getLineItemFnsku(right) || '').trim().toLowerCase();

  return Boolean(
    (leftId && rightId && leftId === rightId) ||
      (isDisplayServiceLabel(leftSku) && isDisplayServiceLabel(rightSku) && leftSku === rightSku) ||
      (isDisplayServiceLabel(leftFnsku) && isDisplayServiceLabel(rightFnsku) && leftFnsku === rightFnsku)
  );
};

const findLineItemForDiscrepancy = (discrepancy = {}, lineItems = [], fallbackIndex = -1) => {
  const discrepancyLineItem = getDiscrepancyLineItem(discrepancy);
  const discrepancyLineItemId = String(getDiscrepancyLineItemId(discrepancy) || getLineItemRecordId(discrepancyLineItem) || '').trim();
  const discrepancySku = String(getDiscrepancySku(discrepancy) || '').trim().toLowerCase();

  return (
    lineItems.find((item) => {
      const itemId = String(getLineItemRecordId(item) || '').trim();
      const itemSku = String(getLineItemSku(item) || '').trim().toLowerCase();
      return (
        (discrepancyLineItemId && itemId && discrepancyLineItemId === itemId) ||
        (isDisplayServiceLabel(discrepancySku) && isDisplayServiceLabel(itemSku) && discrepancySku === itemSku)
      );
    }) ||
    (fallbackIndex >= 0 ? lineItems[fallbackIndex] : null) ||
    (lineItems.length === 1 ? lineItems[0] : null) ||
    discrepancyLineItem ||
    {}
  );
};

const getLineItemReceivedQty = (item = {}) =>
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
    getLineItemExpectedQty(discrepancyLineItem),
    getLineItemExpectedQty(matchedLineItem)
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
    getLineItemExpectedQty(discrepancyLineItem),
    getLineItemExpectedQty(matchedLineItem),
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
    getLineItemReceivedQty(discrepancyLineItem),
    getLineItemReceivedQty(matchedLineItem)
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
    getLineItemReceivedQty(discrepancyLineItem),
    getLineItemReceivedQty(matchedLineItem),
    0
  );

  return firstPresent(receivedFromDiscrepancy, receivedFromLineItem, fallbackReceived, 0);
};

const getDiscrepancyDifferenceQty = (discrepancy = {}, matchedLineItem = {}) => {
  const explicitDifference = firstQuantity(
    discrepancy?.difference,
    discrepancy?.differenceQty,
    discrepancy?.difference_qty,
    discrepancy?.qtyDifference,
    discrepancy?.qty_difference,
    discrepancy?.quantityDifference,
    discrepancy?.quantity_difference
  );

  if (explicitDifference !== '') return explicitDifference;

  const expected = Number(getDiscrepancyExpectedQty(discrepancy, matchedLineItem));
  const received = Number(getDiscrepancyReceivedQty(discrepancy, matchedLineItem));

  return Number.isFinite(expected) && Number.isFinite(received) ? received - expected : '';
};

const updateDiscrepancyRowsAfterResolve = (rows = [], target = {}, responseData = {}) => {
  const lineItemId = String(target?.lineItemId || '').trim();
  const discrepancyId = String(target?.discrepancy?.id || target?.discrepancy?.uuid || '').trim();

  const matchesTarget = (row = {}) => {
    const rowIds = [
      getDiscrepancyLineItemId(row),
      getLineItemRecordId(getDiscrepancyLineItem(row)),
      row?.id,
      row?.uuid,
    ].map((value) => String(value || '').trim());

    return Boolean(
      (lineItemId && rowIds.includes(lineItemId)) ||
        (discrepancyId && rowIds.includes(discrepancyId))
    );
  };

  if (responseData?.resolved === true) {
    return rows.filter((row) => !matchesTarget(row));
  }

  const linePatch = { ...(responseData || {}) };
  delete linePatch.shipment;

  return rows.map((row) => {
    if (!matchesTarget(row)) return row;

    return {
      ...row,
      ...linePatch,
      lineItem: {
        ...getDiscrepancyLineItem(row),
        ...linePatch,
      },
    };
  });
};

const isDiscrepancyForItem = (discrepancy = {}, item = {}, lineItems = [], discrepancyIndex = -1) => {
  const lineItemId = getDiscrepancyLineItemId(discrepancy);
  const sku = getDiscrepancySku(discrepancy);

  if (lineItemId || sku) return itemMatchesReferences(item, { lineItemId, sku });
  if (lineItems.length === 1) return sameLineItem(item, lineItems[0]);

  const matchedLineItem = findLineItemForDiscrepancy(discrepancy, lineItems, discrepancyIndex);
  return sameLineItem(item, matchedLineItem);
};

const extractCustomServices = (shipment = {}, serviceTasks = []) => {
  const items = getShipmentLineItems(shipment);
  const customServices = items.flatMap((item) =>
    (item?.customServices || item?.custom_services || []).map((service, index) => ({
      id: service?.id || `${getLineItemRecordId(item) || getLineItemSku(item) || 'item'}-${index}`,
      lineItemId: getLineItemRecordId(item) || '',
      sku: getLineItemSku(item) || '-',
      name: service?.name || service?.serviceName || service?.service_name || 'Custom Service',
      status: service?.status || 'PENDING',
    }))
  );
  const existingKeys = new Set(customServices.map((service) => `${service.lineItemId}-${String(service.name || '').toLowerCase()}`));

  extractServiceTasks(serviceTasks)
    .filter(isCustomServiceTask)
    .forEach((service, index) => {
      const serviceLineItemId = String(getServiceTaskLineItemId(service) || '').trim();
      const serviceSku = String(getServiceTaskSku(service) || '').trim().toLowerCase();
      const matchedItem = items.find((item) => {
        const itemId = String(getLineItemRecordId(item) || '').trim();
        const itemSku = String(getLineItemSku(item) || '').trim().toLowerCase();
        return (serviceLineItemId && itemId === serviceLineItemId) || (serviceSku && itemSku === serviceSku);
      });
      const lineItemId = serviceLineItemId || getLineItemRecordId(matchedItem) || '';
      const name = firstPresent(service?.customServiceName, service?.custom_service_name, service?.name, service?.serviceName, service?.service_name, getServiceTaskLabel(service), 'Other Service');
      const key = `${lineItemId}-${String(name || '').toLowerCase()}`;

      if (existingKeys.has(key)) return;
      existingKeys.add(key);

      customServices.push({
        id: getServiceTaskId(service) || `custom-${lineItemId || serviceSku || index}`,
        lineItemId,
        sku: getLineItemSku(matchedItem) || getServiceTaskSku(service) || '-',
        name,
        status: getServiceTaskStatus(service),
      });
    });

  return customServices;
};

const isCustomServiceForItem = (service = {}, item = {}, itemCount = 0) => {
  const lineItemId = service?.lineItemId || service?.line_item_id || '';
  const sku = service?.sku || '';

  if (lineItemId || sku) return itemMatchesReferences(item, { lineItemId, sku });
  return itemCount === 1;
};

const getBoxTitle = (box = {}, index = 0) => {
  const rawTitle = firstPresent(box?.name, box?.label, box?.reference, box?.boxNumber, box?.box_number);
  const title = String(rawTitle || '').trim();

  if (/^\d+$/.test(title)) return `Box ${title}`;
  return title || `Box #${index + 1}`;
};

const getBoxId = (box = {}) =>
  firstPresent(box?.id, box?.uuid, box?.boxId, box?.box_id);

const getBoxRecordId = (box = {}) =>
  firstUuidValue(box?.id, box?.uuid, box?.boxId, box?.box_id, box?.recordId, box?.record_id, box?.boxRecordId, box?.box_record_id);

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
    ]
      .map((value) => String(value || '').trim())
      .filter(isUuidValue)
      .filter(Boolean)
  ),
];

const getBoxItemsLookupId = (box = {}) =>
  getBoxRecordId(box) || getBoxLookupIds(box).find(Boolean);

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

const getBoxRawStatus = (box = {}) =>
  firstPresent(box?.status, box?.boxStatus, box?.box_status, box?.state, box?.dispatchStatus, box?.dispatch_status, box?.labelStatus, box?.label_status);

const isBoxDispatchedStatus = (box = {}) => {
  const normalizedStatus = String(getBoxRawStatus(box) || '').trim().toLowerCase().replace(/\s+/g, '_');

  return Boolean(
    box?.dispatched_at ||
      box?.dispatchedAt ||
      box?.dispatch_date ||
      box?.dispatchDate ||
      ['dispatched', 'sealed', 'completed', 'complete'].includes(normalizedStatus)
  );
};

const getBoxStatus = (box = {}) => {
  const rawStatus = getBoxRawStatus(box);
  const normalizedStatus = String(rawStatus || '').trim().toLowerCase().replace(/\s+/g, '_');
  if (['completed', 'complete'].includes(normalizedStatus)) return 'Completed';
  if (isBoxDispatchedStatus(box)) return 'Dispatched';
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
  firstPresent(box?.weight, box?.weightKg, box?.weight_kg, box?.grossWeight, box?.gross_weight, box?.totalWeight, box?.total_weight, 0);

const getBoxSize = (box = {}) =>
  firstPresent(box?.boxSize, box?.box_size, box?.size, box?.type, box?.boxType, box?.box_type);

const getBoxTypeValue = (box = {}) =>
  String(firstPresent(box?.boxType, box?.box_type, box?.containerType, box?.container_type, box?.type, 'box'))
    .trim()
    .toLowerCase();

const isPalletBox = (box = {}) => getBoxTypeValue(box) === 'pallet';

const getBoxPalletId = (box = {}) =>
  firstPresent(box?.palletId, box?.pallet_id, box?.pallet?.id, box?.pallet?.uuid);

const isBoxInsidePallet = (box = {}) =>
  Boolean(
    getBoxPalletId(box) ||
      box?.insidePallet ||
      box?.inside_pallet ||
      box?.isChildBox ||
      box?.is_child_box
  );

const getPalletChildBoxes = (box = {}) => {
  const children = [
    ...extractList(box?.palletChildren || box?.pallet_children),
    ...extractList(box?.childBoxes || box?.child_boxes),
    ...extractList(box?.children),
    ...extractList(box?.pallet || {}, ['palletChildren', 'pallet_children', 'childBoxes', 'child_boxes', 'children', 'boxes']),
  ];
  const seenKeys = new Set();

  return children.filter((childBox, childIndex) => {
    const key = String(getBoxRecordId(childBox) || getBoxId(childBox) || childIndex);
    if (seenKeys.has(key)) return false;
    seenKeys.add(key);
    return true;
  });
};

const getBoxPalletLabel = (box = {}, index = 0) =>
  isPalletBox(box) ? String(getBoxTitle(box, index)).replace(/^Box\b/i, 'Pallet') : getBoxTitle(box, index);

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

const getBoxUnits = (box = {}) => {
  const itemQuantities = getBoxItems(box)
    .map((item) => getBoxItemQuantity(item))
    .filter((quantity) => quantity !== '' && quantity !== undefined && quantity !== null);

  if (itemQuantities.length) {
    return itemQuantities.reduce((sum, quantity) => {
      const numericQuantity = Number(quantity);
      return Number.isFinite(numericQuantity) ? sum + numericQuantity : sum;
    }, 0);
  }

  return firstPresent(box?.units, box?.quantity, box?.qty, box?.itemCount, box?.item_count, box?.unitCount, box?.unit_count);
};

const getBoxItems = (box = {}) => {
  const directItems = extractList(box, ['items', 'boxItems', 'box_items', 'contents', 'lineItems', 'line_items']);
  if (directItems.length) return directItems;

  const rawContents = firstPresent(box?.contents, box?.box_contents);
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

const getLineItemMatchIds = (lineItem = {}) => [
  getLineItemRecordId(lineItem),
  lineItem?.shipmentItemId,
  lineItem?.shipment_item_id,
  lineItem?.shipmentLineItemId,
  lineItem?.shipment_line_item_id,
  lineItem?.lineItemId,
  lineItem?.line_item_id,
  lineItem?.id,
  lineItem?.uuid,
]
  .map((value) => String(value || '').trim())
  .filter(Boolean);

const extractBoxItems = (payload) => {
  const directItems = extractList(payload, [
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
  ]);
  if (directItems.length) return directItems;

  const containers = [
    payload?.data,
    payload?.box,
    payload?.data?.box,
    payload?.record,
    payload?.data?.record,
    payload?.payload,
    payload?.data?.payload,
  ];

  for (const container of containers) {
    const items = extractList(container, [
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
    ]);
    if (items.length) return items;
  }

  return [];
};

const getBoxLineItemId = (box = {}) =>
  firstPresent(
    box?.shipmentItemId,
    box?.shipment_item_id,
    box?.shipmentLineItemId,
    box?.shipment_line_item_id,
    box?.lineItemId,
    box?.line_item_id,
    box?.itemId,
    box?.item_id,
    box?.metadata?.shipmentItemId,
    box?.metadata?.shipment_item_id,
    box?.meta?.shipmentItemId,
    box?.meta?.shipment_item_id
  );

const getBoxSku = (box = {}) =>
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
  );

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
    item?.item?.uuid,
    item?.product?.id,
    item?.product?.uuid,
    item?.product_item?.id,
    item?.product_item?.uuid
  );

const getBoxItemSku = (item = {}) => {
  if (typeof item === 'string') return item.trim();

  return firstPresent(
    item?.sku,
    item?.sellerSku,
    item?.seller_sku,
    item?.msku,
    item?.asinSku,
    item?.asin_sku,
    item?.shipmentItemSku,
    item?.shipment_item_sku,
    item?.lineItemSku,
    item?.line_item_sku,
    item?.productSku,
    item?.product_sku,
    item?.product?.sku,
    item?.product?.sellerSku,
    item?.product?.seller_sku,
    item?.shipmentItem?.sku,
    item?.shipmentItem?.sellerSku,
    item?.shipmentItem?.seller_sku,
    item?.shipmentItem?.productSku,
    item?.shipmentItem?.product_sku,
    item?.shipmentItem?.product?.sku,
    item?.shipmentItem?.product?.sellerSku,
    item?.shipmentItem?.product?.seller_sku,
    item?.shipment_item?.sku,
    item?.shipment_item?.sellerSku,
    item?.shipment_item?.seller_sku,
    item?.shipment_item?.productSku,
    item?.shipment_item?.product_sku,
    item?.shipment_item?.product?.sku,
    item?.shipment_item?.product?.sellerSku,
    item?.shipment_item?.product?.seller_sku,
    item?.shipmentLineItem?.sku,
    item?.shipmentLineItem?.sellerSku,
    item?.shipmentLineItem?.seller_sku,
    item?.shipment_line_item?.sku,
    item?.shipment_line_item?.sellerSku,
    item?.shipment_line_item?.seller_sku,
    item?.lineItem?.sku,
    item?.lineItem?.sellerSku,
    item?.lineItem?.seller_sku,
    item?.lineItem?.product?.sku,
    item?.line_item?.sku,
    item?.line_item?.sellerSku,
    item?.line_item?.seller_sku,
    item?.line_item?.product?.sku,
    item?.item?.sku,
    item?.item?.sellerSku,
    item?.item?.seller_sku,
    item?.item?.product?.sku,
    item?.product_item?.sku,
    item?.product_item?.sellerSku,
    item?.product_item?.seller_sku
  );
};

const getBoxItemQuantity = (item = {}) => {
  if (typeof item === 'number') return Number.isFinite(item) ? item : '';
  if (typeof item === 'string') {
    const quantityMatch = item.match(/(?:qty|quantity|units?)?\s*[:x-]\s*(\d+(?:\.\d+)?)/i);
    return quantityMatch ? quantityMatch[1] : '';
  }

  return firstPresent(
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
    item?.allocatedUnits,
    item?.allocated_units,
    item?.packedQuantity,
    item?.packed_quantity,
    item?.packedUnits,
    item?.packed_units,
    item?.boxedQuantity,
    item?.boxed_quantity,
    item?.boxedUnits,
    item?.boxed_units,
    item?.skuQty,
    item?.sku_qty,
    item?.skuQuantity,
    item?.sku_quantity,
    item?.unitCount,
    item?.unit_count,
    item?.totalUnits,
    item?.total_units,
    item?.totalQuantity,
    item?.total_quantity,
    item?.count,
    item?.metadata?.quantity,
    item?.metadata?.qty,
    item?.metadata?.units,
    item?.meta?.quantity,
    item?.meta?.qty,
    item?.meta?.units,
    ''
  );
};

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

const normalizeBoxAllocationItems = (items = []) =>
  toArray(items)
    .map((item) => (item && typeof item === 'object' ? item : { sku: String(item || '').trim() }))
    .map((item) => {
      const sku = String(getBoxItemSku(item) || '').trim();
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

const getCachedBoxAllocationItems = (box = {}) => {
  const cache = readBoxAllocationCache();
  const keys = getBoxAllocationCacheKeys(box);
  const cachedItems = keys.map((key) => cache[key]).find((items) => toArray(items).length);
  return normalizeBoxAllocationItems(cachedItems || []);
};

const findLineItemForBoxItem = (boxItem = {}, lineItemList = []) => {
  const boxItemId = String(getBoxItemLineItemId(boxItem) || '').trim();
  const boxItemSku = normalizeFileMatchValue(getBoxItemSku(boxItem));

  return toArray(lineItemList).find((lineItem) => {
    const lineItemIds = getLineItemMatchIds(lineItem);
    const lineItemSku = normalizeFileMatchValue(getLineItemSku(lineItem));

    return Boolean(
      (boxItemId && lineItemIds.includes(boxItemId)) ||
        (boxItemSku && lineItemSku && boxItemSku === lineItemSku)
    );
  });
};

const hydrateBoxItemWithLineItem = (boxItem = {}, lineItemList = []) => {
  const matchedLineItem = findLineItemForBoxItem(boxItem, lineItemList);
  const matchedLineItemId = matchedLineItem ? getLineItemRecordId(matchedLineItem) : '';
  const sku = getBoxItemSku(boxItem) || getLineItemSku(matchedLineItem || {});
  const quantity = getBoxItemQuantity(boxItem);

  return {
    ...boxItem,
    ...(matchedLineItemId && !getBoxItemLineItemId(boxItem)
      ? {
          shipmentItemId: matchedLineItemId,
          shipment_item_id: matchedLineItemId,
          lineItemId: matchedLineItemId,
          line_item_id: matchedLineItemId,
        }
      : {}),
    ...(sku && !getBoxItemSku(boxItem)
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

const isBoxItemForLineItem = (boxItem = {}, item = {}) => {
  const itemIds = getLineItemMatchIds(item);
  const itemSku = normalizeFileMatchValue(getLineItemSku(item));
  const boxItemId = String(getBoxItemLineItemId(boxItem) || '').trim();
  const boxItemSku = normalizeFileMatchValue(getBoxItemSku(boxItem));

  return Boolean((boxItemId && itemIds.includes(boxItemId)) || (itemSku && boxItemSku && itemSku === boxItemSku));
};

const getBoxPrimarySku = (box = {}) =>
  normalizeFileMatchValue(firstPresent(getBoxSku(box), getBoxItemSku(getBoxItems(box)[0])));

const getBoxDisplaySkuValues = (box = {}) => [
  ...new Set(
    [
      getBoxSku(box),
      box?.skuSummary,
      box?.sku_summary,
      box?.skus,
      box?.skuList,
      box?.sku_list,
      box?.metadata?.sku,
      box?.metadata?.skuSummary,
      box?.metadata?.sku_summary,
      box?.metadata?.skus,
      box?.metadata?.skuList,
      box?.metadata?.sku_list,
      box?.meta?.sku,
      box?.meta?.skuSummary,
      box?.meta?.sku_summary,
      box?.meta?.skus,
      box?.meta?.skuList,
      box?.meta?.sku_list,
      ...getBoxItems(box).map((item) => getBoxItemSku(item)),
    ]
      .flatMap((value) => {
        if (Array.isArray(value)) return value;
        const rawValue = String(value || '');
        const parenthesizedSkus = [...rawValue.matchAll(/\(([^)]+)\)/g)].map((match) => match[1]);
        return [rawValue, ...parenthesizedSkus];
      })
      .flatMap((skuValue) => String(skuValue || '').split(/[,|]/))
      .map((sku) => normalizeFileMatchValue(sku.replace(/\b\d+(?:\.\d+)?\s*(?:units?|qty)\b/gi, '')))
      .map((sku) => sku.replace(/[()]/g, '').trim())
      .filter(Boolean)
  ),
];

const getBoxPrimaryQty = (box = {}) =>
  firstPresent(
    getBoxUnits(box),
    getBoxItemQuantity(getBoxItems(box)[0]),
    ''
  );

const getBoxContentsSummary = (box = {}, lineItem = null) => {
  const allItems = getBoxItems(box);
  const contentItems = lineItem
    ? allItems.filter((item) => isBoxItemForLineItem(item, lineItem))
    : allItems;
  const rows = contentItems
    .map((item) => {
      const sku = getBoxItemSku(item);
      const quantity = getBoxItemQuantity(item);

      if (sku && quantity !== '') return `${sku} x ${quantity}`;
      if (sku) return sku;
      if (quantity !== '') return `SKU pending x ${quantity}`;
      return '';
    })
    .filter(Boolean);

  if (rows.length) return rows.join(', ');

  if (lineItem) {
    const itemId = String(getLineItemRecordId(lineItem) || '').trim();
    const itemSku = normalizeFileMatchValue(getLineItemSku(lineItem));
    const boxLineItemId = String(getBoxLineItemId(box) || '').trim();
    const boxSku = getBoxPrimarySku(box);
    const boxSkuValues = getBoxDisplaySkuValues(box);
    const boxMatchesLineItem = Boolean(
      (itemId && boxLineItemId && itemId === boxLineItemId) ||
        (itemSku && ((boxSku && itemSku === boxSku) || boxSkuValues.includes(itemSku)))
    );

    if (!boxMatchesLineItem) return '';
    if (boxSkuValues.length > 1) return '';
  }

  const sku = lineItem ? getLineItemSku(lineItem) : getBoxPrimarySku(box);
  const quantity = getBoxPrimaryQty(box);
  if (sku && quantity !== '') return `${sku} x ${quantity}`;
  return sku || '';
};

const isBoxForLineItem = (box = {}, item = {}, lineItems = []) => {
  const itemId = String(getLineItemRecordId(item) || '').trim();
  const itemSku = normalizeFileMatchValue(getLineItemSku(item));
  const boxLineItemId = String(getBoxLineItemId(box) || '').trim();
  const boxSku = getBoxPrimarySku(box);
  const boxSkuValues = getBoxDisplaySkuValues(box);
  const boxItems = getBoxItems(box);

  if (
    (itemId && boxLineItemId && itemId === boxLineItemId) ||
    (itemSku && ((boxSku && itemSku === boxSku) || boxSkuValues.includes(itemSku)))
  ) {
    return true;
  }

  if (boxItems.some((boxItem) => {
    const boxItemId = String(getBoxItemLineItemId(boxItem) || '').trim();
    const boxItemSku = normalizeFileMatchValue(getBoxItemSku(boxItem));
    return Boolean((itemId && boxItemId && itemId === boxItemId) || (itemSku && boxItemSku && itemSku === boxItemSku));
  })) {
    return true;
  }

  return lineItems.length === 1 && !boxLineItemId && !boxSku && !boxItems.length;
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

const isUsableFileUrlCandidate = (value = '') => {
  const url = String(value || '').trim();
  if (!url) return false;
  if (/^(https?:|data:|blob:)/i.test(url)) return true;
  if (url.startsWith('/')) return true;
  return url.includes('/');
};

const isStoragePathCandidate = (url = '') => {
  const normalizedUrl = String(url || '').trim();
  if (!normalizedUrl || normalizedUrl.startsWith('/') || /^(https?:|data:|blob:)/i.test(normalizedUrl)) return false;
  if (/^api\//i.test(normalizedUrl)) return false;
  return normalizedUrl.includes('/') && /\.[a-z0-9]{2,8}(?:$|\?)/i.test(normalizedUrl);
};

const safeDecodeStoragePath = (path = '') => {
  let decodedPath = String(path || '');

  for (let index = 0; index < 4; index += 1) {
    try {
      const nextPath = decodeURIComponent(decodedPath);
      if (nextPath === decodedPath) break;
      decodedPath = nextPath;
    } catch {
      break;
    }
  }

  return decodedPath;
};

const encodeStoragePath = (path = '') =>
  String(path || '')
    .trim()
    .replace(/^\/+/, '')
    .split('/')
    .map((part) => encodeURIComponent(safeDecodeStoragePath(part)))
    .join('/');

const buildStoragePublicUrl = (bucket = SUPABASE_DEFAULT_STORAGE_BUCKET, path = '') => {
  const normalizedPath = String(path || '').trim().replace(/^\/+/, '');
  if (!SUPABASE_STORAGE_PUBLIC_BASE_URL || !bucket || !isStoragePathCandidate(normalizedPath)) return '';
  return `${SUPABASE_STORAGE_PUBLIC_BASE_URL}/${bucket}/${encodeStoragePath(normalizedPath)}`;
};

const encodeHttpUrlOnce = (url = '') => {
  try {
    return encodeURI(decodeURI(String(url || '').trim()));
  } catch {
    return encodeURI(String(url || '').trim()).replace(/%25([0-9a-f]{2})/gi, '%$1');
  }
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

  return objectPath ? `${prefix}${encodeStoragePath(objectPath)}${query}${hash}` : encodeHttpUrlOnce(value);
};

const firstUsableFileUrl = (...values) => {
  const value = values.find(isUsableFileUrlCandidate);
  return value === undefined || value === null ? '' : String(value).trim();
};

const getFileUrl = (file = {}) => {
  const meta = getFileMeta(file);
  return firstUsableFileUrl(
    file?.signedUrl,
    file?.signed_url,
    file?.signedURL,
    file?.signed_url,
    file?.previewUrl,
    file?.preview_url,
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
    file?.url,
    file?.href,
    file?.src,
    meta?.signedUrl,
    meta?.signed_url,
    meta?.signedURL,
    meta?.previewUrl,
    meta?.preview_url,
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
    meta?.url,
    meta?.href,
    meta?.src
  );
};

const getFileName = (file = {}) =>
  firstPresent(
    file?.name,
    file?.fileName,
    file?.file_name,
    file?.originalName,
    file?.original_name,
    file?.original_filename,
    file?.filename,
    file?.storagePath,
    file?.storage_path,
    file?.filePath,
    file?.file_path,
    file?.path,
    file?.url,
    getFileMeta(file)?.name,
    getFileMeta(file)?.fileName,
    getFileMeta(file)?.file_name,
    getFileMeta(file)?.originalName,
    getFileMeta(file)?.original_name,
    getFileMeta(file)?.original_filename,
    getFileMeta(file)?.filename,
    getFileMeta(file)?.storagePath,
    getFileMeta(file)?.storage_path,
    getFileMeta(file)?.filePath,
    getFileMeta(file)?.file_path,
    getFileMeta(file)?.path,
    getFileMeta(file)?.url,
    'download'
  );

const cleanFileDisplayName = (value = 'download') => {
  const rawName = String(value || 'download').split('?')[0];
  const baseName = rawName.split(/[\\/]/).filter(Boolean).pop() || rawName;
  return baseName.replace(/^\d{10,}-+/, '') || baseName || 'download';
};

const getFileDisplayName = (file = {}) => cleanFileDisplayName(getFileName(file));

const getFileTypeValue = (file = {}) =>
  String(
    firstPresent(
      file?.fileType,
      file?.file_type,
      file?.type,
      file?.mimeType,
      file?.mime_type,
      file?.mime,
      file?.contentType,
      file?.content_type,
      getFileMeta(file)?.fileType,
      getFileMeta(file)?.file_type,
      getFileMeta(file)?.type,
      getFileMeta(file)?.mimeType,
      getFileMeta(file)?.mime_type,
      getFileMeta(file)?.mime,
      getFileMeta(file)?.contentType,
      getFileMeta(file)?.content_type
    )
  ).toLowerCase();

const resolveFileUrl = (url = '') => {
  const normalizedUrl = String(url || '').trim();
  if (!normalizedUrl || !isUsableFileUrlCandidate(normalizedUrl)) return '';
  if (/^(data:|blob:)/i.test(normalizedUrl)) return normalizedUrl;
  if (/^https?:/i.test(normalizedUrl)) return encodeSupabasePublicObjectUrl(normalizedUrl) || encodeHttpUrlOnce(normalizedUrl);
  if (isStoragePathCandidate(normalizedUrl)) {
    return buildStoragePublicUrl(SUPABASE_DEFAULT_STORAGE_BUCKET, normalizedUrl) || encodeHttpUrlOnce(`${BACKEND_BASE_URL}/${normalizedUrl.replace(/^\/+/, '')}`);
  }
  return encodeURI(`${BACKEND_BASE_URL}${normalizedUrl.startsWith('/') ? normalizedUrl : `/${normalizedUrl}`}`);
};

const getFileUrlQuality = (file = {}) => {
  const meta = getFileMeta(file);
  if (firstUsableFileUrl(file?.signedUrl, file?.signed_url, file?.signedURL, meta?.signedUrl, meta?.signed_url, meta?.signedURL)) return 5;
  if (firstUsableFileUrl(file?.publicUrl, file?.public_url, file?.publicURL, meta?.publicUrl, meta?.public_url, meta?.publicURL)) return 4;
  if (firstUsableFileUrl(file?.previewUrl, file?.preview_url, meta?.previewUrl, meta?.preview_url)) return 4;
  if (firstUsableFileUrl(file?.downloadUrl, file?.download_url, file?.downloadURL, meta?.downloadUrl, meta?.download_url, meta?.downloadURL)) return 4;
  if (firstUsableFileUrl(file?.fileUrl, file?.file_url, file?.storageUrl, file?.storage_url, meta?.fileUrl, meta?.file_url, meta?.storageUrl, meta?.storage_url)) return 3;
  const rawUrl = firstUsableFileUrl(file?.url, file?.href, file?.src, meta?.url, meta?.href, meta?.src);
  if (/^(https?:|data:|blob:)/i.test(rawUrl)) return 2;
  return rawUrl ? 1 : 0;
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

const openOrDownloadFile = async (file = {}) => {
  let fileUrl = resolveFileUrl(getFileUrl(file));
  const fileId = getFileRecordId(file);
  const entityType = getFileEntityType(file);
  const entityId = getFileEntityId(file);

  if (!fileUrl && entityType && entityId) {
    const entityFiles = await fetchFilesByEntity(entityType, entityId);
    const matchedFile =
      entityFiles.find((entityFile) => fileId && String(getFileRecordId(entityFile) || '').trim() === String(fileId)) ||
      entityFiles.find((entityFile) => getFileDisplayName(entityFile) === getFileDisplayName(file)) ||
      entityFiles[0];
    fileUrl = resolveFileUrl(getFileUrl(matchedFile || {}));
  }

  if (!fileUrl && fileId) {
    const freshFiles = await fetchFileById(fileId);
    fileUrl = resolveFileUrl(getFileUrl(freshFiles[0] || {}));
  }

  if (fileUrl) window.open(fileUrl, '_blank', 'noopener,noreferrer');
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
        file?.original_filename ||
        file?.storagePath ||
        file?.storage_path)
  );

const extractFiles = (payload) => {
  const files = extractList(payload, ['files', 'fileList', 'file_list', 'attachments', 'uploads']);
  if (files.length) return files;

  const candidates = [
    payload,
    payload?.data,
    payload?.result,
    payload?.payload,
    payload?.file,
    payload?.data?.file,
    payload?.record,
    payload?.data?.record,
  ];
  const singleFile = candidates.find(hasFileShape);

  return singleFile ? [singleFile] : [];
};

const fetchFileById = async (fileId) => {
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
      const files = extractFiles(await parseResponse(response));
      if (files.length) return files;
    } catch {
      // Backends differ on file lookup shape, so try the next supported route.
    }
  }

  return [];
};

const fetchFilesByEntity = async (entityType, entityId) => {
  const normalizedEntityType = String(entityType || '').trim();
  const normalizedEntityId = String(entityId || '').trim();
  if (!normalizedEntityType || !normalizedEntityId) return [];

  try {
    const response = await fetch(`${API_BASE_URL}/api/files?entityType=${encodeURIComponent(normalizedEntityType)}&entityId=${encodeURIComponent(normalizedEntityId)}`, {
      method: 'GET',
      headers: buildHeaders(),
      cache: 'no-store',
    });
    return extractFiles(await parseResponse(response));
  } catch {
    return [];
  }
};

const fetchBoxItemsByBoxId = async (box = {}) => {
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
      const hasUsableItems = existingItems.some((item) =>
        (getBoxItemLineItemId(item) || getBoxItemSku(item)) && getBoxItemQuantity(item) !== ''
      );
      const boxItems = await fetchBoxItemsByBoxId(box);
      const hydratedBoxItems = hydrateBoxItemsWithLineItems(boxItems, lineItems);

      if (hydratedBoxItems.length) {
        return {
          ...box,
          items: hydratedBoxItems,
          boxItems: hydratedBoxItems,
          box_items: hydratedBoxItems,
          contents: hydratedBoxItems,
        };
      }

      const cachedItems = hydrateBoxItemsWithLineItems(getCachedBoxAllocationItems(box), lineItems);
      if (cachedItems.length) {
        return {
          ...box,
          items: cachedItems,
          boxItems: cachedItems,
          box_items: cachedItems,
          contents: cachedItems,
        };
      }

      if (hasUsableItems) {
        const hydratedExistingItems = hydrateBoxItemsWithLineItems(existingItems, lineItems);

        return {
          ...box,
          items: hydratedExistingItems,
          boxItems: hydratedExistingItems,
          box_items: hydratedExistingItems,
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
  const itemId = getLineItemEntityId(item) || getLineItemRecordId(item);
  const labelFileId = getItemLabelFileId(item);
  const fileName = firstPresent(getFileName(file), getItemLabelFileName(item), 'FNSKU label');

  return {
    ...file,
    id: getFileRecordId(file) || labelFileId || file?.id || file?.uuid || `${itemId || getLineItemSku(item) || 'item'}-fnsku-label`,
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
    sku: file?.sku || file?.sellerSku || file?.seller_sku || getLineItemSku(item),
    fnsku: file?.fnsku || file?.fnskuLabel || file?.fnsku_label || getLineItemFnsku(item),
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

const normalizeFileMatchValue = (value = '') => {
  const normalized = String(value || '').trim().toLowerCase();
  return normalized && !['-', 'n/a', 'na', 'none', 'null', 'undefined'].includes(normalized) ? normalized : '';
};

const getFileEntityId = (file = {}) =>
  firstPresent(
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
    getFileMeta(file)?.entityId,
    getFileMeta(file)?.entity_id,
    getFileMeta(file)?.itemId,
    getFileMeta(file)?.item_id,
    getFileMeta(file)?.lineItemId,
    getFileMeta(file)?.line_item_id,
    getFileMeta(file)?.shipmentLineItemId,
    getFileMeta(file)?.shipment_line_item_id,
    getFileMeta(file)?.shipmentItemId,
    getFileMeta(file)?.shipment_item_id,
    getFileMeta(file)?.linkedEntityId,
    getFileMeta(file)?.linked_entity_id,
    getFileMeta(file)?.boxId,
    getFileMeta(file)?.box_id,
    getFileMeta(file)?.shipmentId,
    getFileMeta(file)?.shipment_id
  );

const getFileEntityType = (file = {}) =>
  String(firstPresent(file?.entityType, file?.entity_type, file?.linkedEntityType, file?.linked_entity_type, getFileMeta(file)?.entityType, getFileMeta(file)?.entity_type, getFileMeta(file)?.linkedEntityType, getFileMeta(file)?.linked_entity_type)).trim().toLowerCase();

const normalizeEntityType = (value = '') => String(value || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '_');

const ITEM_FILE_ENTITY_TYPE_LIST = ['item', 'shipment_item', 'shipmentitem', 'shipment_line_item', 'shipmentlineitem', 'line_item', 'lineitem'];
const ITEM_FILE_ENTITY_TYPES = new Set(ITEM_FILE_ENTITY_TYPE_LIST);
const ITEM_FILE_LOOKUP_ENTITY_TYPES = ['item', 'shipment_item', 'shipment_line_item', 'line_item'];
const SHIPMENT_FILE_ENTITY_TYPES = new Set(['shipment']);
const BOX_FILE_ENTITY_TYPES = new Set(['box']);

const isItemFileEntityType = (value = '') => ITEM_FILE_ENTITY_TYPES.has(normalizeEntityType(value));
const isShipmentFileEntityType = (value = '') => SHIPMENT_FILE_ENTITY_TYPES.has(normalizeEntityType(value));
const isBoxFileEntityType = (value = '') => BOX_FILE_ENTITY_TYPES.has(normalizeEntityType(value));

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
  parseLineItemSequenceOrder(value, PRODUCT_SEQUENCE_PREFIXES);

const isGeneratedProductSequenceLabel = (value = '') =>
  getGeneratedProductSequence(value) !== null || isAutoGeneratedProductName(value);

const getConsistentGeneratedProductLabel = (item = {}) => {
  const { product, sku, fnsku } = getLineItemSequenceParts(item);
  const reliableOrder = sku ?? fnsku ?? product;

  return reliableOrder !== null && reliableOrder !== undefined ? `p${reliableOrder}` : '';
};

const getLineItemDisplayProductName = (item = {}, labelFile = null) => {
  const directProductName = firstPresent(
    item?.productName,
    item?.product_name,
    item?.itemName,
    item?.item_name,
    item?.name
  );
  const fileProductName = getFileProductName(labelFile || {});
  const productName = getLineItemProductName(item);
  const consistentGeneratedProductLabel = getConsistentGeneratedProductLabel(item);

  if (isGeneratedProductSequenceLabel(directProductName || productName)) {
    return consistentGeneratedProductLabel || getAutoGeneratedProductAlias(productName) || directProductName || productName;
  }

  if (fileProductName && (!directProductName || isAutoGeneratedProductName(productName))) {
    if (isGeneratedProductSequenceLabel(fileProductName)) {
      return consistentGeneratedProductLabel || fileProductName;
    }

    return fileProductName;
  }

  if (isAutoGeneratedProductName(productName)) {
    return consistentGeneratedProductLabel || getAutoGeneratedProductAlias(productName) || productName;
  }

  return directProductName || fileProductName || productName;
};

const getFileStablePath = (file = {}) => {
  const rawPath = firstPresent(
    getFileUrl(file),
    file?.storagePath,
    file?.storage_path,
    file?.filePath,
    file?.file_path,
    file?.path,
    file?.location,
    getFileMeta(file)?.storagePath,
    getFileMeta(file)?.storage_path,
    getFileMeta(file)?.filePath,
    getFileMeta(file)?.file_path,
    getFileMeta(file)?.path,
    getFileMeta(file)?.location
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
  const fileSize = firstPresent(file?.size, file?.fileSize, file?.file_size, file?.fileSizeBytes, file?.file_size_bytes, getFileMeta(file)?.size, getFileMeta(file)?.fileSizeBytes, getFileMeta(file)?.file_size_bytes);
  const stablePath = getFileStablePath(file);

  if (fileName && (entityType || entityId)) return `file:${entityType}:${entityId}:${fileName}:${fileSize || ''}`;
  if (fileName && fileType) return `filetype:${fileType}:${fileName}:${fileSize || ''}`;
  if (stablePath) return `path:${stablePath}`;
  return String(file?.id || file?.uuid || `${fileName || 'file'}-${index}`);
};

const shouldReplaceDuplicateFile = (existingFile = {}, nextFile = {}) =>
  Boolean(
    (existingFile?.localPreview && !nextFile?.localPreview) ||
      getFileUrlQuality(nextFile) > getFileUrlQuality(existingFile) ||
      (!getFileRecordId(existingFile) && getFileRecordId(nextFile)) ||
      (!existingFile?.signedUrl && !existingFile?.signed_url && (nextFile?.signedUrl || nextFile?.signed_url))
  );

const mergeFileLists = (...fileLists) => {
  const merged = new Map();

  fileLists.flat().filter(Boolean).forEach((file, index) => {
    const key = getFileDedupeKey(file, index);
    const existingFile = merged.get(key);

    if (!existingFile || shouldReplaceDuplicateFile(existingFile, file)) merged.set(key, file);
  });

  return [...merged.values()];
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

const isFbaBoxLabelFile = (file = {}) => {
  const type = getFileTypeValue(file);
  const name = getFileName(file).toLowerCase();
  const entityType = getFileEntityType(file);

  return (
    type.includes('fba_shipping_label') ||
    type.includes('fba-shipping-label') ||
    type.includes('shipping_label') ||
    name.includes('shipping-label') ||
    name.includes('shipping_label') ||
    (isBoxFileEntityType(entityType) && type.includes('label'))
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

const getBoxDirectFbaLabelFile = (box = {}) => {
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

  return {
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
};

const getBoxFbaLabelFile = (box = {}, files = []) => {
  const directLabelFile = getBoxDirectFbaLabelFile(box);
  if (directLabelFile) return directLabelFile;

  const boxLookupIds = getBoxLookupIds(box);
  const labelFileId = String(getBoxFbaLabelFileId(box) || '').trim();
  const directFiles = getBoxInlineFiles(box);
  const allFiles = mergeFileLists(directFiles, extractList(files, ['files']));

  return allFiles.find((file) => {
    const entityType = getFileEntityType(file);
    const entityId = String(getFileEntityId(file) || '').trim();
    const fileRecordId = String(getFileRecordId(file) || '').trim();
    const sameLabelFile = labelFileId && fileRecordId === labelFileId;
    const sameBox =
      (entityId && boxLookupIds.includes(entityId)) ||
      boxLookupIds.some((boxId) => file?.boxId === boxId || file?.box_id === boxId) ||
      directFiles.includes(file);

    return sameLabelFile || (sameBox && (!entityType || isBoxFileEntityType(entityType)) && isFbaBoxLabelFile(file));
  }) || null;
};

const isBoxFbaLabelUploaded = (box = {}, files = []) => {
  const status = String(box?.status || '').toLowerCase();
  return Boolean(
    box?.labelReady ||
      box?.label_ready ||
      box?.fbaLabelUploaded ||
      box?.fba_label_uploaded ||
      box?.labelUploaded ||
      box?.label_uploaded ||
      getBoxFbaLabelFileId(box) ||
      box?.label_uploaded_at ||
      status === 'uploaded' ||
      status === 'label_ready' ||
      status === 'ready' ||
      getBoxFbaLabelFile(box, files)
  );
};

const normalizeLookupValue = (value = '') => String(value || '').trim().toLowerCase();

const getShipmentFileLookupIds = (shipment = {}) => [
  ...new Set(
    [
      getShipmentRecordId(shipment),
      getShipmentId(shipment),
      shipment?.id,
      shipment?.uuid,
      shipment?.shipmentId,
      shipment?.shipment_id,
      shipment?.reference,
      shipment?.shipmentNumber,
      shipment?.shipment_number,
    ]
      .map((value) => String(value || '').trim())
      .filter(Boolean)
  ),
];

const fileMatchesLookupIds = (file = {}, lookupIds = []) => {
  const normalizedLookups = lookupIds.map(normalizeLookupValue).filter(Boolean);
  if (!normalizedLookups.length) return false;

  const entityId = normalizeLookupValue(getFileEntityId(file));
  if (entityId && normalizedLookups.includes(entityId)) return true;

  const stablePath = getFileStablePath(file);
  if (!stablePath) return false;

  return normalizedLookups.some((lookupId) => lookupId.length >= 6 && stablePath.includes(lookupId));
};

const getVisibleShipmentFiles = (files = [], shipment = {}, boxes = [], items = []) => {
  const shipmentLookupIds = getShipmentFileLookupIds(shipment);
  const boxLookupIds = boxes.flatMap((box) => getBoxLookupIds(box)).map(normalizeLookupValue).filter(Boolean);
  const itemLookupIds = items.map((item) => normalizeLookupValue(getLineItemRecordId(item))).filter(Boolean);
  const boxLabelFiles = boxes.map((box) => getBoxFbaLabelFile(box, files)).filter(Boolean);
  const boxLabelFileIds = new Set(boxLabelFiles.map((file) => normalizeLookupValue(getFileRecordId(file))).filter(Boolean));
  const boxLabelPaths = new Set(boxLabelFiles.map(getFileStablePath).filter(Boolean));

  return mergeFileLists(extractList(files, ['files'])).filter((file) => {
    if (!getFileUrl(file) && !getFileName(file)) return false;

    const entityType = getFileEntityType(file);
    const entityId = normalizeLookupValue(getFileEntityId(file));
    const fileRecordId = normalizeLookupValue(getFileRecordId(file));
    const stablePath = getFileStablePath(file);

    if (
      isBoxFileEntityType(entityType) ||
      (entityId && boxLookupIds.includes(entityId)) ||
      (fileRecordId && boxLabelFileIds.has(fileRecordId)) ||
      (stablePath && boxLabelPaths.has(stablePath)) ||
      isFbaBoxLabelFile(file)
    ) {
      return false;
    }

    if (
      isItemFileEntityType(entityType) ||
      (entityId && itemLookupIds.includes(entityId)) ||
      (isAnyItemLabelFile(file) && items.some((item) => fileMatchesLineItem(file, item)))
    ) {
      return false;
    }

    if (entityType && !isShipmentFileEntityType(entityType)) return false;
    return fileMatchesLookupIds(file, shipmentLookupIds);
  });
};

const isFnskuLabelFile = (file = {}) => {
  const type = getFileTypeValue(file);
  const name = getFileName(file).toLowerCase();
  const entityType = getFileEntityType(file);
  const url = getFileUrl(file).toLowerCase();
  const stablePath = getFileStablePath(file);

  return !isFbaBoxLabelFile(file) && (type.includes('fnsku') || name.includes('fnsku') || url.includes('fnsku') || stablePath.includes('fnsku') || (isItemFileEntityType(entityType) && (type.includes('label') || isPdfFile(file) || isImageFile(file) || isCsvFile(file))));
};

const isAnyItemLabelFile = (file = {}) => {
  const type = getFileTypeValue(file);
  const name = getFileName(file).toLowerCase();

  return !isFbaBoxLabelFile(file) && (isFnskuLabelFile(file) || type.includes('label') || name.includes('label'));
};

const getDisplayableItemFiles = (files = []) =>
  extractList(files, ['files']).filter((file) => {
    if (!getFileUrl(file) && !getFileName(file)) return false;
    const entityType = getFileEntityType(file);
    if (isBoxFileEntityType(entityType) || isFbaBoxLabelFile(file)) return false;
    return isFnskuLabelFile(file) || isAnyItemLabelFile(file) || (isItemFileEntityType(entityType) && (isImageFile(file) || isPdfFile(file) || isCsvFile(file)));
  });

const fileMatchesLineItem = (file = {}, item = {}) => {
  return mappedFileMatchesLineItem(file, item);
};

const findLineItemLabelFile = (item = {}, files = []) => {
  return findMappedLineItemLabelFile(item, getDisplayableItemFiles(mergeFileLists(getItemInlineLabelFiles(item), files)));
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
    file?.uploadedAt,
    file?.uploaded_at,
    file?.uploadedAt,
    file?.uploaded_at,
    file?.uploadedAt,
    file?.uploaded_at,
    file?.uploadedAt,
    file?.uploaded_at,
    file?.uploadedAt,
    file?.uploaded_at,
    file?.uploaded_at,
    file?.uploadedAt,
    file?.uploaded_at,
    file?.uploaded_at,
    file?.uploadedAt,
    file?.uploaded_at,
    file?.uploaded_at,
    file?.uploadedAt,
    file?.uploaded_at,
    file?.uploaded_at,
    file?.uploadedAt,
    file?.uploaded_at,
    file?.uploaded_at,
    file?.uploadedAt,
    file?.uploaded_at,
    file?.uploaded_at,
    file?.uploadedAt,
    file?.uploaded_at,
    file?.uploaded_at,
    file?.uploaded_at,
    file?.uploadedAt,
    file?.uploaded_at,
    file?.uploaded_at,
    file?.uploadedAt,
    file?.uploaded_at,
    file?.uploaded_at,
    file?.uploadedAt,
    file?.uploaded_at,
    file?.uploaded_at,
    file?.uploadedAt,
    file?.uploaded_at,
    file?.uploaded_at,
    file?.uploadedAt,
    file?.uploaded_at,
    file?.uploaded_at,
    file?.uploadedAt,
    file?.uploaded_at,
    file?.uploaded_at,
    file?.uploadedAt,
    file?.uploaded_at,
    file?.uploaded_at,
    file?.uploadedAt,
    file?.uploaded_at,
    file?.uploaded_at,
    file?.uploadedAt,
    file?.uploaded_at,
    file?.uploaded_at,
    file?.uploadedAt,
    file?.uploaded_at,
    file?.uploaded_at,
    file?.uploadedAt,
    file?.uploaded_at,
    file?.uploaded_at,
    file?.uploadedAt,
    file?.uploaded_at,
    file?.uploaded_at,
    file?.uploadedAt,
    file?.uploaded_at,
    file?.uploaded_at,
    file?.uploadedAt,
    file?.uploaded_at,
    file?.uploaded_at,
    file?.uploadedAt,
    file?.uploaded_at,
    file?.uploaded_at,
    file?.uploadedAt,
    file?.uploaded_at,
    file?.uploaded_at,
    file?.uploaded_at,
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
  getLineItemEntityId(item),
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
  itemList.some((item) => fileMatchesLineItem(file, item) || isExactItemLabelFileMatch(file, item));

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

const getLineItemUploadMatchKey = (item = {}, index = 0) =>
  String(getLineItemEntityId(item) || `index:${index}`);

const findCreatedLineItemForUpload = (sourceItem = {}, fallbackIndex = 0, createdLineItems = [], usedKeys = new Set()) => {
  const sourceSku = normalizeItemFileMatchValue(getLineItemSku(sourceItem));
  const sourceFnsku = normalizeItemFileMatchValue(getLineItemFnsku(sourceItem));
  const sourceProduct = normalizeItemFileMatchValue(getLineItemProductName(sourceItem));
  const sourceOrder = Number(firstPresent(sourceItem?.displayOrder, sourceItem?.display_order, sourceItem?.itemIndex, sourceItem?.item_index, fallbackIndex));
  const candidates = toArray(createdLineItems).map((lineItem, index) => ({ lineItem, index }));
  const isUnused = ({ lineItem, index }) => !usedKeys.has(getLineItemUploadMatchKey(lineItem, index));
  const useMatch = (match) => {
    const resolvedMatch = match?.lineItem || null;
    if (match) usedKeys.add(getLineItemUploadMatchKey(resolvedMatch, match.index));
    return { lineItem: resolvedMatch, matchType: match?.matchType || 'none' };
  };
  const findUniqueBy = (matchType, predicate) => {
    const matches = candidates.filter((candidate) => isUnused(candidate) && predicate(candidate.lineItem, candidate.index));
    return matches.length === 1 ? { ...matches[0], matchType } : null;
  };

  const stableMatch =
    findUniqueBy('line_item_id', (lineItem) => getMappedLineItemId(sourceItem) && getMappedLineItemId(sourceItem) === getMappedLineItemId(lineItem)) ||
    findUniqueBy('sku', (lineItem) => sourceSku && sourceSku === normalizeItemFileMatchValue(getLineItemSku(lineItem))) ||
    findUniqueBy('fnsku', (lineItem) => sourceFnsku && sourceFnsku === normalizeItemFileMatchValue(getLineItemFnsku(lineItem))) ||
    findUniqueBy('product_name', (lineItem) => sourceProduct && sourceProduct === normalizeItemFileMatchValue(getLineItemProductName(lineItem))) ||
    findUniqueBy('display_order', (lineItem) => {
      const lineOrder = Number(firstPresent(lineItem?.displayOrder, lineItem?.display_order, lineItem?.itemIndex, lineItem?.item_index));
      return Number.isFinite(sourceOrder) && Number.isFinite(lineOrder) && sourceOrder === lineOrder;
    });

  if (stableMatch) return useMatch(stableMatch);

  return useMatch(null);
};

const getShipmentUnits = (shipment = {}) => {
  const directUnits =
    shipment?.units ||
    shipment?.totalUnits ||
    shipment?.total_units ||
    shipment?.expectedUnits ||
    shipment?.expected_units ||
    shipment?.totalExpectedUnits ||
    shipment?.total_expected_units ||
    shipment?.totalQuantity ||
    shipment?.total_quantity ||
    shipment?.unitCount ||
    shipment?.unit_count;

  if (Number(directUnits) > 0) return Number(directUnits);

  const lineItems = getShipmentLineItems(shipment);
  return Array.isArray(lineItems)
    ? lineItems.reduce((sum, item) => sum + Number(getLineItemExpectedQty(item) || 0), 0)
    : 0;
};

const normalizeShipment = (shipment) => {
  const mappedShipment = normalizeMappedShipment(shipment);

  return {
    ...mappedShipment,
    id: getShipmentId(mappedShipment),
    reference: mappedShipment.reference || mappedShipment.shipmentNumber || mappedShipment.id || 'N/A',
    client: mappedShipment.clientName || mappedShipment.client_name || '-',
    created: getShipmentCreatedDate(mappedShipment),
    expected: mappedShipment.expectedArrivalDate || mappedShipment.expected_arrival_date || mappedShipment.expected || '-',
    units: getShipmentUnits(mappedShipment),
    assigned: getAssignedStaffName(mappedShipment) || 'Unassigned',
    assignedStaffId: getAssignedStaffId(mappedShipment),
    status: mappedShipment.status || 'draft',
  };
};

const statusBadgeClass = (status = '') => {
  switch (String(status).toLowerCase()) {
    case 'received':
      return 'bg-green-100 text-green-700';
    case 'in_progress':
    case 'in progress':
      return 'bg-orange-100 text-orange-700';
    case 'prepped':
      return 'bg-purple-100 text-purple-700';
    case 'dispatched':
      return 'bg-teal-100 text-teal-700';
    case 'completed':
      return 'bg-gray-100 text-gray-700';
    default:
      return 'bg-blue-100 text-blue-700';
  }
};

const buildShipmentItems = (items) => {
  if (!items.length) {
    throw new Error('At least one product line item is required.');
  }

  const validItems = items
    .map((item, index) => ({
      ...item,
      itemIndex: index,
      item_index: index,
      lineItemIndex: index,
      line_item_index: index,
      displayOrder: index,
      display_order: index,
      sku: String(item.sku || '').trim(),
      productName: String(item.productName || '').trim(),
      expectedQty: Number(item.expectedQty || 0),
      ...(item.needsBundling ? { bundleSize: Number(item.bundleSize || 0) } : {}),
      fnskuLabel: String(item.fnskuLabel || '').trim(),
      fileName: String(item.fileName || item.fnskuLabelFileName || item.fnsku_label_file_name || '').trim(),
    }))
    .filter((item) => item.sku || item.productName || item.expectedQty || item.fnskuLabel || item.services?.length);

  if (!validItems.length) {
    throw new Error('At least one product line item is required.');
  }

  return validItems.map((item, index) => {
    if (!item.sku || !item.productName || item.expectedQty <= 0) {
      throw new Error('Each product line item needs product, SKU, and qty expected.');
    }

    const services = normalizeServiceList(item.services);

    return {
      ...mapShipmentItemPayload({ ...item, services }, index),
      services,
    };
  });
};

const extractCreatedShipmentId = (payload) =>
  firstPresent(
    payload?.shipment?.id,
    payload?.shipment?.uuid,
    payload?.shipment?.shipmentId,
    payload?.shipment?.shipment_id,
    payload?.data?.shipment?.id,
    payload?.data?.shipment?.uuid,
    payload?.data?.shipment?.shipmentId,
    payload?.data?.shipment?.shipment_id,
    payload?.data?.id,
    payload?.data?.uuid,
    payload?.data?.shipmentId,
    payload?.data?.shipment_id,
    payload?.id,
    payload?.uuid,
    payload?.shipmentId,
    payload?.shipment_id
  );

const extractCreatedShipmentStatus = (payload) =>
  payload?.shipment?.status ||
  payload?.data?.shipment?.status ||
  payload?.data?.status ||
  payload?.status ||
  '';

const extractShipmentDetail = (payload) => {
  const detail =
    payload?.shipment ||
    payload?.data?.shipment ||
    payload?.data?.row ||
    payload?.data ||
    payload ||
    {};

  if (!detail || typeof detail !== 'object') return {};

  const lineItems = getShipmentLineItems(detail).length
    ? getShipmentLineItems(detail)
    : getShipmentLineItems(payload);

  return lineItems.length && !getShipmentLineItems(detail).length
    ? { ...detail, shipment_line_items: lineItems }
    : detail;
};

const reloadShipmentDetailWithItemFiles = async (shipmentId, fallbackLineItems = []) => {
  const detailResponse = await fetch(`${API_BASE_URL}/api/shipments/${encodeURIComponent(shipmentId)}`, {
    method: 'GET',
    headers: buildHeaders(),
    cache: 'no-store',
  });
  const detailPayload = await parseResponse(detailResponse);
  const detail = extractShipmentDetail(detailPayload);
  const detailLineItems = getShipmentLineItems(detail);
  const lineItems = detailLineItems.length ? detailLineItems : fallbackLineItems;
  const itemFileResults = await Promise.allSettled(
    lineItems
      .map((item) => String(getLineItemEntityId(item) || '').trim())
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

const getShipmentLookupCandidates = (shipment = {}, normalizedShipment = {}) => [
  ...new Set(
    [
      normalizedShipment?.id,
      shipment?.id,
      shipment?.uuid,
      shipment?.shipmentId,
      shipment?.shipment_id,
      shipment?.reference,
      shipment?.shipmentNumber,
      shipment?.shipment_number,
      normalizedShipment?.reference,
    ]
      .map((value) => String(value || '').trim())
      .filter(Boolean)
  ),
];

const getAssociatedLookupCandidates = (shipment = {}, detail = {}, normalizedShipment = {}, fallbackIds = []) => [
  ...new Set(
    [
      getShipmentRecordId(detail),
      getShipmentRecordId(shipment),
      getShipmentRecordId(normalizedShipment),
      getShipmentId(detail),
      getShipmentId(shipment),
      getShipmentId(normalizedShipment),
      detail?.reference,
      detail?.shipmentNumber,
      detail?.shipment_number,
      shipment?.reference,
      shipment?.shipmentNumber,
      shipment?.shipment_number,
      normalizedShipment?.reference,
      ...fallbackIds,
    ]
      .map((value) => String(value || '').trim())
      .filter(Boolean)
  ),
];

const getStatusTransitionError = (message = '') => {
  const match = String(message).match(/cannot transition from\s+(.+?)\s+to\s+(.+?)(?:\.|$)/i);

  if (!match) {
    return null;
  }

  return {
    from: match[1].trim().toLowerCase(),
    to: match[2].trim().toLowerCase(),
  };
};

const toastStyles = {
  success: 'border-green-200 bg-green-50 text-green-700',
  error: 'border-red-200 bg-red-50 text-red-700',
};

const Shipments = () => {
  const [shipments, setShipments] = useState([]);
  const [clients, setClients] = useState([]);
  const [staffMembers, setStaffMembers] = useState([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [clientFilter, setClientFilter] = useState('');
  const [currentPage, setCurrentPage] = useState(1);
  const [showStatusDropdown, setShowStatusDropdown] = useState(false);
  const [showCreateSection, setShowCreateSection] = useState(false);
  const [showQuickViewModal, setShowQuickViewModal] = useState(false);
  const [quickViewShipment, setQuickViewShipment] = useState(null);
  const [quickViewItems, setQuickViewItems] = useState([]);
  const [quickViewServices, setQuickViewServices] = useState([]);
  const [quickViewDiscrepancies, setQuickViewDiscrepancies] = useState([]);
  const [quickViewBoxes, setQuickViewBoxes] = useState([]);
  const [quickViewFiles, setQuickViewFiles] = useState([]);
  const [isQuickViewLoading, setIsQuickViewLoading] = useState(false);
  const [quickViewError, setQuickViewError] = useState('');
  const [discrepancyResolveTarget, setDiscrepancyResolveTarget] = useState(null);
  const [discrepancyResolveError, setDiscrepancyResolveError] = useState('');
  const [isResolvingDiscrepancy, setIsResolvingDiscrepancy] = useState(false);
  const quickViewRequestIdRef = useRef(0);
  const [createForm, setCreateForm] = useState(initialCreateForm);
  const [createItems, setCreateItems] = useState([createEmptyProductItem()]);
  const [skuOptions, setSkuOptions] = useState([]);
  const [isSkuOptionsLoading, setIsSkuOptionsLoading] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [isClientsLoading, setIsClientsLoading] = useState(false);
  const [isStaffLoading, setIsStaffLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [deletingShipmentId, setDeletingShipmentId] = useState('');
  const [pendingDeleteShipment, setPendingDeleteShipment] = useState(null);
  const [error, setError] = useState('');
  const [toast, setToast] = useState(null);
  const navigate = useNavigate();

  const statuses = ['all', 'draft', 'submitted', 'pending_arrival', 'received', 'in_progress', 'prepped', 'dispatched', 'completed'];

  const clientOptions = useMemo(() => {
    const seenClientIds = new Set();

    return clients
      .filter(isSelectableClient)
      .filter((client) => client?.active !== false && client?.isActive !== false && client?.is_active !== false)
      .map((client) => {
        const id = getClientId(client);

        if (!id || seenClientIds.has(id)) {
          return null;
        }

        seenClientIds.add(id);

        return {
          id,
          label: getClientOptionLabel(client),
        };
      })
      .filter(Boolean)
      .sort((firstClient, secondClient) => firstClient.label.localeCompare(secondClient.label));
  }, [clients]);

  const staffOptions = useMemo(() => {
    const seenStaffIds = new Set();

    return staffMembers
      .filter((user) => String(user?.role || '').toLowerCase() === 'staff')
      .filter((user) => user?.active !== false && user?.isActive !== false && user?.is_active !== false)
      .map((user) => {
        const id = getUserId(user);

        if (!id || seenStaffIds.has(id)) {
          return null;
        }

        seenStaffIds.add(id);

        const name = getUserName(user);
        const email = user?.email || '';

        return {
          id,
          label: email && email !== name ? `${name} (${email})` : name,
        };
      })
      .filter(Boolean)
      .sort((firstStaff, secondStaff) => firstStaff.label.localeCompare(secondStaff.label));
  }, [staffMembers]);

  const getAssignedDisplayName = (shipment = {}) => {
    const assignedId = String(shipment.assignedStaffId || '').trim();
    const matchedStaff = assignedId
      ? staffOptions.find((staff) => String(staff.id) === assignedId)
      : null;

    if (matchedStaff?.label) return matchedStaff.label;
    if (shipment.assigned && !isUuidValue(shipment.assigned)) return shipment.assigned;
    return 'Unassigned';
  };

  const showToast = (type, message) => {
    setToast({ type, message: formatToastMessage(message) });
  };

  const fetchSkuOptionsForClient = async (clientId) => {
    const query = new URLSearchParams({ clientId });
    const response = await fetch(`${API_BASE_URL}/api/products?${query.toString()}`, {
      method: 'GET',
      headers: buildHeaders(),
      cache: 'no-store',
    });
    const payload = await parseResponse(response);
    return normalizeSkuProductOptions(payload, clientId);
  };

  useEffect(() => {
    const clientId = String(createForm.clientId || '').trim();
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
          showToast('error', requestError.message || 'Failed to load client SKUs.');
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

  const loadClients = async () => {
    try {
      setIsClientsLoading(true);
      const response = await fetch(`${API_BASE_URL}/api/clients`, {
        method: 'GET',
        headers: buildHeaders(),
      });
      const payload = await parseResponse(response);
      setClients(extractClients(payload));
    } catch (requestError) {
      setClients([]);
      showToast('error', requestError.message || 'Failed to load clients.');
    } finally {
      setIsClientsLoading(false);
    }
  };

  const loadStaffMembers = async () => {
    try {
      setIsStaffLoading(true);
      const response = await fetch(`${API_BASE_URL}/api/users`, {
        method: 'GET',
        headers: buildHeaders(),
      });
      const payload = await parseResponse(response);
      setStaffMembers(extractUsers(payload));
    } catch (requestError) {
      setStaffMembers([]);
      showToast('error', requestError.message || 'Failed to load staff members.');
    } finally {
      setIsStaffLoading(false);
    }
  };

  const openCreateSection = () => {
    setShowCreateSection(true);
    setError('');
    setCreateForm((current) => ({
      ...current,
      expectedArrivalDate: current.expectedArrivalDate || getTodayDate(),
    }));

    if (!clientOptions.length && !isClientsLoading) {
      loadClients();
    }

    if (!staffOptions.length && !isStaffLoading) {
      loadStaffMembers();
    }
  };

  const closeCreateSection = () => {
    setShowCreateSection(false);
    setCreateForm(initialCreateForm);
    setCreateItems([createEmptyProductItem()]);
  };

  const loadShipments = async () => {
    try {
      setIsLoading(true);
      setError('');
      const response = await fetch(`${API_BASE_URL}/api/shipments`, {
        method: 'GET',
        headers: buildHeaders(),
      });
      const payload = await parseResponse(response);
      const shipmentRows = extractShipments(payload);
      const normalizedRows = shipmentRows.map(normalizeShipment);
      setShipments(normalizedRows);
    } catch (requestError) {
      setError(requestError.message);
      showToast('error', requestError.message || 'Failed to load shipments.');
      setShipments([]);
    } finally {
      setIsLoading(false);
    }
  };

  const handleQuickViewShipment = async (shipment) => {
    const requestId = quickViewRequestIdRef.current + 1;
    quickViewRequestIdRef.current = requestId;
    const isCurrentRequest = () => quickViewRequestIdRef.current === requestId;
    const previewShipment = normalizeShipment(shipment || {});
    setQuickViewShipment(previewShipment);
    setQuickViewItems(sortLineItemsForDisplay(applyBundleSizesFromNotes(getShipmentLineItems(shipment), shipment)));
    setQuickViewServices([]);
    setQuickViewDiscrepancies([]);
    setQuickViewBoxes([]);
    setQuickViewFiles([]);
    setQuickViewError('');
    setDiscrepancyResolveTarget(null);
    setDiscrepancyResolveError('');
    setShowQuickViewModal(true);

    const lookupCandidates = getShipmentLookupCandidates(shipment, previewShipment);

    if (!lookupCandidates.length) {
      if (isCurrentRequest()) setQuickViewError('Shipment identifier is missing for this row.');
      return;
    }

    try {
      setIsQuickViewLoading(true);

      let loadedDetail = null;
      let lastError = null;

      for (const lookupId of lookupCandidates) {
        try {
          const detailResponse = await fetch(`${API_BASE_URL}/api/shipments/${encodeURIComponent(lookupId)}`, {
            method: 'GET',
            headers: buildHeaders(),
            cache: 'no-store',
          });
          const detailPayload = logAdminViewGetResponse(
            `GET /api/shipments/${lookupId}`,
            await parseResponse(detailResponse)
          );
          loadedDetail = extractShipmentDetail(detailPayload);
          break;
        } catch (requestError) {
          lastError = requestError;
        }
      }

      if (!loadedDetail) {
        throw lastError || new Error('Shipment detail was not returned.');
      }

      const detailItems = getShipmentLineItems(loadedDetail);
      const itemsForView = sortLineItemsForDisplay(
        applyBundleSizesFromNotes(
          detailItems.length ? detailItems : getShipmentLineItems(shipment),
          { ...shipment, ...loadedDetail }
        )
      );
      const resolvedShipment = normalizeShipment({ ...shipment, ...loadedDetail });
      const resolvedShipmentId = getShipmentId(loadedDetail) || getShipmentId(shipment) || lookupCandidates[0];
      const resolvedRecordId =
        loadedDetail?.id ||
        loadedDetail?.uuid ||
        loadedDetail?.shipmentId ||
        loadedDetail?.shipment_id ||
        (isUuidValue(resolvedShipmentId) ? resolvedShipmentId : '');
      const associatedLookupIds = getAssociatedLookupCandidates(shipment, loadedDetail, previewShipment, lookupCandidates);
      const associatedRecordLookupIds = [
        ...new Set([resolvedRecordId, ...associatedLookupIds].map((value) => String(value || '').trim()).filter(isUuidValue)),
      ];
      const fetchAssociatedList = async (path, extractor) => {
        for (const lookupId of associatedRecordLookupIds) {
          try {
            const response = await fetch(`${API_BASE_URL}/api/shipments/${encodeURIComponent(lookupId)}${path}`, {
              method: 'GET',
              headers: buildHeaders(),
              cache: 'no-store',
            });
            const payload = await parseResponse(response);
            logAdminViewGetResponse(`GET /api/shipments/${lookupId}${path}`, payload);
            const rows = extractor(payload);

            if (rows.length) {
              return rows;
            }
          } catch {
            // Some backend routes accept UUIDs and others accept shipment references.
          }
        }

        return [];
      };
      const associatedResults = await Promise.allSettled([
        fetchAssociatedList('/services', extractServiceTasks),
        fetchAssociatedList('/discrepancies', (payload) => extractList(payload, ['discrepancies'])),
        fetchAssociatedList('/boxes', (payload) => extractList(payload, ['boxes'])),
        resolvedRecordId
          ? fetch(`${API_BASE_URL}/api/files?entityType=shipment&entityId=${encodeURIComponent(resolvedRecordId)}`, {
              method: 'GET',
              headers: buildHeaders(),
              cache: 'no-store',
            })
              .then(parseResponse)
              .then((payload) => logAdminViewGetResponse(`GET /api/files?entityType=shipment&entityId=${resolvedRecordId}`, payload))
          : Promise.resolve(null),
      ]);
      const loadedBoxes = associatedResults[2].status === 'fulfilled' ? associatedResults[2].value : [];
      const boxesForView = await enrichBoxesWithItems(loadedBoxes, itemsForView);
      const initialFiles = associatedResults[3].status === 'fulfilled' && associatedResults[3].value
        ? extractFiles(associatedResults[3].value)
        : [];
      const extraFileLookups = [
        ...associatedRecordLookupIds
          .filter(Boolean)
          .map((entityId) => ({ entityType: 'shipment', entityId })),
        ...itemsForView
          .map((item) => String(getLineItemEntityId(item) || '').trim())
          .filter(isUuidValue)
          .filter(Boolean)
          .flatMap((entityId) => ITEM_FILE_LOOKUP_ENTITY_TYPES.map((entityType) => ({ entityType, entityId }))),
        ...boxesForView
          .flatMap((box) => getBoxLookupIds(box))
          .filter(Boolean)
          .map((entityId) => ({ entityType: 'box', entityId })),
      ].filter(
        ({ entityType, entityId }, index, lookups) =>
          lookups.findIndex((lookup) => lookup.entityType === entityType && lookup.entityId === entityId) === index
      );
      const extraFileResults = await Promise.allSettled(
        extraFileLookups.map(async ({ entityType, entityId }) => {
          const response = await fetch(`${API_BASE_URL}/api/files?entityType=${encodeURIComponent(entityType)}&entityId=${encodeURIComponent(entityId)}`, {
            method: 'GET',
            headers: buildHeaders(),
            cache: 'no-store',
          });
          const payload = logAdminViewGetResponse(
            `GET /api/files?entityType=${entityType}&entityId=${entityId}`,
            await parseResponse(response)
          );
          return extractFiles(payload);
        })
      );
      const extraFiles = extraFileResults.flatMap((result) =>
        result.status === 'fulfilled' ? result.value : []
      );
      const fbaLabelFileLookups = boxesForView
        .map((box) => ({
          fileId: String(getBoxFbaLabelFileId(box) || '').trim(),
          boxId: getBoxLookupIds(box).find(Boolean),
        }))
        .filter(({ fileId }) => fileId);
      const fbaLabelFileResults = await Promise.allSettled(
        fbaLabelFileLookups.map(async ({ fileId, boxId }) => {
          const files = await fetchFileById(fileId);
          logAdminViewGetResponse(`GET /api/files?fileId=${fileId} (box FBA label)`, files);
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
      const fbaLabelFiles = fbaLabelFileResults.flatMap((result) =>
        result.status === 'fulfilled' ? result.value : []
      );
      const itemLabelFileLookups = itemsForView
        .map((item) => ({
          fileId: String(getItemLabelFileId(item) || '').trim(),
          item,
        }))
        .filter(({ fileId }) => fileId);
      const itemLabelFileResults = await Promise.allSettled(
        itemLabelFileLookups.map(async ({ fileId, item }) => {
          const itemId = getLineItemEntityId(item) || getLineItemRecordId(item);
          const files = await fetchFileById(fileId);
          logAdminViewGetResponse(`GET /api/files?fileId=${fileId} (item FNSKU label)`, files);
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
      const itemLabelFiles = itemLabelFileResults.flatMap((result) =>
        result.status === 'fulfilled' ? result.value : []
      );
      const inlineItemLabelFiles = itemsForView.flatMap((item) => getItemInlineLabelFiles(item));
      const mergedQuickViewFiles = mergeFileLists(initialFiles, extraFiles, fbaLabelFiles, itemLabelFiles, inlineItemLabelFiles);
      const visibleQuickViewShipmentFiles = getVisibleShipmentFiles(
        mergedQuickViewFiles,
        resolvedShipment,
        boxesForView,
        itemsForView
      );
      const itemLabelAssignmentsForLog = getItemLabelFileAssignments(
        itemsForView,
        mergedQuickViewFiles,
        visibleQuickViewShipmentFiles
      );

      if (!isCurrentRequest()) return;
      console.log('[PickPackPro][Admin View Popup]', {
        shipmentId: resolvedShipmentId,
        detail: loadedDetail,
        items: itemsForView.map((item, index) => ({
          index,
          product: getLineItemDisplayProductName(item, itemLabelAssignmentsForLog[index]),
          sku: getLineItemSku(item),
          fnsku: getLineItemFnsku(item),
          expectedQty: getLineItemExpectedQty(item),
          assignedFnskuLabelFile: itemLabelAssignmentsForLog[index]
            ? {
                name: getFileDisplayName(itemLabelAssignmentsForLog[index]),
                type: getFileTypeValue(itemLabelAssignmentsForLog[index]),
                entityType: getFileEntityType(itemLabelAssignmentsForLog[index]),
                entityId: getFileEntityId(itemLabelAssignmentsForLog[index]),
                sku: getFileSku(itemLabelAssignmentsForLog[index]),
                fnsku: getFileFnsku(itemLabelAssignmentsForLog[index]),
                itemIndex: getFileItemIndex(itemLabelAssignmentsForLog[index]),
                lookupSource: itemLabelAssignmentsForLog[index]?.lookupSource || itemLabelAssignmentsForLog[index]?.lookup_source,
                url: getFileUrl(itemLabelAssignmentsForLog[index]),
              }
            : null,
        })),
        files: mergedQuickViewFiles.map((file, index) => ({
          index,
          name: getFileDisplayName(file),
          type: getFileTypeValue(file),
          entityType: getFileEntityType(file),
          entityId: getFileEntityId(file),
          sku: getFileSku(file),
          fnsku: getFileFnsku(file),
          itemIndex: getFileItemIndex(file),
          lookupSource: file?.lookupSource || file?.lookup_source,
          isFnskuLabel: isFnskuLabelFile(file),
          isItemLabel: isAnyItemLabelFile(file),
          url: getFileUrl(file),
        })),
      });
      setQuickViewShipment(resolvedShipment);
      setQuickViewItems(itemsForView);
      setQuickViewServices(
        mergeServiceTasks(
          loadedDetail,
          shipment,
          associatedResults[0].status === 'fulfilled' ? associatedResults[0].value : []
        )
      );
      setQuickViewDiscrepancies(associatedResults[1].status === 'fulfilled' ? associatedResults[1].value : []);
      setQuickViewBoxes(boxesForView);
      setQuickViewFiles(mergedQuickViewFiles);
    } catch (requestError) {
      if (isCurrentRequest()) {
        setQuickViewError(`${requestError.message || 'Failed to load shipment detail.'} Showing table data.`);
      }
    } finally {
      if (isCurrentRequest()) setIsQuickViewLoading(false);
    }
  };

  const closeQuickViewModal = () => {
    quickViewRequestIdRef.current += 1;
    setShowQuickViewModal(false);
    setQuickViewShipment(null);
    setQuickViewItems([]);
    setQuickViewServices([]);
    setQuickViewDiscrepancies([]);
    setQuickViewBoxes([]);
    setQuickViewFiles([]);
    setQuickViewError('');
    setDiscrepancyResolveTarget(null);
    setDiscrepancyResolveError('');
    setIsQuickViewLoading(false);
  };

  const handleOpenDiscrepancyResolve = (discrepancy = {}, matchedLineItem = {}) => {
    const fallbackLineItem = matchedLineItem && Object.keys(matchedLineItem).length
      ? matchedLineItem
      : findLineItemForDiscrepancy(discrepancy, quickViewItems);
    const discrepancyLineItem = getDiscrepancyLineItem(discrepancy);
    const lineItemId = firstPresent(
      getDiscrepancyLineItemId(discrepancy),
      getLineItemRecordId(fallbackLineItem),
      getLineItemRecordId(discrepancyLineItem)
    );

    setDiscrepancyResolveError('');
    setDiscrepancyResolveTarget({
      discrepancy,
      lineItem: fallbackLineItem,
      lineItemId,
      sku: firstPresent(getLineItemSku(fallbackLineItem), getDiscrepancySku(discrepancy), lineItemId),
      productName: firstPresent(getLineItemProductName(fallbackLineItem), getLineItemProductName(discrepancyLineItem)),
      expectedQty: getDiscrepancyExpectedQty(discrepancy, fallbackLineItem),
      receivedQty: getDiscrepancyReceivedQty(discrepancy, fallbackLineItem),
      differenceQty: getDiscrepancyDifferenceQty(discrepancy, fallbackLineItem),
    });
  };

  const handleCloseDiscrepancyResolve = () => {
    if (isResolvingDiscrepancy) return;
    setDiscrepancyResolveTarget(null);
    setDiscrepancyResolveError('');
  };

  const handleResolveDiscrepancySubmit = async (payload) => {
    try {
      const target = discrepancyResolveTarget;

      setError('');
      setQuickViewError('');
      setDiscrepancyResolveError('');
      setIsResolvingDiscrepancy(true);

      if (!target?.lineItemId) {
        throw new Error('Line item ID is required to update received quantity.');
      }

      const responsePayload = await resolveDiscrepancyRequest(target.lineItemId, payload);
      const responseData = getDiscrepancyResolveData(responsePayload) || {};

      if (responseData?.shipment && typeof responseData.shipment === 'object') {
        const updatedShipment = normalizeShipment(responseData.shipment);
        const updatedItems = sortLineItemsForDisplay(applyBundleSizesFromNotes(getShipmentLineItems(updatedShipment), updatedShipment));
        setQuickViewShipment(updatedShipment);
        if (updatedItems.length) setQuickViewItems(updatedItems);
      }

      setQuickViewDiscrepancies((currentRows) => updateDiscrepancyRowsAfterResolve(currentRows, target, responseData));
      showToast('success', responseData?.resolved === true ? 'Discrepancy resolved.' : 'Received quantity updated. Discrepancy remains active.');
      setDiscrepancyResolveTarget(null);

      if (responseData?.shipment || quickViewShipment) {
        await handleQuickViewShipment(responseData?.shipment || quickViewShipment);
      }
    } catch (requestError) {
      setDiscrepancyResolveError(requestError.message);
      setQuickViewError(requestError.message);
      showToast('error', requestError.message || 'Failed to update received quantity.');
    } finally {
      setIsResolvingDiscrepancy(false);
    }
  };

  const requestDeleteShipment = (shipment) => {
    const normalizedShipment = normalizeShipment(shipment || {});
    const shipmentId = getShipmentRecordId(shipment) || getShipmentId(shipment) || normalizedShipment.id;
    const shipmentLabel = normalizedShipment.reference || shipment?.reference || shipmentId || 'this shipment';

    if (!shipmentId) {
      const errorMessage = 'Shipment id is missing.';
      setError(errorMessage);
      showToast('error', errorMessage);
      return;
    }

    setError('');
    setPendingDeleteShipment({
      ...shipment,
      id: shipmentId,
      reference: shipmentLabel,
    });
  };

  const handleDeleteShipment = async (shipment) => {
    const normalizedShipment = normalizeShipment(shipment || {});
    const shipmentId = getShipmentRecordId(shipment) || getShipmentId(shipment) || normalizedShipment.id;

    if (!shipmentId) {
      const errorMessage = 'Shipment id is missing.';
      setError(errorMessage);
      showToast('error', errorMessage);
      return;
    }

    try {
      setDeletingShipmentId(shipmentId);
      setError('');
      setPendingDeleteShipment(null);
      setToast(null);
      const response = await fetch(`${API_BASE_URL}/api/shipments/${encodeURIComponent(shipmentId)}`, {
        method: 'DELETE',
        headers: buildHeaders(),
      });
      await parseResponse(response);

      const deletedKeys = new Set(getShipmentLookupCandidates(shipment, normalizedShipment));
      setShipments((currentShipments) =>
        currentShipments.filter((currentShipment) => {
          const currentKeys = getShipmentLookupCandidates(currentShipment, normalizeShipment(currentShipment));
          return !currentKeys.some((key) => deletedKeys.has(key));
        })
      );

      if (quickViewShipment) {
        const quickViewKeys = getShipmentLookupCandidates(quickViewShipment, normalizeShipment(quickViewShipment));
        if (quickViewKeys.some((key) => deletedKeys.has(key))) {
          closeQuickViewModal();
        }
      }

      showToast('success', 'Shipment deleted.');
      await loadShipments();
    } catch (requestError) {
      const errorMessage = requestError.message || 'Failed to delete shipment.';
      setError(errorMessage);
      showToast('error', errorMessage);
    } finally {
      setDeletingShipmentId('');
    }
  };

  useEffect(() => {
    loadShipments();
    loadClients();
    loadStaffMembers();
  }, []);

  useEffect(() => {
    const handleOpenCreateShipment = () => {
      setShowCreateSection(true);
      setCreateForm((current) => ({
        ...current,
        expectedArrivalDate: current.expectedArrivalDate || getTodayDate(),
      }));
      window.scrollTo({ top: 0, behavior: 'smooth' });
    };

    window.addEventListener('open-shipment-create', handleOpenCreateShipment);
    return () => window.removeEventListener('open-shipment-create', handleOpenCreateShipment);
  }, []);

  useEffect(() => {
    if (!toast) {
      return undefined;
    }

    const timer = window.setTimeout(() => {
      setToast(null);
    }, 3000);

    return () => window.clearTimeout(timer);
  }, [toast]);

  const filteredShipments = useMemo(() => {
    const term = searchTerm.toLowerCase();
    return shipments.filter((shipment) => {
      const matchesSearch =
        !term ||
        shipment.reference.toLowerCase().includes(term) ||
        shipment.client.toLowerCase().includes(term);
      const matchesStatus =
        statusFilter === 'all' || String(shipment.status || '').toLowerCase() === statusFilter;
      const matchesClient =
        !clientFilter.trim() ||
        String(shipment.client || '').toLowerCase().includes(clientFilter.trim().toLowerCase());

      return matchesSearch && matchesStatus && matchesClient;
    });
  }, [shipments, searchTerm, statusFilter, clientFilter]);

  const totalShipmentPages = Math.max(1, Math.ceil(filteredShipments.length / SHIPMENTS_PER_PAGE));
  const currentShipmentPage = Math.min(currentPage, totalShipmentPages);
  const shipmentPageStart = (currentShipmentPage - 1) * SHIPMENTS_PER_PAGE;
  const paginatedShipments = filteredShipments.slice(shipmentPageStart, shipmentPageStart + SHIPMENTS_PER_PAGE);
  const firstVisibleShipment = filteredShipments.length ? shipmentPageStart + 1 : 0;
  const lastVisibleShipment = Math.min(shipmentPageStart + paginatedShipments.length, filteredShipments.length);
  const shipmentPageNumbers = Array.from({ length: totalShipmentPages }, (_, index) => index + 1);

  useEffect(() => {
    setCurrentPage(1);
  }, [searchTerm, statusFilter, clientFilter]);

  useEffect(() => {
    if (currentPage > totalShipmentPages) {
      setCurrentPage(totalShipmentPages);
    }
  }, [currentPage, totalShipmentPages]);

  const handleItemChange = (index, field, value) => {
    setCreateItems((current) =>
      current.map((item, itemIndex) => {
        if (itemIndex !== index) return item;
        if (field === 'needsBundling') {
          return {
            ...item,
            needsBundling: value,
            bundleSize: value ? (item.bundleSize || '') : '',
          };
        }
        return { ...item, [field]: value };
      })
    );
  };

  const handleSkuChange = (index, value) => {
    setCreateItems((current) =>
      current.map((item, itemIndex) => (itemIndex === index ? { ...item, sku: value } : item))
    );
  };

  const handleSkuProductSelect = (index, product) => {
    setCreateItems((current) =>
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

  const handleProductLabelFile = (index, file) => {
    if (!file) return;
    if (file.size > SAFE_FILE_UPLOAD_BYTES) {
      const errorMessage = getFnskuLabelTooLargeMessage(file.name);
      setError(errorMessage);
      showToast('error', errorMessage);
      return;
    }
    setCreateItems((current) =>
      current.map((item, itemIndex) =>
        itemIndex === index
          ? {
              ...item,
              file,
              fileName: file.name,
              fnskuLabelFileName: file.name,
              fnsku_label_file_name: file.name,
            }
          : item
      )
    );
    setError('');
  };

  const handleServiceSelect = (index, value) => {
    if (isOtherServiceValue(value)) {
      setCreateItems((current) =>
        current.map((item, itemIndex) =>
          itemIndex === index ? { ...item, serviceType: 'OTHER', customServiceName: '' } : item
        )
      );
      setError('');
      return;
    }

    const serviceCode = normalizeServiceType(value);
    if (!serviceCode) return;

    setCreateItems((current) =>
      current.map((item, itemIndex) => {
        if (itemIndex !== index) return item;
        const nextServices = normalizeServiceList(item.services, serviceCode);
        return { ...item, services: nextServices, serviceType: '', serviceQty: '', customServiceName: '' };
      })
    );
    setError('');
  };

  const handleCustomServiceChange = (index, value) => {
    setCreateItems((current) =>
      current.map((item, itemIndex) =>
        itemIndex === index
          ? {
              ...item,
              customServiceName: value,
            }
          : item
      )
    );
  };

  const addCustomServiceToItem = (index) => {
    const customService = createItems[index]?.customServiceName?.trim();
    const serviceLabel = normalizeServiceType(customService);

    if (!serviceLabel) {
      setError('Please type a custom service name.');
      return;
    }

    setCreateItems((current) =>
      current.map((item, itemIndex) => {
        if (itemIndex !== index) return item;
        const nextServices = normalizeServiceList(item.services, serviceLabel);
        return { ...item, services: nextServices, serviceType: '', serviceQty: '', customServiceName: '' };
      })
    );
    setError('');
  };

  const handleRemoveService = (index, serviceIndex) => {
    setCreateItems((current) =>
      current.map((item, itemIndex) =>
        itemIndex === index
          ? { ...item, services: (item.services || []).filter((_, currentServiceIndex) => currentServiceIndex !== serviceIndex) }
          : item
      )
    );
  };

  const handleAddItem = () => {
    setCreateItems((current) => [...current, createEmptyProductItem()]);
  };

  const handleRemoveItem = (index) => {
    setCreateItems((current) => (current.length === 1 ? current : current.filter((_, itemIndex) => itemIndex !== index)));
  };

  const handleCreateShipment = async () => {
    try {
      setIsSaving(true);
      setError('');

      if (!createForm.clientId.trim()) {
        throw new Error('Please select a client.');
      }

      if (!createForm.expectedArrivalDate) {
        throw new Error('Expected arrival date is required.');
      }

      const items = buildShipmentItems(createItems);
      const notes = buildShipmentNotes(createForm.notes, items);
      const labelFileInputs = createItems
        .map((item, index) => ({ item, index, file: item.file }))
        .filter(({ item }) => item.sku || item.productName || item.expectedQty || item.fnskuLabel || item.services?.length)
        .filter(({ file }) => file && typeof file === 'object' && file.name);
      const response = await fetch(`${API_BASE_URL}/api/shipments`, {
        method: 'POST',
        headers: buildHeaders(true),
        body: JSON.stringify({
          clientId: createForm.clientId.trim(),
          reference: createForm.reference.trim() || undefined,
          notes,
          expectedArrivalDate: createForm.expectedArrivalDate,
          items,
        }),
      });

      const payload = await parseResponse(response);
      const createdShipmentDetail = extractShipmentDetail(payload);
      const createdLineItems = getShipmentLineItems(createdShipmentDetail);
      const createdShipmentId = extractCreatedShipmentId(payload);
      const createdShipmentStatus = String(extractCreatedShipmentStatus(payload) || '').toLowerCase();
      const postCreateWarnings = [];
      let labelUploadCount = 0;

      if (createdShipmentId) {
        if (createForm.assignedStaff.trim()) {
          try {
            await fetch(`${API_BASE_URL}/api/shipments/${createdShipmentId}/assign`, {
              method: 'PATCH',
              headers: buildHeaders(true),
              body: JSON.stringify({ staffId: createForm.assignedStaff.trim() }),
            }).then(parseResponse);
          } catch (assignError) {
            postCreateWarnings.push(assignError.message || 'Staff assignment failed.');
          }
        }

        const updateShipmentStatus = async (status) => {
          try {
            await fetch(`${API_BASE_URL}/api/shipments/${createdShipmentId}/status`, {
              method: 'PATCH',
              headers: buildHeaders(true),
              body: JSON.stringify({ status }),
            }).then(parseResponse);
          } catch (statusError) {
            const transitionError = getStatusTransitionError(statusError.message);

            if (transitionError?.from === transitionError?.to) {
              return;
            }

            throw statusError;
          }
        };

        if (!createdShipmentStatus || createdShipmentStatus === 'draft') {
          try {
            await updateShipmentStatus('submitted');
          } catch (statusError) {
            postCreateWarnings.push(statusError.message || 'Submitted status update failed.');
          }
        }

        if (labelFileInputs.length) {
          const usedCreatedLineItemKeys = new Set();
          const uploadResults = await Promise.allSettled(
            labelFileInputs.map(async ({ file, item, index }) => {
              const match = findCreatedLineItemForUpload(item, index, createdLineItems, usedCreatedLineItemKeys);
              const savedLineItem = match.lineItem;
              const sku = getLineItemSku(item) || item.sku || getLineItemSku(savedLineItem) || '';
              const fnsku = getLineItemFnsku(item) || item.fnskuLabel || getLineItemFnsku(savedLineItem) || '';
              const productName = getLineItemProductName(item) || item.productName || getLineItemProductName(savedLineItem) || '';
              const failedSku = sku || fnsku || productName || `line ${index + 1}`;
              const lineItemId = getLineItemEntityId(savedLineItem);

              if (!lineItemId) {
                const uploadError = new Error(`Could not match FNSKU label to product ${failedSku}. Please upload it from shipment details.`);
                uploadError.sku = failedSku;
                uploadError.unmatched = true;
                throw uploadError;
              }

              const formData = new FormData();
              formData.append('file', file, file.name);
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
              if (lineItemId) {
                formData.append('lineItemId', lineItemId);
                formData.append('line_item_id', lineItemId);
                formData.append('shipmentLineItemId', lineItemId);
                formData.append('shipment_line_item_id', lineItemId);
                formData.append('shipmentItemId', lineItemId);
                formData.append('shipment_item_id', lineItemId);
              }
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

              try {
                await parseResponse(uploadResponse);
              } catch (uploadError) {
                uploadError.sku = failedSku;
                throw uploadError;
              }
            })
          );

          labelUploadCount = uploadResults.filter((result) => result.status === 'fulfilled').length;
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

          if (unmatchedMessages.length) {
            postCreateWarnings.push(...unmatchedMessages);
          }

          if (failedUploadSkus.length) {
            postCreateWarnings.push(`FNSKU label upload failed for SKU(s): ${failedUploadSkus.join(', ')}.`);
          } else if (failedResults.length && !unmatchedMessages.length) {
            postCreateWarnings.push(`${failedResults.length} FNSKU label file(s) could not upload.`);
          }
        }

        if (labelFileInputs.length) {
          try {
            await reloadShipmentDetailWithItemFiles(createdShipmentId, createdLineItems);
          } catch (refreshError) {
            postCreateWarnings.push(refreshError.message || 'Shipment detail refresh failed after label upload.');
          }
        }
      } else if (labelFileInputs.length) {
        postCreateWarnings.push('FNSKU label upload skipped because shipment ID was not returned.');
      }

      showToast(
        postCreateWarnings.length ? 'error' : 'success',
        postCreateWarnings.length
          ? `Shipment created, but ${postCreateWarnings.join(' ')}`
          : labelUploadCount
            ? `Shipment created successfully. ${labelUploadCount} FNSKU label file(s) attached.`
            : 'Shipment created successfully.'
      );
      closeCreateSection();
      await loadShipments();
    } catch (requestError) {
      setError(requestError.message);
      showToast('error', requestError.message || 'Failed to create shipment.');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <Layout>
      <FullPageLoader show={isLoading} label="Loading shipments..." />
      <div className="">
        {toast ? (
          <div className="fixed right-6 top-20 z-[70]">
            <div className={`max-w-sm rounded-lg border px-4 py-3 text-sm shadow-lg ${toastStyles[toast.type] || toastStyles.error}`}>
              {toast.message}
            </div>
          </div>
        ) : null}

        {pendingDeleteShipment ? (
          <div className="fixed inset-0 z-[80] flex items-center justify-center bg-slate-900/40 p-4">
            <div className="w-full max-w-md rounded-xl border border-red-100 bg-white shadow-2xl">
              <div className="border-b border-gray-100 px-6 py-4">
                <h2 className="text-lg font-semibold text-gray-900">Delete shipment?</h2>
                <p className="mt-2 text-sm text-gray-600">
                  Delete {pendingDeleteShipment.reference || 'this shipment'}? This action cannot be undone.
                </p>
              </div>
              <div className="flex justify-end gap-3 px-6 py-4">
                <button
                  type="button"
                  onClick={() => setPendingDeleteShipment(null)}
                  disabled={Boolean(deletingShipmentId)}
                  className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={() => handleDeleteShipment(pendingDeleteShipment)}
                  disabled={Boolean(deletingShipmentId)}
                  className="rounded-lg bg-red-600 px-4 py-2 text-sm font-semibold text-white hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {deletingShipmentId ? 'Deleting...' : 'Delete'}
                </button>
              </div>
            </div>
          </div>
        ) : null}

        {!showCreateSection ? (
          <>
            <div className="mb-6 flex items-center justify-between">
              <div>
                <h1 className="text-2xl font-semibold text-gray-900">Shipments</h1>
              </div>
              <button
                onClick={openCreateSection}
                className="inline-flex items-center gap-2 rounded-lg bg-[#ff6900] px-4 py-2 text-sm font-medium text-white hover:bg-[#e55d00]"
              >
                <Plus size={16} />
                Create Shipment
              </button>
            </div>

            {error ? <p className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p> : null}

            <div className="mb-4 flex items-center justify-between">
              <div className="text-sm text-gray-500">{new Date().toLocaleDateString('en-GB')}</div>

              <div className="flex items-center gap-3">
                <div className="relative">
                  <button
                    onClick={() => setShowStatusDropdown((current) => !current)}
                    className="flex items-center gap-2 rounded-lg border border-gray-200 bg-white px-4 py-2 text-sm text-gray-700 hover:bg-gray-50"
                  >
                    {statusFilter}
                    <ChevronDown size={16} className="text-gray-400" />
                  </button>

                  {showStatusDropdown ? (
                    <div className="absolute right-0 z-10 mt-1 w-48 rounded-lg border border-gray-200 bg-white py-1 shadow-lg">
                      {statuses.map((status) => (
                        <button
                          key={status}
                          onClick={() => {
                            setStatusFilter(status);
                            setShowStatusDropdown(false);
                          }}
                          className="w-full px-4 py-2 text-left text-sm text-gray-700 hover:bg-gray-50"
                        >
                          {status}
                        </button>
                      ))}
                    </div>
                  ) : null}
                </div>

                {/* <input
                  type="text"
                  placeholder="Client UUID"
                  value={clientFilter}
                  onChange={(e) => setClientFilter(e.target.value)}
                  className="rounded-lg border border-gray-200 bg-white px-4 py-2 text-sm text-gray-700"
                /> */}

                <div className="relative">
                  <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                  <input
                    type="text"
                    placeholder="Search shipments..."
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    className="rounded-lg border border-gray-200 bg-white py-2 pl-9 pr-4 text-sm text-gray-700"
                  />
                </div>

                <button
                  onClick={loadShipments}
                  className="rounded-lg border border-gray-200 bg-white px-4 py-2 text-sm text-gray-700 hover:bg-gray-50"
                >
                  Refresh
                </button>
              </div>
            </div>

            <div className="overflow-hidden rounded-xl border border-gray-200 bg-white">
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr className="border-b border-gray-200">
                      <th className="px-6 py-3.5 text-left text-xs font-semibold uppercase tracking-wider text-gray-500">Reference</th>
                      <th className="px-6 py-3.5 text-left text-xs font-semibold uppercase tracking-wider text-gray-500">Client</th>
                      <th className="px-6 py-3.5 text-left text-xs font-semibold uppercase tracking-wider text-gray-500">Create Date</th>
                      <th className="px-6 py-3.5 text-left text-xs font-semibold uppercase tracking-wider text-gray-500">Expected Date</th>
                      <th className="px-6 py-3.5 text-left text-xs font-semibold uppercase tracking-wider text-gray-500">Units</th>
                      <th className="px-6 py-3.5 text-left text-xs font-semibold uppercase tracking-wider text-gray-500">Assigned</th>
                      <th className="px-6 py-3.5 text-left text-xs font-semibold uppercase tracking-wider text-gray-500">Status</th>
                      <th className="px-6 py-3.5 text-left text-xs font-semibold uppercase tracking-wider text-gray-500">View</th>
                      <th className="px-6 py-3.5 text-left text-xs font-semibold uppercase tracking-wider text-gray-500">Action</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {isLoading ? (
                      <tr>
                        <td colSpan="9" className="px-6 py-12 text-center text-sm text-gray-500">
                          <LoadingState label="Loading shipments..." />
                        </td>
                      </tr>
                    ) : paginatedShipments.length ? paginatedShipments.map((shipment) => (
                      <tr key={shipment.id} className="transition-colors hover:bg-gray-50">
                        <td className="px-6 py-3.5 text-sm font-medium text-gray-900">{shipment.reference}</td>
                        <td className="px-6 py-3.5 text-sm text-gray-700">{shipment.client}</td>
                        <td className="px-6 py-3.5 text-sm text-gray-500">{shipment.created}</td>
                        <td className="px-6 py-3.5 text-sm text-gray-500">{formatListDate(shipment.expected)}</td>
                        <td className="px-6 py-3.5 text-sm font-medium text-gray-900">{shipment.units}</td>
                        <td className="px-6 py-3.5 text-sm text-gray-700">{getAssignedDisplayName(shipment)}</td>
                        <td className="px-6 py-3.5">
                          <span className={`inline-flex items-center rounded-full px-2.5 py-1 text-xs font-medium ${statusBadgeClass(shipment.status)}`}>
                            {shipment.status}
                          </span>
                        </td>
                        <td className="px-6 py-3.5">
                          <button
                            type="button"
                            onClick={() => handleQuickViewShipment(shipment)}
                            className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-[#dbe3ef] bg-white text-[#64748b] transition-colors hover:bg-[#f8fafc] hover:text-[#ff6900]"
                            title="View popup"
                            aria-label={`Open ${shipment.reference} quick view`}
                          >
                            <Eye size={16} />
                          </button>
                        </td>
                        <td className="px-6 py-3.5">
                          <div className="flex items-center gap-2">
                            <button onClick={() => navigate(`/shipments/${shipment.id}`)} className="flex items-center gap-1 text-sm font-medium text-[#ff6900] hover:text-[#e55d00]">
                              View
                              <ArrowRight size={14} />
                            </button>
                            <button
                              type="button"
                              onClick={() => requestDeleteShipment(shipment)}
                              disabled={deletingShipmentId === shipment.id}
                              className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-gray-400 transition-colors hover:bg-red-50 hover:text-red-600 disabled:cursor-not-allowed disabled:opacity-50"
                              title="Delete shipment"
                              aria-label={`Delete ${shipment.reference}`}
                            >
                              <Trash2 size={14} />
                            </button>
                          </div>
                        </td>
                      </tr>
                    )) : (
                      <tr>
                        <td colSpan="9" className="px-6 py-12 text-center text-sm text-gray-500">
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
                          ? 'border-[#ff6900] bg-[#ff6900] text-white'
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
        ) : (
          <div className="">
            <button
              onClick={closeCreateSection}
              className="mb-4 inline-flex items-center gap-2 text-sm text-gray-500 hover:text-gray-700"
            >
              <ArrowLeft size={16} />
              Back
            </button>

            <div className="mb-5">
              <h1 className="text-3xl font-semibold text-[#1d2942]">Add Arrival Shipment</h1>
              <p className="mt-1 text-sm text-gray-500">Register new inbound freight and assign handling resources.</p>
            </div>

            {error ? <p className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p> : null}

            <div className="grid grid-cols-1 gap-5 xl:grid-cols-[1.35fr_0.65fr]">
              <div className="space-y-5">
                <div className="rounded-xl border border-[#e6ecf5] bg-white p-5">
                  <div className="mb-4 flex items-center gap-2 text-sm font-semibold text-[#21304f]">
                    <ClipboardList size={16} className="text-[#ff9d20]" />
                    Shipment Information
                  </div>

                  <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                    <div>
                      <label className="mb-2 block text-[11px] font-semibold uppercase tracking-wide text-gray-400">Reference Number</label>
                      <input
                        type="text"
                        placeholder="e.g. ASN-90420-LX"
                        value={createForm.reference}
                        onChange={(e) => setCreateForm((prev) => ({ ...prev, reference: e.target.value }))}
                        className="w-full rounded-lg border border-gray-200 px-3 py-2.5 text-sm"
                      />
                    </div>
                    <div>
                      <label className="mb-2 block text-[11px] font-semibold uppercase tracking-wide text-gray-400">Client Selection</label>
                      <select
                        value={createForm.clientId}
                        onChange={(e) => {
                          setCreateForm((prev) => ({ ...prev, clientId: e.target.value }));
                          setCreateItems([createEmptyProductItem()]);
                        }}
                        disabled={isClientsLoading || !clientOptions.length}
                        className={`w-full rounded-lg border border-gray-200 bg-white px-3 py-2.5 text-sm ${
                          createForm.clientId ? 'text-gray-900' : 'text-gray-400'
                        }`}
                      >
                        <option value="">
                          {isClientsLoading ? 'Loading clients...' : 'Select Client'}
                        </option>
                        {clientOptions.map((client) => (
                          <option key={client.id} value={client.id}>
                            {client.label}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>

                  <div className="mt-4">
                    <label className="mb-2 block text-[11px] font-semibold uppercase tracking-wide text-gray-400">Date/Time Arrived</label>
                    <input
                      type="date"
                      value={createForm.expectedArrivalDate}
                      onChange={(e) => setCreateForm((prev) => ({ ...prev, expectedArrivalDate: e.target.value }))}
                      className="w-full rounded-lg border border-gray-200 px-3 py-2.5 text-sm"
                    />
                  </div>
                </div>

                <div className="rounded-2xl border border-[#dfe7f3] bg-white p-5 shadow-sm">
                  <div className="mb-4 flex items-center justify-between gap-4">
                    <div className="flex items-center gap-2">
                      <PackagePlus size={18} className="text-[#ff9d20]" />
                      <h3 className="text-[24px] font-semibold text-[#132347]">Product Line Items</h3>
                    </div>
                    <span className="text-xs text-[#6b7280]">{createItems.length} Item Added</span>
                  </div>

                  <div className="space-y-4">
                    {createItems.map((item, index) => (
                      <div key={`product-item-${index}`} className="rounded-2xl border border-[#e4ebf4] p-4">
                        <div className="mb-3 flex items-center justify-end">
                          <button
                            type="button"
                            onClick={() => handleRemoveItem(index)}
                            className="inline-flex items-center gap-1 text-xs font-medium text-[#ef4444] disabled:cursor-not-allowed disabled:opacity-40"
                            disabled={createItems.length === 1}
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
                              onChange={(e) => handleItemChange(index, 'productName', e.target.value)}
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
                              onChange={(e) => handleItemChange(index, 'fnskuLabel', e.target.value)}
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
                              disabled={!createForm.clientId}
                              placeholder={
                                createForm.clientId
                                  ? 'Search or create SKU'
                                  : 'Select client first'
                              }
                              onChange={(value) => handleSkuChange(index, value)}
                              onSelect={(product) => handleSkuProductSelect(index, product)}
                              inputClassName="w-full rounded-lg border border-[#dbe3ef] py-3 pr-4 text-sm text-[#132347] outline-none focus:ring-2 focus:ring-[#ff6900] disabled:cursor-not-allowed disabled:bg-[#f8fafc] disabled:text-[#94a3b8] disabled:focus:ring-0"
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
                              onChange={(e) => handleItemChange(index, 'expectedQty', e.target.value)}
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
                              <span className="flex min-w-0 items-center gap-3">
                                <FileUp size={16} className="shrink-0 text-[#ff6900]" />
                                <span className="truncate">{item.fileName || 'Drop labels here'}</span>
                              </span>
                              <span className="shrink-0 rounded-md bg-[#f8fafc] px-3 py-1 text-[11px] font-semibold text-[#132347]">Browse</span>
                              <input
                                type="file"
                                accept=".pdf,.csv,application/pdf,text/csv,application/csv,image/*"
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
                              value={item.bundleSize}
                              onChange={(e) => handleItemChange(index, 'bundleSize', e.target.value)}
                              disabled={!item.needsBundling}
                              className="w-full rounded-lg border border-[#dbe3ef] px-4 py-3 text-sm text-[#132347] outline-none focus:ring-2 focus:ring-[#ff6900] disabled:cursor-not-allowed disabled:bg-[#f8fafc] disabled:text-[#94a3b8] disabled:focus:ring-0"
                            />
                          </div>
                        </div>

                        <label className="mt-4 inline-flex items-center gap-2 text-sm text-[#4b5563]">
                          <input
                            type="checkbox"
                            checked={item.needsBundling}
                            onChange={(e) => handleItemChange(index, 'needsBundling', e.target.checked)}
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
                              onChange={(e) => handleServiceSelect(index, e.target.value)}
                              className="rounded-lg border border-[#dbe3ef] px-4 py-3 text-sm text-[#132347] outline-none focus:ring-2 focus:ring-[#ff6900]"
                            >
                              <option value="">Add service</option>
                              {serviceRequiredOptions.map((service) => (
                                <option key={service.value} value={service.value}>{service.label}</option>
                              ))}
                            </select>
                            {item.serviceType === 'OTHER' ? (
                              <div className="grid grid-cols-1 gap-3 sm:grid-cols-[minmax(0,1fr)_120px]">
                                <input
                                  type="text"
                                  value={item.customServiceName || ''}
                                  onChange={(e) => handleCustomServiceChange(index, e.target.value)}
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

                          {item.services?.length ? (
                            <div className="mt-4 flex flex-wrap gap-3">
                              {item.services.map((service, serviceIndex) => (
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
                    onClick={handleAddItem}
                    className="mt-4 w-full rounded-2xl border border-dashed border-[#d5dfec] bg-[#fafcff] px-5 py-4 text-sm font-semibold text-[#4b5563] hover:border-[#ff9900] hover:text-[#ff9900]"
                  >
                    Add Another Product
                  </button>
                </div>
              </div>

              <div className="space-y-5">
                <div className="rounded-xl border border-[#e6ecf5] bg-white p-5">
                  <div className="mb-4 flex items-center gap-2 text-sm font-semibold text-[#21304f]">
                    <UserCog size={16} className="text-[#ff9d20]" />
                    Personnel
                  </div>
                  <label className="mb-2 block text-[11px] font-semibold uppercase tracking-wide text-gray-400">Assign Staff Member</label>
                  <select
                    value={createForm.assignedStaff}
                    onChange={(e) => setCreateForm((prev) => ({ ...prev, assignedStaff: e.target.value }))}
                    disabled={isStaffLoading || !staffOptions.length}
                    className={`w-full rounded-lg border border-gray-200 bg-white px-3 py-2.5 text-sm ${
                      createForm.assignedStaff ? 'text-gray-900' : 'text-gray-400'
                    }`}
                  >
                    <option value="">
                      {isStaffLoading ? 'Loading staff...' : 'Select Handler'}
                    </option>
                    {staffOptions.map((staff) => (
                      <option key={staff.id} value={staff.id}>
                        {staff.label}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="rounded-xl border border-[#e6ecf5] bg-white p-5">
                  <div className="mb-4 flex items-center gap-2 text-sm font-semibold text-[#21304f]">
                    <ClipboardList size={16} className="text-[#ff9d20]" />
                    Arrival Notes
                  </div>
                  <textarea
                    placeholder="e.g. Box damaged on corner, pallet intact"
                    value={createForm.notes}
                    onChange={(e) => setCreateForm((prev) => ({ ...prev, notes: e.target.value }))}
                    className="min-h-32 w-full rounded-lg border border-gray-200 px-3 py-2.5 text-sm"
                  />
                </div>

                <div className="flex items-center justify-end gap-3 rounded-xl border border-[#e6ecf5] bg-white p-5">
                  <button
                    onClick={closeCreateSection}
                    className="rounded-lg border border-gray-300 px-4 py-2 text-sm text-gray-700 hover:bg-gray-50"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={handleCreateShipment}
                    disabled={isSaving}
                    className="rounded-lg bg-[#ff9d20] px-5 py-2 text-sm font-semibold text-white hover:bg-[#f08f09] disabled:opacity-60"
                  >
                    {isSaving ? 'Submitting...' : 'Confirm Shipment'}
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        <DiscrepancyResolutionModal
          open={Boolean(discrepancyResolveTarget)}
          sku={discrepancyResolveTarget?.sku}
          productName={discrepancyResolveTarget?.productName}
          expectedQty={discrepancyResolveTarget?.expectedQty}
          receivedQty={discrepancyResolveTarget?.receivedQty}
          differenceQty={discrepancyResolveTarget?.differenceQty}
          lineItemId={discrepancyResolveTarget?.lineItemId}
          error={discrepancyResolveError}
          isSubmitting={isResolvingDiscrepancy}
          onClose={handleCloseDiscrepancyResolve}
          onSubmit={handleResolveDiscrepancySubmit}
        />

        {showQuickViewModal && quickViewShipment ? (
          <div className="fixed inset-0 z-[80] flex items-center justify-center bg-slate-900/50 p-4">
            <div className="max-h-[90vh] w-full max-w-4xl overflow-hidden rounded-2xl bg-white shadow-2xl">
              <div className="flex items-center justify-between border-b border-gray-100 px-6 py-4">
                <div>
                  <h2 className="text-xl font-semibold text-[#132347]">{quickViewShipment.reference}</h2>
                  <p className="mt-1 text-sm text-gray-500">Shipment quick view</p>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => navigate(`/shipments/${quickViewShipment.id}`)}
                    className="rounded-lg border border-[#ffd6b6] px-3 py-2 text-xs font-semibold text-[#ff6900] hover:bg-[#fff7ed]"
                  >
                    Open Detail
                  </button>
                  <button
                    type="button"
                    onClick={closeQuickViewModal}
                    className="rounded-full p-2 text-gray-500 hover:bg-gray-100"
                    aria-label="Close shipment popup"
                  >
                    <X size={18} />
                  </button>
                </div>
              </div>

              <div className="max-h-[calc(90vh-76px)] overflow-y-auto p-6">
                {quickViewError ? (
                  <p className="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-700">
                    {quickViewError}
                  </p>
                ) : null}

                {isQuickViewLoading ? (
                  <div className="py-10">
                    <LoadingState label="Loading shipment detail..." />
                  </div>
                ) : (
                  (() => {
                    const detailServices = extractServiceTasks(quickViewServices);
                    const standardServiceTasks = detailServices.filter((service) => !isCustomServiceTask(service));
                    const detailDiscrepancies = extractList(quickViewDiscrepancies, ['discrepancies']);
                    const customServicesForView = extractCustomServices(
                      { ...quickViewShipment, items: quickViewItems, lineItems: quickViewItems },
                      detailServices
                    );
                    const itemCount = quickViewItems.length;
                    const hasMatchedServiceTasks = standardServiceTasks.some((service) =>
                      quickViewItems.some((item) => isServiceTaskForItem(service, item, itemCount))
                    );
                    const showGlobalServiceTasks = standardServiceTasks.length && !hasMatchedServiceTasks;
                    const unassignedServiceTasks = standardServiceTasks.filter(
                      (service) => !quickViewItems.some((item) => isServiceTaskForItem(service, item, itemCount))
                    );
                    const unassignedDiscrepancies = detailDiscrepancies.filter(
                      (discrepancy, index) => !quickViewItems.some((item) => isDiscrepancyForItem(discrepancy, item, quickViewItems, index))
                    );
                    const unassignedCustomServices = customServicesForView.filter(
                      (service) => !quickViewItems.some((item) => isCustomServiceForItem(service, item, itemCount))
                    );
                    const boxesWithIndex = quickViewBoxes.map((box, boxIndex) => ({ box, boxIndex }));
                    const getBoxFallbackItem = (boxIndex) =>
                      quickViewItems.length === 1
                        ? quickViewItems[0]
                        : quickViewItems[Math.min(boxIndex, Math.max(quickViewItems.length - 1, 0))];
                    const getBoxDisplaySku = (box, boxIndex) => {
                      const skuValues = getBoxDisplaySkuValues(box);
                      if (skuValues.length) return skuValues.join(', ');
                      return normalizeFileMatchValue(firstPresent(getBoxPrimarySku(box), getLineItemSku(getBoxFallbackItem(boxIndex) || {})));
                    };
                    const getBoxDisplayQty = (box, boxIndex) =>
                      firstPresent(getBoxPrimaryQty(box), getLineItemExpectedQty(getBoxFallbackItem(boxIndex) || {}), '');
                    const getBoxLineItemRows = (box, item) =>
                      item ? getBoxItems(box).filter((boxItem) => isBoxItemForLineItem(boxItem, item)) : [];
                    const getRowsTotalQuantity = (rows = []) => {
                      const quantities = rows
                        .map((row) => getBoxItemQuantity(row))
                        .filter((quantity) => quantity !== '' && quantity !== undefined && quantity !== null);
                      if (!quantities.length) return '';
                      return quantities.reduce((sum, quantity) => {
                        const numericQuantity = Number(quantity);
                        return Number.isFinite(numericQuantity) ? sum + numericQuantity : sum;
                      }, 0);
                    };
                    const getRowsSkuSummary = (rows = []) =>
                      rows
                        .map((row) => String(getBoxItemSku(row) || '').trim())
                        .filter(Boolean)
                        .filter((sku, index, skus) => skus.indexOf(sku) === index)
                        .join(', ');
                    const getBoxAllRows = (box) => getBoxItems(box);
                    const isBoxMatchedToItem = (box, boxIndex, item) => {
                      if (isBoxForLineItem(box, item, quickViewItems)) return true;

                      const itemSku = normalizeFileMatchValue(getLineItemSku(item));
                      const displaySkuValues = getBoxDisplaySkuValues(box);
                      const displaySku = normalizeFileMatchValue(getBoxDisplaySku(box, boxIndex));
                      return Boolean(
                        itemSku &&
                          ((displaySku && itemSku === displaySku) || displaySkuValues.includes(itemSku))
                      );
                    };
                    const getOutboundPackagesForItem = (item) =>
                      getLineItemOutboundPackageGroups({
                        item,
                        boxes: quickViewBoxes,
                        lineItems: quickViewItems,
                        isBoxLinkedToItem: (box, currentItem, boxIndex) => isBoxMatchedToItem(box, boxIndex, currentItem),
                        getPalletChildBoxes,
                        isPalletBox,
                        getBoxKey: (box, boxIndex) => String(getBoxRecordId(box) || getBoxId(box) || getBoxPalletLabel(box, boxIndex) || boxIndex),
                      });
                    const getBoxesForItem = (item) => getOutboundPackagesForItem(item).boxes;
                    const getPalletsForItem = (item) => getOutboundPackagesForItem(item).pallets;
                    const unassignedBoxes = quickViewItems.length
                      ? boxesWithIndex.filter(({ box, boxIndex }) => !quickViewItems.some((item) => {
                          const packages = getOutboundPackagesForItem(item);
                          const packageRows = [...packages.boxes, ...packages.pallets];
                          const currentKey = String(getBoxRecordId(box) || getBoxId(box) || getBoxPalletLabel(box, boxIndex) || boxIndex);
                          return packageRows.some((row) => String(row.key || getBoxRecordId(row.box) || getBoxId(row.box) || getBoxPalletLabel(row.box, row.boxIndex) || row.boxIndex) === currentKey);
                        }))
                      : boxesWithIndex;
                    const visibleShipmentFiles = getVisibleShipmentFiles(
                      quickViewFiles,
                      quickViewShipment,
                      quickViewBoxes,
                      quickViewItems
                    );
                    const itemLabelFileAssignments = getItemLabelFileAssignments(
                      quickViewItems,
                      quickViewFiles,
                      visibleShipmentFiles
                    );
                    const renderOutboundBoxCard = (box, boxIndex, lineItem = null) => {
                      const fbaLabelFile = getBoxFbaLabelFile(box, quickViewFiles);
                      const fbaLabelReady = isBoxFbaLabelUploaded(box, quickViewFiles);
                      const fbaLabelUrl = resolveFileUrl(getFileUrl(fbaLabelFile));
                      const fbaLabelImage = fbaLabelFile && fbaLabelUrl && isImageFile(fbaLabelFile);
                      const boxSize = getBoxSize(box);
                      const boxDimensions = getBoxDimensions(box);
                      const lineItemRows = getBoxLineItemRows(box, lineItem);
                      const allBoxRows = getBoxAllRows(box);
                      const allRowsQty = getRowsTotalQuantity(allBoxRows);
                      const allRowsSkuSummary = getRowsSkuSummary(allBoxRows);
                      const boxUnits = firstPresent(allRowsQty, lineItem ? getRowsTotalQuantity(lineItemRows) : '', getBoxDisplayQty(box, boxIndex));
                      const boxSku = firstPresent(allRowsSkuSummary, lineItem ? getRowsSkuSummary(lineItemRows) : '', getBoxDisplaySku(box, boxIndex));
                      const boxContentsSummary = firstPresent(
                        getBoxContentsSummary(box),
                        lineItemRows.length ? getBoxContentsSummary(box, lineItem) : ''
                      );
                      const boxTitle = getBoxTitle(box, boxIndex);
                      const displayBoxTitle =
                        boxSize && !String(boxTitle || '').toLowerCase().includes(String(boxSize).toLowerCase())
                          ? `${boxTitle} - ${String(boxSize).toLowerCase()}`
                          : boxTitle;
                      const allocationRows = (allBoxRows.length ? allBoxRows : lineItemRows)
                        .map((boxItem, rowIndex) => ({
                          key: getBoxItemLineItemId(boxItem) || getBoxItemSku(boxItem) || rowIndex,
                          sku: getBoxItemSku(boxItem),
                          quantity: getBoxItemQuantity(boxItem),
                        }))
                        .filter((row) => row.sku || row.quantity !== '');
                      const metaItems = [
                        { label: 'Status', value: getBoxDisplayStatus(box, quickViewShipment?.status) },
                        { label: 'Dimensions', value: boxDimensions || '-' },
                        { label: 'Weight', value: `${getBoxWeight(box) || 0} kg` },
                        { label: 'SKU', value: boxContentsSummary || boxSku || 'Pending' },
                        { label: 'Qty', value: boxUnits !== '' ? boxUnits : 'Pending' },
                      ];

                      return (
                        <div key={getBoxId(box) || boxIndex} className="rounded-lg border border-gray-200 bg-gray-50 p-3">
                          <div className="flex items-start justify-between gap-3">
                            <p className="font-medium text-gray-900">{displayBoxTitle}</p>
                            <span className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-medium ${
                              fbaLabelReady ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-600'
                            }`}>
                              {fbaLabelReady ? 'FBA Label Ready' : 'FBA Label Missing'}
                            </span>
                          </div>

                          <div className="mt-3 grid grid-cols-2 gap-2 text-xs sm:grid-cols-5">
                            {metaItems.map((meta) => (
                              <div key={meta.label} className="rounded-md border border-gray-200 bg-white px-3 py-2">
                                <p className="text-[10px] font-semibold uppercase tracking-wide text-gray-500">{meta.label}</p>
                                <p className="mt-1 break-words font-semibold text-gray-900">{meta.value}</p>
                              </div>
                            ))}
                          </div>

                          {allocationRows.length ? (
                            <div className="mt-3 overflow-hidden rounded-md border border-gray-200 bg-white">
                              {allocationRows.map((row) => (
                                <div key={row.key} className="flex items-center justify-between gap-3 border-b border-gray-100 px-3 py-2 text-xs last:border-b-0">
                                  <span className="font-semibold text-gray-900">SKU: {row.sku || 'Pending'}</span>
                                  <span className="font-medium text-gray-700">Qty: {row.quantity !== '' ? row.quantity : '-'}</span>
                                </div>
                              ))}
                            </div>
                          ) : null}

                          <div className="mt-3 rounded-lg border border-gray-200 bg-white px-3 py-2">
                            <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">FBA Label</p>
                            {fbaLabelFile ? (
                              <>
                                {fbaLabelImage ? (
                                  <button type="button" onClick={() => openOrDownloadFile(fbaLabelFile)} className="mt-2 block w-full overflow-hidden rounded-md border border-gray-100 bg-gray-50">
                                    <img src={fbaLabelUrl} alt={getFileDisplayName(fbaLabelFile)} className="h-40 w-full object-contain" />
                                  </button>
                                ) : null}
                                <button
                                  type="button"
                                  onClick={() => openOrDownloadFile(fbaLabelFile)}
                                  className="mt-2 text-left text-sm font-medium text-[#ff6900] hover:text-[#e55d00]"
                                >
                                  {getFileDisplayName(fbaLabelFile)}
                                </button>
                              </>
                            ) : (
                              <p className={`mt-1 text-sm font-medium ${fbaLabelReady ? 'text-emerald-700' : 'text-gray-600'}`}>
                                {fbaLabelReady ? 'FBA label image not returned by backend.' : 'No FBA label file returned.'}
                              </p>
                            )}
                          </div>
                        </div>
                      );
                    };
                    const renderOutboundPalletCard = (box, boxIndex) => {
                      const palletChildren = getPalletChildBoxes(box);
                      const palletLabelFile = getBoxFbaLabelFile(box, quickViewFiles);
                      const palletLabelReady = isBoxFbaLabelUploaded(box, quickViewFiles);
                      const palletLabelUrl = resolveFileUrl(getFileUrl(palletLabelFile));
                      const palletLabelImage = palletLabelFile && palletLabelUrl && isImageFile(palletLabelFile);
                      const palletDimensions = getBoxDimensions(box);
                      const palletWeight = getBoxWeight(box);
                      const metaItems = [
                        { label: 'Status', value: getBoxDisplayStatus(box, quickViewShipment?.status) },
                        { label: 'Pallet Dimensions', value: palletDimensions || '-' },
                        { label: 'Pallet Weight', value: `${palletWeight || 0} kg` },
                        { label: 'Boxes Inside', value: `${palletChildren.length} box${palletChildren.length !== 1 ? 'es' : ''}` },
                        { label: 'Pallet FBA Label', value: palletLabelReady ? 'Uploaded' : 'Missing' },
                      ];

                      return (
                        <div key={getBoxId(box) || boxIndex} className="rounded-lg border border-gray-200 bg-gray-50 p-3">
                          <div className="flex items-start justify-between gap-3">
                            <div>
                              <div className="flex flex-wrap items-center gap-2">
                                <p className="font-medium text-gray-900">{getBoxPalletLabel(box, boxIndex)}</p>
                                <span className="rounded-full bg-[#fff7ed] px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-[#ff6900]">
                                  Pallet
                                </span>
                              </div>
                              <p className="mt-1 text-xs text-gray-500">
                                {[palletDimensions, palletWeight ? `${palletWeight} kg` : '', `${palletChildren.length} box${palletChildren.length !== 1 ? 'es' : ''}`].filter(Boolean).join(' - ') || 'Pallet details pending'}
                              </p>
                            </div>
                            <span className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-medium ${
                              palletLabelReady ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-600'
                            }`}>
                              {palletLabelReady ? 'Pallet Label Ready' : 'Pallet Label Missing'}
                            </span>
                          </div>

                          <div className="mt-3 grid grid-cols-2 gap-2 text-xs sm:grid-cols-5">
                            {metaItems.map((meta) => (
                              <div key={meta.label} className="rounded-md border border-gray-200 bg-white px-3 py-2">
                                <p className="text-[10px] font-semibold uppercase tracking-wide text-gray-500">{meta.label}</p>
                                <p className="mt-1 break-words font-semibold text-gray-900">{meta.value}</p>
                              </div>
                            ))}
                          </div>

                          <div className="mt-3 rounded-lg border border-gray-200 bg-white p-3">
                            <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                              <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">Boxes in pallet</p>
                              <span className="rounded-full bg-gray-50 px-2 py-0.5 text-[10px] font-semibold text-gray-600">
                                {palletChildren.length} box{palletChildren.length !== 1 ? 'es' : ''}
                              </span>
                            </div>
                            {palletChildren.length ? (
                              <div className="space-y-2">
                                {palletChildren.map((childBox, childIndex) => {
                                  const childLabelReady = isBoxFbaLabelUploaded(childBox, quickViewFiles);
                                  const childDimensions = getBoxDimensions(childBox);
                                  const childWeight = getBoxWeight(childBox);
                                  const childSummary = firstPresent(
                                    getBoxContentsSummary(childBox),
                                    getRowsSkuSummary(getBoxAllRows(childBox)),
                                    getBoxDisplaySku(childBox, childIndex)
                                  );

                                  return (
                                    <div key={getBoxRecordId(childBox) || getBoxId(childBox) || childIndex} className="rounded-md border border-gray-200 bg-gray-50 px-3 py-2">
                                      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                                        <div className="min-w-0">
                                          <p className="text-sm font-semibold text-gray-900">{getBoxTitle(childBox, childIndex)}</p>
                                          <p className="mt-1 text-xs text-gray-500">
                                            {[childDimensions, childWeight ? `${childWeight} kg` : '', childSummary].filter(Boolean).join(' - ') || 'Box details pending'}
                                          </p>
                                        </div>
                                        <span className={`w-fit rounded-full px-2.5 py-1 text-xs font-medium ${childLabelReady ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-600'}`}>
                                          {childLabelReady ? 'FBA Label Ready' : 'FBA Label Missing'}
                                        </span>
                                      </div>
                                    </div>
                                  );
                                })}
                              </div>
                            ) : (
                              <p className="rounded-md border border-dashed border-gray-300 bg-gray-50 px-3 py-4 text-center text-xs text-gray-600">
                                No child boxes returned for this pallet.
                              </p>
                            )}
                          </div>

                          <div className="mt-3 rounded-lg border border-gray-200 bg-white px-3 py-2">
                            <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">FBA Label</p>
                            {palletLabelFile ? (
                              <>
                                {palletLabelImage ? (
                                  <button type="button" onClick={() => openOrDownloadFile(palletLabelFile)} className="mt-2 block w-full overflow-hidden rounded-md border border-gray-100 bg-gray-50">
                                    <img src={palletLabelUrl} alt={getFileDisplayName(palletLabelFile)} className="h-40 w-full object-contain" />
                                  </button>
                                ) : null}
                                <button
                                  type="button"
                                  onClick={() => openOrDownloadFile(palletLabelFile)}
                                  className="mt-2 text-left text-sm font-medium text-[#ff6900] hover:text-[#e55d00]"
                                >
                                  {getFileDisplayName(palletLabelFile)}
                                </button>
                              </>
                            ) : (
                              <p className="mt-1 text-sm font-medium text-gray-600">No FBA label file returned.</p>
                            )}
                          </div>
                        </div>
                      );
                    };

                    return (
                      <>
                        <div className="grid grid-cols-1 gap-3 rounded-lg border border-gray-200 bg-gray-50 p-4 md:grid-cols-3">
                          <p><span className="text-xs uppercase text-gray-500">Status</span><br /><span className="font-medium text-gray-900">{quickViewShipment.status}</span></p>
                          <p><span className="text-xs uppercase text-gray-500">Expected Arrival</span><br /><span className="font-medium text-gray-900">{formatListDate(quickViewShipment.expected)}</span></p>
                          <p><span className="text-xs uppercase text-gray-500">Units</span><br /><span className="font-medium text-gray-900">{quickViewShipment.units}</span></p>
                          <p><span className="text-xs uppercase text-gray-500">Client</span><br /><span className="font-medium text-gray-900">{quickViewShipment.client}</span></p>
                          <p><span className="text-xs uppercase text-gray-500">Created</span><br /><span className="font-medium text-gray-900">{quickViewShipment.created}</span></p>
                          <p><span className="text-xs uppercase text-gray-500">Assigned</span><br /><span className="font-medium text-gray-900">{getAssignedDisplayName(quickViewShipment)}</span></p>
                        </div>

                        <div className="mt-6">
                          <p className="mb-2 font-medium text-gray-900">Items</p>
                          {quickViewItems.length ? (
                            <div className="space-y-3">
                              {quickViewItems.map((item, index) => {
                                const matchedServiceTasks = standardServiceTasks.filter((service) => isServiceTaskForItem(service, item, itemCount));
                                const itemServices = [
                                  ...new Set([
                                    ...getLineItemServiceLabels(item).filter((service) => shouldDisplayServiceForLineItem(service, item)),
                                    ...matchedServiceTasks
                                      .map(getServiceTaskLabel)
                                      .filter((service) => service && shouldDisplayServiceForLineItem(service, item)),
                                  ]),
                                ];
                                const itemDiscrepancies = detailDiscrepancies.filter((discrepancy, discrepancyIndex) =>
                                  isDiscrepancyForItem(discrepancy, item, quickViewItems, discrepancyIndex)
                                );
                                const itemCustomServices = customServicesForView.filter((service) => isCustomServiceForItem(service, item, itemCount));
                                const labelFile = itemLabelFileAssignments[index] || (itemCount === 1 ? findLineItemLabelFile(item, quickViewFiles, itemCount, index) : null);
                                const labelFileUrl = labelFile ? resolveFileUrl(getFileUrl(labelFile)) : '';
                                const labelFileIsImage = Boolean(labelFile && labelFileUrl && isImageFile(labelFile));
                                const itemDisplayProductName = getLineItemDisplayProductName(item, labelFile);
                                const itemBoxes = getBoxesForItem(item);
                                const itemPallets = getPalletsForItem(item);

                                return (
                                  <div key={item?.id || item?.uuid || `${getLineItemSku(item)}-${index}`} className="rounded-lg border border-gray-200 bg-gray-50 p-4">
                                    <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
                                      <p><span className="text-xs uppercase text-gray-500">Product</span><br /><span className="font-medium text-gray-900">{itemDisplayProductName || '-'}</span></p>
                                      <p><span className="text-xs uppercase text-gray-500">SKU</span><br /><span className="font-medium text-gray-900">{getLineItemSku(item) || '-'}</span></p>
                                      <p><span className="text-xs uppercase text-gray-500">FNSKU</span><br /><span className="font-medium text-gray-900">{getLineItemFnsku(item) || '-'}</span></p>
                                      <p><span className="text-xs uppercase text-gray-500">Expected Qty</span><br /><span className="font-medium text-gray-900">{getLineItemExpectedQty(item) || 0}</span></p>
                                      <p><span className="text-xs uppercase text-gray-500">Bundle Size</span><br /><span className="font-medium text-gray-900">{getLineItemBundleSize(item) || '-'}</span></p>
                                      <p><span className="text-xs uppercase text-gray-500">Services</span><br /><span className="font-medium text-gray-900">{itemServices.length ? itemServices.join(', ') : '-'}</span></p>
                                      <div>
                                        <span className="text-xs uppercase text-gray-500">FNSKU Label PDF / CSV</span><br />
                                        {labelFile ? (
                                          <div className="mt-1 max-w-full space-y-2">
                                            {labelFileIsImage ? (
                                              <button type="button" onClick={() => openOrDownloadFile(labelFile)} className="block overflow-hidden rounded-md border border-gray-200 bg-white">
                                                <img
                                                  src={labelFileUrl}
                                                  alt={getFileDisplayName(labelFile)}
                                                  className="h-24 w-36 object-contain"
                                                  onError={(event) => {
                                                    event.currentTarget.style.display = 'none';
                                                  }}
                                                />
                                              </button>
                                            ) : null}
                                            {labelFileUrl ? (
                                              <button
                                                type="button"
                                                onClick={() => openOrDownloadFile(labelFile)}
                                                className="block max-w-full break-all text-left font-medium text-[#ff6900] hover:text-[#e55d00]"
                                              >
                                                {getFileDisplayName(labelFile)}
                                              </button>
                                            ) : (
                                              <span className="block max-w-full break-all font-medium text-gray-900">{getFileDisplayName(labelFile)}</span>
                                            )}
                                          </div>
                                        ) : (
                                          <span className="font-medium text-gray-900">-</span>
                                        )}
                                      </div>
                                    </div>

                                    <div className="mt-4 space-y-4 border-t border-gray-200 pt-4">
                                      <div>
                                        <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500">Service Tasks</p>
                                        {matchedServiceTasks.length ? (
                                          <div className="space-y-2">
                                            {matchedServiceTasks.map((service, serviceIndex) => {
                                              const serviceLabel = getServiceTaskLabel(service) || 'Service Task';

                                              return (
                                                <div key={`${getServiceTaskId(service) || serviceLabel}-${serviceIndex}`} className="rounded-lg border border-gray-200 bg-white px-3 py-2">
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
                                        {itemBoxes.length ? (
                                          <div className="space-y-2">
                                            {itemBoxes.map(({ box, boxIndex }) => renderOutboundBoxCard(box, boxIndex, item))}
                                          </div>
                                        ) : (
                                          <p className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-xs text-gray-600">No outbound boxes linked to this item.</p>
                                        )}
                                      </div>

                                      <div>
                                        <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500">Outbound Pallets</p>
                                        {itemPallets.length ? (
                                          <div className="space-y-2">
                                            {itemPallets.map(({ box, boxIndex }) => renderOutboundPalletCard(box, boxIndex))}
                                          </div>
                                        ) : (
                                          <p className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-xs text-gray-600">No outbound pallets linked to this item.</p>
                                        )}
                                      </div>

                                      {itemDiscrepancies.length ? (
                                        <div>
                                          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-amber-700">Discrepancies</p>
                                          <div className="space-y-2">
                                            {itemDiscrepancies.map((discrepancy, discrepancyIndex) => (
                                              <div key={discrepancy?.id || discrepancy?.uuid || getDiscrepancyLineItemId(discrepancy) || discrepancyIndex} className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2">
                                                <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                                                  <p className="font-medium text-amber-900">{getLineItemSku(item) || getDiscrepancySku(discrepancy) || 'Line Item'}</p>
                                                  <div className="flex flex-wrap items-center gap-2">
                                                    <span className="rounded-full bg-white px-2 py-1 text-xs font-medium text-amber-700">
                                                      {discrepancy?.status || 'OPEN'}
                                                    </span>
                                                    <button
                                                      type="button"
                                                      onClick={() => handleOpenDiscrepancyResolve(discrepancy, item)}
                                                      disabled={!firstPresent(getDiscrepancyLineItemId(discrepancy), getLineItemRecordId(item))}
                                                      className="rounded-md bg-[#132347] px-2.5 py-1.5 text-[10px] font-semibold uppercase tracking-wide text-white hover:bg-[#0f1b38] disabled:cursor-not-allowed disabled:bg-gray-200 disabled:text-gray-500"
                                                    >
                                                      Update Received Qty
                                                    </button>
                                                  </div>
                                                </div>
                                                <p className="mt-1 text-xs text-amber-800">
                                                  Expected {getDiscrepancyExpectedQty(discrepancy, item)}, received {getDiscrepancyReceivedQty(discrepancy, item)}, difference {getDiscrepancyDifferenceQty(discrepancy, item)}
                                                </p>
                                              </div>
                                            ))}
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
                                                    <p className="text-xs text-gray-500">SKU {service.sku || getLineItemSku(item) || '-'}</p>
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

                        {showGlobalServiceTasks ? (
                          <div className="mt-6">
                            <p className="mb-2 font-medium text-gray-900">Service Tasks</p>
                            <div className="space-y-3">
                              {standardServiceTasks.map((service, index) => {
                                const serviceLabel = getServiceTaskLabel(service) || 'Service Task';

                                return (
                                  <div key={`${getServiceTaskId(service) || serviceLabel}-${index}`} className="rounded-lg border border-gray-200 bg-gray-50 p-3">
                                    <div className="flex items-center justify-between gap-3">
                                      <div>
                                        <p className="font-medium text-gray-900">{serviceLabel}</p>
                                      </div>
                                      <span className="rounded-full bg-white px-2 py-1 text-xs font-medium text-gray-700">
                                        {getServiceTaskStatus(service)}
                                      </span>
                                    </div>
                                  </div>
                                );
                              })}
                            </div>
                          </div>
                        ) : null}

                        {((!showGlobalServiceTasks && unassignedServiceTasks.length) || unassignedDiscrepancies.length || unassignedCustomServices.length) ? (
                          <div className="mt-6">
                            <p className="mb-2 font-medium text-gray-900">Unassigned Details</p>
                            <div className="space-y-3 rounded-lg border border-dashed border-gray-300 bg-gray-50 p-3">
                              {!showGlobalServiceTasks && unassignedServiceTasks.length ? (
                                <div>
                                  <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500">Service Tasks</p>
                                  <div className="space-y-2">
                                    {unassignedServiceTasks.map((service, index) => {
                                      const serviceLabel = getServiceTaskLabel(service) || 'Service Task';

                                      return (
                                        <div key={`${getServiceTaskId(service) || serviceLabel}-${index}`} className="rounded-lg border border-gray-200 bg-white px-3 py-2">
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
                                    {unassignedDiscrepancies.map((discrepancy, index) => {
                                      const matchedLineItem = findLineItemForDiscrepancy(discrepancy, quickViewItems, index);
                                      const displaySku = firstDisplayValue(getLineItemSku(matchedLineItem), getDiscrepancySku(discrepancy), getDiscrepancyLineItemId(discrepancy)) || 'Line Item';

                                      return (
                                        <div key={discrepancy?.id || discrepancy?.uuid || getDiscrepancyLineItemId(discrepancy) || index} className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2">
                                          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                                            <p className="font-medium text-amber-900">{displaySku}</p>
                                            <div className="flex flex-wrap items-center gap-2">
                                              <span className="rounded-full bg-white px-2 py-1 text-xs font-medium text-amber-700">
                                                {discrepancy?.status || 'OPEN'}
                                              </span>
                                              <button
                                                type="button"
                                                onClick={() => handleOpenDiscrepancyResolve(discrepancy, matchedLineItem)}
                                                disabled={!firstPresent(getDiscrepancyLineItemId(discrepancy), getLineItemRecordId(matchedLineItem))}
                                                className="rounded-md bg-[#132347] px-2.5 py-1.5 text-[10px] font-semibold uppercase tracking-wide text-white hover:bg-[#0f1b38] disabled:cursor-not-allowed disabled:bg-gray-200 disabled:text-gray-500"
                                              >
                                                Update Received Qty
                                              </button>
                                            </div>
                                          </div>
                                          <p className="mt-1 text-xs text-amber-800">
                                            Expected {getDiscrepancyExpectedQty(discrepancy, matchedLineItem)}, received {getDiscrepancyReceivedQty(discrepancy, matchedLineItem)}, difference {getDiscrepancyDifferenceQty(discrepancy, matchedLineItem)}
                                          </p>
                                        </div>
                                      );
                                    })}
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

                        <div className="mt-6">
                          <p className="mb-2 font-medium text-gray-900">Outbound Boxes</p>
                          {unassignedBoxes.length ? (
                            <div className="space-y-3">
                              {unassignedBoxes.map(({ box, boxIndex }) => renderOutboundBoxCard(box, boxIndex))}
                            </div>
                          ) : (
                            <p className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-xs text-gray-600">
                              {quickViewBoxes.length ? 'All outbound boxes are shown under their product SKU.' : 'No outbound boxes returned.'}
                            </p>
                          )}
                        </div>

                        {/* <div className="mt-6">
                          <p className="mb-2 font-medium text-gray-900">Shipment Files</p>
                          {visibleShipmentFiles.length ? (
                            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                              {visibleShipmentFiles.map((file, index) => {
                                const fileUrl = resolveFileUrl(getFileUrl(file));
                                const imageFile = isImageFile(file) && fileUrl;

                                return (
                                  <div key={file?.id || file?.url || file?.path || index} className="overflow-hidden rounded-lg border border-gray-200 bg-gray-50">
                                    {imageFile ? (
                                      <button type="button" onClick={() => openOrDownloadFile(file)} className="block w-full bg-white">
                                        <img src={fileUrl} alt={getFileDisplayName(file)} className="h-40 w-full object-contain" />
                                      </button>
                                    ) : null}
                                    <button
                                      type="button"
                                      onClick={() => openOrDownloadFile(file)}
                                      className="block w-full px-3 py-2 text-left text-xs font-medium text-[#132347] hover:bg-white"
                                    >
                                      {getFileDisplayName(file)}
                                    </button>
                                  </div>
                                );
                              })}
                            </div>
                          ) : (
                            <p className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-xs text-gray-600">No shipment files returned.</p>
                          )}
                        </div> */}
                      </>
                    );
                  })()
                )}
              </div>
            </div>
          </div>
        ) : null}
      </div>
    </Layout>
  );
};

export default Shipments;

// test1
