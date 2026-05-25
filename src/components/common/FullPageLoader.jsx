import { useEffect, useState } from 'react';

const FullPageLoader = ({
  show,
  label = 'Loading...',
  delay = 450,
  blocking = false,
}) => {
  const [shouldRender, setShouldRender] = useState(false);

  useEffect(() => {
    if (!show) {
      setShouldRender(false);
      return undefined;
    }

    if (!delay) {
      setShouldRender(true);
      return undefined;
    }

    const timer = window.setTimeout(() => {
      setShouldRender(true);
    }, delay);

    return () => window.clearTimeout(timer);
  }, [delay, show]);

  if (!show || !shouldRender) return null;

  if (!blocking) {
    return (
      <div className="pointer-events-none fixed inset-x-0 top-0 z-[120]" role="status" aria-live="polite">
        <div className="h-1 w-full overflow-hidden bg-orange-100">
          <span className="block h-full w-1/3 animate-pulse rounded-r-full bg-[#ff6900]" />
        </div>
        <div className="mx-auto mt-3 flex w-fit items-center gap-2 rounded-full border border-orange-100 bg-white/95 px-4 py-2 text-sm font-semibold text-gray-700 shadow-lg">
          <span
            className="h-4 w-4 animate-spin rounded-full border-2 border-gray-200 border-t-[#ff6900]"
            aria-hidden="true"
          />
          <span>{label}</span>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-[120] flex items-center justify-center bg-white/80 backdrop-blur-[2px]" role="status" aria-live="polite">
      <div className="flex flex-col items-center gap-4 rounded-xl border border-gray-200 bg-white p-7 shadow-xl">
        <div className="flex h-12 w-20 items-center justify-center ">
          <span
            className="h-12 w-12 animate-spin rounded-full border-4 border-gray-200 border-t-[#ff6900]"
            aria-hidden="true"
          />
        </div>

        <span className="text-sm font-semibold text-gray-700">
          {label}
        </span>
      </div>
    </div>
  );
};

export default FullPageLoader;
