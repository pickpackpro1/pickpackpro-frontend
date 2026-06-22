import { Download, Eye, FileText } from 'lucide-react';
import {
  SHIPMENT_NOTE_ATTACHMENT_LABEL,
  getShipmentNoteAttachmentName,
  getShipmentNoteAttachmentUrl,
} from '../../utils/shipmentNoteAttachments';

const ShipmentNoteAttachments = ({ attachments = [], className = '' }) => {
  if (!attachments.length) return null;

  return (
    <div className={`mt-3 rounded-lg border border-[#d9e3f2] bg-white p-3 ${className}`}>
      <p className="text-[11px] font-semibold uppercase tracking-wide text-[#7f8ea6]">
        {SHIPMENT_NOTE_ATTACHMENT_LABEL}
      </p>
      <div className="mt-2 space-y-2">
        {attachments.map((attachment, index) => {
          const name = getShipmentNoteAttachmentName(attachment);
          const url = getShipmentNoteAttachmentUrl(attachment);
          const key = attachment.id || attachment.fileId || attachment.file_id || url || `${name}-${index}`;

          return (
            <div
              key={key}
              className="flex flex-col gap-2 rounded-md border border-gray-200 bg-gray-50 px-3 py-2 text-sm sm:flex-row sm:items-center sm:justify-between"
            >
              <div className="flex min-w-0 items-center gap-2">
                <FileText size={16} className="shrink-0 text-[#ff8c2f]" />
                <span className="truncate font-medium text-[#132347]">{name}</span>
              </div>
              {url ? (
                <div className="flex shrink-0 items-center gap-2">
                  <a
                    href={url}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1 rounded-md border border-gray-200 bg-white px-2.5 py-1.5 text-xs font-semibold text-[#132347] hover:bg-gray-50"
                  >
                    <Eye size={13} />
                    View
                  </a>
                  <a
                    href={url}
                    download
                    className="inline-flex items-center gap-1 rounded-md border border-[#fde7d5] bg-white px-2.5 py-1.5 text-xs font-semibold text-[#ff6900] hover:bg-[#fff7ed]"
                  >
                    <Download size={13} />
                    Download
                  </a>
                </div>
              ) : null}
            </div>
          );
        })}
      </div>
    </div>
  );
};

export default ShipmentNoteAttachments;
