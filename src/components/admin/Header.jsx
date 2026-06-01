import { useEffect, useMemo, useRef, useState } from "react";
import { Bell, Menu, Plus, Search, X } from "lucide-react";
import { useLocation, useNavigate } from "react-router-dom";
import {
  fetchNotifications,
  markAllNotificationsRead,
  markNotificationRead,
  resolveNotificationNavigation,
} from "../../utils/notifications";
import { getSession } from "../../utils/auth";

const API_BASE_URL = '';

const pageTitles = {
  "/": "Dashboard",
  "/dashboard": "Dashboard",
  "/shipments": "Shipments",
  "/awaiting-fba-labels": "Awaiting FBA Labels",
  "/receiving": "Receiving",
  "/dispatch": "Dispatch",
  "/clients": "Clients",
  "/billing": "Billing",
  "/products": "Products",
  "/audit-log": "Audit Log",
  "/settings": "Settings",
};


const initialShipmentForm = {
  clientId: "",
  notes: "",
  expectedArrivalDate: "",
  itemsJson:
    '[\n  {\n    "sku": "WGT-001",\n    "productName": "Widget A",\n    "expectedQty": 100,\n    "bundleSize": 1,\n    "fnskuLabel": "X001234567",\n    "services": ["FNSKU_LABEL", "POLY_BAG"]\n  },\n  {\n    "sku": "WGT-002",\n    "productName": "Widget B",\n    "expectedQty": 50,\n    "bundleSize": 1,\n    "fnskuLabel": "X002345678",\n    "services": ["FNSKU_LABEL", "BUBBLE_WRAP", "BUNDLING"]\n  }\n]',
};

const initialClientForm = {
  companyName: "ACME Ltd",
  contactName: "Lucy Palmer",
  email: "ACME Ltd",
  phone: "+123456789",
  password: "ACME Ltd",
  billingAddress: "Full street address, city, and postal code",
  vatRegistered: "NO",
  vatNo: "1213",
  pricingTier: "Auto Calculate",
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

const parseShipmentItems = (itemsJson) => {
  const parsedItems = JSON.parse(itemsJson);

  if (!Array.isArray(parsedItems) || !parsedItems.length) {
    throw new Error("Items must be a non-empty JSON array.");
  }

  return parsedItems;
};

const Header = ({ onMenuClick }) => {
  const location = useLocation();
  const navigate = useNavigate();
  const title = pageTitles[location.pathname] || "Dashboard";
  const isClientPage = location.pathname === "/clients";
  const actionLabel = isClientPage ? "Add Client" : "New Shipment";
  const [showNotifications, setShowNotifications] = useState(false);
  const [showActionModal, setShowActionModal] = useState(false);
  const [shipmentForm, setShipmentForm] = useState(initialShipmentForm);
  const [clientForm, setClientForm] = useState(initialClientForm);
  const [isSubmittingShipment, setIsSubmittingShipment] = useState(false);
  const [banner, setBanner] = useState(null);
  const [notificationItems, setNotificationItems] = useState([]);
  const notificationRef = useRef(null);
  const hasLoadedNotificationsRef = useRef(false);
  const seenUnreadIdsRef = useRef(new Set());

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
    setShowActionModal(false);
  }, [location.pathname]);

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
    }, 120000);

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

  const handleNotificationClick = async (notification) => {
    const target = resolveNotificationNavigation(notification, "admin");
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

  const handleCreateShipment = async () => {
    try {
      setIsSubmittingShipment(true);
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
        message: "Shipment created successfully.",
      });
      setShowActionModal(false);
      setShipmentForm(initialShipmentForm);
    } catch (error) {
      setBanner({
        type: "error",
        message: error.message || "Failed to create shipment.",
      });
    } finally {
      setIsSubmittingShipment(false);
    }
  };

  const handleActionClick = () => {
    if (isClientPage) {
      window.dispatchEvent(new CustomEvent('open-client-create'));
      return;
    }
    navigate('/shipments');
    window.setTimeout(() => {
      window.dispatchEvent(new CustomEvent('open-shipment-create'));
    }, 0);
  };

  return (
    <>
      <header className="flex h-16 w-full items-center justify-between border-b border-gray-200 bg-white px-6">
        <div className="flex min-w-0 items-center gap-3">
          <button
            type="button"
            onClick={onMenuClick}
            className="inline-flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-lg border border-gray-200 text-gray-700 hover:bg-gray-50 lg:hidden"
            aria-label="Open sidebar menu"
          >
            <Menu size={20} />
          </button>
          <h1 className="text-xl font-semibold text-gray-900">{title}</h1>
        </div>

        <div className="flex items-center gap-3" ref={notificationRef}>
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

          <button
            type="button"
            onClick={handleActionClick}
            className="flex items-center gap-2 rounded-lg bg-[#ff6900] px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-[#e55d00]"
          >
            <Plus size={16} />
            {actionLabel}
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

      {showActionModal ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4 backdrop-blur-sm">
          <div className="w-full max-w-2xl rounded-3xl bg-white p-5 shadow-[0_24px_80px_rgba(15,23,42,0.22)]">
            <div className="mb-5 flex items-center justify-between">
              <h3 className="text-2xl font-semibold text-[#132347]">
                {isClientPage ? "Add New Client" : "Create Shipment"}
              </h3>
              <button
                type="button"
                onClick={() => setShowActionModal(false)}
                className="rounded-full p-2 text-gray-500 transition-colors hover:bg-gray-100"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {isClientPage ? (
              <form className="space-y-4">
                <div className="grid grid-cols-2 gap-3">
                  <label className="block text-[11px] font-semibold uppercase tracking-[0.12em] text-gray-400">
                    Company Name*
                    <input
                      type="text"
                      value={clientForm.companyName}
                      onChange={(event) =>
                        setClientForm((current) => ({
                          ...current,
                          companyName: event.target.value,
                        }))
                      }
                      className="mt-2 w-full rounded-md border border-gray-200 px-3 py-2 text-sm font-normal uppercase tracking-normal text-[#132347] focus:border-transparent focus:outline-none focus:ring-2 focus:ring-[#ff6900]"
                    />
                  </label>
                  <label className="block text-[11px] font-semibold uppercase tracking-[0.12em] text-gray-400">
                    Contact Name*
                    <input
                      type="text"
                      value={clientForm.contactName}
                      onChange={(event) =>
                        setClientForm((current) => ({
                          ...current,
                          contactName: event.target.value,
                        }))
                      }
                      className="mt-2 w-full rounded-md border border-gray-200 px-3 py-2 text-sm font-normal text-[#132347] focus:border-transparent focus:outline-none focus:ring-2 focus:ring-[#ff6900]"
                    />
                  </label>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <label className="block text-[11px] font-semibold uppercase tracking-[0.12em] text-gray-400">
                    Email*
                    <input
                      type="text"
                      value={clientForm.email}
                      onChange={(event) =>
                        setClientForm((current) => ({
                          ...current,
                          email: event.target.value,
                        }))
                      }
                      className="mt-2 w-full rounded-md border border-gray-200 px-3 py-2 text-sm text-[#132347] focus:border-transparent focus:outline-none focus:ring-2 focus:ring-[#ff6900]"
                    />
                  </label>
                  <label className="block text-[11px] font-semibold uppercase tracking-[0.12em] text-gray-400">
                    Phone
                    <input
                      type="text"
                      value={clientForm.phone}
                      onChange={(event) =>
                        setClientForm((current) => ({
                          ...current,
                          phone: event.target.value,
                        }))
                      }
                      className="mt-2 w-full rounded-md border border-gray-200 px-3 py-2 text-sm text-[#132347] focus:border-transparent focus:outline-none focus:ring-2 focus:ring-[#ff6900]"
                    />
                  </label>
                </div>

                <label className="block text-[11px] font-semibold uppercase tracking-[0.12em] text-gray-400">
                  Password*
                  <input
                    type="text"
                    value={clientForm.password}
                    onChange={(event) =>
                      setClientForm((current) => ({
                        ...current,
                        password: event.target.value,
                      }))
                    }
                    className="mt-2 w-full rounded-md border border-gray-200 px-3 py-2 text-sm text-[#132347] focus:border-transparent focus:outline-none focus:ring-2 focus:ring-[#ff6900]"
                  />
                </label>

                <label className="block text-[11px] font-semibold uppercase tracking-[0.12em] text-gray-400">
                  Billing Address
                  <textarea
                    value={clientForm.billingAddress}
                    onChange={(event) =>
                      setClientForm((current) => ({
                        ...current,
                        billingAddress: event.target.value,
                      }))
                    }
                    className="mt-2 min-h-24 w-full rounded-md border border-gray-200 px-3 py-2 text-sm text-[#132347] focus:border-transparent focus:outline-none focus:ring-2 focus:ring-[#ff6900]"
                  />
                </label>

                <div className="grid grid-cols-[1fr_1fr_1.2fr] gap-3">
                  <label className="block text-[11px] font-semibold uppercase tracking-[0.12em] text-gray-400">
                    VAT Registered
                    <select
                      value={clientForm.vatRegistered}
                      onChange={(event) =>
                        setClientForm((current) => ({
                          ...current,
                          vatRegistered: event.target.value,
                        }))
                      }
                      className="mt-2 w-full rounded-md border border-gray-200 px-3 py-2 text-sm font-normal text-[#132347] focus:border-transparent focus:outline-none focus:ring-2 focus:ring-[#ff6900]"
                    >
                      <option>NO</option>
                      <option>YES</option>
                    </select>
                  </label>
                  <label className="block text-[11px] font-semibold uppercase tracking-[0.12em] text-gray-400">
                    VAT No
                    <input
                      type="text"
                      value={clientForm.vatNo}
                      onChange={(event) =>
                        setClientForm((current) => ({
                          ...current,
                          vatNo: event.target.value,
                        }))
                      }
                      className="mt-2 w-full rounded-md border border-gray-200 px-3 py-2 text-sm text-[#132347] focus:border-transparent focus:outline-none focus:ring-2 focus:ring-[#ff6900]"
                    />
                  </label>
                  <label className="block text-[11px] font-semibold uppercase tracking-[0.12em] text-gray-400">
                    Pricing Tier
                    <select
                      value={clientForm.pricingTier}
                      onChange={(event) =>
                        setClientForm((current) => ({
                          ...current,
                          pricingTier: event.target.value,
                        }))
                      }
                      className="mt-2 w-full rounded-md border border-gray-200 px-3 py-2 text-sm font-normal text-[#132347] focus:border-transparent focus:outline-none focus:ring-2 focus:ring-[#ff6900]"
                    >
                      <option>Auto Calculate</option>
                      <option>Silver</option>
                      <option>Gold</option>
                      <option>Platinum</option>
                      <option>Custom</option>
                    </select>
                  </label>
                </div>

                <div className="flex justify-end gap-3 pt-2">
                  <button
                    type="button"
                    onClick={() => setShowActionModal(false)}
                    className="rounded-md border border-gray-300 bg-white px-4 py-2 text-sm text-gray-700 transition-colors hover:bg-gray-50"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    className="rounded-md bg-[#ff6900] px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-[#e55d00]"
                  >
                    Send Invite
                  </button>
                </div>
              </form>
            ) : (
              <form className="space-y-4">
                <label className="block text-[11px] font-semibold uppercase tracking-[0.12em] text-gray-400">
                  Client UUID
                  <input
                    type="text"
                    value={shipmentForm.clientId}
                    onChange={(event) =>
                      setShipmentForm((current) => ({
                        ...current,
                        clientId: event.target.value,
                      }))
                    }
                    className="mt-2 w-full rounded-md border border-gray-200 px-3 py-2 text-sm text-[#132347] focus:border-transparent focus:outline-none focus:ring-2 focus:ring-[#ff6900]"
                  />
                </label>

                <label className="block text-[11px] font-semibold uppercase tracking-[0.12em] text-gray-400">
                  Expected Arrival Date
                  <input
                    type="date"
                    value={shipmentForm.expectedArrivalDate}
                    onChange={(event) =>
                      setShipmentForm((current) => ({
                        ...current,
                        expectedArrivalDate: event.target.value,
                      }))
                    }
                    className="mt-2 w-full rounded-md border border-gray-200 px-3 py-2 text-sm text-[#132347] focus:border-transparent focus:outline-none focus:ring-2 focus:ring-[#ff6900]"
                  />
                </label>

                <label className="block text-[11px] font-semibold uppercase tracking-[0.12em] text-gray-400">
                  Notes
                  <textarea
                    value={shipmentForm.notes}
                    onChange={(event) =>
                      setShipmentForm((current) => ({
                        ...current,
                        notes: event.target.value,
                      }))
                    }
                    className="mt-2 min-h-20 w-full rounded-md border border-gray-200 px-3 py-2 text-sm text-[#132347] focus:border-transparent focus:outline-none focus:ring-2 focus:ring-[#ff6900]"
                  />
                </label>

              

                <div className="flex justify-end gap-3 pt-2">
                  <button
                    type="button"
                    onClick={() => setShowActionModal(false)}
                    className="rounded-md border border-gray-300 bg-white px-4 py-2 text-sm text-gray-700 transition-colors hover:bg-gray-50"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={handleCreateShipment}
                    disabled={isSubmittingShipment}
                    className="rounded-md bg-[#ff6900] px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-[#e55d00]"
                  >
                    {isSubmittingShipment ? "Creating..." : "Create Shipment"}
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>
      ) : null}
    </>
  );
};

export default Header;
