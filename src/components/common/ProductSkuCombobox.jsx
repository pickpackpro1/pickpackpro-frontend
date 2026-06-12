import React, { useMemo, useRef, useState } from 'react';
import { Search } from 'lucide-react';
import { getSkuOptionDisplayLabel, normalizeSkuIdentity } from '../../utils/productSkuOptions';

const containsTerm = (value = '', term = '') =>
  String(value || '').toLowerCase().includes(term);

const filterSkuOptions = (options = [], value = '') => {
  const term = String(value || '').trim().toLowerCase();
  if (!term) return options.slice(0, 20);

  return options
    .filter((option) =>
      containsTerm(option?.sku, term) ||
      containsTerm(option?.productName, term) ||
      containsTerm(option?.fnskuLabel, term)
    )
    .slice(0, 20);
};

const ProductSkuCombobox = ({
  value = '',
  options = [],
  loading = false,
  disabled = false,
  placeholder = 'Search or create SKU',
  inputClassName = '',
  onChange,
  onSelect,
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const blurTimeoutRef = useRef(null);
  const filteredOptions = useMemo(() => filterSkuOptions(options, value), [options, value]);
  const hasExactMatch = useMemo(
    () => options.some((option) => normalizeSkuIdentity(option?.sku) === normalizeSkuIdentity(value)),
    [options, value]
  );
  const showNewSkuOption = String(value || '').trim() && !hasExactMatch;

  const openMenu = () => {
    if (!disabled) setIsOpen(true);
  };

  const closeMenuSoon = () => {
    blurTimeoutRef.current = window.setTimeout(() => setIsOpen(false), 120);
  };

  const keepMenuOpen = () => {
    if (blurTimeoutRef.current) window.clearTimeout(blurTimeoutRef.current);
  };

  const selectOption = (option) => {
    onSelect?.(option);
    setIsOpen(false);
  };

  return (
    <div className="relative" onMouseDown={keepMenuOpen}>
      <div className="relative">
        <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[#94a3b8]" />
        <input
          type="text"
          placeholder={loading ? 'Loading SKUs...' : placeholder}
          value={value}
          onChange={(event) => {
            onChange?.(event.target.value);
            openMenu();
          }}
          onFocus={openMenu}
          onBlur={closeMenuSoon}
          disabled={disabled}
          className={`${inputClassName} pl-9`}
        />
      </div>

      {isOpen && !disabled ? (
        <div className="absolute z-30 mt-1 max-h-64 w-full overflow-y-auto rounded-lg border border-[#dbe3ef] bg-white py-1 text-sm shadow-xl">
          {loading ? (
            <div className="px-3 py-2 text-[#64748b]">Loading SKUs...</div>
          ) : filteredOptions.length ? (
            filteredOptions.map((option) => (
              <button
                key={option.id || option.sku}
                type="button"
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => selectOption(option)}
                className="flex w-full flex-col px-3 py-2 text-left hover:bg-[#fff7ed]"
              >
                <span className="font-semibold text-[#132347]">{option.sku}</span>
                <span className="text-xs text-[#64748b]">{getSkuOptionDisplayLabel(option)}</span>
              </button>
            ))
          ) : (
            <div className="px-3 py-2 text-[#64748b]">No matching products</div>
          )}

          {showNewSkuOption ? (
            <button
              type="button"
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => {
                onChange?.(value);
                setIsOpen(false);
              }}
              className="flex w-full items-center justify-between border-t border-[#eef2f7] px-3 py-2 text-left text-[#132347] hover:bg-[#f8fafc]"
            >
              <span className="font-semibold">Use new SKU</span>
              <span className="truncate pl-3 text-xs text-[#64748b]">{value}</span>
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
};

export default ProductSkuCombobox;
