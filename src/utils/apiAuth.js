import { clearSession, getSession, saveSession } from './auth';

export const AUTH_REQUIRED_EVENT_NAME = 'pickpackpro-auth-required';

let authReadyPromise = null;
let latestSupabaseSession = null;
let refreshPromise = null;
let lastSetSessionToken = '';
let supabaseClientPromise = null;
let supabaseClient = null;
let authBridgeInstalled = false;

const syncStoredSessionFromSupabase = (session) => {
  if (!session?.access_token) return;

  const currentSession = getSession();
  if (!currentSession) return;

  const nextRefreshToken = session.refresh_token || currentSession.refreshToken;
  if (currentSession.token === session.access_token && currentSession.refreshToken === nextRefreshToken) {
    return;
  }

  const user = session.user || {};
  saveSession({
    ...currentSession,
    token: session.access_token,
    refreshToken: nextRefreshToken,
    userId: user.id || currentSession.userId,
    id: user.id || currentSession.id,
    email: user.email || currentSession.email,
    rawUser: currentSession.rawUser || user,
  });
};

const installAuthBridge = (supabase) => {
  if (typeof window === 'undefined' || !supabase || authBridgeInstalled) return;

  authBridgeInstalled = true;
  supabase.auth.onAuthStateChange((_event, session) => {
    latestSupabaseSession = session || null;
    if (session?.access_token) {
      lastSetSessionToken = session.access_token;
      syncStoredSessionFromSupabase(session);
    }
  });
};

const getSupabaseClient = async () => {
  if (supabaseClient) return supabaseClient;

  if (!supabaseClientPromise) {
    supabaseClientPromise = import('./supabaseClient')
      .then(({ supabase }) => {
        supabaseClient = supabase || null;
        installAuthBridge(supabaseClient);
        return supabaseClient;
      })
      .catch(() => null);
  }

  return supabaseClientPromise;
};

export const waitForAuthReady = async () => {
  const supabase = await getSupabaseClient();
  if (!supabase) return null;

  if (!authReadyPromise) {
    authReadyPromise = supabase.auth
      .getSession()
      .then(({ data, error }) => {
        if (error) return null;
        latestSupabaseSession = data?.session || null;
        if (latestSupabaseSession?.access_token) {
          lastSetSessionToken = latestSupabaseSession.access_token;
          syncStoredSessionFromSupabase(latestSupabaseSession);
        }
        return latestSupabaseSession;
      })
      .catch(() => null);
  }

  return authReadyPromise;
};

const ensureSupabaseSessionFromStoredAuth = async (storedSession = getSession()) => {
  const supabase = await getSupabaseClient();
  if (!supabase || !storedSession?.token || !storedSession?.refreshToken) {
    return latestSupabaseSession;
  }

  if (latestSupabaseSession?.access_token === storedSession.token || lastSetSessionToken === storedSession.token) {
    return latestSupabaseSession;
  }

  lastSetSessionToken = storedSession.token;

  try {
    const { data, error } = await supabase.auth.setSession({
      access_token: storedSession.token,
      refresh_token: storedSession.refreshToken,
    });

    if (!error && data?.session) {
      latestSupabaseSession = data.session;
      if (data.session.access_token) {
        lastSetSessionToken = data.session.access_token;
        syncStoredSessionFromSupabase(data.session);
      }
    }
  } catch {
    // The request-level 401 retry path will attempt a refresh if this setup fails.
  }

  return latestSupabaseSession;
};

export const getAccessTokenForProtectedRequest = async () => {
  const storedSession = getSession();
  return storedSession?.token || '';
};

export const getFreshSessionOnce = async () => {
  const supabase = await getSupabaseClient();
  if (!supabase) return null;

  if (!refreshPromise) {
    refreshPromise = (async () => {
      await waitForAuthReady();
      const storedToken = getSession()?.token || '';
      const restoredSession = await ensureSupabaseSessionFromStoredAuth(getSession());
      if (restoredSession?.access_token && restoredSession.access_token !== storedToken) {
        return restoredSession;
      }

      const { data, error } = await supabase.auth.refreshSession();
      if (error || !data?.session) return null;

      latestSupabaseSession = data.session;
      if (data.session.access_token) {
        lastSetSessionToken = data.session.access_token;
        syncStoredSessionFromSupabase(data.session);
      }

      return data.session;
    })().finally(() => {
      refreshPromise = null;
    });
  }

  return refreshPromise;
};

export const handleProtectedAuthFailure = () => {
  clearSession();

  if (typeof window === 'undefined') return;

  window.dispatchEvent(new CustomEvent(AUTH_REQUIRED_EVENT_NAME));
};
