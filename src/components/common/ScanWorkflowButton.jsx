import { useState } from 'react';
import BarcodeScanner from './BarcodeScanner';
import ScanMatchChooser from './ScanMatchChooser';
import { ReceiveDialog, PrintDialog } from './ScanDialogs';
import { findLineItemsByScan, getScanLineItemFnsku, getScanLineItemId } from '../../utils/barcodeMatch';
import { getReceivingLineRemainingQty, formatReceivingQuantity } from '../../utils/receiving';

// One scan does the whole job in sequence: check the count against the system (fixing any
// discrepancy), then immediately offer to print that product's FNSKU labels.
// onReceive(item, receivedQty) must save and throw on failure.
const ScanWorkflowButton = ({ lineItems = [], onReceive, label = 'Scan', className = '' }) => {
  const [scanning, setScanning] = useState(false);
  const [choice, setChoice] = useState(null);
  // active: { item, matchedBy, code, stage: 'receive' | 'print' }
  const [active, setActive] = useState(null);
  const [notice, setNotice] = useState('');

  const handleDetected = (code) => {
    setScanning(false);
    const matches = findLineItemsByScan(lineItems, code);
    if (!matches.length) {
      setNotice(`No product in this shipment matches “${code}”. Check the barcode is saved on the product, or enter the quantity by hand below.`);
      return;
    }
    if (matches.length === 1) {
      setActive({ ...matches[0], code, stage: 'receive' });
      return;
    }
    setChoice({ code, matches });
  };

  return (
    <div className={className}>
      <button
        type="button"
        onClick={() => {
          setNotice('');
          setScanning(true);
        }}
        className="w-full rounded-lg bg-[#132347] px-4 py-3 text-sm font-semibold text-white hover:bg-[#0f1b38]"
      >
        {label}
      </button>
      {notice ? <p className="mt-2 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800">{notice}</p> : null}

      {scanning ? <BarcodeScanner title={label} onDetected={handleDetected} onClose={() => setScanning(false)} /> : null}

      {choice ? (
        <ScanMatchChooser
          code={choice.code}
          matches={choice.matches}
          describe={(item) =>
            `${getScanLineItemFnsku(item) ? `FNSKU ${getScanLineItemFnsku(item)} · ` : ''}${formatReceivingQuantity(getReceivingLineRemainingQty(item))} still due`
          }
          onCancel={() => setChoice(null)}
          onPick={(item) => {
            setActive({ item, matchedBy: 'your choice', code: choice.code, stage: 'receive' });
            setChoice(null);
          }}
        />
      ) : null}

      {active?.stage === 'receive' ? (
        <ReceiveDialog
          key={`${getScanLineItemId(active.item)}-${active.code}-receive`}
          item={active.item}
          matchedBy={active.matchedBy}
          onCancel={() => setActive(null)}
          onConfirm={async (quantity) => {
            await onReceive(active.item, quantity);
            setNotice('');
            // Same scan, same product — move straight to the print step, don't make them scan again.
            setActive((current) => (current ? { ...current, stage: 'print' } : current));
          }}
        />
      ) : null}

      {active?.stage === 'print' ? (
        <PrintDialog
          key={`${getScanLineItemId(active.item)}-${active.code}-print`}
          item={active.item}
          matchedBy={active.matchedBy}
          onClose={() => setActive(null)}
          onScanNext={() => {
            setActive(null);
            setScanning(true);
          }}
        />
      ) : null}
    </div>
  );
};

export default ScanWorkflowButton;
