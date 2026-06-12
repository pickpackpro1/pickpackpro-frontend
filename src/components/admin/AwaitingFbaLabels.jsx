import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { CheckCircle, RefreshCw, Tags, X } from 'lucide-react';
import Layout from './adminlayout/Layout';
import { getSession } from '../../utils/auth';
import { API_MUTATION_EVENT_NAME } from '../../utils/toast';
import {
  getLineItemId as getMappedLineItemId,
  getShipmentItems as getMappedShipmentItems,
  normalizeShipment as normalizeMappedShipment,
  normalizeShipmentList as normalizeMappedShipmentList,
} from '../../utils/shipmentMapper';

const API_BASE_URL = '';
const BACKEND_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'https://ali-backend.vercel.app';
const SAFE_FILE_UPLOAD_BYTES = 3 * 1024 * 1024;
const IMAGE_UPLOAD_MAX_DIMENSION = 2400;
const BOX_ALLOCATION_CACHE_KEY = 'pickpackpro-box-allocation-items-v1';
const ELIGIBLE_STATUS_VALUES = ['submitted', 'pending_arrival', 'received', 'in_progress', 'prepped', 'dispatched'];
const ELIGIBLE_STATUSES = new Set([...ELIGIBLE_STATUS_VALUES, 'pending arrival', 'in progress']);
const INELIGIBLE_STATUS_VALUES = new Set(['draft', 'completed', 'cancelled', 'canceled', 'archived']);
const configuredBoxItemEnrichLimit = Number(import.meta.env.VITE_AWAITING_FBA_BOX_ITEM_ENRICH_LIMIT || 100);
const BOX_ITEM_ENRICH_LIMIT =
  Number.isFinite(configuredBoxItemEnrichLimit) && configuredBoxItemEnrichLimit > 0
    ? configuredBoxItemEnrichLimit
    : 0;
const firstPresent = (...values) => {
  const value = values.find((currentValue) => {
    if (currentValue === 0 || currentValue === false) return true;
    return currentValue !== undefined && currentValue !== null && String(currentValue).trim() !== '';
  });

  return value === undefined || value === null ? '' : value;
};

const toArray = (value) => {
  if (Array.isArray(value)) return value;
  if (value === undefined || value === null || value === '') return [];
  return [value];
};

const buildHeaders = (includeJson = false) => {
  const session = getSession();
  const headers = {};
  if (session?.token) headers.Authorization = `Bearer ${session.token}`;
  if (includeJson) headers['Content-Type'] = 'application/json';
  return headers;
};

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

const extractList = (payload, keys = []) => {
  if (Array.isArray(payload)) return payload;

  let firstEmptyList = null;

  for (const key of keys) {
    if (Array.isArray(payload?.[key])) {
      if (payload[key].length) return payload[key];
      if (!firstEmptyList) firstEmptyList = payload[key];
    }
    if (Array.isArray(payload?.data?.[key])) {
      if (payload.data[key].length) return payload.data[key];
      if (!firstEmptyList) firstEmptyList = payload.data[key];
    }
  }

  if (Array.isArray(payload?.rows)) {
    if (payload.rows.length) return payload.rows;
    if (!firstEmptyList) firstEmptyList = payload.rows;
  }
  if (Array.isArray(payload?.data?.rows)) {
    if (payload.data.rows.length) return payload.data.rows;
    if (!firstEmptyList) firstEmptyList = payload.data.rows;
  }
  if (Array.isArray(payload?.data)) {
    if (payload.data.length) return payload.data;
    if (!firstEmptyList) firstEmptyList = payload.data;
  }
  if (Array.isArray(payload?.results)) {
    if (payload.results.length) return payload.results;
    if (!firstEmptyList) firstEmptyList = payload.results;
  }

  return firstEmptyList || [];
};

const extractShipments = (payload) => normalizeMappedShipmentList(payload);

const extractBoxes = (payload) =>
  extractList(payload, ['outbound_boxes', 'outboundBoxes', 'shipment_boxes', 'shipmentBoxes', 'boxes']);

const extractBoxEndpointRows = (payload) =>
  extractList(payload, ['boxes', 'outbound_boxes', 'outboundBoxes', 'shipment_boxes', 'shipmentBoxes']);

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

const getSubShipmentItems = (subShipment = {}) =>
  extractList(subShipment, [
    'sub_shipment_items',
    'subShipmentItems',
    'items',
    'lineItems',
    'line_items',
    'shipmentItems',
    'shipment_items',
    'products',
    'skus',
  ]);

const decorateSubShipmentBox = (box = {}, subShipment = {}, siblingBoxes = []) => {
  const subShipmentItems = getSubShipmentItems(subShipment);
  const canUseSubShipmentItems =
    !getBoxItems(box).length &&
    subShipmentItems.length &&
    toArray(siblingBoxes).length <= 1;

  return {
    ...box,
    ...(canUseSubShipmentItems
      ? {
          items: subShipmentItems,
          boxItems: subShipmentItems,
          box_items: subShipmentItems,
          boxContents: subShipmentItems,
          box_contents: subShipmentItems,
          contents: subShipmentItems,
        }
      : {}),
    subShipmentId: getSubShipmentId(subShipment),
    sub_shipment_id: getSubShipmentId(subShipment),
    subShipmentReference: getSubShipmentReference(subShipment),
    sub_shipment_reference: getSubShipmentReference(subShipment),
    __subShipmentReference: getSubShipmentReference(subShipment),
  };
};

const extractClients = (payload) =>
  extractList(payload, ['clients', 'clientRows', 'client_rows']);

const extractClientDetail = (payload) =>
  payload?.client ||
  payload?.data?.client ||
  payload?.data?.record ||
  payload?.data?.row ||
  payload?.record ||
  payload?.row ||
  payload?.data ||
  payload ||
  null;

const extractFiles = (payload) => {
  const directFiles = extractList(payload, ['files', 'attachments', 'documents']);
  if (directFiles.length) return directFiles;

  const candidates = [
    payload?.file,
    payload?.data?.file,
    payload?.data?.record,
    payload?.data?.row,
    payload?.record,
    payload?.row,
    payload?.data,
  ].filter(Boolean);

  return candidates.filter((file) => typeof file === 'object' && (getFileUrl(file) || getFileName(file) || getFileRecordId(file)));
};

const extractShipmentDetail = (payload) =>
  payload?.shipment || payload?.data?.shipment || payload?.data?.record || payload?.data?.row || payload?.data || payload || {};

const isUuidValue = (value = '') =>
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(value || '').trim());

const firstUuidValue = (...values) => values.find((value) => isUuidValue(value)) || '';

const getShipmentRecordId = (shipment = {}) =>
  firstUuidValue(shipment?.id, shipment?.uuid, shipment?.shipmentId, shipment?.shipment_id);

const getShipmentId = (shipment = {}) =>
  firstPresent(shipment?.id, shipment?.uuid, shipment?.shipmentId, shipment?.shipment_id, shipment?.reference);

const getShipmentReference = (shipment = {}) =>
  firstPresent(shipment?.reference, shipment?.shipmentNumber, shipment?.shipment_number, shipment?.ref, getShipmentId(shipment));

const getShipmentStatus = (shipment = {}) =>
  String(firstPresent(shipment?.status, shipment?.shipmentStatus, shipment?.shipment_status, 'unknown')).toLowerCase();

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
    shipment?.userId,
    shipment?.user_id,
    shipment?.client?.id,
    shipment?.client?.uuid,
    shipment?.client?.clientId,
    shipment?.client?.client_id,
    shipment?.client?.accountId,
    shipment?.client?.account_id,
    shipment?.client?.userId,
    shipment?.client?.user_id,
    shipment?.clients?.id,
    shipment?.clients?.uuid,
    shipment?.clients?.clientId,
    shipment?.clients?.client_id,
    shipment?.clients?.accountId,
    shipment?.clients?.account_id,
    shipment?.clients?.userId,
    shipment?.clients?.user_id,
    shipment?.clientRecord?.id,
    shipment?.clientRecord?.uuid,
    shipment?.clientRecord?.clientId,
    shipment?.clientRecord?.client_id,
    shipment?.clientRecord?.accountId,
    shipment?.clientRecord?.account_id,
    shipment?.clientRecord?.userId,
    shipment?.clientRecord?.user_id,
    shipment?.client_record?.id,
    shipment?.client_record?.uuid,
    shipment?.rawClient?.id,
    shipment?.rawClient?.uuid,
    shipment?.raw_client?.id,
    shipment?.raw_client?.uuid
  );

const getShipmentClientName = (shipment = {}) =>
  firstPresent(
    shipment?.clientName,
    shipment?.client_name,
    shipment?.client?.companyName,
    shipment?.client?.company_name,
    shipment?.client?.name,
    typeof shipment?.client === 'string' ? shipment.client : '',
    shipment?.companyName,
    shipment?.company_name,
    shipment?.clientRecord?.companyName,
    shipment?.clientRecord?.company_name,
    shipment?.clientRecord?.name,
    shipment?.client_record?.companyName,
    shipment?.client_record?.name,
    shipment?.rawClient?.companyName,
    shipment?.rawClient?.company_name,
    shipment?.rawClient?.name,
    shipment?.clientId,
    shipment?.client_id,
    '-'
  );

const getShipmentClientEmail = (shipment = {}) =>
  firstPresent(
    shipment?.clientEmail,
    shipment?.client_email,
    shipment?.client?.email,
    shipment?.clients?.email,
    shipment?.clientRecord?.email,
    shipment?.client_record?.email,
    shipment?.rawClient?.email,
    shipment?.raw_client?.email,
    shipment?.email
  );

const getClientId = (client = {}) =>
  firstPresent(client?.id, client?.uuid, client?.clientUuid, client?.client_uuid, client?.clientId, client?.client_id);

const getClientRecordId = (client = {}) =>
  firstUuidValue(client?.id, client?.uuid, client?.clientUuid, client?.client_uuid, client?.clientId, client?.client_id);

const getClientName = (client = {}) =>
  firstPresent(
    client?.companyName,
    client?.company_name,
    client?.company,
    client?.clientName,
    client?.client_name,
    client?.name,
    client?.contactName,
    client?.contact_name
  );

const getClientEmail = (client = {}) =>
  firstPresent(client?.email, client?.contactEmail, client?.contact_email);

const normalizeLookupList = (values = []) => [
  ...new Set(
    values
      .map(normalizeLookupValue)
      .filter((value) => value && value !== '-')
  ),
];

const getShipmentClientEmailValues = (shipment = {}) =>
  normalizeLookupList([
    getShipmentClientEmail(shipment),
    shipment?.clientEmail,
    shipment?.client_email,
    shipment?.customerEmail,
    shipment?.customer_email,
    shipment?.email,
    shipment?.client?.email,
    shipment?.clients?.email,
    shipment?.clientRecord?.email,
    shipment?.client_record?.email,
    shipment?.rawClient?.email,
    shipment?.raw_client?.email,
  ]);

const getShipmentClientNameValues = (shipment = {}) =>
  normalizeLookupList([
    getShipmentClientName(shipment),
    shipment?.clientName,
    shipment?.client_name,
    shipment?.clientCompany,
    shipment?.client_company,
    shipment?.companyName,
    shipment?.company_name,
    shipment?.customerName,
    shipment?.customer_name,
    typeof shipment?.client === 'string' ? shipment.client : '',
    shipment?.client?.companyName,
    shipment?.client?.company_name,
    shipment?.client?.name,
    shipment?.clients?.companyName,
    shipment?.clients?.company_name,
    shipment?.clients?.name,
    shipment?.clientRecord?.companyName,
    shipment?.clientRecord?.company_name,
    shipment?.clientRecord?.name,
    shipment?.client_record?.companyName,
    shipment?.client_record?.company_name,
    shipment?.client_record?.name,
    shipment?.rawClient?.companyName,
    shipment?.rawClient?.company_name,
    shipment?.rawClient?.name,
    shipment?.raw_client?.companyName,
    shipment?.raw_client?.company_name,
    shipment?.raw_client?.name,
  ]).filter((value) => !isUuidValue(value) && !value.includes('@'));

const getShipmentClientIdValues = (shipment = {}) =>
  normalizeLookupList([
    getShipmentClientId(shipment),
    shipment?.clientId,
    shipment?.client_id,
    shipment?.clientUuid,
    shipment?.client_uuid,
    shipment?.customerId,
    shipment?.customer_id,
    shipment?.accountId,
    shipment?.account_id,
    shipment?.userId,
    shipment?.user_id,
    shipment?.client?.id,
    shipment?.client?.uuid,
    shipment?.client?.clientId,
    shipment?.client?.client_id,
    shipment?.client?.accountId,
    shipment?.client?.account_id,
    shipment?.client?.userId,
    shipment?.client?.user_id,
    shipment?.clients?.id,
    shipment?.clients?.uuid,
    shipment?.clients?.clientId,
    shipment?.clients?.client_id,
    shipment?.clients?.accountId,
    shipment?.clients?.account_id,
    shipment?.clients?.userId,
    shipment?.clients?.user_id,
    shipment?.clientRecord?.id,
    shipment?.clientRecord?.uuid,
    shipment?.clientRecord?.clientId,
    shipment?.clientRecord?.client_id,
    shipment?.clientRecord?.accountId,
    shipment?.clientRecord?.account_id,
    shipment?.clientRecord?.userId,
    shipment?.clientRecord?.user_id,
    shipment?.client_record?.id,
    shipment?.client_record?.uuid,
    shipment?.client_record?.clientId,
    shipment?.client_record?.client_id,
    shipment?.rawClient?.id,
    shipment?.rawClient?.uuid,
    shipment?.raw_client?.id,
    shipment?.raw_client?.uuid,
  ]);

const getClientEmailValues = (client = {}) =>
  normalizeLookupList([getClientEmail(client), client?.email, client?.contactEmail, client?.contact_email]);

const getClientNameValues = (client = {}) =>
  normalizeLookupList([
    getClientName(client),
    client?.company,
    client?.companyName,
    client?.company_name,
    client?.clientName,
    client?.client_name,
    client?.name,
    client?.contactName,
    client?.contact_name,
  ]).filter((value) => !isUuidValue(value) && !value.includes('@'));

const getClientIdValues = (client = {}) =>
  normalizeLookupList([
    getClientId(client),
    getClientRecordId(client),
    client?.id,
    client?.uuid,
    client?.clientUuid,
    client?.client_uuid,
    client?.clientId,
    client?.client_id,
    client?.accountId,
    client?.account_id,
    client?.userId,
    client?.user_id,
    client?.ownerId,
    client?.owner_id,
    client?.profileId,
    client?.profile_id,
    client?.authUserId,
    client?.auth_user_id,
  ]);

const uniqueUuidValues = (...values) => [
  ...new Set(
    values
      .flat()
      .map((value) => String(value || '').trim())
      .filter(isUuidValue)
  ),
];

const getClientUploadIdCandidates = (client = {}) =>
  uniqueUuidValues(
    getClientRecordId(client),
    client?.id,
    client?.uuid,
    client?.clientUuid,
    client?.client_uuid,
    client?.clientId,
    client?.client_id,
    client?.accountId,
    client?.account_id,
    client?.userId,
    client?.user_id,
    client?.ownerId,
    client?.owner_id,
    client?.profileId,
    client?.profile_id,
    client?.authUserId,
    client?.auth_user_id
  );

const normalizeLookupValue = (value = '') =>
  String(value || '')
    .trim()
    .toLowerCase();

const lookupValuesMatch = (left = '', right = '') => {
  const first = normalizeLookupValue(left);
  const second = normalizeLookupValue(right);
  if (!first || !second || first === '-') return false;
  return first === second || first.includes(second) || second.includes(first);
};

const getClientDedupeKey = (client = {}, fallback = '') =>
  String(getClientRecordId(client) || getClientId(client) || getClientEmail(client) || getClientName(client) || fallback);

const fetchClientRows = async () => {
  const clients = [];
  const seenKeys = new Set();
  const pageSize = 100;

  const addClients = (clientRows = [], page = 0) => {
    let addedCount = 0;
    clientRows.forEach((client, index) => {
      const key = getClientDedupeKey(client, `${page}-${index}`);
      if (seenKeys.has(key)) return;
      seenKeys.add(key);
      clients.push(client);
      addedCount += 1;
    });
    return addedCount;
  };

  try {
    const response = await fetch(`${API_BASE_URL}/api/clients?page=1&limit=${pageSize}`, {
      method: 'GET',
      headers: buildHeaders(),
      cache: 'no-store',
    });
    const firstPageClients = extractClients(await parseResponse(response));
    addClients(firstPageClients, 1);

    for (let page = 2; page <= 10; page += 1) {
      const pageResponse = await fetch(`${API_BASE_URL}/api/clients?page=${page}&limit=${pageSize}`, {
        method: 'GET',
        headers: buildHeaders(),
        cache: 'no-store',
      });
      const pageClients = extractClients(await parseResponse(pageResponse));
      const addedCount = addClients(pageClients, page);
      if (!pageClients.length || addedCount === 0) break;
    }
  } catch {
    try {
      const response = await fetch(`${API_BASE_URL}/api/clients`, {
        method: 'GET',
        headers: buildHeaders(),
        cache: 'no-store',
      });
      addClients(extractClients(await parseResponse(response)));
    } catch {
      return clients;
    }
  }

  return clients;
};

const fetchClientDetailById = async (clientId = '') => {
  const normalizedClientId = String(clientId || '').trim();
  if (!normalizedClientId) return null;

  try {
    const response = await fetch(`${API_BASE_URL}/api/clients/${encodeURIComponent(normalizedClientId)}`, {
      method: 'GET',
      headers: buildHeaders(),
      cache: 'no-store',
    });
    const client = extractClientDetail(await parseResponse(response));
    return client && typeof client === 'object' ? client : null;
  } catch {
    return null;
  }
};

const findClientForShipment = (shipment = {}, clients = []) => {
  const shipmentEmails = getShipmentClientEmailValues(shipment);
  const shipmentNames = getShipmentClientNameValues(shipment);
  const shipmentIds = getShipmentClientIdValues(shipment);

  if (!shipmentEmails.length && !shipmentNames.length && !shipmentIds.length) return null;

  const exactEmailMatch = clients.find((client) =>
    getClientEmailValues(client).some((clientEmail) => shipmentEmails.includes(clientEmail))
  );
  if (exactEmailMatch) return exactEmailMatch;

  const exactNameMatch = clients.find((client) =>
    getClientNameValues(client).some((clientName) => shipmentNames.includes(clientName))
  );
  if (exactNameMatch) return exactNameMatch;

  const fuzzyNameMatch = clients.find((client) =>
    getClientNameValues(client).some((clientName) =>
      shipmentNames.some((shipmentName) => lookupValuesMatch(clientName, shipmentName))
    )
  );
  if (fuzzyNameMatch) return fuzzyNameMatch;

  return clients.find((client) =>
    getClientIdValues(client).some((clientId) => shipmentIds.includes(clientId))
  ) || null;
};

const resolveUploadClientIds = async (shipment = {}, box = {}) => {
  const clients = await fetchClientRows();
  const matchedClient = findClientForShipment(shipment, clients);
  const embeddedClient =
    shipment?.clientRecord ||
    shipment?.client_record ||
    shipment?.rawClient ||
    shipment?.raw_client ||
    (shipment?.client && typeof shipment.client === 'object' ? shipment.client : null) ||
    (shipment?.clients && typeof shipment.clients === 'object' ? shipment.clients : null);

  const directClientId = firstUuidValue(getShipmentClientId(shipment), getBoxClientId(box));
  const matchedByDirectId = clients.find((client) =>
    getClientIdValues(client).some((value) => value === normalizeLookupValue(directClientId))
  );

  const confirmedClientIds = uniqueUuidValues(
    getClientUploadIdCandidates(matchedClient),
    getClientUploadIdCandidates(matchedByDirectId)
  );
  if (confirmedClientIds.length) return confirmedClientIds;

  const detailCandidates = await Promise.all(
    uniqueUuidValues(getClientUploadIdCandidates(embeddedClient), directClientId).map(fetchClientDetailById)
  );
  const matchedDetailClient = findClientForShipment(shipment, detailCandidates.filter(Boolean));
  const detailClientIds = uniqueUuidValues(getClientUploadIdCandidates(matchedDetailClient));
  if (detailClientIds.length) return detailClientIds;

  return [];
};

const withClientDetails = (shipment = {}, clients = []) => {
  const existingClient =
    shipment?.clientRecord ||
    shipment?.client_record ||
    shipment?.rawClient ||
    shipment?.raw_client ||
    (shipment?.client && typeof shipment.client === 'object' ? shipment.client : null) ||
    (shipment?.clients && typeof shipment.clients === 'object' ? shipment.clients : null);
  const matchedClient = findClientForShipment(shipment, clients);
  const client = matchedClient || existingClient;

  if (!client) return shipment;

  const clientId = getClientRecordId(client) || getClientId(client);
  const clientName = getClientName(client);
  const clientEmail = getClientEmail(client);

  return {
    ...shipment,
    clientId: clientId || shipment?.clientId || shipment?.client_id,
    client_id: clientId || shipment?.client_id || shipment?.clientId,
    client: clientName || getShipmentClientName(shipment),
    clientName: clientName || shipment?.clientName || shipment?.client_name,
    client_name: clientName || shipment?.client_name || shipment?.clientName,
    clientEmail: clientEmail || shipment?.clientEmail || shipment?.client_email,
    client_email: clientEmail || shipment?.client_email || shipment?.clientEmail,
    clientRecord: client,
    client_record: client,
  };
};

const getShipmentCreatedDate = (shipment = {}) =>
  firstPresent(shipment?.createdAt, shipment?.created_at, shipment?.created, shipment?.expectedArrivalDate, shipment?.expected_arrival_date);

const getShipmentLookupCandidates = (...shipments) => [
  ...new Set(
    shipments
      .filter(Boolean)
      .flatMap((shipment) => [
        getShipmentRecordId(shipment),
        shipment?.id,
        shipment?.uuid,
        shipment?.shipmentId,
        shipment?.shipment_id,
        shipment?.recordId,
        shipment?.record_id,
        shipment?.reference,
        shipment?.shipmentNumber,
        shipment?.shipment_number,
      ])
      .map((value) => String(value || '').trim())
      .filter(Boolean)
  ),
];

const getUuidLookupCandidates = (lookupCandidates = []) => [
  ...new Set(
    lookupCandidates
      .map((value) => String(value || '').trim())
      .filter(isUuidValue)
  ),
];

const isShipmentEligibleForFbaLabels = (shipment = {}) => {
  const status = getShipmentStatus(shipment);
  if (!status || status === 'unknown') return true;
  if (INELIGIBLE_STATUS_VALUES.has(status)) return false;
  return ELIGIBLE_STATUSES.has(status) || !INELIGIBLE_STATUS_VALUES.has(status);
};

const getLineItems = (shipment = {}) => getMappedShipmentItems(shipment);

const getLineItemSku = (item = {}) =>
  firstPresent(
    item?.sku,
    item?.sellerSku,
    item?.seller_sku,
    item?.msku,
    item?.productSku,
    item?.product_sku,
    item?.product?.sku,
    item?.product?.seller_sku,
    item?.products?.sku,
    item?.products?.seller_sku
  );

const getLineItemId = (item = {}) =>
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

const getLineItemQty = (item = {}) =>
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
    item?.dispatch_units,
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
    item?.receivedQty,
    item?.received_qty,
    item?.receivedQuantity,
    item?.received_quantity,
    item?.qtyReceived,
    item?.qty_received,
    item?.unitsReceived,
    item?.units_received,
    item?.totalUnits,
    item?.total_units,
    item?.totalQuantity,
    item?.total_quantity,
    item?.quantity,
    item?.qty,
    item?.units
  );

const normalizeShipment = (shipment = {}) => {
  const mappedShipment = normalizeMappedShipment(shipment);
  const lineItems = getMappedShipmentItems(mappedShipment);

  return {
    ...mappedShipment,
    id: getShipmentRecordId(mappedShipment) || getShipmentId(mappedShipment),
    reference: getShipmentReference(mappedShipment),
    status: getShipmentStatus(mappedShipment),
    clientId: getShipmentClientId(mappedShipment) || mappedShipment?.clientId || mappedShipment?.client_id,
    client_id: getShipmentClientId(mappedShipment) || mappedShipment?.client_id || mappedShipment?.clientId,
    client: getShipmentClientName(mappedShipment),
    clientRecord:
      mappedShipment?.clientRecord ||
      mappedShipment?.client_record ||
      mappedShipment?.rawClient ||
      mappedShipment?.raw_client ||
      (mappedShipment?.client && typeof mappedShipment.client === 'object' ? mappedShipment.client : null) ||
      (mappedShipment?.clients && typeof mappedShipment.clients === 'object' ? mappedShipment.clients : null),
    created: getShipmentCreatedDate(mappedShipment),
    lineItems,
    line_items: lineItems,
    shipment_line_items: lineItems,
    items: lineItems,
  };
};

const getBoxId = (box = {}) =>
  firstPresent(box?.id, box?.uuid, box?.boxId, box?.box_id, box?.boxRecordId, box?.box_record_id);

const getBoxRecordId = (box = {}) =>
  firstUuidValue(box?.id, box?.uuid, box?.boxId, box?.box_id, box?.boxRecordId, box?.box_record_id, box?.recordId, box?.record_id);

const getBoxClientId = (box = {}) =>
  firstPresent(box?.clientId, box?.client_id, box?.client?.id, box?.client?.uuid);

const getBoxLookupIds = (box = {}) => [
  ...new Set(
    [
      box?.id,
      box?.uuid,
      box?.boxId,
      box?.box_id,
      box?.boxRecordId,
      box?.box_record_id,
      box?.recordId,
      box?.record_id,
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

const normalizeBoxCompareValue = (value = '') =>
  String(value || '').trim().toLowerCase().replace(/\s+/g, '');

const getBoxNumberValue = (box = {}) =>
  firstPresent(box?.boxNumber, box?.box_number, box?.number, box?.sequence, box?.sequence_no);

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
    box?.shipping_label?.id
  );

const getBoxTitle = (box = {}, index = 0) => {
  const rawTitle = firstPresent(box?.name, box?.label, box?.reference, box?.boxNumber, box?.box_number);
  const title = String(rawTitle || '').trim();

  if (/^\d+$/.test(title)) return `Box ${title}`;
  return title || `${String(box?.box_type || box?.boxType || '').toLowerCase() === 'pallet' ? 'Pallet' : 'Box'} #${index + 1}`;
};

const getBoxSize = (box = {}) =>
  firstPresent(box?.boxSize, box?.box_size, box?.size, box?.type, box?.boxType, box?.box_type);

const getBoxType = (box = {}) => {
  const value = String(firstPresent(box?.boxType, box?.box_type, box?.containerType, box?.container_type, box?.type, 'box')).toLowerCase();
  return value === 'pallet' ? 'pallet' : 'box';
};

const getBoxDisplaySize = (box = {}) =>
  firstPresent(box?.boxSize, box?.box_size, box?.size, '-');

const getBoxDimensionValue = (box = {}, longKey, shortKey) => {
  const dimensions = box?.dimensions || box?.dimension || {};
  return firstPresent(dimensions?.[longKey], dimensions?.[shortKey], box?.[longKey], box?.[`${longKey}Cm`], box?.[`${longKey}_cm`], box?.[shortKey]);
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
      const parsed = JSON.parse(rawContents);
      return Array.isArray(parsed) ? parsed : parsed ? [parsed] : [];
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
    item?.shipmentLineItems?.id,
    item?.shipmentLineItems?.uuid,
    item?.shipment_line_items?.id,
    item?.shipment_line_items?.uuid,
    item?.lineItemId,
    item?.line_item_id,
    item?.itemId,
    item?.item_id,
    item?.shipmentItem?.id,
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
    item?.item?.id
  );

const getBoxItemDirectSku = (item = {}) =>
  firstPresent(
    item?.sku,
    item?.sellerSku,
    item?.seller_sku,
    item?.msku,
    item?.shipmentItemSku,
    item?.shipment_item_sku,
    item?.lineItemSku,
    item?.line_item_sku,
    item?.productSku,
    item?.product_sku,
    getLineItemSku(item?.shipmentItem || {}),
    getLineItemSku(item?.shipment_item || {}),
    getLineItemSku(item?.shipmentLineItem || {}),
    getLineItemSku(item?.shipment_line_item || {}),
    getLineItemSku(item?.shipmentLineItems || {}),
    getLineItemSku(item?.shipment_line_items || {}),
    getLineItemSku(item?.lineItem || {}),
    getLineItemSku(item?.line_item || {}),
    getLineItemSku(item?.item || {})
  );

const getBoxItemSku = (item = {}, lineItems = []) => {
  const directSku = getBoxItemDirectSku(item);
  if (directSku) return directSku;

  const lineItemId = String(getBoxItemLineItemId(item) || '').trim();
  if (!lineItemId) return '';

  const matchedLineItem = lineItems.find((lineItem) => String(getLineItemId(lineItem) || '').trim() === lineItemId);
  return getLineItemSku(matchedLineItem || {});
};

const getBoxItemQuantity = (item = {}) =>
  firstPresent(
    item?.allocationQuantity,
    item?.allocation_quantity,
    item?.allocationQty,
    item?.allocation_qty,
    item?.allocatedQuantity,
    item?.allocated_quantity,
    item?.allocatedUnits,
    item?.allocated_units,
    item?.allocatedQty,
    item?.allocated_qty,
    item?.qtyAllocated,
    item?.qty_allocated,
    item?.unitsAllocated,
    item?.units_allocated,
    item?.assignedQuantity,
    item?.assigned_quantity,
    item?.assignedQty,
    item?.assigned_qty,
    item?.requestedQuantity,
    item?.requested_quantity,
    item?.requestedQty,
    item?.requested_qty,
    item?.selectedQuantity,
    item?.selected_quantity,
    item?.selectedQty,
    item?.selected_qty,
    item?.boxedQuantity,
    item?.boxed_quantity,
    item?.boxedUnits,
    item?.boxed_units,
    item?.unitsBoxed,
    item?.units_boxed,
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
    item?.plannedQty,
    item?.planned_qty,
    item?.plannedQuantity,
    item?.planned_quantity,
    item?.unitCount,
    item?.unit_count,
    item?.totalQuantity,
    item?.total_quantity,
    item?.totalQty,
    item?.total_qty,
    item?.dispatchQty,
    item?.dispatch_qty,
    item?.dispatchQuantity,
    item?.dispatch_quantity,
    item?.qtyToDispatch,
    item?.qty_to_dispatch,
    item?.unitsToDispatch,
    item?.units_to_dispatch,
    item?.expectedQty,
    item?.expected_qty,
    item?.expectedQuantity,
    item?.expected_quantity,
    item?.qtyExpected,
    item?.qty_expected,
    item?.quantity,
    item?.qty,
    item?.units,
    item?.itemQuantity,
    item?.item_quantity,
    item?.metadata?.quantity,
    item?.metadata?.qty,
    item?.metadata?.units,
    item?.meta?.quantity,
    item?.meta?.qty,
    item?.meta?.units
  );

const normalizeSkuMatchValue = (value = '') =>
  String(value || '').trim().toLowerCase();

const getLineItemMatchIds = (lineItem = {}) => [
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

const getBoxAllocationCacheKeys = (box = {}, extraKeys = []) => [
  ...new Set(
    [
      ...extraKeys,
      getBoxRecordId(box),
      getBoxId(box),
      box?.boxId,
      box?.box_id,
      box?.boxRecordId,
      box?.box_record_id,
      box?.recordId,
      box?.record_id,
      box?.reference,
      box?.label,
      box?.subShipmentId,
      box?.sub_shipment_id,
      box?.subShipmentReference,
      box?.sub_shipment_reference,
      box?.__subShipmentReference,
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

const findLineItemForBoxItem = (boxItem = {}, lineItemList = []) => {
  const boxItemId = String(getBoxItemLineItemId(boxItem) || '').trim();
  const boxItemSku = normalizeSkuMatchValue(getBoxItemSku(boxItem));

  return toArray(lineItemList).find((lineItem) => {
    const lineItemIds = getLineItemMatchIds(lineItem);
    const lineItemSku = normalizeSkuMatchValue(getLineItemSku(lineItem));

    return Boolean(
      (boxItemId && lineItemIds.includes(boxItemId)) ||
        (boxItemSku && lineItemSku && boxItemSku === lineItemSku)
    );
  });
};

const hydrateBoxItemWithLineItem = (boxItem = {}, lineItemList = []) => {
  const matchedLineItem = findLineItemForBoxItem(boxItem, lineItemList);
  const matchedLineItemId = matchedLineItem ? getLineItemId(matchedLineItem) : '';
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

const getCachedBoxAllocationItems = (box = {}, lineItemList = []) => {
  const cache = readBoxAllocationCache();
  const keys = getBoxAllocationCacheKeys(box);
  const cachedItems = keys.map((key) => cache[key]).find((items) => toArray(items).length);
  return getShipmentScopedBoxItems(normalizeBoxAllocationItems(cachedItems || []), lineItemList);
};

const getBoxDirectQuantity = (box = {}) =>
  firstPresent(
    box?.allocationQuantity,
    box?.allocation_quantity,
    box?.allocationQty,
    box?.allocation_qty,
    box?.allocatedQuantity,
    box?.allocated_quantity,
    box?.allocatedUnits,
    box?.allocated_units,
    box?.allocatedQty,
    box?.allocated_qty,
    box?.qtyAllocated,
    box?.qty_allocated,
    box?.unitsAllocated,
    box?.units_allocated,
    box?.assignedQuantity,
    box?.assigned_quantity,
    box?.assignedQty,
    box?.assigned_qty,
    box?.requestedQuantity,
    box?.requested_quantity,
    box?.requestedQty,
    box?.requested_qty,
    box?.selectedQuantity,
    box?.selected_quantity,
    box?.selectedQty,
    box?.selected_qty,
    box?.boxedQuantity,
    box?.boxed_quantity,
    box?.boxedUnits,
    box?.boxed_units,
    box?.unitsBoxed,
    box?.units_boxed,
    box?.packedQuantity,
    box?.packed_quantity,
    box?.packedUnits,
    box?.packed_units,
    box?.boxQuantity,
    box?.box_quantity,
    box?.boxQty,
    box?.box_qty,
    box?.contentQuantity,
    box?.content_quantity,
    box?.contentQty,
    box?.content_qty,
    box?.unitCount,
    box?.unit_count,
    box?.itemCount,
    box?.item_count,
    box?.totalQuantity,
    box?.total_quantity,
    box?.totalQty,
    box?.total_qty,
    box?.dispatchQty,
    box?.dispatch_qty,
    box?.dispatchQuantity,
    box?.dispatch_quantity,
    box?.qtyToDispatch,
    box?.qty_to_dispatch,
    box?.unitsToDispatch,
    box?.units_to_dispatch,
    box?.expectedQty,
    box?.expected_qty,
    box?.expectedQuantity,
    box?.expected_quantity,
    box?.qtyExpected,
    box?.qty_expected,
    box?.quantity,
    box?.qty,
    box?.units,
    box?.metadata?.quantity,
    box?.metadata?.qty,
    box?.metadata?.units,
    box?.meta?.quantity,
    box?.meta?.qty,
    box?.meta?.units
  );

const sumBoxItemQuantities = (items = []) => {
  const quantities = items
    .map((item) => getBoxItemQuantity(item))
    .filter((quantity) => quantity !== '' && quantity !== undefined && quantity !== null);

  if (!quantities.length) return '';

  return quantities.reduce((sum, quantity) => {
    const numericQuantity = Number(quantity);
    return Number.isFinite(numericQuantity) ? sum + numericQuantity : sum;
  }, 0);
};

const getBoxUnits = (box = {}) => {
  const itemUnits = sumBoxItemQuantities(getBoxItems(box));
  if (itemUnits !== '') return itemUnits;

  return getBoxDirectQuantity(box);
};

const getBoxSku = (box = {}) =>
  firstPresent(
    box?.sku,
    box?.sellerSku,
    box?.seller_sku,
    box?.msku,
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

const parseBoxSkuQuantityText = (value = '') =>
  String(value || '')
    .split(/[,;\n]+/)
    .map((part) => {
      const normalizedPart = part.trim().replace(/^SKU:\s*/i, '');
      if (!normalizedPart) return null;

      const match = normalizedPart.match(/^(.+?)\s*(?:x|:|\*)\s*(\d+(?:\.\d+)?)\s*(?:units?)?$/i);
      const sku = String(match ? match[1] : normalizedPart).trim();
      return sku ? { sku, quantity: match ? match[2] : '' } : null;
    })
    .filter(Boolean);

const getBoxContentRows = (box = {}, shipment = {}, index = 0) => {
  void index;
  const lineItems = getLineItems(shipment);
  const boxDirectSku = getBoxSku(box);
  const directBoxQuantity = getBoxDirectQuantity(box);
  const boxLineItemId = firstPresent(
    box?.shipmentItemId,
    box?.shipment_item_id,
    box?.shipmentLineItemId,
    box?.shipment_line_item_id,
    box?.lineItemId,
    box?.line_item_id,
    box?.itemId,
    box?.item_id
  );
  const referencedLineItem = lineItems.find((item) => {
    const itemId = String(getLineItemId(item) || '').trim();
    return Boolean(boxLineItemId && itemId && String(boxLineItemId) === itemId);
  });
  const buildRows = (items = []) => {
    const itemList = toArray(items);
    const canUseBoxLevelQuantity = itemList.length <= 1;

    return itemList.map((item, itemIndex) => {
      const parsedTextRows = typeof item === 'string' ? parseBoxSkuQuantityText(item) : [];
      if (parsedTextRows.length === 1) {
        return {
          key: `parsed-${itemIndex}`,
          sku: parsedTextRows[0].sku,
          quantity: firstPresent(parsedTextRows[0].quantity, canUseBoxLevelQuantity ? directBoxQuantity : '', ''),
        };
      }

      const shipmentItemId = getBoxItemLineItemId(item);
      const itemSku = getBoxItemSku(item, lineItems);

      return {
        key: firstPresent(item?.id, item?.uuid, item?.boxItemId, item?.box_item_id, shipmentItemId, itemIndex),
        sku: firstPresent(itemSku, boxDirectSku),
        quantity: firstPresent(
          getBoxItemQuantity(item),
          canUseBoxLevelQuantity ? directBoxQuantity : '',
          ''
        ),
      };
    })
    .flatMap((item) => {
      const parsedSkuRows = parseBoxSkuQuantityText(item?.sku);
      if (parsedSkuRows.length <= 1) return [item];
      return parsedSkuRows.map((parsedRow, parsedIndex) => ({
        ...item,
        key: `${item.key || 'row'}-${parsedIndex}`,
        sku: parsedRow.sku,
        quantity: firstPresent(parsedRow.quantity, item.quantity, ''),
      }));
    })
    .filter((item) => item.sku || item.quantity !== '');
  };
  const rows = buildRows(getBoxItems(box));

  if (rows.some((item) => item.sku && item.quantity !== '')) return rows;

  if (rows.length) return rows;

  const directSku = firstPresent(boxDirectSku, getLineItemSku(referencedLineItem || {}));
  const directQuantity = directBoxQuantity;

  return directSku || directQuantity !== ''
    ? [{ key: 'direct-box', sku: directSku, quantity: directQuantity }]
    : [];
};

const getBoxContentsSummary = (box = {}, shipment = {}, index = 0) => {
  const rows = getBoxContentRows(box, shipment, index);
  if (!rows.length) return '';

  return rows
    .map((row) => `${row.sku || 'SKU pending'}${row.quantity !== '' ? ` x ${row.quantity}` : ''}`)
    .join(', ');
};

const getBoxTotalQuantity = (box = {}, shipment = {}, index = 0) => {
  const quantities = getBoxContentRows(box, shipment, index)
    .map((row) => row?.quantity)
    .filter((quantity) => quantity !== '' && quantity !== undefined && quantity !== null);

  if (quantities.length) {
    return quantities.reduce((sum, quantity) => {
      const numericQuantity = Number(quantity);
      return Number.isFinite(numericQuantity) ? sum + numericQuantity : sum;
    }, 0);
  }

  return getBoxUnits(box);
};

const appendFormValue = (formData, key, value) => {
  const normalizedValue = String(value || '').trim();
  if (normalizedValue) formData.append(key, normalizedValue);
};

const appendSearchValue = (searchParams, key, value) => {
  const normalizedValue = String(value || '').trim();
  if (normalizedValue) searchParams.set(key, normalizedValue);
};

const getFileUrl = (file = {}) =>
  firstPresent(
    file?.signedUrl,
    file?.signed_url,
    file?.url,
    file?.fileUrl,
    file?.file_url,
    file?.publicUrl,
    file?.public_url,
    file?.downloadUrl,
    file?.download_url,
    file?.localUrl,
    file?.local_url,
    file?.previewUrl,
    file?.preview_url
  );

const getFileName = (file = {}) =>
  firstPresent(file?.name, file?.fileName, file?.file_name, file?.originalName, file?.original_name, file?.original_filename, file?.storagePath, file?.storage_path, file?.path, 'download');

const getFileRecordId = (file = {}) =>
  firstPresent(file?.id, file?.uuid, file?.fileId, file?.file_id);

const getFileTypeValue = (file = {}) =>
  String(firstPresent(file?.fileType, file?.file_type, file?.type, file?.mimeType, file?.mime_type, file?.contentType, file?.content_type)).toLowerCase();

const getFileEntityId = (file = {}) =>
  firstPresent(file?.entityId, file?.entity_id, file?.boxId, file?.box_id, file?.shipmentId, file?.shipment_id);

const getFileEntityType = (file = {}) => String(firstPresent(file?.entityType, file?.entity_type)).trim().toLowerCase();

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

const fileMatchesBox = (file = {}, box = {}) => {
  const boxIds = getBoxLookupIds(box).map((value) => String(value || '').trim()).filter(Boolean);
  const fileBoxId = String(getFileBoxId(file) || '').trim();
  if (fileBoxId && boxIds.includes(fileBoxId)) return true;
  const fileEntityId = String(getFileEntityId(file) || '').trim();
  if (fileEntityId && boxIds.includes(fileEntityId)) return true;

  const searchText = getFileSearchText(file);
  const specificBoxIds = boxIds.filter((boxId) => !/^\d+$/.test(boxId) && boxId.length >= 8);
  if (specificBoxIds.some((boxId) => searchText.includes(boxId.toLowerCase()))) return true;

  const boxNumber = String(firstPresent(box?.box_number, box?.boxNumber)).trim();
  if (!boxNumber) return false;
  const fileBoxNumber = String(getFileBoxNumber(file) || '').trim();
  if (fileBoxNumber && fileBoxNumber === boxNumber) return true;

  return [
    `box-${boxNumber}`,
    `box_${boxNumber}`,
    `box ${boxNumber}`,
    `box#${boxNumber}`,
    `box-${boxNumber}-`,
  ].some((token) => searchText.includes(token.toLowerCase()));
};

const resolveFileUrl = (url = '') => {
  const value = String(url || '').trim();
  if (!value) return '';
  if (/^(https?:|blob:|data:)/i.test(value)) return value;
  return `${BACKEND_BASE_URL}${value.startsWith('/') ? value : `/${value}`}`;
};

const isFbaBoxLabelFile = (file = {}) => {
  const type = getFileTypeValue(file);
  const name = getFileName(file).toLowerCase();
  const entityType = getFileEntityType(file);
  return (
    type.includes('fba_shipping_label') ||
    type.includes('fba-shipping-label') ||
    type.includes('fba_label') ||
    type.includes('shipping_label') ||
    name.includes('fba') ||
    name.includes('shipping-label') ||
    name.includes('shipping_label') ||
    (entityType === 'box' && type.includes('label'))
  );
};

const getBoxDirectFbaLabelFile = (box = {}) => {
  const url = firstPresent(
    box?.fbaLabelUrl,
    box?.fba_label_url,
    box?.fbaShippingLabelUrl,
    box?.fba_shipping_label_url,
    box?.shippingLabelUrl,
    box?.shipping_label_url,
    box?.labelUrl,
    box?.label_url,
    box?.fbaLabel?.url,
    box?.fba_label?.url
  );
  if (!url) return null;

  const boxId = getBoxRecordId(box) || getBoxId(box);
  const name = firstPresent(
    box?.fbaLabelFileName,
    box?.fba_label_file_name,
    box?.shippingLabelFileName,
    box?.shipping_label_file_name,
    box?.labelFileName,
    box?.label_file_name,
    getFileName(box?.fbaLabel || {}),
    getFileName(box?.fba_label || {}),
    'FBA label'
  );

  return {
    id: getBoxFbaLabelFileId(box) || `box-label-${boxId || name}`,
    name,
    fileName: name,
    url,
    entityType: 'box',
    entity_type: 'box',
    entityId: boxId,
    entity_id: boxId,
    fileType: 'fba_shipping_label',
    file_type: 'fba_shipping_label',
  };
};

const getBoxLabelFile = (box = {}, filesByBox = {}) => {
  const directFile = getBoxDirectFbaLabelFile(box);
  if (directFile) return directFile;

  const boxIds = getBoxLookupIds(box);
  const labelFileId = String(getBoxFbaLabelFileId(box) || '').trim();
  const files = boxIds.flatMap((boxId) => extractList(filesByBox[boxId], ['files']));

  return (
    files.find((file) => labelFileId && String(getFileRecordId(file) || '').trim() === labelFileId) ||
    files.find((file) => fileMatchesBox(file, box) && isFbaBoxLabelFile(file)) ||
    files.find((file) => {
      const fileEntityId = String(getFileEntityId(file) || '').trim();
      const fileBoxId = String(getFileBoxId(file) || '').trim();
      const matchesThisBox = (fileEntityId && boxIds.includes(fileEntityId)) || (fileBoxId && boxIds.includes(fileBoxId));
      return matchesThisBox && isFbaBoxLabelFile(file);
    }) ||
    null
  );
};

const hasDirectFbaLabelRecord = (box = {}) =>
  Boolean(getBoxFbaLabelFileId(box) || getBoxDirectFbaLabelFile(box));

const isBoxDispatched = (box = {}) => {
  const status = String(
    box?.status || box?.boxStatus || box?.box_status || box?.state || box?.dispatchStatus || box?.dispatch_status || ''
  )
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

const isBoxLabelReady = (box = {}, filesByBox = {}) =>
  Boolean(
    box?.__fbaLabelUploaded ||
      isBoxDispatched(box) ||
      hasDirectFbaLabelRecord(box) ||
      getBoxLabelFile(box, filesByBox)
  );

const openOrDownloadFile = (file = {}) => {
  const fileUrl = resolveFileUrl(getFileUrl(file));
  if (!fileUrl) return false;
  window.open(fileUrl, '_blank', 'noopener,noreferrer');
  return true;
};

const getBoxDedupeKey = (box = {}, index = 0) =>
  String(
    getBoxRecordId(box) ||
      getBoxId(box) ||
      box?.boxRecordId ||
      box?.box_record_id ||
      box?.reference ||
      box?.boxNumber ||
      box?.box_number ||
      index
  );

const boxHasReturnedContent = (box = {}) =>
  getBoxItems(box).some((item) => getBoxItemSku(item) || getBoxItemQuantity(item) !== '');

const mergeBoxRecords = (existing = {}, incoming = {}) => {
  const existingHasContent = boxHasReturnedContent(existing);
  const incomingHasContent = boxHasReturnedContent(incoming);
  const merged = { ...existing, ...incoming };

  if (existingHasContent && !incomingHasContent) {
    return {
      ...merged,
      items: existing.items,
      boxItems: existing.boxItems,
      box_items: existing.box_items,
      contents: existing.contents,
      boxContents: existing.boxContents,
      box_contents: existing.box_contents,
      lineItems: existing.lineItems,
      line_items: existing.line_items,
    };
  }

  return merged;
};

const boxesReferToSamePhysicalBox = (left = {}, right = {}) => {
  const leftIds = getBoxLookupIds(left);
  const rightIds = new Set(getBoxLookupIds(right));
  if (leftIds.some((id) => rightIds.has(id))) return true;

  const leftNumber = normalizeBoxCompareValue(getBoxNumberValue(left));
  const rightNumber = normalizeBoxCompareValue(getBoxNumberValue(right));
  if (!leftNumber || !rightNumber || leftNumber !== rightNumber) return false;

  const leftDimensions = normalizeBoxCompareValue(getBoxDimensions(left));
  const rightDimensions = normalizeBoxCompareValue(getBoxDimensions(right));
  const dimensionsMatch = leftDimensions && rightDimensions && leftDimensions === rightDimensions;

  const leftWeight = normalizeBoxCompareValue(getBoxWeight(left));
  const rightWeight = normalizeBoxCompareValue(getBoxWeight(right));
  const weightMatch = leftWeight && rightWeight && leftWeight === rightWeight;

  return dimensionsMatch || weightMatch;
};

const mergeBoxLists = (...boxLists) => {
  const merged = new Map();
  boxLists.flat().filter(Boolean).forEach((box, index) => {
    const key = getBoxDedupeKey(box, index);
    if (merged.has(key)) {
      merged.set(key, mergeBoxRecords(merged.get(key), box));
      return;
    }

    const matchingEntry = [...merged.entries()].find(([, existingBox]) =>
      boxesReferToSamePhysicalBox(existingBox, box)
    );

    if (matchingEntry) {
      const [existingKey, existingBox] = matchingEntry;
      merged.set(existingKey, mergeBoxRecords(existingBox, box));
      return;
    }

    merged.set(key, box);
  });
  return [...merged.values()];
};

const getShipmentDedupeKey = (shipment = {}, fallback = '') =>
  String(getShipmentRecordId(shipment) || getShipmentId(shipment) || getShipmentReference(shipment) || fallback);

const fetchShipmentRowsAllPages = async (params = {}) => {
  const allShipments = [];
  const seenKeys = new Set();
  const maxPages = 25;
  const pageSize = 100;

  for (let page = 1; page <= maxPages; page += 1) {
    const query = new URLSearchParams({
      ...params,
      page: String(page),
      limit: String(pageSize),
    });
    const response = await fetch(`${API_BASE_URL}/api/shipments?${query.toString()}`, {
      method: 'GET',
      headers: buildHeaders(),
      cache: 'no-store',
    });
    const payload = await parseResponse(response);
    const pageShipments = extractShipments(payload);

    if (!pageShipments.length) break;

    let addedCount = 0;
    pageShipments.forEach((shipment, index) => {
      const key = getShipmentDedupeKey(shipment, `${page}-${index}`);
      if (seenKeys.has(key)) return;
      seenKeys.add(key);
      allShipments.push(shipment);
      addedCount += 1;
    });

    if (!addedCount || pageShipments.length < pageSize) break;
  }

  return allShipments;
};

const fetchEligibleShipmentRows = async () => {
  const rowsByKey = new Map();
  const seenKeys = new Set();
  const addRows = (shipmentRows = []) => {
    shipmentRows.forEach((shipment, index) => {
      const key = getShipmentDedupeKey(shipment, index);
      if (seenKeys.has(key)) return;
      seenKeys.add(key);
      rowsByKey.set(key, shipment);
    });
  };

  try {
    addRows(await fetchShipmentRowsAllPages());
  } catch {
    // Status-specific requests below are the fallback if the unfiltered list is restricted.
  }

  const statusResults = await Promise.allSettled(
    ELIGIBLE_STATUS_VALUES.map((status) => fetchShipmentRowsAllPages({ status }))
  );

  statusResults.forEach((result) => {
    if (result.status !== 'fulfilled') return;
    addRows(result.value);
  });

  return [...rowsByKey.values()].filter(isShipmentEligibleForFbaLabels);
};

const fetchShipmentBoxesAllPages = async (shipmentId) => {
  const allBoxes = [];
  const seenKeys = new Set();

  for (let page = 1; page <= 10; page += 1) {
    const response = await fetch(`${API_BASE_URL}/api/shipments/${encodeURIComponent(shipmentId)}/boxes?page=${page}&limit=100`, {
      method: 'GET',
      headers: buildHeaders(),
      cache: 'no-store',
    });
    const payload = await parseResponse(response);
    const pageBoxes = extractBoxEndpointRows(payload);

    if (!pageBoxes.length) break;

    let addedCount = 0;
    pageBoxes.forEach((box, index) => {
      const key = getBoxDedupeKey(box, allBoxes.length + index);
      if (seenKeys.has(key)) return;
      seenKeys.add(key);
      allBoxes.push(box);
      addedCount += 1;
    });

    if (!addedCount || pageBoxes.length < 100) break;
  }

  return allBoxes;
};

const fetchBoxesForShipment = async (lookupCandidates = []) => {
  const uniqueLookupCandidates = [...new Set(lookupCandidates.map((value) => String(value || '').trim()).filter(Boolean))];
  const boxLookupCandidates = getUuidLookupCandidates(uniqueLookupCandidates);

  if (!boxLookupCandidates.length) return [];

  for (const lookupId of boxLookupCandidates) {
    try {
      const boxes = await fetchShipmentBoxesAllPages(lookupId);
      if (boxes.length) return boxes;
    } catch {
      // Try the next UUID. Reference-based lookups are intentionally skipped because this route rejects them.
    }
  }

  return [];
};

const fetchSubShipmentBoxesForShipment = async (lookupCandidates = []) => {
  const uniqueLookupCandidates = [...new Set(lookupCandidates.map((value) => String(value || '').trim()).filter(Boolean))];

  for (const lookupId of uniqueLookupCandidates) {
    try {
      const response = await fetch(`${API_BASE_URL}/api/shipments/${encodeURIComponent(lookupId)}/sub-shipments`, {
        method: 'GET',
        headers: buildHeaders(),
        cache: 'no-store',
      });
      const payload = await parseResponse(response);
      const subShipments = extractSubShipments(payload);
      if (!subShipments.length) continue;

      const boxResults = await Promise.allSettled(
        subShipments.map(async (subShipment) => {
          const subShipmentId = getSubShipmentId(subShipment);
          if (!subShipmentId) {
            const boxes = extractBoxes(subShipment);
            return boxes.map((box) => decorateSubShipmentBox(box, subShipment, boxes));
          }

          try {
            const boxesResponse = await fetch(`${API_BASE_URL}/api/sub-shipments/${encodeURIComponent(subShipmentId)}/boxes`, {
              method: 'GET',
              headers: buildHeaders(),
              cache: 'no-store',
            });
            const boxesPayload = await parseResponse(boxesResponse);
            const boxes = extractBoxEndpointRows(boxesPayload);
            const selectedBoxes = boxes.length ? boxes : extractBoxes(subShipment);
            return selectedBoxes.map((box) => decorateSubShipmentBox(box, subShipment, selectedBoxes));
          } catch {
            const boxes = extractBoxes(subShipment);
            return boxes.map((box) => decorateSubShipmentBox(box, subShipment, boxes));
          }
        })
      );
      const boxes = boxResults.flatMap((result) => (result.status === 'fulfilled' ? result.value : []));
      if (boxes.length) return boxes;
    } catch {
      // Try the next shipment identifier.
    }
  }

  return [];
};

const fetchShipmentDetail = async (lookupCandidates = []) => {
  for (const lookupId of lookupCandidates) {
    try {
      const response = await fetch(`${API_BASE_URL}/api/shipments/${encodeURIComponent(lookupId)}`, {
        method: 'GET',
        headers: buildHeaders(),
        cache: 'no-store',
      });
      return extractShipmentDetail(await parseResponse(response));
    } catch {
      // Try the next shipment identifier.
    }
  }

  return {};
};

const fetchBoxItemsByBoxId = async (box = {}) => {
  if (BOX_ITEM_ENRICH_LIMIT <= 0) return [];

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
  let remainingFetches = BOX_ITEM_ENRICH_LIMIT;
  const results = await Promise.allSettled(
    boxes.map(async (box) => {
      const existingItems = getBoxItems(box);
      const hasUsableItems = existingItems.some((item) =>
        (getBoxItemLineItemId(item) || getBoxItemSku(item)) && getBoxItemQuantity(item) !== ''
      );
      if (remainingFetches <= 0) {
        const cachedItems = getCachedBoxAllocationItems(box, lineItems);
        if (cachedItems.length) {
          return { ...box, items: cachedItems, boxItems: cachedItems, box_items: cachedItems, boxContents: cachedItems, box_contents: cachedItems, contents: cachedItems };
        }
        return box;
      }
      remainingFetches -= 1;
      const boxItems = await fetchBoxItemsByBoxId(box);
      const hydratedBoxItems = getShipmentScopedBoxItems(boxItems, lineItems);
      if (hydratedBoxItems.length) {
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
        if (hydratedExistingItems.length) {
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
      }

      return box;
    })
  );

  return results.map((result, index) => (result.status === 'fulfilled' ? result.value : boxes[index]));
};

const mapShipmentFilesToBoxes = (boxes = [], shipmentFilesResult = [], filesByBox = {}) => {
  const nextFilesByBox = { ...filesByBox };
  const shipmentFiles = extractFiles(shipmentFilesResult);

  boxes.forEach((box) => {
    const boxId = getBoxRecordId(box) || getBoxId(box);
    if (!boxId) return;
    const matchedFiles = shipmentFiles
      .filter((file) => fileMatchesBox(file, box))
      .map((file) => ({
        ...file,
        entityType: getFileEntityType(file) || 'box',
        entity_type: getFileEntityType(file) || 'box',
        boxId,
        box_id: boxId,
      }));
    if (matchedFiles.length) {
      nextFilesByBox[boxId] = [...(nextFilesByBox[boxId] || []), ...matchedFiles];
    }
  });

  return nextFilesByBox;
};

const fetchFilesForBox = async (box = {}) => {
  const directFile = getBoxDirectFbaLabelFile(box);
  if (directFile) return [directFile];

  const lookupIds = getBoxRecordId(box) ? [getBoxRecordId(box)] : [];
  for (const boxId of lookupIds) {
    try {
      const response = await fetch(`${API_BASE_URL}/api/files?entityType=box&entityId=${encodeURIComponent(boxId)}`, {
        method: 'GET',
        headers: buildHeaders(),
        cache: 'no-store',
      });
      const files = extractFiles(await parseResponse(response));
      const matchingFiles = files.filter((file) => {
        const type = getFileTypeValue(file);
        const name = getFileName(file).toLowerCase();
        return fileMatchesBox(file, box) && (isFbaBoxLabelFile(file) || type.includes('label') || name.includes('label'));
      });
      if (matchingFiles.length) {
        return matchingFiles.map((file) => ({
          ...file,
          boxId,
          box_id: boxId,
          entityId: getFileEntityId(file) || boxId,
          entity_id: getFileEntityId(file) || boxId,
          entityType: getFileEntityType(file) || 'box',
          entity_type: getFileEntityType(file) || 'box',
        }));
      }
    } catch {
      // Try the next box identifier.
    }
  }

  return [];
};

const fetchFilesForShipment = async (shipment = {}) => {
  const lookupIds = getUuidLookupCandidates(getShipmentLookupCandidates(shipment));

  for (const lookupId of lookupIds) {
    try {
      const response = await fetch(`${API_BASE_URL}/api/files?entityType=shipment&entityId=${encodeURIComponent(lookupId)}`, {
        method: 'GET',
        headers: buildHeaders(),
        cache: 'no-store',
      });
      const files = extractFiles(await parseResponse(response));
      if (files.length) return files;
    } catch {
      // Try the next shipment identifier.
    }
  }

  return [];
};

const hydrateBoxFilesForRows = async (rowsSnapshot = []) => {
  const lookups = rowsSnapshot.flatMap((row) =>
    (row.boxes || []).map((box) => ({
      shipmentId: getShipmentId(row.shipment),
      box,
      boxId: getBoxRecordId(box) || getBoxId(box),
    }))
  ).filter((lookup) => lookup.boxId);

  const shipmentLookups = rowsSnapshot
    .map((row) => ({
      shipment: row.shipment,
      shipmentId: getShipmentId(row.shipment),
      boxes: row.boxes || [],
    }))
    .filter((lookup) => lookup.shipmentId && lookup.boxes.length);

  if (!lookups.length && !shipmentLookups.length) return {};

  const [boxResults, shipmentResults] = await Promise.all([
    Promise.allSettled(
      lookups.map(async ({ box, boxId }) => ({
        boxId,
        files: await fetchFilesForBox(box),
      }))
    ),
    Promise.allSettled(
      shipmentLookups.map(async ({ shipment, boxes }) => ({
        boxes,
        files: await fetchFilesForShipment(shipment),
      }))
    ),
  ]);

  const filesByBox = boxResults.reduce((acc, result) => {
    if (result.status !== 'fulfilled' || !result.value.files.length) return acc;
    acc[result.value.boxId] = result.value.files;
    return acc;
  }, {});

  shipmentResults.forEach((result) => {
    if (result.status !== 'fulfilled' || !result.value.files.length) return;
    Object.assign(filesByBox, mapShipmentFilesToBoxes(result.value.boxes, result.value.files, filesByBox));
  });

  return filesByBox;
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
      const optimizedFile = new File([blob], `${baseName}.jpg`, { type: 'image/jpeg', lastModified: Date.now() });
      if (!bestFile || optimizedFile.size < bestFile.size) bestFile = optimizedFile;
      if (optimizedFile.size <= SAFE_FILE_UPLOAD_BYTES) return optimizedFile;
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

const formatStatus = (value = '') =>
  String(value || '-').replaceAll('_', ' ');

const AwaitingFbaLabels = () => {
  const [rows, setRows] = useState([]);
  const [filesByBox, setFilesByBox] = useState({});
  const [isLoading, setIsLoading] = useState(false);
  const [hasLoaded, setHasLoaded] = useState(false);
  const [uploadingKey, setUploadingKey] = useState('');
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [selectedFbaBoxDetail, setSelectedFbaBoxDetail] = useState(null);
  const [batchFbaUpload, setBatchFbaUpload] = useState(null);
  const isLoadingRef = useRef(false);
  const pendingLoadRef = useRef(null);
  const loadAwaitingFbaLabelsRef = useRef(null);

  const visibleRows = useMemo(
    () =>
      rows
        .map((row) => ({
          ...row,
          boxes: row.boxes.filter((box) => !isBoxLabelReady(box, filesByBox)),
        }))
        .filter((row) => row.boxes.length),
    [rows, filesByBox]
  );

  const pendingBoxCount = useMemo(
    () => visibleRows.reduce((sum, row) => sum + row.boxes.length, 0),
    [visibleRows]
  );
  const isInitialLoading = isLoading && !hasLoaded;

  const batchFbaUploadOptions = useMemo(() => {
    if (!batchFbaUpload) return [];

    const targetShipmentId = getShipmentId(batchFbaUpload.shipment);
    const targetShipmentRecordId = getShipmentRecordId(batchFbaUpload.shipment);
    const row = visibleRows.find((currentRow) => {
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
        boxId: getBoxRecordId(box) || getBoxId(box),
        index,
      }))
      .filter(({ box, boxId }) => boxId && !isBoxLabelReady(box, filesByBox));
  }, [batchFbaUpload, filesByBox, visibleRows]);

  const loadAwaitingFbaLabels = useCallback(async ({ clearMessage = false, showLoader = true } = {}) => {
    if (isLoadingRef.current) {
      pendingLoadRef.current = { clearMessage, showLoader: false };
      return;
    }
    isLoadingRef.current = true;

    try {
      if (showLoader) setIsLoading(true);
      setError('');
      if (clearMessage) setMessage('');

      const clientRows = await fetchClientRows();
      const sourceShipments = (await fetchEligibleShipmentRows()).map((shipment) =>
        withClientDetails(normalizeShipment(shipment), clientRows)
      );
      const candidateShipments = sourceShipments.filter(isShipmentEligibleForFbaLabels);

      if (!candidateShipments.length) {
        setRows([]);
        setFilesByBox({});
        return;
      }

      const shipmentResults = await Promise.allSettled(
        candidateShipments.map(async (shipment) => {
          const lookupCandidates = getShipmentLookupCandidates(shipment);
          const detail = await fetchShipmentDetail(lookupCandidates).catch(() => ({}));
          const mergedShipment = withClientDetails(
            normalizeShipment({
              ...shipment,
              ...detail,
              id: getShipmentRecordId(detail) || getShipmentRecordId(shipment) || getShipmentId(shipment),
              reference: getShipmentReference(detail) || getShipmentReference(shipment),
              clientId: getShipmentClientId(detail) || getShipmentClientId(shipment) || shipment?.clientId || shipment?.client_id,
              client_id: getShipmentClientId(detail) || getShipmentClientId(shipment) || shipment?.client_id || shipment?.clientId,
              clientRecord:
                detail?.clientRecord ||
                detail?.client_record ||
                detail?.rawClient ||
                detail?.raw_client ||
                (detail?.client && typeof detail.client === 'object' ? detail.client : null) ||
                (detail?.clients && typeof detail.clients === 'object' ? detail.clients : null) ||
                shipment?.clientRecord ||
                shipment?.client_record ||
                shipment?.rawClient ||
                shipment?.raw_client ||
                (shipment?.client && typeof shipment.client === 'object' ? shipment.client : null) ||
                (shipment?.clients && typeof shipment.clients === 'object' ? shipment.clients : null),
              lineItems: getLineItems(detail).length ? getLineItems(detail) : getLineItems(shipment),
              shipment_line_items: getLineItems(detail).length ? getLineItems(detail) : getLineItems(shipment),
            }),
            clientRows
          );

          const resolvedLookupCandidates = getShipmentLookupCandidates(mergedShipment, detail, shipment);
          const [boxesResult, subShipmentBoxesResult] = await Promise.allSettled([
            fetchBoxesForShipment(resolvedLookupCandidates),
            fetchSubShipmentBoxesForShipment(resolvedLookupCandidates),
          ]);

          const boxesResultRows = boxesResult.status === 'fulfilled' ? boxesResult.value : [];
          const subShipmentBoxes = subShipmentBoxesResult.status === 'fulfilled' ? subShipmentBoxesResult.value : [];
          const loadedBoxes = mergeBoxLists(
            boxesResultRows,
            subShipmentBoxes,
            extractBoxes(detail),
            extractBoxes(shipment)
          );
          const boxes = await enrichBoxesWithItems(loadedBoxes, getLineItems(mergedShipment));

          return { shipment: mergedShipment, boxes, filesByBox: {} };
        })
      );

      const nextFilesByBox = {};
      const nextRows = shipmentResults.flatMap((result) => {
        if (result.status !== 'fulfilled') return [];
        Object.assign(nextFilesByBox, result.value.filesByBox);
        const boxes = result.value.boxes || [];
        return boxes.length ? [{ shipment: result.value.shipment, boxes }] : [];
      });

      const hydratedFilesByBox = await hydrateBoxFilesForRows(nextRows);
      const nextHydratedFilesByBox = { ...nextFilesByBox, ...hydratedFilesByBox };
      setFilesByBox(nextHydratedFilesByBox);
      setRows(nextRows);
    } catch (requestError) {
      if (showLoader) {
        setRows([]);
        setFilesByBox({});
      }
      setError(requestError.message || 'Failed to load boxes awaiting FBA labels.');
    } finally {
      isLoadingRef.current = false;
      setHasLoaded(true);
      if (showLoader) setIsLoading(false);

      const pendingLoad = pendingLoadRef.current;
      pendingLoadRef.current = null;
      if (pendingLoad) {
        window.setTimeout(() => {
          loadAwaitingFbaLabelsRef.current?.(pendingLoad);
        }, 0);
      }
    }
  }, []);

  useEffect(() => {
    loadAwaitingFbaLabelsRef.current = loadAwaitingFbaLabels;
  }, [loadAwaitingFbaLabels]);

  useEffect(() => {
    const loadTimer = window.setTimeout(() => {
      loadAwaitingFbaLabels({ showLoader: true });
    }, 0);
    return () => window.clearTimeout(loadTimer);
  }, [loadAwaitingFbaLabels]);

  useEffect(() => {
    let refreshTimer = null;

    const scheduleRefresh = () => {
      window.clearTimeout(refreshTimer);
      refreshTimer = window.setTimeout(() => {
        loadAwaitingFbaLabels({ showLoader: false });
      }, 700);
    };

    const handleMutation = (event) => {
      const url = String(event?.detail?.url || '');
      if (!url.includes('/api/files') && !url.includes('/api/boxes') && !url.includes('/api/shipments')) {
        return;
      }

      scheduleRefresh();
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        scheduleRefresh();
      }
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
  }, [loadAwaitingFbaLabels]);

  const getPrimaryBoxSku = (box = {}, shipment = {}, index = 0) => {
    const contentRows = getBoxContentRows(box, shipment, index);
    return firstPresent(contentRows[0]?.sku, getBoxSku(box));
  };

  const getBoxGroupLabel = (box = {}, shipment = {}, index = 0) => {
    const skus = [
      ...new Set(
        getBoxContentRows(box, shipment, index)
          .map((row) => String(row.sku || '').trim())
          .filter(Boolean)
      ),
    ];

    if (skus.length > 1) return `Mixed SKUs: ${skus.join(', ')}`;
    return firstPresent(skus[0], getPrimaryBoxSku(box, shipment, index));
  };

  const getBoxesGroupedBySku = (boxes = [], shipment = {}) => {
    const grouped = new Map();
    boxes.forEach((box, index) => {
      const label = String(getBoxGroupLabel(box, shipment, index) || '').trim();
      const key = label || 'sku-unallocated';
      if (!grouped.has(key)) grouped.set(key, { key, label, boxes: [] });
      grouped.get(key).boxes.push({ box, originalIndex: index });
    });
    return [...grouped.values()];
  };

  const handleOpenFbaLabelBatchUpload = (shipment, box, index, file) => {
    if (!file) return;

    const boxId = getBoxRecordId(box) || getBoxId(box);
    if (!boxId) {
      setError('Box ID missing.');
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

  const handleToggleBatchBox = (boxId) => {
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

  const handleSetAllBatchBoxes = (checked) => {
    setBatchFbaUpload((current) => {
      if (!current) return current;
      return {
        ...current,
        selectedBoxIds: checked ? batchFbaUploadOptions.map((option) => option.boxId) : [],
      };
    });
  };

  const handleConfirmFbaLabelBatchUpload = async () => {
    if (!batchFbaUpload?.file) return;

    const shipment = batchFbaUpload.shipment || {};
    const shipmentId = getShipmentId(shipment);
    const shipmentRecordId = getShipmentRecordId(shipment) || (isUuidValue(shipmentId) ? shipmentId : '');
    const selectedBoxIds = [...new Set(batchFbaUpload.selectedBoxIds || [])].filter(Boolean);

    if (!shipmentRecordId) {
      setError('Shipment record ID missing for FBA label upload.');
      return;
    }
    if (!selectedBoxIds.length) {
      setError('Select at least one box for this FBA label.');
      return;
    }

    try {
      setError('');
      setMessage('');
      setUploadingKey(`batch-${shipmentId}`);

      const uploadFile = await prepareFileForUpload(batchFbaUpload.file, 'FBA label');
      const shipmentReference = getShipmentReference(shipment);
      const uploadFileName = `fba-label-${shipmentReference || shipmentRecordId}-${Date.now()}-${uploadFile.name}`.replace(/[^a-z0-9._-]+/gi, '-');
      const formData = new FormData();
      formData.append('file', uploadFile, uploadFileName);
      formData.append('fileType', 'fba_shipping_label');
      formData.append('shipmentId', shipmentRecordId);
      formData.append('boxIds', JSON.stringify(selectedBoxIds));
      selectedBoxIds.forEach((boxId) => formData.append('boxIds[]', boxId));

      const response = await fetch(`${API_BASE_URL}/api/files/fba-labels/apply-to-boxes`, {
        method: 'POST',
        headers: buildHeaders(),
        body: formData,
        skipApiToast: true,
      });
      const payload = await parseResponse(response);
      const responseData = payload?.data || payload || {};
      const uploadedFileId = responseData?.fileId || responseData?.file_id || '';

      setFilesByBox((current) => {
        const next = { ...current };
        selectedBoxIds.forEach((boxId) => {
          next[boxId] = [
            {
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
            },
          ];
        });
        return next;
      });

      const selectedSet = new Set(selectedBoxIds);
      setRows((current) =>
        current.map((row) =>
          getShipmentId(row.shipment) === shipmentId
            ? {
                ...row,
                boxes: row.boxes.map((currentBox) => {
                  const currentBoxId = getBoxRecordId(currentBox) || getBoxId(currentBox);
                  return selectedSet.has(currentBoxId)
                    ? {
                        ...currentBox,
                        __fbaLabelUploaded: true,
                        labelReady: true,
                        label_ready: true,
                        fbaLabelUploaded: true,
                        fba_label_uploaded: true,
                        labelUploaded: true,
                        label_uploaded: true,
                        label_uploaded_at: new Date().toISOString(),
                        fba_shipping_label_file_id: uploadedFileId || currentBox?.fba_shipping_label_file_id,
                      }
                    : currentBox;
                }),
              }
            : row
        )
      );

      setMessage(`FBA label uploaded for ${selectedBoxIds.length} box${selectedBoxIds.length !== 1 ? 'es' : ''}.${uploadFile !== batchFbaUpload.file ? ' Large image was optimized before upload.' : ''}`);
      setBatchFbaUpload(null);
      await loadAwaitingFbaLabels({ showLoader: false });
    } catch (requestError) {
      setError(isPayloadTooLargeMessage(requestError.message) ? getUploadTooLargeMessage(batchFbaUpload.file.name) : requestError.message);
    } finally {
      setUploadingKey('');
    }
  };

  // eslint-disable-next-line no-unused-vars
  const handleUploadFbaLabel = async (shipment, box, index, file) => {
    if (!file) return;

    const boxRecordId = getBoxRecordId(box);
    const boxId = boxRecordId || getBoxId(box);
    const shipmentRecordId = getShipmentRecordId(shipment);
    if (!boxId) {
      setError('Box ID missing.');
      return;
    }
    if (!boxRecordId && !shipmentRecordId) {
      setError('Shipment record ID missing for this box.');
      return;
    }

    const uploadKey = `${getShipmentId(shipment)}-${boxId}`;

    try {
      setError('');
      setMessage('');
      setUploadingKey(uploadKey);

      const uploadFile = await prepareFileForUpload(file, 'FBA label');
      const clientIds = await resolveUploadClientIds(shipment, box);
      const uploadClientIds = ['', ...clientIds].filter((value, valueIndex, values) => values.indexOf(value) === valueIndex);
      const clientName = getShipmentClientName(shipment);
      const clientEmail = getShipmentClientEmail(shipment);
      const shipmentReference = getShipmentReference(shipment);
      const boxNumber = firstPresent(box?.box_number, box?.boxNumber, index + 1);
      const uploadedFileName = `fba-label-box-${boxNumber}-${boxId}-${uploadFile.name}`.replace(/[^a-z0-9._-]+/gi, '-');
      const buildMetadata = (uploadClientId) => ({
        ...(uploadClientId
          ? {
              clientId: uploadClientId,
              client_id: uploadClientId,
              clientUuid: uploadClientId,
              client_uuid: uploadClientId,
            }
          : {}),
        clientName,
        client_name: clientName,
        clientEmail,
        client_email: clientEmail,
        shipmentId: shipmentRecordId,
        shipment_id: shipmentRecordId,
        shipmentReference,
        shipment_reference: shipmentReference,
        boxId,
        box_id: boxId,
        boxRecordId,
        box_record_id: boxRecordId,
        boxNumber,
        box_number: boxNumber,
      });
      const buildUploadHeaders = (uploadClientId) => {
        const uploadHeaders = buildHeaders();
        if (uploadClientId) uploadHeaders['X-Client-Id'] = uploadClientId;
        if (uploadClientId) uploadHeaders['X-Client-ID'] = uploadClientId;
        if (clientName) uploadHeaders['X-Client-Name'] = clientName;
        if (clientEmail) uploadHeaders['X-Client-Email'] = clientEmail;
        if (shipmentRecordId) uploadHeaders['X-Shipment-Id'] = shipmentRecordId;
        if (boxId) uploadHeaders['X-Box-Id'] = boxId;
        return uploadHeaders;
      };
      const buildUploadFormData = ({ entityType, entityId, uploadClientId }) => {
        const metadata = buildMetadata(uploadClientId);
        const nextFormData = new FormData();
        nextFormData.append('file', uploadFile, uploadedFileName);
        nextFormData.append('entityType', entityType);
        nextFormData.append('entityId', entityId);
        nextFormData.append('fileType', 'fba_shipping_label');
        nextFormData.append('metadata', JSON.stringify(metadata));
        nextFormData.append('meta', JSON.stringify(metadata));
        appendFormValue(nextFormData, 'clientId', uploadClientId);
        appendFormValue(nextFormData, 'client_id', uploadClientId);
        appendFormValue(nextFormData, 'clientUuid', uploadClientId);
        appendFormValue(nextFormData, 'client_uuid', uploadClientId);
        appendFormValue(nextFormData, 'clientName', clientName);
        appendFormValue(nextFormData, 'client_name', clientName);
        appendFormValue(nextFormData, 'clientEmail', clientEmail);
        appendFormValue(nextFormData, 'client_email', clientEmail);
        appendFormValue(nextFormData, 'shipmentId', shipmentRecordId);
        appendFormValue(nextFormData, 'shipment_id', shipmentRecordId);
        appendFormValue(nextFormData, 'shipmentReference', shipmentReference);
        appendFormValue(nextFormData, 'shipment_reference', shipmentReference);
        appendFormValue(nextFormData, 'boxId', boxId);
        appendFormValue(nextFormData, 'box_id', boxId);
        appendFormValue(nextFormData, 'boxRecordId', boxRecordId);
        appendFormValue(nextFormData, 'box_record_id', boxRecordId);
        appendFormValue(nextFormData, 'boxNumber', boxNumber);
        appendFormValue(nextFormData, 'box_number', boxNumber);
        return nextFormData;
      };
      const uploadTargets = [
        boxRecordId ? { entityType: 'box', entityId: boxRecordId } : null,
        !boxRecordId && shipmentRecordId ? { entityType: 'shipment', entityId: shipmentRecordId } : null,
      ].filter(Boolean);
      if (!uploadTargets.length) {
        throw new Error('Box record ID missing for FBA label upload.');
      }
      let payload = null;
      let lastUploadError = null;

      for (const uploadClientId of uploadClientIds) {
        for (const target of uploadTargets) {
          try {
            const uploadQuery = new URLSearchParams();
            appendSearchValue(uploadQuery, 'clientId', uploadClientId);
            appendSearchValue(uploadQuery, 'client_id', uploadClientId);
            appendSearchValue(uploadQuery, 'clientUuid', uploadClientId);
            appendSearchValue(uploadQuery, 'client_uuid', uploadClientId);
            appendSearchValue(uploadQuery, 'clientName', clientName);
            appendSearchValue(uploadQuery, 'client_name', clientName);
            appendSearchValue(uploadQuery, 'clientEmail', clientEmail);
            appendSearchValue(uploadQuery, 'client_email', clientEmail);
            appendSearchValue(uploadQuery, 'shipmentId', shipmentRecordId);
            appendSearchValue(uploadQuery, 'shipment_id', shipmentRecordId);
            appendSearchValue(uploadQuery, 'boxId', boxId);
            appendSearchValue(uploadQuery, 'box_id', boxId);
            appendSearchValue(uploadQuery, 'entityType', target.entityType);
            appendSearchValue(uploadQuery, 'entityId', target.entityId);
            const uploadUrl = `${API_BASE_URL}/api/files?${uploadQuery.toString()}`;

            const response = await fetch(uploadUrl, {
              method: 'POST',
              headers: buildUploadHeaders(uploadClientId),
              body: buildUploadFormData({ ...target, uploadClientId }),
              skipApiToast: true,
            });
            payload = await parseResponse(response);
            lastUploadError = null;
            break;
          } catch (uploadError) {
            lastUploadError = uploadError;
            if (isPayloadTooLargeMessage(uploadError.message)) break;
          }
        }

        if (!lastUploadError || isPayloadTooLargeMessage(lastUploadError.message)) break;
      }

      if (lastUploadError) throw lastUploadError;
      const uploadedFile = extractFiles(payload)[0] || payload?.file || payload?.data?.file || payload?.data || {};
      const localUrl = getFileUrl(uploadedFile) ? '' : URL.createObjectURL(uploadFile);
      const decoratedFile = {
        ...uploadedFile,
        url: getFileUrl(uploadedFile) || localUrl,
        localUrl: localUrl || uploadedFile?.localUrl,
        entityType: 'box',
        entity_type: 'box',
        entityId: boxId,
        entity_id: boxId,
        boxId,
        box_id: boxId,
        fileType: uploadedFile?.fileType || uploadedFile?.file_type || 'fba_shipping_label',
        file_type: uploadedFile?.file_type || uploadedFile?.fileType || 'fba_shipping_label',
        name: uploadedFile?.name || uploadedFile?.fileName || uploadedFileName,
        fileName: uploadedFile?.fileName || uploadedFile?.name || uploadedFileName,
        original_filename: uploadedFile?.original_filename || uploadFile.name,
      };

      setFilesByBox((current) => ({
        ...current,
        [boxId]: [decoratedFile],
      }));
      setRows((current) =>
        current.map((row) =>
          getShipmentId(row.shipment) === getShipmentId(shipment)
            ? {
                ...row,
                boxes: row.boxes.map((currentBox, currentIndex) =>
                  (getBoxRecordId(currentBox) || getBoxId(currentBox)) === boxId || (!getBoxRecordId(currentBox) && currentIndex === index)
                    ? {
                        ...currentBox,
                        __fbaLabelUploaded: true,
                        labelReady: true,
                        label_ready: true,
                        fbaLabelUploaded: true,
                        fba_label_uploaded: true,
                        labelUploaded: true,
                        label_uploaded: true,
                        label_uploaded_at: new Date().toISOString(),
                        fba_shipping_label_file_id: getFileRecordId(decoratedFile) || currentBox?.fba_shipping_label_file_id,
                      }
                    : currentBox
                ),
              }
            : row
        )
      );
      setMessage(`FBA label uploaded for ${getBoxTitle(box, index)}.${uploadFile !== file ? ' Large image was optimized before upload.' : ''}`);
      await loadAwaitingFbaLabels({ showLoader: false });
    } catch (requestError) {
      setError(isPayloadTooLargeMessage(requestError.message) ? getUploadTooLargeMessage(file.name) : requestError.message);
    } finally {
      setUploadingKey('');
    }
  };

  return (
    <Layout>
      <div className="min-h-screen bg-white p-6">
        <div className="mb-4 flex items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold text-[#132347]">Awaiting FBA Labels</h1>
            <p className="mt-1 text-sm text-[#6b7280]">
              Upload Amazon FBA shipping labels for outbound boxes before they can be dispatched.
            </p>
          </div>
          <div className="flex shrink-0 flex-wrap items-center gap-3">
            <span className="rounded-full bg-red-100 px-3 py-1 text-xs font-semibold text-red-600">
              {isInitialLoading
                ? 'Checking boxes...'
                : `${pendingBoxCount} box${pendingBoxCount !== 1 ? 'es' : ''} pending`}
            </span>
            <button
              type="button"
              onClick={() => loadAwaitingFbaLabels({ clearMessage: true })}
              disabled={isLoading}
              className="inline-flex items-center gap-2 rounded-lg border border-[#dbe3ef] bg-white px-3 py-1.5 text-xs font-semibold text-[#64748b] hover:bg-[#f8fafc] disabled:cursor-not-allowed disabled:opacity-60"
            >
              <RefreshCw size={14} className={isLoading ? 'animate-spin' : ''} />
              Refresh
            </button>
          </div>
        </div>

        {message ? <p className="mb-4 rounded-lg border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-700">{message}</p> : null}
        {error ? <p className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p> : null}

        {isInitialLoading ? (
          <div className="rounded-xl border border-gray-200 bg-white px-5 py-12 text-center shadow-sm">
            <RefreshCw size={28} className="mx-auto mb-3 animate-spin text-[#ff8c2f]" />
            <p className="text-sm font-medium text-gray-700">Loading boxes awaiting FBA labels...</p>
            <p className="mt-1 text-xs text-gray-500">Checking shipments and outbound boxes.</p>
          </div>
        ) : visibleRows.length ? (
          <div className="space-y-4">
            {visibleRows.map(({ shipment, boxes }) => {
              const shipmentId = getShipmentId(shipment);
              const missingCount = boxes.filter((box) => !isBoxLabelReady(box, filesByBox)).length;
              const clientName = getShipmentClientName(shipment);
              const clientEmail = getShipmentClientEmail(shipment);

              return (
                <div key={shipmentId} className="overflow-hidden rounded-xl border border-[#e2e8f0] bg-white shadow-sm">
                  <div className="flex flex-col gap-3 border-b border-[#e2e8f0] bg-[#f8fafc] px-5 py-3 md:flex-row md:items-center md:justify-between">
                    <div className="min-w-0 space-y-1">
                      <div className="flex flex-wrap items-center gap-3">
                        <span className="text-sm font-semibold text-[#132347]">
                          {shipment.reference || shipmentId}
                        </span>
                        <span className="rounded-full bg-[#fff7ed] px-2 py-0.5 text-[11px] font-semibold uppercase text-[#ff8c2f]">
                          {formatStatus(shipment.status)}
                        </span>
                      </div>
                      <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 text-xs text-[#64748b]">
                        <span className="font-semibold text-[#132347]">Client: {clientName || '-'}</span>
                        {clientEmail ? <span className="truncate">{clientEmail}</span> : null}
                      </div>
                    </div>
                    <span className="text-xs text-[#6b7280]">
                      {missingCount} label{missingCount !== 1 ? 's' : ''} missing
                    </span>
                  </div>

                  <div className="divide-y divide-[#f1f5f9]">
                    {getBoxesGroupedBySku(boxes, shipment).map((group) => (
                        <div key={group.key || 'pending-sku'}>
                        <div className="bg-[#f8fafc] px-5 py-2 text-xs font-semibold uppercase tracking-wide text-[#64748b]">
                          {group.label || 'SKU allocation pending'} - {group.boxes.length} box{group.boxes.length !== 1 ? 'es' : ''}
                        </div>
                        <div className="divide-y divide-[#f1f5f9]">
                          {group.boxes.map(({ box, originalIndex }) => {
                            const boxId = getBoxRecordId(box) || getBoxId(box);
                            const labelReady = isBoxLabelReady(box, filesByBox);
                            const labelFile = getBoxLabelFile(box, filesByBox);
                            const uploadKey = `${shipmentId}-${boxId}`;
                            const isUploading = uploadingKey === uploadKey;
                            const contentSummary = getBoxContentsSummary(box, shipment, originalIndex);
                            const boxUnits = getBoxTotalQuantity(box, shipment, originalIndex);
                            const boxSize = getBoxSize(box);
                            const boxType = String(box?.box_type || box?.boxType || '').toLowerCase() === 'pallet' ? 'Pallet' : 'Box';

                            return (
                              <div
                                key={boxId || originalIndex}
                                role="button"
                                tabIndex={0}
                                onClick={() => setSelectedFbaBoxDetail({ shipment, box, boxIndex: originalIndex })}
                                onKeyDown={(event) => {
                                  if (event.key === 'Enter' || event.key === ' ') {
                                    event.preventDefault();
                                    setSelectedFbaBoxDetail({ shipment, box, boxIndex: originalIndex });
                                  }
                                }}
                                className={`grid items-center gap-4 px-5 py-4 md:grid-cols-[auto_minmax(0,1fr)_auto_auto] ${
                                  labelReady ? 'bg-white' : 'bg-[#fffbf7]'
                                } cursor-pointer transition-colors hover:bg-[#f8fafc] focus:outline-none focus:ring-2 focus:ring-inset focus:ring-[#ff9d3a]`}
                              >
                                <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-[#f1f5f9] text-sm font-bold text-[#132347]">
                                  {box?.box_number || originalIndex + 1}
                                </div>

                                <div className="min-w-0">
                                  <p className="text-sm font-medium text-[#132347]">
                                    {boxType} #{box?.box_number || originalIndex + 1}
                                    {boxSize ? ` - ${boxSize}` : ''}
                                  </p>
                                  {box.__subShipmentReference ? (
                                    <p className="mt-0.5 text-xs font-semibold text-[#ff8c2f]">
                                      Sub-shipment: {box.__subShipmentReference}
                                    </p>
                                  ) : null}
                                  {contentSummary ? (
                                    <p className="mt-0.5 text-sm font-semibold text-[#132347]">
                                      Contents: {contentSummary}
                                    </p>
                                  ) : null}
                                  {boxUnits !== '' ? (
                                    <p className="mt-0.5 text-xs text-[#64748b]">Units: {boxUnits}</p>
                                  ) : null}
                                </div>

                                <div>
                                  <span className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold ${
                                    labelReady ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-600'
                                  }`}>
                                    {labelReady ? <CheckCircle size={13} /> : null}
                                    {labelReady ? 'Label Uploaded' : 'Label Missing'}
                                  </span>
                                </div>

                                <div onClick={(event) => event.stopPropagation()}>
                                  {labelReady ? (
                                    <button
                                      type="button"
                                      onClick={(event) => {
                                        event.stopPropagation();
                                        labelFile && openOrDownloadFile(labelFile);
                                      }}
                                      disabled={!labelFile}
                                      className="rounded-lg border border-[#d1d5db] px-4 py-2 text-xs font-medium text-[#374151] hover:bg-[#f9fafb] disabled:cursor-not-allowed disabled:opacity-60"
                                    >
                                      View Label
                                    </button>
                                  ) : (
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
                                          handleOpenFbaLabelBatchUpload(shipment, box, originalIndex, file);
                                        }}
                                      />
                                    </label>
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
        ) : (
          <div className="rounded-xl border border-gray-200 bg-white px-5 py-12 text-center shadow-sm">
            <Tags size={28} className="mx-auto mb-3 text-gray-300" />
            <p className="text-sm font-medium text-gray-700">No boxes are currently awaiting FBA labels.</p>
            <p className="mt-1 text-xs text-gray-500">Received, in-progress, and prepped shipments with missing box labels will appear here.</p>
          </div>
        )}
      </div>

      {batchFbaUpload ? (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-lg overflow-hidden rounded-2xl bg-white shadow-xl">
            {(() => {
              const selectedSet = new Set(batchFbaUpload.selectedBoxIds || []);
              const allSelected = batchFbaUploadOptions.length > 0 && batchFbaUploadOptions.every((option) => selectedSet.has(option.boxId));
              const isUploading = uploadingKey === `batch-${getShipmentId(batchFbaUpload.shipment)}`;

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
                      aria-label="Close FBA label selection"
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
                        onChange={(event) => handleSetAllBatchBoxes(event.target.checked)}
                        disabled={isUploading || !batchFbaUploadOptions.length}
                        className="h-4 w-4 accent-[#ff9d3a]"
                      />
                      Select all missing boxes in this shipment
                    </label>

                    <div className="max-h-72 overflow-y-auto rounded-xl border border-[#e2e8f0]">
                      {batchFbaUploadOptions.map(({ box, boxId, index }) => {
                        const contentSummary = getBoxContentsSummary(box, batchFbaUpload.shipment, index);
                        const boxUnits = getBoxTotalQuantity(box, batchFbaUpload.shipment, index);
                        const boxNumber = firstPresent(box?.box_number, box?.boxNumber, index + 1);
                        const boxType = getBoxType(box) === 'pallet' ? 'Pallet' : 'Box';

                        return (
                          <label key={boxId} className="flex cursor-pointer items-center gap-3 border-b border-[#f1f5f9] px-4 py-3 last:border-b-0">
                            <input
                              type="checkbox"
                              checked={selectedSet.has(boxId)}
                              onChange={() => handleToggleBatchBox(boxId)}
                              disabled={isUploading}
                              className="h-4 w-4 accent-[#ff9d3a]"
                            />
                            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[#f1f5f9] text-xs font-bold text-[#132347]">
                              {boxNumber}
                            </span>
                            <span className="min-w-0">
                              <span className="block text-sm font-semibold text-[#132347]">
                                {boxType} #{boxNumber}{getBoxSize(box) ? ` - ${getBoxSize(box)}` : ''}
                              </span>
                              {contentSummary ? <span className="block text-xs text-[#64748b]">Contents: {contentSummary}</span> : null}
                              {boxUnits !== '' ? <span className="block text-xs text-[#64748b]">Units: {boxUnits}</span> : null}
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
                        onClick={handleConfirmFbaLabelBatchUpload}
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

      {selectedFbaBoxDetail ? (
        <div className="fixed inset-0 z-[90] flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-[700px] overflow-hidden rounded-2xl bg-white shadow-xl">
            {(() => {
              const { shipment, box, boxIndex } = selectedFbaBoxDetail;
              const contentRows = getBoxContentRows(box, shipment, boxIndex);
              const primarySku = getPrimaryBoxSku(box, shipment, boxIndex);
              const contentSummary = getBoxContentsSummary(box, shipment, boxIndex);
              const totalQuantity = getBoxTotalQuantity(box, shipment, boxIndex);
              const labelReady = isBoxLabelReady(box, filesByBox);
              const dimensions = getBoxDimensions(box);
              const weight = getBoxWeight(box);
              const boxNumber = firstPresent(box?.box_number, box?.boxNumber, boxIndex + 1);
              const clientName = getShipmentClientName(shipment);
              const clientEmail = getShipmentClientEmail(shipment);

              return (
                <>
                  <div className="flex items-start justify-between gap-4 border-b border-[#e2e8f0] px-6 py-4">
                    <div>
                      <h3 className="text-lg font-semibold text-[#132347]">
                        {getBoxType(box) === 'pallet' ? 'Pallet' : 'Box'} #{boxNumber}
                      </h3>
                      <p className="mt-1 text-xs text-[#6b7280]">{shipment?.reference || getShipmentId(shipment)}</p>
                      <p className="mt-1 text-xs font-semibold text-[#132347]">
                        Client: {clientName || '-'}{clientEmail ? ` (${clientEmail})` : ''}
                      </p>
                      {contentSummary || primarySku ? (
                        <p className="mt-1 text-sm font-semibold text-[#132347]">
                          Contents: {contentSummary || primarySku}
                        </p>
                      ) : null}
                    </div>
                    <button
                      type="button"
                      onClick={() => setSelectedFbaBoxDetail(null)}
                      className="rounded-lg p-1 text-[#94a3b8] hover:bg-[#f8fafc] hover:text-[#132347]"
                      aria-label="Close box detail"
                    >
                      <X size={20} />
                    </button>
                  </div>

                  <div className="space-y-5 p-6">
                    <div className="grid grid-cols-1 gap-3 text-sm sm:grid-cols-5">
                      <div className="rounded-xl border border-[#e2e8f0] bg-[#f8fafc] p-3">
                        <p className="text-[10px] font-semibold uppercase tracking-wider text-[#94a3b8]">Type</p>
                        <p className="mt-1 font-semibold text-[#132347]">{getBoxType(box)}</p>
                      </div>
                      <div className="rounded-xl border border-[#e2e8f0] bg-[#f8fafc] p-3">
                        <p className="text-[10px] font-semibold uppercase tracking-wider text-[#94a3b8]">Size</p>
                        <p className="mt-1 font-semibold text-[#132347]">{getBoxDisplaySize(box)}</p>
                      </div>
                      <div className="rounded-xl border border-[#e2e8f0] bg-[#f8fafc] p-3">
                        <p className="text-[10px] font-semibold uppercase tracking-wider text-[#94a3b8]">Dimensions</p>
                        <p className="mt-1 font-semibold text-[#132347]">{dimensions || '-'}</p>
                      </div>
                      <div className="rounded-xl border border-[#e2e8f0] bg-[#f8fafc] p-3">
                        <p className="text-[10px] font-semibold uppercase tracking-wider text-[#94a3b8]">Weight</p>
                        <p className="mt-1 font-semibold text-[#132347]">{weight !== '' ? `${weight} KG` : '-'}</p>
                      </div>
                      <div className="rounded-xl border border-[#e2e8f0] bg-[#f8fafc] p-3">
                        <p className="text-[10px] font-semibold uppercase tracking-wider text-[#94a3b8]">Contents</p>
                        <p className="mt-1 break-words font-semibold text-[#132347]">{contentSummary || primarySku || '-'}</p>
                      </div>
                      <div className="rounded-xl border border-[#e2e8f0] bg-[#f8fafc] p-3">
                        <p className="text-[10px] font-semibold uppercase tracking-wider text-[#94a3b8]">Units</p>
                        <p className="mt-1 font-semibold text-[#132347]">{totalQuantity !== '' ? totalQuantity : '-'}</p>
                      </div>
                    </div>

                    <div>
                      <div className="mb-2 flex items-center justify-between gap-3">
                        <p className="text-sm font-semibold text-[#132347]">SKU Allocation</p>
                        <span
                          className={`rounded-full px-3 py-1 text-xs font-semibold ${
                            labelReady ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-600'
                          }`}
                        >
                          {labelReady ? 'Label Uploaded' : 'Label Missing'}
                        </span>
                      </div>

                      {contentRows.length ? (
                        <div className="overflow-hidden rounded-xl border border-[#e2e8f0]">
                          {contentRows.map((item) => (
                            <div key={item.key} className="flex items-center justify-between border-b border-[#f1f5f9] px-4 py-3 last:border-b-0">
                              <span className="text-sm font-medium text-[#132347]">SKU: {item.sku || '-'}</span>
                              <span className="text-sm text-[#6b7280]">{item.quantity !== '' ? item.quantity : '-'}</span>
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
    </Layout>
  );
};

export default AwaitingFbaLabels;
