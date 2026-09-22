import { useEffect, useState } from 'react';
import {
  getScanLineItemBarcode,
  getScanLineItemFnsku,
  getScanLineItemId,
  getScanLineItemLabelUrl,
  getScanLineItemName,
  getScanLineItemSku,
} from '../../utils/barcodeMatch';
import {
  formatReceivingQuantity,
  getReceivingLineExpectedQty,
  getReceivingLineReceivedQty,
  getReceivingLineRemainingQty,
} from '../../utils/receiving';
import { printLabelUrl } from '../../utils/printLabel';

// Shared by scan-to-receive and the global cross-client scanner.
export const ReceiveDialog = ({ item, matchedBy, onConfirm, onCancel }) => {
  const expected = getReceivingLineExpectedQty(item);
  const receivedSoFar = getReceivingLineReceivedQty(item);
  const remaining = getReceivingLineRemainingQty(item);
  const [quantity, setQuantity] = useState(String(Math.max(remaining, 0)));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const counted = Number(quantity);
  const validCount = quantity !== '' && Number.isInteger(counted) && counted >= 0;
  const difference = validCount ? counted - remaining : 0;

  const submit = async (scanNext) => {
    if (!validCount) {
      setError('Enter the number of units you counted (a whole number, 0 or more).');
      return;
    }
    try {
      setSaving(true);
      setError('');
      await onConfirm(counted, scanNext);
    } catch (requestError) {
      setError(requestError?.message || 'Could not save. Try again.');
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[160] flex items-center justify-center bg-black/45 px-4">
      <div className="w-full max-w-md rounded-xl bg-white shadow-2xl">
        <div className="border-b border-gray-100 px-6 py-5">
          <p className="text-xs font-semibold uppercase tracking-wide text-[#ff6900]">Scanned · matched by {matchedBy}</p>
          <h2 className="mt-1 text-lg font-semibold text-[#132347]">{getScanLineItemName(item)}</h2>
          <p className="mt-1 text-sm text-gray-500">
            SKU {getScanLineItemSku(item) || '-'} · FNSKU {getScanLineItemFnsku(item) || '-'}
          </p>
          {item.clientName || item.shipmentReference ? (
            <p className="mt-1 text-xs font-medium text-gray-400">
              {[item.clientName, item.shipmentReference].filter(Boolean).join(' · ')}
            </p>
          ) : null}
        </div>

        <div className="space-y-4 px-6 py-5">
          <div className="grid grid-cols-3 gap-2 text-center">
            <div className="rounded-lg bg-gray-50 px-2 py-3">
              <p className="text-[10px] font-semibold uppercase tracking-wide text-gray-500">In system</p>
              <p className="mt-1 text-xl font-semibold text-gray-900">{formatReceivingQuantity(expected)}</p>
            </div>
            <div className="rounded-lg bg-gray-50 px-2 py-3">
              <p className="text-[10px] font-semibold uppercase tracking-wide text-gray-500">Received</p>
              <p className="mt-1 text-xl font-semibold text-gray-900">{formatReceivingQuantity(receivedSoFar)}</p>
            </div>
            <div className="rounded-lg bg-orange-50 px-2 py-3">
              <p className="text-[10px] font-semibold uppercase tracking-wide text-[#c05621]">Still due</p>
              <p className="mt-1 text-xl font-semibold text-[#c05621]">{formatReceivingQuantity(remaining)}</p>
            </div>
          </div>

          <label className="block">
            <span className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-gray-500">Units counted now</span>
            <input
              type="number"
              inputMode="numeric"
              min="0"
              step="1"
              autoFocus
              value={quantity}
              onChange={(event) => {
                setError('');
                setQuantity(event.target.value);
              }}
              className="w-full rounded-lg border border-gray-200 px-3 py-3 text-2xl font-semibold focus:outline-none focus:ring-2 focus:ring-[#ff6900]"
            />
          </label>

          {validCount && difference === 0 ? (
            <p className="rounded-lg bg-green-50 px-3 py-2 text-sm font-medium text-green-700">Matches the system.</p>
          ) : null}
          {validCount && difference < 0 ? (
            <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm font-medium text-amber-800">
              {formatReceivingQuantity(-difference)} short — this will be flagged as a discrepancy.
            </p>
          ) : null}
          {validCount && difference > 0 ? (
            <p className="rounded-lg bg-red-50 px-3 py-2 text-sm font-medium text-red-700">
              {formatReceivingQuantity(difference)} more than expected — this will be flagged as a discrepancy.
            </p>
          ) : null}
          {error ? <p className="text-sm font-medium text-red-600">{error}</p> : null}
        </div>

        <div className="grid grid-cols-1 gap-2 border-t border-gray-100 px-6 py-4 sm:grid-cols-3">
          <button
            type="button"
            onClick={onCancel}
            disabled={saving}
            className="rounded-lg border border-gray-300 px-4 py-3 text-sm font-semibold text-gray-700 disabled:opacity-60"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => submit(false)}
            disabled={saving}
            className="rounded-lg border border-[#ff6900] px-4 py-3 text-sm font-semibold text-[#ff6900] disabled:opacity-60"
          >
            {saving ? 'Saving…' : 'OK'}
          </button>
          <button
            type="button"
            onClick={() => submit(true)}
            disabled={saving}
            className="rounded-lg bg-[#ff6900] px-4 py-3 text-sm font-semibold text-white disabled:opacity-60"
          >
            OK &amp; scan next
          </button>
        </div>
      </div>
    </div>
  );
};

// One FNSKU label per sellable unit: bundles use dispatch qty, otherwise what was received, else what was expected.
const getLabelCount = (item = {}) => {
  const candidates = [item?.dispatchQty, item?.dispatch_qty, item?.receivedQty, item?.qty_received, item?.expectedQty, item?.qty_expected];
  for (const value of candidates) {
    const number = Number(value);
    if (value !== null && value !== undefined && value !== '' && Number.isFinite(number) && number > 0) return number;
  }
  return 0;
};

// Shared by scan-to-print and the global cross-client scanner.
export const PrintDialog = ({ item, matchedBy, onScanNext, onClose, apiBaseUrl = '', buildHeaders, parseResponse }) => {
  const canIsolate = Boolean(getScanLineItemLabelUrl(item) && getScanLineItemId(item) && buildHeaders && parseResponse);
  const [labelUrl, setLabelUrl] = useState(getScanLineItemLabelUrl(item));
  const [count, setCount] = useState(String(getLabelCount(item) || 1));
  const [preparing, setPreparing] = useState(canIsolate);
  const [printing, setPrinting] = useState(false);
  const [result, setResult] = useState('');
  const [error, setError] = useState('');

  // The client often uploads one PDF holding every product's labels. Before printing, ask the
  // backend to pull out just this product's pages so staff never print the whole file by mistake.
  useEffect(() => {
    if (!canIsolate) return undefined;
    const lineItemId = getScanLineItemId(item);
    let cancelled = false;
    (async () => {
      try {
        const response = await fetch(`${apiBaseUrl}/api/shipment-line-items/${encodeURIComponent(lineItemId)}/label/isolate`, {
          method: 'POST',
          headers: buildHeaders(true),
        });
        const payload = await parseResponse(response);
        const data = payload?.data ?? payload;
        if (cancelled || !data) return;
        if (data.url) setLabelUrl(data.url);
        if (data.pages) setCount(String(data.pages));
        if (data.warning) setError(data.warning);
      } catch {
        // Best effort — if it fails we still let them print whatever is attached.
      } finally {
        if (!cancelled) setPreparing(false);
      }
    })();
    return () => {
      cancelled = true;
    };
    // Runs once per scanned product; the dialog is remounted (keyed) for each new scan.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const copies = Number(count);
  const validCount = Number.isInteger(copies) && copies > 0;

  const handlePrint = async () => {
    if (!validCount) {
      setError('Enter how many labels to print (1 or more).');
      return;
    }
    try {
      setPrinting(true);
      setError('');
      const outcome = await printLabelUrl(labelUrl);
      if (outcome === 'blocked') {
        setError('Your browser blocked the label window. Allow pop-ups for this site and try again.');
      } else if (outcome === 'opened') {
        setResult(`Label opened in a new tab — print ${copies} ${copies === 1 ? 'copy' : 'copies'} from there.`);
      } else {
        setResult(`Print window opened — ${copies} ${copies === 1 ? 'label' : 'labels'} ready to print.`);
      }
    } catch (printError) {
      setError(printError?.message || 'Could not open the label.');
    } finally {
      setPrinting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[160] flex items-center justify-center bg-black/45 px-4">
      <div className="w-full max-w-md rounded-xl bg-white shadow-2xl">
        <div className="border-b border-gray-100 px-6 py-5">
          <p className="text-xs font-semibold uppercase tracking-wide text-[#ff6900]">Scanned · matched by {matchedBy}</p>
          <h2 className="mt-1 text-lg font-semibold text-[#132347]">{getScanLineItemName(item)}</h2>
          <p className="mt-1 text-sm text-gray-500">
            SKU {getScanLineItemSku(item) || '-'} · FNSKU {getScanLineItemFnsku(item) || '-'}
            {getScanLineItemBarcode(item) ? ` · Barcode ${getScanLineItemBarcode(item)}` : ''}
          </p>
          {item.clientName || item.shipmentReference ? (
            <p className="mt-1 text-xs font-medium text-gray-400">
              {[item.clientName, item.shipmentReference].filter(Boolean).join(' · ')}
            </p>
          ) : null}
        </div>

        <div className="space-y-4 px-6 py-5">
          <label className="block">
            <span className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-gray-500">FNSKU labels to print</span>
            <input
              type="number"
              inputMode="numeric"
              min="1"
              step="1"
              value={count}
              onChange={(event) => {
                setError('');
                setResult('');
                setCount(event.target.value);
              }}
              className="w-full rounded-lg border border-gray-200 px-3 py-3 text-2xl font-semibold focus:outline-none focus:ring-2 focus:ring-[#ff6900]"
            />
            <span className="mt-1 block text-[11px] text-gray-500">
              {preparing ? 'Pulling this product’s labels out of the file…' : "Only this product's labels print. Change the number if you need more or fewer."}
            </span>
          </label>

          {!labelUrl ? (
            <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800">
              No FNSKU label file is uploaded for this SKU yet. Upload it on the shipment, then scan again.
            </p>
          ) : null}
          {result ? <p className="rounded-lg bg-green-50 px-3 py-2 text-sm text-green-700">{result}</p> : null}
          {error ? <p className="text-sm font-medium text-red-600">{error}</p> : null}
        </div>

        <div className="grid grid-cols-1 gap-2 border-t border-gray-100 px-6 py-4 sm:grid-cols-3">
          <button type="button" onClick={onClose} className="rounded-lg border border-gray-300 px-4 py-3 text-sm font-semibold text-gray-700">
            Close
          </button>
          <button
            type="button"
            onClick={onScanNext}
            className="rounded-lg border border-[#ff6900] px-4 py-3 text-sm font-semibold text-[#ff6900]"
          >
            Scan next
          </button>
          <button
            type="button"
            onClick={handlePrint}
            disabled={!labelUrl || printing || preparing}
            className="rounded-lg bg-[#ff6900] px-4 py-3 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50"
          >
            {preparing ? 'Preparing…' : printing ? 'Opening…' : 'OK — print'}
          </button>
        </div>
      </div>
    </div>
  );
};
