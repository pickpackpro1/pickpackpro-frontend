import { useEffect, useMemo, useState } from "react";
import { CheckCircle2, Download, Filter, Package, RefreshCw, Search, Send, Tag, Truck } from "lucide-react";
import LayoutStaff from "./stafflayout/LayoutStaff";
import LoadingState from "../common/LoadingState";
import FullPageLoader from "../common/FullPageLoader";
import ConfirmationModal from "../common/ConfirmationModal";
import { getSession } from "../../utils/auth";
import { useNavigate } from "react-router-dom";
import { API_MUTATION_EVENT_NAME } from "../../utils/toast";

const API_BASE_URL = '';
const DISPATCH_PAGE_SIZE = 10;

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

const toBooleanFlag = (value) => {
  if (value === true || value === 1) return true;
  if (value === false || value === 0) return false;
  const normalized = String(value || "").trim().toLowerCase();
  return ["true", "yes", "1", "uploaded", "ready"].includes(normalized);
};

const getNumberOrFallback = (source = {}, keys = [], fallback = 0) => {
  const rawValue = firstPresent(...keys.map((key) => source?.[key]));
  const value = Number(rawValue);
  return rawValue !== "" && Number.isFinite(value) ? value : fallback;
};

const extractDispatchQueueData = (payload = {}) =>
  payload?.data && typeof payload.data === "object" ? payload.data : payload || {};

const extractDispatchQueueRows = (payload = {}) => {
  const data = extractDispatchQueueData(payload);
  return toArray(data?.rows || data?.dispatchRows || data?.dispatch_rows || payload?.rows || payload);
};

const formatQueueContents = (contents = []) =>
  toArray(contents)
    .map((item) => {
      const sku = firstPresent(item?.sku, item?.productSku, item?.product_sku, item?.sellerSku, item?.seller_sku);
      const quantity = firstPresent(item?.quantity, item?.qty, item?.units);
      if (sku && quantity !== "") return `${sku} x ${quantity}`;
      return sku || "";
    })
    .filter(Boolean)
    .join(", ");

const getQueueChildBoxTitle = (box = {}, index = 0) => {
  const boxNumber = firstPresent(box?.boxNumber, box?.box_number);
  return firstPresent(
    box?.boxTitle,
    box?.box_title,
    box?.title,
    box?.palletNumber,
    box?.pallet_number,
    boxNumber !== "" ? `Box ${boxNumber}` : "",
    `Box ${index + 1}`
  );
};

const getShipmentListTotal = (payload = {}, fallback = 0) => {
  const data = payload?.data && typeof payload.data === "object" ? payload.data : payload || {};
  const total = Number(
    data?.total ??
      data?.totalCount ??
      data?.total_count ??
      data?.count ??
      payload?.total ??
      payload?.totalCount ??
      payload?.total_count ??
      payload?.count ??
      fallback
  );

  return Number.isFinite(total) && total >= 0 ? total : fallback;
};

const normalizeStatusValue = (value = "") =>
  String(value || "").trim().toLowerCase().replace(/\s+/g, "_");

const getDispatchAction = ({ dispatchState, fbaLabelUploaded }) => {
  if (dispatchState === "completed") return "Completed";
  if (dispatchState === "dispatched") return "Dispatched";
  return fbaLabelUploaded ? "Dispatch" : "Chase Client";
};

const parseDispatchQueueTimestamp = (row = {}) => {
  const candidates = [
    row?.createdAt,
    row?.created_at,
    row?.created,
    row?.createdDate,
    row?.created_date,
    row?.dispatchedAt,
    row?.dispatched_at,
  ];

  for (const candidate of candidates) {
    const timestamp = Date.parse(candidate);
    if (Number.isFinite(timestamp)) return timestamp;
  }

  const shipmentReference = String(
    firstPresent(row?.shipmentReference, row?.shipment_reference, row?.shipment, row?.reference, '')
  ).trim();
  const match = shipmentReference.match(/(\d{8})/);

  if (match) {
    const datePart = match[1];
    const year = Number(datePart.slice(0, 4));
    const month = Number(datePart.slice(4, 6));
    const day = Number(datePart.slice(6, 8));
    const timestamp = Date.UTC(year, month - 1, day);

    if (Number.isFinite(timestamp)) return timestamp;
  }

  return 0;
};

const sortDispatchQueueRows = (rows = []) =>
  [...rows].sort((firstRow, secondRow) => {
    const firstTimestamp = parseDispatchQueueTimestamp(firstRow);
    const secondTimestamp = parseDispatchQueueTimestamp(secondRow);

    if (firstTimestamp !== secondTimestamp) {
      return secondTimestamp - firstTimestamp;
    }

    const firstShipmentReference = String(
      firstPresent(firstRow?.shipmentReference, firstRow?.shipment_reference, firstRow?.shipment, firstRow?.reference, firstRow?.shipmentId, '')
    ).trim();
    const secondShipmentReference = String(
      firstPresent(
        secondRow?.shipmentReference,
        secondRow?.shipment_reference,
        secondRow?.shipment,
        secondRow?.reference,
        secondRow?.shipmentId,
        ''
      )
    ).trim();

    if (firstShipmentReference !== secondShipmentReference) {
      return secondShipmentReference.localeCompare(firstShipmentReference, undefined, { numeric: true, sensitivity: 'base' });
    }

    const firstBoxNumber = Number(firstPresent(firstRow?.boxNumber, firstRow?.box_number, -1));
    const secondBoxNumber = Number(firstPresent(secondRow?.boxNumber, secondRow?.box_number, -1));

    if (Number.isFinite(firstBoxNumber) && Number.isFinite(secondBoxNumber) && firstBoxNumber !== secondBoxNumber) {
      return secondBoxNumber - firstBoxNumber;
    }

    const firstBoxId = String(firstPresent(firstRow?.boxId, firstRow?.box_id, firstRow?.id, '')).trim();
    const secondBoxId = String(firstPresent(secondRow?.boxId, secondRow?.box_id, secondRow?.id, '')).trim();

    if (firstBoxId !== secondBoxId) {
      return secondBoxId.localeCompare(firstBoxId, undefined, { numeric: true, sensitivity: 'base' });
    }

    return 0;
  });

const palletMissingFbaLabel = (box = {}) =>
  Boolean(box?.isPallet) && !box?.fbaLabelUploaded && !box?.fbaShippingLabelFileId && !box?.labelUploadedAt;

const isDispatchComplete = (item = {}) =>
  item.action === "Dispatched" || item.action === "Completed";

const isDispatchableQueueItem = (item = {}) =>
  (item.isDispatchable !== undefined || item.canDispatchDirectly !== undefined
    ? toBooleanFlag(item.isDispatchable || item.canDispatchDirectly)
    : (Boolean(item.fbaShippingLabelFileId || item.labelUploadedAt || item.fbaLabelUploaded) || Boolean(item.isPallet))) &&
  !isDispatchComplete(item);

const normalizeDispatchQueueRow = (row = {}, index = 0) => {
  const shipmentId = firstPresent(row?.shipmentId, row?.shipment_id);
  const shipmentReference = firstPresent(row?.shipmentReference, row?.shipment_reference, row?.shipment, row?.reference, shipmentId, "-");
  const subShipmentId = firstPresent(row?.subShipmentId, row?.sub_shipment_id);
  const subShipmentReference = firstPresent(row?.subShipmentReference, row?.sub_shipment_reference, "-");
  const client = firstPresent(row?.clientName, row?.client_name, row?.client?.companyName, row?.client?.company_name, row?.clients?.companyName, row?.clients?.company_name, "-");
  const boxId = firstPresent(row?.boxId, row?.box_id, row?.id);
  const isPallet = toBooleanFlag(firstPresent(row?.isPallet, row?.is_pallet)) || String(firstPresent(row?.boxType, row?.box_type)).toLowerCase() === "pallet";
  const boxNumber = firstPresent(row?.boxNumber, row?.box_number);
  const boxTitle = firstPresent(
    row?.boxTitle,
    row?.box_title,
    row?.title,
    row?.palletNumber,
    row?.pallet_number,
    isPallet && boxNumber !== "" ? `Pallet ${boxNumber}` : "",
    boxNumber !== "" ? `Box ${boxNumber}` : "",
    "--"
  );
  const weightValue = firstPresent(row?.weightKg, row?.weight_kg, row?.weight);
  const childBoxes = toArray(row?.childBoxes || row?.child_boxes);
  const labelStatus = String(firstPresent(row?.labelStatus, row?.label_status)).toLowerCase();
  const fbaLabelUploaded =
    toBooleanFlag(firstPresent(row?.fbaLabelUploaded, row?.fba_label_uploaded)) ||
    labelStatus === "uploaded" ||
    Boolean(firstPresent(row?.fbaShippingLabelFileId, row?.fba_shipping_label_file_id, row?.fbaLabelFileId, row?.fba_label_file_id));
  const dispatchedAt = firstPresent(row?.dispatchedAt, row?.dispatched_at);
  const dispatchState = String(firstPresent(row?.dispatchState, row?.dispatch_state, dispatchedAt ? "dispatched" : "")).toLowerCase();
  const rawAction = firstPresent(row?.action, getDispatchAction({ dispatchState, fbaLabelUploaded }));
  const normalizedAction = String(rawAction).toLowerCase();
  const action =
    normalizedAction === "dispatch"
      ? "Dispatch"
      : normalizedAction === "dispatched"
      ? "Dispatched"
      : normalizedAction === "completed"
      ? "Completed"
      : normalizedAction === "chase client"
      ? "Chase Client"
      : rawAction || getDispatchAction({ dispatchState, fbaLabelUploaded });
  const explicitDispatchable = firstPresent(row?.isDispatchable, row?.is_dispatchable, row?.canDispatchDirectly, row?.can_dispatch_directly);
  const isDispatchable = explicitDispatchable === "" ? action === "Dispatch" : toBooleanFlag(explicitDispatchable);

  return {
    id: firstPresent(row?.id, `${shipmentId || shipmentReference}-${subShipmentId || "parent"}-${boxId || boxTitle || index}`),
    boxId,
    shipmentId,
    subShipmentId,
    reference: shipmentReference,
    subShipment: subShipmentReference || "-",
    client,
    box: boxTitle,
    type: String(firstPresent(row?.boxType, row?.box_type, isPallet ? "Pallet" : "--")).replaceAll("_", " "),
    weight: weightValue !== "" ? `${weightValue} kg` : "--",
    contents: firstPresent(row?.contentsSummary, row?.contents_summary, formatQueueContents(row?.contents), "-"),
    childBoxCount: Number(firstPresent(row?.childBoxCount, row?.child_box_count, childBoxes.length, 0)) || 0,
    childBoxes: childBoxes.map(getQueueChildBoxTitle).join(", "),
    isPallet,
    status: dispatchState,
    fbaLabelUploaded,
    fbaShippingLabelFileId: firstPresent(row?.fbaShippingLabelFileId, row?.fba_shipping_label_file_id, row?.fbaLabelFileId, row?.fba_label_file_id),
    labelUploadedAt: firstPresent(row?.labelUploadedAt, row?.label_uploaded_at),
    labelStatus,
    dispatchedAt,
    dispatchState,
    action,
    isDispatchable,
    canDispatchDirectly: isDispatchable,
  };
};

const DispatchStaff = () => {
  const [shipments, setShipments] = useState([]);
  const [searchTerm, setSearchTerm] = useState("");
  const [filter, setFilter] = useState("ready");
  const [isLoading, setIsLoading] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [updatingId, setUpdatingId] = useState("");
  const [dispatchConfirm, setDispatchConfirm] = useState(null);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [currentPage, setCurrentPage] = useState(1);
  const [totalShipments, setTotalShipments] = useState(0);
  const [hasNextShipmentPage, setHasNextShipmentPage] = useState(false);
  const [dispatchCounts, setDispatchCounts] = useState({});
  const navigate = useNavigate();

  const loadShipments = async ({ silent = false, page = currentPage } = {}) => {
    const pageToLoad = Math.max(1, Number(page) || 1);

    try {
      if (silent) {
        setIsRefreshing(true);
      } else {
        setIsLoading(true);
      }
      setError("");
      const query = new URLSearchParams({
        page: String(pageToLoad),
        limit: String(DISPATCH_PAGE_SIZE),
        status: filter || "all",
      });
      const trimmedSearch = searchTerm.trim();
      if (trimmedSearch) {
        query.set("search", trimmedSearch);
      }
      const response = await fetch(`${API_BASE_URL}/api/dispatch/queue?${query.toString()}`, {
        method: "GET",
        headers: buildHeaders(),
        cache: "no-store",
      });
      const payload = await parseResponse(response);
      const queueData = extractDispatchQueueData(payload);
      const queueRows = extractDispatchQueueRows(payload);
      const reportedTotal = getShipmentListTotal(payload, queueRows.length);
      const hasReportedTotal = reportedTotal > 0;
      setTotalShipments(hasReportedTotal ? reportedTotal : ((pageToLoad - 1) * DISPATCH_PAGE_SIZE) + queueRows.length);
      setHasNextShipmentPage(hasReportedTotal ? pageToLoad < Math.ceil(reportedTotal / DISPATCH_PAGE_SIZE) : queueRows.length === DISPATCH_PAGE_SIZE);
      setDispatchCounts(queueData);
      setShipments(sortDispatchQueueRows(queueRows.map(normalizeDispatchQueueRow)));
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
    setCurrentPage(1);
  }, [filter, searchTerm]);

  useEffect(() => {
    const refreshTimer = window.setTimeout(() => {
      loadShipments();
    }, searchTerm.trim() ? 300 : 0);

    return () => window.clearTimeout(refreshTimer);
  }, [currentPage, filter, searchTerm]);

  useEffect(() => {
    let refreshTimer = null;

    const scheduleRefresh = () => {
      window.clearTimeout(refreshTimer);
      refreshTimer = window.setTimeout(() => {
        loadShipments({ silent: true, page: currentPage });
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
  }, [currentPage]);

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
    const ready = getNumberOrFallback(dispatchCounts, ["readyCount", "ready_count"], shipments.filter((shipment) => shipment.action === "Dispatch").length);
    const missing = getNumberOrFallback(dispatchCounts, ["missingLabelCount", "missing_label_count", "pendingCount", "pending_count"], shipments.filter((shipment) => shipment.action === "Chase Client").length);
    const dispatched = getNumberOrFallback(dispatchCounts, ["dispatchedCount", "dispatched_count"], shipments.filter((shipment) => shipment.action === "Dispatched" || shipment.action === "Completed").length);

    return [
      { label: "Ready to Dispatch", value: ready, icon: CheckCircle2, color: "text-green-600", bg: "bg-green-50" },
      { label: "Needs Workflow", value: missing, icon: Tag, color: "text-orange-600", bg: "bg-orange-50" },
      { label: "Dispatched", value: dispatched, icon: Send, color: "text-teal-600", bg: "bg-teal-50" },
    ];
  }, [dispatchCounts, shipments]);
  const totalPages = totalShipments > 0
    ? Math.max(1, Math.ceil(totalShipments / DISPATCH_PAGE_SIZE))
    : currentPage + (hasNextShipmentPage ? 1 : 0);

  const runDispatchBox = async (box) => {
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
      setMessage(`${box?.isPallet ? "Pallet" : "Box"} dispatched successfully.`);
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setUpdatingId("");
    }
  };

  const dispatchBox = async (box) => {
    if (palletMissingFbaLabel(box)) {
      setDispatchConfirm({
        title: "Dispatch pallet without FBA label?",
        message: "This pallet does not have an FBA label. Are you sure you want to dispatch this pallet without a pallet FBA label?",
        confirmLabel: "Dispatch Pallet",
        action: () => runDispatchBox(box),
      });
      return;
    }

    await runDispatchBox(box);
  };

  const handleConfirmDispatchWarning = async () => {
    const action = dispatchConfirm?.action;
    setDispatchConfirm(null);
    if (typeof action === "function") {
      await action();
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
                    const dispatchComplete = isDispatchComplete(shipment);
                    const canDispatch = isDispatchableQueueItem(shipment);
                    return (
                      <tr key={shipment.id} className="hover:bg-gray-50/70">
                        <td className="px-5 py-4 text-sm font-bold text-gray-900">{shipment.reference}</td>
                        <td className="px-5 py-4 text-sm font-medium text-gray-700">{shipment.subShipment}</td>
                        <td className="px-5 py-4 text-sm font-semibold text-gray-800">{shipment.client}</td>
                        <td className="px-5 py-4 text-sm font-medium text-gray-700">{shipment.box}</td>
                        <td className="px-5 py-4">
                          <span className="rounded bg-gray-100 px-2 py-1 text-[11px] font-semibold text-gray-600">{shipment.type}</span>
                          {shipment.isPallet ? (
                            <span className="ml-2 rounded bg-[#fff7ed] px-2 py-1 text-[11px] font-semibold text-[#d76000]">
                              {shipment.childBoxCount || 0} child box{shipment.childBoxCount === 1 ? "" : "es"}
                            </span>
                          ) : null}
                        </td>
                        <td className="px-5 py-4 text-sm font-medium text-gray-700">{shipment.weight}</td>
                        <td className="px-5 py-4 text-sm text-gray-500">
                          {shipment.contents}
                          {shipment.isPallet && shipment.childBoxes ? (
                            <p className="mt-1 text-xs text-gray-400">Boxes: {shipment.childBoxes}</p>
                          ) : null}
                        </td>
                        <td className="px-5 py-4">
                          {labelUploaded ? (
                            <span className="inline-flex items-center gap-1 text-sm font-semibold text-emerald-600">
                              <span className="inline-block h-2 w-2 rounded-full bg-emerald-500" />
                              Uploaded
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 text-sm font-semibold text-red-500">
                              <span className="inline-block h-2 w-2 rounded-full bg-red-500" />
                              {shipment.isPallet ? "Missing (optional)" : "Missing"}
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
            <div className="flex flex-col gap-3 border-t border-gray-100 px-5 py-4 text-sm text-gray-500 sm:flex-row sm:items-center sm:justify-between">
              <span>
                Page {currentPage}{totalShipments ? ` of ${totalPages}` : ""}
              </span>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setCurrentPage((page) => Math.max(1, page - 1))}
                  disabled={isLoading || isRefreshing || currentPage <= 1}
                  className="rounded-lg border border-gray-200 px-3 py-1.5 font-medium text-gray-600 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  Previous
                </button>
                <button
                  type="button"
                  onClick={() => setCurrentPage((page) => page + 1)}
                  disabled={isLoading || isRefreshing || !hasNextShipmentPage}
                  className="rounded-lg border border-gray-200 px-3 py-1.5 font-medium text-gray-600 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  Next
                </button>
              </div>
            </div>
          </div>
        </div>
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

export default DispatchStaff;
