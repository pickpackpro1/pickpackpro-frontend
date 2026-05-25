import { useEffect, useMemo, useRef, useState } from "react";
import { Bell, Plus, Search, X, Crown, Menu } from "lucide-react";
import { useLocation, useNavigate } from "react-router-dom";
import {
  fetchNotifications,
  markAllNotificationsRead,
  markNotificationRead,
  resolveNotificationNavigation,
} from "../../utils/notifications";
import { getSession } from "../../utils/auth";
import { getClientIdFromSources, getClientTierFromSources } from "../../utils/clientTier";

const API_BASE_URL = import.meta.env.DEV
  ? ""
  : (import.meta.env.VITE_API_BASE_URL || 'https://ali-backend.vercel.app');

const pageTitles = {
  "/dashboard": "Dashboard",
  "/shipments": "Shipments",
  "/awaiting-fba-labels": "Awaiting FBA Labels",
  "/invoices": "Invoices",
  "/products": "Products",
  "/account": "Account",
};

const initialShipmentForm = {
  clientId: "",
  notes: "",
  expectedArrivalDate: "",
  itemsJson:
    '[\n  {\n    "sku": "WGT-001",\n    "productName": "Widget A",\n    "expectedQty": 100,\n    "bundleSize": 1,\n    "fnskuLabel": "X001234567",\n    "services": ["FNSKU_LABEL", "POLY_BAG"]\n  },\n  {\n    "sku": "WGT-002",\n    "productName": "Widget B",\n    "expectedQty": 50,\n    "bundleSize": 1,\n    "fnskuLabel": "X002345678",\n    "services": ["FNSKU_LABEL", "BUBBLE_WRAP", "BUNDLING"]\n  }\n]',
};

const buildHeaders = (includeJson = false) => {
  const session = getSession();
  const headers = {};

  if (session?.token) {
    headers["Authorization"] = `Bearer ${session.token}`;
  }

  if (includeJson) {
    headers["Content-Type"] = "application/json";
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
        (typeof payload === "string" ? payload : "") ||
        `Request failed with status ${response.status}`
    );
  }

  return payload;
};

const getTierBadgeClass = (tier) => {
  const normalizedTier = String(tier || "").toLowerCase();

  if (normalizedTier.includes("silver")) {
    return "bg-gradient-to-r from-slate-400 to-slate-500";
  }

  if (normalizedTier.includes("gold")) {
    return "bg-gradient-to-r from-amber-400 to-yellow-500";
  }

  if (normalizedTier.includes("platinum")) {
    return "bg-gradient-to-r from-amber-400 to-orange-500";
  }

  return "bg-gradient-to-r from-slate-500 to-slate-600";
};

const parseShipmentItems = (itemsJson) => {
  const parsedItems = JSON.parse(itemsJson);

  if (!Array.isArray(parsedItems) || !parsedItems.length) {
    throw new Error("Items must be a non-empty JSON array.");
  }

  return parsedItems;
};

const ClientHeader = ({ onMenuClick }) => {
  const location = useLocation();
  const navigate = useNavigate();
  const session = getSession();
  const title = pageTitles[location.pathname] || "Dashboard";
  const clientName = session?.name ?? "Client User";
  const [showNotifications, setShowNotifications] = useState(false);
  const [clientTier, setClientTier] = useState(() => getClientTierFromSources(session, session?.rawUser));
  const [shipmentForm, setShipmentForm] = useState(initialShipmentForm);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [banner, setBanner] = useState(null);
  const [notificationItems, setNotificationItems] = useState([]);
  const notificationRef = useRef(null);
  const hasLoadedNotificationsRef = useRef(false);
  const seenUnreadIdsRef = useRef(new Set());

  useEffect(() => {
    let isMounted = true;

    const loadClientTier = async () => {
      const sessionSnapshot = getSession();
      let authUser = null;
      let clientRecord = null;

      try {
        const authPayload = await fetch(`${API_BASE_URL}/api/auth/me`, {
          method: "GET",
          headers: buildHeaders(),
          cache: "no-store",
        }).then(parseResponse);

        authUser = authPayload?.user || authPayload?.data?.user || authPayload?.data || authPayload || null;
        const clientId = getClientIdFromSources(authUser, sessionSnapshot, sessionSnapshot?.rawUser);

        if (clientId) {
          const clientPayload = await fetch(`${API_BASE_URL}/api/clients/${clientId}`, {
            method: "GET",
            headers: buildHeaders(),
            cache: "no-store",
          }).then(parseResponse);

          clientRecord = clientPayload?.client || clientPayload?.data?.client || clientPayload?.data || clientPayload || null;
        }
      } catch {
        clientRecord = null;
      }

      if (!isMounted) {
        return;
      }

      setClientTier(getClientTierFromSources(clientRecord, authUser, sessionSnapshot, sessionSnapshot?.rawUser));
    };

    loadClientTier();

    return () => {
      isMounted = false;
    };
  }, []);

  useEffect(() => {
    const handleOutsideClick = (event) => {
      if (notificationRef.current && !notificationRef.current.contains(event.target)) {
        setShowNotifications(false);
      }
    };

    if (showNotifications) {
      document.addEventListener("mousedown", handleOutsideClick);
    }

    return () => {
      document.removeEventListener("mousedown", handleOutsideClick);
    };
  }, [showNotifications]);

  useEffect(() => {
    if (!banner) {
      return undefined;
    }

    const timer = window.setTimeout(() => {
      setBanner(null);
    }, 3500);

    return () => window.clearTimeout(timer);
  }, [banner]);

  useEffect(() => {
    let isMounted = true;

    const loadNotifications = async (showErrorToast = false) => {
      try {
        const items = await fetchNotifications();

        if (!isMounted) {
          return;
        }

        setNotificationItems(items);

        const unreadIds = new Set(items.filter((item) => item.unread).map((item) => String(item.id)));

        if (!hasLoadedNotificationsRef.current) {
          seenUnreadIdsRef.current = unreadIds;
          hasLoadedNotificationsRef.current = true;
          return;
        }

        const newUnreadCount = [...unreadIds].filter((id) => !seenUnreadIdsRef.current.has(id)).length;
        seenUnreadIdsRef.current = unreadIds;

      } catch (error) {
        if (isMounted && showErrorToast) {
          setBanner({
            type: "error",
            message: error.message || "Failed to load notifications.",
          });
        }
      }
    };

    loadNotifications();
    const intervalId = window.setInterval(() => {
      loadNotifications();
    }, 30000);

    return () => {
      isMounted = false;
      window.clearInterval(intervalId);
    };
  }, []);

  const unreadCount = useMemo(
    () => notificationItems.filter((item) => item.unread).length,
    [notificationItems]
  );
  const visibleNotificationItems = useMemo(
    () => notificationItems.filter((item) => item.unread),
    [notificationItems]
  );
  const tierBadgeLabel = clientTier ? `${clientTier} tier` : "Tier unavailable";

  const handleNotificationClick = async (notification) => {
    const target = resolveNotificationNavigation(notification, "client");
    setShowNotifications(false);

    if (notification?.unread) {
      setNotificationItems((current) =>
        current.map((item) => (String(item.id) === String(notification.id) ? { ...item, unread: false } : item))
      );
    }

    if (target?.pathname) {
      navigate(target.pathname, target.state ? { state: target.state } : undefined);
    }

    if (!notification?.unread) {
      return;
    }

    try {
      await markNotificationRead(notification.id);
    } catch (error) {
      setNotificationItems((current) =>
        current.map((item) => (String(item.id) === String(notification.id) ? { ...item, unread: true } : item))
      );
      setBanner({
        type: "error",
        message: error.message || "Failed to mark notification as read.",
      });
    }
  };

  const handleMarkAllRead = async () => {
    const previousItems = notificationItems;
    const previousSeenUnreadIds = seenUnreadIdsRef.current;

    seenUnreadIdsRef.current = new Set();
    setNotificationItems([]);

    try {
      await markAllNotificationsRead(previousItems.map((item) => item.id));
    } catch (error) {
      setNotificationItems(previousItems);
      seenUnreadIdsRef.current = previousSeenUnreadIds;
      setBanner({
        type: "error",
        message: error.message || "Failed to mark all notifications as read.",
      });
    }
  };

  const handleSubmitShipment = async () => {
    try {
      setIsSubmitting(true);
      setBanner(null);

      if (!shipmentForm.clientId.trim()) {
        throw new Error("Client UUID is required.");
      }

      if (!shipmentForm.expectedArrivalDate) {
        throw new Error("Expected arrival date is required.");
      }

      const items = parseShipmentItems(shipmentForm.itemsJson);
      const response = await fetch(`${API_BASE_URL}/api/shipments`, {
        method: "POST",
        headers: buildHeaders(true),
        body: JSON.stringify({
          clientId: shipmentForm.clientId.trim(),
          notes: shipmentForm.notes.trim(),
          expectedArrivalDate: shipmentForm.expectedArrivalDate,
          items,
        }),
      });

      await parseResponse(response);
      setBanner({
        type: "success",
        message: "Shipment submitted successfully.",
      });
      setShowSubmitShipment(false);
      setShipmentForm(initialShipmentForm);
    } catch (error) {
      setBanner({
        type: "error",
        message: error.message || "Failed to submit shipment.",
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <>
      <header className="flex h-16 w-full items-center justify-between border-b border-gray-200 bg-white px-4 sm:px-6">
        <div className="flex min-w-0 items-center gap-3">
          <button
            type="button"
            onClick={onMenuClick}
            className="inline-flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-lg border border-gray-200 text-gray-700 hover:bg-gray-50 lg:hidden"
            aria-label="Open sidebar menu"
          >
            <Menu size={20} />
          </button>
          <h1 className="truncate text-xl font-semibold text-gray-900">{title}</h1>
        </div>

        <div className="flex min-w-0 items-center gap-2 sm:gap-3" ref={notificationRef}>
          <div className="relative hidden md:block">
            <Search
              size={16}
              className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400"
            />
            <input
              type="text"
              placeholder={`Search ${title.toLowerCase()}...`}
              className="w-64 rounded-lg border border-gray-200 bg-gray-50 py-2 pl-9 pr-4 text-sm focus:border-transparent focus:outline-none focus:ring-2 focus:ring-[#ff6900]"
            />
          </div>

          <div className={`hidden items-center gap-1.5 rounded-full px-3 py-1.5 sm:flex ${getTierBadgeClass(clientTier)}`}>
            <Crown size={14} className="text-white" />
            <span className="text-xs font-semibold text-white">{tierBadgeLabel}</span>
          </div>

          <button
            type="button"
            onClick={() => navigate('/shipments?mode=create')}
            className="flex items-center gap-2 rounded-lg bg-[#ff6900] px-3 py-2 text-sm font-medium text-white transition-colors hover:bg-[#e55d00] sm:px-4"
          >
            <Plus size={16} />
            <span className="hidden sm:inline">Create Shipment</span>
          </button>

          <button
            type="button"
            onClick={() => setShowNotifications((current) => !current)}
            className="relative rounded-lg p-2 text-gray-600 transition-colors hover:bg-gray-100"
          >
            <Bell size={18} />
            {unreadCount ? (
              <span className="absolute right-1.5 top-1.5 h-2 w-2 rounded-full bg-red-500" />
            ) : null}
          </button>

          {showNotifications ? (
            <div className="absolute right-6 top-[72px] z-50 w-[min(380px,calc(100vw-32px))] overflow-hidden rounded border border-[#d8dee8] bg-white shadow-[0_18px_44px_rgba(15,23,42,0.18)]">
              <div className="flex items-center justify-between border-b border-[#d8dee8] bg-white px-4 py-3">
                <h3 className="text-base font-semibold text-[#132347]">Notifications</h3>
                <div className="flex items-center gap-3">
                  <button
                    type="button"
                    onClick={handleMarkAllRead}
                    className="border border-[#9b8f84] bg-white px-3 py-2 text-xs font-semibold text-[#374151] transition-colors hover:bg-slate-50"
                  >
                    Mark all read
                  </button>
                  <button
                    type="button"
                    onClick={() => setShowNotifications(false)}
                    className="p-1 text-[#64748b] transition-colors hover:bg-slate-100 hover:text-gray-900"
                  >
                    <X size={18} />
                  </button>
                </div>
              </div>

              <div className="max-h-[380px] overflow-y-auto bg-white">
                {visibleNotificationItems.length ? (
                  visibleNotificationItems.map((item) => (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => handleNotificationClick(item)}
                      className="block w-full border-b border-[#dfe5ee] px-4 py-4 text-left transition-colors hover:bg-[#fafcff] last:border-b-0"
                    >
                      <div className="flex items-start gap-3">
                        <span
                          className={`mt-2 h-2.5 w-2.5 shrink-0 rounded-full ${
                            item.unread ? "bg-orange-400" : "border border-slate-400 bg-white"
                          }`}
                        />
                        <div className="min-w-0">
                          <p
                            className={`text-sm leading-6 ${
                            item.alert ? "font-semibold text-[#dc2626]" : "text-[#334155]"
                          }`}
                          >
                            {item.text}
                          </p>
                          {(item.actor || item.reference || item.subject) ? (
                            <p className="mt-1 text-xs font-medium uppercase tracking-wider text-[#94a3b8]">
                              {[item.actor, item.reference, item.subject].filter(Boolean).join(" - ")}
                            </p>
                          ) : null}
                        </div>
                      </div>
                    </button>
                  ))
                ) : (
                  <div className="px-4 py-6 text-center text-xs text-[#64748b]">
                    No notifications right now.
                  </div>
                )}
              </div>

              <div className="border-t border-[#edf1f6] bg-[#fbfcfe] px-4 py-2 text-[10px] font-medium uppercase tracking-[0.14em] text-[#94a3b8]">
                {unreadCount} unread notifications
              </div>
            </div>
          ) : null}
        </div>
      </header>

      {banner ? (
        <div className="fixed right-6 top-20 z-[60]">
          <div
            className={`rounded-xl border px-4 py-3 text-sm shadow-lg ${
              banner.type === "success"
                ? "border-green-200 bg-green-50 text-green-700"
                : "border-red-200 bg-red-50 text-red-700"
            }`}
          >
            {banner.message}
          </div>
        </div>
      ) : null}

    </>
  );
};

export default ClientHeader;
