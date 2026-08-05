import { AlertTriangle, CheckCircle2, Info, Package, RefreshCw } from "lucide-react";
import { useEffect, useState } from "react";
import LayoutStaff from "./stafflayout/LayoutStaff";
import LoadingState from "../common/LoadingState";
import FullPageLoader from "../common/FullPageLoader";
import { getSession } from "../../utils/auth";
import {
  getLineItemId as getMappedLineItemId,
  getShipmentItems as getMappedShipmentItems,
  normalizeShipment as normalizeMappedShipment,
  normalizeShipmentList as normalizeMappedShipmentList,
} from "../../utils/shipmentMapper";
import {
  formatReceivingStatus,
  formatReceivingQuantity,
  getReceivingLineDiscrepancyNotes,
  getReceivingLineExpectedQty,
  getReceivingLineReceivedQty,
  getReceivingLineRemainingQty,
  getReceivingShipmentDiscrepancyCount,
  getReceivingShipmentExpectedQty,
  getReceivingShipmentReceivedQty,
  getReceivingShipmentRemainingQty,
  getReceivingShipmentStatus,
  hasReceivingLineDiscrepancy,
  hasReceivingShipmentDiscrepancy,
  isReceivingComplete,
} from "../../utils/receiving";

const API_BASE_URL = '';
const RECEIVING_PAGE_SIZE = 25;

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

const extractShipments = (payload) => {
  const source = payload?.data && typeof payload.data === "object" ? payload.data : payload || {};
  if (Array.isArray(source.rows)) return normalizeMappedShipmentList(source.rows);
  if (Array.isArray(source.shipments)) return normalizeMappedShipmentList(source.shipments);
  return normalizeMappedShipmentList(payload);
};

const getLineItems = (source) => getMappedShipmentItems(source);

const extractShipmentDetail = (payload) =>
  normalizeMappedShipment(
    payload?.shipment ||
      payload?.data?.shipment ||
      payload?.data?.record ||
      payload?.data?.detail ||
      payload?.record ||
      payload?.detail ||
      payload?.data ||
      payload ||
      {}
  );

const getItemId = (item) =>
  getMappedLineItemId(item) || item?.id || item?.shipmentItemId || item?.shipment_item_id || item?.lineItemId || item?.line_item_id || "";

const getExpectedQty = getReceivingLineExpectedQty;
const getReceivedQty = getReceivingLineReceivedQty;
const getRemainingQty = getReceivingLineRemainingQty;

const getItemSku = (item) =>
  item?.sku ||
  item?.sellerSku ||
  item?.seller_sku ||
  item?.skuCode ||
  item?.sku_code ||
  item?.product?.sku ||
  item?.product?.sellerSku ||
  item?.product?.seller_sku ||
  item?.products?.sku ||
  item?.products?.sellerSku ||
  item?.products?.seller_sku ||
  "";

const getProductName = (item) =>
  item?.productName ||
  item?.product_name ||
  item?.name ||
  item?.product?.name ||
  item?.products?.name ||
  "Product line";

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

const ReceivingStaff = () => {
  const [pendingArrivals, setPendingArrivals] = useState([]);
  const [selectedShipment, setSelectedShipment] = useState(null);
  const [receivedQuantities, setReceivedQuantities] = useState({});
  const [isLoading, setIsLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [currentPage, setCurrentPage] = useState(1);
  const [queueMeta, setQueueMeta] = useState({
    total: 0,
    page: 1,
    limit: RECEIVING_PAGE_SIZE,
    totalPages: 1,
  });

  const loadPendingArrivals = async ({ page = currentPage } = {}) => {
    try {
      setIsLoading(true);
      setError("");
      const query = new URLSearchParams({
        page: String(page),
        limit: String(RECEIVING_PAGE_SIZE),
        status: "all",
      });
      const response = await fetch(`${API_BASE_URL}/api/receiving/queue?${query.toString()}`, {
        method: "GET",
        headers: buildHeaders(),
        cache: "no-store",
      });
      const payload = await parseResponse(response);
      const shipmentsById = new Map();

      extractShipments(payload).forEach((shipment, index) => {
        const key = shipment?.id || shipment?.uuid || shipment?.reference || `shipment-${index}`;
        if (!shipmentsById.has(key)) shipmentsById.set(key, shipment);
      });

      setPendingArrivals([...shipmentsById.values()]);
      const source = payload?.data && typeof payload.data === "object" ? payload.data : payload || {};
      const total = Number(source.total || shipmentsById.size || 0);
      const limit = Number(source.limit || RECEIVING_PAGE_SIZE) || RECEIVING_PAGE_SIZE;
      setQueueMeta({
        total,
        page: Number(source.page || page || 1) || 1,
        limit,
        totalPages: Number(source.totalPages || source.total_pages || Math.ceil(total / limit)) || 1,
      });
    } catch (requestError) {
      setError(requestError.message);
      setPendingArrivals([]);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadPendingArrivals({ page: currentPage });
  }, [currentPage]);

  const loadShipmentDetail = async (shipment) => {
    const shipmentId = shipment?.id || shipment?.uuid || shipment?.reference;
    try {
      setError("");
      const response = await fetch(`${API_BASE_URL}/api/shipments/${shipmentId}`, {
        method: "GET",
        headers: buildHeaders(),
        cache: "no-store",
      });
      const payload = await parseResponse(response);
      const detail = extractShipmentDetail(payload);
      const quantities = {};

      getLineItems(detail).forEach((item) => {
        quantities[getItemId(item)] = "";
      });

      setSelectedShipment(detail);
      setReceivedQuantities(quantities);
    } catch (requestError) {
      setError(requestError.message);
    }
  };

  const receiveShipment = async (startPrepAfterReceive = false) => {
    if (!selectedShipment) return;

    try {
      setIsSaving(true);
      setError("");
      setMessage("");

      const shipmentId = selectedShipment.id || selectedShipment.uuid;
      const items = getLineItems(selectedShipment)
        .map((item) => {
          const shipmentItemId = getItemId(item);
          return {
            shipmentItemId,
            receivedQty: Number(receivedQuantities[shipmentItemId] || 0),
            remainingQty: getRemainingQty(item),
            sku: getItemSku(item) || shipmentItemId,
          };
        })
        .filter((item) => item.shipmentItemId);

      if (!items.length) {
        throw new Error("Shipment has no valid line items to receive.");
      }

      const invalidNumberItem = items.find((item) => !Number.isFinite(item.receivedQty));
      if (invalidNumberItem) {
        throw new Error(`Enter a valid received quantity for ${invalidNumberItem.sku || "this line item"}.`);
      }

      const negativeItem = items.find((item) => item.receivedQty < 0);
      if (negativeItem) {
        throw new Error(`Received quantity cannot be negative for ${negativeItem.sku || "this line item"}.`);
      }

      const overReceivedItem = items.find((item) => item.receivedQty > item.remainingQty);
      if (overReceivedItem) {
        throw new Error(
          `Received quantity for ${overReceivedItem.sku || "this line item"} cannot exceed remaining quantity ${formatReceivingQuantity(overReceivedItem.remainingQty)}.`
        );
      }

      if (!items.some((item) => item.receivedQty > 0)) {
        throw new Error("Enter at least one received quantity greater than 0.");
      }

      const remainingAfterAction = items.reduce(
        (sum, item) => sum + Math.max(0, item.remainingQty - item.receivedQty),
        0
      );
      if (startPrepAfterReceive && remainingAfterAction > 0) {
        throw new Error("Receive all remaining quantity before starting prep.");
      }

      await parseResponse(
        await fetch(`${API_BASE_URL}/api/shipments/${shipmentId}/receive`, {
          method: "POST",
          headers: buildHeaders(true),
          body: JSON.stringify({
            items: items.map(({ shipmentItemId, receivedQty }) => ({ shipmentItemId, receivedQty })),
          }),
        })
      );

      if (startPrepAfterReceive) {
        await parseResponse(
          await fetch(`${API_BASE_URL}/api/shipments/${shipmentId}/status`, {
            method: "PATCH",
            headers: buildHeaders(true),
            body: JSON.stringify({ status: "in_progress" }),
          })
        );
      }

      setMessage(startPrepAfterReceive ? "Received quantity saved and moved to in_progress." : "Received quantity saved.");
      setSelectedShipment(null);
      setReceivedQuantities({});
      await loadPendingArrivals();
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setIsSaving(false);
    }
  };

  const selectedItems = getLineItems(selectedShipment);
  const totalPages = Math.max(1, Number(queueMeta.totalPages || 1) || 1);
  const paginationStart = queueMeta.total ? (currentPage - 1) * RECEIVING_PAGE_SIZE + 1 : 0;
  const paginationEnd = Math.min((currentPage - 1) * RECEIVING_PAGE_SIZE + pendingArrivals.length, queueMeta.total);

  useEffect(() => {
    if (currentPage > totalPages) {
      setCurrentPage(totalPages);
    }
  }, [currentPage, totalPages]);

  return (
    <LayoutStaff>
      <FullPageLoader show={isLoading} label="Loading arrivals..." />
      <div className="p-6">
        <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="text-2xl font-bold text-[#132347]">Receiving</h1>
            <p className="mt-1 text-sm text-gray-500">Receive pending arrivals and start prep work.</p>
          </div>
          <button
            type="button"
            onClick={() => loadPendingArrivals()}
            className="inline-flex items-center gap-2 rounded-lg border border-gray-200 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
          >
            <RefreshCw className="h-4 w-4" />
            Refresh
          </button>
        </div>

        <div className="mb-5 flex items-center gap-2 rounded-xl bg-[#3b82f6] px-4 py-3 text-sm text-white shadow-sm">
          <Info className="h-4 w-4 shrink-0" />
          <span>Receiving moves a shipment to Received; start prep only when the team begins work and it should move to In Progress.</span>
        </div>

        {message ? <div className="mb-4 rounded-lg border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-700">{message}</div> : null}
        {error ? <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div> : null}

        <div className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1fr)_420px]">
          <div className="rounded-2xl border border-gray-200 bg-white shadow-sm">
            <div className="border-b border-gray-200 px-5 py-4">
              <h2 className="text-xl font-semibold text-[#132347]">Pending Arrivals</h2>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="bg-white text-left text-[11px] font-semibold uppercase tracking-wider text-gray-400">
                    <th className="px-5 py-3">Shipment</th>
                    <th className="px-5 py-3">Client</th>
                    <th className="px-5 py-3">Expected Arrival</th>
                    <th className="px-5 py-3">Expected Quantity</th>
                    <th className="px-5 py-3">Received Quantity</th>
                    <th className="px-5 py-3">Remaining Quantity</th>
                    <th className="px-5 py-3">Status</th>
                    <th className="px-5 py-3">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {isLoading ? (
                    <tr>
                      <td colSpan="8" className="px-5 py-10 text-center text-sm text-gray-500">
                        <LoadingState label="Loading arrivals..." />
                      </td>
                    </tr>
                  ) : pendingArrivals.map((shipment) => {
                    const shipmentId = shipment?.id || shipment?.uuid || shipment?.reference;
                    const isSelected = selectedShipment && (selectedShipment.id || selectedShipment.uuid) === shipmentId;
                    const lineItems = getLineItems(shipment);
                    const expectedQty = getReceivingShipmentExpectedQty(shipment, lineItems);
                    const receivedQty = getReceivingShipmentReceivedQty(shipment, lineItems);
                    const remainingQty = getReceivingShipmentRemainingQty(shipment, lineItems);
                    const discrepancyCount = getReceivingShipmentDiscrepancyCount(shipment, lineItems);
                    const hasDiscrepancy = hasReceivingShipmentDiscrepancy(shipment, lineItems);
                    const complete = isReceivingComplete(shipment, lineItems);
                    const shipmentStatusLabel = formatReceivingStatus(getReceivingShipmentStatus(shipment));

                    return (
                      <tr key={shipmentId} className={isSelected ? "bg-blue-50/50" : "hover:bg-gray-50"}>
                        <td className="px-5 py-4 text-sm font-semibold text-[#2d6cdf]">{getReference(shipment)}</td>
                        <td className="px-5 py-4 text-sm text-gray-700">{getClientName(shipment)}</td>
                        <td className="px-5 py-4 text-sm text-gray-700">{shipment?.expectedArrivalDate || shipment?.expected_arrival_date || "-"}</td>
                        <td className="px-5 py-4 text-sm font-medium text-gray-900">{formatReceivingQuantity(expectedQty)}</td>
                        <td className="px-5 py-4 text-sm font-medium text-gray-900">{formatReceivingQuantity(receivedQty)}</td>
                        <td className={`px-5 py-4 text-sm font-semibold ${remainingQty > 0 ? "text-[#2d6cdf]" : "text-green-700"}`}>{formatReceivingQuantity(remainingQty)}</td>
                        <td className="px-5 py-4">
                          <div className="flex flex-col items-start gap-1">
                            {shipmentStatusLabel ? (
                              <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-700">{shipmentStatusLabel}</span>
                            ) : null}
                            {complete ? (
                              <span className="rounded-full bg-green-100 px-2.5 py-1 text-xs font-semibold text-green-700">Complete</span>
                            ) : hasDiscrepancy ? (
                              <span className="rounded-full bg-red-100 px-2.5 py-1 text-xs font-semibold text-red-700">
                                {discrepancyCount
                                  ? `${formatReceivingQuantity(discrepancyCount)} ${discrepancyCount === 1 ? "discrepancy" : "discrepancies"}`
                                  : "Discrepancy"}
                              </span>
                            ) : (
                              <span className="rounded-full bg-blue-100 px-2.5 py-1 text-xs font-semibold text-[#2d6cdf]">Pending</span>
                            )}
                          </div>
                        </td>
                        <td className="px-5 py-4">
                          <button
                            type="button"
                            onClick={() => loadShipmentDetail(shipment)}
                            className="rounded-md bg-[#2d6cdf] px-3 py-1.5 text-xs font-semibold text-white hover:bg-[#2358b5]"
                          >
                            Receive
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                  {!isLoading && !pendingArrivals.length ? (
                    <tr>
                      <td colSpan="8" className="px-5 py-10 text-center text-sm text-gray-500">No pending arrivals found.</td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
            <div className="flex flex-col gap-3 border-t border-gray-100 bg-white px-5 py-4 text-sm text-gray-500 md:flex-row md:items-center md:justify-between">
              <span>Showing {paginationStart}-{paginationEnd} of {queueMeta.total} arrivals</span>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setCurrentPage((page) => Math.max(1, page - 1))}
                  disabled={currentPage === 1 || isLoading}
                  className="rounded-lg border border-gray-200 px-3 py-1.5 font-medium text-gray-600 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  Previous
                </button>
                <span className="text-xs font-semibold text-gray-500">Page {currentPage} of {totalPages}</span>
                <button
                  type="button"
                  onClick={() => setCurrentPage((page) => Math.min(totalPages, page + 1))}
                  disabled={currentPage === totalPages || isLoading}
                  className="rounded-lg border border-gray-200 px-3 py-1.5 font-medium text-gray-600 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  Next
                </button>
              </div>
            </div>
          </div>

          <div className="rounded-2xl border border-gray-200 bg-white shadow-sm">
            <div className="flex items-center gap-2 border-b border-gray-200 px-5 py-4">
              <CheckCircle2 className="h-5 w-5 text-[#2d6cdf]" />
              <h2 className="text-xl font-semibold text-[#132347]">Mark Received</h2>
            </div>
            <div className="space-y-4 p-5">
              {selectedShipment ? (
                <>
                  <div className="rounded-xl bg-[#eef3ff] p-4">
                    <h3 className="text-sm font-semibold text-[#132347]">{getReference(selectedShipment)}</h3>
                    <p className="mt-1 text-xs text-gray-500">{getClientName(selectedShipment)}</p>
                  </div>

                  <div className="max-h-[52vh] space-y-3 overflow-y-auto pr-1">
                    {selectedItems.map((item) => {
                      const itemId = getItemId(item);
                      const sku = getItemSku(item) || itemId || "SKU";
                      const productName = getProductName(item);
                      const expected = getExpectedQty(item);
                      const receivedSoFar = getReceivedQty(item);
                      const remaining = getRemainingQty(item);
                      const value = receivedQuantities[itemId] ?? "";
                      const quantityNow = Number(value || 0);
                      const invalidQuantity = !Number.isFinite(quantityNow) || quantityNow < 0 || quantityNow > remaining;
                      const lineHasDiscrepancy = hasReceivingLineDiscrepancy(item);
                      const notes = getReceivingLineDiscrepancyNotes(item);

                      return (
                        <div key={itemId || item?.sku} className={`rounded-xl border p-4 ${lineHasDiscrepancy || invalidQuantity ? "border-red-200 bg-red-50" : "border-gray-200"}`}>
                          <div className="mb-3 flex items-start justify-between gap-3">
                            <div>
                              <p className="text-sm font-semibold text-gray-900">SKU: {sku}</p>
                              <p className="mt-1 text-xs text-gray-500">{productName}</p>
                            </div>
                            {remaining <= 0 ? (
                              <span className="rounded-full bg-green-100 px-2 py-1 text-xs font-semibold text-green-700">Verified</span>
                            ) : lineHasDiscrepancy ? (
                              <span className="rounded-full bg-red-100 px-2 py-1 text-xs font-semibold text-red-700">Discrepancy</span>
                            ) : (
                              <span className="rounded-full bg-blue-100 px-2 py-1 text-xs font-semibold text-[#2d6cdf]">Pending</span>
                            )}
                          </div>
                          <div className="mb-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
                            <div>
                              <label className="mb-1 block text-[10px] font-semibold uppercase tracking-[0.12em] text-gray-500">Expected</label>
                              <input
                                type="number"
                                value={formatReceivingQuantity(expected)}
                                readOnly
                                className="w-full rounded-xl border border-gray-200 bg-gray-50 px-3 py-3 text-sm text-gray-700"
                              />
                            </div>
                            <div>
                              <label className="mb-1 block text-[10px] font-semibold uppercase tracking-[0.12em] text-gray-500">Received So Far</label>
                              <input
                                type="number"
                                value={formatReceivingQuantity(receivedSoFar)}
                                readOnly
                                className="w-full rounded-xl border border-gray-200 bg-gray-50 px-3 py-3 text-sm text-gray-700"
                              />
                            </div>
                            <div>
                              <label className="mb-1 block text-[10px] font-semibold uppercase tracking-[0.12em] text-gray-500">Remaining</label>
                              <input
                                type="number"
                                value={formatReceivingQuantity(remaining)}
                                readOnly
                                className="w-full rounded-xl border border-gray-200 bg-gray-50 px-3 py-3 text-sm text-gray-700"
                              />
                            </div>
                            <div>
                              <label className="mb-1 block text-[10px] font-semibold uppercase tracking-[0.12em] text-gray-500">Receive Now</label>
                              <input
                                type="number"
                                min="0"
                                max={remaining}
                                value={value}
                                disabled={remaining <= 0}
                                onChange={(event) => setReceivedQuantities((current) => ({ ...current, [itemId]: event.target.value }))}
                                className={`w-full rounded-xl border px-3 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-[#2d6cdf] ${remaining <= 0 ? "cursor-not-allowed border-gray-200 bg-gray-50 text-gray-400 focus:ring-0" : invalidQuantity ? "border-red-300 bg-white text-red-700" : "border-[#93c5fd] text-gray-700"}`}
                                placeholder="0"
                              />
                            </div>
                          </div>
                          {invalidQuantity ? (
                            <div className="mt-3 flex items-start gap-2 rounded-lg border border-red-200 bg-white px-3 py-2 text-xs text-red-600">
                              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                              <span>Enter a quantity from 0 to {formatReceivingQuantity(remaining)} for {sku}.</span>
                            </div>
                          ) : lineHasDiscrepancy || notes ? (
                            <div className="mt-3 flex items-start gap-2 rounded-lg border border-red-200 bg-white px-3 py-2 text-xs text-red-600">
                              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                              <span>{notes || `${formatReceivingQuantity(remaining)} units still need to be received for ${sku}.`}</span>
                            </div>
                          ) : null}
                        </div>
                      );
                    })}
                  </div>

                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <button
                      type="button"
                      disabled={isSaving}
                      onClick={() => receiveShipment(false)}
                      className="inline-flex items-center justify-center gap-2 rounded-xl border border-gray-300 bg-white px-4 py-3 text-sm font-semibold text-gray-700 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      {isSaving ? <RefreshCw className="h-4 w-4 animate-spin" /> : null}
                      {isSaving ? "Confirming..." : "Confirm Receipt"}
                    </button>
                    <button
                      type="button"
                      disabled={isSaving}
                      onClick={() => receiveShipment(true)}
                      className="inline-flex items-center justify-center gap-2 rounded-xl bg-[#2d6cdf] px-4 py-3 text-sm font-semibold text-white hover:bg-[#2358b5] disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      {isSaving ? <RefreshCw className="h-4 w-4 animate-spin" /> : null}
                      {isSaving ? "Starting..." : "Receive + Start Prep"}
                    </button>
                  </div>
                </>
              ) : (
                <div className="flex min-h-64 flex-col items-center justify-center rounded-xl border border-dashed border-gray-200 text-center">
                  <Package className="mb-3 h-8 w-8 text-gray-300" />
                  <p className="text-sm font-medium text-gray-700">Select a pending shipment to receive.</p>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </LayoutStaff>
  );
};

export default ReceivingStaff;
