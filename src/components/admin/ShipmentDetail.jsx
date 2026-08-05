import React, { useEffect, useMemo, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import Layout from './adminlayout/Layout';
import LoadingState from '../common/LoadingState';
import FullPageLoader from '../common/FullPageLoader';
import DiscrepancyResolutionModal from '../common/DiscrepancyResolutionModal';
import ConfirmationModal from '../common/ConfirmationModal';
import ShipmentNoteAttachments from '../common/ShipmentNoteAttachments';
import { getSession } from '../../utils/auth';
import { getDiscrepancyResolveData, resolveDiscrepancy as resolveDiscrepancyRequest } from '../../utils/discrepancies';
import { formatToastMessage, showToast } from '../../utils/toast';
import { ArrowDown, ArrowLeft, ChevronDown, RefreshCw, X, CheckCircle2, Plus } from 'lucide-react';
import {
  findLineItemLabelFile as findMappedLineItemLabelFile,
  getLineItemOutboundPackageGroups,
  getItemLabelFileAssignments as getMappedItemLabelFileAssignments,
  getLineItemId as getMappedLineItemId,
  getShipmentItems as getMappedShipmentItems,
  lineItemFileMatches as mappedFileMatchesLineItem,
  normalizeShipment as normalizeMappedShipment,
} from '../../utils/shipmentMapper';
import {
  STANDARD_SERVICE_KEYS as STANDARD_CATALOG_SERVICE_KEYS,
  getServiceDisplayName,
  getServiceKey,
  isBundlingService,
  normalizeServiceCode,
} from '../../utils/serviceCatalog';
import { fetchFilesBatch, getBatchFileById, getBatchFilesForEntity } from '../../utils/fileBatch';
import { fetchBoxItemsBatch, getBatchItemsForBox } from '../../utils/boxItemsBatch';
import { fetchShipmentServicesBatch, getBatchServicesForShipment } from '../../utils/shipmentServicesBatch';
import { fetchShipmentDiscrepanciesBatch, getBatchDiscrepanciesForShipment } from '../../utils/shipmentDiscrepanciesBatch';
import { getShipmentNoteAttachments } from '../../utils/shipmentNoteAttachments';

const API_BASE_URL = '';
const BUNDLE_SIZE_NOTE_PREFIX = 'Bundle Sizes:';
const normalizeServiceDisplayList = (services = []) => {
  return (Array.isArray(services) ? services : [])
    .map((service) => String(service || '').trim())
    .filter(Boolean);
};
const BOX_ALLOCATION_CACHE_KEY = 'pickpackpro-box-allocation-items-v1';
const SUB_SHIPMENT_STATUSES = {
  draft: 'Draft',
  awaiting_fba_labels: 'Awaiting FBA labels',
  ready_to_dispatch: 'Ready to dispatch',
  dispatched: 'Dispatched',
  completed: 'Completed',
  cancelled: 'Cancelled',
};
const SUB_SHIPMENT_CREATION_STATUSES = new Set(['received', 'in_progress', 'prepped']);

const buildHeaders = (includeJson = false) => {
  const session = getSession();
  const headers = {};
  if (session?.token) headers['Authorization'] = `Bearer ${session.token}`;
  if (includeJson) headers['Content-Type'] = 'application/json';
  return headers;
};
const parseResponse = async (response) => {
  const text = await response.text();
  let payload = null;
  if (text) { try { payload = JSON.parse(text); } catch { payload = text; } }
  if (!response.ok) {
    const error = new Error(formatToastMessage(
      payload?.message ?? payload?.error ?? payload?.details ?? (typeof payload === 'string' ? payload : ''),
      `Request failed with status ${response.status}`
    ));
    error.status = response.status;
    error.payload = payload;
    error.responseText = text;
    throw error;
  }
  return payload;
};

const getBoxWorkflowPatch = (payload = {}) =>
  payload?.workflowPatch ||
  payload?.workflow_patch ||
  payload?.data?.workflowPatch ||
  payload?.data?.workflow_patch ||
  null;

const getCreatedBoxFromPayload = (payload = {}) => {
  if (payload?.box) return payload.box;
  if (payload?.data?.box) return payload.data.box;
  if (payload?.data && !getBoxWorkflowPatch(payload)) return payload.data;
  return payload;
};

const toArray = (value) => {
  if (Array.isArray(value)) return value;
  if (Array.isArray(value?.rows)) return value.rows;
  if (Array.isArray(value?.data?.rows)) return value.data.rows;
  if (Array.isArray(value?.results)) return value.results;
  if (Array.isArray(value?.data?.results)) return value.data.results;
  if (Array.isArray(value?.data)) return value.data;
  if (Array.isArray(value?.services)) return value.services;
  if (Array.isArray(value?.serviceTasks)) return value.serviceTasks;
  if (Array.isArray(value?.service_tasks)) return value.service_tasks;
  if (Array.isArray(value?.tasks)) return value.tasks;
  return [];
};

const extractList = (payload, keys = []) => {
  if (Array.isArray(payload)) return payload;

  for (const key of keys) {
    if (Array.isArray(payload?.[key])) return payload[key];
    if (Array.isArray(payload?.data?.[key])) return payload.data[key];
  }

  return toArray(payload);
};

const BOX_LIST_KEYS = [
  'boxes',
  'shipmentBoxes',
  'shipment_boxes',
  'outboundBoxes',
  'outbound_boxes',
  'pallets',
];

const BOX_LIST_CONTAINERS = ['data', 'shipment', 'row', 'record', 'detail', 'result', 'payload'];

const extractBoxes = (payload) => {
  const directBoxes = extractList(payload, BOX_LIST_KEYS);
  if (directBoxes.length) return directBoxes;

  for (const key of BOX_LIST_CONTAINERS) {
    const nestedBoxes = extractList(payload?.[key], BOX_LIST_KEYS);
    if (nestedBoxes.length) return nestedBoxes;
  }

  const singleBox = payload?.box || payload?.data?.box;
  return singleBox && typeof singleBox === 'object' ? [singleBox] : [];
};

const getBoxId = (box = {}) => box?.id || box?.uuid || box?.boxId || box?.box_id || '';

const getBoxDedupeKey = (box = {}, index = 0) =>
  String(getBoxId(box) || box?.reference || box?.label || box?.boxNumber || box?.box_number || index);

const mergeBoxLists = (...boxLists) => {
  const merged = new Map();

  boxLists.flat().filter(Boolean).forEach((box, index) => {
    const key = getBoxDedupeKey(box, index);
    if (!merged.has(key)) merged.set(key, box);
  });

  return [...merged.values()];
};

const isUuidValue = (value = '') =>
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(value || '').trim());

const firstUuidValue = (...values) => values.find((value) => isUuidValue(value)) || '';

const getBoxRecordId = (box = {}) =>
  firstUuidValue(box?.id, box?.uuid, box?.boxId, box?.box_id);

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

const getShipmentRecordId = (shipment = {}) =>
  firstUuidValue(shipment?.id, shipment?.uuid, shipment?.shipmentId, shipment?.shipment_id);

const getShipmentLookupCandidates = (shipment = {}, routeId = '') => [
  ...new Set(
    [
      routeId,
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
      .filter(Boolean)
  ),
];

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
        item?.item ||
        item?.lineItem ||
        item?.line_item ||
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

const getLineItems = (shipment = {}) => {
  return getMappedShipmentItems(shipment);
};

const firstPresent = (...values) => {
  const value = values.find((currentValue) => {
    if (currentValue === 0) return true;
    if (currentValue === false) return true;
    return currentValue !== undefined && currentValue !== null && String(currentValue).trim() !== '';
  });

  return value === undefined || value === null ? '' : value;
};

const getRawShipmentNotes = (shipment = {}) =>
  firstPresent(shipment?.client_notes, shipment?.clientNotes, shipment?.notes, shipment?.note);

const getNoteValue = (notes = '', prefix = '') => {
  const normalizedPrefix = String(prefix || '').trim().toLowerCase();
  const line = String(notes || '')
    .split(/\r?\n/)
    .find((currentLine) => currentLine.trim().toLowerCase().startsWith(normalizedPrefix));

  return line ? line.slice(prefix.length).trim() : '';
};

const stripNoteLine = (notes = '', prefix = '') => {
  const normalizedPrefix = String(prefix || '').trim().toLowerCase();

  return String(notes || '')
    .split(/\r?\n/)
    .filter((line) => !line.trim().toLowerCase().startsWith(normalizedPrefix))
    .join('\n')
    .trim();
};

const getShipmentNoteText = (shipment = {}) =>
  stripNoteLine(
    stripNoteLine(
      stripNoteLine(
        stripNoteLine(
          stripNoteLine(
            stripNoteLine(
              stripNoteLine(getRawShipmentNotes(shipment), 'QC inspection requested'),
              BUNDLE_SIZE_NOTE_PREFIX
            ),
            'Product Names:'
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
      getNoteValue(notes, 'Boxes:'),
      getNoteValue(notes, 'Boxes/Pallets:'),
      shipment?.boxCount,
      shipment?.box_count,
      shipment?.boxesPallets,
      shipment?.boxes_pallets
    ),
    pallets: firstPresent(
      getNoteValue(notes, 'Pallets:'),
      shipment?.palletCount,
      shipment?.pallet_count
    ),
  };
};

const extractUsers = (payload) => {
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload?.users)) return payload.users;
  if (Array.isArray(payload?.data?.rows)) return payload.data.rows;
  if (Array.isArray(payload?.data)) return payload.data;
  if (Array.isArray(payload?.results)) return payload.results;
  return [];
};

const getUserId = (user = {}) =>
  user?.id || user?.uuid || user?.userId || user?.user_id || '';

const getUserName = (user = {}) =>
  user?.name ||
  user?.fullName ||
  user?.full_name ||
  user?.displayName ||
  user?.display_name ||
  user?.email ||
  getUserId(user) ||
  'Unnamed Staff';

const getAssignedStaffId = (shipment = {}) =>
  firstPresent(
    shipment?.staffId,
    shipment?.staff_id,
    shipment?.assignedStaffId,
    shipment?.assigned_staff_id,
    shipment?.assignedToId,
    shipment?.assigned_to_id,
    shipment?.assignedStaff?.id,
    shipment?.assignedStaff?.uuid,
    shipment?.assignedTo?.id,
    shipment?.assignedTo?.uuid,
    shipment?.assigned_to?.id,
    shipment?.assigned_to?.uuid,
    shipment?.staff?.id,
    shipment?.staff?.uuid
  );

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
    item?.inventory_item ||
    item?.productItem ||
    item?.product_item ||
    item?.item ||
    item?.lineItem ||
    item?.line_item ||
    item?.shipmentItem ||
    item?.shipment_item;
  return product && typeof product === 'object' ? product : {};
};

const isAutoGeneratedProductName = (value = '') =>
  /^product[\s_-]*\d+$/i.test(String(value || '').trim());

const getAutoGeneratedProductAlias = (value = '') => {
  const match = String(value || '').trim().match(/^product[\s_-]*0*(\d+)$/i);
  return match ? `p${Number(match[1])}` : '';
};

const PRODUCT_SEQUENCE_PREFIXES = ['product', 'prod', 'pp', 'p'];
const SKU_SEQUENCE_PREFIXES = ['sku', 'product', 'prod', 'pp', 'p'];
const FNSKU_SEQUENCE_PREFIXES = ['fnsku', 'f', 'sku', 'product', 'prod', 'pp', 'p'];
const PRODUCT_SEQUENCE_REGEX = new RegExp(`^(?:${PRODUCT_SEQUENCE_PREFIXES.join('|')})[\\s_-]*0*(\\d+)$`, 'i');
const SKU_SEQUENCE_REGEX = new RegExp(`^(?:${SKU_SEQUENCE_PREFIXES.join('|')})[\\s_-]*0*(\\d+)$`, 'i');
const FNSKU_SEQUENCE_REGEX = new RegExp(`^(?:${FNSKU_SEQUENCE_PREFIXES.join('|')})[\\s_-]*0*(\\d+)$`, 'i');
const SEQUENCE_REGEX_BY_PREFIXES = new Map([
  [PRODUCT_SEQUENCE_PREFIXES, PRODUCT_SEQUENCE_REGEX],
  [SKU_SEQUENCE_PREFIXES, SKU_SEQUENCE_REGEX],
  [FNSKU_SEQUENCE_PREFIXES, FNSKU_SEQUENCE_REGEX],
]);

const getSequenceRegexForPrefixes = (prefixes = []) =>
  SEQUENCE_REGEX_BY_PREFIXES.get(prefixes) || new RegExp(`^(?:${prefixes.join('|')})[\\s_-]*0*(\\d+)$`, 'i');

const parseLineItemSequenceOrder = (value = '', prefixes = []) => {
  const text = String(value || '').trim();
  if (!text) return null;

  const match = text.match(getSequenceRegexForPrefixes(prefixes));
  if (!match) return null;

  const order = Number(match[1]);
  return Number.isFinite(order) ? order : null;
};

const getGeneratedProductSequence = (value = '') =>
  parseLineItemSequenceOrder(value, PRODUCT_SEQUENCE_PREFIXES);

const isGeneratedProductSequenceLabel = (value = '') =>
  getGeneratedProductSequence(value) !== null || isAutoGeneratedProductName(value);

const getItemRawProductName = (item = {}) => {
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

const resolveDisplayProductName = (...values) => {
  const candidates = values
    .map((value) => String(value || '').trim())
    .filter(Boolean);
  return candidates[0] || '';
};

const getItemProductName = (item = {}) => {
  const product = getItemProduct(item);
  return resolveDisplayProductName(
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

const parseBundleSizeEntriesFromNotes = (notes = '') => {
  const rawValue = getNoteValue(notes, BUNDLE_SIZE_NOTE_PREFIX);
  if (!rawValue) return [];

  try {
    const entries = JSON.parse(rawValue);
    return Array.isArray(entries) ? entries : [];
  } catch {
    return [];
  }
};

const normalizeBundleMatchValue = (value = '') => {
  const normalized = String(value || '').trim().toLowerCase();
  return normalized && !['-', 'n/a', 'na', 'none', 'null', 'undefined'].includes(normalized) ? normalized : '';
};

const getBundleSizeFromEntries = (item = {}, entries = []) => {
  const itemSku = normalizeBundleMatchValue(getItemSku(item));
  const itemFnsku = normalizeBundleMatchValue(getItemFnsku(item));
  const matchedEntry = entries.find((entry) => {
    const entrySku = normalizeBundleMatchValue(entry?.sku);
    const entryFnsku = normalizeBundleMatchValue(entry?.fnsku);

    return (
      (itemSku && entrySku && itemSku === entrySku && (!itemFnsku || !entryFnsku || itemFnsku === entryFnsku)) ||
      (itemFnsku && entryFnsku && itemFnsku === entryFnsku)
    );
  });
  const bundleSize = Number(firstPresent(matchedEntry?.bundleSize, matchedEntry?.bundle_size, 0) || 0);

  return Number.isFinite(bundleSize) && bundleSize > 0 ? bundleSize : 0;
};

const applyBundleMetadataFromNotes = (items = [], shipment = {}) => {
  const bundleEntries = parseBundleSizeEntriesFromNotes(getRawShipmentNotes(shipment));
  if (!bundleEntries.length) return items;

  return (Array.isArray(items) ? items : []).map((item) => {
    if (!isItemBundlingEnabled(item)) return item;
    const currentBundleSize = Number(getItemBundleMetadataSize(item) || 0);
    if (Number.isFinite(currentBundleSize) && currentBundleSize > 0) return item;
    const bundleSize = getBundleSizeFromEntries(item, bundleEntries);
    return bundleSize > 0
      ? { ...item, bundleSize, bundle_size: bundleSize }
      : item;
  });
};

const getItemDisplayOrder = (item = {}) => {
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

const getItemSequenceParts = (item = {}) => ({
  product: parseLineItemSequenceOrder(getItemRawProductName(item), PRODUCT_SEQUENCE_PREFIXES),
  sku: parseLineItemSequenceOrder(getItemSku(item), SKU_SEQUENCE_PREFIXES),
  fnsku: parseLineItemSequenceOrder(getItemFnsku(item), FNSKU_SEQUENCE_PREFIXES),
});

const getItemReliableSequenceOrder = (item = {}) => {
  const sequenceParts = getItemSequenceParts(item);
  return sequenceParts.sku ?? sequenceParts.fnsku ?? sequenceParts.product;
};

const getConsistentGeneratedProductLabel = (item = {}) => {
  const reliableOrder = getItemReliableSequenceOrder(item);
  return reliableOrder !== null && reliableOrder !== undefined ? `p${reliableOrder}` : '';
};

const sortLineItemsForDisplay = (items = []) =>
  (Array.isArray(items) ? [...items] : []).sort((firstItem, secondItem) => {
    const firstSequenceOrder = getItemReliableSequenceOrder(firstItem);
    const secondSequenceOrder = getItemReliableSequenceOrder(secondItem);

    if (firstSequenceOrder !== null && secondSequenceOrder !== null && firstSequenceOrder !== secondSequenceOrder) {
      return firstSequenceOrder - secondSequenceOrder;
    }

    if (firstSequenceOrder !== null && secondSequenceOrder === null) return -1;
    if (firstSequenceOrder === null && secondSequenceOrder !== null) return 1;

    const firstOrder = getItemDisplayOrder(firstItem);
    const secondOrder = getItemDisplayOrder(secondItem);

    if (firstOrder !== null && secondOrder !== null && firstOrder !== secondOrder) {
      return firstOrder - secondOrder;
    }

    if (firstOrder !== null && secondOrder === null) return -1;
    if (firstOrder === null && secondOrder !== null) return 1;

    return String(getItemProductName(firstItem) || getItemSku(firstItem) || '').localeCompare(
      String(getItemProductName(secondItem) || getItemSku(secondItem) || ''),
      undefined,
      { numeric: true, sensitivity: 'base' }
    );
  });

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
    item?.dispatchQty,
    item?.dispatch_qty,
    item?.dispatchQuantity,
    item?.dispatch_quantity,
    item?.qtyToDispatch,
    item?.qty_to_dispatch,
    item?.unitsToDispatch,
    item?.units_to_dispatch,
    item?.quantity,
    item?.qty,
    item?.count,
    item?.totalUnits,
    item?.total_units,
    item?.units
  );

const getItemExpectedBoxableQty = (item = {}) =>
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

const getItemDispatchQty = (item = {}) =>
  firstPresent(
    item?.dispatchQty,
    item?.dispatch_qty,
    item?.dispatchQuantity,
    item?.dispatch_quantity,
    item?.qtyToDispatch,
    item?.qty_to_dispatch,
    item?.unitsToDispatch,
    item?.units_to_dispatch,
    item?.dispatchUnits,
    item?.dispatch_units
  );

const RECEIVED_QTY_KEYS = [
  'receivedQty',
  'received_qty',
  'receivedQuantity',
  'received_quantity',
  'qtyReceived',
  'qty_received',
  'unitsReceived',
  'units_received',
  'received',
];

const getItemReceivedQtyRawValue = (item = {}) => {
  const sources = [
    item,
    item?.lineItem,
    item?.line_item,
    item?.shipmentItem,
    item?.shipment_item,
    item?.item,
  ].filter((source) => source && typeof source === 'object');

  for (const source of sources) {
    for (const key of RECEIVED_QTY_KEYS) {
      if (Object.prototype.hasOwnProperty.call(source, key)) return source[key];
    }
  }

  return undefined;
};

const getItemReceivedQtyValue = (item = {}) => {
  const value = getItemReceivedQtyRawValue(item);
  return value === undefined || value === null ? '' : value;
};

const hasItemReceivedQtyField = (item = {}) =>
  getItemReceivedQtyRawValue(item) !== undefined;

const getItemReceivedQty = (item = {}) =>
  firstPresent(getItemReceivedQtyValue(item), 0);

const isDisplayServiceLabel = (value = '') => {
  const normalized = String(value || '').trim().toLowerCase();
  return Boolean(normalized && !['-', 'n/a', 'na', 'none', 'null', 'undefined'].includes(normalized));
};

const toLabelList = (value) => {
  if (!value) return [];
  if (Array.isArray(value)) return value.flatMap((item) => toLabelList(item)).filter(isDisplayServiceLabel);
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

const getItemServices = (item = {}) => normalizeServiceDisplayList([
  ...new Set(
    [
      ...toLabelList(item?.services),
      ...toLabelList(item?.selectedServices),
      ...toLabelList(item?.selected_services),
      ...toLabelList(item?.servicesSelected),
      ...toLabelList(item?.services_selected),
    ]
      .map((service) => String(service || '').trim())
      .filter(isDisplayServiceLabel)
  ),
]);

const getShipmentClientName = (shipment) =>
  shipment?.client?.companyName ||
  shipment?.client?.company_name ||
  shipment?.client?.name ||
  shipment?.clients?.companyName ||
  shipment?.clients?.company_name ||
  shipment?.clients?.name ||
  shipment?.clientName ||
  shipment?.client_name ||
  shipment?.clientId ||
  shipment?.client_id ||
  '-';

const getShipmentUnits = (shipment) =>
  shipment?.totalUnits ||
  shipment?.total_units ||
  shipment?.units ||
  getLineItems(shipment).reduce((sum, item) => sum + Number(getItemExpectedQty(item) || 0), 0) ||
  0;

const getShipmentArrived = (shipment) =>
  shipment?.arrivedDate ||
  shipment?.receivedAt ||
  shipment?.actual_arrival_date ||
  '-';

const formatBoxMetaValue = (value = '') => {
  const normalized = String(value || '').trim();
  if (!normalized) return '';
  return normalized.charAt(0).toUpperCase() + normalized.slice(1).replaceAll('_', ' ');
};

const getBoxTitle = (box = {}, index = 0) => {
  if (isPalletBox(box)) {
    const palletNumber = String(firstPresent(box?.palletNumber, box?.pallet_number) || '').trim();
    if (palletNumber) return palletNumber;
  }

  const boxNumber = String(firstPresent(box?.boxNumber, box?.box_number) || '').trim();
  if (boxNumber) return /^\d+$/.test(boxNumber) ? `Box ${boxNumber}` : boxNumber;

  const rawTitle = firstPresent(box?.label, box?.name, box?.reference);
  const title = String(rawTitle || '').trim();
  if (title) return title;

  return `Box ${index + 1}`;
};

const getBoxSize = (box = {}) =>
  formatBoxMetaValue(firstPresent(box?.boxSize, box?.box_size, box?.size, 'Medium'));

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

const getBoxWeight = (box = {}) =>
  firstPresent(box?.weight, box?.weightKg, box?.weight_kg, box?.grossWeight, box?.gross_weight, box?.totalWeight, box?.total_weight);

const getBoxRawStatus = (box = {}) =>
  firstPresent(
    box?.status,
    box?.boxStatus,
    box?.box_status,
    box?.state,
    box?.dispatchStatus,
    box?.dispatch_status,
    box?.labelStatus,
    box?.label_status
  );

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
  return formatBoxMetaValue(rawStatus || 'No status');
};

const getBoxTypeValue = (box = {}) => {
  const value = String(firstPresent(box?.boxType, box?.box_type, box?.containerType, box?.container_type, box?.type, 'box')).trim().toLowerCase();
  return value === 'pallet' ? 'pallet' : 'box';
};

const isPalletBox = (box = {}) => getBoxTypeValue(box) === 'pallet';

const getBoxPalletId = (box = {}) =>
  firstPresent(box?.palletId, box?.pallet_id, box?.pallet?.id, box?.pallet?.uuid);

const getBoxParentPalletLabel = (box = {}) =>
  firstPresent(box?.parentPalletNumber, box?.parent_pallet_number, box?.palletNumber, box?.pallet_number, getBoxPalletId(box));

const isBoxInsidePallet = (box = {}) =>
  Boolean(
    getBoxPalletId(box) ||
      box?.insidePallet ||
      box?.inside_pallet ||
      box?.isChildBox ||
      box?.is_child_box
  );

const getPalletChildBoxes = (box = {}) =>
  mergeBoxLists(
    extractBoxes(box?.palletChildren || box?.pallet_children),
    extractBoxes(box?.childBoxes || box?.child_boxes),
    extractBoxes(box?.children)
  );

const getBoxPalletLabel = (box = {}, index = 0) => {
  if (!isPalletBox(box)) return getBoxTitle(box, index);

  const palletNumber = String(firstPresent(box?.palletNumber, box?.pallet_number) || '').trim();
  if (palletNumber) return palletNumber;

  return String(getBoxTitle(box, index)).replace(/^Box\b/i, 'Pallet');
};

const getBoxDisplayStatus = (box = {}, shipmentStatus = '') => {
  const boxStatus = getBoxStatus(box);
  const normalizedBoxStatus = String(boxStatus || '').trim().toLowerCase();
  const normalizedShipmentStatus = String(shipmentStatus || '').trim().toLowerCase();

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

const getBoxItems = (box = {}) => {
  const directItems = extractList(box, BOX_ITEM_KEYS);
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

  const inlineQuantity = getBoxItemQuantity(box);
  return (getBoxItemLineItemId(box) || getBoxItemSku(box)) && inlineQuantity !== '' ? [box] : [];
};

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
  if (typeof item === 'string') {
    const value = item.trim();
    const parenthesizedSku = value.match(/\(([^)]+)\)/);
    if (parenthesizedSku && /\b(units?|qty|quantity)\b/i.test(value)) return parenthesizedSku[1].trim();

    const trailingQuantity = value.match(/^(.+?)\s*(?:x|:|\*)\s*\d+(?:\.\d+)?\s*(?:units?)?$/i);
    if (trailingQuantity) return trailingQuantity[1].trim();

    const leadingQuantity = value.match(/^\d+(?:\.\d+)?\s*(?:units?|qty|quantity)\s*(?:of|for)?\s*(.+)$/i);
    if (leadingQuantity) return leadingQuantity[1].trim();

    return value;
  }

  return firstPresent(
    item?.sku,
    item?.sellerSku,
    item?.seller_sku,
    item?.msku,
    item?.asinSku,
    item?.asin_sku,
    item?.productSku,
    item?.product_sku,
    item?.lineItemSku,
    item?.line_item_sku,
    item?.shipmentItemSku,
    item?.shipment_item_sku,
    item?.fnsku,
    getItemSku(item?.shipmentItem || {}),
    getItemSku(item?.shipment_item || {}),
    getItemSku(item?.lineItem || {}),
    getItemSku(item?.line_item || {}),
    getItemSku(item?.item || {}),
    getItemSku(item?.product || {}),
    getItemSku(item?.product_item || {})
  );
};

const getBoxItemQuantity = (item = {}) => {
  if (typeof item === 'number') return Number.isFinite(item) ? item : '';
  if (typeof item === 'string') {
    const quantityMatch = item.match(/(?:qty|quantity|units?)?\s*[:x-]\s*(\d+(?:\.\d+)?)/i);
    if (quantityMatch) return quantityMatch[1];

    const leadingQuantityMatch = item.match(/^(\d+(?:\.\d+)?)\s*(?:units?|qty|quantity)\b/i);
    return leadingQuantityMatch ? leadingQuantityMatch[1] : '';
  }

  return firstPresent(
    item?.allocatedQuantity,
    item?.allocated_quantity,
    item?.allocatedUnits,
    item?.allocated_units,
    item?.allocatedQty,
    item?.allocated_qty,
    item?.qtyAllocated,
    item?.qty_allocated,
    item?.boxedQuantity,
    item?.boxed_quantity,
    item?.boxedUnits,
    item?.boxed_units,
    item?.packedQuantity,
    item?.packed_quantity,
    item?.packedUnits,
    item?.packed_units,
    item?.boxQuantity,
    item?.box_quantity,
    item?.boxQty,
    item?.box_qty,
    item?.contentQuantity,
    item?.content_quantity,
    item?.contentQty,
    item?.content_qty,
    item?.quantity,
    item?.allocated,
    item?.allocated_count,
    item?.allocatedCount,
    item?.qty,
    item?.skuQty,
    item?.sku_qty,
    item?.skuQuantity,
    item?.sku_quantity,
    item?.units,
    item?.unit,
    item?.unitCount,
    item?.unit_count,
    item?.unitsCount,
    item?.units_count,
    item?.totalUnits,
    item?.total_units,
    item?.totalQuantity,
    item?.total_quantity,
    item?.count,
    item?.amount,
    item?.value,
    item?.numberOfUnits,
    item?.number_of_units,
    item?.itemQuantity,
    item?.item_quantity,
    item?.metadata?.quantity,
    item?.metadata?.qty,
    item?.metadata?.units,
    item?.metadata?.totalUnits,
    item?.metadata?.total_units,
    item?.metadata?.unitCount,
    item?.metadata?.unit_count,
    item?.meta?.quantity,
    item?.meta?.qty,
    item?.meta?.units,
    item?.meta?.totalUnits,
    item?.meta?.total_units,
    item?.meta?.unitCount,
    item?.meta?.unit_count
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

const writeBoxAllocationCache = (cache = {}) => {
  if (typeof window === 'undefined') return;

  try {
    localStorage.setItem(BOX_ALLOCATION_CACHE_KEY, JSON.stringify(cache));
  } catch {
    // Allocation display should not fail if browser storage is unavailable.
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

const getBoxSkuCollectionValue = (...values) => {
  const skus = values.flatMap((value) => {
    if (!value && value !== 0) return [];
    if (Array.isArray(value)) {
      return value
        .map((item) => (typeof item === 'string' ? item : getBoxItemSku(item)))
        .filter(Boolean);
    }
    if (typeof value === 'object') {
      return [getBoxItemSku(value)].filter(Boolean);
    }
    return String(value)
      .split(',')
      .map((sku) => sku.trim())
      .filter(Boolean);
  });

  return [...new Set(skus)].join(', ');
};

const getBoxUnits = (box = {}, lineItemList = []) => {
  const items = getShipmentScopedBoxItems(getBoxItems(box), lineItemList);
  const itemQuantities = items
    .map((item) => getBoxItemQuantity(item))
    .filter((quantity) => quantity !== '' && quantity !== undefined && quantity !== null);

  if (itemQuantities.length) {
    return itemQuantities.reduce((sum, quantity) => {
      const numericQuantity = Number(quantity);
      return Number.isFinite(numericQuantity) ? sum + numericQuantity : sum;
    }, 0);
  }

  return firstPresent(
    box?.units,
    box?.totalUnits,
    box?.total_units,
    box?.totalUnitCount,
    box?.total_unit_count,
    box?.allocatedUnits,
    box?.allocated_units,
    box?.allocatedQuantity,
    box?.allocated_quantity,
    box?.quantity,
    box?.qty,
    box?.skuQty,
    box?.sku_qty,
    box?.skuQuantity,
    box?.sku_quantity,
    box?.itemCount,
    box?.item_count,
    box?.unitCount,
    box?.unit_count,
    box?.contentsCount,
    box?.contents_count,
    box?.itemsCount,
    box?.items_count,
    box?.metadata?.units,
    box?.metadata?.totalUnits,
    box?.metadata?.total_units,
    box?.metadata?.quantity,
    box?.metadata?.qty,
    box?.meta?.units,
    box?.meta?.totalUnits,
    box?.meta?.total_units,
    box?.meta?.quantity,
    box?.meta?.qty
  );
};

const getLineItemOptionValue = (item = {}) => String(getLineItemId(item) || getItemSku(item) || '').trim();

const getFallbackLineItemForBoxIndex = (boxIndex = 0, lineItemList = []) => {
  const items = toArray(lineItemList);
  if (!items.length) return null;
  return items.length === 1 ? items[0] : items[Math.min(boxIndex, items.length - 1)] || null;
};

const isSameLineItemForAllocation = (left = {}, right = {}) => {
  const leftIds = getLineItemMatchIds(left);
  const rightIds = getLineItemMatchIds(right);
  const leftSku = String(getItemSku(left) || '').trim().toLowerCase();
  const rightSku = String(getItemSku(right) || '').trim().toLowerCase();

  return Boolean(
    leftIds.some((leftId) => rightIds.includes(leftId)) ||
      (leftSku && rightSku && skuValuesMatch(leftSku, rightSku))
  );
};

const isSameBoxLineItem = (boxItem = {}, lineItem = {}) => {
  const lineItemIds = getLineItemMatchIds(lineItem);
  const boxLineItemId = String(getBoxItemLineItemId(boxItem) || '').trim();
  const lineItemSku = String(getItemSku(lineItem) || '').trim().toLowerCase();
  const boxItemSku = String(getBoxItemSku(boxItem) || '').trim().toLowerCase();

  return Boolean(
    (boxLineItemId && lineItemIds.includes(boxLineItemId)) ||
      (lineItemSku && boxItemSku && skuValuesMatch(lineItemSku, boxItemSku))
  );
};

const normalizeAllocationSku = (value = '') =>
  normalizeSkuMatchValue(value);

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

const findLineItemForSkuValue = (skuValue = '', lineItemList = []) =>
  toArray(lineItemList).find((lineItem) => skuValuesMatch(getItemSku(lineItem), skuValue));

const getShipmentScopedSkuParts = (value = '', lineItemList = []) => {
  const lineItems = toArray(lineItemList);
  if (!lineItems.length) return [];

  return String(value || '')
    .split(/[,|;]/)
    .map((part) => {
      const candidate = part.trim();
      if (!candidate) return null;

      const sku = getBoxItemSku(candidate);
      const matchedLineItem = findLineItemForSkuValue(sku, lineItems);
      if (!matchedLineItem) return null;

      return {
        sku: getItemSku(matchedLineItem),
        quantity: getBoxItemQuantity(candidate),
      };
    })
    .filter(Boolean);
};

const getShipmentScopedSkuCollectionValue = (value = '', lineItemList = []) => {
  const lineItems = toArray(lineItemList);
  if (!lineItems.length) return value;

  return getShipmentScopedSkuParts(value, lineItems)
    .map((part) =>
      part.quantity !== '' ? `${part.sku}: ${formatQuantityValue(part.quantity)}` : part.sku
    )
    .filter(Boolean)
    .join(', ');
};

const getBoxDisplaySkuValues = (box = {}) => {
  const values = [
    getBoxSkuValue(box),
    box?.sku,
    box?.sellerSku,
    box?.seller_sku,
    box?.skuSummary,
    box?.sku_summary,
    box?.metadata?.sku,
    box?.metadata?.skuSummary,
    box?.metadata?.sku_summary,
    box?.meta?.sku,
    box?.meta?.skuSummary,
    box?.meta?.sku_summary,
  ];

  return [
    ...new Set(
      values
        .flatMap((value) => {
          const rawValue = String(value || '');
          const parenthesizedSkus = [...rawValue.matchAll(/\(([^)]+)\)/g)].map((match) => match[1]);

          return [rawValue, ...parenthesizedSkus]
            .flatMap((skuValue) => String(skuValue || '').split(/[,|]/))
            .map((sku) => normalizeAllocationSku(sku.replace(/\b\d+(?:\.\d+)?\s*(?:units?|qty)\b/gi, '')))
            .map((sku) => sku.replace(/[()]/g, '').trim());
        })
        .filter(Boolean)
    ),
  ];
};

const getAllocatedQuantityForLineItem = (lineItem = {}, boxList = [], lineItemList = []) =>
  toArray(boxList).reduce((sum, box, boxIndex) => {
    const boxItems = getShipmentScopedBoxItems(getBoxItems(box), lineItemList);
    const lineItemSku = normalizeAllocationSku(getItemSku(lineItem));
    const boxDisplaySkus = getBoxDisplaySkuValues(box);
    const boxMatchesDisplayedSku = Boolean(lineItemSku && boxDisplaySkus.includes(lineItemSku));
    const fallbackLineItem = getFallbackLineItemForBoxIndex(boxIndex, lineItemList);
    const fallbackQuantity = fallbackLineItem && isSameLineItemForAllocation(fallbackLineItem, lineItem)
      ? getItemExpectedQty(fallbackLineItem)
      : '';
    const displayedSkuQuantity = boxMatchesDisplayedSku
      ? firstPresent(getBoxUnits(box, lineItemList), fallbackQuantity, getItemExpectedQty(lineItem), 0)
      : '';

    if (boxItems.length) {
      const matchingItems = boxItems.filter((boxItem) => isSameBoxLineItem(boxItem, lineItem));
      const itemQuantity = matchingItems.reduce((itemSum, boxItem) => {
        const quantity = Number(getBoxItemQuantity(boxItem) || 0);
        return itemSum + (Number.isFinite(quantity) ? quantity : 0);
      }, 0);

      if (itemQuantity > 0) return sum + itemQuantity;

      if (fallbackLineItem && isSameLineItemForAllocation(fallbackLineItem, lineItem)) {
        const boxQuantity = Number(firstPresent(getBoxUnits(box, lineItemList), fallbackQuantity, 0));
        return sum + (Number.isFinite(boxQuantity) ? boxQuantity : 0);
      }

      if (displayedSkuQuantity !== '' && boxDisplaySkus.length === 1) {
        const boxQuantity = Number(displayedSkuQuantity);
        return sum + (Number.isFinite(boxQuantity) ? boxQuantity : 0);
      }

      return sum;
    }

    if (displayedSkuQuantity !== '' && boxDisplaySkus.length === 1) {
      const boxQuantity = Number(displayedSkuQuantity);
      return sum + (Number.isFinite(boxQuantity) ? boxQuantity : 0);
    }

    if (fallbackLineItem && isSameLineItemForAllocation(fallbackLineItem, lineItem)) {
      const boxQuantity = Number(firstPresent(getBoxUnits(box, lineItemList), fallbackQuantity, 0));
      return sum + (Number.isFinite(boxQuantity) ? boxQuantity : 0);
    }

    return sum;
  }, 0);

const getLineItemMatchIds = (lineItem = {}) => [
  getBoxAllocationLineItemId(lineItem),
  getShipmentLineItemId(lineItem),
  getLineItemId(lineItem),
]
  .map((value) => String(value || '').trim())
  .filter(Boolean);

const findLineItemForBoxItem = (boxItem = {}, lineItemList = []) => {
  const boxItemId = String(getBoxItemLineItemId(boxItem) || '').trim();
  const boxItemSku = String(getBoxItemSku(boxItem) || '').trim().toLowerCase();

  return toArray(lineItemList).find((lineItem) => {
    const lineItemIds = getLineItemMatchIds(lineItem);
    const lineItemSku = String(getItemSku(lineItem) || '').trim().toLowerCase();

    return Boolean(
      (boxItemId && lineItemIds.includes(boxItemId)) ||
        (boxItemSku && lineItemSku && skuValuesMatch(boxItemSku, lineItemSku))
    );
  });
};

const hydrateBoxItemWithLineItem = (boxItem = {}, lineItemList = []) => {
  const matchedLineItem = findLineItemForBoxItem(boxItem, lineItemList);
  const matchedLineItemId = matchedLineItem ? firstPresent(getBoxAllocationLineItemId(matchedLineItem), getShipmentLineItemId(matchedLineItem), getLineItemId(matchedLineItem)) : '';
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

const getPositiveQuantity = (value) => {
  const quantity = Number(value || 0);
  return Number.isFinite(quantity) && quantity > 0 ? quantity : 0;
};

const getLineItemBoxableQuantity = (lineItem = {}) => {
  if (lineItem.__parentShipmentBoxableQty !== undefined) {
    const parentShipmentBoxableQty = Number(lineItem.__parentShipmentBoxableQty || 0);
    return Number.isFinite(parentShipmentBoxableQty) ? Math.max(0, parentShipmentBoxableQty) : 0;
  }

  const receivedQuantityValue = getItemReceivedQtyValue(lineItem);
  const receivedQuantity = getPositiveQuantity(receivedQuantityValue);

  if (receivedQuantity > 0) return receivedQuantity;
  if (hasItemReceivedQtyField(lineItem)) return 0;

  const expectedQuantityValue = getItemExpectedBoxableQty(lineItem);
  const expectedQuantity = getPositiveQuantity(expectedQuantityValue);

  if (expectedQuantity > 0) return expectedQuantity;

  const dispatchQuantity = getPositiveQuantity(getItemDispatchQty(lineItem));

  if (dispatchQuantity > 0) return dispatchQuantity;
  if (getBoxAllocationLineItemId(lineItem)) return 0;

  return 0;
};

const getLineItemAllocatableQuantity = (lineItem = {}, boxList = [], lineItemList = []) => {
  if (!lineItem || typeof lineItem !== 'object') return 0;
  if (lineItem.__subShipmentAvailableQty !== undefined) {
    const subShipmentAvailableQty = Number(lineItem.__subShipmentAvailableQty || 0);
    return Number.isFinite(subShipmentAvailableQty) ? Math.max(0, subShipmentAvailableQty) : 0;
  }
  const availableSourceQuantity = getLineItemBoxableQuantity(lineItem);
  if (!Number.isFinite(availableSourceQuantity) || availableSourceQuantity <= 0) return 0;
  return Math.max(0, availableSourceQuantity - getAllocatedQuantityForLineItem(lineItem, boxList, lineItemList));
};

const clampAllocationQuantity = (value, maxQuantity = 0) => {
  if (value === '' || value === undefined || value === null) return '';

  const quantity = Number(value);
  if (!Number.isFinite(quantity) || quantity <= 0) return '';
  if (Number(maxQuantity || 0) <= 0) return '';

  const wholeQuantity = Math.floor(quantity);
  if (maxQuantity > 0) return String(Math.min(wholeQuantity, maxQuantity));
  return String(wholeQuantity);
};

const formatQuantityValue = (value) => {
  const quantity = Number(value || 0);
  if (!Number.isFinite(quantity)) return '0';
  return Number.isInteger(quantity) ? String(quantity) : quantity.toFixed(2).replace(/\.?0+$/, '');
};

const normalizeCompletionStatus = (value = '') =>
  String(value || '').trim().toLowerCase().replace(/\s+/g, '_');

const normalizeShipmentStatusValue = (value = '') =>
  String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');

const getShipmentCompletionBlockers = (lineItemList = [], boxList = []) =>
  toArray(lineItemList)
    .map((lineItem) => {
      const requiredQuantity = getLineItemBoxableQuantity(lineItem);
      if (!Number.isFinite(requiredQuantity) || requiredQuantity <= 0) return null;

      const boxedQuantity = getAllocatedQuantityForLineItem(lineItem, boxList, lineItemList);
      const remainingQuantity = Math.max(0, requiredQuantity - boxedQuantity);
      if (remainingQuantity <= 0.000001) return null;

      return {
        sku: firstPresent(getItemSku(lineItem), getLineItemId(lineItem), 'SKU'),
        requiredQuantity,
        boxedQuantity,
        remainingQuantity,
      };
    })
    .filter(Boolean);

const formatShipmentCompletionBlockerMessage = (blockers = []) => {
  const visibleBlockers = blockers.slice(0, 3).map((blocker) =>
    `${blocker.sku}: ${formatQuantityValue(blocker.remainingQuantity)} units remaining (boxed ${formatQuantityValue(blocker.boxedQuantity)} of ${formatQuantityValue(blocker.requiredQuantity)})`
  );
  const extraCount = blockers.length - visibleBlockers.length;
  const extraMessage = extraCount > 0 ? ` ${extraCount} more SKU(s) also need boxing.` : '';

  return `Shipment cannot be marked complete yet. Add all remaining SKU quantities to boxes first. ${visibleBlockers.join('; ')}.${extraMessage}`;
};

const buildBoxItemAllocationPayloads = (shipmentItemId = '', quantity = 0) => {
  const normalizedShipmentItemId = String(shipmentItemId || '').trim();
  const normalizedQuantity = Number(quantity || 0);

  return [
    { shipmentItemId: normalizedShipmentItemId, quantity: normalizedQuantity },
    { shipment_item_id: normalizedShipmentItemId, quantity: normalizedQuantity },
    { shipmentLineItemId: normalizedShipmentItemId, quantity: normalizedQuantity },
    { shipment_line_item_id: normalizedShipmentItemId, quantity: normalizedQuantity },
    { lineItemId: normalizedShipmentItemId, quantity: normalizedQuantity },
    { line_item_id: normalizedShipmentItemId, quantity: normalizedQuantity },
  ];
};

const postBoxItemAllocation = async ({ boxId, shipmentItemId, quantity, skuLabel = '' }) => {
  let lastError = null;
  const payloads = buildBoxItemAllocationPayloads(shipmentItemId, quantity);

  for (const [attemptIndex, request] of payloads.entries()) {
    try {
      console.log('[PickPackPro][Box Item POST]', {
        boxId,
        sku: skuLabel,
        attempt: attemptIndex + 1,
        request,
      });

      const itemResponse = await fetch(`${API_BASE_URL}/api/boxes/${encodeURIComponent(boxId)}/items`, {
        method: 'POST',
        headers: buildHeaders(true),
        body: JSON.stringify(request),
      });
      const payload = await parseResponse(itemResponse);

      console.log('[PickPackPro][Box Item POST response]', {
        boxId,
        sku: skuLabel,
        attempt: attemptIndex + 1,
        status: itemResponse.status,
        request,
        response: payload,
      });

      return { payload, status: itemResponse.status, request };
    } catch (error) {
      lastError = error;
      console.error('[PickPackPro][Box Item POST failed]', {
        boxId,
        sku: skuLabel,
        attempt: attemptIndex + 1,
        status: error?.status,
        payload: error?.payload,
        responseText: error?.responseText,
        message: error?.message,
        request,
      });

      if (![400, 422].includes(Number(error?.status))) throw error;
    }
  }

  throw lastError || new Error('Box item allocation could not be saved.');
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
    const payload = await parseResponse(response);
    const boxItems = extractBoxItems(payload);

    console.log('[PickPackPro][Box Items GET]', {
      boxId,
      status: response.status,
      payload,
      items: boxItems,
    });

    return boxItems;
  } catch (error) {
    console.error('[PickPackPro][Box Items GET failed]', {
      boxId,
      status: error?.status,
      payload: error?.payload,
      responseText: error?.responseText,
      message: error?.message,
    });
    return [];
  }
};

const enrichBoxWithItems = async (box = {}, lineItemList = [], batchItems = null) => {
  const existingItems = getBoxItems(box);
  const hasUsableItems = existingItems.some((item) =>
    (getBoxItemLineItemId(item) || getBoxItemSku(item)) && getBoxItemQuantity(item) !== ''
  );
  const boxId = String(getBoxItemsLookupId(box) || '').trim();
  const boxItems = batchItems && isUuidValue(boxId)
    ? getBatchItemsForBox(batchItems, boxId)
    : await fetchBoxItemsByBoxId(box);
  const hydratedBoxItems = getShipmentScopedBoxItems(boxItems, lineItemList);

  if (hydratedBoxItems.length) {
    console.log('[PickPackPro][Box Items merged]', {
      boxId: getBoxItemsLookupId(box),
      existingItems,
      fetchedItems: boxItems,
      hydratedItems: hydratedBoxItems,
    });

    return {
      ...box,
      items: hydratedBoxItems,
      boxItems: hydratedBoxItems,
      box_items: hydratedBoxItems,
      contents: hydratedBoxItems,
      __boxItemsSource: 'api',
      __boxItemsFetchedCount: hydratedBoxItems.length,
    };
  }

  const cachedItems = getCachedBoxAllocationItems(box, lineItemList);
  if (cachedItems.length) {
    return {
      ...box,
      items: cachedItems,
      boxItems: cachedItems,
      box_items: cachedItems,
      contents: cachedItems,
      __boxItemsSource: 'cache',
      __boxItemsFetchedCount: cachedItems.length,
    };
  }

  if (hasUsableItems) {
    const hydratedExistingItems = getShipmentScopedBoxItems(existingItems, lineItemList);
    if (!hydratedExistingItems.length) return box;

    return {
      ...box,
      items: hydratedExistingItems,
      boxItems: hydratedExistingItems,
      box_items: hydratedExistingItems,
      contents: hydratedExistingItems,
      __boxItemsSource: 'inline',
      __boxItemsFetchedCount: 0,
    };
  }

  return box;
};

const enrichBoxesWithItems = async (boxList = [], lineItemList = []) => {
  if (!boxList.length) return [];
  const batchBoxIds = boxList.map((box) => getBoxItemsLookupId(box)).filter(isUuidValue).filter(Boolean);
  let batchItems = null;

  if (batchBoxIds.length) {
    try {
      batchItems = await fetchBoxItemsBatch({
        apiBaseUrl: API_BASE_URL,
        headers: buildHeaders(),
        parseResponse,
        boxIds: batchBoxIds,
      });
    } catch {
      batchItems = null;
    }
  }

  const results = await Promise.allSettled(boxList.map((box) => enrichBoxWithItems(box, lineItemList, batchItems)));
  return results.map((result, index) =>
    result.status === 'fulfilled' ? result.value : boxList[index]
  );
};

const enrichBoxesWithItemsIfMissing = async (boxList = [], lineItemList = []) => {
  const boxesNeedingItems = toArray(boxList).filter((box) => !getBoxItems(box).length && getBoxItemsLookupId(box));
  return boxesNeedingItems.length ? enrichBoxesWithItems(boxList, lineItemList) : boxList;
};

const getBoxSkuValue = (box = {}, files = [], lineItemList = []) => {
  const lineItems = toArray(lineItemList);
  const items = getShipmentScopedBoxItems(getBoxItems(box), lineItems);
  const itemSkus = items
    .map((item) => {
      const sku = String(getBoxItemSku(item) || '').trim();
      const quantity = getBoxItemQuantity(item);

      if (sku && quantity !== '') return `${sku}: ${formatQuantityValue(quantity)}`;
      return sku;
    })
    .filter(Boolean);

  if (itemSkus.length) return itemSkus.join(', ');

  const skuCollection = getBoxSkuCollectionValue(
    box?.skus,
    box?.skuList,
    box?.sku_list,
    box?.skuSummary,
    box?.sku_summary,
    box?.sellerSkus,
    box?.seller_skus,
    box?.metadata?.skus,
    box?.metadata?.skuList,
    box?.metadata?.sku_list,
    box?.meta?.skus,
    box?.meta?.skuList,
    box?.meta?.sku_list
  );

  const scopedSkuCollection = lineItems.length
    ? getShipmentScopedSkuCollectionValue(skuCollection, lineItems)
    : skuCollection;

  if (scopedSkuCollection) return scopedSkuCollection;

  const directSku = firstPresent(
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
    getBoxItemSku(items[0]),
    getFileSku(getBoxFbaLabelFile(box, files))
  );

  return lineItems.length ? getShipmentScopedSkuCollectionValue(directSku, lineItems) : directSku;
};

const getBoxSkuSummary = (box = {}, files = [], lineItemList = []) => {
  const lineItems = toArray(lineItemList);
  const itemSummaries = getShipmentScopedBoxItems(getBoxItems(box), lineItems)
    .map((item) => {
      const sku = getBoxItemSku(item);
      const quantity = getBoxItemQuantity(item);

      if (sku && quantity !== '') return `${formatQuantityValue(quantity)} UNITS (${sku})`;
      if (sku) return sku;
      if (quantity !== '') return `${formatQuantityValue(quantity)} UNITS`;
      return '';
    })
    .filter(Boolean);

  if (itemSummaries.length) return itemSummaries.join(', ');

  const sku = getBoxSkuValue(box, files, lineItems);
  const units = getBoxUnits(box, lineItems);

  if (sku && units !== '' && !String(sku).includes(':')) return `${formatQuantityValue(units)} UNITS (${sku})`;
  if (sku) return sku;
  if (units && !lineItems.length) return `${formatQuantityValue(units)} UNITS`;
  return '';
};

const getBoxSubtitle = (box) => {
  const dimensions = getBoxDimensions(box);
  const weight = firstPresent(box?.weight, box?.weightKg, box?.weight_kg, box?.grossWeight, box?.gross_weight);
  const skuSummary = getBoxSkuSummary(box);
  return [dimensions, weight ? `${weight} KG` : '', skuSummary].filter(Boolean).join(' - ') || 'No box details';
};

const statusSteps = ['draft', 'submitted', 'pending_arrival', 'received', 'in_progress', 'prepped', 'dispatched', 'completed'];

const formatServiceLabel = getServiceDisplayName;

const extractSubShipments = (payload) =>
  extractList(payload, ['subShipments', 'sub_shipments', 'subshipments']);

const extractSubShipmentAvailability = (payload) =>
  extractList(payload, [
    'availability',
    'availableItems',
    'available_items',
    'availablePreparedItems',
    'available_prepared_items',
    'preparedItems',
    'prepared_items',
  ]);

const getSubShipmentId = (subShipment = {}) =>
  firstPresent(subShipment?.id, subShipment?.uuid, subShipment?.subShipmentId, subShipment?.sub_shipment_id);

const getBoxSubShipmentId = (box = {}) =>
  firstPresent(
    box?.subShipmentId,
    box?.sub_shipment_id,
    box?.subshipmentId,
    box?.subshipment_id,
    box?.subShipmentID,
    box?.sub_shipment_uuid,
    box?.subShipmentUuid,
    box?.sub_shipment_uuid,
    box?.metadata?.subShipmentId,
    box?.metadata?.sub_shipment_id,
    box?.metadata?.subshipmentId,
    box?.metadata?.subshipment_id,
    box?.meta?.subShipmentId,
    box?.meta?.sub_shipment_id,
    box?.subShipment?.id,
    box?.subShipment?.uuid,
    box?.subShipment?.subShipmentId,
    box?.subShipment?.sub_shipment_id,
    box?.sub_shipment?.id,
    box?.sub_shipment?.uuid,
    box?.sub_shipment?.subShipmentId,
    box?.sub_shipment?.sub_shipment_id
  );

const getBoxSubShipmentReference = (box = {}) =>
  firstPresent(
    box?.subShipmentReference,
    box?.sub_shipment_reference,
    box?.subshipmentReference,
    box?.subshipment_reference,
    box?.subShipmentRef,
    box?.sub_shipment_ref,
    box?.metadata?.subShipmentReference,
    box?.metadata?.sub_shipment_reference,
    box?.metadata?.subShipmentRef,
    box?.metadata?.sub_shipment_ref,
    box?.meta?.subShipmentReference,
    box?.meta?.sub_shipment_reference,
    box?.subShipment?.reference,
    box?.subShipment?.subShipmentReference,
    box?.subShipment?.sub_shipment_reference,
    box?.subShipment?.subShipmentRef,
    box?.subShipment?.sub_shipment_ref,
    box?.sub_shipment?.reference,
    box?.sub_shipment?.subShipmentReference,
    box?.sub_shipment?.sub_shipment_reference,
    box?.sub_shipment?.subShipmentRef,
    box?.sub_shipment?.sub_shipment_ref
  );

const getSubShipmentReference = (subShipment = {}) =>
  firstPresent(
    subShipment?.reference,
    subShipment?.subShipmentReference,
    subShipment?.sub_shipment_reference,
    subShipment?.sequence_no ? `Sub-shipment ${subShipment.sequence_no}` : '',
    getSubShipmentId(subShipment)
  );

const getBoxScope = (box = {}) =>
  String(firstPresent(box?.scope, box?.boxScope, box?.box_scope, box?.metadata?.scope, box?.meta?.scope) || '').trim().toLowerCase();

const isParentShipmentBox = (box = {}) => {
  const scope = getBoxScope(box);
  if (scope === 'parent_shipment') return true;
  if (scope === 'sub_shipment') return false;
  return !getBoxSubShipmentId(box) && !getBoxSubShipmentReference(box);
};

const decorateSubShipmentBoxForScope = (box = {}, subShipment = {}) => {
  const subShipmentId = getSubShipmentId(subShipment);
  const subShipmentReference = getSubShipmentReference(subShipment);

  return {
    ...box,
    subShipmentId: getBoxSubShipmentId(box) || subShipmentId,
    sub_shipment_id: getBoxSubShipmentId(box) || subShipmentId,
    subShipmentReference: getBoxSubShipmentReference(box) || subShipmentReference,
    sub_shipment_reference: getBoxSubShipmentReference(box) || subShipmentReference,
    scope: getBoxScope(box) || 'sub_shipment',
  };
};

const getBoxScopeKeys = (box = {}) => [
  getBoxRecordId(box),
  getBoxId(box),
  ...getBoxLookupIds(box),
  box?.reference,
  box?.boxReference,
  box?.box_reference,
].map((value) => String(value || '').trim()).filter(Boolean);

const getVisiblePackageRowsWithPalletChildren = (boxRows = [], decorateChild = (childBox) => childBox) => {
  const sourceRows = toArray(boxRows);
  const childRows = sourceRows.flatMap((box, boxIndex) => {
    if (!isPalletBox(box)) return [];

    const palletId = getBoxRecordId(box) || getBoxId(box) || getBoxPalletId(box);
    const palletLabel = getBoxPalletLabel(box, boxIndex);
    const palletScope = getBoxScope(box);
    const palletSubShipmentId = getBoxSubShipmentId(box);
    const palletSubShipmentReference = getBoxSubShipmentReference(box);

    return getPalletChildBoxes(box).map((childBox) => {
      const decoratedChild = decorateChild(childBox, box) || childBox;
      const childScope = getBoxScope(decoratedChild) || getBoxScope(childBox) || palletScope;
      const childSubShipmentId = getBoxSubShipmentId(decoratedChild) || getBoxSubShipmentId(childBox) || palletSubShipmentId;
      const childSubShipmentReference = getBoxSubShipmentReference(decoratedChild) || getBoxSubShipmentReference(childBox) || palletSubShipmentReference;

      return {
        ...decoratedChild,
        palletId: getBoxPalletId(decoratedChild) || getBoxPalletId(childBox) || palletId,
        pallet_id: getBoxPalletId(decoratedChild) || getBoxPalletId(childBox) || palletId,
        insidePallet: true,
        inside_pallet: true,
        parentPalletNumber: firstPresent(decoratedChild?.parentPalletNumber, decoratedChild?.parent_pallet_number, childBox?.parentPalletNumber, childBox?.parent_pallet_number, palletLabel),
        parent_pallet_number: firstPresent(decoratedChild?.parent_pallet_number, decoratedChild?.parentPalletNumber, childBox?.parent_pallet_number, childBox?.parentPalletNumber, palletLabel),
        ...(childScope ? { scope: childScope } : {}),
        ...(childSubShipmentId
          ? {
              subShipmentId: childSubShipmentId,
              sub_shipment_id: childSubShipmentId,
            }
          : {}),
        ...(childSubShipmentReference
          ? {
              subShipmentReference: childSubShipmentReference,
              sub_shipment_reference: childSubShipmentReference,
            }
          : {}),
      };
    });
  });

  const merged = new Map();
  [sourceRows, childRows].flat().filter(Boolean).forEach((box, index) => {
    const key = getBoxDedupeKey(box, index);
    if (merged.has(key)) {
      merged.set(key, { ...merged.get(key), ...box });
      return;
    }
    merged.set(key, box);
  });

  return [...merged.values()];
};

const getSubShipmentStatus = (subShipment = {}) =>
  String(firstPresent(subShipment?.status, 'draft')).trim().toLowerCase();

const isDispatchInvoiceEligibleStatus = (status = '') =>
  ['dispatched', 'completed', 'complete'].includes(String(status || '').trim().toLowerCase());

const getInvoiceId = (invoice = {}) =>
  firstPresent(invoice?.id, invoice?.uuid, invoice?.invoiceId, invoice?.invoice_id);

const getInvoiceReference = (invoice = {}) =>
  firstPresent(invoice?.invoiceNumber, invoice?.invoice_number, invoice?.number, invoice?.reference, getInvoiceId(invoice), 'Invoice');

const getInvoiceStatusLabel = (invoice = {}) =>
  formatServiceLabel(firstPresent(invoice?.status, 'draft'));

const getInvoiceTotal = (invoice = {}) =>
  firstPresent(invoice?.total, invoice?.totalAmount, invoice?.total_amount, invoice?.grandTotal, invoice?.grand_total, invoice?.amountDue, invoice?.amount_due, '');

const getInvoiceDate = (invoice = {}) =>
  firstPresent(invoice?.invoiceDate, invoice?.invoice_date, invoice?.date, invoice?.createdAt, invoice?.created_at);

const getInvoiceType = (invoice = {}) =>
  String(firstPresent(invoice?.invoiceType, invoice?.invoice_type, invoice?.type, '')).trim().toLowerCase();

const findInvoiceByType = (owner = {}, type = '') => {
  const directInvoice =
    owner?.invoice ||
    owner?.shipmentInvoice ||
    owner?.shipment_invoice ||
    owner?.subShipmentInvoice ||
    owner?.sub_shipment_invoice ||
    owner?.draftInvoice ||
    owner?.draft_invoice;
  if (directInvoice && typeof directInvoice === 'object') return directInvoice;

  const invoices = extractList(owner, ['invoices', 'invoiceRows', 'invoice_rows']);
  return invoices.find((invoice) => {
    const invoiceType = getInvoiceType(invoice);
    return !type || invoiceType === type || (!invoiceType && type === 'shipment');
  }) || null;
};

const extractGeneratedInvoice = (payload = {}) =>
  payload?.invoice || payload?.data?.invoice || payload?.data?.row || payload?.data?.record || payload?.data || payload;

const getSubShipmentStatusLabel = (status = '') => {
  const normalizedStatus = String(status || '').trim().toLowerCase();
  return SUB_SHIPMENT_STATUSES[normalizedStatus] || formatServiceLabel(normalizedStatus || 'draft');
};

const getSubShipmentItems = (subShipment = {}) =>
  extractList(subShipment, ['sub_shipment_items', 'subShipmentItems', 'items']);

const getSubShipmentBoxes = (subShipment = {}) =>
  extractBoxes(subShipment);

const getSubShipmentDedupeKey = (subShipment = {}, index = 0) =>
  String(getSubShipmentId(subShipment) || getSubShipmentReference(subShipment) || index);

const mergeSubShipmentLists = (...subShipmentLists) => {
  const merged = new Map();

  subShipmentLists.flat().filter(Boolean).forEach((subShipment, index) => {
    const key = getSubShipmentDedupeKey(subShipment, index);
    if (!merged.has(key)) merged.set(key, subShipment);
  });

  return [...merged.values()];
};

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

const getAvailabilityItemId = (item = {}) =>
  firstPresent(item?.shipmentItemId, item?.shipment_item_id, item?.lineItemId, item?.line_item_id, item?.id);

const getAvailabilitySku = (item = {}) =>
  firstPresent(
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
    item?.product?.sku,
    item?.product?.sellerSku,
    item?.product?.seller_sku,
    item?.product?.sellerSKU,
    item?.product?.productSku,
    item?.product?.product_sku,
    item?.products?.sku,
    item?.products?.sellerSku,
    item?.products?.seller_sku,
    item?.products?.sellerSKU,
    item?.products?.productSku,
    item?.products?.product_sku
  );

const getAvailabilityFnsku = (item = {}) =>
  firstPresent(
    item?.fnskuLabel,
    item?.fnsku_label,
    item?.fnsku,
    item?.defaultFnsku,
    item?.default_fnsku,
    item?.product?.fnskuLabel,
    item?.product?.fnsku_label,
    item?.product?.fnsku,
    item?.product?.defaultFnsku,
    item?.product?.default_fnsku,
    item?.products?.fnskuLabel,
    item?.products?.fnsku_label,
    item?.products?.fnsku,
    item?.products?.defaultFnsku,
    item?.products?.default_fnsku
  );

const getAvailabilityRawProductName = (item = {}) =>
  firstPresent(
    item?.productName,
    item?.product_name,
    item?.name,
    item?.title,
    item?.product?.productName,
    item?.product?.product_name,
    item?.product?.name,
    item?.product?.title,
    item?.products?.productName,
    item?.products?.product_name,
    item?.products?.name,
    item?.products?.title
  );

const getAvailabilitySequenceParts = (item = {}) => ({
  product: parseLineItemSequenceOrder(getAvailabilityRawProductName(item), PRODUCT_SEQUENCE_PREFIXES),
  sku: parseLineItemSequenceOrder(getAvailabilitySku(item), SKU_SEQUENCE_PREFIXES),
  fnsku: parseLineItemSequenceOrder(getAvailabilityFnsku(item), FNSKU_SEQUENCE_PREFIXES),
});

const getAvailabilityReliableSequenceOrder = (item = {}) => {
  const sequenceParts = getAvailabilitySequenceParts(item);
  return sequenceParts.sku ?? sequenceParts.fnsku ?? sequenceParts.product;
};

const getAvailabilityProductName = (item = {}) => {
  return resolveDisplayProductName(getAvailabilityRawProductName(item));
};

const sortAvailabilityRowsForDisplay = (items = []) =>
  (Array.isArray(items) ? [...items] : []).sort((firstItem, secondItem) => {
    const firstOrder = getAvailabilityReliableSequenceOrder(firstItem);
    const secondOrder = getAvailabilityReliableSequenceOrder(secondItem);

    if (firstOrder !== null && secondOrder !== null && firstOrder !== secondOrder) {
      return firstOrder - secondOrder;
    }

    if (firstOrder !== null && secondOrder === null) return -1;
    if (firstOrder === null && secondOrder !== null) return 1;

    return String(getAvailabilityProductName(firstItem) || getAvailabilitySku(firstItem) || '').localeCompare(
      String(getAvailabilityProductName(secondItem) || getAvailabilitySku(secondItem) || ''),
      undefined,
      { numeric: true, sensitivity: 'base' }
    );
  });

const getAvailabilityExpectedQty = (item = {}) =>
  firstPresent(item?.expectedQty, item?.expected_qty, item?.qtyExpected, item?.qty_expected, 0);

const getAvailabilityReceivedQty = (item = {}) =>
  firstPresent(item?.receivedQty, item?.received_qty, item?.qtyReceived, item?.qty_received, 0);

const getAvailabilityDifferenceQty = (item = {}) => {
  const expectedNumber = Number(getAvailabilityExpectedQty(item) ?? 0);
  const receivedNumber = Number(getAvailabilityReceivedQty(item) ?? 0);
  const expectedQty = Number.isFinite(expectedNumber) ? expectedNumber : 0;
  const receivedQty = Number.isFinite(receivedNumber) ? receivedNumber : 0;

  return receivedQty - expectedQty;
};

const formatAvailabilityDifferenceQty = (value) => {
  const quantity = Number(value);
  if (!Number.isFinite(quantity) || quantity === 0) return '0';
  return quantity > 0 ? `+${formatQuantityValue(quantity)}` : formatQuantityValue(quantity);
};

const getAvailabilityAssignedQty = (item = {}) => {
  const displayQuantity = firstPresent(item?.assignedDisplayQty, item?.assigned_display_qty);
  const displayNumber = Number(displayQuantity);
  if (displayQuantity !== '' && Number.isFinite(displayNumber)) return Math.max(0, displayNumber);

  const consumedQuantity = firstPresent(item?.consumedQty, item?.consumed_qty);
  const consumedNumber = Number(consumedQuantity);
  if (consumedQuantity !== '' && Number.isFinite(consumedNumber)) return Math.max(0, consumedNumber);

  const subShipmentAssignedNumber = Number(firstPresent(item?.assignedToSubShipments, item?.assigned_to_sub_shipments, 0) || 0);
  const packedInParentBoxesNumber = Number(firstPresent(item?.packedInParentBoxes, item?.packed_in_parent_boxes, 0) || 0);
  const combinedAssignedNumber =
    (Number.isFinite(subShipmentAssignedNumber) ? subShipmentAssignedNumber : 0) +
    (Number.isFinite(packedInParentBoxesNumber) ? packedInParentBoxesNumber : 0);

  if (combinedAssignedNumber > 0) return Math.max(0, combinedAssignedNumber);

  return firstPresent(item?.assignedQty, item?.assigned_qty, item?.assigned, 0);
};

const getAvailabilityRemainingQty = (item = {}) =>
  firstPresent(item?.remainingQty, item?.remaining_qty, 0);

const getAvailabilityAvailableQty = (item = {}) => {
  const availableQuantity = firstPresent(item?.availableQty, item?.available_qty);
  const availableNumber = Number(availableQuantity);
  if (availableQuantity !== '' && Number.isFinite(availableNumber)) return Math.max(0, availableNumber);

  const remainingQuantity = firstPresent(item?.remainingQty, item?.remaining_qty);
  const remainingNumber = Number(remainingQuantity);
  if (remainingQuantity !== '' && Number.isFinite(remainingNumber)) return Math.max(0, remainingNumber);

  return 0;
};

const isAvailabilityPrepared = (item = {}) =>
  item?.prepared === true || item?.isPrepared === true || item?.is_prepared === true;

const getSubShipmentAllocationItemId = (item = {}) =>
  firstPresent(item?.shipmentItemId, item?.shipment_item_id, item?.lineItemId, item?.line_item_id, item?.id);

const getSubShipmentBoxRows = (subShipment = {}, boxData = {}) =>
  mergeBoxLists(getSubShipmentBoxes(subShipment), extractBoxes(boxData));

const hasBoxAllocationDetails = (box = {}) => {
  const boxItems = getBoxItems(box);
  const hasItemRows = boxItems.some((boxItem) =>
    Boolean((getBoxItemLineItemId(boxItem) || getBoxItemSku(boxItem)) && getBoxItemQuantity(boxItem) !== '')
  );

  if (hasItemRows) return true;

  return Boolean(getBoxDisplaySkuValues(box).length && getBoxUnits(box) !== '');
};

const getSubShipmentAllocationSummary = (subShipment = {}, boxData = {}) =>
  extractList(boxData, ['allocationSummary', 'allocation_summary']).length
    ? extractList(boxData, ['allocationSummary', 'allocation_summary'])
    : getSubShipmentItems(subShipment).map((item) => {
        const lineItem = getSubShipmentItemLineItem(item);
        return {
          shipmentItemId: getLineItemId(lineItem) || getSubShipmentAllocationItemId(item),
          sku: getItemSku(lineItem),
          plannedQty: getSubShipmentItemQuantity(item),
          allocated: 0,
          remainingQty: getSubShipmentItemQuantity(item),
        };
      });

const getSubShipmentLineItemsForBoxing = (subShipment = {}, boxData = {}, parentLineItems = []) => {
  const items = getSubShipmentItems(subShipment);
  const summaryRows = getSubShipmentAllocationSummary(subShipment, boxData);
  const subShipmentBoxes = getSubShipmentBoxRows(subShipment, boxData);
  const hasDetailedBoxAllocation = subShipmentBoxes.some(hasBoxAllocationDetails);
  const hasSummaryAllocation = summaryRows.some((summary) => {
    const plannedQty = Number(firstPresent(summary?.plannedQty, summary?.planned_qty, getSubShipmentItemQuantity(summary), 0) || 0);
    const allocatedQty = Number(firstPresent(summary?.allocated, summary?.allocatedQty, summary?.allocated_qty, 0) || 0);
    const remainingValue = firstPresent(summary?.remainingQty, summary?.remaining_qty);
    const remainingQty = Number(remainingValue);

    return (
      (Number.isFinite(allocatedQty) && allocatedQty > 0) ||
      (remainingValue !== '' && Number.isFinite(remainingQty) && Number.isFinite(plannedQty) && remainingQty < plannedQty)
    );
  });
  const assumeExistingBoxesConsumedPlannedQty = subShipmentBoxes.length > 0 && !hasDetailedBoxAllocation && !hasSummaryAllocation;

  return summaryRows
    .map((summary) => {
      const summaryItemId = String(getSubShipmentAllocationItemId(summary) || '').trim();
      const summarySku = String(getAvailabilitySku(summary) || '').trim().toLowerCase();
      const matchedSubItem = items.find((item) => {
        const lineItem = getSubShipmentItemLineItem(item);
        const lineItemId = String(getLineItemId(lineItem) || getSubShipmentAllocationItemId(item) || '').trim();
        const lineItemSku = String(getItemSku(lineItem) || '').trim().toLowerCase();
        return Boolean(
          (summaryItemId && lineItemId && summaryItemId === lineItemId) ||
            (summarySku && lineItemSku && skuValuesMatch(summarySku, lineItemSku))
        );
      });
      const matchedParentLine = toArray(parentLineItems).find((lineItem) => {
        const lineItemId = String(getLineItemId(lineItem) || '').trim();
        const lineItemSku = String(getItemSku(lineItem) || '').trim().toLowerCase();
        return Boolean(
          (summaryItemId && lineItemId && summaryItemId === lineItemId) ||
            (summarySku && lineItemSku && skuValuesMatch(summarySku, lineItemSku))
        );
      });
      const sourceLineItem = matchedSubItem ? getSubShipmentItemLineItem(matchedSubItem) : matchedParentLine || {};
      const plannedQty = Number(firstPresent(summary?.plannedQty, summary?.planned_qty, getSubShipmentItemQuantity(matchedSubItem || {}), 0) || 0);
      const shipmentItemId = summaryItemId || getLineItemId(sourceLineItem);
      const sku = getAvailabilitySku(summary) || getItemSku(sourceLineItem);

      if (!shipmentItemId && !sku) return null;

      const allocationLineItem = {
        ...sourceLineItem,
        id: shipmentItemId || sourceLineItem?.id,
        shipmentItemId,
        shipment_item_id: shipmentItemId,
        sku,
        sellerSku: sku,
        seller_sku: sku,
      };
      const summaryAllocatedQty = Number(firstPresent(summary?.allocated, summary?.allocatedQty, summary?.allocated_qty, 0) || 0);
      const allocationLineItems = [allocationLineItem, ...toArray(parentLineItems)];
      const actualAllocatedQty = getAllocatedQuantityForLineItem(allocationLineItem, subShipmentBoxes, allocationLineItems);
      const allocatedQty = Math.min(
        plannedQty,
        assumeExistingBoxesConsumedPlannedQty
          ? plannedQty
          : Math.max(
              Number.isFinite(summaryAllocatedQty) ? summaryAllocatedQty : 0,
              Number.isFinite(actualAllocatedQty) ? actualAllocatedQty : 0
            )
      );
      const summaryRemainingValue = firstPresent(summary?.remainingQty, summary?.remaining_qty);
      const summaryRemainingQty = Number(summaryRemainingValue);
      const computedRemainingQty = Math.max(0, plannedQty - allocatedQty);
      const remainingQty =
        summaryRemainingValue !== '' && Number.isFinite(summaryRemainingQty)
          ? Math.min(Math.max(0, summaryRemainingQty), computedRemainingQty)
          : computedRemainingQty;

      return {
        ...allocationLineItem,
        sku,
        productName: getAvailabilityProductName(summary) || getItemProductName(sourceLineItem),
        product_name: getAvailabilityProductName(summary) || getItemProductName(sourceLineItem),
        quantity: plannedQty,
        qty: plannedQty,
        expectedQty: plannedQty,
        expected_qty: plannedQty,
        receivedQty: plannedQty,
        received_qty: plannedQty,
        __subShipmentPlannedQty: plannedQty,
        __subShipmentAllocatedQty: allocatedQty,
        __subShipmentAvailableQty: Math.max(0, remainingQty),
      };
    })
    .filter(Boolean);
};

const getSubShipmentResolvedAllocationSummary = (subShipment = {}, boxData = {}, parentLineItems = []) =>
  getSubShipmentLineItemsForBoxing(subShipment, boxData, parentLineItems).map((item) => ({
    shipmentItemId: getBoxAllocationLineItemId(item) || getLineItemId(item),
    sku: getItemSku(item),
    plannedQty: item.__subShipmentPlannedQty,
    allocated: item.__subShipmentAllocatedQty,
    remainingQty: item.__subShipmentAvailableQty,
  }));

const getSubShipmentLabelSummary = (boxes = [], files = []) => {
  if (!boxes.length) return 'No boxes';
  const labeledCount = boxes.filter((box) => isBoxFbaLabelUploaded(box, files)).length;
  return `${labeledCount}/${boxes.length} labels uploaded`;
};

const getSubShipmentDispatchSummary = (subShipment = {}, boxes = []) => {
  const status = getSubShipmentStatus(subShipment);
  if (['dispatched', 'completed'].includes(status)) return getSubShipmentStatusLabel(status);
  if (!boxes.length) return 'No boxes';
  const dispatchedCount = boxes.filter((box) =>
    ['dispatched', 'sealed', 'completed', 'complete'].includes(
      String(firstPresent(box?.status, box?.boxStatus, box?.box_status, box?.dispatchStatus, box?.dispatch_status, '')).toLowerCase()
    ) || Boolean(box?.dispatched_at || box?.dispatchedAt)
  ).length;
  return `${dispatchedCount}/${boxes.length} dispatched`;
};

const getServiceDisplayStatus = (serviceName, item, services, itemCount = 0) => {
  const matchedTask = getServiceTaskForLine(serviceName, item, services, itemCount);

  if (matchedTask && isServiceTaskCompleteForPrep(matchedTask, item)) {
    return 'Done';
  }

  return 'Pending';
};

const getBoxImageUrl = (box, files) => {
  const labelFile = getBoxFbaLabelFile(box, files);
  if (labelFile && isImageFile(labelFile)) return resolveFileUrl(getFileUrl(labelFile));

  const boxIds = getBoxLookupIds(box);
  const directImage = firstPresent(box?.imageUrl, box?.image_url, box?.photoUrl, box?.photo_url);
  if (directImage) return resolveFileUrl(directImage);

  const matchedFile = toArray(files).find((file) => {
    const fileEntityId = String(getFileEntityId(file) || '').trim();
    const sameEntity =
      (fileEntityId && boxIds.includes(fileEntityId)) ||
      boxIds.some((boxId) => file?.entityId === boxId || file?.entity_id === boxId || file?.boxId === boxId || file?.box_id === boxId);
    const type = String(file?.mimeType || file?.mime_type || file?.fileType || file?.file_type || '').toLowerCase();
    return sameEntity && type.includes('image');
  });

  return resolveFileUrl(getFileUrl(matchedFile));
};

const getBoxLabelState = (box, files = []) =>
  isBoxFbaLabelUploaded(box, files)
    ? { label: 'Label Ready', className: 'bg-emerald-50 text-emerald-700' }
    : { label: 'Label Needed', className: 'bg-red-50 text-red-600' };

const extractCustomServices = (shipment, serviceTasks = []) => {
  const items = getLineItems(shipment);
  const customServices = items.flatMap((item) =>
    toArray(item?.customServices || item?.custom_services).map((service, index) => ({
      id: service?.id || `${getLineItemId(item) || getItemSku(item) || 'item'}-${index}`,
      lineItemId: getLineItemId(item),
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
        const itemId = String(getLineItemId(item) || '').trim();
        const itemSku = String(getItemSku(item) || '').trim().toLowerCase();
        return (serviceLineItemId && itemId === serviceLineItemId) || (serviceSku && itemSku === serviceSku);
      });
      const lineItemId = serviceLineItemId || getLineItemId(matchedItem) || '';
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
        status: firstPresent(service?.status, service?.taskStatus, service?.task_status, service?.state, 'PENDING'),
      });
    });

  return customServices;
};

const getServiceTaskId = (service) =>
  service?.id ||
  service?.taskId ||
  service?.task_id ||
  service?.serviceTaskId ||
  service?.service_task_id ||
  '';

const getLineItemId = (item) =>
  firstPresent(
    item?.id,
    item?.uuid,
    item?.shipmentItemId,
    item?.shipment_item_id,
    item?.lineItemId,
    item?.line_item_id,
    item?.itemId,
    item?.item_id,
    item?.lineItem?.id,
    item?.line_item?.id,
    item?.shipmentItem?.id,
    item?.shipment_item?.id,
    item?.productItem?.id,
    item?.product_item?.id,
    item?.productId,
    item?.product_id
  );

const getShipmentLineItemId = (item) =>
  firstPresent(
    item?.id,
    item?.uuid,
    item?.shipmentItemId,
    item?.shipment_item_id,
    item?.shipmentLineItemId,
    item?.shipment_line_item_id,
    item?.lineItemId,
    item?.line_item_id,
    item?.itemId,
    item?.item_id,
    item?.lineItem?.id,
    item?.lineItem?.uuid,
    item?.line_item?.id,
    item?.line_item?.uuid,
    item?.shipmentItem?.id,
    item?.shipmentItem?.uuid,
    item?.shipment_item?.id,
    item?.shipment_item?.uuid
  );

const getBoxAllocationLineItemId = (item = {}) =>
  firstUuidValue(
    item?.id,
    item?.uuid,
    item?.shipmentItemId,
    item?.shipment_item_id,
    item?.shipmentLineItemId,
    item?.shipment_line_item_id,
    item?.lineItemId,
    item?.line_item_id,
    item?.lineItem?.id,
    item?.lineItem?.uuid,
    item?.line_item?.id,
    item?.line_item?.uuid,
    item?.shipmentItem?.id,
    item?.shipmentItem?.uuid,
    item?.shipment_item?.id,
    item?.shipment_item?.uuid
  );

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
    service?.sellerSKU,
    service?.productSku,
    service?.product_sku,
    service?.skuCode,
    service?.sku_code,
    service?.merchantSku,
    service?.merchant_sku,
    service?.msku,
    service?.lineItem?.sku,
    service?.lineItem?.sellerSku,
    service?.lineItem?.seller_sku,
    service?.lineItem?.sellerSKU,
    service?.lineItem?.productSku,
    service?.lineItem?.product_sku,
    service?.line_item?.sku,
    service?.line_item?.sellerSku,
    service?.line_item?.seller_sku,
    service?.line_item?.sellerSKU,
    service?.line_item?.productSku,
    service?.line_item?.product_sku,
    service?.shipmentItem?.sku,
    service?.shipmentItem?.sellerSku,
    service?.shipmentItem?.seller_sku,
    service?.shipmentItem?.sellerSKU,
    service?.shipmentItem?.productSku,
    service?.shipmentItem?.product_sku,
    service?.shipment_item?.sku,
    service?.shipment_item?.sellerSku,
    service?.shipment_item?.seller_sku,
    service?.shipment_item?.sellerSKU,
    service?.shipment_item?.productSku,
    service?.shipment_item?.product_sku,
    service?.item?.sku,
    service?.item?.sellerSku,
    service?.item?.seller_sku,
    service?.item?.sellerSKU,
    service?.item?.productSku,
    service?.item?.product_sku,
    service?.product?.sku,
    service?.product?.sellerSku,
    service?.product?.seller_sku,
    service?.product?.sellerSKU,
    service?.product?.productSku,
    service?.product?.product_sku
  );

const getServiceTaskLabel = (service = {}) =>
  formatServiceLabel(
    typeof service === 'object'
      ? firstPresent(service?.serviceType, service?.service_type, service?.name, service?.serviceName, service?.service_name, service?.type)
      : service
  );

const getServiceTaskDoneUnitsValue = (service = {}) =>
  firstPresent(
    service?.unitsDone,
    service?.units_done,
    service?.doneUnits,
    service?.done_units,
    service?.completedUnits,
    service?.completed_units,
    service?.completedQty,
    service?.completed_qty,
    service?.qtyDone,
    service?.qty_done,
    service?.quantityDone,
    service?.quantity_done
  );

const getServiceTaskRequiredUnitsValue = (service = {}, lineItem = {}) =>
  firstPresent(
    getItemReceivedQty(lineItem),
    getItemExpectedQty(lineItem),
    service?.unitsRequired,
    service?.units_required,
    service?.requiredUnits,
    service?.required_units,
    service?.totalUnits,
    service?.total_units,
    service?.expectedUnits,
    service?.expected_units,
    service?.quantity,
    service?.qty,
    service?.expectedQty,
    service?.expected_qty,
    service?.expectedQuantity,
    service?.expected_quantity,
    service?.receivedQty,
    service?.received_qty
  );

const hasPreparedUnitValue = (value) =>
  value === 0 || (value !== undefined && value !== null && String(value).trim() !== '');

const isServiceTaskCompleteForPrep = (service = {}, lineItem = {}) => {
  const normalized = String(firstPresent(service?.status, service?.taskStatus, service?.task_status, service?.state, '')).toUpperCase();
  if (!['DONE', 'COMPLETED', 'COMPLETE'].includes(normalized)) return false;

  const requiredUnits = Number(getServiceTaskRequiredUnitsValue(service, lineItem) || 0);
  if (!Number.isFinite(requiredUnits) || requiredUnits <= 0) return true;

  const doneUnitsValue = getServiceTaskDoneUnitsValue(service);
  if (!hasPreparedUnitValue(doneUnitsValue)) return false;

  const doneUnits = Number(doneUnitsValue);
  return Number.isFinite(doneUnits) && doneUnits >= requiredUnits;
};

const isOtherServiceTask = (service = {}) => {
  const rawType = String(firstPresent(service?.serviceType, service?.service_type, service?.type)).trim().toLowerCase();
  const label = String(getServiceTaskLabel(service) || '').trim().toLowerCase();

  return rawType === 'other' || rawType === 'other_service' || label === 'other' || label.includes('other service');
};

const normalizeServiceKey = getServiceKey;

const isBundlingServiceValue = (value = '') =>
  isBundlingService(typeof value === 'object' ? getServiceTaskLabel(value) : value);

const filterBundlingServiceLabels = (services = []) =>
  services.filter((service) => !isBundlingServiceValue(service));

const isTruthyFlag = (value) => {
  if (value === true || value === 1 || value === '1') return true;
  return ['true', 'yes', 'y'].includes(String(value || '').trim().toLowerCase());
};

const isItemBundlingEnabled = (item = {}) =>
  isTruthyFlag(item?.needsBundling) || isTruthyFlag(item?.needs_bundling);

const getItemBundleMetadataSize = (item = {}) => {
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
    item?.units_per_bundle,
    item?.product?.bundleSize,
    item?.product?.bundle_size,
    item?.product?.bundleQty,
    item?.product?.bundle_qty,
    item?.product?.bundleQuantity,
    item?.product?.bundle_quantity,
    item?.product?.bundle,
    item?.product?.casePack,
    item?.product?.case_pack,
    item?.products?.bundleSize,
    item?.products?.bundle_size,
    item?.products?.bundleQty,
    item?.products?.bundle_qty,
    item?.products?.bundleQuantity,
    item?.products?.bundle_quantity,
    item?.products?.bundle,
    item?.products?.casePack,
    item?.products?.case_pack,
    0
  );
};

const getItemSelectedServices = (item = {}) => [
  ...new Set([
    ...getItemServices(item),
  ]),
];

const hasSelectedBundlingService = (item = {}) =>
  getItemSelectedServices(item).some(isBundlingServiceValue);

const shouldDisplayServiceTaskForItem = (service, item = {}) =>
  !isBundlingServiceValue(service) || hasSelectedBundlingService(item);

const STANDARD_SERVICE_KEYS = STANDARD_CATALOG_SERVICE_KEYS;

const isCustomServiceTask = (service = {}) => {
  const label = getServiceTaskLabel(service);
  if (!isDisplayServiceLabel(label)) return false;
  return isOtherServiceTask(service) || !STANDARD_SERVICE_KEYS.has(normalizeServiceKey(label));
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

  taskGroups.flatMap((group) => extractServiceTasks(group)).filter(Boolean).forEach((service, index) => {
    const serviceLabel = getServiceTaskLabel(service) || formatServiceLabel(service);
    const key = String(
      getServiceTaskId(service) ||
        `${getServiceTaskLineItemId(service)}-${getServiceTaskSku(service)}-${serviceLabel || index}`
    );

    if (!mergedTasks.has(key)) {
      mergedTasks.set(key, service);
    }
  });

  return [...mergedTasks.values()];
};

const hasServiceTaskShape = (task = {}) =>
  Boolean(
    task &&
      typeof task === 'object' &&
      (getServiceTaskId(task) ||
        task?.status !== undefined ||
        task?.taskStatus !== undefined ||
        task?.task_status !== undefined ||
        task?.serviceType ||
        task?.service_type ||
        task?.name ||
        task?.serviceName ||
        task?.service_name)
  );

const getUpdatedServiceTaskFromPayload = (payload = {}, taskId = '') => {
  const payloadTasks = extractServiceTasks(payload).filter((task) => task && typeof task === 'object');
  const matchedTask = payloadTasks.find(
    (task) => String(getServiceTaskId(task) || '') === String(taskId || '')
  );
  if (matchedTask) return matchedTask;

  const candidates = [
    payload?.serviceTask,
    payload?.service_task,
    payload?.task,
    payload?.service,
    payload?.data?.serviceTask,
    payload?.data?.service_task,
    payload?.data?.task,
    payload?.data?.service,
    payload?.data,
  ];

  return (
    candidates.find((task) => {
      if (!hasServiceTaskShape(task)) return false;
      const candidateTaskId = getServiceTaskId(task);
      return !taskId || !candidateTaskId || String(candidateTaskId) === String(taskId);
    }) || null
  );
};

const mergeServiceTaskUpdate = (service = {}, patchPayload = {}, responseTask = null) => {
  const taskPatch = responseTask && typeof responseTask === 'object' ? responseTask : {};
  const status = firstPresent(taskPatch.status, taskPatch.taskStatus, taskPatch.task_status, patchPayload.status);
  const unitsDone = firstPresent(taskPatch.unitsDone, taskPatch.units_done, patchPayload.unitsDone, patchPayload.units_done);
  const notes = firstPresent(taskPatch.notes, taskPatch.note, patchPayload.notes);

  return {
    ...service,
    ...taskPatch,
    ...(status !== ''
      ? {
          status,
          taskStatus: status,
          task_status: status,
        }
      : {}),
    ...(unitsDone !== ''
      ? {
          unitsDone,
          units_done: unitsDone,
        }
      : {}),
    ...(notes !== '' ? { notes } : {}),
  };
};

const getLineItemServiceTasks = (item = {}, serviceTasks = [], itemCount = 0) => {
  const lineItemIds = [
    getLineItemId(item),
    getShipmentLineItemId(item),
    item?.shipmentItemId,
    item?.shipment_item_id,
    item?.lineItemId,
    item?.line_item_id,
    item?.itemId,
    item?.item_id,
  ]
    .map((value) => String(value || '').trim())
    .filter(Boolean);
  const itemSku = String(getItemSku(item) || '').trim().toLowerCase();

  return toArray(serviceTasks).filter((service) => {
    const serviceLineItemId = String(getServiceTaskLineItemId(service) || '').trim();
    const serviceSku = String(getServiceTaskSku(service) || '').trim().toLowerCase();
    return (
      (serviceLineItemId && lineItemIds.includes(serviceLineItemId)) ||
      (itemSku && serviceSku && itemSku === serviceSku) ||
      (!serviceLineItemId && !serviceSku && (itemCount === 1 || (!lineItemIds.length && !itemSku)))
    );
  });
};

const getLineItemServiceTaskLabels = (item = {}, serviceTasks = [], itemCount = 0) => [
  ...new Set(
    getLineItemServiceTasks(item, serviceTasks, itemCount)
      .map((service) => getServiceTaskLabel(service))
      .filter((service) => isDisplayServiceLabel(service) && shouldDisplayServiceTaskForItem(service, item))
  ),
];

const getLineItemServices = (item = {}, _serviceTasks = [], _itemCount = 0) => [
  ...new Set(getItemSelectedServices(item)),
];

const getServiceTaskForLine = (serviceName, item, services, itemCount = 0) => {
  const serviceKey = normalizeServiceKey(serviceName);
  const lineItemIds = [
    getLineItemId(item),
    getShipmentLineItemId(item),
    item?.shipmentItemId,
    item?.shipment_item_id,
    item?.lineItemId,
    item?.line_item_id,
    item?.itemId,
    item?.item_id,
  ]
    .map((value) => String(value || '').trim())
    .filter(Boolean);
  const itemSku = String(getItemSku(item) || '').trim().toLowerCase();

  return toArray(services).find((service) => {
    const serviceLineItemId = String(getServiceTaskLineItemId(service) || '').trim();
    const serviceSku = String(getServiceTaskSku(service) || '').trim().toLowerCase();
    const serviceLabelKey = normalizeServiceKey(getServiceTaskLabel(service));
    const sameLineItem =
      (serviceLineItemId && lineItemIds.includes(serviceLineItemId)) ||
      (itemSku && serviceSku && itemSku === serviceSku) ||
      (!serviceLineItemId && !serviceSku && (itemCount === 1 || (!lineItemIds.length && !itemSku)));
    const sameType = Boolean(serviceKey && serviceLabelKey && (serviceLabelKey.includes(serviceKey) || serviceKey.includes(serviceLabelKey)));

    return sameLineItem && sameType;
  });
};

const findLineItemForServiceTask = (service = {}, items = []) => {
  const serviceLineItemId = String(getServiceTaskLineItemId(service) || '').trim();
  const serviceSku = String(getServiceTaskSku(service) || '').trim().toLowerCase();

  return (
    toArray(items).find((item) => {
      const itemId = String(getLineItemId(item) || '').trim();
      const itemSku = String(getItemSku(item) || '').trim().toLowerCase();

      return (
        (serviceLineItemId && itemId && serviceLineItemId === itemId) ||
        (serviceSku && itemSku && serviceSku === itemSku)
      );
    }) ||
    service?.lineItem ||
    service?.line_item ||
    service?.shipmentItem ||
    service?.shipment_item ||
    service?.item ||
    {}
  );
};

const getDiscrepancyId = (discrepancy) =>
  discrepancy?.id ||
  discrepancy?.uuid ||
  discrepancy?.discrepancyId ||
  discrepancy?.discrepancy_id ||
  '';

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
    discrepancy?.shipmentLineItemSku,
    discrepancy?.shipment_line_item_sku,
    discrepancy?.productSku,
    discrepancy?.product_sku
  );

const sameLineItem = (left = {}, right = {}) => {
  const leftId = String(getLineItemId(left) || '').trim();
  const rightId = String(getLineItemId(right) || '').trim();
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

const findLineItemForDiscrepancy = (discrepancy = {}, lineItems = [], fallbackIndex = -1) => {
  const discrepancyLineItem = getDiscrepancyLineItem(discrepancy);
  const discrepancyLineItemId = String(getDiscrepancyLineItemId(discrepancy) || getLineItemId(discrepancyLineItem) || '').trim();
  const discrepancySku = String(getDiscrepancySku(discrepancy) || '').trim().toLowerCase();

  return (
    lineItems.find((item) => {
      const itemId = String(getLineItemId(item) || '').trim();
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

const isDiscrepancyForItem = (discrepancy = {}, item = {}, lineItems = [], discrepancyIndex = -1) => {
  const lineItemId = getDiscrepancyLineItemId(discrepancy);
  const sku = getDiscrepancySku(discrepancy);

  if (lineItemId || sku) {
    const itemId = String(getLineItemId(item) || '').trim();
    const itemSku = String(getItemSku(item) || '').trim().toLowerCase();
    const referenceLineItemId = String(lineItemId || '').trim();
    const referenceSku = String(sku || '').trim().toLowerCase();

    return Boolean(
      (itemId && referenceLineItemId && itemId === referenceLineItemId) ||
        (itemSku && referenceSku && itemSku === referenceSku)
    );
  }

  if (lineItems.length === 1) return sameLineItem(item, lineItems[0]);

  const matchedLineItem = findLineItemForDiscrepancy(discrepancy, lineItems, discrepancyIndex);
  return sameLineItem(item, matchedLineItem);
};

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
    getItemExpectedQty(discrepancyLineItem),
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
  const discrepancyId = String(getDiscrepancyId(target?.discrepancy) || '').trim();

  const matchesTarget = (row = {}) => {
    const rowIds = [
      getDiscrepancyLineItemId(row),
      getLineItemId(getDiscrepancyLineItem(row)),
      getDiscrepancyId(row),
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

const firstPositiveQuantityValue = (...values) => {
  const positiveValue = values.find((value) => {
    const quantity = Number(value);
    return Number.isFinite(quantity) && quantity > 0;
  });

  return positiveValue === undefined ? firstPresent(...values, 0) : positiveValue;
};

const getServiceUnits = (service = {}, lineItem = {}) =>
  Number(
    firstPositiveQuantityValue(
      service?.receivedQty,
      service?.received_qty,
      service?.receivedQuantity,
      service?.received_quantity,
      getItemReceivedQty(service?.lineItem),
      getItemReceivedQty(service?.line_item),
      getItemReceivedQty(service?.shipmentItem),
      getItemReceivedQty(service?.shipment_item),
      getItemReceivedQty(service?.item),
      getItemReceivedQty(lineItem),
      service?.unitsRequired,
      service?.units_required,
      service?.requiredUnits,
      service?.required_units,
      service?.totalUnits,
      service?.total_units,
      service?.expectedUnits,
      service?.expected_units,
      service?.quantity,
      service?.expectedQty,
      service?.expected_qty,
      getItemExpectedQty(lineItem),
      service?.unitsDone,
      service?.units_done,
      0
    )
  );

const getFileUrl = (file = {}) =>
  file?.signedUrl ||
  file?.signed_url ||
  file?.signedURL ||
  file?.previewUrl ||
  file?.preview_url ||
  file?.url ||
  file?.fileUrl ||
  file?.file_url ||
  file?.publicUrl ||
  file?.public_url ||
  file?.publicURL ||
  file?.storageUrl ||
  file?.storage_url ||
  file?.secureUrl ||
  file?.secure_url ||
  file?.downloadUrl ||
  file?.download_url ||
  file?.downloadURL ||
  file?.href ||
  file?.src ||
  file?.storagePath ||
  file?.storage_path ||
  file?.filePath ||
  file?.file_path ||
  file?.path ||
  file?.location ||
  file?.metadata?.signedUrl ||
  file?.metadata?.signed_url ||
  file?.metadata?.url ||
  file?.metadata?.fileUrl ||
  file?.metadata?.file_url ||
  file?.metadata?.publicUrl ||
  file?.metadata?.public_url ||
  file?.metadata?.downloadUrl ||
  file?.metadata?.download_url ||
  file?.metadata?.storagePath ||
  file?.metadata?.storage_path ||
  file?.metadata?.filePath ||
  file?.metadata?.file_path ||
  file?.metadata?.path ||
  file?.meta?.signedUrl ||
  file?.meta?.signed_url ||
  file?.meta?.url ||
  file?.meta?.fileUrl ||
  file?.meta?.file_url ||
  file?.meta?.publicUrl ||
  file?.meta?.public_url ||
  file?.meta?.downloadUrl ||
  file?.meta?.download_url ||
  file?.meta?.storagePath ||
  file?.meta?.storage_path ||
  file?.meta?.filePath ||
  file?.meta?.file_path ||
  file?.meta?.path ||
  '';

const getFileName = (file = {}) =>
  file?.name ||
  file?.fileName ||
  file?.file_name ||
  file?.originalName ||
  file?.original_name ||
  file?.original_filename ||
  file?.storagePath ||
  file?.storage_path ||
  file?.path ||
  file?.url ||
  'label.pdf';

const cleanFileDisplayName = (value = 'label.pdf') => {
  const rawName = String(value || 'label.pdf').split('?')[0];
  const baseName = rawName.split(/[\\/]/).filter(Boolean).pop() || rawName;
  return baseName.replace(/^\d{10,}-+/, '') || baseName || 'label.pdf';
};

const getFileDisplayName = (file = {}) => cleanFileDisplayName(getFileName(file));

const getItemLabelFileName = (item = {}) =>
  firstPresent(
    item?.fileName,
    item?.file_name,
    item?.labelFileName,
    item?.label_file_name,
    item?.fnskuLabelFileName,
    item?.fnsku_label_file_name
  );

const getFileTypeValue = (file = {}) =>
  String(file?.fileType || file?.file_type || file?.type || file?.mimeType || file?.mime_type || '').toLowerCase();

const getFileEntityId = (file = {}) =>
  file?.entityId ||
  file?.entity_id ||
  file?.linkedEntityId ||
  file?.linked_entity_id ||
  file?.itemId ||
  file?.item_id ||
  file?.lineItemId ||
  file?.line_item_id ||
  file?.shipmentLineItemId ||
  file?.shipment_line_item_id ||
  file?.shipmentItemId ||
  file?.shipment_item_id ||
  file?.boxId ||
  file?.box_id ||
  file?.shipmentId ||
  file?.shipment_id ||
  '';

const getFileEntityType = (file = {}) => String(file?.entityType || file?.entity_type || file?.linkedEntityType || file?.linked_entity_type || '').trim().toLowerCase();

const normalizeEntityType = (value = '') => String(value || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '_');
const ITEM_FILE_ENTITY_TYPES = new Set(['item', 'shipment_item', 'shipmentitem', 'shipment_line_item', 'shipmentlineitem', 'line_item', 'lineitem']);
const isItemFileEntityType = (value = '') => ITEM_FILE_ENTITY_TYPES.has(normalizeEntityType(value));

const getFileRecordId = (file = {}) =>
  firstPresent(file?.id, file?.uuid, file?.fileId, file?.file_id);

const getFileSku = (file = {}) =>
  firstPresent(file?.sku, file?.sellerSku, file?.seller_sku, file?.metadata?.sku, file?.meta?.sku);

const getFileFnsku = (file = {}) =>
  firstPresent(file?.fnsku, file?.fnskuLabel, file?.fnsku_label, file?.metadata?.fnsku, file?.meta?.fnsku);

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

const getItemLabelRecordId = (item = {}) =>
  firstPresent(getShipmentLineItemId(item), getBoxAllocationLineItemId(item), getLineItemId(item));

const getItemLabelMatchIds = (item = {}) => [
  getShipmentLineItemId(item),
  getBoxAllocationLineItemId(item),
  item?.id,
  item?.uuid,
  item?.shipmentItemId,
  item?.shipment_item_id,
  item?.shipmentLineItemId,
  item?.shipment_line_item_id,
  item?.lineItemId,
  item?.line_item_id,
  item?.itemId,
  item?.item_id,
  item?.lineItem?.id,
  item?.lineItem?.uuid,
  item?.line_item?.id,
  item?.line_item?.uuid,
  item?.shipmentItem?.id,
  item?.shipmentItem?.uuid,
  item?.shipment_item?.id,
  item?.shipment_item?.uuid,
]
  .map((value) => String(value || '').trim())
  .filter(Boolean);

const getItemLabelEntityId = (item = {}) =>
  getItemLabelMatchIds(item)[0] || getItemLabelRecordId(item);

const normalizeItemFileMatchValue = (value = '') => {
  const normalized = String(value || '').trim().toLowerCase();
  return normalized && !['-', 'n/a', 'na', 'none', 'null', 'undefined'].includes(normalized) ? normalized : '';
};

const rawFileMatchesLineItem = (file = {}, item = {}) => mappedFileMatchesLineItem(file, item);

const isExactItemLabelFileMatch = (file = {}, item = {}) => {
  const itemLabelFileId = String(getItemLabelFileId(item) || '').trim();
  const fileRecordId = String(getFileRecordId(file) || '').trim();
  const fileEntityId = String(getFileEntityId(file) || '').trim();
  const fileEntityType = getFileEntityType(file);
  const linkedEntityId = String(file?.linkedEntityId || file?.linked_entity_id || '').trim();
  const linkedEntityType = String(file?.linkedEntityType || file?.linked_entity_type || '').trim().toLowerCase();
  const itemIds = getItemLabelMatchIds(item);

  return Boolean(
    (itemLabelFileId && fileRecordId && itemLabelFileId === fileRecordId) ||
      (isItemFileEntityType(fileEntityType) && fileEntityId && itemIds.includes(fileEntityId)) ||
      (isItemFileEntityType(linkedEntityType) && linkedEntityId && itemIds.includes(linkedEntityId))
  );
};

const hasFileShape = (file = {}) =>
  Boolean(
    file &&
      typeof file === 'object' &&
      !Array.isArray(file) &&
      (getFileUrl(file) ||
        getFileRecordId(file) ||
        file?.name ||
        file?.fileName ||
        file?.file_name ||
        file?.originalName ||
        file?.original_name ||
        file?.original_filename ||
        file?.storagePath ||
        file?.storage_path ||
        file?.filePath ||
        file?.file_path ||
        file?.path ||
        file?.mimeType ||
        file?.mime_type ||
        file?.contentType ||
        file?.content_type)
  );

const decorateItemLabelFile = (file = {}, item = {}) => {
  const itemId = getItemLabelEntityId(item);
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

const getBoxInlineFiles = (box = {}) => [
  ...extractList(box?.files, ['files']),
  ...extractList(box?.attachments, ['files']),
  ...extractList(box?.uploads, ['files']),
  ...extractList(box?.labels, ['files']),
  ...extractList(box?.fbaLabels, ['files']),
  ...extractList(box?.fba_labels, ['files']),
];

const isFbaLabelFile = (file = {}) => {
  const type = getFileTypeValue(file);
  const name = getFileName(file).toLowerCase();

  return (
    type === 'fba_shipping_label' ||
    type === 'fba_label' ||
    type.includes('fba') ||
    (type.includes('label') && !type.includes('fnsku')) ||
    name.includes('fba') ||
    name.includes('shipping-label') ||
    name.includes('shipping_label')
  );
};

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
    const entityId = String(getFileEntityId(file) || '').trim();
    const entityType = getFileEntityType(file);
    const fileRecordId = String(getFileRecordId(file) || '').trim();
    const sameLabelFile = labelFileId && fileRecordId === labelFileId;
    const sameBox =
      (entityId && boxLookupIds.includes(entityId)) ||
      boxLookupIds.some((boxId) => file?.boxId === boxId || file?.box_id === boxId) ||
      directFiles.includes(file);

    return sameLabelFile || (sameBox && (!entityType || entityType === 'box') && isFbaLabelFile(file));
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
      status === 'uploaded' ||
      status === 'label_ready' ||
      status === 'ready' ||
      getBoxFbaLabelFile(box, files)
  );
};

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
    file?.path
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

const mergeFileLists = (...fileLists) => {
  const merged = new Map();

  fileLists.flat().filter(Boolean).forEach((file, index) => {
    const key = getFileDedupeKey(file, index);
    const existingFile = merged.get(key);
    const shouldReplace =
      existingFile?.localPreview ||
      (!getFileUrl(existingFile) && getFileUrl(file)) ||
      (!existingFile?.signedUrl && !existingFile?.signed_url && (file?.signedUrl || file?.signed_url));

    if (!existingFile || shouldReplace) merged.set(key, file);
  });

  return [...merged.values()];
};

const extractFileRecords = (payload) => {
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
  const singleFile = candidates.find((file) =>
    file &&
      typeof file === 'object' &&
      !Array.isArray(file) &&
      (
        getFileUrl(file) ||
        getFileRecordId(file) ||
        file?.name ||
        file?.fileName ||
        file?.file_name ||
        file?.storagePath ||
        file?.storage_path
      )
  );

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
      const files = extractFileRecords(await parseResponse(response));
      if (files.length) return files;
    } catch {
      // File lookup routes vary between deployments.
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
    return extractFileRecords(await parseResponse(response));
  } catch {
    return [];
  }
};

const resolveFileUrl = (url = '') => {
  if (!url) return '';
  if (/^https?:\/\//i.test(url) || url.startsWith('blob:') || url.startsWith('data:')) return url;
  if (url.startsWith('/')) return `${API_BASE_URL}${url}`;
  return `${API_BASE_URL}/${url.replace(/^\/+/, '')}`;
};

const sanitizeFileName = (value = 'label') =>
  String(value || 'label')
    .replace(/[^a-z0-9._-]+/gi, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase() || 'label';

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
  anchor.click();
  URL.revokeObjectURL(url);
};

const openOrDownloadFile = (file) => {
  const url = resolveFileUrl(getFileUrl(file));
  if (!url) return false;

  window.open(url, '_blank', 'noopener,noreferrer');
  return true;
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

const isFbaBoxLabelFile = (file = {}) => {
  const type = getFileTypeValue(file);
  const entityType = getFileEntityType(file);

  return (
    type.includes('fba_shipping_label') ||
    type.includes('fba-shipping-label') ||
    type.includes('shipping_label') ||
    (entityType === 'box' && type.includes('label'))
  );
};

const isFnskuLabelFile = (file = {}) => {
  const type = getFileTypeValue(file);
  const name = getFileName(file).toLowerCase();
  const entityType = getFileEntityType(file);

  return !isFbaBoxLabelFile(file) && (type.includes('fnsku') || name.includes('fnsku') || (isItemFileEntityType(entityType) && (type.includes('label') || isPdfFile(file) || isImageFile(file) || isCsvFile(file))));
};

const isAnyItemLabelFile = (file = {}) => {
  const type = getFileTypeValue(file);
  const name = getFileName(file).toLowerCase();

  return !isFbaBoxLabelFile(file) && (isFnskuLabelFile(file) || type.includes('label') || name.includes('label') || isImageFile(file) || isCsvFile(file));
};

const getItemLabelCandidateFiles = (files = []) =>
  extractList(files, ['files']).filter((file) => {
    if (!getFileUrl(file) && !getFileName(file)) return false;
    const entityType = getFileEntityType(file);
    if (entityType === 'box' || isFbaBoxLabelFile(file)) return false;
    return isFnskuLabelFile(file) || isAnyItemLabelFile(file) || isImageFile(file) || isPdfFile(file) || isCsvFile(file);
  });

const getPreferredLabelFile = (files = []) =>
  files.find(isFnskuLabelFile) ||
  files.find(isAnyItemLabelFile) ||
  files.find(isImageFile) ||
  files.find(isCsvFile) ||
  files.find(isPdfFile) ||
  files[0] ||
  null;

const findLineItemLabelFile = (item, files) => {
  const candidateFiles = getItemLabelCandidateFiles(mergeFileLists(getItemInlineLabelFiles(item), files));
  const matchingFiles = candidateFiles.filter((file) => isExactItemLabelFileMatch(file, item));

  return getPreferredLabelFile(matchingFiles);
};

const normalizeFileMatchValue = (value = '') => {
  const normalized = String(value || '').trim().toLowerCase();
  return normalized && !['-', 'n/a', 'na', 'none', 'null', 'undefined'].includes(normalized) ? normalized : '';
};

const ShipmentDetail = () => {
  const { id } = useParams();
  const navigate = useNavigate();
  const [shipment, setShipment] = useState(null);
  const [services, setServices] = useState([]);
  const [discrepancies, setDiscrepancies] = useState([]);
  const [boxes, setBoxes] = useState([]);
  const [subShipments, setSubShipments] = useState([]);
  const [subShipmentAvailability, setSubShipmentAvailability] = useState([]);
  const [subShipmentBoxData, setSubShipmentBoxData] = useState({});
  const [showSubShipmentModal, setShowSubShipmentModal] = useState(false);
  const [subShipmentSelections, setSubShipmentSelections] = useState({});
  const [subShipmentNotes, setSubShipmentNotes] = useState('');
  const [isCreatingSubShipment, setIsCreatingSubShipment] = useState(false);
  const [isRefreshingSubShipmentAvailability, setIsRefreshingSubShipmentAvailability] = useState(false);
  const [activeSubShipmentIdForBox, setActiveSubShipmentIdForBox] = useState('');
  const [files, setFiles] = useState([]);
  const [statusValue, setStatusValue] = useState('pending_arrival');
  const [staffId, setStaffId] = useState('');
  const [staffMembers, setStaffMembers] = useState([]);
  const [isStaffLoading, setIsStaffLoading] = useState(false);
  const [bulkServiceType, setBulkServiceType] = useState('fnsku_label');
  const [bulkStatus, setBulkStatus] = useState('IN_PROGRESS');
  const [customServiceLineItemId, setCustomServiceLineItemId] = useState('');
  const [customServiceName, setCustomServiceName] = useState('');
  const [customServicePrice, setCustomServicePrice] = useState('');
  const [customServiceStatusLineItemId, setCustomServiceStatusLineItemId] = useState('');
  const [customServiceStatusName, setCustomServiceStatusName] = useState('');
  const [customServiceStatusValue, setCustomServiceStatusValue] = useState('DONE');
  const [discrepancyResolveTarget, setDiscrepancyResolveTarget] = useState(null);
  const [discrepancyResolveError, setDiscrepancyResolveError] = useState('');
  const [isResolvingDiscrepancy, setIsResolvingDiscrepancy] = useState(false);
  const [taskId, setTaskId] = useState('');
  const [taskStatus, setTaskStatus] = useState('IN_PROGRESS');
  const [taskUnitsDone, setTaskUnitsDone] = useState('');
  const [taskNotes, setTaskNotes] = useState('');
  const [boxType, setBoxType] = useState('box');
  const [boxSize, setBoxSize] = useState('medium');
  const [boxWeight, setBoxWeight] = useState('');
  const [boxLength, setBoxLength] = useState('');
  const [boxWidth, setBoxWidth] = useState('');
  const [boxHeight, setBoxHeight] = useState('');
  const [boxNumber, setBoxNumber] = useState('');
  const [palletNumber, setPalletNumber] = useState('');
  const [sealBoxId, setSealBoxId] = useState('');
  const [sealTrackingCode, setSealTrackingCode] = useState('');
  const [deleteBoxId, setDeleteBoxId] = useState('');
  const [addToBoxBoxId, setAddToBoxBoxId] = useState('');
  const [addToBoxLineItemId, setAddToBoxLineItemId] = useState('');
  const [addToBoxQuantity, setAddToBoxQuantity] = useState('');
  const [removeFromBoxBoxId, setRemoveFromBoxBoxId] = useState('');
  const [removeFromBoxItemId, setRemoveFromBoxItemId] = useState('');
  const [fileEntityType, setFileEntityType] = useState('shipment');
  const [fileEntityId, setFileEntityId] = useState('');
  const [fileType, setFileType] = useState('other');
  const [selectedFile, setSelectedFile] = useState(null);
  const [uploadingBoxLabelId, setUploadingBoxLabelId] = useState('');
  const [showPrepTimeModal, setShowPrepTimeModal] = useState(false);
  const [showAddBoxModal, setShowAddBoxModal] = useState(false);
  const [prepStartTime, setPrepStartTime] = useState('11:25');
  const [prepEndTime, setPrepEndTime] = useState('11:50');
  const [boxSkuPreview, setBoxSkuPreview] = useState('');
  const [boxSkuQuantityPreview, setBoxSkuQuantityPreview] = useState('');
  const [boxSkuExtraRows, setBoxSkuExtraRows] = useState([]);
  const [selectedPalletBoxIds, setSelectedPalletBoxIds] = useState([]);
  const [hazmatEnabled, setHazmatEnabled] = useState(true);
  const [trackExpiryDates, setTrackExpiryDates] = useState(true);
  const [trackLotNumbers, setTrackLotNumbers] = useState(true);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [dispatchConfirm, setDispatchConfirm] = useState(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isCreatingBox, setIsCreatingBox] = useState(false);
  const [updatingTaskId, setUpdatingTaskId] = useState('');
  const [invoiceActionKey, setInvoiceActionKey] = useState('');

  useEffect(() => {
    if (message) showToast('success', message);
  }, [message]);

  useEffect(() => {
    if (error) showToast('error', error);
  }, [error]);

  const staffOptions = useMemo(() => {
    const seenStaffIds = new Set();

    return staffMembers
      .filter((user) => String(user?.role || '').toLowerCase() === 'staff')
      .filter((user) => user?.active !== false && user?.isActive !== false && user?.is_active !== false)
      .map((user) => {
        const id = getUserId(user);

        if (!id || seenStaffIds.has(id)) return null;
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
  const lineItems = sortLineItemsForDisplay(applyBundleMetadataFromNotes(getLineItems(shipment), shipment));
  const activeSubShipmentForBox = activeSubShipmentIdForBox
    ? subShipments.find((subShipment) => getSubShipmentId(subShipment) === activeSubShipmentIdForBox) || null
    : null;
  const activeSubShipmentBoxData = activeSubShipmentIdForBox ? subShipmentBoxData[activeSubShipmentIdForBox] || {} : {};
  const getSubShipmentReservedQuantityForLineItem = (lineItem = {}) =>
    subShipments.reduce((total, subShipment) => {
      if (getSubShipmentStatus(subShipment) === 'cancelled') return total;

      const subShipmentId = getSubShipmentId(subShipment);
      const boxData = subShipmentId ? subShipmentBoxData[subShipmentId] || {} : {};
      const matchedSubShipmentLine = getSubShipmentLineItemsForBoxing(subShipment, boxData, lineItems)
        .find((subShipmentLineItem) => isSameLineItemForAllocation(subShipmentLineItem, lineItem));
      const plannedQty = Number(
        firstPresent(
          matchedSubShipmentLine?.__subShipmentPlannedQty,
          matchedSubShipmentLine?.quantity,
          matchedSubShipmentLine?.qty,
          0
        ) || 0
      );

      return total + (Number.isFinite(plannedQty) ? Math.max(0, plannedQty) : 0);
    }, 0);
  const parentBoxSelectionLineItems = lineItems.map((lineItem) => {
    const reservedQty = getSubShipmentReservedQuantityForLineItem(lineItem);
    const parentBoxableQty = Math.max(0, getLineItemBoxableQuantity(lineItem) - reservedQty);

    return {
      ...lineItem,
      __parentShipmentReservedQty: reservedQty,
      __parentShipmentBoxableQty: parentBoxableQty,
    };
  });
  const boxSelectionLineItems = activeSubShipmentForBox
    ? getSubShipmentLineItemsForBoxing(activeSubShipmentForBox, activeSubShipmentBoxData, lineItems)
    : parentBoxSelectionLineItems;
  const shipmentPackageRows = getVisiblePackageRowsWithPalletChildren(boxes);
  const subShipmentScopedBoxKeys = new Set(
    subShipments.flatMap((subShipment) => {
      const subShipmentId = getSubShipmentId(subShipment);
      const boxData = subShipmentId ? subShipmentBoxData[subShipmentId] || {} : {};
      const subShipmentPackageRows = getVisiblePackageRowsWithPalletChildren(
        getSubShipmentBoxRows(subShipment, boxData).map((box) => decorateSubShipmentBoxForScope(box, subShipment)),
        (childBox) => decorateSubShipmentBoxForScope(childBox, subShipment)
      );

      return subShipmentPackageRows
        .flatMap(getBoxScopeKeys);
    })
  );
  const parentShipmentBoxes = shipmentPackageRows.filter((box, index) => {
    const boxKeys = getBoxScopeKeys(box);
    return isParentShipmentBox(box) && (!boxKeys.length || !boxKeys.some((boxKey) => subShipmentScopedBoxKeys.has(boxKey)));
  });
  const boxSelectionBoxes = activeSubShipmentForBox
    ? getSubShipmentBoxRows(activeSubShipmentForBox, activeSubShipmentBoxData)
    : parentShipmentBoxes;
  const isBoxLinkedToLineItem = (box = {}, item = {}, boxIndex = -1) => {
    const itemIds = getItemLabelMatchIds(item);
    const itemSku = normalizeAllocationSku(getItemSku(item));
    const boxItems = getShipmentScopedBoxItems(getBoxItems(box), lineItems);
    const directLineItemId = String(getBoxItemLineItemId(box) || '').trim();
    const directSku = normalizeAllocationSku(getBoxItemSku(box));
    const boxDisplaySkus = getBoxDisplaySkuValues(box);

    if ((directLineItemId && itemIds.includes(directLineItemId)) || (itemSku && directSku && skuValuesMatch(itemSku, directSku))) {
      return true;
    }

    if (boxItems.some((boxItem) => isSameBoxLineItem(boxItem, item))) return true;
    if (itemSku && boxDisplaySkus.includes(itemSku)) return true;

    const fallbackLineItem = getFallbackLineItemForBoxIndex(boxIndex, lineItems);
    return Boolean(!boxItems.length && fallbackLineItem && isSameLineItemForAllocation(fallbackLineItem, item));
  };
  const getOutboundPackagesForLineItem = (item) =>
    getLineItemOutboundPackageGroups({
      item,
      boxes: shipmentPackageRows,
      lineItems,
      isBoxLinkedToItem: (box, currentItem, boxIndex) => isBoxLinkedToLineItem(box, currentItem, boxIndex),
      getPalletChildBoxes,
      isPalletBox,
      getBoxKey: (box, boxIndex) => String(getBoxRecordId(box) || getBoxId(box) || getBoxPalletLabel(box, boxIndex) || boxIndex),
    });
  const renderLineItemOutboundPackageCard = (box = {}, boxIndex = 0) => {
    const isPallet = isPalletBox(box);
    const palletChildren = getPalletChildBoxes(box);
    const boxDimensions = getBoxDimensions(box);
    const boxWeight = getBoxWeight(box);
    const labelState = getBoxLabelState(box, files);
    const labelText = isPallet
      ? labelState.label === 'Label Ready' || labelState.label === 'FBA Label Ready'
        ? 'Pallet Label Ready'
        : 'Pallet Label Missing'
      : labelState.label;

    return (
      <div key={getBoxRecordId(box) || getBoxId(box) || boxIndex} className="rounded-md border border-[#dbe5f3] bg-white px-3 py-3">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <p className="font-semibold text-[#132347]">{getBoxPalletLabel(box, boxIndex)}</p>
              {isPallet ? (
                <span className="rounded-full bg-[#fff7ed] px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-[#d76000]">
                  Pallet
                </span>
              ) : getBoxSize(box) ? (
                <span className="rounded-full bg-[#f3f6fb] px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-[#60708b]">
                  {getBoxSize(box)}
                </span>
              ) : null}
            </div>
            <p className="mt-1 text-xs text-[#64748b]">
              {isPallet
                ? [boxDimensions, boxWeight ? `${boxWeight} kg` : '', `${palletChildren.length} box${palletChildren.length !== 1 ? 'es' : ''}`].filter(Boolean).join(' - ') || 'No pallet details'
                : [boxDimensions, boxWeight ? `${boxWeight} kg` : '', getBoxSkuSummary(box, files, lineItems)].filter(Boolean).join(' - ') || 'No box details'}
            </p>
          </div>
          <span className={`w-fit rounded-full px-2.5 py-1 text-xs font-semibold ${labelState.className}`}>
            {labelText}
          </span>
        </div>

        {isPallet ? (
          <div className="mt-3 rounded-md border border-[#e4ecf8] bg-[#f8fbff] p-3">
            <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
              <p className="text-[10px] font-semibold uppercase tracking-wide text-[#60708b]">Boxes in pallet</p>
              <span className="rounded-full bg-white px-2 py-0.5 text-[10px] font-semibold text-[#60708b]">
                {palletChildren.length} box{palletChildren.length !== 1 ? 'es' : ''}
              </span>
            </div>
            {palletChildren.length ? (
              <div className="space-y-2">
                {palletChildren.map((childBox, childIndex) => {
                  const childDimensions = getBoxDimensions(childBox);
                  const childWeight = getBoxWeight(childBox);
                  const childSkuSummary = getBoxSkuSummary(childBox, files, lineItems);
                  const childLabelUploaded = isBoxFbaLabelUploaded(childBox, files);

                  return (
                    <div key={getBoxRecordId(childBox) || getBoxId(childBox) || childIndex} className="rounded-md border border-[#dbe5f3] bg-white px-2.5 py-2">
                      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                        <div className="min-w-0">
                          <p className="truncate text-xs font-semibold text-[#132347]">{getBoxTitle(childBox, childIndex)}</p>
                          <p className="text-[11px] text-[#64748b]">
                            {[childDimensions, childWeight ? `${childWeight} kg` : '', childSkuSummary].filter(Boolean).join(' - ') || 'No child box details'}
                          </p>
                        </div>
                        <span className={`w-fit rounded-full px-2 py-0.5 text-[10px] font-semibold ${childLabelUploaded ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-600'}`}>
                          {childLabelUploaded ? 'FBA ready' : 'FBA missing'}
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <p className="rounded-md border border-dashed border-[#dbe5f3] bg-white px-2.5 py-2 text-xs text-[#64748b]">No child boxes returned for this pallet.</p>
            )}
          </div>
        ) : null}
      </div>
    );
  };

  const renderShipmentPackageCard = (box = {}, boxIndex = 0, options = {}) => {
    const imageUrl = getBoxImageUrl(box, files);
    const boxRecordId = getBoxRecordId(box);
    const boxId = boxRecordId || getBoxId(box);
    const isPallet = isPalletBox(box);
    const insidePallet = isBoxInsidePallet(box);
    const palletChildren = getPalletChildBoxes(box);
    const labelState = getBoxLabelState(box, files);
    const labelUploaded = isBoxFbaLabelUploaded(box, files);
    const labelReady = labelUploaded || labelState.label === 'Label Ready' || labelState.label === 'FBA Label Ready';
    const needsLabel = !labelReady;
    const fbaUploadKey = `fba-${boxId || boxIndex}`;
    const isUploadingFbaLabel = uploadingBoxLabelId === fbaUploadKey;
    const boxDimensions = getBoxDimensions(box);
    const boxWeight = getBoxWeight(box);
    const fallbackLineItem = lineItems.length === 1
      ? lineItems[0]
      : lineItems[Math.min(boxIndex, Math.max(lineItems.length - 1, 0))];
    const boxUnits = firstPresent(getBoxUnits(box, lineItems), getItemExpectedQty(fallbackLineItem || {}), '');
    const contextStatus = String(firstPresent(options.shipmentStatus, currentStatus) || '').trim().toLowerCase();
    const boxStatus = getBoxDisplayStatus(box, contextStatus);
    const boxSku = firstPresent(getBoxSkuValue(box, files, lineItems), getItemSku(fallbackLineItem || {}));
    const skuSummary = firstPresent(
      getBoxSkuSummary(box, files, lineItems),
      boxSku && boxUnits !== '' ? `${formatQuantityValue(boxUnits)} UNITS (${boxSku})` : boxSku
    );
    const boxDispatchComplete = ['dispatched', 'sealed', 'completed', 'complete'].includes(
      String(firstPresent(box?.status, box?.boxStatus, box?.box_status, box?.dispatchStatus, box?.dispatch_status, '')).toLowerCase()
    ) || Boolean(box?.dispatched_at || box?.dispatchedAt);
    const contextDispatchedOrCompleted = ['dispatched', 'completed', 'complete'].includes(contextStatus);
    const dispatchComplete = boxDispatchComplete || contextDispatchedOrCompleted;
    const canDispatchPackage = options.canDispatchBoxes !== false;
    const palletLabelText = needsLabel ? 'Pallet FBA label missing' : 'Pallet FBA label uploaded';
    const parentPalletId = String(getBoxPalletId(box) || '').trim();
    const packageRows = toArray(options.packageRows);
    const parentPalletIndex = parentPalletId
      ? packageRows.findIndex((packageBox) => {
          if (!isPalletBox(packageBox)) return false;
          const candidateIds = [getBoxRecordId(packageBox), getBoxId(packageBox)]
            .map((value) => String(value || '').trim())
            .filter(Boolean);
          return candidateIds.includes(parentPalletId);
        })
      : -1;
    const parentPallet = parentPalletIndex >= 0 ? packageRows[parentPalletIndex] : null;
    const insidePalletLabel = parentPallet ? getBoxPalletLabel(parentPallet, parentPalletIndex) : getBoxParentPalletLabel(box);

    return (
      <div key={boxId || boxIndex} className={`overflow-hidden rounded-lg border bg-white shadow-sm transition hover:border-[#c8d5e8] hover:shadow-md ${
        needsLabel ? 'border-[#ffc9c9]' : 'border-[#dbe5f3]'
      }`}>
        <div className={`h-1 ${needsLabel ? 'bg-[#ff7a7a]' : 'bg-[#22c55e]'}`} />
        <div className="p-4">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
            <div className="flex min-w-0 items-start gap-3">
              <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-sm font-semibold ${
                needsLabel ? 'bg-red-50 text-red-600' : 'bg-emerald-50 text-emerald-700'
              }`}>
                {boxIndex + 1}
              </div>
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="truncate text-[15px] font-semibold text-[#132347]">{getBoxPalletLabel(box, boxIndex)}</p>
                  <span className="rounded-full bg-[#f3f6fb] px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wide text-[#60708b]">
                    {isPallet ? 'Pallet' : getBoxSize(box)}
                  </span>
                  {insidePallet ? (
                    <span className="rounded-full bg-blue-50 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wide text-blue-700">
                      Inside pallet {insidePalletLabel}
                    </span>
                  ) : null}
                </div>
                <p className="mt-1 text-[12px] font-medium text-[#6b7a93]">
                  {isPallet
                    ? [boxDimensions, boxWeight ? `${boxWeight} KG` : '', `${palletChildren.length} box${palletChildren.length !== 1 ? 'es' : ''}`].filter(Boolean).join(' - ') || 'No pallet details'
                    : [boxDimensions, boxWeight ? `${boxWeight} KG` : '', skuSummary].filter(Boolean).join(' - ') || 'No box details'}
                </p>
                {isPallet ? (
                  <p className="mt-1 text-[12px] text-[#6b7a93]">{palletLabelText}</p>
                ) : null}
              </div>
            </div>
            <span className={`w-fit rounded-full px-3 py-1.5 text-[11px] font-semibold ${labelState.className}`}>
              {isPallet ? (needsLabel ? 'Pallet Label Missing' : 'Pallet Label Ready') : labelState.label}
            </span>
          </div>

          {isPallet ? (
            <>
              <div className="mt-4 grid grid-cols-2 gap-x-4 gap-y-3 border-t border-[#edf2f8] pt-4 text-[12px] text-[#132347] sm:grid-cols-4">
                <div>
                  <p className="text-[10px] font-semibold uppercase tracking-wide text-[#7f8ea6]">Status</p>
                  <p className="mt-1 font-medium">{boxStatus}</p>
                </div>
                <div>
                  <p className="text-[10px] font-semibold uppercase tracking-wide text-[#7f8ea6]">Pallet Weight</p>
                  <p className="mt-1 font-medium">{boxWeight ? `${boxWeight} kg` : '-'}</p>
                </div>
                <div>
                  <p className="text-[10px] font-semibold uppercase tracking-wide text-[#7f8ea6]">Pallet Dimensions</p>
                  <p className="mt-1 font-medium">{boxDimensions || '-'}</p>
                </div>
                <div>
                  <p className="text-[10px] font-semibold uppercase tracking-wide text-[#7f8ea6]">Boxes Inside</p>
                  <p className="mt-1 font-medium">{palletChildren.length}</p>
                </div>
              </div>
              <div className="mt-4 rounded-lg border border-[#edf2f8] bg-[#f8fbff] p-3">
                <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-[#60708b]">Boxes in this pallet</p>
                  <span className="rounded-full bg-white px-2.5 py-1 text-[10px] font-semibold text-[#60708b]">
                    {palletChildren.length} box{palletChildren.length !== 1 ? 'es' : ''}
                  </span>
                </div>
                {palletChildren.length ? (
                  <div className="space-y-2">
                    {palletChildren.map((childBox, childIndex) => {
                      const childDimensions = getBoxDimensions(childBox);
                      const childWeight = getBoxWeight(childBox);
                      const childSkuSummary = getBoxSkuSummary(childBox, files, lineItems);
                      const childLabelUploaded = isBoxFbaLabelUploaded(childBox, files);

                      return (
                        <div key={getBoxRecordId(childBox) || getBoxId(childBox) || childIndex} className="rounded-md border border-[#dbe5f3] bg-white px-3 py-2">
                          <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                            <div className="min-w-0">
                              <p className="truncate text-xs font-semibold text-[#132347]">{getBoxTitle(childBox, childIndex)}</p>
                              <p className="mt-0.5 text-[11px] text-[#64748b]">
                                {[childDimensions, childWeight ? `${childWeight} kg` : '', childSkuSummary].filter(Boolean).join(' - ') || 'No child box details'}
                              </p>
                            </div>
                            <span className={`w-fit rounded-full px-2 py-0.5 text-[10px] font-semibold ${childLabelUploaded ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-600'}`}>
                              {childLabelUploaded ? 'FBA label ready' : 'FBA label missing'}
                            </span>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <p className="rounded-md border border-dashed border-[#dbe5f3] bg-white px-3 py-3 text-xs text-[#64748b]">No child boxes returned for this pallet.</p>
                )}
              </div>
            </>
          ) : (
            <div className="mt-4 grid grid-cols-2 gap-x-4 gap-y-3 border-t border-[#edf2f8] pt-4 text-[12px] text-[#132347] sm:grid-cols-5">
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-wide text-[#7f8ea6]">Status</p>
                <p className="mt-1 font-medium">{boxStatus}</p>
              </div>
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-wide text-[#7f8ea6]">Weight</p>
                <p className="mt-1 font-medium">{boxWeight ? `${boxWeight} kg` : '-'}</p>
              </div>
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-wide text-[#7f8ea6]">Dimensions</p>
                <p className="mt-1 font-medium">{boxDimensions || '-'}</p>
              </div>
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-wide text-[#7f8ea6]">Units</p>
                <p className={`mt-1 font-medium ${boxUnits !== '' ? '' : 'text-red-600'}`}>
                  {boxUnits !== '' ? boxUnits : '-'}
                </p>
              </div>
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-wide text-[#7f8ea6]">SKU</p>
                <p className={`mt-1 break-words font-medium ${boxSku ? '' : 'text-red-600'}`}>
                  {boxSku || 'SKU not allocated'}
                </p>
              </div>
            </div>
          )}

          <div className="mt-4 flex flex-wrap gap-2">
            {labelUploaded ? (
              <button
                type="button"
                onClick={() => handleBoxFbaLabel(box, boxIndex)}
                className="rounded-[4px] bg-[#132347] px-3 py-2 text-[11px] font-semibold text-white hover:bg-[#0f1b38]"
              >
                FBA Label
              </button>
            ) : (
              <label className={`rounded-[4px] bg-[#ff9d3a] px-3 py-2 text-[11px] font-semibold text-white hover:bg-[#f28a18] ${isUploadingFbaLabel || !boxRecordId ? 'pointer-events-none opacity-60' : 'cursor-pointer'}`}>
                {isUploadingFbaLabel ? 'Uploading...' : isPallet ? 'Upload Pallet Label' : 'Upload FBA Label'}
                <input
                  type="file"
                  accept=".pdf,image/*"
                  className="hidden"
                  disabled={!boxRecordId || isUploadingFbaLabel}
                  onChange={(event) => {
                    const file = event.target.files?.[0] || null;
                    event.target.value = '';
                    handleUploadBoxFbaLabel(box, boxIndex, file);
                  }}
                />
              </label>
            )}
            <button
              type="button"
              onClick={dispatchComplete || insidePallet || (!labelUploaded && !isPallet) ? undefined : () => handleMarkBoxDispatched(box)}
              disabled={!canDispatchPackage || dispatchComplete || insidePallet || (!labelUploaded && !isPallet) || !boxRecordId}
              className={`rounded-[4px] px-3 py-2 text-[11px] font-semibold text-white disabled:cursor-not-allowed ${
                dispatchComplete
                  ? 'bg-emerald-600 disabled:opacity-100'
                  : 'bg-[#ff9d20] hover:bg-[#f28a18] disabled:opacity-60'
              }`}
            >
              {dispatchComplete ? 'Dispatched' : insidePallet ? 'Inside Pallet' : 'Mark Dispatched'}
            </button>
          </div>

          {imageUrl ? (
            <button type="button" onClick={() => window.open(imageUrl, '_blank', 'noopener,noreferrer')} className="mt-4 block w-full overflow-hidden rounded-[4px] border border-[#dbe4f1] bg-[#f7f9fc]">
              <img src={imageUrl} alt={getBoxTitle(box, boxIndex)} className="h-32 w-full object-contain" />
            </button>
          ) : null}
        </div>
      </div>
    );
  };

  const getEligiblePalletBoxesFromRows = (boxRows = []) => boxRows.filter((box) => {
    const boxId = getBoxRecordId(box) || getBoxId(box);
    return (
      boxId &&
      getBoxTypeValue(box) === 'box' &&
      isBoxFbaLabelUploaded(box, files) &&
      !getBoxPalletId(box) &&
      !isBoxInsidePallet(box) &&
      !isBoxDispatchedStatus(box)
    );
  });
  const eligiblePalletBoxes = getEligiblePalletBoxesFromRows(boxSelectionBoxes);
  const selectedPalletBoxes = eligiblePalletBoxes.filter((box) =>
    selectedPalletBoxIds.includes(getBoxRecordId(box) || getBoxId(box))
  );
  const togglePalletBoxSelection = (boxId = '') => {
    const normalizedBoxId = String(boxId || '').trim();
    if (!normalizedBoxId) return;

    setSelectedPalletBoxIds((currentIds) =>
      currentIds.includes(normalizedBoxId)
        ? currentIds.filter((currentId) => currentId !== normalizedBoxId)
        : [...currentIds, normalizedBoxId]
    );
  };
  const getSubShipmentBoxableQuantity = (subShipment = {}, boxData = {}) => {
    const subShipmentLineItems = getSubShipmentLineItemsForBoxing(subShipment, boxData, lineItems);
    const subShipmentBoxes = getSubShipmentBoxRows(subShipment, boxData);

    return subShipmentLineItems.reduce(
      (total, item) => total + getLineItemAllocatableQuantity(item, subShipmentBoxes, subShipmentLineItems),
      0
    );
  };
  const findLineItemBySelection = (selectedValue = '') => {
    const normalizedSelection = String(selectedValue || '').trim();
    if (!normalizedSelection) return null;

    return boxSelectionLineItems.find((item) => {
      const optionValue = getLineItemOptionValue(item);
      const itemId = String(getLineItemId(item) || '').trim();
      const itemSku = String(getItemSku(item) || '').trim();
      return [optionValue, itemId, itemSku].filter(Boolean).includes(normalizedSelection);
    }) || null;
  };
  const selectedBoxLineItem = findLineItemBySelection(boxSkuPreview);
  const selectedAddToBoxLineItem = findLineItemBySelection(addToBoxLineItemId);
  const selectedBoxBoxableQty = selectedBoxLineItem ? getLineItemBoxableQuantity(selectedBoxLineItem) : 0;
  const selectedBoxAllocatedQty = selectedBoxLineItem
    ? activeSubShipmentForBox
      ? Number(selectedBoxLineItem.__subShipmentAllocatedQty || 0)
      : getAllocatedQuantityForLineItem(selectedBoxLineItem, boxSelectionBoxes, boxSelectionLineItems)
    : 0;
  const selectedBoxMaxQuantity = selectedBoxLineItem ? getLineItemAllocatableQuantity(selectedBoxLineItem, boxSelectionBoxes, boxSelectionLineItems) : 0;
  const selectedAddToBoxMaxQuantity = selectedAddToBoxLineItem ? getLineItemAllocatableQuantity(selectedAddToBoxLineItem, boxSelectionBoxes, boxSelectionLineItems) : 0;
  const boxSkuSelectionRows = [
    { lineItemValue: boxSkuPreview, quantity: boxSkuQuantityPreview },
    ...boxSkuExtraRows,
  ];
  const resetAddBoxSkuSelection = () => {
    setBoxSkuPreview('');
    setBoxSkuQuantityPreview('');
    setBoxSkuExtraRows([]);
  };
  const handleBoxSkuPreviewChange = (value) => {
    const selectedValue = String(value || '').trim();
    const nextLineItem = findLineItemBySelection(selectedValue);
    const nextMaxQuantity = nextLineItem ? getLineItemAllocatableQuantity(nextLineItem, boxSelectionBoxes, boxSelectionLineItems) : 0;

    setBoxSkuPreview(selectedValue);
    setBoxSkuQuantityPreview(nextMaxQuantity > 0 ? String(nextMaxQuantity) : '');
  };
  const handleBoxSkuQuantityPreviewChange = (value) => {
    setBoxSkuQuantityPreview(clampAllocationQuantity(value, selectedBoxMaxQuantity));
  };
  const isBoxSkuOptionSelectedElsewhere = (optionValue = '', rowIndex = 0) => {
    const normalizedOption = String(optionValue || '').trim();
    if (!normalizedOption) return false;

    return boxSkuSelectionRows.some((row, index) =>
      index !== rowIndex && String(row?.lineItemValue || '').trim() === normalizedOption
    );
  };
  const handleAddBoxSkuRow = () => {
    setBoxSkuExtraRows((currentRows) => [...currentRows, { lineItemValue: '', quantity: '' }]);
  };
  const handleRemoveBoxSkuRow = (index) => {
    setBoxSkuExtraRows((currentRows) => currentRows.filter((_, currentIndex) => currentIndex !== index));
  };
  const handleBoxSkuExtraRowChange = (index, field, value) => {
    setBoxSkuExtraRows((currentRows) =>
      currentRows.map((row, currentIndex) => {
        if (currentIndex !== index) return row;

        if (field === 'lineItemValue') {
          const selectedValue = String(value || '').trim();
          const nextLineItem = findLineItemBySelection(selectedValue);
          const nextMaxQuantity = nextLineItem ? getLineItemAllocatableQuantity(nextLineItem, boxSelectionBoxes, boxSelectionLineItems) : 0;
          return {
            lineItemValue: selectedValue,
            quantity: nextMaxQuantity > 0 ? String(nextMaxQuantity) : '',
          };
        }

        const rowLineItem = findLineItemBySelection(row.lineItemValue);
        const rowMaxQuantity = rowLineItem ? getLineItemAllocatableQuantity(rowLineItem, boxSelectionBoxes, boxSelectionLineItems) : 0;
        return {
          ...row,
          quantity: clampAllocationQuantity(value, rowMaxQuantity),
        };
      })
    );
  };
  const serviceTasks = extractServiceTasks(services).map((service, index) => {
    const task = service && typeof service === 'object' ? service : { name: service };
    const displayId = getServiceTaskId(task) || getServiceTaskLineItemId(task) || getServiceTaskSku(task) || getServiceTaskLabel(task) || 'task';
    return {
      ...task,
      displayId: `${displayId}-${index}`,
    };
  });
  const isSelectedServiceTaskForDisplay = (service = {}, items = lineItems) => {
    const serviceKey = normalizeServiceKey(getServiceTaskLabel(service));
    if (!serviceKey) return false;

    const itemList = toArray(items);
    const matchedItems = itemList.filter((item) => getLineItemServiceTasks(item, [service], itemList.length).length > 0);
    const candidateItems = matchedItems.length ? matchedItems : itemList;

    return candidateItems.some((item) =>
      getLineItemServices(item, [], itemList.length).some((serviceName) => normalizeServiceKey(serviceName) === serviceKey)
    );
  };
  const visibleServiceTasks = serviceTasks.filter((service) => {
    if (!isSelectedServiceTaskForDisplay(service, lineItems)) return false;
    if (!isBundlingServiceValue(service)) return true;

    const matchedItem = findLineItemForServiceTask(service, lineItems);
    if (matchedItem && Object.keys(matchedItem).length) {
      return shouldDisplayServiceTaskForItem(service, matchedItem);
    }

    return lineItems.some((item) => shouldDisplayServiceTaskForItem(service, item));
  });
  const customServices = extractCustomServices(shipment, serviceTasks);
  const isDoneServiceStatus = (status = '') =>
    ['DONE', 'COMPLETED', 'COMPLETE'].includes(String(status || '').toUpperCase());

  const getServiceTasksWithPatch = (taskIdToPatch = '', patchPayload = {}, taskList = serviceTasks) =>
    toArray(taskList).map((service) => {
      if (String(getServiceTaskId(service) || '') !== String(taskIdToPatch || '')) {
        return service;
      }

      return {
        ...service,
        status: patchPayload.status,
        taskStatus: patchPayload.status,
        task_status: patchPayload.status,
        ...(patchPayload.unitsDone !== undefined
          ? {
              unitsDone: patchPayload.unitsDone,
              units_done: patchPayload.unitsDone,
            }
          : {}),
      };
    });

  const areDisplayedServicesDoneForItem = (item = {}, nextServiceTasks = [], itemList = lineItems) => {
    const itemCount = itemList.length;
    const displayedServices = getLineItemServices(item, nextServiceTasks, itemCount);
    if (!displayedServices.length) return false;

    return displayedServices.every(
      (serviceName) => getServiceDisplayStatus(serviceName, item, nextServiceTasks, itemCount) === 'Done'
    );
  };

  const isTaskForLineItem = (service = {}, item = {}, itemCount = 0) =>
    getLineItemServiceTasks(item, [service], itemCount).length > 0;

  const getHiddenAutoBundlingTasksForItem = (item = {}, nextServiceTasks = [], itemList = lineItems) =>
    toArray(nextServiceTasks).filter((service) =>
      Boolean(
        getServiceTaskId(service) &&
          isTaskForLineItem(service, item, itemList.length) &&
          isBundlingServiceValue(service) &&
          !shouldDisplayServiceTaskForItem(service, item) &&
          !isServiceTaskCompleteForPrep(service, item)
      )
    );

  const syncHiddenAutoBundlingTasksForItems = async (itemsToCheck = lineItems, nextServiceTasks = serviceTasks) => {
    const itemList = toArray(itemsToCheck);
    const syncRows = itemList
      .filter((item) => areDisplayedServicesDoneForItem(item, nextServiceTasks, itemList))
      .flatMap((item) =>
        getHiddenAutoBundlingTasksForItem(item, nextServiceTasks, itemList).map((service) => ({
          service,
          item,
        }))
      )
      .filter((row, index, rows) => {
        const serviceId = String(getServiceTaskId(row.service) || '');
        return serviceId && rows.findIndex((currentRow) => String(getServiceTaskId(currentRow.service) || '') === serviceId) === index;
      });

    if (!syncRows.length) return 0;

    await Promise.all(
      syncRows.map(({ service, item }) => {
        const serviceId = getServiceTaskId(service);
        const unitsDone = getServiceUnits(service, item);
        const hiddenPayload = { status: 'DONE' };

        if (Number.isFinite(unitsDone)) {
          hiddenPayload.unitsDone = unitsDone;
          hiddenPayload.units_done = unitsDone;
        }

        return fetch(`${API_BASE_URL}/api/services/${encodeURIComponent(serviceId)}`, {
          method: 'PATCH',
          headers: buildHeaders(true),
          body: JSON.stringify(hiddenPayload),
        }).then((response) => parseResponse(response));
      })
    );

    return syncRows.length;
  };

  const syncHiddenAutoBundlingTasks = async (updatedTaskId = '', patchPayload = {}) => {
    if (!isDoneServiceStatus(patchPayload.status)) return 0;

    const nextServiceTasks = getServiceTasksWithPatch(updatedTaskId, patchPayload);
    const updatedTask = nextServiceTasks.find(
      (service) => String(getServiceTaskId(service) || '') === String(updatedTaskId || '')
    );
    const candidateItems = updatedTask
      ? lineItems.filter((item) => isTaskForLineItem(updatedTask, item, lineItems.length))
      : [];

    return syncHiddenAutoBundlingTasksForItems(candidateItems, nextServiceTasks);
  };

  const shouldRefreshAvailabilityForTaskPatch = (updatedTaskId = '', patchPayload = {}) => {
    const previousTask = serviceTasks.find(
      (service) => String(getServiceTaskId(service) || '') === String(updatedTaskId || '')
    );
    const nextServiceTasks = getServiceTasksWithPatch(updatedTaskId, patchPayload);
    const updatedTask = nextServiceTasks.find(
      (service) => String(getServiceTaskId(service) || '') === String(updatedTaskId || '')
    );

    if (!updatedTask) return false;

    const previousDone = isDoneServiceStatus(
      firstPresent(previousTask?.status, previousTask?.taskStatus, previousTask?.task_status, previousTask?.state)
    );
    const nextDone = isDoneServiceStatus(
      firstPresent(updatedTask?.status, updatedTask?.taskStatus, updatedTask?.task_status, updatedTask?.state)
    );

    if (!previousDone && !nextDone) return false;

    return lineItems
      .filter((item) => isTaskForLineItem(updatedTask, item, lineItems.length))
      .some((item) => {
        const wasReady = areDisplayedServicesDoneForItem(item, serviceTasks, lineItems);
        const isReady = areDisplayedServicesDoneForItem(item, nextServiceTasks, lineItems);
        return wasReady !== isReady || isReady;
      });
  };

  const loadShipmentData = async ({ showLoader = true } = {}) => {
    try {
      if (showLoader) {
        setIsLoading(true);
      }
      setError('');
      const routeId = String(id || '').trim();
      const encodedRouteId = encodeURIComponent(routeId);
      {
      const detailViewResponse = await fetch(`${API_BASE_URL}/api/shipments/${encodedRouteId}/detail-view`, {
        method: 'GET',
        headers: buildHeaders(),
        cache: 'no-store',
      });
      const detailViewPayload = await parseResponse(detailViewResponse);
      const detailViewBundle = detailViewPayload?.data || detailViewPayload;
      const bundleShipment = detailViewBundle?.shipment || {};
      const bundleLineItems = extractList(detailViewBundle, ['lineItems', 'line_items', 'items']);
      const bundleBoxes = mergeBoxLists(
        extractList(detailViewBundle, ['allBoxes', 'all_boxes']),
        extractList(detailViewBundle, ['boxes']),
        extractList(detailViewBundle, ['pallets'])
      );
      const bundleSubShipments = mergeSubShipmentLists(
        extractList(detailViewBundle, ['subShipments', 'sub_shipments']),
        extractSubShipments(bundleShipment)
      );
      const noteAttachments = getShipmentNoteAttachments(detailViewBundle, bundleShipment);
      const shipmentData = normalizeMappedShipment({
        ...bundleShipment,
        items: bundleLineItems,
        lineItems: bundleLineItems,
        shipment_line_items: bundleLineItems,
        boxes: bundleBoxes,
        outbound_boxes: bundleBoxes,
        subShipments: bundleSubShipments,
        sub_shipments: bundleSubShipments,
        noteAttachments,
        note_attachments: noteAttachments,
        invoice: detailViewBundle?.invoice || bundleShipment?.invoice || null,
        invoices: extractList(detailViewBundle, ['invoices']),
        counts: detailViewBundle?.counts || bundleShipment?.counts,
        permissions: detailViewBundle?.permissions || bundleShipment?.permissions,
        dispatchSummary: detailViewBundle?.dispatchSummary || detailViewBundle?.dispatch_summary || bundleShipment?.dispatchSummary || bundleShipment?.dispatch_summary,
        dispatch_summary: detailViewBundle?.dispatch_summary || detailViewBundle?.dispatchSummary || bundleShipment?.dispatch_summary || bundleShipment?.dispatchSummary,
        labelSummary: detailViewBundle?.labelSummary || detailViewBundle?.label_summary || bundleShipment?.labelSummary || bundleShipment?.label_summary,
        label_summary: detailViewBundle?.label_summary || detailViewBundle?.labelSummary || bundleShipment?.label_summary || bundleShipment?.labelSummary,
        filesByEntity: detailViewBundle?.filesByEntity || detailViewBundle?.files_by_entity || bundleShipment?.filesByEntity || bundleShipment?.files_by_entity,
        files_by_entity: detailViewBundle?.files_by_entity || detailViewBundle?.filesByEntity || bundleShipment?.files_by_entity || bundleShipment?.filesByEntity,
      });
      const shipmentLineItems = sortLineItemsForDisplay(applyBundleMetadataFromNotes(getLineItems(shipmentData), shipmentData));
      const shipmentRecordId = getShipmentRecordId(shipmentData);
      const subShipmentBoxDataFromBundle = bundleSubShipments.reduce((acc, subShipment) => {
        const subShipmentId = getSubShipmentId(subShipment);
        if (!subShipmentId) return acc;
        acc[subShipmentId] = {
          boxes: mergeBoxLists(
            getSubShipmentBoxes(subShipment),
            extractList(subShipment, ['boxes']),
            extractList(subShipment, ['pallets']),
            extractList(subShipment, ['allBoxes', 'all_boxes'])
          ).map((box) => decorateSubShipmentBoxForScope(box, subShipment)),
          allocationSummary: extractList(subShipment, ['allocationSummary', 'allocation_summary']),
        };
        return acc;
      }, {});
      const bundleFiles = mergeFileLists(
        extractFileRecords(detailViewBundle?.files),
        shipmentLineItems.flatMap((item) => getItemInlineLabelFiles(item)),
        bundleBoxes.flatMap((box) =>
          mergeFileLists(
            extractFileRecords(box?.fbaLabelFile),
            extractFileRecords(box?.fba_label_file),
            getPalletChildBoxes(box).flatMap((childBox) =>
              mergeFileLists(extractFileRecords(childBox?.fbaLabelFile), extractFileRecords(childBox?.fba_label_file))
            )
          )
        )
      );

      setShipment(shipmentData);
      setStaffId(getAssignedStaffId(shipmentData) || '');
      setStatusValue(shipmentData?.status || 'pending_arrival');
      setServices(mergeServiceTasks(detailViewBundle?.serviceTasks, detailViewBundle?.service_tasks, detailViewBundle?.customServices, detailViewBundle?.custom_services));
      setDiscrepancies(extractList(detailViewBundle, ['discrepancies']));
      setBoxes(bundleBoxes);
      setSubShipments(bundleSubShipments);
      setSubShipmentAvailability(sortAvailabilityRowsForDisplay(extractList(detailViewBundle, ['subShipmentAvailability', 'sub_shipment_availability'])));
      setSubShipmentBoxData(subShipmentBoxDataFromBundle);
      setFiles(bundleFiles);
      setFileEntityId(shipmentRecordId || id);
      setStaffMembers(extractUsers(detailViewBundle?.assignableUsers || detailViewBundle?.assignable_users || []));
      return;
      }

    } catch (requestError) {
      setError(requestError.message);
    } finally {
      if (showLoader) {
        setIsLoading(false);
      }
    }
  };

  const loadStaffMembers = async () => {
    try {
      setIsStaffLoading(true);
      const response = await fetch(`${API_BASE_URL}/api/users`, {
        method: 'GET',
        headers: buildHeaders(),
        cache: 'no-store',
      });
      const payload = await parseResponse(response);
      setStaffMembers(extractUsers(payload));
    } catch (requestError) {
      setStaffMembers([]);
      setError(requestError.message || 'Failed to load staff members.');
    } finally {
      setIsStaffLoading(false);
    }
  };

  useEffect(() => {
    loadShipmentData();
  }, [id]);

  const resetSubShipmentCreateForm = () => {
    setSubShipmentSelections({});
    setSubShipmentNotes('');
  };

  const refreshSubShipmentAvailability = async () => {
    const lookupCandidates = getShipmentLookupCandidates(shipment, id);
    let lastError = null;

    for (const lookupId of lookupCandidates) {
      try {
        const response = await fetch(`${API_BASE_URL}/api/shipments/${encodeURIComponent(lookupId)}/sub-shipments`, {
          method: 'GET',
          headers: buildHeaders(),
          cache: 'no-store',
        });
        const payload = await parseResponse(response);
        const nextSubShipments = mergeSubShipmentLists(extractSubShipments(payload), extractSubShipments(shipment));
        const nextAvailability = sortAvailabilityRowsForDisplay(extractSubShipmentAvailability(payload));

        setSubShipments(nextSubShipments);
        setSubShipmentAvailability(nextAvailability);
        return nextAvailability;
      } catch (requestError) {
        lastError = requestError;
      }
    }

    throw lastError || new Error('Failed to load sub-shipment availability.');
  };

  const handleOpenSubShipmentModal = async () => {
    if (isRefreshingSubShipmentAvailability || updatingTaskId) return;

    try {
      setError('');
      resetSubShipmentCreateForm();
      setIsRefreshingSubShipmentAvailability(true);
      await refreshSubShipmentAvailability();
      setShowSubShipmentModal(true);
    } catch (requestError) {
      setError(requestError.message || 'Failed to refresh sub-shipment availability.');
    } finally {
      setIsRefreshingSubShipmentAvailability(false);
    }
  };

  const handleSubShipmentSelectionChange = (availabilityItem, field, value) => {
    const availabilityId = getAvailabilityItemId(availabilityItem);
    if (!availabilityId) return;
    const maxQuantity = getSubShipmentAvailabilityAvailableQty(availabilityItem);

    setSubShipmentSelections((currentSelections) => {
      const currentSelection = currentSelections[availabilityId] || { selected: false, quantity: '' };
      if (field === 'selected') {
        const selected = Boolean(value);
        return {
          ...currentSelections,
          [availabilityId]: {
            ...currentSelection,
            selected,
            quantity: selected ? currentSelection.quantity || String(maxQuantity) : '',
          },
        };
      }

      const quantity = clampAllocationQuantity(value, maxQuantity);
      return {
        ...currentSelections,
        [availabilityId]: {
          ...currentSelection,
          selected: Boolean(quantity),
          quantity,
        },
      };
    });
  };

  const handleCreateSubShipment = async () => {
    if (isCreatingSubShipment) return;

    try {
      setIsCreatingSubShipment(true);
      setError('');
      setMessage('');
      const shipmentLookupId = getShipmentRecordId(shipment) || id;
      const refreshedAvailability = await refreshSubShipmentAvailability();
      const availabilityRows = refreshedAvailability.length ? refreshedAvailability : subShipmentAvailability;
      const selectedItems = availabilityRows
        .map((availabilityItem) => {
          const availabilityId = getAvailabilityItemId(availabilityItem);
          const selection = subShipmentSelections[availabilityId] || {};
          const requestedQuantity = Number(selection.quantity || 0);
          const availableQty = getSubShipmentAvailabilityAvailableQty(availabilityItem);
          const prepared = getSubShipmentAvailabilityPrepared(availabilityItem);
          const quantity = Math.min(requestedQuantity, availableQty);

          if (!selection.selected || !availabilityId || !prepared || availableQty <= 0 || !Number.isFinite(quantity) || quantity <= 0) return null;

          return {
            shipmentItemId: availabilityId,
            quantity,
          };
        })
        .filter(Boolean);

      if (!selectedItems.length) {
        throw new Error('Select at least one prepared item and quantity.');
      }

      const response = await fetch(`${API_BASE_URL}/api/shipments/${encodeURIComponent(shipmentLookupId)}/sub-shipments`, {
        method: 'POST',
        headers: buildHeaders(true),
        body: JSON.stringify({
          notes: String(subShipmentNotes || '').trim() || undefined,
          items: selectedItems,
        }),
      });
      await parseResponse(response);
      setMessage('Sub-shipment created successfully.');
      setShowSubShipmentModal(false);
      resetSubShipmentCreateForm();
      await loadShipmentData({ showLoader: false });
    } catch (requestError) {
      setError(requestError.status === 422 ? requestError.message : requestError.message || 'Failed to create sub-shipment.');
    } finally {
      setIsCreatingSubShipment(false);
    }
  };

  const handleOpenSubShipmentBoxModal = (subShipmentId = '', preferredBoxType = 'box') => {
    const subShipment = subShipments.find((currentSubShipment) => getSubShipmentId(currentSubShipment) === subShipmentId);
    const boxData = subShipmentId ? subShipmentBoxData[subShipmentId] || {} : {};

    if (!subShipmentId || !subShipment || getSubShipmentStatus(subShipment) === 'cancelled') return;

    const normalizedBoxType = preferredBoxType === 'pallet' ? 'pallet' : 'box';
    const subShipmentBoxes = getSubShipmentBoxRows(subShipment, boxData);
    const hasBoxableQuantity = getSubShipmentBoxableQuantity(subShipment, boxData) > 0;
    const hasEligiblePalletBoxes = getEligiblePalletBoxesFromRows(subShipmentBoxes).length > 0;

    if (normalizedBoxType === 'box' && !hasBoxableQuantity) {
      showToast('error', 'All SKU quantities in this sub-shipment are already boxed.');
      return;
    }

    if (normalizedBoxType === 'pallet' && !hasEligiblePalletBoxes) {
      showToast('error', 'No labeled loose boxes are available for this sub-shipment pallet.');
      return;
    }

    setActiveSubShipmentIdForBox(subShipmentId);
    setBoxType(normalizedBoxType);
    setBoxNumber('');
    setPalletNumber('');
    resetAddBoxSkuSelection();
    setSelectedPalletBoxIds([]);
    setShowAddBoxModal(true);
  };

  const handleRefreshSubShipmentBoxes = async (subShipmentId = '') => {
    const subShipment = subShipments.find((currentSubShipment) => getSubShipmentId(currentSubShipment) === subShipmentId);
    if (!subShipmentId || !subShipment) return;

    try {
      setError('');
      const response = await fetch(`${API_BASE_URL}/api/sub-shipments/${encodeURIComponent(subShipmentId)}/boxes`, {
        method: 'GET',
        headers: buildHeaders(),
        cache: 'no-store',
      });
      const payload = await parseResponse(response);
      const boxes = await enrichBoxesWithItems(
        mergeBoxLists(getSubShipmentBoxes(subShipment), extractBoxes(payload)).map((box) => decorateSubShipmentBoxForScope(box, subShipment)),
        lineItems
      );
      setSubShipmentBoxData((currentData) => ({
        ...currentData,
        [subShipmentId]: {
          boxes,
          allocationSummary: extractList(payload, ['allocationSummary', 'allocation_summary']),
        },
      }));
    } catch (requestError) {
      setError(requestError.message || 'Failed to load sub-shipment boxes.');
    }
  };

  const upsertCreatedBoxIntoLocalState = async (createdBox = null, targetSubShipmentId = '') => {
    if (!createdBox || typeof createdBox !== 'object') return false;

    const boxKey = String(getBoxRecordId(createdBox) || getBoxId(createdBox) || createdBox?.boxNumber || createdBox?.box_number || '').trim();
    if (!boxKey) return false;

    const resolvedSubShipmentId = String(targetSubShipmentId || getBoxSubShipmentId(createdBox) || '').trim();
    const resolvedSubShipment = resolvedSubShipmentId
      ? subShipments.find((currentSubShipment) => getSubShipmentId(currentSubShipment) === resolvedSubShipmentId) || null
      : null;
    const scopedCreatedBox = resolvedSubShipment
      ? decorateSubShipmentBoxForScope(createdBox, resolvedSubShipment)
      : createdBox;
    const hasReturnedItems = getBoxItems(scopedCreatedBox).length > 0;
    const [enrichedBox] = hasReturnedItems
      ? [scopedCreatedBox]
      : await enrichBoxesWithItems(
          [scopedCreatedBox],
          resolvedSubShipmentId ? boxSelectionLineItems : lineItems
        );
    const nextBox = enrichedBox || scopedCreatedBox;

    if (resolvedSubShipmentId) {
      setSubShipmentBoxData((currentData) => {
        const currentEntry = currentData[resolvedSubShipmentId] || {};
        const nextBoxes = mergeBoxLists(currentEntry.boxes || [], [nextBox]);

        return {
          ...currentData,
          [resolvedSubShipmentId]: {
            ...currentEntry,
            boxes: nextBoxes,
          },
        };
      });

      setSubShipments((currentSubShipments) =>
        currentSubShipments.map((currentSubShipment) => {
          if (getSubShipmentId(currentSubShipment) !== resolvedSubShipmentId) return currentSubShipment;

          const nextBoxes = mergeBoxLists(getSubShipmentBoxes(currentSubShipment), [nextBox]);
          return {
            ...currentSubShipment,
            boxes: nextBoxes,
            outbound_boxes: nextBoxes,
            shipmentBoxes: nextBoxes,
            shipment_boxes: nextBoxes,
          };
        })
      );

      return true;
    }

    setBoxes((currentBoxes) => mergeBoxLists(currentBoxes, [nextBox]));
    setShipment((currentShipment) => {
      if (!currentShipment) return currentShipment;

      const nextBoxes = mergeBoxLists(extractBoxes(currentShipment), boxes, [nextBox]);
      return {
        ...currentShipment,
        boxes: nextBoxes,
        outbound_boxes: nextBoxes,
        shipmentBoxes: nextBoxes,
        shipment_boxes: nextBoxes,
      };
    });

    return true;
  };

  const applyBoxWorkflowPatch = async (workflowPatch = null, createdBox = null) => {
    if (!workflowPatch || typeof workflowPatch !== 'object') return false;

    const scope = String(workflowPatch.scope || workflowPatch.workflowScope || workflowPatch.workflow_scope || '').trim();

    if (scope === 'shipmentBoxes') {
      const shipmentBoxesPatch = workflowPatch.shipmentBoxes || workflowPatch.shipment_boxes || {};
      const patchBoxes = extractBoxes(shipmentBoxesPatch);
      const createdBoxRows = createdBox && typeof createdBox === 'object' ? [createdBox] : [];
      const nextBoxes = await enrichBoxesWithItemsIfMissing(mergeBoxLists(patchBoxes, createdBoxRows, boxes), lineItems);
      const availabilityRows = extractSubShipmentAvailability(shipmentBoxesPatch);

      if (!nextBoxes.length) return false;

      setBoxes(nextBoxes);
      setShipment((currentShipment) =>
        currentShipment
          ? {
              ...currentShipment,
              boxes: nextBoxes,
              outbound_boxes: nextBoxes,
              shipmentBoxes: nextBoxes,
              shipment_boxes: nextBoxes,
            }
          : currentShipment
      );

      if (availabilityRows.length || Array.isArray(shipmentBoxesPatch?.availability)) {
        setSubShipmentAvailability(sortAvailabilityRowsForDisplay(availabilityRows));
      }

      return true;
    }

    if (scope === 'subShipmentBoxes') {
      const subShipmentBoxesPatch = workflowPatch.subShipmentBoxes || workflowPatch.sub_shipment_boxes || {};
      const patchSubShipment =
        subShipmentBoxesPatch.subShipment ||
        subShipmentBoxesPatch.sub_shipment ||
        workflowPatch.subShipment ||
        workflowPatch.sub_shipment ||
        null;
      const patchSubShipmentId = String(
        workflowPatch.subShipmentId ||
          workflowPatch.sub_shipment_id ||
          subShipmentBoxesPatch.subShipmentId ||
          subShipmentBoxesPatch.sub_shipment_id ||
          getSubShipmentId(patchSubShipment || {}) ||
          activeSubShipmentIdForBox ||
          ''
      ).trim();

      if (!patchSubShipmentId) return false;

      const patchSubShipmentSource =
        patchSubShipment ||
        subShipments.find((currentSubShipment) => getSubShipmentId(currentSubShipment) === patchSubShipmentId) ||
        {};
      const existingBoxes = getSubShipmentBoxRows(
        patchSubShipmentSource,
        subShipmentBoxData[patchSubShipmentId] || {}
      );
      const createdBoxRows = createdBox && typeof createdBox === 'object' ? [createdBox] : [];
      const nextBoxes = await enrichBoxesWithItemsIfMissing(
        mergeBoxLists(
          extractBoxes(subShipmentBoxesPatch).map((box) => decorateSubShipmentBoxForScope(box, patchSubShipmentSource)),
          createdBoxRows.map((box) => decorateSubShipmentBoxForScope(box, patchSubShipmentSource)),
          existingBoxes
        ),
        lineItems
      );
      const allocationSummary = extractList(subShipmentBoxesPatch, ['allocationSummary', 'allocation_summary']);

      setSubShipmentBoxData((currentData) => ({
        ...currentData,
        [patchSubShipmentId]: {
          boxes: nextBoxes,
          allocationSummary,
        },
      }));

      if (patchSubShipment && typeof patchSubShipment === 'object') {
        setSubShipments((currentSubShipments) => {
          let matched = false;
          const nextSubShipments = currentSubShipments.map((currentSubShipment) => {
            if (getSubShipmentId(currentSubShipment) !== patchSubShipmentId) return currentSubShipment;
            matched = true;
            return {
              ...currentSubShipment,
              ...patchSubShipment,
              boxes: nextBoxes,
              outbound_boxes: nextBoxes,
              shipmentBoxes: nextBoxes,
              shipment_boxes: nextBoxes,
            };
          });

          return matched
            ? nextSubShipments
            : [
                ...nextSubShipments,
                {
                  ...patchSubShipment,
                  boxes: nextBoxes,
                  outbound_boxes: nextBoxes,
                  shipmentBoxes: nextBoxes,
                  shipment_boxes: nextBoxes,
                },
              ];
        });
      }

      return true;
    }

    return false;
  };

  const handleStatusUpdate = async (nextStatus = statusValue) => {
    try {
      setError('');
      setMessage('');

      if (['completed', 'complete'].includes(normalizeCompletionStatus(nextStatus))) {
        const completionBlockers = getShipmentCompletionBlockers(lineItems, boxes);
        if (completionBlockers.length) {
          setError(formatShipmentCompletionBlockerMessage(completionBlockers));
          return;
        }
      }

      const response = await fetch(`${API_BASE_URL}/api/shipments/${id}/status`, {
        method: 'PATCH',
        headers: buildHeaders(true),
        body: JSON.stringify({ status: nextStatus }),
      });
      await parseResponse(response);
      setStatusValue(nextStatus);
      setMessage('Shipment status updated.');
      await loadShipmentData({ showLoader: false });
    } catch (requestError) {
      setError(requestError.message);
    }
  };

  const handleAssignStaff = async () => {
    try {
      setError('');
      setMessage('');
      const selectedStaffId = String(staffId || '').trim();
      if (!selectedStaffId) {
        throw new Error('Please select a staff member before assigning.');
      }

      const response = await fetch(`${API_BASE_URL}/api/shipments/${id}/assign`, {
        method: 'PATCH',
        headers: buildHeaders(true),
        body: JSON.stringify({ staffId: selectedStaffId }),
      });
      await parseResponse(response);
      setMessage('Staff assigned successfully.');
      await loadShipmentData({ showLoader: false });
    } catch (requestError) {
      setError(requestError.message);
    }
  };

  const handleBulkServiceUpdate = async () => {
    try {
      setError('');
      setMessage('');
      const response = await fetch(`${API_BASE_URL}/api/shipments/${id}/services/bulk`, {
        method: 'POST',
        headers: buildHeaders(true),
        body: JSON.stringify({ serviceType: normalizeServiceCode(bulkServiceType), status: bulkStatus }),
      });
      await parseResponse(response);
      setMessage('Bulk service status updated.');
      await loadShipmentData({ showLoader: false });
    } catch (requestError) {
      setError(requestError.message);
    }
  };

  const handleAddCustomService = async () => {
    try {
      setError('');
      setMessage('');
      const response = await fetch(`${API_BASE_URL}/api/shipments/${id}/line-items/${customServiceLineItemId}/custom-service`, {
        method: 'POST',
        headers: buildHeaders(true),
        body: JSON.stringify({ name: customServiceName, price: Number(customServicePrice || 0) }),
      });
      await parseResponse(response);
      setMessage('Custom service added.');
      setCustomServiceName('');
      setCustomServicePrice('');
      await loadShipmentData({ showLoader: false });
    } catch (requestError) {
      setError(requestError.message);
    }
  };

  const handleUpdateCustomServiceStatus = async () => {
    try {
      setError('');
      setMessage('');
      const response = await fetch(`${API_BASE_URL}/api/shipments/${id}/line-items/${customServiceStatusLineItemId}/custom-service`, {
        method: 'PATCH',
        headers: buildHeaders(true),
        body: JSON.stringify({ name: customServiceStatusName, status: customServiceStatusValue }),
      });
      await parseResponse(response);
      setMessage('Custom service status updated.');
      await loadShipmentData({ showLoader: false });
    } catch (requestError) {
      setError(requestError.message);
    }
  };

  const handleOpenDiscrepancyResolve = (discrepancy = {}, matchedLineItem = {}) => {
    const fallbackLineItem = matchedLineItem && Object.keys(matchedLineItem).length
      ? matchedLineItem
      : findLineItemForDiscrepancy(discrepancy, lineItems);
    const discrepancyLineItem = getDiscrepancyLineItem(discrepancy);
    const lineItemId = firstPresent(
      getDiscrepancyLineItemId(discrepancy),
      getLineItemId(fallbackLineItem),
      getLineItemId(discrepancyLineItem)
    );

    setDiscrepancyResolveError('');
    setDiscrepancyResolveTarget({
      discrepancy,
      lineItem: fallbackLineItem,
      lineItemId,
      sku: firstPresent(getItemSku(fallbackLineItem), getDiscrepancySku(discrepancy), lineItemId),
      productName: firstPresent(getItemProductName(fallbackLineItem), getItemProductName(discrepancyLineItem)),
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
      setMessage('');
      setDiscrepancyResolveError('');
      setIsResolvingDiscrepancy(true);

      if (!target?.lineItemId) {
        throw new Error('Line item ID is required to update received quantity.');
      }

      const responsePayload = await resolveDiscrepancyRequest(target.lineItemId, payload);
      const responseData = getDiscrepancyResolveData(responsePayload) || {};

      if (responseData?.shipment && typeof responseData.shipment === 'object') {
        setShipment(normalizeMappedShipment(responseData.shipment));
      }

      setDiscrepancies((currentRows) => updateDiscrepancyRowsAfterResolve(currentRows, target, responseData));
      setMessage(responseData?.resolved === true ? 'Discrepancy resolved.' : 'Received quantity updated. Discrepancy remains active.');
      setDiscrepancyResolveTarget(null);
      await loadShipmentData({ showLoader: false });
    } catch (requestError) {
      setDiscrepancyResolveError(requestError.message);
      setError(requestError.message);
    } finally {
      setIsResolvingDiscrepancy(false);
    }
  };

  const handleGenerateShipmentInvoice = async () => {
    try {
      setError('');
      setMessage('');
      const existingInvoice = findInvoiceByType(shipment, 'shipment');
      setInvoiceActionKey(`shipment:${id}`);
      const response = await fetch(`${API_BASE_URL}/api/shipments/${encodeURIComponent(id)}/invoice`, {
        method: 'POST',
        headers: buildHeaders(true),
      });
      const payload = await parseResponse(response);
      const invoice = extractGeneratedInvoice(payload);
      if (invoice && typeof invoice === 'object') {
        setShipment((currentShipment) => ({ ...(currentShipment || {}), invoice }));
      }
      setMessage(existingInvoice ? 'Shipment invoice refreshed.' : 'Shipment invoice ready.');
      await loadShipmentData({ showLoader: false });
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setInvoiceActionKey('');
    }
  };

  const handleGenerateSubShipmentInvoice = async (subShipmentId = '') => {
    try {
      setError('');
      setMessage('');
      if (!subShipmentId) throw new Error('Sub-shipment identifier is missing.');
      const existingSubShipment = subShipments.find((subShipment) => getSubShipmentId(subShipment) === subShipmentId);
      const existingInvoice = findInvoiceByType(existingSubShipment, 'sub_shipment');
      setInvoiceActionKey(`sub-shipment:${subShipmentId}`);
      const response = await fetch(`${API_BASE_URL}/api/sub-shipments/${encodeURIComponent(subShipmentId)}/invoice`, {
        method: 'POST',
        headers: buildHeaders(true),
      });
      const payload = await parseResponse(response);
      const invoice = extractGeneratedInvoice(payload);
      if (invoice && typeof invoice === 'object') {
        setSubShipments((currentSubShipments) =>
          currentSubShipments.map((subShipment) =>
            getSubShipmentId(subShipment) === subShipmentId ? { ...subShipment, invoice } : subShipment
          )
        );
      }
      setMessage(existingInvoice ? 'Sub-shipment invoice refreshed.' : 'Sub-shipment invoice ready.');
      await loadShipmentData({ showLoader: false });
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setInvoiceActionKey('');
    }
  };

  const handleUpdateTask = async (taskOverride = {}) => {
    let previousServices = null;

    try {
      setError('');
      setMessage('');
      const resolvedTaskId = taskOverride.taskId || taskId;
      if (!resolvedTaskId) {
        throw new Error('Service task id required.');
      }
      setUpdatingTaskId(resolvedTaskId);
      const payload = { status: taskOverride.status || taskStatus };
      const unitsDone = taskOverride.unitsDone ?? taskUnitsDone;
      const notes = taskOverride.notes ?? taskNotes;
      if (unitsDone !== '' && unitsDone !== undefined) {
        const normalizedUnitsDone = Number(unitsDone);
        payload.unitsDone = normalizedUnitsDone;
        payload.units_done = normalizedUnitsDone;
      }
      if (String(notes || '').trim()) payload.notes = String(notes).trim();
      const doneUnitsValue = Number(firstPresent(payload.unitsDone, payload.units_done, ''));
      if (isDoneServiceStatus(payload.status) && (!Number.isFinite(doneUnitsValue) || doneUnitsValue <= 0)) {
        const message = 'Receive this item before marking services done.';
        setError(message);
        showToast('error', message);
        return;
      }
      const shouldRefreshAvailability = shouldRefreshAvailabilityForTaskPatch(resolvedTaskId, payload);
      setServices((currentServices) => {
        previousServices = currentServices;

        return toArray(currentServices).map((service) => {
          if (String(getServiceTaskId(service) || '') !== String(resolvedTaskId)) {
            return service;
          }

          return mergeServiceTaskUpdate(service, payload);
        });
      });
      const response = await fetch(`${API_BASE_URL}/api/services/${encodeURIComponent(resolvedTaskId)}`, {
        method: 'PATCH',
        headers: buildHeaders(true),
        body: JSON.stringify(payload),
      });
      const responsePayload = await parseResponse(response);
      const responseTask = getUpdatedServiceTaskFromPayload(responsePayload, resolvedTaskId);
      if (responseTask) {
        setServices((currentServices) =>
          toArray(currentServices).map((service) => {
            if (String(getServiceTaskId(service) || '') !== String(resolvedTaskId)) {
              return service;
            }

            return mergeServiceTaskUpdate(service, payload, responseTask);
          })
        );
      }
      const syncedHiddenAutoTasks = await syncHiddenAutoBundlingTasks(resolvedTaskId, payload);
      setMessage('Service task updated.');
      if (shouldRefreshAvailability || syncedHiddenAutoTasks > 0) {
        await refreshSubShipmentAvailability();
      }
    } catch (requestError) {
      if (previousServices) {
        setServices(previousServices);
      }
      setError(requestError.message);
    } finally {
      setUpdatingTaskId('');
    }
  };

  const handleCreateBox = async (isPallet = false) => {
    if (isCreatingBox) return false;

    const showBoxError = (errorMessage) => {
      setError('');
      showToast('error', errorMessage);
      return false;
    };

    try {
      setIsCreatingBox(true);
      setError('');
      setMessage('');
      const endpoint = isPallet ? 'pallets' : 'boxes';
      const shipmentLookupId = getShipmentRecordId(shipment) || id;
      const subShipmentIdForBox = activeSubShipmentIdForBox;

      if (isPallet) {
        const palletBoxIds = [...new Set(selectedPalletBoxIds.map((boxId) => String(boxId || '').trim()).filter(Boolean))];
        const validPalletBoxIds = palletBoxIds.filter((boxId) =>
          eligiblePalletBoxes.some((box) => (getBoxRecordId(box) || getBoxId(box)) === boxId)
        );
        const selectedBoxesForPallet = eligiblePalletBoxes.filter((box) =>
          validPalletBoxIds.includes(getBoxRecordId(box) || getBoxId(box))
        );

        if (!validPalletBoxIds.length) {
          return showBoxError('Select at least one labeled loose box to place inside this pallet.');
        }

        if (!subShipmentIdForBox) {
          const hasSubShipmentBox = selectedBoxesForPallet.some((box) => {
            const boxKeys = getBoxScopeKeys(box);
            return !isParentShipmentBox(box) || boxKeys.some((boxKey) => subShipmentScopedBoxKeys.has(boxKey));
          });

          if (hasSubShipmentBox) {
            return showBoxError('Use the sub-shipment Add Pallet button to palletize sub-shipment boxes.');
          }
        }

        const manualPalletNumber = String(palletNumber || '').trim();
        const palletPayload = {
          boxIds: validPalletBoxIds,
          dimensions: {
            l: Number(boxLength || 0),
            w: Number(boxWidth || 0),
            h: Number(boxHeight || 0),
          },
          weight: Number(boxWeight || 0),
          ...(manualPalletNumber ? { palletNumber: manualPalletNumber } : {}),
          ...(subShipmentIdForBox ? { subShipmentId: subShipmentIdForBox } : {}),
        };
        const createUrl = subShipmentIdForBox
          ? `${API_BASE_URL}/api/sub-shipments/${encodeURIComponent(subShipmentIdForBox)}/pallets`
          : `${API_BASE_URL}/api/shipments/${encodeURIComponent(shipmentLookupId)}/pallets`;
        const response = await fetch(createUrl, {
          method: 'POST',
          headers: buildHeaders(true),
          body: JSON.stringify(palletPayload),
        });
        const palletPayloadResponse = await parseResponse(response);
        const createdPallet = getCreatedBoxFromPayload(palletPayloadResponse);

        showToast('success', 'Pallet created successfully.');
        const localPalletApplied = await upsertCreatedBoxIntoLocalState(createdPallet, subShipmentIdForBox);
        if (!localPalletApplied) {
          await loadShipmentData({ showLoader: false });
        }
        if (subShipmentIdForBox && !localPalletApplied) {
          await handleRefreshSubShipmentBoxes(subShipmentIdForBox);
        }
        setSelectedPalletBoxIds([]);
        setPalletNumber('');
        resetAddBoxSkuSelection();
        setActiveSubShipmentIdForBox('');
        return true;
      }

      const payload = isPallet && !subShipmentIdForBox
        ? {}
        : {
            boxType: isPallet ? 'pallet' : boxType,
            boxSize,
            weight: Number(boxWeight || 0),
            dimensions: { l: Number(boxLength || 0), w: Number(boxWidth || 0), h: Number(boxHeight || 0) },
            ...(String(boxNumber || '').trim() ? { boxNumber: String(boxNumber || '').trim() } : {}),
          };
      const allocationDrafts = [
        { lineItemValue: boxSkuPreview, quantity: boxSkuQuantityPreview, rowNumber: 1 },
        ...boxSkuExtraRows.map((row, index) => ({ ...row, rowNumber: index + 2 })),
      ].filter((row) => String(row.lineItemValue || row.quantity || '').trim());
      const allocations = [];
      const seenAllocationKeys = new Set();

      if (!isPallet && boxSelectionLineItems.length) {
        if (!allocationDrafts.length) {
          return showBoxError('Please select a SKU before creating the box so units are allocated.');
        }

        for (const draft of allocationDrafts) {
          const lineItemValue = String(draft.lineItemValue || '').trim();
          const lineItem = findLineItemBySelection(lineItemValue);
          const requestedQuantity = Number(draft.quantity || 0);
          const rowLabel = draft.rowNumber === 1 ? 'selected SKU' : `SKU row ${draft.rowNumber}`;

          if (!lineItemValue || !lineItem) {
            return showBoxError(`Please select a valid SKU in ${rowLabel}.`);
          }

          if (!Number.isFinite(requestedQuantity) || requestedQuantity <= 0) {
            return showBoxError(`Please enter units greater than 0 for ${getItemSku(lineItem) || rowLabel}.`);
          }

          if (!Number.isInteger(requestedQuantity)) {
            return showBoxError(`Please enter a whole number of units for ${getItemSku(lineItem) || rowLabel}.`);
          }

          const allocationKey = String(getBoxAllocationLineItemId(lineItem) || getLineItemId(lineItem) || lineItemValue).trim();
          if (seenAllocationKeys.has(allocationKey)) {
            return showBoxError('This SKU is already selected. Please remove duplicate SKU rows.');
          }

          const maxQuantity = getLineItemAllocatableQuantity(lineItem, boxSelectionBoxes, boxSelectionLineItems);
          if (maxQuantity <= 0) {
            return showBoxError(`${getItemSku(lineItem) || 'Selected SKU'} has no received units available to box.`);
          }

          if (requestedQuantity > maxQuantity) {
            return showBoxError(`Only ${formatQuantityValue(maxQuantity)} units are available for ${getItemSku(lineItem) || rowLabel}.`);
          }

          seenAllocationKeys.add(allocationKey);
          allocations.push({
            lineItem,
            lineItemValue,
            requestedQuantity,
            quantity: requestedQuantity,
            maxQuantity,
          });
        }
      }
      let allocationWarning = '';
      const allocationPayloadItems = allocations
        .map((allocation) => {
          const shipmentItemId = String(
            getBoxAllocationLineItemId(allocation.lineItem) || getShipmentLineItemId(allocation.lineItem) || ''
          ).trim();
          const sku = getItemSku(allocation.lineItem) || allocation.lineItemValue;

          return {
            shipmentItemId,
            shipment_item_id: shipmentItemId,
            lineItemId: shipmentItemId,
            line_item_id: shipmentItemId,
            sku,
            sellerSku: sku,
            seller_sku: sku,
            quantity: allocation.quantity,
            qty: allocation.quantity,
            units: allocation.quantity,
          };
        })
        .filter((item) => item.shipmentItemId && item.quantity > 0);

      if (!isPallet && allocations.length && allocationPayloadItems.length !== allocations.length) {
        return showBoxError('Selected SKU is missing a valid shipment line item id.');
      }

      const createBoxPayload =
        !isPallet && allocationPayloadItems.length
          ? {
              ...payload,
              items: allocationPayloadItems,
              boxItems: allocationPayloadItems,
              box_items: allocationPayloadItems,
              contents: allocationPayloadItems,
              units: allocationPayloadItems.reduce((sum, item) => sum + Number(item.quantity || 0), 0),
              sku: getBoxSkuCollectionValue(allocationPayloadItems),
            }
          : payload;

      const createBoxRequest = async (requestPayload) => {
        const createUrl = subShipmentIdForBox
          ? `${API_BASE_URL}/api/sub-shipments/${encodeURIComponent(subShipmentIdForBox)}/boxes?includeWorkflow=true`
          : `${API_BASE_URL}/api/shipments/${encodeURIComponent(shipmentLookupId)}/${endpoint}?includeWorkflow=true`;
        const createResponse = await fetch(createUrl, {
          method: 'POST',
          headers: buildHeaders(true),
          body: JSON.stringify(requestPayload),
        });
        const createPayload = await parseResponse(createResponse);

        return {
          response: createResponse,
          payload: createPayload,
          request: requestPayload,
        };
      };

      const createResult = await createBoxRequest(createBoxPayload);

      const boxPayload = createResult.payload;
      const response = createResult.response;
      const workflowPatch = getBoxWorkflowPatch(boxPayload);
      const newBox = getCreatedBoxFromPayload(boxPayload);
      const newBoxId = getBoxRecordId(newBox) || newBox?.id;
      const allocationIncludedInCreate = !isPallet && allocationPayloadItems.length && createResult.request !== payload;

      if (!isPallet && allocationPayloadItems.length) {
        saveCachedBoxAllocationItems(
          { ...newBox, id: newBoxId || getBoxId(newBox) },
          allocationPayloadItems,
          [newBoxId, getBoxId(newBox), getBoxRecordId(newBox)]
        );
      }

      console.log('[PickPackPro][Box Create POST]', {
        shipmentId: shipmentLookupId,
        endpoint,
          status: response.status,
          request: createResult.request,
          allocationPayloadItems,
          response: boxPayload,
          newBox,
          newBoxId,
          subShipmentId: subShipmentIdForBox,
          allocations: allocations.map((allocation) => ({
            sku: getItemSku(allocation.lineItem) || allocation.lineItemValue,
            shipmentItemId: getBoxAllocationLineItemId(allocation.lineItem) || getShipmentLineItemId(allocation.lineItem),
          requestedQuantity: allocation.requestedQuantity,
          quantity: allocation.quantity,
          maxQuantity: allocation.maxQuantity,
        })),
      });

      if (allocationIncludedInCreate) {
        console.log('[PickPackPro][Box Item POST skipped]', {
          boxId: newBoxId,
          reason: 'Allocation items were included in the create box request.',
          allocationPayloadItems,
        });
      }

      if (!isPallet && !newBoxId && allocations.length) {
        allocationWarning = ' SKU allocation skipped: new box id was not returned.';
      }

      if (allocationWarning) {
        showToast('error', `${isPallet ? 'Pallet' : 'Box'} created, but some SKU quantities could not be added.`);
      } else {
        showToast('success', `${isPallet ? 'Pallet' : 'Box'} created successfully.`);
      }

      const newBoxForWorkflowState =
        !isPallet && allocationPayloadItems.length
          ? {
              ...newBox,
              items: getBoxItems(newBox).length ? getBoxItems(newBox) : allocationPayloadItems,
              boxItems: getBoxItems(newBox).length ? getBoxItems(newBox) : allocationPayloadItems,
              box_items: getBoxItems(newBox).length ? getBoxItems(newBox) : allocationPayloadItems,
              contents: getBoxItems(newBox).length ? getBoxItems(newBox) : allocationPayloadItems,
            }
          : newBox;
      const localBoxApplied = await upsertCreatedBoxIntoLocalState(newBoxForWorkflowState, subShipmentIdForBox);
      const workflowPatchApplied = await applyBoxWorkflowPatch(workflowPatch, newBoxForWorkflowState);
      if (!workflowPatchApplied && !localBoxApplied) {
        await loadShipmentData({ showLoader: false });
        if (subShipmentIdForBox) {
          await handleRefreshSubShipmentBoxes(subShipmentIdForBox);
        }
      }
      resetAddBoxSkuSelection();
      setBoxNumber('');
      setActiveSubShipmentIdForBox('');
      return true;
    } catch (requestError) {
      setError('');
      const errorMessage = requestError.message || `Failed to create ${isPallet ? 'pallet' : 'box'}.`;
      const friendlyMessage =
        isPallet && /pallet number already exists/i.test(errorMessage)
          ? 'This pallet number already exists in this shipment/sub-shipment.'
          : errorMessage;
      showToast('error', friendlyMessage);
      setError(friendlyMessage);
      return false;
    } finally {
      setIsCreatingBox(false);
    }
  };

  const handleAddItemToBox = async () => {
    try {
      setError('');
      setMessage('');
      const boxId = String(addToBoxBoxId || '').trim();
      const selectedLineItemId = String(
        getBoxAllocationLineItemId(selectedAddToBoxLineItem || {}) || addToBoxLineItemId || ''
      ).trim();
      const requestedQuantity = Number(addToBoxQuantity || 0);

      if (!boxId) {
        setError('Please select a box first.');
        return false;
      }

      if (!selectedLineItemId) {
        setError('Please select a SKU first.');
        return false;
      }

      if (!isUuidValue(selectedLineItemId)) {
        setError('Selected SKU is missing a valid line item UUID.');
        return false;
      }

      if (!Number.isFinite(requestedQuantity) || requestedQuantity <= 0) {
        setError('Please enter units greater than 0.');
        return false;
      }

      if (selectedAddToBoxLineItem && selectedAddToBoxMaxQuantity > 0 && requestedQuantity > selectedAddToBoxMaxQuantity) {
        setError(`Only ${formatQuantityValue(selectedAddToBoxMaxQuantity)} units are available for this SKU.`);
        return false;
      }

      await postBoxItemAllocation({
        boxId,
        shipmentItemId: selectedLineItemId,
        quantity: requestedQuantity,
        skuLabel: getItemSku(selectedAddToBoxLineItem || {}) || selectedLineItemId,
      });
      setMessage('Item added to box.');
      await loadShipmentData({ showLoader: false });
      return true;
    } catch (requestError) {
      setError(requestError.message);
      return false;
    }
  };

  const handleRemoveItemFromBox = async () => {
    try {
      setError('');
      setMessage('');
      const response = await fetch(`${API_BASE_URL}/api/boxes/${removeFromBoxBoxId}/items/${removeFromBoxItemId}`, {
        method: 'DELETE',
        headers: buildHeaders(),
      });
      await parseResponse(response);
      setMessage('Item removed from box.');
      await loadShipmentData({ showLoader: false });
    } catch (requestError) {
      setError(requestError.message);
    }
  };

  const handleSealBox = async () => {
    try {
      setError('');
      setMessage('');
      const response = await fetch(`${API_BASE_URL}/api/boxes/${sealBoxId}/seal`, {
        method: 'PATCH',
        headers: buildHeaders(true),
        body: JSON.stringify({ trackingCode: sealTrackingCode || undefined }),
      });
      await parseResponse(response);
      setMessage('Box sealed successfully.');
      await loadShipmentData({ showLoader: false });
    } catch (requestError) {
      setError(requestError.message);
    }
  };

  const runMarkBoxDispatched = async (boxId, isPallet) => {
    try {
      setError('');
      setMessage('');
      const response = await fetch(`${API_BASE_URL}/api/boxes/${encodeURIComponent(boxId)}/seal`, {
        method: 'PATCH',
        headers: buildHeaders(true),
        body: JSON.stringify({ trackingCode: undefined }),
      });
      const payload = await parseResponse(response);
      const invoice = extractGeneratedInvoice(payload);
      if (invoice && typeof invoice === 'object') {
        setShipment((currentShipment) => ({ ...(currentShipment || {}), invoice }));
      }
      setMessage(`${isPallet ? 'Pallet' : 'Box'} marked dispatched.`);
      await loadShipmentData({ showLoader: false });
    } catch (requestError) {
      setError(requestError.message);
    }
  };

  const handleMarkBoxDispatched = async (boxOrId) => {
    const box = typeof boxOrId === 'object'
      ? boxOrId
      : boxes.find((currentBox) => getBoxId(currentBox) === boxOrId) || { id: boxOrId };
    const boxId = getBoxRecordId(box);
    const isPallet = isPalletBox(box);

    if (!boxId) {
      setError('Box UUID required hai.');
      return;
    }

    if (isBoxInsidePallet(box)) {
      setError('Boxes inside a pallet must be dispatched by dispatching the pallet.');
      return;
    }

    if (!isPallet && !isBoxFbaLabelUploaded(box, files)) {
      setError('Please upload the FBA label before marking this box dispatched.');
      return;
    }

    if (isPallet && !isBoxFbaLabelUploaded(box, files)) {
      setDispatchConfirm({
        title: 'Dispatch pallet without FBA label?',
        message: 'This pallet does not have an FBA label. Are you sure you want to dispatch this pallet without a pallet FBA label?',
        confirmLabel: 'Dispatch Pallet',
        action: () => runMarkBoxDispatched(boxId, isPallet),
      });
      return;
    }

    await runMarkBoxDispatched(boxId, isPallet);
  };

  const handleConfirmDispatchWarning = async () => {
    const action = dispatchConfirm?.action;
    setDispatchConfirm(null);
    if (typeof action === 'function') {
      await action();
    }
  };

  const handleBoxFbaLabel = (box, index) => {
    setError('');
    setMessage('');

    const labelFile = getBoxFbaLabelFile(box, files);
    if (labelFile && openOrDownloadFile(labelFile)) {
      setMessage(`FBA label opened for ${getBoxTitle(box, index)}.`);
      return;
    }

    setError('FBA label file is missing for this box.');
  };

  const handleUploadBoxFbaLabel = async (box, index, file) => {
    if (!file) return;

    const boxId = getBoxRecordId(box);
    if (!boxId) {
      setError('Box record UUID required before uploading an FBA label.');
      return;
    }

    const uploadKey = `fba-${boxId || index}`;

    try {
      setError('');
      setMessage('');
      setUploadingBoxLabelId(uploadKey);

      const formData = new FormData();
      formData.append('file', file, file.name);
      formData.append('entityType', isPalletBox(box) ? 'pallet' : 'box');
      formData.append('entityId', boxId);
      formData.append('fileType', 'fba_shipping_label');

      const response = await fetch(`${API_BASE_URL}/api/files`, {
        method: 'POST',
        headers: buildHeaders(),
        body: formData,
      });
      const payload = await parseResponse(response);
      const uploadedFile =
        payload?.file ||
        payload?.data?.file ||
        payload?.data ||
        (payload && typeof payload === 'object' ? payload : null) ||
        {};

      setFiles((currentFiles) =>
        mergeFileLists(currentFiles, [
          {
            ...uploadedFile,
            entityType: isPalletBox(box) ? 'pallet' : 'box',
            entity_type: isPalletBox(box) ? 'pallet' : 'box',
            entityId: boxId,
            entity_id: boxId,
            boxId,
            box_id: boxId,
            fileType: uploadedFile?.fileType || uploadedFile?.file_type || 'fba_shipping_label',
            file_type: uploadedFile?.file_type || uploadedFile?.fileType || 'fba_shipping_label',
            name: uploadedFile?.name || uploadedFile?.fileName || file.name,
            fileName: uploadedFile?.fileName || uploadedFile?.name || file.name,
            original_filename: uploadedFile?.original_filename || file.name,
          },
        ])
      );
      setBoxes((currentBoxes) =>
        currentBoxes.map((currentBox, currentIndex) => {
          const sameBox = getBoxRecordId(currentBox) === boxId || (!getBoxRecordId(currentBox) && currentIndex === index);
          return sameBox
            ? {
                ...currentBox,
                labelReady: true,
                label_ready: true,
                fbaLabelUploaded: true,
                fba_label_uploaded: true,
                labelUploaded: true,
                label_uploaded: true,
              }
            : currentBox;
        })
      );
      setMessage(`FBA label uploaded for ${getBoxTitle(box, index)}.`);
      await loadShipmentData({ showLoader: false });
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setUploadingBoxLabelId('');
    }
  };

  const handleDeleteBox = async () => {
    try {
      setError('');
      setMessage('');
      const response = await fetch(`${API_BASE_URL}/api/boxes/${deleteBoxId}`, {
        method: 'DELETE',
        headers: buildHeaders(),
      });
      await parseResponse(response);
      setMessage('Box deleted.');
      await loadShipmentData({ showLoader: false });
    } catch (requestError) {
      setError(requestError.message);
    }
  };

  const handleUploadFile = async () => {
    if (!selectedFile || !fileEntityId.trim()) {
      setError('File aur entity id required hain.');
      return;
    }
    const normalizedFileType = String(fileType || '').trim().toLowerCase();
    const normalizedEntityType = String(fileEntityType || '').trim().toLowerCase();
    if (normalizedFileType.includes('fnsku') && normalizedEntityType !== 'item') {
      setError('FNSKU labels must be uploaded against a shipment line item. Select entity type "item" and use the line item ID.');
      return;
    }
    try {
      setError('');
      setMessage('');
      const formData = new FormData();
      formData.append('file', selectedFile);
      formData.append('entityType', fileEntityType);
      formData.append('entityId', fileEntityId.trim());
      formData.append('fileType', fileType);
      const response = await fetch(`${API_BASE_URL}/api/files`, {
        method: 'POST',
        headers: buildHeaders(),
        body: formData,
      });
      await parseResponse(response);
      setMessage('File uploaded successfully.');
      setSelectedFile(null);
      await loadShipmentData({ showLoader: false });
    } catch (requestError) {
      setError(requestError.message);
    }
  };

  const resolveLineItemLabelFileForOpen = async (item, index) => {
    let labelFile = findLineItemLabelFile(item, files, lineItems.length, index);
    const labelFileId = String(getItemLabelFileId(item) || getFileRecordId(labelFile) || '').trim();
    const itemLookupIds = getItemLabelMatchIds(item)
      .map((value) => String(value || '').trim())
      .filter(Boolean)
      .filter((value, valueIndex, values) => values.indexOf(value) === valueIndex);

    for (const itemLookupId of itemLookupIds) {
      const entityFiles = await fetchFilesByEntity('item', itemLookupId);
      const decoratedFiles = entityFiles.map((file) => decorateItemLabelFile(file, item));
      const matchedFile =
        decoratedFiles.find((file) => labelFileId && String(getFileRecordId(file) || '').trim() === labelFileId) ||
        getPreferredLabelFile(decoratedFiles.filter((file) => isExactItemLabelFileMatch(file, item)));

      if (matchedFile) {
        labelFile = matchedFile;
        if (getFileUrl(matchedFile)) return matchedFile;
      }
    }

    if (labelFileId) {
      const freshFiles = await fetchFileById(labelFileId);
      const decoratedFiles = freshFiles.map((file) => decorateItemLabelFile(file, item));
      const freshLabel =
        decoratedFiles.find((file) => String(getFileRecordId(file) || '').trim() === labelFileId) ||
        getPreferredLabelFile(decoratedFiles.filter((file) => isExactItemLabelFileMatch(file, item)));

      if (freshLabel) labelFile = freshLabel;
    }

    return labelFile || null;
  };

  const handleLabelPdf = async (item, index) => {
    setError('');
    setMessage('');

    const uploadedLabel = await resolveLineItemLabelFileForOpen(item, index);
    if (uploadedLabel && openOrDownloadFile(uploadedLabel)) {
      setMessage('Label file opened.');
      return;
    }

    const sku = getItemSku(item) || '-';
    setError(`Uploaded FNSKU label file was not returned for SKU ${sku}.`);
  };

  const handleMarkPrepped = async () => {
    try {
      await handleStatusUpdate('prepped');
    } catch {
      // handled in shared request flow
    }
  };

  const currentStatus = normalizeShipmentStatusValue(shipment?.status);
  const currentStepIndex = statusSteps.indexOf(currentStatus);
  const getSubShipmentAvailabilityPrepared = (availabilityItem) =>
    isAvailabilityPrepared(availabilityItem);
  const getSubShipmentAvailabilityAvailableQty = (availabilityItem) =>
    getAvailabilityAvailableQty(availabilityItem);
  const subShipmentAvailabilityRows = sortAvailabilityRowsForDisplay(subShipmentAvailability);
  const sessionRole = String(getSession()?.role || getSession()?.rawUser?.role || '').toLowerCase();
  const hasPreparedSubShipmentAvailability = subShipmentAvailabilityRows.some((availabilityItem) =>
    Boolean(
      getAvailabilityItemId(availabilityItem) &&
        getSubShipmentAvailabilityPrepared(availabilityItem) &&
        getSubShipmentAvailabilityAvailableQty(availabilityItem) > 0
    )
  );
  const canCreateSubShipment =
    ['admin', 'staff'].includes(sessionRole) &&
    (SUB_SHIPMENT_CREATION_STATUSES.has(currentStatus) || hasPreparedSubShipmentAvailability);
  const shipmentInvoice = findInvoiceByType(shipment, 'shipment');
  const canShowShipmentInvoiceSection = isDispatchInvoiceEligibleStatus(currentStatus);
  const nextStatusIndex = currentStepIndex >= 0 ? currentStepIndex + 1 : 1;
  const nextStatus = statusSteps[nextStatusIndex] || '';
  const primaryStatusAction = (() => {
    if (currentStatus === 'completed' || !nextStatus) {
      return {
        label: 'Completed',
        onClick: undefined,
        disabled: true,
        title: 'Shipment is completed',
      };
    }

    if (nextStatus === 'dispatched') {
      return {
        label: 'Mark Dispatch',
        onClick: () => navigate('/dispatch'),
        title: 'Open dispatch queue to dispatch boxes',
      };
    }

    return {
      label: `Mark ${formatServiceLabel(nextStatus)}`,
      onClick: () => handleStatusUpdate(nextStatus),
      title: `Mark shipment ${formatServiceLabel(nextStatus).toLowerCase()}`,
    };
  })();

  return (
    <Layout>
      <FullPageLoader show={isLoading} label="Loading shipment..." />
      <div className="">
        <button onClick={() => navigate('/shipments')} className="flex items-center gap-2 text-gray-600 hover:text-gray-900 mb-6 text-sm">
          <ArrowLeft size={16} />
          Back to Shipments
        </button>

        <div className="mb-6 rounded-2xl border border-gray-200 bg-white p-6">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
            <div>
              <h1 className="text-2xl font-semibold text-[#132347]">{shipment?.reference || id}</h1>
              <div className="mt-2 flex flex-wrap items-center gap-x-5 gap-y-2 text-sm text-gray-500">
                <span>Client: <span className="font-medium text-gray-800">{getShipmentClientName(shipment)}</span></span>
                <span>Arrived: <span className="font-medium text-gray-800">{getShipmentArrived(shipment)}</span></span>
                <span>Assigned: <span className="font-medium text-gray-800">{shipment?.assignedStaff?.name || shipment?.assignedTo?.name || shipment?.assigned_to || 'Unassigned'}</span></span>
                <span>Units: <span className="font-medium text-gray-800">{getShipmentUnits(shipment)}</span></span>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <button onClick={() => setShowPrepTimeModal(true)} className="rounded-lg bg-[#ff9d3a] px-4 py-2 text-sm font-semibold text-white hover:bg-[#f28a18]">
                Prep Time
              </button>
              <span className="rounded-full bg-purple-100 px-3 py-1 text-xs font-semibold text-purple-700">
                {shipment?.status || 'In Progress'}
              </span>
              <select
                value={staffId}
                onChange={(e) => setStaffId(e.target.value)}
                disabled={isStaffLoading || !staffOptions.length}
                className={`min-w-[180px] rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm ${
                  staffId ? 'text-gray-900' : 'text-gray-400'
                }`}
              >
                <option value="">
                  {isStaffLoading ? 'Loading staff...' : staffOptions.length ? 'Select Staff' : 'No staff found'}
                </option>
                {staffOptions.map((staff) => (
                  <option key={staff.id} value={staff.id}>
                    {staff.label}
                  </option>
                ))}
              </select>
              <button
                onClick={handleAssignStaff}
                disabled={isStaffLoading || !staffId}
                className="rounded-lg border border-gray-200 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-60"
              >
                Assign Staff
              </button>
              <button
                onClick={primaryStatusAction.onClick}
                disabled={primaryStatusAction.disabled}
                title={primaryStatusAction.title}
                className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {primaryStatusAction.label}
              </button>
              <button onClick={loadShipmentData} className="inline-flex items-center gap-2 rounded-lg border border-gray-200 bg-white px-4 py-2 text-sm text-gray-700 hover:bg-gray-50">
                <RefreshCw size={15} />
                Refresh
              </button>
            </div>
          </div>

          <div className="mt-6 grid grid-cols-2 gap-3 md:grid-cols-6">
            {statusSteps.map((step, index) => {
              const isDone = currentStepIndex >= index;
              const isCurrent = currentStepIndex === index;
              const label = step.replace('_', ' ');
              return (
                <div key={step} className="flex items-center gap-2">
                  <span className={`flex h-6 w-6 items-center justify-center rounded-full text-[11px] font-semibold ${
                    isDone ? 'bg-emerald-500 text-white' : isCurrent ? 'bg-orange-400 text-white' : 'bg-gray-100 text-gray-400'
                  }`}>
                    {isDone && !isCurrent ? <CheckCircle2 size={14} /> : index + 1}
                  </span>
                  <span className={`text-xs font-medium capitalize ${isCurrent ? 'text-gray-900' : isDone ? 'text-gray-700' : 'text-gray-400'}`}>
                    {label}
                  </span>
                </div>
              );
            })}
          </div>
        </div>

        {canShowShipmentInvoiceSection ? (
          <div className="mb-6 rounded-2xl border border-gray-200 bg-white p-5">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <h3 className="text-sm font-semibold uppercase tracking-[0.16em] text-gray-500">Invoice</h3>
                {shipmentInvoice ? (
                  <p className="mt-2 text-sm text-gray-600">
                    {getInvoiceReference(shipmentInvoice)} - {getInvoiceStatusLabel(shipmentInvoice)}
                    {getInvoiceTotal(shipmentInvoice) !== '' ? ` - ${getInvoiceTotal(shipmentInvoice)}` : ''}
                  </p>
                ) : (
                  <p className="mt-2 text-sm text-gray-600">No shipment invoice is attached yet.</p>
                )}
              </div>
              <div className="flex flex-wrap gap-2">
                {shipmentInvoice ? (
                  <button
                    type="button"
                    onClick={() => navigate(`/billing?invoice=${encodeURIComponent(getInvoiceId(shipmentInvoice) || getInvoiceReference(shipmentInvoice))}`)}
                    className="rounded-lg border border-gray-200 bg-white px-4 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-50"
                  >
                    View Invoice
                  </button>
                ) : null}
                <button
                  type="button"
                  onClick={handleGenerateShipmentInvoice}
                  disabled={invoiceActionKey === `shipment:${id}`}
                  className={`rounded-lg px-4 py-2 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-60 ${
                    shipmentInvoice
                      ? 'border border-[#ffb37a] bg-white text-[#d76000] hover:bg-[#fff7ed]'
                      : 'bg-[#ff6900] text-white hover:bg-[#e55d00]'
                  }`}
                >
                  {invoiceActionKey === `shipment:${id}`
                    ? shipmentInvoice
                      ? 'Refreshing...'
                      : 'Generating...'
                    : shipmentInvoice
                      ? 'Refresh Invoice'
                      : 'Generate Invoice'}
                </button>
              </div>
            </div>
          </div>
        ) : null}

        {isLoading ? (
          <div className="rounded-xl border border-gray-200 bg-white p-10 text-center text-sm text-gray-500">
            <LoadingState label="Loading shipment..." size="lg" />
          </div>
        ) : shipment ? (
          <div className="">
            <div className="hidden grid-cols-1 gap-6 lg:grid-cols-3">
              <div className="rounded-xl border border-gray-200 bg-white p-6 lg:col-span-1">
                <h3 className="mb-4 text-sm font-semibold uppercase tracking-wider text-gray-500">Update Status</h3>
                <div className="flex gap-3">
                  <div className="relative flex-1">
                    <select value={statusValue} onChange={(e) => setStatusValue(e.target.value)} className="w-full appearance-none rounded-lg border border-gray-200 px-3 py-2.5 text-sm">
                      <option value="draft">draft</option>
                      <option value="submitted">submitted</option>
                      <option value="pending_arrival">pending_arrival</option>
                      <option value="received">received</option>
                      <option value="in_progress">in_progress</option>
                      <option value="prepped">prepped</option>
                      <option value="dispatched">dispatched</option>
                      <option value="completed">completed</option>
                    </select>
                    <ChevronDown size={16} className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-gray-400" />
                  </div>
                  <button onClick={() => handleStatusUpdate()} className="rounded-lg bg-[#ff6900] px-4 py-2.5 text-sm font-medium text-white hover:bg-[#e55d00]">Save</button>
                </div>
              </div>

            </div>

            {(subShipments.length || subShipmentAvailabilityRows.length || canCreateSubShipment) ? (
              <div className="mb-8 rounded-md border border-[#d9e3f2] bg-white p-5">
                <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <div>
                    <h3 className="text-[13px] font-semibold uppercase tracking-[0.18em] text-[#6d7b95]">Sub-shipments</h3>
                    <p className="mt-1 text-sm text-[#60708b]">
                      Parent shipment {shipment?.reference || id}
                    </p>
                  </div>
                  {canCreateSubShipment ? (
                    <button
                      type="button"
                      onClick={handleOpenSubShipmentModal}
                      disabled={isRefreshingSubShipmentAvailability || Boolean(updatingTaskId)}
                      className="inline-flex items-center justify-center gap-2 rounded-lg bg-[#ff6900] px-4 py-2 text-sm font-semibold text-white hover:bg-[#e55d00] disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      {isRefreshingSubShipmentAvailability ? <RefreshCw size={15} className="animate-spin" /> : <Plus size={15} />}
                      {isRefreshingSubShipmentAvailability ? 'Refreshing...' : 'Create Sub-shipment'}
                    </button>
                  ) : null}
                </div>

                {subShipmentAvailabilityRows.length ? (
                  <div className="mb-5 overflow-hidden rounded-lg border border-[#e2e8f0]">
                    <div className="bg-[#f8fafc] px-4 py-3 text-xs font-semibold uppercase tracking-wide text-[#64748b]">
                      Availability
                    </div>
                    <div className="overflow-x-auto">
                      <table className="w-full min-w-[820px] text-sm">
                        <thead className="bg-white">
                          <tr className="border-b border-[#edf2f7] text-left text-[11px] font-semibold uppercase tracking-wide text-[#7f8ea6]">
                            <th className="px-4 py-3">Product / SKU</th>
                            <th className="px-4 py-3">Expected</th>
                            <th className="px-4 py-3">Received</th>
                            <th className="px-4 py-3">Difference</th>
                            <th className="px-4 py-3">Assigned</th>
                            <th className="px-4 py-3">Remaining</th>
                            <th className="px-4 py-3">Prepared</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-[#f1f5f9]">
                          {subShipmentAvailabilityRows.map((availabilityItem, index) => {
                            const prepared = getSubShipmentAvailabilityPrepared(availabilityItem);
                            const remainingQty = getAvailabilityRemainingQty(availabilityItem);
                            const differenceQty = getAvailabilityDifferenceQty(availabilityItem);
                            const differenceClassName =
                              differenceQty > 0
                                ? 'text-emerald-700'
                                : differenceQty < 0
                                  ? 'text-red-600'
                                  : 'text-[#132347]';

                            return (
                              <tr key={getAvailabilityItemId(availabilityItem) || getAvailabilitySku(availabilityItem) || index}>
                                <td className="px-4 py-3">
                                  <p className="font-semibold text-[#132347]">{getAvailabilityProductName(availabilityItem) || '-'}</p>
                                  <p className="text-xs text-[#64748b]">{getAvailabilitySku(availabilityItem) || '-'}</p>
                                </td>
                                <td className="px-4 py-3 text-[#132347]">{formatQuantityValue(getAvailabilityExpectedQty(availabilityItem))}</td>
                                <td className="px-4 py-3 text-[#132347]">{formatQuantityValue(getAvailabilityReceivedQty(availabilityItem))}</td>
                                <td className={`px-4 py-3 font-semibold ${differenceClassName}`}>
                                  {formatAvailabilityDifferenceQty(differenceQty)}
                                </td>
                                <td className="px-4 py-3 text-[#132347]">{formatQuantityValue(getAvailabilityAssignedQty(availabilityItem))}</td>
                                <td className="px-4 py-3 text-[#132347]">{formatQuantityValue(remainingQty)}</td>
                                <td className="px-4 py-3">
                                  <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${
                                    prepared
                                      ? 'bg-emerald-50 text-emerald-700'
                                      : 'bg-gray-100 text-gray-600'
                                  }`}>
                                    {prepared ? 'Yes' : 'No'}
                                  </span>
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  </div>
                ) : null}

                {subShipments.length ? (
                  <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
                    {subShipments.map((subShipment, subShipmentIndex) => {
                      const subShipmentId = getSubShipmentId(subShipment);
                      const status = getSubShipmentStatus(subShipment);
                      const boxData = subShipmentBoxData[subShipmentId] || {};
                      const subBoxes = getSubShipmentBoxRows(subShipment, boxData);
                      const subVisiblePackages = getVisiblePackageRowsWithPalletChildren(
                        subBoxes.map((box) => decorateSubShipmentBoxForScope(box, subShipment)),
                        (childBox) => decorateSubShipmentBoxForScope(childBox, subShipment)
                      );
                      const subLooseBoxes = subVisiblePackages.filter((box) => !isPalletBox(box) && !isBoxInsidePallet(box));
                      const subChildBoxes = subVisiblePackages.filter((box) => !isPalletBox(box) && isBoxInsidePallet(box));
                      const subPallets = subVisiblePackages.filter((box) => isPalletBox(box));
                      const subDispatchablePackages = subVisiblePackages.filter((box) => isPalletBox(box) || !isBoxInsidePallet(box));
                      const allocationSummary = getSubShipmentResolvedAllocationSummary(subShipment, boxData, lineItems);
                      const items = getSubShipmentItems(subShipment);
                      const canDispatchBoxes = status !== 'cancelled';
                      const eligibleSubShipmentPalletBoxes = getEligiblePalletBoxesFromRows(subLooseBoxes);
                      const canAddSubShipmentBox =
                        Boolean(subShipmentId) && status !== 'cancelled' && getSubShipmentBoxableQuantity(subShipment, boxData) > 0;
                      const canAddSubShipmentPallet =
                        Boolean(subShipmentId) && status !== 'cancelled' && eligibleSubShipmentPalletBoxes.length > 0;
                      const subShipmentInvoice = findInvoiceByType(subShipment, 'sub_shipment');
                      const canShowSubShipmentInvoiceSection = isDispatchInvoiceEligibleStatus(status);

                      return (
                        <div key={subShipmentId || subShipmentIndex} className="overflow-hidden rounded-lg border border-[#dbe5f3] bg-[#f8fbff]">
                          <div className="border-b border-[#e4ecf8] bg-white px-4 py-4">
                            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                              <div>
                                <div className="flex flex-wrap items-center gap-2">
                                  <p className="text-[15px] font-semibold text-[#132347]">
                                    {getSubShipmentReference(subShipment)}
                                  </p>
                                  <span className="rounded-full bg-[#fff7ed] px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wide text-[#d76000]">
                                    {getSubShipmentStatusLabel(status)}
                                  </span>
                                </div>
                                <p className="mt-1 text-xs text-[#60708b]">
                                  {subLooseBoxes.length} loose box{subLooseBoxes.length !== 1 ? 'es' : ''} - {subPallets.length} pallet{subPallets.length !== 1 ? 's' : ''} - {subChildBoxes.length} box{subChildBoxes.length !== 1 ? 'es' : ''} inside pallet - {getSubShipmentLabelSummary(subVisiblePackages, files)} - {getSubShipmentDispatchSummary(subShipment, subDispatchablePackages)}
                                </p>
                              </div>
                              <div className="flex flex-wrap gap-2">
                                <button
                                  type="button"
                                  onClick={() => handleOpenSubShipmentBoxModal(subShipmentId, 'box')}
                                  disabled={!canAddSubShipmentBox}
                                  title={canAddSubShipmentBox ? 'Add box' : 'All SKU quantities are already boxed'}
                                  className="rounded-lg bg-[#132347] px-3 py-2 text-xs font-semibold text-white hover:bg-[#0f1b38] disabled:cursor-not-allowed disabled:opacity-60"
                                >
                                  Add Box
                                </button>
                                <button
                                  type="button"
                                  onClick={() => handleOpenSubShipmentBoxModal(subShipmentId, 'pallet')}
                                  disabled={!canAddSubShipmentPallet}
                                  title={canAddSubShipmentPallet ? 'Add pallet from this sub-shipment boxes' : 'No labeled loose boxes available for pallet'}
                                  className="rounded-lg bg-[#ff7a1a] px-3 py-2 text-xs font-semibold text-white hover:bg-[#f26f12] disabled:cursor-not-allowed disabled:opacity-60"
                                >
                                  Add Pallet
                                </button>
                                {/* <button
                                  type="button"
                                  onClick={() => handleRefreshSubShipmentBoxes(subShipmentId)}
                                  disabled={!subShipmentId}
                                  className="rounded-lg border border-[#d6dfef] bg-white px-3 py-2 text-xs font-semibold text-[#5f6d85] hover:bg-[#f8fafc] disabled:cursor-not-allowed disabled:opacity-60"
                                >
                                  View / Manage Boxes
                                </button> */}
                                {canShowSubShipmentInvoiceSection ? (
                                  <>
                                    {subShipmentInvoice ? (
                                    <button
                                      type="button"
                                      onClick={() => navigate(`/billing?invoice=${encodeURIComponent(getInvoiceId(subShipmentInvoice) || getInvoiceReference(subShipmentInvoice))}`)}
                                      className="rounded-lg border border-[#d6dfef] bg-white px-3 py-2 text-xs font-semibold text-[#5f6d85] hover:bg-[#f8fafc]"
                                    >
                                      View Invoice
                                    </button>
                                    ) : null}
                                    <button
                                      type="button"
                                      onClick={() => handleGenerateSubShipmentInvoice(subShipmentId)}
                                      disabled={!subShipmentId || invoiceActionKey === `sub-shipment:${subShipmentId}`}
                                      className={`rounded-lg px-3 py-2 text-xs font-semibold disabled:cursor-not-allowed disabled:opacity-60 ${
                                        subShipmentInvoice
                                          ? 'border border-[#ffb37a] bg-white text-[#d76000] hover:bg-[#fff7ed]'
                                          : 'bg-[#ff6900] text-white hover:bg-[#e55d00]'
                                      }`}
                                    >
                                      {invoiceActionKey === `sub-shipment:${subShipmentId}`
                                        ? subShipmentInvoice
                                          ? 'Refreshing...'
                                          : 'Generating...'
                                        : subShipmentInvoice
                                          ? 'Refresh Invoice'
                                          : 'Generate Invoice'}
                                    </button>
                                  </>
                                ) : null}
                              </div>
                            </div>
                            {canShowSubShipmentInvoiceSection ? (
                              <div className="rounded-md border border-[#e2e8f0] bg-white px-3 py-2 text-xs text-[#60708b]">
                                {subShipmentInvoice ? (
                                  <>
                                    Invoice {getInvoiceReference(subShipmentInvoice)} - {getInvoiceStatusLabel(subShipmentInvoice)}
                                  </>
                                ) : (
                                  'No sub-shipment invoice is attached yet.'
                                )}
                              </div>
                            ) : null}
                          </div>

                          <div className="space-y-4 p-4">
                            <div>
                              <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-[#7f8ea6]">Items</p>
                              {items.length ? (
                                <div className="space-y-2">
                                  {items.map((item, itemIndex) => {
                                    const lineItem = getSubShipmentItemLineItem(item);
                                    return (
                                      <div key={item?.id || getLineItemId(lineItem) || itemIndex} className="rounded-md border border-[#e2e8f0] bg-white px-3 py-2 text-sm">
                                        <div className="flex items-center justify-between gap-3">
                                          <div className="min-w-0">
                                            <p className="truncate font-semibold text-[#132347]">{getItemProductName(lineItem) || 'Product'}</p>
                                            <p className="text-xs text-[#64748b]">SKU {getItemSku(lineItem) || '-'}</p>
                                          </div>
                                          <span className="shrink-0 rounded-full bg-[#f3f6fb] px-2.5 py-1 text-xs font-semibold text-[#60708b]">
                                            {formatQuantityValue(getSubShipmentItemQuantity(item))}
                                          </span>
                                        </div>
                                      </div>
                                    );
                                  })}
                                </div>
                              ) : (
                                <p className="rounded-md border border-[#e2e8f0] bg-white px-3 py-2 text-xs text-[#64748b]">No items returned.</p>
                              )}
                            </div>

                            <div>
                              <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-[#7f8ea6]">Allocation</p>
                              {allocationSummary.length ? (
                                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                                  {allocationSummary.map((summary, index) => (
                                    <div key={getSubShipmentAllocationItemId(summary) || index} className="rounded-md border border-[#e2e8f0] bg-white px-3 py-2 text-xs text-[#64748b]">
                                      <p className="font-semibold text-[#132347]">{getAvailabilitySku(summary) || 'SKU'}</p>
                                      <p>Planned {formatQuantityValue(firstPresent(summary?.plannedQty, summary?.planned_qty, 0))} - Allocated {formatQuantityValue(firstPresent(summary?.allocated, summary?.allocatedQty, summary?.allocated_qty, 0))} - Remaining {formatQuantityValue(firstPresent(summary?.remainingQty, summary?.remaining_qty, 0))}</p>
                                    </div>
                                  ))}
                                </div>
                              ) : (
                                <p className="rounded-md border border-[#e2e8f0] bg-white px-3 py-2 text-xs text-[#64748b]">No allocation summary returned.</p>
                              )}
                            </div>

                            <div>
                              <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-[#7f8ea6]">Sub-shipment Boxes & Pallets</p>
                              {subVisiblePackages.length ? (
                                <div className="space-y-4">
                                  {subVisiblePackages.map((box, boxIndex) =>
                                    renderShipmentPackageCard(box, boxIndex, {
                                      shipmentStatus: status,
                                      canDispatchBoxes,
                                      packageRows: subVisiblePackages,
                                    })
                                  )}
                                </div>
                              ) : (
                                <p className="rounded-md border border-[#e2e8f0] bg-white px-3 py-2 text-xs text-[#64748b]">No boxes created for this sub-shipment.</p>
                              )}
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <p className="rounded-lg border border-dashed border-[#d9e3f2] bg-[#f8fbff] px-4 py-6 text-center text-sm text-[#64748b]">
                    No sub-shipments created yet.
                  </p>
                )}
              </div>
            ) : null}

            <div className="grid grid-cols-1 items-start gap-10 lg:grid-cols-2">
              <div className="space-y-6">
                <div className="rounded-none border-0 bg-transparent p-0">
                  <h3 className="mb-4 text-[12px] font-semibold uppercase tracking-[0.18em] text-[#6d7b95]">Line Items & Services</h3>
                  <div className="space-y-4">
                    {lineItems.length ? lineItems.map((item, index) => {
                      const itemId = getLineItemId(item);
                      const itemSku = getItemSku(item);
                      const itemName = getItemProductName(item);
                      const itemFnsku = getItemFnsku(item);
                      const expectedQty = getItemExpectedQty(item) || 0;
                      const receivedQty = getItemReceivedQty(item) || 0;
                      const itemServices = getLineItemServices(item, visibleServiceTasks, lineItems.length);
                      const itemOutboundPackages = getOutboundPackagesForLineItem(item);
                      const itemOutboundBoxes = itemOutboundPackages.boxes;
                      const itemOutboundPallets = itemOutboundPackages.pallets;
                      const itemDiscrepancies = discrepancies.filter((discrepancy, discrepancyIndex) =>
                        isDiscrepancyForItem(discrepancy, item, lineItems, discrepancyIndex)
                      );
                      return (
                      <div key={itemId || itemSku || index} className="overflow-hidden rounded-md border border-[#d9e3f2] bg-[#f5f9ff]">
                        <div className="flex items-start justify-between gap-4 border-b border-[#e4ecf8] px-4 py-4">
                          <div>
                            <p className="text-[15px] font-semibold leading-6 text-[#1b2a4a]">
                              SKU: {itemSku || '-'} {itemName ? `- ${itemName}` : ''}
                            </p>
                            <p className="mt-1 text-[12px] text-[#6b7a93]">
                              FNSKU: {itemFnsku || '-'} - Expected: {expectedQty} - Received: {receivedQty}
                            </p>
                          </div>
                          <button type="button" onClick={() => handleLabelPdf(item, index)} className="inline-flex shrink-0 items-center gap-1.5 rounded-md border border-[#d6dfef] bg-white px-3 py-2 text-[10px] font-semibold uppercase tracking-wide text-[#5f6d85] shadow-sm hover:bg-[#f8fbff]">
                            <ArrowDown size={12} />
                            Label PDF
                          </button>
                        </div>
                        <div className="space-y-3 px-4 py-4">
                          {itemServices.length ? itemServices.map((serviceName, serviceIndex) => {
                            const selectedStatus = getServiceDisplayStatus(serviceName, item, visibleServiceTasks, lineItems.length);
                            const matchedTask = getServiceTaskForLine(serviceName, item, visibleServiceTasks, lineItems.length);
                            const taskIdForService = getServiceTaskId(matchedTask || {});
                            const serviceUnits = getServiceUnits(matchedTask || {}, item);
                            const cannotMarkServiceDone = !Number.isFinite(serviceUnits) || serviceUnits <= 0;
                            return (
                              <div key={`${serviceName}-${serviceIndex}`} className="flex items-center justify-between gap-4">
                                <span className="text-[14px] text-[#60708b]">{formatServiceLabel(serviceName)}</span>
                                <div className="relative">
                                  <select
                                    value={selectedStatus}
                                    disabled={Boolean(taskIdForService && updatingTaskId === taskIdForService)}
                                    onChange={(event) => {
                                      if (!taskIdForService) return;
                                      const nextStatus = event.target.value === 'Done' ? 'DONE' : 'PENDING';
                                      if (nextStatus === 'DONE' && cannotMarkServiceDone) return;
                                      handleUpdateTask({
                                        taskId: taskIdForService,
                                        status: nextStatus,
                                        ...(nextStatus === 'DONE' ? { unitsDone: serviceUnits } : {}),
                                      });
                                    }}
                                    className="min-w-[120px] appearance-none rounded-md border border-[#d8e1ef] bg-white px-3 py-2 pr-8 text-[12px] font-semibold text-[#495a77] shadow-sm outline-none disabled:cursor-wait disabled:opacity-70"
                                  >
                                    <option disabled={selectedStatus !== 'Done' && cannotMarkServiceDone}>Done</option>
                                    <option>Pending</option>
                                  </select>
                                  <ChevronDown className="pointer-events-none absolute right-2 top-1/2 h-4 w-4 -translate-y-1/2 text-[#7d8aa2]" />
                                </div>
                              </div>
                            );
                          }) : (
                            <p className="text-sm text-[#7b889f]">No service tasks on this line item.</p>
                          )}

                          <div>
                            <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-[#6d7b95]">Outbound Boxes</p>
                            {itemOutboundBoxes.length ? (
                              <div className="space-y-2">
                                {itemOutboundBoxes.map(({ box, boxIndex }) => renderLineItemOutboundPackageCard(box, boxIndex))}
                              </div>
                            ) : (
                              <p className="rounded-md border border-[#dbe5f3] bg-white px-3 py-2 text-xs text-[#64748b]">No outbound boxes linked to this item.</p>
                            )}
                          </div>

                          <div>
                            <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-[#6d7b95]">Outbound Pallets</p>
                            {itemOutboundPallets.length ? (
                              <div className="space-y-2">
                                {itemOutboundPallets.map(({ box, boxIndex }) => renderLineItemOutboundPackageCard(box, boxIndex))}
                              </div>
                            ) : (
                              <p className="rounded-md border border-[#dbe5f3] bg-white px-3 py-2 text-xs text-[#64748b]">No outbound pallets linked to this item.</p>
                            )}
                          </div>

                          {itemDiscrepancies.length ? (
                            <div>
                              <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-amber-700">Discrepancies</p>
                              <div className="space-y-2">
                                {itemDiscrepancies.map((discrepancy, discrepancyIndex) => {
                                  const discrepancyLineItemId = firstPresent(getDiscrepancyLineItemId(discrepancy), getLineItemId(item));
                                  return (
                                    <div key={getDiscrepancyId(discrepancy) || discrepancyLineItemId || discrepancyIndex} className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2">
                                      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                                        <p className="text-[13px] font-semibold text-amber-900">{itemSku || getDiscrepancySku(discrepancy) || 'Line Item'}</p>
                                        <div className="flex flex-wrap items-center gap-2">
                                          <span className="rounded-full bg-white px-2 py-1 text-[10px] font-semibold text-amber-700">
                                            {discrepancy?.status || 'OPEN'}
                                          </span>
                                          <button
                                            type="button"
                                            onClick={() => handleOpenDiscrepancyResolve(discrepancy, item)}
                                            disabled={!discrepancyLineItemId}
                                            className="rounded-md bg-[#132347] px-2.5 py-1.5 text-[10px] font-semibold uppercase tracking-wide text-white hover:bg-[#0f1b38] disabled:cursor-not-allowed disabled:bg-gray-200 disabled:text-gray-500"
                                          >
                                            Update Received Qty
                                          </button>
                                        </div>
                                      </div>
                                      <p className="mt-1 text-[12px] text-amber-800">
                                        Expected {getDiscrepancyExpectedQty(discrepancy, item)}, received {getDiscrepancyReceivedQty(discrepancy, item)}, difference {formatQuantityValue(getDiscrepancyDifferenceQty(discrepancy, item))}
                                      </p>
                                    </div>
                                  );
                                })}
                              </div>
                            </div>
                          ) : null}
                        </div>
                      </div>
                      );
                    }) : (
                      <p className="text-sm text-gray-500">No line items found.</p>
                    )}
                  </div>
                </div>

                <div className="hidden rounded-xl border border-gray-200 bg-white p-6">
                  <h3 className="text-sm font-semibold uppercase tracking-wider text-gray-500">Shipment Notes</h3>
                  <div className="mt-4 rounded-lg border border-gray-200 bg-gray-50 p-4 text-sm text-gray-700">
                    {getShipmentNoteText(shipment) || 'No shipment notes added.'}
                  </div>
                  <ShipmentNoteAttachments attachments={getShipmentNoteAttachments(shipment, files)} />
                  <div className="mt-3 text-[11px] text-gray-400">
                    <span>Last edited: {shipment?.updated_at || shipment?.updatedAt || '2 hours ago'} </span>
                  </div>
                </div>
              </div>

              <div className="space-y-6">
                <div className="rounded-none border-0 bg-transparent p-0">
                  <div className="mb-4 flex items-center justify-between">
                    <h3 className="text-[12px] font-semibold uppercase tracking-[0.18em] text-[#6d7b95]">Parent Shipment Boxes & Pallets</h3>
                  </div>

                  <div className="space-y-4">
                    {parentShipmentBoxes.length ? parentShipmentBoxes.map((box, index) => {
                      const imageUrl = getBoxImageUrl(box, files);
                      const boxRecordId = getBoxRecordId(box);
                      const boxId = boxRecordId || getBoxId(box);
                      const isPallet = isPalletBox(box);
                      const insidePallet = isBoxInsidePallet(box);
                      const palletChildren = getPalletChildBoxes(box);
                      const labelState = getBoxLabelState(box, files);
                      const needsLabel = labelState.label === 'Label Needed';
                      const fbaUploadKey = `fba-${boxId || index}`;
                      const isUploadingFbaLabel = uploadingBoxLabelId === fbaUploadKey;
                      const boxDimensions = getBoxDimensions(box);
                      const boxWeight = getBoxWeight(box);
                      const fallbackLineItem = lineItems.length === 1
                        ? lineItems[0]
                        : lineItems[Math.min(index, Math.max(lineItems.length - 1, 0))];
                      const boxUnits = firstPresent(getBoxUnits(box, lineItems), getItemExpectedQty(fallbackLineItem || {}), '');
                      const boxStatus = getBoxDisplayStatus(box, currentStatus);
                      const boxSku = firstPresent(getBoxSkuValue(box, files, lineItems), getItemSku(fallbackLineItem || {}));
                      const skuSummary = firstPresent(
                        getBoxSkuSummary(box, files, lineItems),
                        boxSku && boxUnits !== '' ? `${formatQuantityValue(boxUnits)} UNITS (${boxSku})` : boxSku
                      );
                      const shipmentDispatchedOrCompleted = ['dispatched', 'completed', 'complete'].includes(currentStatus);
                      const palletLabelText = needsLabel ? 'Pallet FBA label missing' : 'Pallet FBA label uploaded';
                      return (
                      <div key={boxId || index} className={`overflow-hidden rounded-lg border bg-white shadow-sm transition hover:border-[#c8d5e8] hover:shadow-md ${
                        needsLabel
                          ? 'border-[#ffc9c9]'
                          : 'border-[#dbe5f3]'
                      }`}>
                        <div className={`h-1 ${needsLabel ? 'bg-[#ff7a7a]' : 'bg-[#22c55e]'}`} />
                        <div className="p-4">
                          <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                            <div className="flex min-w-0 items-start gap-3">
                              <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-sm font-semibold ${
                                needsLabel ? 'bg-red-50 text-red-600' : 'bg-emerald-50 text-emerald-700'
                              }`}>
                                {index + 1}
                              </div>
                              <div className="min-w-0">
                                <div className="flex flex-wrap items-center gap-2">
                                  <p className="truncate text-[15px] font-semibold text-[#132347]">{getBoxPalletLabel(box, index)}</p>
                                  <span className="rounded-full bg-[#f3f6fb] px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wide text-[#60708b]">
                                    {isPallet ? 'Pallet' : getBoxSize(box)}
                                  </span>
                                  {insidePallet ? (
                                    <span className="rounded-full bg-blue-50 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wide text-blue-700">
                                      Inside pallet {getBoxParentPalletLabel(box)}
                                    </span>
                                  ) : null}
                                </div>
                                <p className="mt-1 text-[12px] font-medium text-[#6b7a93]">
                                  {isPallet
                                    ? [boxDimensions, boxWeight ? `${boxWeight} KG` : '', `${palletChildren.length} box${palletChildren.length !== 1 ? 'es' : ''}`].filter(Boolean).join(' - ') || 'No pallet details'
                                    : [boxDimensions, boxWeight ? `${boxWeight} KG` : '', skuSummary].filter(Boolean).join(' - ') || 'No box details'}
                                </p>
                                {isPallet ? (
                                  <p className="mt-1 text-[12px] text-[#6b7a93]">{palletLabelText}</p>
                                ) : null}
                              </div>
                            </div>
                            <span className={`w-fit rounded-full px-3 py-1.5 text-[11px] font-semibold ${labelState.className}`}>
                              {isPallet ? (needsLabel ? 'Pallet Label Missing' : 'Pallet Label Ready') : labelState.label}
                            </span>
                          </div>

                          {isPallet ? (
                            <>
                              <div className="mt-4 grid grid-cols-2 gap-x-4 gap-y-3 border-t border-[#edf2f8] pt-4 text-[12px] text-[#132347] sm:grid-cols-4">
                                <div>
                                  <p className="text-[10px] font-semibold uppercase tracking-wide text-[#7f8ea6]">Status</p>
                                  <p className="mt-1 font-medium">{boxStatus}</p>
                                </div>
                                <div>
                                  <p className="text-[10px] font-semibold uppercase tracking-wide text-[#7f8ea6]">Pallet Weight</p>
                                  <p className="mt-1 font-medium">{boxWeight ? `${boxWeight} kg` : '-'}</p>
                                </div>
                                <div>
                                  <p className="text-[10px] font-semibold uppercase tracking-wide text-[#7f8ea6]">Pallet Dimensions</p>
                                  <p className="mt-1 font-medium">{boxDimensions || '-'}</p>
                                </div>
                                <div>
                                  <p className="text-[10px] font-semibold uppercase tracking-wide text-[#7f8ea6]">Boxes Inside</p>
                                  <p className="mt-1 font-medium">{palletChildren.length}</p>
                                </div>
                              </div>
                              <div className="mt-4 rounded-lg border border-[#edf2f8] bg-[#f8fbff] p-3">
                                <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                                  <p className="text-[11px] font-semibold uppercase tracking-wide text-[#60708b]">Boxes in this pallet</p>
                                  <span className="rounded-full bg-white px-2.5 py-1 text-[10px] font-semibold text-[#60708b]">
                                    {palletChildren.length} box{palletChildren.length !== 1 ? 'es' : ''}
                                  </span>
                                </div>
                                {palletChildren.length ? (
                                  <div className="space-y-2">
                                    {palletChildren.map((childBox, childIndex) => {
                                      const childDimensions = getBoxDimensions(childBox);
                                      const childWeight = getBoxWeight(childBox);
                                      const childSkuSummary = getBoxSkuSummary(childBox, files, lineItems);
                                      const childLabelUploaded = isBoxFbaLabelUploaded(childBox, files);

                                      return (
                                        <div key={getBoxRecordId(childBox) || getBoxId(childBox) || childIndex} className="rounded-md border border-[#dbe5f3] bg-white px-3 py-2">
                                          <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                                            <div className="min-w-0">
                                              <p className="truncate text-xs font-semibold text-[#132347]">{getBoxTitle(childBox, childIndex)}</p>
                                              <p className="mt-0.5 text-[11px] text-[#64748b]">
                                                {[childDimensions, childWeight ? `${childWeight} kg` : '', childSkuSummary].filter(Boolean).join(' - ') || 'No child box details'}
                                              </p>
                                            </div>
                                            <span className={`w-fit rounded-full px-2 py-0.5 text-[10px] font-semibold ${childLabelUploaded ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-600'}`}>
                                              {childLabelUploaded ? 'FBA label ready' : 'FBA label missing'}
                                            </span>
                                          </div>
                                        </div>
                                      );
                                    })}
                                  </div>
                                ) : (
                                  <p className="rounded-md border border-dashed border-[#dbe5f3] bg-white px-3 py-3 text-xs text-[#64748b]">No child boxes returned for this pallet.</p>
                                )}
                              </div>
                            </>
                          ) : (
                            <div className="mt-4 grid grid-cols-2 gap-x-4 gap-y-3 border-t border-[#edf2f8] pt-4 text-[12px] text-[#132347] sm:grid-cols-5">
                              <div>
                                <p className="text-[10px] font-semibold uppercase tracking-wide text-[#7f8ea6]">Status</p>
                                <p className="mt-1 font-medium">{boxStatus}</p>
                              </div>
                              <div>
                                <p className="text-[10px] font-semibold uppercase tracking-wide text-[#7f8ea6]">Weight</p>
                                <p className="mt-1 font-medium">{boxWeight ? `${boxWeight} kg` : '-'}</p>
                              </div>
                              <div>
                                <p className="text-[10px] font-semibold uppercase tracking-wide text-[#7f8ea6]">Dimensions</p>
                                <p className="mt-1 font-medium">{boxDimensions || '-'}</p>
                              </div>
                              <div>
                                <p className="text-[10px] font-semibold uppercase tracking-wide text-[#7f8ea6]">Units</p>
                                <p className={`mt-1 font-medium ${boxUnits !== '' ? '' : 'text-red-600'}`}>
                                  {boxUnits !== '' ? boxUnits : '-'}
                                </p>
                              </div>
                              <div>
                                <p className="text-[10px] font-semibold uppercase tracking-wide text-[#7f8ea6]">SKU</p>
                                <p className={`mt-1 break-words font-medium ${boxSku ? '' : 'text-red-600'}`}>
                                  {boxSku || 'SKU not allocated'}
                                </p>
                              </div>
                            </div>
                          )}

                          {(!needsLabel || isPallet) ? (
                            <div className="mt-4 flex flex-wrap gap-2">
                              {!needsLabel ? (
                                <button
                                  type="button"
                                  onClick={() => handleBoxFbaLabel(box, index)}
                                  className="rounded-[4px] bg-[#132347] px-3 py-2 text-[11px] font-semibold text-white hover:bg-[#0f1b38]"
                                >
                                  FBA Label
                                </button>
                              ) : null}
                              <button
                                type="button"
                                onClick={shipmentDispatchedOrCompleted || insidePallet ? undefined : () => handleMarkBoxDispatched(box)}
                                disabled={shipmentDispatchedOrCompleted || insidePallet || !boxRecordId}
                                className={`rounded-[4px] px-3 py-2 text-[11px] font-semibold text-white disabled:cursor-not-allowed ${
                                  shipmentDispatchedOrCompleted
                                    ? 'bg-emerald-600 disabled:opacity-100'
                                    : 'bg-[#ff9d20] hover:bg-[#f28a18] disabled:opacity-60'
                                }`}
                              >
                                {shipmentDispatchedOrCompleted ? 'Dispatched' : insidePallet ? 'Inside Pallet' : 'Mark Dispatched'}
                              </button>
                            </div>
                          ) : null}

                          {imageUrl ? (
                            <button type="button" onClick={() => window.open(imageUrl, '_blank', 'noopener,noreferrer')} className="mt-4 block w-full overflow-hidden rounded-[4px] border border-[#dbe4f1] bg-[#f7f9fc]">
                              <img src={imageUrl} alt={getBoxTitle(box, index)} className="h-32 w-full object-contain" />
                            </button>
                          ) : null}
                        </div>
                      </div>
                    );
                    }) : (
                      <p className="text-sm text-gray-500">No parent shipment boxes or pallets created yet.</p>
                    )}
                  </div>

                  <button
                    onClick={() => {
                      setActiveSubShipmentIdForBox('');
                      setBoxType('box');
                      setBoxNumber('');
                      setPalletNumber('');
                      resetAddBoxSkuSelection();
                      setSelectedPalletBoxIds([]);
                      setShowAddBoxModal(true);
                    }}
                    className="mt-4 w-full rounded-full border border-[#dfe6f2] bg-white px-4 py-3 text-[11px] font-semibold uppercase tracking-wide text-[#7f8ea6] hover:bg-gray-50"
                  >
                    + Add Box/Pallet
                  </button>
                </div>

                <div>
                  <h3 className="mb-5 text-[16px] font-normal uppercase  text-[#657187]">Shipment Notes</h3>
                  <div className="rounded-md border border-[#d9e3f2] bg-white p-6">
                    <p className="whitespace-pre-line text-[15px] leading-7 text-[#132347]">
                      {getShipmentNoteText(shipment) || 'No shipment notes added.'}
                    </p>
                    <ShipmentNoteAttachments attachments={getShipmentNoteAttachments(shipment, files)} />
                    {/* <div className="mt-5 border-t border-[#e8edf5] pt-4 text-[12px]">
                      <span className="text-[#9aa8bd]">Last edited: {shipment?.updated_at || shipment?.updatedAt || '2 hours ago'} </span>
                    </div> */}
                  </div>
                </div>

                <div>
                  <h3 className="mb-5 text-[16px] font-normal uppercase text-[#657187]">Order Data</h3>
                  <div className="rounded-md border border-[#d9e3f2] bg-white p-6">
                    {(() => {
                      const orderData = getShipmentOrderData(shipment);

                      return (
                        <div className="grid grid-cols-1 gap-4 text-[14px] text-[#132347] sm:grid-cols-3">
                          <div>
                            <p className="text-[11px] font-semibold uppercase tracking-wide text-[#7f8ea6]">Tracking</p>
                            <p className="mt-1 font-medium">{orderData.tracking || '-'}</p>
                          </div>
                          <div>
                            <p className="text-[11px] font-semibold uppercase tracking-wide text-[#7f8ea6]">Boxes</p>
                            <p className="mt-1 font-medium">{orderData.boxes || '-'}</p>
                          </div>
                          <div>
                            <p className="text-[11px] font-semibold uppercase tracking-wide text-[#7f8ea6]">Pallets</p>
                            <p className="mt-1 font-medium">{orderData.pallets || '-'}</p>
                          </div>
                        </div>
                      );
                    })()}
                  </div>
                </div>
              </div>
            </div>

            <div className="hidden grid-cols-1 gap-6 lg:grid-cols-2">
              <div className="rounded-xl border border-gray-200 bg-white p-6">
                <h3 className="mb-4 text-sm font-semibold uppercase tracking-wider text-gray-500">Discrepancies</h3>
                {discrepancies.length ? (
                  <div className="mb-4 space-y-3">
                    {discrepancies.map((item, index) => {
                      const discrepancyLineItem = item?.lineItem || item?.line_item || item;
                      const discrepancySku = getItemSku(discrepancyLineItem) || item?.lineItemId || item?.line_item_id || 'Line Item';
                      const expectedQty = firstPresent(item?.expectedQty, item?.expected_qty, item?.expected, getItemExpectedQty(discrepancyLineItem), 0);
                      const receivedQty = firstPresent(item?.receivedQty, item?.received_qty, item?.received, getItemReceivedQty(discrepancyLineItem), 0);
                      return (
                      <div key={getDiscrepancyId(item) || item?.lineItemId || item?.line_item_id || index} className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm">
                        <div className="flex items-center justify-between gap-3">
                          <p className="font-semibold text-amber-900">{discrepancySku}</p>
                          <div className="flex items-center gap-2">
                            <span className="rounded-full bg-white px-2 py-1 text-xs font-medium text-amber-700">
                              {item?.status || 'OPEN'}
                            </span>
                            {firstPresent(getDiscrepancyLineItemId(item), getLineItemId(discrepancyLineItem)) ? (
                              <button
                                type="button"
                                onClick={() => handleOpenDiscrepancyResolve(item, discrepancyLineItem)}
                                className="rounded-full bg-[#132347] px-2.5 py-1 text-xs font-semibold text-white hover:bg-[#0f1b38]"
                              >
                                Update Received Qty
                              </button>
                            ) : null}
                          </div>
                        </div>
                        <p className="mt-2 text-amber-800">
                          Expected {expectedQty}, received {receivedQty}
                        </p>
                        {item?.notes ? <p className="mt-1 text-xs text-amber-700">{item.notes}</p> : null}
                      </div>
                      );
                    })}
                  </div>
                ) : (
                  <p className="mb-4 rounded-lg border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-700">
                    No discrepancies found for this shipment.
                  </p>
                )}
                {/* <pre className="overflow-auto rounded-lg bg-gray-50 p-4 text-xs">{JSON.stringify(discrepancies, null, 2)}</pre> */}
              </div>
              <div className="rounded-xl border border-gray-200 bg-white p-6">
                <h3 className="mb-4 text-sm font-semibold uppercase tracking-wider text-gray-500">Services</h3>
                {visibleServiceTasks.length ? (
                  <div className="mb-4 space-y-3">
                    {visibleServiceTasks.map((service) => {
                      const serviceId = getServiceTaskId(service);
                      const serviceLineItem = findLineItemForServiceTask(service, lineItems);
                      const serviceStatus = String(service?.status || 'PENDING').toUpperCase();
                      const isDone = serviceStatus === 'DONE' || serviceStatus === 'COMPLETED';
                      const serviceUnits = getServiceUnits(service, serviceLineItem);
                      const cannotMarkServiceDone = !Number.isFinite(serviceUnits) || serviceUnits <= 0;
                      return (
                        <div key={service.displayId} className="rounded-lg border border-gray-200 bg-gray-50 p-3 text-sm">
                          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                            <div>
                              <p className="font-semibold text-gray-900">{getServiceTaskLabel(service) || 'Service Task'}</p>
                            </div>
                            <div className="flex items-center gap-2">
                              <span className="rounded-full bg-white px-2 py-1 text-xs font-medium text-gray-700">
                                {serviceStatus}
                              </span>
                              <button
                                type="button"
                                disabled={!serviceId || isDone || cannotMarkServiceDone || updatingTaskId === serviceId}
                                onClick={() => handleUpdateTask({ taskId: serviceId, status: 'DONE', unitsDone: serviceUnits })}
                                className="rounded-lg bg-[#ff6900] px-3 py-1.5 text-xs font-semibold text-white hover:bg-[#e55d00] disabled:cursor-not-allowed disabled:bg-gray-200 disabled:text-gray-500"
                              >
                                {updatingTaskId === serviceId ? 'Updating...' : isDone ? 'Done' : 'Mark Done'}
                              </button>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                ) : customServices.length ? (
                  <div className="mb-4 space-y-3">
                    {customServices.map((service) => (
                      <div key={service.id} className="rounded-lg border border-gray-200 bg-gray-50 p-3 text-sm">
                        <div className="flex items-center justify-between gap-3">
                          <div>
                            <p className="font-semibold text-gray-900">{service.name}</p>
                            <p className="text-xs text-gray-500">
                              SKU {service.sku} - Line Item {service.lineItemId || '-'}
                            </p>
                          </div>
                          <span className="rounded-full bg-white px-2 py-1 text-xs font-medium text-gray-700">
                            {service.status}
                          </span>
                        </div>
                        {typeof service.price === 'number' ? (
                          <p className="mt-2 text-xs text-gray-600">Price: {service.price}</p>
                        ) : null}
                      </div>
                    ))}
                  </div>
                ) : null}
                {/* <pre className="overflow-auto rounded-lg bg-gray-50 p-4 text-xs">{JSON.stringify(services, null, 2)}</pre> */}
                <div className="mt-4 space-y-3">
                  <input type="text" placeholder="taskId e.g. LINE_ITEM_UUID:fnsku_label" value={taskId} onChange={(e) => setTaskId(e.target.value)} className="w-full rounded-lg border border-gray-200 px-3 py-2.5 text-sm" />
                  <input type="text" placeholder="Status" value={taskStatus} onChange={(e) => setTaskStatus(e.target.value)} className="w-full rounded-lg border border-gray-200 px-3 py-2.5 text-sm" />
                  <input type="number" placeholder="Units Done" value={taskUnitsDone} onChange={(e) => setTaskUnitsDone(e.target.value)} className="w-full rounded-lg border border-gray-200 px-3 py-2.5 text-sm" />
                  <input type="text" placeholder="Notes" value={taskNotes} onChange={(e) => setTaskNotes(e.target.value)} className="w-full rounded-lg border border-gray-200 px-3 py-2.5 text-sm" />
                  <button onClick={() => handleUpdateTask()} className="rounded-lg bg-[#ff6900] px-4 py-2.5 text-sm font-medium text-white hover:bg-[#e55d00]">Update Single Task</button>
                </div>
              </div>
            </div>

            <div className="hidden grid-cols-1 gap-6 lg:grid-cols-2">
              <div className="rounded-xl border border-gray-200 bg-white p-6">
                <h3 className="mb-4 text-sm font-semibold uppercase tracking-wider text-gray-500">Bulk Service Status</h3>
                <div className="space-y-3">
                  <input type="text" placeholder="Service Type e.g. fnsku_label" value={bulkServiceType} onChange={(e) => setBulkServiceType(e.target.value)} className="w-full rounded-lg border border-gray-200 px-3 py-2.5 text-sm" />
                  <input type="text" placeholder="Status e.g. IN_PROGRESS" value={bulkStatus} onChange={(e) => setBulkStatus(e.target.value)} className="w-full rounded-lg border border-gray-200 px-3 py-2.5 text-sm" />
                  <button onClick={handleBulkServiceUpdate} className="rounded-lg bg-[#ff6900] px-4 py-2.5 text-sm font-medium text-white hover:bg-[#e55d00]">Update All</button>
                </div>
              </div>

              <div className="rounded-xl border border-gray-200 bg-white p-6">
                <h3 className="mb-4 text-sm font-semibold uppercase tracking-wider text-gray-500">Add Custom Service</h3>
                <div className="space-y-3">
                  <input type="text" placeholder="Line Item UUID" value={customServiceLineItemId} onChange={(e) => setCustomServiceLineItemId(e.target.value)} className="w-full rounded-lg border border-gray-200 px-3 py-2.5 text-sm" />
                  <input type="text" placeholder="Service Name" value={customServiceName} onChange={(e) => setCustomServiceName(e.target.value)} className="w-full rounded-lg border border-gray-200 px-3 py-2.5 text-sm" />
                  <input type="number" step="0.01" placeholder="Price" value={customServicePrice} onChange={(e) => setCustomServicePrice(e.target.value)} className="w-full rounded-lg border border-gray-200 px-3 py-2.5 text-sm" />
                  <button onClick={handleAddCustomService} className="rounded-lg bg-[#132347] px-4 py-2.5 text-sm font-medium text-white hover:bg-[#0f1b38]">Add Service</button>
                </div>
                <div className="mt-6 space-y-3 border-t border-gray-200 pt-4">
                  <input type="text" placeholder="Line Item UUID" value={customServiceStatusLineItemId} onChange={(e) => setCustomServiceStatusLineItemId(e.target.value)} className="w-full rounded-lg border border-gray-200 px-3 py-2.5 text-sm" />
                  <input type="text" placeholder="Custom Service Name" value={customServiceStatusName} onChange={(e) => setCustomServiceStatusName(e.target.value)} className="w-full rounded-lg border border-gray-200 px-3 py-2.5 text-sm" />
                  <input type="text" placeholder="Status" value={customServiceStatusValue} onChange={(e) => setCustomServiceStatusValue(e.target.value)} className="w-full rounded-lg border border-gray-200 px-3 py-2.5 text-sm" />
                  <button onClick={handleUpdateCustomServiceStatus} className="rounded-lg border border-gray-300 bg-white px-4 py-2.5 text-sm font-medium text-gray-700 hover:bg-gray-50">Update Custom Service Status</button>
                </div>
              </div>
            </div>


            <div className="hidden grid-cols-1 gap-6 lg:grid-cols-3">
              <div className="rounded-xl border border-gray-200 bg-white p-6">
                <h3 className="mb-4 text-sm font-semibold uppercase tracking-wider text-gray-500">Create Box / Pallet</h3>
                <div className="space-y-3">
                  <input type="text" placeholder="box or pallet" value={boxType} onChange={(e) => setBoxType(e.target.value)} className="w-full rounded-lg border border-gray-200 px-3 py-2.5 text-sm" />
                  {boxType !== 'pallet' ? (
                    <input type="text" placeholder="Box Number (optional)" value={boxNumber} onChange={(e) => setBoxNumber(e.target.value)} className="w-full rounded-lg border border-gray-200 px-3 py-2.5 text-sm" />
                  ) : null}
                  <input type="text" placeholder="Size" value={boxSize} onChange={(e) => setBoxSize(e.target.value)} className="w-full rounded-lg border border-gray-200 px-3 py-2.5 text-sm" />
                  <input type="number" step="0.01" placeholder="Weight" value={boxWeight} onChange={(e) => setBoxWeight(e.target.value)} className="w-full rounded-lg border border-gray-200 px-3 py-2.5 text-sm" />
                  <div className="grid grid-cols-3 gap-2">
                    <input type="number" placeholder="L" value={boxLength} onChange={(e) => setBoxLength(e.target.value)} className="rounded-lg border border-gray-200 px-3 py-2.5 text-sm" />
                    <input type="number" placeholder="W" value={boxWidth} onChange={(e) => setBoxWidth(e.target.value)} className="rounded-lg border border-gray-200 px-3 py-2.5 text-sm" />
                    <input type="number" placeholder="H" value={boxHeight} onChange={(e) => setBoxHeight(e.target.value)} className="rounded-lg border border-gray-200 px-3 py-2.5 text-sm" />
                  </div>
                  <div className="flex gap-2">
                    <button onClick={() => handleCreateBox(false)} className="rounded-lg bg-[#ff6900] px-4 py-2.5 text-sm font-medium text-white hover:bg-[#e55d00]">Create Box</button>
                    <button
                      onClick={() => {
                        setActiveSubShipmentIdForBox('');
                        setBoxType('pallet');
                        setBoxNumber('');
                        setPalletNumber('');
                        resetAddBoxSkuSelection();
                        setSelectedPalletBoxIds([]);
                        setShowAddBoxModal(true);
                      }}
                      className="rounded-lg border border-gray-300 bg-white px-4 py-2.5 text-sm font-medium text-gray-700 hover:bg-gray-50"
                    >
                      Create Pallet
                    </button>
                  </div>
                </div>
              </div>

              <div className="rounded-xl border border-gray-200 bg-white p-6">
                <h3 className="mb-4 text-sm font-semibold uppercase tracking-wider text-gray-500">Box Operations</h3>
                <div className="space-y-3">
                  <input type="text" placeholder="Box UUID" value={addToBoxBoxId} onChange={(e) => setAddToBoxBoxId(e.target.value)} className="w-full rounded-lg border border-gray-200 px-3 py-2.5 text-sm" />
                  <input type="text" placeholder="Line Item UUID" value={addToBoxLineItemId} onChange={(e) => setAddToBoxLineItemId(e.target.value)} className="w-full rounded-lg border border-gray-200 px-3 py-2.5 text-sm" />
                  <input type="number" placeholder="Quantity" value={addToBoxQuantity} onChange={(e) => setAddToBoxQuantity(e.target.value)} className="w-full rounded-lg border border-gray-200 px-3 py-2.5 text-sm" />
                  <button onClick={handleAddItemToBox} className="rounded-lg bg-[#132347] px-4 py-2.5 text-sm font-medium text-white hover:bg-[#0f1b38]">Add Item To Box</button>
                  <input type="text" placeholder="Remove From Box UUID" value={removeFromBoxBoxId} onChange={(e) => setRemoveFromBoxBoxId(e.target.value)} className="w-full rounded-lg border border-gray-200 px-3 py-2.5 text-sm" />
                  <input type="text" placeholder="Content Entry Item ID" value={removeFromBoxItemId} onChange={(e) => setRemoveFromBoxItemId(e.target.value)} className="w-full rounded-lg border border-gray-200 px-3 py-2.5 text-sm" />
                  <button onClick={handleRemoveItemFromBox} className="rounded-lg border border-gray-300 bg-white px-4 py-2.5 text-sm font-medium text-gray-700 hover:bg-gray-50">Remove Item From Box</button>
                </div>
              </div>

              <div className="rounded-xl border border-gray-200 bg-white p-6">
                <h3 className="mb-4 text-sm font-semibold uppercase tracking-wider text-gray-500">Seal / Delete Box</h3>
                <div className="space-y-3">
                  <input type="text" placeholder="Seal Box UUID" value={sealBoxId} onChange={(e) => setSealBoxId(e.target.value)} className="w-full rounded-lg border border-gray-200 px-3 py-2.5 text-sm" />
                  <input type="text" placeholder="Tracking Code" value={sealTrackingCode} onChange={(e) => setSealTrackingCode(e.target.value)} className="w-full rounded-lg border border-gray-200 px-3 py-2.5 text-sm" />
                  <button onClick={handleSealBox} className="rounded-lg bg-[#ff6900] px-4 py-2.5 text-sm font-medium text-white hover:bg-[#e55d00]">Seal Box</button>
                  <input type="text" placeholder="Delete Box UUID" value={deleteBoxId} onChange={(e) => setDeleteBoxId(e.target.value)} className="w-full rounded-lg border border-gray-200 px-3 py-2.5 text-sm" />
                  <button onClick={handleDeleteBox} className="rounded-lg border border-red-300 bg-red-50 px-4 py-2.5 text-sm font-medium text-red-700 hover:bg-red-100">Delete Box</button>
                </div>
              </div>
            </div>

          </div>
        ) : null}

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

        {showSubShipmentModal ? (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
            <div className="max-h-[90vh] w-full max-w-3xl overflow-hidden rounded-2xl bg-white shadow-xl">
              <div className="flex items-center justify-between border-b border-gray-200 px-6 py-4">
                <h3 className="text-lg font-semibold text-[#132347]">Create Sub-shipment</h3>
                <button
                  type="button"
                  onClick={() => {
                    if (isCreatingSubShipment) return;
                    setShowSubShipmentModal(false);
                    resetSubShipmentCreateForm();
                  }}
                  disabled={isCreatingSubShipment}
                  className="rounded-full p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-700 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <X size={18} />
                </button>
              </div>

              <div className="max-h-[calc(90vh-145px)] space-y-4 overflow-y-auto p-6">
                <div>
                  <label className="mb-2 block text-[11px] font-semibold uppercase tracking-wide text-gray-400">Notes</label>
                  <textarea
                    value={subShipmentNotes}
                    onChange={(event) => setSubShipmentNotes(event.target.value)}
                    className="min-h-20 w-full rounded-lg border border-gray-200 px-3 py-2.5 text-sm focus:border-[#ff9900] focus:outline-none focus:ring-2 focus:ring-orange-100"
                    placeholder="Optional"
                  />
                </div>

                <div className="overflow-hidden rounded-lg border border-[#e2e8f0]">
                  <div className="grid grid-cols-[44px_minmax(0,1fr)_110px_110px] bg-[#f8fafc] px-4 py-3 text-[11px] font-semibold uppercase tracking-wide text-[#64748b]">
                    <span />
                    <span>Product / SKU</span>
                    <span>Available</span>
                    <span>Quantity</span>
                  </div>
                  <div className="max-h-72 overflow-y-auto divide-y divide-[#f1f5f9]">
                    {subShipmentAvailabilityRows.map((availabilityItem, index) => {
                      const availabilityId = getAvailabilityItemId(availabilityItem);
                      const availableQty = getSubShipmentAvailabilityAvailableQty(availabilityItem);
                      const prepared = getSubShipmentAvailabilityPrepared(availabilityItem);
                      const selectable = Boolean(prepared && availableQty > 0 && availabilityId);
                      const selection = subShipmentSelections[availabilityId] || {};

                      return (
                        <div
                          key={availabilityId || getAvailabilitySku(availabilityItem) || index}
                          className={`grid grid-cols-[44px_minmax(0,1fr)_110px_110px] items-center gap-3 px-4 py-3 text-sm ${
                            selectable ? 'bg-white' : 'bg-gray-50 text-gray-400'
                          }`}
                        >
                          <input
                            type="checkbox"
                            checked={Boolean(selection.selected)}
                            disabled={!selectable}
                            onChange={(event) => handleSubShipmentSelectionChange(availabilityItem, 'selected', event.target.checked)}
                            className="h-4 w-4 accent-[#ff6900] disabled:cursor-not-allowed"
                          />
                          <div className="min-w-0">
                            <p className="truncate font-semibold text-[#132347]">{getAvailabilityProductName(availabilityItem) || '-'}</p>
                            <p className="text-xs text-[#64748b]">
                              SKU {getAvailabilitySku(availabilityItem) || '-'} - Prepared {prepared ? 'Yes' : 'No'}
                            </p>
                          </div>
                          <span className="font-medium text-[#132347]">{formatQuantityValue(availableQty)}</span>
                          <input
                            type="number"
                            min="1"
                            step="1"
                            max={availableQty}
                            value={selection.quantity || ''}
                            disabled={!selectable}
                            onChange={(event) => handleSubShipmentSelectionChange(availabilityItem, 'quantity', event.target.value)}
                            className="min-w-0 rounded-lg border border-gray-200 px-3 py-2 text-sm disabled:bg-gray-100 disabled:text-gray-400"
                          />
                        </div>
                      );
                    })}
                    {!subShipmentAvailabilityRows.length ? (
                      <div className="px-4 py-8 text-center text-sm text-gray-500">
                        No availability rows returned.
                      </div>
                    ) : null}
                  </div>
                </div>
              </div>

              <div className="flex justify-end gap-3 border-t border-gray-200 px-6 py-4">
                <button
                  type="button"
                  onClick={() => {
                    if (isCreatingSubShipment) return;
                    setShowSubShipmentModal(false);
                    resetSubShipmentCreateForm();
                  }}
                  disabled={isCreatingSubShipment}
                  className="rounded-lg border border-gray-300 px-4 py-2 text-sm text-gray-700 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleCreateSubShipment}
                  disabled={isCreatingSubShipment}
                  className="inline-flex min-w-[128px] items-center justify-center gap-2 rounded-lg bg-[#ff6900] px-5 py-2 text-sm font-semibold text-white hover:bg-[#e55d00] disabled:cursor-not-allowed disabled:opacity-70"
                >
                  {isCreatingSubShipment ? (
                    <>
                      <RefreshCw size={14} className="animate-spin" />
                      Creating...
                    </>
                  ) : (
                    'Create'
                  )}
                </button>
              </div>
            </div>
          </div>
        ) : null}

        {showPrepTimeModal ? (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
            <div className="w-full max-w-md rounded-2xl bg-white shadow-xl">
              <div className="flex items-center justify-between border-b border-gray-200 px-6 py-4">
                <h3 className="text-lg font-semibold text-[#132347]">Shipment Preparation Time</h3>
                <button onClick={() => setShowPrepTimeModal(false)} className="rounded-full p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-700">
                  <X size={18} />
                </button>
              </div>
              <div className="p-6">
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="mb-2 block text-xs font-semibold uppercase tracking-wide text-gray-400">Starting time</label>
                    <input type="time" value={prepStartTime} onChange={(e) => setPrepStartTime(e.target.value)} className="w-full rounded border border-gray-300 px-3 py-2.5 text-sm" />
                  </div>
                  <div>
                    <label className="mb-2 block text-xs font-semibold uppercase tracking-wide text-gray-400">Ending time</label>
                    <input type="time" value={prepEndTime} onChange={(e) => setPrepEndTime(e.target.value)} className="w-full rounded border border-gray-300 px-3 py-2.5 text-sm" />
                  </div>
                </div>
              </div>
              <div className="flex justify-end gap-3 border-t border-gray-200 px-6 py-4">
                <button onClick={() => setShowPrepTimeModal(false)} className="rounded-lg border border-gray-300 px-4 py-2 text-sm text-gray-700 hover:bg-gray-50">Cancel</button>
                <button onClick={() => setShowPrepTimeModal(false)} className="rounded-lg bg-[#ff9d3a] px-5 py-2 text-sm font-semibold text-white hover:bg-[#f28a18]">Save</button>
              </div>
            </div>
          </div>
        ) : null}

        {showAddBoxModal ? (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
            <div className="max-h-[90vh] w-full max-w-lg overflow-hidden rounded-2xl bg-white shadow-xl">
              <div className="flex items-center justify-between border-b border-gray-200 px-6 py-4">
                <h3 className="text-lg font-semibold text-[#132347]">
                  {activeSubShipmentForBox
                    ? `${boxType === 'pallet' ? 'Add Pallet' : 'Add Box'} - ${getSubShipmentReference(activeSubShipmentForBox)}`
                    : 'Add Box / Pallet'}
                </h3>
                <button
                  onClick={() => {
                    if (isCreatingBox) return;
                    setShowAddBoxModal(false);
                    setActiveSubShipmentIdForBox('');
                    setBoxNumber('');
                    setPalletNumber('');
                    resetAddBoxSkuSelection();
                    setSelectedPalletBoxIds([]);
                  }}
                  disabled={isCreatingBox}
                  className="rounded-full p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-700 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <X size={18} />
                </button>
              </div>
              <div className="max-h-[calc(90vh-140px)] space-y-4 overflow-y-auto p-6">
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="mb-2 block text-[11px] font-semibold uppercase tracking-wide text-gray-400">Box Type</label>
                    <select
                      value={boxType}
                      onChange={(e) => {
                        setBoxType(e.target.value);
                        if (e.target.value === 'pallet') {
                          setBoxNumber('');
                        } else {
                          setPalletNumber('');
                          setSelectedPalletBoxIds([]);
                        }
                      }}
                      className="w-full rounded-lg border border-gray-200 px-3 py-2.5 text-sm"
                    >
                      <option value="box">Box</option>
                      <option value="pallet">Pallet</option>
                    </select>
                  </div>
                  <div>
                    <label className="mb-2 block text-[11px] font-semibold uppercase tracking-wide text-gray-400">
                      {boxType === 'pallet' ? 'Boxes with FBA labels' : 'Size'}
                    </label>
                    {boxType === 'pallet' ? (
                      <div className="max-h-[150px] overflow-y-auto rounded-lg border border-gray-200 bg-white p-2">
                        {eligiblePalletBoxes.length ? (
                          <div className="space-y-2">
                            {eligiblePalletBoxes.map((box, index) => {
                              const childBoxId = getBoxRecordId(box) || getBoxId(box);
                              const checked = selectedPalletBoxIds.includes(childBoxId);

                              return (
                                <label key={childBoxId || index} className="flex cursor-pointer items-start gap-2 rounded-md px-2 py-1.5 hover:bg-gray-50">
                                  <input
                                    type="checkbox"
                                    checked={checked}
                                    onChange={() => togglePalletBoxSelection(childBoxId)}
                                    className="mt-1 h-4 w-4 accent-[#ff9d3a]"
                                  />
                                  <span className="min-w-0">
                                    <span className="block truncate text-sm font-semibold text-[#132347]">{getBoxTitle(box, index)}</span>
                                    <span className="block truncate text-[11px] text-[#6b7280]">
                                      {[getBoxDimensions(box), getBoxWeight(box) ? `${getBoxWeight(box)} kg` : '', getBoxSkuSummary(box, files, lineItems)].filter(Boolean).join(' - ') || 'Ready for pallet'}
                                    </span>
                                  </span>
                                </label>
                              );
                            })}
                          </div>
                        ) : (
                          <p className="px-2 py-3 text-xs text-gray-500">
                            No eligible labeled loose boxes are available for this {activeSubShipmentForBox ? 'sub-shipment' : 'shipment'}.
                          </p>
                        )}
                      </div>
                    ) : (
                      <select value={boxSize} onChange={(e) => setBoxSize(e.target.value)} className="w-full rounded-lg border border-gray-200 px-3 py-2.5 text-sm">
                        <option value="small">Small</option>
                        <option value="medium">Medium</option>
                        <option value="large">Large</option>
                      </select>
                    )}
                  </div>
                </div>
                {boxType === 'pallet' && selectedPalletBoxes.length ? (
                  <div className="rounded-lg border border-[#ffe1c2] bg-[#fff7ef] px-3 py-2 text-xs text-[#8a4a12]">
                    {selectedPalletBoxes.length} box{selectedPalletBoxes.length !== 1 ? 'es' : ''} selected for this pallet.
                  </div>
                ) : null}
                {boxType === 'pallet' ? (
                  <div>
                    <label className="mb-2 block text-[11px] font-semibold uppercase tracking-wide text-gray-400">Pallet Number</label>
                    <input
                      type="text"
                      value={palletNumber}
                      onChange={(event) => setPalletNumber(event.target.value)}
                      placeholder="e.g. Pallet A"
                      className="w-full rounded-lg border border-gray-200 px-3 py-2.5 text-sm"
                    />
                    <p className="mt-1 text-[11px] text-gray-400">Optional saved display label for this pallet.</p>
                  </div>
                ) : (
                  <div>
                    <label className="mb-2 block text-[11px] font-semibold uppercase tracking-wide text-gray-400">Box Number</label>
                    <input
                      type="text"
                      value={boxNumber}
                      onChange={(event) => setBoxNumber(event.target.value)}
                      placeholder="A-01, Box 1, FBA-BOX-5"
                      className="w-full rounded-lg border border-gray-200 px-3 py-2.5 text-sm"
                    />
                    <p className="mt-1 text-[11px] text-gray-400">Optional. Leave blank to auto-generate the box number.</p>
                  </div>
                )}
                <div>
                  <label className="mb-2 block text-[11px] font-semibold uppercase tracking-wide text-gray-400">Dimensions (cm)</label>
                  <div className="grid grid-cols-3 gap-3">
                    <input type="number" placeholder="Length" value={boxLength} onChange={(e) => setBoxLength(e.target.value)} className="rounded-lg border border-gray-200 px-3 py-2.5 text-sm" />
                    <input type="number" placeholder="Width" value={boxWidth} onChange={(e) => setBoxWidth(e.target.value)} className="rounded-lg border border-gray-200 px-3 py-2.5 text-sm" />
                    <input type="number" placeholder="Height" value={boxHeight} onChange={(e) => setBoxHeight(e.target.value)} className="rounded-lg border border-gray-200 px-3 py-2.5 text-sm" />
                  </div>
                </div>
                <div>
                  <label className="mb-2 block text-[11px] font-semibold uppercase tracking-wide text-gray-400">Weight (kg)</label>
                  <input type="number" step="0.01" value={boxWeight} onChange={(e) => setBoxWeight(e.target.value)} className="w-full rounded-lg border border-gray-200 px-3 py-2.5 text-sm" />
                </div>
                {boxType !== 'pallet' ? (
                <div>
                  <label className="mb-2 block text-[11px] font-semibold uppercase tracking-wide text-gray-400">SKU (Line Item + Qty)</label>
                  <div className="grid min-w-0 grid-cols-1 gap-3 sm:grid-cols-[minmax(0,1fr)_96px]">
                    <select value={boxSkuPreview} onChange={(e) => handleBoxSkuPreviewChange(e.target.value)} className="min-w-0 w-full truncate rounded-lg border border-gray-200 px-3 py-2.5 text-sm">
                      <option value="">Select SKU</option>
                      {boxSelectionLineItems.map((item, index) => {
                        const optionValue = getLineItemOptionValue(item);
                        const availableQty = getLineItemAllocatableQuantity(item, boxSelectionBoxes, boxSelectionLineItems);

                        return (
                          <option key={optionValue || index} value={optionValue} disabled={availableQty <= 0 || isBoxSkuOptionSelectedElsewhere(optionValue, 0)}>
                            {getItemSku(item) || getLineItemId(item) || '-'}
                          </option>
                        );
                      })}
                    </select>
                    <input
                      type="number"
                      min="1"
                      step="1"
                      max={selectedBoxMaxQuantity || undefined}
                      value={boxSkuQuantityPreview}
                      onChange={(e) => handleBoxSkuQuantityPreviewChange(e.target.value)}
                      placeholder={selectedBoxLineItem && selectedBoxMaxQuantity <= 0 ? '0' : selectedBoxMaxQuantity ? formatQuantityValue(selectedBoxMaxQuantity) : 'Qty'}
                      disabled={Boolean(selectedBoxLineItem) && selectedBoxMaxQuantity <= 0}
                      className="min-w-0 w-full rounded-lg border border-gray-200 px-3 py-2.5 text-sm disabled:bg-gray-100 disabled:text-gray-400"
                    />
                  </div>
                  {selectedBoxLineItem ? (
                    <p className="mt-2 text-[11px] font-medium text-[#6b7a93]">
                      {activeSubShipmentForBox ? 'Planned' : 'Boxable'} {formatQuantityValue(selectedBoxBoxableQty)} units, already boxed {formatQuantityValue(selectedBoxAllocatedQty)}, available {formatQuantityValue(selectedBoxMaxQuantity)}.
                    </p>
                  ) : null}
                  {boxSkuExtraRows.length ? (
                    <div className="mt-3 space-y-3">
                      {boxSkuExtraRows.map((row, rowIndex) => {
                        const rowLineItem = findLineItemBySelection(row.lineItemValue);
                        const rowMaxQuantity = rowLineItem ? getLineItemAllocatableQuantity(rowLineItem, boxSelectionBoxes, boxSelectionLineItems) : 0;
                        const rowBoxableQty = rowLineItem ? getLineItemBoxableQuantity(rowLineItem) : 0;
                        const rowAllocatedQty = rowLineItem
                          ? activeSubShipmentForBox
                            ? Number(rowLineItem.__subShipmentAllocatedQty || 0)
                            : getAllocatedQuantityForLineItem(rowLineItem, boxSelectionBoxes, boxSelectionLineItems)
                          : 0;
                        const visualRowIndex = rowIndex + 1;

                        return (
                          <div key={`extra-sku-${rowIndex}`} className="space-y-2 rounded-lg border border-gray-100 bg-gray-50 p-2.5">
                            <div className="grid min-w-0 grid-cols-1 gap-2 sm:grid-cols-[minmax(0,1fr)_96px_36px]">
                              <select
                                value={row.lineItemValue}
                                onChange={(e) => handleBoxSkuExtraRowChange(rowIndex, 'lineItemValue', e.target.value)}
                                className="min-w-0 w-full truncate rounded-lg border border-gray-200 bg-white px-3 py-2.5 text-sm"
                              >
                                <option value="">Select SKU</option>
                                {boxSelectionLineItems.map((item, index) => {
                                  const optionValue = getLineItemOptionValue(item);
                                  const availableQty = getLineItemAllocatableQuantity(item, boxSelectionBoxes, boxSelectionLineItems);

                                  return (
                                    <option key={optionValue || index} value={optionValue} disabled={availableQty <= 0 || isBoxSkuOptionSelectedElsewhere(optionValue, visualRowIndex)}>
                                      {getItemSku(item) || getLineItemId(item) || '-'}
                                    </option>
                                  );
                                })}
                              </select>
                              <input
                                type="number"
                                min="1"
                                step="1"
                                max={rowMaxQuantity || undefined}
                                value={row.quantity}
                                onChange={(e) => handleBoxSkuExtraRowChange(rowIndex, 'quantity', e.target.value)}
                                placeholder={rowLineItem && rowMaxQuantity <= 0 ? '0' : rowMaxQuantity ? formatQuantityValue(rowMaxQuantity) : 'Qty'}
                                disabled={Boolean(rowLineItem) && rowMaxQuantity <= 0}
                                className="min-w-0 w-full rounded-lg border border-gray-200 bg-white px-3 py-2.5 text-sm disabled:bg-gray-100 disabled:text-gray-400"
                              />
                              <button
                                type="button"
                                onClick={() => handleRemoveBoxSkuRow(rowIndex)}
                                title="Remove SKU row"
                                className="inline-flex h-[42px] items-center justify-center rounded-lg border border-gray-200 bg-white text-gray-500 hover:border-red-200 hover:bg-red-50 hover:text-red-600"
                              >
                                <X size={14} />
                              </button>
                            </div>
                            {rowLineItem ? (
                              <p className="text-[11px] font-medium text-[#6b7a93]">
                                {activeSubShipmentForBox ? 'Planned' : 'Boxable'} {formatQuantityValue(rowBoxableQty)} units, already boxed {formatQuantityValue(rowAllocatedQty)}, available {formatQuantityValue(rowMaxQuantity)}.
                              </p>
                            ) : null}
                          </div>
                        );
                      })}
                    </div>
                  ) : null}
                  <button
                    type="button"
                    onClick={handleAddBoxSkuRow}
                    className="mt-3 inline-flex items-center gap-1.5 rounded-lg border border-[#ffbf85] bg-[#fff7ef] px-3 py-2 text-xs font-semibold text-[#d76000] hover:bg-[#fff0df]"
                  >
                    <Plus size={14} />
                    Other SKU
                  </button>
                </div>
                ) : null}
                {boxType !== 'pallet' ? (
                <div className="space-y-3 text-sm text-gray-600">
                  <label className="flex items-start gap-3">
                    <input type="checkbox" checked={hazmatEnabled} onChange={(e) => setHazmatEnabled(e.target.checked)} className="mt-1 h-4 w-4 accent-[#ff9d3a]" />
                    <span>Hazmat / Dangerous Goods</span>
                  </label>
                  <label className="flex items-start gap-3">
                    <input type="checkbox" checked={trackExpiryDates} onChange={(e) => setTrackExpiryDates(e.target.checked)} className="mt-1 h-4 w-4 accent-[#ff9d3a]" />
                    <span>Track Expiry Dates
                      <span className="block text-[11px] text-gray-400">Adds expiry date field to each shipment line item for this product</span>
                    </span>
                  </label>
                  <label className="flex items-start gap-3">
                    <input type="checkbox" checked={trackLotNumbers} onChange={(e) => setTrackLotNumbers(e.target.checked)} className="mt-1 h-4 w-4 accent-[#ff9d3a]" />
                    <span>Track Lot Numbers
                      <span className="block text-[11px] text-gray-400">Adds a lot/batch number field to each shipment line item for this product</span>
                    </span>
                  </label>
                </div>
                ) : null}
              </div>
              <div className="flex justify-end gap-3 border-t border-gray-200 px-6 py-4">
                <button
                  onClick={() => {
                    if (isCreatingBox) return;
                    setShowAddBoxModal(false);
                    setActiveSubShipmentIdForBox('');
                    setBoxNumber('');
                    setPalletNumber('');
                    resetAddBoxSkuSelection();
                    setSelectedPalletBoxIds([]);
                  }}
                  disabled={isCreatingBox}
                  className="rounded-lg border border-gray-300 px-4 py-2 text-sm text-gray-700 hover:bg-gray-50"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  disabled={isCreatingBox}
                  aria-busy={isCreatingBox}
                  onClick={async () => {
                    const created = await handleCreateBox(boxType === 'pallet');
                    if (created) {
                      setShowAddBoxModal(false);
                      setActiveSubShipmentIdForBox('');
                      setBoxNumber('');
                      setPalletNumber('');
                      resetAddBoxSkuSelection();
                      setSelectedPalletBoxIds([]);
                    }
                  }}
                  className="inline-flex min-w-[96px] items-center justify-center gap-2 rounded-lg bg-[#ff9d3a] px-5 py-2 text-sm font-semibold text-white hover:bg-[#f28a18] disabled:cursor-not-allowed disabled:opacity-70"
                >
                  {isCreatingBox ? (
                    <>
                      <RefreshCw size={14} className="animate-spin" />
                      {boxType === 'pallet' ? 'Add Pallet...' : 'Add Box...'}
                    </>
                  ) : (
                    boxType === 'pallet' ? 'Add Pallet' : 'Add Box'
                  )}
                </button>
              </div>
            </div>
          </div>
        ) : null}
      </div>
      <ConfirmationModal
        open={Boolean(dispatchConfirm)}
        title={dispatchConfirm?.title}
        message={dispatchConfirm?.message}
        confirmLabel={dispatchConfirm?.confirmLabel}
        cancelLabel="Cancel"
        onCancel={() => setDispatchConfirm(null)}
        onConfirm={handleConfirmDispatchWarning}
      />
    </Layout>
  );
};

export default ShipmentDetail;
