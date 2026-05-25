export const TOAST_EVENT_NAME = 'pickpackpro-toast';
export const API_MUTATION_EVENT_NAME = 'pickpackpro-api-mutated';

export const showToast = (type, message) => {
  if (typeof window === 'undefined') return;

  window.dispatchEvent(
    new CustomEvent(TOAST_EVENT_NAME, {
      detail: { type, message },
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
      return payload?.message || payload?.error || payload?.details || '';
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

    try {
      const response = await originalFetch(input, init);

      if (shouldToast) {
        const responseMessage = await parseResponseMessage(response);

        if (response.ok) {
          showToast('success', getSuccessMessage(method, url, responseMessage));
          window.dispatchEvent(
            new CustomEvent(API_MUTATION_EVENT_NAME, {
              detail: { method, url },
            })
          );
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
