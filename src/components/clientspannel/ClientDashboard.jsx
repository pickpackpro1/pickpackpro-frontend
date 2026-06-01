import React, { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, TrendingUp, Truck, FileText } from 'lucide-react';
import LayoutClient from './clientlayout/LayoutClient';
import LoadingState from '../common/LoadingState';
import FullPageLoader from '../common/FullPageLoader';
import { getSession } from '../../utils/auth';

const API_BASE_URL = '';

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
    const rawMessage =
      payload?.message ||
      payload?.error ||
      payload?.details ||
      (typeof payload === 'string' ? payload : '') ||
      `Request failed with status ${response.status}`;

    if (String(rawMessage).toLowerCase().includes('max clients reached')) {
      throw new Error('Backend database connection limit reached. Please retry in a moment.');
    }

    throw new Error(
      rawMessage
    );
  }

  return payload;
};

const formatCurrency = (value) =>
  new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP', maximumFractionDigits: 0 }).format(
    Number(value || 0)
  );

const formatDate = (value) => {
  if (!value) return '--';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
};

const extractRows = (payload, keys = []) => {
  for (const key of keys) {
    if (Array.isArray(payload?.[key])) return payload[key];
    if (Array.isArray(payload?.data?.[key])) return payload.data[key];
  }
  if (Array.isArray(payload?.rows)) return payload.rows;
  if (Array.isArray(payload?.data?.rows)) return payload.data.rows;
  if (Array.isArray(payload?.data)) return payload.data;
  if (Array.isArray(payload)) return payload;
  return [];
};

const firstNonEmptyRows = (...rowSets) =>
  rowSets.find((rows) => Array.isArray(rows) && rows.length > 0) || [];

const getClientIdFromSession = () => {
  const session = getSession();

  return (
    session?.clientId ||
    session?.client_id ||
    session?.rawUser?.clientId ||
    session?.rawUser?.client_id ||
    session?.rawUser?.client?.id ||
    session?.rawUser?.clients?.id ||
    ''
  );
};

const getClientIdFromAuthUser = (authUser) =>
  authUser?.clientId ||
  authUser?.client_id ||
  authUser?.client?.id ||
  authUser?.clients?.id ||
  '';

const getLineItems = (shipment) =>
  shipment?.items ||
  shipment?.lineItems ||
  shipment?.line_items ||
  shipment?.shipmentLineItems ||
  shipment?.shipment_line_items ||
  [];

const getShipmentUnits = (shipment) =>
  Number(
    shipment?.units ||
      shipment?.totalUnits ||
      shipment?.total_units ||
      getLineItems(shipment).reduce(
        (sum, item) =>
          sum +
          Number(
            item?.expectedQty ||
              item?.qtyExpected ||
              item?.qty_expected ||
              item?.qtyReceived ||
              item?.qty_received ||
              item?.dispatchQty ||
              item?.dispatch_qty ||
              0
          ),
        0
      )
  );

const getShipmentServices = (shipment) => {
  const directServices = shipment?.services || shipment?.serviceTypes || shipment?.service_types || [];
  const itemServices = getLineItems(shipment).flatMap(
    (item) => item?.services || item?.services_selected || item?.serviceTypes || []
  );
  const uniqueServices = [...new Set([...directServices, ...itemServices].filter(Boolean))];

  return uniqueServices.map((service) => String(service).replaceAll('_', ' ')).join(', ') || '--';
};

const getServiceBreakdownFromShipments = (shipments = []) => {
  const totals = new Map();

  shipments.forEach((shipment) => {
    getLineItems(shipment).forEach((item) => {
      const units = Number(
        item?.expectedQty ||
          item?.qtyExpected ||
          item?.qty_expected ||
          item?.qtyReceived ||
          item?.qty_received ||
          item?.dispatchQty ||
          item?.dispatch_qty ||
          0
      );
      const services = item?.services || item?.services_selected || item?.serviceTypes || [];

      services.forEach((service) => {
        const label = String(service || '').replaceAll('_', ' ');
        totals.set(label, (totals.get(label) || 0) + units);
      });
    });
  });

  return [...totals.entries()].map(([name, value]) => ({ name, value }));
};

const extractDashboardPayload = (payload) => payload?.data || payload?.dashboard || payload || {};

const ClientDashboard = () => {
  const [dashboard, setDashboard] = useState(null);
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    const loadDashboard = async () => {
      try {
        setIsLoading(true);
        setError('');
        const query = new URLSearchParams();

        const [dashboardResult, shipmentsResult, invoicesResult] = await Promise.allSettled([
          fetch(`${API_BASE_URL}/api/dashboard/client`, {
            method: 'GET',
            headers: buildHeaders(),
          }).then(parseResponse),
          fetch(`${API_BASE_URL}/api/shipments${query.toString() ? `?${query.toString()}` : ''}`, {
            method: 'GET',
            headers: buildHeaders(),
          }).then(parseResponse),
          fetch(`${API_BASE_URL}/api/invoices`, {
            method: 'GET',
            headers: buildHeaders(),
          }).then(parseResponse),
        ]);

        const dashboardPayload =
          dashboardResult.status === 'fulfilled' ? extractDashboardPayload(dashboardResult.value) : {};
        const shipmentRows =
          shipmentsResult.status === 'fulfilled' ? extractRows(shipmentsResult.value, ['shipments']) : [];
        const invoiceRows =
          invoicesResult.status === 'fulfilled' ? extractRows(invoicesResult.value, ['invoices']) : [];

        if (
          dashboardResult.status === 'rejected' &&
          shipmentsResult.status === 'rejected' &&
          invoicesResult.status === 'rejected'
        ) {
          throw dashboardResult.reason;
        }

        setDashboard({
          ...dashboardPayload,
          shipments: firstNonEmptyRows(
            extractRows(dashboardPayload, ['shipments', 'activeShipments', 'active_shipments']),
            shipmentRows
          ),
          invoices: firstNonEmptyRows(
            extractRows(dashboardPayload, ['recentInvoices', 'invoices']),
            invoiceRows
          ),
        });
      } catch (requestError) {
        setError(requestError.message);
        setDashboard(null);
      } finally {
        setIsLoading(false);
      }
    };

    loadDashboard();
  }, []);

  const activeShipments = useMemo(
    () =>
      extractRows(dashboard, ['shipments', 'activeShipments', 'active_shipments']).map((shipment) => ({
        reference: shipment?.reference || shipment?.shipmentNumber || shipment?.shipment_number || shipment?.id || 'N/A',
        expected: formatDate(shipment?.expectedArrivalDate || shipment?.expected_arrival_date),
        arrived: formatDate(shipment?.actual_arrival_date || shipment?.arrivedDate || shipment?.receivedAt),
        units: getShipmentUnits(shipment),
        services: getShipmentServices(shipment),
        status: shipment?.status || 'Pending',
      })),
    [dashboard]
  );

  const servicesData = useMemo(
    () =>
      firstNonEmptyRows(
        extractRows(dashboard, ['serviceBreakdown', 'servicesBreakdown', 'services']),
        getServiceBreakdownFromShipments(dashboard?.shipments || [])
      ).map((service) => ({
        name: service?.name || service?.serviceType || service?.label || 'Service',
        value: Number(service?.value || service?.units || service?.count || 0),
      })),
    [dashboard]
  );

  const recentInvoices = useMemo(
    () =>
      extractRows(dashboard, ['recentInvoices', 'invoices']).map((invoice) => ({
        invoice: invoice?.reference || invoice?.invoiceNumber || invoice?.id || 'N/A',
        period: invoice?.periodLabel || invoice?.billingPeriod || '--',
        units: Number(invoice?.units || invoice?.totalUnits || 0),
        total: formatCurrency(invoice?.total || invoice?.grandTotal || 0),
        due: formatDate(invoice?.dueDate || invoice?.due_date),
        status: invoice?.status || 'Pending',
      })),
    [dashboard]
  );

  const stats = {
    activeShipments:
      dashboard?.activeShipmentsCount ||
      dashboard?.summary?.activeShipments ||
      dashboard?.summary?.active_shipments ||
      activeShipments.length,
    overdueInvoices:
      dashboard?.overdueInvoicesCount ||
      dashboard?.summary?.overdueInvoices ||
      dashboard?.summary?.overdue_invoices ||
      recentInvoices.filter((invoice) => String(invoice.status).toLowerCase() === 'overdue').length,
    outstandingBalance:
      dashboard?.outstandingBalance ||
      dashboard?.summary?.outstandingBalance ||
      dashboard?.summary?.outstanding_balance ||
      0,
  };

  const maxServiceValue = Math.max(...servicesData.map((service) => service.value), 1);

  return (
    <LayoutClient>
      <FullPageLoader show={isLoading} label="Loading dashboard..." />
      <div className="min-h-screen ">
        <div className="">
          {error ? (
            <div className="mb-6 rounded-lg border border-red-200 bg-red-50 p-4 text-red-700">
              {error}
            </div>
          ) : null}

          {stats.overdueInvoices > 0 ? (
            <div className="mb-8 flex items-center justify-between rounded-lg border border-red-200 bg-red-50 p-4">
              <div className="flex items-center gap-3">
                <AlertTriangle className="h-5 w-5 text-red-600" />
                <span className="font-medium text-red-800">
                  Attention: {stats.overdueInvoices} invoice(s) overdue.
                </span>
              </div>
            </div>
          ) : null}

          <div className="mb-6 flex items-center justify-between gap-4">
            <h1 className="text-2xl font-bold text-gray-900">Dashboard</h1>
          </div>

          <div className="mb-8 grid grid-cols-1 gap-6 md:grid-cols-2">
            <div className="rounded-lg border border-gray-200 bg-white p-6">
              <div className="mb-4 flex items-center justify-between">
                <div className="text-sm font-medium text-gray-600">ACTIVE SHIPMENTS</div>
                <Truck className="h-5 w-5 text-gray-400" />
              </div>
              <div className="mb-2 text-4xl font-bold text-gray-900">{stats.activeShipments}</div>
              <div className="flex items-center gap-1 text-sm">
                <TrendingUp className="h-4 w-4 text-green-600" />
                <span className="font-medium text-green-600">Live dashboard data</span>
              </div>
            </div>

            <div className="rounded-lg border border-gray-200 bg-white p-6">
              <div className="mb-4 flex items-center justify-between">
                <div className="text-sm font-medium text-gray-600">OUTSTANDING BALANCE</div>
                <FileText className="h-5 w-5 text-gray-400" />
              </div>
              <div className="mb-2 text-4xl font-bold text-gray-900">{formatCurrency(stats.outstandingBalance)}</div>
              <div className="text-sm text-gray-500">Current unpaid balance</div>
            </div>
          </div>

          <div className="mb-8 rounded-lg border border-gray-200 bg-white p-6">
            <h2 className="mb-4 text-lg font-semibold text-gray-900">Active Shipments</h2>
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-gray-200">
                    <th className="px-4 py-3 text-left text-sm font-medium text-gray-500">REFERENCE</th>
                    <th className="px-4 py-3 text-left text-sm font-medium text-gray-500">EXPECTED</th>
                    <th className="px-4 py-3 text-left text-sm font-medium text-gray-500">ARRIVED</th>
                    <th className="px-4 py-3 text-left text-sm font-medium text-gray-500">UNITS</th>
                    <th className="px-4 py-3 text-left text-sm font-medium text-gray-500">SERVICES</th>
                    <th className="px-4 py-3 text-left text-sm font-medium text-gray-500">STATUS</th>
                  </tr>
                </thead>
                <tbody>
                  {isLoading ? (
                    <tr>
                      <td colSpan="6" className="px-4 py-8 text-center text-sm text-gray-500">
                        <LoadingState label="Loading dashboard..." />
                      </td>
                    </tr>
                  ) : activeShipments.length === 0 ? (
                    <tr>
                      <td colSpan="6" className="px-4 py-8 text-center text-sm text-gray-500">
                        No active shipments found.
                      </td>
                    </tr>
                  ) : activeShipments.map((shipment, index) => (
                    <tr key={index} className="border-b border-gray-100 last:border-0">
                      <td className="px-4 py-3 text-sm font-medium text-blue-600">{shipment.reference}</td>
                      <td className="px-4 py-3 text-sm text-gray-900">{shipment.expected}</td>
                      <td className="px-4 py-3 text-sm text-gray-900">{shipment.arrived}</td>
                      <td className="px-4 py-3 text-sm text-gray-900">{shipment.units.toLocaleString()}</td>
                      <td className="px-4 py-3 text-sm text-gray-900">{shipment.services}</td>
                      <td className="px-4 py-3">
                        <span className="inline-flex rounded-full bg-yellow-100 px-3 py-1 text-xs font-medium text-yellow-700">
                          {shipment.status}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className="mb-8 grid grid-cols-1 gap-8 lg:grid-cols-2">
            <div className="rounded-lg border border-gray-200 bg-white p-6">
              <h2 className="mb-6 text-lg font-semibold text-gray-900">Units by Services</h2>
              <div className="space-y-4">
                {servicesData.map((service, index) => (
                  <div key={index}>
                    <div className="mb-2 flex items-center justify-between">
                      <span className="text-sm font-medium text-gray-700">{service.name}</span>
                      <span className="text-sm font-semibold text-gray-900">{service.value.toLocaleString()}</span>
                    </div>
                    <div className="h-2 w-full rounded-full bg-gray-100">
                      <div className="h-2 rounded-full bg-blue-600" style={{ width: `${(service.value / maxServiceValue) * 100}%` }} />
                    </div>
                  </div>
                ))}
                {!servicesData.length ? <p className="text-sm text-gray-500">No service data found.</p> : null}
              </div>
            </div>

            <div className="rounded-lg border border-gray-200 bg-white p-6">
              <h2 className="mb-4 text-lg font-semibold text-gray-900">Recent Invoices</h2>
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr className="border-b border-gray-200">
                      <th className="px-2 py-2 text-left text-xs font-medium text-gray-500">INVOICE</th>
                      <th className="px-2 py-2 text-left text-xs font-medium text-gray-500">PERIOD</th>
                      <th className="px-2 py-2 text-left text-xs font-medium text-gray-500">UNITS</th>
                      <th className="px-2 py-2 text-left text-xs font-medium text-gray-500">TOTAL</th>
                      <th className="px-2 py-2 text-left text-xs font-medium text-gray-500">DUE</th>
                      <th className="px-2 py-2 text-left text-xs font-medium text-gray-500">STATUS</th>
                    </tr>
                  </thead>
                  <tbody>
                    {recentInvoices.map((invoice, index) => (
                      <tr key={index} className="border-b border-gray-100 last:border-0">
                        <td className="px-2 py-2 text-xs font-medium text-blue-600">{invoice.invoice}</td>
                        <td className="px-2 py-2 text-xs text-gray-900">{invoice.period}</td>
                        <td className="px-2 py-2 text-xs text-gray-900">{invoice.units}</td>
                        <td className="px-2 py-2 text-xs text-gray-900">{invoice.total}</td>
                        <td className="px-2 py-2 text-xs text-gray-900">{invoice.due}</td>
                        <td className="px-2 py-2">
                          <span className={`inline-flex rounded-full px-2 py-1 text-xs font-medium ${
                            String(invoice.status).toLowerCase() === 'overdue'
                              ? 'bg-red-100 text-red-700'
                              : 'bg-green-100 text-green-700'
                          }`}>
                            {invoice.status}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {!recentInvoices.length ? <p className="pt-4 text-sm text-gray-500">No recent invoices found.</p> : null}
              </div>
            </div>
          </div>
        </div>
      </div>
    </LayoutClient>
  );
};

export default ClientDashboard;
