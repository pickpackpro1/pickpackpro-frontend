import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, CheckCircle2, Clock, Package, RefreshCw, Send, ChevronRight } from "lucide-react";
import { useNavigate } from "react-router-dom";
import LayoutStaff from "./stafflayout/LayoutStaff";
import LoadingState from "../common/LoadingState";
import FullPageLoader from "../common/FullPageLoader";
import { getSession } from "../../utils/auth";

const API_BASE_URL = import.meta.env.DEV ? "" : (import.meta.env.VITE_API_BASE_URL || 'https://ali-backend.vercel.app');

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

const extractRows = (payload) => {
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload?.data?.rows)) return payload.data.rows;
  if (Array.isArray(payload?.shipments)) return payload.shipments;
  if (Array.isArray(payload?.data)) return payload.data;
  return [];
};

const extractListByKeys = (payload, keys = []) => {
  if (Array.isArray(payload)) return payload;

  for (const key of keys) {
    if (Array.isArray(payload?.[key])) return payload[key];
    if (Array.isArray(payload?.data?.[key])) return payload.data[key];
    if (Array.isArray(payload?.summary?.[key])) return payload.summary[key];
    if (Array.isArray(payload?.dashboard?.[key])) return payload.dashboard[key];
  }

  if (Array.isArray(payload?.rows)) return payload.rows;
  if (Array.isArray(payload?.data?.rows)) return payload.data.rows;
  if (Array.isArray(payload?.results)) return payload.results;
  if (Array.isArray(payload?.data?.results)) return payload.data.results;
  if (Array.isArray(payload?.data)) return payload.data;
  return [];
};

const toArray = (value) => {
  if (Array.isArray(value)) return value;
  if (Array.isArray(value?.rows)) return value.rows;
  if (Array.isArray(value?.data?.rows)) return value.data.rows;
  if (Array.isArray(value?.data)) return value.data;
  if (Array.isArray(value?.services)) return value.services;
  if (Array.isArray(value?.serviceTasks)) return value.serviceTasks;
  if (Array.isArray(value?.service_tasks)) return value.service_tasks;
  if (Array.isArray(value?.tasks)) return value.tasks;
  return [];
};

const firstPresent = (...values) => {
  const value = values.find((currentValue) => {
    if (currentValue === 0 || currentValue === false) return true;
    return currentValue !== undefined && currentValue !== null && String(currentValue).trim() !== "";
  });

  return value === undefined || value === null ? "" : value;
};

const getShipmentId = (shipment = {}) =>
  shipment?.id ||
  shipment?.uuid ||
  shipment?.shipmentId ||
  shipment?.shipment_id ||
  shipment?.reference ||
  shipment?.shipmentNumber ||
  shipment?.shipment_number ||
  "";

const LINE_ITEM_KEYS = [
  "shipment_line_items",
  "shipmentLineItems",
  "line_items",
  "lineItems",
  "items",
  "shipmentItems",
  "shipment_items",
  "products",
  "productItems",
  "product_items",
  "lines",
];

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
        item?.products)
  );

const getLineItems = (source = {}) => {
  if (Array.isArray(source)) return source.some(hasLineItemShape) ? source : [];
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

const getLineItemExpectedQty = (item = {}) =>
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
    item?.units,
    0
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

const extractShipmentDetail = (payload) => {
  const detail = payload?.shipment || payload?.data?.shipment || payload?.data?.row || payload?.data || payload || {};
  if (!detail || typeof detail !== "object") return {};

  const detailItems = getLineItems(detail);
  const payloadItems = getLineItems(payload);
  return !detailItems.length && payloadItems.length ? { ...detail, shipment_line_items: payloadItems } : detail;
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
      .map((value) => String(value || "").trim())
      .filter(Boolean)
  ),
];

const getShipmentArrivalDate = (shipment = {}) =>
  firstPresent(
    shipment?.arrivedDate,
    shipment?.arrived_date,
    shipment?.receivedAt,
    shipment?.received_at,
    shipment?.actualArrivalDate,
    shipment?.actual_arrival_date,
    shipment?.expectedArrivalDate,
    shipment?.expected_arrival_date,
    shipment?.eta,
    shipment?.arrivalDate,
    shipment?.arrival_date
  );

const getShipmentActivityDate = (shipment = {}) =>
  firstPresent(
    shipment?.preppedAt,
    shipment?.prepped_at,
    shipment?.completedAt,
    shipment?.completed_at,
    shipment?.dispatchedAt,
    shipment?.dispatched_at,
    shipment?.updatedAt,
    shipment?.updated_at,
    shipment?.receivedAt,
    shipment?.received_at,
    shipment?.createdAt,
    shipment?.created_at
  );

const formatLocalDateText = (date) => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
};

const normalizeDateText = (value = "") => {
  if (!value) return "";
  const textValue = String(value);
  if (/^\d{4}-\d{2}-\d{2}/.test(textValue)) return textValue.slice(0, 10);
  const parsedDate = new Date(textValue);
  return Number.isNaN(parsedDate.getTime()) ? "" : formatLocalDateText(parsedDate);
};

const getTodayText = () => formatLocalDateText(new Date());

const isTodayDate = (value = "") => normalizeDateText(value) === getTodayText();

const formatArrivalValue = (value = "") => {
  const dateText = normalizeDateText(value);
  if (!dateText) return "";
  if (dateText === getTodayText()) return "Today";

  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  if (dateText === formatLocalDateText(tomorrow)) return "Tomorrow";

  return dateText;
};

const normalizeStatusValue = (value = "") => String(value || "").trim().toLowerCase().replace(/\s+/g, "_");

const serviceTaskKeys = [
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

const extractServiceTasks = (source = {}) => {
  if (Array.isArray(source)) return source;
  if (!source || typeof source !== "object") return [];

  for (const key of serviceTaskKeys) {
    const value = source[key];
    const rows = toArray(value);
    if (rows.length) return rows;
  }

  for (const key of ["data", "shipment", "row", "record", "detail", "result", "payload"]) {
    const value = source?.[key];
    if (!value || typeof value !== "object" || value === source) continue;
    const rows = extractServiceTasks(value);
    if (rows.length) return rows;
  }

  return [];
};

const getServiceTaskStatus = (service = {}) =>
  firstPresent(service?.status, service?.taskStatus, service?.task_status, service?.state);

const isServiceDone = (service = {}) => {
  const status = normalizeStatusValue(getServiceTaskStatus(service));
  return status === "done" || status === "completed" || status === "complete";
};

const getServicesDoneCount = (shipments = []) =>
  shipments.reduce((sum, shipment) => sum + extractServiceTasks(shipment).filter(isServiceDone).length, 0);

const getPreppedUnits = (shipments = []) => {
  const preppedShipments = shipments.filter((shipment) =>
    ["prepped", "dispatched", "completed"].includes(normalizeStatusValue(shipment.status))
  );
  const todayShipments = preppedShipments.filter((shipment) => isTodayDate(shipment.activityDate));
  const sourceRows = todayShipments.length ? todayShipments : preppedShipments;

  return sourceRows.reduce((sum, shipment) => sum + Number(shipment.units || 0), 0);
};

const getNextArrivalSummary = (shipments = []) => {
  const pendingRows = shipments.filter((shipment) =>
    ["draft", "submitted", "pending_arrival"].includes(normalizeStatusValue(shipment.status))
  );
  const arrivalRows = pendingRows
    .map((shipment) => normalizeDateText(shipment.arrivalDate))
    .filter(Boolean)
    .sort();

  return {
    value: formatArrivalValue(arrivalRows[0]) || (pendingRows.length ? "Pending" : "-"),
    pendingCount: pendingRows.length,
  };
};

const timeEntryKeys = [
  "entries",
  "timeEntries",
  "time_entries",
  "rows",
  "timesheets",
  "timeLogs",
  "time_logs",
  "shifts",
  "attendance",
  "recentTimeEntries",
  "recent_time_entries",
];

const getEntryStartedAt = (entry = {}) =>
  firstPresent(
    entry?.checkInAt,
    entry?.check_in_at,
    entry?.checkedInAt,
    entry?.checked_in_at,
    entry?.clockInAt,
    entry?.clock_in_at,
    entry?.startedAt,
    entry?.started_at,
    entry?.startTime,
    entry?.start_time,
    entry?.createdAt,
    entry?.created_at
  );

const getEntryEndedAt = (entry = {}) =>
  firstPresent(
    entry?.checkOutAt,
    entry?.check_out_at,
    entry?.checkedOutAt,
    entry?.checked_out_at,
    entry?.clockOutAt,
    entry?.clock_out_at,
    entry?.endedAt,
    entry?.ended_at,
    entry?.endTime,
    entry?.end_time
  );

const formatTimeValue = (value = "") => {
  if (!value) return "-";
  const parsedDate = new Date(value);
  if (Number.isNaN(parsedDate.getTime())) return String(value);

  return parsedDate.toLocaleString([], {
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
};

const getEntryDurationLabel = (entry = {}) => {
  const explicitDuration = firstPresent(
    entry?.duration,
    entry?.durationLabel,
    entry?.duration_label,
    entry?.hours,
    entry?.totalHours,
    entry?.total_hours
  );

  if (explicitDuration !== "") {
    return typeof explicitDuration === "number" ? `${explicitDuration}h` : String(explicitDuration);
  }

  const startedAt = new Date(getEntryStartedAt(entry));
  const endedAt = new Date(getEntryEndedAt(entry));
  if (Number.isNaN(startedAt.getTime()) || Number.isNaN(endedAt.getTime())) return "";

  const minutes = Math.max(0, Math.round((endedAt.getTime() - startedAt.getTime()) / 60000));
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  return hours ? `${hours}h ${remainingMinutes}m` : `${remainingMinutes}m`;
};

const normalizeTimeEntry = (entry = {}, index = 0) => {
  const startedAt = getEntryStartedAt(entry);
  const endedAt = getEntryEndedAt(entry);
  const status = firstPresent(entry?.status, entry?.state, endedAt ? "Completed" : "In Progress");

  return {
    id: firstPresent(entry?.id, entry?.uuid, entry?.entryId, entry?.entry_id, `${startedAt || "entry"}-${index}`),
    title: firstPresent(entry?.title, entry?.label, entry?.type, entry?.action, endedAt ? "Shift completed" : "Shift in progress"),
    startedAt,
    endedAt,
    status,
    duration: getEntryDurationLabel(entry),
  };
};

const getDashboardNotes = ({ dashboard = {}, shipments = [], timeEntries = [], stats = [] }) => {
  const summary = dashboard?.summary || dashboard?.stats || {};
  const dashboardNotes = extractListByKeys(dashboard, ["notes", "dashboardNotes", "dashboard_notes", "recentActivity", "recent_activity", "activity"]);

  if (dashboardNotes.length) {
    return dashboardNotes.slice(0, 5).map((note, index) => ({
      id: firstPresent(note?.id, note?.uuid, index),
      title: firstPresent(note?.title, note?.message, note?.note, note?.description, note?.text, "Dashboard update"),
      meta: firstPresent(note?.createdAt, note?.created_at, note?.date, note?.time),
    }));
  }

  const activeTasks = stats.find((item) => item.label === "ACTIVE TASKS")?.value || shipments.length;
  const unitsPrepped = stats.find((item) => item.label === "UNITS PREPPED TODAY")?.value || 0;
  const servicesDone = stats.find((item) => item.label === "SERVICES DONE")?.value || 0;
  const nextArrival = stats.find((item) => item.label === "NEXT ARRIVAL")?.value || "-";

  return [
    {
      id: "active",
      title: `${activeTasks} active shipment${String(activeTasks) === "1" ? "" : "s"} assigned.`,
      meta: "Live dashboard",
    },
    {
      id: "prep",
      title: `${unitsPrepped} units prepped and ${servicesDone} services done.`,
      meta: firstPresent(summary?.updatedAt, summary?.updated_at, dashboard?.updatedAt, dashboard?.updated_at, "Today"),
    },
    {
      id: "arrival",
      title: nextArrival === "-" ? "No pending arrivals found." : `Next arrival: ${nextArrival}.`,
      meta: timeEntries.length ? `${timeEntries.length} time entries loaded` : "No time entries loaded",
    },
  ];
};

const normalizeShipment = (shipment) => ({
  id: getShipmentId(shipment),
  reference: shipment?.reference || shipment?.shipmentNumber || shipment?.id || "N/A",
  client:
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
    "-",
  units: getShipmentUnits(shipment),
  arrivalDate: getShipmentArrivalDate(shipment),
  activityDate: getShipmentActivityDate(shipment),
  serviceTasks: extractServiceTasks(shipment),
  service_tasks: extractServiceTasks(shipment),
  status: shipment?.status || "draft",
});

const formatStatusLabel = (value = "") =>
  String(value)
    .replace(/_/g, " ")
    .split(" ")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");

const getStatusStyle = (status = "") => {
  switch (String(status).toLowerCase()) {
    case "draft":
      return "bg-slate-100 text-slate-700";
    case "submitted":
      return "bg-blue-100 text-blue-700";
    case "pending_arrival":
      return "bg-amber-100 text-amber-700";
    case "received":
      return "bg-emerald-100 text-emerald-700";
    case "in_progress":
      return "bg-orange-100 text-orange-700";
    case "prepped":
      return "bg-purple-100 text-purple-700";
    case "dispatched":
      return "bg-teal-100 text-teal-700";
    case "completed":
      return "bg-green-100 text-green-700";
    default:
      return "bg-gray-100 text-gray-700";
  }
};

const MyTasks = () => {
  const navigate = useNavigate();
  const [shipments, setShipments] = useState([]);
  const [dashboard, setDashboard] = useState(null);
  const [timeEntries, setTimeEntries] = useState([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  const loadData = async () => {
    try {
      setIsLoading(true);
      setError("");
      const [shipmentsResponse, dashboardResponse, entriesResponse] = await Promise.all([
        fetch(`${API_BASE_URL}/api/shipments?page=1&limit=3`, { method: "GET", headers: buildHeaders() }),
        fetch(`${API_BASE_URL}/api/dashboard/staff`, { method: "GET", headers: buildHeaders() }),
        fetch(`${API_BASE_URL}/api/time/entries`, { method: "GET", headers: buildHeaders() }),
      ]);

      const shipmentsPayload = await parseResponse(shipmentsResponse);
      const dashboardPayload = await parseResponse(dashboardResponse);
      const entriesPayload = await parseResponse(entriesResponse);
      const dashboardData = dashboardPayload?.data || dashboardPayload?.dashboard || dashboardPayload || {};
      const shipmentRows = extractRows(shipmentsPayload);
      const normalizedRows = shipmentRows.map(normalizeShipment);
      const shipmentDetailResults = await Promise.allSettled(
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
              const detailLineItems = getLineItems(detail);
              const rowLineItems = getLineItems(shipmentRows[index]);
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
              // Some endpoints accept UUIDs while others accept shipment references.
            }
          }

          return shipmentRows[index];
        })
      );

      const enrichedShipmentRows = shipmentDetailResults.map((result, index) =>
        result.status === "fulfilled" ? result.value : shipmentRows[index]
      );
      const serviceResults = await Promise.allSettled(
        enrichedShipmentRows.map(async (shipment, index) => {
          const normalizedShipment = normalizeShipment(shipment);
          const existingServices = extractServiceTasks(shipment);
          if (existingServices.length || !normalizedShipment.id) return existingServices;

          const lookupCandidates = getShipmentLookupCandidates(shipment, normalizedShipment);

          for (const lookupId of lookupCandidates) {
            try {
              const servicesResponse = await fetch(`${API_BASE_URL}/api/shipments/${encodeURIComponent(lookupId)}/services`, {
                method: "GET",
                headers: buildHeaders(),
                cache: "no-store",
              });
              return extractServiceTasks(await parseResponse(servicesResponse));
            } catch {
              // Try the next shipment identifier.
            }
          }

          return extractServiceTasks(shipmentRows[index]);
        })
      );
      const rowsWithServices = enrichedShipmentRows.map((shipment, index) => {
        const loadedServices = serviceResults[index]?.status === "fulfilled" ? serviceResults[index].value : [];
        const serviceTasks = loadedServices.length ? loadedServices : extractServiceTasks(shipment);

        return {
          ...shipment,
          services: serviceTasks,
          serviceTasks,
          service_tasks: serviceTasks,
        };
      });

      setShipments(rowsWithServices.map(normalizeShipment));
      setDashboard(dashboardData);
      setTimeEntries(
        [
          ...extractListByKeys(entriesPayload, timeEntryKeys),
          ...extractListByKeys(dashboardData, timeEntryKeys),
        ].map(normalizeTimeEntry)
      );
    } catch (requestError) {
      setError(requestError.message);
      setShipments([]);
      setDashboard(null);
      setTimeEntries([]);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  const stats = useMemo(() => {
    const summary = dashboard?.summary || dashboard?.stats || {};
    const activeTasks =
      dashboard?.activeTasks ??
      dashboard?.active_tasks ??
      summary?.activeTasks ??
      summary?.active_tasks ??
      shipments.length;
    const computedUnitsPrepped = getPreppedUnits(shipments);
    const dashboardUnitsPrepped = Number(
      firstPresent(
        dashboard?.unitsPreppedToday,
        dashboard?.units_prepped_today,
        dashboard?.preppedUnitsToday,
        dashboard?.prepped_units_today,
        summary?.unitsPreppedToday,
        summary?.units_prepped_today,
        summary?.preppedUnitsToday,
        summary?.prepped_units_today,
        ""
      )
    );
    const unitsPrepped = dashboardUnitsPrepped > 0 ? dashboardUnitsPrepped : computedUnitsPrepped;
    const computedServicesDone = getServicesDoneCount(shipments);
    const dashboardServicesDone = Number(
      firstPresent(
        dashboard?.servicesDone,
        dashboard?.services_done,
        dashboard?.completedServices,
        dashboard?.completed_services,
        dashboard?.servicesCompletedToday,
        dashboard?.services_completed_today,
        summary?.servicesDone,
        summary?.services_done,
        summary?.completedServices,
        summary?.completed_services,
        summary?.servicesCompletedToday,
        summary?.services_completed_today,
        ""
      )
    );
    const servicesDone = dashboardServicesDone > 0 ? dashboardServicesDone : computedServicesDone;
    const nextArrivalSummary = getNextArrivalSummary(shipments);
    const dashboardNextArrival = firstPresent(
      dashboard?.nextArrival,
      dashboard?.next_arrival,
      dashboard?.nextArrivalDate,
      dashboard?.next_arrival_date,
      summary?.nextArrival,
      summary?.next_arrival,
      summary?.nextArrivalDate,
      summary?.next_arrival_date
    );
    const nextArrival = nextArrivalSummary.value && nextArrivalSummary.value !== "-" ? nextArrivalSummary.value : dashboardNextArrival;
    const dashboardPendingCount = Number(
      firstPresent(
        dashboard?.pendingCount,
        dashboard?.pending_count,
        dashboard?.pendingArrivals,
        dashboard?.pending_arrivals,
        summary?.pendingCount,
        summary?.pending_count,
        summary?.pendingArrivals,
        summary?.pending_arrivals,
        ""
      )
    );
    const pendingCount = Math.max(
      Number.isFinite(dashboardPendingCount) ? dashboardPendingCount : 0,
      nextArrivalSummary.pendingCount
    );

    return [
      { label: "ACTIVE TASKS", value: String(activeTasks), sublabel: "Live dashboard", icon: AlertTriangle, textColor: "text-orange-600" },
      { label: "UNITS PREPPED TODAY", value: String(unitsPrepped), sublabel: "on target", icon: Package, textColor: "text-green-600" },
      { label: "SERVICES DONE", value: String(servicesDone), sublabel: "", icon: CheckCircle2, textColor: "text-blue-600" },
      { label: "NEXT ARRIVAL", value: nextArrival || "-", sublabel: pendingCount ? `${pendingCount} pending` : "no pending", icon: Send, textColor: "text-purple-600" },
    ];
  }, [dashboard, shipments]);

  const dashboardNotes = useMemo(
    () => getDashboardNotes({ dashboard, shipments, timeEntries, stats }),
    [dashboard, shipments, stats, timeEntries]
  );

  const checkIn = async () => {
    try {
      setError("");
      setMessage("");
      await parseResponse(
        await fetch(`${API_BASE_URL}/api/time/checkin`, {
          method: "POST",
          headers: buildHeaders(true),
          body: JSON.stringify({}),
        })
      );
      setMessage("Checked in successfully.");
      await loadData();
    } catch (requestError) {
      setError(requestError.message);
    }
  };

  const checkOut = async () => {
    try {
      setError("");
      setMessage("");
      await parseResponse(
        await fetch(`${API_BASE_URL}/api/time/checkout`, {
          method: "POST",
          headers: buildHeaders(true),
          body: JSON.stringify({}),
        })
      );
      setMessage("Checked out successfully.");
      await loadData();
    } catch (requestError) {
      setError(requestError.message);
    }
  };

  return (
    <LayoutStaff>
      <FullPageLoader show={isLoading} label="Loading staff dashboard..." />
      <div className="p-6">
        <div className="mb-4 flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">My Shipments</h1>
            <p className="mt-1 text-sm text-gray-500">Staff dashboard and live time tracking.</p>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={checkIn} className="rounded-lg border border-gray-200 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50">Check In</button>
            <button onClick={checkOut} className="rounded-lg bg-[#ff6900] px-4 py-2 text-sm font-medium text-white hover:bg-[#e55d00]">Check Out</button>
            <button onClick={loadData} className="inline-flex items-center gap-2 rounded-lg border border-gray-200 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50">
              <RefreshCw className="h-4 w-4" />
              Refresh
            </button>
          </div>
        </div>

        {message ? <div className="mb-4 rounded-lg border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-700">{message}</div> : null}
        {error ? <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div> : null}

        <div className="mb-8 grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-4">
          {stats.map((stat) => (
            <div key={stat.label} className="rounded-lg border bg-white p-4 shadow-sm">
              <div className="mb-2 flex items-start justify-between">
                <span className="text-xs font-medium uppercase tracking-wider text-gray-500">{stat.label}</span>
                <stat.icon className={`h-5 w-5 ${stat.textColor}`} />
              </div>
              <div className="mb-1 text-2xl font-bold text-gray-900">{stat.value}</div>
              {stat.sublabel ? <div className={`text-sm font-medium ${stat.textColor}`}>{stat.sublabel}</div> : null}
            </div>
          ))}
        </div>

        <div className="mb-8 rounded-lg border bg-white shadow-sm">
          <div className="flex items-center justify-between border-b px-6 py-4">
            <h3 className="text-lg font-semibold">Active Shipments</h3>
            <button onClick={() => navigate("/shipments")} className="text-sm font-medium text-[#ff6900] hover:text-[#e65f00]">
              View All
            </button>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="bg-gray-50 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                  <th className="px-6 py-3">Shipment ID</th>
                  <th className="px-6 py-3">Client</th>
                  <th className="px-6 py-3">Units</th>
                  <th className="px-6 py-3">Status</th>
                  <th className="px-6 py-3">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {isLoading ? (
                  <tr>
                    <td colSpan="5" className="px-6 py-8 text-center text-sm text-gray-500">
                      <LoadingState label="Loading shipments..." />
                    </td>
                  </tr>
                ) : shipments.map((shipment) => (
                  <tr key={shipment.id} className="hover:bg-gray-50">
                    <td className="px-6 py-4 font-mono text-sm text-[#ff6900]">{shipment.reference}</td>
                    <td className="px-6 py-4 text-sm text-gray-800">{shipment.client}</td>
                    <td className="px-6 py-4 text-sm text-gray-700">{shipment.units}</td>
                    <td className="px-6 py-4">
                      <span className={`inline-flex rounded-full px-2 py-1 text-xs font-semibold ${getStatusStyle(shipment.status)}`}>
                        {formatStatusLabel(shipment.status)}
                      </span>
                    </td>
                    <td className="px-6 py-4">
                      <button onClick={() => navigate('/shipments', { state: { selectedShipmentId: shipment.id } })} className="inline-flex items-center gap-1 rounded-lg bg-[#ff6900] px-3 py-1.5 text-sm font-medium text-white hover:bg-[#e65f00]">
                        Manage
                        <ChevronRight className="h-4 w-4" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          <div className="rounded-lg border bg-white p-6 shadow-sm">
            <h3 className="mb-4 flex items-center gap-2 text-lg font-semibold">
              <AlertTriangle className="h-5 w-5 text-amber-600" />
              Time Entries
            </h3>
            <div className="space-y-3">
              {timeEntries.slice(0, 5).map((entry, index) => (
                <div key={entry.id || index} className="rounded-lg border border-gray-200 bg-gray-50 p-3 text-sm">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="font-semibold text-gray-900">{entry.title}</p>
                      <p className="mt-1 text-xs text-gray-500">
                        {formatTimeValue(entry.startedAt)} - {entry.endedAt ? formatTimeValue(entry.endedAt) : "Now"}
                      </p>
                    </div>
                    <span className="rounded-full bg-white px-2 py-1 text-xs font-semibold text-gray-700">
                      {entry.duration || entry.status}
                    </span>
                  </div>
                </div>
              ))}
              {!timeEntries.length ? (
                <p className="text-sm text-gray-500">No time entries returned yet. Use Check In / Check Out to create a shift entry.</p>
              ) : null}
            </div>
          </div>

          <div className="rounded-lg border bg-white p-6 shadow-sm">
            <h3 className="mb-4 flex items-center gap-2 text-lg font-semibold">
              <Clock className="h-5 w-5 text-gray-600" />
              Dashboard Notes
            </h3>
            <div className="space-y-3">
              {dashboardNotes.map((note) => (
                <div key={note.id} className="rounded-lg border border-gray-200 bg-gray-50 p-3 text-sm">
                  <p className="font-semibold text-gray-900">{note.title}</p>
                  {note.meta ? <p className="mt-1 text-xs text-gray-500">{formatTimeValue(note.meta)}</p> : null}
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </LayoutStaff>
  );
};

export default MyTasks;
