import { useState } from 'react';
import BarcodeScanner from './BarcodeScanner';
import { ReceiveDialog, PrintDialog } from './ScanDialogs';

const groupBy = (list, keyFn) => {
  const map = new Map();
  for (const item of list) {
    const key = keyFn(item);
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(item);
  }
  return [...map.entries()];
};

const PickList = ({ title, subtitle, groups, render, onPick, onCancel }) => (
  <div className="fixed inset-0 z-[160] flex items-center justify-center bg-black/45 px-4">
    <div className="w-full max-w-md rounded-xl bg-white shadow-2xl">
      <div className="border-b border-gray-100 px-6 py-5">
        <h2 className="text-lg font-semibold text-[#132347]">{title}</h2>
        {subtitle ? <p className="mt-1 text-sm text-gray-600">{subtitle}</p> : null}
      </div>
      <div className="max-h-[60vh] space-y-2 overflow-y-auto px-6 py-4">
        {groups.map(([key, matches]) => (
          <button
            key={key}
            type="button"
            onClick={() => onPick(key, matches)}
            className="w-full rounded-lg border border-gray-200 px-4 py-3 text-left hover:border-[#ff6900] hover:bg-orange-50"
          >
            {render(matches)}
          </button>
        ))}
      </div>
      <div className="flex justify-end border-t border-gray-100 px-6 py-4">
        <button type="button" onClick={onCancel} className="rounded-lg border border-gray-300 px-4 py-2.5 text-sm font-semibold text-gray-700">
          Cancel
        </button>
      </div>
    </div>
  </div>
);

// Scan a code with no shipment open yet. Searches every client's pending/in-progress shipments
// (GET /api/scan/lookup?mode=any), narrows client -> shipment -> line item, then runs the same
// receive-check -> print flow as the per-shipment scan button.
// onReceive(shipmentId, match, receivedQty) must save and throw on failure.
const GlobalScanButton = ({ apiBaseUrl = '', buildHeaders, parseResponse, onReceive, label = 'Scan (any client)', className = '' }) => {
  const [scanning, setScanning] = useState(false);
  const [loading, setLoading] = useState(false);
  const [notice, setNotice] = useState('');
  const [scannedCode, setScannedCode] = useState('');
  const [matches, setMatches] = useState(null);
  const [clientId, setClientId] = useState(null);
  const [shipmentId, setShipmentId] = useState(null);
  const [stage, setStage] = useState('receive'); // 'receive' | 'print' — only used once resolved to one line

  const reset = () => {
    setMatches(null);
    setClientId(null);
    setShipmentId(null);
    setStage('receive');
  };

  const handleDetected = async (code) => {
    setScanning(false);
    setScannedCode(code);
    reset();
    try {
      setLoading(true);
      setNotice('');
      const response = await fetch(`${apiBaseUrl}/api/scan/lookup?code=${encodeURIComponent(code)}&mode=any`, {
        headers: buildHeaders(),
      });
      const payload = await parseResponse(response);
      const found = payload?.data?.matches ?? payload?.matches ?? [];
      if (!found.length) {
        setNotice(`No pending shipment matches “${code}”.`);
        return;
      }
      setMatches(found);
    } catch (requestError) {
      setNotice(requestError?.message || 'Could not look up that code.');
    } finally {
      setLoading(false);
    }
  };

  const byClient = matches ? groupBy(matches, (m) => m.clientId) : [];
  const clientMatches = clientId ? matches.filter((m) => m.clientId === clientId) : matches ?? [];
  const byShipment = matches && (byClient.length === 1 || clientId) ? groupBy(clientMatches, (m) => m.shipmentId) : [];
  const shipmentMatches = shipmentId ? clientMatches.filter((m) => m.shipmentId === shipmentId) : clientMatches;

  const needsClientPick = matches && byClient.length > 1 && !clientId;
  const needsShipmentPick = matches && !needsClientPick && byShipment.length > 1 && !shipmentId;
  const resolved = matches && !needsClientPick && !needsShipmentPick ? shipmentMatches[0] : null;

  return (
    <div className={className}>
      <button
        type="button"
        onClick={() => {
          setNotice('');
          setScanning(true);
        }}
        className="rounded-lg bg-[#132347] px-4 py-2 text-sm font-semibold text-white hover:bg-[#0f1b38]"
      >
        {label}
      </button>
      {loading ? <span className="ml-2 text-xs text-gray-500">Looking up…</span> : null}
      {notice ? <p className="mt-2 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800">{notice}</p> : null}

      {scanning ? <BarcodeScanner title={label} onDetected={handleDetected} onClose={() => setScanning(false)} /> : null}

      {needsClientPick ? (
        <PickList
          title="Which client is this?"
          subtitle={`“${scannedCode}” matches products from ${byClient.length} different clients.`}
          groups={byClient}
          render={(rows) => (
            <>
              <span className="block text-sm font-semibold text-gray-900">{rows[0].clientName}</span>
              <span className="block text-xs text-gray-500">
                {new Set(rows.map((r) => r.shipmentId)).size} shipment{new Set(rows.map((r) => r.shipmentId)).size === 1 ? '' : 's'} · {rows[0].productName}
              </span>
            </>
          )}
          onPick={(pickedClientId) => setClientId(pickedClientId)}
          onCancel={reset}
        />
      ) : null}

      {needsShipmentPick ? (
        <PickList
          title="Which shipment?"
          subtitle={`${clientMatches[0].clientName} has this product on ${byShipment.length} shipments.`}
          groups={byShipment}
          render={(rows) => (
            <>
              <span className="block text-sm font-semibold text-gray-900">{rows[0].shipmentReference}</span>
              <span className="block text-xs text-gray-500">{rows[0].productName}</span>
            </>
          )}
          onPick={(pickedShipmentId) => setShipmentId(pickedShipmentId)}
          onCancel={reset}
        />
      ) : null}

      {resolved && stage === 'receive' ? (
        <ReceiveDialog
          key={`${resolved.lineItemId}-${scannedCode}-receive`}
          item={resolved}
          matchedBy={resolved.matchedBy}
          onCancel={reset}
          onConfirm={async (quantity) => {
            await onReceive(resolved.shipmentId, resolved, quantity);
            setNotice('');
            // Same scan, same product — move straight to the print step, don't make them scan again.
            setStage('print');
          }}
        />
      ) : null}

      {resolved && stage === 'print' ? (
        <PrintDialog
          key={`${resolved.lineItemId}-${scannedCode}-print`}
          item={resolved}
          matchedBy={resolved.matchedBy}
          apiBaseUrl={apiBaseUrl}
          buildHeaders={buildHeaders}
          parseResponse={parseResponse}
          onClose={reset}
          onScanNext={() => {
            reset();
            setScanning(true);
          }}
        />
      ) : null}
    </div>
  );
};

export default GlobalScanButton;
