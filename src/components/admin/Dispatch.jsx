import React, { useEffect, useMemo, useState } from 'react';
import Layout from './adminlayout/Layout';
import LoadingState from '../common/LoadingState';
import FullPageLoader from '../common/FullPageLoader';
import ConfirmationModal from '../common/ConfirmationModal';
import { getSession } from '../../utils/auth';
import { Truck, Clock, Send, Search, Filter, Download, CheckCircle2 } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { API_MUTATION_EVENT_NAME } from '../../utils/toast';

const API_BASE_URL = '';
const DISPATCH_PAGE_SIZE = 10;

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

const toBooleanFlag = (value) => {
  if (value === true || value === 1) return true;
  if (value === false || value === 0) return false;
  const normalized = String(value || '').trim().toLowerCase();
  return ['true', 'yes', '1', 'uploaded', 'ready'].includes(normalized);
};

const getNumberOrFallback = (source = {}, keys = [], fallback = 0) => {
  const rawValue = firstPresent(...keys.map((key) => source?.[key]));
  const value = Number(rawValue);
  return rawValue !== '' && Number.isFinite(value) ? value : fallback;
};

const extractDispatchQueueData = (payload = {}) =>
  payload?.data && typeof payload.data === 'object' ? payload.data : payload || {};

const extractDispatchQueueRows = (payload = {}) => {
  const data = extractDispatchQueueData(payload);
  return toArray(data?.rows || data?.dispatchRows || data?.dispatch_rows || payload?.rows || payload);
};

const formatQueueContents = (contents = []) =>
  toArray(contents)
    .map((item) => {
      const sku = firstPresent(item?.sku, item?.productSku, item?.product_sku, item?.sellerSku, item?.seller_sku);
      const quantity = firstPresent(item?.quantity, item?.qty, item?.units);
      if (sku && quantity !== '') return `${sku} x ${quantity}`;
      return sku || '';
    })
    .filter(Boolean)
    .join(', ');

const getQueueChildBoxTitle = (box = {}, index = 0) => {
  const boxNumber = firstPresent(box?.boxNumber, box?.box_number);
  const isPallet = toBooleanFlag(firstPresent(box?.isPallet, box?.is_pallet)) || String(firstPresent(box?.boxType, box?.box_type)).toLowerCase() === 'pallet';
  const boxNumberTitle = boxNumber !== '' ? (isPallet ? `Pallet ${boxNumber}` : /^\d+$/.test(String(boxNumber)) ? `Box ${boxNumber}` : String(boxNumber)) : '';
  return firstPresent(
    box?.palletNumber,
    box?.pallet_number,
    boxNumberTitle,
    box?.boxTitle,
    box?.box_title,
    box?.title,
    `Box ${index + 1}`
  );
};

const getShipmentListTotal = (payload = {}, fallback = 0) => {
  const data = payload?.data && typeof payload.data === 'object' ? payload.data : payload || {};
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

const normalizeStatusValue = (value = '') =>
  String(value || '').trim().toLowerCase().replace(/\s+/g, '_');

const getDispatchAction = ({ dispatchState, fbaLabelUploaded }) => {
  if (dispatchState === 'completed') return 'Completed';
  if (dispatchState === 'dispatched') return 'Dispatched';
  return fbaLabelUploaded ? 'Dispatch' : 'Chase Client';
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

    const firstBoxNumber = Number(firstPresent(firstRow?.boxSequenceNumber, firstRow?.box_sequence_number, firstRow?.sequence, firstRow?.sequence_no, -1));
    const secondBoxNumber = Number(firstPresent(secondRow?.boxSequenceNumber, secondRow?.box_sequence_number, secondRow?.sequence, secondRow?.sequence_no, -1));

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

const isDispatchComplete = (item = {}) =>
  item.action === 'Dispatched' || item.action === 'Completed';

const isDispatchableQueueItem = (item = {}) =>
  (item.isDispatchable !== undefined || item.canDispatchDirectly !== undefined
    ? toBooleanFlag(item.isDispatchable || item.canDispatchDirectly)
    : (Boolean(item.fbaShippingLabelFileId || item.labelUploadedAt || item.fbaLabelUploaded) || Boolean(item.isPallet))) &&
  !isDispatchComplete(item);

const palletMissingFbaLabel = (box = {}) =>
  Boolean(box?.isPallet) && !box?.fbaLabelUploaded && !box?.fbaShippingLabelFileId && !box?.labelUploadedAt;

const normalizeDispatchQueueRow = (row = {}, index = 0) => {
  const shipmentId = firstPresent(row?.shipmentId, row?.shipment_id);
  const shipmentReference = firstPresent(row?.shipmentReference, row?.shipment_reference, row?.shipment, row?.reference, shipmentId, '-');
  const subShipmentId = firstPresent(row?.subShipmentId, row?.sub_shipment_id);
  const subShipmentReference = firstPresent(row?.subShipmentReference, row?.sub_shipment_reference, '-');
  const client = firstPresent(row?.clientName, row?.client_name, row?.client?.companyName, row?.client?.company_name, row?.clients?.companyName, row?.clients?.company_name, '-');
  const boxId = firstPresent(row?.boxId, row?.box_id, row?.id);
  const isPallet = toBooleanFlag(firstPresent(row?.isPallet, row?.is_pallet)) || String(firstPresent(row?.boxType, row?.box_type)).toLowerCase() === 'pallet';
  const boxNumber = firstPresent(row?.boxNumber, row?.box_number);
  const boxNumberTitle = boxNumber !== '' ? (isPallet ? `Pallet ${boxNumber}` : /^\d+$/.test(String(boxNumber)) ? `Box ${boxNumber}` : String(boxNumber)) : '';
  const boxTitle = firstPresent(
    row?.palletNumber,
    row?.pallet_number,
    boxNumberTitle,
    row?.boxTitle,
    row?.box_title,
    row?.title,
    '--'
  );
  const weightValue = firstPresent(row?.weightKg, row?.weight_kg, row?.weight);
  const childBoxes = toArray(row?.childBoxes || row?.child_boxes);
  const labelStatus = String(firstPresent(row?.labelStatus, row?.label_status)).toLowerCase();
  const fbaLabelUploaded =
    toBooleanFlag(firstPresent(row?.fbaLabelUploaded, row?.fba_label_uploaded)) ||
    labelStatus === 'uploaded' ||
    Boolean(firstPresent(row?.fbaShippingLabelFileId, row?.fba_shipping_label_file_id, row?.fbaLabelFileId, row?.fba_label_file_id));
  const dispatchedAt = firstPresent(row?.dispatchedAt, row?.dispatched_at);
  const dispatchState = String(firstPresent(row?.dispatchState, row?.dispatch_state, dispatchedAt ? 'dispatched' : '')).toLowerCase();
  const rawAction = firstPresent(row?.action, getDispatchAction({ dispatchState, fbaLabelUploaded }));
  const normalizedAction = String(rawAction).toLowerCase();
  const action =
    normalizedAction === 'dispatch'
      ? 'Dispatch'
      : normalizedAction === 'dispatched'
      ? 'Dispatched'
      : normalizedAction === 'completed'
      ? 'Completed'
      : normalizedAction === 'chase client'
      ? 'Chase Client'
      : rawAction || getDispatchAction({ dispatchState, fbaLabelUploaded });
  const explicitDispatchable = firstPresent(row?.isDispatchable, row?.is_dispatchable, row?.canDispatchDirectly, row?.can_dispatch_directly);
  const isDispatchable = explicitDispatchable === '' ? action === 'Dispatch' : toBooleanFlag(explicitDispatchable);

  return {
    id: firstPresent(row?.id, `${shipmentId || shipmentReference}-${subShipmentId || 'parent'}-${boxId || boxTitle || index}`),
    boxId,
    shipmentId,
    shipment: shipmentReference,
    subShipmentId,
    subShipment: subShipmentReference || '-',
    client,
    box: boxTitle,
    type: String(firstPresent(row?.boxType, row?.box_type, isPallet ? 'Pallet' : '--')).replaceAll('_', ' '),
    weight: weightValue !== '' ? `${weightValue} kg` : '--',
    contents: firstPresent(row?.contentsSummary, row?.contents_summary, formatQueueContents(row?.contents), '-'),
    childBoxCount: Number(firstPresent(row?.childBoxCount, row?.child_box_count, childBoxes.length, 0)) || 0,
    childBoxes: childBoxes.map(getQueueChildBoxTitle).join(', '),
    isPallet,
    fbaLabel: fbaLabelUploaded ? 'Uploaded' : 'Missing',
    fbaLabelUploaded,
    fbaShippingLabelFileId: firstPresent(row?.fbaShippingLabelFileId, row?.fba_shipping_label_file_id, row?.fbaLabelFileId, row?.fba_label_file_id),
    labelUploadedAt: firstPresent(row?.labelUploadedAt, row?.label_uploaded_at),
    labelStatus,
    dispatchedAt,
    dispatchState,
    rawStatus: dispatchState,
    action,
    isDispatchable,
    canDispatchDirectly: isDispatchable,
  };
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
  const [dispatchConfirm, setDispatchConfirm] = useState(null);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [currentPage, setCurrentPage] = useState(1);
  const [totalShipments, setTotalShipments] = useState(0);
  const [hasNextShipmentPage, setHasNextShipmentPage] = useState(false);
  const [dispatchCounts, setDispatchCounts] = useState({});
  const navigate = useNavigate();

  const loadShipments = async ({ silent = false, page = currentPage } = {}) => {
    const pageToLoad = Math.max(1, Number(page) || 1);

    try {
      if (!silent) setIsLoading(true);
      setError('');
      const query = new URLSearchParams({
        page: String(pageToLoad),
        limit: String(DISPATCH_PAGE_SIZE),
        status: dispatchFilter || 'all',
      });
      const trimmedSearch = searchTerm.trim();
      if (trimmedSearch) {
        query.set('search', trimmedSearch);
      }
      const response = await fetch(`${API_BASE_URL}/api/dispatch/queue?${query.toString()}`, {
        method: 'GET',
        headers: buildHeaders(),
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
      if (!silent) setIsLoading(false);
    }
  };

  useEffect(() => {
    setCurrentPage(1);
  }, [dispatchFilter, searchTerm]);

  useEffect(() => {
    const refreshTimer = window.setTimeout(() => {
      loadShipments();
    }, searchTerm.trim() ? 300 : 0);

    return () => window.clearTimeout(refreshTimer);
  }, [currentPage, dispatchFilter, searchTerm]);

  useEffect(() => {
    let refreshTimer = null;

    const scheduleRefresh = () => {
      window.clearTimeout(refreshTimer);
      refreshTimer = window.setTimeout(() => {
        loadShipments({ silent: true, page: currentPage });
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
  }, [currentPage]);

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
    const ready = getNumberOrFallback(dispatchCounts, ['readyCount', 'ready_count'], shipments.filter((item) => item.action === 'Dispatch').length);
    const missing = getNumberOrFallback(dispatchCounts, ['missingLabelCount', 'missing_label_count', 'pendingCount', 'pending_count'], shipments.filter((item) => item.action === 'Chase Client').length);
    const dispatchedToday = getNumberOrFallback(dispatchCounts, ['dispatchedCount', 'dispatched_count'], shipments.filter((item) => item.action === 'Dispatched' || item.action === 'Completed').length);

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
  }, [dispatchCounts, shipments]);

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
  const totalPages = totalShipments > 0
    ? Math.max(1, Math.ceil(totalShipments / DISPATCH_PAGE_SIZE))
    : currentPage + (hasNextShipmentPage ? 1 : 0);

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

  const runDispatchBox = async (box) => {
    const boxId = box?.boxId || box?.id || box?.uuid;

    try {
      setIsUpdatingId(boxId);
      setError('');
      setMessage('');
      await dispatchBoxRequest(box);
      setMessage(`${box?.isPallet ? 'Pallet' : 'Box'} dispatched successfully.`);
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setIsUpdatingId('');
    }
  };

  const handleDispatchBox = async (box) => {
    if (palletMissingFbaLabel(box)) {
      setDispatchConfirm({
        title: 'Dispatch pallet without FBA label?',
        message: 'This pallet does not have an FBA label. Are you sure you want to dispatch this pallet without a pallet FBA label?',
        confirmLabel: 'Dispatch Pallet',
        action: () => runDispatchBox(box),
      });
      return;
    }

    await runDispatchBox(box);
  };

  const runBulkDispatch = async (boxesToDispatch) => {
    try {
      setIsBulkDispatching(true);
      setIsUpdatingId('bulk');
      setError('');
      setMessage('');

      const results = await Promise.allSettled(boxesToDispatch.map(dispatchBoxRequest));
      const dispatchedCount = results.filter((result) => result.status === 'fulfilled').length;
      const failedCount = results.length - dispatchedCount;

      if (failedCount) {
        setError(`${failedCount} selected record${failedCount === 1 ? '' : 's'} could not be dispatched.`);
      }

      if (dispatchedCount) {
        setMessage(`${dispatchedCount} selected record${dispatchedCount === 1 ? '' : 's'} dispatched successfully.`);
      }
    } finally {
      setIsBulkDispatching(false);
      setIsUpdatingId('');
    }
  };

  const handleBulkDispatch = async () => {
    const boxesToDispatch = selectedDispatchItems;
    if (!boxesToDispatch.length) {
      setError('Select at least one dispatch-ready record.');
      return;
    }

    if (boxesToDispatch.some(palletMissingFbaLabel)) {
      setDispatchConfirm({
        title: 'Dispatch pallets without FBA labels?',
        message: 'One or more selected pallets do not have FBA labels. Are you sure you want to dispatch these pallets without pallet FBA labels?',
        confirmLabel: 'Dispatch Selected',
        action: () => runBulkDispatch(boxesToDispatch),
      });
      return;
    }

    await runBulkDispatch(boxesToDispatch);
  };

  const handleConfirmDispatchWarning = async () => {
    const action = dispatchConfirm?.action;
    setDispatchConfirm(null);
    if (typeof action === 'function') {
      await action();
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

          <div className="flex flex-col gap-3 border-t border-gray-100 px-6 py-4 text-sm text-gray-500 sm:flex-row sm:items-center sm:justify-between">
            <span>
              Page {currentPage}{totalShipments ? ` of ${totalPages}` : ''}
            </span>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setCurrentPage((page) => Math.max(1, page - 1))}
                disabled={isLoading || currentPage <= 1}
                className="rounded-lg border border-gray-200 px-3 py-1.5 font-medium text-gray-600 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
              >
                Previous
              </button>
              <button
                type="button"
                onClick={() => setCurrentPage((page) => page + 1)}
                disabled={isLoading || !hasNextShipmentPage}
                className="rounded-lg border border-gray-200 px-3 py-1.5 font-medium text-gray-600 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
              >
                Next
              </button>
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
    </Layout>
  );
};

export default Dispatch;
