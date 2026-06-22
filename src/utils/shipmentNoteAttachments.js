export const SHIPMENT_NOTE_ATTACHMENT_LABEL = 'Invoice / Dispatch Note';
export const SHIPMENT_NOTE_ATTACHMENT_PURPOSE = 'shipment_note_attachment';

const asArray = (value) => {
  if (Array.isArray(value)) return value;
  if (Array.isArray(value?.files)) return value.files;
  if (value && typeof value === 'object') return [value];
  return [];
};

const parseMetadata = (file = {}) => {
  const metadata = file?.metadata || file?.meta || {};
  if (metadata && typeof metadata === 'object') return metadata;
  if (typeof metadata === 'string') {
    try {
      return JSON.parse(metadata);
    } catch {
      return {};
    }
  }
  return {};
};

export const isShipmentNoteAttachment = (file = {}) => {
  const metadata = parseMetadata(file);
  const purpose = String(file?.purpose || metadata?.purpose || '').trim();
  const label = String(file?.label || metadata?.label || '').trim();

  return (
    purpose === SHIPMENT_NOTE_ATTACHMENT_PURPOSE ||
    label === SHIPMENT_NOTE_ATTACHMENT_LABEL ||
    file?.noteAttachment === true ||
    file?.note_attachment === true
  );
};

export const getShipmentNoteAttachments = (...sources) => {
  const attachments = [];

  sources.filter(Boolean).forEach((source) => {
    attachments.push(...asArray(source.noteAttachments));
    attachments.push(...asArray(source.note_attachments));
    attachments.push(...asArray(source?.shipment?.noteAttachments));
    attachments.push(...asArray(source?.shipment?.note_attachments));
    attachments.push(...asArray(source.files).filter(isShipmentNoteAttachment));
    attachments.push(...asArray(source.attachments).filter(isShipmentNoteAttachment));
  });

  const seen = new Set();
  return attachments.filter((attachment, index) => {
    if (!attachment || !isShipmentNoteAttachment(attachment)) return false;
    const key = String(
      attachment.id ||
        attachment.fileId ||
        attachment.file_id ||
        attachment.publicUrl ||
        attachment.public_url ||
        attachment.url ||
        index
    );
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
};

export const getShipmentNoteAttachmentName = (attachment = {}) =>
  attachment.originalFilename ||
  attachment.original_filename ||
  attachment.fileName ||
  attachment.file_name ||
  attachment.name ||
  SHIPMENT_NOTE_ATTACHMENT_LABEL;

export const getShipmentNoteAttachmentUrl = (attachment = {}) =>
  attachment.publicUrl || attachment.public_url || attachment.url || '';

export const uploadShipmentNoteAttachment = async ({
  file,
  shipmentId,
  apiBaseUrl = '',
  buildHeaders,
  parseResponse,
}) => {
  if (!file || !shipmentId) return null;

  const formData = new FormData();
  formData.append('file', file, file.name);
  formData.append('entityType', 'shipment');
  formData.append('entityId', shipmentId);
  formData.append('fileType', 'other');
  formData.append('purpose', SHIPMENT_NOTE_ATTACHMENT_PURPOSE);
  formData.append('label', SHIPMENT_NOTE_ATTACHMENT_LABEL);

  const response = await fetch(`${apiBaseUrl}/api/files`, {
    method: 'POST',
    headers: typeof buildHeaders === 'function' ? buildHeaders() : undefined,
    body: formData,
  });

  return typeof parseResponse === 'function' ? parseResponse(response) : response.json();
};
