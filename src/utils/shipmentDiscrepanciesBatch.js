const MAX_SHIPMENT_DISCREPANCY_BATCH_LOOKUPS = 250;

const toArray = (value) => {
  if (Array.isArray(value)) return value;
  if (Array.isArray(value?.discrepancies)) return value.discrepancies;
  if (Array.isArray(value?.data?.discrepancies)) return value.data.discrepancies;
  if (Array.isArray(value?.shipments)) return value.shipments;
  if (Array.isArray(value?.data?.shipments)) return value.data.shipments;
  if (Array.isArray(value?.data)) return value.data;
  return [];
};

export const isUuidValue = (value = '') =>
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(value || '').trim());

const extractDiscrepancies = (source = {}) => {
  const directRows = toArray(source);
  if (directRows.length) return directRows;

  const groupedRows = Object.values(source || {}).flatMap((value) => (Array.isArray(value) ? value : []));
  if (groupedRows.length) return groupedRows;

  return [];
};

const dedupeShipmentIds = (shipmentIds = []) => {
  const seen = new Set();

  return shipmentIds
    .map((shipmentId) => String(shipmentId || '').trim())
    .filter(isUuidValue)
    .filter((shipmentId) => {
      if (seen.has(shipmentId)) return false;
      seen.add(shipmentId);
      return true;
    });
};

const normalizeMap = (map = {}) => {
  if (!map || typeof map !== 'object' || Array.isArray(map)) return {};

  return Object.entries(map).reduce((nextMap, [shipmentId, rows]) => {
    nextMap[shipmentId] = extractDiscrepancies(rows);
    return nextMap;
  }, {});
};

const normalizeBatchResult = (payload = {}) => {
  const data = payload?.data && typeof payload.data === 'object' ? payload.data : payload || {};
  const shipments = toArray(data.shipments || payload?.shipments);
  const discrepanciesByShipmentId = normalizeMap(
    data.discrepanciesByShipmentId || data.discrepancies_by_shipment_id || {}
  );

  shipments.forEach((shipment) => {
    const shipmentId = String(shipment?.shipmentId || shipment?.shipment_id || shipment?.id || '').trim();
    if (!shipmentId) return;
    const rows = extractDiscrepancies(shipment);
    if (rows.length && !discrepanciesByShipmentId[shipmentId]) {
      discrepanciesByShipmentId[shipmentId] = rows;
    }
  });

  return {
    shipments,
    discrepancies: extractDiscrepancies(data.discrepancies || []),
    discrepanciesByShipmentId,
    totalShipments: Number(data.totalShipments || data.total_shipments || shipments.length || 0),
    totalDiscrepancies: Number(data.totalDiscrepancies || data.total_discrepancies || 0),
  };
};

const mergeBatchResults = (results = []) => ({
  shipments: results.flatMap((result) => result.shipments || []),
  discrepancies: results.flatMap((result) => result.discrepancies || []),
  discrepanciesByShipmentId: Object.assign({}, ...results.map((result) => result.discrepanciesByShipmentId || {})),
  totalShipments: results.reduce((sum, result) => sum + Number(result.totalShipments || 0), 0),
  totalDiscrepancies: results.reduce((sum, result) => sum + Number(result.totalDiscrepancies || 0), 0),
});

export const fetchShipmentDiscrepanciesBatch = async ({
  apiBaseUrl = '',
  headers = {},
  parseResponse,
  shipmentIds = [],
  fetchOptions = {},
} = {}) => {
  if (typeof parseResponse !== 'function') {
    throw new Error('parseResponse is required for shipment discrepancy batch requests.');
  }

  const cleanShipmentIds = dedupeShipmentIds(shipmentIds);
  if (!cleanShipmentIds.length) return normalizeBatchResult({});

  const results = [];

  for (let index = 0; index < cleanShipmentIds.length; index += MAX_SHIPMENT_DISCREPANCY_BATCH_LOOKUPS) {
    const chunk = cleanShipmentIds.slice(index, index + MAX_SHIPMENT_DISCREPANCY_BATCH_LOOKUPS);
    const params = new URLSearchParams();
    chunk.forEach((shipmentId) => params.append('shipmentId', shipmentId));

    const response = await fetch(`${apiBaseUrl}/api/shipments/discrepancies/batch?${params.toString()}`, {
      method: 'GET',
      headers,
      cache: 'no-store',
      ...fetchOptions,
    });
    results.push(normalizeBatchResult(await parseResponse(response)));
  }

  return mergeBatchResults(results);
};

export const getBatchDiscrepanciesForShipment = (batch = {}, shipmentId = '') => {
  const normalizedShipmentId = String(shipmentId || '').trim();
  if (!normalizedShipmentId) return [];

  const mappedRows = extractDiscrepancies(batch.discrepanciesByShipmentId?.[normalizedShipmentId]);
  if (mappedRows.length) return mappedRows;

  return extractDiscrepancies(
    batch.shipments?.find((shipment) =>
      String(shipment?.shipmentId || shipment?.shipment_id || shipment?.id || '').trim() === normalizedShipmentId
    )
  );
};
