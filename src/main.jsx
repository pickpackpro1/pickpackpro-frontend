import { createRoot } from "react-dom/client";
import "./index.css";
import App from "./App.jsx";
import { getAccessTokenForProtectedRequest, getFreshSessionOnce, handleProtectedAuthFailure } from "./utils/apiAuth.js";
import { API_MUTATION_EVENT_NAME, installApiActionToasts } from "./utils/toast.js";
// import { ToastContainer } from "react-toastify";
// import "react-toastify/dist/ReactToastify.css";

if (typeof window !== "undefined" && !window.__PICKPACKPRO_API_GET_CACHE__) {
  window.__PICKPACKPRO_API_GET_CACHE__ = true;

  const originalFetch = window.fetch.bind(window);
  const inFlightGetRequests = new Map();
  const recentGetResponses = new Map();
  const API_CACHE_STORAGE_KEY = "pickpackpro-api-get-cache-v4";
  const OLD_LOCAL_API_CACHE_KEYS = [
    "pickpackpro-api-get-cache-v1",
    "pickpackpro-api-get-cache-v2",
    "pickpackpro-api-get-cache-v3",
  ];
  const AUTH_STORAGE_KEY = "pickpackpro-auth";
  const BACKEND_API_ORIGIN = "https://ali-backend.vercel.app";
  const maxMemoryEntries = 200;
  const maxStoredEntries = 25;
  const maxStoredBodyChars = 250_000;
  let apiCacheVersion = 0;
  let apiLastMutationAt = 0;
  const shouldLogGetRequests = () => window.__PICKPACKPRO_DEBUG_GETS__ === true;

  try {
    OLD_LOCAL_API_CACHE_KEYS.forEach((key) => localStorage.removeItem(key));
  } catch {
    // Old persistent API caches are only performance hints.
  }

  const parseRequestUrl = (requestUrl = "") => {
    try {
      return new URL(requestUrl, window.location.origin);
    } catch {
      return null;
    }
  };

  const getSameOriginApiUrl = (requestUrl = "") => {
    const parsedUrl = parseRequestUrl(requestUrl);
    if (!parsedUrl || import.meta.env.DEV) return requestUrl;
    if (parsedUrl.origin !== BACKEND_API_ORIGIN || !parsedUrl.pathname.startsWith("/api/")) {
      return requestUrl;
    }

    return `${parsedUrl.pathname}${parsedUrl.search}${parsedUrl.hash}`;
  };

  const buildFetchInput = (input, requestUrl = "") => {
    if (!requestUrl || requestUrl === (typeof input === "string" ? input : input?.url || "")) return input;
    if (typeof input === "string" || input instanceof URL) return requestUrl;
    if (typeof Request !== "undefined" && input instanceof Request) {
      return new Request(requestUrl, input);
    }
    return input;
  };

  const readStoredAuthToken = () => {
    try {
      const session = JSON.parse(localStorage.getItem(AUTH_STORAGE_KEY) || "null") || {};
      return String(session?.token || "").trim();
    } catch {
      return "";
    }
  };

  const getRequestHeaders = (input, init = {}) => {
    const sourceHeaders =
      init?.headers ||
      (typeof Request !== "undefined" && input instanceof Request ? input.headers : undefined);
    return new Headers(sourceHeaders || {});
  };

  const hasAuthorizationHeader = (input, init = {}) => getRequestHeaders(input, init).has("Authorization");

  const shouldSkipAuthRetry = (requestUrl = "", init = {}) => {
    if (init?.skipAuthRefresh) return true;
    if (!requestUrl.includes("/api/")) return true;

    const excludedPaths = [
      "/api/auth/login",
      "/api/auth/refresh",
      "/api/auth/refresh-token",
      "/api/auth/token/refresh",
    ];

    return excludedPaths.some((path) => requestUrl.includes(path));
  };

  const shouldHandleProtectedAuth = (fetchInput, init = {}, requestUrl = "") => {
    if (shouldSkipAuthRetry(requestUrl, init)) return false;
    return hasAuthorizationHeader(fetchInput, init) || Boolean(readStoredAuthToken());
  };

  const buildAuthRetryInit = (fetchInput, init = {}, token = "") => {
    const headers = getRequestHeaders(fetchInput, init);

    if (token) {
      headers.set("Authorization", `Bearer ${token}`);
    } else {
      headers.delete("Authorization");
    }

    return { ...init, headers };
  };

  const getSessionCacheKey = () => {
    try {
      const session = JSON.parse(localStorage.getItem(AUTH_STORAGE_KEY) || "null") || {};
      return [
        session.userId,
        session.id,
        session.uuid,
        session.email,
        session.role,
      ]
        .map((value) => String(value || "").trim())
        .filter(Boolean)
        .join(":") || "anonymous";
    } catch {
      return "anonymous";
    }
  };

  const getApiCacheTtlMs = (requestUrl = "") => {
    const configuredTtl = Number(import.meta.env.VITE_API_GET_CACHE_TTL_MS || 0);
    if (Number.isFinite(configuredTtl) && configuredTtl > 0) return configuredTtl;

    if (requestUrl.includes("/api/files")) return 0;
    return 5 * 60_000;
  };

  const getApiCacheStaleMs = (requestUrl = "") => {
    const configuredStaleMs = Number(import.meta.env.VITE_API_GET_CACHE_STALE_MS || 0);
    if (Number.isFinite(configuredStaleMs) && configuredStaleMs > 0) return configuredStaleMs;
    if (requestUrl.includes("/api/files")) return 0;
    return 24 * 60 * 60_000;
  };

  const shouldSkipApiGetCache = (requestUrl = "", init = {}) => {
    if (init?.skipApiGetCache) return true;
    if (["no-store", "reload", "no-cache"].includes(String(init?.cache || "").toLowerCase())) return true;
    if (!requestUrl.includes("/api/")) return true;

    // FIX: Always skip caching for file endpoints
    if (requestUrl.includes("/api/files")) return true;

    const excludedPaths = [
      "/api/auth/",
      "/api/health",
      "/api/notifications",
      "/api/time",
    ];

    return excludedPaths.some((path) => requestUrl.includes(path));
  };

  const getApiCacheKey = (requestUrl = "") => {
    const parsedUrl = parseRequestUrl(requestUrl);
    const normalizedUrl = parsedUrl
      ? `${parsedUrl.origin}${parsedUrl.pathname}${parsedUrl.search}`
      : requestUrl;
    return `${getSessionCacheKey()}::${normalizedUrl}`;
  };

  const isCacheableContentType = (contentType = "") => {
    const normalizedType = String(contentType || "").toLowerCase();
    
    // FIX: Don't cache binary/stream responses
    if (
      normalizedType.includes("application/octet-stream") ||
      normalizedType.includes("application/pdf") ||
      normalizedType.includes("image/") ||
      normalizedType.includes("video/") ||
      normalizedType.includes("audio/")
    ) {
      return false;
    }
    
    return normalizedType.includes("application/json") || normalizedType.startsWith("text/");
  };

  const clearApiGetCache = () => {
    apiCacheVersion += 1;
    apiLastMutationAt = Date.now();
    inFlightGetRequests.clear();
    recentGetResponses.clear();
    try {
      sessionStorage.removeItem(API_CACHE_STORAGE_KEY);
    } catch {
      // Session cache is only a performance hint.
    }
  };

  const readStoredCache = () => {
    try {
      const parsed = JSON.parse(sessionStorage.getItem(API_CACHE_STORAGE_KEY) || "{}");
      return parsed && typeof parsed === "object" ? parsed : {};
    } catch {
      return {};
    }
  };

  const writeStoredCache = (cache) => {
    try {
      sessionStorage.setItem(API_CACHE_STORAGE_KEY, JSON.stringify(cache));
    } catch {
      // Storage can fail on quota/privacy settings; memory caching still works.
      try {
        sessionStorage.removeItem(API_CACHE_STORAGE_KEY);
      } catch {
        // Ignore cleanup failures.
      }
    }
  };

  const pruneMemoryCache = () => {
    if (recentGetResponses.size <= maxMemoryEntries) return;

    [...recentGetResponses.entries()]
      .sort((first, second) => first[1].timestamp - second[1].timestamp)
      .slice(0, recentGetResponses.size - maxMemoryEntries)
      .forEach(([cacheKey]) => recentGetResponses.delete(cacheKey));
  };

  const pruneStoredCache = (cache) => {
    const entries = Object.entries(cache).sort(
      (first, second) => Number(second[1]?.timestamp || 0) - Number(first[1]?.timestamp || 0)
    );

    return Object.fromEntries(entries.slice(0, maxStoredEntries));
  };

  const createStoredResponse = (entry) =>
    new Response(entry.body, {
      status: entry.status,
      statusText: entry.statusText,
      headers: entry.headers,
    });

  const getStoredResponse = (cacheKey, ttlMs, now) => {
    const cache = readStoredCache();
    const entry = cache[cacheKey];

    if (!entry) return null;

    const entryTimestamp = Number(entry.timestamp || 0);
    if (entryTimestamp < apiLastMutationAt || now - entryTimestamp > ttlMs) {
      delete cache[cacheKey];
      writeStoredCache(cache);
      return null;
    }

    return createStoredResponse(entry);
  };

  const getStaleStoredResponse = (cacheKey, staleMs, now) => {
    const cache = readStoredCache();
    const entry = cache[cacheKey];

    if (!entry) return null;
    const entryTimestamp = Number(entry.timestamp || 0);
    if (entryTimestamp < apiLastMutationAt || now - entryTimestamp > staleMs) {
      delete cache[cacheKey];
      writeStoredCache(cache);
      return null;
    }

    return createStoredResponse(entry);
  };

  const refreshCachedGetInBackground = (fetchInput, init, cacheKey, requestUrl, requestCacheVersion) => {
    if (inFlightGetRequests.has(cacheKey)) return;

    const refreshPromise = originalFetch(fetchInput, {
      ...init,
      cache: "no-store",
    });
    inFlightGetRequests.set(cacheKey, refreshPromise);

    refreshPromise
      .then((response) => {
        if (response.ok && requestCacheVersion === apiCacheVersion) {
          storeResponse(cacheKey, response, Date.now());
        }
      })
      .catch(() => {})
      .finally(() => {
        inFlightGetRequests.delete(cacheKey);
      });

    if (shouldLogGetRequests()) console.log("[GET API Background Refresh]", requestUrl);
  };

  const storeResponse = (cacheKey, response, timestamp) => {
    const contentType = response.headers.get("content-type") || "";
    if (!isCacheableContentType(contentType)) return;

    recentGetResponses.set(cacheKey, {
      response: response.clone(),
      timestamp,
    });
    pruneMemoryCache();

    const storedResponse = response.clone();
    Promise.resolve()
      .then(async () => {
        const body = await storedResponse.text();
        if (body.length > maxStoredBodyChars) return;

        const headers = {};
        const skippedHeaders = new Set([
          "connection",
          "content-encoding",
          "content-length",
          "transfer-encoding",
        ]);
        storedResponse.headers.forEach((value, key) => {
          if (skippedHeaders.has(key.toLowerCase())) return;
          headers[key] = value;
        });

        const cache = readStoredCache();
        cache[cacheKey] = {
          body,
          headers,
          status: storedResponse.status,
          statusText: storedResponse.statusText,
          timestamp,
        };
        writeStoredCache(pruneStoredCache(cache));
      })
      .catch(() => {
        // Cache writes should never affect the live request.
      });
  };

  window.addEventListener(API_MUTATION_EVENT_NAME, clearApiGetCache);

  const fetchWithAuthRetry = async (fetchInput, init = {}, requestUrl = "") => {
    if (!shouldHandleProtectedAuth(fetchInput, init, requestUrl)) {
      return originalFetch(fetchInput, init);
    }

    const token = await getAccessTokenForProtectedRequest();
    const requestInit = token ? buildAuthRetryInit(fetchInput, init, token) : init;
    let response = await originalFetch(fetchInput, requestInit);

    if (response.status !== 401) {
      return response;
    }

    const freshSession = await getFreshSessionOnce();
    const freshToken = freshSession?.access_token || "";

    if (!freshToken) {
      clearApiGetCache();
      handleProtectedAuthFailure();
      return response;
    }

    response = await originalFetch(fetchInput, buildAuthRetryInit(fetchInput, init, freshToken));

    if (response.status === 401) {
      clearApiGetCache();
      handleProtectedAuthFailure();
    }

    return response;
  };

  window.fetch = async (input, init = {}) => {
    const originalRequestUrl = typeof input === "string" || input instanceof URL ? String(input) : input?.url || "";
    const requestUrl = getSameOriginApiUrl(originalRequestUrl);
    const fetchInput = buildFetchInput(input, requestUrl);
    const requestMethod = String(
      init?.method || (typeof input !== "string" ? input?.method : "") || "GET"
    ).toUpperCase();
    const isApiGetRequest = requestMethod === "GET" && requestUrl.includes("/api/");
    const isApiMutationRequest =
      ["POST", "PATCH", "PUT", "DELETE"].includes(requestMethod) && requestUrl.includes("/api/");
    
    // FIX: Added check for file requests to skip all caching logic
    const isFileRequest = requestUrl.includes("/api/files");
    const shouldTrackGetRequest = !isFileRequest && isApiGetRequest && !shouldSkipApiGetCache(requestUrl, init);
    
    const now = Date.now();
    const requestCacheVersion = apiCacheVersion;
    const cacheTtlMs = getApiCacheTtlMs(requestUrl);
    const cacheStaleMs = getApiCacheStaleMs(requestUrl);
    const cacheKey = shouldTrackGetRequest ? getApiCacheKey(requestUrl) : "";

    if (isApiMutationRequest) {
      clearApiGetCache();
    }

    // FIX: Skip caching for file requests entirely
    if (shouldTrackGetRequest && !isFileRequest) {
      const cachedEntry = recentGetResponses.get(cacheKey);

      if (cachedEntry && now - cachedEntry.timestamp < cacheTtlMs) {
        if (shouldLogGetRequests()) console.log("[GET API Cache Hit]", requestUrl);
        return cachedEntry.response.clone();
      }

      const storedResponse = getStoredResponse(cacheKey, cacheTtlMs, now);
      if (storedResponse) {
        if (shouldLogGetRequests()) console.log("[GET API Session Cache Hit]", requestUrl);
        return storedResponse;
      }

      const staleResponse = getStaleStoredResponse(cacheKey, cacheStaleMs, now);
      if (staleResponse) {
        if (shouldLogGetRequests()) console.log("[GET API Stale Cache Hit]", requestUrl);
        refreshCachedGetInBackground(fetchInput, init, cacheKey, requestUrl, requestCacheVersion);
        return staleResponse;
      }

      const inFlightRequest = inFlightGetRequests.get(cacheKey);

      if (inFlightRequest) {
        if (shouldLogGetRequests()) console.log("[GET API Deduped]", requestUrl);
        const sharedResponse = await inFlightRequest;
        return sharedResponse.clone();
      }
    }

    if (shouldTrackGetRequest && shouldLogGetRequests()) {
      console.log("[GET API Request]", requestUrl);
    }

    // FIX: For file requests, skip the promise tracking to avoid caching issues
    if (isFileRequest) {
      if (shouldLogGetRequests()) console.log("[FILE Request - No Cache]", requestUrl);
      return fetchWithAuthRetry(fetchInput, init, requestUrl);
    }

    const responsePromise = fetchWithAuthRetry(fetchInput, init, requestUrl);

    if (shouldTrackGetRequest) {
      inFlightGetRequests.set(cacheKey, responsePromise);
    }

    let response;

    try {
      response = await responsePromise;
    } catch (error) {
      if (shouldTrackGetRequest) {
        inFlightGetRequests.delete(cacheKey);
      }

      throw error;
    }

    if (shouldTrackGetRequest) {
      inFlightGetRequests.delete(cacheKey);
      if (response.ok && requestCacheVersion === apiCacheVersion) {
        storeResponse(cacheKey, response, Date.now());
      }
    }

    if (isApiMutationRequest && response.ok) {
      clearApiGetCache();
    }

    if (shouldTrackGetRequest && shouldLogGetRequests()) {
      const clonedResponse = response.clone();

      Promise.resolve()
        .then(async () => {
          const contentType = clonedResponse.headers.get("content-type") || "";
          let payload;

          if (contentType.includes("application/json")) {
            payload = await clonedResponse.json();
          } else {
            payload = await clonedResponse.text();
          }

          console.log("[GET API Response]", {
            url: requestUrl,
            status: response.status,
            ok: response.ok,
            data: payload,
          });
        })
        .catch((error) => {
          console.log("[GET API Response Parse Error]", {
            url: requestUrl,
            status: response.status,
            error: error?.message || String(error),
          });
        });
    }

    return response;
  };

  const getAuthHeaders = () => {
    try {
      const session = JSON.parse(localStorage.getItem(AUTH_STORAGE_KEY) || "null") || {};
      return session?.token ? { Authorization: `Bearer ${session.token}` } : {};
    } catch {
      return {};
    }
  };

  const getSessionRole = () => {
    try {
      const session = JSON.parse(localStorage.getItem(AUTH_STORAGE_KEY) || "null") || {};
      return String(session?.role || session?.rawUser?.role || "").toLowerCase();
    } catch {
      return "";
    }
  };

  const prefetchApiEndpoints = (endpoints = []) => {
    const headers = getAuthHeaders();
    if (!headers.Authorization) return;

    endpoints.forEach((endpoint, index) => {
      window.setTimeout(() => {
        window.fetch(endpoint, {
          method: "GET",
          headers,
          skipApiToast: true,
        }).catch(() => {});
      }, index * 120);
    });
  };

  const getRolePrefetchEndpoints = (role = "") => {
    switch (String(role || "").toLowerCase()) {
      case "admin":
        return [
          "/api/dashboard/admin?arrivalsFilter=today",
          "/api/shipments/summary?page=1",
          "/api/shipments?status=submitted",
          "/api/shipments?status=pending_arrival",
          "/api/invoices",
          "/api/clients",
          "/api/products",
          "/api/users",
          "/api/settings",
          "/api/pricing",
          "/api/pricing/tiers",
        ];
      case "client":
        return [
          "/api/dashboard/client",
          "/api/shipments/summary?page=1",
          "/api/invoices",
          "/api/products",
        ];
      case "staff":
        return [
          "/api/dashboard/staff",
          "/api/shipments/summary?page=1",
          "/api/shipments?status=submitted",
          "/api/shipments?status=pending_arrival",
          "/api/time/entries",
        ];
      default:
        return [];
    }
  };

  window.__PICKPACKPRO_PREFETCH_ROLE_API__ = (role = getSessionRole()) => {
    const endpoints = getRolePrefetchEndpoints(role);
    if (!endpoints.length) return;
    const run = () => prefetchApiEndpoints(endpoints);

    if (typeof window.requestIdleCallback === "function") {
      window.requestIdleCallback(run, { timeout: 1200 });
      return;
    }

    window.setTimeout(run, 500);
  };

  window.__PICKPACKPRO_PREFETCH_ROLE_API__();
}

installApiActionToasts();

createRoot(document.getElementById("root")).render(
  <>
    <App />
    {/* <ToastContainer position="top-right" autoClose={3000} /> */}
  </>
);
