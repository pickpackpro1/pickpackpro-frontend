import { getSession } from "./auth";

const API_BASE_URL = '';

let notificationsEndpointUnavailable = false;
const READ_NOTIFICATION_CACHE_PREFIX = "pickpackpro-read-notifications";

const getNotificationAudioContext = () => {
  return null;
};

const parseJsonResponse = async (response) => {
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

export const buildNotificationHeaders = (includeJson = false) => {
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

const firstPresent = (...values) => {
  const value = values.find((currentValue) => {
    if (currentValue === 0) return true;
    return currentValue !== undefined && currentValue !== null && String(currentValue).trim() !== "";
  });

  return value === undefined || value === null ? "" : String(value).trim();
};

const getNotificationLocalCacheKey = () => {
  const session = getSession();
  const userKey = firstPresent(session?.userId, session?.id, session?.uuid, session?.email, session?.role, "anonymous");
  return `${READ_NOTIFICATION_CACHE_PREFIX}:${userKey}`;
};

const readCachedNotificationIds = () => {
  if (typeof localStorage === "undefined") return new Set();

  try {
    const rawValue = localStorage.getItem(getNotificationLocalCacheKey());
    const ids = rawValue ? JSON.parse(rawValue) : [];
    return new Set(Array.isArray(ids) ? ids.map((id) => String(id)) : []);
  } catch {
    return new Set();
  }
};

const writeCachedNotificationIds = (ids = []) => {
  if (typeof localStorage === "undefined") return;

  try {
    const nextIds = [...new Set([...ids].map((id) => String(id)).filter(Boolean))].slice(-500);
    localStorage.setItem(getNotificationLocalCacheKey(), JSON.stringify(nextIds));
  } catch {
    // Ignore local read-cache failures.
  }
};

const addCachedReadNotificationIds = (ids = []) => {
  const currentIds = readCachedNotificationIds();
  ids.map((id) => String(id || "").trim()).filter(Boolean).forEach((id) => currentIds.add(id));
  writeCachedNotificationIds(currentIds);
};

const getNotificationReference = (item = {}) => {
  const data = item?.data || item?.payload || item?.meta || item?.metadata || item?.details || {};
  const shipment = item?.shipment || data?.shipment || {};
  const invoice = item?.invoice || data?.invoice || {};
  const client = item?.client || data?.client || {};
  const product = item?.product || data?.product || {};

  return firstPresent(
    item?.reference,
    item?.shipmentReference,
    item?.shipment_reference,
    item?.shipmentNumber,
    item?.shipment_number,
    shipment?.reference,
    shipment?.shipmentNumber,
    shipment?.shipment_number,
    item?.invoiceNumber,
    item?.invoice_number,
    invoice?.reference,
    invoice?.invoiceNumber,
    invoice?.invoice_number,
    client?.companyName,
    client?.company_name,
    client?.name,
    product?.sku,
    product?.name,
    data?.reference,
    data?.shipmentReference,
    data?.shipment_reference,
    data?.invoiceNumber,
    data?.invoice_number
  );
};

const getNotificationActor = (item = {}) => {
  const data = item?.data || item?.payload || item?.meta || item?.metadata || item?.details || {};
  const actor = item?.actor || data?.actor || item?.createdBy || data?.createdBy || {};
  const client = item?.client || data?.client || item?.clients || data?.clients || {};
  const user = item?.user || data?.user || item?.sender || data?.sender || {};

  return firstPresent(
    item?.actorName,
    item?.actor_name,
    item?.senderName,
    item?.sender_name,
    item?.createdByName,
    item?.created_by_name,
    actor?.companyName,
    actor?.company_name,
    actor?.name,
    actor?.fullName,
    actor?.full_name,
    client?.companyName,
    client?.company_name,
    client?.name,
    user?.companyName,
    user?.company_name,
    user?.name,
    user?.fullName,
    user?.full_name,
    data?.clientName,
    data?.client_name,
    data?.companyName,
    data?.company_name
  );
};

const formatBoxNumberLabel = (value = "") => {
  const normalized = String(value || "").trim();
  if (!normalized) return "";
  return /^\d+$/.test(normalized) ? `Box ${normalized}` : normalized;
};

const getNotificationSubject = (item = {}) => {
  const data = item?.data || item?.payload || item?.meta || item?.metadata || item?.details || {};
  const box = item?.box || data?.box || {};
  const discrepancy = item?.discrepancy || data?.discrepancy || {};

  return firstPresent(
    item?.subject,
    item?.event,
    item?.type,
    item?.notificationType,
    item?.notification_type,
    data?.subject,
    data?.event,
    data?.type,
    data?.notificationType,
    data?.notification_type,
    formatBoxNumberLabel(firstPresent(box?.boxNumber, box?.box_number)),
    formatBoxNumberLabel(firstPresent(data?.boxNumber, data?.box_number)),
    discrepancy?.sku,
    data?.sku
  );
};

const getNotificationText = (item) => {
  const text =
    item?.text ||
    item?.message ||
    item?.title ||
    item?.body ||
    item?.content ||
    item?.description ||
    "Notification";
  const reference = getNotificationReference(item);
  const actor = getNotificationActor(item);
  const subject = getNotificationSubject(item);
  const parts = [];

  if (actor && !String(text).toLowerCase().includes(String(actor).toLowerCase())) {
    parts.push(actor);
  }

  parts.push(text);

  if (subject && !String(text).toLowerCase().includes(String(subject).toLowerCase())) {
    parts.push(subject);
  }

  if (!reference || String(text).toLowerCase().includes(String(reference).toLowerCase())) {
    return parts.join(" - ");
  }

  parts.push(reference);
  return parts.join(" - ");
};

const getNestedNotificationValue = (item = {}, keys = []) => {
  const data = item?.data || item?.payload || item?.meta || item?.metadata || item?.details || {};
  const candidates = [
    item,
    data,
    item?.entity,
    item?.resource,
    item?.record,
    data?.entity,
    data?.resource,
    data?.record,
    item?.shipment,
    data?.shipment,
    item?.invoice,
    data?.invoice,
    item?.client,
    data?.client,
    item?.product,
    data?.product,
  ].filter(Boolean);

  for (const candidate of candidates) {
    for (const key of keys) {
      const value = candidate?.[key];
      if (value !== undefined && value !== null && String(value).trim() !== "") {
        return String(value).trim();
      }
    }
  }

  return "";
};

const getNotificationEntityType = (notification = {}) => {
  const raw = notification.raw || notification;
  const text = String(notification.text || getNotificationText(raw)).toLowerCase();
  const explicitType = getNestedNotificationValue(raw, [
    "entityType",
    "entity_type",
    "resourceType",
    "resource_type",
    "model",
    "module",
    "targetType",
    "target_type",
  ]).toLowerCase();

  if (explicitType) return explicitType;
  if (text.includes("invoice") || text.includes("billing") || text.includes("payment")) return "invoice";
  if (text.includes("client") || text.includes("customer")) return "client";
  if (text.includes("product") || text.includes("sku") || text.includes("inventory")) return "product";
  if (text.includes("dispatch") || text.includes("dispatched")) return "dispatch";
  if (text.includes("receiv") || text.includes("arriv") || text.includes("warehouse")) return "receiving";
  if (text.includes("setting") || text.includes("user") || text.includes("staff")) return "settings";
  if (text.includes("audit")) return "audit";
  if (text.includes("task") || text.includes("prep") || text.includes("service")) return "task";
  if (text.includes("shipment") || text.includes("fba") || text.includes("label") || text.includes("box")) return "shipment";

  return "";
};

const getNotificationEntityId = (notification = {}) => {
  const raw = notification.raw || notification;
  const explicitId = getNestedNotificationValue(raw, [
    "entityId",
    "entity_id",
    "resourceId",
    "resource_id",
    "targetId",
    "target_id",
    "recordId",
    "record_id",
    "shipmentId",
    "shipment_id",
    "invoiceId",
    "invoice_id",
    "clientId",
    "client_id",
    "productId",
    "product_id",
    "taskId",
    "task_id",
  ]);

  if (explicitId) return explicitId;

  const data = raw?.data || raw?.payload || raw?.meta || raw?.metadata || raw?.details || {};
  const entityType = getNotificationEntityType(notification);

  if (entityType.includes("shipment") || entityType.includes("box") || entityType.includes("service") || entityType.includes("task")) {
    return firstPresent(raw?.shipment?.id, raw?.shipment?.uuid, data?.shipment?.id, data?.shipment?.uuid);
  }

  if (entityType.includes("invoice") || entityType.includes("billing")) {
    return firstPresent(raw?.invoice?.id, raw?.invoice?.uuid, data?.invoice?.id, data?.invoice?.uuid);
  }

  if (entityType.includes("client") || entityType.includes("customer")) {
    return firstPresent(raw?.client?.id, raw?.client?.uuid, data?.client?.id, data?.client?.uuid);
  }

  if (entityType.includes("product") || entityType.includes("inventory") || entityType.includes("sku")) {
    return firstPresent(raw?.product?.id, raw?.product?.uuid, data?.product?.id, data?.product?.uuid);
  }

  return "";
};

export const resolveNotificationNavigation = (notification = {}, role = "admin") => {
  const raw = notification.raw || notification;
  const directPath = getNestedNotificationValue(raw, [
    "path",
    "route",
    "href",
    "link",
    "url",
    "targetUrl",
    "target_url",
    "actionUrl",
    "action_url",
    "deepLink",
    "deep_link",
  ]);

  if (directPath.startsWith("/")) {
    return { pathname: directPath };
  }

  const entityType = getNotificationEntityType(notification);
  const entityId = getNotificationEntityId(notification);
  const text = String(notification.text || getNotificationText(raw)).toLowerCase();
  const isStaff = role === "staff";
  const isClient = role === "client";

  if (entityType.includes("invoice") || entityType.includes("billing")) {
    return { pathname: isClient ? "/invoices" : "/billing" };
  }

  if (entityType.includes("client") || entityType.includes("customer")) {
    return { pathname: isClient ? "/account" : "/clients" };
  }

  if (entityType.includes("product") || entityType.includes("inventory") || entityType.includes("sku")) {
    return { pathname: "/products" };
  }

  if (entityType.includes("dispatch") || text.includes("dispatch") || text.includes("dispatched")) {
    return { pathname: "/dispatch" };
  }

  if (entityType.includes("receiving") || text.includes("receiv") || text.includes("arriv")) {
    return { pathname: "/receiving" };
  }

  if (entityType.includes("audit")) {
    return { pathname: "/audit-log" };
  }

  if (entityType.includes("setting") || entityType.includes("user") || entityType.includes("staff")) {
    return { pathname: isStaff ? "/tasks" : isClient ? "/account" : "/settings" };
  }

  if (
    entityType.includes("shipment") ||
    entityType.includes("box") ||
    entityType.includes("service") ||
    entityType.includes("task") ||
    text.includes("shipment") ||
    text.includes("fba") ||
    text.includes("label") ||
    text.includes("box")
  ) {
    if (isClient) {
      return { pathname: "/shipments" };
    }

    if (isStaff) {
      return entityId
        ? { pathname: "/shipments", state: { selectedShipmentId: entityId } }
        : { pathname: "/shipments" };
    }

    return entityId ? { pathname: `/shipments/${encodeURIComponent(entityId)}` } : { pathname: "/shipments" };
  }

  return { pathname: isStaff ? "/tasks" : "/dashboard" };
};

export const normalizeNotification = (item, index = 0) => {
  const id =
    item?.id ||
    item?.uuid ||
    item?.notificationId ||
    item?.notification_id ||
    item?._id ||
    firstPresent(item?.createdAt, item?.created_at, item?.timestamp, item?.time, getNotificationText(item)) ||
    `notification-${index}`;
  const cachedReadIds = readCachedNotificationIds();
  const backendUnread =
    typeof item?.unread === "boolean"
      ? item.unread
      : typeof item?.isRead === "boolean"
        ? !item.isRead
        : typeof item?.read === "boolean"
          ? !item.read
          : item?.readAt || item?.read_at || item?.seenAt || item?.seen_at || item?.markedReadAt || item?.marked_read_at
            ? false
          : item?.status
            ? String(item.status).toLowerCase() !== "read"
            : true;

  return {
    id,
    text: getNotificationText(item),
    unread: backendUnread && !cachedReadIds.has(String(id)),
    alert:
      Boolean(item?.alert) ||
      Boolean(item?.isAlert) ||
      ["alert", "critical", "error", "warning"].includes(
        String(item?.type || item?.severity || "").toLowerCase()
      ),
    createdAt:
      item?.createdAt ||
      item?.created_at ||
      item?.timestamp ||
      item?.time ||
      "",
    reference: getNotificationReference(item),
    actor: getNotificationActor(item),
    subject: getNotificationSubject(item),
    raw: item,
  };
};

export const normalizeNotificationList = (payload) => {
  const source =
    payload?.data?.notifications ||
    payload?.data?.items ||
    payload?.data?.rows ||
    payload?.data ||
    payload?.notifications ||
    payload?.items ||
    payload?.rows ||
    payload;

  if (!Array.isArray(source)) {
    return [];
  }

  return source.map((item, index) => normalizeNotification(item, index));
};

export const fetchNotifications = async () => {
  if (notificationsEndpointUnavailable) {
    return [];
  }

  if (!getSession()?.token) {
    return [];
  }

  const response = await fetch(`${API_BASE_URL}/api/notifications`, {
    method: "GET",
    headers: buildNotificationHeaders(),
    cache: "no-store",
  });

  if ([400, 401, 403, 404].includes(response.status)) {
    notificationsEndpointUnavailable = true;
    return [];
  }

  const payload = await parseJsonResponse(response);
  return normalizeNotificationList(payload);
};

export const markNotificationRead = async (notificationId) => {
  addCachedReadNotificationIds([notificationId]);

  const response = await fetch(`${API_BASE_URL}/api/notifications`, {
    method: "PATCH",
    headers: buildNotificationHeaders(true),
    cache: "no-store",
    body: JSON.stringify({
      ids: [notificationId],
    }),
  });

  return parseJsonResponse(response);
};

export const markAllNotificationsRead = async (notificationIds = []) => {
  addCachedReadNotificationIds(notificationIds);

  const response = await fetch(`${API_BASE_URL}/api/notifications/read-all`, {
    method: "POST",
    headers: buildNotificationHeaders(),
    cache: "no-store",
  });

  return parseJsonResponse(response);
};

export const unlockNotificationAudio = () => {
  return undefined;
};

export const setupNotificationAudioUnlock = () => {
  return () => {};
};

const playNotificationChime = () => {
  return undefined;
};

export const speakNotificationSummary = (count) => {
  return undefined;
};
