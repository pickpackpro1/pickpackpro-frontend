export const AUTH_STORAGE_KEY = "pickpackpro-auth";
const LARGE_LOCAL_CACHE_KEY_PREFIXES = [
  "pickpackpro-api-get-cache",
  "pickpackpro-client-shipments-cache",
];

const firstPresent = (...values) =>
  values.find((value) => value !== null && value !== undefined && String(value).trim() !== "") || "";

const normalizeRole = (role) => {
  const normalizedRole = String(role || "").trim().toLowerCase();

  if (["admin", "staff", "client"].includes(normalizedRole)) {
    return normalizedRole;
  }

  return "";
};

const getPayloadUser = (payload) =>
  payload?.data?.user ||
  payload?.user ||
  payload?.data?.profile ||
  payload?.profile ||
  payload?.account ||
  payload?.data?.account ||
  payload?.data ||
  payload;

export const getAuthToken = (payload = {}) =>
  firstPresent(
    payload?.token,
    payload?.accessToken,
    payload?.access_token,
    payload?.jwt,
    payload?.data?.token,
    payload?.data?.accessToken,
    payload?.data?.access_token,
    payload?.data?.jwt,
    payload?.data?.session?.accessToken,
    payload?.data?.session?.access_token,
    payload?.session?.accessToken,
    payload?.session?.access_token,
    payload?.auth?.token,
    payload?.auth?.accessToken,
    payload?.auth?.access_token
  );

export const getRefreshToken = (payload = {}) =>
  firstPresent(
    payload?.refreshToken,
    payload?.refresh_token,
    payload?.data?.refreshToken,
    payload?.data?.refresh_token,
    payload?.data?.session?.refreshToken,
    payload?.data?.session?.refresh_token,
    payload?.session?.refreshToken,
    payload?.session?.refresh_token,
    payload?.auth?.refreshToken,
    payload?.auth?.refresh_token
  );

const normalizeSession = (session = {}) => {
  const user = session?.rawUser || session?.user || session?.profile || {};
  const userId = firstPresent(
    session?.userId,
    session?.id,
    session?.uuid,
    session?.user_id,
    user?.id,
    user?.userId,
    user?.user_id
  );

  return {
    ...session,
    email: firstPresent(session?.email, user?.email),
    name: firstPresent(session?.name, user?.full_name, user?.fullName, user?.name, session?.email, "User"),
    role: normalizeRole(firstPresent(session?.role, user?.role)),
    userId,
    id: userId || session?.id || "",
    token: getAuthToken(session),
    refreshToken: getRefreshToken(session),
    rawUser: session?.rawUser || user,
  };
};

export const getSession = () => {
  const rawSession = localStorage.getItem(AUTH_STORAGE_KEY);

  if (!rawSession) {
    return null;
  }

  try {
    return normalizeSession(JSON.parse(rawSession));
  } catch {
    localStorage.removeItem(AUTH_STORAGE_KEY);
    return null;
  }
};

export const clearSession = () => {
  localStorage.removeItem(AUTH_STORAGE_KEY);
};

const clearLargeLocalCaches = () => {
  try {
    Object.keys(localStorage)
      .filter((key) => LARGE_LOCAL_CACHE_KEY_PREFIXES.some((prefix) => key.startsWith(prefix)))
      .forEach((key) => localStorage.removeItem(key));
  } catch {
    // Ignore storage cleanup failures.
  }
};

export const getDashboardPath = (role) => {
  switch (String(role || "").toLowerCase()) {
    case "staff":
      return "/tasks";
    case "client":
    case "admin":
      return "/dashboard";
    default:
      return "/login";
  }
};

export const buildSessionFromLogin = (payload, email) => {
  const user = getPayloadUser(payload) || {};
  const normalizedEmail = String(
    user?.email || payload?.email || payload?.data?.email || email || ""
  )
    .trim()
    .toLowerCase();
  const userId =
    user?.id ||
    user?.userId ||
    user?.user_id ||
    "";
  const role = normalizeRole(
    user?.role ||
      payload?.role ||
      payload?.data?.role ||
      payload?.data?.user?.role ||
      payload?.data?.profile?.role ||
      payload?.profile?.role ||
      ""
  );

  return normalizeSession({
    email: normalizedEmail,
    name: user?.full_name || user?.fullName || user?.name || normalizedEmail || "User",
    role,
    userId,
    id: userId,
    token: getAuthToken(payload),
    refreshToken: getRefreshToken(payload),
    rawUser: user,
  });
};

export const saveSession = (session) => {
  if (!session) {
    return;
  }

  const serializedSession = JSON.stringify(normalizeSession(session));

  try {
    localStorage.setItem(AUTH_STORAGE_KEY, serializedSession);
  } catch (error) {
    clearLargeLocalCaches();
    localStorage.setItem(AUTH_STORAGE_KEY, serializedSession);
  }
};
