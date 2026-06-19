const MAX_SHIPMENT_SERVICE_BATCH_LOOKUPS = 250;

const toArray = (value) => {
  if (Array.isArray(value)) return value;
  if (Array.isArray(value?.tasks)) return value.tasks;
  if (Array.isArray(value?.serviceTasks)) return value.serviceTasks;
  if (Array.isArray(value?.service_tasks)) return value.service_tasks;
  if (Array.isArray(value?.services)) return value.services;
  if (Array.isArray(value?.data?.tasks)) return value.data.tasks;
  if (Array.isArray(value?.data?.serviceTasks)) return value.data.serviceTasks;
  if (Array.isArray(value?.data?.service_tasks)) return value.data.service_tasks;
  if (Array.isArray(value?.data?.services)) return value.data.services;
  if (Array.isArray(value?.shipments)) return value.shipments;
  if (Array.isArray(value?.data?.shipments)) return value.data.shipments;
  if (Array.isArray(value?.data)) return value.data;
  return [];
};

export const isUuidValue = (value = '') =>
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(value || '').trim());

const extractServiceTasks = (source = {}) => {
  const directRows = toArray(source);
  if (directRows.length) return directRows;

  const grouped = source?.grouped || source?.data?.grouped;
  if (grouped && typeof grouped === 'object') {
    return Object.values(grouped).flatMap(toArray);
  }

  const groupedRows = Object.values(source).flatMap((value) => (Array.isArray(value) ? value : []));
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

  return Object.entries(map).reduce((nextMap, [shipmentId, tasks]) => {
    nextMap[shipmentId] = extractServiceTasks(tasks);
    return nextMap;
  }, {});
};

const normalizeBatchResult = (payload = {}) => {
  const data = payload?.data && typeof payload.data === 'object' ? payload.data : payload || {};
  const shipments = toArray(data.shipments || payload?.shipments);
  const tasksByShipmentId = {
    ...normalizeMap(data.tasksByShipmentId || data.tasks_by_shipment_id || {}),
  };
  const groupedByShipmentId = {
    ...normalizeMap(data.groupedByShipmentId || data.grouped_by_shipment_id || {}),
  };

  shipments.forEach((shipment) => {
    const shipmentId = String(shipment?.shipmentId || shipment?.shipment_id || shipment?.id || '').trim();
    if (!shipmentId) return;
    const tasks = extractServiceTasks(shipment);
    if (tasks.length && !tasksByShipmentId[shipmentId]) {
      tasksByShipmentId[shipmentId] = tasks;
    }
  });

  return {
    shipments,
    tasks: extractServiceTasks(data.tasks || data.serviceTasks || data.service_tasks || []),
    serviceTasks: extractServiceTasks(data.serviceTasks || data.service_tasks || data.tasks || []),
    tasksByShipmentId,
    groupedByShipmentId,
    totalShipments: Number(data.totalShipments || data.total_shipments || shipments.length || 0),
    totalTasks: Number(data.totalTasks || data.total_tasks || 0),
  };
};

const mergeBatchResults = (results = []) => ({
  shipments: results.flatMap((result) => result.shipments || []),
  tasks: results.flatMap((result) => result.tasks || []),
  serviceTasks: results.flatMap((result) => result.serviceTasks || []),
  tasksByShipmentId: Object.assign({}, ...results.map((result) => result.tasksByShipmentId || {})),
  groupedByShipmentId: Object.assign({}, ...results.map((result) => result.groupedByShipmentId || {})),
  totalShipments: results.reduce((sum, result) => sum + Number(result.totalShipments || 0), 0),
  totalTasks: results.reduce((sum, result) => sum + Number(result.totalTasks || 0), 0),
});

export const fetchShipmentServicesBatch = async ({
  apiBaseUrl = '',
  headers = {},
  parseResponse,
  shipmentIds = [],
  fetchOptions = {},
} = {}) => {
  if (typeof parseResponse !== 'function') {
    throw new Error('parseResponse is required for shipment service batch requests.');
  }

  const cleanShipmentIds = dedupeShipmentIds(shipmentIds);
  if (!cleanShipmentIds.length) return normalizeBatchResult({});

  const results = [];

  for (let index = 0; index < cleanShipmentIds.length; index += MAX_SHIPMENT_SERVICE_BATCH_LOOKUPS) {
    const chunk = cleanShipmentIds.slice(index, index + MAX_SHIPMENT_SERVICE_BATCH_LOOKUPS);
    const params = new URLSearchParams();
    chunk.forEach((shipmentId) => params.append('shipmentId', shipmentId));

    const response = await fetch(`${apiBaseUrl}/api/shipments/services/batch?${params.toString()}`, {
      method: 'GET',
      headers,
      cache: 'no-store',
      ...fetchOptions,
    });
    results.push(normalizeBatchResult(await parseResponse(response)));
  }

  return mergeBatchResults(results);
};

export const getBatchServicesForShipment = (batch = {}, shipmentId = '') => {
  const normalizedShipmentId = String(shipmentId || '').trim();
  if (!normalizedShipmentId) return [];

  const taskRows = extractServiceTasks(batch.tasksByShipmentId?.[normalizedShipmentId]);
  if (taskRows.length) return taskRows;

  const groupedRows = extractServiceTasks(batch.groupedByShipmentId?.[normalizedShipmentId]);
  if (groupedRows.length) return groupedRows;

  return extractServiceTasks(
    batch.shipments?.find((shipment) =>
      String(shipment?.shipmentId || shipment?.shipment_id || shipment?.id || '').trim() === normalizedShipmentId
    )
  );
};
