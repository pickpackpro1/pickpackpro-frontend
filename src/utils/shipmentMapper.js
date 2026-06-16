import { normalizeServiceList } from './serviceCatalog';

const LINE_ITEM_KEYS = [
  'shipment_line_items',
  'shipmentLineItems',
  'shipment_items',
  'shipmentItems',
  'line_items',
  'lineItems',
  'items',
  'products',
  'productItems',
  'product_items',
  'lines',
];

const LINE_ITEM_CONTAINERS = ['shipment', 'data', 'record', 'result', 'payload', 'detail', 'row'];

const SHIPMENT_LIST_KEYS = ['shipments', 'rows', 'results', 'data'];

export const firstPresent = (...values) => {
  const value = values.find((currentValue) => {
    if (currentValue === 0 || currentValue === false) return true;
    return currentValue !== undefined && currentValue !== null && String(currentValue).trim() !== '';
  });

  return value === undefined || value === null ? '' : value;
};

export const toArray = (value) => {
  if (Array.isArray(value)) return value;
  if (Array.isArray(value?.rows)) return value.rows;
  if (Array.isArray(value?.data?.rows)) return value.data.rows;
  if (Array.isArray(value?.results)) return value.results;
  if (Array.isArray(value?.data?.results)) return value.data.results;
  if (Array.isArray(value?.data)) return value.data;
  return [];
};

const normalizeId = (value = '') => String(value || '').trim();
const normalizeMatchValue = (value = '') =>
  String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '');

const isLineItemEntityType = (value = '') => {
  const entityType = String(value || '').trim().toLowerCase();
  return !entityType || ['item', 'line_item', 'lineitem', 'shipment_line_item', 'shipmentlineitem'].includes(entityType);
};

const normalizeServices = (...values) => normalizeServiceList(...values);

const hasExplicitBoolean = (value) => {
  if (value === true || value === false || value === 1 || value === 0 || value === '1' || value === '0') return true;
  return ['true', 'false', 'yes', 'no', 'y', 'n'].includes(String(value || '').trim().toLowerCase());
};

const toBooleanFlag = (value) => {
  if (value === true || value === 1 || value === '1') return true;
  if (value === false || value === 0 || value === '0') return false;
  const normalized = String(value || '').trim().toLowerCase();
  if (['true', 'yes', 'y'].includes(normalized)) return true;
  if (['false', 'no', 'n'].includes(normalized)) return false;
  return false;
};

const isPositiveNumber = (value) => {
  const number = Number(value);
  return Number.isFinite(number) && number > 0;
};

const getShipmentRecordId = (shipment = {}) =>
  firstPresent(shipment?.id, shipment?.uuid, shipment?.shipmentId, shipment?.shipment_id);

const getClientName = (shipment = {}) =>
  firstPresent(
    shipment?.clientName,
    shipment?.client_name,
    shipment?.client?.companyName,
    shipment?.client?.company_name,
    shipment?.client?.name,
    shipment?.clients?.companyName,
    shipment?.clients?.company_name,
    shipment?.clients?.name,
    shipment?.clientId,
    shipment?.client_id,
    '-'
  );

const getShipmentReference = (shipment = {}) =>
  firstPresent(shipment?.reference, shipment?.shipmentNumber, shipment?.shipment_number, getShipmentRecordId(shipment), 'N/A');

const getRawShipmentItems = (shipment = {}) => {
  if (Array.isArray(shipment)) return shipment;
  if (!shipment || typeof shipment !== 'object') return [];

  for (const key of LINE_ITEM_KEYS) {
    if (Array.isArray(shipment[key])) return shipment[key];
  }

  for (const key of LINE_ITEM_CONTAINERS) {
    const nested = shipment[key];
    if (!nested || nested === shipment || typeof nested !== 'object') continue;
    const nestedItems = getRawShipmentItems(nested);
    if (nestedItems.length) return nestedItems;
  }

  return [];
};

export const getLineItemId = (item = {}) =>
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
    item?.item_id
  );

export const getLineItemSku = (item = {}) =>
  firstPresent(
    item?.sku,
    item?.sellerSku,
    item?.seller_sku,
    item?.skuCode,
    item?.sku_code,
    item?.product?.sku,
    item?.product?.sellerSku,
    item?.product?.seller_sku,
    item?.products?.sku,
    item?.products?.sellerSku,
    item?.products?.seller_sku
  );

export const getLineItemProductName = (item = {}) =>
  firstPresent(
    item?.productName,
    item?.product_name,
    item?.name,
    item?.product?.productName,
    item?.product?.product_name,
    item?.product?.name,
    item?.products?.productName,
    item?.products?.product_name,
    item?.products?.name
  );

export const getLineItemFnsku = (item = {}) =>
  firstPresent(
    item?.fnsku,
    item?.fnskuLabel,
    item?.fnsku_label,
    item?.fbaFnsku,
    item?.fba_fnsku,
    item?.product?.fnsku,
    item?.product?.fnskuLabel,
    item?.product?.fnsku_label,
    item?.products?.fnsku,
    item?.products?.fnskuLabel,
    item?.products?.fnsku_label
  );

export const getLineItemExpectedQty = (item = {}) =>
  Number(
    firstPresent(
      item?.expectedQty,
      item?.expected_qty,
      item?.qtyExpected,
      item?.qty_expected,
      item?.expectedQuantity,
      item?.expected_quantity,
      item?.expectedUnits,
      item?.expected_units,
      item?.quantity,
      item?.qty,
      item?.units,
      0
    )
  );

export const getLineItemReceivedQty = (item = {}) =>
  firstPresent(
    item?.receivedQty,
    item?.received_qty,
    item?.qtyReceived,
    item?.qty_received,
    item?.receivedQuantity,
    item?.received_quantity,
    item?.receivedUnits,
    item?.received_units,
    ''
  );

export const getLineItemLabelFileId = (item = {}) =>
  firstPresent(
    item?.fnskuLabelFileId,
    item?.fnsku_label_file_id,
    item?.fnskuFileId,
    item?.fnsku_file_id,
    item?.labelFileId,
    item?.label_file_id,
    item?.fileId,
    item?.file_id,
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

export const getFileId = (file = {}) =>
  firstPresent(file?.fileId, file?.file_id, file?.id, file?.uuid);

export const getFileEntityId = (file = {}) =>
  firstPresent(file?.entityId, file?.entity_id, file?.linkedEntityId, file?.linked_entity_id);

export const getFileLinkedEntityId = (file = {}) =>
  firstPresent(file?.linkedEntityId, file?.linked_entity_id);

export const getFileEntityType = (file = {}) =>
  String(firstPresent(file?.entityType, file?.entity_type, file?.linkedEntityType, file?.linked_entity_type)).toLowerCase();

export const getFileLinkedEntityType = (file = {}) =>
  String(firstPresent(file?.linkedEntityType, file?.linked_entity_type)).toLowerCase();

export const getFileType = (file = {}) =>
  String(firstPresent(file?.fileType, file?.file_type, file?.type)).toLowerCase();

export const getFileName = (file = {}) =>
  firstPresent(file?.fileName, file?.file_name, file?.originalFilename, file?.original_filename, file?.name);

export const normalizeUploadedFile = (file = {}) => ({
  ...file,
  id: getFileId(file),
  fileId: getFileId(file),
  file_id: getFileId(file),
  fileType: firstPresent(file?.fileType, file?.file_type),
  file_type: firstPresent(file?.file_type, file?.fileType),
  fileName: getFileName(file),
  file_name: getFileName(file),
  originalFilename: firstPresent(file?.originalFilename, file?.original_filename, getFileName(file)),
  original_filename: firstPresent(file?.original_filename, file?.originalFilename, getFileName(file)),
  mimeType: firstPresent(file?.mimeType, file?.mime_type),
  mime_type: firstPresent(file?.mime_type, file?.mimeType),
  storagePath: firstPresent(file?.storagePath, file?.storage_path),
  storage_path: firstPresent(file?.storage_path, file?.storagePath),
  entityType: firstPresent(file?.entityType, file?.entity_type, file?.linkedEntityType, file?.linked_entity_type),
  entity_type: firstPresent(file?.entity_type, file?.entityType, file?.linked_entity_type, file?.linkedEntityType),
  entityId: getFileEntityId(file),
  entity_id: getFileEntityId(file),
  linkedEntityType: firstPresent(file?.linkedEntityType, file?.linked_entity_type),
  linked_entity_type: firstPresent(file?.linked_entity_type, file?.linkedEntityType),
  linkedEntityId: firstPresent(file?.linkedEntityId, file?.linked_entity_id),
  linked_entity_id: firstPresent(file?.linked_entity_id, file?.linkedEntityId),
  url: firstPresent(file?.url, file?.publicUrl, file?.public_url, file?.fileUrl, file?.file_url),
  publicUrl: firstPresent(file?.publicUrl, file?.public_url, file?.url),
  public_url: firstPresent(file?.public_url, file?.publicUrl, file?.url),
});

export const getLineItemLabelFile = (item = {}) => {
  const directFile = item?.fnskuLabelFile || item?.fnsku_label_file;
  if (!directFile || typeof directFile !== 'object') return null;
  return normalizeUploadedFile({
    ...directFile,
    entityType: firstPresent(directFile?.entityType, directFile?.entity_type, 'item'),
    entityId: firstPresent(directFile?.entityId, directFile?.entity_id, getLineItemId(item)),
    fileType: firstPresent(directFile?.fileType, directFile?.file_type, 'fnsku_label'),
  });
};

export const lineItemFileMatches = (file = {}, item = {}) => {
  const normalizedFile = normalizeUploadedFile(file);
  const itemId = normalizeId(getLineItemId(item));
  const itemFileId = normalizeId(getLineItemLabelFileId(item));
  const fileId = normalizeId(getFileId(normalizedFile));
  const fileEntityId = normalizeId(firstPresent(normalizedFile?.entityId, normalizedFile?.entity_id));
  const linkedEntityId = normalizeId(getFileLinkedEntityId(normalizedFile));
  const fileEntityType = getFileEntityType(normalizedFile);
  const linkedEntityType = getFileLinkedEntityType(normalizedFile);

  if (itemFileId && fileId && itemFileId === fileId) return true;
  if (itemId && fileEntityId && itemId === fileEntityId && isLineItemEntityType(fileEntityType)) return true;
  if (itemId && linkedEntityId && itemId === linkedEntityId && isLineItemEntityType(linkedEntityType)) return true;

  return false;
};

export const findLineItemLabelFile = (item = {}, files = []) => {
  const directFile = getLineItemLabelFile(item);
  if (directFile) return directFile;

  const itemLabelFileId = normalizeId(getLineItemLabelFileId(item));
  const normalizedFiles = toArray(files).map(normalizeUploadedFile);

  return (
    normalizedFiles.find((file) => itemLabelFileId && normalizeId(getFileId(file)) === itemLabelFileId) ||
    normalizedFiles.find((file) => lineItemFileMatches(file, item)) ||
    null
  );
};

export const getItemLabelFileAssignments = (items = [], files = []) => {
  const itemList = Array.isArray(items)
    ? items.map((item, index) => normalizeLineItem(item, index))
    : getShipmentItems(items);

  return itemList.map((item) => findLineItemLabelFile(item, files));
};

export const normalizeLineItem = (item = {}, index = 0) => {
  const product = item?.product || item?.products || {};
  const id = getLineItemId(item);
  const sku = getLineItemSku(item);
  const productName = getLineItemProductName(item);
  const fnsku = getLineItemFnsku(item);
  const fnskuLabelFile = getLineItemLabelFile(item);
  const displayOrder = firstPresent(item?.displayOrder, item?.display_order, item?.itemIndex, item?.item_index, item?.lineItemIndex, item?.line_item_index, index);
  const itemIndex = firstPresent(item?.itemIndex, item?.item_index, item?.lineItemIndex, item?.line_item_index, displayOrder, index);
  const rawBundleSize = Number(firstPresent(item?.bundleSize, item?.bundle_size, 0) || 0);
  const rawServices = normalizeServices(
    item?.services,
    item?.servicesSelected,
    item?.services_selected
  );
  const explicitNeedsBundling =
    hasExplicitBoolean(item?.needsBundling)
      ? toBooleanFlag(item.needsBundling)
      : hasExplicitBoolean(item?.needs_bundling)
        ? toBooleanFlag(item.needs_bundling)
        : false;
  const needsBundling = explicitNeedsBundling;
  const bundleSize = needsBundling ? rawBundleSize : 0;
  const services = normalizeServices(rawServices);

  return {
    ...item,
    id,
    shipmentItemId: firstPresent(item?.shipmentItemId, item?.shipment_item_id, id),
    shipment_item_id: firstPresent(item?.shipment_item_id, item?.shipmentItemId, id),
    productId: firstPresent(item?.productId, item?.product_id, product?.id, product?.uuid),
    product_id: firstPresent(item?.product_id, item?.productId, product?.id, product?.uuid),
    product,
    products: item?.products || product,
    sku,
    sellerSku: firstPresent(item?.sellerSku, item?.seller_sku, sku),
    seller_sku: firstPresent(item?.seller_sku, item?.sellerSku, sku),
    productName,
    product_name: productName,
    fnsku,
    fnskuLabel: firstPresent(item?.fnskuLabel, item?.fnsku_label, fnsku),
    fnsku_label: firstPresent(item?.fnsku_label, item?.fnskuLabel, fnsku),
    expectedQty: getLineItemExpectedQty(item),
    expected_qty: getLineItemExpectedQty(item),
    qtyExpected: getLineItemExpectedQty(item),
    qty_expected: getLineItemExpectedQty(item),
    receivedQty: getLineItemReceivedQty(item),
    received_qty: getLineItemReceivedQty(item),
    qtyReceived: getLineItemReceivedQty(item),
    qty_received: getLineItemReceivedQty(item),
    dispatchQty: Number(firstPresent(item?.dispatchQty, item?.dispatch_qty, 0) || 0),
    dispatch_qty: Number(firstPresent(item?.dispatch_qty, item?.dispatchQty, 0) || 0),
    needsBundling,
    needs_bundling: needsBundling,
    bundleSize,
    bundle_size: bundleSize,
    displayOrder: Number(firstPresent(displayOrder, index) || 0),
    display_order: Number(firstPresent(displayOrder, index) || 0),
    itemIndex: Number(firstPresent(itemIndex, index) || 0),
    item_index: Number(firstPresent(itemIndex, index) || 0),
    lineItemIndex: Number(firstPresent(item?.lineItemIndex, item?.line_item_index, itemIndex, index) || 0),
    line_item_index: Number(firstPresent(item?.line_item_index, item?.lineItemIndex, itemIndex, index) || 0),
    services,
    servicesSelected: services,
    services_selected: services,
    serviceStatus: firstPresent(item?.serviceStatus, item?.service_status),
    service_status: firstPresent(item?.service_status, item?.serviceStatus),
    customServices: toArray(item?.customServices || item?.custom_services),
    custom_services: toArray(item?.custom_services || item?.customServices),
    discrepancyFlag: Boolean(item?.discrepancyFlag ?? item?.qty_discrepancy_flag),
    qty_discrepancy_flag: Boolean(item?.qty_discrepancy_flag ?? item?.discrepancyFlag),
    discrepancyNotes: firstPresent(item?.discrepancyNotes, item?.discrepancy_notes),
    discrepancy_notes: firstPresent(item?.discrepancy_notes, item?.discrepancyNotes),
    fnskuLabelFileId: getLineItemLabelFileId(item),
    fnsku_label_file_id: getLineItemLabelFileId(item),
    fnskuLabelFile,
    fnsku_label_file: fnskuLabelFile,
  };
};

export const sortShipmentItems = (items = []) =>
  toArray(items)
    .map(normalizeLineItem)
    .sort((firstItem, secondItem) => {
      const firstOrder = Number(firstItem.displayOrder ?? firstItem.display_order ?? firstItem.itemIndex ?? firstItem.item_index ?? 0);
      const secondOrder = Number(secondItem.displayOrder ?? secondItem.display_order ?? secondItem.itemIndex ?? secondItem.item_index ?? 0);
      if (Number.isFinite(firstOrder) && Number.isFinite(secondOrder) && firstOrder !== secondOrder) return firstOrder - secondOrder;
      return String(firstItem.sku || '').localeCompare(String(secondItem.sku || ''));
    });

export const getShipmentItems = (shipment = {}) => sortShipmentItems(getRawShipmentItems(shipment));

export const normalizeShipment = (shipment = {}) => {
  const rawShipment = shipment?.shipment || shipment?.data?.shipment || shipment?.data?.record || shipment?.record || shipment?.data || shipment || {};
  const lineItems = getShipmentItems(rawShipment);
  const units = Number(
    firstPresent(
      rawShipment?.units,
      rawShipment?.totalExpectedQty,
      rawShipment?.total_expected_qty,
      lineItems.reduce((sum, item) => sum + Number(item.expectedQty || item.expected_qty || 0), 0),
      0
    )
  );

  return {
    ...rawShipment,
    id: getShipmentRecordId(rawShipment),
    reference: getShipmentReference(rawShipment),
    status: firstPresent(rawShipment?.status, 'draft'),
    clientId: firstPresent(rawShipment?.clientId, rawShipment?.client_id, rawShipment?.client?.id, rawShipment?.clients?.id),
    client_id: firstPresent(rawShipment?.client_id, rawShipment?.clientId, rawShipment?.client?.id, rawShipment?.clients?.id),
    clientName: getClientName(rawShipment),
    client_name: getClientName(rawShipment),
    expectedArrivalDate: firstPresent(rawShipment?.expectedArrivalDate, rawShipment?.expected_arrival_date),
    expected_arrival_date: firstPresent(rawShipment?.expected_arrival_date, rawShipment?.expectedArrivalDate),
    actualArrivalDate: firstPresent(rawShipment?.actualArrivalDate, rawShipment?.actual_arrival_date),
    actual_arrival_date: firstPresent(rawShipment?.actual_arrival_date, rawShipment?.actualArrivalDate),
    dispatchedDate: firstPresent(rawShipment?.dispatchedDate, rawShipment?.dispatched_date),
    dispatched_date: firstPresent(rawShipment?.dispatched_date, rawShipment?.dispatchedDate),
    completedDate: firstPresent(rawShipment?.completedDate, rawShipment?.completed_date),
    completed_date: firstPresent(rawShipment?.completed_date, rawShipment?.completedDate),
    notes: firstPresent(rawShipment?.notes, rawShipment?.clientNotes, rawShipment?.client_notes),
    clientNotes: firstPresent(rawShipment?.clientNotes, rawShipment?.client_notes, rawShipment?.notes),
    client_notes: firstPresent(rawShipment?.client_notes, rawShipment?.clientNotes, rawShipment?.notes),
    createdAt: firstPresent(rawShipment?.createdAt, rawShipment?.created_at),
    created_at: firstPresent(rawShipment?.created_at, rawShipment?.createdAt),
    updatedAt: firstPresent(rawShipment?.updatedAt, rawShipment?.updated_at),
    updated_at: firstPresent(rawShipment?.updated_at, rawShipment?.updatedAt),
    units,
    totalExpectedQty: Number(firstPresent(rawShipment?.totalExpectedQty, rawShipment?.total_expected_qty, units, 0) || 0),
    total_expected_qty: Number(firstPresent(rawShipment?.total_expected_qty, rawShipment?.totalExpectedQty, units, 0) || 0),
    totalReceivedQty: Number(firstPresent(rawShipment?.totalReceivedQty, rawShipment?.total_received_qty, 0) || 0),
    total_received_qty: Number(firstPresent(rawShipment?.total_received_qty, rawShipment?.totalReceivedQty, 0) || 0),
    shipment_line_items: lineItems,
    lineItems,
    line_items: lineItems,
    items: lineItems,
  };
};

export const normalizeShipmentList = (payload = {}) => {
  if (Array.isArray(payload)) return payload.map(normalizeShipment);

  for (const key of SHIPMENT_LIST_KEYS) {
    if (Array.isArray(payload?.[key])) return payload[key].map(normalizeShipment);
    if (Array.isArray(payload?.data?.[key])) return payload.data[key].map(normalizeShipment);
  }

  if (payload?.shipment || payload?.data?.shipment || payload?.record || payload?.data?.record) {
    return [normalizeShipment(payload)];
  }

  return toArray(payload).map(normalizeShipment);
};

const getPackageRecordKey = (box = {}, index = 0) =>
  String(
    firstPresent(
      box?.id,
      box?.uuid,
      box?.boxId,
      box?.box_id,
      box?.recordId,
      box?.record_id,
      box?.reference,
      box?.label,
      index
    )
  );

const defaultIsPalletBox = (box = {}) =>
  String(firstPresent(box?.boxType, box?.box_type, box?.containerType, box?.container_type, box?.type, 'box'))
    .trim()
    .toLowerCase() === 'pallet';

const getPackageChildList = (value) => {
  if (Array.isArray(value)) return value;
  if (Array.isArray(value?.boxes)) return value.boxes;
  if (Array.isArray(value?.rows)) return value.rows;
  if (Array.isArray(value?.data)) return value.data;
  return [];
};

const defaultGetPalletChildBoxes = (box = {}) => [
  ...getPackageChildList(box?.palletChildren || box?.pallet_children),
  ...getPackageChildList(box?.childBoxes || box?.child_boxes),
  ...getPackageChildList(box?.children),
];

const uniquePackageRows = (rows = []) => {
  const seenKeys = new Set();

  return rows.filter((row, rowIndex) => {
    const key = String(row?.key || getPackageRecordKey(row?.box, row?.boxIndex ?? rowIndex));
    if (seenKeys.has(key)) return false;
    seenKeys.add(key);
    return true;
  });
};

export const getLineItemOutboundPackageGroups = ({
  item = {},
  boxes = [],
  lineItems = [],
  isBoxLinkedToItem,
  isPalletBox = defaultIsPalletBox,
  getPalletChildBoxes = defaultGetPalletChildBoxes,
  getBoxKey = getPackageRecordKey,
} = {}) => {
  const boxRows = toArray(boxes).map((box, boxIndex) => {
    const key = String(getBoxKey(box, boxIndex) || getPackageRecordKey(box, boxIndex));
    return { box, boxIndex, key };
  });
  const topLevelIndexByKey = new Map(boxRows.map((row) => [row.key, row.boxIndex]));
  const matcher = typeof isBoxLinkedToItem === 'function' ? isBoxLinkedToItem : () => false;
  const boxMatchesItem = (box, boxIndex) => Boolean(matcher(box, item, boxIndex, lineItems));

  const directBoxes = uniquePackageRows(
    boxRows.filter((row) => !isPalletBox(row.box) && boxMatchesItem(row.box, row.boxIndex))
  );

  const pallets = uniquePackageRows(
    boxRows
      .filter((row) => isPalletBox(row.box))
      .map((row) => {
        const children = getPackageChildList(getPalletChildBoxes(row.box));
        const childRows = children.map((childBox, childIndex) => {
          const childKey = String(getBoxKey(childBox, childIndex) || getPackageRecordKey(childBox, childIndex));
          return {
            box: childBox,
            boxIndex: topLevelIndexByKey.has(childKey) ? topLevelIndexByKey.get(childKey) : childIndex,
            key: childKey,
          };
        });
        const matchedChildBoxes = uniquePackageRows(
          childRows.filter((childRow) => boxMatchesItem(childRow.box, childRow.boxIndex))
        );

        return {
          ...row,
          childBoxes: children,
          matchedChildBoxes,
          matchesLineItem: matchedChildBoxes.length > 0,
        };
      })
      .filter((row) => row.matchesLineItem)
  );

  return {
    boxes: directBoxes,
    pallets,
  };
};

export const buildShipmentItemPayload = (item = {}, index = 0) => {
  const normalized = normalizeLineItem(item, index);
  const bundleSize = Number(normalized.bundleSize || 0);
  const needsBundling = Boolean(normalized.needsBundling);
  const sku = String(normalized.sku || '').trim();
  const productName = String(normalized.productName || normalized.product_name || '').trim();
  const expectedQty = Number(normalized.expectedQty || 0);
  const fnskuLabel = String(normalized.fnskuLabel || normalized.fnsku_label || '').trim();
  const displayOrder = Number(firstPresent(normalized.displayOrder, index) || 0);
  const itemIndex = Number(firstPresent(normalized.itemIndex, index) || 0);

  if (needsBundling && !isPositiveNumber(bundleSize)) {
    throw new Error('Bundle size is required when bundling is enabled.');
  }

  const payload = {
    sku,
    productName,
    product_name: productName,
    expectedQty,
    expected_qty: expectedQty,
    qtyExpected: expectedQty,
    qty_expected: expectedQty,
    fnskuLabel,
    fnsku_label: fnskuLabel,
    fnsku: fnskuLabel,
    services: normalizeServices(normalized.services, item?.services),
    needsBundling,
    needs_bundling: needsBundling,
    displayOrder,
    display_order: displayOrder,
    itemIndex,
    item_index: itemIndex,
    lineItemIndex: itemIndex,
    line_item_index: itemIndex,
  };

  if (needsBundling) {
    payload.bundleSize = Number(bundleSize);
    payload.bundle_size = Number(bundleSize);
  }

  return payload;
};

const getUploadMatchKey = (item = {}, index = 0) =>
  String(getLineItemId(item) || `index:${index}`);

export const findSavedLineItemForUpload = (sourceItem = {}, fallbackIndex = 0, savedLineItems = [], usedKeys = new Set()) => {
  const sourceId = normalizeId(getLineItemId(sourceItem));
  const sourceSku = normalizeMatchValue(getLineItemSku(sourceItem));
  const sourceFnsku = normalizeMatchValue(getLineItemFnsku(sourceItem));
  const sourceProduct = normalizeMatchValue(getLineItemProductName(sourceItem));
  const sourceOrder = Number(firstPresent(sourceItem?.displayOrder, sourceItem?.display_order, sourceItem?.itemIndex, sourceItem?.item_index, fallbackIndex));
  const candidates = toArray(savedLineItems).map((lineItem, index) => ({ lineItem: normalizeLineItem(lineItem, index), index }));
  const isUnused = ({ lineItem, index }) => !usedKeys.has(getUploadMatchKey(lineItem, index));
  const useMatch = (match) => {
    const resolvedMatch = match?.lineItem || null;
    if (match) usedKeys.add(getUploadMatchKey(resolvedMatch, match.index));
    return { lineItem: resolvedMatch, matchType: match?.matchType || 'none' };
  };
  const findUniqueBy = (matchType, predicate) => {
    const matches = candidates.filter((candidate) => isUnused(candidate) && predicate(candidate.lineItem));
    return matches.length === 1 ? { ...matches[0], matchType } : null;
  };

  const stableMatch =
    findUniqueBy('line_item_id', (lineItem) => sourceId && sourceId === normalizeId(getLineItemId(lineItem))) ||
    findUniqueBy('sku', (lineItem) => sourceSku && sourceSku === normalizeMatchValue(getLineItemSku(lineItem))) ||
    findUniqueBy('fnsku', (lineItem) => sourceFnsku && sourceFnsku === normalizeMatchValue(getLineItemFnsku(lineItem))) ||
    findUniqueBy('product_name', (lineItem) => sourceProduct && sourceProduct === normalizeMatchValue(getLineItemProductName(lineItem))) ||
    findUniqueBy('display_order', (lineItem) => {
      const lineOrder = Number(firstPresent(lineItem?.displayOrder, lineItem?.display_order, lineItem?.itemIndex, lineItem?.item_index));
      return Number.isFinite(sourceOrder) && Number.isFinite(lineOrder) && sourceOrder === lineOrder;
    });

  return stableMatch ? useMatch(stableMatch) : useMatch(null);
};
