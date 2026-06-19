export const TOAST_EVENT_NAME = 'pickpackpro-toast';
export const API_MUTATION_EVENT_NAME = 'pickpackpro-api-mutated';

const getFriendlyBackendMessage = (message = '') => {
  const text = String(message || '').trim();
  if (!text) return '';

  const normalizedText = text.toLowerCase();

  if (
    normalizedText.includes('invoices_dispatch_source_check') ||
    (
      normalizedText.includes('new row for relation') &&
      normalizedText.includes('invoices') &&
      normalizedText.includes('violates check constraint')
    ) ||
    (
      normalizedText.includes('prisma.sub_shipments.deletemany') &&
      normalizedText.includes('invoices')
    )
  ) {
    return 'This shipment cannot be deleted because it has linked invoice/sub-shipment billing records. Please cancel or resolve the related invoice first, then try again.';
  }

  if (normalizedText.includes('prisma.') && normalizedText.includes('invocation')) {
    return 'The request could not be completed because related backend records blocked this action.';
  }

  return text;
};

export const formatToastMessage = (value, fallback = 'Something went wrong.') => {
  if (value instanceof Error) return formatToastMessage(value.message, fallback);

  if (typeof value === 'string') {
    const trimmed = value.trim();
    return getFriendlyBackendMessage(trimmed) || fallback;
  }

  if (value === 0 || value === false) return String(value);

  if (value && typeof value === 'object') {
    const nestedMessage =
      value.message ??
      value.error ??
      value.details ??
      value.detail ??
      value.description;

    if (nestedMessage !== undefined && nestedMessage !== null && nestedMessage !== value) {
      return formatToastMessage(nestedMessage, fallback);
    }

    try {
      return JSON.stringify(value);
    } catch {
      return fallback;
    }
  }

  return fallback;
};

export const showToast = (type, message) => {
  if (typeof window === 'undefined') return;

  window.dispatchEvent(
    new CustomEvent(TOAST_EVENT_NAME, {
      detail: { type, message: formatToastMessage(message) },
    })
  );
};

const getRequestMethod = (input, init = {}) =>
  String(init?.method || (typeof input !== 'string' ? input?.method : '') || 'GET').toUpperCase();

const getRequestUrl = (input) => (typeof input === 'string' ? input : input?.url || '');

const isAuthRefreshUrl = (url = '') =>
  [
    '/api/auth/refresh',
    '/api/auth/refresh-token',
    '/api/auth/token/refresh',
  ].some((endpoint) => String(url || '').includes(endpoint));

const shouldToastApiAction = (input, init = {}) => {
  if (init?.skipApiToast) return false;

  const method = getRequestMethod(input, init);
  const url = getRequestUrl(input);

  if (!['POST', 'PATCH', 'PUT', 'DELETE'].includes(method)) return false;
  if (!url.includes('/api/')) return false;
  if (url.includes('/api/auth/login') || url.includes('/api/auth/me')) return false;
  if (isAuthRefreshUrl(url)) return false;

  return true;
};

const shouldEmitApiMutation = (input, init = {}) => {
  const method = getRequestMethod(input, init);
  const url = getRequestUrl(input);

  if (!['POST', 'PATCH', 'PUT', 'DELETE'].includes(method)) return false;
  if (!url.includes('/api/')) return false;
  if (url.includes('/api/auth/login') || url.includes('/api/auth/me')) return false;
  if (isAuthRefreshUrl(url)) return false;

  return true;
};

const parseResponseMessage = async (response) => {
  try {
    const contentType = response.headers.get('content-type') || '';
    const text = await response.clone().text();
    if (!text) return '';
    const trimmedText = text.trim();

    if (
      contentType.includes('text/html') ||
      trimmedText.startsWith('<!DOCTYPE') ||
      trimmedText.startsWith('<html') ||
      trimmedText.includes('<title>404:')
    ) {
      return '';
    }

    try {
      const payload = JSON.parse(text);
      return formatToastMessage(payload?.message ?? payload?.error ?? payload?.details, '');
    } catch {
      return trimmedText.length > 240 ? '' : trimmedText;
    }
  } catch {
    return '';
  }
};

const getSuccessMessage = (method, url, responseMessage) => {
  if (responseMessage) return responseMessage;
  if (url.includes('/api/files')) return 'File uploaded successfully.';

  switch (method) {
    case 'POST':
      return 'Created successfully.';
    case 'PATCH':
    case 'PUT':
      return 'Updated successfully.';
    case 'DELETE':
      return 'Deleted successfully.';
    default:
      return 'Action completed successfully.';
  }
};

export const installApiActionToasts = () => {
  if (typeof window === 'undefined' || window.__PICKPACKPRO_API_TOASTS__) return;

  window.__PICKPACKPRO_API_TOASTS__ = true;
  const originalFetch = window.fetch.bind(window);

  window.fetch = async (input, init = {}) => {
    const method = getRequestMethod(input, init);
    const url = getRequestUrl(input);
    const shouldToast = shouldToastApiAction(input, init);
    const shouldEmitMutation = shouldEmitApiMutation(input, init);

    try {
      const response = await originalFetch(input, init);
      const responseMessage = shouldToast ? await parseResponseMessage(response) : '';

      if (response.ok && shouldEmitMutation) {
        window.dispatchEvent(
          new CustomEvent(API_MUTATION_EVENT_NAME, {
            detail: { method, url },
          })
        );
      }

      if (shouldToast) {
        if (response.ok) {
          showToast('success', getSuccessMessage(method, url, responseMessage));
        } else {
          showToast('error', responseMessage || `Request failed with status ${response.status}`);
        }
      }

      return response;
    } catch (error) {
      if (shouldToast) {
        showToast('error', error?.message || 'Request failed.');
      }

      throw error;
    }
  };
};
