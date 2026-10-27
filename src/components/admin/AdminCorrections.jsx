import { useEffect, useRef, useState } from 'react';
import ConfirmationModal from '../common/ConfirmationModal';
import { showToast } from '../../utils/toast';
import { MAX_FBA_BOX_WEIGHT_KG } from '../../utils/boxWeight';

// Admin-only fixes for mistakes a client (or staff member) made: wrong SKU / FNSKU / quantity on a
// shipment line, a wrong FNSKU label file, and wrong box sizes or boxes that shouldn't exist.
// The server enforces the rules (admin only, nothing once invoiced) — these screens just surface its answers.

const smallButton =
  'rounded-md border border-[#d6dfef] bg-white px-2.5 py-1.5 text-[10px] font-semibold uppercase tracking-wide text-[#5f6d85] hover:bg-[#f8fbff] disabled:cursor-not-allowed disabled:opacity-60';
const dangerButton =
  'rounded-md border border-red-200 bg-white px-2.5 py-1.5 text-[10px] font-semibold uppercase tracking-wide text-red-600 hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-60';
const inputClass =
  'w-full rounded-lg border border-gray-200 px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#ff6900]';

const Field = ({ label, hint, children }) => (
  <label className="block">
    <span className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wide text-gray-500">{label}</span>
    {children}
    {hint ? <span className="mt-1 block text-[11px] text-gray-400">{hint}</span> : null}
  </label>
);

const ModalShell = ({ title, subtitle, children, error, saving, saveLabel, onSave, onClose }) => (
  <div className="fixed inset-0 z-[150] flex items-center justify-center bg-black/45 px-4">
    <form
      onSubmit={(event) => {
        event.preventDefault();
        onSave();
      }}
      className="w-full max-w-md rounded-xl bg-white shadow-2xl"
    >
      <div className="border-b border-gray-100 px-6 py-5">
        <h2 className="text-lg font-semibold text-[#132347]">{title}</h2>
        {subtitle ? <p className="mt-1 text-sm text-gray-500">{subtitle}</p> : null}
      </div>
      <div className="space-y-4 px-6 py-5">
        {children}
        {error ? <p className="rounded-lg bg-red-50 px-3 py-2 text-sm font-medium text-red-700">{error}</p> : null}
      </div>
      <div className="flex justify-end gap-3 border-t border-gray-100 px-6 py-4">
        <button type="button" onClick={onClose} disabled={saving} className="rounded-lg border border-gray-300 px-4 py-2.5 text-sm font-semibold text-gray-700 disabled:opacity-60">
          Cancel
        </button>
        <button type="submit" disabled={saving} className="rounded-lg bg-[#ff8c2f] px-4 py-2.5 text-sm font-semibold text-white hover:bg-[#f47b14] disabled:opacity-60">
          {saving ? 'Saving…' : saveLabel}
        </button>
      </div>
    </form>
  </div>
);

const textValue = (value) => (value === null || value === undefined ? '' : String(value));

// ---------------------------------------------------------------- shipment line (SKU / FNSKU / qty / label)

const EditLineModal = ({ item, shipmentId, clientId, apiBaseUrl, buildHeaders, parseResponse, onClose, onSaved }) => {
  const [form, setForm] = useState({
    sku: textValue(item.sku),
    fnsku: textValue(item.fnsku),
    barcode: textValue(item.barcode),
    qtyExpected: textValue(item.qtyExpected),
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [products, setProducts] = useState([]);

  // Suggest this client's real SKUs so a fix is a pick, not a retype.
  useEffect(() => {
    if (!clientId) return undefined;
    let cancelled = false;
    (async () => {
      try {
        const response = await fetch(`${apiBaseUrl}/api/products?clientId=${encodeURIComponent(clientId)}&status=active`, {
          headers: buildHeaders(),
        });
        const payload = await parseResponse(response);
        const rows = payload?.data ?? payload;
        if (!cancelled && Array.isArray(rows)) setProducts(rows);
      } catch {
        // Suggestions are optional.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [clientId, apiBaseUrl, buildHeaders, parseResponse]);

  const set = (key) => (event) => {
    setError('');
    setForm((current) => ({ ...current, [key]: event.target.value }));
  };

  const save = async () => {
    const body = {};
    const sku = form.sku.trim();
    const fnsku = form.fnsku.trim();
    const barcode = form.barcode.trim();
    if (!sku || !fnsku) {
      setError('SKU and FNSKU can’t be empty.');
      return;
    }
    if (sku !== textValue(item.sku).trim()) body.sku = sku;
    if (fnsku !== textValue(item.fnsku).trim()) body.fnsku = fnsku;
    if (barcode !== textValue(item.barcode).trim()) body.barcode = barcode || null;
    if (form.qtyExpected !== '' && Number(form.qtyExpected) !== Number(item.qtyExpected)) {
      const qty = Number(form.qtyExpected);
      if (!Number.isInteger(qty) || qty < 0) {
        setError('Quantity must be a whole number (0 or more).');
        return;
      }
      body.qtyExpected = qty;
    }
    if (!Object.keys(body).length) {
      onClose();
      return;
    }
    try {
      setSaving(true);
      const response = await fetch(`${apiBaseUrl}/api/shipments/${encodeURIComponent(shipmentId)}/line-items/${encodeURIComponent(item.id)}`, {
        method: 'PATCH',
        headers: buildHeaders(true),
        body: JSON.stringify(body),
      });
      const payload = await parseResponse(response);
      const data = payload?.data ?? payload;
      showToast(
        'success',
        data?.labelMayNeedReplacing
          ? 'Line corrected. The FNSKU changed, so replace its label file too.'
          : 'Line corrected.',
      );
      onSaved();
    } catch (requestError) {
      setError(requestError?.message || 'Could not save the change.');
      setSaving(false);
    }
  };

  return (
    <ModalShell title="Correct this line" subtitle="Fix what was entered wrong. Every change is recorded in the audit log." saving={saving} saveLabel="Save correction" error={error} onSave={save} onClose={onClose}>
      <Field label="SKU" hint="Changing it moves the line to that product (barcode and name follow).">
        <input className={inputClass} list="admin-fix-skus" value={form.sku} onChange={set('sku')} autoComplete="off" />
        <datalist id="admin-fix-skus">
          {products.map((product) => (
            <option key={product.id} value={product.sku}>
              {product.product_name}
            </option>
          ))}
        </datalist>
      </Field>
      <Field label="FNSKU">
        <input className={inputClass} value={form.fnsku} onChange={set('fnsku')} autoComplete="off" />
      </Field>
      <Field label="Barcode (EAN / UPC)">
        <input className={inputClass} inputMode="numeric" value={form.barcode} onChange={set('barcode')} autoComplete="off" />
      </Field>
      <Field label="Expected quantity">
        <input className={inputClass} type="number" inputMode="numeric" min="0" step="1" value={form.qtyExpected} onChange={set('qtyExpected')} />
      </Field>
    </ModalShell>
  );
};

export const LineItemAdminTools = ({ item, shipmentId, clientId, apiBaseUrl = '', buildHeaders, parseResponse, onChanged }) => {
  const [editing, setEditing] = useState(false);
  const [confirm, setConfirm] = useState(null); // 'delete' | 'removeLabel'
  const [busy, setBusy] = useState(false);
  const fileInput = useRef(null);

  const run = async (work, successMessage) => {
    try {
      setBusy(true);
      await work();
      showToast('success', successMessage);
      onChanged();
    } catch (requestError) {
      showToast('error', requestError?.message || 'That didn’t work.');
    } finally {
      setBusy(false);
      setConfirm(null);
    }
  };

  const replaceLabel = (file) =>
    run(async () => {
      const form = new FormData();
      form.append('file', file, file.name);
      form.append('entityType', 'item');
      form.append('entityId', item.id);
      form.append('fileType', 'fnsku_label');
      if (item.fnsku) form.append('fnsku', item.fnsku);
      if (item.sku) form.append('sku', item.sku);
      const response = await fetch(`${apiBaseUrl}/api/files`, { method: 'POST', headers: buildHeaders(), body: form });
      await parseResponse(response);
    }, 'FNSKU label replaced.');

  return (
    <>
      <div className="flex flex-wrap justify-end gap-1.5">
        <button type="button" className={smallButton} disabled={busy} onClick={() => setEditing(true)}>
          Edit
        </button>
        <button type="button" className={smallButton} disabled={busy} onClick={() => fileInput.current?.click()}>
          {item.labelFileId ? 'Replace label' : 'Add label'}
        </button>
        {item.labelFileId ? (
          <button type="button" className={smallButton} disabled={busy} onClick={() => setConfirm('removeLabel')}>
            Remove label
          </button>
        ) : null}
        <button type="button" className={dangerButton} disabled={busy} onClick={() => setConfirm('delete')}>
          Delete
        </button>
        <input
          ref={fileInput}
          type="file"
          accept=".pdf,.csv,application/pdf,text/csv,image/*"
          className="hidden"
          onChange={(event) => {
            const file = event.target.files?.[0];
            event.target.value = '';
            if (file) replaceLabel(file);
          }}
        />
      </div>

      {editing ? (
        <EditLineModal
          item={item}
          shipmentId={shipmentId}
          clientId={clientId}
          apiBaseUrl={apiBaseUrl}
          buildHeaders={buildHeaders}
          parseResponse={parseResponse}
          onClose={() => setEditing(false)}
          onSaved={() => {
            setEditing(false);
            onChanged();
          }}
        />
      ) : null}

      <ConfirmationModal
        open={confirm === 'removeLabel'}
        title="Remove this FNSKU label?"
        message={`The label file for ${item.sku || 'this line'} will be taken off the line. You can add the right one afterwards.`}
        confirmLabel="Remove label"
        tone="danger"
        loading={busy}
        onCancel={() => setConfirm(null)}
        onConfirm={() =>
          run(async () => {
            const response = await fetch(`${apiBaseUrl}/api/files/${encodeURIComponent(item.labelFileId)}`, {
              method: 'DELETE',
              headers: buildHeaders(),
            });
            await parseResponse(response);
          }, 'FNSKU label removed.')
        }
      />
      <ConfirmationModal
        open={confirm === 'delete'}
        title={`Delete ${item.sku || 'this line'}?`}
        message="This removes the line from the shipment. It can't be undone, and it's blocked if any of it is already in a box."
        confirmLabel="Delete line"
        tone="danger"
        loading={busy}
        onCancel={() => setConfirm(null)}
        onConfirm={() =>
          run(async () => {
            const response = await fetch(`${apiBaseUrl}/api/shipments/${encodeURIComponent(shipmentId)}/line-items/${encodeURIComponent(item.id)}`, {
              method: 'DELETE',
              headers: buildHeaders(),
            });
            await parseResponse(response);
          }, 'Line deleted.')
        }
      />
    </>
  );
};

// ---------------------------------------------------------------- box (size / weight / delete)

const EditBoxModal = ({ box, apiBaseUrl, buildHeaders, parseResponse, onClose, onSaved }) => {
  const [form, setForm] = useState({
    lengthCm: textValue(box.lengthCm),
    widthCm: textValue(box.widthCm),
    heightCm: textValue(box.heightCm),
    weightKg: textValue(box.weightKg),
  });
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const set = (key) => (event) => {
    setError('');
    setForm((current) => ({ ...current, [key]: event.target.value }));
  };

  const weightChanged = form.weightKg !== '' && Number(form.weightKg) !== Number(box.weightKg);
  const overLimit = !box.isPallet && weightChanged && Number(form.weightKg) > MAX_FBA_BOX_WEIGHT_KG;

  const save = async () => {
    const body = {};
    for (const key of ['lengthCm', 'widthCm', 'heightCm']) {
      if (form[key] === '') continue;
      const value = Number(form[key]);
      if (!Number.isFinite(value) || value < 0) {
        setError('Sizes must be numbers (0 or more).');
        return;
      }
      if (value !== Number(box[key])) body[key] = value;
    }
    if (weightChanged) {
      const weight = Number(form.weightKg);
      if (!Number.isFinite(weight) || weight < 0) {
        setError('Weight must be a number (0 or more).');
        return;
      }
      body.weightKg = weight;
      if (overLimit) {
        if (!reason.trim()) {
          setError(`Enter a reason to put a box over ${MAX_FBA_BOX_WEIGHT_KG} kg.`);
          return;
        }
        body.weightOverride = true;
        body.weightOverrideReason = reason.trim();
      }
    }
    if (!Object.keys(body).length) {
      onClose();
      return;
    }
    try {
      setSaving(true);
      const response = await fetch(`${apiBaseUrl}/api/boxes/${encodeURIComponent(box.id)}`, {
        method: 'PATCH',
        headers: buildHeaders(true),
        body: JSON.stringify(body),
      });
      await parseResponse(response);
      showToast('success', 'Box corrected.');
      onSaved();
    } catch (requestError) {
      setError(requestError?.message || 'Could not save the change.');
      setSaving(false);
    }
  };

  return (
    <ModalShell
      title={`Correct ${box.label || 'box'}`}
      subtitle={box.sealed ? 'This box is already sealed. Sizes and weight can still be fixed; the change is logged.' : 'Fix a wrong size or weight. The change is logged.'}
      saving={saving}
      saveLabel="Save correction"
      error={error}
      onSave={save}
      onClose={onClose}
    >
      <div className="grid grid-cols-3 gap-3">
        <Field label="Length (cm)">
          <input className={inputClass} type="number" inputMode="decimal" step="0.1" min="0" value={form.lengthCm} onChange={set('lengthCm')} />
        </Field>
        <Field label="Width (cm)">
          <input className={inputClass} type="number" inputMode="decimal" step="0.1" min="0" value={form.widthCm} onChange={set('widthCm')} />
        </Field>
        <Field label="Height (cm)">
          <input className={inputClass} type="number" inputMode="decimal" step="0.1" min="0" value={form.heightCm} onChange={set('heightCm')} />
        </Field>
      </div>
      <Field label="Weight (kg)">
        <input className={inputClass} type="number" inputMode="decimal" step="0.01" min="0" value={form.weightKg} onChange={set('weightKg')} />
      </Field>
      {overLimit ? (
        <Field label={`Reason for going over ${MAX_FBA_BOX_WEIGHT_KG} kg`} hint="Saved in the audit log.">
          <textarea className={inputClass} rows={2} value={reason} onChange={(event) => { setError(''); setReason(event.target.value); }} />
        </Field>
      ) : null}
    </ModalShell>
  );
};

// What is IN the box: which SKUs and how many units of each. Replaces the whole list.
const EditContentsModal = ({ box, lineChoices, apiBaseUrl, buildHeaders, parseResponse, onClose, onSaved }) => {
  const choiceById = new Map(lineChoices.map((choice) => [choice.id, choice]));
  const [rows, setRows] = useState(() =>
    box.contentRows.length
      ? box.contentRows.map((row) => ({ shipmentItemId: row.shipmentItemId, quantity: textValue(row.quantity) }))
      : [{ shipmentItemId: lineChoices[0]?.id || '', quantity: '' }],
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const update = (index, patch) => {
    setError('');
    setRows((current) => current.map((row, rowIndex) => (rowIndex === index ? { ...row, ...patch } : row)));
  };

  const save = async () => {
    const items = [];
    for (const [index, row] of rows.entries()) {
      const quantity = Number(row.quantity);
      if (!row.shipmentItemId) {
        setError(`Row ${index + 1}: pick a SKU.`);
        return;
      }
      if (!Number.isInteger(quantity) || quantity <= 0) {
        setError(`Row ${index + 1}: units must be a whole number above 0.`);
        return;
      }
      items.push({ shipmentItemId: row.shipmentItemId, quantity });
    }
    if (new Set(items.map((item) => item.shipmentItemId)).size !== items.length) {
      setError('Each SKU can only appear once \u2014 combine the units into one row.');
      return;
    }
    try {
      setSaving(true);
      const response = await fetch(`${apiBaseUrl}/api/boxes/${encodeURIComponent(box.id)}/contents`, {
        method: 'PUT',
        headers: buildHeaders(true),
        body: JSON.stringify({ items }),
      });
      await parseResponse(response);
      showToast('success', 'Box contents corrected.');
      onSaved(items.map((item) => ({ ...item, sku: choiceById.get(item.shipmentItemId)?.sku || '' })));
    } catch (requestError) {
      setError(requestError?.message || 'Could not save the change.');
      setSaving(false);
    }
  };

  return (
    <ModalShell
      title={`What's in ${box.label || 'this box'}`}
      subtitle="Fix a wrong SKU or unit count. Only received units can be packed, and never more than are left unpacked."
      saving={saving}
      saveLabel="Save contents"
      error={error}
      onSave={save}
      onClose={onClose}
    >
      <div className="space-y-2">
        {rows.map((row, index) => (
          <div key={index} className="flex items-end gap-2">
            <div className="min-w-0 flex-1">
              <Field label={index === 0 ? 'SKU' : ''}>
                <select className={inputClass} value={row.shipmentItemId} onChange={(event) => update(index, { shipmentItemId: event.target.value })}>
                  <option value="">Select SKU</option>
                  {lineChoices.map((choice) => (
                    <option key={choice.id} value={choice.id}>
                      {choice.sku} {choice.received !== '' ? `(received ${choice.received})` : ''}
                    </option>
                  ))}
                </select>
              </Field>
            </div>
            <div className="w-24">
              <Field label={index === 0 ? 'Units' : ''}>
                <input className={inputClass} type="number" inputMode="numeric" min="1" step="1" value={row.quantity} onChange={(event) => update(index, { quantity: event.target.value })} />
              </Field>
            </div>
            <button
              type="button"
              aria-label="Remove row"
              disabled={rows.length === 1}
              onClick={() => setRows((current) => current.filter((_row, rowIndex) => rowIndex !== index))}
              className="mb-1 rounded-md border border-gray-200 px-2.5 py-2 text-sm text-gray-500 hover:bg-gray-50 disabled:opacity-40"
            >
              &times;
            </button>
          </div>
        ))}
      </div>
      <button type="button" onClick={() => setRows((current) => [...current, { shipmentItemId: '', quantity: '' }])} className={smallButton}>
        + Add another SKU
      </button>
    </ModalShell>
  );
};

export const BoxAdminTools = ({ box, lineChoices = [], apiBaseUrl = '', buildHeaders, parseResponse, onChanged, onContentsSaved }) => {
  const [editing, setEditing] = useState(false);
  const [editingContents, setEditingContents] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [busy, setBusy] = useState(false);

  const deleteBox = async () => {
    try {
      setBusy(true);
      const response = await fetch(`${apiBaseUrl}/api/boxes/${encodeURIComponent(box.id)}`, {
        method: 'DELETE',
        headers: buildHeaders(),
      });
      await parseResponse(response);
      showToast('success', 'Box deleted.');
      onChanged();
    } catch (requestError) {
      showToast('error', requestError?.message || 'Could not delete the box.');
    } finally {
      setBusy(false);
      setConfirmDelete(false);
    }
  };

  return (
    <>
      <div className="mt-3 flex flex-wrap gap-1.5 border-t border-dashed border-[#e3eaf5] pt-3">
        <button type="button" className={smallButton} disabled={busy} onClick={() => setEditing(true)}>
          Correct size / weight
        </button>
        {!box.isPallet ? (
          <button type="button" className={smallButton} disabled={busy} onClick={() => setEditingContents(true)}>
            Edit contents
          </button>
        ) : null}
        <button type="button" className={dangerButton} disabled={busy} onClick={() => setConfirmDelete(true)}>
          Delete {box.isPallet ? 'pallet' : 'box'}
        </button>
      </div>
      {editingContents ? (
        <EditContentsModal
          box={box}
          lineChoices={lineChoices}
          apiBaseUrl={apiBaseUrl}
          buildHeaders={buildHeaders}
          parseResponse={parseResponse}
          onClose={() => setEditingContents(false)}
          onSaved={(items) => {
            setEditingContents(false);
            onContentsSaved?.(items);
            onChanged();
          }}
        />
      ) : null}
      {editing ? (
        <EditBoxModal
          box={box}
          apiBaseUrl={apiBaseUrl}
          buildHeaders={buildHeaders}
          parseResponse={parseResponse}
          onClose={() => setEditing(false)}
          onSaved={() => {
            setEditing(false);
            onChanged();
          }}
        />
      ) : null}
      <ConfirmationModal
        open={confirmDelete}
        title={`Delete ${box.label || 'this box'}?`}
        message={
          box.sealed
            ? 'This box is already sealed. Deleting it takes it off the shipment, and the units go back to unpacked. Blocked once the shipment is dispatched and invoiced.'
            : 'The units in it go back to unpacked. This can’t be undone.'
        }
        confirmLabel={`Delete ${box.isPallet ? 'pallet' : 'box'}`}
        tone="danger"
        loading={busy}
        onCancel={() => setConfirmDelete(false)}
        onConfirm={deleteBox}
      />
    </>
  );
};
