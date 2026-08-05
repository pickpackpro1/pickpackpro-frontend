import { useEffect, useState } from 'react';
import Layout from './adminlayout/Layout';
import LoadingState from '../common/LoadingState';
import FullPageLoader from '../common/FullPageLoader';
import { getSession } from '../../utils/auth';
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
} from '../../utils/receiving';
import { Package, AlertCircle, RefreshCw } from 'lucide-react';

const API_BASE_URL = '';
const RECEIVING_PAGE_SIZE = 25;

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
    const message =
      payload?.message ||
      payload?.error ||
      payload?.details ||
      (typeof payload === 'string' ? payload : '') ||
      `Request failed with status ${response.status}`;

    throw new Error(
      String(message).toLowerCase().includes('max clients reached')
        ? 'Backend database connection limit reached. Please retry in a moment.'
        : message
    );
  }
  return payload;
};
const extractShipments = (payload) =>
  Array.isArray(payload)
    ? payload
    : Array.isArray(payload?.shipments)
      ? payload.shipments
      : Array.isArray(payload?.data?.shipments)
        ? payload.data.shipments
      : Array.isArray(payload?.data?.rows)
        ? payload.data.rows
        : Array.isArray(payload?.data)
          ? payload.data
          : [];

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
];

const LINE_ITEM_CONTAINERS = ['shipment', 'data', 'record', 'result', 'payload', 'detail'];

const getLineItems = (source) => {
  if (Array.isArray(source)) return source;
  if (!source || typeof source !== 'object') return [];

  for (const key of LINE_ITEM_KEYS) {
    if (Array.isArray(source[key])) return source[key];
  }

  for (const key of LINE_ITEM_CONTAINERS) {
    const nested = source[key];
    if (!nested || nested === source || typeof nested !== 'object') continue;
    const nestedItems = getLineItems(nested);
    if (nestedItems.length) return nestedItems;
  }

  return [];
};

const extractShipmentDetail = (payload) =>
  payload?.shipment ||
  payload?.data?.shipment ||
  payload?.data?.record ||
  payload?.data?.detail ||
  payload?.record ||
  payload?.detail ||
  payload?.data ||
  payload;

const getLineItemId = (item) =>
  item?.id || item?.shipmentItemId || item?.shipment_item_id || item?.lineItemId || item?.line_item_id || item?.sku || '';

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
  '';

const getClientName = (shipment) =>
  shipment?.client?.companyName ||
  shipment?.client?.company_name ||
  shipment?.client?.name ||
  shipment?.clients?.companyName ||
  shipment?.clients?.company_name ||
  shipment?.clientName ||
  shipment?.client_name ||
  shipment?.clientId ||
  shipment?.client_id ||
  '-';

const getProductName = (item) =>
  item?.productName ||
  item?.product_name ||
  item?.product?.name ||
  item?.products?.name ||
  'Product line';

const Receiving = () => {
  const [pendingArrivals, setPendingArrivals] = useState([]);
  const [selectedShipment, setSelectedShipment] = useState(null);
  const [receivedQuantities, setReceivedQuantities] = useState({});
  const [isLoading, setIsLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
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
      setError('');
      const query = new URLSearchParams({
        page: String(page),
        limit: String(RECEIVING_PAGE_SIZE),
        status: 'all',
      });
      const response = await fetch(`${API_BASE_URL}/api/receiving/queue?${query.toString()}`, {
        method: 'GET',
        headers: buildHeaders(),
        cache: 'no-store',
      });
      const payload = await parseResponse(response);
      const shipmentsById = new Map();

      extractShipments(payload).forEach((shipment, index) => {
        const key = shipment?.id || shipment?.uuid || shipment?.reference || `shipment-${index}`;
        if (!shipmentsById.has(key)) shipmentsById.set(key, shipment);
      });

      setPendingArrivals([...shipmentsById.values()]);
      const source = payload?.data && typeof payload.data === 'object' ? payload.data : payload || {};
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

  const handleSelectShipment = async (shipment) => {
    try {
      setError('');
      const response = await fetch(`${API_BASE_URL}/api/shipments/${shipment.id || shipment.uuid || shipment.reference}`, {
        method: 'GET',
        headers: buildHeaders(),
      });
      const payload = await parseResponse(response);
      const detail = extractShipmentDetail(payload);
      setSelectedShipment(detail);
      const quantities = {};
      getLineItems(detail).forEach((item) => {
        quantities[getLineItemId(item)] = '';
      });
      setReceivedQuantities(quantities);
    } catch (requestError) {
      setError(requestError.message);
    }
  };

  const handleCancel = () => {
    setSelectedShipment(null);
    setReceivedQuantities({});
  };

  const handleConfirmArrival = async () => {
    if (!selectedShipment || isSaving) return;
    try {
      setIsSaving(true);
      setError('');
      setMessage('');
      const items = getLineItems(selectedShipment)
        .map((item) => {
          const shipmentItemId = getLineItemId(item);
          return {
            shipmentItemId,
            receivedQty: Number(receivedQuantities[shipmentItemId] || 0),
            remainingQty: getRemainingQty(item),
            sku: getItemSku(item) || shipmentItemId,
          };
        })
        .filter((item) => item.shipmentItemId);

      if (!items.length) {
        throw new Error('Shipment line items nahi milay. Detail response check karein.');
      }

      const invalidNumberItem = items.find((item) => !Number.isFinite(item.receivedQty));
      if (invalidNumberItem) {
        throw new Error(`Enter a valid received quantity for ${invalidNumberItem.sku || 'this line item'}.`);
      }

      const negativeItem = items.find((item) => item.receivedQty < 0);
      if (negativeItem) {
        throw new Error(`Received quantity cannot be negative for ${negativeItem.sku || 'this line item'}.`);
      }

      const overReceivedItem = items.find((item) => item.receivedQty > item.remainingQty);
      if (overReceivedItem) {
        throw new Error(
          `Received quantity for ${overReceivedItem.sku || 'this line item'} cannot exceed remaining quantity ${formatReceivingQuantity(overReceivedItem.remainingQty)}.`
        );
      }

      if (!items.some((item) => item.receivedQty > 0)) {
        throw new Error('Enter at least one received quantity greater than 0.');
      }

      const response = await fetch(`${API_BASE_URL}/api/shipments/${selectedShipment.id || selectedShipment.uuid}/receive`, {
        method: 'POST',
        headers: buildHeaders(true),
        body: JSON.stringify({
          items: items.map(({ shipmentItemId, receivedQty }) => ({ shipmentItemId, receivedQty })),
        }),
      });
      await parseResponse(response);
      setMessage('Received quantity saved.');
      setSelectedShipment(null);
      setReceivedQuantities({});
      await loadPendingArrivals();
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setIsSaving(false);
    }
  };

  const totalPages = Math.max(1, Number(queueMeta.totalPages || 1) || 1);
  const paginationStart = queueMeta.total ? (currentPage - 1) * RECEIVING_PAGE_SIZE + 1 : 0;
  const paginationEnd = Math.min((currentPage - 1) * RECEIVING_PAGE_SIZE + pendingArrivals.length, queueMeta.total);

  useEffect(() => {
    if (currentPage > totalPages) {
      setCurrentPage(totalPages);
    }
  }, [currentPage, totalPages]);

  return (
    <Layout>
      <FullPageLoader show={isLoading} label="Loading arrivals..." />
      <div className="p-6 bg-gray-50 min-h-screen">
        <div className="mb-6 flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-semibold text-gray-900">Receiving</h1>
          </div>
          <button onClick={() => loadPendingArrivals()} className="inline-flex items-center gap-2 rounded-lg border border-gray-200 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50">
            <RefreshCw size={15} />
            Refresh
          </button>
        </div>

        {message ? <p className="mb-4 rounded-lg border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-700">{message}</p> : null}
        {error ? <p className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p> : null}

        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <div className="px-6 py-4 border-b border-gray-200">
            <h2 className="text-lg font-semibold text-gray-900">Pending Arrivals</h2>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-gray-200 bg-gray-50">
                  <th className="text-left py-3 px-6 text-xs font-semibold text-gray-500 uppercase tracking-wider">Reference</th>
                  <th className="text-left py-3 px-6 text-xs font-semibold text-gray-500 uppercase tracking-wider">Client</th>
                  <th className="text-left py-3 px-6 text-xs font-semibold text-gray-500 uppercase tracking-wider">Expected Arrival</th>
                  <th className="text-left py-3 px-6 text-xs font-semibold text-gray-500 uppercase tracking-wider">Expected Quantity</th>
                  <th className="text-left py-3 px-6 text-xs font-semibold text-gray-500 uppercase tracking-wider">Received Quantity</th>
                  <th className="text-left py-3 px-6 text-xs font-semibold text-gray-500 uppercase tracking-wider">Remaining Quantity</th>
                  <th className="text-left py-3 px-6 text-xs font-semibold text-gray-500 uppercase tracking-wider">Status</th>
                  <th className="text-left py-3 px-6 text-xs font-semibold text-gray-500 uppercase tracking-wider">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {isLoading ? (
                  <tr>
                    <td colSpan="8" className="px-6 py-12 text-center text-sm text-gray-500">
                      <LoadingState label="Loading arrivals..." />
                    </td>
                  </tr>
                ) : pendingArrivals.map((shipment, index) => {
                  const lineItems = getLineItems(shipment);
                  const expectedQty = getReceivingShipmentExpectedQty(shipment, lineItems);
                  const receivedQty = getReceivingShipmentReceivedQty(shipment, lineItems);
                  const remainingQty = getReceivingShipmentRemainingQty(shipment, lineItems);
                  const discrepancyCount = getReceivingShipmentDiscrepancyCount(shipment, lineItems);
                  const hasDiscrepancy = hasReceivingShipmentDiscrepancy(shipment, lineItems);
                  const complete = isReceivingComplete(shipment, lineItems);
                  const shipmentStatusLabel = formatReceivingStatus(getReceivingShipmentStatus(shipment));

                  return (
                    <tr key={shipment.id || index} className="hover:bg-gray-50 transition-colors">
                      <td className="py-3.5 px-6"><div className="flex items-center gap-2"><Package size={14} className="text-gray-400" /><span className="text-sm font-medium text-gray-900">{shipment.reference || shipment.id}</span></div></td>
                      <td className="py-3.5 px-6 text-sm text-gray-700">{getClientName(shipment)}</td>
                      <td className="py-3.5 px-6 text-sm text-gray-500">{shipment.expectedArrivalDate || shipment.expected_arrival_date || '-'}</td>
                      <td className="py-3.5 px-6 text-sm font-medium text-gray-900">{formatReceivingQuantity(expectedQty)}</td>
                      <td className="py-3.5 px-6 text-sm font-medium text-gray-900">{formatReceivingQuantity(receivedQty)}</td>
                      <td className={`py-3.5 px-6 text-sm font-semibold ${remainingQty > 0 ? 'text-[#ff6900]' : 'text-green-700'}`}>{formatReceivingQuantity(remainingQty)}</td>
                      <td className="py-3.5 px-6">
                        <div className="flex flex-col items-start gap-1">
                          {shipmentStatusLabel ? (
                            <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-700">{shipmentStatusLabel}</span>
                          ) : null}
                          {complete ? (
                            <span className="rounded-full bg-green-100 px-2.5 py-1 text-xs font-semibold text-green-700">Complete</span>
                          ) : hasDiscrepancy ? (
                            <span className="rounded-full bg-red-100 px-2.5 py-1 text-xs font-semibold text-red-700">
                              {discrepancyCount
                                ? `${formatReceivingQuantity(discrepancyCount)} ${discrepancyCount === 1 ? 'discrepancy' : 'discrepancies'}`
                                : 'Discrepancy'}
                            </span>
                          ) : (
                            <span className="rounded-full bg-orange-100 px-2.5 py-1 text-xs font-semibold text-[#c05621]">Pending</span>
                          )}
                        </div>
                      </td>
                      <td className="py-3.5 px-6">
                        <button
                          type="button"
                          onClick={() => handleSelectShipment(shipment)}
                          className="rounded-lg bg-[#ff6900] px-4 py-2 text-sm font-medium text-white hover:bg-[#e55d00]"
                        >
                          Receive
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className="flex flex-col gap-3 border-t border-gray-100 bg-white px-6 py-4 text-sm text-gray-500 md:flex-row md:items-center md:justify-between">
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

        {selectedShipment ? (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4">
            <div className="w-full max-w-xl rounded-2xl bg-white shadow-2xl">
              <div className="flex items-center justify-between border-b border-gray-200 px-6 py-5">
                <div>
                  <h2 className="text-2xl font-semibold text-gray-900">Mark Received</h2>
                  <p className="mt-1 text-sm text-gray-500">Ref: {selectedShipment.reference || selectedShipment.id}</p>
                </div>
                <button
                  type="button"
                  onClick={handleCancel}
                  className="rounded-full p-2 text-gray-400 hover:bg-gray-100 hover:text-gray-700"
                >
                  ×
                </button>
              </div>
              <div className="max-h-[70vh] overflow-y-auto p-6">
                <div className="space-y-4">
                  {getLineItems(selectedShipment).map((item, itemIndex) => {
                    const key = getLineItemId(item);
                    const sku = getItemSku(item) || key || `SKU ${itemIndex + 1}`;
                    const productName = getProductName(item);
                    const expected = getExpectedQty(item);
                    const receivedSoFar = getReceivedQty(item);
                    const remaining = getRemainingQty(item);
                    const receivedValue = receivedQuantities[key] ?? '';
                    const value = Number(receivedValue || 0);
                    const invalidQuantity = !Number.isFinite(value) || value < 0 || value > remaining;
                    const lineHasDiscrepancy = hasReceivingLineDiscrepancy(item);
                    const notes = getReceivingLineDiscrepancyNotes(item);
                    return (
                      <div key={key || itemIndex} className={`rounded-xl border p-4 ${lineHasDiscrepancy || invalidQuantity ? 'border-red-200 bg-red-50/40' : 'border-gray-200 bg-white'}`}>
                        <div className="mb-3 flex items-center justify-between gap-3">
                          <div>
                            <p className="text-sm font-semibold text-gray-900">SKU: {sku}</p>
                            <p className="mt-1 text-xs text-gray-500">{productName}</p>
                          </div>
                          {remaining <= 0 ? (
                            <span className="rounded-full bg-green-100 px-2.5 py-1 text-[11px] font-semibold text-green-700">Verified</span>
                          ) : lineHasDiscrepancy ? (
                            <span className="rounded-full bg-red-100 px-2.5 py-1 text-[11px] font-semibold text-red-700">Discrepancy</span>
                          ) : (
                            <span className="rounded-full bg-orange-100 px-2.5 py-1 text-[11px] font-semibold text-[#c05621]">Pending</span>
                          )}
                        </div>
                        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                          <div>
                            <label className="mb-1 block text-[10px] font-semibold uppercase tracking-[0.12em] text-gray-500">Expected</label>
                            <input type="number" value={formatReceivingQuantity(expected)} readOnly className="w-full rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-sm text-gray-700" />
                          </div>
                          <div>
                            <label className="mb-1 block text-[10px] font-semibold uppercase tracking-[0.12em] text-gray-500">Received So Far</label>
                            <input type="number" value={formatReceivingQuantity(receivedSoFar)} readOnly className="w-full rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-sm text-gray-700" />
                          </div>
                          <div>
                            <label className="mb-1 block text-[10px] font-semibold uppercase tracking-[0.12em] text-gray-500">Remaining</label>
                            <input type="number" value={formatReceivingQuantity(remaining)} readOnly className="w-full rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-sm text-gray-700" />
                          </div>
                          <div>
                            <label className="mb-1 block text-[10px] font-semibold uppercase tracking-[0.12em] text-gray-500">Receive Now</label>
                            <input
                              type="number"
                              min="0"
                              max={remaining}
                              value={receivedValue}
                              disabled={remaining <= 0}
                              onChange={(e) => setReceivedQuantities({ ...receivedQuantities, [key]: e.target.value })}
                              className={`w-full rounded-lg border px-3 py-2 text-sm ${remaining <= 0 ? 'cursor-not-allowed border-gray-200 bg-gray-50 text-gray-400' : invalidQuantity ? 'border-red-300 bg-white text-red-700' : 'border-gray-200 text-gray-900'}`}
                              placeholder="0"
                            />
                          </div>
                        </div>
                        {invalidQuantity ? (
                          <div className="mt-3 flex items-center gap-2 rounded-lg bg-red-100 px-3 py-2 text-xs text-red-700">
                            <AlertCircle size={14} />
                            <span>Enter a quantity from 0 to {formatReceivingQuantity(remaining)} for {sku}.</span>
                          </div>
                        ) : lineHasDiscrepancy || notes ? (
                          <div className="mt-3 flex items-center gap-2 rounded-lg bg-red-100 px-3 py-2 text-xs text-red-700">
                            <AlertCircle size={14} />
                            <span>{notes || `${formatReceivingQuantity(remaining)} units still need to be received for ${sku}.`}</span>
                          </div>
                        ) : null}
                      </div>
                    );
                  })}
                  {!getLineItems(selectedShipment).length ? (
                    <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
                      No line items returned for this shipment.
                    </div>
                  ) : null}
                </div>
              </div>
              <div className="flex items-center gap-3 border-t border-gray-200 px-6 py-5">
                <button onClick={handleCancel} className="flex-1 rounded-lg border border-gray-300 px-4 py-2.5 text-sm font-medium text-gray-700 hover:bg-gray-50">Cancel</button>
                <button
                  type="button"
                  onClick={handleConfirmArrival}
                  disabled={isSaving}
                  className="inline-flex flex-1 items-center justify-center gap-2 rounded-lg bg-[#ff6900] px-4 py-2.5 text-sm font-medium text-white hover:bg-[#e55d00] disabled:cursor-not-allowed disabled:opacity-70"
                >
                  {isSaving ? <RefreshCw size={14} className="animate-spin" /> : null}
                  {isSaving ? 'Confirming...' : 'Confirm Receipt'}
                </button>
              </div>
            </div>
          </div>
        ) : null}
      </div>
    </Layout>
  );
};

export default Receiving;
