const isPresent = (value) => value !== undefined && value !== null && value !== '';

const firstPresent = (...values) => {
  const match = values.find(isPresent);
  return match === undefined ? '' : match;
};

const toNumber = (value, fallback = 0) => {
  const numericValue = Number(value);
  return Number.isFinite(numericValue) ? numericValue : fallback;
};

const toBoolean = (value, fallback = false) => {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value !== 0;
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (['true', '1', 'yes', 'y', 'open'].includes(normalized)) return true;
    if (['false', '0', 'no', 'n', 'closed', 'resolved'].includes(normalized)) return false;
  }
  return fallback;
};

export const formatReceivingQuantity = (value = 0) => {
  const quantity = toNumber(value, 0);
  return Number.isInteger(quantity) ? String(quantity) : quantity.toFixed(2).replace(/\.?0+$/, '');
};

export const getReceivingShipmentStatus = (shipment = {}) =>
  String(
    firstPresent(
      shipment?.status,
      shipment?.shipmentStatus,
      shipment?.shipment_status,
      shipment?.statusValue,
      shipment?.status_value
    ) || ''
  ).trim();

export const formatReceivingStatus = (status = '') => {
  const normalizedStatus = String(status || '')
    .trim()
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ');

  if (!normalizedStatus) return '';

  return normalizedStatus
    .split(' ')
    .map((part) => (part ? `${part.charAt(0).toUpperCase()}${part.slice(1).toLowerCase()}` : ''))
    .join(' ');
};

export const getReceivingLineExpectedQty = (item = {}) =>
  toNumber(
    firstPresent(
      item?.expectedQty,
      item?.expected_qty,
      item?.expectedQuantity,
      item?.expected_quantity,
      item?.qtyExpected,
      item?.qty_expected,
      item?.expectedUnits,
      item?.expected_units,
      item?.unitsExpected,
      item?.units_expected,
      item?.expected,
      item?.quantity,
      item?.qty,
      item?.count,
      item?.totalUnits,
      item?.total_units,
      item?.units
    ),
    0
  );

export const getReceivingLineReceivedQty = (item = {}) =>
  toNumber(
    firstPresent(
      item?.receivedQty,
      item?.received_qty,
      item?.receivedQuantity,
      item?.received_quantity,
      item?.qtyReceived,
      item?.qty_received,
      item?.unitsReceived,
      item?.units_received,
      item?.received
    ),
    0
  );

export const getReceivingLineRemainingQty = (item = {}) => {
  const explicitRemaining = firstPresent(
    item?.remainingQty,
    item?.remaining_qty,
    item?.remainingQuantity,
    item?.remaining_quantity,
    item?.qtyRemaining,
    item?.qty_remaining,
    item?.unitsRemaining,
    item?.units_remaining,
    item?.remaining
  );

  if (isPresent(explicitRemaining)) return Math.max(0, toNumber(explicitRemaining, 0));

  return Math.max(0, getReceivingLineExpectedQty(item) - getReceivingLineReceivedQty(item));
};

export const getReceivingLineDifferenceQty = (item = {}) =>
  toNumber(
    firstPresent(
      item?.differenceQty,
      item?.difference_qty,
      item?.qtyDifference,
      item?.qty_difference,
      item?.quantityDifference,
      item?.quantity_difference
    ),
    getReceivingLineReceivedQty(item) - getReceivingLineExpectedQty(item)
  );

export const hasReceivingLineDiscrepancy = (item = {}) => {
  const explicitFlag = firstPresent(
    item?.discrepancyFlag,
    item?.discrepancy_flag,
    item?.hasDiscrepancy,
    item?.has_discrepancy,
    item?.openDiscrepancy,
    item?.open_discrepancy
  );

  if (isPresent(explicitFlag)) return toBoolean(explicitFlag);

  const status = String(firstPresent(item?.discrepancyStatus, item?.discrepancy_status) || '').trim().toLowerCase();
  if (status) return !['resolved', 'closed', 'complete', 'completed'].includes(status);

  return getReceivingLineReceivedQty(item) > 0 && getReceivingLineRemainingQty(item) > 0;
};

export const getReceivingLineDiscrepancyNotes = (item = {}) =>
  String(
    firstPresent(
      item?.discrepancyNotes,
      item?.discrepancy_notes,
      item?.discrepancyMessage,
      item?.discrepancy_message,
      item?.notes
    ) || ''
  ).trim();

export const getReceivingShipmentExpectedQty = (shipment = {}, lineItems = []) => {
  const explicitExpected = firstPresent(
    shipment?.totalExpectedQty,
    shipment?.total_expected_qty,
    shipment?.totalExpectedQuantity,
    shipment?.total_expected_quantity,
    shipment?.expectedQty,
    shipment?.expected_qty,
    shipment?.totalUnits,
    shipment?.total_units,
    shipment?.units
  );

  if (isPresent(explicitExpected)) return toNumber(explicitExpected, 0);

  return lineItems.reduce((sum, item) => sum + getReceivingLineExpectedQty(item), 0);
};

export const getReceivingShipmentReceivedQty = (shipment = {}, lineItems = []) => {
  const explicitReceived = firstPresent(
    shipment?.totalReceivedQty,
    shipment?.total_received_qty,
    shipment?.totalReceivedQuantity,
    shipment?.total_received_quantity,
    shipment?.receivedQty,
    shipment?.received_qty,
    shipment?.receivedUnits,
    shipment?.received_units
  );

  if (isPresent(explicitReceived)) return toNumber(explicitReceived, 0);

  return lineItems.reduce((sum, item) => sum + getReceivingLineReceivedQty(item), 0);
};

export const getReceivingShipmentRemainingQty = (shipment = {}, lineItems = []) => {
  const explicitRemaining = firstPresent(
    shipment?.totalRemainingQty,
    shipment?.total_remaining_qty,
    shipment?.totalRemainingQuantity,
    shipment?.total_remaining_quantity,
    shipment?.remainingQty,
    shipment?.remaining_qty,
    shipment?.remainingUnits,
    shipment?.remaining_units
  );

  if (isPresent(explicitRemaining)) return Math.max(0, toNumber(explicitRemaining, 0));

  if (lineItems.length) {
    return lineItems.reduce((sum, item) => sum + getReceivingLineRemainingQty(item), 0);
  }

  return Math.max(
    0,
    getReceivingShipmentExpectedQty(shipment, lineItems) - getReceivingShipmentReceivedQty(shipment, lineItems)
  );
};

export const getReceivingShipmentDiscrepancyCount = (shipment = {}, lineItems = []) => {
  const explicitCount = firstPresent(
    shipment?.discrepancyCount,
    shipment?.discrepancy_count,
    shipment?.openDiscrepancyCount,
    shipment?.open_discrepancy_count
  );

  if (isPresent(explicitCount)) return Math.max(0, toNumber(explicitCount, 0));

  return lineItems.filter(hasReceivingLineDiscrepancy).length;
};

export const hasReceivingShipmentDiscrepancy = (shipment = {}, lineItems = []) => {
  const explicitFlag = firstPresent(
    shipment?.hasOpenDiscrepancy,
    shipment?.has_open_discrepancy,
    shipment?.hasDiscrepancy,
    shipment?.has_discrepancy
  );

  if (isPresent(explicitFlag)) return toBoolean(explicitFlag);

  return getReceivingShipmentDiscrepancyCount(shipment, lineItems) > 0;
};

export const isReceivingComplete = (shipment = {}, lineItems = []) => {
  const explicitComplete = firstPresent(shipment?.receivingComplete, shipment?.receiving_complete);
  if (isPresent(explicitComplete)) return toBoolean(explicitComplete);

  return (
    getReceivingShipmentRemainingQty(shipment, lineItems) <= 0 &&
    getReceivingShipmentDiscrepancyCount(shipment, lineItems) <= 0
  );
};
