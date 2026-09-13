import { getScanLineItemId, getScanLineItemSku } from '../../utils/barcodeMatch';

// Shown when one scanned code matches more than one line in the shipment.
const ScanMatchChooser = ({ code, matches, describe, onPick, onCancel }) => (
  <div className="fixed inset-0 z-[160] flex items-center justify-center bg-black/45 px-4">
    <div className="w-full max-w-md rounded-xl bg-white shadow-2xl">
      <div className="border-b border-gray-100 px-6 py-5">
        <h2 className="text-lg font-semibold text-[#132347]">Which line is it?</h2>
        <p className="mt-1 text-sm text-gray-600">
          “{code}” matches {matches.length} lines in this shipment.
        </p>
      </div>
      <div className="max-h-[60vh] space-y-2 overflow-y-auto px-6 py-4">
        {matches.map(({ item }, index) => (
          <button
            key={getScanLineItemId(item) || index}
            type="button"
            onClick={() => onPick(item)}
            className="w-full rounded-lg border border-gray-200 px-4 py-3 text-left hover:border-[#ff6900] hover:bg-orange-50"
          >
            <span className="block text-sm font-semibold text-gray-900">{getScanLineItemSku(item) || 'SKU'}</span>
            <span className="block text-xs text-gray-500">{describe(item)}</span>
          </button>
        ))}
      </div>
      <div className="flex justify-end border-t border-gray-100 px-6 py-4">
        <button
          type="button"
          onClick={onCancel}
          className="rounded-lg border border-gray-300 px-4 py-2.5 text-sm font-semibold text-gray-700"
        >
          Cancel
        </button>
      </div>
    </div>
  </div>
);

export default ScanMatchChooser;
