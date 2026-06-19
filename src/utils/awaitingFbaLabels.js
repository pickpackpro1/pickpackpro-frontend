const firstPresent = (...values) => {
  const value = values.find((item) => item !== undefined && item !== null && String(item).trim() !== '');
  return value === undefined || value === null ? '' : value;
};

const toArray = (value) => {
  if (Array.isArray(value)) return value;
  if (Array.isArray(value?.data)) return value.data;
  if (Array.isArray(value?.rows)) return value.rows;
  if (Array.isArray(value?.boxes)) return value.boxes;
  return [];
};

const getPayloadData = (payload = {}) =>
  payload?.data && typeof payload.data === 'object' ? payload.data : payload || {};

const getFileId = (file = {}) =>
  firstPresent(file?.id, file?.uuid, file?.fileId, file?.file_id);

const getBoxId = (box = {}) =>
  firstPresent(box?.id, box?.uuid, box?.boxId, box?.box_id);

const getShipmentId = (shipment = {}) =>
  firstPresent(shipment?.id, shipment?.uuid, shipment?.shipmentId, shipment?.shipment_id);

const getBoxLabelFile = (box = {}) =>
  box?.fbaLabelFile ||
  box?.fba_label_file ||
  box?.fbaShippingLabelFile ||
  box?.fba_shipping_label_file ||
  null;

const getBoxLabelFileId = (box = {}) =>
  firstPresent(
    box?.fbaLabelFileId,
    box?.fba_label_file_id,
    box?.fbaShippingLabelFileId,
    box?.fba_shipping_label_file_id,
    getFileId(getBoxLabelFile(box))
  );

const normalizeFile = (file = {}, box = {}) => {
  if (!file || typeof file !== 'object') return null;

  const boxId = getBoxId(box);
  const fileId = getFileId(file);
  return {
    ...file,
    id: file?.id || fileId,
    fileId: file?.fileId || fileId,
    file_id: file?.file_id || fileId,
    entityType: file?.entityType || file?.entity_type || (box?.boxType === 'pallet' || box?.box_type === 'pallet' ? 'pallet' : 'box'),
    entity_type: file?.entity_type || file?.entityType || (box?.boxType === 'pallet' || box?.box_type === 'pallet' ? 'pallet' : 'box'),
    entityId: file?.entityId || file?.entity_id || boxId,
    entity_id: file?.entity_id || file?.entityId || boxId,
    boxId: file?.boxId || file?.box_id || boxId,
    box_id: file?.box_id || file?.boxId || boxId,
    fileType: file?.fileType || file?.file_type || 'fba_shipping_label',
    file_type: file?.file_type || file?.fileType || 'fba_shipping_label',
  };
};

const normalizeBox = (box = {}, shipment = {}) => {
  const boxId = getBoxId(box);
  const labelFile = normalizeFile(getBoxLabelFile(box), box);
  const labelFileId = getBoxLabelFileId(box);
  const rawLabelStatus = String(firstPresent(box?.labelStatus, box?.label_status)).trim();
  const labelStatus = rawLabelStatus || (labelFileId || labelFile ? 'uploaded' : '');
  const fbaLabelUploaded = Boolean(
    box?.fbaLabelUploaded ||
      box?.fba_label_uploaded ||
      box?.labelUploaded ||
      box?.label_uploaded ||
      box?.labelReady ||
      box?.label_ready ||
      labelFileId ||
      labelFile ||
      String(labelStatus).toLowerCase() === 'uploaded'
  );
  const boxType = String(firstPresent(box?.boxType, box?.box_type, box?.type, 'box')).toLowerCase();
  const childBoxes = toArray(firstPresent(box?.childBoxes, box?.child_boxes, box?.palletChildren, box?.pallet_children))
    .map((childBox) => normalizeBox(childBox, shipment));

  return {
    ...box,
    id: box?.id || boxId,
    boxId: box?.boxId || boxId,
    box_id: box?.box_id || boxId,
    shipmentId: box?.shipmentId || box?.shipment_id || getShipmentId(shipment),
    shipment_id: box?.shipment_id || box?.shipmentId || getShipmentId(shipment),
    shipmentReference: box?.shipmentReference || box?.shipment_reference || shipment?.reference || shipment?.shipmentReference,
    shipment_reference: box?.shipment_reference || box?.shipmentReference || shipment?.reference || shipment?.shipment_reference,
    boxType,
    box_type: box?.box_type || boxType,
    isPallet: box?.isPallet ?? box?.is_pallet ?? boxType === 'pallet',
    is_pallet: box?.is_pallet ?? box?.isPallet ?? boxType === 'pallet',
    insidePallet: box?.insidePallet ?? box?.inside_pallet ?? Boolean(box?.palletId || box?.pallet_id),
    inside_pallet: box?.inside_pallet ?? box?.insidePallet ?? Boolean(box?.palletId || box?.pallet_id),
    fbaLabelFileId: box?.fbaLabelFileId || labelFileId,
    fba_label_file_id: box?.fba_label_file_id || labelFileId,
    fbaShippingLabelFileId: box?.fbaShippingLabelFileId || labelFileId,
    fba_shipping_label_file_id: box?.fba_shipping_label_file_id || labelFileId,
    fbaLabelUploaded,
    fba_label_uploaded: fbaLabelUploaded,
    labelUploaded: box?.labelUploaded ?? box?.label_uploaded ?? fbaLabelUploaded,
    label_uploaded: box?.label_uploaded ?? box?.labelUploaded ?? fbaLabelUploaded,
    labelReady: box?.labelReady ?? box?.label_ready ?? fbaLabelUploaded,
    label_ready: box?.label_ready ?? box?.labelReady ?? fbaLabelUploaded,
    labelStatus,
    label_status: box?.label_status || labelStatus,
    fbaLabelFile: labelFile || box?.fbaLabelFile,
    fba_label_file: labelFile || box?.fba_label_file,
    childBoxes,
    child_boxes: childBoxes,
    childBoxCount: firstPresent(box?.childBoxCount, box?.child_box_count, childBoxes.length),
    child_box_count: firstPresent(box?.child_box_count, box?.childBoxCount, childBoxes.length),
    contents: toArray(firstPresent(box?.contents, box?.items, box?.boxItems, box?.box_items)),
  };
};

const normalizeShipment = (shipment = {}) => {
  const shipmentId = getShipmentId(shipment);
  const reference = firstPresent(shipment?.reference, shipment?.shipmentReference, shipment?.shipment_reference, shipment?.shipmentNumber, shipment?.shipment_number, shipmentId);

  return {
    ...shipment,
    id: shipment?.id || shipmentId,
    shipmentId: shipment?.shipmentId || shipmentId,
    shipment_id: shipment?.shipment_id || shipmentId,
    reference,
    shipmentReference: shipment?.shipmentReference || reference,
    shipment_reference: shipment?.shipment_reference || reference,
    clientId: shipment?.clientId || shipment?.client_id,
    client_id: shipment?.client_id || shipment?.clientId,
    clientName: shipment?.clientName || shipment?.client_name,
    client_name: shipment?.client_name || shipment?.clientName,
    clientEmail: shipment?.clientEmail || shipment?.client_email,
    client_email: shipment?.client_email || shipment?.clientEmail,
  };
};

export const normalizeAwaitingFbaLabelsPayload = (payload = {}) => {
  const data = getPayloadData(payload);
  const rows = toArray(data.rows || data).map((row) => {
    const shipment = normalizeShipment(row?.shipment || row?.shipmentRow || row?.shipment_row || row || {});
    const boxes = toArray(row?.boxes || row?.outboundBoxes || row?.outbound_boxes).map((box) => normalizeBox(box, shipment));
    const shipmentId = getShipmentId(shipment);

    return {
      ...row,
      shipment,
      shipmentId,
      shipment_id: shipmentId,
      pendingLabelCount: firstPresent(row?.pendingLabelCount, row?.pending_label_count, boxes.length),
      pending_label_count: firstPresent(row?.pending_label_count, row?.pendingLabelCount, boxes.length),
      boxes,
    };
  });
  const filesByBox = {};

  const addBoxFile = (box) => {
    const boxId = getBoxId(box);
    const file = normalizeFile(getBoxLabelFile(box), box);
    if (boxId && file) filesByBox[boxId] = [...(filesByBox[boxId] || []), file];
    toArray(box?.childBoxes || box?.child_boxes).forEach(addBoxFile);
  };

  rows.forEach((row) => row.boxes.forEach(addBoxFile));

  return {
    rows,
    filesByBox,
    total: Number(firstPresent(data.total, rows.length) || 0),
    page: Number(firstPresent(data.page, 1) || 1),
    limit: Number(firstPresent(data.limit, 50) || 50),
    pendingBoxCount: Number(firstPresent(data.pendingBoxCount, data.pending_box_count, rows.reduce((sum, row) => sum + row.boxes.length, 0)) || 0),
    includeUploaded: Boolean(data.includeUploaded ?? data.include_uploaded),
  };
};

export const fetchAwaitingFbaLabels = async ({
  apiBaseUrl = '',
  headers = {},
  parseResponse,
  page = 1,
  limit = 50,
  search = '',
  clientId = '',
  status = '',
  includeUploaded = false,
} = {}) => {
  if (typeof parseResponse !== 'function') {
    throw new Error('parseResponse is required for awaiting FBA label requests.');
  }

  const safeLimit = Math.min(100, Math.max(1, Number(limit) || 50));
  const query = new URLSearchParams({
    page: String(Math.max(1, Number(page) || 1)),
    limit: String(safeLimit),
  });

  if (String(search || '').trim()) query.set('search', String(search).trim());
  if (String(clientId || '').trim()) query.set('clientId', String(clientId).trim());
  if (String(status || '').trim() && String(status).trim() !== 'all') query.set('status', String(status).trim());
  if (includeUploaded) query.set('includeUploaded', 'true');

  const response = await fetch(`${apiBaseUrl}/api/fba-labels/awaiting?${query.toString()}`, {
    method: 'GET',
    headers,
    cache: 'no-store',
    skipApiGetCache: true,
  });
  return normalizeAwaitingFbaLabelsPayload(await parseResponse(response));
};
