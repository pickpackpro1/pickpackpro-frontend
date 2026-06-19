const RECENT_SHIPMENT_TTL_MS = 10 * 60 * 1000;
const RECENT_SHIPMENT_LIMIT = 25;

const canUseSessionStorage = () =>
  typeof window !== 'undefined' && typeof window.sessionStorage !== 'undefined';

const getRecentShipmentKeys = (shipment = {}) =>
  [
    shipment?.id,
    shipment?.uuid,
    shipment?.shipmentId,
    shipment?.shipment_id,
    shipment?.recordId,
    shipment?.record_id,
    shipment?.reference,
    shipment?.shipmentNumber,
    shipment?.shipment_number,
  ]
    .map((value) => String(value || '').trim())
    .filter(Boolean);

const readRecentShipmentEntries = (storageKey = '') => {
  if (!storageKey || !canUseSessionStorage()) return [];

  try {
    const payload = JSON.parse(window.sessionStorage.getItem(storageKey) || '{}');
    const sourceEntries = Array.isArray(payload?.entries)
      ? payload.entries
      : Array.isArray(payload)
        ? payload.map((row) => ({ row, savedAt: Date.now() }))
        : [];
    const now = Date.now();

    return sourceEntries
      .filter((entry) => entry?.row && typeof entry.row === 'object')
      .filter((entry) => now - Number(entry.savedAt || 0) <= RECENT_SHIPMENT_TTL_MS);
  } catch {
    return [];
  }
};

const writeRecentShipmentEntries = (storageKey = '', entries = []) => {
  if (!storageKey || !canUseSessionStorage()) return;

  try {
    window.sessionStorage.setItem(
      storageKey,
      JSON.stringify({ entries: entries.slice(0, RECENT_SHIPMENT_LIMIT) })
    );
  } catch {
    // This cache is only used to bridge stale list refreshes.
  }
};

export const readRecentShipmentRows = (storageKey = '') =>
  readRecentShipmentEntries(storageKey).map((entry) => entry.row);

export const rememberRecentShipmentRows = (storageKey = '', rows = []) => {
  const nextRows = (Array.isArray(rows) ? rows : [rows]).filter(Boolean);
  if (!nextRows.length) return;

  const now = Date.now();
  const mergedEntries = new Map();

  readRecentShipmentEntries(storageKey).forEach((entry) => {
    const key = getRecentShipmentKeys(entry.row)[0];
    if (key) mergedEntries.set(key, entry);
  });

  nextRows.forEach((row) => {
    const key = getRecentShipmentKeys(row)[0];
    if (!key) return;
    mergedEntries.set(key, { row, savedAt: now });
  });

  const entries = [...mergedEntries.values()].sort(
    (firstEntry, secondEntry) => Number(secondEntry.savedAt || 0) - Number(firstEntry.savedAt || 0)
  );
  writeRecentShipmentEntries(storageKey, entries);
};

export const forgetRecentShipmentRows = (storageKey = '', lookupKeys = []) => {
  const keysToRemove = new Set(
    (Array.isArray(lookupKeys) ? lookupKeys : [lookupKeys])
      .map((value) => String(value || '').trim())
      .filter(Boolean)
  );

  if (!keysToRemove.size) return;

  const entries = readRecentShipmentEntries(storageKey).filter((entry) =>
    !getRecentShipmentKeys(entry.row).some((key) => keysToRemove.has(key))
  );
  writeRecentShipmentEntries(storageKey, entries);
};
