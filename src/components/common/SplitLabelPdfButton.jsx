import { useState } from 'react';
import { getScanLineItemFnsku, getScanLineItemSku } from '../../utils/barcodeMatch';

const text = (value) => String(value ?? '').trim();

const getLabelFile = (item = {}) => item?.fnskuLabelFile || item?.fnsku_label_file || null;

const getLabelFileId = (item = {}) => {
  const file = getLabelFile(item) || {};
  return text(item?.fnskuLabelFileId || item?.fnsku_label_file_id || file?.fileId || file?.file_id || file?.id);
};

const getLabelFileName = (item = {}) => {
  const file = getLabelFile(item) || {};
  return text(file?.fileName || file?.file_name || file?.originalFilename || file?.original_filename || file?.name);
};

// The client's multi-product PDF is attached to one or more lines; list each PDF once.
const collectPdfLabelFiles = (lineItems = []) => {
  const byId = new Map();
  for (const item of lineItems) {
    const id = getLabelFileId(item);
    if (!id) continue;
    const file = getLabelFile(item) || {};
    const name = getLabelFileName(item);
    const mime = text(file?.mimeType || file?.mime_type);
    if (!/\.pdf$/i.test(name) && !/pdf/i.test(mime)) continue;
    if (file?.metadata?.splitFromFileId) continue;
    const entry = byId.get(id) || { id, name: name || 'Label PDF', skus: [] };
    entry.skus.push(getScanLineItemSku(item) || getScanLineItemFnsku(item) || '?');
    byId.set(id, entry);
  }
  return [...byId.values()];
};

// Staff pick the client's big label PDF and the backend cuts it into one label file per shipment line.
const SplitLabelPdfButton = ({ shipmentId, lineItems = [], apiBaseUrl = '', buildHeaders, parseResponse, onDone, className = '' }) => {
  const [open, setOpen] = useState(false);
  const [fileId, setFileId] = useState('');
  const [overwrite, setOverwrite] = useState(false);
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');

  const files = collectPdfLabelFiles(lineItems);
  const selectedFileId = fileId || files[0]?.id || '';

  const close = () => {
    setOpen(false);
    setResult(null);
    setError('');
    if (result?.split?.length) onDone?.();
  };

  const runSplit = async () => {
    if (!selectedFileId || !shipmentId) return;
    try {
      setRunning(true);
      setError('');
      const response = await fetch(`${apiBaseUrl}/api/shipments/${encodeURIComponent(shipmentId)}/fnsku-labels/split`, {
        method: 'POST',
        headers: buildHeaders(true),
        body: JSON.stringify({ fileId: selectedFileId, overwrite }),
      });
      const payload = await parseResponse(response);
      setResult(payload?.data ?? payload);
    } catch (requestError) {
      setError(requestError?.message || 'Could not split the PDF.');
    } finally {
      setRunning(false);
    }
  };

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={`rounded-lg border border-gray-200 bg-white px-4 py-2 text-sm font-semibold text-[#132347] hover:bg-gray-50 ${className}`}
      >
        Split label PDF
      </button>

      {open ? (
        <div className="fixed inset-0 z-[160] flex items-center justify-center bg-black/45 px-4">
          <div className="flex max-h-[90vh] w-full max-w-lg flex-col rounded-xl bg-white shadow-2xl">
            <div className="border-b border-gray-100 px-6 py-5">
              <h2 className="text-lg font-semibold text-[#132347]">Split a multi-product label PDF</h2>
              <p className="mt-1 text-sm text-gray-600">
                Finds each product's FNSKU in the client's PDF and saves just those pages as that line's label.
              </p>
            </div>

            <div className="space-y-4 overflow-y-auto px-6 py-5">
              {!result ? (
                files.length ? (
                  <>
                    <div className="space-y-2">
                      {files.map((file) => (
                        <label
                          key={file.id}
                          className={`flex cursor-pointer items-start gap-3 rounded-lg border px-4 py-3 ${
                            selectedFileId === file.id ? 'border-[#ff6900] bg-orange-50' : 'border-gray-200'
                          }`}
                        >
                          <input
                            type="radio"
                            name="split-label-file"
                            checked={selectedFileId === file.id}
                            onChange={() => setFileId(file.id)}
                            className="mt-1"
                          />
                          <span>
                            <span className="block text-sm font-semibold text-gray-900">{file.name}</span>
                            <span className="block text-xs text-gray-500">Attached to {file.skus.join(', ')}</span>
                          </span>
                        </label>
                      ))}
                    </div>
                    <label className="flex items-center gap-2 text-sm text-gray-700">
                      <input type="checkbox" checked={overwrite} onChange={(event) => setOverwrite(event.target.checked)} />
                      Replace labels that lines already have
                    </label>
                  </>
                ) : (
                  <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800">
                    No PDF label files on this shipment yet. Upload the client's label PDF on any line first.
                  </p>
                )
              ) : (
                <>
                  <p className="rounded-lg bg-green-50 px-3 py-2 text-sm font-medium text-green-700">
                    Read {result.totalPages} pages · {result.fnskusInPdf} FNSKUs · made {result.split?.length || 0} label{' '}
                    {result.split?.length === 1 ? 'file' : 'files'}.
                  </p>
                  {result.split?.length ? (
                    <ul className="divide-y divide-gray-100 rounded-lg border border-gray-200 text-sm">
                      {result.split.map((row) => (
                        <li key={row.lineItemId} className="flex justify-between gap-3 px-3 py-2">
                          <span className="font-medium text-gray-900">{row.sku}</span>
                          <span className="text-gray-500">
                            {row.fnsku} · {row.labels} {row.labels === 1 ? 'label' : 'labels'}
                          </span>
                        </li>
                      ))}
                    </ul>
                  ) : null}
                  {result.skipped?.length ? (
                    <div>
                      <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-amber-700">Not split</p>
                      <ul className="space-y-1 text-sm text-gray-700">
                        {result.skipped.map((row) => (
                          <li key={row.lineItemId}>
                            <span className="font-medium">{row.sku}</span> ({row.fnsku}) — {row.reason}
                          </li>
                        ))}
                      </ul>
                    </div>
                  ) : null}
                  {result.notInShipment?.length ? (
                    <p className="text-xs text-gray-500">
                      In the PDF but not on this shipment: {result.notInShipment.join(', ')}
                    </p>
                  ) : null}
                </>
              )}
              {error ? <p className="text-sm font-medium text-red-600">{error}</p> : null}
            </div>

            <div className="flex justify-end gap-3 border-t border-gray-100 px-6 py-4">
              <button type="button" onClick={close} disabled={running} className="rounded-lg border border-gray-300 px-4 py-2.5 text-sm font-semibold text-gray-700 disabled:opacity-60">
                {result ? 'Done' : 'Cancel'}
              </button>
              {!result && files.length ? (
                <button
                  type="button"
                  onClick={runSplit}
                  disabled={running || !selectedFileId}
                  className="rounded-lg bg-[#ff6900] px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-60"
                >
                  {running ? 'Splitting…' : 'Split PDF'}
                </button>
              ) : null}
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
};

export default SplitLabelPdfButton;
