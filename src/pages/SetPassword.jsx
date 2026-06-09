import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { createClient } from '@supabase/supabase-js';
import { Eye, EyeOff } from 'lucide-react';

const INVALID_INVITE_MESSAGE =
  'Invalid or expired invite link. Please ask your administrator to resend the invitation.';

const hasSupabaseConfig = Boolean(
  import.meta.env.VITE_SUPABASE_URL && import.meta.env.VITE_SUPABASE_ANON_KEY
);

const supabase = hasSupabaseConfig
  ? createClient(import.meta.env.VITE_SUPABASE_URL, import.meta.env.VITE_SUPABASE_ANON_KEY)
  : null;

const SetPassword = () => {
  const navigate = useNavigate();
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);
  const [tokenReady, setTokenReady] = useState(false);
  const [invalidLink, setInvalidLink] = useState(false);

  useEffect(() => {
    let isMounted = true;

    const prepareInviteSession = async () => {
      const hash = window.location.hash.substring(1);
      const params = new URLSearchParams(hash);
      const accessToken = params.get('access_token');
      const refreshToken = params.get('refresh_token');

      try {
        if (!supabase) {
          throw new Error('Missing Supabase configuration.');
        }

        if (accessToken) {
          const { error: sessionError } = await supabase.auth.setSession({
            access_token: accessToken,
            refresh_token: refreshToken || '',
          });

          if (sessionError) {
            throw sessionError;
          }

          if (isMounted) {
            setTokenReady(true);
          }
          return;
        }

        const queryParams = new URLSearchParams(window.location.search);
        const tokenHash = queryParams.get('token_hash');
        const queryType = queryParams.get('type');

        if (tokenHash) {
          const { error: verifyError } = await supabase.auth.verifyOtp({
            token_hash: tokenHash,
            type: queryType || 'invite',
          });

          if (verifyError) {
            throw verifyError;
          }

          if (isMounted) {
            setTokenReady(true);
          }
          return;
        }

        const { data, error: sessionError } = await supabase.auth.getSession();

        if (sessionError || !data?.session?.access_token) {
          throw sessionError || new Error('Missing invite session.');
        }

        if (isMounted) {
          setTokenReady(true);
        }
      } catch {
        if (isMounted) {
          setInvalidLink(true);
        }
      }
    };

    prepareInviteSession();

    return () => {
      isMounted = false;
    };
  }, []);

  const handleSubmit = async (event) => {
    event.preventDefault();
    setError('');

    if (password.length < 8) {
      setError('Password must be at least 8 characters.');
      return;
    }

    if (password !== confirmPassword) {
      setError('Passwords do not match.');
      return;
    }

    try {
      setIsSubmitting(true);
      const { error: updateError } = await supabase.auth.updateUser({ password });

      if (updateError) {
        throw new Error(updateError.message);
      }

      setSuccess(true);
      window.setTimeout(() => navigate('/login', { replace: true }), 2500);
    } catch (err) {
      setError(err.message || 'Failed to set password. Please try again.');
    } finally {
      setIsSubmitting(false);
    }
  };

  if (invalidLink) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-white p-4">
        <div className="w-full max-w-md rounded-lg border border-orange-100 bg-white p-8 text-center shadow-[0_24px_80px_rgba(255,105,0,0.12)]">
          <h1 className="mb-4 text-3xl font-bold text-[#ff6900]">PickPackPro</h1>
          <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-4 text-sm text-red-700">
            <p>{INVALID_INVITE_MESSAGE}</p>
          </div>
        </div>
      </div>
    );
  }

  if (success) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-white p-4">
        <div className="w-full max-w-md rounded-lg border border-orange-100 bg-white p-8 text-center shadow-[0_24px_80px_rgba(255,105,0,0.12)]">
          <h1 className="mb-4 text-3xl font-bold text-[#ff6900]">PickPackPro</h1>
          <div className="rounded-lg border border-green-200 bg-green-50 px-4 py-4 text-sm text-green-700">
            <p className="mb-1 font-semibold">Password set successfully!</p>
            <p>Redirecting you to login...</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-white p-4">
      <div className="w-full max-w-md rounded-lg border border-orange-100 bg-white p-8 shadow-[0_24px_80px_rgba(255,105,0,0.12)]">
        <div className="mb-8 text-center">
          <h1 className="mb-1 text-4xl font-bold text-[#ff6900]">PickPackPro</h1>
          <p className="text-lg font-medium text-gray-700">Set your password</p>
          <p className="mt-1 text-sm text-gray-400">Choose a password to activate your account</p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-5" noValidate>
          <div>
            <label className="mb-1.5 block text-sm font-semibold text-gray-700" htmlFor="password">
              New Password
            </label>
            <div className="relative">
              <input
                id="password"
                type={showPassword ? 'text' : 'password'}
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                placeholder="Min. 8 characters"
                minLength={8}
                className="w-full rounded-lg border-2 border-gray-200 px-4 py-2.5 pr-12 text-gray-700 transition-all duration-200 placeholder-gray-400 focus:border-[#ff6900] focus:outline-none focus:ring-2 focus:ring-orange-100"
                required
                disabled={!tokenReady}
              />
              <button
                type="button"
                onClick={() => setShowPassword((current) => !current)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 transition-colors hover:text-[#ff6900]"
                aria-label={showPassword ? 'Hide password' : 'Show password'}
              >
                {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
              </button>
            </div>
          </div>

          <div>
            <label className="mb-1.5 block text-sm font-semibold text-gray-700" htmlFor="confirm-password">
              Confirm Password
            </label>
            <input
              id="confirm-password"
              type={showPassword ? 'text' : 'password'}
              value={confirmPassword}
              onChange={(event) => setConfirmPassword(event.target.value)}
              placeholder="Repeat your password"
              minLength={8}
              className="w-full rounded-lg border-2 border-gray-200 px-4 py-2.5 text-gray-700 transition-all duration-200 placeholder-gray-400 focus:border-[#ff6900] focus:outline-none focus:ring-2 focus:ring-orange-100"
              required
              disabled={!tokenReady}
            />
          </div>

          {error ? (
            <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-600">
              {error}
            </p>
          ) : null}

          <button
            type="submit"
            disabled={isSubmitting || !tokenReady}
            className="w-full rounded-lg bg-[#ff6900] px-6 py-3 text-base font-semibold text-white shadow-lg shadow-orange-200 transition-all duration-200 hover:bg-[#e65f00] disabled:cursor-not-allowed disabled:opacity-60"
          >
            {!tokenReady ? 'Verifying link...' : isSubmitting ? 'Setting Password...' : 'Set Password & Sign In'}
          </button>
        </form>
      </div>
    </div>
  );
};

export default SetPassword;
