import React, { useEffect, useMemo, useState } from 'react';
import LayoutClient from './clientlayout/LayoutClient';
import LoadingState from '../common/LoadingState';
import FullPageLoader from '../common/FullPageLoader';
import { AlertCircle, Crown, Download, FileText, Plus, RefreshCw, TrendingUp, X } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { getSession } from '../../utils/auth';
import { getClientIdFromSources, getClientTierFromSources } from '../../utils/clientTier';

const API_BASE_URL = import.meta.env.DEV
  ? ''
  : (import.meta.env.VITE_API_BASE_URL || 'https://ali-backend.vercel.app');
const BACKEND_API_BASE_URL = (import.meta.env.VITE_API_BASE_URL || 'https://ali-backend.vercel.app').replace(/\/+$/, '');

const buildHeaders = (includeJson = false) => {
  const session = getSession();
  const headers = {};

  if (session?.token) {
    headers['Authorization'] = `Bearer ${session.token}`;
  }

  if (includeJson) {
    headers['Content-Type'] = 'application/json';
  }

  return headers;
};

const parseResponse = async (response) => {
  const text = await response.text();
  let payload = null;
  if (text) {
    try {
      payload = JSON.parse(text);
    } catch {
      payload = text;
    }
  }
  if (!response.ok) {
    throw new Error(
      payload?.message ||
        payload?.error ||
        payload?.details ||
        (typeof payload === 'string' ? payload : '') ||
        `Request failed with status ${response.status}`
    );
  }
  return payload;
};

const firstPresent = (...values) => {
  const value = values.find((currentValue) => {
    if (currentValue === 0 || currentValue === false) return true;
    return currentValue !== undefined && currentValue !== null && String(currentValue).trim() !== '';
  });

  return value === undefined || value === null ? '' : value;
};

const extractInvoices = (payload) => {
  const candidates = [
    payload,
    payload?.data,
    payload?.result,
    payload?.payload,
    payload?.data?.data,
    payload?.data?.result,
    payload?.result?.data,
  ];
  const rowKeys = ['invoices', 'rows', 'items', 'records', 'results'];

  for (const candidate of candidates) {
    if (Array.isArray(candidate)) return candidate;

    for (const key of rowKeys) {
      if (Array.isArray(candidate?.[key])) return candidate[key];
    }
  }

  return [];
};

const extractInvoiceDetail = (payload) =>
  payload?.invoice ||
  payload?.data?.invoice ||
  payload?.data?.row ||
  payload?.data?.record ||
  payload?.data ||
  payload?.record ||
  payload;

const extractInvoiceLineItems = (invoice = {}) =>
  invoice?.lineItems ||
  invoice?.line_items ||
  invoice?.invoiceLineItems ||
  invoice?.invoice_line_items ||
  invoice?.items ||
  invoice?.charges ||
  invoice?.services ||
  invoice?.entries ||
  invoice?.rows ||
  [];

const getInvoiceLineItemQuantity = (item = {}) => {
  const quantity = Number(
    firstPresent(
      item?.quantity,
      item?.qty,
      item?.units,
      item?.unitCount,
      item?.unit_count,
      item?.totalUnits,
      item?.total_units,
      item?.qtyUnits,
      item?.qty_units,
      0
    )
  );

  return Number.isFinite(quantity) ? quantity : 0;
};

const getInvoiceUnits = (invoice = {}, lineItems = extractInvoiceLineItems(invoice)) => {
  const directUnits = Number(
    firstPresent(
      invoice?.units,
      invoice?.totalUnits,
      invoice?.total_units,
      invoice?.unitCount,
      invoice?.unit_count,
      invoice?.qty,
      0
    )
  );

  if (Number.isFinite(directUnits) && directUnits > 0) return directUnits;

  return lineItems.reduce((sum, item) => sum + getInvoiceLineItemQuantity(item), 0);
};

const resolveInvoiceFileUrl = (url = '') => {
  if (!url) return '';
  if (/^(https?:|data:|blob:)/i.test(url)) return url;
  return `${BACKEND_API_BASE_URL}${url.startsWith('/') ? url : `/${url}`}`;
};

const buildApiUrl = (path = '') =>
  `${API_BASE_URL}${path.startsWith('/') ? path : `/${path}`}`;

const getContentDispositionFileName = (contentDisposition = '') => {
  const encodedMatch = String(contentDisposition || '').match(/filename\*=UTF-8''([^;]+)/i);
  if (encodedMatch?.[1]) {
    try {
      return decodeURIComponent(encodedMatch[1].replaceAll('"', '').trim());
    } catch {
      return encodedMatch[1].replaceAll('"', '').trim();
    }
  }

  const match = String(contentDisposition || '').match(/filename="?([^";]+)"?/i);
  return match?.[1]?.trim() || '';
};

const getInvoiceDownloadExtension = (contentType = '', fallbackFileName = '') => {
  const normalizedType = String(contentType || '').toLowerCase();
  const normalizedName = String(fallbackFileName || '').toLowerCase();

  if (normalizedName.endsWith('.pdf') || normalizedType.includes('pdf')) return 'pdf';
  if (normalizedName.endsWith('.html') || normalizedName.endsWith('.htm') || normalizedType.includes('html')) return 'html';
  return 'html';
};

const downloadBlob = (blob, fileName) => {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
};

const formatCurrency = (value) =>
  new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP' }).format(Number(value || 0));

const formatDate = (value) => {
  if (!value) return '--';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleDateString('en-GB');
};

const getTierTextClass = (tier) => {
  const normalizedTier = String(tier || '').toLowerCase();

  if (normalizedTier.includes('silver')) return 'text-slate-600';
  if (normalizedTier.includes('gold')) return 'text-amber-600';
  if (normalizedTier.includes('platinum')) return 'text-[#a16207]';

  return 'text-[#132347]';
};

const buildPeriodLabel = (invoice) => {
  const directLabel =
    invoice?.periodLabel ||
    invoice?.period_label ||
    invoice?.billingPeriod ||
    invoice?.billing_period ||
    invoice?.period;

  if (directLabel) return directLabel;

  const periodStart = invoice?.periodStart || invoice?.period_start || invoice?.billingPeriodStart || invoice?.billing_period_start;
  const periodEnd = invoice?.periodEnd || invoice?.period_end || invoice?.billingPeriodEnd || invoice?.billing_period_end;

  if (periodStart || periodEnd) return `${formatDate(periodStart)} - ${formatDate(periodEnd)}`;

  return '--';
};

const normalizeInvoice = (invoice, index = 0) => {
  const invoiceId = firstPresent(invoice?.id, invoice?.uuid, invoice?.invoiceId, invoice?.invoice_id, invoice?.reference, invoice?.invoice);
  const invoiceRef =
    invoice?.reference ||
    invoice?.invoice ||
    invoice?.invoiceNumber ||
    invoice?.invoice_number ||
    invoice?.number ||
    invoice?.invoiceNo ||
    invoice?.invoice_no ||
    invoiceId ||
    'N/A';
  const lineItems = extractInvoiceLineItems(invoice);

  return {
    id: invoiceId || `invoice-${index}`,
    invoice: invoiceRef,
    period: buildPeriodLabel(invoice),
    units: getInvoiceUnits(invoice, lineItems),
    subtotal: Number(invoice?.subtotal || invoice?.subTotal || invoice?.sub_total || invoice?.netTotal || invoice?.net_total || 0),
    vat: Number(invoice?.vat || invoice?.vatAmount || invoice?.vat_amount || invoice?.tax || invoice?.taxAmount || invoice?.tax_amount || 0),
    total: Number(invoice?.total || invoice?.grandTotal || invoice?.grand_total || invoice?.amount || 0),
    due: invoice?.dueDate || invoice?.due_date || invoice?.dueAt || invoice?.due_at || '',
    date: invoice?.createdAt || invoice?.created_at || invoice?.invoiceDate || invoice?.invoice_date || invoice?.date || '',
    status: invoice?.status || invoice?.paymentStatus || invoice?.payment_status || 'Pending',
    client: invoice?.client?.companyName || invoice?.client?.company_name || invoice?.clientName || invoice?.client_name || invoice?.client || '',
    lineItems,
    pdfUrl: invoice?.pdfUrl || invoice?.pdf_url || invoice?.downloadUrl || invoice?.download_url || invoice?.fileUrl || invoice?.file_url || '',
    raw: invoice,
  };
};

const mergeInvoiceDetail = (fallbackInvoice = {}, detail = {}, index = 0) =>
  normalizeInvoice(
    {
      ...(fallbackInvoice.raw || {}),
      ...fallbackInvoice,
      ...(detail || {}),
      lineItems: extractInvoiceLineItems(detail).length ? extractInvoiceLineItems(detail) : fallbackInvoice.lineItems,
      line_items: extractInvoiceLineItems(detail).length ? extractInvoiceLineItems(detail) : fallbackInvoice.lineItems,
    },
    index
  );

const getInvoiceLookupCandidates = (invoice = {}) => [
  ...new Set(
    [
      invoice?.id,
      invoice?.raw?.id,
      invoice?.uuid,
      invoice?.raw?.uuid,
      invoice?.invoiceId,
      invoice?.invoice_id,
      invoice?.raw?.invoiceId,
      invoice?.raw?.invoice_id,
      invoice?.reference,
      invoice?.raw?.reference,
      invoice?.invoice,
    ]
      .map((value) => String(value || '').trim())
      .filter(Boolean)
  ),
];

const fetchInvoicePdfFile = async (invoice) => {
  const lookupCandidates = getInvoiceLookupCandidates(invoice);
  let lastError = null;

  for (const lookupId of lookupCandidates) {
    try {
      const response = await fetch(
        buildApiUrl(`/api/invoices/${encodeURIComponent(lookupId)}/pdf`),
        {
          method: 'GET',
          headers: buildHeaders(),
          cache: 'no-store',
        }
      );

      if (!response.ok) {
        const text = await response.text();
        let payload = null;

        if (text) {
          try {
            payload = JSON.parse(text);
          } catch {
            payload = text;
          }
        }

        throw new Error(
          payload?.message ||
            payload?.error ||
            payload?.details ||
            (typeof payload === 'string' ? payload : '') ||
            `Invoice PDF request failed with status ${response.status}`
        );
      }

      const contentType = response.headers.get('content-type') || '';

      if (contentType.toLowerCase().includes('application/json')) {
        const payload = await response.json();
        const fileUrl = payload?.url || payload?.pdfUrl || payload?.pdf_url || payload?.downloadUrl || payload?.download_url || payload?.fileUrl || payload?.file_url;

        if (fileUrl) {
          return {
            url: resolveInvoiceFileUrl(fileUrl),
            fileName: getContentDispositionFileName(response.headers.get('content-disposition') || '') || `${sanitizeFileName(invoice?.invoice || lookupId)}.pdf`,
          };
        }

        throw new Error(payload?.message || payload?.error || 'Invoice PDF response did not include a downloadable file.');
      }

      const blob = await response.blob();
      const dispositionFileName = getContentDispositionFileName(response.headers.get('content-disposition') || '');
      const extension = getInvoiceDownloadExtension(contentType, dispositionFileName);

      return {
        blob,
        fileName: dispositionFileName || `${sanitizeFileName(invoice?.invoice || lookupId)}.${extension}`,
      };
    } catch (requestError) {
      lastError = requestError;
    }
  }

  throw lastError || new Error('Invoice identifier is missing.');
};

const sanitizeFileName = (value = 'invoice') =>
  String(value || 'invoice')
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, '-')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '') || 'invoice';

const escapePdfText = (value = '') => String(value).replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');

const downloadPdfFile = (fileName, lines) => {
  const textLines = lines.slice(0, 44);
  const streamLines = ['BT', '/F1 13 Tf', '46 780 Td'];
  textLines.forEach((line, index) => {
    if (index === 1) streamLines.push('/F1 10 Tf');
    streamLines.push(`(${escapePdfText(line)}) Tj`);
    streamLines.push('0 -17 Td');
  });
  streamLines.push('ET');

  const stream = streamLines.join('\n');
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
  ];

  let pdf = '%PDF-1.4\n';
  const offsets = [0];
  objects.forEach((object, index) => {
    offsets.push(pdf.length);
    pdf += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });

  const xrefOffset = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  offsets.slice(1).forEach((offset) => {
    pdf += `${String(offset).padStart(10, '0')} 00000 n \n`;
  });
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`;

  const blob = new Blob([pdf], { type: 'application/pdf' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
};

const InvoicesClient = () => {
  const navigate = useNavigate();
  const [invoices, setInvoices] = useState([]);
  const [selectedInvoice, setSelectedInvoice] = useState(null);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [isInvoiceDetailLoading, setIsInvoiceDetailLoading] = useState(false);
  const [downloadingInvoiceId, setDownloadingInvoiceId] = useState('');
  const [clientTier, setClientTier] = useState(() => {
    const session = getSession();
    return getClientTierFromSources(session, session?.rawUser);
  });

  const loadInvoices = async () => {
    try {
      setIsLoading(true);
      setError('');
      const response = await fetch(`${API_BASE_URL}/api/invoices`, {
        method: 'GET',
        headers: buildHeaders(),
        cache: 'no-store',
      });
      const payload = await parseResponse(response);
      setInvoices(extractInvoices(payload).map((invoice, index) => normalizeInvoice(invoice, index)));
    } catch (requestError) {
      setError(requestError.message);
      setInvoices([]);
    } finally {
      setIsLoading(false);
    }
  };

  const loadClientTier = async () => {
    const session = getSession();
    let authUser = null;
    let clientRecord = null;

    try {
      const authResponse = await fetch(`${API_BASE_URL}/api/auth/me`, {
        method: 'GET',
        headers: buildHeaders(),
        cache: 'no-store',
      });
      const authPayload = await parseResponse(authResponse);
      authUser = authPayload?.user || authPayload?.data?.user || authPayload?.data || authPayload || null;

      const clientId = getClientIdFromSources(authUser, session, session?.rawUser);

      if (clientId) {
        const clientResponse = await fetch(`${API_BASE_URL}/api/clients/${clientId}`, {
          method: 'GET',
          headers: buildHeaders(),
          cache: 'no-store',
        });
        const clientPayload = await parseResponse(clientResponse);
        clientRecord = clientPayload?.client || clientPayload?.data?.client || clientPayload?.data || clientPayload || null;
      }
    } catch {
      clientRecord = null;
    }

    setClientTier(getClientTierFromSources(clientRecord, authUser, session, session?.rawUser));
  };

  useEffect(() => {
    loadInvoices();
    loadClientTier();
  }, []);

  const stats = useMemo(() => {
    const outstandingInvoices = invoices.filter((invoice) => String(invoice.status).toLowerCase() !== 'paid');
    const outstanding = outstandingInvoices.reduce((sum, invoice) => sum + invoice.total, 0);
    const paidToDate = invoices
      .filter((invoice) => String(invoice.status).toLowerCase() === 'paid')
      .reduce((sum, invoice) => sum + invoice.total, 0);
    const overdue = outstandingInvoices.filter((invoice) => String(invoice.status).toLowerCase() === 'overdue').length;
    return { outstanding, paidToDate, overdue };
  }, [invoices]);

  const payableInvoice = useMemo(
    () => invoices.find((invoice) => String(invoice.status).toLowerCase() !== 'paid' && invoice.total > 0),
    [invoices]
  );
  const invoiceSummaryText = invoices.length
    ? `Showing ${invoices.length} of ${invoices.length} invoices`
    : 'No invoices found';
  const tierLabel = clientTier || 'Tier unavailable';
  const tierBadgeLabel = clientTier ? `${clientTier} tier` : tierLabel;

  const fetchInvoiceDetail = async (invoice) => {
    const fallbackInvoice = typeof invoice === 'object'
      ? invoice
      : invoices.find((row) => getInvoiceLookupCandidates(row).includes(String(invoice || '').trim())) || { id: invoice };
    const lookupCandidates = getInvoiceLookupCandidates(fallbackInvoice);

    for (const lookupId of lookupCandidates) {
      try {
        const response = await fetch(`${API_BASE_URL}/api/invoices/${encodeURIComponent(lookupId)}`, {
          method: 'GET',
          headers: buildHeaders(),
          cache: 'no-store',
        });
        const payload = await parseResponse(response);
        return mergeInvoiceDetail(fallbackInvoice, extractInvoiceDetail(payload));
      } catch {
        // Some APIs accept invoice UUIDs and others accept invoice references.
      }
    }

    return fallbackInvoice;
  };

  const handleView = async (invoice) => {
    try {
      setError('');
      setMessage('');
      setSelectedInvoice(invoice);
      setIsInvoiceDetailLoading(true);
      const detailedInvoice = await fetchInvoiceDetail(invoice);
      setSelectedInvoice(detailedInvoice);
      setInvoices((currentInvoices) =>
        currentInvoices.map((currentInvoice) =>
          getInvoiceLookupCandidates(currentInvoice).some((key) => getInvoiceLookupCandidates(detailedInvoice).includes(key))
            ? detailedInvoice
            : currentInvoice
        )
      );
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setIsInvoiceDetailLoading(false);
    }
  };

  const getInvoicePdfLines = (invoice) => {
    const rows = invoice.lineItems?.length
      ? invoice.lineItems
      : [
          {
            description: 'Invoice total',
            quantity: invoice.units || 1,
            total: invoice.total,
          },
        ];

    return [
      `Invoice ${invoice.invoice}`,
      invoice.client ? `Client: ${invoice.client}` : '',
      `Period: ${invoice.period}`,
      `Invoice Date: ${formatDate(invoice.date)}`,
      `Due Date: ${formatDate(invoice.due)}`,
      `Status: ${invoice.status}`,
      '',
      'Charges',
      ...rows.map((item, index) => {
        const description = firstPresent(item?.description, item?.serviceType, item?.service_type, item?.name, `Line ${index + 1}`);
        const quantity = firstPresent(item?.quantity, item?.qty, item?.units, '');
        const rate = firstPresent(item?.rate, item?.unitPrice, item?.unit_price, item?.pricePerUnit, '');
        const total = firstPresent(item?.total, item?.amount, item?.lineTotal, item?.line_total, 0);
        return `${index + 1}. ${description}${quantity !== '' ? ` | Qty ${quantity}` : ''}${rate !== '' ? ` | Rate ${formatCurrency(rate)}` : ''} | ${formatCurrency(total)}`;
      }),
      '',
      `Subtotal: ${formatCurrency(invoice.subtotal)}`,
      `VAT: ${formatCurrency(invoice.vat)}`,
      `Total: ${formatCurrency(invoice.total)}`,
    ].filter((line) => line !== '');
  };

  const handleDownloadPdf = async (invoice) => {
    const invoiceId = invoice?.id || invoice?.invoice || '';

    try {
      setError('');
      setMessage('');
      setDownloadingInvoiceId(invoiceId);
      const invoiceFile = await fetchInvoicePdfFile(invoice);

      if (invoiceFile.url) {
        const link = document.createElement('a');
        link.href = invoiceFile.url;
        link.download = invoiceFile.fileName || `${sanitizeFileName(invoice?.invoice || invoiceId)}.pdf`;
        link.target = '_blank';
        link.rel = 'noreferrer';
        document.body.appendChild(link);
        link.click();
        link.remove();
      } else {
        downloadBlob(invoiceFile.blob, invoiceFile.fileName || `${sanitizeFileName(invoice?.invoice || invoiceId)}.html`);
      }

      setMessage(`Invoice downloaded for ${invoice?.invoice || invoiceId}.`);
    } catch (requestError) {
      setError(requestError.message || 'Failed to download invoice.');
    } finally {
      setDownloadingInvoiceId('');
    }
  };

  const handleExport = () => {
    if (!invoices.length) {
      setMessage('No invoice data available to export.');
      return;
    }

    const rows = [
      ['Invoice', 'Period', 'Units', 'Subtotal', 'VAT', 'Total', 'Due', 'Status'],
      ...invoices.map((invoice) => [
        invoice.invoice,
        invoice.period,
        invoice.units,
        invoice.subtotal,
        invoice.vat,
        invoice.total,
        invoice.due,
        invoice.status,
      ]),
    ];
    const csv = rows.map((row) => row.map((value) => `"${String(value)}"`).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'client-invoices.csv';
    link.click();
    URL.revokeObjectURL(url);
    setMessage('Invoice export downloaded.');
  };

  const handlePayNow = () => {
    setError('');

    if (!payableInvoice) {
      setMessage('No outstanding invoice to pay right now.');
      return;
    }

    setSelectedInvoice(payableInvoice);
    setMessage(
      `Online payment checkout is not connected yet. Please pay ${formatCurrency(payableInvoice.total)} by bank transfer and use ${payableInvoice.invoice} as the payment reference.`
    );
  };

  const cardClass = 'rounded-2xl border border-[#dde6f2] bg-white p-6';

  return (
    <LayoutClient>
      <FullPageLoader show={isLoading} label="Loading invoices..." />
      <div className="min-h-screen ">
        <div className="">
          <div className="mb-8 flex items-start justify-between gap-4">
            <div>
              <h1 className="text-[34px] font-semibold leading-none text-[#132347]">Invoices</h1>
              <p className="mt-2 text-sm text-[#7a8ca5]">Finance / Billing History</p>
            </div>
            <div className="flex items-center gap-3">
              <div className="rounded-full border border-[#e3e8f2] bg-white px-3 py-1.5 text-xs font-semibold text-[#132347]">
                {tierBadgeLabel}
              </div>
              <button
                type="button"
                onClick={() => navigate('/shipments?mode=create')}
                className="inline-flex items-center gap-2 rounded-lg bg-[#ff8c2f] px-4 py-2.5 text-sm font-semibold text-white"
              >
                <Plus size={15} />
                Submit Shipment
              </button>
            </div>
          </div>

          {message ? <div className="mb-4 rounded-lg border border-green-200 bg-green-50 p-3 text-sm text-green-700">{message}</div> : null}
          {error ? <div className="mb-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</div> : null}

          <div className="mb-8 grid grid-cols-1 gap-6 md:grid-cols-2 xl:grid-cols-4">
            <div className={cardClass}>
              <div className="mb-4 flex items-start justify-between">
                <span className="text-sm font-semibold uppercase tracking-wider text-gray-400">OUTSTANDING</span>
                <div className="flex h-10 w-10 items-center justify-center rounded-full bg-red-50">
                  <AlertCircle size={20} className="text-red-500" />
                </div>
              </div>
              <div className="mb-1 text-4xl font-bold text-[#132347]">{formatCurrency(stats.outstanding)}</div>
              <span className="inline-flex rounded-full bg-red-50 px-2 py-1 text-xs font-semibold text-red-600">
                {stats.overdue ? 'overdue' : 'open balance'}
              </span>
            </div>

            <div className={cardClass}>
              <div className="mb-4 flex items-start justify-between">
                <span className="text-sm font-semibold uppercase tracking-wider text-gray-400">PAID YTD</span>
                <div className="flex h-10 w-10 items-center justify-center rounded-full bg-green-50">
                  <TrendingUp size={20} className="text-green-500" />
                </div>
              </div>
              <div className="mb-1 text-4xl font-bold text-[#132347]">{formatCurrency(stats.paidToDate)}</div>
              <span className="inline-flex rounded-full bg-[#fff7ed] px-2 py-1 text-xs font-semibold text-[#f97316]">+12% vs last year</span>
            </div>

            <div className={cardClass}>
              <div className="mb-4 flex items-start justify-between">
                <span className="text-sm font-semibold uppercase tracking-wider text-gray-400">MY TIER</span>
                <div className="flex h-10 w-10 items-center justify-center rounded-full bg-amber-50">
                  <Crown size={20} className="text-amber-500" />
                </div>
              </div>
              <div className={`mb-1 text-4xl font-bold ${getTierTextClass(clientTier)}`}>{tierLabel}</div>
              <span className="text-xs text-gray-500">
                {clientTier ? 'Current pricing tier from your account' : 'No pricing tier assigned'}
              </span>
            </div>

            <div className="rounded-2xl border border-[#0f203f] bg-[#0f203f] p-6 text-white shadow-lg">
              <div className="mb-4 flex items-start justify-between">
                <span className="text-sm font-semibold uppercase tracking-wider text-slate-300">AMOUNT DUE NOW</span>
                <div className="flex h-10 w-10 items-center justify-center rounded-full bg-[#12315f]">
                  <FileText size={20} className="text-[#2dd4bf]" />
                </div>
              </div>
              <div className="mb-3 text-4xl font-bold text-[#2dd4bf]">{formatCurrency(stats.outstanding)}</div>
              <div className="grid grid-cols-2 gap-3 text-xs text-slate-300">
                <div>
                  <p>Bank transfer details:</p>
                  <p className="mt-2 uppercase tracking-wide text-slate-400">Sort code</p>
                  <p className="text-white">48-01-82</p>
                </div>
                <div>
                  <p className="opacity-0">.</p>
                  <p className="mt-2 uppercase tracking-wide text-slate-400">Account</p>
                  <p className="text-white">12345678</p>
                </div>
              </div>
              <p className="mt-4 text-sm font-semibold text-[#22d3ee]">{payableInvoice?.invoice || invoices[0]?.invoice || 'No open invoice'}</p>
              <button
                type="button"
                onClick={handlePayNow}
                disabled={!payableInvoice}
                className="mt-6 w-full rounded-lg bg-[#22c7b8] px-4 py-3 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-60"
              >
                Pay Now
              </button>
            </div>
          </div>

          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-lg font-semibold text-gray-900">Invoice History</h2>
            <button type="button" onClick={handleExport} className="inline-flex items-center gap-2 rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50">
              <Download size={16} />
            </button>
          </div>

          <div className="overflow-hidden rounded-2xl border border-[#dce5f1] bg-white shadow-sm">
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-[#e8eef7] bg-[#f8fbff]">
                    <th className="px-6 py-4 text-left text-xs font-semibold uppercase tracking-wider text-gray-500">INVOICE#</th>
                    <th className="px-6 py-4 text-left text-xs font-semibold uppercase tracking-wider text-gray-500">PERIOD</th>
                    <th className="px-6 py-4 text-left text-xs font-semibold uppercase tracking-wider text-gray-500">UNITS</th>
                    <th className="px-6 py-4 text-left text-xs font-semibold uppercase tracking-wider text-gray-500">SUBTOTAL</th>
                    <th className="px-6 py-4 text-left text-xs font-semibold uppercase tracking-wider text-gray-500">VAT</th>
                    <th className="px-6 py-4 text-left text-xs font-semibold uppercase tracking-wider text-gray-500">TOTAL</th>
                    <th className="px-6 py-4 text-left text-xs font-semibold uppercase tracking-wider text-gray-500">DUE</th>
                    <th className="px-6 py-4 text-left text-xs font-semibold uppercase tracking-wider text-gray-500">STATUS</th>
                    <th className="px-6 py-4 text-left text-xs font-semibold uppercase tracking-wider text-gray-500">ACTIONS</th>
                  </tr>
                </thead>
                <tbody>
                  {isLoading ? (
                    <tr>
                      <td colSpan="9" className="px-6 py-10 text-center text-sm text-gray-500">
                        <LoadingState label="Loading invoices..." />
                      </td>
                    </tr>
                  ) : invoices.length === 0 ? (
                    <tr>
                      <td colSpan="9" className="px-6 py-12 text-center">
                        <div className="mx-auto flex max-w-sm flex-col items-center">
                          <div className="mb-3 flex h-11 w-11 items-center justify-center rounded-full bg-[#f1f5f9]">
                            <FileText size={20} className="text-[#64748b]" />
                          </div>
                          <p className="text-sm font-semibold text-[#132347]">No invoice data found.</p>
                          <p className="mt-1 text-sm text-[#64748b]">
                            When invoices are generated for this client, they will appear here.
                          </p>
                        </div>
                      </td>
                    </tr>
                  ) : invoices.map((invoice) => (
                    <tr key={invoice.id} className="border-b border-gray-50 transition-colors hover:bg-gray-50/30 last:border-b-0">
                      <td className="px-6 py-4 text-sm font-semibold text-[#132347]">{invoice.invoice}</td>
                      <td className="px-6 py-4 text-sm text-gray-700">{invoice.period}</td>
                      <td className="px-6 py-4 text-sm font-medium text-gray-900">{invoice.units}</td>
                      <td className="px-6 py-4 text-sm text-gray-700">{formatCurrency(invoice.subtotal)}</td>
                      <td className="px-6 py-4 text-sm text-gray-700">{formatCurrency(invoice.vat)}</td>
                      <td className="px-6 py-4 text-sm font-semibold text-gray-900">{formatCurrency(invoice.total)}</td>
                      <td className="px-6 py-4 text-sm text-gray-700">{formatDate(invoice.due)}</td>
                      <td className="px-6 py-4">
                        <span className={`inline-flex rounded-full border px-3 py-1 text-xs font-semibold ${
                          String(invoice.status).toLowerCase() === 'overdue' || String(invoice.status).toLowerCase() === 'unpaid'
                            ? 'border-red-200 bg-red-50 text-red-700'
                            : 'border-green-200 bg-[#e6fffb] text-[#16a394]'
                        }`}>
                          {invoice.status}
                        </span>
                      </td>
                      <td className="px-6 py-4">
                        <div className="flex items-center gap-2">
                          <button type="button" onClick={() => handleView(invoice)} className="rounded-md border border-[#dbe2ee] px-3 py-1.5 text-xs font-medium text-[#64748b] hover:bg-[#f8fafc]">
                            View
                          </button>
                          <button
                            type="button"
                            onClick={() => handleDownloadPdf(invoice)}
                            disabled={downloadingInvoiceId === invoice.id}
                            className="rounded-md border border-[#fde7d5] px-3 py-1.5 text-xs font-medium text-[#ff8c2f] hover:bg-[#fff7ed] disabled:cursor-not-allowed disabled:opacity-60"
                          >
                            {downloadingInvoiceId === invoice.id ? '...' : 'PDF'}
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="flex items-center justify-between border-t border-[#edf2f7] px-6 py-4 text-sm text-[#64748b]">
              <span>{invoiceSummaryText}</span>
              <div className="flex items-center gap-2">
                <button type="button" disabled className="rounded-md border border-[#d8e0ee] px-2 py-1 disabled:cursor-not-allowed disabled:opacity-50">{'<'}</button>
                <button type="button" disabled className="rounded-md border border-[#d8e0ee] px-2 py-1 disabled:cursor-not-allowed disabled:opacity-50">{'>'}</button>
              </div>
            </div>
          </div>

          {selectedInvoice ? (
            <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 px-4 py-8">
              <div className="w-full max-w-3xl overflow-hidden rounded-2xl bg-white shadow-2xl">
                <div className="flex items-start justify-between gap-4 border-b border-[#e5edf7] px-6 py-5">
                  <div>
                    <h3 className="text-xl font-semibold text-[#132347]">{selectedInvoice.invoice}</h3>
                    <p className="mt-1 text-sm text-[#64748b]">Invoice detail</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => handleDownloadPdf(selectedInvoice)}
                      disabled={Boolean(downloadingInvoiceId)}
                      className="inline-flex items-center gap-2 rounded-lg border border-[#fde7d5] px-3 py-2 text-xs font-semibold text-[#ff8c2f] hover:bg-[#fff7ed] disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      <Download size={14} />
                      PDF
                    </button>
                    <button
                      type="button"
                      onClick={() => setSelectedInvoice(null)}
                      className="rounded-lg p-2 text-[#64748b] hover:bg-[#f8fafc] hover:text-[#132347]"
                      aria-label="Close invoice detail"
                    >
                      <X size={18} />
                    </button>
                  </div>
                </div>

                {isInvoiceDetailLoading ? (
                  <div className="flex items-center gap-2 border-b border-[#e5edf7] bg-[#f8fafc] px-6 py-3 text-sm text-[#64748b]">
                    <RefreshCw size={14} className="animate-spin" />
                    Fetching latest invoice data...
                  </div>
                ) : null}

                <div className="space-y-5 px-6 py-5">
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-4">
                    {[
                      { label: 'Period', value: selectedInvoice.period },
                      { label: 'Units', value: selectedInvoice.units },
                      { label: 'Due', value: formatDate(selectedInvoice.due) },
                      { label: 'Status', value: selectedInvoice.status },
                    ].map((item) => (
                      <div key={item.label} className="rounded-lg border border-[#e5edf7] bg-[#f8fafc] px-3 py-2">
                        <p className="text-[10px] font-semibold uppercase tracking-wide text-[#94a3b8]">{item.label}</p>
                        <p className="mt-1 break-words text-sm font-semibold text-[#132347]">{item.value || '-'}</p>
                      </div>
                    ))}
                  </div>

                  <div className="overflow-hidden rounded-xl border border-[#e5edf7]">
                    <table className="w-full text-sm">
                      <thead className="bg-[#f8fbff] text-xs uppercase tracking-wide text-[#64748b]">
                        <tr>
                          <th className="px-4 py-3 text-left">Description</th>
                          <th className="px-4 py-3 text-right">Qty</th>
                          <th className="px-4 py-3 text-right">Rate</th>
                          <th className="px-4 py-3 text-right">Total</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-[#edf2f7]">
                        {selectedInvoice.lineItems?.length ? (
                          selectedInvoice.lineItems.map((item, index) => (
                            <tr key={item?.id || item?.uuid || index}>
                              <td className="px-4 py-3 font-medium text-[#132347]">
                                {firstPresent(item?.description, item?.serviceType, item?.service_type, item?.name, `Line ${index + 1}`)}
                              </td>
                              <td className="px-4 py-3 text-right text-[#64748b]">{firstPresent(getInvoiceLineItemQuantity(item), '-')}</td>
                              <td className="px-4 py-3 text-right text-[#64748b]">{formatCurrency(firstPresent(item?.rate, item?.unitPrice, item?.unit_price, item?.pricePerUnit, 0))}</td>
                              <td className="px-4 py-3 text-right font-semibold text-[#132347]">{formatCurrency(firstPresent(item?.total, item?.amount, item?.lineTotal, item?.line_total, 0))}</td>
                            </tr>
                          ))
                        ) : (
                          <tr>
                            <td colSpan="4" className="px-4 py-6 text-center text-sm text-[#64748b]">
                              No line item detail returned for this invoice.
                            </td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>

                  <div className="ml-auto grid max-w-sm grid-cols-2 gap-y-2 text-sm">
                    <span className="text-[#64748b]">Subtotal</span>
                    <span className="text-right font-semibold text-[#132347]">{formatCurrency(selectedInvoice.subtotal)}</span>
                    <span className="text-[#64748b]">VAT</span>
                    <span className="text-right font-semibold text-[#132347]">{formatCurrency(selectedInvoice.vat)}</span>
                    <span className="border-t border-[#e5edf7] pt-2 text-[#132347]">Total</span>
                    <span className="border-t border-[#e5edf7] pt-2 text-right text-lg font-bold text-[#132347]">{formatCurrency(selectedInvoice.total)}</span>
                  </div>
                </div>
              </div>
            </div>
          ) : null}
        </div>
      </div>
    </LayoutClient>
  );
};

export default InvoicesClient;
