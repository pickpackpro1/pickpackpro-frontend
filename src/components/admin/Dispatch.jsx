import React, { useEffect, useMemo, useState } from 'react';
import Layout from './adminlayout/Layout';
import LoadingState from '../common/LoadingState';
import FullPageLoader from '../common/FullPageLoader';
import { getSession } from '../../utils/auth';
import { Truck, Clock, Send, Search, Filter, Download, CheckCircle2 } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { API_MUTATION_EVENT_NAME } from '../../utils/toast';

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

const extractShipments = (payload) => {
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload?.shipments)) return payload.shipments;
  if (Array.isArray(payload?.data?.rows)) return payload.data.rows;
  if (Array.isArray(payload?.data)) return payload.data;
  return [];
};

const getLineItems = (shipment) =>
  shipment?.shipment_line_items || shipment?.shipmentLineItems || shipment?.items || shipment?.lineItems || [];

const getBoxes = (shipment) =>
  shipment?.boxes || shipment?.shipmentBoxes || shipment?.shipment_boxes || [];

const extractBoxes = (payload) => {
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload?.boxes)) return payload.boxes;
  if (Array.isArray(payload?.data?.boxes)) return payload.data.boxes;
  if (Array.isArray(payload?.data?.rows)) return payload.data.rows;
  if (Array.isArray(payload?.data)) return payload.data;
  return [];
};

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

const getBoxLookupIds = (box = {}) => [
  ...new Set(
    [box?.id, box?.uuid, box?.boxId, box?.box_id, box?.recordId, box?.record_id]
      .map((value) => String(value || '').trim())
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

const enrichShipmentForDispatch = async (shipment) => {
  const shipmentId = getShipmentLookupId(shipment);
  let boxes = getBoxes(shipment);

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

  if (boxes.length) {
    const boxFileResults = await Promise.allSettled(
      boxes.map(async (box) => {
        const primaryBoxId = getBoxId(box);
        const lookupIds = getBoxLookupIds(box).filter((boxId, index, values) => values.indexOf(boxId) === index);
        if (!lookupIds.length) return [];

        const fileResults = await Promise.allSettled(
          lookupIds.map(async (boxId) => {
            const filesResponse = await fetch(`${API_BASE_URL}/api/files?entityType=box&entityId=${encodeURIComponent(boxId)}`, {
              method: 'GET',
              headers: buildHeaders(),
              cache: 'no-store',
            });
            return extractFiles(await parseResponse(filesResponse)).map((file) => normalizeBoxLabelFile(file, primaryBoxId || boxId));
          })
        );

        return fileResults.flatMap((result) => (result.status === 'fulfilled' ? result.value : []));
      })
    );

    boxes = boxes.map((box, index) => {
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
  }

  return {
    ...shipment,
    boxes,
    shipmentBoxes: boxes,
    shipment_boxes: boxes,
  };
};

const formatBoxContents = (shipment, box) => {
  const boxItems = box?.items || box?.boxItems || box?.contents || box?.box_contents || [];
  const firstBoxItem = Array.isArray(boxItems) ? boxItems[0] : null;

  if (firstBoxItem) {
    const qty = firstBoxItem?.quantity || firstBoxItem?.qty || firstBoxItem?.units || firstBoxItem?.expectedQty || firstBoxItem?.expected_qty || 0;
    const sku =
      firstBoxItem?.sku ||
      firstBoxItem?.productSku ||
      firstBoxItem?.product_sku ||
      firstBoxItem?.lineItem?.sku ||
      firstBoxItem?.shipmentItem?.sku ||
      '';

    return [qty ? `${qty}x` : '', sku].filter(Boolean).join(' ') || '--';
  }

  const firstShipmentItem = getLineItems(shipment)[0];

  if (firstShipmentItem) {
    const qty =
      firstShipmentItem?.receivedQty ||
      firstShipmentItem?.received_qty ||
      firstShipmentItem?.expectedQty ||
      firstShipmentItem?.expected_qty ||
      0;
    const sku = firstShipmentItem?.sku || firstShipmentItem?.productSku || firstShipmentItem?.product_sku || '';
    return [qty ? `${qty}x` : '', sku].filter(Boolean).join(' ') || '--';
  }

  return '--';
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
  const boxes = getBoxes(shipment);
  const normalizedBoxes = boxes.length ? boxes : [{}];

  return normalizedBoxes.map((box, index) => {
    const boxLabel =
      box?.reference ||
      box?.label ||
      box?.name ||
      box?.boxNumber ||
      box?.box_number ||
      box?.id ||
      (boxes.length ? `BOX-${String(index + 1).padStart(2, '0')}` : '--');
    const boxType = box?.boxType || box?.box_type || box?.type || box?.size || box?.boxSize || box?.box_size || '--';
    const weight = Number(box?.weight || box?.weightKg || box?.weight_kg || box?.grossWeight || box?.gross_weight || 0);
    const fbaLabelUploaded = boxes.length
      ? getBoxLabelUploaded(box)
      : Boolean(shipment?.fbaLabelUploaded || shipment?.fba_label_uploaded || shipment?.labelUploaded || shipment?.label_uploaded);
    const dispatchedAt = box?.dispatched_at || box?.dispatchedAt || '';
    const dispatchState = getBoxDispatchState(shipment, box);
    const action = getDispatchAction({ dispatchState, fbaLabelUploaded });

    return {
      id: `${shipmentId}-${box?.id || boxLabel || index}`,
      boxId: getBoxId(box),
      shipmentId,
      shipment: reference,
      client,
      box: boxLabel,
      type: String(boxType).replaceAll('_', ' '),
      weight: weight ? `${weight} kg` : '--',
      contents: formatBoxContents(shipment, box),
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

  const handleDispatchBox = async (box) => {
    const boxId = box?.boxId || box?.id || box?.uuid;
    if (!boxId) {
      setError('Box ID missing');
      return;
    }

    try {
      setIsUpdatingId(boxId);
      setError('');
      setMessage('');
      const response = await fetch(`${API_BASE_URL}/api/boxes/${encodeURIComponent(boxId)}/seal`, {
        method: 'PATCH',
        headers: buildHeaders(true),
        body: JSON.stringify({}),
      });
      const payload = await parseResponse(response);
      const updatedBox = payload?.box || payload?.data?.box || payload?.data || payload || {};
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
      setMessage('Box dispatched successfully.');
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setIsUpdatingId('');
    }
  };

  const handleChaseClient = (box) => {
    navigate(`/shipments/${box.shipmentId}`);
  };

  const handleExport = () => {
    const rows = [
      ['Shipment', 'Client', 'Box', 'Type', 'Weight', 'Contents', 'FBA Label', 'Action'],
      ...filteredQueue.map((item) => [
        item.shipment,
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
                  <th className="px-6 py-3 text-left text-xs font-semibold uppercase tracking-wider text-gray-500">Shipment</th>
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
                  const dispatchComplete = item.action === 'Dispatched' || item.action === 'Completed';
                  const isDispatchAction = labelUploaded && !dispatchComplete;
                  return (
                    <tr key={item.id} className="transition-colors hover:bg-gray-50">
                      <td className="px-6 py-3">
                        <span className="text-sm font-medium text-gray-900">{item.shipment}</span>
                      </td>
                      <td className="px-6 py-3">
                        <span className="text-sm text-gray-700">{item.client}</span>
                      </td>
                      <td className="px-6 py-3">
                        <span className="text-sm font-medium text-gray-700">{item.box}</span>
                      </td>
                      <td className="px-6 py-3">
                        <span className="rounded bg-gray-100 px-2 py-1 text-[11px] font-semibold text-gray-600">{item.type}</span>
                      </td>
                      <td className="px-6 py-3">
                        <span className="text-sm text-gray-700">{item.weight}</span>
                      </td>
                      <td className="px-6 py-3">
                        <span className="text-sm text-gray-500">{item.contents}</span>
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
                            Missing
                          </span>
                        )}
                      </td>
                      <td className="px-6 py-3">
                        <button
                          type="button"
                          onClick={() => {
                            if (dispatchComplete) return;

                            if (isDispatchAction) {
                              handleDispatchBox(item);
                              return;
                            }
                            handleChaseClient(item);
                          }}
                          disabled={dispatchComplete || isUpdatingId === (item.boxId || item.shipmentId)}
                          className={`inline-flex items-center gap-1.5 rounded-lg px-4 py-2 text-sm transition-colors ${
                            dispatchComplete
                              ? 'border border-emerald-200 bg-emerald-50 font-semibold text-emerald-700'
                              : isDispatchAction
                              ? 'bg-emerald-600 font-semibold text-white hover:bg-emerald-700'
                              : 'border border-[#d1d5db] bg-white font-medium text-[#374151] hover:bg-[#f9fafb]'
                          } ${dispatchComplete || isUpdatingId === (item.boxId || item.shipmentId) ? 'cursor-not-allowed opacity-70' : ''}`}
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
