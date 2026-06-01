import React, { useEffect, useMemo, useState } from 'react';
import Layout from './adminlayout/Layout';
import LoadingState from '../common/LoadingState';
import FullPageLoader from '../common/FullPageLoader';
import { getSession } from '../../utils/auth';
import { FileText, CheckCircle, AlertCircle, Download, Eye, RefreshCw, Info, ArrowRight, X, Send } from 'lucide-react';

const API_BASE_URL = '';
const BILLING_PAGE_SIZE = 20;

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

const extractInvoices = (payload) => {
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload?.invoices)) return payload.invoices;
  if (Array.isArray(payload?.data?.rows)) return payload.data.rows;
  if (Array.isArray(payload?.data)) return payload.data;
  return [];
};

const extractClients = (payload) => {
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload?.clients)) return payload.clients;
  if (Array.isArray(payload?.data?.rows)) return payload.data.rows;
  if (Array.isArray(payload?.data)) return payload.data;
  return [];
};

const extractShipments = (payload) => {
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload?.shipments)) return payload.shipments;
  if (Array.isArray(payload?.data?.shipments)) return payload.data.shipments;
  if (Array.isArray(payload?.data?.rows)) return payload.data.rows;
  if (Array.isArray(payload?.data)) return payload.data;
  if (Array.isArray(payload?.rows)) return payload.rows;
  if (Array.isArray(payload?.results)) return payload.results;
  return [];
};

const extractPricing = (payload) => {
  const data = payload?.data || payload || {};
  return {
    catalog: data?.catalog || data?.serviceCatalog || data?.service_catalog || [],
    clientPrices: data?.clientPrices || data?.client_price_lists || data?.prices || [],
  };
};

const getMonthValue = () => {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
};

const getMonthRange = (monthValue) => {
  const [yearValue, monthNumberValue] = String(monthValue || getMonthValue()).split('-').map(Number);
  const year = Number.isFinite(yearValue) ? yearValue : new Date().getFullYear();
  const monthIndex = Number.isFinite(monthNumberValue) ? monthNumberValue - 1 : new Date().getMonth();
  const start = new Date(year, monthIndex, 1);
  const end = new Date(year, monthIndex + 1, 0);
  const format = (date) =>
    `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  return { periodStart: format(start), periodEnd: format(end) };
};

const formatMonthLabel = (monthValue) => {
  const [yearValue, monthNumberValue] = String(monthValue || '').split('-').map(Number);
  const date = new Date(yearValue || new Date().getFullYear(), (monthNumberValue || 1) - 1, 1);
  return date.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });
};

const getRecentMonthOptions = (count = 6) => {
  const now = new Date();

  return Array.from({ length: count }, (_, offset) => {
    const date = new Date(now.getFullYear(), now.getMonth() - offset, 1);
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
  });
};

const formatCurrency = (value) =>
  new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP' }).format(Number(value || 0));

const formatDate = (value) => {
  if (!value) return '--';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleDateString('en-GB');
};

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

const toArrayValue = (value) => {
  const parsed = parseJsonValue(value, value);
  if (Array.isArray(parsed)) return parsed;
  if (typeof parsed === 'string' && parsed.trim()) {
    return parsed
      .split(/[;,]/)
      .map((item) => item.trim())
      .filter(Boolean);
  }
  return [];
};

const toObjectValue = (value) => {
  const parsed = parseJsonValue(value, {});
  return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
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

const normalizeInvoice = (invoice) => {
  const lineItems = extractInvoiceLineItems(invoice);

  return {
    id: firstPresent(invoice?.id, invoice?.uuid, invoice?.invoiceId, invoice?.invoice_id, invoice?.reference, invoice?.invoice_number),
    ref: firstPresent(invoice?.reference, invoice?.invoiceNumber, invoice?.invoice_number, invoice?.number, invoice?.invoiceNo, invoice?.invoice_no, invoice?.id, 'N/A'),
    clientId: getInvoiceClientId(invoice),
    client: getInlineInvoiceClientDisplay(invoice) || '-',
    date: firstPresent(invoice?.invoiceDate, invoice?.invoice_date, invoice?.date, invoice?.createdAt, invoice?.created_at),
    due: firstPresent(invoice?.dueDate, invoice?.due_date, invoice?.dueAt, invoice?.due_at),
    subtotal: getInvoiceSubtotalValue(invoice, lineItems),
    vat: getInvoiceVatValue(invoice, lineItems),
    total: getInvoiceTotalValue(invoice, lineItems),
    status: invoice?.status || 'draft',
    lineItems,
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
      invoice?.raw?.id,
      invoice?.raw?.uuid,
      invoice?.raw?.invoiceId,
      invoice?.raw?.invoice_id,
      invoice?.raw?.reference,
      invoice?.raw?.invoiceNumber,
      invoice?.raw?.invoice_number,
    ]
      .map((value) => String(value || '').trim())
      .filter(Boolean)
  ),
];

const getInvoiceRouteId = (invoice = {}) => {
  const candidates = getInvoiceLookupCandidates(invoice);
  return candidates.find(isUuidValue) || candidates[0] || '';
};

const getInvoiceDetailPayload = (payload) =>
  payload?.invoice || payload?.data?.invoice || payload?.data?.row || payload?.data?.record || payload?.data || payload;

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

const sanitizeFileName = (value = 'invoice') =>
  String(value || 'invoice')
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, '-')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '') || 'invoice';

const fetchInvoiceLineItems = async (lookupCandidates = []) => {
  for (const lookupId of lookupCandidates) {
    const encodedLookupId = encodeURIComponent(lookupId);
    const endpoints = [
      `${API_BASE_URL}/api/invoices/${encodedLookupId}/line-items`,
      `${API_BASE_URL}/api/invoices/${encodedLookupId}/items`,
    ];

    for (const endpoint of endpoints) {
      try {
        const response = await fetch(endpoint, {
          method: 'GET',
          headers: buildHeaders(),
          cache: 'no-store',
        });
        const items = extractInvoiceLineItems(await parseResponse(response));
        if (items.length) return items;
      } catch {
        // Invoice item routes can differ by backend version, so try the next shape.
      }
    }
  }

  return [];
};

const getShipmentId = (shipment = {}) =>
  shipment?.id || shipment?.uuid || shipment?.shipmentId || shipment?.shipment_id || shipment?.reference || '';

const getShipmentLineItems = (shipment = {}) =>
  shipment?.shipment_line_items ||
  shipment?.shipmentLineItems ||
  shipment?.lineItems ||
  shipment?.line_items ||
  shipment?.items ||
  [];

const getShipmentOutboundBoxes = (shipment = {}) =>
  shipment?.outbound_boxes ||
  shipment?.outboundBoxes ||
  shipment?.boxes ||
  [];

const getShipmentArrivalDate = (shipment = {}) =>
  shipment?.actual_arrival_date ||
  shipment?.actualArrivalDate ||
  shipment?.receivedAt ||
  shipment?.received_at ||
  shipment?.arrivalDate ||
  shipment?.arrival_date ||
  '';

const getShipmentReceivedUnits = (shipment = {}) => {
  const lineItems = getShipmentLineItems(shipment);
  const lineItemUnits = lineItems.reduce(
    (sum, item) =>
      sum +
      Number(
        item?.qty_received ??
          item?.qtyReceived ??
          item?.receivedQty ??
          item?.received_qty ??
          item?.actualQty ??
          item?.actual_qty ??
          0
      ),
    0
  );

  return lineItemUnits || Number(shipment?.receivedUnits || shipment?.received_units || shipment?.units || 0);
};

const getLineItemBillingUnits = (item = {}) =>
  toNumber(
    firstPresent(
      item?.qty_received,
      item?.qtyReceived,
      item?.receivedQty,
      item?.received_qty,
      item?.actualQty,
      item?.actual_qty,
      0
    )
  );

const getServiceCatalogEntry = (catalog = [], serviceCode = '') =>
  catalog.find((service) => String(service?.code || '').trim() === String(serviceCode || '').trim()) || null;

const getClientCustomPrice = (clientPrices = [], clientId = '', serviceCode = '') =>
  clientPrices
    .filter(
      (price) =>
        String(price?.client_id || price?.clientId || '').trim() === String(clientId || '').trim() &&
        String(price?.service_code || price?.serviceCode || price?.serviceType || '').trim() === String(serviceCode || '').trim()
    )
    .sort((left, right) => new Date(right?.effective_from || right?.effectiveFrom || 0) - new Date(left?.effective_from || left?.effectiveFrom || 0))[0] ||
  null;

const getServiceRate = ({ catalog, clientPrices, clientId, serviceCode, tier, allowRateFallback = false }) => {
  const customPrice = getClientCustomPrice(clientPrices, clientId, serviceCode);
  if (customPrice) return toNumber(customPrice?.rate ?? customPrice?.pricePerUnit ?? customPrice?.price_per_unit);

  const service = getServiceCatalogEntry(catalog, serviceCode);
  const tierPricing = toObjectValue(service?.default_tier_pricing ?? service?.defaultTierPricing);
  const tierKey = String(tier || 'silver').toLowerCase();
  const directRate = firstPresent(tierPricing?.[tierKey], tierPricing?.[tier], allowRateFallback ? tierPricing?.rate : '');

  return directRate === '' ? 0 : toNumber(directRate);
};

const getVatRate = (client = {}, service = {}) => {
  const clientVatRegistered = Boolean(client?.vat_registered ?? client?.vatRegistered);
  const vatApplicable = Boolean(service?.vat_applicable ?? service?.vatApplicable);
  return clientVatRegistered && vatApplicable ? 0.2 : 0;
};

const getBoxBillingServiceCode = (box = {}) => {
  const boxType = String(box?.box_type || box?.boxType || '').toLowerCase();
  const boxSize = String(box?.box_size || box?.boxSize || '').toLowerCase();

  if (boxType === 'pallet') return 'pallet_forwarding';
  if (boxType === 'box' && boxSize === 'medium') return 'medium_box';
  if (boxType === 'box' && boxSize === 'large') return 'large_box';
  return '';
};

const calculateMonthlyInvoiceEstimate = ({ client, clientId, shipments, tier, pricingData }) => {
  const catalog = pricingData?.catalog || [];
  const clientPrices = pricingData?.clientPrices || [];
  let subtotal = 0;
  let vat = 0;

  shipments.forEach((shipment) => {
    getShipmentLineItems(shipment).forEach((item) => {
      const billingUnits = getLineItemBillingUnits(item);
      if (!billingUnits) return;

      const selectedServices = toArrayValue(item?.services_selected ?? item?.servicesSelected ?? item?.services);
      const serviceStatuses = toObjectValue(item?.service_status ?? item?.serviceStatus);

      selectedServices.forEach((serviceCode) => {
        if (String(serviceStatuses?.[serviceCode] || '').toLowerCase() !== 'done') return;

        const service = getServiceCatalogEntry(catalog, serviceCode);
        const unitRate = getServiceRate({ catalog, clientPrices, clientId, serviceCode, tier });
        const amount = billingUnits * unitRate;
        const vatAmount = amount * getVatRate(client, service || {});

        subtotal += amount;
        vat += vatAmount;
      });
    });

    getShipmentOutboundBoxes(shipment).forEach((box) => {
      if (!(box?.dispatched_at || box?.dispatchedAt)) return;

      const serviceCode = getBoxBillingServiceCode(box);
      if (!serviceCode) return;

      const service = getServiceCatalogEntry(catalog, serviceCode);
      const unitRate = getServiceRate({ catalog, clientPrices, clientId, serviceCode, tier, allowRateFallback: true });
      const vatAmount = unitRate * getVatRate(client, service || {});

      subtotal += unitRate;
      vat += vatAmount;
    });
  });

  return {
    subtotal,
    vat,
    total: subtotal + vat,
  };
};

const needsShipmentPreviewDetail = (shipment = {}) =>
  !getShipmentArrivalDate(shipment) || !getShipmentLineItems(shipment).length;

const Billing = () => {
  const [activeTab, setActiveTab] = useState('invoices');
  const [invoicePage, setInvoicePage] = useState(1);
  const [monthlyPage, setMonthlyPage] = useState(1);
  const [selectedInvoice, setSelectedInvoice] = useState(null);
  const [invoices, setInvoices] = useState([]);
  const [clients, setClients] = useState([]);
  const [pricingData, setPricingData] = useState({ catalog: [], clientPrices: [] });
  const [monthlyForm, setMonthlyForm] = useState({
    billingMonth: getMonthValue(),
  });
  const [previewData, setPreviewData] = useState([]);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [invoiceActionKey, setInvoiceActionKey] = useState('');

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

  const loadInvoices = async () => {
    try {
      setIsLoading(true);
      setError('');
      const response = await fetch(`${API_BASE_URL}/api/invoices`, {
        method: 'GET',
        headers: buildHeaders(),
      });
      const payload = await parseResponse(response);
      console.log('[PickPackPro][Billing][GET /api/invoices]', payload);
      setInvoices(extractInvoices(payload).map(normalizeInvoice));
    } catch (requestError) {
      setError(requestError.message);
      setInvoices([]);
    } finally {
      setIsLoading(false);
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

  const loadPricing = async () => {
    try {
      const response = await fetch(`${API_BASE_URL}/api/pricing`, {
        method: 'GET',
        headers: buildHeaders(),
        cache: 'no-store',
      });
      const payload = await parseResponse(response);
      setPricingData(extractPricing(payload));
    } catch {
      setPricingData({ catalog: [], clientPrices: [] });
    }
  };

  const fetchShipmentPreviewDetail = async (shipment) => {
    const shipmentId = getShipmentId(shipment);
    if (!shipmentId || !needsShipmentPreviewDetail(shipment)) return shipment;

    try {
      const response = await fetch(`${API_BASE_URL}/api/shipments/${encodeURIComponent(shipmentId)}`, {
        method: 'GET',
        headers: buildHeaders(),
        cache: 'no-store',
      });
      const payload = await parseResponse(response);
      const detail = payload?.shipment || payload?.data?.shipment || payload?.data || payload;
      return {
        ...shipment,
        ...detail,
        shipment_line_items: getShipmentLineItems(detail).length ? getShipmentLineItems(detail) : getShipmentLineItems(shipment),
        outbound_boxes: getShipmentOutboundBoxes(detail).length ? getShipmentOutboundBoxes(detail) : getShipmentOutboundBoxes(shipment),
      };
    } catch {
      return shipment;
    }
  };

  const loadMonthlyPreview = async (monthValue) => {
    try {
      const { periodStart, periodEnd } = getMonthRange(monthValue);
      const startDate = new Date(periodStart);
      const endDate = new Date(periodEnd);
      endDate.setHours(23, 59, 59, 999);
      const rows = await Promise.all(
        clients.map(async (client) => {
          const clientId = getClientId(client);
          if (!clientId) return null;

          try {
            const response = await fetch(
              `${API_BASE_URL}/api/shipments?clientId=${encodeURIComponent(clientId)}&limit=100`,
              { method: 'GET', headers: buildHeaders(), cache: 'no-store' }
            );
            const payload = await parseResponse(response);
            console.log('[PickPackPro][Billing][Monthly GET /api/shipments]', {
              month: monthValue,
              clientId,
              periodStart,
              periodEnd,
              payload,
            });
            const shipmentRows = extractShipments(payload);
            const shipments = await Promise.all(shipmentRows.map(fetchShipmentPreviewDetail));
            const filtered = shipments.filter((shipment) => {
              const arrival = getShipmentArrivalDate(shipment);
              if (!arrival) return false;

              const arrivalDate = new Date(arrival);
              const status = String(shipment?.status || '').toLowerCase();
              return (
                !Number.isNaN(arrivalDate.getTime()) &&
                arrivalDate >= startDate &&
                arrivalDate <= endDate &&
                ['dispatched', 'completed'].includes(status)
              );
            });
            const units = filtered.reduce((sum, shipment) => sum + getShipmentReceivedUnits(shipment), 0);
            const tier =
              client?.pricing_tier_override ??
              client?.pricingTierOverride ??
              (units >= 5000 ? 'platinum' : units >= 2000 ? 'gold' : 'silver');
            const estimate = calculateMonthlyInvoiceEstimate({
              client,
              clientId,
              shipments: filtered,
              tier,
              pricingData,
            });

            return {
              clientId,
              client: getClientName(client),
              tier,
              units,
              shipments: filtered.length,
              subtotal: estimate.subtotal,
              vat: estimate.vat,
              total: estimate.total,
            };
          } catch {
            return null;
          }
        })
      );

      const previewRows = rows.filter(Boolean);
      console.log('[PickPackPro][Billing][Monthly preview rows]', {
        month: monthValue,
        periodStart,
        periodEnd,
        rows: previewRows,
      });
      setPreviewData(previewRows);
    } catch {
      setPreviewData([]);
    }
  };

  useEffect(() => {
    loadInvoices();
    loadClients();
    loadPricing();
  }, []);

  useEffect(() => {
    if (activeTab === 'monthly' && clients.length) {
      loadMonthlyPreview(monthlyForm.billingMonth);
    } else if (activeTab === 'monthly') {
      setPreviewData([]);
    }
  }, [activeTab, clients, monthlyForm.billingMonth, pricingData]);

  const displayInvoices = useMemo(
    () =>
      invoices.map((invoice) => ({
        ...invoice,
        client: resolveInvoiceClientDisplay(invoice),
      })),
    [invoices, clientLookup]
  );
  const invoiceTotalPages = Math.max(1, Math.ceil(displayInvoices.length / BILLING_PAGE_SIZE));
  const invoicePaginationPages = useMemo(
    () => getPaginationPages(invoicePage, invoiceTotalPages),
    [invoicePage, invoiceTotalPages]
  );
  const paginatedInvoices = useMemo(() => {
    const startIndex = (invoicePage - 1) * BILLING_PAGE_SIZE;
    return displayInvoices.slice(startIndex, startIndex + BILLING_PAGE_SIZE);
  }, [displayInvoices, invoicePage]);
  const invoicePaginationStart = displayInvoices.length ? (invoicePage - 1) * BILLING_PAGE_SIZE + 1 : 0;
  const invoicePaginationEnd = Math.min(invoicePage * BILLING_PAGE_SIZE, displayInvoices.length);

  useEffect(() => {
    setInvoicePage((page) => Math.min(Math.max(page, 1), invoiceTotalPages));
  }, [invoiceTotalPages]);

  useEffect(() => {
    setMonthlyPage(1);
  }, [monthlyForm.billingMonth]);

  const monthlyTotalPages = Math.max(1, Math.ceil(previewData.length / BILLING_PAGE_SIZE));
  const monthlyPaginationPages = useMemo(
    () => getPaginationPages(monthlyPage, monthlyTotalPages),
    [monthlyPage, monthlyTotalPages]
  );
  const paginatedPreviewData = useMemo(() => {
    const startIndex = (monthlyPage - 1) * BILLING_PAGE_SIZE;
    return previewData.slice(startIndex, startIndex + BILLING_PAGE_SIZE);
  }, [previewData, monthlyPage]);
  const monthlyPaginationStart = previewData.length ? (monthlyPage - 1) * BILLING_PAGE_SIZE + 1 : 0;
  const monthlyPaginationEnd = Math.min(monthlyPage * BILLING_PAGE_SIZE, previewData.length);

  useEffect(() => {
    setMonthlyPage((page) => Math.min(Math.max(page, 1), monthlyTotalPages));
  }, [monthlyTotalPages]);

  const selectedInvoiceView = selectedInvoice
    ? {
        ...selectedInvoice,
        client: resolveInvoiceClientDisplay(selectedInvoice),
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
      { title: 'PAID (MONTH)', value: formatCurrency(paid), icon: CheckCircle, iconBg: 'bg-green-50', iconColor: 'text-green-600' },
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
        const detailInvoice = normalizeInvoice({
          ...(fallbackInvoice.raw || {}),
          ...fallbackInvoice,
          ...detailPayload,
          lineItems: extractInvoiceLineItems(detailPayload).length
            ? extractInvoiceLineItems(detailPayload)
            : extractInvoiceLineItems(fallbackInvoice.raw || fallbackInvoice),
        });

        if (detailInvoice.lineItems.length) return detailInvoice;

        const fetchedLineItems = await fetchInvoiceLineItems(lookupCandidates);
        return fetchedLineItems.length ? { ...detailInvoice, lineItems: fetchedLineItems } : detailInvoice;
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
      setSelectedInvoice(await fetchInvoiceDetail(invoice));
    } catch (requestError) {
      setError(requestError.message);
    }
  };

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
      });

      if (!response.ok) throw new Error('Failed to download invoice document');

      const blob = await response.blob();
      const contentType = response.headers.get('content-type') || '';
      const dispositionName = getContentDispositionFileName(response.headers.get('content-disposition') || '');
      const extension = contentType.toLowerCase().includes('pdf') || dispositionName.toLowerCase().endsWith('.pdf') ? 'pdf' : 'html';
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = dispositionName || `${sanitizeFileName(invoiceRef || invoiceId)}.${extension}`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
      setMessage('Invoice document downloaded.');
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

  const handleSendInvoice = async (invoice) => {
    const invoiceId = getInvoiceRouteId(invoice);

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

  const handleGenerateMonthlyInvoices = async () => {
    try {
      setError('');
      setMessage('');
      const { periodStart, periodEnd } = getMonthRange(monthlyForm.billingMonth);
      const rowsToGenerate = previewData.filter((row) => row.clientId);

      if (!rowsToGenerate.length) {
        throw new Error('Clients are required to generate monthly invoices.');
      }

      await Promise.all(
        rowsToGenerate.map((row) =>
          fetch(`${API_BASE_URL}/api/invoices/generate`, {
            method: 'POST',
            headers: buildHeaders(true),
            body: JSON.stringify({
              clientId: row.clientId,
              periodStart,
              periodEnd,
            }),
          }).then(parseResponse)
        )
      );

      setMessage('Monthly draft invoices generated.');
      await loadInvoices();
    } catch (requestError) {
      setError(requestError.message);
    }
  };

  const handleExport = () => {
    const rows = [['Invoice Ref', 'Client', 'Date', 'Due', 'Total', 'Status'], ...displayInvoices.map((invoice) => [invoice.ref, invoice.client, invoice.date, invoice.due, invoice.total, invoice.status])];
    const csv = rows.map((row) => row.map((value) => `"${String(value)}"`).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'invoices.csv';
    link.click();
    URL.revokeObjectURL(url);
  };

  const monthlyTotal = previewData.reduce((sum, row) => sum + row.total, 0);

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
            <button onClick={loadInvoices} className="inline-flex items-center gap-2 rounded-lg border border-gray-200 bg-white px-4 py-2 text-sm text-gray-700 hover:bg-gray-50"><RefreshCw size={15} />Refresh</button>
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
          <div className="border-b border-gray-200">
            <div className="flex">
              <button onClick={() => setActiveTab('invoices')} className={`border-b-2 px-6 py-3 text-sm font-medium ${activeTab === 'invoices' ? 'border-[#ff6900] text-[#ff6900]' : 'border-transparent text-gray-500 hover:text-gray-700'}`}>Invoices</button>
              <button onClick={() => setActiveTab('monthly')} className={`border-b-2 px-6 py-3 text-sm font-medium ${activeTab === 'monthly' ? 'border-[#ff6900] text-[#ff6900]' : 'border-transparent text-gray-500 hover:text-gray-700'}`}>Generate Monthly</button>
            </div>
          </div>

          {activeTab === 'invoices' ? (
            <>
              <div className="flex justify-end px-6 py-4">
                <button onClick={handleExport} className="inline-flex items-center gap-2 rounded-lg border border-gray-200 bg-white px-4 py-2 text-sm text-gray-700 hover:bg-gray-50"><Download size={16} />Export</button>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr className="border-b border-gray-100 bg-gray-50">
                      <th className="px-6 py-3 text-left text-xs font-semibold uppercase tracking-wider text-gray-500">Invoice Ref</th>
                      <th className="px-6 py-3 text-left text-xs font-semibold uppercase tracking-wider text-gray-500">Client</th>
                      <th className="px-6 py-3 text-left text-xs font-semibold uppercase tracking-wider text-gray-500">Date</th>
                      <th className="px-6 py-3 text-left text-xs font-semibold uppercase tracking-wider text-gray-500">Due</th>
                      <th className="px-6 py-3 text-left text-xs font-semibold uppercase tracking-wider text-gray-500">Total</th>
                      <th className="px-6 py-3 text-left text-xs font-semibold uppercase tracking-wider text-gray-500">Status</th>
                      <th className="px-6 py-3 text-center text-xs font-semibold uppercase tracking-wider text-gray-500">Action</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50">
                    {paginatedInvoices.map((invoice) => {
                      const routeId = getInvoiceRouteId(invoice);
                      const status = String(invoice.status || '').toLowerCase();
                      const isActionPending = invoiceActionKey.startsWith(`${routeId}:`);
                      const canSend = status === 'draft';
                      const canMarkPaid = !['paid', 'cancelled', 'canceled'].includes(status);

                      return (
                        <tr key={invoice.id} className="transition-colors hover:bg-gray-50">
                          <td className="px-6 py-3.5"><div className="flex items-center gap-2"><FileText size={14} className="text-gray-400" /><span className="text-sm font-medium text-gray-900">{invoice.ref}</span></div></td>
                          <td className="px-6 py-3.5 text-sm text-gray-700">{invoice.client}</td>
                          <td className="px-6 py-3.5 text-sm text-gray-500">{formatDate(invoice.date)}</td>
                          <td className="px-6 py-3.5 text-sm text-gray-500">{formatDate(invoice.due)}</td>
                          <td className="px-6 py-3.5 text-sm font-medium text-gray-900">{formatCurrency(invoice.total)}</td>
                          <td className="px-6 py-3.5"><span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-medium ${status === 'paid' ? 'bg-green-100 text-green-700' : status === 'overdue' ? 'bg-red-100 text-red-700' : 'bg-yellow-100 text-yellow-700'}`}>{invoice.status}</span></td>
                          <td className="px-6 py-3.5 text-center">
                            <div className="flex items-center justify-center gap-1">
                              <button type="button" onClick={() => handleViewInvoice(invoice)} className="rounded-lg p-1.5 text-gray-400 transition-colors hover:bg-gray-100 hover:text-[#ff6900]" title="View Invoice" aria-label={`View ${invoice.ref}`}><Eye size={16} /></button>
                              <button type="button" onClick={() => handleDownloadPdf(invoice)} className="rounded-lg p-1.5 text-gray-400 transition-colors hover:bg-gray-100 hover:text-[#ff6900]" title="Download invoice document" aria-label={`Download ${invoice.ref} invoice document`}><Download size={16} /></button>
                              {canSend ? (
                                <button
                                  type="button"
                                  onClick={() => handleSendInvoice(invoice)}
                                  disabled={isActionPending}
                                  className="rounded-lg p-1.5 text-gray-400 transition-colors hover:bg-gray-100 hover:text-[#ff6900] disabled:cursor-not-allowed disabled:opacity-50"
                                  title="Send invoice"
                                  aria-label={`Send ${invoice.ref}`}
                                >
                                  <Send size={16} />
                                </button>
                              ) : null}
                              {canMarkPaid ? (
                                <button
                                  type="button"
                                  onClick={() => handleUpdateInvoiceStatus(invoice, 'paid')}
                                  disabled={isActionPending}
                                  className="rounded-lg p-1.5 text-gray-400 transition-colors hover:bg-gray-100 hover:text-green-600 disabled:cursor-not-allowed disabled:opacity-50"
                                  title="Mark paid"
                                  aria-label={`Mark ${invoice.ref} paid`}
                                >
                                  <CheckCircle size={16} />
                                </button>
                              ) : null}
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                    {isLoading ? (
                      <tr>
                        <td colSpan="7" className="px-6 py-10 text-center text-sm text-gray-500">
                          <LoadingState label="Loading invoices..." />
                        </td>
                      </tr>
                    ) : null}
                  </tbody>
                </table>
              </div>
              {displayInvoices.length ? (
                <div className="border-t border-gray-200 px-6 py-3 flex flex-col gap-3 bg-gray-50 sm:flex-row sm:items-center sm:justify-between">
                  <p className="text-sm text-gray-500">
                    Showing <span className="font-medium text-gray-900">{invoicePaginationStart}-{invoicePaginationEnd}</span> of{' '}
                    <span className="font-medium text-gray-900">{displayInvoices.length}</span> invoices
                  </p>
                  <div className="flex items-center gap-2 text-sm">
                    <button
                      type="button"
                      onClick={() => setInvoicePage((page) => Math.max(1, page - 1))}
                      disabled={invoicePage === 1}
                      className="rounded-lg border border-gray-200 bg-white px-3 py-1.5 font-medium text-gray-600 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      Previous
                    </button>
                    {invoicePaginationPages.map((page) => (
                      <button
                        key={page}
                        type="button"
                        onClick={() => setInvoicePage(page)}
                        className={`min-w-8 rounded-lg px-3 py-1.5 font-semibold ${
                          invoicePage === page
                            ? 'bg-[#ff6900] text-white'
                            : 'border border-gray-200 bg-white text-gray-600 hover:bg-gray-50'
                        }`}
                      >
                        {page}
                      </button>
                    ))}
                    <button
                      type="button"
                      onClick={() => setInvoicePage((page) => Math.min(invoiceTotalPages, page + 1))}
                      disabled={invoicePage === invoiceTotalPages}
                      className="rounded-lg border border-gray-200 bg-white px-3 py-1.5 font-medium text-gray-600 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      Next
                    </button>
                  </div>
                </div>
              ) : null}
            </>
          ) : (
            <div className="bg-[#f7f9fc] p-6">
              <div className="mb-6">
                <h2 className="text-base font-semibold text-gray-900">Generate Monthly Invoices</h2>
                <p className="mt-1 text-sm text-slate-500">Review and process the current month's service billing for all active clients.</p>
              </div>

              <div className="mb-6 rounded-lg border border-slate-200 bg-white p-5">
                <div className="grid grid-cols-1 gap-5 md:max-w-sm">
                  <label className="block">
                    <span className="mb-2 block text-sm font-medium text-slate-600">Billing Month</span>
                    <select
                      value={monthlyForm.billingMonth}
                      onChange={(event) => setMonthlyForm((current) => ({ ...current, billingMonth: event.target.value }))}
                      className="w-full rounded-md border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm text-slate-700 outline-none focus:border-[#ff6900]"
                    >
                      {getRecentMonthOptions().map((value) => {
                        return <option key={value} value={value}>{formatMonthLabel(value)}</option>;
                      })}
                    </select>
                  </label>
                </div>
              </div>

              <div className="mb-6 flex items-start gap-3 rounded-md border border-blue-100 bg-blue-50 px-4 py-3 text-sm text-blue-700">
                <Info size={18} className="mt-0.5 shrink-0" />
                <p>Preview below shows invoices that will be generated based on current storage usage and fulfillment shipments processed in the selected billing period.</p>
              </div>

              <div className="overflow-hidden rounded-lg border border-slate-200 bg-white">
                <div className="overflow-x-auto">
                  <table className="w-full">
                    <thead>
                      <tr className="border-b border-slate-200 bg-slate-50">
                        <th className="px-6 py-4 text-left text-xs font-bold uppercase tracking-wide text-slate-500">Client</th>
                        <th className="px-6 py-4 text-left text-xs font-bold uppercase tracking-wide text-slate-500">Tier</th>
                        <th className="px-6 py-4 text-right text-xs font-bold uppercase tracking-wide text-slate-500">Units</th>
                        <th className="px-6 py-4 text-right text-xs font-bold uppercase tracking-wide text-slate-500">Shipments</th>
                        <th className="px-6 py-4 text-right text-xs font-bold uppercase tracking-wide text-slate-500">Est. Subtotal</th>
                        <th className="px-6 py-4 text-right text-xs font-bold uppercase tracking-wide text-slate-500">Est. VAT (20%)</th>
                        <th className="px-6 py-4 text-right text-xs font-bold uppercase tracking-wide text-slate-500">Est. Total</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {paginatedPreviewData.map((row) => (
                        <tr key={row.clientId || row.client} className="bg-white">
                          <td className="px-6 py-4 text-sm font-semibold text-slate-800">{row.client}</td>
                          <td className="px-6 py-4">
                            <span className={`inline-flex rounded px-2 py-1 text-[10px] font-bold uppercase ${String(row.tier).toLowerCase() === 'enterprise' || String(row.tier).toLowerCase() === 'platinum' ? 'bg-blue-100 text-blue-700' : String(row.tier).toLowerCase() === 'standard' || String(row.tier).toLowerCase() === 'silver' ? 'bg-orange-100 text-orange-700' : 'bg-slate-100 text-slate-600'}`}>
                              {row.tier}
                            </span>
                          </td>
                          <td className="px-6 py-4 text-right text-sm text-slate-700">{row.units.toLocaleString()}</td>
                          <td className="px-6 py-4 text-right text-sm text-slate-700">{row.shipments.toLocaleString()}</td>
                          <td className="px-6 py-4 text-right text-sm text-slate-700">{formatCurrency(row.subtotal)}</td>
                          <td className="px-6 py-4 text-right text-sm text-slate-700">{formatCurrency(row.vat)}</td>
                          <td className="px-6 py-4 text-right text-sm font-bold text-slate-900">{formatCurrency(row.total)}</td>
                        </tr>
                      ))}
                      {!previewData.length ? (
                        <tr>
                          <td colSpan="7" className="px-6 py-10 text-center text-sm text-slate-500">No active clients found.</td>
                        </tr>
                      ) : null}
                    </tbody>
                  </table>
                </div>
                {previewData.length ? (
                  <div className="border-t border-slate-200 px-6 py-3 flex flex-col gap-3 bg-slate-50 sm:flex-row sm:items-center sm:justify-between">
                    <p className="text-sm text-slate-500">
                      Showing <span className="font-medium text-slate-900">{monthlyPaginationStart}-{monthlyPaginationEnd}</span> of{' '}
                      <span className="font-medium text-slate-900">{previewData.length}</span> clients
                    </p>
                    <div className="flex items-center gap-2 text-sm">
                      <button
                        type="button"
                        onClick={() => setMonthlyPage((page) => Math.max(1, page - 1))}
                        disabled={monthlyPage === 1}
                        className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 font-medium text-slate-600 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        Previous
                      </button>
                      {monthlyPaginationPages.map((page) => (
                        <button
                          key={page}
                          type="button"
                          onClick={() => setMonthlyPage(page)}
                          className={`min-w-8 rounded-lg px-3 py-1.5 font-semibold ${
                            monthlyPage === page
                              ? 'bg-[#ff6900] text-white'
                              : 'border border-slate-200 bg-white text-slate-600 hover:bg-slate-50'
                          }`}
                        >
                          {page}
                        </button>
                      ))}
                      <button
                        type="button"
                        onClick={() => setMonthlyPage((page) => Math.min(monthlyTotalPages, page + 1))}
                        disabled={monthlyPage === monthlyTotalPages}
                        className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 font-medium text-slate-600 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        Next
                      </button>
                    </div>
                  </div>
                ) : null}
              </div>

              <div className="mt-6 flex flex-col gap-4 rounded-lg border border-slate-200 bg-white px-6 py-5 sm:flex-row sm:items-center sm:justify-between">
                <div className="text-sm text-slate-500">
                  Total to be invoiced: <span className="ml-3 font-semibold text-slate-900">{formatCurrency(monthlyTotal)}</span>
                </div>
                <button
                  onClick={handleGenerateMonthlyInvoices}
                  className="inline-flex items-center justify-center gap-2 rounded-md bg-[#ff9800] px-7 py-3 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-[#f08d00]"
                >
                  Generate Draft Invoices
                  <ArrowRight size={17} />
                </button>
              </div>
            </div>
          )}
        </div>

        {selectedInvoiceView ? (
          <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 px-4 py-8">
            <div className="w-full max-w-3xl overflow-hidden rounded-xl bg-white shadow-2xl">
              <div className="flex items-start justify-between gap-4 border-b border-gray-200 px-6 py-5">
                <div>
                  <h3 className="text-lg font-semibold text-gray-900">{selectedInvoiceView.ref}</h3>
                  <p className="mt-1 text-sm text-gray-500">Invoice detail</p>
                </div>
                <button
                  type="button"
                  onClick={() => setSelectedInvoice(null)}
                  className="rounded-lg p-2 text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-700"
                  aria-label="Close invoice detail"
                >
                  <X size={18} />
                </button>
              </div>

              <div className="space-y-5 px-6 py-5">
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-4">
                  {[
                    { label: 'Client', value: selectedInvoiceView.client },
                    { label: 'Due', value: formatDate(selectedInvoiceView.due) },
                    { label: 'Total', value: formatCurrency(selectedInvoiceView.total) },
                    { label: 'Status', value: selectedInvoiceView.status },
                  ].map((item) => (
                    <div key={item.label} className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-2">
                      <p className="text-[10px] font-semibold uppercase tracking-wide text-gray-500">{item.label}</p>
                      <p className="mt-1 break-words text-sm font-semibold text-gray-900">{item.value || '-'}</p>
                    </div>
                  ))}
                </div>

                <div className="overflow-x-auto rounded-lg border border-gray-200">
                  <table className="w-full text-sm">
                    <thead className="bg-gray-50 text-xs uppercase tracking-wider text-gray-500">
                      <tr>
                        <th className="px-4 py-2 text-left">Description</th>
                        <th className="px-4 py-2 text-left">Qty</th>
                        <th className="px-4 py-2 text-left">Rate</th>
                        <th className="px-4 py-2 text-left">Total</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {selectedInvoiceView.lineItems.length ? (
                        selectedInvoiceView.lineItems.map((item, index) => (
                          <tr key={item?.id || index}>
                            <td className="px-4 py-2">{item?.description || item?.serviceType || item?.service_type || item?.name || '-'}</td>
                            <td className="px-4 py-2">{item?.quantity || item?.qty || item?.units || '-'}</td>
                            <td className="px-4 py-2">{formatCurrency(item?.rate || item?.unitRate || item?.unit_rate || item?.unitPrice || item?.unit_price || item?.pricePerUnit)}</td>
                            <td className="px-4 py-2">{formatCurrency(item?.total || item?.amount || item?.lineTotal || item?.line_total)}</td>
                          </tr>
                        ))
                      ) : (
                        <tr>
                          <td colSpan="4" className="px-4 py-8 text-center text-sm text-gray-500">
                            No line items returned for this invoice.
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
