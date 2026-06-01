import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { lazy, Suspense, useEffect, useState } from "react";
import FullPageLoader from "./components/common/FullPageLoader";
import ToastHost from "./components/common/ToastHost";
import { clearSession, getAuthToken, getDashboardPath, getRefreshToken, getSession, saveSession } from "./utils/auth";

const CHUNK_RELOAD_STORAGE_KEY = "pickpackpro-chunk-reload-v1";

const isDynamicImportLoadError = (error) => {
  const message = String(error?.message || error || "").toLowerCase();
  return (
    message.includes("failed to fetch dynamically imported module") ||
    message.includes("expected a javascript-or-wasm module script") ||
    message.includes("strict mime type checking") ||
    message.includes("loading chunk") ||
    message.includes("chunkloaderror")
  );
};

const lazyWithChunkReload = (importer) =>
  lazy(() =>
    importer()
      .then((module) => {
        try {
          sessionStorage.removeItem(CHUNK_RELOAD_STORAGE_KEY);
        } catch {
          // Ignore storage failures.
        }
        return module;
      })
      .catch((error) => {
        if (typeof window !== "undefined" && isDynamicImportLoadError(error)) {
          try {
            if (!sessionStorage.getItem(CHUNK_RELOAD_STORAGE_KEY)) {
              sessionStorage.setItem(CHUNK_RELOAD_STORAGE_KEY, "1");
              window.location.reload();
              return new Promise(() => {});
            }
          } catch {
            window.location.reload();
            return new Promise(() => {});
          }
        }
        throw error;
      })
  );

const Dashboard = lazyWithChunkReload(() => import("./components/admin/Dashboard"));
const Receiving = lazyWithChunkReload(() => import("./components/admin/Receiving"));
const Shipments = lazyWithChunkReload(() => import("./components/admin/Shipments"));
const AwaitingFbaLabels = lazyWithChunkReload(() => import("./components/admin/AwaitingFbaLabels"));
const ShipmentDetail = lazyWithChunkReload(() => import("./components/admin/ShipmentDetail"));
const Dispatch = lazyWithChunkReload(() => import("./components/admin/Dispatch"));
const Clients = lazyWithChunkReload(() => import("./components/admin/Clients"));
const Billing = lazyWithChunkReload(() => import("./components/admin/Billing"));
const Products = lazyWithChunkReload(() => import("./components/admin/Products"));
const AuditLog = lazyWithChunkReload(() => import("./components/admin/AuditLog"));
const Settings = lazyWithChunkReload(() => import("./components/admin/Settings"));
const MyTasks = lazyWithChunkReload(() => import("./components/staff/MyTasks"));
const ShipmentsStaff = lazyWithChunkReload(() => import("./components/staff/ShipmentsStaff"));
const DispatchStaff = lazyWithChunkReload(() => import("./components/staff/DispatchStaff"));
const ReceivingStaff = lazyWithChunkReload(() => import("./components/staff/ReceivingStaff"));
const Login = lazyWithChunkReload(() => import("./pages/Login"));
const SetPassword = lazyWithChunkReload(() => import("./pages/SetPassword"));
const ClientDashboard = lazyWithChunkReload(() => import("./components/clientspannel/ClientDashboard"));
const ClientShipments = lazyWithChunkReload(() => import("./components/clientspannel/ClientShipments"));
const InvoicesClient = lazyWithChunkReload(() => import("./components/clientspannel/InvoicesClient"));
const ProductsClient = lazyWithChunkReload(() => import("./components/clientspannel/ProductsClient"));
const Account = lazyWithChunkReload(() => import("./components/clientspannel/Account"));

const API_BASE_URL = '';

const getSessionUserId = (session) =>
  session?.userId || session?.id || session?.uuid || session?.user_id || "";

const extractAuthUser = (payload) =>
  payload?.user ||
  payload?.data?.user ||
  payload?.data?.profile ||
  payload?.profile ||
  payload?.data ||
  payload ||
  {};

const isNetworkAuthError = (error) =>
  navigator.onLine === false ||
  error?.name === "TypeError" ||
  String(error?.message || "").toLowerCase().includes("failed to fetch") ||
  String(error?.message || "").toLowerCase().includes("network");

const isTemporaryBackendFailure = (status) => [502, 503, 504].includes(Number(status));

const decodeBase64Url = (value = "") => {
  try {
    const base64 = value.replace(/-/g, "+").replace(/_/g, "/");
    const padded = `${base64}${"=".repeat((4 - (base64.length % 4)) % 4)}`;
    return atob(padded);
  } catch {
    return "";
  }
};

const getJwtExpiryMs = (token = "") => {
  const parts = String(token || "").split(".");
  if (parts.length < 2) return 0;

  try {
    const payload = JSON.parse(decodeBase64Url(parts[1]) || "{}");
    return Number(payload?.exp || 0) * 1000;
  } catch {
    return 0;
  }
};

const isTokenExpired = (token = "") => {
  const expiryMs = getJwtExpiryMs(token);
  return expiryMs > 0 && expiryMs <= Date.now() + 30000;
};

const shouldClearSessionForAuthError = (error) =>
  Number(error?.status) === 401;

const REFRESH_SESSION_ENDPOINTS = String(import.meta.env.VITE_AUTH_REFRESH_ENDPOINTS || "/api/auth/refresh")
  .split(",")
  .map((endpoint) => endpoint.trim())
  .filter(Boolean);

const getInviteRedirectPath = () => {
  const hasToken =
    window.location.hash.includes('access_token') ||
    new URLSearchParams(window.location.search).has('token_hash');

  return hasToken ? `/set-password${window.location.search}${window.location.hash}` : '';
};

const readAuthPayload = async (response) => {
  const text = await response.text();
  if (!text) return null;

  try {
    return JSON.parse(text);
  } catch {
    return { message: text };
  }
};

const createAuthError = (response, payload) => {
  const error = new Error(
    payload?.error ||
      payload?.message ||
      payload?.details ||
      `Auth check failed with status ${response.status}`
  );
  error.status = response.status;
  return error;
};

const extractOptionalAuthUser = (payload) =>
  payload?.user ||
  payload?.data?.user ||
  payload?.data?.profile ||
  payload?.profile ||
  null;

const fetchAuthUser = async (token) => {
  const response = await fetch(`${API_BASE_URL}/api/auth/me`, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${token}`,
    },
    cache: "no-store",
  });
  const payload = await readAuthPayload(response);

  if (!response.ok) {
    throw createAuthError(response, payload);
  }

  return extractAuthUser(payload);
};

const refreshSessionToken = async (session) => {
  const refreshToken = getRefreshToken(session);

  if (!refreshToken || !REFRESH_SESSION_ENDPOINTS.length) {
    return null;
  }

  for (const endpoint of REFRESH_SESSION_ENDPOINTS) {
    try {
      const response = await fetch(`${API_BASE_URL}${endpoint}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(session?.token ? { Authorization: `Bearer ${session.token}` } : {}),
        },
        body: JSON.stringify({
          refreshToken,
          refresh_token: refreshToken,
        }),
        cache: "no-store",
        skipApiToast: true,
      });
      const payload = await readAuthPayload(response);

      if (response.status === 404 || response.status === 405) {
        continue;
      }

      if (!response.ok) {
        if (response.status === 401 || response.status === 403) {
          return null;
        }
        if (isTemporaryBackendFailure(response.status)) {
          return session;
        }
        continue;
      }

      const nextToken = getAuthToken(payload);
      if (!nextToken) {
        continue;
      }

      const user = extractOptionalAuthUser(payload);
      const userId = getSessionUserId(user) || getSessionUserId(session);
      const refreshedSession = {
        ...session,
        token: nextToken,
        refreshToken: getRefreshToken(payload) || refreshToken,
        role: String(user?.role || session.role || "").toLowerCase(),
        userId,
        id: userId || session.id,
        email: user?.email || session.email,
        name: user?.full_name || user?.fullName || user?.name || session.name,
        rawUser: user || session.rawUser,
      };

      saveSession(refreshedSession);
      return refreshedSession;
    } catch (error) {
      if (isNetworkAuthError(error)) {
        return session;
      }
    }
  }

  return null;
};

function VerifiedSessionRoute({ children, allowedRoles, roleComponents }) {
  const [state, setState] = useState(() => {
    const session = getSession();
    const token = session?.token || "";
    return { session, invalid: false, verifying: Boolean(token && isTokenExpired(token)) };
  });

  useEffect(() => {
    let isMounted = true;

    const verifySession = async () => {
      const session = getSession();
      let activeSession = session;
      let activeToken = session?.token || "";

      if (!activeSession || !activeToken) {
        if (isMounted) {
          setState({ session: null, invalid: true, verifying: false });
        }
        return;
      }

      try {
        if (isTokenExpired(activeToken)) {
          const refreshedSession = await refreshSessionToken(activeSession);
          if (!isMounted) return;

          if (!refreshedSession?.token) {
            clearSession();
            setState({ session: null, invalid: true, verifying: false });
            return;
          }

          activeSession = refreshedSession;
          activeToken = refreshedSession.token;
        }

        let user;
        try {
          user = await fetchAuthUser(activeToken);
        } catch (error) {
          if (Number(error?.status) !== 401) {
            throw error;
          }

          const refreshedSession = await refreshSessionToken(activeSession);
          if (!isMounted) return;

          if (!refreshedSession?.token || refreshedSession.token === activeToken) {
            throw error;
          }

          activeSession = refreshedSession;
          activeToken = refreshedSession.token;
          user = await fetchAuthUser(activeToken);
        }

        if (!isMounted) return;
        const verifiedRole = String(user?.role || activeSession.role || "").toLowerCase();
        const verifiedUserId = getSessionUserId(user) || getSessionUserId(activeSession);
        const verifiedSession = {
          ...activeSession,
          role: verifiedRole,
          userId: verifiedUserId,
          id: verifiedUserId,
          email: user?.email || activeSession.email,
          name: user?.full_name || user?.fullName || user?.name || activeSession.name,
          rawUser: user,
        };
        saveSession(verifiedSession);
        setState({ session: verifiedSession, invalid: false, verifying: false });
      } catch (error) {
        if (!isMounted) return;
        if (isNetworkAuthError(error) || !shouldClearSessionForAuthError(error)) {
          setState({ session: activeSession, invalid: false, verifying: false });
          return;
        }
        clearSession();
        setState({ session: null, invalid: true, verifying: false });
      }
    };

    verifySession();

    return () => {
      isMounted = false;
    };
  }, []);

  if (state.verifying) {
    return <FullPageLoader show delay={600} label="Checking session..." />;
  }

  if (state.invalid || !state.session) {
    return <Navigate to={getInviteRedirectPath() || "/login"} replace />;
  }

  if (allowedRoles && !allowedRoles.includes(state.session.role)) {
    return <Navigate to={getDashboardPath(state.session.role)} replace />;
  }

  if (roleComponents) {
    const component = roleComponents[state.session.role];
    return component || <Navigate to={getDashboardPath(state.session.role)} replace />;
  }

  return children;
}

function ProtectedRoute({ children, allowedRoles }) {
  const session = getSession();

  if (!session) {
    return <Navigate to={getInviteRedirectPath() || "/login"} replace />;
  }

  return <VerifiedSessionRoute allowedRoles={allowedRoles}>{children}</VerifiedSessionRoute>;
}

function PublicOnlyRoute({ children }) {
  const inviteRedirectPath = getInviteRedirectPath();
  const session = getSession();

  if (inviteRedirectPath) {
    return <Navigate to={inviteRedirectPath} replace />;
  }

  if (session) {
    return <Navigate to={getDashboardPath(session.role)} replace />;
  }

  return children;
}

function RoleBasedRoute({ roleComponents }) {
  const session = getSession();

  if (!session) {
    return <Navigate to={getInviteRedirectPath() || "/login"} replace />;
  }

  return <VerifiedSessionRoute roleComponents={roleComponents} />;
}

function DefaultRedirect() {
  return <Navigate to={getInviteRedirectPath() || getDashboardPath(getSession()?.role)} replace />;
}

function App() {
  return (
    <BrowserRouter>
      <ToastHost />
      <Suspense fallback={<FullPageLoader show delay={300} label="Loading page..." />}>
        <Routes>
          <Route
            path="/"
            element={<DefaultRedirect />}
          />
          <Route
            path="/dashboard"
            element={
              <RoleBasedRoute
                roleComponents={{
                  admin: <Dashboard />,
                  client: <ClientDashboard />,
                }}
              />
            }
          />
          <Route
            path="/receiving"
            element={
              <RoleBasedRoute
                roleComponents={{
                  admin: <Receiving />,
                  staff: <ReceivingStaff />,
                }}
              />
            }
          />
          <Route
            path="/shipments"
            element={
              <RoleBasedRoute
                roleComponents={{
                  admin: <Shipments />,
                  client: <ClientShipments />,
                  staff: <ShipmentsStaff />,
                }}
              />
            }
          />
          <Route
            path="/shipments/:id"
            element={
              <ProtectedRoute allowedRoles={["admin", "staff"]}>
                <ShipmentDetail />
              </ProtectedRoute>
            }
          />
          <Route
            path="/awaiting-fba-labels"
            element={
              <RoleBasedRoute
                roleComponents={{
                  admin: <AwaitingFbaLabels />,
                  client: <ClientShipments awaitingFbaOnly />,
                }}
              />
            }
          />
          <Route
            path="/dispatch"
            element={
              <RoleBasedRoute
                roleComponents={{
                  admin: <Dispatch />,
                  staff: <DispatchStaff />,
                }}
              />
            }
          />
          <Route
            path="/clients"
            element={
              <ProtectedRoute allowedRoles={["admin"]}>
                <Clients />
              </ProtectedRoute>
            }
          />
          <Route
            path="/billing"
            element={
              <ProtectedRoute allowedRoles={["admin"]}>
                <Billing />
              </ProtectedRoute>
            }
          />
          <Route
            path="/audit-log"
            element={
              <ProtectedRoute allowedRoles={["admin"]}>
                <AuditLog />
              </ProtectedRoute>
            }
          />
          <Route
            path="/settings"
            element={
              <ProtectedRoute allowedRoles={["admin"]}>
                <Settings />
              </ProtectedRoute>
            }
          />

          <Route
            path="/tasks"
            element={
              <ProtectedRoute allowedRoles={["staff"]}>
                <MyTasks />
              </ProtectedRoute>
            }
          />
          <Route
            path="/invoices"
            element={
              <ProtectedRoute allowedRoles={["client"]}>
                <InvoicesClient />
              </ProtectedRoute>
            }
          />
          <Route
            path="/products"
            element={
              <RoleBasedRoute
                roleComponents={{
                  admin: <Products />,
                  client: <ProductsClient />,
                }}
              />
            }
          />
          <Route
            path="/account"
            element={
              <ProtectedRoute allowedRoles={["client"]}>
                <Account />
              </ProtectedRoute>
            }
          />

          <Route
            path="/login"
            element={
              <PublicOnlyRoute>
                <Login />
              </PublicOnlyRoute>
            }
          />
          <Route path="/set-password" element={<SetPassword />} />
          <Route path="/auth/confirm" element={<SetPassword />} />
          <Route
            path="*"
            element={
              <DefaultRedirect />
            }
          />
        </Routes>
      </Suspense>
    </BrowserRouter>
  );
}

export default App;
