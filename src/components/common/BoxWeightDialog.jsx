import { useState } from 'react';
import { HEAVY_PACKAGE_THRESHOLD_KG, MAX_FBA_BOX_WEIGHT_KG } from '../../utils/boxWeight';

const isPalletRecord = (box) =>
  String(box?.boxType || box?.box_type || box?.type || '').toLowerCase() === 'pallet';

export const BoxWeightBadges = ({ box }) => {
  if (!box || isPalletRecord(box)) return null;
  const weightKg = Number(box?.weightKg ?? box?.weight_kg ?? box?.weight ?? 0);
  const heavy = Boolean(box?.heavyPackage ?? box?.heavy_package_flag) || weightKg > HEAVY_PACKAGE_THRESHOLD_KG;
  const overridden = Boolean(box?.weightOverride ?? box?.weight_override);
  const overrideReason = box?.weightOverrideReason ?? box?.weight_override_reason ?? '';
  if (!heavy && !overridden) return null;

  return (
    <span className="ml-2 inline-flex flex-wrap gap-1 align-middle">
      {heavy ? (
        <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-800">
          Heavy package
        </span>
      ) : null}
      {overridden ? (
        <span
          title={overrideReason ? `Override reason: ${overrideReason}` : 'Weight limit overridden'}
          className="rounded bg-red-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-red-700"
        >
          Over {MAX_FBA_BOX_WEIGHT_KG} kg · override
        </span>
      ) : null}
    </span>
  );
};

const BoxWeightDialog = ({ request, onSubmit, onCancel }) => {
  const initialWeight = Number(request?.weightKg) > 0 ? String(request.weightKg) : '';
  const [weight, setWeight] = useState(initialWeight);
  const [reason, setReason] = useState('');
  const [error, setError] = useState('');

  const weightKg = Number(weight);
  const hasWeight = Number.isFinite(weightKg) && weightKg > 0;
  const overLimit = hasWeight && weightKg > MAX_FBA_BOX_WEIGHT_KG;
  const heavy = hasWeight && weightKg > HEAVY_PACKAGE_THRESHOLD_KG;
  const boxName = request?.boxLabel ? `Box ${request.boxLabel}` : 'This box';

  const title = request?.reason === 'over-limit' ? `Box is over ${MAX_FBA_BOX_WEIGHT_KG} kg` : 'Enter box weight';
  const message =
    request?.reason === 'over-limit'
      ? `Amazon FBA boxes can't be over ${MAX_FBA_BOX_WEIGHT_KG} kg. Repack it and enter the new weight, or override with a reason.`
      : `${boxName} has no weight yet. Put it on the scale and enter the weight to continue.`;

  const handleSubmit = (event) => {
    event.preventDefault();
    if (!hasWeight) {
      setError('Enter a weight greater than 0 kg.');
      return;
    }
    if (overLimit && !reason.trim()) {
      setError(`Enter a reason to send a box over ${MAX_FBA_BOX_WEIGHT_KG} kg.`);
      return;
    }
    onSubmit({
      weight: weightKg,
      weightKg,
      weightOverride: overLimit,
      weightOverrideReason: overLimit ? reason.trim() : null,
    });
  };

  return (
    <div className="fixed inset-0 z-[150] flex items-center justify-center bg-black/45 px-4">
      <form onSubmit={handleSubmit} className="w-full max-w-md rounded-xl bg-white shadow-2xl">
        <div className="border-b border-gray-100 px-6 py-5">
          <h2 className="text-lg font-semibold text-[#132347]">{title}</h2>
          <p className="mt-2 text-sm leading-6 text-gray-600">{message}</p>
        </div>

        <div className="space-y-4 px-6 py-5">
          <label className="block">
            <span className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-gray-500">Weight (kg)</span>
            <input
              type="number"
              inputMode="decimal"
              step="0.01"
              min="0"
              autoFocus
              value={weight}
              onChange={(event) => {
                setError('');
                setWeight(event.target.value);
              }}
              className="w-full rounded-lg border border-gray-200 px-3 py-3 text-lg focus:outline-none focus:ring-2 focus:ring-[#ff6900]"
            />
          </label>

          {heavy && !overLimit ? (
            <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800">
              Over {HEAVY_PACKAGE_THRESHOLD_KG} kg — mark this box "Heavy Package".
            </p>
          ) : null}

          {overLimit ? (
            <label className="block">
              <span className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-red-600">
                Reason for going over {MAX_FBA_BOX_WEIGHT_KG} kg
              </span>
              <textarea
                rows={3}
                value={reason}
                onChange={(event) => {
                  setError('');
                  setReason(event.target.value);
                }}
                placeholder="e.g. Single item can't be split, client approved"
                className="w-full rounded-lg border border-red-200 px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-red-400"
              />
              <span className="mt-1 block text-[11px] text-gray-500">This override is saved in the audit log.</span>
            </label>
          ) : null}

          {error ? <p className="text-sm font-medium text-red-600">{error}</p> : null}
        </div>

        <div className="flex justify-end gap-3 border-t border-gray-100 px-6 py-4">
          <button
            type="button"
            onClick={onCancel}
            className="rounded-lg border border-gray-300 px-4 py-2.5 text-sm font-semibold text-gray-700 hover:bg-gray-50"
          >
            Cancel
          </button>
          <button
            type="submit"
            className={`rounded-lg px-4 py-2.5 text-sm font-semibold text-white ${
              overLimit ? 'bg-red-600 hover:bg-red-700' : 'bg-[#ff8c2f] hover:bg-[#f47b14]'
            }`}
          >
            {overLimit ? 'Override & save' : 'Save weight'}
          </button>
        </div>
      </form>
    </div>
  );
};

export default BoxWeightDialog;
