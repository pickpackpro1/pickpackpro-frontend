import React, { useEffect, useMemo, useState } from 'react';
import Layout from './adminlayout/Layout';
import LoadingState from '../common/LoadingState';
import FullPageLoader from '../common/FullPageLoader';
import { getSession } from '../../utils/auth';
import { Truck, Clock, Send, Search, Filter, Download, CheckCircle2 } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { API_MUTATION_EVENT_NAME } from '../../utils/toast';
import {
  getLineItemId as getMappedLineItemId,
  getShipmentItems as getMappedShipmentItems,
  normalizeShipment as normalizeMappedShipment,
  normalizeShipmentList as normalizeMappedShipmentList,
} from '../../utils/shipmentMapper';

const API_BASE_URL = '';

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
    throw new Error(
      payload?.message ||
        payload?.error ||
        payload?.details ||
        (typeof payload === 'string' ? payload : '') ||
        `Request failed with status ${response.status}`
    );
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
  return [];
};

const firstPresent = (...values) => {
  const value = values.find((currentValue) => {
    if (currentValue === 0 || currentValue === false) return true;
    return currentValue !== undefined && currentValue !== null && String(currentValue).trim() !== '';
  });

  return value === undefined || value === null ? '' : value;
};

const extractShipments = (payload) => normalizeMappedShipmentList(payload);

const extractShipmentDetail = (payload) =>
  normalizeMappedShipment(
    payload?.shipment ||
      payload?.data?.shipment ||
      payload?.data?.record ||
      payload?.data?.row ||
      payload?.record ||
      payload?.row ||
      payload?.data ||
      payload ||
      {}
  );

const getLineItems = (shipment) =>
  getMappedShipmentItems(shipment);

const getBoxes = (shipment) =>
  shipment?.boxes || shipment?.shipmentBoxes || shipment?.shipment_boxes || shipment?.outboundBoxes || shipment?.outbound_boxes || [];

const extractBoxes = (payload) => {
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload?.boxes)) return payload.boxes;
  if (Array.isArray(payload?.data?.boxes)) return payload.data.boxes;
  if (Array.isArray(payload?.data?.rows)) return payload.data.rows;
  if (Array.isArray(payload?.data)) return payload.data;
  return [];
};

const extractSubShipments = (payload) => {
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload?.subShipments)) return payload.subShipments;
  if (Array.isArray(payload?.sub_shipments)) return payload.sub_shipments;
  if (Array.isArray(payload?.data?.subShipments)) return payload.data.subShipments;
  if (Array.isArray(payload?.data?.sub_shipments)) return payload.data.sub_shipments;
  return [];
};

const getSubShipmentId = (subShipment = {}) =>
  subShipment?.id || subShipment?.uuid || subShipment?.subShipmentId || subShipment?.sub_shipment_id || '';

const getSubShipmentReference = (subShipment = {}) =>
  subShipment?.reference ||
  subShipment?.subShipmentReference ||
  subShipment?.sub_shipment_reference ||
  (subShipment?.sequence_no ? `Sub-shipment ${subShipment.sequence_no}` : '') ||
  getSubShipmentId(subShipment) ||
  '';

const getSubShipmentBoxes = (subShipment = {}) =>
  getBoxes(subShipment);

const extractFiles = (payload) => {
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload?.files)) return payload.files;
  if (Array.isArray(payload?.data?.files)) return payload.data.files;
  if (Array.isArray(payload?.data?.rows)) return payload.data.rows;
  if (Array.isArray(payload?.data)) return payload.data;
  if (payload?.file && typeof payload.file === 'object') return [payload.file];
  if (payload?.data?.file && typeof payload.data.file === 'object') return [payload.data.file];
  return [];
};

const getBoxId = (box) => box?.id || box?.uuid || box?.boxId || box?.box_id || '';

const getBoxTypeValue = (box = {}) => {
  const value = String(firstPresent(box?.boxType, box?.box_type, box?.containerType, box?.container_type, box?.type, 'box')).trim().toLowerCase();
  return value === 'pallet' ? 'pallet' : 'box';
};

const isPalletBox = (box = {}) => getBoxTypeValue(box) === 'pallet';

const getBoxPalletId = (box = {}) =>
  firstPresent(box?.palletId, box?.pallet_id, box?.pallet?.id, box?.pallet?.uuid);

const isBoxInsidePallet = (box = {}) =>
  Boolean(getBoxPalletId(box) || box?.insidePallet || box?.inside_pallet || box?.isChildBox || box?.is_child_box);

const getPalletChildBoxes = (box = {}) => [
  ...toArray(box?.palletChildren || box?.pallet_children),
  ...toArray(box?.childBoxes || box?.child_boxes),
  ...toArray(box?.children),
];

const getBoxTitle = (box = {}, index = 0) => {
  const rawTitle = firstPresent(box?.reference, box?.label, box?.name);
  const title = String(rawTitle || '').trim();
  if (title) return title;

  const boxNumber = String(firstPresent(box?.boxNumber, box?.box_number) || '').trim();
  if (boxNumber) return `${isPalletBox(box) ? 'Pallet' : 'Box'} ${boxNumber}`;

  const fallbackId = String(box?.id || '').trim();
  return fallbackId || `${isPalletBox(box) ? 'Pallet' : 'Box'} ${index + 1}`;
};

const getDispatchableBoxes = (source = {}) => {
  const dispatchableBoxes = toArray(source?.dispatchableBoxes || source?.dispatchable_boxes);
  if (dispatchableBoxes.length) return dispatchableBoxes;

  const looseBoxes = toArray(source?.looseBoxes || source?.loose_boxes);
  const pallets = toArray(source?.pallets);
  if (looseBoxes.length || pallets.length) return [...looseBoxes, ...pallets];

  return getBoxes(source).filter((box) => !isBoxInsidePallet(box));
};

const getLineItemId = (item = {}) =>
  firstPresent(
    getMappedLineItemId(item),
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
    item?.line_item?.id,
    item?.shipmentItem?.id,
    item?.shipment_item?.id
  );

const getLineItemSku = (item = {}) =>
  firstPresent(
    item?.sku,
    item?.sellerSku,
    item?.seller_sku,
    item?.productSku,
    item?.product_sku,
    item?.shipmentItemSku,
    item?.shipment_item_sku,
    item?.lineItemSku,
    item?.line_item_sku,
    item?.product?.sku,
    item?.product?.sellerSku,
    item?.product?.seller_sku,
    item?.products?.sku,
    item?.products?.sellerSku,
    item?.products?.seller_sku
  );

const getBoxLookupIds = (box = {}) => [
  ...new Set(
    [box?.id, box?.uuid, box?.boxId, box?.box_id, box?.recordId, box?.record_id]
      .map((value) => String(value || '').trim())
      .filter(Boolean)
  ),
];

const getBoxItemsLookupId = (box = {}) => getBoxId(box) || getBoxLookupIds(box).find(Boolean);

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

const getBoxItemDirectSku = (item = {}) =>
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
    item?.shipmentItem?.sku,
    item?.shipmentItem?.sellerSku,
    item?.shipmentItem?.seller_sku,
    item?.shipment_item?.sku,
    item?.shipment_item?.sellerSku,
    item?.shipment_item?.seller_sku,
    item?.lineItem?.sku,
    item?.lineItem?.sellerSku,
    item?.lineItem?.seller_sku,
    item?.line_item?.sku,
    item?.line_item?.sellerSku,
    item?.line_item?.seller_sku,
    item?.item?.sku,
    item?.item?.sellerSku,
    item?.item?.seller_sku
  );

const findLineItemForBoxItem = (boxItem = {}, lineItems = []) => {
  const boxLineItemId = String(getBoxItemLineItemId(boxItem) || '').trim();
  const boxSku = String(getBoxItemDirectSku(boxItem) || '').trim().toLowerCase();

  return toArray(lineItems).find((lineItem) => {
    const lineItemIds = [
      getLineItemId(lineItem),
      lineItem?.id,
      lineItem?.uuid,
      lineItem?.shipmentItemId,
      lineItem?.shipment_item_id,
      lineItem?.shipmentLineItemId,
      lineItem?.shipment_line_item_id,
      lineItem?.lineItemId,
      lineItem?.line_item_id,
    ]
      .map((value) => String(value || '').trim())
      .filter(Boolean);
    const lineItemSku = String(getLineItemSku(lineItem) || '').trim().toLowerCase();

    return Boolean(
      (boxLineItemId && lineItemIds.includes(boxLineItemId)) ||
        (boxSku && lineItemSku && boxSku === lineItemSku)
    );
  });
};

const getBoxItemSku = (item = {}, lineItems = []) =>
  firstPresent(getBoxItemDirectSku(item), getLineItemSku(findLineItemForBoxItem(item, lineItems) || {}));

const getBoxItemQuantity = (item = {}) =>
  firstPresent(
    item?.quantity,
    item?.qty,
    item?.units,
    item?.itemQuantity,
    item?.item_quantity,
    item?.allocatedQuantity,
    item?.allocated_quantity,
    item?.allocatedQty,
    item?.allocated_qty,
    item?.boxedQuantity,
    item?.boxed_quantity,
    item?.packedQuantity,
    item?.packed_quantity,
    item?.receivedQty,
    item?.received_qty
  );

const getBoxUnits = (box = {}) =>
  firstPresent(
    box?.units,
    box?.unitCount,
    box?.unit_count,
    box?.quantity,
    box?.qty,
    box?.boxQuantity,
    box?.box_quantity,
    box?.packedQuantity,
    box?.packed_quantity,
    box?.allocatedQuantity,
    box?.allocated_quantity,
    box?.allocatedQty,
    box?.allocated_qty
  );

const parseBoxContents = (value) => {
  if (Array.isArray(value)) return value;
  if (!value) return [];
  if (typeof value === 'object') return [value];

  const rawValue = String(value || '').trim();
  if (!rawValue) return [];

  try {
    const parsedValue = JSON.parse(rawValue);
    if (Array.isArray(parsedValue)) return parsedValue;
    if (parsedValue && typeof parsedValue === 'object') return [parsedValue];
  } catch {
    // Plain text contents are handled below.
  }

  return [{ sku: rawValue }];
};

const getBoxItems = (box = {}) => {
  const directItems = toArray(box?.items || box?.boxItems || box?.box_items || box?.lineItems || box?.line_items || box?.contents || box?.box_contents);
  if (directItems.length) return directItems;

  const parsedContents = parseBoxContents(firstPresent(box?.contents, box?.box_contents));
  if (parsedContents.length) return parsedContents;

  const inlineQuantity = getBoxItemQuantity(box);
  return (getBoxItemLineItemId(box) || getBoxItemDirectSku(box)) && inlineQuantity !== '' ? [box] : [];
};

const extractBoxItems = (payload) => {
  const directItems = toArray(
    payload?.items ||
      payload?.boxItems ||
      payload?.box_items ||
      payload?.contents ||
      payload?.box_contents ||
      payload?.lineItems ||
      payload?.line_items ||
      payload?.data?.items ||
      payload?.data?.boxItems ||
      payload?.data?.box_items ||
      payload?.data?.contents ||
      payload?.data?.box_contents ||
      payload?.data
  );
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
    const items = toArray(container?.items || container?.boxItems || container?.box_items || container?.contents || container?.box_contents || container?.lineItems || container?.line_items);
    if (items.length) return items;
  }

  return [];
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

const getShipmentLookupId = (shipment = {}) =>
  shipment?.id ||
  shipment?.uuid ||
  shipment?.shipmentId ||
  shipment?.shipment_id ||
  shipment?.reference ||
  shipment?.shipmentNumber ||
  shipment?.shipment_number ||
  '';

const getFileName = (file = {}) =>
  String(
    file?.name ||
      file?.fileName ||
      file?.file_name ||
      file?.originalName ||
      file?.original_name ||
      file?.original_filename ||
      file?.path ||
      file?.storagePath ||
      file?.storage_path ||
      file?.url ||
      ''
  ).toLowerCase();

const getFileTypeValue = (file = {}) =>
  String(file?.fileType || file?.file_type || file?.type || file?.mimeType || file?.mime_type || '').toLowerCase();

const getBoxFiles = (box = {}) =>
  extractFiles(box?.files || box?.attachments || box?.uploads || box?.labels || box?.fbaLabels || box?.fba_labels);

const isFbaLabelFile = (file = {}) => {
  const type = getFileTypeValue(file);
  const name = getFileName(file);

  return (
    type === 'fba_shipping_label' ||
    type === 'fba_label' ||
    type.includes('fba_shipping_label') ||
    type.includes('fba') ||
    name.includes('fba') ||
    name.includes('shipping-label') ||
    name.includes('shipping_label')
  );
};

const normalizeBoxLabelFile = (file = {}, boxId = '') => ({
  ...file,
  entityType: file?.entityType || file?.entity_type || 'box',
  entity_type: file?.entity_type || file?.entityType || 'box',
  entityId: file?.entityId || file?.entity_id || boxId,
  entity_id: file?.entity_id || file?.entityId || boxId,
  boxId: file?.boxId || file?.box_id || boxId,
  box_id: file?.box_id || file?.boxId || boxId,
  fileType: file?.fileType || file?.file_type || 'fba_shipping_label',
  file_type: file?.file_type || file?.fileType || 'fba_shipping_label',
});

const getBoxLabelUploaded = (box) =>
  Boolean(
    box?.labelReady ||
      box?.fbaLabelUploaded ||
      box?.fba_label_uploaded ||
      box?.fba_shipping_label_file_id ||
      box?.label_uploaded_at ||
      box?.labelUploaded ||
      box?.label_uploaded ||
      String(box?.status || '').toLowerCase() === 'uploaded' ||
      getBoxFiles(box).some(isFbaLabelFile)
  );

const normalizeStatusValue = (value = '') =>
  String(value || '').trim().toLowerCase().replace(/\s+/g, '_');

const getBoxDispatchState = (shipment = {}, box = {}) => {
  const shipmentStatus = normalizeStatusValue(shipment?.status);
  const boxStatus = normalizeStatusValue(
    box?.status || box?.boxStatus || box?.box_status || box?.state || box?.dispatchStatus || box?.dispatch_status
  );
  const dispatchedAt =
    box?.dispatched_at ||
    box?.dispatchedAt ||
    box?.dispatch_date ||
    box?.dispatchDate ||
    '';

  if (shipmentStatus === 'completed' || shipmentStatus === 'complete' || boxStatus === 'completed' || boxStatus === 'complete') {
    return 'completed';
  }

  if (
    boxStatus === 'dispatched' ||
    boxStatus === 'sealed' ||
    Boolean(dispatchedAt)
  ) {
    return 'dispatched';
  }

  return '';
};

const getDispatchAction = ({ dispatchState, fbaLabelUploaded }) => {
  if (dispatchState === 'completed') return 'Completed';
  if (dispatchState === 'dispatched') return 'Dispatched';
  return fbaLabelUploaded ? 'Dispatch' : 'Chase Client';
};

const isDispatchComplete = (item = {}) =>
  item.action === 'Dispatched' || item.action === 'Completed';

const isDispatchableQueueItem = (item = {}) =>
  (Boolean(item.fbaShippingLabelFileId || item.labelUploadedAt || item.fbaLabelUploaded) || Boolean(item.isPallet)) && !isDispatchComplete(item);

const hydrateBoxesWithLabelFiles = async (boxes = []) => {
  if (!boxes.length) return [];

  const boxFileResults = await Promise.allSettled(
    boxes.map(async (box) => {
      const primaryBoxId = getBoxId(box);
      const lookupIds = getBoxLookupIds(box).filter((boxId, index, values) => values.indexOf(boxId) === index);
      if (!lookupIds.length) return [];

      const fileResults = await Promise.allSettled(
        lookupIds.map(async (boxId) => {
          const filesResponse = await fetch(`${API_BASE_URL}/api/files?entityType=${isPalletBox(box) ? 'pallet' : 'box'}&entityId=${encodeURIComponent(boxId)}`, {
            method: 'GET',
            headers: buildHeaders(),
            cache: 'no-store',
          });
          return extractFiles(await parseResponse(filesResponse)).map((file) => ({
            ...normalizeBoxLabelFile(file, primaryBoxId || boxId),
            entityType: isPalletBox(box) ? 'pallet' : 'box',
            entity_type: isPalletBox(box) ? 'pallet' : 'box',
          }));
        })
      );

      return fileResults.flatMap((result) => (result.status === 'fulfilled' ? result.value : []));
    })
  );

  return boxes.map((box, index) => {
    const files = boxFileResults[index]?.status === 'fulfilled' ? boxFileResults[index].value : [];
    const mergedFiles = [...getBoxFiles(box), ...files];
    const labelUploaded = getBoxLabelUploaded({ ...box, files: mergedFiles });

    return {
      ...box,
      files: mergedFiles,
      labelReady: box?.labelReady || labelUploaded,
      label_ready: box?.label_ready || labelUploaded,
      fbaLabelUploaded: box?.fbaLabelUploaded || labelUploaded,
      fba_label_uploaded: box?.fba_label_uploaded || labelUploaded,
    };
  });
};

const enrichBoxWithItems = async (box = {}) => {
  const existingItems = getBoxItems(box);
  const hasUsableItems = existingItems.some((item) => (getBoxItemLineItemId(item) || getBoxItemSku(item)) && getBoxItemQuantity(item) !== '');
  if (hasUsableItems) return box;

  const boxItems = await fetchBoxItemsByBoxId(box);
  return boxItems.length
    ? {
        ...box,
        items: boxItems,
        boxItems,
        box_items: boxItems,
        contents: boxItems,
      }
    : box;
};

const enrichBoxesWithItems = async (boxList = []) => {
  if (!boxList.length) return [];

  const results = await Promise.allSettled(boxList.map((box) => enrichBoxWithItems(box)));
  return results.map((result, index) => (result.status === 'fulfilled' ? result.value : boxList[index]));
};

const fetchSubShipmentsForDispatch = async (shipmentId = '', shipment = {}) => {
  if (!shipmentId) return extractSubShipments(shipment);

  try {
    const response = await fetch(`${API_BASE_URL}/api/shipments/${encodeURIComponent(shipmentId)}/sub-shipments`, {
      method: 'GET',
      headers: buildHeaders(),
      cache: 'no-store',
    });
    const payload = await parseResponse(response);
    const subShipments = extractSubShipments(payload);

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
          const boxesPayload = await parseResponse(boxesResponse);
          const boxes = extractBoxes(boxesPayload);
          return boxes.length ? boxes : getSubShipmentBoxes(subShipment);
        } catch {
          return getSubShipmentBoxes(subShipment);
        }
      })
    );

    return subShipments.map((subShipment, index) => {
      const boxes = boxResults[index]?.status === 'fulfilled' ? boxResults[index].value : getSubShipmentBoxes(subShipment);
      return {
        ...subShipment,
        boxes,
        outbound_boxes: boxes,
        shipmentBoxes: boxes,
        shipment_boxes: boxes,
      };
    });
  } catch {
    return extractSubShipments(shipment);
  }
};

const enrichShipmentForDispatch = async (shipment) => {
  const shipmentId = getShipmentLookupId(shipment);
  let shipmentDetail = shipment;
  let boxes = getBoxes(shipment);

  if (shipmentId && !getLineItems(shipmentDetail).length) {
    try {
      const detailResponse = await fetch(`${API_BASE_URL}/api/shipments/${encodeURIComponent(shipmentId)}`, {
        method: 'GET',
        headers: buildHeaders(),
        cache: 'no-store',
      });
      const detail = extractShipmentDetail(await parseResponse(detailResponse));
      shipmentDetail = {
        ...shipment,
        ...detail,
        id: shipment?.id || detail?.id,
        reference: shipment?.reference || detail?.reference,
      };
    } catch {
      shipmentDetail = shipment;
    }
  }

  if (shipmentId && !boxes.length) {
    try {
      const boxesResponse = await fetch(`${API_BASE_URL}/api/shipments/${encodeURIComponent(shipmentId)}/boxes`, {
        method: 'GET',
        headers: buildHeaders(),
        cache: 'no-store',
      });
      boxes = extractBoxes(await parseResponse(boxesResponse));
    } catch {
      boxes = getBoxes(shipment);
    }
  }

  boxes = await hydrateBoxesWithLabelFiles(await enrichBoxesWithItems(boxes));
  const subShipments = await Promise.all(
    (await fetchSubShipmentsForDispatch(shipmentId, shipmentDetail)).map(async (subShipment) => {
      const subBoxes = await hydrateBoxesWithLabelFiles(await enrichBoxesWithItems(getSubShipmentBoxes(subShipment)));
      return {
        ...subShipment,
        boxes: subBoxes,
        outbound_boxes: subBoxes,
        shipmentBoxes: subBoxes,
        shipment_boxes: subBoxes,
      };
    })
  );

  return {
    ...shipmentDetail,
    boxes,
    shipmentBoxes: boxes,
    shipment_boxes: boxes,
    subShipments,
    sub_shipments: subShipments,
  };
};

const getSubShipmentItems = (subShipment = {}) =>
  toArray(
    subShipment?.sub_shipment_items ||
      subShipment?.subShipmentItems ||
      subShipment?.sub_shipment_line_items ||
      subShipment?.subShipmentLineItems ||
      subShipment?.shipment_items ||
      subShipment?.shipmentItems ||
      subShipment?.allocationSummary ||
      subShipment?.allocation_summary ||
      subShipment?.items ||
      subShipment?.lineItems ||
      subShipment?.line_items
  );

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

const getSubShipmentFallbackItems = (subShipment = {}, box = {}, lineItems = []) => {
  const boxUnits = getBoxUnits(box);

  return getSubShipmentItems(subShipment)
    .map((item) => {
      const lineItem = getSubShipmentItemLineItem(item);
      const sku = firstPresent(getBoxItemDirectSku(item), getLineItemSku(lineItem), getBoxItemSku(item, lineItems));
      const quantity = firstPresent(
        boxUnits,
        getBoxItemQuantity(item),
        item?.plannedQty,
        item?.planned_qty,
        item?.allocatedQty,
        item?.allocated_qty
      );
      const lineItemId = firstPresent(getBoxItemLineItemId(item), getLineItemId(lineItem));

      return {
        ...item,
        ...(sku ? { sku, sellerSku: sku, seller_sku: sku } : {}),
        ...(lineItemId
          ? {
              shipmentItemId: lineItemId,
              shipment_item_id: lineItemId,
              lineItemId,
              line_item_id: lineItemId,
            }
          : {}),
        ...(quantity !== '' ? { quantity, qty: quantity, units: quantity } : {}),
      };
    })
    .filter((item) => getBoxItemSku(item, lineItems) || getBoxItemQuantity(item) !== '');
};

const formatBoxContentRows = (items = [], lineItems = [], box = {}) => {
  const fallbackQuantity = toArray(items).length === 1 ? getBoxUnits(box) : '';

  return toArray(items)
    .map((boxItem) => {
      const matchedLineItem = findLineItemForBoxItem(boxItem, lineItems);
      const sku = firstPresent(getBoxItemSku(boxItem, lineItems), getLineItemSku(matchedLineItem || {}));
      const quantity = firstPresent(getBoxItemQuantity(boxItem), fallbackQuantity);

      if (sku && quantity !== '') return `${sku} x ${quantity}`;
      if (sku) return sku;
      if (quantity !== '') return `${quantity} units`;
      return '';
    })
    .filter(Boolean);
};

const formatBoxContents = (shipment, box, subShipment = null) => {
  const palletChildren = getPalletChildBoxes(box);
  if (isPalletBox(box) && palletChildren.length) {
    return palletChildren
      .map((childBox, index) => {
        const childTitle = getBoxTitle(childBox, index);
        const childContents = formatBoxContents(shipment, childBox, subShipment);
        return childContents && childContents !== '--' ? `${childTitle}: ${childContents}` : childTitle;
      })
      .join('; ');
  }

  const lineItems = getLineItems(shipment);
  const contentRows = formatBoxContentRows(getBoxItems(box), lineItems, box);
  if (contentRows.length) return contentRows.join(', ');

  const subShipmentContentRows = subShipment
    ? formatBoxContentRows(getSubShipmentFallbackItems(subShipment, box, lineItems), lineItems, box)
    : [];
  if (subShipmentContentRows.length) return subShipmentContentRows.join(', ');

  const directSku = getBoxItemDirectSku(box);
  const directQuantity = getBoxItemQuantity(box);
  if (directSku && directQuantity !== '') return `${directSku} x ${directQuantity}`;
  if (directSku) return directSku;
  if (directQuantity !== '') return `${directQuantity} units`;

  const firstShipmentItem = getLineItems(shipment)[0];
  if (getLineItems(shipment).length === 1 && firstShipmentItem) {
    const sku = getLineItemSku(firstShipmentItem);
    const quantity = firstPresent(getBoxUnits(box), firstShipmentItem?.receivedQty, firstShipmentItem?.received_qty, firstShipmentItem?.expectedQty, firstShipmentItem?.expected_qty);
    if (sku && quantity !== '') return `${sku} x ${quantity}`;
    if (sku) return sku;
    if (quantity !== '') return `${quantity} units`;
  }

  return '--';
};

const getBoxDimensionDedupeValue = (box = {}) => {
  if (typeof box?.dimensions === 'string') return box.dimensions;

  const dimensions = box?.dimensions && typeof box.dimensions === 'object' ? box.dimensions : {};
  return [
    dimensions?.length || dimensions?.l || box?.length || box?.lengthCm || box?.length_cm,
    dimensions?.width || dimensions?.w || box?.width || box?.widthCm || box?.width_cm,
    dimensions?.height || dimensions?.h || box?.height || box?.heightCm || box?.height_cm,
  ]
    .map((value) => String(value || '').trim())
    .filter(Boolean)
    .join('x');
};

const getDispatchBoxDedupeKey = (box = {}, shipment = {}, subShipment = null) => {
  const boxId = String(getBoxId(box) || '').trim();
  if (boxId) return `id:${boxId}`;

  const label = String(box?.reference || box?.label || box?.name || box?.boxNumber || box?.box_number || '').trim().toLowerCase();
  const dimensions = String(getBoxDimensionDedupeValue(box) || '').trim().toLowerCase();
  const weight = String(box?.weight || box?.weightKg || box?.weight_kg || box?.grossWeight || box?.gross_weight || '').trim().toLowerCase();
  const labelFileId = String(box?.fba_shipping_label_file_id || box?.fbaShippingLabelFileId || box?.label_file_id || box?.labelFileId || '').trim().toLowerCase();
  const contents = String(formatBoxContents(shipment, box, subShipment) || '').trim().toLowerCase();
  const fallbackParts = [label, dimensions, weight, labelFileId, contents].filter(Boolean);

  return fallbackParts.length >= 2 ? `fallback:${fallbackParts.join('|')}` : '';
};

const dedupeDispatchBoxRows = (rows = [], shipment = {}) => {
  const rowsByBox = new Map();
  const rowsWithoutKey = [];

  rows.forEach((row, index) => {
    const key = getDispatchBoxDedupeKey(row?.box || {}, shipment, row?.subShipment || null);
    const rowWithIndex = { ...row, __displayIndex: index };

    if (!key) {
      rowsWithoutKey.push(rowWithIndex);
      return;
    }

    const existingRow = rowsByBox.get(key);
    if (!existingRow || (!existingRow.subShipment && row?.subShipment)) {
      rowsByBox.set(key, rowWithIndex);
    }
  });

  return [...rowsByBox.values(), ...rowsWithoutKey]
    .sort((firstRow, secondRow) => firstRow.__displayIndex - secondRow.__displayIndex)
    .map(({ __displayIndex, ...row }) => row);
};

const normalizeDispatchShipment = (shipment) => {
  const status = String(shipment?.status || 'draft').toLowerCase();
  const reference =
    shipment?.reference ||
    shipment?.shipmentNumber ||
    shipment?.shipment_number ||
    shipment?.id ||
    'N/A';

  const shipmentId = shipment?.id || shipment?.uuid || reference;
  const client =
    shipment?.client?.companyName ||
    shipment?.client?.company_name ||
    shipment?.clients?.companyName ||
    shipment?.clients?.company_name ||
    shipment?.clientName ||
    shipment?.client_name ||
    shipment?.clientId ||
    shipment?.client_id ||
    '-';
  const boxes = getDispatchableBoxes(shipment);
  const subShipments = extractSubShipments(shipment);
  const parentRows = boxes.map((box) => ({ box, subShipment: null }));
  const subShipmentRows = subShipments.flatMap((subShipment) =>
    getDispatchableBoxes(subShipment).map((box) => ({ box, subShipment }))
  );
  const normalizedBoxes = parentRows.length || subShipmentRows.length
    ? dedupeDispatchBoxRows([...parentRows, ...subShipmentRows], shipment)
    : [{ box: {}, subShipment: null }];

  return normalizedBoxes.map(({ box, subShipment }, index) => {
    const subShipmentId = getSubShipmentId(subShipment || {});
    const subShipmentReference = getSubShipmentReference(subShipment || {});
    const isPallet = isPalletBox(box);
    const palletChildren = getPalletChildBoxes(box);
    const boxLabel = getBoxTitle(box, index) || (parentRows.length || subShipmentRows.length ? `BOX-${String(index + 1).padStart(2, '0')}` : '--');
    const boxType = isPallet ? 'Pallet' : (box?.boxType || box?.box_type || box?.type || box?.size || box?.boxSize || box?.box_size || '--');
    const weight = Number(box?.weight || box?.weightKg || box?.weight_kg || box?.grossWeight || box?.gross_weight || 0);
    const fbaLabelUploaded = parentRows.length || subShipmentRows.length
      ? getBoxLabelUploaded(box)
      : Boolean(shipment?.fbaLabelUploaded || shipment?.fba_label_uploaded || shipment?.labelUploaded || shipment?.label_uploaded);
    const dispatchedAt = box?.dispatched_at || box?.dispatchedAt || '';
    const dispatchState = getBoxDispatchState(subShipment || shipment, box);
    const action = isPallet && !dispatchState ? 'Dispatch' : getDispatchAction({ dispatchState, fbaLabelUploaded });

    return {
      id: `${shipmentId}-${subShipmentId || 'parent'}-${box?.id || boxLabel || index}`,
      boxId: getBoxId(box),
      shipmentId,
      shipment: reference,
      subShipmentId,
      subShipment: subShipmentReference || '-',
      client,
      box: boxLabel,
      type: String(boxType).replaceAll('_', ' '),
      weight: weight ? `${weight} kg` : '--',
      contents: formatBoxContents(shipment, box, subShipment),
      childBoxCount: palletChildren.length,
      childBoxes: palletChildren.map((childBox, childIndex) => getBoxTitle(childBox, childIndex)).join(', '),
      isPallet,
      fbaLabel: fbaLabelUploaded ? 'Uploaded' : 'Missing',
      fbaLabelUploaded,
      fbaShippingLabelFileId: box?.fba_shipping_label_file_id || box?.fbaShippingLabelFileId || '',
      labelUploadedAt: box?.label_uploaded_at || box?.labelUploadedAt || '',
      dispatchedAt,
      dispatchState,
      rawStatus: dispatchState || status,
      action,
    };
  });
};

const FILTER_OPTIONS = [
  { value: 'all', label: 'All' },
  { value: 'ready', label: 'Ready to Dispatch' },
  { value: 'missing', label: 'Need Follow-up' },
  { value: 'dispatched', label: 'Dispatched' },
];

const Dispatch = () => {
  const [shipments, setShipments] = useState([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [dispatchFilter, setDispatchFilter] = useState('all');
  const [isLoading, setIsLoading] = useState(false);
  const [isUpdatingId, setIsUpdatingId] = useState('');
  const [selectedDispatchIds, setSelectedDispatchIds] = useState([]);
  const [isBulkDispatching, setIsBulkDispatching] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const navigate = useNavigate();

  const loadShipments = async ({ silent = false } = {}) => {
    try {
      if (!silent) setIsLoading(true);
      setError('');
      const query = new URLSearchParams({
        page: '1',
        limit: '50',
      });
      const response = await fetch(`${API_BASE_URL}/api/shipments?${query.toString()}`, {
        method: 'GET',
        headers: buildHeaders(),
      });
      const payload = await parseResponse(response);
      const enrichedShipments = await Promise.all(extractShipments(payload).map(enrichShipmentForDispatch));
      setShipments(enrichedShipments.flatMap(normalizeDispatchShipment));
    } catch (requestError) {
      setError(requestError.message);
      if (!silent) setShipments([]);
    } finally {
      if (!silent) setIsLoading(false);
    }
  };

  useEffect(() => {
    loadShipments();
  }, []);

  useEffect(() => {
    let refreshTimer = null;

    const scheduleRefresh = () => {
      window.clearTimeout(refreshTimer);
      refreshTimer = window.setTimeout(() => {
        loadShipments({ silent: true });
      }, 700);
    };

    const handleMutation = (event) => {
      const url = String(event?.detail?.url || '');
      if (!url.includes('/api/files') && !url.includes('/api/boxes') && !url.includes('/api/shipments')) return;
      scheduleRefresh();
    };

    window.addEventListener(API_MUTATION_EVENT_NAME, handleMutation);

    return () => {
      window.clearTimeout(refreshTimer);
      window.removeEventListener(API_MUTATION_EVENT_NAME, handleMutation);
    };
  }, []);

  const filteredQueue = useMemo(() => {
    const term = searchTerm.trim().toLowerCase();

    return shipments.filter((item) => {
      const matchesSearch =
        !term ||
        item.shipment.toLowerCase().includes(term) ||
        item.subShipment.toLowerCase().includes(term) ||
        item.client.toLowerCase().includes(term) ||
        item.box.toLowerCase().includes(term) ||
        item.type.toLowerCase().includes(term) ||
        item.contents.toLowerCase().includes(term);

      if (!matchesSearch) {
        return false;
      }

      if (dispatchFilter === 'ready') {
        return item.action === 'Dispatch';
      }

      if (dispatchFilter === 'missing') {
        return item.action === 'Chase Client';
      }

      if (dispatchFilter === 'dispatched') {
        return item.action === 'Dispatched' || item.action === 'Completed';
      }

      return true;
    });
  }, [dispatchFilter, searchTerm, shipments]);

  const statsCards = useMemo(() => {
    const ready = shipments.filter((item) => item.action === 'Dispatch').length;
    const missing = shipments.filter((item) => item.action === 'Chase Client').length;
    const dispatchedToday = shipments.filter((item) => item.action === 'Dispatched' || item.action === 'Completed').length;

    return [
      {
        title: 'SENT TODAY',
        value: String(dispatchedToday),
        icon: Send,
        iconBg: 'bg-blue-50',
        iconColor: 'text-blue-600',
      },
      {
        title: 'AWAITING',
        value: String(missing),
        subtitle: `${missing} need follow-up`,
        icon: Clock,
        iconBg: 'bg-orange-50',
        iconColor: 'text-orange-600',
      },
      {
        title: 'DISPATCH READY',
        value: String(ready),
        subtitle: `${ready} ready boxes`,
        icon: Truck,
        iconBg: 'bg-green-50',
        iconColor: 'text-green-600',
      },
    ];
  }, [shipments]);

  useEffect(() => {
    setSelectedDispatchIds((currentIds) =>
      currentIds.filter((selectedId) =>
        shipments.some((item) => item.id === selectedId && isDispatchableQueueItem(item))
      )
    );
  }, [shipments]);

  const visibleDispatchableIds = useMemo(
    () => filteredQueue.filter(isDispatchableQueueItem).map((item) => item.id),
    [filteredQueue]
  );
  const selectedDispatchItems = useMemo(
    () => shipments.filter((item) => selectedDispatchIds.includes(item.id) && isDispatchableQueueItem(item)),
    [selectedDispatchIds, shipments]
  );
  const allVisibleDispatchableSelected =
    visibleDispatchableIds.length > 0 &&
    visibleDispatchableIds.every((id) => selectedDispatchIds.includes(id));
  const someVisibleDispatchableSelected =
    visibleDispatchableIds.some((id) => selectedDispatchIds.includes(id)) && !allVisibleDispatchableSelected;

  const applyDispatchedBoxState = (box, boxId, updatedBox = {}) => {
    const dispatchedAt =
      updatedBox?.dispatched_at ||
      updatedBox?.dispatchedAt ||
      updatedBox?.dispatch_date ||
      updatedBox?.dispatchDate ||
      new Date().toISOString();
    const updatedStatus = normalizeStatusValue(updatedBox?.status);
    const nextState = updatedStatus === 'completed' || updatedStatus === 'complete' ? 'completed' : 'dispatched';
    const nextAction = getDispatchAction({ dispatchState: nextState, fbaLabelUploaded: true });

    setShipments((currentShipments) =>
      currentShipments.map((item) => {
        const itemBoxId = String(item.boxId || '');
        const itemRowId = String(item.id || '');
        const requestedBoxId = String(boxId || '');
        const requestedRowId = String(box?.id || '');
        const isTargetBox =
          itemBoxId === requestedBoxId ||
          itemRowId === requestedBoxId ||
          (requestedRowId && itemRowId === requestedRowId);

        if (!isTargetBox) return item;

        return {
          ...item,
          fbaLabel: 'Uploaded',
          fbaLabelUploaded: true,
          dispatchedAt,
          dispatchState: nextState,
          rawStatus: nextState,
          action: nextAction,
        };
      })
    );
    setSelectedDispatchIds((currentIds) => currentIds.filter((id) => id !== box?.id));
  };

  const dispatchBoxRequest = async (box) => {
    const boxId = box?.boxId || box?.id || box?.uuid;
    if (!boxId) {
      throw new Error('Box ID missing');
    }

    const response = await fetch(`${API_BASE_URL}/api/boxes/${encodeURIComponent(boxId)}/seal`, {
      method: 'PATCH',
      headers: buildHeaders(true),
      body: JSON.stringify({}),
    });
    const payload = await parseResponse(response);
    const updatedBox = payload?.box || payload?.data?.box || payload?.data || payload || {};
    applyDispatchedBoxState(box, boxId, updatedBox);
    return updatedBox;
  };

  const toggleDispatchSelection = (item) => {
    if (!isDispatchableQueueItem(item) || isBulkDispatching) return;

    setSelectedDispatchIds((currentIds) =>
      currentIds.includes(item.id)
        ? currentIds.filter((id) => id !== item.id)
        : [...currentIds, item.id]
    );
  };

  const toggleVisibleDispatchSelection = () => {
    if (!visibleDispatchableIds.length || isBulkDispatching) return;

    setSelectedDispatchIds((currentIds) => {
      if (visibleDispatchableIds.every((id) => currentIds.includes(id))) {
        return currentIds.filter((id) => !visibleDispatchableIds.includes(id));
      }

      return [...new Set([...currentIds, ...visibleDispatchableIds])];
    });
  };

  const handleDispatchBox = async (box) => {
    const boxId = box?.boxId || box?.id || box?.uuid;

    try {
      if (box?.isPallet && !box?.fbaLabelUploaded && !box?.fbaShippingLabelFileId && !box?.labelUploadedAt) {
        const confirmed = window.confirm('This pallet does not have an FBA label. Are you sure you want to dispatch this pallet without a pallet FBA label?');
        if (!confirmed) return;
      }

      setIsUpdatingId(boxId);
      setError('');
      setMessage('');
      await dispatchBoxRequest(box);
      await loadShipments({ silent: true });
      setMessage(`${box?.isPallet ? 'Pallet' : 'Box'} dispatched successfully.`);
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setIsUpdatingId('');
    }
  };

  const handleBulkDispatch = async () => {
    const boxesToDispatch = selectedDispatchItems;
    if (!boxesToDispatch.length) {
      setError('Select at least one dispatch-ready record.');
      return;
    }

    try {
      setIsBulkDispatching(true);
      setIsUpdatingId('bulk');
      setError('');
      setMessage('');

      const palletsWithoutLabels = boxesToDispatch.filter((box) => box?.isPallet && !box?.fbaLabelUploaded && !box?.fbaShippingLabelFileId && !box?.labelUploadedAt);
      if (palletsWithoutLabels.length) {
        const confirmed = window.confirm('One or more selected pallets do not have FBA labels. Are you sure you want to dispatch these pallets without pallet FBA labels?');
        if (!confirmed) return;
      }

      const results = await Promise.allSettled(boxesToDispatch.map(dispatchBoxRequest));
      const dispatchedCount = results.filter((result) => result.status === 'fulfilled').length;
      const failedCount = results.length - dispatchedCount;

      if (failedCount) {
        setError(`${failedCount} selected record${failedCount === 1 ? '' : 's'} could not be dispatched.`);
      }

      if (dispatchedCount) {
        await loadShipments({ silent: true });
        setMessage(`${dispatchedCount} selected record${dispatchedCount === 1 ? '' : 's'} dispatched successfully.`);
      }
    } finally {
      setIsBulkDispatching(false);
      setIsUpdatingId('');
    }
  };

  const handleChaseClient = (box) => {
    navigate(`/shipments/${box.shipmentId}`);
  };

  const handleExport = () => {
    const rows = [
      ['Shipment', 'Sub-shipment', 'Client', 'Box', 'Type', 'Weight', 'Contents', 'FBA Label', 'Action'],
      ...filteredQueue.map((item) => [
        item.shipment,
        item.subShipment,
        item.client,
        item.box,
        item.type,
        item.weight,
        item.contents,
        item.fbaLabel,
        item.action,
      ]),
    ];

    const csv = rows
      .map((row) => row.map((value) => `"${String(value).replace(/"/g, '""')}"`).join(','))
      .join('\n');

    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = 'dispatch-queue.csv';
    anchor.click();
    URL.revokeObjectURL(url);
  };

  return (
    <Layout>
      <FullPageLoader show={isLoading} label="Loading shipments..." />
      <div className="min-h-screen ">
        <div className="mb-6">
          <h1 className="text-2xl font-semibold text-gray-900">Dispatch</h1>
          <p className="mt-1 text-sm text-gray-500">Manage outbound shipments and deliveries.</p>
        </div>

        {(error || message) ? (
          <div className="mb-4 space-y-2">
            {error ? (
              <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>
            ) : null}
            {message ? (
              <div className="rounded-lg border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-700">{message}</div>
            ) : null}
          </div>
        ) : null}

        <div className="mb-6 grid grid-cols-1 gap-6 md:grid-cols-3">
          {statsCards.map((card, index) => {
            const Icon = card.icon;
            return (
              <div
                key={index}
                className="rounded-lg border border-gray-200 bg-white p-6 transition-shadow duration-200 hover:shadow-sm"
              >
                <div className="mb-3 flex items-start justify-between">
                  <p className="text-xs font-semibold uppercase tracking-wider text-gray-500">
                    {card.title}
                  </p>
                  <div className={`rounded-lg p-2 ${card.iconBg}`}>
                    <Icon size={18} className={card.iconColor} />
                  </div>
                </div>
                <h3 className="mb-1 text-3xl font-bold text-gray-900">{card.value}</h3>
                {card.subtitle ? <p className="text-sm text-gray-500">{card.subtitle}</p> : null}
              </div>
            );
          })}
        </div>

        <div className="overflow-hidden rounded-lg border border-gray-200 bg-white">
          <div className="flex flex-col gap-4 border-b border-gray-200 px-6 py-4 md:flex-row md:items-center md:justify-between">
            <div className="flex items-center gap-2">
              <h2 className="text-base font-semibold text-gray-900">Outbound Queue</h2>
              <span className="rounded bg-gray-100 px-2 py-1 text-[10px] font-semibold uppercase tracking-wider text-gray-500">
                {filteredQueue.length} boxes total
              </span>
            </div>
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
              <button
                type="button"
                onClick={handleBulkDispatch}
                disabled={!selectedDispatchItems.length || isBulkDispatching}
                className="inline-flex items-center justify-center gap-1.5 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <Send size={14} />
                {isBulkDispatching ? 'Dispatching...' : `Dispatch${selectedDispatchItems.length ? ` (${selectedDispatchItems.length})` : ''}`}
              </button>
              <div className="relative">
                <Search
                  size={14}
                  className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400"
                />
                <input
                  type="text"
                  placeholder="Search shipments..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="w-56 rounded-lg border border-gray-200 py-1.5 pl-8 pr-4 text-sm focus:border-transparent focus:outline-none focus:ring-2 focus:ring-[#ff6900]"
                />
              </div>
              <div className="relative">
                <Filter
                  size={14}
                  className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-gray-400"
                />
                <select
                  value={dispatchFilter}
                  onChange={(e) => setDispatchFilter(e.target.value)}
                  className="rounded-lg border border-gray-200 py-2 pl-8 pr-9 text-sm font-medium text-gray-600 focus:border-transparent focus:outline-none focus:ring-2 focus:ring-[#ff6900]"
                >
                  {FILTER_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </div>
              <button
                onClick={handleExport}
                className="inline-flex items-center gap-1.5 rounded-lg border border-gray-200 px-3 py-2 text-sm font-medium text-gray-600 hover:bg-gray-50"
              >
                <Download size={14} />
                Export
              </button>
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-gray-100">
                  <th className="w-12 px-6 py-3 text-left">
                    <input
                      type="checkbox"
                      checked={allVisibleDispatchableSelected}
                      aria-checked={someVisibleDispatchableSelected ? 'mixed' : allVisibleDispatchableSelected}
                      aria-label="Select all dispatch-ready records"
                      disabled={!visibleDispatchableIds.length || isBulkDispatching}
                      onChange={toggleVisibleDispatchSelection}
                      className="h-4 w-4 rounded border-gray-300 text-[#ff6900] focus:ring-[#ff6900] disabled:cursor-not-allowed disabled:opacity-50"
                    />
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-semibold uppercase tracking-wider text-gray-500">Shipment</th>
                  <th className="px-6 py-3 text-left text-xs font-semibold uppercase tracking-wider text-gray-500">Sub-shipment</th>
                  <th className="px-6 py-3 text-left text-xs font-semibold uppercase tracking-wider text-gray-500">Client</th>
                  <th className="px-6 py-3 text-left text-xs font-semibold uppercase tracking-wider text-gray-500">Box</th>
                  <th className="px-6 py-3 text-left text-xs font-semibold uppercase tracking-wider text-gray-500">Type</th>
                  <th className="px-6 py-3 text-left text-xs font-semibold uppercase tracking-wider text-gray-500">Weight</th>
                  <th className="px-6 py-3 text-left text-xs font-semibold uppercase tracking-wider text-gray-500">Contents</th>
                  <th className="px-6 py-3 text-left text-xs font-semibold uppercase tracking-wider text-gray-500">FBA Label</th>
                  <th className="px-6 py-3 text-left text-xs font-semibold uppercase tracking-wider text-gray-500">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {filteredQueue.map((item) => {
                  const labelUploaded = Boolean(item.fbaShippingLabelFileId || item.labelUploadedAt || item.fbaLabelUploaded);
                  const dispatchComplete = isDispatchComplete(item);
                  const isDispatchAction = isDispatchableQueueItem(item);
                  const isSelected = selectedDispatchIds.includes(item.id);
                  return (
                    <tr key={item.id} className={`transition-colors hover:bg-gray-50 ${isSelected ? 'bg-emerald-50/40' : ''}`}>
                      <td className="px-6 py-3">
                        <input
                          type="checkbox"
                          checked={isSelected}
                          aria-label={`Select ${item.shipment} ${item.box} for dispatch`}
                          disabled={!isDispatchAction || isBulkDispatching}
                          onChange={() => toggleDispatchSelection(item)}
                          className="h-4 w-4 rounded border-gray-300 text-[#ff6900] focus:ring-[#ff6900] disabled:cursor-not-allowed disabled:opacity-40"
                        />
                      </td>
                      <td className="px-6 py-3">
                        <span className="text-sm font-medium text-gray-900">{item.shipment}</span>
                      </td>
                      <td className="px-6 py-3">
                        <span className="text-sm text-gray-700">{item.subShipment}</span>
                      </td>
                      <td className="px-6 py-3">
                        <span className="text-sm text-gray-700">{item.client}</span>
                      </td>
                      <td className="px-6 py-3">
                        <span className="text-sm font-medium text-gray-700">{item.box}</span>
                      </td>
                      <td className="px-6 py-3">
                        <span className="rounded bg-gray-100 px-2 py-1 text-[11px] font-semibold text-gray-600">{item.type}</span>
                        {item.isPallet ? (
                          <span className="ml-2 rounded bg-[#fff7ed] px-2 py-1 text-[11px] font-semibold text-[#d76000]">
                            {item.childBoxCount || 0} child box{item.childBoxCount === 1 ? '' : 'es'}
                          </span>
                        ) : null}
                      </td>
                      <td className="px-6 py-3">
                        <span className="text-sm text-gray-700">{item.weight}</span>
                      </td>
                      <td className="px-6 py-3">
                        <span className="text-sm text-gray-500">{item.contents}</span>
                        {item.isPallet && item.childBoxes ? (
                          <p className="mt-1 text-xs text-gray-400">Boxes: {item.childBoxes}</p>
                        ) : null}
                      </td>
                      <td className="px-6 py-3">
                        {labelUploaded ? (
                          <span className="inline-flex items-center gap-1 text-sm font-semibold text-emerald-600">
                            <span className="inline-block h-2 w-2 rounded-full bg-emerald-500" />
                            Uploaded
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 text-sm font-semibold text-red-500">
                            <span className="inline-block h-2 w-2 rounded-full bg-red-500" />
                            {item.isPallet ? 'Missing (optional)' : 'Missing'}
                          </span>
                        )}
                      </td>
                      <td className="px-6 py-3">
                        <button
                          type="button"
                          onClick={() => {
                            if (dispatchComplete || isBulkDispatching) return;

                            if (isDispatchAction) {
                              handleDispatchBox(item);
                              return;
                            }
                            handleChaseClient(item);
                          }}
                          disabled={dispatchComplete || isBulkDispatching || isUpdatingId === (item.boxId || item.shipmentId)}
                          className={`inline-flex items-center gap-1.5 rounded-lg px-4 py-2 text-sm transition-colors ${
                            dispatchComplete
                              ? 'border border-emerald-200 bg-emerald-50 font-semibold text-emerald-700'
                              : isDispatchAction
                              ? 'bg-emerald-600 font-semibold text-white hover:bg-emerald-700'
                              : 'border border-[#d1d5db] bg-white font-medium text-[#374151] hover:bg-[#f9fafb]'
                          } ${dispatchComplete || isBulkDispatching || isUpdatingId === (item.boxId || item.shipmentId) ? 'cursor-not-allowed opacity-70' : ''}`}
                        >
                          {dispatchComplete ? <CheckCircle2 size={14} /> : null}
                          {isUpdatingId === (item.boxId || item.shipmentId) ? 'Updating...' : item.action}
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {isLoading ? (
            <div className="py-12 text-center">
              <LoadingState label="Loading shipments..." />
            </div>
          ) : null}

          {!isLoading && filteredQueue.length === 0 ? (
            <div className="py-12 text-center">
              <Truck size={40} className="mx-auto mb-3 text-gray-300" />
              <p className="text-sm text-gray-500">No shipments found</p>
            </div>
          ) : null}
        </div>
      </div>
    </Layout>
  );
};

export default Dispatch;
