import { useState } from "react";
import { createClient } from "@supabase/supabase-js";
import { Eye, EyeOff } from "lucide-react";
import { useNavigate } from "react-router-dom";
import {
  buildSessionFromLogin,
  getDashboardPath,
  saveSession,
} from "../utils/auth";

const API_BASE_URL = import.meta.env.DEV
  ? ""
  : (import.meta.env.VITE_API_BASE_URL || 'https://ali-backend.vercel.app');

const hasSupabaseConfig = Boolean(
  import.meta.env.VITE_SUPABASE_URL && import.meta.env.VITE_SUPABASE_ANON_KEY
);

const supabase = hasSupabaseConfig
  ? createClient(import.meta.env.VITE_SUPABASE_URL, import.meta.env.VITE_SUPABASE_ANON_KEY)
  : null;

const initialFormState = {
  email: "",
  password: "",
  rememberMe: false,
};

const isTemporaryBackendFailure = (status) => [502, 503, 504].includes(Number(status));

const readResponsePayload = async (response) => {
  const text = await response.text();

  if (!text) {
    return null;
  }

  try {
    return JSON.parse(text);
  } catch {
    return { message: text };
  }
};

const extractAuthUser = (payload) =>
  payload?.user ||
  payload?.data?.user ||
  payload?.data?.profile ||
  payload?.profile ||
  payload?.data ||
  payload ||
  {};

const buildSupabaseFallbackUser = (user = {}, email = "") => {
  const metadata = {
    ...(user?.user_metadata || {}),
    ...(user?.app_metadata || {}),
  };
  const role =
    metadata.role ||
    metadata.user_role ||
    metadata.account_role ||
    user?.role ||
    "";

  return {
    id: user?.id || user?.user_id || "",
    userId: user?.id || user?.user_id || "",
    email: user?.email || email,
    name:
      metadata.full_name ||
      metadata.fullName ||
      metadata.name ||
      user?.email ||
      email,
    role,
  };
};

const getPayloadMessage = (payload, fallback) =>
  payload?.message || payload?.error || payload?.details || fallback;

const loginWithSupabaseFallback = async (email, password) => {
  if (!supabase) {
    throw new Error("Login service is temporarily unavailable. Please try again.");
  }

  const { data, error } = await supabase.auth.signInWithPassword({
    email,
    password,
  });

  if (error) {
    throw new Error(error.message || "Login failed. Please check your credentials.");
  }

  const accessToken = data?.session?.access_token;
  const refreshToken = data?.session?.refresh_token;
  const fallbackUser = buildSupabaseFallbackUser(data?.user || {}, email);

  if (!accessToken) {
    throw new Error("Login service did not return a session token.");
  }

  let profilePayload = null;
  let verifiedUser = fallbackUser;

  try {
    const response = await fetch(`${API_BASE_URL}/api/auth/me`, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
      cache: "no-store",
      skipApiToast: true,
    });
    profilePayload = await readResponsePayload(response);

    if (response.ok) {
      verifiedUser = extractAuthUser(profilePayload);
    } else if (!isTemporaryBackendFailure(response.status)) {
      throw new Error(
        getPayloadMessage(profilePayload, "Login succeeded, but your profile could not be verified.")
      );
    }
  } catch (profileError) {
    const isTemporaryProfileError =
      profileError?.name === "TypeError" ||
      String(profileError?.message || "").toLowerCase().includes("failed to fetch") ||
      String(profileError?.message || "").toLowerCase().includes("network");

    if (!isTemporaryProfileError) throw profileError;
  }

  if (!verifiedUser?.role) {
    throw new Error("Login succeeded, but your account role could not be verified while the backend is unavailable.");
  }

  return {
    ...profilePayload,
    token: accessToken,
    refreshToken,
    user: verifiedUser,
    data: {
      ...(profilePayload?.data && typeof profilePayload.data === "object" ? profilePayload.data : {}),
      user: verifiedUser,
      session: {
        access_token: accessToken,
        refresh_token: refreshToken,
      },
    },
  };
};

const Login = () => {
  const navigate = useNavigate();
  const [formData, setFormData] = useState(initialFormState);
  const [error, setError] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleChange = (event) => {
    const { name, value, type, checked } = event.target;

    setFormData((previous) => ({
      ...previous,
      [name]: type === "checkbox" ? checked : value,
    }));

    if (error) {
      setError("");
    }
  };

  const handleSubmit = async (event) => {
    event.preventDefault();

    if (!formData.email.trim() || !formData.password.trim()) {
      setError("Email and password are required.");
      return;
    }

    try {
      setIsSubmitting(true);
      setError("");

      const response = await fetch(`${API_BASE_URL}/api/auth/login`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          email: formData.email.trim(),
          password: formData.password,
        }),
      });

      let payload = await readResponsePayload(response);

      if (!response.ok) {
        if (isTemporaryBackendFailure(response.status)) {
          payload = await loginWithSupabaseFallback(formData.email.trim(), formData.password);
        } else {
          throw new Error(
            getPayloadMessage(payload, "Login failed. Please check your credentials.")
          );
        }
      }

      const session = buildSessionFromLogin(payload, formData.email);

      if (!session.token || !session.role) {
        throw new Error(
          !session.token
            ? "Login service did not return a session token."
            : "Your account role could not be verified."
        );
      }

      saveSession(session);
      navigate(getDashboardPath(session.role), { replace: true });
    } catch (requestError) {
      const canRetryWithSupabase =
        requestError?.name === "TypeError" ||
        String(requestError?.message || "").toLowerCase().includes("failed to fetch") ||
        String(requestError?.message || "").toLowerCase().includes("network");

      if (canRetryWithSupabase) {
        try {
          const payload = await loginWithSupabaseFallback(formData.email.trim(), formData.password);
          const session = buildSessionFromLogin(payload, formData.email);

          if (!session.token || !session.role) {
            throw new Error(
              !session.token
                ? "Login service did not return a session token."
                : "Your account role could not be verified."
            );
          }

          saveSession(session);
          navigate(getDashboardPath(session.role), { replace: true });
          return;
        } catch (fallbackError) {
          setError(fallbackError.message);
          return;
        }
      }

      setError(requestError.message || "Login failed. Please check your credentials.");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-white p-4">
      <div className="w-full max-w-md rounded-2xl border border-orange-100 bg-white p-8 shadow-[0_24px_80px_rgba(255,105,0,0.12)]">
        <div className="text-center mb-8">
          {/* <h1 className="text-4xl font-bold text-[#ff6900] mb-1">PickPackPro</h1> */}
          <img src="/images/ppp-orange-logo-wide (1).webp" alt="PickPackPro Logo" className="mx-auto mb-3 h-10 w-auto" />
    
          <p className="text-lg text-gray-700 font-medium">
            Sign in
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-5" noValidate>
          <div>
            <label className="block text-sm font-semibold text-gray-700 mb-1.5">
              Email Address
            </label>
            <input
              type="email"
              name="email"
              value={formData.email}
              onChange={handleChange}
              placeholder="email"
              className="w-full rounded-lg border-2 border-gray-200 px-4 py-2.5 text-gray-700 transition-all duration-200  focus:border-[#ff6900] focus:outline-none focus:ring-1 focus:ring-orange-100"
              required
            />
          </div>

          <div>
            <label className="block text-sm font-semibold text-gray-700 mb-1.5">
              Password
            </label>
            <div className="relative">
              <input
                type={showPassword ? "text" : "password"}
                name="password"
                value={formData.password}
                onChange={handleChange}
                placeholder="password"
                minLength={8}
                className="w-full rounded-lg border-2 border-gray-200 px-4 py-2.5 pr-12 text-gray-700 transition-all duration-200 placeholder-gray-400 focus:border-[#ff6900] focus:outline-none focus:ring-2 focus:ring-orange-100"
                required
              />
              <button
                type="button"
                onClick={() => setShowPassword((current) => !current)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 transition-colors hover:text-[#ff6900]"
                aria-label={showPassword ? "Hide password" : "Show password"}
              >
                {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
              </button>
            </div>
          </div>

       

          {error ? (
            <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-600">
              {error}
            </p>
          ) : null}

          <button
            type="submit"
            disabled={isSubmitting}
            className="w-full rounded-lg bg-[#ff6900] px-6 py-3 text-base font-semibold text-white shadow-lg shadow-orange-200 transition-all duration-200 hover:scale-[1.02] hover:bg-[#e65f00] hover:shadow-xl focus:outline-none focus:ring-2 focus:ring-orange-300 focus:ring-offset-2"
          >
            {isSubmitting ? "Signing In..." : "Sign In"}
          </button>
        </form>

      
      </div>
    </div>
  );
};

export default Login;
