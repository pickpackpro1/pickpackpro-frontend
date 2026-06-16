import { normalizeServiceList } from './serviceCatalog';
import { buildShipmentItemPayload, firstPresent, toArray } from './shipmentMapper';

const makeFallbackDraftItemId = () =>
  `draft-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;

export const createDraftItemId = () => {
  try {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      return crypto.randomUUID();
    }
  } catch {
    // Fall through to a stable-enough client id for older browsers.
  }

  return makeFallbackDraftItemId();
};

export const getDraftItemId = (item = {}) =>
  firstPresent(item?.draftItemId, item?.draft_item_id, item?.clientDraftId, item?.client_draft_id);

export const ensureDraftItemIds = (items = []) =>
  items.map((item) => ({
    ...item,
    draftItemId: getDraftItemId(item) || createDraftItemId(),
  }));

const toPositiveNumber = (value) => {
  const numericValue = Number(value || 0);
  return Number.isFinite(numericValue) && numericValue > 0 ? numericValue : 0;
};

const toDraftQty = (value) => {
  const numericValue = Number(value || 0);
  return Number.isFinite(numericValue) && numericValue > 0 ? numericValue : 0;
};

const toDraftBundleSize = (value, needsBundling) => {
  if (!needsBundling) return 1;
  const numericValue = Number(value || 0);
  return Number.isFinite(numericValue) && numericValue > 0 ? numericValue : 1;
};

const normalizeProductName = (item = {}) =>
  String(firstPresent(item?.productName, item?.product_name, item?.name) || '').trim();

const normalizeFnskuLabel = (item = {}) =>
  String(firstPresent(item?.fnskuLabel, item?.fnsku_label, item?.fnsku, item?.defaultFnsku, item?.default_fnsku) || '').trim();

export const buildDraftShipmentItems = (items = []) =>
  ensureDraftItemIds(items).map((item, index) => {
    const needsBundling = Boolean(item?.needsBundling || item?.needs_bundling);

    return {
      draftItemId: getDraftItemId(item),
      sku: String(item?.sku || '').trim(),
      productName: normalizeProductName(item),
      fnskuLabel: normalizeFnskuLabel(item),
      expectedQty: toDraftQty(firstPresent(item?.expectedQty, item?.expected_qty, item?.qtyExpected, item?.qty_expected)),
      needsBundling,
      bundleSize: toDraftBundleSize(firstPresent(item?.bundleSize, item?.bundle_size), needsBundling),
      services: normalizeServiceList(item?.services),
      notes: String(item?.notes || '').trim(),
      displayOrder: index,
    };
  });

export const buildSubmittedShipmentItems = (items = []) => {
  const rows = ensureDraftItemIds(items);

  if (!rows.length) {
    throw new Error('At least one product line item is required.');
  }

  return rows.map((item, index) => {
    const sku = String(item?.sku || '').trim();
    const productName = normalizeProductName(item);
    const expectedQty = toPositiveNumber(firstPresent(item?.expectedQty, item?.expected_qty, item?.qtyExpected, item?.qty_expected));
    const needsBundling = Boolean(item?.needsBundling || item?.needs_bundling);
    const bundleSize = toPositiveNumber(firstPresent(item?.bundleSize, item?.bundle_size));

    if (!sku || !productName || expectedQty <= 0) {
      throw new Error(`Line ${index + 1} needs product, SKU, and qty expected before submitting.`);
    }

    if (needsBundling && bundleSize <= 0) {
      throw new Error(`Line ${index + 1} needs bundle size before submitting.`);
    }

    const payload = buildShipmentItemPayload(
      {
        ...item,
        draftItemId: getDraftItemId(item),
        sku,
        productName,
        expectedQty,
        fnskuLabel: normalizeFnskuLabel(item),
        needsBundling,
        ...(needsBundling ? { bundleSize } : {}),
        services: normalizeServiceList(item?.services),
        displayOrder: index,
        itemIndex: index,
      },
      index
    );

    return {
      ...payload,
      draftItemId: getDraftItemId(item),
      displayOrder: index,
      display_order: index,
    };
  });
};

export const getShipmentDraftPayload = (shipment = {}) => {
  const payload = firstPresent(
    shipment?.draftPayload,
    shipment?.draft_payload,
    shipment?.data?.draftPayload,
    shipment?.data?.draft_payload,
    shipment?.shipment?.draftPayload,
    shipment?.shipment?.draft_payload
  );

  return payload && typeof payload === 'object' ? payload : {};
};

export const getShipmentDraftItems = (shipment = {}) => {
  const draftPayload = getShipmentDraftPayload(shipment);
  return toArray(firstPresent(draftPayload?.items, draftPayload?.productItems, draftPayload?.product_items));
};

const parseMetadata = (metadata) => {
  if (!metadata) return {};
  if (typeof metadata === 'object') return metadata;
  try {
    const parsed = JSON.parse(metadata);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
};

export const getDraftFileMetadata = (file = {}) =>
  parseMetadata(firstPresent(file?.metadata, file?.meta, file?.file_metadata, file?.data?.metadata));

export const getDraftFileRecordId = (file = {}) =>
  firstPresent(
    file?.fileRecordId,
    file?.file_record_id,
    file?.uploadedFileId,
    file?.uploaded_file_id,
    file?.recordId,
    file?.record_id,
    file?.id,
    file?.uuid,
    file?.data?.fileRecordId,
    file?.data?.file_record_id
  );

export const getDraftFileName = (file = {}) => {
  const url = String(firstPresent(file?.name, file?.fileName, file?.file_name, file?.originalName, file?.original_name, file?.storagePath, file?.storage_path, file?.publicUrl, file?.url) || '');
  if (!url) return '';
  const cleanUrl = url.split('?')[0];
  const fileName = cleanUrl.split('/').filter(Boolean).pop() || url;
  return decodeURIComponent(fileName);
};

const normalizeDraftFile = (file = {}, fallback = {}) => {
  const source = file?.data && typeof file.data === 'object' ? file.data : file;
  const metadata = {
    ...getDraftFileMetadata(source),
    ...getDraftFileMetadata(file),
  };
  const fileRecordId = getDraftFileRecordId(source) || getDraftFileRecordId(file) || fallback.fileRecordId || '';
  const fileName = getDraftFileName(source) || fallback.fileName || fallback.name || 'FNSKU label';

  return {
    ...source,
    id: fileRecordId || source?.id || fallback.id || `${fallback.draftItemId || 'draft'}-${fallback.index || 0}-fnsku-label`,
    fileRecordId,
    file_record_id: fileRecordId,
    fileName,
    file_name: fileName,
    url: firstPresent(source?.url, source?.publicUrl, source?.public_url, fallback.url),
    publicUrl: firstPresent(source?.publicUrl, source?.public_url, source?.url, fallback.url),
    public_url: firstPresent(source?.public_url, source?.publicUrl, source?.url, fallback.url),
    fileType: firstPresent(source?.fileType, source?.file_type, 'fnsku_label'),
    file_type: firstPresent(source?.file_type, source?.fileType, 'fnsku_label'),
    metadata: {
      ...metadata,
      draftItemId: firstPresent(metadata?.draftItemId, metadata?.draft_item_id, fallback.draftItemId),
      itemIndex: firstPresent(metadata?.itemIndex, metadata?.item_index, fallback.index),
    },
  };
};

export const getShipmentDraftFiles = (shipment = {}) => {
  const draftPayload = getShipmentDraftPayload(shipment);
  const rows = [
    ...toArray(shipment?.draftFiles),
    ...toArray(shipment?.draft_files),
    ...toArray(shipment?.data?.draftFiles),
    ...toArray(shipment?.data?.draft_files),
    ...toArray(draftPayload?.draftFiles),
    ...toArray(draftPayload?.draft_files),
  ];
  const seen = new Set();

  return rows
    .map((file) => normalizeDraftFile(file))
    .filter((file, index) => {
      const key = getDraftFileRecordId(file) || `${getDraftFileMetadata(file)?.draftItemId || ''}:${getDraftFileMetadata(file)?.itemIndex ?? index}`;
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
};

export const findDraftFileForItem = (item = {}, index = 0, files = []) => {
  const draftItemId = String(getDraftItemId(item) || '').trim();
  const byDraftId = draftItemId
    ? files.find((file) => {
        const metadata = getDraftFileMetadata(file);
        return String(firstPresent(metadata?.draftItemId, metadata?.draft_item_id) || '').trim() === draftItemId;
      })
    : null;

  if (byDraftId) return byDraftId;

  return files.find((file) => {
    const metadata = getDraftFileMetadata(file);
    const itemIndex = Number(firstPresent(metadata?.itemIndex, metadata?.item_index, metadata?.lineItemIndex, metadata?.line_item_index, -1));
    return Number.isFinite(itemIndex) && itemIndex === index;
  });
};

export const mapDraftPayloadItemsToFormItems = (items = [], files = []) => {
  const rows = ensureDraftItemIds(toArray(items)).map((item, index) => {
    const matchedFile = findDraftFileForItem(item, index, files);
    const matchedFileId = matchedFile ? getDraftFileRecordId(matchedFile) : '';
    const matchedFileName = matchedFile ? getDraftFileName(matchedFile) : '';

    return {
      draftItemId: getDraftItemId(item),
      sku: String(item?.sku || '').trim(),
      productName: normalizeProductName(item),
      expectedQty: String(firstPresent(item?.expectedQty, item?.expected_qty, item?.qtyExpected, item?.qty_expected, '')),
      bundleSize: String(firstPresent(item?.bundleSize, item?.bundle_size, '')),
      fnskuLabel: normalizeFnskuLabel(item),
      needsBundling: Boolean(item?.needsBundling || item?.needs_bundling),
      serviceType: '',
      serviceQty: '',
      services: normalizeServiceList(item?.services),
      customServiceName: '',
      notes: String(item?.notes || '').trim(),
      fileName: matchedFileName,
      fnskuLabelFileName: matchedFileName,
      fnsku_label_file_name: matchedFileName,
      fnskuLabelFileId: matchedFileId,
      fnsku_label_file_id: matchedFileId,
      draftFileRecordId: matchedFileId,
      uploadedDraftFile: matchedFile || null,
      file: null,
    };
  });

  return rows.length ? rows : [];
};

export const uploadDraftFnskuLabelFiles = async ({
  shipmentId,
  items = [],
  apiBaseUrl = '',
  buildHeaders,
  parseResponse,
  prepareFileForUpload,
}) => {
  const normalizedShipmentId = String(shipmentId || '').trim();
  if (!normalizedShipmentId) {
    throw new Error('Shipment ID is required before uploading draft FNSKU labels.');
  }

  const inputs = ensureDraftItemIds(items)
    .map((item, index) => ({ item, index, file: item?.file }))
    .filter(({ file }) => file && typeof file === 'object' && file.name);

  if (!inputs.length) {
    return { uploadedFiles: [], uploadedCount: 0, failedMessages: [] };
  }

  const results = await Promise.allSettled(
    inputs.map(async ({ item, index, file }) => {
      const uploadFile = prepareFileForUpload ? await prepareFileForUpload(file, 'FNSKU label') : file;
      const draftItemId = getDraftItemId(item) || createDraftItemId();
      const sku = String(item?.sku || '').trim();
      const fnsku = normalizeFnskuLabel(item);
      const productName = normalizeProductName(item);
      const failedSku = sku || fnsku || productName || `line ${index + 1}`;
      const formData = new FormData();

      formData.append('file', uploadFile, uploadFile.name);
      formData.append('fileType', 'fnsku_label');
      formData.append('entityType', 'shipment_draft_item');
      formData.append('entityId', normalizedShipmentId);
      formData.append('draftItemId', draftItemId);
      formData.append('itemIndex', String(index));
      formData.append('sku', sku);
      formData.append('fnsku', fnsku);
      formData.append('productName', productName);

      const response = await fetch(`${apiBaseUrl}/api/files`, {
        method: 'POST',
        headers: buildHeaders(),
        body: formData,
      });

      try {
        const payload = await parseResponse(response);
        return normalizeDraftFile(payload?.data || payload, {
          draftItemId,
          index,
          name: uploadFile.name,
          fileName: uploadFile.name,
        });
      } catch (error) {
        error.sku = failedSku;
        throw error;
      }
    })
  );

  const uploadedFiles = results
    .filter((result) => result.status === 'fulfilled')
    .map((result) => result.value)
    .filter(Boolean);
  const failedMessages = results
    .filter((result) => result.status === 'rejected')
    .map((result) => result.reason?.message || (result.reason?.sku ? `FNSKU label upload failed for ${result.reason.sku}.` : 'FNSKU label upload failed.'))
    .filter(Boolean);

  return {
    uploadedFiles,
    uploadedCount: uploadedFiles.length,
    failedMessages,
  };
};

export const deleteDraftFileRecord = async ({
  fileRecordId,
  apiBaseUrl = '',
  buildHeaders,
  parseResponse,
}) => {
  const normalizedFileId = String(fileRecordId || '').trim();
  if (!normalizedFileId) return null;

  const response = await fetch(`${apiBaseUrl}/api/files/${encodeURIComponent(normalizedFileId)}`, {
    method: 'DELETE',
    headers: buildHeaders(),
  });

  return parseResponse(response);
};
