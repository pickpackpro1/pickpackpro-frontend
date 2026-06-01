import React, { useEffect, useMemo, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import Layout from './adminlayout/Layout';
import LoadingState from '../common/LoadingState';
import FullPageLoader from '../common/FullPageLoader';
import { getSession } from '../../utils/auth';
import { showToast } from '../../utils/toast';
import { ArrowDown, ArrowLeft, ChevronDown, RefreshCw, X, CheckCircle2, Plus } from 'lucide-react';

const API_BASE_URL = '';
const BUNDLE_SIZE_NOTE_PREFIX = 'Bundle Sizes:';
const BOX_ALLOCATION_CACHE_KEY = 'pickpackpro-box-allocation-items-v1';

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
    const error = new Error(payload?.message || payload?.error || payload?.details || (typeof payload === 'string' ? payload : '') || `Request failed with status ${response.status}`);
    error.status = response.status;
    error.payload = payload;
    error.responseText = text;
    throw error;
  }
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
  if (Array.isArray(shipment)) return shipment.some(hasLineItemShape) ? shipment : [];
  if (!shipment || typeof shipment !== 'object') return [];

  const directItems = getDirectLineItems(shipment);
  if (directItems.length) return directItems;

  for (const key of LINE_ITEM_CONTAINERS) {
    const value = shipment[key];
    if (!value || typeof value !== 'object' || value === shipment) continue;
    const nestedItems = getDirectLineItems(value);
    if (nestedItems.length) return nestedItems;
  }

  return [];
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

const getItemServices = (item = {}) => [
  ...new Set(
    [
      ...toLabelList(item?.services),
      ...toLabelList(item?.servicesSelected),
      ...toLabelList(item?.services_selected),
      ...toLabelList(item?.serviceTypes),
      ...toLabelList(item?.service_types),
      ...toLabelList(item?.serviceType),
      ...toLabelList(item?.service_type),
      ...toLabelList(item?.requiredServices),
      ...toLabelList(item?.required_services),
      ...toLabelList(item?.prepServices),
      ...toLabelList(item?.prep_services),
      ...(item?.needsBundling || item?.needs_bundling ? ['Bundling'] : []),
    ]
      .map((service) => String(service || '').trim())
      .filter(isDisplayServiceLabel)
  ),
];

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

const getBoxTitle = (box, index = 0) =>
  box?.label ||
  box?.name ||
  box?.reference ||
  box?.boxNumber ||
  box?.box_number ||
  `Box ${index + 1}`;

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

const getBoxStatus = (box = {}) =>
  formatBoxMetaValue(
    firstPresent(
      box?.status,
      box?.boxStatus,
      box?.box_status,
      box?.state,
      box?.dispatchStatus,
      box?.dispatch_status,
      box?.labelStatus,
      box?.label_status,
      'No status'
    )
  );

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
  const receivedQuantityValue = getItemReceivedQtyValue(lineItem);
  const receivedQuantity = getPositiveQuantity(receivedQuantityValue);

  if (receivedQuantity > 0) return receivedQuantity;

  const expectedQuantityValue = getItemExpectedBoxableQty(lineItem);
  const expectedQuantity = getPositiveQuantity(expectedQuantityValue);

  if (expectedQuantity > 0) return expectedQuantity;

  const dispatchQuantity = getPositiveQuantity(getItemDispatchQty(lineItem));

  if (dispatchQuantity > 0) return dispatchQuantity;
  if (hasItemReceivedQtyField(lineItem)) return 0;
  if (getBoxAllocationLineItemId(lineItem)) return 0;

  return 0;
};

const getLineItemAllocatableQuantity = (lineItem = {}, boxList = [], lineItemList = []) => {
  if (!lineItem || typeof lineItem !== 'object') return 0;
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

const enrichBoxWithItems = async (box = {}, lineItemList = []) => {
  const existingItems = getBoxItems(box);
  const hasUsableItems = existingItems.some((item) =>
    (getBoxItemLineItemId(item) || getBoxItemSku(item)) && getBoxItemQuantity(item) !== ''
  );
  const boxItems = await fetchBoxItemsByBoxId(box);
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

  const results = await Promise.allSettled(boxList.map((box) => enrichBoxWithItems(box, lineItemList)));
  return results.map((result, index) =>
    result.status === 'fulfilled' ? result.value : boxList[index]
  );
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

const formatServiceLabel = (value = '') =>
  String(value)
  .toLowerCase()
  .split('_')
  .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
  .join(' ');

const getServiceDisplayStatus = (serviceName, item, services) => {
  const matchedTask = getServiceTaskForLine(serviceName, item, services);
  const normalized = String(matchedTask?.status || '').toUpperCase();

  if (normalized === 'DONE' || normalized === 'COMPLETED') {
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
    service?.lineItem?.sku,
    service?.line_item?.sku,
    service?.shipmentItem?.sku,
    service?.shipment_item?.sku,
    service?.item?.sku
  );

const getServiceTaskLabel = (service = {}) =>
  formatServiceLabel(
    typeof service === 'object'
      ? firstPresent(service?.serviceType, service?.service_type, service?.name, service?.serviceName, service?.service_name, service?.type)
      : service
  );

const isOtherServiceTask = (service = {}) => {
  const rawType = String(firstPresent(service?.serviceType, service?.service_type, service?.type)).trim().toLowerCase();
  const label = String(getServiceTaskLabel(service) || '').trim().toLowerCase();

  return rawType === 'other' || rawType === 'other_service' || label === 'other' || label.includes('other service');
};

const normalizeServiceKey = (value = '') =>
  String(formatServiceLabel(value || ''))
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '');

const STANDARD_SERVICE_KEYS = new Set(
  [
    'FNSKU Labeling',
    'FNSKU_LABEL',
    'Bundling',
    'BUNDLING',
    'Poly Bag',
    'POLY_BAG',
    'Bubble Wrap',
    'BUBBLE_WRAP',
    'Leaflet Insertion',
    'LEAFLET_INSERTION',
    'Oversize Surcharge',
    'OVERSIZE_SURCHARGE',
    'Return Processing',
    'RETURN_PROCESSING',
  ].map(normalizeServiceKey)
);

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

const getLineItemServices = (item = {}, serviceTasks = []) => {
  const inlineServices = getItemServices(item);
  if (inlineServices.length) return inlineServices;

  const lineItemId = String(getLineItemId(item) || '').trim();
  const itemSku = String(getItemSku(item) || '').trim().toLowerCase();

  return [
    ...new Set(
      toArray(serviceTasks)
        .filter((service) => {
          const serviceLineItemId = String(getServiceTaskLineItemId(service) || '').trim();
          const serviceSku = String(getServiceTaskSku(service) || '').trim().toLowerCase();
          return (
            (lineItemId && serviceLineItemId && lineItemId === serviceLineItemId) ||
            (itemSku && serviceSku && itemSku === serviceSku) ||
            (!serviceLineItemId && !serviceSku && !lineItemId && !itemSku)
          );
        })
        .map((service) => getServiceTaskLabel(service))
        .filter(isDisplayServiceLabel)
    ),
  ];
};

const getServiceTaskForLine = (serviceName, item, services) => {
  const serviceKey = normalizeServiceKey(serviceName);
  const lineItemId = getLineItemId(item);
  const itemSku = String(getItemSku(item) || '').trim().toLowerCase();

  return toArray(services).find((service) => {
    const serviceLineItemId = String(getServiceTaskLineItemId(service) || '').trim();
    const serviceSku = String(getServiceTaskSku(service) || '').trim().toLowerCase();
    const serviceLabelKey = normalizeServiceKey(getServiceTaskLabel(service));
    const sameLineItem =
      (lineItemId && serviceLineItemId && String(lineItemId) === serviceLineItemId) ||
      (itemSku && serviceSku && itemSku === serviceSku) ||
      (!serviceLineItemId && !serviceSku);
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

const getServiceUnits = (service = {}, lineItem = {}) =>
  Number(
    firstPresent(
      getItemReceivedQty(lineItem),
      getItemReceivedQty(service?.lineItem),
      getItemReceivedQty(service?.line_item),
      getItemReceivedQty(service?.shipmentItem),
      getItemReceivedQty(service?.shipment_item),
      getItemReceivedQty(service?.item),
      service?.receivedQty,
      service?.received_qty,
      service?.receivedQuantity,
      service?.received_quantity,
      service?.unitsDone,
      service?.units_done,
      service?.quantity,
      service?.expectedQty,
      service?.expected_qty,
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
  file?.entityId || file?.entity_id || file?.boxId || file?.box_id || file?.itemId || file?.item_id || file?.lineItemId || file?.line_item_id || file?.shipmentItemId || file?.shipment_item_id || file?.shipmentId || file?.shipment_id || '';

const getFileEntityType = (file = {}) => String(file?.entityType || file?.entity_type || '').trim().toLowerCase();

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

const normalizeItemFileMatchValue = (value = '') => {
  const normalized = String(value || '').trim().toLowerCase();
  return normalized && !['-', 'n/a', 'na', 'none', 'null', 'undefined'].includes(normalized) ? normalized : '';
};

const rawFileMatchesLineItem = (file = {}, item = {}) => {
  const lineItemIds = [
    getItemLabelRecordId(item),
    getShipmentLineItemId(item),
    getBoxAllocationLineItemId(item),
    getLineItemId(item),
  ]
    .map((value) => String(value || '').trim())
    .filter(Boolean);
  const itemLabelFileId = String(getItemLabelFileId(item) || '').trim();
  const sku = normalizeItemFileMatchValue(getItemSku(item));
  const fnsku = normalizeItemFileMatchValue(getItemFnsku(item));
  const itemFileName = normalizeItemFileMatchValue(getItemLabelFileName(item));
  const name = getFileName(file).toLowerCase();
  const entityId = String(getFileEntityId(file) || '').trim();
  const fileRecordId = String(getFileRecordId(file) || '').trim();
  const fileSku = normalizeItemFileMatchValue(getFileSku(file));
  const fileFnsku = normalizeItemFileMatchValue(getFileFnsku(file));

  return Boolean(
    (itemLabelFileId && fileRecordId && itemLabelFileId === fileRecordId) ||
      (entityId && lineItemIds.includes(entityId)) ||
      (sku && fileSku && sku === fileSku) ||
      (fnsku && fileFnsku && fnsku === fileFnsku) ||
      (sku && name.includes(sku)) ||
      (fnsku && name.includes(fnsku)) ||
      (itemFileName && name.includes(itemFileName))
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
  const itemId = getItemLabelRecordId(item);
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
    item?.labelFile,
    item?.label_file,
    item?.label,
    item?.file,
  ].find(hasFileShape);

  if (nestedFile) return decorateItemLabelFile(nestedFile, item);

  const labelUrl = firstPresent(
    item?.fnskuLabelFileUrl,
    item?.fnsku_label_file_url,
    item?.fnskuLabelUrl,
    item?.fnsku_label_url,
    item?.labelFileUrl,
    item?.label_file_url,
    item?.labelUrl,
    item?.label_url,
    item?.fileUrl,
    item?.file_url,
    item?.fnskuLabelPath,
    item?.fnsku_label_path,
    item?.labelFilePath,
    item?.label_file_path,
    item?.filePath,
    item?.file_path
  );

  if (!labelUrl) return null;

  const fileName = firstPresent(getItemLabelFileName(item), labelUrl);
  return decorateItemLabelFile(
    {
      url: labelUrl,
      fileUrl: labelUrl,
      file_url: labelUrl,
      name: fileName,
      fileName,
      file_name: fileName,
    },
    item
  );
};

const getItemInlineLabelFiles = (item = {}) =>
  mergeFileLists(
    [getItemDirectLabelFile(item)].filter(Boolean),
    mergeFileLists(
      extractList(item?.files, ['files']),
      extractList(item?.attachments, ['files']),
      extractList(item?.uploads, ['files'])
    ).filter((file) => rawFileMatchesLineItem(file, item)),
    extractList(item?.labels, ['files']),
    extractList(item?.fnskuLabels, ['files']),
    extractList(item?.fnsku_labels, ['files'])
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

  return !isFbaBoxLabelFile(file) && (type.includes('fnsku') || name.includes('fnsku') || (entityType === 'item' && (type.includes('label') || isPdfFile(file) || isImageFile(file) || isCsvFile(file))));
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

const findLineItemLabelFile = (item, files, itemCount = 0, itemIndex = 0) => {
  const candidateFiles = getItemLabelCandidateFiles(mergeFileLists(getItemInlineLabelFiles(item), files));
  const fnskuLabelFiles = candidateFiles.filter(isFnskuLabelFile);
  const labelFiles = candidateFiles.filter(isAnyItemLabelFile);
  const shipmentOrItemFiles = candidateFiles.filter((file) => {
    const entityType = getFileEntityType(file);
    return entityType !== 'box' && (isPdfFile(file) || isImageFile(file) || isCsvFile(file) || isAnyItemLabelFile(file));
  });
  const matchingFiles = candidateFiles.filter((file) => fileMatchesLineItem(file, item));

  return (
    getPreferredLabelFile(matchingFiles) ||
    getPreferredLabelFile(candidateFiles.filter((file) => getFileEntityType(file) === 'item' && fileMatchesLineItem(file, item))) ||
    (itemCount === 1 && fnskuLabelFiles.length === 1 ? fnskuLabelFiles[0] : null) ||
    (itemCount === 1 && labelFiles.length === 1 ? labelFiles[0] : null) ||
    (itemCount === 1 && shipmentOrItemFiles.length === 1 ? shipmentOrItemFiles[0] : null) ||
    (itemCount > 1 && fnskuLabelFiles.length === itemCount ? fnskuLabelFiles[itemIndex] : null) ||
    (itemCount > 1 && labelFiles.length === itemCount ? labelFiles[itemIndex] : null) ||
    (itemCount > 1 && shipmentOrItemFiles.length === itemCount ? shipmentOrItemFiles[itemIndex] : null) ||
    (itemCount > 1 && candidateFiles.length === itemCount ? candidateFiles[itemIndex] : null) ||
    (itemCount === 1 && candidateFiles.length === 1 ? candidateFiles[0] : null)
  );
};

const normalizeFileMatchValue = (value = '') => {
  const normalized = String(value || '').trim().toLowerCase();
  return normalized && !['-', 'n/a', 'na', 'none', 'null', 'undefined'].includes(normalized) ? normalized : '';
};

const isDisplayableLineItemFile = (file = {}) => {
  if (!getFileUrl(file) && !getFileName(file)) return false;
  const entityType = getFileEntityType(file);
  if (entityType === 'box' || isFbaBoxLabelFile(file)) return false;
  return isFnskuLabelFile(file) || isAnyItemLabelFile(file) || isImageFile(file) || isPdfFile(file) || isCsvFile(file);
};

const fileMatchesLineItem = (file = {}, item = {}) => {
  return rawFileMatchesLineItem(file, item);
};

const getLineItemFiles = (item = {}, files = [], itemCount = 0, itemIndex = 0) => {
  const fileList = mergeFileLists(getItemInlineLabelFiles(item), files).filter(isDisplayableLineItemFile);
  const matchedFiles = fileList.filter((file) => fileMatchesLineItem(file, item));

  if (matchedFiles.length) return mergeFileLists(matchedFiles);
  if (itemCount === 1) return mergeFileLists(fileList);
  if (fileList.length === itemCount && fileList[itemIndex]) return [fileList[itemIndex]];
  return [];
};

const ShipmentDetail = () => {
  const { id } = useParams();
  const navigate = useNavigate();
  const [shipment, setShipment] = useState(null);
  const [services, setServices] = useState([]);
  const [discrepancies, setDiscrepancies] = useState([]);
  const [boxes, setBoxes] = useState([]);
  const [files, setFiles] = useState([]);
  const [statusValue, setStatusValue] = useState('pending_arrival');
  const [staffId, setStaffId] = useState('');
  const [staffMembers, setStaffMembers] = useState([]);
  const [isStaffLoading, setIsStaffLoading] = useState(false);
  const [bulkServiceType, setBulkServiceType] = useState('FNSKU_LABEL');
  const [bulkStatus, setBulkStatus] = useState('IN_PROGRESS');
  const [customServiceLineItemId, setCustomServiceLineItemId] = useState('');
  const [customServiceName, setCustomServiceName] = useState('');
  const [customServicePrice, setCustomServicePrice] = useState('');
  const [customServiceStatusLineItemId, setCustomServiceStatusLineItemId] = useState('');
  const [customServiceStatusName, setCustomServiceStatusName] = useState('');
  const [customServiceStatusValue, setCustomServiceStatusValue] = useState('DONE');
  const [resolveDiscrepancyId, setResolveDiscrepancyId] = useState('');
  const [resolveNotes, setResolveNotes] = useState('');
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
  const [assignBoxId, setAssignBoxId] = useState('');
  const [assignPalletId, setAssignPalletId] = useState('');
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
  const [hazmatEnabled, setHazmatEnabled] = useState(true);
  const [trackExpiryDates, setTrackExpiryDates] = useState(true);
  const [trackLotNumbers, setTrackLotNumbers] = useState(true);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [isCreatingBox, setIsCreatingBox] = useState(false);
  const [updatingTaskId, setUpdatingTaskId] = useState('');

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
  const lineItems = getLineItems(shipment);
  const findLineItemBySelection = (selectedValue = '') => {
    const normalizedSelection = String(selectedValue || '').trim();
    if (!normalizedSelection) return null;

    return lineItems.find((item) => {
      const optionValue = getLineItemOptionValue(item);
      const itemId = String(getLineItemId(item) || '').trim();
      const itemSku = String(getItemSku(item) || '').trim();
      return [optionValue, itemId, itemSku].filter(Boolean).includes(normalizedSelection);
    }) || null;
  };
  const selectedBoxLineItem = findLineItemBySelection(boxSkuPreview);
  const selectedAddToBoxLineItem = findLineItemBySelection(addToBoxLineItemId);
  const selectedBoxBoxableQty = selectedBoxLineItem ? getLineItemBoxableQuantity(selectedBoxLineItem) : 0;
  const selectedBoxAllocatedQty = selectedBoxLineItem ? getAllocatedQuantityForLineItem(selectedBoxLineItem, boxes, lineItems) : 0;
  const selectedBoxMaxQuantity = selectedBoxLineItem ? getLineItemAllocatableQuantity(selectedBoxLineItem, boxes, lineItems) : 0;
  const selectedAddToBoxMaxQuantity = selectedAddToBoxLineItem ? getLineItemAllocatableQuantity(selectedAddToBoxLineItem, boxes, lineItems) : 0;
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
    const nextMaxQuantity = nextLineItem ? getLineItemAllocatableQuantity(nextLineItem, boxes, lineItems) : 0;

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
          const nextMaxQuantity = nextLineItem ? getLineItemAllocatableQuantity(nextLineItem, boxes, lineItems) : 0;
          return {
            lineItemValue: selectedValue,
            quantity: nextMaxQuantity > 0 ? String(nextMaxQuantity) : '',
          };
        }

        const rowLineItem = findLineItemBySelection(row.lineItemValue);
        const rowMaxQuantity = rowLineItem ? getLineItemAllocatableQuantity(rowLineItem, boxes, lineItems) : 0;
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
  const customServices = extractCustomServices(shipment, serviceTasks);

  const loadShipmentData = async ({ showLoader = true } = {}) => {
    try {
      if (showLoader) {
        setIsLoading(true);
      }
      setError('');
      const routeId = String(id || '').trim();
      const encodedRouteId = encodeURIComponent(routeId);
      const shipmentResponse = await fetch(`${API_BASE_URL}/api/shipments/${encodedRouteId}`, {
        method: 'GET',
        headers: buildHeaders(),
        cache: 'no-store',
      });
      const shipmentPayload = await parseResponse(shipmentResponse);
      const shipmentData = shipmentPayload?.shipment || shipmentPayload?.data || shipmentPayload;
      const shipmentLineItems = getLineItems(shipmentData);
      const shipmentRecordId = getShipmentRecordId(shipmentData);
      const shipmentRecordLookupIds = [
        ...new Set(
          getShipmentLookupCandidates(shipmentData, routeId)
            .map((lookupId) => String(lookupId || '').trim())
            .filter(isUuidValue)
        ),
      ];
      const fetchShipmentRelated = async (path, extractor) => {
        for (const lookupId of shipmentRecordLookupIds) {
          try {
            const response = await fetch(`${API_BASE_URL}/api/shipments/${encodeURIComponent(lookupId)}${path}`, {
              method: 'GET',
              headers: buildHeaders(),
              cache: 'no-store',
            });
            const payload = await parseResponse(response);
            const rows = extractor(payload);
            if (rows.length) return rows;
          } catch {
            // Try the next UUID identifier.
          }
        }

        return [];
      };
      const [servicesResult, discrepanciesResult, boxesResult, shipmentFileResults] = await Promise.allSettled([
        fetchShipmentRelated('/services', extractServiceTasks),
        fetchShipmentRelated('/discrepancies', (payload) => toArray(payload?.discrepancies || payload?.data || payload)),
        fetchShipmentRelated('/boxes', extractBoxes),
        Promise.allSettled(
          shipmentRecordLookupIds.map((lookupId) =>
            fetch(`${API_BASE_URL}/api/files?entityType=shipment&entityId=${encodeURIComponent(lookupId)}`, {
              method: 'GET',
              headers: buildHeaders(),
              cache: 'no-store',
            }).then((response) => parseResponse(response))
          )
        ),
      ]);
      const servicesRows = servicesResult.status === 'fulfilled' ? servicesResult.value : [];
      const discrepanciesRows = discrepanciesResult.status === 'fulfilled' ? discrepanciesResult.value : [];
      let loadedBoxes = mergeBoxLists(
        boxesResult.status === 'fulfilled' ? boxesResult.value : [],
        extractBoxes(shipmentData)
      );
      let shipmentFiles =
        shipmentFileResults.status === 'fulfilled'
          ? mergeFileLists(
              ...shipmentFileResults.value.map((result) =>
                result.status === 'fulfilled' ? extractFileRecords(result.value) : []
              )
            )
          : [];
      const shipmentFileLookupIds = getShipmentLookupCandidates(shipmentData, id)
        .filter(isUuidValue)
        .filter(Boolean)
        .filter((lookupId, index, lookupIds) => lookupIds.indexOf(lookupId) === index);
      const extraShipmentFileResults = await Promise.allSettled(
        shipmentFileLookupIds.map((lookupId) =>
          fetch(`${API_BASE_URL}/api/files?entityType=shipment&entityId=${encodeURIComponent(lookupId)}`, {
            method: 'GET',
            headers: buildHeaders(),
            cache: 'no-store',
          }).then((response) => parseResponse(response))
        )
      );
      shipmentFiles = mergeFileLists(
        shipmentFiles,
        extraShipmentFileResults.flatMap((result) =>
          result.status === 'fulfilled' ? extractFileRecords(result.value) : []
        )
      );
      const lineItemFileRequests = shipmentLineItems
        .map((item) => getItemLabelRecordId(item))
        .filter(isUuidValue)
        .filter(Boolean)
        .map((lineItemId) =>
          fetch(`${API_BASE_URL}/api/files?entityType=item&entityId=${encodeURIComponent(lineItemId)}`, {
            method: 'GET',
            headers: buildHeaders(),
          }).then((response) => parseResponse(response))
        );
      const lineItemFileResults = await Promise.allSettled(lineItemFileRequests);
      const lineItemFiles = lineItemFileResults.flatMap((result) =>
        result.status === 'fulfilled'
          ? extractFileRecords(result.value)
          : []
      );
      const itemLabelFileLookups = shipmentLineItems
        .map((item) => ({
          fileId: String(getItemLabelFileId(item) || '').trim(),
          item,
        }))
        .filter(({ fileId }) => fileId);
      const itemLabelFileResults = await Promise.allSettled(
        itemLabelFileLookups.map(async ({ fileId, item }) => {
          const itemId = getItemLabelRecordId(item);
          const itemFiles = await fetchFileById(fileId);
          return itemFiles.map((file) =>
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
      const inlineItemLabelFiles = shipmentLineItems.flatMap((item) => getItemInlineLabelFiles(item));
      if (!loadedBoxes.length) {
        const fallbackBoxIds = shipmentRecordLookupIds.filter((lookupId) => lookupId !== routeId);

        for (const lookupId of fallbackBoxIds) {
          try {
            const fallbackResponse = await fetch(`${API_BASE_URL}/api/shipments/${encodeURIComponent(lookupId)}/boxes`, {
              method: 'GET',
              headers: buildHeaders(),
              cache: 'no-store',
            });
            loadedBoxes = extractBoxes(await parseResponse(fallbackResponse));
            if (loadedBoxes.length) break;
          } catch {
            loadedBoxes = [];
          }
        }
      }
      loadedBoxes = await enrichBoxesWithItems(loadedBoxes, shipmentLineItems);
      const boxFileRequests = loadedBoxes
        .flatMap((box) => getBoxLookupIds(box))
        .filter(isUuidValue)
        .filter(Boolean)
        .filter((boxId, index, allBoxIds) => allBoxIds.indexOf(boxId) === index)
        .map((boxId) =>
          fetch(`${API_BASE_URL}/api/files?entityType=box&entityId=${encodeURIComponent(boxId)}`, {
            method: 'GET',
            headers: buildHeaders(),
            cache: 'no-store',
          }).then((response) => parseResponse(response))
        );
      const boxFileResults = await Promise.allSettled(boxFileRequests);
      const boxFiles = boxFileResults.flatMap((result) =>
        result.status === 'fulfilled'
          ? extractFileRecords(result.value)
          : []
      );
      const fbaLabelFileLookups = loadedBoxes
        .map((box) => ({
          fileId: String(getBoxFbaLabelFileId(box) || '').trim(),
          boxId: getBoxLookupIds(box).find(Boolean),
        }))
        .filter(({ fileId }) => fileId);
      const fbaLabelFileResults = await Promise.allSettled(
        fbaLabelFileLookups.map(async ({ fileId, boxId }) => {
          const files = await fetchFileById(fileId);
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

      setShipment(shipmentData);
      setStaffId(getAssignedStaffId(shipmentData) || '');
      setStatusValue(shipmentData?.status || 'pending_arrival');
      setServices(servicesRows);
      setDiscrepancies(discrepanciesRows);
      setBoxes(loadedBoxes);
      setFiles(mergeFileLists(shipmentFiles, lineItemFiles, itemLabelFiles, inlineItemLabelFiles, boxFiles, fbaLabelFiles));
      setFileEntityId(shipmentRecordId || id);
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

  useEffect(() => {
    loadStaffMembers();
  }, []);

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
      await loadShipmentData();
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
      await loadShipmentData();
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
        body: JSON.stringify({ serviceType: bulkServiceType, status: bulkStatus }),
      });
      await parseResponse(response);
      setMessage('Bulk service status updated.');
      await loadShipmentData();
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
      await loadShipmentData();
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
      await loadShipmentData();
    } catch (requestError) {
      setError(requestError.message);
    }
  };

  const handleResolveDiscrepancy = async () => {
    try {
      setError('');
      setMessage('');
      if (!resolveDiscrepancyId.trim()) {
        throw new Error('Discrepancy UUID required hai.');
      }
      const response = await fetch(`${API_BASE_URL}/api/discrepancies/${resolveDiscrepancyId}/resolve`, {
        method: 'PATCH',
        headers: buildHeaders(true),
        body: JSON.stringify({ notes: resolveNotes }),
      });
      await parseResponse(response);
      setMessage('Discrepancy resolved.');
      await loadShipmentData();
    } catch (requestError) {
      setError(requestError.message);
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
      if (unitsDone !== '' && unitsDone !== undefined) payload.unitsDone = Number(unitsDone);
      if (String(notes || '').trim()) payload.notes = String(notes).trim();
      setServices((currentServices) => {
        previousServices = currentServices;

        return toArray(currentServices).map((service) => {
          if (String(getServiceTaskId(service) || '') !== String(resolvedTaskId)) {
            return service;
          }

          return {
            ...service,
            status: payload.status,
            taskStatus: payload.status,
            task_status: payload.status,
            ...(payload.unitsDone !== undefined
              ? {
                  unitsDone: payload.unitsDone,
                  units_done: payload.unitsDone,
                }
              : {}),
            ...(payload.notes ? { notes: payload.notes } : {}),
          };
        });
      });
      const response = await fetch(`${API_BASE_URL}/api/services/${encodeURIComponent(resolvedTaskId)}`, {
        method: 'PATCH',
        headers: buildHeaders(true),
        body: JSON.stringify(payload),
      });
      await parseResponse(response);
      setMessage('Service task updated.');
      await loadShipmentData({ showLoader: false });
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
      const payload = isPallet
        ? {}
        : {
            boxType,
            boxSize,
            weight: Number(boxWeight || 0),
            dimensions: { l: Number(boxLength || 0), w: Number(boxWidth || 0), h: Number(boxHeight || 0) },
          };
      const allocationDrafts = [
        { lineItemValue: boxSkuPreview, quantity: boxSkuQuantityPreview, rowNumber: 1 },
        ...boxSkuExtraRows.map((row, index) => ({ ...row, rowNumber: index + 2 })),
      ].filter((row) => String(row.lineItemValue || row.quantity || '').trim());
      const allocations = [];
      const seenAllocationKeys = new Set();

      if (!isPallet && lineItems.length) {
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

          const allocationKey = String(getBoxAllocationLineItemId(lineItem) || getLineItemId(lineItem) || lineItemValue).trim();
          if (seenAllocationKeys.has(allocationKey)) {
            return showBoxError('This SKU is already selected. Please remove duplicate SKU rows.');
          }

          const maxQuantity = getLineItemAllocatableQuantity(lineItem, boxes, lineItems);
          if (maxQuantity <= 0) {
            return showBoxError(`${getItemSku(lineItem) || 'Selected SKU'} has no received units available to box.`);
          }

          seenAllocationKeys.add(allocationKey);
          allocations.push({
            lineItem,
            lineItemValue,
            requestedQuantity,
            quantity: Math.min(requestedQuantity, maxQuantity),
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
        const createResponse = await fetch(`${API_BASE_URL}/api/shipments/${encodeURIComponent(shipmentLookupId)}/${endpoint}`, {
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

      let createResult;
      try {
        createResult = await createBoxRequest(createBoxPayload);
      } catch (createError) {
        if (createBoxPayload !== payload && [400, 422].includes(Number(createError?.status))) {
          console.error('[PickPackPro][Box Create POST with items failed, retrying plain box]', {
            shipmentId: shipmentLookupId,
            endpoint,
            status: createError?.status,
            request: createBoxPayload,
            payload: createError?.payload,
            responseText: createError?.responseText,
            message: createError?.message,
          });
          createResult = await createBoxRequest(payload);
        } else {
          throw createError;
        }
      }

      const boxPayload = createResult.payload;
      const response = createResult.response;
      const newBox = boxPayload?.box || boxPayload?.data?.box || boxPayload?.data || boxPayload;
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
      } else if (!isPallet && newBoxId && allocations.length) {
        let boxForAllocation = await enrichBoxWithItems(newBox, lineItems);

        for (const allocation of allocations) {
          const skuLabel = getItemSku(allocation.lineItem) || allocation.lineItemValue;
          const alreadySavedQuantity =
            boxForAllocation?.__boxItemsSource === 'api'
              ? getAllocatedQuantityForLineItem(allocation.lineItem, [boxForAllocation], lineItems)
              : 0;

          if (alreadySavedQuantity >= allocation.quantity) {
            continue;
          }

          const selectedLineItemId = String(
            getBoxAllocationLineItemId(allocation.lineItem) || getShipmentLineItemId(allocation.lineItem) || ''
          ).trim();

          if (!isUuidValue(selectedLineItemId)) {
            allocationWarning += ` ${skuLabel} allocation skipped: selected line item UUID is missing.`;
            console.error('[PickPackPro][Box Item POST skipped]', {
              boxId: newBoxId,
              sku: skuLabel,
              reason: 'Selected line item UUID is missing.',
              lineItem: allocation.lineItem,
            });
            continue;
          }

          try {
            await postBoxItemAllocation({
              boxId: newBoxId,
              shipmentItemId: selectedLineItemId,
              quantity: allocation.quantity,
              skuLabel,
            });

            if (allocation.quantity < allocation.requestedQuantity) {
              allocationWarning += ` ${skuLabel} allocation adjusted to ${formatQuantityValue(allocation.quantity)} units (max available ${formatQuantityValue(allocation.maxQuantity)}).`;
            }

            boxForAllocation = await enrichBoxWithItems({ ...boxForAllocation, id: newBoxId }, lineItems);
          } catch (allocationError) {
            boxForAllocation = await enrichBoxWithItems(boxForAllocation, lineItems);
            const refreshedAllocatedQuantity = getAllocatedQuantityForLineItem(allocation.lineItem, [boxForAllocation], lineItems);

            if (refreshedAllocatedQuantity >= allocation.quantity) {
              continue;
            }

            if (/max allocatable:\s*0/i.test(String(allocationError?.message || ''))) {
              allocationWarning += ` ${skuLabel} allocation skipped: this SKU is already fully boxed.`;
            } else {
              allocationWarning += ` ${skuLabel} allocation could not be saved: ${allocationError.message}`;
            }
          }
        }
      }

      if (!isPallet && !newBoxId && allocations.length) {
        allocationWarning = ' SKU allocation skipped: new box id was not returned.';
      }

      if (allocationWarning) {
        showToast('error', `${isPallet ? 'Pallet' : 'Box'} created, but some SKU quantities could not be added.`);
      } else {
        showToast('success', `${isPallet ? 'Pallet' : 'Box'} created successfully.`);
      }
      await loadShipmentData();
      resetAddBoxSkuSelection();
      return true;
    } catch (requestError) {
      setError('');
      showToast('error', requestError.message || `Failed to create ${isPallet ? 'pallet' : 'box'}.`);
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
      await loadShipmentData();
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
      await loadShipmentData();
    } catch (requestError) {
      setError(requestError.message);
    }
  };

  const handleAssignPallet = async () => {
    try {
      setError('');
      setMessage('');
      const response = await fetch(`${API_BASE_URL}/api/boxes/${assignBoxId}/assign-pallet`, {
        method: 'PATCH',
        headers: buildHeaders(true),
        body: JSON.stringify({ palletId: assignPalletId }),
      });
      await parseResponse(response);
      setMessage('Box assigned to pallet.');
      await loadShipmentData();
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
      await loadShipmentData();
    } catch (requestError) {
      setError(requestError.message);
    }
  };

  const handleMarkBoxDispatched = async (boxOrId) => {
    const box = typeof boxOrId === 'object'
      ? boxOrId
      : boxes.find((currentBox) => getBoxId(currentBox) === boxOrId) || { id: boxOrId };
    const boxId = getBoxRecordId(box);

    if (!boxId) {
      setError('Box UUID required hai.');
      return;
    }

    if (!isBoxFbaLabelUploaded(box, files)) {
      setError('Please upload the FBA label before marking this box dispatched.');
      return;
    }

    try {
      setError('');
      setMessage('');
      const response = await fetch(`${API_BASE_URL}/api/boxes/${encodeURIComponent(boxId)}/seal`, {
        method: 'PATCH',
        headers: buildHeaders(true),
        body: JSON.stringify({ trackingCode: undefined }),
      });
      await parseResponse(response);
      setMessage('Box marked dispatched.');
      await loadShipmentData();
    } catch (requestError) {
      setError(requestError.message);
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
      formData.append('entityType', 'box');
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
            entityType: 'box',
            entity_type: 'box',
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
      await loadShipmentData();
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
      await loadShipmentData();
    } catch (requestError) {
      setError(requestError.message);
    }
  };

  const handleUploadFile = async () => {
    if (!selectedFile || !fileEntityId.trim()) {
      setError('File aur entity id required hain.');
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
      await loadShipmentData();
    } catch (requestError) {
      setError(requestError.message);
    }
  };

  const resolveLineItemLabelFileForOpen = async (item, index) => {
    let labelFile = findLineItemLabelFile(item, files, lineItems.length, index);
    const labelFileId = String(getItemLabelFileId(item) || getFileRecordId(labelFile) || '').trim();
    const itemLookupIds = [
      getItemLabelRecordId(item),
      getShipmentLineItemId(item),
      getBoxAllocationLineItemId(item),
      getLineItemId(item),
    ]
      .map((value) => String(value || '').trim())
      .filter(Boolean)
      .filter((value, valueIndex, values) => values.indexOf(value) === valueIndex);

    for (const itemLookupId of itemLookupIds) {
      const entityFiles = await fetchFilesByEntity('item', itemLookupId);
      const decoratedFiles = entityFiles.map((file) => decorateItemLabelFile(file, item));
      const matchedFile =
        decoratedFiles.find((file) => labelFileId && String(getFileRecordId(file) || '').trim() === labelFileId) ||
        getPreferredLabelFile(decoratedFiles.filter((file) => fileMatchesLineItem(file, item))) ||
        (decoratedFiles.length === 1 ? decoratedFiles[0] : null);

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
        getPreferredLabelFile(decoratedFiles.filter((file) => fileMatchesLineItem(file, item))) ||
        (decoratedFiles.length === 1 ? decoratedFiles[0] : null);

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

  const currentStepIndex = statusSteps.indexOf(String(shipment?.status || '').toLowerCase());
  const currentStatus = String(shipment?.status || '').toLowerCase();
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
                      const itemServices = getLineItemServices(item, serviceTasks);
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
                            const selectedStatus = getServiceDisplayStatus(serviceName, item, serviceTasks);
                            const matchedTask = getServiceTaskForLine(serviceName, item, serviceTasks);
                            const taskIdForService = getServiceTaskId(matchedTask || {});
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
                                      handleUpdateTask({
                                        taskId: taskIdForService,
                                        status: nextStatus,
                                        ...(nextStatus === 'DONE' ? { unitsDone: getServiceUnits(matchedTask || {}, item) } : {}),
                                      });
                                    }}
                                    className="min-w-[120px] appearance-none rounded-md border border-[#d8e1ef] bg-white px-3 py-2 pr-8 text-[12px] font-semibold text-[#495a77] shadow-sm outline-none disabled:cursor-wait disabled:opacity-70"
                                  >
                                    <option>Done</option>
                                    <option>Pending</option>
                                  </select>
                                  <ChevronDown className="pointer-events-none absolute right-2 top-1/2 h-4 w-4 -translate-y-1/2 text-[#7d8aa2]" />
                                </div>
                              </div>
                            );
                          }) : (
                            <p className="text-sm text-[#7b889f]">No service tasks on this line item.</p>
                          )}

                          {itemDiscrepancies.length ? (
                            <div>
                              <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-amber-700">Discrepancies</p>
                              <div className="space-y-2">
                                {itemDiscrepancies.map((discrepancy, discrepancyIndex) => (
                                  <div key={getDiscrepancyId(discrepancy) || getDiscrepancyLineItemId(discrepancy) || discrepancyIndex} className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2">
                                    <div className="flex items-center justify-between gap-3">
                                      <p className="text-[13px] font-semibold text-amber-900">{itemSku || getDiscrepancySku(discrepancy) || 'Line Item'}</p>
                                      <span className="rounded-full bg-white px-2 py-1 text-[10px] font-semibold text-amber-700">
                                        {discrepancy?.status || 'OPEN'}
                                      </span>
                                    </div>
                                    <p className="mt-1 text-[12px] text-amber-800">
                                      Expected {getDiscrepancyExpectedQty(discrepancy, item)}, received {getDiscrepancyReceivedQty(discrepancy, item)}
                                    </p>
                                  </div>
                                ))}
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
                  <div className="mt-3 text-[11px] text-gray-400">
                    <span>Last edited: {shipment?.updated_at || shipment?.updatedAt || '2 hours ago'} </span>
                  </div>
                </div>
              </div>

              <div className="space-y-6">
                <div className="rounded-none border-0 bg-transparent p-0">
                  <div className="mb-4 flex items-center justify-between">
                    <h3 className="text-[12px] font-semibold uppercase tracking-[0.18em] text-[#6d7b95]">Outbound Boxes</h3>
                  </div>

                  <div className="space-y-4">
                    {boxes.length ? boxes.map((box, index) => {
                      const imageUrl = getBoxImageUrl(box, files);
                      const boxRecordId = getBoxRecordId(box);
                      const boxId = boxRecordId || getBoxId(box);
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
                                  <p className="truncate text-[15px] font-semibold text-[#132347]">{getBoxTitle(box, index)}</p>
                                  <span className="rounded-full bg-[#f3f6fb] px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wide text-[#60708b]">
                                    {getBoxSize(box)}
                                  </span>
                                </div>
                                <p className="mt-1 text-[12px] font-medium text-[#6b7a93]">
                                  {[boxDimensions, boxWeight ? `${boxWeight} KG` : '', skuSummary].filter(Boolean).join(' - ') || 'No box details'}
                                </p>
                              </div>
                            </div>
                            <span className={`w-fit rounded-full px-3 py-1.5 text-[11px] font-semibold ${labelState.className}`}>
                              {labelState.label}
                            </span>
                          </div>

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

                          {!needsLabel ? (
                            <div className="mt-4 flex flex-wrap gap-2">
                              <button
                                type="button"
                                onClick={() => handleBoxFbaLabel(box, index)}
                                className="rounded-[4px] bg-[#132347] px-3 py-2 text-[11px] font-semibold text-white hover:bg-[#0f1b38]"
                              >
                                FBA Label
                              </button>
                              <button
                                type="button"
                                onClick={shipmentDispatchedOrCompleted ? undefined : () => handleMarkBoxDispatched(box)}
                                disabled={shipmentDispatchedOrCompleted || !boxRecordId}
                                className={`rounded-[4px] px-3 py-2 text-[11px] font-semibold text-white disabled:cursor-not-allowed ${
                                  shipmentDispatchedOrCompleted
                                    ? 'bg-emerald-600 disabled:opacity-100'
                                    : 'bg-[#ff9d20] hover:bg-[#f28a18] disabled:opacity-60'
                                }`}
                              >
                                {shipmentDispatchedOrCompleted ? 'Dispatched' : 'Mark Dispatched'}
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
                      <p className="text-sm text-gray-500">No boxes created yet.</p>
                    )}
                  </div>

                  <button
                    onClick={() => setShowAddBoxModal(true)}
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
                            {getDiscrepancyId(item) ? (
                              <button
                                type="button"
                                onClick={() => setResolveDiscrepancyId(getDiscrepancyId(item))}
                                className="rounded-full bg-[#132347] px-2.5 py-1 text-xs font-semibold text-white hover:bg-[#0f1b38]"
                              >
                                Use this ID
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
                <div className="mt-4 space-y-3">
                  <input type="text" placeholder="Discrepancy UUID" value={resolveDiscrepancyId} onChange={(e) => setResolveDiscrepancyId(e.target.value)} className="w-full rounded-lg border border-gray-200 px-3 py-2.5 text-sm" />
                  <input type="text" placeholder="Resolution Notes" value={resolveNotes} onChange={(e) => setResolveNotes(e.target.value)} className="w-full rounded-lg border border-gray-200 px-3 py-2.5 text-sm" />
                  <button onClick={handleResolveDiscrepancy} className="rounded-lg bg-[#132347] px-4 py-2.5 text-sm font-medium text-white hover:bg-[#0f1b38]">Resolve Discrepancy</button>
                </div>
              </div>
              <div className="rounded-xl border border-gray-200 bg-white p-6">
                <h3 className="mb-4 text-sm font-semibold uppercase tracking-wider text-gray-500">Services</h3>
                {serviceTasks.length ? (
                  <div className="mb-4 space-y-3">
                    {serviceTasks.map((service) => {
                      const serviceId = getServiceTaskId(service);
                      const serviceLineItem = findLineItemForServiceTask(service, lineItems);
                      const serviceStatus = String(service?.status || 'PENDING').toUpperCase();
                      const isDone = serviceStatus === 'DONE' || serviceStatus === 'COMPLETED';
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
                                disabled={!serviceId || isDone || updatingTaskId === serviceId}
                                onClick={() => handleUpdateTask({ taskId: serviceId, status: 'DONE', unitsDone: getServiceUnits(service, serviceLineItem) })}
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
                  <input type="text" placeholder="taskId e.g. LINE_ITEM_UUID:FNSKU_LABEL" value={taskId} onChange={(e) => setTaskId(e.target.value)} className="w-full rounded-lg border border-gray-200 px-3 py-2.5 text-sm" />
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
                  <input type="text" placeholder="Service Type e.g. FNSKU_LABEL" value={bulkServiceType} onChange={(e) => setBulkServiceType(e.target.value)} className="w-full rounded-lg border border-gray-200 px-3 py-2.5 text-sm" />
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
                  <input type="text" placeholder="Size" value={boxSize} onChange={(e) => setBoxSize(e.target.value)} className="w-full rounded-lg border border-gray-200 px-3 py-2.5 text-sm" />
                  <input type="number" step="0.01" placeholder="Weight" value={boxWeight} onChange={(e) => setBoxWeight(e.target.value)} className="w-full rounded-lg border border-gray-200 px-3 py-2.5 text-sm" />
                  <div className="grid grid-cols-3 gap-2">
                    <input type="number" placeholder="L" value={boxLength} onChange={(e) => setBoxLength(e.target.value)} className="rounded-lg border border-gray-200 px-3 py-2.5 text-sm" />
                    <input type="number" placeholder="W" value={boxWidth} onChange={(e) => setBoxWidth(e.target.value)} className="rounded-lg border border-gray-200 px-3 py-2.5 text-sm" />
                    <input type="number" placeholder="H" value={boxHeight} onChange={(e) => setBoxHeight(e.target.value)} className="rounded-lg border border-gray-200 px-3 py-2.5 text-sm" />
                  </div>
                  <div className="flex gap-2">
                    <button onClick={() => handleCreateBox(false)} className="rounded-lg bg-[#ff6900] px-4 py-2.5 text-sm font-medium text-white hover:bg-[#e55d00]">Create Box</button>
                    <button onClick={() => handleCreateBox(true)} className="rounded-lg border border-gray-300 bg-white px-4 py-2.5 text-sm font-medium text-gray-700 hover:bg-gray-50">Create Pallet</button>
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
                <h3 className="mb-4 text-sm font-semibold uppercase tracking-wider text-gray-500">Seal / Assign / Delete Box</h3>
                <div className="space-y-3">
                  <input type="text" placeholder="Assign Box UUID" value={assignBoxId} onChange={(e) => setAssignBoxId(e.target.value)} className="w-full rounded-lg border border-gray-200 px-3 py-2.5 text-sm" />
                  <input type="text" placeholder="Pallet UUID" value={assignPalletId} onChange={(e) => setAssignPalletId(e.target.value)} className="w-full rounded-lg border border-gray-200 px-3 py-2.5 text-sm" />
                  <button onClick={handleAssignPallet} className="rounded-lg border border-gray-300 bg-white px-4 py-2.5 text-sm font-medium text-gray-700 hover:bg-gray-50">Assign To Pallet</button>
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
                <h3 className="text-lg font-semibold text-[#132347]">Add Box / Pallet</h3>
                <button
                  onClick={() => {
                    if (isCreatingBox) return;
                    setShowAddBoxModal(false);
                    resetAddBoxSkuSelection();
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
                    <select value={boxType} onChange={(e) => setBoxType(e.target.value)} className="w-full rounded-lg border border-gray-200 px-3 py-2.5 text-sm">
                      <option value="box">Box</option>
                      <option value="pallet">Pallet</option>
                    </select>
                  </div>
                  <div>
                    <label className="mb-2 block text-[11px] font-semibold uppercase tracking-wide text-gray-400">Size</label>
                    <select value={boxSize} onChange={(e) => setBoxSize(e.target.value)} className="w-full rounded-lg border border-gray-200 px-3 py-2.5 text-sm">
                      <option value="small">Small</option>
                      <option value="medium">Medium</option>
                      <option value="large">Large</option>
                    </select>
                  </div>
                </div>
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
                <div>
                  <label className="mb-2 block text-[11px] font-semibold uppercase tracking-wide text-gray-400">SKU (Line Item + Qty)</label>
                  <div className="grid min-w-0 grid-cols-1 gap-3 sm:grid-cols-[minmax(0,1fr)_96px]">
                    <select value={boxSkuPreview} onChange={(e) => handleBoxSkuPreviewChange(e.target.value)} className="min-w-0 w-full truncate rounded-lg border border-gray-200 px-3 py-2.5 text-sm">
                      <option value="">Select SKU</option>
                      {lineItems.map((item, index) => {
                        const optionValue = getLineItemOptionValue(item);
                        // const availableQty = getLineItemAllocatableQuantity(item, boxes);

                        return (
                          <option key={optionValue || index} value={optionValue} disabled={isBoxSkuOptionSelectedElsewhere(optionValue, 0)}>
                            {getItemSku(item) || getLineItemId(item) || '-'}
                             {/* ({formatQuantityValue(availableQty)} available) */}
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
                      Boxable {formatQuantityValue(selectedBoxBoxableQty)} units, already boxed {formatQuantityValue(selectedBoxAllocatedQty)}, available {formatQuantityValue(selectedBoxMaxQuantity)}.
                    </p>
                  ) : null}
                  {boxSkuExtraRows.length ? (
                    <div className="mt-3 space-y-3">
                      {boxSkuExtraRows.map((row, rowIndex) => {
                        const rowLineItem = findLineItemBySelection(row.lineItemValue);
                        const rowMaxQuantity = rowLineItem ? getLineItemAllocatableQuantity(rowLineItem, boxes, lineItems) : 0;
                        const rowBoxableQty = rowLineItem ? getLineItemBoxableQuantity(rowLineItem) : 0;
                        const rowAllocatedQty = rowLineItem ? getAllocatedQuantityForLineItem(rowLineItem, boxes, lineItems) : 0;
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
                                {lineItems.map((item, index) => {
                                  const optionValue = getLineItemOptionValue(item);

                                  return (
                                    <option key={optionValue || index} value={optionValue} disabled={isBoxSkuOptionSelectedElsewhere(optionValue, visualRowIndex)}>
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
                                Boxable {formatQuantityValue(rowBoxableQty)} units, already boxed {formatQuantityValue(rowAllocatedQty)}, available {formatQuantityValue(rowMaxQuantity)}.
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
              </div>
              <div className="flex justify-end gap-3 border-t border-gray-200 px-6 py-4">
                <button
                  onClick={() => {
                    if (isCreatingBox) return;
                    setShowAddBoxModal(false);
                    resetAddBoxSkuSelection();
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
                      resetAddBoxSkuSelection();
                    }
                  }}
                  className="inline-flex min-w-[96px] items-center justify-center gap-2 rounded-lg bg-[#ff9d3a] px-5 py-2 text-sm font-semibold text-white hover:bg-[#f28a18] disabled:cursor-not-allowed disabled:opacity-70"
                >
                  {isCreatingBox ? (
                    <>
                      <RefreshCw size={14} className="animate-spin" />
                      Add Box...
                    </>
                  ) : (
                    'Add Box'
                  )}
                </button>
              </div>
            </div>
          </div>
        ) : null}
      </div>
    </Layout>
  );
};

export default ShipmentDetail;

