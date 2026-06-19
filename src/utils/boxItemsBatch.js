const MAX_BOX_ITEM_BATCH_LOOKUPS = 250;

const toArray = (value) => {
  if (Array.isArray(value)) return value;
  if (Array.isArray(value?.items)) return value.items;
  if (Array.isArray(value?.data?.items)) return value.data.items;
  if (Array.isArray(value?.boxes)) return value.boxes;
  if (Array.isArray(value?.data?.boxes)) return value.data.boxes;
  if (Array.isArray(value?.data)) return value.data;
  return [];
};

export const isUuidValue = (value = '') =>
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(value || '').trim());

const dedupeBoxIds = (boxIds = []) => {
  const seen = new Set();

  return boxIds
    .map((boxId) => String(boxId || '').trim())
    .filter(isUuidValue)
    .filter((boxId) => {
      if (seen.has(boxId)) return false;
      seen.add(boxId);
      return true;
    });
};

const normalizeBatchResult = (payload = {}) => {
  const data = payload?.data && typeof payload.data === 'object' ? payload.data : payload || {};
  return {
    boxes: toArray(data.boxes || payload?.boxes),
    itemsByBoxId: data.itemsByBoxId || data.items_by_box_id || {},
    totalBoxes: Number(data.totalBoxes || data.total_boxes || 0),
    totalItems: Number(data.totalItems || data.total_items || 0),
  };
};

const mergeBatchResults = (results = []) => ({
  boxes: results.flatMap((result) => result.boxes || []),
  itemsByBoxId: Object.assign({}, ...results.map((result) => result.itemsByBoxId || {})),
  totalBoxes: results.reduce((sum, result) => sum + Number(result.totalBoxes || 0), 0),
  totalItems: results.reduce((sum, result) => sum + Number(result.totalItems || 0), 0),
});

export const fetchBoxItemsBatch = async ({
  apiBaseUrl = '',
  headers = {},
  parseResponse,
  boxIds = [],
  fetchOptions = {},
} = {}) => {
  if (typeof parseResponse !== 'function') {
    throw new Error('parseResponse is required for box item batch requests.');
  }

  const cleanBoxIds = dedupeBoxIds(boxIds);
  if (!cleanBoxIds.length) return normalizeBatchResult({});

  const results = [];

  for (let index = 0; index < cleanBoxIds.length; index += MAX_BOX_ITEM_BATCH_LOOKUPS) {
    const chunk = cleanBoxIds.slice(index, index + MAX_BOX_ITEM_BATCH_LOOKUPS);
    const params = new URLSearchParams();
    chunk.forEach((boxId) => params.append('boxId', boxId));

    const response = await fetch(`${apiBaseUrl}/api/boxes/items/batch?${params.toString()}`, {
      method: 'GET',
      headers,
      cache: 'no-store',
      ...fetchOptions,
    });
    results.push(normalizeBatchResult(await parseResponse(response)));
  }

  return mergeBatchResults(results);
};

export const getBatchItemsForBox = (batch = {}, boxId = '') => {
  const normalizedBoxId = String(boxId || '').trim();
  if (!normalizedBoxId) return [];

  return (
    batch.itemsByBoxId?.[normalizedBoxId] ||
    batch.boxes?.find((box) =>
      String(box?.boxId || box?.box_id || box?.id || '').trim() === normalizedBoxId
    )?.items ||
    []
  );
};
