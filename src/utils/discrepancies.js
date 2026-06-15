import { getSession } from './auth';
import { formatToastMessage } from './toast';

const API_BASE_URL = '';

const buildHeaders = (includeJson = false) => {
  const session = getSession();
  const headers = {};

  if (session?.token) headers.Authorization = `Bearer ${session.token}`;
  if (includeJson) headers['Content-Type'] = 'application/json';

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
    const error = new Error(formatToastMessage(
      payload?.message ?? payload?.error ?? payload?.details ?? (typeof payload === 'string' ? payload : ''),
      `Request failed with status ${response.status}`
    ));
    error.status = response.status;
    error.payload = payload;
    error.responseText = text;
    throw error;
  }

  return payload;
};

export const getDiscrepancyResolveData = (payload) =>
  payload?.data && typeof payload.data === 'object' ? payload.data : payload;

export const resolveDiscrepancy = async (lineItemId, payload = {}) => {
  const normalizedLineItemId = String(lineItemId || '').trim();
  if (!normalizedLineItemId) throw new Error('Line item ID is required to update received quantity.');

  const hasReceivedQty = Object.prototype.hasOwnProperty.call(payload, 'receivedQty');
  const hasAdditionalReceivedQty = Object.prototype.hasOwnProperty.call(payload, 'additionalReceivedQty');

  if (hasReceivedQty === hasAdditionalReceivedQty) {
    throw new Error('Send either final received quantity or additional received quantity.');
  }

  const response = await fetch(`${API_BASE_URL}/api/discrepancies/${encodeURIComponent(normalizedLineItemId)}/resolve`, {
    method: 'PATCH',
    headers: buildHeaders(true),
    body: JSON.stringify(payload),
  });

  return parseResponse(response);
};
