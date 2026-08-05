import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';
import Layout from './adminlayout/Layout';
import LoadingState from '../common/LoadingState';
import FullPageLoader from '../common/FullPageLoader';
import { getSession } from '../../utils/auth';
import { API_MUTATION_EVENT_NAME } from '../../utils/toast';
import { FileText, CheckCircle, AlertCircle, Download, Eye, RefreshCw, X, Send, Plus, Pencil, Trash2, Search } from 'lucide-react';
import { getServiceDisplayName, getServiceKey, isKnownServiceCode } from '../../utils/serviceCatalog';

const API_BASE_URL = '';
const BILLING_PAGE_SIZE = 20;
const INVOICE_CATEGORY_DISPATCH = 'dispatch';
const INVOICE_CATEGORY_CLIENT = 'client';

const createInvoiceListMeta = () => ({
  total: 0,
  page: 1,
  limit: BILLING_PAGE_SIZE,
  totalPages: 1,
});

const getTodayInputDate = () => new Date().toISOString().slice(0, 10);

const createEmptyClientInvoiceForm = () => ({
  clientId: '',
  invoiceDate: getTodayInputDate(),
  invoiceType: 'monthly',
  description: '',
  unit: '',
  rate: '',
  notes: '',
});

const buildHeaders = (includeJson = false) => {
  const session = getSession();
  const headers = {};
  if (session?.token) headers['Authorization'] = `Bearer ${session.token}`;
  if (includeJson) headers['Content-Type'] = 'application/json';
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

const extractRows = (payload, preferredKeys = []) => {
  const candidates = [
    payload,
    payload?.data,
    payload?.result,
    payload?.payload,
    payload?.data?.data,
    payload?.data?.result,
    payload?.result?.data,
  ];
  const rowKeys = [...preferredKeys, 'rows', 'items', 'records', 'results'];

  for (const candidate of candidates) {
    if (Array.isArray(candidate)) return candidate;

    for (const key of rowKeys) {
      if (Array.isArray(candidate?.[key])) return candidate[key];
    }
  }

  return [];
};

const extractInvoices = (payload) => extractRows(payload, ['invoices']);

const extractClients = (payload) => extractRows(payload, ['clients']);

const formatCurrency = (value) =>
  new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP' }).format(Number(value || 0));

const formatDate = (value) => {
  if (!value) return '--';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleDateString('en-GB');
};

const formatStatusLabel = (value = '') =>
  String(value || '')
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase()
    .replace(/\b\w/g, (letter) => letter.toUpperCase());

const getPaginationPages = (currentPage = 1, totalPages = 1) => {
  const maxVisiblePages = 5;
  const firstPage = Math.max(1, currentPage - 2);
  const lastPage = Math.min(totalPages, firstPage + maxVisiblePages - 1);
  const adjustedFirstPage = Math.max(1, lastPage - maxVisiblePages + 1);

  return Array.from({ length: lastPage - adjustedFirstPage + 1 }, (_, index) => adjustedFirstPage + index);
};

const firstPresent = (...values) => {
  const value = values.find((currentValue) => {
    if (currentValue === 0 || currentValue === false) return true;
    return currentValue !== undefined && currentValue !== null && String(currentValue).trim() !== '';
  });

  return value === undefined || value === null ? '' : value;
};

const parseJsonValue = (value, fallback) => {
  if (value === undefined || value === null || value === '') return fallback;
  if (Array.isArray(value) || typeof value === 'object') return value;

  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
};

const isUuidValue = (value = '') =>
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(value || '').trim());

const cleanDisplayValue = (value = '') => {
  const text = String(value || '').trim();
  if (!text || isUuidValue(text)) return '';
  return text;
};

const firstDisplayValue = (...values) =>
  values.map(cleanDisplayValue).find(Boolean) || '';

const getClientId = (client) => client?.id || client?.uuid || client?.clientId || client?.client_id || '';

const getClientName = (client = {}) =>
  firstDisplayValue(
    client?.companyName,
    client?.company_name,
    client?.company,
    client?.businessName,
    client?.business_name,
    client?.name,
    client?.fullName,
    client?.full_name,
    client?.displayName,
    client?.display_name,
    client?.user?.name,
    client?.users?.name
  );

const getClientEmail = (client = {}) =>
  firstDisplayValue(
    client?.email,
    client?.contactEmail,
    client?.contact_email,
    client?.billingEmail,
    client?.billing_email,
    client?.user?.email,
    client?.users?.email,
    client?.profile?.email
  );

const getClientDisplayName = (client = {}) =>
  getClientName(client) || getClientEmail(client) || 'Unnamed Client';

const getClientObjectDisplay = (client = {}) =>
  client && typeof client === 'object' ? getClientName(client) || getClientEmail(client) : '';

const getInvoiceClientId = (invoice = {}) =>
  firstPresent(
    invoice?.clientId,
    invoice?.client_id,
    invoice?.customerId,
    invoice?.customer_id,
    invoice?.client?.id,
    invoice?.client?.uuid,
    invoice?.clients?.id,
    invoice?.clients?.uuid,
    invoice?.customer?.id,
    invoice?.customer?.uuid
  );

const getInlineInvoiceClientDisplay = (invoice = {}) =>
  firstDisplayValue(
    getClientObjectDisplay(invoice?.client),
    getClientObjectDisplay(invoice?.clients),
    getClientObjectDisplay(invoice?.customer),
    invoice?.clientName,
    invoice?.client_name,
    invoice?.companyName,
    invoice?.company_name,
    invoice?.clientEmail,
    invoice?.client_email,
    invoice?.billingEmail,
    invoice?.billing_email
  );

const extractInvoiceLineItems = (invoice = {}) => {
  const directItems =
    invoice?.lineItems ||
    invoice?.line_items ||
    invoice?.invoiceLineItems ||
    invoice?.invoice_line_items ||
    invoice?.invoiceItems ||
    invoice?.invoice_items ||
    invoice?.items ||
    invoice?.charges ||
    invoice?.serviceLines ||
    invoice?.service_lines ||
    invoice?.rows ||
    [];

  if (Array.isArray(directItems) && directItems.length) return directItems;

  const containers = [
    invoice?.invoice,
    invoice?.data,
    invoice?.data?.invoice,
    invoice?.data?.record,
    invoice?.data?.row,
    invoice?.record,
    invoice?.row,
    invoice?.payload,
    invoice?.result,
  ];

  for (const container of containers) {
    if (!container || container === invoice) continue;
    const items = extractInvoiceLineItems(container);
    if (items.length) return items;
  }

  return [];
};

const toNumber = (value) => {
  const number = Number(value ?? 0);
  return Number.isFinite(number) ? number : 0;
};

const getInvoiceLineItemCount = (invoice = {}, lineItems = extractInvoiceLineItems(invoice)) =>
  toNumber(
    firstPresent(
      invoice?._count?.invoice_line_items,
      invoice?._count?.invoiceLineItems,
      invoice?.lineItemCount,
      invoice?.line_item_count,
      lineItems.length
    )
  );

const sumInvoiceLineItems = (items = [], keys = []) =>
  items.reduce((sum, item) => {
    const value = firstPresent(...keys.map((key) => item?.[key]), 0);
    return sum + toNumber(value);
  }, 0);

const getInvoiceSubtotalValue = (invoice = {}, lineItems = extractInvoiceLineItems(invoice)) => {
  const directValue = firstPresent(
    invoice?.subtotal,
    invoice?.subTotal,
    invoice?.sub_total,
    invoice?.netTotal,
    invoice?.net_total,
    invoice?.amountSubtotal,
    invoice?.amount_subtotal
  );

  if (directValue !== '') return toNumber(directValue);

  return sumInvoiceLineItems(lineItems, ['subtotal', 'subTotal', 'sub_total', 'netTotal', 'net_total', 'amount', 'lineTotal', 'line_total', 'total']);
};

const getInvoiceVatValue = (invoice = {}, lineItems = extractInvoiceLineItems(invoice)) => {
  const directValue = firstPresent(
    invoice?.vat,
    invoice?.vatAmount,
    invoice?.vat_amount,
    invoice?.tax,
    invoice?.taxAmount,
    invoice?.tax_amount
  );

  if (directValue !== '') return toNumber(directValue);

  return sumInvoiceLineItems(lineItems, ['vat', 'vatAmount', 'vat_amount', 'tax', 'taxAmount', 'tax_amount']);
};

const getInvoiceTotalValue = (invoice = {}, lineItems = extractInvoiceLineItems(invoice)) => {
  const directValue = firstPresent(
    invoice?.total,
    invoice?.grandTotal,
    invoice?.grand_total,
    invoice?.totalAmount,
    invoice?.total_amount,
    invoice?.amountTotal,
    invoice?.amount_total,
    invoice?.amountDue,
    invoice?.amount_due,
    invoice?.balance,
    invoice?.balanceDue,
    invoice?.balance_due
  );

  if (directValue !== '') return toNumber(directValue);

  const subtotal = getInvoiceSubtotalValue(invoice, lineItems);
  const vat = getInvoiceVatValue(invoice, lineItems);
  return subtotal + vat;
};

const getInvoicePaidDate = (invoice = {}) =>
  firstPresent(
    invoice?.paidAt,
    invoice?.paid_at,
    invoice?.paidDate,
    invoice?.paid_date,
    invoice?.paymentDate,
    invoice?.payment_date,
    invoice?.settledAt,
    invoice?.settled_at,
    invoice?.raw?.paidAt,
    invoice?.raw?.paid_at,
    invoice?.raw?.paidDate,
    invoice?.raw?.paid_date,
    invoice?.raw?.paymentDate,
    invoice?.raw?.payment_date,
    invoice?.raw?.settledAt,
    invoice?.raw?.settled_at
  );

const getInvoiceDateValue = (invoice = {}) =>
  firstPresent(invoice?.date, invoice?.invoiceDate, invoice?.invoice_date, invoice?.createdAt, invoice?.created_at, invoice?.raw?.date, invoice?.raw?.invoiceDate, invoice?.raw?.invoice_date, invoice?.raw?.createdAt, invoice?.raw?.created_at);

const isDateInCurrentMonth = (value) => {
  if (!value) return false;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return false;
  const now = new Date();
  return date.getFullYear() === now.getFullYear() && date.getMonth() === now.getMonth();
};

const isInvoicePaid = (invoice = {}) => String(invoice.status || '').trim().toLowerCase() === 'paid';

const isInvoiceCancelled = (invoice = {}) =>
  ['cancelled', 'canceled', 'void', 'voided'].includes(String(invoice.status || '').trim().toLowerCase());

const isInvoiceOverdue = (invoice = {}) => {
  const status = String(invoice.status || '').trim().toLowerCase();
  if (status === 'overdue') return true;
  if (isInvoicePaid(invoice) || isInvoiceCancelled(invoice)) return false;

  const dueDate = new Date(invoice.due || invoice.raw?.dueDate || invoice.raw?.due_date || '');
  if (Number.isNaN(dueDate.getTime())) return false;

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  dueDate.setHours(0, 0, 0, 0);
  return dueDate < today;
};

const getInvoiceTypeValue = (invoice = {}) =>
  String(firstPresent(invoice?.invoiceType, invoice?.invoice_type, invoice?.type, invoice?.raw?.invoiceType, invoice?.raw?.invoice_type, 'shipment'))
    .trim()
    .toLowerCase();

const getInvoiceTypeLabel = (invoiceType = '', invoice = {}) => {
  const type = String(invoiceType || '').trim().toLowerCase();
  if (type === 'shipment') return 'Shipment Invoice';
  if (type === 'sub_shipment' || type === 'sub-shipment') return 'Sub-shipment Invoice';
  if (type === 'ad_hoc' || type === 'ad-hoc') return isClientInvoiceRecord(invoice) ? 'Ad-hoc Client Invoice' : 'Ad-hoc Invoice';
  if (type === 'monthly') return isClientInvoiceRecord(invoice) ? 'Client Invoice' : 'Legacy Invoice';
  return type ? formatStatusLabel(type) : 'Invoice';
};

const getInvoiceShipmentId = (invoice = {}) =>
  firstPresent(invoice?.shipmentId, invoice?.shipment_id, invoice?.raw?.shipmentId, invoice?.raw?.shipment_id);

const getInvoiceSubShipmentId = (invoice = {}) =>
  firstPresent(invoice?.subShipmentId, invoice?.sub_shipment_id, invoice?.raw?.subShipmentId, invoice?.raw?.sub_shipment_id);

const isTruthyInvoiceFlag = (value) => value === true || String(value || '').trim().toLowerCase() === 'true';

const isClientInvoiceRecord = (invoice = {}) => {
  const rawInvoice = invoice?.raw || {};
  const category = String(firstPresent(invoice?.category, rawInvoice?.category, '')).trim().toLowerCase();
  const sourceType = String(firstPresent(invoice?.sourceType, invoice?.source_type, rawInvoice?.sourceType, rawInvoice?.source_type, '')).trim().toLowerCase();

  if (category === INVOICE_CATEGORY_CLIENT || sourceType === 'client_invoice') return true;
  if (isTruthyInvoiceFlag(firstPresent(invoice?.isClientInvoice, invoice?.is_client_invoice, rawInvoice?.isClientInvoice, rawInvoice?.is_client_invoice, ''))) return true;

  const invoiceType = getInvoiceTypeValue(invoice);
  const hasDispatchSource = Boolean(getInvoiceShipmentId(invoice) || getInvoiceSubShipmentId(invoice));
  return !hasDispatchSource && ['monthly', 'ad_hoc', 'ad-hoc'].includes(invoiceType);
};

const firstObject = (...values) =>
  values.find((value) => value && typeof value === 'object' && !Array.isArray(value)) || {};

const getInvoiceShipmentRecord = (invoice = {}) =>
  firstObject(
    invoice?.shipment,
    invoice?.shipments,
    invoice?.shipmentRecord,
    invoice?.shipment_record,
    invoice?.raw?.shipment,
    invoice?.raw?.shipments,
    invoice?.raw?.shipmentRecord,
    invoice?.raw?.shipment_record
  );

const getInvoiceSubShipmentRecord = (invoice = {}) =>
  firstObject(
    invoice?.subShipment,
    invoice?.sub_shipment,
    invoice?.subShipments,
    invoice?.sub_shipments,
    invoice?.subShipmentRecord,
    invoice?.sub_shipment_record,
    invoice?.raw?.subShipment,
    invoice?.raw?.sub_shipment,
    invoice?.raw?.subShipments,
    invoice?.raw?.sub_shipments,
    invoice?.raw?.subShipmentRecord,
    invoice?.raw?.sub_shipment_record
  );

const getShipmentReferenceValue = (shipment = {}) =>
  firstPresent(
    shipment?.reference,
    shipment?.shipmentReference,
    shipment?.shipment_reference,
    shipment?.shipmentNumber,
    shipment?.shipment_number,
    shipment?.ref,
    shipment?.number
  );

const getSubShipmentReferenceValue = (subShipment = {}) =>
  firstPresent(
    subShipment?.reference,
    subShipment?.subShipmentReference,
    subShipment?.sub_shipment_reference,
    subShipment?.ref,
    subShipment?.number,
    subShipment?.sequence_no ? `Sub-shipment ${subShipment.sequence_no}` : ''
  );

const getInvoiceShipmentReference = (invoice = {}) => {
  const shipment = getInvoiceShipmentRecord(invoice);
  return firstPresent(
    invoice?.shipmentReference,
    invoice?.shipment_reference,
    invoice?.sourceReference,
    invoice?.source_reference,
    invoice?.raw?.shipmentReference,
    invoice?.raw?.shipment_reference,
    invoice?.raw?.sourceReference,
    invoice?.raw?.source_reference,
    getShipmentReferenceValue(shipment)
  );
};

const getInvoiceSubShipmentReference = (invoice = {}) => {
  const subShipment = getInvoiceSubShipmentRecord(invoice);
  return firstPresent(
    invoice?.subShipmentReference,
    invoice?.sub_shipment_reference,
    invoice?.sourceReference,
    invoice?.source_reference,
    invoice?.raw?.subShipmentReference,
    invoice?.raw?.sub_shipment_reference,
    invoice?.raw?.sourceReference,
    invoice?.raw?.source_reference,
    getSubShipmentReferenceValue(subShipment)
  );
};

const getInvoiceSourceId = (invoice = {}) => {
  const invoiceType = getInvoiceTypeValue(invoice);
  if (invoiceType === 'shipment') return getInvoiceShipmentId(invoice);
  if (invoiceType === 'sub_shipment' || invoiceType === 'sub-shipment') return getInvoiceSubShipmentId(invoice);
  return '';
};

const getInvoiceSourceReference = (invoice = {}) => {
  const invoiceType = getInvoiceTypeValue(invoice);
  if (invoiceType === 'shipment') return getInvoiceShipmentReference(invoice);
  if (invoiceType === 'sub_shipment' || invoiceType === 'sub-shipment') return getInvoiceSubShipmentReference(invoice);
  return '';
};

const getInvoiceSourceFallbackDisplay = (invoice = {}) => {
  if (isClientInvoiceRecord(invoice)) return 'Client Invoice';

  const directReference = getInvoiceSourceReference(invoice);
  if (directReference) return directReference;

  const invoiceType = getInvoiceTypeValue(invoice);
  if (invoiceType === 'shipment' && getInvoiceShipmentId(invoice)) return 'Shipment';
  if ((invoiceType === 'sub_shipment' || invoiceType === 'sub-shipment') && getInvoiceSubShipmentId(invoice)) return 'Sub-shipment';
  if (invoiceType === 'monthly' || invoiceType === 'ad_hoc' || invoiceType === 'ad-hoc') return 'Manual / Monthly';
  return getInvoiceSourceId(invoice) ? formatStatusLabel(invoiceType) : 'Manual / Monthly';
};

const normalizeInvoice = (invoice) => {
  const lineItems = extractInvoiceLineItems(invoice);
  const invoiceType = getInvoiceTypeValue(invoice);
  const isClientInvoice = isClientInvoiceRecord(invoice);
  const description = firstPresent(invoice?.description, invoice?.name, invoice?.label, lineItems?.[0]?.description, lineItems?.[0]?.name, '');
  const unit = toNumber(firstPresent(invoice?.unit, invoice?.units, invoice?.qty, invoice?.quantity, lineItems?.[0]?.unit, lineItems?.[0]?.units, lineItems?.[0]?.qty, lineItems?.[0]?.quantity, 0));
  const rate = toNumber(firstPresent(invoice?.rate, invoice?.unitRate, invoice?.unit_rate, lineItems?.[0]?.rate, lineItems?.[0]?.unitRate, lineItems?.[0]?.unit_rate, 0));
  const amount = getInvoiceTotalValue(invoice, lineItems);
  const displayLineItems = lineItems.length
    ? lineItems
    : isClientInvoice && description
      ? [{ description, unit, rate, amount, total: amount, qty: unit }]
      : lineItems;

  return {
    id: firstPresent(invoice?.id, invoice?.uuid, invoice?.invoiceId, invoice?.invoice_id, invoice?.reference, invoice?.invoice_number),
    ref: firstPresent(invoice?.reference, invoice?.invoiceNumber, invoice?.invoice_number, invoice?.number, invoice?.invoiceNo, invoice?.invoice_no, invoice?.id, 'N/A'),
    invoiceType,
    invoiceTypeLabel: getInvoiceTypeLabel(invoiceType, invoice),
    category: isClientInvoice ? INVOICE_CATEGORY_CLIENT : INVOICE_CATEGORY_DISPATCH,
    isClientInvoice,
    shipmentId: getInvoiceShipmentId(invoice),
    subShipmentId: getInvoiceSubShipmentId(invoice),
    sourceId: getInvoiceSourceId(invoice),
    sourceReference: getInvoiceSourceReference(invoice),
    source: getInvoiceSourceFallbackDisplay(invoice),
    clientId: getInvoiceClientId(invoice),
    client: getInlineInvoiceClientDisplay(invoice) || '-',
    date: firstPresent(invoice?.invoiceDate, invoice?.invoice_date, invoice?.date, invoice?.createdAt, invoice?.created_at),
    due: firstPresent(invoice?.dueDate, invoice?.due_date, invoice?.dueAt, invoice?.due_at),
    subtotal: getInvoiceSubtotalValue(invoice, lineItems),
    vat: getInvoiceVatValue(invoice, lineItems),
    total: amount,
    description,
    unit,
    rate,
    amount,
    status: invoice?.status || 'draft',
    sentAt: firstPresent(invoice?.sentAt, invoice?.sent_at),
    paidAt: firstPresent(invoice?.paidAt, invoice?.paid_at),
    notes: firstPresent(invoice?.notes, ''),
    lineItems: displayLineItems,
    lineItemCount: getInvoiceLineItemCount(invoice, displayLineItems),
    raw: invoice,
  };
};

const getInvoiceLookupCandidates = (invoice = {}) => [
  ...new Set(
    [
      invoice?.id,
      invoice?.uuid,
      invoice?.invoiceId,
      invoice?.invoice_id,
      invoice?.reference,
      invoice?.ref,
      invoice?.invoiceNumber,
      invoice?.invoice_number,
      invoice?.source,
      invoice?.sourceReference,
      invoice?.source_reference,
      invoice?.raw?.id,
      invoice?.raw?.uuid,
      invoice?.raw?.invoiceId,
      invoice?.raw?.invoice_id,
      invoice?.raw?.reference,
      invoice?.raw?.invoiceNumber,
      invoice?.raw?.invoice_number,
      invoice?.raw?.sourceReference,
      invoice?.raw?.source_reference,
      getInvoiceSourceReference(invoice),
    ]
      .map((value) => String(value || '').trim())
      .filter(Boolean)
  ),
];

const getInvoiceRouteId = (invoice = {}) => {
  const candidates = getInvoiceLookupCandidates(invoice);
  return candidates.find(isUuidValue) || candidates[0] || '';
};

const getInvoiceDetailPayload = (payload) => {
  const invoice = payload?.invoice || payload?.data?.invoice || payload?.data?.row || payload?.data?.record || payload?.data || payload;
  const lineItems =
    payload?.invoice_line_items ||
    payload?.invoiceLineItems ||
    payload?.data?.invoice_line_items ||
    payload?.data?.invoiceLineItems ||
    invoice?.invoice_line_items ||
    invoice?.invoiceLineItems;

  if (!invoice || typeof invoice !== 'object') return invoice;

  return {
    ...invoice,
    clients: invoice?.clients || payload?.clients || payload?.data?.clients,
    invoice_line_items: Array.isArray(lineItems) ? lineItems : invoice?.invoice_line_items,
  };
};

const sanitizeFileName = (value = 'invoice') =>
  String(value || 'invoice')
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, '-')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '') || 'invoice';

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

const ensurePdfFileName = (fileName = '', fallback = 'invoice') => {
  const normalizedFileName = String(fileName || '').trim();
  if (normalizedFileName && /\.pdf$/i.test(normalizedFileName)) return normalizedFileName;

  const baseName = sanitizeFileName(normalizedFileName || fallback).replace(/\.[^.]+$/i, '');
  return `${baseName || 'invoice'}.pdf`;
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

const escapeHtml = (value = '') =>
  String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

const getAddressLines = (address = '') => {
  const parsedAddress = parseJsonValue(address, address);

  if (Array.isArray(parsedAddress)) {
    return parsedAddress
      .flatMap(getAddressLines)
      .map((line) => String(line || '').trim())
      .filter(Boolean);
  }

  if (typeof parsedAddress === 'string') {
    const lineParts = parsedAddress.includes('\n')
      ? parsedAddress.split(/\r?\n/)
      : parsedAddress.split(',');

    return lineParts.map((line) => line.trim()).filter(Boolean);
  }

  if (!parsedAddress || typeof parsedAddress !== 'object') return [];

  return [
    firstDisplayValue(parsedAddress?.street, parsedAddress?.addressLine1, parsedAddress?.address_line_1, parsedAddress?.line1, parsedAddress?.line_1, parsedAddress?.address1),
    firstDisplayValue(parsedAddress?.street2, parsedAddress?.addressLine2, parsedAddress?.address_line_2, parsedAddress?.line2, parsedAddress?.line_2, parsedAddress?.address2),
    [parsedAddress?.city, parsedAddress?.county, parsedAddress?.state].map(cleanDisplayValue).filter(Boolean).join(', '),
    [parsedAddress?.postcode, parsedAddress?.postalCode, parsedAddress?.postal_code, parsedAddress?.zip, parsedAddress?.country].map(cleanDisplayValue).filter(Boolean).join(', '),
  ].filter(Boolean);
};

const firstAddressLines = (...addresses) =>
  addresses.map(getAddressLines).find((lines) => lines.length) || [];

const DEFAULT_COMPANY_BILLING_DETAILS = {
  companyName: '',
  website: '',
  addressLines: [],
  vatNumber: '',
  bankName: '',
  sortCode: '',
  accountNumber: '',
};

const extractSettingsPayload = (payload = {}) =>
  payload?.settings || payload?.data?.settings || payload?.data || payload || {};

const getCompanyBillingDetailsFromSettings = (payload = {}) => {
  const settings = extractSettingsPayload(payload);
  const bankDetails = settings?.bankDetails || settings?.bank_details || {};

  return {
    companyName: firstDisplayValue(settings?.companyName, settings?.company_name, DEFAULT_COMPANY_BILLING_DETAILS.companyName),
    website: firstDisplayValue(settings?.website, settings?.siteUrl, settings?.site_url, settings?.domain, DEFAULT_COMPANY_BILLING_DETAILS.website),
    addressLines: firstAddressLines(settings?.companyAddress, settings?.company_address, settings?.address),
    vatNumber: firstDisplayValue(settings?.vatNumber, settings?.vat_number),
    bankName: firstDisplayValue(bankDetails?.bankName, bankDetails?.bank_name),
    sortCode: firstDisplayValue(bankDetails?.sortCode, bankDetails?.sort_code),
    accountNumber: firstDisplayValue(bankDetails?.accountNumber, bankDetails?.account_number),
  };
};

const getInvoiceClientRecord = (invoice = {}, clients = []) => {
  const rawInvoice = invoice?.raw || invoice;
  const clientIds = [
    invoice?.clientId,
    rawInvoice?.clientId,
    rawInvoice?.client_id,
    getInvoiceClientId(rawInvoice),
  ]
    .map((value) => String(value || '').trim())
    .filter(Boolean);
  const clientEmails = [
    invoice?.clientEmail,
    invoice?.client_email,
    invoice?.billingEmail,
    invoice?.billing_email,
    rawInvoice?.clientEmail,
    rawInvoice?.client_email,
    rawInvoice?.billingEmail,
    rawInvoice?.billing_email,
    rawInvoice?.client?.email,
    rawInvoice?.clients?.email,
    rawInvoice?.customer?.email,
  ]
    .map((value) => String(value || '').trim().toLowerCase())
    .filter(Boolean);
  const clientNames = [
    invoice?.client,
    rawInvoice?.clientName,
    rawInvoice?.client_name,
    rawInvoice?.companyName,
    rawInvoice?.company_name,
    getClientObjectDisplay(rawInvoice?.client),
    getClientObjectDisplay(rawInvoice?.clients),
    getClientObjectDisplay(rawInvoice?.customer),
  ]
    .map((value) => String(value || '').trim().toLowerCase())
    .filter(Boolean);

  return clients.find((client) => {
    const ids = [getClientId(client), client?.id, client?.uuid, client?.clientId, client?.client_id]
      .map((value) => String(value || '').trim())
      .filter(Boolean);
    const email = String(getClientEmail(client) || '').trim().toLowerCase();
    const name = String(getClientDisplayName(client) || '').trim().toLowerCase();

    return (
      ids.some((id) => clientIds.includes(id)) ||
      (email && clientEmails.includes(email)) ||
      (name && clientNames.includes(name))
    );
  }) || {};
};

const getInvoiceClientAddressLines = (invoice = {}, clientRecord = {}) => {
  const rawInvoice = invoice?.raw || invoice;

  return firstAddressLines(
    invoice?.billingAddress,
    invoice?.billing_address,
    invoice?.clientAddress,
    invoice?.client_address,
    rawInvoice?.billingAddress,
    rawInvoice?.billing_address,
    rawInvoice?.clientAddress,
    rawInvoice?.client_address,
    rawInvoice?.client?.billingAddress,
    rawInvoice?.client?.billing_address,
    rawInvoice?.client?.address,
    rawInvoice?.clients?.billingAddress,
    rawInvoice?.clients?.billing_address,
    rawInvoice?.clients?.address,
    rawInvoice?.customer?.billingAddress,
    rawInvoice?.customer?.billing_address,
    rawInvoice?.customer?.address,
    clientRecord?.billingAddress,
    clientRecord?.billing_address,
    clientRecord?.address
  );
};

const getInvoiceClientEmailDisplay = (invoice = {}, clientRecord = {}) => {
  const rawInvoice = invoice?.raw || invoice;
  return firstDisplayValue(
    invoice?.clientEmail,
    invoice?.client_email,
    invoice?.billingEmail,
    invoice?.billing_email,
    rawInvoice?.clientEmail,
    rawInvoice?.client_email,
    rawInvoice?.billingEmail,
    rawInvoice?.billing_email,
    rawInvoice?.client?.email,
    rawInvoice?.clients?.email,
    rawInvoice?.customer?.email,
    getClientEmail(clientRecord)
  );
};

const buildAddressHtml = (lines = []) =>
  (lines.length ? lines : ['-']).map((line) => `<div>${escapeHtml(line)}</div>`).join('');

const getInvoiceLineAmount = (item = {}) =>
  firstPresent(
    item?.effectiveAmount,
    item?.effective_amount,
    item?.overrideAmount,
    item?.override_amount,
    item?.amount,
    item?.total,
    item?.lineTotal,
    item?.line_total,
    item?.subtotal,
    item?.sub_total,
    0
  );

const getInvoiceLineVat = (item = {}) =>
  firstPresent(
    item?.effectiveVatAmount,
    item?.effective_vat_amount,
    item?.overrideVatAmount,
    item?.override_vat_amount,
    item?.vat,
    item?.vatAmount,
    item?.vat_amount,
    item?.tax,
    item?.taxAmount,
    item?.tax_amount,
    0
  );

const getInvoiceLineDescription = (item = {}, index = 0) => {
  const serviceCode = firstPresent(
    item?.serviceType,
    item?.service_type,
    item?.serviceCode,
    item?.service_code,
    item?.code,
    item?.type
  );
  const description = firstDisplayValue(
    item?.effectiveDescription,
    item?.effective_description,
    item?.overrideDescription,
    item?.override_description,
    item?.description,
    item?.name,
    item?.label
  );
  const serviceLabel = getServiceDisplayName(serviceCode || description);

  if (serviceCode && (!description || getServiceKey(description) === getServiceKey(serviceCode))) {
    return serviceLabel || `Line ${index + 1}`;
  }

  if (!serviceCode && description && isKnownServiceCode(description)) {
    return serviceLabel;
  }

  return description || serviceLabel || `Line ${index + 1}`;
};

const getInvoiceLineId = (item = {}) =>
  firstPresent(item?.id, item?.uuid, item?.lineItemId, item?.line_item_id);

const getInvoiceLineSource = (item = {}) =>
  String(firstPresent(item?.lineSource, item?.line_source, item?.source, 'system')).trim().toLowerCase();

const isManualInvoiceLine = (item = {}) => ['manual', 'manual_override'].includes(getInvoiceLineSource(item));

const isSystemInvoiceLine = (item = {}) => !isManualInvoiceLine(item);

const isOverriddenInvoiceLine = (item = {}) =>
  item?.isOverridden === true ||
  item?.is_overridden === true ||
  String(firstPresent(item?.isOverridden, item?.is_overridden, item?.metadata?.isOverridden, item?.metadata?.is_overridden, '') || '')
    .trim()
    .toLowerCase() === 'true';

const getInvoiceLineSourceLabel = (item = {}) => {
  if (isManualInvoiceLine(item)) return 'Manual';
  return 'System';
};

const getInvoiceStatusValue = (invoice = {}) => String(invoice?.status || '').trim().toLowerCase();

const isDraftInvoice = (invoice = {}) => getInvoiceStatusValue(invoice) === 'draft';

const canEditInvoiceLines = (invoice = {}) =>
  ['draft', 'sent'].includes(getInvoiceStatusValue(invoice)) && !isClientInvoiceRecord(invoice) && getInvoiceTypeValue(invoice) !== 'monthly';

const canEditManualInvoiceLines = canEditInvoiceLines;

const getInvoiceLineQty = (item = {}) =>
  firstPresent(item?.effectiveQty, item?.effective_qty, item?.overrideQty, item?.override_qty, item?.unit, item?.qty, item?.quantity, item?.units, 0);

const getInvoiceLineUnitRate = (item = {}) =>
  firstPresent(
    item?.effectiveUnitRate,
    item?.effective_unit_rate,
    item?.overrideUnitRate,
    item?.override_unit_rate,
    item?.unitRate,
    item?.unit_rate,
    item?.rate,
    item?.unitPrice,
    item?.unit_price,
    item?.pricePerUnit,
    0
  );

const getInvoiceLineVatRate = (item = {}) =>
  firstPresent(item?.effectiveVatRate, item?.effective_vat_rate, item?.overrideVatRate, item?.override_vat_rate, item?.vatRate, item?.vat_rate, 0);

const getInvoiceLineVatAmount = (item = {}) => firstPresent(getInvoiceLineVat(item), 0);

const getInvoiceLineOverrideReason = (item = {}) =>
  firstPresent(
    item?.reason,
    item?.overrideReason,
    item?.override_reason,
    item?.metadata?.reason,
    item?.metadata?.overrideReason,
    item?.metadata?.override_reason,
    item?.metadata?.override?.reason,
    ''
  );

const buildInvoiceDocumentHtml = ({ invoice, companyDetails, clientRecord, clientDisplay }) => {
  const rawInvoice = invoice?.raw || invoice;
  const reference = firstDisplayValue(invoice?.ref, rawInvoice?.reference, rawInvoice?.invoiceNumber, rawInvoice?.invoice_number, invoice?.id, 'Invoice');
  const invoiceDate = formatDate(firstPresent(invoice?.date, rawInvoice?.invoiceDate, rawInvoice?.invoice_date, rawInvoice?.date, rawInvoice?.createdAt, rawInvoice?.created_at));
  const dueDate = formatDate(firstPresent(invoice?.due, rawInvoice?.dueDate, rawInvoice?.due_date, rawInvoice?.dueAt, rawInvoice?.due_at));
  const lineItems = invoice?.lineItems?.length ? invoice.lineItems : extractInvoiceLineItems(rawInvoice);
  const companyAddressLines = companyDetails?.addressLines || [];
  const clientAddressLines = getInvoiceClientAddressLines(invoice, clientRecord);
  const clientName = firstDisplayValue(clientDisplay, invoice?.client, getClientDisplayName(clientRecord), getInlineInvoiceClientDisplay(rawInvoice), 'Unnamed Client');
  const clientEmail = getInvoiceClientEmailDisplay(invoice, clientRecord);
  const isClientInvoice = isClientInvoiceRecord(invoice);
  const paymentParts = [
    companyDetails?.bankName ? `Bank: ${companyDetails.bankName}` : '',
    companyDetails?.sortCode ? `Sort Code: ${companyDetails.sortCode}` : '',
    companyDetails?.accountNumber ? `Account: ${companyDetails.accountNumber}` : '',
  ].filter(Boolean);

  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <title>${escapeHtml(reference)}</title>
  <style>
    body { margin: 0; font-family: Arial, Helvetica, sans-serif; color: #020617; background: #fff; }
    .top-bar { height: 8px; background: #3f3f3f; }
    .page { padding: 52px 50px 70px; }
    .header { display: flex; justify-content: space-between; gap: 40px; }
    .brand { font-size: 30px; font-weight: 600; letter-spacing: -0.02em; color: #0b1f44; }
    .brand span { color: #ff6900; }
    .muted { color: #4b5563; }
    .small { font-size: 14px; line-height: 1.45; }
    .invoice-meta { text-align: right; }
    .invoice-meta h1 { margin: 0 0 2px; font-size: 26px; line-height: 1; }
    .addresses { display: grid; grid-template-columns: 1fr 1fr; gap: 80px; margin-top: 52px; max-width: 920px; }
    .label { margin-bottom: 6px; color: #8a9099; font-size: 14px; text-transform: uppercase; letter-spacing: 0.02em; }
    .name { margin-bottom: 3px; font-size: 20px; font-weight: 700; }
    .address { margin-top: 14px; line-height: 1.45; }
    table { width: 100%; border-collapse: collapse; margin-top: 40px; }
    th { background: #f6f7f9; color: #4b5563; font-size: 14px; text-align: left; padding: 14px 16px; text-transform: uppercase; }
    td { border-bottom: 1px solid #eef1f5; padding: 14px 16px; font-size: 14px; }
    .right { text-align: right; }
    .totals { width: 375px; margin: 30px 0 0 auto; font-size: 20px; }
    .totals-row { display: flex; justify-content: space-between; padding: 8px 14px; }
    .totals-row.total { border-top: 2px solid #132347; font-weight: 800; }
    .payment { margin-top: 66px; border-radius: 8px; background: #f6f7f9; padding: 24px 26px; font-size: 16px; }
    .payment strong { display: block; margin-bottom: 2px; }
    @media print {
      .top-bar { display: none; }
      .page { padding: 44px 48px; }
    }
  </style>
</head>
<body>
  <div class="top-bar"></div>
  <main class="page">
    <section class="header">
      <div>
        <div class="brand">${escapeHtml(companyDetails?.companyName || DEFAULT_COMPANY_BILLING_DETAILS.companyName).replace(/PickPackPro/i, 'Pick<span>Pack</span>Pro')}</div>
        <div class="small muted">${escapeHtml(companyDetails?.website || DEFAULT_COMPANY_BILLING_DETAILS.website)}</div>
        <div class="address small">
          <div class="label">Company Address</div>
          ${buildAddressHtml(companyAddressLines)}
        </div>
      </div>
      <div class="invoice-meta">
        <h1>${escapeHtml(reference)}</h1>
        <div class="small muted">Invoice Date: ${escapeHtml(invoiceDate)}</div>
        <div class="small muted">Due: ${escapeHtml(dueDate)}</div>
      </div>
    </section>

    <section class="addresses">
      <div>
        <div class="label">Billed To</div>
        <div class="name">${escapeHtml(clientName)}</div>
        ${clientEmail ? `<div class="small">${escapeHtml(clientEmail)}</div>` : ''}
        <div class="address small">
          <div class="label">Client Address</div>
          ${buildAddressHtml(clientAddressLines)}
        </div>
      </div>
    </section>

    <table>
      <thead>
        <tr>
          <th>Description</th>
          <th class="right">${isClientInvoice ? 'Unit' : 'Qty'}</th>
          <th class="right">Rate</th>
          <th class="right">Amount</th>
          ${isClientInvoice ? '' : '<th class="right">VAT</th>'}
        </tr>
      </thead>
      <tbody>
        ${lineItems.map((item, index) => {
          const description = getInvoiceLineDescription(item, index);
          const quantity = firstPresent(item?.unit, item?.quantity, item?.qty, item?.units, '');
          const rate = firstPresent(item?.rate, item?.unitRate, item?.unit_rate, item?.unitPrice, item?.unit_price, item?.pricePerUnit, '');
          return `<tr>
            <td>${escapeHtml(description)}</td>
            <td class="right">${escapeHtml(quantity)}</td>
            <td class="right">${rate !== '' ? escapeHtml(formatCurrency(rate)) : ''}</td>
            <td class="right">${escapeHtml(formatCurrency(getInvoiceLineAmount(item)))}</td>
            ${isClientInvoice ? '' : `<td class="right">${escapeHtml(formatCurrency(getInvoiceLineVat(item)))}</td>`}
          </tr>`;
        }).join('')}
      </tbody>
    </table>

    <section class="totals">
      ${isClientInvoice ? '' : `<div class="totals-row"><span>Subtotal</span><span>${escapeHtml(formatCurrency(invoice?.subtotal))}</span></div>`}
      ${isClientInvoice ? '' : `<div class="totals-row"><span>VAT</span><span>${escapeHtml(formatCurrency(invoice?.vat))}</span></div>`}
      <div class="totals-row total"><span>Total</span><span>${escapeHtml(formatCurrency(invoice?.total))}</span></div>
    </section>

    <section class="payment">
      <strong>Payment - Bank Transfer</strong>
      ${paymentParts.length ? `<div>${escapeHtml(paymentParts.join(' | '))}</div>` : ''}
      <div>Reference: ${escapeHtml(reference)}</div>
      ${companyDetails?.vatNumber ? `<div>VAT Number: ${escapeHtml(companyDetails.vatNumber)}</div>` : ''}
    </section>
  </main>
</body>
</html>`;
};

const createEmptyManualLineForm = () => ({
  description: '',
  serviceCode: '',
  qty: '1',
  unitRate: '',
  vatRate: '',
  reason: '',
});

const extractSourceRecord = (payload = {}, recordKeys = []) => {
  const candidates = [payload, payload?.data, payload?.result, payload?.payload, payload?.data?.data].filter(Boolean);

  for (const candidate of candidates) {
    for (const key of recordKeys) {
      if (candidate?.[key] && typeof candidate[key] === 'object' && !Array.isArray(candidate[key])) {
        return candidate[key];
      }
    }

    if (candidate && typeof candidate === 'object' && !Array.isArray(candidate) && (candidate.id || candidate.uuid || candidate.reference)) {
      return candidate;
    }
  }

  return {};
};

const extractSourceRows = (payload = {}, rowKeys = []) => {
  const candidates = [payload, payload?.data, payload?.result, payload?.payload, payload?.data?.data].filter(Boolean);

  for (const candidate of candidates) {
    if (Array.isArray(candidate)) return candidate;

    for (const key of rowKeys) {
      if (Array.isArray(candidate?.[key])) return candidate[key];
    }
  }

  return [];
};

const sourceRecordMatchesId = (record = {}, sourceId = '') => {
  const normalizedSourceId = String(sourceId || '').trim();
  if (!normalizedSourceId) return false;

  return [
    record?.id,
    record?.uuid,
    record?.shipmentId,
    record?.shipment_id,
    record?.subShipmentId,
    record?.sub_shipment_id,
  ].some((value) => String(value || '').trim() === normalizedSourceId);
};

const fetchSourcePayload = async (endpoint = '', cache = new Map()) => {
  if (!endpoint) return null;
  if (cache.has(endpoint)) return cache.get(endpoint);

  const request = fetch(endpoint, {
    method: 'GET',
    headers: buildHeaders(),
    cache: 'no-store',
  })
    .then(parseResponse)
    .catch(() => null);

  cache.set(endpoint, request);
  return request;
};

const fetchShipmentReference = async (shipmentId = '', cache) => {
  if (!shipmentId) return '';

  const payload = await fetchSourcePayload(`${API_BASE_URL}/api/shipments/${encodeURIComponent(shipmentId)}`, cache);
  const shipment = extractSourceRecord(payload, ['shipment', 'record', 'row']);
  return getShipmentReferenceValue(shipment);
};

const fetchSubShipmentReference = async (subShipmentId = '', shipmentId = '', cache) => {
  if (!subShipmentId) return '';

  const directPayload = await fetchSourcePayload(`${API_BASE_URL}/api/sub-shipments/${encodeURIComponent(subShipmentId)}`, cache);
  const directSubShipment = extractSourceRecord(directPayload, ['subShipment', 'sub_shipment', 'record', 'row']);
  const directReference = getSubShipmentReferenceValue(directSubShipment);
  if (directReference) return directReference;

  if (!shipmentId) return '';

  const listPayload = await fetchSourcePayload(`${API_BASE_URL}/api/shipments/${encodeURIComponent(shipmentId)}/sub-shipments`, cache);
  const subShipments = extractSourceRows(listPayload, ['subShipments', 'sub_shipments', 'subshipments', 'rows', 'items', 'records', 'results']);
  const matchedSubShipment = subShipments.find((subShipment) => sourceRecordMatchesId(subShipment, subShipmentId));
  return getSubShipmentReferenceValue(matchedSubShipment);
};

const Billing = () => {
  const location = useLocation();
  const [selectedInvoice, setSelectedInvoice] = useState(null);
  const [dispatchInvoices, setDispatchInvoices] = useState([]);
  const [clientInvoices, setClientInvoices] = useState([]);
  const [clients, setClients] = useState([]);
  const [companyBillingDetails, setCompanyBillingDetails] = useState(DEFAULT_COMPANY_BILLING_DETAILS);
  const [manualLineForm, setManualLineForm] = useState(createEmptyManualLineForm);
  const [editingLineItemId, setEditingLineItemId] = useState('');
  const [editingLineSource, setEditingLineSource] = useState('');
  const [showManualLineForm, setShowManualLineForm] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [isInvoiceDetailLoading, setIsInvoiceDetailLoading] = useState(false);
  const [invoiceActionKey, setInvoiceActionKey] = useState('');
  const [lineActionKey, setLineActionKey] = useState('');
  const [openedInvoiceQuery, setOpenedInvoiceQuery] = useState('');
  const [invoiceCategory, setInvoiceCategory] = useState(INVOICE_CATEGORY_DISPATCH);
  const [invoicePages, setInvoicePages] = useState({
    [INVOICE_CATEGORY_DISPATCH]: 1,
    [INVOICE_CATEGORY_CLIENT]: 1,
  });
  const [invoiceSearchTerms, setInvoiceSearchTerms] = useState({
    [INVOICE_CATEGORY_DISPATCH]: '',
    [INVOICE_CATEGORY_CLIENT]: '',
  });
  const [debouncedInvoiceSearchTerms, setDebouncedInvoiceSearchTerms] = useState({
    [INVOICE_CATEGORY_DISPATCH]: '',
    [INVOICE_CATEGORY_CLIENT]: '',
  });
  const [invoiceStatusFilters, setInvoiceStatusFilters] = useState({
    [INVOICE_CATEGORY_DISPATCH]: 'all',
    [INVOICE_CATEGORY_CLIENT]: 'all',
  });
  const [invoiceListMetas, setInvoiceListMetas] = useState({
    [INVOICE_CATEGORY_DISPATCH]: createInvoiceListMeta(),
    [INVOICE_CATEGORY_CLIENT]: createInvoiceListMeta(),
  });
  const [invoiceLoading, setInvoiceLoading] = useState({
    [INVOICE_CATEGORY_DISPATCH]: false,
    [INVOICE_CATEGORY_CLIENT]: false,
  });
  const [sendInvoiceTarget, setSendInvoiceTarget] = useState(null);
  const [deleteInvoiceTarget, setDeleteInvoiceTarget] = useState(null);
  const [showClientInvoiceForm, setShowClientInvoiceForm] = useState(false);
  const [clientInvoiceForm, setClientInvoiceForm] = useState(createEmptyClientInvoiceForm);
  const [selectedClientInvoiceIds, setSelectedClientInvoiceIds] = useState([]);
  const [bulkDeleteClientInvoicesTarget, setBulkDeleteClientInvoicesTarget] = useState(false);
  const [deletedInvoiceKeys, setDeletedInvoiceKeys] = useState([]);
  const [sourceReferenceLookup, setSourceReferenceLookup] = useState({ shipments: {}, subShipments: {} });
  const pendingSourceReferenceRequests = useRef(new Set());

  const invoices = invoiceCategory === INVOICE_CATEGORY_CLIENT ? clientInvoices : dispatchInvoices;
  const invoicePage = invoicePages[invoiceCategory] || 1;
  const invoiceSearchTerm = invoiceSearchTerms[invoiceCategory] || '';
  const debouncedInvoiceSearchTerm = debouncedInvoiceSearchTerms[invoiceCategory] || '';
  const invoiceStatusFilter = invoiceStatusFilters[invoiceCategory] || 'all';
  const invoiceListMeta = invoiceListMetas[invoiceCategory] || createInvoiceListMeta();
  const isLoading = Boolean(invoiceLoading[invoiceCategory]);

  const setInvoicesForCategory = (category, updater) => {
    const setCategoryInvoices = category === INVOICE_CATEGORY_CLIENT ? setClientInvoices : setDispatchInvoices;
    setCategoryInvoices(updater);
  };

  const setInvoices = (updater) => {
    setInvoicesForCategory(invoiceCategory, updater);
  };

  const setInvoicePage = (updater) => {
    setInvoicePages((currentPages) => {
      const currentPage = currentPages[invoiceCategory] || 1;
      const nextPage = typeof updater === 'function' ? updater(currentPage) : updater;
      return { ...currentPages, [invoiceCategory]: nextPage };
    });
  };

  const clientLookup = useMemo(() => {
    const lookup = new Map();

    clients.forEach((client) => {
      const displayName = getClientDisplayName(client);
      [
        getClientId(client),
        client?.id,
        client?.uuid,
        client?.clientId,
        client?.client_id,
        client?.userId,
        client?.user_id,
        getClientEmail(client),
      ]
        .map((value) => String(value || '').trim())
        .filter(Boolean)
        .forEach((key) => lookup.set(key, displayName));
    });

    return lookup;
  }, [clients]);

  const resolveInvoiceClientDisplay = (invoice = {}) => {
    const clientId = String(invoice.clientId || getInvoiceClientId(invoice.raw || invoice) || '').trim();
    const matchedClient = clientLookup.get(clientId);
    if (matchedClient) return matchedClient;

    const inlineDisplay = cleanDisplayValue(invoice.client) || getInlineInvoiceClientDisplay(invoice.raw || invoice);
    return inlineDisplay || 'Unnamed Client';
  };

  const resolveInvoiceSourceReference = (invoice = {}) => {
    const directReference = cleanDisplayValue(invoice.sourceReference) || cleanDisplayValue(getInvoiceSourceReference(invoice.raw || invoice));
    if (directReference) return directReference;

    const invoiceType = getInvoiceTypeValue(invoice);
    if (invoiceType === 'shipment') {
      const shipmentId = String(invoice.shipmentId || invoice.sourceId || '').trim();
      return shipmentId ? sourceReferenceLookup.shipments[shipmentId] || '' : '';
    }

    if (invoiceType === 'sub_shipment' || invoiceType === 'sub-shipment') {
      const subShipmentId = String(invoice.subShipmentId || invoice.sourceId || '').trim();
      return subShipmentId ? sourceReferenceLookup.subShipments[subShipmentId] || '' : '';
    }

    return '';
  };

  const resolveInvoiceSourceDisplay = (invoice = {}) =>
    resolveInvoiceSourceReference(invoice) || getInvoiceSourceFallbackDisplay(invoice.raw || invoice);

  const loadInvoices = async (category = invoiceCategory, extraDeletedKeys = [], pageOverride) => {
    const currentPage = Number(pageOverride || invoicePages[category] || 1) || 1;
    const currentSearchTerm = String(debouncedInvoiceSearchTerms[category] || '').trim();
    const currentStatusFilter = String(invoiceStatusFilters[category] || 'all').trim() || 'all';

    try {
      setInvoiceLoading((currentLoading) => ({ ...currentLoading, [category]: true }));
      setError('');
      const query = new URLSearchParams({
        page: String(currentPage),
        limit: String(BILLING_PAGE_SIZE),
        category,
        search: currentSearchTerm,
        status: currentStatusFilter,
      });

      const response = await fetch(`${API_BASE_URL}/api/invoices?${query.toString()}`, {
        method: 'GET',
        headers: buildHeaders(),
        cache: 'no-store',
      });
      const payload = await parseResponse(response);
      const deletedKeySet = new Set([...deletedInvoiceKeys, ...extraDeletedKeys]);
      const normalizedInvoices = extractInvoices(payload)
        .map(normalizeInvoice)
        .filter((invoice) => !getInvoiceLookupCandidates(invoice).some((key) => deletedKeySet.has(key)));
      setInvoicesForCategory(category, normalizedInvoices);
      const source = payload?.data && typeof payload.data === 'object' ? payload.data : payload || {};
      const total = Number(source.total || normalizedInvoices.length || 0);
      const limit = Number(source.limit || BILLING_PAGE_SIZE) || BILLING_PAGE_SIZE;
      setInvoiceListMetas((currentMetas) => ({
        ...currentMetas,
        [category]: {
          total,
          page: Number(source.page || currentPage || 1) || 1,
          limit,
          totalPages: Number(source.totalPages || source.total_pages || Math.ceil(total / limit)) || 1,
        },
      }));
    } catch (requestError) {
      setError(requestError.message);
      setInvoicesForCategory(category, []);
      setInvoiceListMetas((currentMetas) => ({
        ...currentMetas,
        [category]: createInvoiceListMeta(),
      }));
    } finally {
      setInvoiceLoading((currentLoading) => ({ ...currentLoading, [category]: false }));
    }
  };

  const loadClients = async () => {
    try {
      const response = await fetch(`${API_BASE_URL}/api/clients`, {
        method: 'GET',
        headers: buildHeaders(),
      });
      const payload = await parseResponse(response);
      setClients(extractClients(payload));
    } catch {
      setClients([]);
    }
  };

  const loadSettings = async () => {
    try {
      const response = await fetch(`${API_BASE_URL}/api/settings`, {
        method: 'GET',
        headers: buildHeaders(),
        cache: 'no-store',
      });
      const payload = await parseResponse(response);
      setCompanyBillingDetails(getCompanyBillingDetailsFromSettings(payload));
    } catch {
      setCompanyBillingDetails(DEFAULT_COMPANY_BILLING_DETAILS);
    }
  };

  useEffect(() => {
    loadClients();
    loadSettings();
  }, []);

  useEffect(() => {
    loadInvoices(invoiceCategory);
  }, [invoicePage, debouncedInvoiceSearchTerm, invoiceStatusFilter, invoiceCategory]);

  useEffect(() => {
    const category = invoiceCategory;
    const timer = setTimeout(() => {
      setDebouncedInvoiceSearchTerms((currentTerms) => ({
        ...currentTerms,
        [category]: invoiceSearchTerms[category] || '',
      }));
    }, 250);
    return () => clearTimeout(timer);
  }, [invoiceCategory, invoiceSearchTerm, invoiceSearchTerms]);

  const displayInvoices = useMemo(
    () =>
      invoices.map((invoice) => {
        const sourceReference = resolveInvoiceSourceReference(invoice);
        return {
          ...invoice,
          client: resolveInvoiceClientDisplay(invoice),
          sourceReference,
          source: sourceReference || resolveInvoiceSourceDisplay(invoice),
        };
      }),
    [invoices, clientLookup, sourceReferenceLookup]
  );
  const invoiceStatusOptions = useMemo(() => {
    const hiddenStatusFilters = new Set(['cancelled', 'canceled', 'void', 'voided']);
    const baseStatuses = ['draft', 'sent', 'paid', 'overdue'];
    const statuses = new Set(baseStatuses);

    displayInvoices.forEach((invoice) => {
      const status = getInvoiceStatusValue(invoice);
      if (status && !hiddenStatusFilters.has(status)) statuses.add(status);
    });

    return [...statuses];
  }, [displayInvoices]);
  const filteredInvoices = displayInvoices;
  const invoiceTotalPages = Math.max(1, Number(invoiceListMeta.totalPages || 1) || 1);
  const invoicePaginationPages = useMemo(
    () => getPaginationPages(invoicePage, invoiceTotalPages),
    [invoicePage, invoiceTotalPages]
  );
  const paginatedInvoices = filteredInvoices;
  const invoicePaginationStart = invoiceListMeta.total ? (invoicePage - 1) * BILLING_PAGE_SIZE + 1 : 0;
  const invoicePaginationEnd = Math.min((invoicePage - 1) * BILLING_PAGE_SIZE + paginatedInvoices.length, invoiceListMeta.total);
  const isClientInvoiceCategory = invoiceCategory === INVOICE_CATEGORY_CLIENT;
  const visibleClientInvoiceIds = isClientInvoiceCategory
    ? paginatedInvoices.map(getInvoiceRouteId).filter(Boolean)
    : [];
  const allVisibleClientInvoicesSelected =
    visibleClientInvoiceIds.length > 0 && visibleClientInvoiceIds.every((invoiceId) => selectedClientInvoiceIds.includes(invoiceId));

  useEffect(() => {
    if (invoiceCategory === INVOICE_CATEGORY_CLIENT) return undefined;

    let isCancelled = false;
    const sourceRequestCache = new Map();
    const nextShipments = {};
    const nextSubShipments = {};
    const requests = [];
    const hasOwn = (source, key) => Object.prototype.hasOwnProperty.call(source || {}, key);

    paginatedInvoices.forEach((invoice) => {
      if (resolveInvoiceSourceReference(invoice)) return;

      const invoiceType = getInvoiceTypeValue(invoice);
      if (invoiceType === 'shipment') {
        const shipmentId = String(invoice.shipmentId || invoice.sourceId || '').trim();
        const pendingKey = `shipment:${shipmentId}`;
        if (!shipmentId || hasOwn(sourceReferenceLookup.shipments, shipmentId) || pendingSourceReferenceRequests.current.has(pendingKey)) return;

        pendingSourceReferenceRequests.current.add(pendingKey);
        requests.push(
          fetchShipmentReference(shipmentId, sourceRequestCache)
            .then((reference) => {
              nextShipments[shipmentId] = cleanDisplayValue(reference);
            })
            .finally(() => {
              pendingSourceReferenceRequests.current.delete(pendingKey);
            })
        );
        return;
      }

      if (invoiceType === 'sub_shipment' || invoiceType === 'sub-shipment') {
        const subShipmentId = String(invoice.subShipmentId || invoice.sourceId || '').trim();
        const pendingKey = `subShipment:${subShipmentId}`;
        if (!subShipmentId || hasOwn(sourceReferenceLookup.subShipments, subShipmentId) || pendingSourceReferenceRequests.current.has(pendingKey)) return;

        pendingSourceReferenceRequests.current.add(pendingKey);
        requests.push(
          fetchSubShipmentReference(subShipmentId, invoice.shipmentId, sourceRequestCache)
            .then((reference) => {
              nextSubShipments[subShipmentId] = cleanDisplayValue(reference);
            })
            .finally(() => {
              pendingSourceReferenceRequests.current.delete(pendingKey);
            })
        );
      }
    });

    if (!requests.length) return undefined;

    Promise.allSettled(requests).then(() => {
      if (isCancelled || (!Object.keys(nextShipments).length && !Object.keys(nextSubShipments).length)) return;
      setSourceReferenceLookup((current) => ({
        shipments: { ...current.shipments, ...nextShipments },
        subShipments: { ...current.subShipments, ...nextSubShipments },
      }));
    });

    return () => {
      isCancelled = true;
    };
  }, [paginatedInvoices, sourceReferenceLookup, invoiceCategory]);

  useEffect(() => {
    setInvoicePages((currentPages) => {
      const currentPage = currentPages[invoiceCategory] || 1;
      const nextPage = Math.min(Math.max(currentPage, 1), invoiceTotalPages);
      if (nextPage === currentPage) return currentPages;
      return { ...currentPages, [invoiceCategory]: nextPage };
    });
  }, [invoiceCategory, invoiceTotalPages]);

  useEffect(() => {
    setInvoicePage(1);
    setSelectedClientInvoiceIds([]);
  }, [debouncedInvoiceSearchTerm, invoiceStatusFilter, invoiceCategory]);


  const selectedInvoiceView = selectedInvoice
    ? {
        ...selectedInvoice,
        client: resolveInvoiceClientDisplay(selectedInvoice),
        lineItems: Array.isArray(selectedInvoice.lineItems) ? selectedInvoice.lineItems : [],
      }
    : null;

  const statsCards = useMemo(() => {
    const outstanding = invoices
      .filter((invoice) => !isInvoicePaid(invoice) && !isInvoiceCancelled(invoice))
      .reduce((sum, invoice) => sum + invoice.total, 0);
    const paid = invoices
      .filter((invoice) => {
        if (!isInvoicePaid(invoice)) return false;
        const paidDate = getInvoicePaidDate(invoice) || getInvoiceDateValue(invoice);
        return isDateInCurrentMonth(paidDate);
      })
      .reduce((sum, invoice) => sum + invoice.total, 0);
    const overdue = invoices.filter(isInvoiceOverdue).length;
    return [
      { title: 'OUTSTANDING', value: formatCurrency(outstanding), icon: FileText, iconBg: 'bg-orange-50', iconColor: 'text-[#ff6900]' },
      { title: 'PAID', value: formatCurrency(paid), icon: CheckCircle, iconBg: 'bg-green-50', iconColor: 'text-green-600' },
      { title: 'OVERDUE', value: String(overdue), icon: AlertCircle, iconBg: 'bg-red-50', iconColor: 'text-red-600' },
    ];
  }, [invoices]);

  const fetchInvoiceDetail = async (invoice) => {
    const fallbackInvoice = typeof invoice === 'object'
      ? invoice
      : invoices.find((row) => getInvoiceLookupCandidates(row).includes(String(invoice || '').trim())) || { id: invoice, ref: invoice };
    const lookupCandidates = getInvoiceLookupCandidates(fallbackInvoice);

    for (const lookupId of lookupCandidates) {
      try {
        const response = await fetch(`${API_BASE_URL}/api/invoices/${encodeURIComponent(lookupId)}`, {
          method: 'GET',
          headers: buildHeaders(),
          cache: 'no-store',
        });
        const payload = await parseResponse(response);
        const detailPayload = getInvoiceDetailPayload(payload);
        const detailLineItems = extractInvoiceLineItems(detailPayload);
        const fallbackLineItems = detailLineItems.length
          ? detailLineItems
          : extractInvoiceLineItems(fallbackInvoice.raw || fallbackInvoice);
        return normalizeInvoice({
          ...(fallbackInvoice.raw || {}),
          ...fallbackInvoice,
          ...detailPayload,
          lineItems: fallbackLineItems,
        });
      } catch {
        // Try the next candidate; some routes accept UUIDs while others accept invoice references.
      }
    }

    return fallbackInvoice;
  };

  const handleViewInvoice = async (invoice) => {
    try {
      setError('');
      setMessage('');
      setSelectedInvoice(typeof invoice === 'object' ? invoice : { id: invoice, ref: invoice });
      setIsInvoiceDetailLoading(true);
      setSelectedInvoice(await fetchInvoiceDetail(invoice));
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setIsInvoiceDetailLoading(false);
    }
  };

  const handleRefreshSelectedInvoice = async ({ showMessage = true } = {}) => {
    if (!selectedInvoice) return;

    try {
      setError('');
      if (showMessage) setMessage('');
      setIsInvoiceDetailLoading(true);
      const refreshedInvoice = await fetchInvoiceDetail(selectedInvoice);
      setSelectedInvoice(refreshedInvoice);
      await loadInvoices(invoiceCategory);
      if (showMessage) setMessage('Invoice refreshed.');
    } catch (requestError) {
      if (showMessage) setError(requestError.message);
    } finally {
      setIsInvoiceDetailLoading(false);
    }
  };

  useEffect(() => {
    const invoiceId = new URLSearchParams(location.search).get('invoice') || '';
    if (!invoiceId || openedInvoiceQuery === invoiceId || !invoices.length) return;
    setOpenedInvoiceQuery(invoiceId);
    handleViewInvoice(invoiceId);
  }, [location.search, invoices, openedInvoiceQuery]);

  useEffect(() => {
    let refreshTimer = null;

    const scheduleInvoiceRefresh = () => {
      window.clearTimeout(refreshTimer);
      refreshTimer = window.setTimeout(() => {
        if (selectedInvoice) {
          handleRefreshSelectedInvoice({ showMessage: false });
        } else {
          loadInvoices(invoiceCategory);
        }
      }, 700);
    };

    const handleMutation = (event) => {
      const url = String(event?.detail?.url || '');
      if (!url.includes('/api/invoices') && !url.includes('/api/shipments') && !url.includes('/api/boxes')) return;
      scheduleInvoiceRefresh();
    };

    window.addEventListener(API_MUTATION_EVENT_NAME, handleMutation);

    return () => {
      window.clearTimeout(refreshTimer);
      window.removeEventListener(API_MUTATION_EVENT_NAME, handleMutation);
    };
  }, [invoiceCategory, selectedInvoice]);

  const handleDownloadPdf = async (invoice) => {
    const invoiceId = getInvoiceRouteId(invoice);
    const invoiceRef = invoice?.ref || invoice?.reference || invoice?.invoiceNumber || invoice?.invoice_number || invoiceId;

    try {
      setError('');
      setMessage('');
      if (!invoiceId) throw new Error('Invoice identifier is missing.');

      const response = await fetch(`${API_BASE_URL}/api/invoices/${encodeURIComponent(invoiceId)}/pdf`, {
        method: 'GET',
        headers: buildHeaders(),
        cache: 'no-store',
      });
      if (!response.ok) await parseResponse(response);

      const contentType = String(response.headers.get('content-type') || '').toLowerCase();
      if (contentType.includes('application/json')) {
        const payload = await response.json();
        throw new Error(payload?.message || payload?.error || 'Invoice PDF endpoint returned JSON instead of a PDF.');
      }
      if (contentType.includes('text/html')) {
        throw new Error('Invoice PDF endpoint returned HTML instead of a PDF.');
      }

      const blob = await response.blob();
      const fileName = ensurePdfFileName(
        getContentDispositionFileName(response.headers.get('content-disposition')),
        invoiceRef || invoiceId
      );
      downloadBlob(blob, fileName);
      setMessage('Invoice PDF downloaded.');
    } catch (downloadError) {
      setError(downloadError.message);
    }
  };

  const mergeUpdatedInvoice = (invoicePayload, fallbackInvoice = {}) => {
    const updatedInvoice = normalizeInvoice({
      ...(fallbackInvoice.raw || {}),
      ...fallbackInvoice,
      ...(invoicePayload || {}),
    });

    setInvoices((currentInvoices) =>
      currentInvoices.map((currentInvoice) =>
        getInvoiceLookupCandidates(currentInvoice).some((key) => getInvoiceLookupCandidates(updatedInvoice).includes(key))
          ? { ...currentInvoice, ...updatedInvoice }
          : currentInvoice
      )
    );

    setSelectedInvoice((currentSelected) => {
      if (!currentSelected) return currentSelected;
      const matchesSelected = getInvoiceLookupCandidates(currentSelected).some((key) => getInvoiceLookupCandidates(updatedInvoice).includes(key));
      return matchesSelected ? { ...currentSelected, ...updatedInvoice } : currentSelected;
    });
  };

  const removeInvoiceFromState = (invoice = {}) => {
    const removedKeys = getInvoiceLookupCandidates(invoice);

    setInvoices((currentInvoices) =>
      currentInvoices.filter(
        (currentInvoice) => !getInvoiceLookupCandidates(currentInvoice).some((key) => removedKeys.includes(key))
      )
    );

    setSelectedInvoice((currentSelected) => {
      if (!currentSelected) return currentSelected;
      const matchesSelected = getInvoiceLookupCandidates(currentSelected).some((key) => removedKeys.includes(key));
      return matchesSelected ? null : currentSelected;
    });
  };

  const handleDeleteInvoice = async (invoice) => {
    const invoiceId = getInvoiceRouteId(invoice);

    try {
      setError('');
      setMessage('');
      if (!invoiceId) throw new Error('Invoice identifier is missing.');
      setInvoiceActionKey(`${invoiceId}:delete`);

      const response = await fetch(`${API_BASE_URL}/api/invoices/${encodeURIComponent(invoiceId)}`, {
        method: 'DELETE',
        headers: buildHeaders(),
      });
      const payload = await parseResponse(response);
      const deletedInvoice = normalizeInvoice({
        ...(invoice?.raw || {}),
        ...invoice,
        ...(payload?.data?.invoice || payload?.invoice || {}),
      });

      const removedKeys = getInvoiceLookupCandidates(deletedInvoice);
      setDeletedInvoiceKeys((currentKeys) => [...new Set([...currentKeys, ...removedKeys])]);
      removeInvoiceFromState(deletedInvoice);
      setDeleteInvoiceTarget(null);
      resetManualLineForm();
      setMessage(`Invoice ${deletedInvoice.ref || invoice?.ref || invoiceId} deleted.`);
      await loadInvoices(invoiceCategory, removedKeys);
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setInvoiceActionKey('');
    }
  };

  const handleSendInvoice = async (invoice) => {
    const invoiceId = getInvoiceRouteId(invoice);
    const shouldRefreshSelectedInvoice = Boolean(selectedInvoice);

    try {
      setError('');
      setMessage('');
      if (!invoiceId) throw new Error('Invoice identifier is missing.');
      setInvoiceActionKey(`${invoiceId}:send`);

      const response = await fetch(`${API_BASE_URL}/api/invoices/${encodeURIComponent(invoiceId)}/send`, {
        method: 'POST',
        headers: buildHeaders(),
      });
      const payload = await parseResponse(response);
      const invoicePayload = payload?.data?.invoice || payload?.invoice || getInvoiceDetailPayload(payload);
      mergeUpdatedInvoice(invoicePayload, invoice);
      await loadInvoices(invoiceCategory);
      if (shouldRefreshSelectedInvoice) {
        setSelectedInvoice(await fetchInvoiceDetail(invoicePayload || invoice));
      }
      setSendInvoiceTarget(null);
      setMessage('Invoice sent.');
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setInvoiceActionKey('');
    }
  };

  const handleUpdateInvoiceStatus = async (invoice, status) => {
    const invoiceId = getInvoiceRouteId(invoice);

    try {
      setError('');
      setMessage('');
      if (!invoiceId) throw new Error('Invoice identifier is missing.');
      setInvoiceActionKey(`${invoiceId}:${status}`);

      const response = await fetch(`${API_BASE_URL}/api/invoices/${encodeURIComponent(invoiceId)}/status`, {
        method: 'PATCH',
        headers: buildHeaders(true),
        body: JSON.stringify({ status }),
      });
      const payload = await parseResponse(response);
      mergeUpdatedInvoice(getInvoiceDetailPayload(payload), invoice);
      setMessage(`Invoice marked as ${status}.`);
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setInvoiceActionKey('');
    }
  };

  const getClientInvoiceAmount = () => {
    const unit = Number(clientInvoiceForm.unit);
    const rate = Number(clientInvoiceForm.rate);
    if (!Number.isFinite(unit) || !Number.isFinite(rate)) return 0;
    return Number((unit * rate).toFixed(2));
  };

  const resetClientInvoiceForm = () => {
    setClientInvoiceForm(createEmptyClientInvoiceForm());
    setShowClientInvoiceForm(false);
  };

  const handleCreateClientInvoice = async (event) => {
    event.preventDefault();

    try {
      setError('');
      setMessage('');
      const clientId = String(clientInvoiceForm.clientId || '').trim();
      const invoiceDate = String(clientInvoiceForm.invoiceDate || '').trim();
      const description = String(clientInvoiceForm.description || '').trim();
      const unit = Number(clientInvoiceForm.unit);
      const rate = Number(clientInvoiceForm.rate);
      const amount = getClientInvoiceAmount();

      if (!clientId) throw new Error('Client is required.');
      if (!invoiceDate) throw new Error('Invoice date is required.');
      if (!description) throw new Error('Description is required.');
      if (!Number.isFinite(unit) || unit <= 0) throw new Error('Unit must be a positive number.');
      if (!Number.isFinite(rate) || rate < 0) throw new Error('Rate must be zero or positive.');

      setInvoiceActionKey('client-invoice:create');
      const response = await fetch(`${API_BASE_URL}/api/invoices`, {
        method: 'POST',
        headers: buildHeaders(true),
        body: JSON.stringify({
          clientId,
          invoiceDate,
          invoiceType: clientInvoiceForm.invoiceType || 'monthly',
          description,
          unit,
          rate,
          amount,
          notes: String(clientInvoiceForm.notes || '').trim(),
        }),
      });
      await parseResponse(response);
      resetClientInvoiceForm();
      setInvoiceCategory(INVOICE_CATEGORY_CLIENT);
      setInvoicePages((currentPages) => ({ ...currentPages, [INVOICE_CATEGORY_CLIENT]: 1 }));
      setMessage('Client invoice created.');
      await loadInvoices(INVOICE_CATEGORY_CLIENT, [], 1);
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setInvoiceActionKey('');
    }
  };

  const handleToggleClientInvoiceSelection = (invoiceId) => {
    setSelectedClientInvoiceIds((currentIds) =>
      currentIds.includes(invoiceId)
        ? currentIds.filter((currentId) => currentId !== invoiceId)
        : [...currentIds, invoiceId]
    );
  };

  const handleToggleAllClientInvoiceSelections = (invoiceIds = []) => {
    const selectableIds = invoiceIds.filter(Boolean);
    const allSelected = selectableIds.length > 0 && selectableIds.every((invoiceId) => selectedClientInvoiceIds.includes(invoiceId));

    setSelectedClientInvoiceIds((currentIds) => {
      if (allSelected) return currentIds.filter((invoiceId) => !selectableIds.includes(invoiceId));
      return [...new Set([...currentIds, ...selectableIds])];
    });
  };

  const handleBulkDeleteClientInvoices = async () => {
    try {
      setError('');
      setMessage('');
      const ids = selectedClientInvoiceIds.filter(Boolean);
      if (!ids.length) throw new Error('Select at least one client invoice to delete.');

      setInvoiceActionKey('client-invoice:bulk-delete');
      const response = await fetch(`${API_BASE_URL}/api/invoices/bulk-delete`, {
        method: 'POST',
        headers: buildHeaders(true),
        body: JSON.stringify({ ids }),
      });
      const payload = await parseResponse(response);
      const deletedCount = Number(payload?.data?.deletedCount || payload?.data?.deleted_count || ids.length || 0);
      setSelectedClientInvoiceIds([]);
      setBulkDeleteClientInvoicesTarget(false);
      setMessage(`${deletedCount} client invoice${deletedCount === 1 ? '' : 's'} deleted.`);
      await loadInvoices(INVOICE_CATEGORY_CLIENT);
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setInvoiceActionKey('');
    }
  };

  const resetManualLineForm = () => {
    setManualLineForm(createEmptyManualLineForm());
    setEditingLineItemId('');
    setEditingLineSource('');
    setShowManualLineForm(false);
  };

  const startAddManualLine = () => {
    setManualLineForm(createEmptyManualLineForm());
    setEditingLineItemId('');
    setEditingLineSource('');
    setShowManualLineForm(true);
  };

  const startEditManualLine = (lineItem = {}) => {
    setManualLineForm({
      description: getInvoiceLineDescription(lineItem),
      serviceCode: firstPresent(lineItem?.serviceCode, lineItem?.service_code, ''),
      qty: String(getInvoiceLineQty(lineItem) || '1'),
      unitRate: String(getInvoiceLineUnitRate(lineItem) || ''),
      vatRate: String(getInvoiceLineVatRate(lineItem) || ''),
      reason: String(getInvoiceLineOverrideReason(lineItem) || ''),
    });
    setEditingLineItemId(getInvoiceLineId(lineItem));
    setEditingLineSource(getInvoiceLineSource(lineItem));
    setShowManualLineForm(true);
  };

  const buildManualLinePayload = () => {
    const description = String(manualLineForm.description || '').trim();
    const serviceCode = String(manualLineForm.serviceCode || '').trim();
    const qty = Number(manualLineForm.qty);
    const unitRate = Number(manualLineForm.unitRate);
    const vatRateText = String(manualLineForm.vatRate || '').trim();
    const vatRate = vatRateText === '' ? undefined : Number(vatRateText);
    const reason = String(manualLineForm.reason || '').trim();

    if (!description) throw new Error('Description is required.');
    if (!Number.isFinite(qty) || qty <= 0) throw new Error('Quantity must be positive.');
    if (!Number.isFinite(unitRate) || unitRate < 0) throw new Error('Unit rate must be zero or positive.');
    if (vatRate !== undefined && (!Number.isFinite(vatRate) || vatRate < 0 || vatRate > 1)) {
      throw new Error('VAT rate must be between 0 and 1.');
    }

    return {
      description,
      ...(serviceCode ? { serviceCode } : {}),
      qty,
      unitRate,
      ...(vatRate !== undefined ? { vatRate } : {}),
      ...(reason ? { reason } : {}),
    };
  };

  const replaceInvoiceFromPayload = async (payload, fallbackInvoice = selectedInvoiceView) => {
    const invoicePayload = payload?.data?.invoice || payload?.invoice || getInvoiceDetailPayload(payload);
    mergeUpdatedInvoice(invoicePayload, fallbackInvoice);
    setSelectedInvoice(await fetchInvoiceDetail(invoicePayload || fallbackInvoice));
    await loadInvoices(invoiceCategory);
  };

  const handleSubmitManualLine = async (event) => {
    event.preventDefault();
    const invoiceId = getInvoiceRouteId(selectedInvoiceView || {});

    try {
      setError('');
      setMessage('');
      if (!invoiceId) throw new Error('Invoice identifier is missing.');
      if (!canEditInvoiceLines(selectedInvoiceView)) throw new Error('Invoice lines can only be edited while the invoice is draft or sent.');

      const payload = buildManualLinePayload();
      const isEditing = Boolean(editingLineItemId);
      setLineActionKey(`${invoiceId}:${isEditing ? editingLineItemId : 'new'}`);

      const response = await fetch(
        isEditing
          ? `${API_BASE_URL}/api/invoices/${encodeURIComponent(invoiceId)}/line-items/${encodeURIComponent(editingLineItemId)}`
          : `${API_BASE_URL}/api/invoices/${encodeURIComponent(invoiceId)}/line-items`,
        {
          method: isEditing ? 'PATCH' : 'POST',
          headers: buildHeaders(true),
          body: JSON.stringify(payload),
        }
      );
      await replaceInvoiceFromPayload(await parseResponse(response));
      resetManualLineForm();
      setMessage(isEditing ? 'Invoice line updated.' : 'Manual service line added.');
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setLineActionKey('');
    }
  };

  const handleDeleteManualLine = async (lineItem = {}) => {
    const invoiceId = getInvoiceRouteId(selectedInvoiceView || {});
    const lineItemId = getInvoiceLineId(lineItem);

    try {
      setError('');
      setMessage('');
      if (!invoiceId || !lineItemId) throw new Error('Invoice line identifier is missing.');
      if (!canEditInvoiceLines(selectedInvoiceView)) {
        throw new Error('Invoice lines can only be edited while the invoice is draft or sent.');
      }
      if (isSystemInvoiceLine(lineItem)) {
        throw new Error('System-generated lines can be edited but not deleted.');
      }
      if (!window.confirm('Delete this manual invoice line?')) return;

      setLineActionKey(`${invoiceId}:${lineItemId}:delete`);
      const response = await fetch(
        `${API_BASE_URL}/api/invoices/${encodeURIComponent(invoiceId)}/line-items/${encodeURIComponent(lineItemId)}`,
        {
          method: 'DELETE',
          headers: buildHeaders(),
        }
      );
      await replaceInvoiceFromPayload(await parseResponse(response));
      setMessage('Manual service line deleted.');
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setLineActionKey('');
    }
  };

  const handleExport = () => {
    const rows = isClientInvoiceCategory
      ? [
          ['Invoice Ref', 'Client', 'Date', 'Description', 'Unit', 'Rate', 'Amount', 'Due', 'Status'],
          ...filteredInvoices.map((invoice) => [
            invoice.ref,
            invoice.client,
            invoice.date,
            invoice.description,
            invoice.unit,
            invoice.rate,
            invoice.amount,
            invoice.due,
            invoice.status,
          ]),
        ]
      : [
          ['Invoice Ref', 'Client', 'Type', 'Source', 'Date', 'Due', 'Subtotal', 'VAT', 'Total', 'Status'],
          ...filteredInvoices.map((invoice) => [
            invoice.ref,
            invoice.client,
            invoice.invoiceTypeLabel,
            invoice.source,
            invoice.date,
            invoice.due,
            invoice.subtotal,
            invoice.vat,
            invoice.total,
            invoice.status,
          ]),
        ];
    const csv = rows.map((row) => row.map((value) => `"${String(value)}"`).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = isClientInvoiceCategory ? 'client-invoices.csv' : 'dispatch-invoices.csv';
    link.click();
    URL.revokeObjectURL(url);
  };

  return (
    <Layout>
      <FullPageLoader show={isLoading} label="Loading invoices..." />
      <div className="">
        <div className="mb-6 flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-semibold text-gray-900">Billing</h1>
            <p className="mt-1 text-sm text-gray-500">Manage invoices and billing actions.</p>
          </div>
          <div className="flex items-center gap-3">
            <button onClick={() => loadInvoices()} className="inline-flex items-center gap-2 rounded-lg border border-gray-200 bg-white px-4 py-2 text-sm text-gray-700 hover:bg-gray-50"><RefreshCw size={15} />Refresh</button>
          </div>
        </div>

        {message ? <div className="mb-4 rounded-lg border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-700">{message}</div> : null}
        {error ? <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div> : null}

        <div className="mb-6 grid grid-cols-1 gap-6 md:grid-cols-3">
          {statsCards.map((card, index) => {
            const Icon = card.icon;
            return (
              <div key={index} className="rounded-lg border border-gray-200 bg-white p-6">
                <div className="mb-3 flex items-start justify-between">
                  <p className="text-xs font-semibold uppercase tracking-wider text-gray-500">{card.title}</p>
                  <div className={`rounded-lg p-2 ${card.iconBg}`}>
                    <Icon size={18} className={card.iconColor} />
                  </div>
                </div>
                <h3 className="text-3xl font-bold text-gray-900">{card.value}</h3>
              </div>
            );
          })}
        </div>

        <div className="overflow-hidden rounded-lg border border-gray-200 bg-white">
          <div className="flex flex-col gap-3 border-b border-gray-200 px-6 py-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <div className="mb-3 inline-flex rounded-lg border border-gray-200 bg-gray-50 p-1">
                {[
                  { value: INVOICE_CATEGORY_DISPATCH, label: 'Dispatch Invoices' },
                  { value: INVOICE_CATEGORY_CLIENT, label: 'Client Invoices' },
                ].map((tab) => (
                  <button
                    key={tab.value}
                    type="button"
                    onClick={() => setInvoiceCategory(tab.value)}
                    className={`rounded-md px-3 py-1.5 text-sm font-semibold transition-colors ${
                      invoiceCategory === tab.value ? 'bg-white text-[#ff6900] shadow-sm' : 'text-gray-500 hover:text-gray-900'
                    }`}
                  >
                    {tab.label}
                  </button>
                ))}
              </div>
              <h2 className="text-sm font-semibold text-gray-900">{isClientInvoiceCategory ? 'Client Invoices' : 'Dispatch Invoices'}</h2>
              <p className="mt-1 text-xs text-gray-500">
                {isClientInvoiceCategory
                  ? 'Independent client-level invoices for storage and account charges.'
                  : 'Shipment and sub-shipment invoices are created from dispatch events.'}
              </p>
            </div>
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
              {isClientInvoiceCategory ? (
                <button
                  type="button"
                  onClick={() => setShowClientInvoiceForm(true)}
                  className="inline-flex items-center justify-center gap-2 rounded-lg bg-[#ff6900] px-4 py-2 text-sm font-semibold text-white hover:bg-[#e55d00]"
                >
                  <Plus size={16} /> Create Client Invoice
                </button>
              ) : null}
              {isClientInvoiceCategory && selectedClientInvoiceIds.length ? (
                <button
                  type="button"
                  onClick={() => setBulkDeleteClientInvoicesTarget(true)}
                  className="inline-flex items-center justify-center gap-2 rounded-lg border border-red-200 bg-red-50 px-4 py-2 text-sm font-semibold text-red-700 hover:bg-red-100"
                >
                  <Trash2 size={16} /> Delete Selected ({selectedClientInvoiceIds.length})
                </button>
              ) : null}
              <select
                value={invoiceStatusFilter}
                onChange={(event) =>
                  setInvoiceStatusFilters((currentFilters) => ({
                    ...currentFilters,
                    [invoiceCategory]: event.target.value,
                  }))
                }
                aria-label="Filter invoices by status"
                className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-700 outline-none transition-colors focus:border-[#ff6900] sm:w-40"
              >
                <option value="all">All statuses</option>
                {invoiceStatusOptions.map((status) => (
                  <option key={status} value={status}>
                    {formatStatusLabel(status)}
                  </option>
                ))}
              </select>
              <label className="relative block">
                <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                <input
                  type="search"
                  value={invoiceSearchTerm}
                  onChange={(event) =>
                    setInvoiceSearchTerms((currentTerms) => ({
                      ...currentTerms,
                      [invoiceCategory]: event.target.value,
                    }))
                  }
                  placeholder={isClientInvoiceCategory ? 'Search client invoice, description' : 'Search client, invoice, source, type'}
                  className="w-full rounded-lg border border-gray-200 bg-white py-2 pl-9 pr-3 text-sm text-gray-700 outline-none transition-colors placeholder:text-gray-400 focus:border-[#ff6900] sm:w-80"
                />
              </label>
              <button onClick={handleExport} className="inline-flex items-center justify-center gap-2 rounded-lg border border-gray-200 bg-white px-4 py-2 text-sm text-gray-700 hover:bg-gray-50"><Download size={16} />Export</button>
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-gray-100 bg-gray-50">
                  {isClientInvoiceCategory ? (
                    <th className="px-4 py-3 text-left">
                      <input
                        type="checkbox"
                        checked={allVisibleClientInvoicesSelected}
                        onChange={() => handleToggleAllClientInvoiceSelections(visibleClientInvoiceIds)}
                        aria-label="Select all visible client invoices"
                        className="h-4 w-4 rounded border-gray-300 text-[#ff6900] focus:ring-[#ff6900]"
                      />
                    </th>
                  ) : null}
                  <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-gray-500">Invoice No.</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-gray-500">Client</th>
                  {isClientInvoiceCategory ? (
                    <>
                      <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-gray-500">Description</th>
                      <th className="px-4 py-3 text-right text-xs font-semibold uppercase tracking-wider text-gray-500">Unit</th>
                      <th className="px-4 py-3 text-right text-xs font-semibold uppercase tracking-wider text-gray-500">Rate</th>
                      <th className="px-4 py-3 text-right text-xs font-semibold uppercase tracking-wider text-gray-500">Amount</th>
                    </>
                  ) : (
                    <>
                      <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-gray-500">Type</th>
                      <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-gray-500">Source</th>
                    </>
                  )}
                  <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-gray-500">Invoice Date</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-gray-500">Due Date</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-gray-500">Status</th>
                  {!isClientInvoiceCategory ? (
                    <>
                      <th className="px-4 py-3 text-right text-xs font-semibold uppercase tracking-wider text-gray-500">Subtotal</th>
                      <th className="px-4 py-3 text-right text-xs font-semibold uppercase tracking-wider text-gray-500">VAT</th>
                      <th className="px-4 py-3 text-right text-xs font-semibold uppercase tracking-wider text-gray-500">Total</th>
                    </>
                  ) : null}
                  <th className="px-4 py-3 text-center text-xs font-semibold uppercase tracking-wider text-gray-500">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {paginatedInvoices.map((invoice) => {
                  const routeId = getInvoiceRouteId(invoice);
                  const status = String(invoice.status || '').toLowerCase();
                  const isActionPending = invoiceActionKey.startsWith(`${routeId}:`);
                  const canSend = isDraftInvoice(invoice);
                  const canMarkPaid = ['sent', 'overdue'].includes(status);
                  const sourceId = invoice.sourceId || invoice.shipmentId || invoice.source;
                  const sourceDisplay = invoice.source || sourceId || '-';
                  const canLinkSource = invoice.invoiceType === 'shipment' && sourceId && sourceId !== '-';
                  const invoiceId = getInvoiceRouteId(invoice);

                  return (
                    <tr key={invoice.id} className="transition-colors hover:bg-gray-50">
                      {isClientInvoiceCategory ? (
                        <td className="px-4 py-3.5">
                          <input
                            type="checkbox"
                            checked={selectedClientInvoiceIds.includes(invoiceId)}
                            onChange={() => handleToggleClientInvoiceSelection(invoiceId)}
                            aria-label={`Select ${invoice.ref}`}
                            className="h-4 w-4 rounded border-gray-300 text-[#ff6900] focus:ring-[#ff6900]"
                          />
                        </td>
                      ) : null}
                      <td className="px-4 py-3.5">
                        <div className="flex items-center gap-2">
                          <FileText size={14} className="text-gray-400" />
                          <span className="whitespace-nowrap text-sm font-medium text-gray-900">{invoice.ref}</span>
                        </div>
                      </td>
                      <td className="px-4 py-3.5 text-sm text-gray-700">{invoice.client}</td>
                      {isClientInvoiceCategory ? (
                        <>
                          <td className="px-4 py-3.5 text-sm text-gray-700">{invoice.description || '-'}</td>
                          <td className="px-4 py-3.5 text-right text-sm text-gray-700">{invoice.unit || 0}</td>
                          <td className="px-4 py-3.5 text-right text-sm text-gray-700">{formatCurrency(invoice.rate)}</td>
                          <td className="px-4 py-3.5 text-right text-sm font-medium text-gray-900">{formatCurrency(invoice.amount)}</td>
                        </>
                      ) : (
                        <>
                          <td className="px-4 py-3.5 text-sm text-gray-700">{invoice.invoiceTypeLabel}</td>
                          <td className="px-4 py-3.5 text-sm text-gray-500">
                            {canLinkSource ? (
                              <a href={`/shipments/${encodeURIComponent(sourceId)}`} className="font-medium text-[#ff6900] hover:text-[#e55d00]">
                                {sourceDisplay}
                              </a>
                            ) : (
                              sourceDisplay
                            )}
                          </td>
                        </>
                      )}
                      <td className="px-4 py-3.5 text-sm text-gray-500">{formatDate(invoice.date)}</td>
                      <td className="px-4 py-3.5 text-sm text-gray-500">{formatDate(invoice.due)}</td>
                      <td className="px-4 py-3.5">
                        <span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-medium ${status === 'paid' ? 'bg-green-100 text-green-700' : status === 'sent' ? 'bg-blue-100 text-blue-700' : status === 'draft' ? 'bg-yellow-100 text-yellow-700' : status === 'overdue' ? 'bg-red-100 text-red-700' : 'bg-gray-100 text-gray-700'}`}>
                          {formatStatusLabel(invoice.status)}
                        </span>
                      </td>
                      {!isClientInvoiceCategory ? (
                        <>
                          <td className="px-4 py-3.5 text-right text-sm text-gray-700">{formatCurrency(invoice.subtotal)}</td>
                          <td className="px-4 py-3.5 text-right text-sm text-gray-700">{formatCurrency(invoice.vat)}</td>
                          <td className="px-4 py-3.5 text-right text-sm font-medium text-gray-900">{formatCurrency(invoice.total)}</td>
                        </>
                      ) : null}
                      <td className="px-4 py-3.5 text-center">
                        <div className="flex items-center justify-center gap-1">
                          <button type="button" onClick={() => handleViewInvoice(invoice)} className="rounded-lg p-1.5 text-gray-400 transition-colors hover:bg-gray-100 hover:text-[#ff6900]" title="View invoice" aria-label={`View ${invoice.ref}`}><Eye size={16} /></button>
                          <button type="button" onClick={() => handleDownloadPdf(invoice)} className="rounded-lg p-1.5 text-gray-400 transition-colors hover:bg-gray-100 hover:text-[#ff6900]" title="Download invoice PDF" aria-label={`Download ${invoice.ref} invoice PDF`}><Download size={16} /></button>
                          {canSend ? (
                            <button type="button" onClick={() => setSendInvoiceTarget(invoice)} disabled={isActionPending} className="rounded-lg p-1.5 text-gray-400 transition-colors hover:bg-gray-100 hover:text-[#ff6900] disabled:cursor-not-allowed disabled:opacity-50" title="Send invoice" aria-label={`Send ${invoice.ref}`}><Send size={16} /></button>
                          ) : null}
                          {canMarkPaid ? (
                            <button type="button" onClick={() => handleUpdateInvoiceStatus(invoice, 'paid')} disabled={isActionPending} className="rounded-lg p-1.5 text-gray-400 transition-colors hover:bg-gray-100 hover:text-green-600 disabled:cursor-not-allowed disabled:opacity-50" title="Mark paid" aria-label={`Mark ${invoice.ref} paid`}><CheckCircle size={16} /></button>
                          ) : null}
                          <button
                            type="button"
                            onClick={() => setDeleteInvoiceTarget(invoice)}
                            disabled={isActionPending}
                            className="rounded-lg p-1.5 text-gray-400 transition-colors hover:bg-gray-100 hover:text-red-600 disabled:cursor-not-allowed disabled:opacity-50"
                            title="Delete invoice"
                            aria-label={`Delete ${invoice.ref}`}
                          >
                            <Trash2 size={16} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
                {isLoading ? (
                  <tr>
                    <td colSpan={isClientInvoiceCategory ? 11 : 11} className="px-6 py-10 text-center text-sm text-gray-500">
                      <LoadingState label="Loading invoices..." />
                    </td>
                  </tr>
                ) : null}
                {!isLoading && !paginatedInvoices.length ? (
                  <tr>
                    <td colSpan={isClientInvoiceCategory ? 11 : 11} className="px-6 py-10 text-center text-sm text-gray-500">
                      {debouncedInvoiceSearchTerm.trim() || invoiceStatusFilter !== 'all' ? 'No invoices match your filters.' : 'No invoices found.'}
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
          {invoiceListMeta.total ? (
            <div className="flex flex-col gap-3 border-t border-gray-200 bg-gray-50 px-6 py-3 sm:flex-row sm:items-center sm:justify-between">
              <p className="text-sm text-gray-500">
                Showing <span className="font-medium text-gray-900">{invoicePaginationStart}-{invoicePaginationEnd}</span> of{' '}
                <span className="font-medium text-gray-900">{invoiceListMeta.total}</span> invoices
                {debouncedInvoiceSearchTerm.trim() ? <span> matching "{debouncedInvoiceSearchTerm.trim()}"</span> : null}
                {invoiceStatusFilter !== 'all' ? <span> with status {formatStatusLabel(invoiceStatusFilter)}</span> : null}
              </p>
              <div className="flex items-center gap-2 text-sm">
                <button type="button" onClick={() => setInvoicePage((page) => Math.max(1, page - 1))} disabled={invoicePage === 1} className="rounded-lg border border-gray-200 bg-white px-3 py-1.5 font-medium text-gray-600 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50">Previous</button>
                {invoicePaginationPages.map((page) => (
                  <button key={page} type="button" onClick={() => setInvoicePage(page)} className={`min-w-8 rounded-lg px-3 py-1.5 font-semibold ${invoicePage === page ? 'bg-[#ff6900] text-white' : 'border border-gray-200 bg-white text-gray-600 hover:bg-gray-50'}`}>{page}</button>
                ))}
                <button type="button" onClick={() => setInvoicePage((page) => Math.min(invoiceTotalPages, page + 1))} disabled={invoicePage === invoiceTotalPages} className="rounded-lg border border-gray-200 bg-white px-3 py-1.5 font-medium text-gray-600 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50">Next</button>
              </div>
            </div>
          ) : null}
        </div>

        {showClientInvoiceForm ? (
          <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 px-4 py-8">
            <div className="w-full max-w-2xl rounded-xl bg-white shadow-2xl">
              <div className="flex items-start justify-between gap-4 border-b border-gray-200 px-5 py-4">
                <div>
                  <h3 className="text-base font-semibold text-gray-900">Create Client Invoice</h3>
                  <p className="mt-1 text-sm text-gray-500">Create an independent client-level invoice with no VAT.</p>
                </div>
                <button
                  type="button"
                  onClick={resetClientInvoiceForm}
                  className="rounded-lg p-2 text-gray-400 hover:bg-gray-100 hover:text-gray-700"
                  aria-label="Close create client invoice"
                >
                  <X size={18} />
                </button>
              </div>
              <form onSubmit={handleCreateClientInvoice}>
                <div className="grid grid-cols-1 gap-4 px-5 py-4 sm:grid-cols-2">
                  <label className="text-sm">
                    <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-gray-500">Client</span>
                    <select
                      value={clientInvoiceForm.clientId}
                      onChange={(event) => setClientInvoiceForm((current) => ({ ...current, clientId: event.target.value }))}
                      className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm outline-none focus:border-[#ff6900]"
                    >
                      <option value="">Select client</option>
                      {clients.map((client) => {
                        const clientId = getClientId(client);
                        return (
                          <option key={clientId || getClientDisplayName(client)} value={clientId}>
                            {getClientDisplayName(client)}
                          </option>
                        );
                      })}
                    </select>
                  </label>
                  <label className="text-sm">
                    <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-gray-500">Date</span>
                    <input
                      type="date"
                      value={clientInvoiceForm.invoiceDate}
                      onChange={(event) => setClientInvoiceForm((current) => ({ ...current, invoiceDate: event.target.value }))}
                      className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm outline-none focus:border-[#ff6900]"
                    />
                  </label>
                  <label className="sm:col-span-2 text-sm">
                    <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-gray-500">Description</span>
                    <input
                      type="text"
                      value={clientInvoiceForm.description}
                      onChange={(event) => setClientInvoiceForm((current) => ({ ...current, description: event.target.value }))}
                      placeholder="Storage"
                      className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm outline-none focus:border-[#ff6900]"
                    />
                  </label>
                  <label className="text-sm">
                    <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-gray-500">Unit</span>
                    <input
                      type="number"
                      min="0.01"
                      step="0.01"
                      value={clientInvoiceForm.unit}
                      onChange={(event) => setClientInvoiceForm((current) => ({ ...current, unit: event.target.value }))}
                      className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm outline-none focus:border-[#ff6900]"
                    />
                  </label>
                  <label className="text-sm">
                    <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-gray-500">Rate</span>
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      value={clientInvoiceForm.rate}
                      onChange={(event) => setClientInvoiceForm((current) => ({ ...current, rate: event.target.value }))}
                      className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm outline-none focus:border-[#ff6900]"
                    />
                  </label>
                  <div className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-2">
                    <p className="text-[10px] font-semibold uppercase tracking-wide text-gray-500">Amount</p>
                    <p className="mt-1 text-sm font-semibold text-gray-900">{formatCurrency(getClientInvoiceAmount())}</p>
                  </div>
                  <label className="sm:col-span-2 text-sm">
                    <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-gray-500">Notes</span>
                    <textarea
                      rows={3}
                      value={clientInvoiceForm.notes}
                      onChange={(event) => setClientInvoiceForm((current) => ({ ...current, notes: event.target.value }))}
                      className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm outline-none focus:border-[#ff6900]"
                    />
                  </label>
                </div>
                <div className="flex justify-end gap-2 border-t border-gray-200 px-5 py-4">
                  <button type="button" onClick={resetClientInvoiceForm} className="rounded-lg border border-gray-200 bg-white px-4 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-50">
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={invoiceActionKey === 'client-invoice:create'}
                    className="inline-flex items-center gap-2 rounded-lg bg-[#ff6900] px-4 py-2 text-sm font-semibold text-white hover:bg-[#e55d00] disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    <Plus size={16} />
                    {invoiceActionKey === 'client-invoice:create' ? 'Creating...' : 'Create Invoice'}
                  </button>
                </div>
              </form>
            </div>
          </div>
        ) : null}

        {bulkDeleteClientInvoicesTarget ? (
          <div className="fixed inset-0 z-[65] flex items-center justify-center bg-black/40 px-4 py-8">
            <div className="w-full max-w-md rounded-xl bg-white shadow-2xl">
              <div className="flex items-start justify-between gap-4 border-b border-gray-200 px-5 py-4">
                <div>
                  <h3 className="text-base font-semibold text-gray-900">Delete Client Invoices</h3>
                  <p className="mt-1 text-sm text-gray-500">
                    Delete selected client invoices? This will remove the invoices and their files.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setBulkDeleteClientInvoicesTarget(false)}
                  disabled={invoiceActionKey === 'client-invoice:bulk-delete'}
                  className="rounded-lg p-2 text-gray-400 hover:bg-gray-100 hover:text-gray-700 disabled:cursor-not-allowed disabled:opacity-50"
                  aria-label="Close bulk delete confirmation"
                >
                  <X size={18} />
                </button>
              </div>
              <div className="px-5 py-4 text-sm">
                <div className="rounded-lg border border-red-100 bg-red-50 px-3 py-2 text-red-700">
                  {selectedClientInvoiceIds.length} invoice{selectedClientInvoiceIds.length === 1 ? '' : 's'} selected. Bulk delete only applies to independent client invoices.
                </div>
              </div>
              <div className="flex justify-end gap-2 border-t border-gray-200 px-5 py-4">
                <button
                  type="button"
                  onClick={() => setBulkDeleteClientInvoicesTarget(false)}
                  disabled={invoiceActionKey === 'client-invoice:bulk-delete'}
                  className="rounded-lg border border-gray-200 bg-white px-4 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleBulkDeleteClientInvoices}
                  disabled={invoiceActionKey === 'client-invoice:bulk-delete'}
                  className="inline-flex items-center gap-2 rounded-lg bg-red-600 px-4 py-2 text-sm font-semibold text-white hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <Trash2 size={16} />
                  {invoiceActionKey === 'client-invoice:bulk-delete' ? 'Deleting...' : 'Delete Selected'}
                </button>
              </div>
            </div>
          </div>
        ) : null}

        {sendInvoiceTarget ? (
          <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 px-4 py-8">
            <div className="w-full max-w-md rounded-xl bg-white shadow-2xl">
              <div className="flex items-start justify-between gap-4 border-b border-gray-200 px-5 py-4">
                <div>
                  <h3 className="text-base font-semibold text-gray-900">Send Invoice</h3>
                  <p className="mt-1 text-sm text-gray-500">Finalize and send this invoice to the client.</p>
                </div>
                <button
                  type="button"
                  onClick={() => setSendInvoiceTarget(null)}
                  className="rounded-lg p-2 text-gray-400 hover:bg-gray-100 hover:text-gray-700"
                  aria-label="Close send invoice confirmation"
                >
                  <X size={18} />
                </button>
              </div>
              <div className="space-y-3 px-5 py-4 text-sm">
                <div className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-2">
                  <p className="text-[10px] font-semibold uppercase tracking-wide text-gray-500">Invoice</p>
                  <p className="mt-1 font-semibold text-gray-900">{sendInvoiceTarget.ref || sendInvoiceTarget.invoiceNumber || sendInvoiceTarget.id}</p>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="rounded-lg border border-gray-200 bg-white px-3 py-2">
                    <p className="text-[10px] font-semibold uppercase tracking-wide text-gray-500">Client</p>
                    <p className="mt-1 break-words font-semibold text-gray-900">{resolveInvoiceClientDisplay(sendInvoiceTarget)}</p>
                  </div>
                  <div className="rounded-lg border border-gray-200 bg-white px-3 py-2">
                    <p className="text-[10px] font-semibold uppercase tracking-wide text-gray-500">Total</p>
                    <p className="mt-1 font-semibold text-gray-900">{formatCurrency(sendInvoiceTarget.total)}</p>
                  </div>
                </div>
                <p className="text-xs text-gray-500">
                  The backend will set the invoice date, due date, sent timestamp, and notify the client.
                </p>
              </div>
              <div className="flex justify-end gap-2 border-t border-gray-200 px-5 py-4">
                <button
                  type="button"
                  onClick={() => setSendInvoiceTarget(null)}
                  className="rounded-lg border border-gray-200 bg-white px-4 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-50"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={() => handleSendInvoice(sendInvoiceTarget)}
                  disabled={invoiceActionKey.startsWith(`${getInvoiceRouteId(sendInvoiceTarget)}:`)}
                  className="inline-flex items-center gap-2 rounded-lg bg-[#ff6900] px-4 py-2 text-sm font-semibold text-white hover:bg-[#e55d00] disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <Send size={16} />
                  {invoiceActionKey.startsWith(`${getInvoiceRouteId(sendInvoiceTarget)}:`) ? 'Sending...' : 'Send Invoice'}
                </button>
              </div>
            </div>
          </div>
        ) : null}

        {deleteInvoiceTarget ? (
          <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/40 px-4 py-8">
            <div className="w-full max-w-md rounded-xl bg-white shadow-2xl">
              {(() => {
                const invoiceId = getInvoiceRouteId(deleteInvoiceTarget);
                const invoiceRef = deleteInvoiceTarget.ref || deleteInvoiceTarget.invoiceNumber || deleteInvoiceTarget.invoice_number || invoiceId;
                const isDeletingInvoice = invoiceActionKey === `${invoiceId}:delete`;

                return (
                  <>
                    <div className="flex items-start justify-between gap-4 border-b border-gray-200 px-5 py-4">
                      <div>
                        <h3 className="text-base font-semibold text-gray-900">Delete Invoice</h3>
                        <p className="mt-1 text-sm text-gray-500">
                          Are you sure you want to delete invoice <span className="font-semibold text-gray-900">{invoiceRef}</span>? This will remove the invoice and its files.
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() => setDeleteInvoiceTarget(null)}
                        disabled={isDeletingInvoice}
                        className="rounded-lg p-2 text-gray-400 hover:bg-gray-100 hover:text-gray-700 disabled:cursor-not-allowed disabled:opacity-50"
                        aria-label="Close delete invoice confirmation"
                      >
                        <X size={18} />
                      </button>
                    </div>
                    <div className="space-y-3 px-5 py-4 text-sm">
                      <div className="rounded-lg border border-red-100 bg-red-50 px-3 py-2 text-red-700">
                        This action cannot be undone.
                      </div>
                      <div className="grid grid-cols-2 gap-3">
                        <div className="rounded-lg border border-gray-200 bg-white px-3 py-2">
                          <p className="text-[10px] font-semibold uppercase tracking-wide text-gray-500">Status</p>
                          <p className="mt-1 font-semibold text-gray-900">{formatStatusLabel(deleteInvoiceTarget.status)}</p>
                        </div>
                        <div className="rounded-lg border border-gray-200 bg-white px-3 py-2">
                          <p className="text-[10px] font-semibold uppercase tracking-wide text-gray-500">Total</p>
                          <p className="mt-1 font-semibold text-gray-900">{formatCurrency(deleteInvoiceTarget.total)}</p>
                        </div>
                      </div>
                    </div>
                    <div className="flex justify-end gap-2 border-t border-gray-200 px-5 py-4">
                      <button
                        type="button"
                        onClick={() => setDeleteInvoiceTarget(null)}
                        disabled={isDeletingInvoice}
                        className="rounded-lg border border-gray-200 bg-white px-4 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        Cancel
                      </button>
                      <button
                        type="button"
                        onClick={() => handleDeleteInvoice(deleteInvoiceTarget)}
                        disabled={isDeletingInvoice}
                        className="inline-flex items-center gap-2 rounded-lg bg-red-600 px-4 py-2 text-sm font-semibold text-white hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        <Trash2 size={16} />
                        {isDeletingInvoice ? 'Deleting...' : 'Delete Invoice'}
                      </button>
                    </div>
                  </>
                );
              })()}
            </div>
          </div>
        ) : null}

        {selectedInvoiceView ? (
          <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 px-4 py-8">
            <div className="w-full max-w-6xl overflow-hidden rounded-xl bg-white shadow-2xl">
              <div className="flex items-start justify-between gap-4 border-b border-gray-200 px-6 py-5">
                <div>
                  <h3 className="text-lg font-semibold text-gray-900">{selectedInvoiceView.ref}</h3>
                  <p className="mt-1 text-sm text-gray-500">{selectedInvoiceView.invoiceTypeLabel}</p>
                </div>
                <div className="flex items-center gap-2">
                  {isDraftInvoice(selectedInvoiceView) ? (
                    <button
                      type="button"
                      onClick={() => setSendInvoiceTarget(selectedInvoiceView)}
                      disabled={invoiceActionKey.startsWith(`${getInvoiceRouteId(selectedInvoiceView)}:`)}
                      className="inline-flex items-center gap-2 rounded-lg bg-[#ff6900] px-4 py-2 text-sm font-semibold text-white hover:bg-[#e55d00] disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      <Send size={16} /> Send Invoice
                    </button>
                  ) : null}
                  <button
                    type="button"
                    onClick={() => handleRefreshSelectedInvoice()}
                    disabled={isInvoiceDetailLoading}
                    className="inline-flex items-center gap-2 rounded-lg border border-gray-200 bg-white px-4 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    <RefreshCw size={16} className={isInvoiceDetailLoading ? 'animate-spin' : ''} /> Refresh
                  </button>
                  <button
                    type="button"
                    onClick={() => setDeleteInvoiceTarget(selectedInvoiceView)}
                    disabled={invoiceActionKey.startsWith(`${getInvoiceRouteId(selectedInvoiceView)}:`)}
                    className="inline-flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 px-4 py-2 text-sm font-semibold text-red-700 hover:bg-red-100 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    <Trash2 size={16} /> Delete Invoice
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setSelectedInvoice(null);
                      resetManualLineForm();
                    }}
                    className="rounded-lg p-2 text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-700"
                    aria-label="Close invoice detail"
                  >
                    <X size={18} />
                  </button>
                </div>
              </div>

              <div className="space-y-5 px-6 py-5">
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-3 lg:grid-cols-6">
                  {[
                    { label: 'Client', value: selectedInvoiceView.client },
                    { label: 'Type', value: selectedInvoiceView.invoiceTypeLabel },
                    { label: 'Source', value: selectedInvoiceView.source },
                    { label: 'Status', value: selectedInvoiceView.status },
                    { label: 'Invoice Date', value: formatDate(selectedInvoiceView.date) },
                    { label: 'Due Date', value: formatDate(selectedInvoiceView.due) },
                  ].map((item) => (
                    <div key={item.label} className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-2">
                      <p className="text-[10px] font-semibold uppercase tracking-wide text-gray-500">{item.label}</p>
                      <p className="mt-1 break-words text-sm font-semibold text-gray-900">{item.value || '-'}</p>
                    </div>
                  ))}
                </div>

                <div className={`grid grid-cols-1 gap-3 ${isClientInvoiceRecord(selectedInvoiceView) ? 'sm:grid-cols-1' : 'sm:grid-cols-3'}`}>
                  {(isClientInvoiceRecord(selectedInvoiceView)
                    ? [{ label: 'Total', value: formatCurrency(selectedInvoiceView.total) }]
                    : [
                        { label: 'Subtotal', value: formatCurrency(selectedInvoiceView.subtotal) },
                        { label: 'VAT', value: formatCurrency(selectedInvoiceView.vat) },
                        { label: 'Total', value: formatCurrency(selectedInvoiceView.total) },
                      ]).map((item) => (
                    <div key={item.label} className="rounded-lg border border-gray-200 bg-white px-3 py-2">
                      <p className="text-[10px] font-semibold uppercase tracking-wide text-gray-500">{item.label}</p>
                      <p className="mt-1 text-sm font-semibold text-gray-900">{item.value}</p>
                    </div>
                  ))}
                </div>

                {canEditManualInvoiceLines(selectedInvoiceView) ? (
                  <div className="rounded-lg border border-gray-200 bg-gray-50 p-4">
                    <div className="mb-3 flex items-center justify-between gap-3">
                      <div>
                        <h4 className="text-sm font-semibold text-gray-900">Invoice Line Adjustments</h4>
                        {showManualLineForm && editingLineItemId ? (
                          <p className="mt-1 text-xs text-gray-500">
                            {isSystemInvoiceLine({ lineSource: editingLineSource })
                              ? 'Editing a system-generated line will save a persistent override.'
                              : 'Editing a manual invoice line.'}
                          </p>
                        ) : null}
                      </div>
                      <button
                        type="button"
                        onClick={showManualLineForm ? resetManualLineForm : startAddManualLine}
                        className="inline-flex items-center gap-2 rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-50"
                      >
                        {showManualLineForm ? <X size={15} /> : <Plus size={15} />}
                        {showManualLineForm ? 'Cancel' : 'Add Manual Service'}
                      </button>
                    </div>

                    {showManualLineForm ? (
                      <form onSubmit={handleSubmitManualLine} className="grid grid-cols-1 gap-3 lg:grid-cols-[minmax(0,2fr)_minmax(120px,1fr)_110px_130px_110px_minmax(150px,1fr)_auto]">
                        <input
                          type="text"
                          value={manualLineForm.description}
                          onChange={(event) => setManualLineForm((current) => ({ ...current, description: event.target.value }))}
                          placeholder="Description"
                          className="rounded-lg border border-gray-200 px-3 py-2 text-sm outline-none focus:border-[#ff6900]"
                        />
                        <input
                          type="text"
                          value={manualLineForm.serviceCode}
                          onChange={(event) => setManualLineForm((current) => ({ ...current, serviceCode: event.target.value }))}
                          placeholder="Service code"
                          className="rounded-lg border border-gray-200 px-3 py-2 text-sm outline-none focus:border-[#ff6900]"
                        />
                        <input
                          type="number"
                          min="0.01"
                          step="0.01"
                          value={manualLineForm.qty}
                          onChange={(event) => setManualLineForm((current) => ({ ...current, qty: event.target.value }))}
                          placeholder="Qty"
                          className="rounded-lg border border-gray-200 px-3 py-2 text-sm outline-none focus:border-[#ff6900]"
                        />
                        <input
                          type="number"
                          min="0"
                          step="0.01"
                          value={manualLineForm.unitRate}
                          onChange={(event) => setManualLineForm((current) => ({ ...current, unitRate: event.target.value }))}
                          placeholder="Unit rate"
                          className="rounded-lg border border-gray-200 px-3 py-2 text-sm outline-none focus:border-[#ff6900]"
                        />
                        <input
                          type="number"
                          min="0"
                          max="1"
                          step="0.01"
                          value={manualLineForm.vatRate}
                          onChange={(event) => setManualLineForm((current) => ({ ...current, vatRate: event.target.value }))}
                          placeholder="VAT rate"
                          className="rounded-lg border border-gray-200 px-3 py-2 text-sm outline-none focus:border-[#ff6900]"
                        />
                        <input
                          type="text"
                          value={manualLineForm.reason}
                          onChange={(event) => setManualLineForm((current) => ({ ...current, reason: event.target.value }))}
                          placeholder="Reason"
                          className="rounded-lg border border-gray-200 px-3 py-2 text-sm outline-none focus:border-[#ff6900]"
                        />
                        <button
                          type="submit"
                          disabled={Boolean(lineActionKey)}
                          className="inline-flex items-center justify-center rounded-lg bg-[#132347] px-4 py-2 text-sm font-semibold text-white hover:bg-[#0f1b38] disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          {editingLineItemId ? 'Update' : 'Add'}
                        </button>
                      </form>
                    ) : null}
                  </div>
                ) : null}

                <div className="overflow-x-auto rounded-lg border border-gray-200">
                  <table className="w-full text-sm">
                    <thead className="bg-gray-50 text-xs uppercase tracking-wider text-gray-500">
                      <tr>
                        <th className="px-4 py-2 text-left">Description</th>
                        <th className="px-4 py-2 text-right">{isClientInvoiceRecord(selectedInvoiceView) ? 'Unit' : 'Qty'}</th>
                        <th className="px-4 py-2 text-right">Rate</th>
                        <th className="px-4 py-2 text-right">Amount</th>
                        {!isClientInvoiceRecord(selectedInvoiceView) ? (
                          <>
                            <th className="px-4 py-2 text-right">VAT Rate</th>
                            <th className="px-4 py-2 text-right">VAT Amount</th>
                            <th className="px-4 py-2 text-left">Source</th>
                            <th className="px-4 py-2 text-center">Actions</th>
                          </>
                        ) : null}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {isInvoiceDetailLoading ? (
                        <tr>
                          <td colSpan={isClientInvoiceRecord(selectedInvoiceView) ? 4 : 8} className="px-4 py-8 text-center text-sm text-gray-500">
                            <LoadingState label="Loading line items..." />
                          </td>
                        </tr>
                      ) : selectedInvoiceView.lineItems.length ? (
                        selectedInvoiceView.lineItems.map((item, index) => {
                          const isManual = isManualInvoiceLine(item);
                          const isSystem = isSystemInvoiceLine(item);
                          const isOverridden = isOverriddenInvoiceLine(item);
                          const canEditLine = canEditInvoiceLines(selectedInvoiceView);
                          const lineId = getInvoiceLineId(item);

                          return (
                            <tr key={lineId || index}>
                              <td className="px-4 py-2">{getInvoiceLineDescription(item, index)}</td>
                              <td className="px-4 py-2 text-right">{getInvoiceLineQty(item)}</td>
                              <td className="px-4 py-2 text-right">{formatCurrency(getInvoiceLineUnitRate(item))}</td>
                              <td className="px-4 py-2 text-right">{formatCurrency(getInvoiceLineAmount(item))}</td>
                              {!isClientInvoiceRecord(selectedInvoiceView) ? (
                                <>
                                  <td className="px-4 py-2 text-right">{Number(getInvoiceLineVatRate(item) || 0).toLocaleString(undefined, { style: 'percent', maximumFractionDigits: 2 })}</td>
                                  <td className="px-4 py-2 text-right">{formatCurrency(getInvoiceLineVatAmount(item))}</td>
                                  <td className="px-4 py-2">
                                    <div className="flex flex-wrap gap-1.5">
                                      <span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-medium ${isManual ? 'bg-blue-100 text-blue-700' : 'bg-gray-100 text-gray-700'}`}>
                                        {getInvoiceLineSourceLabel(item)}
                                      </span>
                                      {isOverridden ? (
                                        <span className="inline-flex rounded-full bg-amber-100 px-2.5 py-1 text-xs font-medium text-amber-700">
                                          Overridden
                                        </span>
                                      ) : null}
                                    </div>
                                  </td>
                                  <td className="px-4 py-2 text-center">
                                    {canEditLine ? (
                                      <div className="flex items-center justify-center gap-1">
                                        <button type="button" onClick={() => startEditManualLine(item)} className="rounded-lg p-1.5 text-gray-400 hover:bg-gray-100 hover:text-[#ff6900]" title={isSystem ? 'Edit system line override' : 'Edit manual line'} aria-label={isSystem ? 'Edit system line override' : 'Edit manual line'}><Pencil size={15} /></button>
                                        {isManual ? (
                                          <button type="button" onClick={() => handleDeleteManualLine(item)} disabled={Boolean(lineId && lineActionKey.includes(lineId))} className="rounded-lg p-1.5 text-gray-400 hover:bg-gray-100 hover:text-red-600 disabled:cursor-not-allowed disabled:opacity-50" title="Delete manual line" aria-label="Delete manual line"><Trash2 size={15} /></button>
                                        ) : null}
                                      </div>
                                    ) : (
                                      <span className="text-xs text-gray-400">-</span>
                                    )}
                                  </td>
                                </>
                              ) : null}
                            </tr>
                          );
                        })
                      ) : (
                        <tr>
                          <td colSpan={isClientInvoiceRecord(selectedInvoiceView) ? 4 : 8} className="px-4 py-8 text-center text-sm text-gray-500">
                            {toNumber(selectedInvoiceView.total) === 0
                              ? 'No billable line items were created for this invoice.'
                              : 'No line items returned for this invoice detail.'}
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          </div>
        ) : null}
      </div>
    </Layout>
  );
};

export default Billing;
