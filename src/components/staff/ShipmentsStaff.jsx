import { useEffect, useMemo, useState } from "react";
import {
  ArrowLeft,
  Filter,
  Package,
  Plus,
  RefreshCw,
  Search,
  Truck,
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  Send,
  Upload,
  X,
  ArrowDown,
  Eye,
  FileText,
} from "lucide-react";
import { useLocation, useNavigate } from "react-router-dom";
import LayoutStaff from "./stafflayout/LayoutStaff";
import LoadingState from "../common/LoadingState";
import FullPageLoader from "../common/FullPageLoader";
import DiscrepancyResolutionModal from "../common/DiscrepancyResolutionModal";
import ConfirmationModal from "../common/ConfirmationModal";
import { getSession } from "../../utils/auth";
import { getDiscrepancyResolveData, resolveDiscrepancy as resolveDiscrepancyRequest } from "../../utils/discrepancies";
import { formatToastMessage, showToast } from "../../utils/toast";
import {
  findLineItemLabelFile as findMappedLineItemLabelFile,
  getLineItemOutboundPackageGroups,
  getItemLabelFileAssignments as getMappedItemLabelFileAssignments,
  getLineItemId as getMappedLineItemId,
  getShipmentItems as getMappedShipmentItems,
  lineItemFileMatches as mappedFileMatchesLineItem,
  normalizeShipment as normalizeMappedShipment,
  normalizeShipmentList as normalizeMappedShipmentList,
} from "../../utils/shipmentMapper";
import { fetchShipmentSummaryPages } from "../../utils/shipmentSummary";
import {
  STANDARD_SERVICE_KEYS as STANDARD_CATALOG_SERVICE_KEYS,
  getServiceDisplayName,
  getServiceKey,
  isBundlingService,
  normalizeServiceCode,
} from "../../utils/serviceCatalog";
import { fetchBoxItemsBatch, getBatchItemsForBox } from "../../utils/boxItemsBatch";

const API_BASE_URL = '';
const SUPABASE_STORAGE_PUBLIC_BASE_URL = import.meta.env.VITE_SUPABASE_URL
  ? `${String(import.meta.env.VITE_SUPABASE_URL).replace(/\/+$/, "")}/storage/v1/object/public`
  : "";
const SUPABASE_DEFAULT_STORAGE_BUCKET =
  import.meta.env.VITE_SUPABASE_BUCKET_FNSKU_LABELS ||
  import.meta.env.VITE_SUPABASE_STORAGE_BUCKET ||
  "pickpackpro-files";
const SUPABASE_STORAGE_BUCKET_CANDIDATES = [
  import.meta.env.VITE_SUPABASE_BUCKET_FNSKU_LABELS,
  import.meta.env.VITE_SUPABASE_STORAGE_BUCKET,
  SUPABASE_DEFAULT_STORAGE_BUCKET,
  "fnsku-labels",
  "pickpackpro-files",
].filter((bucket, index, buckets) => bucket && buckets.indexOf(bucket) === index);
const BOX_ALLOCATION_CACHE_KEY = "pickpackpro-box-allocation-items-v1";
const FILE_OPEN_URL_CACHE = new Map();
const BUNDLE_SIZE_NOTE_PREFIX = "Bundle Sizes:";
const SUB_SHIPMENT_STATUSES = {
  draft: "Draft",
  awaiting_fba_labels: "Awaiting FBA labels",
  ready_to_dispatch: "Ready to dispatch",
  dispatched: "Dispatched",
  completed: "Completed",
  cancelled: "Cancelled",
};
const SUB_SHIPMENT_CREATION_STATUSES = new Set(["received", "in_progress", "prepped"]);

const buildHeaders = (includeJson = false) => {
  const session = getSession();
  const headers = {};

  if (session?.token) {
    headers["Authorization"] = `Bearer ${session.token}`;
  }

  if (includeJson) {
    headers["Content-Type"] = "application/json";
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
    const error = new Error(formatToastMessage(
      payload?.message ??
        payload?.error ??
        payload?.details ??
        (typeof payload === "string" ? payload : ""),
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

const extractShipments = (payload) => normalizeMappedShipmentList(payload);

const getShipmentId = (shipment = {}) =>
  shipment?.id ||
  shipment?.uuid ||
  shipment?.shipmentId ||
  shipment?.shipment_id ||
  shipment?.reference ||
  shipment?.shipmentNumber ||
  shipment?.shipment_number ||
  "";

const normalizeShipment = (shipment) => {
  const mappedShipment = normalizeMappedShipment(shipment);

  return {
    ...mappedShipment,
    id: getShipmentId(mappedShipment),
    reference: mappedShipment?.reference || mappedShipment?.shipmentNumber || mappedShipment?.id || "N/A",
    client:
      mappedShipment?.clientName ||
      mappedShipment?.client_name ||
      mappedShipment?.client?.companyName ||
      mappedShipment?.client?.company_name ||
      mappedShipment?.client?.name ||
      mappedShipment?.clients?.companyName ||
      mappedShipment?.clients?.company_name ||
      mappedShipment?.clients?.name ||
      mappedShipment?.clientId ||
      mappedShipment?.client_id ||
      "-",
    units: getShipmentUnits(mappedShipment),
    arrived:
      mappedShipment?.arrivedDate ||
      mappedShipment?.receivedAt ||
      mappedShipment?.actualArrivalDate ||
      mappedShipment?.actual_arrival_date ||
      mappedShipment?.expectedArrivalDate ||
      mappedShipment?.expected_arrival_date ||
      "-",
    status: mappedShipment?.status || "draft",
  };
};

const statCards = (shipments) => [
  {
    label: "TOTAL ACTIVE",
    value: String(shipments.length),
    icon: Package,
    iconBg: "bg-blue-100",
    iconColor: "text-blue-600",
  },
  {
    label: "IN PROGRESS",
    value: String(
      shipments.filter((shipment) => String(shipment.status).toLowerCase() === "in_progress").length
    ),
    icon: Truck,
    iconBg: "bg-amber-100",
    iconColor: "text-amber-600",
  },
  {
    label: "DISPATCHED",
    value: String(
      shipments.filter((shipment) => String(shipment.status).toLowerCase() === "dispatched").length
    ),
    icon: Send,
    iconBg: "bg-green-100",
    iconColor: "text-green-600",
  },
  {
    label: "RECEIVED",
    value: String(
      shipments.filter((shipment) => String(shipment.status).toLowerCase() === "received").length
    ),
    icon: CheckCircle2,
    iconBg: "bg-purple-100",
    iconColor: "text-purple-600",
  },
];

const getStatusStyle = (status) => {
  switch (String(status).toLowerCase()) {
    case "in_progress":
      return "bg-orange-50 text-orange-700 border-orange-200";
    case "dispatched":
      return "bg-purple-50 text-purple-700 border-purple-200";
    case "completed":
      return "bg-green-50 text-green-700 border-green-200";
    case "received":
      return "bg-emerald-50 text-emerald-700 border-emerald-200";
    default:
      return "bg-gray-50 text-gray-700 border-gray-200";
  }
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

const firstPresent = (...values) => {
  const value = values.find((currentValue) => {
    if (currentValue === 0) return true;
    if (currentValue === false) return true;
    return currentValue !== undefined && currentValue !== null && String(currentValue).trim() !== "";
  });

  return value === undefined || value === null ? "" : value;
};

const toLabelList = (value) => {
  if (Array.isArray(value)) {
    return value.flatMap(toLabelList);
  }

  if (value && typeof value === "object") {
    return [];
  }

  return String(value || "")
    .split(/[,;\n]+/)
    .map((service) => service.trim())
    .filter(Boolean);
};

const getRawShipmentNotes = (shipment = {}) =>
  firstPresent(shipment?.client_notes, shipment?.clientNotes, shipment?.notes, shipment?.note);

const getNoteValue = (notes = "", prefix = "") => {
  const normalizedPrefix = String(prefix || "").trim().toLowerCase();
  const line = String(notes || "")
    .split(/\r?\n/)
    .find((currentLine) => currentLine.trim().toLowerCase().startsWith(normalizedPrefix));

  return line ? line.slice(prefix.length).trim() : "";
};

const stripNoteLine = (notes = "", prefix = "") => {
  const normalizedPrefix = String(prefix || "").trim().toLowerCase();

  return String(notes || "")
    .split(/\r?\n/)
    .filter((line) => !line.trim().toLowerCase().startsWith(normalizedPrefix))
    .join("\n")
    .trim();
};

const getShipmentNoteText = (shipment = {}) =>
  stripNoteLine(
    stripNoteLine(
      stripNoteLine(
        stripNoteLine(
          stripNoteLine(getRawShipmentNotes(shipment), BUNDLE_SIZE_NOTE_PREFIX),
          "Tracking:"
        ),
        "Boxes:"
      ),
      "Pallets:"
    ),
    "Boxes/Pallets:"
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
      getNoteValue(notes, "Tracking:")
    ),
    boxes: firstPresent(
      getNoteValue(notes, "Boxes:"),
      getNoteValue(notes, "Boxes/Pallets:"),
      shipment?.boxCount,
      shipment?.box_count,
      shipment?.boxesPallets,
      shipment?.boxes_pallets
    ),
    pallets: firstPresent(
      getNoteValue(notes, "Pallets:"),
      shipment?.palletCount,
      shipment?.pallet_count
    ),
  };
};

const isUuidValue = (value = "") =>
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{12}$/i.test(String(value || "").trim());

const firstUuidValue = (...values) => values.find((value) => isUuidValue(value)) || "";

const getShipmentRecordId = (shipment = {}) =>
  firstUuidValue(shipment?.id, shipment?.uuid, shipment?.shipmentId, shipment?.shipment_id);

const LINE_ITEM_KEYS = [
  "items",
  "lineItems",
  "line_items",
  "shipmentItems",
  "shipment_items",
  "shipmentLineItems",
  "shipment_line_items",
  "products",
  "productItems",
  "product_items",
  "lines",
];

const LINE_ITEM_CONTAINERS = ["data", "shipment", "row", "record", "detail", "result", "payload"];

const hasLineItemShape = (item = {}) =>
  Boolean(
    item &&
      typeof item === "object" &&
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
  if (!source || typeof source !== "object") return [];

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

const getLineItems = (shipment = {}) => getMappedShipmentItems(shipment);

const extractCustomServices = (shipment, serviceTasks = []) => {
  const items = getLineItems(shipment);
  const customServices = items.flatMap((item) =>
    toArray(item?.customServices || item?.custom_services).map((service, index) => ({
      id: service?.id || `${item?.id || item?.shipmentItemId || item?.sku || "item"}-${index}`,
      lineItemId: item?.id || item?.shipmentItemId || "",
      sku: item?.sku || "-",
      name: service?.name || service?.serviceName || "Custom Service",
      price: service?.price,
      status: service?.status || "PENDING",
    }))
  );
  const existingKeys = new Set(
    customServices.map((service) =>
      `${String(service.lineItemId || "").trim()}-${String(service.name || "").trim().toLowerCase()}`
    )
  );

  toArray(serviceTasks)
    .filter(isCustomServiceTask)
    .forEach((service, index) => {
      const matchedItem = findLineItemForServiceTask(service, items);
      const lineItemId = getServiceTaskLineItemId(service) || getLineItemId(matchedItem) || "";
      const name = firstPresent(
        service?.customServiceName,
        service?.custom_service_name,
        service?.customName,
        service?.custom_name,
        service?.name,
        service?.serviceName,
        service?.service_name,
        getServiceTaskLabel(service),
        "Other Service"
      );
      const key = `${String(lineItemId || "").trim()}-${String(name || "").trim().toLowerCase()}`;

      if (existingKeys.has(key)) return;
      existingKeys.add(key);

      customServices.push({
        id: getServiceTaskId(service) || `other-service-${lineItemId || getServiceTaskSku(service) || index}`,
        lineItemId,
        sku: getItemSku(matchedItem) || getServiceTaskSku(service) || "-",
        name,
        price: service?.price,
        status: firstPresent(service?.status, service?.taskStatus, service?.task_status, service?.state, "PENDING"),
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
  "";

const getDiscrepancyId = (discrepancy) =>
  discrepancy?.id ||
  discrepancy?.uuid ||
  discrepancy?.discrepancyId ||
  discrepancy?.discrepancy_id ||
  "";

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
    getLineItemId(getDiscrepancyLineItem(discrepancy))
  );

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
  const leftId = String(getLineItemId(left) || "").trim();
  const rightId = String(getLineItemId(right) || "").trim();
  const leftSku = String(getItemSku(left) || "").trim().toLowerCase();
  const rightSku = String(getItemSku(right) || "").trim().toLowerCase();
  const leftFnsku = String(getItemFnsku(left) || "").trim().toLowerCase();
  const rightFnsku = String(getItemFnsku(right) || "").trim().toLowerCase();

  return Boolean(
    (leftId && rightId && leftId === rightId) ||
      (leftSku && rightSku && leftSku === rightSku) ||
      (leftFnsku && rightFnsku && leftFnsku === rightFnsku)
  );
};

const findLineItemForDiscrepancy = (discrepancy = {}, lineItems = [], fallbackIndex = -1) => {
  const discrepancyLineItem = getDiscrepancyLineItem(discrepancy);
  const discrepancyLineItemId = String(getDiscrepancyLineItemId(discrepancy) || getLineItemId(discrepancyLineItem) || "").trim();
  const discrepancySku = String(getDiscrepancySku(discrepancy) || "").trim().toLowerCase();

  return (
    lineItems.find((item) => {
      const itemId = String(getLineItemId(item) || "").trim();
      const itemSku = String(getItemSku(item) || "").trim().toLowerCase();
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
    const itemId = String(getLineItemId(item) || "").trim();
    const itemSku = String(getItemSku(item) || "").trim().toLowerCase();
    const referenceLineItemId = String(lineItemId || "").trim();
    const referenceSku = String(sku || "").trim().toLowerCase();

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
  value !== undefined && value !== null && String(value).trim() !== "" && !Number.isNaN(Number(value));

const firstQuantity = (...values) => {
  const value = values.find(hasQuantityValue);
  return value === undefined || value === null ? "" : value;
};

const firstNonZeroQuantity = (...values) => {
  const value = values.find((candidate) => hasQuantityValue(candidate) && Number(candidate) !== 0);
  return value === undefined || value === null ? "" : value;
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

  if (explicitDifference !== "") return explicitDifference;

  const expected = Number(getDiscrepancyExpectedQty(discrepancy, matchedLineItem));
  const received = Number(getDiscrepancyReceivedQty(discrepancy, matchedLineItem));

  return Number.isFinite(expected) && Number.isFinite(received) ? received - expected : "";
};

const updateDiscrepancyRowsAfterResolve = (rows = [], target = {}, responseData = {}) => {
  const lineItemId = String(target?.lineItemId || "").trim();
  const discrepancyId = String(getDiscrepancyId(target?.discrepancy) || "").trim();

  const matchesTarget = (row = {}) => {
    const rowIds = [
      getDiscrepancyLineItemId(row),
      getLineItemId(getDiscrepancyLineItem(row)),
      getDiscrepancyId(row),
    ].map((value) => String(value || "").trim());

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
      getLineItemExpectedQty(lineItem),
      service?.unitsDone,
      service?.units_done,
      0
    )
  );

const statusSteps = [
  "draft",
  "submitted",
  "pending_arrival",
  "received",
  "in_progress",
  "prepped",
  "dispatched",
  "completed",
];

const formatStatusLabel = (value = "") =>
  String(value)
    .replace(/_/g, " ")
    .split(" ")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");

const formatServiceLabel = getServiceDisplayName;

const getShipmentClientName = (shipment) =>
  shipment?.client?.companyName ||
  shipment?.client?.company_name ||
  shipment?.client?.name ||
  shipment?.clients?.companyName ||
  shipment?.clients?.company_name ||
  shipment?.clientName ||
  shipment?.client_name ||
  shipment?.clientId ||
  shipment?.client_id ||
  "-";

const getShipmentArrived = (shipment) =>
  shipment?.arrivedDate ||
  shipment?.receivedAt ||
  shipment?.received_at ||
  shipment?.actualArrivalDate ||
  shipment?.actual_arrival_date ||
  shipment?.expectedArrivalDate ||
  shipment?.expected_arrival_date ||
  "-";

const getLineItemExpectedQtyValue = (item = {}) =>
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

const getLineItemExpectedQty = (item = {}) => firstPresent(getLineItemExpectedQtyValue(item), 0);

const getLineItemDispatchQty = (item = {}) =>
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

const getShipmentUnits = (shipment = {}) => {
  const directUnits = firstPresent(
    shipment?.totalUnits,
    shipment?.total_units,
    shipment?.units,
    shipment?.expectedUnits,
    shipment?.expected_units,
    shipment?.totalExpectedUnits,
    shipment?.total_expected_units,
    shipment?.totalQuantity,
    shipment?.total_quantity,
    shipment?.unitCount,
    shipment?.unit_count
  );

  if (Number(directUnits) > 0) return Number(directUnits);

  return getLineItems(shipment).reduce((sum, item) => sum + Number(getLineItemExpectedQty(item) || 0), 0);
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
      .map((value) => String(value || "").trim())
      .filter(Boolean)
  ),
];

const getLineItemId = (item) =>
  firstPresent(
    getMappedLineItemId(item),
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

const getItemProduct = (item = {}) =>
  item?.product ||
  item?.products ||
  item?.productRecord ||
  item?.product_record ||
  item?.productData ||
  item?.product_data ||
  {};

const isAutoGeneratedProductName = (value = "") =>
  /^product[\s_-]*\d+$/i.test(String(value || "").trim());

const getAutoGeneratedProductAlias = (value = "") => {
  const match = String(value || "").trim().match(/^product[\s_-]*0*(\d+)$/i);
  return match ? `p${Number(match[1])}` : "";
};

const PRODUCT_SEQUENCE_PREFIXES = ["product", "prod", "pp", "p"];
const SKU_SEQUENCE_PREFIXES = ["sku", "product", "prod", "pp", "p"];
const FNSKU_SEQUENCE_PREFIXES = ["fnsku", "f", "sku", "product", "prod", "pp", "p"];
const PRODUCT_SEQUENCE_REGEX = new RegExp(`^(?:${PRODUCT_SEQUENCE_PREFIXES.join("|")})[\\s_-]*0*(\\d+)$`, "i");
const SKU_SEQUENCE_REGEX = new RegExp(`^(?:${SKU_SEQUENCE_PREFIXES.join("|")})[\\s_-]*0*(\\d+)$`, "i");
const FNSKU_SEQUENCE_REGEX = new RegExp(`^(?:${FNSKU_SEQUENCE_PREFIXES.join("|")})[\\s_-]*0*(\\d+)$`, "i");
const SEQUENCE_REGEX_BY_PREFIXES = new Map([
  [PRODUCT_SEQUENCE_PREFIXES, PRODUCT_SEQUENCE_REGEX],
  [SKU_SEQUENCE_PREFIXES, SKU_SEQUENCE_REGEX],
  [FNSKU_SEQUENCE_PREFIXES, FNSKU_SEQUENCE_REGEX],
]);

const getSequenceRegexForPrefixes = (prefixes = []) =>
  SEQUENCE_REGEX_BY_PREFIXES.get(prefixes) || new RegExp(`^(?:${prefixes.join("|")})[\\s_-]*0*(\\d+)$`, "i");

const parseLineItemSequenceOrder = (value = "", prefixes = []) => {
  const text = String(value || "").trim();
  if (!text) return null;

  const match = text.match(getSequenceRegexForPrefixes(prefixes));
  if (!match) return null;

  const order = Number(match[1]);
  return Number.isFinite(order) ? order : null;
};

const getGeneratedProductSequence = (value = "") =>
  parseLineItemSequenceOrder(value, PRODUCT_SEQUENCE_PREFIXES);

const isGeneratedProductSequenceLabel = (value = "") =>
  getGeneratedProductSequence(value) !== null || isAutoGeneratedProductName(value);

const resolveDisplayProductName = (...values) => {
  const candidates = values
    .map((value) => String(value || "").trim())
    .filter(Boolean);
  return candidates[0] || "";
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

const getItemRawProductName = (item = {}) => {
  const product = getItemProduct(item);
  return firstPresent(
    item?.productName,
    item?.product_name,
    item?.name,
    item?.title,
    item?.productTitle,
    item?.product_title,
    item?.itemName,
    item?.item_name,
    product?.productName,
    product?.product_name,
    product?.productTitle,
    product?.product_title,
    product?.itemName,
    product?.item_name,
    product?.name,
    product?.title
  );
};

const getItemName = (item = {}) => {
  const product = getItemProduct(item);
  return resolveDisplayProductName(
    item?.productName,
    item?.product_name,
    item?.name,
    item?.title,
    item?.productTitle,
    item?.product_title,
    item?.itemName,
    item?.item_name,
    product?.productName,
    product?.product_name,
    product?.productTitle,
    product?.product_title,
    product?.itemName,
    product?.item_name,
    product?.name,
    product?.title
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

const getItemReliableSequenceOrder = (item = {}) =>
  parseLineItemSequenceOrder(getItemSku(item), SKU_SEQUENCE_PREFIXES) ??
  parseLineItemSequenceOrder(getItemFnsku(item), FNSKU_SEQUENCE_PREFIXES) ??
  parseLineItemSequenceOrder(getItemRawProductName(item), PRODUCT_SEQUENCE_PREFIXES);

const getConsistentGeneratedProductLabel = (item = {}) => {
  const reliableOrder = getItemReliableSequenceOrder(item);
  return reliableOrder !== null && reliableOrder !== undefined ? `p${reliableOrder}` : "";
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

    return String(getItemName(firstItem) || getItemSku(firstItem) || "").localeCompare(
      String(getItemName(secondItem) || getItemSku(secondItem) || ""),
      undefined,
      { numeric: true, sensitivity: "base" }
    );
  });

const getItemReceivedQty = (item = {}) =>
  item?.receivedQty ??
  item?.received_qty ??
  item?.receivedQuantity ??
  item?.received_quantity ??
  item?.qtyReceived ??
  item?.qty_received ??
  item?.unitsReceived ??
  item?.units_received ??
  item?.received ??
  "";

const hasItemReceivedQtyField = (item = {}) =>
  [
    "receivedQty",
    "received_qty",
    "receivedQuantity",
    "received_quantity",
    "qtyReceived",
    "qty_received",
    "unitsReceived",
    "units_received",
    "received",
  ].some((key) => Object.prototype.hasOwnProperty.call(item, key));

const getServiceTaskLineItemId = (service = {}) =>
  service?.lineItemId ||
  service?.line_item_id ||
  service?.shipmentItemId ||
  service?.shipment_item_id ||
  service?.itemId ||
  service?.item_id ||
  service?.lineItem?.id ||
  service?.line_item?.id ||
  service?.shipmentItem?.id ||
  service?.shipment_item?.id ||
  service?.item?.id ||
  "";

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
  typeof service === "object"
    ? formatServiceLabel(
        firstPresent(
          service?.serviceType,
          service?.service_type,
          service?.name,
          service?.serviceName,
          service?.service_name,
          service?.label,
          service?.taskName,
          service?.task_name,
          service?.type
        )
      )
    : formatServiceLabel(service);

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
    getLineItemExpectedQty(lineItem),
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
  value === 0 || (value !== undefined && value !== null && String(value).trim() !== "");

const isServiceTaskCompleteForPrep = (service = {}, lineItem = {}) => {
  const normalized = String(firstPresent(service?.status, service?.taskStatus, service?.task_status, service?.state, "")).toUpperCase();
  if (!["DONE", "COMPLETED", "COMPLETE"].includes(normalized)) return false;

  const requiredUnits = Number(getServiceTaskRequiredUnitsValue(service, lineItem) || 0);
  if (!Number.isFinite(requiredUnits) || requiredUnits <= 0) return true;

  const doneUnitsValue = getServiceTaskDoneUnitsValue(service);
  if (!hasPreparedUnitValue(doneUnitsValue)) return false;

  const doneUnits = Number(doneUnitsValue);
  return Number.isFinite(doneUnits) && doneUnits >= requiredUnits;
};

const isDisplayServiceLabel = (value = "") => {
  const normalizedValue = String(value || "").trim().toLowerCase();
  return Boolean(normalizedValue && normalizedValue !== "-" && normalizedValue !== "none" && normalizedValue !== "n/a");
};

const normalizeServiceKey = getServiceKey;

const normalizeServiceDisplayList = (services = []) => {
  return (Array.isArray(services) ? services : [])
    .map((service) => String(service || "").trim())
    .filter(Boolean);
};

const isBundlingServiceValue = (value = "") =>
  isBundlingService(typeof value === "object" ? getServiceTaskLabel(value) : value);

const STANDARD_SERVICE_KEYS = STANDARD_CATALOG_SERVICE_KEYS;

const isOtherServiceTask = (service = {}) => {
  const rawType = String(service?.serviceType || service?.service_type || service?.type || "").trim().toLowerCase();
  const label = String(getServiceTaskLabel(service) || "").trim().toLowerCase();

  return rawType === "other" || rawType === "other_service" || label === "other" || label.includes("other service");
};

const isCustomServiceTask = (service = {}) => {
  const label = getServiceTaskLabel(service);
  if (!isDisplayServiceLabel(label)) return false;
  return isOtherServiceTask(service) || !STANDARD_SERVICE_KEYS.has(normalizeServiceKey(label));
};

const isTruthyFlag = (value) => {
  if (value === true || value === 1 || value === "1") return true;
  return ["true", "yes", "y"].includes(String(value || "").trim().toLowerCase());
};

const isItemBundlingEnabled = (item = {}) =>
  isTruthyFlag(item?.needsBundling) || isTruthyFlag(item?.needs_bundling);

const getItemBundleMetadataSize = (item = {}) => {
  if (!isItemBundlingEnabled(item)) return "";

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
    item?.packSize,
    item?.pack_size,
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

const getItemSelectedServices = (item = {}) => {
  const services = [
    ...toLabelList(item?.services),
    ...toLabelList(item?.selectedServices),
    ...toLabelList(item?.selected_services),
    ...toLabelList(item?.servicesSelected),
    ...toLabelList(item?.services_selected),
  ];

  return normalizeServiceDisplayList([
    ...new Set(
      services
        .map((service) => String(formatServiceLabel(service) || "").trim())
        .filter(isDisplayServiceLabel)
    ),
  ]);
};

const hasSelectedBundlingService = (item = {}) =>
  getItemSelectedServices(item).some(isBundlingServiceValue);

const shouldDisplayServiceTaskForItem = (service, item = {}) =>
  !isBundlingServiceValue(service) || hasSelectedBundlingService(item);

const getItemServices = (item = {}) => getItemSelectedServices(item);

const SERVICE_TASK_KEYS = [
  "services",
  "serviceTasks",
  "service_tasks",
  "tasks",
  "shipmentServices",
  "shipment_services",
  "requiredServices",
  "required_services",
  "prepServices",
  "prep_services",
];

const SERVICE_TASK_CONTAINERS = ["data", "shipment", "row", "record", "detail", "result", "payload"];

const extractScalarServiceTasks = (source = {}) =>
  SERVICE_TASK_KEYS.flatMap((key) => {
    const value = source?.[key];
    return Array.isArray(value) || (value && typeof value === "object") ? [] : toLabelList(value);
  });

const extractServiceTasks = (source = {}) => {
  if (Array.isArray(source)) return source;
  if (!source || typeof source !== "object") return [];

  const directTasks = extractList(source, SERVICE_TASK_KEYS);
  if (directTasks.length) return directTasks;

  const directScalarTasks = extractScalarServiceTasks(source);
  if (directScalarTasks.length) return directScalarTasks;

  for (const key of SERVICE_TASK_CONTAINERS) {
    const value = source[key];
    if (!value || typeof value !== "object" || value === source) continue;

    const nestedTasks = extractList(value, SERVICE_TASK_KEYS);
    if (nestedTasks.length) return nestedTasks;

    const nestedScalarTasks = extractScalarServiceTasks(value);
    if (nestedScalarTasks.length) return nestedScalarTasks;
  }

  return [];
};

const hasServiceTaskShape = (task = {}) =>
  Boolean(
    task &&
      typeof task === "object" &&
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

const getUpdatedServiceTaskFromPayload = (payload = {}, taskId = "") => {
  const payloadTasks = extractServiceTasks(payload).filter((task) => task && typeof task === "object");
  const matchedTask = payloadTasks.find(
    (task) => String(getServiceTaskId(task) || "") === String(taskId || "")
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
  const taskPatch = responseTask && typeof responseTask === "object" ? responseTask : {};
  const status = firstPresent(taskPatch.status, taskPatch.taskStatus, taskPatch.task_status, patchPayload.status);
  const unitsDone = firstPresent(taskPatch.unitsDone, taskPatch.units_done, patchPayload.unitsDone, patchPayload.units_done);
  const notes = firstPresent(taskPatch.notes, taskPatch.note, patchPayload.notes);

  return {
    ...service,
    ...taskPatch,
    ...(status !== ""
      ? {
          status,
          taskStatus: status,
          task_status: status,
        }
      : {}),
    ...(unitsDone !== ""
      ? {
          unitsDone,
          units_done: unitsDone,
        }
      : {}),
    ...(notes !== "" ? { notes } : {}),
  };
};

const mergeServiceTasks = (...taskGroups) => {
  const mergedTasks = new Map();

  taskGroups.flatMap(extractServiceTasks).filter(Boolean).forEach((service, index) => {
    const serviceLabel = getServiceTaskLabel(service) || formatServiceLabel(service);
    const key = String(
      service?.id ||
        service?.uuid ||
        service?.taskId ||
        service?.task_id ||
        service?.serviceTaskId ||
        service?.service_task_id ||
        `${getServiceTaskLineItemId(service)}-${getServiceTaskSku(service)}-${serviceLabel || index}`
    );

    if (!mergedTasks.has(key)) {
      mergedTasks.set(key, service);
    }
  });

  return [...mergedTasks.values()];
};

const getShipmentServiceLabels = (shipment = {}, _serviceTasks = []) => {
  const lineItems = getLineItems(shipment);
  const itemCount = lineItems.length;
  const shouldDisplayShipmentService = (service) => {
    if (!isBundlingServiceValue(service)) return true;
    if (!service || typeof service !== "object") return lineItems.some(hasSelectedBundlingService);

    const matchedItems = lineItems.filter((item) => isServiceTaskForItem(service, item, itemCount));
    if (!matchedItems.length) return lineItems.some(hasSelectedBundlingService);

    return matchedItems.some((item) => shouldDisplayServiceTaskForItem(service, item));
  };
  const labels = [
    ...lineItems.flatMap((item) => getItemServices(item)),
    ...toLabelList(shipment?.serviceTypes).filter(shouldDisplayShipmentService),
    ...toLabelList(shipment?.service_types).filter(shouldDisplayShipmentService),
    ...toLabelList(shipment?.serviceType).filter(shouldDisplayShipmentService),
    ...toLabelList(shipment?.service_type).filter(shouldDisplayShipmentService),
    ...toLabelList(shipment?.requiredServices).filter(shouldDisplayShipmentService),
    ...toLabelList(shipment?.required_services).filter(shouldDisplayShipmentService),
    ...toLabelList(shipment?.prepServices).filter(shouldDisplayShipmentService),
    ...toLabelList(shipment?.prep_services).filter(shouldDisplayShipmentService),
  ];

  return [...new Set(labels.map((service) => String(formatServiceLabel(service) || "").trim()).filter(isDisplayServiceLabel))];
};

const findLineItemForServiceTask = (service = {}, items = []) => {
  const serviceLineItemId = String(getServiceTaskLineItemId(service) || "").trim();
  const serviceSku = String(getServiceTaskSku(service) || "").trim().toLowerCase();

  return (
    toArray(items).find((item) => {
      const itemId = String(getLineItemId(item) || "").trim();
      const itemSku = String(getItemSku(item) || "").trim().toLowerCase();

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

const getLineItemServiceTasks = (item, serviceTasks = [], itemCount = 0) => {
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
    .map((value) => String(value || "").trim())
    .filter(Boolean);
  const itemSku = String(getItemSku(item) || "").trim().toLowerCase();

  return mergeServiceTasks(serviceTasks).filter((service) => {
    const serviceLineItemId = String(getServiceTaskLineItemId(service) || "").trim();
    const serviceSku = String(getServiceTaskSku(service) || "").trim().toLowerCase();
    return (
      (serviceLineItemId && lineItemIds.includes(serviceLineItemId)) ||
      (serviceSku && itemSku && serviceSku === itemSku) ||
      (itemCount === 1 && !serviceLineItemId && !serviceSku)
    );
  });
};

const getLineItemServiceTaskLabels = (item, serviceTasks = [], itemCount = 0) => [
  ...new Set(
    getLineItemServiceTasks(item, serviceTasks, itemCount)
    .map(getServiceTaskLabel)
    .filter((service) => isDisplayServiceLabel(service) && shouldDisplayServiceTaskForItem(service, item))
  ),
];

const getLineItemServices = (item, _serviceTasks = [], _itemCount = 0) => [
  ...new Set(getItemServices(item)),
];

const getItemBundleSize = (item = {}) =>
  getItemBundleMetadataSize(item);

const hasDisplayBundleSize = (value) => {
  const bundleSize = Number(value || 0);
  return Number.isFinite(bundleSize) && bundleSize > 0;
};

const getBundleSizeEntriesFromNotes = (notes = "") => {
  const line = String(notes || "")
    .split(/\r?\n/)
    .find((currentLine) => currentLine.trim().toLowerCase().startsWith(BUNDLE_SIZE_NOTE_PREFIX.toLowerCase()));

  if (!line) return [];

  try {
    const parsedEntries = JSON.parse(line.trim().slice(BUNDLE_SIZE_NOTE_PREFIX.length).trim());
    return Array.isArray(parsedEntries) ? parsedEntries : [];
  } catch {
    return [];
  }
};

const normalizeBundleMatchValue = (value = "") => {
  const normalized = String(value || "").trim().toLowerCase();
  return normalized && !["-", "n/a", "na", "none", "null", "undefined"].includes(normalized) ? normalized : "";
};

const getBundleSizeForLineItem = (item = {}, entries = []) => {
  const itemSku = normalizeBundleMatchValue(getItemSku(item));
  const itemFnsku = normalizeBundleMatchValue(getItemFnsku(item));
  const matchedEntry = toArray(entries).find((entry) => {
    const entrySku = normalizeBundleMatchValue(entry?.sku);
    const entryFnsku = normalizeBundleMatchValue(entry?.fnsku);

    return (
      (itemSku && entrySku && itemSku === entrySku && (!itemFnsku || !entryFnsku || itemFnsku === entryFnsku)) ||
      (itemFnsku && entryFnsku && itemFnsku === entryFnsku)
    );
  });
  const bundleSize = Number(matchedEntry?.bundleSize || matchedEntry?.bundle_size || 0);

  return hasDisplayBundleSize(bundleSize) ? bundleSize : "";
};

const applyBundleMetadataFromNotes = (items = [], shipment = {}) => {
  const entries = getBundleSizeEntriesFromNotes(getRawShipmentNotes(shipment));
  if (!entries.length) return items;

  return toArray(items).map((item) => {
    if (!isItemBundlingEnabled(item)) return item;
    if (hasDisplayBundleSize(getItemBundleSize(item))) return item;
    const bundleSize = getBundleSizeForLineItem(item, entries);
    return hasDisplayBundleSize(bundleSize)
      ? { ...item, bundleSize, bundle_size: bundleSize }
      : item;
  });
};

const getViewItemBundleSize = (item = {}, bundleSizeEntries = []) => {
  const directBundleSize = getItemBundleSize(item);
  if (hasDisplayBundleSize(directBundleSize)) return directBundleSize;

  const noteBundleSize = getBundleSizeForLineItem(item, bundleSizeEntries);
  return hasDisplayBundleSize(noteBundleSize) ? noteBundleSize : "";
};

const getServiceTaskStatus = (service = {}) => {
  const status = String(firstPresent(service?.status, service?.taskStatus, service?.task_status, service?.state, "PENDING")).toUpperCase();
  return status === "COMPLETED" ? "DONE" : status;
};

const isServiceTaskForItem = (service = {}, item = {}, itemCount = 0) => {
  const serviceLineItemId = String(getServiceTaskLineItemId(service) || "").trim();
  const serviceSku = String(getServiceTaskSku(service) || "").trim().toLowerCase();
  const itemIds = getItemLabelMatchIds(item);
  const itemSku = String(getItemSku(item) || "").trim().toLowerCase();

  if (serviceLineItemId && itemIds.includes(serviceLineItemId)) return true;
  if (serviceSku && itemSku && serviceSku === itemSku) return true;

  return itemCount === 1 && !serviceLineItemId && !serviceSku;
};

const isCustomServiceForItem = (service = {}, item = {}, itemCount = 0) => {
  const serviceLineItemId = String(service?.lineItemId || service?.line_item_id || "").trim();
  const serviceSku = String(service?.sku || service?.sellerSku || service?.seller_sku || "").trim().toLowerCase();
  const itemIds = getItemLabelMatchIds(item);
  const itemSku = String(getItemSku(item) || "").trim().toLowerCase();

  if (serviceLineItemId && itemIds.includes(serviceLineItemId)) return true;
  if (serviceSku && itemSku && serviceSku === itemSku) return true;

  return itemCount === 1 && !serviceLineItemId && !serviceSku;
};

const getServiceDisplayStatus = (serviceName, item, serviceTasks, itemCount = 0) => {
  const serviceKey = normalizeServiceKey(serviceName);
  const itemIds = [
    getLineItemId(item),
    getShipmentLineItemId(item),
    item?.shipmentItemId,
    item?.shipment_item_id,
    item?.lineItemId,
    item?.line_item_id,
    item?.itemId,
    item?.item_id,
  ]
    .map((value) => String(value || "").trim())
    .filter(Boolean);
  const itemSku = String(getItemSku(item) || "").trim().toLowerCase();
  const matchedTask = mergeServiceTasks(serviceTasks).find((service) => {
    const serviceLineItemId = String(getServiceTaskLineItemId(service) || "").trim();
    const serviceSku = String(getServiceTaskSku(service) || "").trim().toLowerCase();
    const sameLineItem = serviceLineItemId && itemIds.includes(serviceLineItemId);
    const sameSku = serviceSku && itemSku && serviceSku === itemSku;
    const sameUnidentifiedItem = !serviceLineItemId && !serviceSku && (itemCount === 1 || (!itemIds.length && !itemSku));
    const taskKey = normalizeServiceKey(getServiceTaskLabel(service));
    const sameType = !serviceKey || (taskKey && (taskKey.includes(serviceKey) || serviceKey.includes(taskKey)));
    return (sameLineItem || sameSku || sameUnidentifiedItem) && sameType;
  });

  return matchedTask && isServiceTaskCompleteForPrep(matchedTask, item) ? "Done" : "Pending";
};

const getServiceTaskForLine = (serviceName, item, serviceTasks, itemCount = 0) => {
  const serviceKey = normalizeServiceKey(serviceName);
  const itemIds = [
    getLineItemId(item),
    getShipmentLineItemId(item),
    item?.shipmentItemId,
    item?.shipment_item_id,
    item?.lineItemId,
    item?.line_item_id,
    item?.itemId,
    item?.item_id,
  ]
    .map((value) => String(value || "").trim())
    .filter(Boolean);
  const itemSku = String(getItemSku(item) || "").trim().toLowerCase();
  return mergeServiceTasks(serviceTasks).find((service) => {
    const serviceLineItemId = String(getServiceTaskLineItemId(service) || "").trim();
    const serviceSku = String(getServiceTaskSku(service) || "").trim().toLowerCase();
    const sameLineItem = serviceLineItemId && itemIds.includes(serviceLineItemId);
    const sameSku = serviceSku && itemSku && serviceSku === itemSku;
    const sameUnidentifiedItem = !serviceLineItemId && !serviceSku && (itemCount === 1 || (!itemIds.length && !itemSku));
    const taskKey = normalizeServiceKey(getServiceTaskLabel(service));
    const sameType = !serviceKey || (taskKey && (taskKey.includes(serviceKey) || serviceKey.includes(taskKey)));
    return (sameLineItem || sameSku || sameUnidentifiedItem) && sameType;
  });
};

const getBoxId = (box) => box?.id || box?.uuid || box?.boxId || box?.box_id || "";

const BOX_LIST_KEYS = [
  "boxes",
  "shipmentBoxes",
  "shipment_boxes",
  "outboundBoxes",
  "outbound_boxes",
  "pallets",
];

const BOX_LIST_CONTAINERS = ["data", "shipment", "row", "record", "detail", "result", "payload"];

const extractBoxes = (payload) => {
  const directBoxes = extractList(payload, BOX_LIST_KEYS);
  if (directBoxes.length) return directBoxes;

  for (const key of BOX_LIST_CONTAINERS) {
    const nestedBoxes = extractList(payload?.[key], BOX_LIST_KEYS);
    if (nestedBoxes.length) return nestedBoxes;
  }

  const singleBox = payload?.box || payload?.data?.box;
  return singleBox && typeof singleBox === "object" ? [singleBox] : [];
};

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

const getBoxRecordId = (box = {}) => getBoxId(box);

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
      .map((value) => String(value || "").trim())
      .filter(Boolean)
  ),
];

const getBoxItemsLookupId = (box = {}) =>
  getBoxRecordId(box) || getBoxId(box) || getBoxLookupIds(box).find(Boolean);

const getBoxTitle = (box = {}, index = 0) => {
  const isPallet = String(firstPresent(box?.boxType, box?.box_type, box?.containerType, box?.container_type, box?.type, "box")).trim().toLowerCase() === "pallet";
  const palletNumber = isPallet ? String(firstPresent(box?.palletNumber, box?.pallet_number) || "").trim() : "";
  if (palletNumber) return palletNumber;

  const rawTitle = firstPresent(box?.label, box?.name, box?.reference);
  const title = String(rawTitle || "").trim();
  if (title) return title;

  const boxNumber = String(firstPresent(box?.boxNumber, box?.box_number) || "").trim();
  return boxNumber ? `Box ${boxNumber}` : `Box ${index + 1}`;
};

const formatBoxMetaValue = (value = "") => {
  const normalized = String(value || "").trim();
  if (!normalized) return "";
  return normalized.charAt(0).toUpperCase() + normalized.slice(1).replaceAll("_", " ");
};

const getBoxSize = (box) => formatBoxMetaValue(firstPresent(box?.boxSize, box?.box_size, box?.size, "Medium"));

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
  if (typeof box?.dimensions === "string") return box.dimensions;

  const length = getBoxDimensionValue(box, "length", "l");
  const width = getBoxDimensionValue(box, "width", "w");
  const height = getBoxDimensionValue(box, "height", "h");
  const hasDimensions = [length, width, height].some((value) => String(value || "").trim() !== "");

  return hasDimensions ? `${length || 0}x${width || 0}x${height || 0} CM` : "";
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
  const normalizedStatus = String(getBoxRawStatus(box) || "").trim().toLowerCase().replace(/\s+/g, "_");

  return Boolean(
    box?.dispatched_at ||
      box?.dispatchedAt ||
      box?.dispatch_date ||
      box?.dispatchDate ||
      ["dispatched", "sealed", "completed", "complete"].includes(normalizedStatus)
  );
};

const getBoxStatus = (box = {}) => {
  const rawStatus = getBoxRawStatus(box);
  const normalizedStatus = String(rawStatus || "").trim().toLowerCase().replace(/\s+/g, "_");
  if (["completed", "complete"].includes(normalizedStatus)) return "Completed";
  if (isBoxDispatchedStatus(box)) return "Dispatched";
  return formatBoxMetaValue(rawStatus || "No status");
};

const getBoxTypeValue = (box = {}) => {
  const value = String(firstPresent(box?.boxType, box?.box_type, box?.containerType, box?.container_type, box?.type, "box")).trim().toLowerCase();
  return value === "pallet" ? "pallet" : "box";
};

const isPalletBox = (box = {}) => getBoxTypeValue(box) === "pallet";

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

const getBoxPalletLabel = (box = {}, index = 0) =>
  isPalletBox(box) ? String(getBoxTitle(box, index)).replace(/^Box\b/i, "Pallet") : getBoxTitle(box, index);

const getBoxDisplayStatus = (box = {}, shipmentStatus = "") => {
  const boxStatus = getBoxStatus(box);
  const normalizedBoxStatus = String(boxStatus || "").trim().toLowerCase().replaceAll("_", " ");
  const normalizedShipmentStatus = String(shipmentStatus || "").trim().toLowerCase().replaceAll("_", " ");

  if (normalizedShipmentStatus === "completed" && normalizedBoxStatus !== "completed") {
    return "Completed";
  }

  if (
    ["", "no status", "draft", "pending", "pending arrival"].includes(normalizedBoxStatus) &&
    normalizedShipmentStatus === "dispatched"
  ) {
    return "Dispatched";
  }

  return boxStatus;
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
  if (typeof item === "string") return item.trim();

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
    item?.fnsku,
    getItemSku(item?.product || {}),
    getItemSku(item?.shipmentItem || {}),
    getItemSku(item?.shipment_item || {}),
    getItemSku(item?.lineItem || {}),
    getItemSku(item?.line_item || {}),
    getItemSku(item?.item || {}),
    getItemSku(item?.product_item || {})
  );
};

const getBoxItemQuantity = (item = {}) => {
  if (typeof item === "number") return Number.isFinite(item) ? item : "";
  if (typeof item === "string") {
    const quantityMatch = item.match(/(?:qty|quantity|units?)?\s*[:x-]\s*(\d+(?:\.\d+)?)/i);
    return quantityMatch ? quantityMatch[1] : "";
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
    item?.meta?.unit_count,
    ""
  );
};

const getBoxItems = (box = {}) => {
  const directItems = toArray(box?.items || box?.boxItems || box?.box_items || box?.contents || box?.lineItems || box?.line_items);
  if (directItems.length) return directItems;

  const rawContents = firstPresent(box?.contents, box?.box_contents);
  if (Array.isArray(rawContents)) return rawContents;
  if (rawContents && typeof rawContents === "object") return [rawContents];
  if (typeof rawContents === "string") {
    try {
      const parsedContents = JSON.parse(rawContents);
      return Array.isArray(parsedContents) ? parsedContents : parsedContents ? [parsedContents] : [];
    } catch {
      return rawContents.trim() ? [{ sku: rawContents.trim() }] : [];
    }
  }

  const inlineQuantity = getBoxItemQuantity(box);
  return (getBoxItemLineItemId(box) || getBoxItemSku(box)) && inlineQuantity !== "" ? [box] : [];
};

const getBoxUnits = (box = {}) => {
  const items = getBoxItems(box);
  const itemQuantities = items
    .map((item) => getBoxItemQuantity(item))
    .filter((quantity) => quantity !== "" && quantity !== undefined && quantity !== null);

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

const extractBoxItems = (payload) => {
  const directItems = toArray(
    payload?.items ||
      payload?.boxItems ||
      payload?.box_items ||
      payload?.boxLineItems ||
      payload?.box_line_items ||
      payload?.contents ||
      payload?.boxContents ||
      payload?.box_contents ||
      payload?.lineItems ||
      payload?.line_items ||
      payload?.shipmentItems ||
      payload?.shipment_items ||
      payload?.products ||
      payload?.skus ||
      payload?.data?.items ||
      payload?.data?.boxItems ||
      payload?.data?.box_items ||
      payload?.data?.boxLineItems ||
      payload?.data?.box_line_items ||
      payload?.data?.contents ||
      payload?.data?.boxContents ||
      payload?.data?.box_contents ||
      payload?.data?.lineItems ||
      payload?.data?.line_items ||
      payload?.data?.shipmentItems ||
      payload?.data?.shipment_items ||
      payload?.data?.products ||
      payload?.data?.skus ||
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
    const items = toArray(
      container?.items ||
        container?.boxItems ||
        container?.box_items ||
        container?.boxLineItems ||
        container?.box_line_items ||
        container?.contents ||
        container?.boxContents ||
        container?.box_contents ||
        container?.lineItems ||
        container?.line_items ||
        container?.shipmentItems ||
        container?.shipment_items ||
        container?.products ||
        container?.skus
    );
    if (items.length) return items;
  }

  return [];
};

const getLineItemMatchIds = (lineItem = {}) => [
  getBoxAllocationLineItemId(lineItem),
  getShipmentLineItemId(lineItem),
  getLineItemId(lineItem),
]
  .map((value) => String(value || "").trim())
  .filter(Boolean);

const getFallbackLineItemForBoxIndex = (boxIndex = 0, lineItemList = []) => {
  const items = toArray(lineItemList);
  if (!items.length) return null;
  return items.length === 1 ? items[0] : items[Math.min(boxIndex, items.length - 1)] || null;
};

const isSameLineItemForAllocation = (left = {}, right = {}) => {
  const leftIds = getLineItemMatchIds(left);
  const rightIds = getLineItemMatchIds(right);
  const leftSku = String(getItemSku(left) || "").trim().toLowerCase();
  const rightSku = String(getItemSku(right) || "").trim().toLowerCase();

  return Boolean(
    leftIds.some((leftId) => rightIds.includes(leftId)) ||
      (leftSku && rightSku && leftSku === rightSku)
  );
};

const normalizeAllocationSku = (value = "") =>
  String(value || "").trim().toLowerCase();

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
          const rawValue = String(value || "");
          const parenthesizedSkus = [...rawValue.matchAll(/\(([^)]+)\)/g)].map((match) => match[1]);

          return [rawValue, ...parenthesizedSkus]
            .flatMap((skuValue) => String(skuValue || "").split(/[,|]/))
            .map((sku) => normalizeAllocationSku(sku.replace(/\b\d+(?:\.\d+)?\s*(?:units?|qty)\b/gi, "")))
            .map((sku) => sku.replace(/[()]/g, "").trim());
        })
        .filter(Boolean)
    ),
  ];
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
      .map((value) => String(value || "").trim())
      .filter(Boolean)
  ),
];

const readBoxAllocationCache = () => {
  if (typeof window === "undefined") return {};

  try {
    const parsed = JSON.parse(localStorage.getItem(BOX_ALLOCATION_CACHE_KEY) || "{}");
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
};

const writeBoxAllocationCache = (cache = {}) => {
  if (typeof window === "undefined") return;

  try {
    localStorage.setItem(BOX_ALLOCATION_CACHE_KEY, JSON.stringify(cache));
  } catch {
    // Allocation display should not fail if browser storage is unavailable.
  }
};

const normalizeBoxAllocationItems = (items = []) =>
  toArray(items)
    .map((item) => (item && typeof item === "object" ? item : { sku: String(item || "").trim() }))
    .map((item) => {
      const sku = String(getBoxItemSku(item) || "").trim();
      const quantity = getBoxItemQuantity(item);
      const shipmentItemId = String(getBoxItemLineItemId(item) || "").trim();

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
        ...(quantity !== ""
          ? {
              quantity,
              qty: quantity,
              units: quantity,
            }
          : {}),
      };
    })
    .filter((item) => getBoxItemSku(item) && getBoxItemQuantity(item) !== "");

const getCachedBoxAllocationItems = (box = {}) => {
  const cache = readBoxAllocationCache();
  const keys = getBoxAllocationCacheKeys(box);
  const cachedItems = keys.map((key) => cache[key]).find((items) => toArray(items).length);
  return normalizeBoxAllocationItems(cachedItems || []);
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
        .map((item) => (typeof item === "string" ? item : getBoxItemSku(item)))
        .filter(Boolean);
    }
    if (typeof value === "object") {
      return [getBoxItemSku(value)].filter(Boolean);
    }
    return String(value)
      .split(",")
      .map((sku) => sku.trim())
      .filter(Boolean);
  });

  return [...new Set(skus)].join(", ");
};

const findLineItemForBoxItem = (boxItem = {}, lineItemList = []) => {
  const boxItemId = String(getBoxItemLineItemId(boxItem) || "").trim();
  const boxItemSku = String(getBoxItemSku(boxItem) || "").trim().toLowerCase();

  return toArray(lineItemList).find((lineItem) => {
    const lineItemIds = getLineItemMatchIds(lineItem);
    const lineItemSku = String(getItemSku(lineItem) || "").trim().toLowerCase();

    return Boolean(
      (boxItemId && lineItemIds.includes(boxItemId)) ||
        (boxItemSku && lineItemSku && boxItemSku === lineItemSku)
    );
  });
};

const hydrateBoxItemWithLineItem = (boxItem = {}, lineItemList = []) => {
  const matchedLineItem = findLineItemForBoxItem(boxItem, lineItemList);
  const matchedLineItemId = matchedLineItem
    ? firstPresent(getBoxAllocationLineItemId(matchedLineItem), getShipmentLineItemId(matchedLineItem), getLineItemId(matchedLineItem))
    : "";
  const sku = getBoxItemSku(boxItem) || getItemSku(matchedLineItem || {});
  const quantity = getBoxItemQuantity(boxItem);

  return {
    ...boxItem,
    ...(matchedLineItemId && !getBoxItemLineItemId(boxItem)
      ? {
          shipmentItemId: matchedLineItemId,
          shipment_item_id: matchedLineItemId,
        }
      : {}),
    ...(sku && !getBoxItemSku(boxItem)
      ? {
          sku,
          sellerSku: sku,
          seller_sku: sku,
        }
      : {}),
    ...(quantity !== ""
      ? {
          quantity,
        }
      : {}),
  };
};

const hydrateBoxItemsWithLineItems = (boxItems = [], lineItemList = []) =>
  toArray(boxItems).map((boxItem) => hydrateBoxItemWithLineItem(boxItem, lineItemList));

const isSameBoxLineItem = (boxItem = {}, lineItem = {}) => {
  const lineItemIds = getLineItemMatchIds(lineItem);
  const boxLineItemId = String(getBoxItemLineItemId(boxItem) || "").trim();
  const lineItemSku = String(getItemSku(lineItem) || "").trim().toLowerCase();
  const boxItemSku = String(getBoxItemSku(boxItem) || "").trim().toLowerCase();

  return Boolean(
    (boxLineItemId && lineItemIds.includes(boxLineItemId)) ||
      (lineItemSku && boxItemSku && lineItemSku === boxItemSku)
  );
};

const getAllocatedQuantityForLineItem = (lineItem = {}, boxList = [], lineItemList = []) =>
  toArray(boxList).reduce((sum, box, boxIndex) => {
    const boxItems = getBoxItems(box);
    const lineItemSku = normalizeAllocationSku(getItemSku(lineItem));
    const boxDisplaySkus = getBoxDisplaySkuValues(box);
    const boxMatchesDisplayedSku = Boolean(lineItemSku && boxDisplaySkus.includes(lineItemSku));
    const fallbackLineItem = getFallbackLineItemForBoxIndex(boxIndex, lineItemList);
    const fallbackQuantity = fallbackLineItem && isSameLineItemForAllocation(fallbackLineItem, lineItem)
      ? getLineItemExpectedQty(fallbackLineItem)
      : "";
    const displayedSkuQuantity = boxMatchesDisplayedSku
      ? firstPresent(getBoxUnits(box), fallbackQuantity, getLineItemExpectedQty(lineItem), 0)
      : "";

    if (boxItems.length) {
      const matchingItems = boxItems.filter((boxItem) => isSameBoxLineItem(boxItem, lineItem));
      const itemQuantity = matchingItems.reduce((itemSum, boxItem) => {
        const quantity = Number(getBoxItemQuantity(boxItem) || 0);
        return itemSum + (Number.isFinite(quantity) ? quantity : 0);
      }, 0);

      if (itemQuantity > 0) return sum + itemQuantity;

      if (fallbackLineItem && isSameLineItemForAllocation(fallbackLineItem, lineItem)) {
        const boxQuantity = Number(firstPresent(getBoxUnits(box), fallbackQuantity, 0));
        return sum + (Number.isFinite(boxQuantity) ? boxQuantity : 0);
      }

      if (displayedSkuQuantity !== "" && boxDisplaySkus.length === 1) {
        const boxQuantity = Number(displayedSkuQuantity);
        return sum + (Number.isFinite(boxQuantity) ? boxQuantity : 0);
      }

      return sum;
    }

    if (displayedSkuQuantity !== "" && boxDisplaySkus.length === 1) {
      const boxQuantity = Number(displayedSkuQuantity);
      return sum + (Number.isFinite(boxQuantity) ? boxQuantity : 0);
    }

    if (fallbackLineItem && isSameLineItemForAllocation(fallbackLineItem, lineItem)) {
      const boxQuantity = Number(firstPresent(getBoxUnits(box), fallbackQuantity, 0));
      return sum + (Number.isFinite(boxQuantity) ? boxQuantity : 0);
    }

    return sum;
  }, 0);

const getPositiveQuantity = (value) => {
  const quantity = Number(value || 0);
  return Number.isFinite(quantity) && quantity > 0 ? quantity : 0;
};

const getLineItemBoxableQuantity = (lineItem = {}) => {
  if (lineItem.__parentShipmentBoxableQty !== undefined) {
    const parentShipmentBoxableQty = Number(lineItem.__parentShipmentBoxableQty || 0);
    return Number.isFinite(parentShipmentBoxableQty) ? Math.max(0, parentShipmentBoxableQty) : 0;
  }

  const receivedQuantityValue = getItemReceivedQty(lineItem);
  const receivedQuantity = getPositiveQuantity(receivedQuantityValue);
  if (receivedQuantity > 0) return receivedQuantity;
  if (hasItemReceivedQtyField(lineItem)) return 0;

  const expectedQuantityValue = getLineItemExpectedQtyValue(lineItem);
  const expectedQuantity = getPositiveQuantity(expectedQuantityValue);
  if (expectedQuantity > 0) return expectedQuantity;

  const dispatchQuantity = getPositiveQuantity(getLineItemDispatchQty(lineItem));
  if (dispatchQuantity > 0) return dispatchQuantity;

  if (getBoxAllocationLineItemId(lineItem)) return 0;
  return 0;
};

const getLineItemAllocatableQuantity = (lineItem = {}, boxList = [], lineItemList = []) => {
  if (!lineItem || typeof lineItem !== "object") return 0;
  if (lineItem.__subShipmentAvailableQty !== undefined) {
    const subShipmentAvailableQty = Number(lineItem.__subShipmentAvailableQty || 0);
    return Number.isFinite(subShipmentAvailableQty) ? Math.max(0, subShipmentAvailableQty) : 0;
  }
  const boxableQuantity = getLineItemBoxableQuantity(lineItem);
  if (!Number.isFinite(boxableQuantity) || boxableQuantity <= 0) return 0;
  return Math.max(0, boxableQuantity - getAllocatedQuantityForLineItem(lineItem, boxList, lineItemList));
};

const clampAllocationQuantity = (value, maxQuantity = 0) => {
  if (value === "" || value === undefined || value === null) return "";

  const quantity = Number(value);
  if (!Number.isFinite(quantity) || quantity <= 0) return "";
  if (Number(maxQuantity || 0) <= 0) return "";

  const wholeQuantity = Math.floor(quantity);
  if (maxQuantity > 0) return String(Math.min(wholeQuantity, maxQuantity));
  return String(wholeQuantity);
};

const formatQuantityValue = (value) => {
  const quantity = Number(value || 0);
  if (!Number.isFinite(quantity)) return "0";
  return Number.isInteger(quantity) ? String(quantity) : quantity.toFixed(2).replace(/\.?0+$/, "");
};

const normalizeCompletionStatus = (value = "") =>
  String(value || "").trim().toLowerCase().replace(/\s+/g, "_");

const normalizeShipmentStatusValue = (value = "") =>
  String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");

const getShipmentCompletionBlockers = (lineItemList = [], boxList = []) =>
  toArray(lineItemList)
    .map((lineItem) => {
      const requiredQuantity = getLineItemBoxableQuantity(lineItem);
      if (!Number.isFinite(requiredQuantity) || requiredQuantity <= 0) return null;

      const boxedQuantity = getAllocatedQuantityForLineItem(lineItem, boxList, lineItemList);
      const remainingQuantity = Math.max(0, requiredQuantity - boxedQuantity);
      if (remainingQuantity <= 0.000001) return null;

      return {
        sku: firstPresent(getItemSku(lineItem), getLineItemId(lineItem), "SKU"),
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
  const extraMessage = extraCount > 0 ? ` ${extraCount} more SKU(s) also need boxing.` : "";

  return `Shipment cannot be marked complete yet. Add all remaining SKU quantities to boxes first. ${visibleBlockers.join("; ")}.${extraMessage}`;
};

const normalizeSkuMatchValue = (value = "") =>
  String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");

const skuValuesMatch = (left = "", right = "") => {
  const normalizedLeft = normalizeSkuMatchValue(left);
  const normalizedRight = normalizeSkuMatchValue(right);
  return Boolean(normalizedLeft && normalizedRight && normalizedLeft === normalizedRight);
};

const extractSubShipments = (payload) =>
  extractList(payload, ["subShipments", "sub_shipments", "subshipments"]);

const extractSubShipmentAvailability = (payload) =>
  extractList(payload, [
    "availability",
    "availableItems",
    "available_items",
    "availablePreparedItems",
    "available_prepared_items",
    "preparedItems",
    "prepared_items",
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

const getBoxScope = (box = {}) =>
  String(firstPresent(box?.scope, box?.boxScope, box?.box_scope, box?.metadata?.scope, box?.meta?.scope) || "").trim().toLowerCase();

const isParentShipmentBox = (box = {}) => {
  const scope = getBoxScope(box);
  if (scope === "parent_shipment") return true;
  if (scope === "sub_shipment") return false;
  return !getBoxSubShipmentId(box) && !getBoxSubShipmentReference(box);
};

const getSubShipmentReference = (subShipment = {}) =>
  firstPresent(
    subShipment?.reference,
    subShipment?.subShipmentReference,
    subShipment?.sub_shipment_reference,
    subShipment?.sequence_no ? `Sub-shipment ${subShipment.sequence_no}` : "",
    getSubShipmentId(subShipment)
  );

const decorateSubShipmentBoxForScope = (box = {}, subShipment = {}) => {
  const subShipmentId = getSubShipmentId(subShipment);
  const subShipmentReference = getSubShipmentReference(subShipment);

  return {
    ...box,
    subShipmentId: getBoxSubShipmentId(box) || subShipmentId,
    sub_shipment_id: getBoxSubShipmentId(box) || subShipmentId,
    subShipmentReference: getBoxSubShipmentReference(box) || subShipmentReference,
    sub_shipment_reference: getBoxSubShipmentReference(box) || subShipmentReference,
    scope: getBoxScope(box) || "sub_shipment",
  };
};

const getBoxScopeKeys = (box = {}) => [
  getBoxRecordId(box),
  getBoxId(box),
  ...getBoxLookupIds(box),
  box?.reference,
  box?.boxReference,
  box?.box_reference,
].map((value) => String(value || "").trim()).filter(Boolean);

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
        ...(childSubShipmentId ? { subShipmentId: childSubShipmentId, sub_shipment_id: childSubShipmentId } : {}),
        ...(childSubShipmentReference ? { subShipmentReference: childSubShipmentReference, sub_shipment_reference: childSubShipmentReference } : {}),
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
  String(firstPresent(subShipment?.status, "draft")).trim().toLowerCase();

const getSubShipmentStatusLabel = (status = "") => {
  const normalizedStatus = String(status || "").trim().toLowerCase();
  return SUB_SHIPMENT_STATUSES[normalizedStatus] || formatStatusLabel(normalizedStatus || "draft");
};

const getSubShipmentItems = (subShipment = {}) =>
  extractList(subShipment, ["sub_shipment_items", "subShipmentItems", "items"]);

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

  return lineItem && typeof lineItem === "object" ? lineItem : item;
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

const getAvailabilityReliableSequenceOrder = (item = {}) =>
  parseLineItemSequenceOrder(getAvailabilitySku(item), SKU_SEQUENCE_PREFIXES) ??
  parseLineItemSequenceOrder(getAvailabilityFnsku(item), FNSKU_SEQUENCE_PREFIXES) ??
  parseLineItemSequenceOrder(getAvailabilityRawProductName(item), PRODUCT_SEQUENCE_PREFIXES);

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

    return String(getAvailabilityProductName(firstItem) || getAvailabilitySku(firstItem) || "").localeCompare(
      String(getAvailabilityProductName(secondItem) || getAvailabilitySku(secondItem) || ""),
      undefined,
      { numeric: true, sensitivity: "base" }
    );
  });

const getAvailabilityExpectedQty = (item = {}) =>
  firstPresent(item?.expectedQty, item?.expected_qty, item?.qtyExpected, item?.qty_expected, 0);

const getAvailabilityReceivedQty = (item = {}) =>
  firstPresent(item?.receivedQty, item?.received_qty, item?.qtyReceived, item?.qty_received, 0);

const getAvailabilityAssignedQty = (item = {}) =>
  firstPresent(item?.assignedQty, item?.assigned_qty, item?.assigned, 0);

const getAvailabilityRemainingQty = (item = {}) =>
  firstPresent(item?.remainingQty, item?.remaining_qty, 0);

const getAvailabilityAvailableQty = (item = {}) => {
  const availableQuantity = firstPresent(item?.availableQty, item?.available_qty);
  const availableNumber = Number(availableQuantity);
  if (availableQuantity !== "" && Number.isFinite(availableNumber)) return Math.max(0, availableNumber);

  const remainingQuantity = firstPresent(item?.remainingQty, item?.remaining_qty);
  const remainingNumber = Number(remainingQuantity);
  if (remainingQuantity !== "" && Number.isFinite(remainingNumber)) return Math.max(0, remainingNumber);

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
    Boolean((getBoxItemLineItemId(boxItem) || getBoxItemSku(boxItem)) && getBoxItemQuantity(boxItem) !== "")
  );

  if (hasItemRows) return true;

  return Boolean(getBoxDisplaySkuValues(box).length && getBoxUnits(box) !== "");
};

const getSubShipmentAllocationSummary = (subShipment = {}, boxData = {}) =>
  extractList(boxData, ["allocationSummary", "allocation_summary"]).length
    ? extractList(boxData, ["allocationSummary", "allocation_summary"])
    : getSubShipmentItems(subShipment).map((item) => {
        const lineItem = getSubShipmentItemLineItem(item);
        return {
          shipmentItemId: getShipmentLineItemId(lineItem) || getLineItemId(lineItem) || getSubShipmentAllocationItemId(item),
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
      (remainingValue !== "" && Number.isFinite(remainingQty) && Number.isFinite(plannedQty) && remainingQty < plannedQty)
    );
  });
  const assumeExistingBoxesConsumedPlannedQty = subShipmentBoxes.length > 0 && !hasDetailedBoxAllocation && !hasSummaryAllocation;

  return summaryRows
    .map((summary) => {
      const summaryItemId = String(getSubShipmentAllocationItemId(summary) || "").trim();
      const summarySku = String(getAvailabilitySku(summary) || "").trim().toLowerCase();
      const matchedSubItem = items.find((item) => {
        const lineItem = getSubShipmentItemLineItem(item);
        const lineItemId = String(getShipmentLineItemId(lineItem) || getLineItemId(lineItem) || getSubShipmentAllocationItemId(item) || "").trim();
        const lineItemSku = String(getItemSku(lineItem) || "").trim().toLowerCase();
        return Boolean(
          (summaryItemId && lineItemId && summaryItemId === lineItemId) ||
            (summarySku && lineItemSku && skuValuesMatch(summarySku, lineItemSku))
        );
      });
      const matchedParentLine = toArray(parentLineItems).find((lineItem) => {
        const lineItemId = String(getShipmentLineItemId(lineItem) || getLineItemId(lineItem) || "").trim();
        const lineItemSku = String(getItemSku(lineItem) || "").trim().toLowerCase();
        return Boolean(
          (summaryItemId && lineItemId && summaryItemId === lineItemId) ||
            (summarySku && lineItemSku && skuValuesMatch(summarySku, lineItemSku))
        );
      });
      const sourceLineItem = matchedSubItem ? getSubShipmentItemLineItem(matchedSubItem) : matchedParentLine || {};
      const plannedQty = Number(firstPresent(summary?.plannedQty, summary?.planned_qty, getSubShipmentItemQuantity(matchedSubItem || {}), 0) || 0);
      const shipmentItemId = summaryItemId || getShipmentLineItemId(sourceLineItem) || getLineItemId(sourceLineItem);
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
      const actualAllocatedQty = getAllocatedQuantityForLineItem(allocationLineItem, subShipmentBoxes, []);
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
        summaryRemainingValue !== "" && Number.isFinite(summaryRemainingQty)
          ? Math.min(Math.max(0, summaryRemainingQty), computedRemainingQty)
          : computedRemainingQty;

      return {
        ...allocationLineItem,
        sku,
        productName: getAvailabilityProductName(summary) || getItemName(sourceLineItem),
        product_name: getAvailabilityProductName(summary) || getItemName(sourceLineItem),
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
    shipmentItemId: getBoxAllocationLineItemId(item) || getShipmentLineItemId(item) || getLineItemId(item),
    sku: getItemSku(item),
    plannedQty: item.__subShipmentPlannedQty,
    allocated: item.__subShipmentAllocatedQty,
    remainingQty: item.__subShipmentAvailableQty,
  }));

const getSubShipmentLabelSummary = (subShipmentBoxes = [], files = []) => {
  if (!subShipmentBoxes.length) return "No boxes";
  const labeledCount = subShipmentBoxes.filter((box) => isBoxFbaLabelUploaded(box, files)).length;
  return `${labeledCount}/${subShipmentBoxes.length} labels uploaded`;
};

const getSubShipmentDispatchSummary = (subShipment = {}, subShipmentBoxes = []) => {
  const status = getSubShipmentStatus(subShipment);
  if (["dispatched", "completed"].includes(status)) return getSubShipmentStatusLabel(status);
  if (!subShipmentBoxes.length) return "No boxes";
  const dispatchedCount = subShipmentBoxes.filter((box) =>
    ["dispatched", "sealed", "completed", "complete"].includes(
      String(firstPresent(box?.status, box?.boxStatus, box?.box_status, box?.dispatchStatus, box?.dispatch_status, "")).toLowerCase()
    ) || Boolean(box?.dispatched_at || box?.dispatchedAt)
  ).length;
  return `${dispatchedCount}/${subShipmentBoxes.length} dispatched`;
};

const getLineItemOptionValue = (item = {}) => String(getLineItemId(item) || getItemSku(item) || "").trim();

const fetchBoxItemsByBoxId = async (box = {}) => {
  const boxId = String(getBoxItemsLookupId(box) || "").trim();
  if (!boxId) return [];

  try {
    const response = await fetch(`${API_BASE_URL}/api/boxes/${encodeURIComponent(boxId)}/items`, {
      method: "GET",
      headers: buildHeaders(),
      cache: "no-store",
    });
    return extractBoxItems(await parseResponse(response));
  } catch {
    return [];
  }
};

const enrichBoxWithItems = async (box = {}, lineItemList = [], batchItems = null) => {
  const existingItems = getBoxItems(box);
  const hasUsableItems = existingItems.some((item) =>
    (getBoxItemLineItemId(item) || getBoxItemSku(item)) && getBoxItemQuantity(item) !== ""
  );
  const boxId = String(getBoxItemsLookupId(box) || "").trim();
  const boxItems = batchItems && isUuidValue(boxId)
    ? getBatchItemsForBox(batchItems, boxId)
    : await fetchBoxItemsByBoxId(box);
  const hydratedBoxItems = hydrateBoxItemsWithLineItems(boxItems, lineItemList);

  if (hydratedBoxItems.length) {
    return {
      ...box,
      items: hydratedBoxItems,
      boxItems: hydratedBoxItems,
      box_items: hydratedBoxItems,
      contents: hydratedBoxItems,
    };
  }

  const cachedItems = hydrateBoxItemsWithLineItems(getCachedBoxAllocationItems(box), lineItemList);
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
    const hydratedExistingItems = hydrateBoxItemsWithLineItems(existingItems, lineItemList);

    return {
      ...box,
      items: hydratedExistingItems,
      boxItems: hydratedExistingItems,
      box_items: hydratedExistingItems,
      contents: hydratedExistingItems,
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
    result.status === "fulfilled" ? result.value : boxList[index]
  );
};

const enrichBoxesWithItemsIfMissing = async (boxList = [], lineItemList = []) => {
  const boxesNeedingItems = toArray(boxList).filter((box) => !getBoxItems(box).length && getBoxItemsLookupId(box));
  return boxesNeedingItems.length ? enrichBoxesWithItems(boxList, lineItemList) : boxList;
};

const getBoxImageUrl = (box, files) => {
  const boxId = getBoxId(box);
  const directImage = box?.imageUrl || box?.image_url || box?.photoUrl || box?.photo_url;
  if (directImage) return directImage;

  const matchedFile = toArray(files).find((file) => {
    const sameEntity =
      file?.entityId === boxId ||
      file?.entity_id === boxId ||
      file?.boxId === boxId ||
      file?.box_id === boxId;
    const type = String(file?.mimeType || file?.mime_type || file?.fileType || file?.file_type || "").toLowerCase();
    return sameEntity && type.includes("image");
  });

  return matchedFile?.url || matchedFile?.fileUrl || matchedFile?.file_url || matchedFile?.publicUrl || matchedFile?.public_url || "";
};

const isUsableFileUrlCandidate = (value = "") => {
  const url = String(value || "").trim();
  if (!url) return false;
  if (/^(https?:|data:|blob:)/i.test(url)) return true;
  if (url.startsWith("/")) return true;
  return url.includes("/");
};

const firstUsableFileUrl = (...values) => {
  const value = values.find(isUsableFileUrlCandidate);
  return value === undefined || value === null ? "" : String(value).trim();
};

const getFileUrl = (file = {}) => {
  const meta = getFileMeta(file);
  return firstUsableFileUrl(
    file?.signedUrl,
    file?.signed_url,
    file?.signedURL,
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
    meta?.src,
    meta?.storagePath,
    meta?.storage_path,
    meta?.filePath,
    meta?.file_path,
    meta?.path,
    meta?.location
  );
};

const getFileName = (file = {}) =>
  file?.name ||
  file?.fileName ||
  file?.file_name ||
  file?.originalName ||
  file?.original_name ||
  file?.original_filename ||
  file?.filename ||
  file?.storagePath ||
  file?.storage_path ||
  file?.filePath ||
  file?.file_path ||
  file?.path ||
  file?.url ||
  getFileMeta(file)?.name ||
  getFileMeta(file)?.fileName ||
  getFileMeta(file)?.file_name ||
  getFileMeta(file)?.originalName ||
  getFileMeta(file)?.original_name ||
  getFileMeta(file)?.original_filename ||
  getFileMeta(file)?.filename ||
  getFileMeta(file)?.storagePath ||
  getFileMeta(file)?.storage_path ||
  getFileMeta(file)?.filePath ||
  getFileMeta(file)?.file_path ||
  getFileMeta(file)?.path ||
  getFileMeta(file)?.url ||
  "label.pdf";

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

const parseFileMeta = (value) => {
  if (!value) return {};
  if (typeof value === "object") return value;
  if (typeof value !== "string") return {};

  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
};

const getFileMeta = (file = {}) => ({
  ...parseFileMeta(file?.metadata),
  ...parseFileMeta(file?.meta),
  ...(file?.metadata && typeof file.metadata === "object" ? file.metadata : {}),
  ...(file?.meta && typeof file.meta === "object" ? file.meta : {}),
});

const getFileEntityId = (file = {}) =>
  file?.entityId ||
  file?.entity_id ||
  file?.boxId ||
  file?.box_id ||
  file?.metadata?.boxId ||
  file?.metadata?.box_id ||
  file?.meta?.boxId ||
  file?.meta?.box_id ||
  file?.box?.id ||
  file?.box?.uuid ||
  file?.itemId ||
  file?.item_id ||
  getFileMeta(file)?.itemId ||
  getFileMeta(file)?.item_id ||
  getFileMeta(file)?.lineItemId ||
  getFileMeta(file)?.line_item_id ||
  getFileMeta(file)?.shipmentItemId ||
  getFileMeta(file)?.shipment_item_id ||
  file?.lineItemId ||
  file?.line_item_id ||
  file?.shipmentItemId ||
  file?.shipment_item_id ||
  file?.shipmentId ||
  file?.shipment_id ||
  file?.linkedEntityId ||
  file?.linked_entity_id ||
  getFileMeta(file)?.shipmentId ||
  getFileMeta(file)?.shipment_id ||
  getFileMeta(file)?.linkedEntityId ||
  getFileMeta(file)?.linked_entity_id ||
  "";

const getFileEntityType = (file = {}) =>
  String(
    firstPresent(
      file?.entityType,
      file?.entity_type,
      file?.linkedEntityType,
      file?.linked_entity_type,
      getFileMeta(file)?.entityType,
      getFileMeta(file)?.entity_type,
      getFileMeta(file)?.linkedEntityType,
      getFileMeta(file)?.linked_entity_type
    )
  )
    .trim()
    .toLowerCase();

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
    box?.labelFileName,
    box?.label_file_name,
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
    entityType: "box",
    entity_type: "box",
    entityId: boxId,
    entity_id: boxId,
    boxId,
    box_id: boxId,
    fileType: "fba_shipping_label",
    file_type: "fba_shipping_label",
  };
};

const getBoxFbaLabelFile = (box = {}, files = []) => {
  const directLabelFile = getBoxDirectFbaLabelFile(box);
  if (directLabelFile) return directLabelFile;

  const boxIds = getBoxLookupIds(box);
  const labelFileId = String(getBoxFbaLabelFileId(box) || "").trim();

  return toArray(files).find((file) => {
    const fileId = String(getFileRecordId(file) || "").trim();
    const entityId = String(getFileEntityId(file) || "").trim();
    const type = getFileTypeValue(file);
    const name = getFileName(file).toLowerCase();
    const sameBox =
      (labelFileId && fileId === labelFileId) ||
      (entityId && boxIds.includes(entityId)) ||
      boxIds.some((boxId) => file?.entityId === boxId || file?.entity_id === boxId || file?.boxId === boxId || file?.box_id === boxId);
    const isLabel =
      type.includes("fba_shipping_label") ||
      type.includes("fba") ||
      type.includes("shipping_label") ||
      type.includes("label") ||
      name.includes("fba") ||
      name.includes("shipping-label") ||
      name.includes("shipping_label");
    return sameBox && isLabel;
  });
};

const isBoxFbaLabelUploaded = (box = {}, files = []) => {
  const status = String(box?.status || "").toLowerCase();
  return Boolean(
    getBoxFbaLabelFile(box, files) ||
      getBoxFbaLabelFileId(box) ||
      box?.labelReady ||
      box?.label_ready ||
      box?.fbaLabelUploaded ||
      box?.fba_label_uploaded ||
      box?.labelUploaded ||
      box?.label_uploaded ||
      status === "uploaded" ||
      status === "label_ready" ||
      status === "ready"
  );
};

const getBoxLabelState = (box, files = []) =>
  isBoxFbaLabelUploaded(box, files)
    ? { label: "Label Ready", className: "bg-emerald-50 text-emerald-700" }
    : { label: "Label Needed", className: "bg-red-50 text-red-600" };

const getBoxSkuValue = (box = {}, files = []) => {
  const items = getBoxItems(box);
  const itemSkus = items
    .map((item) => {
      const sku = String(getBoxItemSku(item) || "").trim();
      const quantity = getBoxItemQuantity(item);

      if (sku && quantity !== "") return `${sku}: ${quantity}`;
      return sku;
    })
    .filter(Boolean);

  if (itemSkus.length) return itemSkus.join(", ");

  return firstPresent(
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
};

const getBoxSkuSummary = (box = {}, files = []) => {
  const itemSummaries = getBoxItems(box)
    .map((item) => {
      const sku = getBoxItemSku(item);
      const quantity = getBoxItemQuantity(item);

      if (sku && quantity !== "") return `${quantity} UNITS (${sku})`;
      if (sku) return sku;
      if (quantity !== "") return `${quantity} UNITS`;
      return "";
    })
    .filter(Boolean);

  if (itemSummaries.length) return itemSummaries.join(", ");

  const sku = getBoxSkuValue(box, files);
  const units = getBoxUnits(box);

  if (sku && units !== "") return `${units} UNITS (${sku})`;
  if (sku) return sku;
  if (units) return `${units} UNITS`;
  return "";
};

const getBoxSubtitle = (box = {}, files = []) => {
  const dimensions = getBoxDimensions(box);
  const weight = getBoxWeight(box);
  const skuSummary = getBoxSkuSummary(box, files);

  return [dimensions, weight ? `${weight} KG` : "", skuSummary].filter(Boolean).join(" - ") || "No box details";
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
    file?.path,
    file?.location,
    getFileMeta(file)?.storagePath,
    getFileMeta(file)?.storage_path,
    getFileMeta(file)?.filePath,
    getFileMeta(file)?.file_path,
    getFileMeta(file)?.path,
    getFileMeta(file)?.location
  );

  return String(rawPath || "")
    .split("?")[0]
    .replace(/^https?:\/\/[^/]+/i, "")
    .toLowerCase();
};

const getFileDedupeKey = (file = {}, index = 0) => {
  const entityType = getFileEntityType(file);
  const entityId = String(getFileEntityId(file) || "").trim().toLowerCase();
  const fileType = getFileTypeValue(file);
  const fileName = getFileName(file).trim().toLowerCase();
  const fileSize = firstPresent(file?.size, file?.fileSize, file?.file_size, file?.fileSizeBytes, file?.file_size_bytes, getFileMeta(file)?.size, getFileMeta(file)?.fileSizeBytes, getFileMeta(file)?.file_size_bytes);
  const stablePath = getFileStablePath(file);

  const fileId = String(getFileRecordId(file) || "").trim();
  if (fileId) return `id:${fileId}`;
  if (fileName && (entityType || entityId)) return `file:${entityType}:${entityId}:${fileName}:${fileSize || ""}`;
  if (fileName && fileType) return `filetype:${fileType}:${fileName}:${fileSize || ""}`;
  if (stablePath) return `path:${stablePath}`;
  return String(file?.id || file?.uuid || `${fileName || "file"}-${index}`);
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

const extractFileRecords = (payload) => {
  const files = extractList(payload, ["files", "fileList", "file_list", "attachments", "uploads"]);
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
    typeof file === "object" &&
    !Array.isArray(file) &&
    (
      getFileUrl(file) ||
      getFileRecordId(file) ||
      file?.name ||
      file?.fileName ||
      file?.file_name ||
      file?.original_filename ||
      file?.storagePath ||
      file?.storage_path
    )
  );

  return singleFile ? [singleFile] : [];
};

const fetchFileById = async (fileId) => {
  const normalizedFileId = String(fileId || "").trim();
  if (!normalizedFileId) return [];

  const endpoints = [
    `${API_BASE_URL}/api/files?id=${encodeURIComponent(normalizedFileId)}`,
    `${API_BASE_URL}/api/files?fileId=${encodeURIComponent(normalizedFileId)}`,
  ];

  for (const endpoint of endpoints) {
    try {
      const response = await fetch(endpoint, {
        method: "GET",
        headers: buildHeaders(),
        cache: "no-store",
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
  const normalizedEntityType = String(entityType || "").trim();
  const normalizedEntityId = String(entityId || "").trim();
  if (!normalizedEntityType || !normalizedEntityId) return [];

  try {
    const response = await fetch(`${API_BASE_URL}/api/files?entityType=${encodeURIComponent(normalizedEntityType)}&entityId=${encodeURIComponent(normalizedEntityId)}`, {
      method: "GET",
      headers: buildHeaders(),
      cache: "no-store",
    });
    return extractFileRecords(await parseResponse(response));
  } catch {
    return [];
  }
};

const isStoragePathCandidate = (url = "") => {
  const normalizedUrl = String(url || "").trim();
  if (!normalizedUrl || normalizedUrl.startsWith("/") || /^(https?:|data:|blob:)/i.test(normalizedUrl)) return false;
  if (/^api\//i.test(normalizedUrl)) return false;
  return normalizedUrl.includes("/") && /\.[a-z0-9]{2,8}(?:$|\?)/i.test(normalizedUrl);
};

const encodeStoragePath = (path = "") =>
  String(path || "")
    .trim()
    .replace(/^\/+/, "")
    .split("/")
    .map((part) => encodeURIComponent(safeDecodeStoragePath(part)))
    .join("/");

const safeDecodeStoragePath = (path = "") => {
  let decodedPath = String(path || "");

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

const buildStoragePublicUrl = (bucket = SUPABASE_DEFAULT_STORAGE_BUCKET, path = "") => {
  const normalizedPath = String(path || "").trim().replace(/^\/+/, "");
  if (!SUPABASE_STORAGE_PUBLIC_BASE_URL || !bucket || !isStoragePathCandidate(normalizedPath)) return "";
  return `${SUPABASE_STORAGE_PUBLIC_BASE_URL}/${bucket}/${encodeStoragePath(normalizedPath)}`;
};

const resolveStoragePathUrl = (path = "") => {
  const normalizedPath = String(path || "").trim().replace(/^\/+/, "");
  if (!SUPABASE_STORAGE_PUBLIC_BASE_URL || !isStoragePathCandidate(normalizedPath)) return "";

  return buildStoragePublicUrl(SUPABASE_DEFAULT_STORAGE_BUCKET, normalizedPath);
};

const getSupabasePublicObjectParts = (url = "") => {
  const value = String(url || "").trim();
  const markers = ["/storage/v1/object/public/", "/storage/v1/render/image/public/"];
  const marker = markers.find((currentMarker) => value.includes(currentMarker));
  if (!marker) return {};

  const hashIndex = value.indexOf("#");
  const withoutHash = hashIndex >= 0 ? value.slice(0, hashIndex) : value;
  const queryIndex = withoutHash.indexOf("?");
  const base = queryIndex >= 0 ? withoutHash.slice(0, queryIndex) : withoutHash;
  const markerIndex = base.indexOf(marker);
  const objectPath = base.slice(markerIndex + marker.length);
  const pathParts = objectPath.split("/").filter(Boolean);
  if (pathParts.length < 2) return {};

  return {
    bucket: pathParts[0],
    path: pathParts.slice(1).join("/"),
  };
};

const getSupabasePublicObjectPath = (url = "") => getSupabasePublicObjectParts(url).path || "";

const encodeSupabasePublicObjectUrl = (url = "") => {
  const value = String(url || "").trim();
  const markers = ["/storage/v1/object/public/", "/storage/v1/render/image/public/"];
  const marker = markers.find((currentMarker) => value.includes(currentMarker));
  if (!marker) return "";

  const hashIndex = value.indexOf("#");
  const hash = hashIndex >= 0 ? value.slice(hashIndex) : "";
  const withoutHash = hashIndex >= 0 ? value.slice(0, hashIndex) : value;
  const queryIndex = withoutHash.indexOf("?");
  const query = queryIndex >= 0 ? withoutHash.slice(queryIndex) : "";
  const base = queryIndex >= 0 ? withoutHash.slice(0, queryIndex) : withoutHash;
  const markerIndex = base.indexOf(marker);
  const prefix = base.slice(0, markerIndex + marker.length);
  const objectPath = base.slice(markerIndex + marker.length);

  if (!objectPath || /%25[0-9a-f]{2}/i.test(objectPath)) return encodeURI(value);

  return `${prefix}${encodeStoragePath(objectPath)}${query}${hash}`;
};

const resolveFileUrl = (url = "") => {
  const normalizedUrl = String(url || "").trim();
  if (!normalizedUrl || !isUsableFileUrlCandidate(normalizedUrl)) return "";
  if (/^(data:|blob:)/i.test(normalizedUrl)) return normalizedUrl;
  if (/^https?:/i.test(normalizedUrl)) {
    const encodedStorageUrl = encodeSupabasePublicObjectUrl(normalizedUrl);
    if (encodedStorageUrl && /%[0-9a-f]{2}/i.test(normalizedUrl)) return encodedStorageUrl;
    return encodeURI(normalizedUrl);
  }
  if (isStoragePathCandidate(normalizedUrl)) {
    return encodeURI(resolveStoragePathUrl(normalizedUrl));
  }
  if (normalizedUrl.startsWith("/")) return encodeURI(`${API_BASE_URL}${normalizedUrl}`);
  return "";
};

const getFileUrlCandidates = (file = {}) => {
  const rawUrl = getFileUrl(file);
  const publicObjectParts = getSupabasePublicObjectParts(rawUrl);
  const publicObjectPath = publicObjectParts.path || "";
  const storagePath = publicObjectPath || (isStoragePathCandidate(rawUrl) ? rawUrl : "");
  const storagePathVariants = [
    storagePath,
    safeDecodeStoragePath(storagePath),
  ].filter(Boolean);
  const storageBucketCandidates = [
    publicObjectParts.bucket,
    ...SUPABASE_STORAGE_BUCKET_CANDIDATES,
  ].filter((bucket, index, buckets) => bucket && buckets.indexOf(bucket) === index);

  return [
    resolveFileUrl(rawUrl),
    encodeSupabasePublicObjectUrl(rawUrl),
    encodeSupabasePublicObjectUrl(resolveFileUrl(rawUrl)),
    ...storageBucketCandidates.flatMap((bucket) =>
      storagePathVariants.map((path) => buildStoragePublicUrl(bucket, path))
    ),
  ]
    .map((url) => String(url || "").trim())
    .filter(Boolean)
    .filter((url, index, urls) => urls.indexOf(url) === index);
};

const isReachableFileUrl = async (url = "") => {
  if (!/^https?:/i.test(url)) return true;

  try {
    const headResponse = await fetch(url, {
      method: "HEAD",
      cache: "no-store",
    });

    const headContentType = String(headResponse.headers.get("content-type") || "").toLowerCase();
    if (headResponse.ok && !headContentType.includes("application/json")) return true;
    if (!headResponse.ok && ![403, 405].includes(headResponse.status)) return false;

    const response = await fetch(url, {
      method: "GET",
      cache: "no-store",
    });

    if (!response.ok) return false;

    const contentType = String(response.headers.get("content-type") || "").toLowerCase();
    if (contentType.includes("application/json")) {
      const text = await response.clone().text();
      return !/invalid key|statuscode|\"error\"/i.test(text);
    }

    return true;
  } catch {
    return true;
  }
};

const getOpenFileCacheKey = (file = {}) =>
  String(getFileRecordId(file) || getFileDedupeKey(file) || getFileName(file) || "").trim();

const findReachableFileUrl = async (urls = []) => {
  const localUrl = urls.find((url) => !/^https?:/i.test(url));
  if (localUrl) return localUrl;

  return urls.find(Boolean) || "";
};

const sanitizeFileName = (value = "label") =>
  String(value || "label")
    .replace(/[^a-z0-9._-]+/gi, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase() || "label";

const escapePdfText = (value = "") => String(value).replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");

const downloadPdfFile = (fileName, lines) => {
  const textLines = lines.slice(0, 42);
  const streamLines = ["BT", "/F1 14 Tf", "50 780 Td"];
  textLines.forEach((line, index) => {
    if (index === 1) streamLines.push("/F1 10 Tf");
    streamLines.push(`(${escapePdfText(line)}) Tj`);
    streamLines.push("0 -18 Td");
  });
  streamLines.push("ET");

  const stream = streamLines.join("\n");
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
  ];

  let pdf = "%PDF-1.4\n";
  const offsets = [0];
  objects.forEach((object, index) => {
    offsets.push(pdf.length);
    pdf += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });

  const xrefOffset = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n`;
  pdf += "0000000000 65535 f \n";
  offsets.slice(1).forEach((offset) => {
    pdf += `${String(offset).padStart(10, "0")} 00000 n \n`;
  });
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`;

  const blob = new Blob([pdf], { type: "application/pdf" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  anchor.click();
  URL.revokeObjectURL(url);
};

const openOrDownloadFile = async (file) => {
  const urls = getFileUrlCandidates(file);
  const cacheKey = getOpenFileCacheKey(file);
  const cachedUrl = cacheKey ? FILE_OPEN_URL_CACHE.get(cacheKey) : "";

  if (cachedUrl) {
    window.open(cachedUrl, "_blank", "noopener,noreferrer");
    return true;
  }

  const url = await findReachableFileUrl(urls);
  if (!url) return false;

  if (cacheKey) FILE_OPEN_URL_CACHE.set(cacheKey, url);
  window.open(url, "_blank", "noopener,noreferrer");
  return true;
};

const LabelPreviewImage = ({ file, alt = "", className = "" }) => {
  const urls = getFileUrlCandidates(file);
  const [urlIndex, setUrlIndex] = useState(0);

  useEffect(() => {
    setUrlIndex(0);
  }, [file]);

  const src = urls[urlIndex] || "";
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

const isPdfFile = (file = {}) => {
  const type = getFileTypeValue(file);
  const name = getFileName(file).toLowerCase();
  const url = getFileUrl(file).toLowerCase();
  return type.includes("pdf") || /\.pdf(?:$|\?)/i.test(name) || /\.pdf(?:$|\?)/i.test(url);
};

const isImageFile = (file = {}) => {
  const type = getFileTypeValue(file);
  const name = getFileName(file).toLowerCase();
  const url = getFileUrl(file).toLowerCase();
  return type.startsWith("image/") || /\.(png|jpe?g|webp|avif|gif|bmp|svg)(?:$|\?)/i.test(name) || /\.(png|jpe?g|webp|avif|gif|bmp|svg)(?:$|\?)/i.test(url);
};

const isCsvFile = (file = {}) => {
  const type = getFileTypeValue(file);
  const name = getFileName(file).toLowerCase();
  const url = getFileUrl(file).toLowerCase();
  return type.includes("csv") || /\.csv(?:$|\?)/i.test(name) || /\.csv(?:$|\?)/i.test(url);
};

const isFbaBoxLabelFile = (file = {}) => {
  const type = getFileTypeValue(file);
  const entityType = getFileEntityType(file);
  const name = getFileName(file).toLowerCase();
  return (
    type.includes("fba_shipping_label") ||
    type.includes("fba-shipping-label") ||
    type.includes("shipping_label") ||
    type === "fba_label" ||
    name.includes("fba") ||
    name.includes("shipping-label") ||
    name.includes("shipping_label") ||
    (entityType === "box" && type.includes("label"))
  );
};

const isFnskuLabelFile = (file = {}) => {
  const type = getFileTypeValue(file);
  const name = getFileName(file).toLowerCase();
  const entityType = getFileEntityType(file);
  return !isFbaBoxLabelFile(file) && (type.includes("fnsku") || name.includes("fnsku") || (entityType === "item" && (type.includes("label") || isPdfFile(file) || isImageFile(file))));
};

const isAnyItemLabelFile = (file = {}) => {
  const type = getFileTypeValue(file);
  const name = getFileName(file).toLowerCase();
  return !isFbaBoxLabelFile(file) && (isFnskuLabelFile(file) || type.includes("label") || name.includes("label") || isCsvFile(file));
};

const normalizeFileMatchValue = (value = "") => {
  const normalized = String(value || "").trim().toLowerCase();
  return normalized && !["-", "n/a", "na", "none", "null", "undefined"].includes(normalized) ? normalized : "";
};

const getItemUploadedLabelFiles = (item = {}) =>
  mergeFileLists(
    extractList(item?.uploadedFiles, ["files"]),
    extractList(item?.uploaded_files, ["files"])
  );

const getItemLabelFileName = (item = {}) => {
  const uploadedFile = getItemUploadedLabelFiles(item)[0] || {};
  const uploadedFileName = Object.keys(uploadedFile).length ? getFileName(uploadedFile) : "";
  return firstPresent(
    item?.fileName,
    item?.file_name,
    item?.labelFileName,
    item?.label_file_name,
    item?.fnskuLabelFileName,
    item?.fnsku_label_file_name,
    item?.uploadedFiles?.name,
    item?.uploadedFiles?.fileName,
    item?.uploadedFiles?.file_name,
    item?.uploadedFiles?.original_filename,
    item?.uploaded_files?.name,
    item?.uploaded_files?.fileName,
    item?.uploaded_files?.file_name,
    item?.uploaded_files?.original_filename,
    uploadedFileName
  );
};

const getItemLabelFileId = (item = {}) => {
  const uploadedFile = getItemUploadedLabelFiles(item)[0] || {};
  return firstPresent(
    item?.fnskuLabelFileId,
    item?.fnsku_label_file_id,
    item?.fnskuFileId,
    item?.fnsku_file_id,
    item?.labelFileId,
    item?.label_file_id,
    item?.fileId,
    item?.file_id,
    item?.fnskuLabelFile?.id,
    item?.fnskuLabelFile?.uuid,
    item?.fnsku_label_file?.id,
    item?.fnsku_label_file?.uuid,
    item?.uploadedFiles?.id,
    item?.uploadedFiles?.uuid,
    item?.uploaded_files?.id,
    item?.uploaded_files?.uuid,
    getFileRecordId(uploadedFile)
  );
};

const buildItemLabelFile = (item = {}, file = {}) => {
  const labelFileId = getItemLabelFileId(item);
  const lineItemId = getShipmentLineItemId(item) || getLineItemId(item);
  const fileName = firstPresent(getFileName(file), getItemLabelFileName(item), "FNSKU label");

  return {
    ...file,
    id: getFileRecordId(file) || labelFileId || file?.id || file?.uuid || `${lineItemId || getItemSku(item) || "item"}-fnsku-label`,
    name: fileName,
    fileName,
    file_name: fileName,
    fileType: file?.fileType || file?.file_type || "fnsku_label",
    file_type: file?.file_type || file?.fileType || "fnsku_label",
    entityType: file?.entityType || file?.entity_type || "item",
    entity_type: file?.entity_type || file?.entityType || "item",
    entityId: file?.entityId || file?.entity_id || lineItemId,
    entity_id: file?.entity_id || file?.entityId || lineItemId,
    fnsku: file?.fnsku || file?.fnskuLabel || file?.fnsku_label || getItemFnsku(item),
    sku: file?.sku || getItemSku(item),
  };
};

const getItemDirectLabelFile = (item = {}) => {
  const directFile = item?.fnskuLabelFile || item?.fnsku_label_file;
  if (directFile && typeof directFile === "object" && !Array.isArray(directFile)) return buildItemLabelFile(item, directFile);
  return null;
};

const getItemInlineLabelFiles = (item = {}) =>
  mergeFileLists(
    [getItemDirectLabelFile(item)].filter(Boolean),
    mergeFileLists(
      getItemUploadedLabelFiles(item),
      extractList(item?.files, ["files"]),
      extractList(item?.attachments, ["files"]),
      extractList(item?.labels, ["files"]),
      extractList(item?.fnskuLabels, ["files"]),
      extractList(item?.fnsku_labels, ["files"])
    ).filter((file) => fileMatchesLineItem(file, item))
  ).map((file) => buildItemLabelFile(item, file));

const fileMatchesLineItem = (file = {}, item = {}) => mappedFileMatchesLineItem(file, item);

const getItemLabelCandidateFiles = (files = []) =>
  extractList(files, ["files"]).filter((file) => {
    if (!getFileUrl(file) && !getFileName(file)) return false;
    if (getFileEntityType(file) === "box" || isFbaBoxLabelFile(file)) return false;
    return isFnskuLabelFile(file) || isAnyItemLabelFile(file) || isPdfFile(file) || isImageFile(file);
  });

const findLineItemLabelFile = (item, files) => {
  const allFiles = mergeFileLists(getItemInlineLabelFiles(item), files).filter((file) => {
    if (!getFileUrl(file) && !getFileName(file)) return false;
    if (getFileEntityType(file) === "box" || isFbaBoxLabelFile(file)) return false;
    return isPdfFile(file) || isImageFile(file) || isAnyItemLabelFile(file);
  });

  return findMappedLineItemLabelFile(item, getItemLabelCandidateFiles(allFiles));
};

const getItemLabelMatchIds = (item = {}) => [
  getShipmentLineItemId(item),
  getLineItemId(item),
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
  .map((value) => String(value || "").trim())
  .filter(Boolean);

const isExactItemLabelFileMatch = (file = {}, item = {}) => {
  const itemLabelFileId = String(getItemLabelFileId(item) || "").trim();
  const fileRecordId = String(getFileRecordId(file) || "").trim();
  const fileEntityId = String(getFileEntityId(file) || "").trim();
  const itemIds = getItemLabelMatchIds(item);

  return Boolean(
    (itemLabelFileId && fileRecordId && itemLabelFileId === fileRecordId) ||
      (fileEntityId && itemIds.includes(fileEntityId))
  );
};

const getItemLabelFileAssignments = (items = [], files = []) => {
  const itemList = toArray(items);
  if (!itemList.length) return [];

  const candidateFiles = mergeFileLists(itemList.flatMap((item) => getItemInlineLabelFiles(item)), files)
    .filter((file) => {
      if (!getFileUrl(file) && !getFileName(file)) return false;
      const entityType = getFileEntityType(file);
      if (entityType === "box" || isFbaBoxLabelFile(file)) return false;
      return isFnskuLabelFile(file) || isAnyItemLabelFile(file) || isPdfFile(file) || isImageFile(file) || isCsvFile(file);
    });

  return getMappedItemLabelFileAssignments(itemList, candidateFiles);
};

const ShipmentsStaff = () => {
  const location = useLocation();
  const navigate = useNavigate();
  const [searchTerm, setSearchTerm] = useState("");
  const [shipments, setShipments] = useState([]);
  const [viewShipment, setViewShipment] = useState(null);
  const [viewShipmentDetail, setViewShipmentDetail] = useState(null);
  const [viewShipmentBoxes, setViewShipmentBoxes] = useState([]);
  const [viewShipmentServices, setViewShipmentServices] = useState([]);
  const [viewShipmentFiles, setViewShipmentFiles] = useState([]);
  const [isViewShipmentLoading, setIsViewShipmentLoading] = useState(false);
  const [viewShipmentError, setViewShipmentError] = useState("");
  const [selectedShipmentId, setSelectedShipmentId] = useState(
    location.state?.selectedShipmentId ?? null
  );
  const [selectedShipment, setSelectedShipment] = useState(null);
  const [services, setServices] = useState([]);
  const [discrepancies, setDiscrepancies] = useState([]);
  const [boxes, setBoxes] = useState([]);
  const [subShipments, setSubShipments] = useState([]);
  const [subShipmentAvailability, setSubShipmentAvailability] = useState([]);
  const [subShipmentBoxData, setSubShipmentBoxData] = useState({});
  const [showSubShipmentModal, setShowSubShipmentModal] = useState(false);
  const [subShipmentSelections, setSubShipmentSelections] = useState({});
  const [subShipmentNotes, setSubShipmentNotes] = useState("");
  const [isCreatingSubShipment, setIsCreatingSubShipment] = useState(false);
  const [isRefreshingSubShipmentAvailability, setIsRefreshingSubShipmentAvailability] = useState(false);
  const [activeSubShipmentIdForBox, setActiveSubShipmentIdForBox] = useState("");
  const [files, setFiles] = useState([]);
  const [statusValue, setStatusValue] = useState("in_progress");
  const [bulkServiceType, setBulkServiceType] = useState("fnsku_label");
  const [bulkStatus, setBulkStatus] = useState("IN_PROGRESS");
  const [discrepancyResolveTarget, setDiscrepancyResolveTarget] = useState(null);
  const [discrepancyResolveError, setDiscrepancyResolveError] = useState("");
  const [isResolvingDiscrepancy, setIsResolvingDiscrepancy] = useState(false);
  const [taskId, setTaskId] = useState("");
  const [taskStatus, setTaskStatus] = useState("IN_PROGRESS");
  const [taskUnitsDone, setTaskUnitsDone] = useState("");
  const [taskNotes, setTaskNotes] = useState("");
  const [customServiceLineItemId, setCustomServiceLineItemId] = useState("");
  const [customServiceName, setCustomServiceName] = useState("");
  const [customServicePrice, setCustomServicePrice] = useState("");
  const [customServiceStatusValue, setCustomServiceStatusValue] = useState("DONE");
  const [boxType, setBoxType] = useState("box");
  const [boxSize, setBoxSize] = useState("medium");
  const [boxWeight, setBoxWeight] = useState("");
  const [boxLength, setBoxLength] = useState("");
  const [boxWidth, setBoxWidth] = useState("");
  const [boxHeight, setBoxHeight] = useState("");
  const [palletNumber, setPalletNumber] = useState("");
  const [showAddBoxModal, setShowAddBoxModal] = useState(false);
  const [boxSkuPreview, setBoxSkuPreview] = useState("");
  const [boxSkuQuantityPreview, setBoxSkuQuantityPreview] = useState("");
  const [boxSkuExtraRows, setBoxSkuExtraRows] = useState([]);
  const [selectedPalletBoxIds, setSelectedPalletBoxIds] = useState([]);
  const [hazmatEnabled, setHazmatEnabled] = useState(true);
  const [trackExpiryDates, setTrackExpiryDates] = useState(true);
  const [trackLotNumbers, setTrackLotNumbers] = useState(true);
  const [addToBoxBoxId, setAddToBoxBoxId] = useState("");
  const [addToBoxLineItemId, setAddToBoxLineItemId] = useState("");
  const [addToBoxQuantity, setAddToBoxQuantity] = useState("");
  const [removeFromBoxBoxId, setRemoveFromBoxBoxId] = useState("");
  const [removeFromBoxItemId, setRemoveFromBoxItemId] = useState("");
  const [sealBoxId, setSealBoxId] = useState("");
  const [sealTrackingCode, setSealTrackingCode] = useState("");
  const [deleteBoxId, setDeleteBoxId] = useState("");
  const [fileEntityType, setFileEntityType] = useState("shipment");
  const [fileEntityId, setFileEntityId] = useState("");
  const [fileType, setFileType] = useState("other");
  const [selectedFile, setSelectedFile] = useState(null);
  const [isLoading, setIsLoading] = useState(false);
  const [updatingTaskId, setUpdatingTaskId] = useState("");
  const [uploadingBoxLabelId, setUploadingBoxLabelId] = useState("");
  const [isCreatingBox, setIsCreatingBox] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [dispatchConfirm, setDispatchConfirm] = useState(null);

  const loadShipments = async () => {
    try {
      setIsLoading(true);
      setError("");
      let shipmentRows = [];

      try {
        shipmentRows = await fetchShipmentSummaryPages({
          apiBaseUrl: API_BASE_URL,
          headers: buildHeaders(),
          parseResponse,
          params: searchTerm.trim() ? { search: searchTerm.trim() } : {},
        });
        setShipments(shipmentRows.map(normalizeShipment));
      } catch {
        const query = new URLSearchParams({
          page: "1",
          limit: "25",
        });

        if (searchTerm.trim()) {
          query.set("search", searchTerm.trim());
        }

        const response = await fetch(`${API_BASE_URL}/api/shipments?${query.toString()}`, {
          method: "GET",
          headers: buildHeaders(),
        });
        const payload = await parseResponse(response);
        shipmentRows = extractShipments(payload);
        const normalizedRows = shipmentRows.map(normalizeShipment);
        const detailResults = await Promise.allSettled(
          normalizedRows.map(async (row, index) => {
            if (Number(row.units || 0) > 0 || !row.id) return shipmentRows[index];

            const lookupCandidates = getShipmentLookupCandidates(shipmentRows[index], row);

            for (const lookupId of lookupCandidates) {
              try {
                const detailResponse = await fetch(`${API_BASE_URL}/api/shipments/${encodeURIComponent(lookupId)}`, {
                  method: "GET",
                  headers: buildHeaders(),
                  cache: "no-store",
                });
                const detail = extractShipmentDetail(await parseResponse(detailResponse));
                const detailLineItems = sortLineItemsForDisplay(applyBundleMetadataFromNotes(getLineItems(detail), detail));
                const rowLineItems = sortLineItemsForDisplay(getLineItems(shipmentRows[index]));
                const detailUnits = getShipmentUnits(detail);
                const rowUnits = getShipmentUnits(shipmentRows[index]);

                return {
                  ...shipmentRows[index],
                  ...detail,
                  id: getShipmentId(shipmentRows[index]) || getShipmentId(detail),
                  reference: shipmentRows[index]?.reference || detail?.reference || row.reference,
                  shipment_line_items: detailLineItems.length ? detailLineItems : rowLineItems,
                  units: detailUnits || rowUnits,
                };
              } catch {
                // Try the next identifier; some APIs accept UUIDs while others accept shipment references.
              }
            }

            return shipmentRows[index];
          })
        );
        setShipments(
          detailResults.map((result, index) =>
            normalizeShipment(result.status === "fulfilled" ? result.value : shipmentRows[index])
          )
        );
      }
    } catch (requestError) {
      setError(requestError.message);
      setShipments([]);
    } finally {
      setIsLoading(false);
    }
  };

  const loadShipmentDetail = async (shipmentId, { showLoader = true } = {}) => {
    try {
      if (showLoader) {
        setIsLoading(true);
      }
      setError("");
      const normalizedShipmentId = String(shipmentId || "").trim();
      {
      const detailViewResponse = await fetch(`${API_BASE_URL}/api/shipments/${encodeURIComponent(normalizedShipmentId)}/detail-view`, {
        method: "GET",
        headers: buildHeaders(),
        cache: "no-store",
      });
      const detailViewPayload = await parseResponse(detailViewResponse);
      const detailViewBundle = detailViewPayload?.data || detailViewPayload;
      const bundleShipment = detailViewBundle?.shipment || {};
      const bundleLineItems = extractList(detailViewBundle, ["lineItems", "line_items", "items"]);
      const bundleBoxes = mergeBoxLists(
        extractList(detailViewBundle, ["allBoxes", "all_boxes"]),
        extractList(detailViewBundle, ["boxes"]),
        extractList(detailViewBundle, ["pallets"])
      );
      const bundleSubShipments = mergeSubShipmentLists(
        extractList(detailViewBundle, ["subShipments", "sub_shipments"]),
        extractSubShipments(bundleShipment)
      );
      const shipmentData = {
        ...bundleShipment,
        items: bundleLineItems,
        lineItems: bundleLineItems,
        shipment_line_items: bundleLineItems,
        boxes: bundleBoxes,
        outbound_boxes: bundleBoxes,
        subShipments: bundleSubShipments,
        sub_shipments: bundleSubShipments,
        counts: detailViewBundle?.counts || bundleShipment?.counts,
        permissions: detailViewBundle?.permissions || bundleShipment?.permissions,
        dispatchSummary: detailViewBundle?.dispatchSummary || detailViewBundle?.dispatch_summary || bundleShipment?.dispatchSummary || bundleShipment?.dispatch_summary,
        dispatch_summary: detailViewBundle?.dispatch_summary || detailViewBundle?.dispatchSummary || bundleShipment?.dispatch_summary || bundleShipment?.dispatchSummary,
        labelSummary: detailViewBundle?.labelSummary || detailViewBundle?.label_summary || bundleShipment?.labelSummary || bundleShipment?.label_summary,
        label_summary: detailViewBundle?.label_summary || detailViewBundle?.labelSummary || bundleShipment?.label_summary || bundleShipment?.labelSummary,
        filesByEntity: detailViewBundle?.filesByEntity || detailViewBundle?.files_by_entity || bundleShipment?.filesByEntity || bundleShipment?.files_by_entity,
        files_by_entity: detailViewBundle?.files_by_entity || detailViewBundle?.filesByEntity || bundleShipment?.files_by_entity || bundleShipment?.filesByEntity,
      };
      const detailLineItems = sortLineItemsForDisplay(applyBundleMetadataFromNotes(getLineItems(shipmentData), shipmentData));
      const shipmentRecordId = getShipmentRecordId(shipmentData);
      const nextSubShipmentBoxData = bundleSubShipments.reduce((acc, subShipment) => {
        const subShipmentId = getSubShipmentId(subShipment);
        if (!subShipmentId) return acc;
        acc[subShipmentId] = {
          boxes: mergeBoxLists(
            getSubShipmentBoxes(subShipment),
            extractList(subShipment, ["boxes"]),
            extractList(subShipment, ["pallets"]),
            extractList(subShipment, ["allBoxes", "all_boxes"])
          ).map((box) => decorateSubShipmentBoxForScope(box, subShipment)),
          allocationSummary: extractList(subShipment, ["allocationSummary", "allocation_summary"]),
        };
        return acc;
      }, {});
      const bundleFiles = mergeFileLists(
        extractFileRecords(detailViewBundle?.files),
        detailLineItems.flatMap((item) => getItemInlineLabelFiles(item)),
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

      setSelectedShipment(shipmentData);
      setStatusValue(shipmentData?.status || "in_progress");
      setDiscrepancies(extractList(detailViewBundle, ["discrepancies"]));
      setServices(mergeServiceTasks(detailViewBundle?.serviceTasks, detailViewBundle?.service_tasks, detailViewBundle?.customServices, detailViewBundle?.custom_services));
      setBoxes(bundleBoxes);
      setSubShipments(bundleSubShipments);
      setSubShipmentAvailability(sortAvailabilityRowsForDisplay(extractList(detailViewBundle, ["subShipmentAvailability", "sub_shipment_availability"])));
      setSubShipmentBoxData(nextSubShipmentBoxData);
      setFiles(bundleFiles);
      setFileEntityId(shipmentRecordId || shipmentId);
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

  useEffect(() => {
    loadShipments();
  }, []);

  useEffect(() => {
    if (selectedShipmentId) {
      loadShipmentDetail(selectedShipmentId);
    } else {
      setSelectedShipment(null);
      setServices([]);
      setDiscrepancies([]);
      setBoxes([]);
      setFiles([]);
      setSubShipments([]);
      setSubShipmentAvailability([]);
      setSubShipmentBoxData({});
      setActiveSubShipmentIdForBox("");
    }
  }, [selectedShipmentId]);

  const filteredShipments = useMemo(() => {
    const query = searchTerm.trim().toLowerCase();
    if (!query) return shipments;

    return shipments.filter(
      (shipment) =>
        shipment.reference.toLowerCase().includes(query) ||
        shipment.client.toLowerCase().includes(query) ||
        shipment.status.toLowerCase().includes(query)
    );
  }, [searchTerm, shipments]);

  const openShipmentDetail = (shipmentId) => {
    setSelectedShipmentId(shipmentId);
  };

  const loadShipmentViewDetail = async (shipment) => {
    const lookupCandidates = getShipmentLookupCandidates(shipment, shipment);
    if (!lookupCandidates.length) return;

    try {
      setIsViewShipmentLoading(true);
      setViewShipmentError("");

      let quickViewBundle = null;
      let lastQuickViewError = null;

      for (const lookupId of lookupCandidates) {
        try {
          const response = await fetch(`${API_BASE_URL}/api/shipments/${encodeURIComponent(lookupId)}/quick-view`, {
            method: "GET",
            headers: buildHeaders(),
            cache: "no-store",
          });
          const payload = await parseResponse(response);
          quickViewBundle = payload?.data || payload;
          break;
        } catch (requestError) {
          lastQuickViewError = requestError;
        }
      }

      if (!quickViewBundle) {
        throw lastQuickViewError || new Error("Could not load shipment quick view. Please refresh or try again.");
      }

      const bundleShipment = quickViewBundle?.shipment || {};
      const bundleLineItems = extractList(quickViewBundle, ["lineItems", "line_items", "items"]);
      const bundleBoxes = mergeBoxLists(
        extractList(quickViewBundle, ["allBoxes", "all_boxes"]),
        extractList(quickViewBundle, ["boxes"]),
        extractList(quickViewBundle, ["pallets"])
      );
      const bundleSubShipments = mergeSubShipmentLists(
        extractList(quickViewBundle, ["subShipments", "sub_shipments"]),
        extractSubShipments(bundleShipment)
      );
      const shipmentData = {
        ...shipment,
        ...bundleShipment,
        items: bundleLineItems,
        lineItems: bundleLineItems,
        shipment_line_items: bundleLineItems,
        boxes: bundleBoxes,
        outbound_boxes: bundleBoxes,
        subShipments: bundleSubShipments,
        sub_shipments: bundleSubShipments,
        counts: quickViewBundle?.counts || bundleShipment?.counts,
        permissions: quickViewBundle?.permissions || bundleShipment?.permissions,
        dispatchSummary: quickViewBundle?.dispatchSummary || quickViewBundle?.dispatch_summary || bundleShipment?.dispatchSummary || bundleShipment?.dispatch_summary,
        dispatch_summary: quickViewBundle?.dispatch_summary || quickViewBundle?.dispatchSummary || bundleShipment?.dispatch_summary || bundleShipment?.dispatchSummary,
        labelSummary: quickViewBundle?.labelSummary || quickViewBundle?.label_summary || bundleShipment?.labelSummary || bundleShipment?.label_summary,
        label_summary: quickViewBundle?.label_summary || quickViewBundle?.labelSummary || bundleShipment?.label_summary || bundleShipment?.labelSummary,
        filesByEntity: quickViewBundle?.filesByEntity || quickViewBundle?.files_by_entity || bundleShipment?.filesByEntity || bundleShipment?.files_by_entity,
        files_by_entity: quickViewBundle?.files_by_entity || quickViewBundle?.filesByEntity || bundleShipment?.files_by_entity || bundleShipment?.filesByEntity,
      };
      const viewLineItems = sortLineItemsForDisplay(applyBundleMetadataFromNotes(getLineItems(shipmentData), shipmentData));
      const viewBoxes = mergeBoxLists(
        bundleBoxes,
        bundleSubShipments.flatMap((subShipment) =>
          mergeBoxLists(
            getSubShipmentBoxes(subShipment),
            extractList(subShipment, ["boxes"]),
            extractList(subShipment, ["pallets"]),
            extractList(subShipment, ["allBoxes", "all_boxes"])
          ).map((box) => decorateSubShipmentBoxForScope(box, subShipment))
        )
      );
      const viewFiles = mergeFileLists(
        extractFileRecords(quickViewBundle?.files),
        viewLineItems.flatMap((item) => getItemInlineLabelFiles(item)),
        viewBoxes.flatMap((box) =>
          mergeFileLists(
            extractFileRecords(box?.fbaLabelFile),
            extractFileRecords(box?.fba_label_file),
            getPalletChildBoxes(box).flatMap((childBox) =>
              mergeFileLists(extractFileRecords(childBox?.fbaLabelFile), extractFileRecords(childBox?.fba_label_file))
            )
          )
        )
      );

      setViewShipmentDetail({
        ...shipmentData,
        items: viewLineItems,
        lineItems: viewLineItems,
        shipment_line_items: viewLineItems,
        boxes: viewBoxes,
        outbound_boxes: viewBoxes,
      });
      setViewShipmentServices(mergeServiceTasks(quickViewBundle?.serviceTasks, quickViewBundle?.service_tasks, quickViewBundle?.customServices, quickViewBundle?.custom_services));
      setViewShipmentBoxes(viewBoxes);
      setViewShipmentFiles(viewFiles);
    } catch (requestError) {
      setViewShipmentError(requestError.message || "Failed to load shipment view details.");
    } finally {
      setIsViewShipmentLoading(false);
    }
  };

  const openShipmentView = (shipment) => {
    setViewShipment(shipment);
    setViewShipmentDetail(shipment);
    setViewShipmentBoxes([]);
    setViewShipmentServices([]);
    setViewShipmentFiles([]);
    setViewShipmentError("");
    loadShipmentViewDetail(shipment);
  };

  const closeShipmentView = () => {
    setViewShipment(null);
    setViewShipmentDetail(null);
    setViewShipmentBoxes([]);
    setViewShipmentServices([]);
    setViewShipmentFiles([]);
    setViewShipmentError("");
    setIsViewShipmentLoading(false);
  };

  const closeShipmentDetail = () => {
    setSelectedShipmentId(null);
    setMessage("");
    setError("");
    setShowSubShipmentModal(false);
    setActiveSubShipmentIdForBox("");
    setSubShipmentSelections({});
    setSubShipmentNotes("");
  };

  const resetSubShipmentCreateForm = () => {
    setSubShipmentSelections({});
    setSubShipmentNotes("");
  };

  const refreshSubShipmentAvailability = async () => {
    const lookupCandidates = getShipmentLookupCandidates(selectedShipment, {
      id: selectedShipmentId,
      reference: selectedShipment?.reference,
    });
    let lastError = null;

    for (const lookupId of lookupCandidates) {
      try {
        const response = await fetch(`${API_BASE_URL}/api/shipments/${encodeURIComponent(lookupId)}/sub-shipments`, {
          method: "GET",
          headers: buildHeaders(),
          cache: "no-store",
        });
        const payload = await parseResponse(response);
        const nextSubShipments = mergeSubShipmentLists(extractSubShipments(payload), extractSubShipments(selectedShipment));
        const nextAvailability = sortAvailabilityRowsForDisplay(extractSubShipmentAvailability(payload));

        setSubShipments(nextSubShipments);
        setSubShipmentAvailability(nextAvailability);
        return nextAvailability;
      } catch (requestError) {
        lastError = requestError;
      }
    }

    throw lastError || new Error("Failed to load sub-shipment availability.");
  };

  const handleOpenSubShipmentModal = async () => {
    if (isRefreshingSubShipmentAvailability || updatingTaskId) return;

    try {
      setError("");
      resetSubShipmentCreateForm();
      setIsRefreshingSubShipmentAvailability(true);
      await refreshSubShipmentAvailability();
      setShowSubShipmentModal(true);
    } catch (requestError) {
      setError(requestError.message || "Failed to refresh sub-shipment availability.");
    } finally {
      setIsRefreshingSubShipmentAvailability(false);
    }
  };

  const handleSubShipmentSelectionChange = (availabilityItem, field, value) => {
    const availabilityId = getAvailabilityItemId(availabilityItem);
    if (!availabilityId) return;
    const maxQuantity = getSubShipmentAvailabilityAvailableQty(availabilityItem);

    setSubShipmentSelections((currentSelections) => {
      const currentSelection = currentSelections[availabilityId] || { selected: false, quantity: "" };
      if (field === "selected") {
        const selected = Boolean(value);
        return {
          ...currentSelections,
          [availabilityId]: {
            ...currentSelection,
            selected,
            quantity: selected ? currentSelection.quantity || String(maxQuantity) : "",
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
    if (isCreatingSubShipment || !selectedShipmentId) return;

    try {
      setIsCreatingSubShipment(true);
      setError("");
      setMessage("");
      const shipmentLookupId = getShipmentRecordId(selectedShipment) || selectedShipmentId;
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
        throw new Error("Select at least one prepared item and quantity.");
      }

      const response = await fetch(`${API_BASE_URL}/api/shipments/${encodeURIComponent(shipmentLookupId)}/sub-shipments`, {
        method: "POST",
        headers: buildHeaders(true),
        body: JSON.stringify({
          notes: String(subShipmentNotes || "").trim() || undefined,
          items: selectedItems,
        }),
      });
      await parseResponse(response);
      setMessage("Sub-shipment created successfully.");
      setShowSubShipmentModal(false);
      resetSubShipmentCreateForm();
      await loadShipmentDetail(selectedShipmentId, { showLoader: false });
    } catch (requestError) {
      setError(requestError.status === 422 ? requestError.message : requestError.message || "Failed to create sub-shipment.");
    } finally {
      setIsCreatingSubShipment(false);
    }
  };

  const handleOpenSubShipmentBoxModal = (subShipmentId = "", preferredBoxType = "box") => {
    const subShipment = subShipments.find((currentSubShipment) => getSubShipmentId(currentSubShipment) === subShipmentId);
    const boxData = subShipmentId ? subShipmentBoxData[subShipmentId] || {} : {};

    if (!subShipmentId || !subShipment || getSubShipmentStatus(subShipment) === "cancelled") return;

    const normalizedBoxType = preferredBoxType === "pallet" ? "pallet" : "box";
    const subShipmentBoxes = getSubShipmentBoxRows(subShipment, boxData);
    const hasBoxableQuantity = getSubShipmentBoxableQuantity(subShipment, boxData) > 0;
    const hasEligiblePalletBoxes = getEligiblePalletBoxesFromRows(subShipmentBoxes).length > 0;

    if (normalizedBoxType === "box" && !hasBoxableQuantity) {
      showToast("error", "All SKU quantities in this sub-shipment are already boxed.");
      return;
    }

    if (normalizedBoxType === "pallet" && !hasEligiblePalletBoxes) {
      showToast("error", "No labeled loose boxes are available for this sub-shipment pallet.");
      return;
    }

    setActiveSubShipmentIdForBox(subShipmentId);
    setBoxType(normalizedBoxType);
    resetAddBoxSkuSelection();
    setSelectedPalletBoxIds([]);
    setPalletNumber("");
    setShowAddBoxModal(true);
  };

  const handleRefreshSubShipmentBoxes = async (subShipmentId = "") => {
    const subShipment = subShipments.find((currentSubShipment) => getSubShipmentId(currentSubShipment) === subShipmentId);
    if (!subShipmentId || !subShipment) return;

    try {
      setError("");
      const response = await fetch(`${API_BASE_URL}/api/sub-shipments/${encodeURIComponent(subShipmentId)}/boxes`, {
        method: "GET",
        headers: buildHeaders(),
        cache: "no-store",
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
          allocationSummary: extractList(payload, ["allocationSummary", "allocation_summary"]),
        },
      }));
    } catch (requestError) {
      setError(requestError.message || "Failed to load sub-shipment boxes.");
    }
  };

  const upsertCreatedBoxIntoLocalState = async (createdBox = null, targetSubShipmentId = "") => {
    if (!createdBox || typeof createdBox !== "object") return false;

    const boxKey = String(getBoxRecordId(createdBox) || getBoxId(createdBox) || createdBox?.boxNumber || createdBox?.box_number || "").trim();
    if (!boxKey) return false;

    const resolvedSubShipmentId = String(targetSubShipmentId || getBoxSubShipmentId(createdBox) || "").trim();
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
    setSelectedShipment((currentShipment) => {
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
    if (!workflowPatch || typeof workflowPatch !== "object") return false;

    const scope = String(workflowPatch.scope || workflowPatch.workflowScope || workflowPatch.workflow_scope || "").trim();

    if (scope === "shipmentBoxes") {
      const shipmentBoxesPatch = workflowPatch.shipmentBoxes || workflowPatch.shipment_boxes || {};
      const patchBoxes = extractBoxes(shipmentBoxesPatch);
      const createdBoxRows = createdBox && typeof createdBox === "object" ? [createdBox] : [];
      const nextBoxes = await enrichBoxesWithItemsIfMissing(mergeBoxLists(patchBoxes, createdBoxRows, boxes), lineItems);
      const availabilityRows = extractSubShipmentAvailability(shipmentBoxesPatch);

      if (!nextBoxes.length) return false;

      setBoxes(nextBoxes);
      setSelectedShipment((currentShipment) =>
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

    if (scope === "subShipmentBoxes") {
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
          ""
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
      const createdBoxRows = createdBox && typeof createdBox === "object" ? [createdBox] : [];
      const nextBoxes = await enrichBoxesWithItemsIfMissing(
        mergeBoxLists(
          extractBoxes(subShipmentBoxesPatch).map((box) => decorateSubShipmentBoxForScope(box, patchSubShipmentSource)),
          createdBoxRows.map((box) => decorateSubShipmentBoxForScope(box, patchSubShipmentSource)),
          existingBoxes
        ),
        lineItems
      );
      const allocationSummary = extractList(subShipmentBoxesPatch, ["allocationSummary", "allocation_summary"]);

      setSubShipmentBoxData((currentData) => ({
        ...currentData,
        [patchSubShipmentId]: {
          boxes: nextBoxes,
          allocationSummary,
        },
      }));

      if (patchSubShipment && typeof patchSubShipment === "object") {
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
    if (!selectedShipmentId) return;

    setError("");
    setMessage("");

    if (["completed", "complete"].includes(normalizeCompletionStatus(nextStatus))) {
      const completionBlockers = getShipmentCompletionBlockers(lineItems, boxes);
      if (completionBlockers.length) {
        setError(formatShipmentCompletionBlockerMessage(completionBlockers));
        return;
      }
    }

    try {
      const response = await fetch(`${API_BASE_URL}/api/shipments/${selectedShipmentId}/status`, {
        method: "PATCH",
        headers: buildHeaders(true),
        body: JSON.stringify({ status: nextStatus }),
      });
      await parseResponse(response);
      setStatusValue(nextStatus);
      setMessage("Shipment status updated.");
      await loadShipmentDetail(selectedShipmentId, { showLoader: false });
    } catch (requestError) {
      setError(requestError.message);
    }
  };

  const handleBulkServiceUpdate = async () => {
    if (!selectedShipmentId) return;

    try {
      setError("");
      setMessage("");
      const response = await fetch(
        `${API_BASE_URL}/api/shipments/${selectedShipmentId}/services/bulk`,
        {
          method: "POST",
          headers: buildHeaders(true),
          body: JSON.stringify({
            serviceType: normalizeServiceCode(bulkServiceType),
            status: bulkStatus,
          }),
        }
      );
      await parseResponse(response);
      setMessage("Bulk service status updated.");
      await loadShipmentDetail(selectedShipmentId, { showLoader: false });
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

    setDiscrepancyResolveError("");
    setDiscrepancyResolveTarget({
      discrepancy,
      lineItem: fallbackLineItem,
      lineItemId,
      sku: firstPresent(getItemSku(fallbackLineItem), getDiscrepancySku(discrepancy), lineItemId),
      productName: firstPresent(getItemName(fallbackLineItem), getItemName(discrepancyLineItem)),
      expectedQty: getDiscrepancyExpectedQty(discrepancy, fallbackLineItem),
      receivedQty: getDiscrepancyReceivedQty(discrepancy, fallbackLineItem),
      differenceQty: getDiscrepancyDifferenceQty(discrepancy, fallbackLineItem),
    });
  };

  const handleCloseDiscrepancyResolve = () => {
    if (isResolvingDiscrepancy) return;
    setDiscrepancyResolveTarget(null);
    setDiscrepancyResolveError("");
  };

  const handleResolveDiscrepancySubmit = async (payload) => {
    try {
      const target = discrepancyResolveTarget;

      setError("");
      setMessage("");
      setDiscrepancyResolveError("");
      setIsResolvingDiscrepancy(true);

      if (!target?.lineItemId) {
        throw new Error("Line item ID is required to update received quantity.");
      }

      const responsePayload = await resolveDiscrepancyRequest(target.lineItemId, payload);
      const responseData = getDiscrepancyResolveData(responsePayload) || {};

      if (responseData?.shipment && typeof responseData.shipment === "object") {
        setSelectedShipment(normalizeMappedShipment(responseData.shipment));
      }

      setDiscrepancies((currentRows) => updateDiscrepancyRowsAfterResolve(currentRows, target, responseData));
      setMessage(responseData?.resolved === true ? "Discrepancy resolved." : "Received quantity updated. Discrepancy remains active.");
      setDiscrepancyResolveTarget(null);
      await loadShipmentDetail(selectedShipmentId, { showLoader: false });
    } catch (requestError) {
      setDiscrepancyResolveError(requestError.message);
      setError(requestError.message);
    } finally {
      setIsResolvingDiscrepancy(false);
    }
  };

  const getServiceTasksWithPatch = (taskIdToPatch = "", patchPayload = {}, taskList = serviceTasks) =>
    taskList.map((service) => {
      if (String(getServiceTaskId(service) || "") !== String(taskIdToPatch || "")) {
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
      (serviceName) => getServiceDisplayStatus(serviceName, item, nextServiceTasks, itemCount) === "Done"
    );
  };

  const getHiddenAutoBundlingTasksForItem = (item = {}, nextServiceTasks = [], itemList = lineItems) =>
    nextServiceTasks.filter((service) =>
      Boolean(
        getServiceTaskId(service) &&
          isServiceTaskForItem(service, item, itemList.length) &&
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
        const serviceId = String(getServiceTaskId(row.service) || "");
        return serviceId && rows.findIndex((currentRow) => String(getServiceTaskId(currentRow.service) || "") === serviceId) === index;
      });

    if (!syncRows.length) return 0;

    await Promise.all(
      syncRows.map(({ service, item }) => {
        const serviceId = getServiceTaskId(service);
        const unitsDone = getServiceUnits(service, item);
        const hiddenPayload = { status: "DONE" };

        if (Number.isFinite(unitsDone)) {
          hiddenPayload.unitsDone = unitsDone;
          hiddenPayload.units_done = unitsDone;
        }

        return fetch(`${API_BASE_URL}/api/services/${encodeURIComponent(serviceId)}`, {
          method: "PATCH",
          headers: buildHeaders(true),
          body: JSON.stringify(hiddenPayload),
        }).then((response) => parseResponse(response));
      })
    );

    return syncRows.length;
  };

  const isDoneServiceStatus = (status = "") =>
    ["DONE", "COMPLETED", "COMPLETE"].includes(String(status || "").toUpperCase());

  const syncHiddenAutoBundlingTasks = async (updatedTaskId = "", patchPayload = {}) => {
    if (!isDoneServiceStatus(patchPayload.status)) return 0;

    const nextServiceTasks = getServiceTasksWithPatch(updatedTaskId, patchPayload);
    const updatedTask = nextServiceTasks.find(
      (service) => String(getServiceTaskId(service) || "") === String(updatedTaskId || "")
    );
    const candidateItems = updatedTask
      ? lineItems.filter((item) => isServiceTaskForItem(updatedTask, item, lineItems.length))
      : [];

    return syncHiddenAutoBundlingTasksForItems(candidateItems, nextServiceTasks);
  };

  const shouldRefreshAvailabilityForTaskPatch = (updatedTaskId = "", patchPayload = {}) => {
    const previousTask = serviceTasks.find(
      (service) => String(getServiceTaskId(service) || "") === String(updatedTaskId || "")
    );
    const nextServiceTasks = getServiceTasksWithPatch(updatedTaskId, patchPayload);
    const updatedTask = nextServiceTasks.find(
      (service) => String(getServiceTaskId(service) || "") === String(updatedTaskId || "")
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
      .filter((item) => isServiceTaskForItem(updatedTask, item, lineItems.length))
      .some((item) => {
        const wasReady = areDisplayedServicesDoneForItem(item, serviceTasks, lineItems);
        const isReady = areDisplayedServicesDoneForItem(item, nextServiceTasks, lineItems);
        return wasReady !== isReady || isReady;
      });
  };

  const handleUpdateTask = async (taskOverride = {}) => {
    let previousServices = null;

    try {
      setError("");
      setMessage("");
      const resolvedTaskId = taskOverride.taskId || taskId;
      if (!resolvedTaskId) {
        throw new Error("Service task ID required.");
      }
      setUpdatingTaskId(resolvedTaskId);

      const payload = { status: taskOverride.status || taskStatus };
      const unitsDone = taskOverride.unitsDone ?? taskUnitsDone;
      const notes = taskOverride.notes ?? taskNotes;
      if (unitsDone !== "" && unitsDone !== undefined) {
        const normalizedUnitsDone = Number(unitsDone);
        payload.unitsDone = normalizedUnitsDone;
        payload.units_done = normalizedUnitsDone;
      }
      if (String(notes || "").trim()) payload.notes = String(notes).trim();
      const doneUnitsValue = Number(firstPresent(payload.unitsDone, payload.units_done, ""));
      if (isDoneServiceStatus(payload.status) && (!Number.isFinite(doneUnitsValue) || doneUnitsValue <= 0)) {
        const message = "Receive this item before marking services done.";
        setError(message);
        showToast("error", message);
        return;
      }
      const shouldRefreshAvailability = shouldRefreshAvailabilityForTaskPatch(resolvedTaskId, payload);
      setServices((currentServices) => {
        previousServices = currentServices;

        return toArray(currentServices).map((service) => {
          if (String(getServiceTaskId(service) || "") !== String(resolvedTaskId)) {
            return service;
          }

          return mergeServiceTaskUpdate(service, payload);
        });
      });
      const response = await fetch(`${API_BASE_URL}/api/services/${encodeURIComponent(resolvedTaskId)}`, {
        method: "PATCH",
        headers: buildHeaders(true),
        body: JSON.stringify(payload),
      });
      const responsePayload = await parseResponse(response);
      const responseTask = getUpdatedServiceTaskFromPayload(responsePayload, resolvedTaskId);
      if (responseTask) {
        setServices((currentServices) =>
          toArray(currentServices).map((service) => {
            if (String(getServiceTaskId(service) || "") !== String(resolvedTaskId)) {
              return service;
            }

            return mergeServiceTaskUpdate(service, payload, responseTask);
          })
        );
      }
      const syncedHiddenAutoTasks = await syncHiddenAutoBundlingTasks(resolvedTaskId, payload);
      setMessage("Service task updated.");
      if (shouldRefreshAvailability || syncedHiddenAutoTasks > 0) {
        await refreshSubShipmentAvailability();
      }
    } catch (requestError) {
      if (previousServices) {
        setServices(previousServices);
      }
      setError(requestError.message);
    } finally {
      setUpdatingTaskId("");
    }
  };

  const handleUpdateCustomServiceStatus = async () => {
    try {
      setError("");
      setMessage("");
      const response = await fetch(`${API_BASE_URL}/api/shipments/${selectedShipmentId}/line-items/${customServiceLineItemId}/custom-service`, {
        method: "PATCH",
        headers: buildHeaders(true),
        body: JSON.stringify({ name: customServiceName, status: customServiceStatusValue }),
      });
      await parseResponse(response);
      setMessage("Custom service status updated.");
      await loadShipmentDetail(selectedShipmentId, { showLoader: false });
    } catch (requestError) {
      setError(requestError.message);
    }
  };

  const handleAddCustomService = async () => {
    try {
      setError("");
      setMessage("");
      const response = await fetch(
        `${API_BASE_URL}/api/shipments/${selectedShipmentId}/line-items/${customServiceLineItemId}/custom-service`,
        {
          method: "POST",
          headers: buildHeaders(true),
          body: JSON.stringify({
            name: customServiceName,
            price: Number(customServicePrice || 0),
          }),
        }
      );
      await parseResponse(response);
      setMessage("Custom service added.");
      setCustomServiceName("");
      setCustomServicePrice("");
      await loadShipmentDetail(selectedShipmentId, { showLoader: false });
    } catch (requestError) {
      setError(requestError.message);
    }
  };

  const handleCreateBox = async (isPallet = false) => {
    if (isCreatingBox) return false;

    const showBoxError = (errorMessage) => {
      setError("");
      showToast("error", errorMessage);
      return false;
    };

    try {
      setIsCreatingBox(true);
      setError("");
      setMessage("");
      const endpoint = isPallet ? "pallets" : "boxes";
      const shipmentLookupId = getShipmentRecordId(selectedShipment) || selectedShipmentId;
      const subShipmentIdForBox = activeSubShipmentIdForBox;

      if (isPallet) {
        const palletBoxIds = [...new Set(selectedPalletBoxIds.map((boxId) => String(boxId || "").trim()).filter(Boolean))];
        const validPalletBoxIds = palletBoxIds.filter((boxId) =>
          eligiblePalletBoxes.some((box) => (getBoxRecordId(box) || getBoxId(box)) === boxId)
        );
        const selectedBoxesForPallet = eligiblePalletBoxes.filter((box) =>
          validPalletBoxIds.includes(getBoxRecordId(box) || getBoxId(box))
        );

        if (!validPalletBoxIds.length) {
          return showBoxError("Select at least one labeled loose box to place inside this pallet.");
        }

        if (!subShipmentIdForBox) {
          const hasSubShipmentBox = selectedBoxesForPallet.some((box) => {
            const boxKeys = getBoxScopeKeys(box);
            return !isParentShipmentBox(box) || boxKeys.some((boxKey) => subShipmentScopedBoxKeys.has(boxKey));
          });

          if (hasSubShipmentBox) {
            return showBoxError("Use the sub-shipment Add Pallet button to palletize sub-shipment boxes.");
          }
        }

        const palletPayload = {
          boxIds: validPalletBoxIds,
          dimensions: {
            l: Number(boxLength || 0),
            w: Number(boxWidth || 0),
            h: Number(boxHeight || 0),
          },
          weight: Number(boxWeight || 0),
          ...(String(palletNumber || "").trim() ? { palletNumber: String(palletNumber || "").trim() } : {}),
          ...(subShipmentIdForBox ? { subShipmentId: subShipmentIdForBox } : {}),
        };
        const createUrl = subShipmentIdForBox
          ? `${API_BASE_URL}/api/sub-shipments/${encodeURIComponent(subShipmentIdForBox)}/pallets`
          : `${API_BASE_URL}/api/shipments/${encodeURIComponent(shipmentLookupId)}/pallets`;
        const response = await fetch(createUrl, {
          method: "POST",
          headers: buildHeaders(true),
          body: JSON.stringify(palletPayload),
        });
        const palletPayloadResponse = await parseResponse(response);
        const createdPallet = getCreatedBoxFromPayload(palletPayloadResponse);

        setMessage("Pallet created.");
        const localPalletApplied = await upsertCreatedBoxIntoLocalState(createdPallet, subShipmentIdForBox);
        if (!localPalletApplied) {
          await loadShipmentDetail(selectedShipmentId, { showLoader: false });
        }
        if (subShipmentIdForBox && !localPalletApplied) {
          await handleRefreshSubShipmentBoxes(subShipmentIdForBox);
        }
        setSelectedPalletBoxIds([]);
        setPalletNumber("");
        resetAddBoxSkuSelection();
        setActiveSubShipmentIdForBox("");
        return true;
      }

      const payload = isPallet && !subShipmentIdForBox
        ? {}
        : {
            boxType: isPallet ? "pallet" : boxType,
            boxSize,
            weight: Number(boxWeight || 0),
            dimensions: { l: Number(boxLength || 0), w: Number(boxWidth || 0), h: Number(boxHeight || 0) },
          };
      const allocationDrafts = [
        { lineItemValue: boxSkuPreview, quantity: boxSkuQuantityPreview, rowNumber: 1 },
        ...boxSkuExtraRows.map((row, index) => ({ ...row, rowNumber: index + 2 })),
      ].filter((row) => String(row.lineItemValue || row.quantity || "").trim());
      const allocations = [];
      const seenAllocationKeys = new Set();

      if (!isPallet && boxSelectionLineItems.length) {
        if (!allocationDrafts.length) {
          return showBoxError("Please select a SKU before creating the box so units are allocated.");
        }

        for (const draft of allocationDrafts) {
          const lineItemValue = String(draft.lineItemValue || "").trim();
          const lineItem = findLineItemBySelection(lineItemValue);
          const requestedQuantity = Number(draft.quantity || 0);
          const rowLabel = draft.rowNumber === 1 ? "selected SKU" : `SKU row ${draft.rowNumber}`;

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
            return showBoxError("This SKU is already selected. Please remove duplicate SKU rows.");
          }

          const maxQuantity = getLineItemAllocatableQuantity(lineItem, boxSelectionBoxes, boxSelectionLineItems);
          if (maxQuantity <= 0) {
            return showBoxError(`${getItemSku(lineItem) || "Selected SKU"} has no received units available to box.`);
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
      let allocationWarning = "";
      const allocationPayloadItems = allocations
        .map((allocation) => {
          const shipmentItemId = String(
            getBoxAllocationLineItemId(allocation.lineItem) || getShipmentLineItemId(allocation.lineItem) || ""
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
        return showBoxError("Selected SKU is missing a valid shipment line item id.");
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
          method: "POST",
          headers: buildHeaders(true),
          body: JSON.stringify(requestPayload),
        });

        return {
          payload: await parseResponse(createResponse),
          request: requestPayload,
        };
      };

      const createResult = await createBoxRequest(createBoxPayload);
      const boxPayload = createResult.payload;
      const workflowPatch = getBoxWorkflowPatch(boxPayload);
      const newBox = getCreatedBoxFromPayload(boxPayload);
      const newBoxId = getBoxRecordId(newBox) || newBox?.id;
      const allocationIncludedInCreate = !isPallet && allocationPayloadItems.length > 0;

      if (allocationIncludedInCreate && newBoxId) {
        saveCachedBoxAllocationItems(
          { ...newBox, id: newBoxId || getBoxId(newBox) },
          allocationPayloadItems,
          [newBoxId, getBoxId(newBox), getBoxRecordId(newBox)]
        );
      }

      if (!isPallet && !newBoxId && allocations.length) {
        allocationWarning = " SKU allocation skipped: new box id was not returned.";
      }

      setMessage(`${isPallet ? "Pallet created." : "Box created."}${allocationWarning}`);

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
        await loadShipmentDetail(selectedShipmentId, { showLoader: false });
        if (subShipmentIdForBox) {
          await handleRefreshSubShipmentBoxes(subShipmentIdForBox);
        }
      }
      resetAddBoxSkuSelection();
      setPalletNumber("");
      setActiveSubShipmentIdForBox("");
      return true;
    } catch (requestError) {
      const errorMessage = requestError.message || `Failed to create ${isPallet ? "pallet" : "box"}.`;
      const friendlyMessage =
        isPallet && /pallet number already exists/i.test(errorMessage)
          ? "This pallet number already exists in this shipment/sub-shipment."
          : errorMessage;
      setError(friendlyMessage);
      showToast("error", friendlyMessage);
      return false;
    } finally {
      setIsCreatingBox(false);
    }
  };

  const handleAddItemToBox = async () => {
    try {
      setError("");
      setMessage("");
      const selectedLineItemId = String(addToBoxLineItemId || "").trim();

      if (!isUuidValue(selectedLineItemId)) {
        setError("Please enter a valid shipment item UUID.");
        return;
      }

      const response = await fetch(`${API_BASE_URL}/api/boxes/${addToBoxBoxId}/items`, {
        method: "POST",
        headers: buildHeaders(true),
        body: JSON.stringify({ shipmentItemId: selectedLineItemId, quantity: Number(addToBoxQuantity || 0) }),
      });
      await parseResponse(response);
      setMessage("Item added to box.");
      await loadShipmentDetail(selectedShipmentId, { showLoader: false });
    } catch (requestError) {
      setError(requestError.message);
    }
  };

  const handleRemoveItemFromBox = async () => {
    try {
      setError("");
      setMessage("");
      const response = await fetch(`${API_BASE_URL}/api/boxes/${removeFromBoxBoxId}/items/${removeFromBoxItemId}`, {
        method: "DELETE",
        headers: buildHeaders(),
      });
      await parseResponse(response);
      setMessage("Item removed from box.");
      await loadShipmentDetail(selectedShipmentId, { showLoader: false });
    } catch (requestError) {
      setError(requestError.message);
    }
  };

  const handleSealBox = async () => {
    try {
      setError("");
      setMessage("");
      const response = await fetch(`${API_BASE_URL}/api/boxes/${sealBoxId}/seal`, {
        method: "PATCH",
        headers: buildHeaders(true),
        body: JSON.stringify({ trackingCode: sealTrackingCode || undefined }),
      });
      await parseResponse(response);
      setMessage("Box sealed.");
      await loadShipmentDetail(selectedShipmentId, { showLoader: false });
    } catch (requestError) {
      setError(requestError.message);
    }
  };

  const runMarkBoxDispatched = async (boxId, isPallet) => {
    try {
      setError("");
      setMessage("");
      const response = await fetch(`${API_BASE_URL}/api/boxes/${encodeURIComponent(boxId)}/seal`, {
        method: "PATCH",
        headers: buildHeaders(true),
        body: JSON.stringify({ trackingCode: undefined }),
      });
      await parseResponse(response);
      setMessage(`${isPallet ? "Pallet" : "Box"} marked dispatched.`);
      await loadShipmentDetail(selectedShipmentId, { showLoader: false });
    } catch (requestError) {
      setError(requestError.message);
    }
  };

  const handleMarkBoxDispatched = async (boxOrId) => {
    const box = typeof boxOrId === "object"
      ? boxOrId
      : boxes.find((currentBox) => getBoxId(currentBox) === boxOrId || getBoxRecordId(currentBox) === boxOrId) || { id: boxOrId };
    const boxId = getBoxRecordId(box);
    const isPallet = isPalletBox(box);

    if (!boxId) return;

    if (isBoxInsidePallet(box)) {
      setError("Boxes inside a pallet must be dispatched by dispatching the pallet.");
      return;
    }

    if (!isPallet && !isBoxFbaLabelUploaded(box, files)) {
      setError("Please upload the FBA label before marking this box dispatched.");
      return;
    }

    if (isPallet && !isBoxFbaLabelUploaded(box, files)) {
      setDispatchConfirm({
        title: "Dispatch pallet without FBA label?",
        message: "This pallet does not have an FBA label. Are you sure you want to dispatch this pallet without a pallet FBA label?",
        confirmLabel: "Dispatch Pallet",
        action: () => runMarkBoxDispatched(boxId, isPallet),
      });
      return;
    }

    await runMarkBoxDispatched(boxId, isPallet);
  };

  const handleConfirmDispatchWarning = async () => {
    const action = dispatchConfirm?.action;
    setDispatchConfirm(null);
    if (typeof action === "function") {
      await action();
    }
  };

  const prepareBoxPhotoUpload = (boxId, file) => {
    if (!file) return;
    setFileEntityType("box");
    setFileEntityId(boxId);
    setFileType("box_photo");
    setSelectedFile(file);
  };

  const handleBoxFbaLabel = async (box, index) => {
    setError("");
    setMessage("");

    const labelFile = getBoxFbaLabelFile(box, files);
    if (labelFile && (await openOrDownloadFile(labelFile))) {
      setMessage(`FBA label opened for ${getBoxTitle(box, index)}.`);
      return;
    }

    setError("FBA label file is missing for this box.");
  };

  const handleUploadBoxFbaLabel = async (box, index, file) => {
    if (!file) return;

    const boxId = getBoxRecordId(box);
    if (!boxId) {
      setError("Box record UUID required before uploading an FBA label.");
      return;
    }

    const uploadKey = `fba-${boxId || index}`;

    try {
      setError("");
      setMessage("");
      setUploadingBoxLabelId(uploadKey);

      const formData = new FormData();
      formData.append("file", file, file.name);
      formData.append("entityType", isPalletBox(box) ? "pallet" : "box");
      formData.append("entityId", boxId);
      formData.append("fileType", "fba_shipping_label");

      const response = await fetch(`${API_BASE_URL}/api/files`, {
        method: "POST",
        headers: buildHeaders(),
        body: formData,
      });
      const payload = await parseResponse(response);
      const uploadedFile =
        payload?.file ||
        payload?.data?.file ||
        payload?.data ||
        (payload && typeof payload === "object" ? payload : null) ||
        {};

      setFiles((currentFiles) =>
        mergeFileLists(currentFiles, [
          {
            ...uploadedFile,
            entityType: isPalletBox(box) ? "pallet" : "box",
            entity_type: isPalletBox(box) ? "pallet" : "box",
            entityId: boxId,
            entity_id: boxId,
            boxId,
            box_id: boxId,
            fileType: uploadedFile?.fileType || uploadedFile?.file_type || "fba_shipping_label",
            file_type: uploadedFile?.file_type || uploadedFile?.fileType || "fba_shipping_label",
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
      await loadShipmentDetail(selectedShipmentId, { showLoader: false });
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setUploadingBoxLabelId("");
    }
  };

  const handleDeleteBox = async () => {
    try {
      setError("");
      setMessage("");
      const response = await fetch(`${API_BASE_URL}/api/boxes/${deleteBoxId}`, {
        method: "DELETE",
        headers: buildHeaders(),
      });
      await parseResponse(response);
      setMessage("Box deleted.");
      await loadShipmentDetail(selectedShipmentId, { showLoader: false });
    } catch (requestError) {
      setError(requestError.message);
    }
  };

  const handleUploadFile = async () => {
    if (!selectedFile || !fileEntityId.trim()) {
      setError("File aur entity id required hain.");
      return;
    }
    const normalizedFileType = String(fileType || "").trim().toLowerCase();
    const normalizedEntityType = String(fileEntityType || "").trim().toLowerCase();
    if (normalizedFileType.includes("fnsku") && normalizedEntityType !== "item") {
      setError('FNSKU labels must be uploaded against a shipment line item. Select entity type "item" and use the line item ID.');
      return;
    }
    try {
      setError("");
      setMessage("");
      const formData = new FormData();
      formData.append("file", selectedFile);
      formData.append("entityType", fileEntityType);
      formData.append("entityId", fileEntityId.trim());
      formData.append("fileType", fileType);
      const response = await fetch(`${API_BASE_URL}/api/files`, {
        method: "POST",
        headers: buildHeaders(),
        body: formData,
      });
      await parseResponse(response);
      setMessage("File uploaded.");
      setSelectedFile(null);
      await loadShipmentDetail(selectedShipmentId, { showLoader: false });
    } catch (requestError) {
      setError(requestError.message);
    }
  };

  const resolveLineItemLabelFileForOpen = async (item, index) => {
    const assignedLabel = getItemLabelFileAssignments(lineItems, files)[index];
    let labelFile = assignedLabel || findLineItemLabelFile(item, files, lineItems.length, index);
    const labelFileId = String(getItemLabelFileId(item) || getFileRecordId(labelFile) || "").trim();
    if (labelFile && getFileUrlCandidates(labelFile).length) return labelFile;

    const itemLookupIds = [
      getShipmentLineItemId(item),
      getLineItemId(item),
    ]
      .map((value) => String(value || "").trim())
      .filter(Boolean)
      .filter((value, valueIndex, values) => values.indexOf(value) === valueIndex);

    for (const itemLookupId of itemLookupIds) {
      const entityFiles = await fetchFilesByEntity("item", itemLookupId);
      const matchedFile =
        entityFiles.find((file) => labelFileId && String(getFileRecordId(file) || "").trim() === labelFileId) ||
        entityFiles.find((file) => fileMatchesLineItem(file, item)) ||
        (entityFiles.length === 1 ? entityFiles[0] : null);

      if (matchedFile) {
        const nextLabelFile = buildItemLabelFile(item, matchedFile);
        if (getFileUrlCandidates(nextLabelFile).length) return nextLabelFile;
        labelFile = nextLabelFile;
      }
    }

    if (labelFileId) {
      const freshFiles = await fetchFileById(labelFileId);
      const freshLabel =
        freshFiles.find((file) => String(getFileRecordId(file) || "").trim() === labelFileId) ||
        freshFiles.find((file) => fileMatchesLineItem(file, item)) ||
        (freshFiles.length === 1 ? freshFiles[0] : null);
      if (freshLabel) labelFile = buildItemLabelFile(item, freshLabel);
    }

    if (labelFile && getFileUrlCandidates(labelFile).length) return labelFile;

    return labelFile || null;
  };

  const handleLabelPdf = async (item, index) => {
    setError("");
    setMessage("");

    const uploadedLabel = await resolveLineItemLabelFileForOpen(item, index);
    if (uploadedLabel && (await openOrDownloadFile(uploadedLabel))) {
      setMessage("Uploaded FNSKU label opened.");
      return;
    }

    if (uploadedLabel) {
      setError("Label file found, but file URL was not returned by backend.");
      return;
    }

    setError("No uploaded FNSKU label file returned for this item.");
  };

  const stats = statCards(shipments);
  const lineItems = sortLineItemsForDisplay(applyBundleMetadataFromNotes(getLineItems(selectedShipment), selectedShipment));
  const activeSubShipmentForBox = activeSubShipmentIdForBox
    ? subShipments.find((subShipment) => getSubShipmentId(subShipment) === activeSubShipmentIdForBox) || null
    : null;
  const activeSubShipmentBoxData = activeSubShipmentIdForBox ? subShipmentBoxData[activeSubShipmentIdForBox] || {} : {};
  const getSubShipmentReservedQuantityForLineItem = (lineItem = {}) =>
    subShipments.reduce((total, subShipment) => {
      if (getSubShipmentStatus(subShipment) === "cancelled") return total;

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
      return getVisiblePackageRowsWithPalletChildren(
        getSubShipmentBoxRows(subShipment, boxData).map((box) => decorateSubShipmentBoxForScope(box, subShipment)),
        (childBox) => decorateSubShipmentBoxForScope(childBox, subShipment)
      )
        .flatMap(getBoxScopeKeys);
    })
  );
  const parentShipmentBoxes = shipmentPackageRows.filter((box) => {
    const boxKeys = getBoxScopeKeys(box);
    return isParentShipmentBox(box) && (!boxKeys.length || !boxKeys.some((boxKey) => subShipmentScopedBoxKeys.has(boxKey)));
  });
  const boxSelectionBoxes = activeSubShipmentForBox
    ? getSubShipmentBoxRows(activeSubShipmentForBox, activeSubShipmentBoxData)
    : parentShipmentBoxes;
  const getEligiblePalletBoxesFromRows = (boxRows = []) => boxRows.filter((box) => {
    const boxId = getBoxRecordId(box) || getBoxId(box);
    return (
      boxId &&
      getBoxTypeValue(box) === "box" &&
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
  const togglePalletBoxSelection = (boxId = "") => {
    const normalizedBoxId = String(boxId || "").trim();
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
  const findLineItemBySelection = (selectedValue = "") => {
    const normalizedSelection = String(selectedValue || "").trim();
    if (!normalizedSelection) return null;

    return boxSelectionLineItems.find((item) => {
      const optionValue = getLineItemOptionValue(item);
      const itemId = String(getLineItemId(item) || "").trim();
      const itemSku = String(getItemSku(item) || "").trim();
      return [optionValue, itemId, itemSku].filter(Boolean).includes(normalizedSelection);
    }) || null;
  };
  const selectedBoxLineItem = findLineItemBySelection(boxSkuPreview);
  const selectedBoxBoxableQty = selectedBoxLineItem ? getLineItemBoxableQuantity(selectedBoxLineItem) : 0;
  const selectedBoxAllocatedQty = selectedBoxLineItem
    ? activeSubShipmentForBox
      ? Number(selectedBoxLineItem.__subShipmentAllocatedQty || 0)
      : getAllocatedQuantityForLineItem(selectedBoxLineItem, boxSelectionBoxes, boxSelectionLineItems)
    : 0;
  const selectedBoxMaxQuantity = selectedBoxLineItem ? getLineItemAllocatableQuantity(selectedBoxLineItem, boxSelectionBoxes, boxSelectionLineItems) : 0;
  const boxSkuSelectionRows = [
    { lineItemValue: boxSkuPreview, quantity: boxSkuQuantityPreview },
    ...boxSkuExtraRows,
  ];
  const resetAddBoxSkuSelection = () => {
    setBoxSkuPreview("");
    setBoxSkuQuantityPreview("");
    setBoxSkuExtraRows([]);
  };
  const handleBoxSkuPreviewChange = (value) => {
    const selectedValue = String(value || "").trim();
    const nextLineItem = findLineItemBySelection(selectedValue);
    const nextMaxQuantity = nextLineItem ? getLineItemAllocatableQuantity(nextLineItem, boxSelectionBoxes, boxSelectionLineItems) : 0;

    setBoxSkuPreview(selectedValue);
    setBoxSkuQuantityPreview(nextMaxQuantity > 0 ? String(nextMaxQuantity) : "");
  };
  const handleBoxSkuQuantityPreviewChange = (value) => {
    setBoxSkuQuantityPreview(clampAllocationQuantity(value, selectedBoxMaxQuantity));
  };
  const isBoxSkuOptionSelectedElsewhere = (optionValue = "", rowIndex = 0) => {
    const normalizedOption = String(optionValue || "").trim();
    if (!normalizedOption) return false;

    return boxSkuSelectionRows.some((row, index) =>
      index !== rowIndex && String(row?.lineItemValue || "").trim() === normalizedOption
    );
  };
  const handleAddBoxSkuRow = () => {
    setBoxSkuExtraRows((currentRows) => [...currentRows, { lineItemValue: "", quantity: "" }]);
  };
  const handleRemoveBoxSkuRow = (index) => {
    setBoxSkuExtraRows((currentRows) => currentRows.filter((_, currentIndex) => currentIndex !== index));
  };
  const handleBoxSkuExtraRowChange = (index, field, value) => {
    setBoxSkuExtraRows((currentRows) =>
      currentRows.map((row, currentIndex) => {
        if (currentIndex !== index) return row;

        if (field === "lineItemValue") {
          const selectedValue = String(value || "").trim();
          const nextLineItem = findLineItemBySelection(selectedValue);
          const nextMaxQuantity = nextLineItem ? getLineItemAllocatableQuantity(nextLineItem, boxSelectionBoxes, boxSelectionLineItems) : 0;
          return {
            lineItemValue: selectedValue,
            quantity: nextMaxQuantity > 0 ? String(nextMaxQuantity) : "",
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
  const serviceTasks = mergeServiceTasks(services, selectedShipment).map((service, index) => ({
    ...service,
    displayId: `${getServiceTaskId(service) || service?.lineItemId || service?.shipmentItemId || "task"}-${index}`,
  }));
  const isSelectedServiceTaskForDisplay = (service = {}, items = lineItems) => {
    const serviceKey = normalizeServiceKey(getServiceTaskLabel(service));
    if (!serviceKey) return false;

    const itemList = toArray(items);
    const matchedItems = itemList.filter((item) => isServiceTaskForItem(service, item, itemList.length));
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
  const customServices = extractCustomServices(selectedShipment, serviceTasks);
  const currentStatus = normalizeShipmentStatusValue(selectedShipment?.status);
  const currentStepIndex = statusSteps.indexOf(currentStatus);
  const getSubShipmentAvailabilityPrepared = (availabilityItem) =>
    isAvailabilityPrepared(availabilityItem);
  const getSubShipmentAvailabilityAvailableQty = (availabilityItem) =>
    getAvailabilityAvailableQty(availabilityItem);
  const subShipmentAvailabilityRows = sortAvailabilityRowsForDisplay(subShipmentAvailability);
  const hasPreparedSubShipmentAvailability = subShipmentAvailabilityRows.some((availabilityItem) =>
    Boolean(
      getAvailabilityItemId(availabilityItem) &&
        getSubShipmentAvailabilityPrepared(availabilityItem) &&
        getSubShipmentAvailabilityAvailableQty(availabilityItem) > 0
    )
  );
  const canCreateSubShipment =
    SUB_SHIPMENT_CREATION_STATUSES.has(currentStatus) || hasPreparedSubShipmentAvailability;
  const nextStatusIndex = currentStepIndex >= 0 ? currentStepIndex + 1 : 1;
  const nextStatus = statusSteps[nextStatusIndex] || "";
  const primaryStatusAction = (() => {
    if (currentStatus === "completed" || !nextStatus) {
      return {
        label: "Completed",
        onClick: undefined,
        disabled: true,
        title: "Shipment is completed",
      };
    }

    if (nextStatus === "dispatched") {
      return {
        label: "Mark Dispatch",
        onClick: () => navigate("/dispatch"),
        title: "Open dispatch queue to dispatch boxes",
      };
    }

    return {
      label: `Mark ${formatStatusLabel(nextStatus)}`,
      onClick: () => handleStatusUpdate(nextStatus),
      title: `Mark shipment ${formatStatusLabel(nextStatus).toLowerCase()}`,
    };
  })();
  return (
    <LayoutStaff>
      <FullPageLoader show={isLoading} label="Loading shipments..." />
      <div className=" p-6">
        {!selectedShipment ? (
          <>
            <div className="mb-8">
              <h1 className="mb-1 text-2xl font-bold text-gray-900">All Shipments</h1>
              
            </div>

            {message ? (
              <p className="mb-4 rounded-lg border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-700">
                {message}
              </p>
            ) : null}
            {error ? (
              <p className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                {error}
              </p>
            ) : null}

            <div className="mb-8 grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-4">
              {stats.map((stat) => (
                <div
                  key={stat.label}
                  className="rounded-xl border bg-white p-5 shadow-sm transition-all hover:shadow-md"
                >
                  <div className="mb-3 flex items-start justify-between">
                    <span className="text-xs font-medium uppercase tracking-wider text-gray-500">
                      {stat.label}
                    </span>
                    <div className={`rounded-lg p-2 ${stat.iconBg}`}>
                      <stat.icon className={`h-5 w-5 ${stat.iconColor}`} />
                    </div>
                  </div>
                  <div className="text-2xl font-bold text-gray-900">{stat.value}</div>
                </div>
              ))}
            </div>

            <div className="overflow-hidden rounded-xl border bg-white shadow-sm">
              <div className="flex flex-col items-start justify-between gap-4 border-b px-6 py-4 sm:flex-row sm:items-center">
                <h2 className="text-lg font-semibold text-gray-900">All Shipments</h2>
                <div className="flex w-full items-center gap-3 sm:w-auto">
                  <div className="relative flex-grow sm:flex-grow-0">
                    <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
                    <input
                      type="text"
                      placeholder="Search shipments..."
                      value={searchTerm}
                      onChange={(event) => setSearchTerm(event.target.value)}
                      className="w-full rounded-lg border py-2 pl-10 pr-4 text-sm focus:border-transparent focus:outline-none focus:ring-2 focus:ring-[#ff6900] sm:w-64"
                    />
                  </div>
                  <button
                    type="button"
                    onClick={loadShipments}
                    className="flex items-center gap-2 rounded-lg border bg-gray-50 px-4 py-2 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-100"
                  >
                    <RefreshCw className="h-4 w-4" />
                    Refresh
                  </button>
             
                </div>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr className="bg-gray-50 text-left text-xs font-semibold uppercase tracking-wider text-gray-500">
                      <th className="px-6 py-3">Reference</th>
                      <th className="px-6 py-3">Client</th>
                      <th className="px-6 py-3">Units</th>
                      <th className="px-6 py-3">Arrived</th>
                      <th className="px-6 py-3">Status</th>
                      <th className="px-6 py-3 text-center">View</th>
                      <th className="px-6 py-3 text-center">Detail</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {isLoading ? (
                      <tr>
                        <td colSpan="7" className="px-6 py-10 text-center text-sm text-gray-500">
                          <LoadingState label="Loading shipments..." />
                        </td>
                      </tr>
                    ) : (
                      filteredShipments.map((shipment) => (
                        <tr key={shipment.id} className="transition-colors hover:bg-gray-50">
                          <td className="px-6 py-4">
                            <span className="font-mono text-xs font-medium text-[#ff6900]">
                              {shipment.reference}
                            </span>
                          </td>
                          <td className="px-6 py-4 text-sm font-medium text-gray-900">
                            {shipment.client}
                          </td>
                          <td className="px-6 py-4 text-sm text-gray-700">{shipment.units}</td>
                          <td className="px-6 py-4 text-sm text-gray-600">{shipment.arrived}</td>
                          <td className="px-6 py-4">
                            <span
                              className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-semibold ${getStatusStyle(
                                shipment.status
                              )}`}
                            >
                              {shipment.status}
                            </span>
                          </td>
                          <td className="px-6 py-4 text-center">
                            <button
                              type="button"
                              onClick={() => openShipmentView(shipment)}
                              aria-label={`View shipment ${shipment.reference}`}
                              title="View shipment"
                              className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-gray-200 bg-white text-gray-600 hover:bg-gray-50 hover:text-[#3153a4]"
                            >
                              <Eye className="h-4 w-4" />
                            </button>
                          </td>
                          <td className="px-6 py-4 text-center">
                            <button
                              type="button"
                              onClick={() => openShipmentDetail(shipment.id)}
                              className="inline-flex items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-sm font-semibold text-[#132347] hover:bg-gray-50"
                            >
                              <FileText className="h-4 w-4" />
                              Detail
                            </button>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </>
        ) : (
          <div className="space-y-6">
            <button
              type="button"
              onClick={closeShipmentDetail}
              className="inline-flex items-center gap-2 rounded-xl border border-gray-200 bg-white px-4 py-2 text-sm font-medium text-gray-500 shadow-sm transition-colors hover:bg-gray-50 hover:text-gray-800"
            >
              <ArrowLeft className="h-4 w-4" />
              Back to Shipments
            </button>

            {message ? (
              <p className="rounded-lg border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-700">
                {message}
              </p>
            ) : null}
            {error ? (
              <p className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                {error}
              </p>
            ) : null}

            <div className="rounded-2xl border border-gray-200 bg-white p-6">
              <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                <div>
                  <h1 className="text-2xl font-semibold text-[#132347]">
                    {selectedShipment?.reference || selectedShipmentId}
                  </h1>
                  <div className="mt-2 flex flex-wrap items-center gap-x-5 gap-y-2 text-sm text-gray-500">
                    <span>Client: <span className="font-medium text-gray-800">{getShipmentClientName(selectedShipment)}</span></span>
                    <span>Arrived: <span className="font-medium text-gray-800">{getShipmentArrived(selectedShipment)}</span></span>
                    <span>Units: <span className="font-medium text-gray-800">{getShipmentUnits(selectedShipment)}</span></span>
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-3">
                  <button
                    type="button"
                    onClick={() => handleStatusUpdate("in_progress")}
                    className="rounded-lg bg-[#ff9d3a] px-4 py-2 text-sm font-semibold text-white hover:bg-[#f28a18]"
                  >
                    Prep Time
                  </button>
                  <span className="rounded-full bg-purple-100 px-3 py-1 text-xs font-semibold text-purple-700">
                    {formatStatusLabel(selectedShipment?.status || "in_progress")}
                  </span>
                  <button
                    type="button"
                    onClick={primaryStatusAction.onClick}
                    disabled={primaryStatusAction.disabled}
                    title={primaryStatusAction.title}
                    className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {primaryStatusAction.label}
                  </button>
                  <button
                    type="button"
                    onClick={() => loadShipmentDetail(selectedShipmentId)}
                    className="inline-flex items-center gap-2 rounded-lg border border-gray-200 bg-white px-4 py-2 text-sm text-gray-700 hover:bg-gray-50"
                  >
                    <RefreshCw size={15} />
                    Refresh
                  </button>
                </div>
              </div>

              <div className="mt-6 grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-8">
                {statusSteps.map((step, index) => {
                  const isDone = currentStepIndex >= index;
                  const isCurrent = currentStepIndex === index;
                  return (
                    <div key={step} className="flex items-center gap-2">
                      <span
                        className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold ${
                          isDone ? "bg-emerald-500 text-white" : isCurrent ? "bg-orange-400 text-white" : "bg-gray-100 text-gray-400"
                        }`}
                      >
                        {isDone && !isCurrent ? <CheckCircle2 size={14} /> : index + 1}
                      </span>
                      <span className={`text-xs font-semibold ${isCurrent ? "text-gray-900" : isDone ? "text-gray-700" : "text-gray-400"}`}>
                        {formatStatusLabel(step)}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>

            {(subShipments.length || subShipmentAvailabilityRows.length || canCreateSubShipment) ? (
              <section className="rounded-md border border-[#d9e3f2] bg-white p-5">
                <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <div>
                    <h3 className="text-[13px] font-semibold uppercase tracking-[0.18em] text-[#6d7b95]">Sub-shipments</h3>
                    <p className="mt-1 text-sm text-[#60708b]">
                      Parent shipment {selectedShipment?.reference || selectedShipmentId}
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
                      {isRefreshingSubShipmentAvailability ? "Refreshing..." : "Create Sub-shipment"}
                    </button>
                  ) : null}
                </div>

                {subShipmentAvailabilityRows.length ? (
                  <div className="mb-5 overflow-hidden rounded-lg border border-[#e2e8f0]">
                    <div className="bg-[#f8fafc] px-4 py-3 text-xs font-semibold uppercase tracking-wide text-[#64748b]">
                      Availability
                    </div>
                    <div className="overflow-x-auto">
                      <table className="w-full min-w-[720px] text-sm">
                        <thead className="bg-white">
                          <tr className="border-b border-[#edf2f7] text-left text-[11px] font-semibold uppercase tracking-wide text-[#7f8ea6]">
                            <th className="px-4 py-3">Product / SKU</th>
                            <th className="px-4 py-3">Expected</th>
                            <th className="px-4 py-3">Received</th>
                            <th className="px-4 py-3">Assigned</th>
                            <th className="px-4 py-3">Remaining</th>
                            <th className="px-4 py-3">Prepared</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-[#f1f5f9]">
                          {subShipmentAvailabilityRows.map((availabilityItem, index) => {
                            const prepared = getSubShipmentAvailabilityPrepared(availabilityItem);
                            const remainingQty = getAvailabilityRemainingQty(availabilityItem);

                            return (
                              <tr key={getAvailabilityItemId(availabilityItem) || getAvailabilitySku(availabilityItem) || index}>
                                <td className="px-4 py-3">
                                  <p className="font-semibold text-[#132347]">{getAvailabilityProductName(availabilityItem) || "-"}</p>
                                  <p className="text-xs text-[#64748b]">{getAvailabilitySku(availabilityItem) || "-"}</p>
                                </td>
                                <td className="px-4 py-3 text-[#132347]">{formatQuantityValue(getAvailabilityExpectedQty(availabilityItem))}</td>
                                <td className="px-4 py-3 text-[#132347]">{formatQuantityValue(getAvailabilityReceivedQty(availabilityItem))}</td>
                                <td className="px-4 py-3 text-[#132347]">{formatQuantityValue(getAvailabilityAssignedQty(availabilityItem))}</td>
                                <td className="px-4 py-3 text-[#132347]">{formatQuantityValue(remainingQty)}</td>
                                <td className="px-4 py-3">
                                  <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${
                                    prepared
                                      ? "bg-emerald-50 text-emerald-700"
                                      : "bg-gray-100 text-gray-600"
                                  }`}>
                                    {prepared ? "Yes" : "No"}
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
                      const canDispatchBoxes = status !== "cancelled";
                      const eligibleSubShipmentPalletBoxes = getEligiblePalletBoxesFromRows(subLooseBoxes);
                      const canAddSubShipmentBox =
                        Boolean(subShipmentId) && status !== "cancelled" && getSubShipmentBoxableQuantity(subShipment, boxData) > 0;
                      const canAddSubShipmentPallet =
                        Boolean(subShipmentId) && status !== "cancelled" && eligibleSubShipmentPalletBoxes.length > 0;

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
                                  {subLooseBoxes.length} loose box{subLooseBoxes.length !== 1 ? "es" : ""} - {subPallets.length} pallet{subPallets.length !== 1 ? "s" : ""} - {subChildBoxes.length} box{subChildBoxes.length !== 1 ? "es" : ""} inside pallet - {getSubShipmentLabelSummary(subVisiblePackages, files)} - {getSubShipmentDispatchSummary(subShipment, subDispatchablePackages)}
                                </p>
                              </div>
                              <div className="flex flex-wrap gap-2">
                                <button
                                  type="button"
                                  onClick={() => handleOpenSubShipmentBoxModal(subShipmentId, "box")}
                                  disabled={!canAddSubShipmentBox}
                                  title={canAddSubShipmentBox ? "Add box" : "All SKU quantities are already boxed"}
                                  className="rounded-lg bg-[#132347] px-3 py-2 text-xs font-semibold text-white hover:bg-[#0f1b38] disabled:cursor-not-allowed disabled:opacity-60"
                                >
                                  Add Box
                                </button>
                                <button
                                  type="button"
                                  onClick={() => handleOpenSubShipmentBoxModal(subShipmentId, "pallet")}
                                  disabled={!canAddSubShipmentPallet}
                                  title={canAddSubShipmentPallet ? "Add pallet from this sub-shipment boxes" : "No labeled loose boxes available for pallet"}
                                  className="rounded-lg bg-[#ff7a1a] px-3 py-2 text-xs font-semibold text-white hover:bg-[#f26f12] disabled:cursor-not-allowed disabled:opacity-60"
                                >
                                  Add Pallet
                                </button>
                                <button
                                  type="button"
                                  onClick={() => handleRefreshSubShipmentBoxes(subShipmentId)}
                                  disabled={!subShipmentId}
                                  className="rounded-lg border border-[#d6dfef] bg-white px-3 py-2 text-xs font-semibold text-[#5f6d85] hover:bg-[#f8fafc] disabled:cursor-not-allowed disabled:opacity-60"
                                >
                                  Refresh Boxes
                                </button>
                              </div>
                            </div>
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
                                            <p className="truncate font-semibold text-[#132347]">{getItemName(lineItem) || "Product"}</p>
                                            <p className="text-xs text-[#64748b]">SKU {getItemSku(lineItem) || "-"}</p>
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
                                      <p className="font-semibold text-[#132347]">{getAvailabilitySku(summary) || "SKU"}</p>
                                      <p>Planned {formatQuantityValue(firstPresent(summary?.plannedQty, summary?.planned_qty, 0))} - Allocated {formatQuantityValue(firstPresent(summary?.allocated, summary?.allocatedQty, summary?.allocated_qty, 0))} - Remaining {formatQuantityValue(firstPresent(summary?.remainingQty, summary?.remaining_qty, 0))}</p>
                                    </div>
                                  ))}
                                </div>
                              ) : (
                                <p className="rounded-md border border-[#e2e8f0] bg-white px-3 py-2 text-xs text-[#64748b]">No allocation summary returned.</p>
                              )}
                            </div>

                            <div>
                              <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-[#7f8ea6]">Boxes</p>
                              {subVisiblePackages.length ? (
                                <div className="space-y-2">
                                  {subVisiblePackages.map((box, boxIndex) => {
                                    const boxRecordId = getBoxRecordId(box);
                                    const isPallet = isPalletBox(box);
                                    const insidePallet = isBoxInsidePallet(box);
                                    const palletChildren = getPalletChildBoxes(box);
                                    const boxDimensions = getBoxDimensions(box);
                                    const boxWeight = getBoxWeight(box);
                                    const labelState = getBoxLabelState(box, files);
                                    const labelUploaded = isBoxFbaLabelUploaded(box, files);
                                    const boxPhotoUrl = getBoxImageUrl(box, files);
                                    const fbaLabelFile = getBoxFbaLabelFile(box, files);
                                    const fbaLabelUrl = fbaLabelFile ? getFileUrlCandidates(fbaLabelFile)[0] || resolveFileUrl(getFileUrl(fbaLabelFile)) : "";
                                    const previewUrl = fbaLabelUrl || boxPhotoUrl;
                                    const previewIsImage = fbaLabelFile ? isImageFile(fbaLabelFile) : Boolean(boxPhotoUrl);
                                    const labelText = isPallet
                                      ? (labelUploaded ? "Pallet Label Ready" : "Pallet Label Missing")
                                      : labelState.label;
                                    const dispatchComplete = ["dispatched", "sealed", "completed", "complete"].includes(
                                      String(firstPresent(box?.status, box?.boxStatus, box?.box_status, box?.dispatchStatus, box?.dispatch_status, "")).toLowerCase()
                                    ) || Boolean(box?.dispatched_at || box?.dispatchedAt);

                                    return (
                                      <div key={boxRecordId || getBoxId(box) || boxIndex} className="rounded-md border border-[#e2e8f0] bg-white px-3 py-3">
                                        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                                          <div>
                                            <div className="flex flex-wrap items-center gap-2">
                                              <p className="font-semibold text-[#132347]">{getBoxPalletLabel(box, boxIndex)}</p>
                                              {isPallet ? (
                                                <span className="rounded-full bg-[#fff7ed] px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-[#d76000]">
                                                  Pallet
                                                </span>
                                              ) : null}
                                              {insidePallet ? (
                                                <span className="rounded-full bg-blue-50 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-blue-700">
                                                  Inside pallet {getBoxParentPalletLabel(box)}
                                                </span>
                                              ) : null}
                                            </div>
                                            <p className="text-xs text-[#64748b]">
                                              {isPallet
                                                ? [boxDimensions, boxWeight ? `${boxWeight} kg` : "", `${palletChildren.length} box${palletChildren.length !== 1 ? "es" : ""}`].filter(Boolean).join(" - ") || "No pallet details"
                                                : [boxDimensions, boxWeight ? `${boxWeight} kg` : "", getBoxSkuSummary(box, files)].filter(Boolean).join(" - ") || "No box details"}
                                            </p>
                                            {isPallet ? (
                                              <div className="mt-2 rounded-lg border border-[#edf2f8] bg-[#f8fbff] p-2">
                                                <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
                                                  <p className="text-[10px] font-semibold uppercase tracking-wide text-[#60708b]">Boxes in pallet</p>
                                                  <span className="rounded-full bg-white px-2 py-0.5 text-[10px] font-semibold text-[#60708b]">
                                                    {palletChildren.length} box{palletChildren.length !== 1 ? "es" : ""}
                                                  </span>
                                                </div>
                                                {palletChildren.length ? (
                                                  <div className="space-y-1.5">
                                                    {palletChildren.map((childBox, childIndex) => {
                                                      const childDimensions = getBoxDimensions(childBox);
                                                      const childWeight = getBoxWeight(childBox);
                                                      const childSkuSummary = getBoxSkuSummary(childBox, files);
                                                      const childLabelUploaded = isBoxFbaLabelUploaded(childBox, files);

                                                      return (
                                                        <div key={getBoxRecordId(childBox) || getBoxId(childBox) || childIndex} className="rounded-md border border-[#dbe5f3] bg-white px-2.5 py-2">
                                                          <div className="flex flex-col gap-1 sm:flex-row sm:items-start sm:justify-between">
                                                            <div className="min-w-0">
                                                              <p className="truncate text-xs font-semibold text-[#132347]">{getBoxTitle(childBox, childIndex)}</p>
                                                              <p className="text-[11px] text-[#64748b]">
                                                                {[childDimensions, childWeight ? `${childWeight} kg` : "", childSkuSummary].filter(Boolean).join(" - ") || "No child box details"}
                                                              </p>
                                                            </div>
                                                            <span className={`w-fit rounded-full px-2 py-0.5 text-[10px] font-semibold ${childLabelUploaded ? "bg-emerald-50 text-emerald-700" : "bg-red-50 text-red-600"}`}>
                                                              {childLabelUploaded ? "FBA ready" : "FBA missing"}
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
                                          <div className="flex flex-wrap items-center gap-2">
                                            <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${labelState.className}`}>
                                              {labelText}
                                            </span>
                                            {labelUploaded ? (
                                              <button
                                                type="button"
                                                onClick={() => handleBoxFbaLabel(box, boxIndex)}
                                                className="rounded-lg border border-[#d6dfef] px-3 py-2 text-xs font-semibold text-[#5f6d85] hover:bg-[#f8fafc]"
                                              >
                                                {isPallet ? "Pallet FBA Label" : "FBA Label"}
                                              </button>
                                            ) : null}
                                            <button
                                              type="button"
                                              onClick={dispatchComplete || insidePallet || (!labelUploaded && !isPallet) ? undefined : () => handleMarkBoxDispatched(box)}
                                              disabled={!canDispatchBoxes || dispatchComplete || insidePallet || (!labelUploaded && !isPallet) || !boxRecordId}
                                              className={`rounded-lg px-3 py-2 text-xs font-semibold text-white disabled:cursor-not-allowed ${
                                                dispatchComplete
                                                  ? "bg-emerald-600 disabled:opacity-100"
                                                  : "bg-[#132347] hover:bg-[#0f1b38] disabled:opacity-50"
                                              }`}
                                            >
                                              {dispatchComplete ? "Dispatched" : insidePallet ? "Inside Pallet" : "Dispatch"}
                                            </button>
                                          </div>
                                        </div>

                                        {previewUrl ? (
                                          <button
                                            type="button"
                                            onClick={() => {
                                              if (fbaLabelFile) {
                                                handleBoxFbaLabel(box, boxIndex);
                                                return;
                                              }
                                              window.open(previewUrl, "_blank", "noopener,noreferrer");
                                            }}
                                            className="mt-3 block w-full overflow-hidden rounded-[4px] border border-[#dbe4f1] bg-[#f7f9fc]"
                                          >
                                            {previewIsImage ? (
                                              fbaLabelFile ? (
                                                <LabelPreviewImage file={fbaLabelFile} alt={getBoxTitle(box, boxIndex)} className="h-32 w-full object-contain" />
                                              ) : (
                                                <img src={previewUrl} alt={getBoxTitle(box, boxIndex)} className="h-32 w-full object-contain" />
                                              )
                                            ) : (
                                              <div className="flex h-32 flex-col items-center justify-center px-4 text-center">
                                                <p className="text-[13px] font-semibold text-[#132347]">
                                                  {isPallet ? "Pallet FBA label uploaded" : "FBA label uploaded"}
                                                </p>
                                                <p className="mt-1 max-w-full truncate text-[11px] text-[#7f8ea6]">
                                                  {getFileName(fbaLabelFile)}
                                                </p>
                                              </div>
                                            )}
                                          </button>
                                        ) : null}
                                      </div>
                                    );
                                  })}
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
              </section>
            ) : null}

            <div className="grid grid-cols-1 items-start gap-10 lg:grid-cols-2">
              <div className="space-y-6">
                <section>
                  <h3 className="mb-4 text-[12px] font-semibold uppercase tracking-[0.18em] text-[#6d7b95]">Line Items & Services</h3>
                  <div className="space-y-4">
                    {lineItems.length ? (
                      lineItems.map((item, index) => {
                        const itemServices = getLineItemServices(item, visibleServiceTasks, lineItems.length);
                        const itemSku = getItemSku(item) || "-";
                        const itemName = getItemName(item);
                        const itemFnsku = getItemFnsku(item) || "-";
                        const expectedQty = getLineItemExpectedQty(item) || 0;
                        const receivedQty = getItemReceivedQty(item) || 0;
                        const bundleSize = getViewItemBundleSize(item);
                        const bundleSizeDisplay = bundleSize || "-";
                        const itemDiscrepancies = discrepancies.filter((discrepancy, discrepancyIndex) =>
                          isDiscrepancyForItem(discrepancy, item, lineItems, discrepancyIndex)
                        );
                        return (
                          <div key={getLineItemId(item) || item?.sku || index} className="overflow-hidden rounded-md border border-[#d9e3f2] bg-[#f5f9ff]">
                            <div className="flex items-start justify-between gap-4 border-b border-[#e4ecf8] px-4 py-4">
                              <div>
                                <p className="text-[15px] font-semibold leading-6 text-[#1b2a4a]">
                                  SKU: {itemSku} {itemName ? `- ${itemName}` : ""}
                                </p>
                                <p className="mt-1 text-[12px] text-[#6b7a93]">
                                  FNSKU: {itemFnsku} - Expected: {expectedQty} - Received: {receivedQty} - Bundle Size: {bundleSizeDisplay}
                                </p>
                              </div>
                              <button
                                type="button"
                                onClick={() => handleLabelPdf(item, index)}
                                className="inline-flex shrink-0 items-center gap-1.5 rounded-md border border-[#d6dfef] bg-white px-3 py-2 text-[10px] font-semibold uppercase tracking-wide text-[#5f6d85] shadow-sm hover:bg-[#f8fbff]"
                              >
                                <ArrowDown size={12} />
                                Label PDF
                              </button>
                            </div>
                            <div className="space-y-3 px-4 py-4">
                              {itemServices.length ? (
                                itemServices.map((serviceName, serviceIndex) => {
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
                                          onChange={(event) => {
                                            if (!taskIdForService) return;
                                            const nextStatus = event.target.value === "Done" ? "DONE" : "PENDING";
                                            if (nextStatus === "DONE" && cannotMarkServiceDone) return;
                                            handleUpdateTask({
                                              taskId: taskIdForService,
                                              status: nextStatus,
                                              ...(nextStatus === "DONE" ? { unitsDone: serviceUnits } : {}),
                                            });
                                          }}
                                          className="min-w-[120px] appearance-none rounded-md border border-[#d8e1ef] bg-white px-3 py-2 pr-8 text-[12px] font-semibold text-[#495a77] shadow-sm outline-none"
                                        >
                                          <option disabled={selectedStatus !== "Done" && cannotMarkServiceDone}>Done</option>
                                          <option>Pending</option>
                                        </select>
                                        <ChevronDown className="pointer-events-none absolute right-2 top-1/2 h-4 w-4 -translate-y-1/2 text-[#7d8aa2]" />
                                      </div>
                                    </div>
                                  );
                                })
                              ) : (
                                <p className="text-sm text-[#7b889f]">No service tasks on this line item.</p>
                              )}

                              {itemDiscrepancies.length ? (
                                <div>
                                  <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-amber-700">Discrepancies</p>
                                  <div className="space-y-2">
                                    {itemDiscrepancies.map((discrepancy, discrepancyIndex) => {
                                      const discrepancyLineItemId = firstPresent(getDiscrepancyLineItemId(discrepancy), getLineItemId(item));
                                      return (
                                        <div key={getDiscrepancyId(discrepancy) || discrepancyLineItemId || discrepancyIndex} className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2">
                                          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                                            <p className="text-[13px] font-semibold text-amber-900">{itemSku || getDiscrepancySku(discrepancy) || "Line Item"}</p>
                                            <div className="flex flex-wrap items-center gap-2">
                                              <span className="rounded-full bg-white px-2 py-1 text-[10px] font-semibold text-amber-700">
                                                {discrepancy?.status || "OPEN"}
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
                      })
                    ) : (
                      <p className="text-sm text-gray-500">No line items found.</p>
                    )}
                  </div>
                </section>
              </div>

              <div className="space-y-6">
                <section>
                  <h3 className="mb-4 text-[12px] font-semibold uppercase tracking-[0.18em] text-[#6d7b95]">Outbound Boxes</h3>
                  <div className="space-y-4">
                    {parentShipmentBoxes.length ? (
                      parentShipmentBoxes.map((box, index) => {
                        const boxRecordId = getBoxRecordId(box);
                        const boxId = boxRecordId || getBoxId(box);
                        const isPallet = isPalletBox(box);
                        const insidePallet = isBoxInsidePallet(box);
                        const palletChildren = getPalletChildBoxes(box);
                        const labelState = getBoxLabelState(box, files);
                        const needsLabel = labelState.label === "Label Needed";
                        const boxPhotoUrl = getBoxImageUrl(box, files);
                        const fbaLabelFile = getBoxFbaLabelFile(box, files);
                        const fbaLabelUrl = fbaLabelFile ? getFileUrlCandidates(fbaLabelFile)[0] || resolveFileUrl(getFileUrl(fbaLabelFile)) : "";
                        const previewUrl = fbaLabelUrl || boxPhotoUrl;
                        const previewIsImage = fbaLabelFile ? isImageFile(fbaLabelFile) : Boolean(boxPhotoUrl);
                        const boxDimensions = getBoxDimensions(box);
                        const boxWeight = getBoxWeight(box);
                        const fallbackLineItem = lineItems.length === 1
                          ? lineItems[0]
                          : lineItems[Math.min(index, Math.max(lineItems.length - 1, 0))];
                        const boxUnits = firstPresent(getBoxUnits(box), getLineItemExpectedQty(fallbackLineItem || {}), "");
                        const boxStatus = getBoxDisplayStatus(box, currentStatus);
                        const boxSku = firstPresent(getBoxSkuValue(box, files), getItemSku(fallbackLineItem || {}));
                        const skuSummary = firstPresent(
                          getBoxSkuSummary(box, files),
                          boxSku && boxUnits !== "" ? `${boxUnits} UNITS (${boxSku})` : boxSku
                        );
                        const shipmentDispatchedOrCompleted = ["dispatched", "completed", "complete"].includes(currentStatus);
                        const palletLabelText = needsLabel ? "Pallet FBA label missing" : "Pallet FBA label uploaded";

                        return (
                          <div
                            key={boxId || index}
                            className={`overflow-hidden rounded-lg border bg-white shadow-sm transition hover:border-[#c8d5e8] hover:shadow-md ${
                              needsLabel ? "border-[#ffc9c9]" : "border-[#dbe5f3]"
                            }`}
                          >
                            <div className={`h-1 ${needsLabel ? "bg-[#ff7a7a]" : "bg-[#22c55e]"}`} />
                            <div className="p-4">
                              <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                                <div className="flex min-w-0 items-start gap-3">
                                  <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-sm font-semibold ${
                                    needsLabel ? "bg-red-50 text-red-600" : "bg-emerald-50 text-emerald-700"
                                  }`}>
                                    {index + 1}
                                  </div>
                                  <div className="min-w-0">
                                    <div className="flex flex-wrap items-center gap-2">
                                      <p className="truncate text-[15px] font-semibold text-[#132347]">{getBoxPalletLabel(box, index)}</p>
                                      <span className="rounded-full bg-[#f3f6fb] px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wide text-[#60708b]">
                                        {isPallet ? "Pallet" : getBoxSize(box)}
                                      </span>
                                      {insidePallet ? (
                                        <span className="rounded-full bg-blue-50 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wide text-blue-700">
                                          Inside pallet {getBoxParentPalletLabel(box)}
                                        </span>
                                      ) : null}
                                    </div>
                                    <p className="mt-1 text-[12px] font-medium text-[#6b7a93]">
                                      {isPallet
                                        ? [boxDimensions, boxWeight ? `${boxWeight} KG` : "", `${palletChildren.length} box${palletChildren.length !== 1 ? "es" : ""}`].filter(Boolean).join(" - ") || "No pallet details"
                                        : [boxDimensions, boxWeight ? `${boxWeight} KG` : "", skuSummary].filter(Boolean).join(" - ") || "No box details"}
                                    </p>
                                    {isPallet ? (
                                      <p className="mt-1 text-[12px] text-[#6b7a93]">{palletLabelText}</p>
                                    ) : null}
                                  </div>
                                </div>
                                <span className={`w-fit rounded-full px-3 py-1.5 text-[11px] font-semibold ${labelState.className}`}>
                                  {isPallet ? (needsLabel ? "Pallet Label Missing" : "Pallet Label Ready") : labelState.label}
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
                                      <p className="mt-1 font-medium">{boxWeight ? `${boxWeight} kg` : "-"}</p>
                                    </div>
                                    <div>
                                      <p className="text-[10px] font-semibold uppercase tracking-wide text-[#7f8ea6]">Pallet Dimensions</p>
                                      <p className="mt-1 font-medium">{boxDimensions || "-"}</p>
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
                                        {palletChildren.length} box{palletChildren.length !== 1 ? "es" : ""}
                                      </span>
                                    </div>
                                    {palletChildren.length ? (
                                      <div className="space-y-2">
                                        {palletChildren.map((childBox, childIndex) => {
                                          const childDimensions = getBoxDimensions(childBox);
                                          const childWeight = getBoxWeight(childBox);
                                          const childSkuSummary = getBoxSkuSummary(childBox, files);
                                          const childLabelUploaded = isBoxFbaLabelUploaded(childBox, files);

                                          return (
                                            <div key={getBoxRecordId(childBox) || getBoxId(childBox) || childIndex} className="rounded-md border border-[#dbe5f3] bg-white px-3 py-2">
                                              <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                                                <div className="min-w-0">
                                                  <p className="truncate text-xs font-semibold text-[#132347]">{getBoxTitle(childBox, childIndex)}</p>
                                                  <p className="mt-0.5 text-[11px] text-[#64748b]">
                                                    {[childDimensions, childWeight ? `${childWeight} kg` : "", childSkuSummary].filter(Boolean).join(" - ") || "No child box details"}
                                                  </p>
                                                </div>
                                                <span className={`w-fit rounded-full px-2 py-0.5 text-[10px] font-semibold ${childLabelUploaded ? "bg-emerald-50 text-emerald-700" : "bg-red-50 text-red-600"}`}>
                                                  {childLabelUploaded ? "FBA label ready" : "FBA label missing"}
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
                                    <p className="mt-1 font-medium">{boxWeight ? `${boxWeight} kg` : "-"}</p>
                                  </div>
                                  <div>
                                    <p className="text-[10px] font-semibold uppercase tracking-wide text-[#7f8ea6]">Dimensions</p>
                                    <p className="mt-1 font-medium">{boxDimensions || "-"}</p>
                                  </div>
                                  <div>
                                    <p className="text-[10px] font-semibold uppercase tracking-wide text-[#7f8ea6]">Units</p>
                                    <p className={`mt-1 font-medium ${boxUnits !== "" ? "" : "text-red-600"}`}>
                                      {boxUnits !== "" ? boxUnits : "-"}
                                    </p>
                                  </div>
                                  <div>
                                    <p className="text-[10px] font-semibold uppercase tracking-wide text-[#7f8ea6]">SKU</p>
                                    <p className={`mt-1 break-words font-medium ${boxSku ? "" : "text-red-600"}`}>
                                      {boxSku || "SKU not allocated"}
                                    </p>
                                  </div>
                                </div>
                              )}

                              {(!needsLabel || isPallet) ? (
                                <>
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
                                          ? "bg-emerald-600 disabled:opacity-100"
                                          : "bg-[#ff9d20] hover:bg-[#f28a18] disabled:opacity-60"
                                      }`}
                                    >
                                      {shipmentDispatchedOrCompleted ? "Dispatched" : insidePallet ? "Inside Pallet" : "Mark Dispatched"}
                                    </button>
                                  </div>

                                  {previewUrl ? (
                                    <button
                                      type="button"
                                      onClick={() => {
                                        if (fbaLabelFile) {
                                          handleBoxFbaLabel(box, index);
                                          return;
                                        }
                                        window.open(previewUrl, "_blank", "noopener,noreferrer");
                                      }}
                                      className="mt-4 block w-full overflow-hidden rounded-[4px] border border-[#dbe4f1] bg-[#f7f9fc]"
                                    >
                                      {previewIsImage ? (
                                        fbaLabelFile ? (
                                          <LabelPreviewImage file={fbaLabelFile} alt={getBoxTitle(box, index)} className="h-32 w-full object-contain" />
                                        ) : (
                                          <img src={previewUrl} alt={getBoxTitle(box, index)} className="h-32 w-full object-contain" />
                                        )
                                      ) : (
                                        <div className="flex h-32 flex-col items-center justify-center px-4 text-center">
                                          <p className="text-[13px] font-semibold text-[#132347]">FBA Label uploaded</p>
                                          <p className="mt-1 max-w-full truncate text-[11px] text-[#7f8ea6]">
                                            {getFileName(fbaLabelFile)}
                                          </p>
                                        </div>
                                      )}
                                    </button>
                                  ) : null}
                                </>
                              ) : null}
                            </div>
                          </div>
                        );
                      })
                    ) : (
                      <p className="text-sm text-gray-500">No boxes created yet.</p>
                    )}
                  </div>

                  <button
                    type="button"
                    onClick={() => {
                      setActiveSubShipmentIdForBox("");
                      setBoxType("box");
                      resetAddBoxSkuSelection();
                      setSelectedPalletBoxIds([]);
                      setShowAddBoxModal(true);
                    }}
                    className="mt-4 w-full rounded-full border border-[#dfe6f2] bg-white px-4 py-3 text-[11px] font-semibold uppercase tracking-wide text-[#7f8ea6] hover:bg-gray-50"
                  >
                    + Add Box/Pallet
                  </button>
                </section>

                <section>
                  <h3 className="mb-5 text-[16px] font-normal uppercase  text-[#657187]">Shipment Notes</h3>
                  <div className="rounded-md border border-[#d9e3f2] bg-white p-6">
                    <p className="whitespace-pre-line text-[15px] leading-7 text-[#132347]">
                      {getShipmentNoteText(selectedShipment) || "No shipment notes added."}
                    </p>
                    <div className="mt-5 flex items-center justify-between border-t border-[#e8edf5] pt-4 text-[12px]">
                      <span className="text-[#9aa8bd]">Last edited: {selectedShipment?.updated_at || selectedShipment?.updatedAt || "-"}</span>
                      <span className="font-semibold text-[#a96900]">Edit Notes</span>
                    </div>
                  </div>
                </section>

                <section>
                  <h3 className="mb-5 text-[16px] font-normal uppercase text-[#657187]">Order Data</h3>
                  <div className="rounded-md border border-[#d9e3f2] bg-white p-6">
                    {(() => {
                      const orderData = getShipmentOrderData(selectedShipment);

                      return (
                        <div className="grid grid-cols-1 gap-4 text-[14px] text-[#132347] sm:grid-cols-3">
                          <div>
                            <p className="text-[11px] font-semibold uppercase tracking-wide text-[#7f8ea6]">Tracking</p>
                            <p className="mt-1 font-medium">{orderData.tracking || "-"}</p>
                          </div>
                          <div>
                            <p className="text-[11px] font-semibold uppercase tracking-wide text-[#7f8ea6]">Boxes</p>
                            <p className="mt-1 font-medium">{orderData.boxes || "-"}</p>
                          </div>
                          <div>
                            <p className="text-[11px] font-semibold uppercase tracking-wide text-[#7f8ea6]">Pallets</p>
                            <p className="mt-1 font-medium">{orderData.pallets || "-"}</p>
                          </div>
                        </div>
                      );
                    })()}
                  </div>
                </section>
              </div>
            </div>

            <div className="hidden rounded-2xl border border-[#dce6f7] bg-white p-6 shadow-sm">
              <div className="mb-4 flex items-center justify-between gap-4">
                <div>
                  <h2 className="text-2xl font-bold text-[#132347]">
                    {selectedShipment?.reference || selectedShipmentId}
                  </h2>
            
                </div>
                <button
                  type="button"
                  onClick={() => loadShipmentDetail(selectedShipmentId)}
                  className="inline-flex items-center gap-2 rounded-lg border border-gray-200 bg-white px-4 py-2 text-sm text-gray-700 hover:bg-gray-50"
                >
                  <RefreshCw size={15} />
                  Refresh
                </button>
              </div>

              <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
                <div className="rounded-xl border border-gray-200 bg-gray-50 p-4 text-sm">
                  <p>Client: <span className="font-medium text-gray-900">{selectedShipment?.client?.companyName || selectedShipment?.client?.name || selectedShipment?.clientId || "-"}</span></p>
                  <p className="mt-2">Units: <span className="font-medium text-gray-900">{selectedShipment?.totalUnits || selectedShipment?.units || 0}</span></p>
                  <p className="mt-2">Status: <span className="font-medium text-gray-900">{selectedShipment?.status || "-"}</span></p>
                </div>

                <div className="rounded-xl border border-gray-200 bg-gray-50 p-4">
                  <h3 className="mb-3 text-sm font-semibold text-gray-900">Update Status</h3>
                  <select
                    value={statusValue}
                    onChange={(e) => setStatusValue(e.target.value)}
                    className="mb-3 w-full rounded-lg border border-gray-200 px-3 py-2.5 text-sm"
                  >
                    {statusSteps.map((status) => (
                      <option key={status} value={status}>
                        {formatStatusLabel(status)}
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    onClick={() => handleStatusUpdate()}
                    className="rounded-lg bg-[#ff6900] px-4 py-2 text-sm font-medium text-white hover:bg-[#e55d00]"
                  >
                    Save Status
                  </button>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() => handleStatusUpdate("in_progress")}
                      className="rounded-lg border border-orange-200 bg-white px-3 py-1.5 text-xs font-semibold text-orange-700 hover:bg-orange-50"
                    >
                      Start Prep
                    </button>
                    <button
                      type="button"
                      onClick={() => handleStatusUpdate("prepped")}
                      className="rounded-lg border border-green-200 bg-white px-3 py-1.5 text-xs font-semibold text-green-700 hover:bg-green-50"
                    >
                      Mark Prepped
                    </button>
                  </div>
                </div>

                <div className="rounded-xl border border-gray-200 bg-gray-50 p-4">
                  <h3 className="mb-3 text-sm font-semibold text-gray-900">Bulk Service Update</h3>
                  <input
                    type="text"
                    value={bulkServiceType}
                    onChange={(e) => setBulkServiceType(e.target.value)}
                    className="mb-3 w-full rounded-lg border border-gray-200 px-3 py-2.5 text-sm"
                    placeholder="Service Type e.g. fnsku_label"
                  />
                  <input
                    type="text"
                    value={bulkStatus}
                    onChange={(e) => setBulkStatus(e.target.value)}
                    className="mb-3 w-full rounded-lg border border-gray-200 px-3 py-2.5 text-sm"
                    placeholder="Status"
                  />
                  <button
                    type="button"
                    onClick={handleBulkServiceUpdate}
                    className="rounded-lg bg-[#132347] px-4 py-2 text-sm font-medium text-white hover:bg-[#0f1b38]"
                  >
                    Update Services
                  </button>
                </div>
              </div>
            </div>

            <div className="hidden grid-cols-1 gap-6 lg:grid-cols-2">
              <div className="rounded-2xl border border-[#dce6f7] bg-white p-6 shadow-sm">
                <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-gray-900">
                  <AlertTriangle className="h-4 w-4 text-amber-500" />
                  Discrepancies
                </div>
                {discrepancies.length ? (
                  <div className="mb-4 space-y-3">
                    {discrepancies.map((item, index) => {
                      const matchedLineItem = findLineItemForDiscrepancy(item, lineItems, index);
                      const discrepancyLineItemId = firstPresent(getDiscrepancyLineItemId(item), getLineItemId(matchedLineItem));

                      return (
                        <div key={getDiscrepancyId(item) || discrepancyLineItemId || index} className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm">
                          <div className="flex items-center justify-between gap-3">
                            <p className="font-semibold text-amber-900">{getItemSku(matchedLineItem) || getDiscrepancySku(item) || discrepancyLineItemId || "Line Item"}</p>
                            <div className="flex items-center gap-2">
                              <span className="rounded-full bg-white px-2 py-1 text-xs font-medium text-amber-700">
                                {item?.status || "OPEN"}
                              </span>
                              {discrepancyLineItemId ? (
                                <button
                                  type="button"
                                  onClick={() => handleOpenDiscrepancyResolve(item, matchedLineItem)}
                                  className="rounded-full bg-[#132347] px-2.5 py-1 text-xs font-semibold text-white hover:bg-[#0f1b38]"
                                >
                                  Update Received Qty
                                </button>
                              ) : null}
                            </div>
                          </div>
                          <p className="mt-2 text-amber-800">
                            Expected {getDiscrepancyExpectedQty(item, matchedLineItem)}, received {getDiscrepancyReceivedQty(item, matchedLineItem)}
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
               
              </div>

              <div className="rounded-2xl border border-[#dce6f7] bg-white p-6 shadow-sm">
                <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-gray-900">
                  <CheckCircle2 className="h-4 w-4 text-green-600" />
                  Services
                </div>
                {visibleServiceTasks.length ? (
                  <div className="mb-4 space-y-3">
                    {visibleServiceTasks.map((service) => {
                      const serviceId = getServiceTaskId(service);
                      const serviceLineItem = findLineItemForServiceTask(service, lineItems);
                      const serviceStatus = String(service?.status || "PENDING").toUpperCase();
                      const isDone = serviceStatus === "DONE" || serviceStatus === "COMPLETED";
                      const serviceUnits = getServiceUnits(service, serviceLineItem);
                      const cannotMarkServiceDone = !Number.isFinite(serviceUnits) || serviceUnits <= 0;
                      return (
                        <div key={service.displayId} className="rounded-lg border border-gray-200 bg-gray-50 p-3 text-sm">
                          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                            <div>
                              <p className="font-semibold text-gray-900">{formatServiceLabel(service?.serviceType || service?.service_type || service?.name) || "Service Task"}</p>
                              <p className="text-xs text-gray-500">
                                Task {serviceId || "-"} • Line Item {service?.lineItemId || service?.shipmentItemId || service?.itemId || "-"}
                              </p>
                            </div>
                            <div className="flex items-center gap-2">
                              <span className="rounded-full bg-white px-2 py-1 text-xs font-medium text-gray-700">
                                {serviceStatus}
                              </span>
                              <button
                                type="button"
                                disabled={!serviceId || isDone || cannotMarkServiceDone || updatingTaskId === serviceId}
                                onClick={() =>
                                  handleUpdateTask({
                                    taskId: serviceId,
                                    status: "DONE",
                                    unitsDone: serviceUnits,
                                  })
                                }
                                className="rounded-lg bg-[#ff6900] px-3 py-1.5 text-xs font-semibold text-white hover:bg-[#e55d00] disabled:cursor-not-allowed disabled:bg-gray-200 disabled:text-gray-500"
                              >
                                {updatingTaskId === serviceId ? "Updating..." : isDone ? "Done" : "Mark Done"}
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
                              SKU {service.sku} • Line Item {service.lineItemId || "-"}
                            </p>
                          </div>
                          <span className="rounded-full bg-white px-2 py-1 text-xs font-medium text-gray-700">
                            {service.status}
                          </span>
                        </div>
                        {typeof service.price === "number" ? (
                          <p className="mt-2 text-xs text-gray-600">Price: {service.price}</p>
                        ) : null}
                      </div>
                    ))}
                  </div>
                ) : null}
             
                <div className="mt-4 space-y-3">
                  <input type="text" placeholder="taskId" value={taskId} onChange={(e) => setTaskId(e.target.value)} className="w-full rounded-lg border border-gray-200 px-3 py-2.5 text-sm" />
                  <input type="text" placeholder="Status" value={taskStatus} onChange={(e) => setTaskStatus(e.target.value)} className="w-full rounded-lg border border-gray-200 px-3 py-2.5 text-sm" />
                  <input type="number" placeholder="Units Done" value={taskUnitsDone} onChange={(e) => setTaskUnitsDone(e.target.value)} className="w-full rounded-lg border border-gray-200 px-3 py-2.5 text-sm" />
                  <input type="text" placeholder="Notes" value={taskNotes} onChange={(e) => setTaskNotes(e.target.value)} className="w-full rounded-lg border border-gray-200 px-3 py-2.5 text-sm" />
                  <button onClick={() => handleUpdateTask()} className="rounded-lg bg-[#ff6900] px-4 py-2.5 text-sm font-medium text-white hover:bg-[#e55d00]">Update Task</button>
                </div>
              </div>
            </div>

            <div className="hidden rounded-2xl border border-[#dce6f7] bg-white p-6 shadow-sm">
              <h3 className="mb-3 text-sm font-semibold text-gray-900">Shipment Line Items</h3>
        
            </div>

            <div className="hidden grid-cols-1 gap-6 lg:grid-cols-2">
              <div className="rounded-2xl border border-[#dce6f7] bg-white p-6 shadow-sm">
                <h3 className="mb-3 text-sm font-semibold text-gray-900">Boxes</h3>
              </div>
              <div className="rounded-2xl border border-[#dce6f7] bg-white p-6 shadow-sm">
                <h3 className="mb-3 text-sm font-semibold text-gray-900">Files</h3>
              </div>
            </div>

            <div className="hidden grid-cols-1 gap-6 lg:grid-cols-3">
              <div className="rounded-2xl border border-[#dce6f7] bg-white p-6 shadow-sm">
                <h3 className="mb-3 text-sm font-semibold text-gray-900">Create Box / Pallet</h3>
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
                    <button
                      onClick={() => {
                        setActiveSubShipmentIdForBox("");
                        setBoxType("pallet");
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

              <div className="rounded-2xl border border-[#dce6f7] bg-white p-6 shadow-sm">
                <h3 className="mb-3 text-sm font-semibold text-gray-900">Custom Service / Box Items</h3>
                <div className="space-y-3">
                  <input type="text" placeholder="Line Item UUID" value={customServiceLineItemId} onChange={(e) => setCustomServiceLineItemId(e.target.value)} className="w-full rounded-lg border border-gray-200 px-3 py-2.5 text-sm" />
                  <input type="text" placeholder="Custom Service Name" value={customServiceName} onChange={(e) => setCustomServiceName(e.target.value)} className="w-full rounded-lg border border-gray-200 px-3 py-2.5 text-sm" />
                  <input type="number" step="0.01" placeholder="Custom Service Price" value={customServicePrice} onChange={(e) => setCustomServicePrice(e.target.value)} className="w-full rounded-lg border border-gray-200 px-3 py-2.5 text-sm" />
                  <button onClick={handleAddCustomService} className="rounded-lg bg-[#ff6900] px-4 py-2.5 text-sm font-medium text-white hover:bg-[#e55d00]">Add Custom Service</button>
                  <input type="text" placeholder="Custom Service Status" value={customServiceStatusValue} onChange={(e) => setCustomServiceStatusValue(e.target.value)} className="w-full rounded-lg border border-gray-200 px-3 py-2.5 text-sm" />
                  <button onClick={handleUpdateCustomServiceStatus} className="rounded-lg bg-[#132347] px-4 py-2.5 text-sm font-medium text-white hover:bg-[#0f1b38]">Update Custom Service</button>
                  <input type="text" placeholder="Box UUID" value={addToBoxBoxId} onChange={(e) => setAddToBoxBoxId(e.target.value)} className="w-full rounded-lg border border-gray-200 px-3 py-2.5 text-sm" />
                  <input type="text" placeholder="Shipment Item UUID" value={addToBoxLineItemId} onChange={(e) => setAddToBoxLineItemId(e.target.value)} className="w-full rounded-lg border border-gray-200 px-3 py-2.5 text-sm" />
                  <input type="number" placeholder="Quantity" value={addToBoxQuantity} onChange={(e) => setAddToBoxQuantity(e.target.value)} className="w-full rounded-lg border border-gray-200 px-3 py-2.5 text-sm" />
                  <button onClick={handleAddItemToBox} className="rounded-lg bg-[#ff6900] px-4 py-2.5 text-sm font-medium text-white hover:bg-[#e55d00]">Add Item To Box</button>
                  <input type="text" placeholder="Remove Box UUID" value={removeFromBoxBoxId} onChange={(e) => setRemoveFromBoxBoxId(e.target.value)} className="w-full rounded-lg border border-gray-200 px-3 py-2.5 text-sm" />
                  <input type="text" placeholder="Content Item ID" value={removeFromBoxItemId} onChange={(e) => setRemoveFromBoxItemId(e.target.value)} className="w-full rounded-lg border border-gray-200 px-3 py-2.5 text-sm" />
                  <button onClick={handleRemoveItemFromBox} className="rounded-lg border border-gray-300 bg-white px-4 py-2.5 text-sm font-medium text-gray-700 hover:bg-gray-50">Remove Item</button>
                </div>
              </div>

              <div className="rounded-2xl border border-[#dce6f7] bg-white p-6 shadow-sm">
                <h3 className="mb-3 text-sm font-semibold text-gray-900">Seal / Delete + Files</h3>
                <div className="space-y-3">
                  <input type="text" placeholder="Seal Box UUID" value={sealBoxId} onChange={(e) => setSealBoxId(e.target.value)} className="w-full rounded-lg border border-gray-200 px-3 py-2.5 text-sm" />
                  <input type="text" placeholder="Tracking Code" value={sealTrackingCode} onChange={(e) => setSealTrackingCode(e.target.value)} className="w-full rounded-lg border border-gray-200 px-3 py-2.5 text-sm" />
                  <button onClick={handleSealBox} className="rounded-lg bg-[#ff6900] px-4 py-2.5 text-sm font-medium text-white hover:bg-[#e55d00]">Seal Box</button>
                  <input type="text" placeholder="Delete Box UUID" value={deleteBoxId} onChange={(e) => setDeleteBoxId(e.target.value)} className="w-full rounded-lg border border-gray-200 px-3 py-2.5 text-sm" />
                  <button onClick={handleDeleteBox} className="rounded-lg border border-red-300 bg-red-50 px-4 py-2.5 text-sm font-medium text-red-700 hover:bg-red-100">Delete Box</button>
                  <div className="border-t border-gray-200 pt-3">
                    <div className="grid grid-cols-1 gap-3">
                      <select value={fileEntityType} onChange={(e) => setFileEntityType(e.target.value)} className="rounded-lg border border-gray-200 px-3 py-2.5 text-sm">
                        <option value="shipment">shipment</option>
                        <option value="item">item</option>
                        <option value="box">box</option>
                        <option value="invoice">invoice</option>
                      </select>
                      <input type="text" placeholder="Entity ID" value={fileEntityId} onChange={(e) => setFileEntityId(e.target.value)} className="rounded-lg border border-gray-200 px-3 py-2.5 text-sm" />
                      <input type="text" placeholder="File Type" value={fileType} onChange={(e) => setFileType(e.target.value)} className="rounded-lg border border-gray-200 px-3 py-2.5 text-sm" />
                      <label className="inline-flex cursor-pointer items-center gap-2 rounded-lg border border-dashed border-gray-300 px-3 py-2.5 text-sm text-gray-700 hover:bg-gray-50">
                        <Upload size={15} />
                        {selectedFile ? selectedFile.name : "Choose File"}
                        <input type="file" onChange={(e) => setSelectedFile(e.target.files?.[0] || null)} className="hidden" />
                      </label>
                      <button onClick={handleUploadFile} className="rounded-lg bg-[#132347] px-4 py-2.5 text-sm font-medium text-white hover:bg-[#0f1b38]">Upload File</button>
                    </div>
                  </div>
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

        {viewShipment ? (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
            <div className="h-[600px] w-full max-w-2xl overflow-y-auto rounded-xl bg-white shadow-xl">
              {(() => {
                const shipmentForView = viewShipmentDetail || viewShipment;
                const viewLineItems = sortLineItemsForDisplay(getLineItems(shipmentForView));
                const itemCount = viewLineItems.length;
                const viewServiceTasks = mergeServiceTasks(viewShipmentServices, shipmentForView).map((service, index) => ({
                  ...service,
                  displayId: `${getServiceTaskId(service) || service?.lineItemId || service?.shipmentItemId || "task"}-${index}`,
                }));
                const standardServiceTasks = viewServiceTasks.filter((service) => !isCustomServiceTask(service));
                const viewCustomServices = extractCustomServices(shipmentForView, viewServiceTasks);
                const itemLabelFiles = getItemLabelFileAssignments(viewLineItems, viewShipmentFiles);
                const orderData = getShipmentOrderData(shipmentForView);
                const shipmentNotes = getShipmentNoteText(shipmentForView);
                const viewReference = firstPresent(shipmentForView?.reference, viewShipment?.reference, viewShipment?.id);
                const expectedArrival = firstPresent(
                  shipmentForView?.expectedArrivalDate,
                  shipmentForView?.expected_arrival_date,
                  shipmentForView?.arrivedDate,
                  viewShipment?.arrived,
                  "-"
                );
                const viewStatus = firstPresent(shipmentForView?.status, viewShipment?.status, "-");
                const viewUnits = getShipmentUnits(shipmentForView);
                const allServiceLabels = getShipmentServiceLabels(shipmentForView, viewServiceTasks);
                const viewBundleSizeEntries = getBundleSizeEntriesFromNotes(getRawShipmentNotes(shipmentForView));

                const getBoxContentRowsForView = (box = {}, boxIndex = -1) => {
                  const contentRows = getBoxItems(box)
                    .map((content) => {
                      const shipmentItemId = getBoxItemLineItemId(content);
                      const contentSku = getBoxItemSku(content);
                      const matchedItem = viewLineItems.find((item) => {
                        const itemIds = getItemLabelMatchIds(item);
                        const itemSku = String(getItemSku(item) || "").trim().toLowerCase();
                        const rowSku = String(contentSku || "").trim().toLowerCase();
                        return Boolean(
                          (shipmentItemId && itemIds.includes(String(shipmentItemId))) ||
                            (itemSku && rowSku && itemSku === rowSku)
                        );
                      });
                      const quantity = firstPresent(getBoxItemQuantity(content), getLineItemExpectedQty(matchedItem || {}), "");

                      return {
                        ...content,
                        sku: firstPresent(contentSku, getItemSku(matchedItem || {})),
                        quantity,
                        shipmentItemId,
                      };
                    })
                    .filter((row) => String(row?.sku || "").trim() || row?.quantity !== "");

                  if (contentRows.length) return contentRows;

                  const directLineItemId = firstPresent(box?.shipmentItemId, box?.shipment_item_id, box?.lineItemId, box?.line_item_id, box?.itemId, box?.item_id);
                  const directSku = getBoxItemSku(box);
                  const fallbackItem = viewLineItems.find((item) => {
                    const itemIds = getItemLabelMatchIds(item);
                    const itemSku = String(getItemSku(item) || "").trim().toLowerCase();
                    const boxSku = String(directSku || "").trim().toLowerCase();
                    return Boolean(
                      (directLineItemId && itemIds.includes(String(directLineItemId))) ||
                        (itemSku && boxSku && itemSku === boxSku)
                    );
                  }) || (itemCount === 1 ? viewLineItems[0] : viewLineItems[Math.min(Math.max(boxIndex, 0), Math.max(itemCount - 1, 0))]);
                  const quantity = firstPresent(getBoxItemQuantity(box), getBoxUnits(box), getLineItemExpectedQty(fallbackItem || {}), "");
                  const sku = firstPresent(directSku, getItemSku(fallbackItem || {}));

                  return sku || quantity !== ""
                    ? [{ sku, quantity, shipmentItemId: directLineItemId || getShipmentLineItemId(fallbackItem || {}) || getLineItemId(fallbackItem || {}) }]
                    : [];
                };

                const isBoxLinkedToViewItem = (box = {}, item = {}, boxIndex = -1) => {
                  const itemIds = getItemLabelMatchIds(item);
                  const itemSku = String(getItemSku(item) || "").trim().toLowerCase();
                  const rows = getBoxContentRowsForView(box, boxIndex);

                  return rows.some((row) => {
                    const rowLineItemId = String(row?.shipmentItemId || row?.shipment_item_id || row?.lineItemId || row?.line_item_id || "").trim();
                    const rowSku = String(row?.sku || "").trim().toLowerCase();
                    return Boolean((rowLineItemId && itemIds.includes(rowLineItemId)) || (itemSku && rowSku && itemSku === rowSku));
                  });
                };

                const viewPackageRows = getVisiblePackageRowsWithPalletChildren(viewShipmentBoxes);

                const getOutboundPackagesForViewItem = (item) =>
                  getLineItemOutboundPackageGroups({
                    item,
                    boxes: viewPackageRows,
                    lineItems: viewLineItems,
                    isBoxLinkedToItem: (box, currentItem, boxIndex) => isBoxLinkedToViewItem(box, currentItem, boxIndex),
                    getPalletChildBoxes,
                    isPalletBox,
                    getBoxKey: (box, boxIndex) => String(getBoxRecordId(box) || getBoxId(box) || getBoxPalletLabel(box, boxIndex) || boxIndex),
                  });
                const getBoxesForViewItem = (item) => getOutboundPackagesForViewItem(item).boxes;
                const getPalletsForViewItem = (item) => getOutboundPackagesForViewItem(item).pallets;

                const getUnassignedViewBoxes = () =>
                  viewPackageRows
                    .map((box, boxIndex) => ({ box, boxIndex }))
                    .filter(({ box, boxIndex }) => !viewLineItems.some((item) => {
                      const packages = getOutboundPackagesForViewItem(item);
                      const packageRows = [...packages.boxes, ...packages.pallets];
                      const currentKey = String(getBoxRecordId(box) || getBoxId(box) || getBoxPalletLabel(box, boxIndex) || boxIndex);
                      return packageRows.some((row) => String(row.key || getBoxRecordId(row.box) || getBoxId(row.box) || getBoxPalletLabel(row.box, row.boxIndex) || row.boxIndex) === currentKey);
                    }));

                const getBoxRowsForViewItem = (box = {}, boxIndex = -1, lineItem = null) => {
                  const rows = getBoxContentRowsForView(box, boxIndex);
                  if (!lineItem) return rows;

                  const itemIds = getItemLabelMatchIds(lineItem);
                  const itemSku = String(getItemSku(lineItem) || "").trim().toLowerCase();
                  return rows.filter((row) => {
                    const rowLineItemId = String(row?.shipmentItemId || row?.shipment_item_id || row?.lineItemId || row?.line_item_id || "").trim();
                    const rowSku = String(row?.sku || "").trim().toLowerCase();
                    return Boolean((rowLineItemId && itemIds.includes(rowLineItemId)) || (itemSku && rowSku && itemSku === rowSku));
                  });
                };

                const getBoxRowsSummary = (rows = []) =>
                  rows
                    .map((row) => {
                      const sku = String(row?.sku || "").trim();
                      if (sku && row?.quantity !== "") return `${sku}: ${row.quantity}`;
                      return sku;
                    })
                    .filter(Boolean)
                    .join(", ");

                const getRowsTotalQuantity = (rows = []) => {
                  const quantities = rows
                    .map((row) => row?.quantity)
                    .filter((quantity) => quantity !== "" && quantity !== undefined && quantity !== null);
                  if (!quantities.length) return "";
                  return quantities.reduce((sum, quantity) => {
                    const numericQuantity = Number(quantity);
                    return Number.isFinite(numericQuantity) ? sum + numericQuantity : sum;
                  }, 0);
                };

                const renderViewBoxCard = (box, index, lineItem = null) => {
                  const rows = getBoxRowsForViewItem(box, index, lineItem);
                  const allRows = getBoxRowsForViewItem(box, index);
                  const displayRows = allRows.length ? allRows : rows;
                  const fbaLabelFile = getBoxFbaLabelFile(box, viewShipmentFiles);
                  const fbaLabelUrl = getFileUrlCandidates(fbaLabelFile)[0] || resolveFileUrl(getFileUrl(fbaLabelFile));
                  const fbaLabelImage = fbaLabelFile && fbaLabelUrl && isImageFile(fbaLabelFile);
                  const labelReady = isBoxFbaLabelUploaded(box, viewShipmentFiles);
                  const dimensions = getBoxDimensions(box) || "0x0x0 CM";
                  const boxWeight = getBoxWeight(box);
                  const totalQty = firstPresent(getRowsTotalQuantity(displayRows), getRowsTotalQuantity(rows), getBoxUnits(box), "");
                  const boxSku = firstPresent(getBoxRowsSummary(displayRows), getBoxRowsSummary(rows), getBoxSkuValue(box, viewShipmentFiles), lineItem ? getItemSku(lineItem) : "");
                  const isPallet = isPalletBox(box);
                  const insidePallet = isBoxInsidePallet(box);
                  const insidePalletLabel = insidePallet ? getBoxParentPalletLabel(box) : "";
                  const palletChildren = getPalletChildBoxes(box);

                  return (
                    <div key={getBoxId(box) || index} className="overflow-hidden rounded-lg border border-gray-200 bg-gray-50">
                      <div className="p-3">
                        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                          <div className="flex flex-wrap items-center gap-2">
                            <p className="font-medium text-gray-900">{getBoxPalletLabel(box, index)}{!isPallet && getBoxSize(box) ? ` - ${getBoxSize(box).toLowerCase()}` : ""}</p>
                            {isPallet ? (
                              <span className="rounded-full bg-[#fff7ed] px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-[#ff6900]">Pallet</span>
                            ) : null}
                            {insidePalletLabel ? (
                              <span className="rounded-full bg-blue-50 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-blue-700">
                                Inside pallet {insidePalletLabel}
                              </span>
                            ) : null}
                          </div>
                          <span className={`w-fit rounded-full px-2.5 py-1 text-xs font-semibold ${labelReady ? "bg-emerald-50 text-emerald-700" : "bg-red-50 text-red-600"}`}>
                            {isPallet ? (labelReady ? "Pallet Label Ready" : "Pallet Label Missing") : (labelReady ? "FBA Label Ready" : "FBA Label Missing")}
                          </span>
                        </div>

                        <div className="mt-3 grid grid-cols-2 gap-2 text-xs sm:grid-cols-5">
                          {(isPallet
                            ? [
                                { label: "Status", value: getBoxDisplayStatus(box, viewStatus) },
                                { label: "Pallet Dimensions", value: dimensions },
                                { label: "Pallet Weight", value: `${boxWeight || 0} kg` },
                                { label: "Boxes Inside", value: `${palletChildren.length} box${palletChildren.length !== 1 ? "es" : ""}` },
                                { label: "Pallet FBA Label", value: labelReady ? "Uploaded" : "Missing" },
                              ]
                            : [
                                { label: "Status", value: getBoxDisplayStatus(box, viewStatus) },
                                { label: "Dimensions", value: dimensions },
                                { label: "Weight", value: `${boxWeight || 0} kg` },
                                { label: "SKU", value: boxSku || "Pending" },
                                { label: "Qty", value: totalQty !== "" ? totalQty : "Pending" },
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
                                {palletChildren.length} box{palletChildren.length !== 1 ? "es" : ""}
                              </span>
                            </div>
                            {palletChildren.length ? (
                              <div className="space-y-2">
                                {palletChildren.map((childBox, childIndex) => {
                                  const childDimensions = getBoxDimensions(childBox);
                                  const childWeight = getBoxWeight(childBox);
                                  const childRows = getBoxRowsForViewItem(childBox, childIndex, lineItem);
                                  const childSummary = getBoxRowsSummary(childRows);
                                  const childLabelReady = isBoxFbaLabelUploaded(childBox, viewShipmentFiles);

                                  return (
                                    <div key={getBoxRecordId(childBox) || getBoxId(childBox) || childIndex} className="rounded-md border border-[#e8eef7] bg-[#f8fbff] px-3 py-2">
                                      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                                        <div className="min-w-0">
                                          <p className="text-sm font-semibold text-[#132347]">{getBoxTitle(childBox, childIndex)}</p>
                                          <p className="mt-1 text-xs text-[#64748b]">
                                            {[childDimensions, childWeight ? `${childWeight} kg` : "", childSummary].filter(Boolean).join(" - ") || "Box details pending"}
                                          </p>
                                        </div>
                                        <span className={`w-fit rounded-full px-2.5 py-1 text-xs font-semibold ${childLabelReady ? "bg-emerald-50 text-emerald-700" : "bg-red-50 text-red-600"}`}>
                                          {childLabelReady ? "FBA Label Ready" : "FBA Label Missing"}
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
                        ) : displayRows.length ? (
                          <div className="mt-3 rounded-md border border-gray-200 bg-white">
                            {displayRows.map((row, rowIndex) => (
                              <div key={row?.id || row?.shipmentItemId || rowIndex} className="flex items-center justify-between gap-3 border-b border-gray-100 px-3 py-2 text-xs last:border-b-0">
                                <span className="font-medium text-[#132347]">SKU: {String(row?.sku || "").trim() || "Pending"}</span>
                                <span className="text-gray-600">Qty: {row?.quantity !== "" ? row.quantity : "Pending"}</span>
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
                            <p className="mt-1 text-xs text-gray-500">{labelReady ? "Label file not returned." : "No label uploaded."}</p>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                };

                return (
                  <>
                    <div className="flex items-center justify-between border-b border-gray-200 px-6 py-4">
                      <h3 className="text-lg font-semibold text-gray-900">{viewReference || "-"}</h3>
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => loadShipmentViewDetail(viewShipment)}
                          disabled={isViewShipmentLoading}
                          className="rounded-lg border border-gray-200 px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-60"
                          aria-label="Refresh shipment details"
                          title="Refresh shipment details"
                        >
                          <RefreshCw size={14} className={isViewShipmentLoading ? "animate-spin" : ""} />
                        </button>
                        <button onClick={closeShipmentView} className="rounded-lg p-1 hover:bg-gray-100">
                          <X size={20} />
                        </button>
                      </div>
                    </div>

                    <div className="space-y-4 p-6 text-sm text-gray-700">
                      <div className="grid grid-cols-1 gap-3 rounded-lg border border-gray-200 bg-gray-50 p-4 md:grid-cols-3">
                        <p>Status: <span className="font-medium text-gray-900">{viewStatus}</span></p>
                        <p>Expected Arrival: <span className="font-medium text-gray-900">{expectedArrival || "-"}</span></p>
                        <p>Units: <span className="font-medium text-gray-900">{viewUnits !== "" ? viewUnits : "-"}</span></p>
                      </div>

                      {viewShipmentError ? (
                        <p className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                          {viewShipmentError}
                        </p>
                      ) : null}

                      <div>
                        <p className="mb-2 font-medium text-gray-900">Order Data</p>
                        <div className="grid grid-cols-1 gap-3 rounded-lg border border-gray-200 bg-gray-50 p-4 md:grid-cols-3">
                          <p><span className="text-xs uppercase text-gray-500">Tracking</span><br /><span className="font-medium text-gray-900">{orderData.tracking || "-"}</span></p>
                          <p><span className="text-xs uppercase text-gray-500">Boxes</span><br /><span className="font-medium text-gray-900">{orderData.boxes || 0}</span></p>
                          <p><span className="text-xs uppercase text-gray-500">Pallets</span><br /><span className="font-medium text-gray-900">{orderData.pallets || 0}</span></p>
                        </div>
                      </div>

                      {shipmentNotes ? (
                        <div>
                          <p className="mb-2 font-medium text-gray-900">Notes</p>
                          <p className="whitespace-pre-line rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-sm text-gray-700">{shipmentNotes}</p>
                        </div>
                      ) : null}

                      {allServiceLabels.length ? (
                        <div>
                          <p className="mb-2 font-medium text-gray-900">Services</p>
                          <p className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-sm font-medium text-gray-900">
                            {allServiceLabels.join(", ")}
                          </p>
                        </div>
                      ) : null}

                      <div>
                        <p className="mb-2 font-medium text-gray-900">Items</p>
                        {viewLineItems.length ? (
                          <div className="space-y-3">
                            {viewLineItems.map((item, index) => {
                              const itemSelectedServices = getLineItemServices(item, standardServiceTasks, itemCount);
                              const selectedServiceKeys = new Set(
                                itemSelectedServices.map((service) => normalizeServiceKey(service)).filter(Boolean)
                              );
                              const itemServiceTasks = itemSelectedServices.length
                                ? standardServiceTasks.filter((service) => {
                                    const serviceKey = normalizeServiceKey(getServiceTaskLabel(service));
                                    return (
                                      isServiceTaskForItem(service, item, itemCount) &&
                                      shouldDisplayServiceTaskForItem(service, item) &&
                                      serviceKey &&
                                      selectedServiceKeys.has(serviceKey)
                                    );
                                  })
                                : [];
                              const itemCustomServices = viewCustomServices.filter((service) => isCustomServiceForItem(service, item, itemCount));
                              const itemServices = [
                                ...new Set(
                                  [
                                    ...itemSelectedServices,
                                    ...itemCustomServices.map((service) => service.name),
                                  ]
                                    .map((service) => String(formatServiceLabel(service) || "").trim())
                                    .filter(Boolean)
                                ),
                              ];
                              const itemServiceTaskRows = [
                                ...itemServiceTasks,
                                ...itemServices
                                  .filter((serviceName) => {
                                    const serviceKey = normalizeServiceKey(serviceName);
                                    return serviceKey && !itemServiceTasks.some((service) => normalizeServiceKey(getServiceTaskLabel(service)) === serviceKey);
                                  })
                                  .map((serviceName, serviceIndex) => {
                                    const matchedTask = getServiceTaskForLine(serviceName, item, standardServiceTasks, itemCount);
                                    if (matchedTask) return matchedTask;

                                    const completedByShipmentStatus = ["prepped", "dispatched", "completed"].includes(String(viewStatus || "").toLowerCase());
                                    return {
                                      id: `fallback-${getLineItemId(item) || getItemSku(item) || index}-${serviceIndex}`,
                                      serviceType: serviceName,
                                      service_type: serviceName,
                                      name: serviceName,
                                      status: completedByShipmentStatus ? "DONE" : "PENDING",
                                      shipmentItemId: getShipmentLineItemId(item) || getLineItemId(item),
                                      shipment_item_id: getShipmentLineItemId(item) || getLineItemId(item),
                                      sku: getItemSku(item),
                                    };
                                  }),
                              ];
                              const labelFile = itemLabelFiles[index] || findLineItemLabelFile(item, viewShipmentFiles, itemCount, index);
                              const labelFileName = getItemLabelFileName(item);
                              const labelFileUrl = labelFile ? resolveFileUrl(getFileUrl(labelFile)) : "";
                              const labelFileIsImage = Boolean(labelFile && labelFileUrl && isImageFile(labelFile));
                              const itemOutboundBoxes = getBoxesForViewItem(item);
                              const itemOutboundPallets = getPalletsForViewItem(item);
                              const itemBundleSize = getViewItemBundleSize(item, viewBundleSizeEntries);
                              const itemBundleSizeDisplay = itemBundleSize || "-";

                              return (
                                <div key={getLineItemId(item) || getItemSku(item) || index} className="rounded-lg border border-gray-200 bg-gray-50 p-4">
                                  <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
                                    <p><span className="text-xs uppercase text-gray-500">Product</span><br /><span className="font-medium text-gray-900">{getItemName(item) || "-"}</span></p>
                                    <p><span className="text-xs uppercase text-gray-500">SKU</span><br /><span className="font-medium text-gray-900">{getItemSku(item) || "-"}</span></p>
                                    <p><span className="text-xs uppercase text-gray-500">FNSKU</span><br /><span className="font-medium text-gray-900">{getItemFnsku(item) || "-"}</span></p>
                                    <p><span className="text-xs uppercase text-gray-500">Expected Qty</span><br /><span className="font-medium text-gray-900">{getLineItemExpectedQty(item) || 0}</span></p>
                                    <p><span className="text-xs uppercase text-gray-500">Bundle Size</span><br /><span className="font-medium text-gray-900">{itemBundleSizeDisplay}</span></p>
                                    <p><span className="text-xs uppercase text-gray-500">Services</span><br /><span className="font-medium text-gray-900">{itemServices.length ? itemServices.join(", ") : "-"}</span></p>
                                    <p>
                                      <span className="text-xs uppercase text-gray-500">FNSKU Label PDF / CSV</span><br />
                                      {labelFile ? (
                                        <span className="mt-1 block space-y-2">
                                          {labelFileIsImage ? (
                                            <button type="button" onClick={() => openOrDownloadFile(labelFile)} className="block overflow-hidden rounded-md border border-gray-200 bg-white">
                                              <img
                                                src={labelFileUrl}
                                                alt={getFileName(labelFile)}
                                                className="h-24 w-36 object-contain"
                                                onError={(event) => {
                                                  event.currentTarget.style.display = "none";
                                                }}
                                              />
                                            </button>
                                          ) : null}
                                          {labelFileUrl ? (
                                            <button
                                              type="button"
                                              onClick={() => openOrDownloadFile(labelFile)}
                                              className="break-all text-left font-medium text-[#ff6900] hover:text-[#e55d00]"
                                            >
                                              {getFileName(labelFile)}
                                            </button>
                                          ) : (
                                            <span className="font-medium text-gray-900">{getFileName(labelFile)}</span>
                                          )}
                                        </span>
                                      ) : isViewShipmentLoading ? (
                                        <span className="font-medium text-gray-500">Loading label...</span>
                                      ) : (
                                        <span className="font-medium text-gray-900">{labelFileName || "-"}</span>
                                      )}
                                    </p>
                                  </div>

                                  <div className="mt-4 space-y-4 border-t border-gray-200 pt-4">
                                    <div>
                                      <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500">Service Tasks</p>
                                      {itemServiceTaskRows.length ? (
                                        <div className="space-y-2">
                                          {itemServiceTaskRows.map((service, serviceIndex) => {
                                            const serviceLabel = getServiceTaskLabel(service) || "Service Task";

                                            return (
                                              <div key={service?.id || service?.taskId || service?.task_id || `${serviceLabel}-${serviceIndex}`} className="rounded-lg border border-gray-200 bg-white px-3 py-2">
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
                                      ) : (
                                        <p className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-xs text-gray-600">No service tasks linked to this item.</p>
                                      )}
                                    </div>

                                    <div>
                                      <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500">Outbound Boxes</p>
                                      {itemOutboundBoxes.length ? (
                                        <div className="space-y-2">
                                          {itemOutboundBoxes.map(({ box, boxIndex }) => renderViewBoxCard(box, boxIndex, item))}
                                        </div>
                                      ) : (
                                        <p className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-xs text-gray-600">No outbound boxes linked to this item.</p>
                                      )}
                                    </div>

                                    <div>
                                      <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500">Outbound Pallets</p>
                                      {itemOutboundPallets.length ? (
                                        <div className="space-y-2">
                                          {itemOutboundPallets.map(({ box, boxIndex }) => renderViewBoxCard(box, boxIndex, item))}
                                        </div>
                                      ) : (
                                        <p className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-xs text-gray-600">No outbound pallets linked to this item.</p>
                                      )}
                                    </div>

                                    {itemCustomServices.length ? (
                                      <div>
                                        <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500">Custom Services</p>
                                        <div className="space-y-2">
                                          {itemCustomServices.map((service, serviceIndex) => (
                                            <div key={service.id || serviceIndex} className="rounded-lg border border-gray-200 bg-white px-3 py-2">
                                              <div className="flex items-center justify-between gap-3">
                                                <div>
                                                  <p className="font-medium text-gray-900">{service.name}</p>
                                                  <p className="text-xs text-gray-500">SKU {service.sku || getItemSku(item) || "-"}</p>
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

                      <div>
                        <p className="mb-2 font-medium text-gray-900">Outbound Boxes</p>
                        {(() => {
                          const unassignedShipmentBoxes = getUnassignedViewBoxes();
                          if (unassignedShipmentBoxes.length) {
                            return (
                              <div className="space-y-3">
                                {unassignedShipmentBoxes.map(({ box, boxIndex }) => renderViewBoxCard(box, boxIndex))}
                              </div>
                            );
                          }

                          return (
                            <p className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-xs text-gray-600">
                              {viewShipmentBoxes.length ? "All outbound boxes are shown under their product SKU." : "No boxes returned."}
                            </p>
                          );
                        })()}
                      </div>
                    </div>
                  </>
                );
              })()}
            </div>
          </div>
        ) : null}

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
                            selectable ? "bg-white" : "bg-gray-50 text-gray-400"
                          }`}
                        >
                          <input
                            type="checkbox"
                            checked={Boolean(selection.selected)}
                            disabled={!selectable}
                            onChange={(event) => handleSubShipmentSelectionChange(availabilityItem, "selected", event.target.checked)}
                            className="h-4 w-4 accent-[#ff6900] disabled:cursor-not-allowed"
                          />
                          <div className="min-w-0">
                            <p className="truncate font-semibold text-[#132347]">{getAvailabilityProductName(availabilityItem) || "-"}</p>
                            <p className="text-xs text-[#64748b]">
                              SKU {getAvailabilitySku(availabilityItem) || "-"} - Prepared {prepared ? "Yes" : "No"}
                            </p>
                          </div>
                          <span className="font-medium text-[#132347]">{formatQuantityValue(availableQty)}</span>
                          <input
                            type="number"
                            min="1"
                            step="1"
                            max={availableQty}
                            value={selection.quantity || ""}
                            disabled={!selectable}
                            onChange={(event) => handleSubShipmentSelectionChange(availabilityItem, "quantity", event.target.value)}
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
                    "Create"
                  )}
                </button>
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
                    ? `${boxType === "pallet" ? "Add Pallet" : "Add Box"} - ${getSubShipmentReference(activeSubShipmentForBox)}`
                    : "Add Box / Pallet"}
                </h3>
                <button
                  type="button"
                  onClick={() => {
                    if (isCreatingBox) return;
                    setShowAddBoxModal(false);
                    setActiveSubShipmentIdForBox("");
                    resetAddBoxSkuSelection();
                    setSelectedPalletBoxIds([]);
                    setPalletNumber("");
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
                        const nextBoxType = e.target.value;
                        setBoxType(nextBoxType);
                        if (nextBoxType !== "pallet") {
                          setSelectedPalletBoxIds([]);
                          setPalletNumber("");
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
                      {boxType === "pallet" ? "Boxes with FBA labels" : "Size"}
                    </label>
                    {boxType === "pallet" ? (
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
                                      {[getBoxDimensions(box), getBoxWeight(box) ? `${getBoxWeight(box)} kg` : "", getBoxSkuSummary(box, files)].filter(Boolean).join(" - ") || "Ready for pallet"}
                                    </span>
                                  </span>
                                </label>
                              );
                            })}
                          </div>
                        ) : (
                          <p className="px-2 py-3 text-xs text-gray-500">
                            No eligible labeled loose boxes are available for this {activeSubShipmentForBox ? "sub-shipment" : "shipment"}.
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
                {boxType === "pallet" && selectedPalletBoxes.length ? (
                  <div className="rounded-lg border border-[#ffe1c2] bg-[#fff7ef] px-3 py-2 text-xs text-[#8a4a12]">
                    {selectedPalletBoxes.length} box{selectedPalletBoxes.length !== 1 ? "es" : ""} selected for this pallet.
                  </div>
                ) : null}
                {boxType === "pallet" ? (
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
                ) : null}
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
                {boxType !== "pallet" ? (
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
                            {getItemSku(item) || getLineItemId(item) || "-"}
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
                      placeholder={selectedBoxLineItem && selectedBoxMaxQuantity <= 0 ? "0" : selectedBoxMaxQuantity ? formatQuantityValue(selectedBoxMaxQuantity) : "Qty"}
                      disabled={Boolean(selectedBoxLineItem) && selectedBoxMaxQuantity <= 0}
                      className="min-w-0 w-full rounded-lg border border-gray-200 px-3 py-2.5 text-sm disabled:bg-gray-100 disabled:text-gray-400"
                    />
                  </div>
                  {selectedBoxLineItem ? (
                    <p className="mt-2 text-[11px] font-medium text-[#6b7a93]">
                      {activeSubShipmentForBox ? "Planned" : "Boxable"} {formatQuantityValue(selectedBoxBoxableQty)} units, already boxed {formatQuantityValue(selectedBoxAllocatedQty)}, available {formatQuantityValue(selectedBoxMaxQuantity)}.
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
                                onChange={(e) => handleBoxSkuExtraRowChange(rowIndex, "lineItemValue", e.target.value)}
                                className="min-w-0 w-full truncate rounded-lg border border-gray-200 bg-white px-3 py-2.5 text-sm"
                              >
                                <option value="">Select SKU</option>
                                {boxSelectionLineItems.map((item, index) => {
                                  const optionValue = getLineItemOptionValue(item);
                                  const availableQty = getLineItemAllocatableQuantity(item, boxSelectionBoxes, boxSelectionLineItems);

                                  return (
                                    <option key={optionValue || index} value={optionValue} disabled={availableQty <= 0 || isBoxSkuOptionSelectedElsewhere(optionValue, visualRowIndex)}>
                                      {getItemSku(item) || getLineItemId(item) || "-"}
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
                                onChange={(e) => handleBoxSkuExtraRowChange(rowIndex, "quantity", e.target.value)}
                                placeholder={rowLineItem && rowMaxQuantity <= 0 ? "0" : rowMaxQuantity ? formatQuantityValue(rowMaxQuantity) : "Qty"}
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
                                {activeSubShipmentForBox ? "Planned" : "Boxable"} {formatQuantityValue(rowBoxableQty)} units, already boxed {formatQuantityValue(rowAllocatedQty)}, available {formatQuantityValue(rowMaxQuantity)}.
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
                {boxType !== "pallet" ? (
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
                  type="button"
                  onClick={() => {
                    if (isCreatingBox) return;
                    setShowAddBoxModal(false);
                    setActiveSubShipmentIdForBox("");
                    resetAddBoxSkuSelection();
                    setSelectedPalletBoxIds([]);
                    setPalletNumber("");
                  }}
                  disabled={isCreatingBox}
                  className="rounded-lg border border-gray-300 px-4 py-2 text-sm text-gray-700 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  disabled={isCreatingBox}
                  aria-busy={isCreatingBox}
                  onClick={async () => {
                    const created = await handleCreateBox(boxType === "pallet");
                    if (created) {
                      setShowAddBoxModal(false);
                      setActiveSubShipmentIdForBox("");
                      resetAddBoxSkuSelection();
                      setSelectedPalletBoxIds([]);
                      setPalletNumber("");
                    }
                  }}
                  className="inline-flex min-w-[96px] items-center justify-center gap-2 rounded-lg bg-[#ff9d3a] px-5 py-2 text-sm font-semibold text-white hover:bg-[#f28a18] disabled:cursor-not-allowed disabled:opacity-70"
                >
                  {isCreatingBox ? (
                    <>
                      <RefreshCw size={14} className="animate-spin" />
                      {boxType === "pallet" ? "Add Pallet..." : "Add Box..."}
                    </>
                  ) : (
                    boxType === "pallet" ? "Add Pallet" : "Add Box"
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
    </LayoutStaff>
  );
};

export default ShipmentsStaff;
