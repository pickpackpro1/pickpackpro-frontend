import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { createClient } from '@supabase/supabase-js';

const INVALID_INVITE_MESSAGE =
  'Invalid or expired invite link. Please ask your administrator to resend the invitation.';

const hasSupabaseConfig = Boolean(
  import.meta.env.VITE_SUPABASE_URL && import.meta.env.VITE_SUPABASE_ANON_KEY
);

const supabase = hasSupabaseConfig
  ? createClient(import.meta.env.VITE_SUPABASE_URL, import.meta.env.VITE_SUPABASE_ANON_KEY)
  : null;

const AuthConfirm = () => {
  const navigate = useNavigate();
  const [error, setError] = useState('');
  const [isConfirming, setIsConfirming] = useState(false);

  const inviteParams = useMemo(() => {
    const queryParams = new URLSearchParams(window.location.search);

    return {
      tokenHash: queryParams.get('token_hash') || '',
      type: queryParams.get('type') || 'invite',
    };
  }, []);

  const handleConfirm = async () => {
    setError('');

    if (!supabase || !inviteParams.tokenHash) {
      setError(INVALID_INVITE_MESSAGE);
      return;
    }

    try {
      setIsConfirming(true);

      const { error: verifyError } = await supabase.auth.verifyOtp({
        token_hash: inviteParams.tokenHash,
        type: inviteParams.type || 'invite',
      });

      if (verifyError) {
        throw verifyError;
      }

      navigate('/set-password', { replace: true });
    } catch {
      setError(INVALID_INVITE_MESSAGE);
    } finally {
      setIsConfirming(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-white p-4">
      <div className="w-full max-w-md rounded-lg border border-orange-100 bg-white p-8 text-center shadow-[0_24px_80px_rgba(255,105,0,0.12)]">
        <h1 className="mb-2 text-3xl font-bold text-[#ff6900]">PickPackPro</h1>
        <h2 className="mb-6 text-2xl font-semibold text-gray-800">Confirm your invitation</h2>

        {error ? (
          <p className="mb-5 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            {error}
          </p>
        ) : null}

        <button
          type="button"
          onClick={handleConfirm}
          disabled={isConfirming}
          className="w-full rounded-lg bg-[#ff6900] px-6 py-3 text-base font-semibold text-white shadow-lg shadow-orange-200 transition-all duration-200 hover:bg-[#e65f00] disabled:cursor-not-allowed disabled:opacity-60"
        >
          {isConfirming ? 'Confirming...' : 'Continue to set password'}
        </button>
      </div>
    </div>
  );
};

export default AuthConfirm;
