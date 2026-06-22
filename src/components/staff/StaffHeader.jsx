import { useEffect, useRef, useState } from "react";
import { Bell, Clock, Menu, X } from "lucide-react";
import { useLocation, useNavigate } from "react-router-dom";
import {
  fetchNotifications,
  markAllNotificationsRead,
  markNotificationRead,
  resolveNotificationNavigation,
} from "../../utils/notifications";
import { getSession } from "../../utils/auth";

const API_BASE_URL = "";

const buildHeaders = () => {
  const session = getSession();
  return session?.token ? { Authorization: `Bearer ${session.token}` } : {};
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

const firstPresent = (...values) => {
  const value = values.find((currentValue) => {
    if (currentValue === 0 || currentValue === false) return true;
    return currentValue !== undefined && currentValue !== null && String(currentValue).trim() !== "";
  });

  return value === undefined || value === null ? "" : value;
};

const getTimeStatusData = (payload) => payload?.data || payload || {};

const getActiveEntry = (payload) => {
  const data = getTimeStatusData(payload);
  return data?.activeEntry || data?.active_entry || null;
};

const getIsCheckedIn = (payload) => {
  const data = getTimeStatusData(payload);
  const value = firstPresent(data?.isCheckedIn, data?.is_checked_in, payload?.isCheckedIn, payload?.is_checked_in, "");
  return value === true || String(value).toLowerCase() === "true";
};

const getEntryStartedAt = (entry = {}) =>
  firstPresent(
    entry?.checkInAt,
    entry?.check_in_at,
    entry?.checkedInAt,
    entry?.checked_in_at,
    entry?.clockInAt,
    entry?.clock_in_at,
    entry?.startedAt,
    entry?.started_at
  );

const getDurationMinutes = (entry = {}, now = new Date()) => {
  const explicitMinutes = Number(firstPresent(entry?.durationMinutes, entry?.duration_minutes, ""));
  const startedAt = new Date(getEntryStartedAt(entry));

  if (!Number.isNaN(startedAt.getTime())) {
    return Math.max(0, Math.round((now.getTime() - startedAt.getTime()) / 60000));
  }

  return Number.isFinite(explicitMinutes) ? Math.max(0, Math.round(explicitMinutes)) : 0;
};

const formatDurationMinutes = (minutes = 0) => {
  const safeMinutes = Math.max(0, Math.round(Number(minutes) || 0));
  const hours = Math.floor(safeMinutes / 60);
  const remainingMinutes = safeMinutes % 60;
  return hours ? `${hours}h ${remainingMinutes}m` : `${remainingMinutes}m`;
};

const pageTitles = {
  "/tasks": "My Tasks",
  "/shipments": "All Shipments",
  "/receiving": "Receiving",
  "/dispatch": "Dispatch",
};

const StaffHeader = ({ onMenuClick }) => {
  const location = useLocation();
  const navigate = useNavigate();
  const title = pageTitles[location.pathname] || "Staff Dashboard";
  const [currentTime, setCurrentTime] = useState(new Date());
  const [showNotifications, setShowNotifications] = useState(false);
  const [notificationItems, setNotificationItems] = useState([]);
  const [isCheckedIn, setIsCheckedIn] = useState(false);
  const [activeEntry, setActiveEntry] = useState(null);
  const [hasLoadedAttendance, setHasLoadedAttendance] = useState(false);
  const notificationRef = useRef(null);
  const hasLoadedNotificationsRef = useRef(false);
  const seenUnreadIdsRef = useRef(new Set());

  useEffect(() => {
    const interval = setInterval(() => {
      setCurrentTime(new Date());
    }, 1000);

    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    let isMounted = true;

    const loadAttendanceStatus = async () => {
      try {
        const payload = await parseResponse(
          await fetch(`${API_BASE_URL}/api/time/status`, {
            method: "GET",
            headers: buildHeaders(),
          })
        );

        if (!isMounted) return;

        setIsCheckedIn(getIsCheckedIn(payload));
        setActiveEntry(getActiveEntry(payload));
        setHasLoadedAttendance(true);
      } catch {
        if (isMounted) {
          setHasLoadedAttendance(true);
        }
      }
    };

    const handleAttendanceUpdated = (event) => {
      const detail = event?.detail || {};
      setIsCheckedIn(Boolean(detail.isCheckedIn));
      setActiveEntry(detail.activeEntry || null);
      setHasLoadedAttendance(true);
      loadAttendanceStatus();
    };

    loadAttendanceStatus();
    window.addEventListener("pickpackpro-attendance-updated", handleAttendanceUpdated);

    return () => {
      isMounted = false;
      window.removeEventListener("pickpackpro-attendance-updated", handleAttendanceUpdated);
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
    let isMounted = true;

    const loadNotifications = async () => {
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

      } catch {
        // Ignore polling errors in the staff header.
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

  const formatTime = (value) =>
    value.toLocaleTimeString("en-GB", {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
    });

  const unreadCount = notificationItems.filter((item) => item.unread).length;
  const visibleNotificationItems = notificationItems.filter((item) => item.unread);
  const activeDurationLabel = activeEntry ? formatDurationMinutes(getDurationMinutes(activeEntry, currentTime)) : "";
  const attendanceLabel = !hasLoadedAttendance
    ? "Checking..."
    : isCheckedIn
      ? `Clocked In${activeDurationLabel ? ` - ${activeDurationLabel}` : ""}`
      : "Clocked Out";

  const handleNotificationClick = async (notification) => {
    const target = resolveNotificationNavigation(notification, "staff");
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
    } catch {
      setNotificationItems((current) =>
        current.map((item) => (String(item.id) === String(notification.id) ? { ...item, unread: true } : item))
      );
    }
  };

  const handleMarkAllRead = async () => {
    const previousItems = notificationItems;
    const previousSeenUnreadIds = seenUnreadIdsRef.current;

    seenUnreadIdsRef.current = new Set();
    setNotificationItems([]);

    try {
      await markAllNotificationsRead(previousItems.map((item) => item.id));
    } catch {
      setNotificationItems(previousItems);
      seenUnreadIdsRef.current = previousSeenUnreadIds;
    }
  };

  return (
    <header className="relative flex h-16 w-full items-center justify-between border-b border-gray-200 bg-white px-4 sm:px-6">
      <div className="flex min-w-0 items-center gap-3">
        <button
          type="button"
          onClick={onMenuClick}
          className="inline-flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-lg border border-gray-200 text-gray-700 hover:bg-gray-50 lg:hidden"
          aria-label="Open sidebar menu"
        >
          <Menu size={20} />
        </button>
        <h1 className="truncate text-xl font-semibold leading-none text-gray-900 sm:text-[28px]">{title}</h1>
      </div>

      <div className="flex min-w-0 items-center gap-2 sm:gap-4" ref={notificationRef}>
        <div className="hidden items-center gap-2 rounded-lg border border-orange-200 bg-orange-50 px-3 py-1.5 sm:flex">
          <Clock size={13} className="text-[#ff6900]" />
          <span className="text-[11px] font-medium uppercase tracking-wide text-[#ff6900]">
            Shift: {isCheckedIn && activeDurationLabel ? activeDurationLabel : formatTime(currentTime)}
          </span>
        </div>

        <button
          type="button"
          onClick={() => setShowNotifications((current) => !current)}
          className="relative rounded-full p-1.5 text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-700"
          aria-label="Notifications"
        >
          <Bell size={16} />
          {unreadCount ? (
            <span className="absolute right-1 top-1 h-2 w-2 rounded-full bg-[#ff6900]" />
          ) : null}
        </button>

        <button
          type="button"
          className={`hidden rounded-lg px-4 py-2 text-xs font-semibold shadow-sm transition-colors sm:inline-flex ${
            isCheckedIn
              ? "bg-[#ff6900] text-white"
              : "border border-gray-200 bg-white text-gray-600"
          }`}
        >
          {attendanceLabel}
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

            {unreadCount ? (
              <div className="border-t border-[#edf1f6] bg-[#fbfcfe] px-4 py-2 text-[10px] font-medium uppercase tracking-[0.14em] text-[#94a3b8]">
                {unreadCount} unread notifications
              </div>
            ) : null}
          </div>
        ) : null}
      </div>
    </header>
  );
};

export default StaffHeader;
