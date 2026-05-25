import { useEffect, useState } from 'react';

const sizeClasses = {
  sm: 'h-4 w-4 border-2',
  md: 'h-5 w-5 border-2',
  lg: 'h-7 w-7 border-[3px]',
};

const LoadingState = ({
  label = 'Loading...',
  size = 'md',
  className = '',
  labelClassName = 'text-sm text-gray-500',
  delay = 200,
}) => {
  const [shouldRender, setShouldRender] = useState(false);

  useEffect(() => {
    if (!delay) {
      setShouldRender(true);
      return undefined;
    }

    const timer = window.setTimeout(() => {
      setShouldRender(true);
    }, delay);

    return () => window.clearTimeout(timer);
  }, [delay]);

  if (!shouldRender) return null;

  return (
    <span className={`inline-flex items-center justify-center gap-2 ${className}`} role="status" aria-live="polite">
      <span
        className={`${sizeClasses[size] || sizeClasses.md} inline-block animate-spin rounded-full border-gray-200 border-t-[#ff6900]`}
        aria-hidden="true"
      />
      {label ? <span className={labelClassName}>{label}</span> : null}
    </span>
  );
};

export default LoadingState;
