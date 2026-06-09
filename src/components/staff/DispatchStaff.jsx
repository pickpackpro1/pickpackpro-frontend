import { useEffect, useMemo, useState } from "react";
import { CheckCircle2, Download, Filter, Package, RefreshCw, Search, Send, Tag, Truck } from "lucide-react";
import LayoutStaff from "./stafflayout/LayoutStaff";
import LoadingState from "../common/LoadingState";
import FullPageLoader from "../common/FullPageLoader";
import { getSession } from "../../utils/auth";
import { useNavigate } from "react-router-dom";
import { API_MUTATION_EVENT_NAME } from "../../utils/toast";

const API_BASE_URL = '';

const buildHeaders = (includeJson = false) => {
  const session = getSession();
  const headers = {};

  if (session?.token) {
    headers["Authorization"] = `Bearer ${session.token}`;
  }

  if (includeJson) headers["Content-Type"] = "application/json";
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
        (typeof payload === "string" ? payload : "") ||
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
    if (currentValue === 0) return true;
    if (currentValue === false) return true;
    return currentValue !== undefined && currentValue !== null && String(currentValue).trim() !== "";
  });

  return value === undefined || value === null ? "" : value;
};

const extractShipments = (payload) => {
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload?.shipments)) return payload.shipments;
  if (Array.isArray(payload?.data?.rows)) return payload.data.rows;
  if (Array.isArray(payload?.data)) return payload.data;
  return [];
};

const extractShipmentDetail = (payload) =>
  payload?.shipment ||
  payload?.data?.shipment ||
  payload?.data?.record ||
  payload?.data?.row ||
  payload?.record ||
  payload?.row ||
  payload?.data ||
  payload ||
  {};

const extractBoxes = (payload) => {
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload?.boxes)) return payload.boxes;
  if (Array.isArray(payload?.outbound_boxes)) return payload.outbound_boxes;
  if (Array.isArray(payload?.outboundBoxes)) return payload.outboundBoxes;
  if (Array.isArray(payload?.data?.boxes)) return payload.data.boxes;
  if (Array.isArray(payload?.data?.outbound_boxes)) return payload.data.outbound_boxes;
  if (Array.isArray(payload?.data?.outboundBoxes)) return payload.data.outboundBoxes;
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
  subShipment?.id || subShipment?.uuid || subShipment?.subShipmentId || subShipment?.sub_shipment_id || "";

const getSubShipmentReference = (subShipment = {}) =>
  subShipment?.reference ||
  subShipment?.subShipmentReference ||
  subShipment?.sub_shipment_reference ||
  (subShipment?.sequence_no ? `Sub-shipment ${subShipment.sequence_no}` : "") ||
  getSubShipmentId(subShipment) ||
  "";

const getSubShipmentBoxes = (subShipment = {}) =>
  getBoxes(subShipment);

const extractFiles = (payload) => {
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload?.files)) return payload.files;
  if (Array.isArray(payload?.data?.files)) return payload.data.files;
  if (Array.isArray(payload?.data?.rows)) return payload.data.rows;
  if (Array.isArray(payload?.data)) return payload.data;
  if (payload?.file && typeof payload.file === "object") return [payload.file];
  if (payload?.data?.file && typeof payload.data.file === "object") return [payload.data.file];
  return [];
};

const getBoxId = (box) => box?.id || box?.uuid || box?.boxId || box?.box_id || "";

const getBoxLookupIds = (box = {}) => [
  ...new Set(
    [box?.id, box?.uuid, box?.boxId, box?.box_id, box?.recordId, box?.record_id]
      .map((value) => String(value || "").trim())
      .filter(Boolean)
  ),
];

const getShipmentLookupId = (shipment = {}) =>
  shipment?.id ||
  shipment?.uuid ||
  shipment?.shipmentId ||
  shipment?.shipment_id ||
  shipment?.reference ||
  shipment?.shipmentNumber ||
  shipment?.shipment_number ||
  "";

const getLineItemId = (item = {}) =>
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

const getLineItemQuantity = (item = {}) =>
  firstPresent(
    item?.receivedQty,
    item?.received_qty,
    item?.receivedQuantity,
    item?.received_quantity,
    item?.quantity,
    item?.qty,
    item?.units,
    item?.expectedQty,
    item?.expected_qty,
    item?.expectedQuantity,
    item?.expected_quantity
  );

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
      ""
  ).toLowerCase();

const getFileTypeValue = (file = {}) =>
  String(file?.fileType || file?.file_type || file?.type || file?.mimeType || file?.mime_type || "").toLowerCase();

const getBoxFiles = (box = {}) =>
  extractFiles(box?.files || box?.attachments || box?.uploads || box?.labels || box?.fbaLabels || box?.fba_labels);

const isFbaLabelFile = (file = {}) => {
  const type = getFileTypeValue(file);
  const name = getFileName(file);

  return (
    type === "fba_shipping_label" ||
    type === "fba_label" ||
    type.includes("fba_shipping_label") ||
    type.includes("fba") ||
    name.includes("fba") ||
    name.includes("shipping-label") ||
    name.includes("shipping_label")
  );
};

const normalizeBoxLabelFile = (file = {}, boxId = "") => ({
  ...file,
  entityType: file?.entityType || file?.entity_type || "box",
  entity_type: file?.entity_type || file?.entityType || "box",
  entityId: file?.entityId || file?.entity_id || boxId,
  entity_id: file?.entity_id || file?.entityId || boxId,
  boxId: file?.boxId || file?.box_id || boxId,
  box_id: file?.box_id || file?.boxId || boxId,
  fileType: file?.fileType || file?.file_type || "fba_shipping_label",
  file_type: file?.file_type || file?.fileType || "fba_shipping_label",
});

const getBoxLabelUploaded = (box = {}) =>
  Boolean(
      box?.labelReady ||
      box?.label_ready ||
      box?.fbaLabelUploaded ||
      box?.fba_label_uploaded ||
      box?.fba_shipping_label_file_id ||
      box?.label_uploaded_at ||
      box?.labelUploaded ||
      box?.label_uploaded ||
      String(box?.status || "").toLowerCase() === "uploaded" ||
      getBoxFiles(box).some(isFbaLabelFile)
  );

const normalizeStatusValue = (value = "") =>
  String(value || "").trim().toLowerCase().replace(/\s+/g, "_");

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
    "";

  if (shipmentStatus === "completed" || shipmentStatus === "complete" || boxStatus === "completed" || boxStatus === "complete") {
    return "completed";
  }

  if (
    boxStatus === "dispatched" ||
    boxStatus === "sealed" ||
    Boolean(dispatchedAt)
  ) {
    return "dispatched";
  }

  return "";
};

const getDispatchAction = ({ dispatchState, fbaLabelUploaded }) => {
  if (dispatchState === "completed") return "Completed";
  if (dispatchState === "dispatched") return "Dispatched";
  return fbaLabelUploaded ? "Dispatch" : "Chase Client";
};

const hydrateBoxesWithLabelFiles = async (boxes = []) => {
  if (!boxes.length) return [];

  const boxFileResults = await Promise.allSettled(
    boxes.map(async (box) => {
      const primaryBoxId = getBoxId(box);
      const lookupIds = getBoxLookupIds(box).filter((boxId, index, values) => values.indexOf(boxId) === index);
      if (!lookupIds.length) return [];

      const fileResults = await Promise.allSettled(
        lookupIds.map(async (boxId) => {
          const filesResponse = await fetch(`${API_BASE_URL}/api/files?entityType=box&entityId=${encodeURIComponent(boxId)}`, {
            method: "GET",
            headers: buildHeaders(),
            cache: "no-store",
          });
          return extractFiles(await parseResponse(filesResponse)).map((file) => normalizeBoxLabelFile(file, primaryBoxId || boxId));
        })
      );

      return fileResults.flatMap((result) => (result.status === "fulfilled" ? result.value : []));
    })
  );

  return boxes.map((box, index) => {
    const files = boxFileResults[index]?.status === "fulfilled" ? boxFileResults[index].value : [];
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

const fetchSubShipmentsForDispatch = async (shipmentId = "", shipment = {}) => {
  if (!shipmentId) return extractSubShipments(shipment);

  try {
    const response = await fetch(`${API_BASE_URL}/api/shipments/${encodeURIComponent(shipmentId)}/sub-shipments`, {
      method: "GET",
      headers: buildHeaders(),
      cache: "no-store",
    });
    const payload = await parseResponse(response);
    const subShipments = extractSubShipments(payload);

    const boxResults = await Promise.allSettled(
      subShipments.map(async (subShipment) => {
        const subShipmentId = getSubShipmentId(subShipment);
        if (!subShipmentId) return getSubShipmentBoxes(subShipment);

        try {
          const boxesResponse = await fetch(`${API_BASE_URL}/api/sub-shipments/${encodeURIComponent(subShipmentId)}/boxes`, {
            method: "GET",
            headers: buildHeaders(),
            cache: "no-store",
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
      const boxes = boxResults[index]?.status === "fulfilled" ? boxResults[index].value : getSubShipmentBoxes(subShipment);
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

const getLineItems = (shipment) =>
  shipment?.shipment_line_items ||
  shipment?.shipmentLineItems ||
  shipment?.line_items ||
  shipment?.items ||
  shipment?.lineItems ||
  shipment?.products ||
  shipment?.productItems ||
  shipment?.product_items ||
  [];

const getBoxes = (shipment) =>
  shipment?.boxes || shipment?.shipmentBoxes || shipment?.shipment_boxes || shipment?.outboundBoxes || shipment?.outbound_boxes || [];

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
  const boxLineItemId = String(getBoxItemLineItemId(boxItem) || "").trim();
  const boxSku = String(getBoxItemDirectSku(boxItem) || "").trim().toLowerCase();

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
      .map((value) => String(value || "").trim())
      .filter(Boolean);
    const lineItemSku = String(getLineItemSku(lineItem) || "").trim().toLowerCase();

    return Boolean(
      (boxLineItemId && lineItemIds.includes(boxLineItemId)) ||
      (boxSku && lineItemSku && boxSku === lineItemSku)
    );
  });
};

const getBoxItemSku = (item = {}, lineItems = []) => {
  const directSku = getBoxItemDirectSku(item);

  if (directSku) return directSku;
  return getLineItemSku(findLineItemForBoxItem(item, lineItems) || {});
};

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

const parseBoxContents = (value) => {
  if (Array.isArray(value)) return value;
  if (!value) return [];
  if (typeof value === "object") return [value];

  const rawValue = String(value || "").trim();
  if (!rawValue) return [];

  try {
    const parsedValue = JSON.parse(rawValue);
    if (Array.isArray(parsedValue)) return parsedValue;
    if (parsedValue && typeof parsedValue === "object") return [parsedValue];
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
  return (getBoxItemLineItemId(box) || getBoxItemDirectSku(box)) && inlineQuantity !== "" ? [box] : [];
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

const enrichBoxWithItems = async (box = {}) => {
  const existingItems = getBoxItems(box);
  const hasUsableItems = existingItems.some((item) => (getBoxItemLineItemId(item) || getBoxItemSku(item)) && getBoxItemQuantity(item) !== "");
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
  return results.map((result, index) => (result.status === "fulfilled" ? result.value : boxList[index]));
};

const getReference = (shipment) => shipment?.reference || shipment?.shipmentNumber || shipment?.shipment_number || shipment?.id || "N/A";

const getClientName = (shipment) =>
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
  "-";

const formatBoxContents = (shipment, box) => {
  const lineItems = getLineItems(shipment);
  const boxItems = getBoxItems(box);
  const contentRows = boxItems
    .map((boxItem) => {
      const matchedLineItem = findLineItemForBoxItem(boxItem, lineItems);
      const sku = firstPresent(getBoxItemSku(boxItem, lineItems), getLineItemSku(matchedLineItem || {}));
      const quantity = firstPresent(getBoxItemQuantity(boxItem), getLineItemQuantity(matchedLineItem || {}));

      if (sku && quantity !== "") return `${sku} x ${quantity}`;
      if (sku) return sku;
      if (quantity !== "") return `${quantity} units`;
      return "";
    })
    .filter(Boolean);

  if (contentRows.length) return contentRows.join(", ");

  const directSku = getBoxItemDirectSku(box);
  const directQuantity = getBoxItemQuantity(box);
  if (directSku && directQuantity !== "") return `${directSku} x ${directQuantity}`;
  if (directSku) return directSku;
  if (directQuantity !== "") return `${directQuantity} units`;

  const firstShipmentItem = lineItems[0];
  if (lineItems.length === 1 && firstShipmentItem) {
    const sku = getLineItemSku(firstShipmentItem);
    const quantity = getLineItemQuantity(firstShipmentItem);
    if (sku && quantity !== "") return `${sku} x ${quantity}`;
    if (sku) return sku;
    if (quantity !== "") return `${quantity} units`;
  }

  return "--";
};

const enrichShipmentForDispatch = async (shipment) => {
  const shipmentId = getShipmentLookupId(shipment);
  let shipmentDetail = shipment;
  let boxes = shipment?.boxes || shipment?.shipmentBoxes || shipment?.shipment_boxes || [];

  if (shipmentId && !getLineItems(shipmentDetail).length) {
    try {
      const detailResponse = await fetch(`${API_BASE_URL}/api/shipments/${encodeURIComponent(shipmentId)}`, {
        method: "GET",
        headers: buildHeaders(),
        cache: "no-store",
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

  if (!boxes.length) {
    boxes = getBoxes(shipmentDetail);
  }

  if (shipmentId && !boxes.length) {
    try {
      const boxesResponse = await fetch(`${API_BASE_URL}/api/shipments/${encodeURIComponent(shipmentId)}/boxes`, {
        method: "GET",
        headers: buildHeaders(),
        cache: "no-store",
      });
      boxes = extractBoxes(await parseResponse(boxesResponse));
    } catch {
      boxes = shipment?.boxes || shipment?.shipmentBoxes || shipment?.shipment_boxes || [];
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

const normalizeDispatchShipment = (shipment) => {
  const status = String(shipment?.status || "draft").toLowerCase();
  const reference = getReference(shipment);
  const shipmentId = shipment?.id || shipment?.uuid || reference;
  const client = getClientName(shipment);
  const boxes = getBoxes(shipment);
  const subShipments = extractSubShipments(shipment);
  const parentRows = boxes.map((box) => ({ box, subShipment: null }));
  const subShipmentRows = subShipments.flatMap((subShipment) =>
    getSubShipmentBoxes(subShipment).map((box) => ({ box, subShipment }))
  );
  const normalizedBoxes = parentRows.length || subShipmentRows.length ? [...parentRows, ...subShipmentRows] : [{ box: {}, subShipment: null }];

  return normalizedBoxes.map(({ box, subShipment }, index) => {
    const subShipmentId = getSubShipmentId(subShipment || {});
    const subShipmentReference = getSubShipmentReference(subShipment || {});
    const boxLabel =
      box?.reference ||
      box?.label ||
      box?.name ||
      box?.boxNumber ||
      box?.box_number ||
      box?.id ||
      (parentRows.length || subShipmentRows.length ? `BOX-${String(index + 1).padStart(2, "0")}` : "--");
    const boxType = box?.boxType || box?.box_type || box?.type || box?.size || box?.boxSize || box?.box_size || "--";
    const weight = Number(box?.weight || box?.weightKg || box?.weight_kg || box?.grossWeight || box?.gross_weight || 0);
    const fbaLabelUploaded = parentRows.length || subShipmentRows.length ? getBoxLabelUploaded(box) : false;
    const dispatchedAt = box?.dispatched_at || box?.dispatchedAt || "";
    const dispatchState = getBoxDispatchState(subShipment || shipment, box);
    const action = getDispatchAction({ dispatchState, fbaLabelUploaded });

    return {
      id: `${shipmentId}-${subShipmentId || "parent"}-${box?.id || boxLabel || index}`,
      boxId: getBoxId(box),
      shipmentId,
      subShipmentId,
      reference,
      subShipment: subShipmentReference || "-",
      client,
      box: boxLabel,
      type: String(boxType).replaceAll("_", " "),
      weight: weight ? `${weight} kg` : "--",
      contents: formatBoxContents(shipment, box),
      status,
      fbaLabelUploaded,
      fbaShippingLabelFileId: box?.fba_shipping_label_file_id || box?.fbaShippingLabelFileId || "",
      labelUploadedAt: box?.label_uploaded_at || box?.labelUploadedAt || "",
      dispatchedAt,
      dispatchState,
      action,
    };
  });
};

const DispatchStaff = () => {
  const [shipments, setShipments] = useState([]);
  const [searchTerm, setSearchTerm] = useState("");
  const [filter, setFilter] = useState("ready");
  const [isLoading, setIsLoading] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [updatingId, setUpdatingId] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const navigate = useNavigate();

  const loadShipments = async ({ silent = false } = {}) => {
    try {
      if (silent) {
        setIsRefreshing(true);
      } else {
        setIsLoading(true);
      }
      setError("");
      const query = new URLSearchParams({ page: "1", limit: "50" });
      const response = await fetch(`${API_BASE_URL}/api/shipments?${query.toString()}`, {
        method: "GET",
        headers: buildHeaders(),
        cache: "no-store",
      });
      const payload = await parseResponse(response);
      const enrichedShipments = await Promise.all(extractShipments(payload).map(enrichShipmentForDispatch));
      setShipments(enrichedShipments.flatMap(normalizeDispatchShipment));
    } catch (requestError) {
      setError(requestError.message);
      if (!silent) setShipments([]);
    } finally {
      if (silent) {
        setIsRefreshing(false);
      } else {
        setIsLoading(false);
      }
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
      const url = String(event?.detail?.url || "");
      if (!url.includes("/api/files") && !url.includes("/api/boxes") && !url.includes("/api/shipments")) return;
      scheduleRefresh();
    };

    window.addEventListener(API_MUTATION_EVENT_NAME, handleMutation);

    return () => {
      window.clearTimeout(refreshTimer);
      window.removeEventListener(API_MUTATION_EVENT_NAME, handleMutation);
    };
  }, []);

  const filteredShipments = useMemo(() => {
    const term = searchTerm.trim().toLowerCase();

    return shipments.filter((shipment) => {
      const matchesSearch =
        !term ||
        shipment.reference.toLowerCase().includes(term) ||
        shipment.subShipment.toLowerCase().includes(term) ||
        shipment.client.toLowerCase().includes(term) ||
        shipment.box.toLowerCase().includes(term) ||
        shipment.type.toLowerCase().includes(term) ||
        shipment.contents.toLowerCase().includes(term) ||
        shipment.status.toLowerCase().includes(term);

      if (!matchesSearch) return false;
      if (filter === "ready") return shipment.action === "Dispatch";
      if (filter === "missing") return shipment.action === "Chase Client";
      if (filter === "dispatched") return shipment.action === "Dispatched" || shipment.action === "Completed";
      return true;
    });
  }, [filter, searchTerm, shipments]);

  const stats = useMemo(() => {
    const ready = shipments.filter((shipment) => shipment.action === "Dispatch").length;
    const missing = shipments.filter((shipment) => shipment.action === "Chase Client").length;
    const dispatched = shipments.filter((shipment) => shipment.action === "Dispatched" || shipment.action === "Completed").length;

    return [
      { label: "Ready to Dispatch", value: ready, icon: CheckCircle2, color: "text-green-600", bg: "bg-green-50" },
      { label: "Needs Workflow", value: missing, icon: Tag, color: "text-orange-600", bg: "bg-orange-50" },
      { label: "Dispatched", value: dispatched, icon: Send, color: "text-teal-600", bg: "bg-teal-50" },
    ];
  }, [shipments]);

  const dispatchBox = async (box) => {
    const boxId = box?.boxId || box?.id || box?.uuid;
    if (!boxId) {
      setError("Box ID missing");
      return;
    }

    try {
      setUpdatingId(boxId);
      setError("");
      setMessage("");
      const payload = await parseResponse(
        await fetch(`${API_BASE_URL}/api/boxes/${encodeURIComponent(boxId)}/seal`, {
          method: "PATCH",
          headers: buildHeaders(true),
          body: JSON.stringify({}),
        })
      );
      const updatedBox = payload?.box || payload?.data?.box || payload?.data || payload || {};
      const dispatchedAt =
        updatedBox?.dispatched_at ||
        updatedBox?.dispatchedAt ||
        updatedBox?.dispatch_date ||
        updatedBox?.dispatchDate ||
        new Date().toISOString();
      const updatedStatus = normalizeStatusValue(updatedBox?.status);
      const nextState = updatedStatus === "completed" || updatedStatus === "complete" ? "completed" : "dispatched";
      const nextAction = getDispatchAction({ dispatchState: nextState, fbaLabelUploaded: true });

      setShipments((currentShipments) =>
        currentShipments.map((shipment) => {
          const shipmentBoxId = String(shipment.boxId || "");
          const shipmentRowId = String(shipment.id || "");
          const requestedBoxId = String(boxId || "");
          const requestedRowId = String(box?.id || "");
          const isTargetBox =
            shipmentBoxId === requestedBoxId ||
            shipmentRowId === requestedBoxId ||
            (requestedRowId && shipmentRowId === requestedRowId);

          if (!isTargetBox) return shipment;

          return {
            ...shipment,
            status: nextState,
            fbaLabelUploaded: true,
            dispatchedAt,
            dispatchState: nextState,
            action: nextAction,
          };
        })
      );
      setMessage("Box dispatched successfully.");
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setUpdatingId("");
    }
  };

  const chaseClient = (shipment) => {
    navigate(`/shipments/${shipment.shipmentId}`);
  };

  const exportQueue = () => {
    const rows = [
      ["Shipment", "Sub-shipment", "Client", "Box", "Type", "Weight", "Contents", "FBA Label", "Action"],
      ...filteredShipments.map((shipment) => [
        shipment.reference,
        shipment.subShipment,
        shipment.client,
        shipment.box,
        shipment.type,
        shipment.weight,
        shipment.contents,
        shipment.fbaLabelUploaded ? "Uploaded" : "Missing",
        shipment.action,
      ]),
    ];
    const csv = rows.map((row) => row.map((value) => `"${String(value).replace(/"/g, '""')}"`).join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "staff-dispatch-queue.csv";
    anchor.click();
    URL.revokeObjectURL(url);
  };

  return (
    <LayoutStaff>
      <FullPageLoader show={isLoading} label="Loading dispatch queue..." />
      <div className="min-h-screen">
        <div className="">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h1 className="text-2xl font-bold text-gray-900 tracking-tight">Dispatch</h1>
              <p className="mt-1 text-sm text-gray-500">Dispatch shipments after receiving, prep, and service tasks are complete.</p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => loadShipments()}
                disabled={isLoading || isRefreshing}
                className="inline-flex items-center gap-2 rounded-lg border border-gray-200 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
              >
                <RefreshCw className={`h-4 w-4 ${isRefreshing ? "animate-spin" : ""}`} />
                {isRefreshing ? "Refreshing" : "Refresh"}
              </button>
              <button
                type="button"
                onClick={exportQueue}
                className="inline-flex items-center gap-2 rounded-lg border border-gray-200 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
              >
                <Download className="h-4 w-4" />
                Export
              </button>
            </div>
          </div>

          {message ? <div className="rounded-lg border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-700">{message}</div> : null}
          {error ? <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div> : null}

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            {stats.map((card) => {
              const Icon = card.icon;
              return (
                <div key={card.label} className="rounded-xl border border-gray-100 bg-white p-5 shadow-sm">
                  <div className="mb-2 flex items-center gap-2">
                    <span className={`rounded-lg p-2 ${card.bg}`}>
                      <Icon className={`h-5 w-5 ${card.color}`} />
                    </span>
                    <span className="text-xs font-semibold uppercase tracking-wider text-gray-500">{card.label}</span>
                  </div>
                  <p className="text-3xl font-bold text-gray-900">{card.value}</p>
                </div>
              );
            })}
          </div>

          <div className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">
            <div className="flex flex-col gap-3 border-b border-gray-200 px-5 py-4 lg:flex-row lg:items-center lg:justify-between">
              <div className="flex items-center gap-2">
                <Truck className="h-5 w-5 text-blue-700" />
                <h2 className="text-lg font-bold text-gray-900">Outbound Queue</h2>
              </div>
              <div className="flex flex-col gap-3 sm:flex-row">
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
                  <input
                    type="text"
                    value={searchTerm}
                    onChange={(event) => setSearchTerm(event.target.value)}
                    placeholder="Search shipments..."
                    className="w-full rounded-lg border border-gray-200 py-2 pl-9 pr-4 text-sm focus:outline-none focus:ring-2 focus:ring-[#ff6900] sm:w-64"
                  />
                </div>
                <div className="relative">
                  <Filter className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
                  <select
                    value={filter}
                    onChange={(event) => setFilter(event.target.value)}
                    className="w-full rounded-lg border border-gray-200 py-2 pl-9 pr-8 text-sm font-medium text-gray-700 focus:outline-none focus:ring-2 focus:ring-[#ff6900]"
                  >
                    <option value="all">All shipments</option>
                    <option value="ready">Ready to dispatch</option>
                    <option value="missing">Needs workflow</option>
                    <option value="dispatched">Dispatched</option>
                  </select>
                </div>
              </div>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full min-w-[900px]">
                <thead>
                  <tr className="bg-gray-50/80 text-left">
                    <th className="px-5 py-4 text-xs font-semibold uppercase tracking-wider text-gray-500">Shipment</th>
                    <th className="px-5 py-4 text-xs font-semibold uppercase tracking-wider text-gray-500">Sub-shipment</th>
                    <th className="px-5 py-4 text-xs font-semibold uppercase tracking-wider text-gray-500">Client</th>
                    <th className="px-5 py-4 text-xs font-semibold uppercase tracking-wider text-gray-500">Box</th>
                    <th className="px-5 py-4 text-xs font-semibold uppercase tracking-wider text-gray-500">Type</th>
                    <th className="px-5 py-4 text-xs font-semibold uppercase tracking-wider text-gray-500">Weight</th>
                    <th className="px-5 py-4 text-xs font-semibold uppercase tracking-wider text-gray-500">Contents</th>
                    <th className="px-5 py-4 text-xs font-semibold uppercase tracking-wider text-gray-500">FBA Label</th>
                    <th className="px-5 py-4 text-xs font-semibold uppercase tracking-wider text-gray-500">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {isLoading ? (
                    <tr>
                      <td colSpan="9" className="px-5 py-10 text-center text-sm text-gray-500">
                        <LoadingState label="Loading dispatch queue..." />
                      </td>
                    </tr>
                  ) : filteredShipments.map((shipment) => {
                    const labelUploaded = Boolean(shipment.fbaShippingLabelFileId || shipment.labelUploadedAt || shipment.fbaLabelUploaded);
                    const dispatchComplete = shipment.action === "Dispatched" || shipment.action === "Completed";
                    const canDispatch = labelUploaded && !dispatchComplete;
                    return (
                      <tr key={shipment.id} className="hover:bg-gray-50/70">
                        <td className="px-5 py-4 text-sm font-bold text-gray-900">{shipment.reference}</td>
                        <td className="px-5 py-4 text-sm font-medium text-gray-700">{shipment.subShipment}</td>
                        <td className="px-5 py-4 text-sm font-semibold text-gray-800">{shipment.client}</td>
                        <td className="px-5 py-4 text-sm font-medium text-gray-700">{shipment.box}</td>
                        <td className="px-5 py-4"><span className="rounded bg-gray-100 px-2 py-1 text-[11px] font-semibold text-gray-600">{shipment.type}</span></td>
                        <td className="px-5 py-4 text-sm font-medium text-gray-700">{shipment.weight}</td>
                        <td className="px-5 py-4 text-sm text-gray-500">{shipment.contents}</td>
                        <td className="px-5 py-4">
                          {labelUploaded ? (
                            <span className="inline-flex items-center gap-1 text-sm font-semibold text-emerald-600">
                              <span className="inline-block h-2 w-2 rounded-full bg-emerald-500" />
                              Uploaded
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 text-sm font-semibold text-red-500">
                              <span className="inline-block h-2 w-2 rounded-full bg-red-500" />
                              Missing
                            </span>
                          )}
                        </td>
                        <td className="px-5 py-4">
                          <button
                            type="button"
                            disabled={dispatchComplete || updatingId === (shipment.boxId || shipment.id)}
                            onClick={() => {
                              if (dispatchComplete) return;

                              if (canDispatch) {
                                dispatchBox(shipment);
                                return;
                              }
                              chaseClient(shipment);
                            }}
                            className={`inline-flex items-center gap-1.5 rounded-lg px-4 py-2 text-sm transition-colors ${
                              dispatchComplete
                                ? "border border-emerald-200 bg-emerald-50 font-semibold text-emerald-700"
                                : canDispatch
                                ? "bg-emerald-600 font-semibold text-white hover:bg-emerald-700"
                                : "border border-[#d1d5db] bg-white font-medium text-[#374151] hover:bg-[#f9fafb]"
                            } ${dispatchComplete || updatingId === (shipment.boxId || shipment.id) ? "cursor-not-allowed opacity-70" : ""}`}
                            title={dispatchComplete ? shipment.action : canDispatch ? "Mark box dispatched" : "Open shipment detail"}
                          >
                            {dispatchComplete ? <CheckCircle2 className="h-3.5 w-3.5" /> : <Send className="h-3.5 w-3.5" />}
                            {updatingId === (shipment.boxId || shipment.id) ? "Updating..." : shipment.action}
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                  {!isLoading && !filteredShipments.length ? (
                    <tr>
                      <td colSpan="9" className="px-5 py-12 text-center">
                        <Package className="mx-auto mb-3 h-9 w-9 text-gray-300" />
                        <p className="text-sm text-gray-500">No shipments found.</p>
                      </td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>
    </LayoutStaff>
  );
};

export default DispatchStaff;
