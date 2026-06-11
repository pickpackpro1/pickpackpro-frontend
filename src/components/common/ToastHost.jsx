import { useEffect, useState } from 'react';
import { TOAST_EVENT_NAME, formatToastMessage } from '../../utils/toast';

const toastStyles = {
  success: 'border-green-200 bg-green-50 text-green-700',
  error: 'border-red-200 bg-red-50 text-red-700',
};

const ToastHost = () => {
  const [toast, setToast] = useState(null);

  useEffect(() => {
    const handleToast = (event) => {
      setToast({
        id: Date.now(),
        type: event.detail?.type || 'error',
        message: formatToastMessage(event.detail?.message),
      });
    };

    window.addEventListener(TOAST_EVENT_NAME, handleToast);

    return () => window.removeEventListener(TOAST_EVENT_NAME, handleToast);
  }, []);

  useEffect(() => {
    if (!toast) return undefined;

    const timer = window.setTimeout(() => {
      setToast(null);
    }, 3500);

    return () => window.clearTimeout(timer);
  }, [toast]);

  if (!toast) return null;

  return (
    <div className="fixed right-6 top-20 z-[200]">
      <div className={`rounded-lg border px-4 py-3 text-sm shadow-lg ${toastStyles[toast.type] || toastStyles.error}`}>
        {toast.message}
      </div>
    </div>
  );
};

export default ToastHost;
