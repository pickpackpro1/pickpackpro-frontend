export const SHIPMENT_SUMMARY_FALLBACK_PAGE_SIZE = 20;

export const buildShipmentSummaryUrl = (apiBaseUrl = '', params = {}) => {
  const query = new URLSearchParams();
  query.set('page', String(params.page || 1));

  if (params.limit !== undefined && params.limit !== null && String(params.limit).trim()) {
    query.set('limit', String(params.limit).trim());
  }

  if (params.status && String(params.status).trim() && String(params.status).trim() !== 'all') {
    query.set('status', String(params.status).trim());
  }

  if (params.search && String(params.search).trim()) {
    query.set('search', String(params.search).trim());
  }

  if (params.clientId && String(params.clientId).trim()) {
    query.set('clientId', String(params.clientId).trim());
  }

  return `${apiBaseUrl}/api/shipments/summary?${query.toString()}`;
};

export const getShipmentSummaryRows = (payload = {}) => {
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload?.rows)) return payload.rows;
  if (Array.isArray(payload?.data?.rows)) return payload.data.rows;
  return [];
};

export const getShipmentSummaryMeta = (payload = {}) => {
  const source = payload?.data && typeof payload.data === 'object' ? payload.data : payload || {};
  return {
    total: Number(source.total || 0),
    page: Number(source.page || 1),
    limit: Number(source.limit || SHIPMENT_SUMMARY_FALLBACK_PAGE_SIZE),
    view: source.view || '',
  };
};

export const fetchShipmentSummaryPages = async ({
  apiBaseUrl = '',
  headers = {},
  parseResponse,
  params = {},
  pageSize = null,
  fetchOptions = {},
  maxPages = 50,
} = {}) => {
  if (typeof parseResponse !== 'function') {
    throw new Error('parseResponse is required for shipment summary requests.');
  }

  const rows = [];

  for (let page = 1; page <= maxPages; page += 1) {
    const response = await fetch(
      buildShipmentSummaryUrl(apiBaseUrl, {
        ...params,
        page,
        ...(pageSize ? { limit: pageSize } : {}),
      }),
      {
        method: 'GET',
        headers,
        ...fetchOptions,
      }
    );
    const payload = await parseResponse(response);
    const pageRows = getShipmentSummaryRows(payload);
    const meta = getShipmentSummaryMeta(payload);

    rows.push(...pageRows);

    const total = Number(meta.total || 0);
    const limit = Number(meta.limit || pageSize || SHIPMENT_SUMMARY_FALLBACK_PAGE_SIZE);
    if (!pageRows.length || pageRows.length < limit || (total > 0 && rows.length >= total)) break;
  }

  return rows;
};
