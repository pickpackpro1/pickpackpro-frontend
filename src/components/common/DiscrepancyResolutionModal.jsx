import { useState } from 'react';
import { RefreshCw, X } from 'lucide-react';

const toFiniteNumber = (value, fallback = 0) => {
  const numberValue = Number(value);
  return Number.isFinite(numberValue) ? numberValue : fallback;
};

const formatQuantity = (value) => {
  if (value === undefined || value === null || value === '') return '-';
  const numberValue = Number(value);
  return Number.isFinite(numberValue) ? numberValue.toLocaleString() : String(value);
};

const DiscrepancyResolutionModal = ({
  open,
  ...props
}) => {
  if (!open) return null;

  return <DiscrepancyResolutionForm key={props.lineItemId || props.sku || 'discrepancy-resolution'} {...props} />;
};

const DiscrepancyResolutionForm = ({
  sku,
  productName,
  expectedQty,
  receivedQty,
  differenceQty,
  lineItemId,
  error,
  isSubmitting,
  onClose,
  onSubmit,
}) => {
  const expected = toFiniteNumber(expectedQty);
  const received = toFiniteNumber(receivedQty);
  const missingQty = Math.max(expected - received, 0);
  const [mode, setMode] = useState('additional');
  const [additionalQty, setAdditionalQty] = useState(() => String(missingQty));
  const [finalReceivedQty, setFinalReceivedQty] = useState(() => String(expected));
  const [notes, setNotes] = useState('');
  const calculatedDifference = received - expected;
  const resolvedDifference = differenceQty === undefined || differenceQty === null || differenceQty === ''
    ? calculatedDifference
    : differenceQty;

  const handleSubmit = (event) => {
    event.preventDefault();

    if (isSubmitting) return;

    const payload = {
      notes: String(notes || '').trim(),
    };

    if (mode === 'final') {
      payload.receivedQty = Number(finalReceivedQty);
    } else {
      payload.additionalReceivedQty = Number(additionalQty);
    }

    onSubmit(payload);
  };

  return (
    <div className="fixed inset-0 z-[90] flex items-center justify-center bg-black/50 p-4">
      <form onSubmit={handleSubmit} className="w-full max-w-lg overflow-hidden rounded-2xl bg-white shadow-xl">
        <div className="flex items-center justify-between border-b border-gray-200 px-6 py-4">
          <div>
            <h3 className="text-lg font-semibold text-[#132347]">Update Received Qty</h3>
            <p className="mt-1 text-sm text-gray-500">{sku || lineItemId || 'Line item'}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={isSubmitting}
            className="rounded-full p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-700 disabled:cursor-not-allowed disabled:opacity-50"
            title="Close"
          >
            <X size={18} />
          </button>
        </div>

        <div className="max-h-[70vh] space-y-5 overflow-y-auto p-6">
          <div>
            <p className="text-sm font-semibold text-[#132347]">{productName || 'Product line'}</p>
            <p className="mt-1 text-xs text-gray-500">Line item {lineItemId || '-'}</p>
          </div>

          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <div className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-2.5">
              <p className="text-[10px] font-semibold uppercase tracking-wide text-gray-500">Expected</p>
              <p className="mt-1 text-sm font-semibold text-[#132347]">{formatQuantity(expectedQty)}</p>
            </div>
            <div className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-2.5">
              <p className="text-[10px] font-semibold uppercase tracking-wide text-gray-500">Current</p>
              <p className="mt-1 text-sm font-semibold text-[#132347]">{formatQuantity(receivedQty)}</p>
            </div>
            <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5">
              <p className="text-[10px] font-semibold uppercase tracking-wide text-amber-700">Missing</p>
              <p className="mt-1 text-sm font-semibold text-amber-900">{formatQuantity(missingQty)}</p>
            </div>
            <div className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-2.5">
              <p className="text-[10px] font-semibold uppercase tracking-wide text-gray-500">Difference</p>
              <p className="mt-1 text-sm font-semibold text-[#132347]">{formatQuantity(resolvedDifference)}</p>
            </div>
          </div>

          <div className="inline-flex rounded-lg border border-gray-200 bg-gray-50 p-1">
            <button
              type="button"
              onClick={() => setMode('additional')}
              className={`rounded-md px-3 py-1.5 text-xs font-semibold ${mode === 'additional' ? 'bg-white text-[#132347] shadow-sm' : 'text-gray-500 hover:text-gray-800'}`}
            >
              Additional
            </button>
            <button
              type="button"
              onClick={() => setMode('final')}
              className={`rounded-md px-3 py-1.5 text-xs font-semibold ${mode === 'final' ? 'bg-white text-[#132347] shadow-sm' : 'text-gray-500 hover:text-gray-800'}`}
            >
              Final
            </button>
          </div>

          {mode === 'additional' ? (
            <div>
              <label className="mb-2 block text-[11px] font-semibold uppercase tracking-wide text-gray-500">Additional received quantity</label>
              <input
                type="number"
                min="0"
                step="1"
                value={additionalQty}
                onChange={(event) => setAdditionalQty(event.target.value)}
                className="w-full rounded-lg border border-gray-200 px-3 py-2.5 text-sm focus:border-[#ff9900] focus:outline-none focus:ring-2 focus:ring-orange-100"
                required
              />
            </div>
          ) : (
            <div>
              <label className="mb-2 block text-[11px] font-semibold uppercase tracking-wide text-gray-500">Final received quantity</label>
              <input
                type="number"
                min="0"
                step="1"
                value={finalReceivedQty}
                onChange={(event) => setFinalReceivedQty(event.target.value)}
                className="w-full rounded-lg border border-gray-200 px-3 py-2.5 text-sm focus:border-[#ff9900] focus:outline-none focus:ring-2 focus:ring-orange-100"
                required
              />
            </div>
          )}

          <div>
            <label className="mb-2 block text-[11px] font-semibold uppercase tracking-wide text-gray-500">Notes</label>
            <textarea
              value={notes}
              onChange={(event) => setNotes(event.target.value)}
              className="min-h-24 w-full rounded-lg border border-gray-200 px-3 py-2.5 text-sm focus:border-[#ff9900] focus:outline-none focus:ring-2 focus:ring-orange-100"
            />
          </div>

          {error ? (
            <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>
          ) : null}
        </div>

        <div className="flex justify-end gap-3 border-t border-gray-200 px-6 py-4">
          <button
            type="button"
            onClick={onClose}
            disabled={isSubmitting}
            className="rounded-lg border border-gray-300 px-4 py-2 text-sm text-gray-700 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-60"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={isSubmitting}
            className="inline-flex min-w-[132px] items-center justify-center gap-2 rounded-lg bg-[#132347] px-5 py-2 text-sm font-semibold text-white hover:bg-[#0f1b38] disabled:cursor-not-allowed disabled:opacity-70"
          >
            {isSubmitting ? (
              <>
                <RefreshCw size={14} className="animate-spin" />
                Saving...
              </>
            ) : (
              'Save'
            )}
          </button>
        </div>
      </form>
    </div>
  );
};

export default DiscrepancyResolutionModal;
