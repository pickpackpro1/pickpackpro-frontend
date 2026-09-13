import { useState } from 'react';
import BarcodeScanner from './BarcodeScanner';
import ScanMatchChooser from './ScanMatchChooser';
import {
  findLineItemsByScan,
  getScanLineItemBarcode,
  getScanLineItemFnsku,
  getScanLineItemId,
  getScanLineItemLabelUrl,
  getScanLineItemName,
  getScanLineItemSku,
} from '../../utils/barcodeMatch';
import { printLabelUrl } from '../../utils/printLabel';

// One FNSKU label per sellable unit: bundles use dispatch qty, otherwise what was received, else what was expected.
const getLabelCount = (item = {}) => {
  const candidates = [item?.dispatchQty, item?.dispatch_qty, item?.receivedQty, item?.qty_received, item?.expectedQty, item?.qty_expected];
  for (const value of candidates) {
    const number = Number(value);
    if (value !== null && value !== undefined && value !== '' && Number.isFinite(number) && number > 0) return number;
  }
  return 0;
};

const PrintDialog = ({ item, matchedBy, onScanNext, onClose }) => {
  const labelUrl = getScanLineItemLabelUrl(item);
  const [count, setCount] = useState(String(getLabelCount(item) || 1));
  const [printing, setPrinting] = useState(false);
  const [result, setResult] = useState('');
  const [error, setError] = useState('');

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
        setResult(`Print window opened — set Copies to ${copies} (skip if the PDF already has one page per unit).`);
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
              Filled from this shipment's quantity. Change it if you need more or fewer.
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
            disabled={!labelUrl || printing}
            className="rounded-lg bg-[#ff6900] px-4 py-3 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50"
          >
            {printing ? 'Opening…' : 'OK — print'}
          </button>
        </div>
      </div>
    </div>
  );
};

// Scan a product while prepping, see how many FNSKU labels it needs, and print them.
const ScanToPrintButton = ({ lineItems = [], className = '' }) => {
  const [scanning, setScanning] = useState(false);
  const [choice, setChoice] = useState(null);
  const [active, setActive] = useState(null);
  const [notice, setNotice] = useState('');

  const handleDetected = (code) => {
    setScanning(false);
    const matches = findLineItemsByScan(lineItems, code);
    if (!matches.length) {
      setNotice(`No product in this shipment matches “${code}”.`);
      return;
    }
    setNotice('');
    if (matches.length === 1) {
      setActive({ ...matches[0], code });
      return;
    }
    setChoice({ code, matches });
  };

  return (
    <>
      <button
        type="button"
        onClick={() => {
          setNotice('');
          setScanning(true);
        }}
        className={`rounded-lg bg-[#132347] px-4 py-2 text-sm font-semibold text-white hover:bg-[#0f1b38] ${className}`}
      >
        Scan &amp; print FNSKU
      </button>
      {notice ? (
        <span role="status" className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800">
          {notice}
        </span>
      ) : null}

      {scanning ? <BarcodeScanner title="Scan to print labels" onDetected={handleDetected} onClose={() => setScanning(false)} /> : null}

      {choice ? (
        <ScanMatchChooser
          code={choice.code}
          matches={choice.matches}
          describe={(item) => `${getScanLineItemName(item)} · FNSKU ${getScanLineItemFnsku(item) || '-'} · ${getLabelCount(item)} labels`}
          onCancel={() => setChoice(null)}
          onPick={(item) => {
            setActive({ item, matchedBy: 'your choice', code: choice.code });
            setChoice(null);
          }}
        />
      ) : null}

      {active ? (
        <PrintDialog
          key={`${getScanLineItemId(active.item)}-${active.code}`}
          item={active.item}
          matchedBy={active.matchedBy}
          onClose={() => setActive(null)}
          onScanNext={() => {
            setActive(null);
            setScanning(true);
          }}
        />
      ) : null}
    </>
  );
};

export default ScanToPrintButton;
