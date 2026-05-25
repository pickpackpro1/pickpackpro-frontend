import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import Layout from './adminlayout/Layout';
import LoadingState from '../common/LoadingState';
import FullPageLoader from '../common/FullPageLoader';
import {
  Package,
  Clock,
  TrendingUp,
  FileText,
  AlertTriangle,
  Filter,
} from 'lucide-react';
import { getSession } from '../../utils/auth';

const API_BASE_URL = import.meta.env.DEV
  ? ''
  : (import.meta.env.VITE_API_BASE_URL || 'https://ali-backend.vercel.app');

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

const formatNumber = (value) => Number(value || 0).toLocaleString();

const formatCurrency = (value) => {
  const amount = Number(value || 0);
  return `£${amount.toLocaleString()}`;
};

const normalizeStatusClass = (status = '') => {
  switch (String(status).toLowerCase()) {
    case 'submitted':
      return 'bg-blue-100 text-blue-700';
    case 'received':
      return 'bg-amber-100 text-amber-700';
    case 'pending':
    case 'pending_arrival':
      return 'bg-gray-100 text-gray-700';
    case 'progress':
    case 'in_progress':
      return 'bg-blue-100 text-blue-700';
    case 'prepped':
      return 'bg-green-100 text-green-700';
    default:
      return 'bg-slate-100 text-slate-700';
  }
};

const extractDashboardData = (payload) =>
  payload?.dashboard || payload?.data?.dashboard || payload?.data || payload || {};

const extractRows = (payload) => {
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload?.rows)) return payload.rows;
  if (Array.isArray(payload?.data?.rows)) return payload.data.rows;
  if (Array.isArray(payload?.shipments)) return payload.shipments;
  if (Array.isArray(payload?.data?.shipments)) return payload.data.shipments;
  if (Array.isArray(payload?.data)) return payload.data;
  return [];
};

const getShipmentItems = (shipment) =>
  shipment?.items ||
  shipment?.lineItems ||
  shipment?.line_items ||
  shipment?.shipmentLineItems ||
  shipment?.shipment_line_items ||
  [];

const getClientName = (shipment) =>
  shipment?.client?.companyName ||
  shipment?.client?.company_name ||
  shipment?.clients?.companyName ||
  shipment?.clients?.company_name ||
  shipment?.clientName ||
  shipment?.client_name ||
  shipment?.client ||
  shipment?.clientId ||
  shipment?.client_id ||
  '-';

const getShipmentUnits = (shipment) =>
  Number(
    shipment?.units ||
      shipment?.totalUnits ||
      shipment?.total_units ||
      getShipmentItems(shipment).reduce(
        (sum, entry) =>
          sum +
          Number(
            entry?.expectedQty ||
              entry?.qtyExpected ||
              entry?.qty_expected ||
              entry?.qty_received ||
              entry?.dispatch_qty ||
              0
          ),
        0
      )
  );

const getStaffUnitsDone = (shipment) =>
  getShipmentItems(shipment).reduce((sum, item) => {
    const serviceStatus = item?.service_status || item?.serviceStatus || {};

    return (
      sum +
      Object.entries(serviceStatus).reduce((statusSum, [key, value]) => {
        if (!String(key).toLowerCase().endsWith(':unitsdone')) {
          return statusSum;
        }

        return statusSum + Number(value || 0);
      }, 0)
    );
  }, 0);

const firstNonEmptyRows = (...candidates) =>
  candidates.find((candidate) => Array.isArray(candidate) && candidate.length > 0) || [];

const getStaffUnitRowsFromShipments = (shipments = []) => {
  const totals = new Map();

  shipments.forEach((shipment) => {
    getShipmentItems(shipment).forEach((item) => {
      const serviceStatus = item?.service_status || item?.serviceStatus || {};

      Object.entries(serviceStatus).forEach(([key, value]) => {
        const normalizedKey = String(key).toLowerCase();

        if (!normalizedKey.endsWith(':staffid') || !value) {
          return;
        }

        const servicePrefix = key.slice(0, key.length - ':staffId'.length);
        const unitsDone = Number(
          serviceStatus[`${servicePrefix}:unitsDone`] ||
            serviceStatus[`${servicePrefix}:units_done`] ||
            0
        );
        const staffId = String(value);
        const staffName =
          serviceStatus[`${servicePrefix}:name`] ||
          serviceStatus[`${servicePrefix}:staffName`] ||
          serviceStatus[`${servicePrefix}:staff_name`] ||
          serviceStatus[`${servicePrefix}:assignedName`] ||
          serviceStatus[`${servicePrefix}:assigned_name`] ||
          '';
        const row = totals.get(staffId) || { staffId, name: '', units: 0 };

        totals.set(staffId, {
          ...row,
          name: row.name || staffName,
          units: row.units + unitsDone,
        });
      });
    });
  });

  return [...totals.values()].map((row, index) => ({
    id: row.staffId,
    name: row.name || `Staff ${row.staffId?.slice(0, 8) || '?'}`,
    units: row.units,
    color: index === 0 ? 'bg-[#ff6900]' : index === 1 ? 'bg-orange-400' : 'bg-slate-400',
  }));
};

const Dashboard = () => {
  const navigate = useNavigate();
  const [arrivalsFilter, setArrivalsFilter] = useState('today');
  const [dashboardData, setDashboardData] = useState(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');

  const loadDashboard = async (selectedFilter = arrivalsFilter) => {
    try {
      setIsLoading(true);
      setError('');
      const query = new URLSearchParams();

      if (selectedFilter) {
        query.set('arrivalsFilter', selectedFilter);
      }

      const [dashboardResult] = await Promise.allSettled([
        fetch(
          `${API_BASE_URL}/api/dashboard/admin${query.toString() ? `?${query.toString()}` : ''}`,
          {
            method: 'GET',
            headers: buildHeaders(),
          }
        ).then(parseResponse),
      ]);

      if (dashboardResult.status === 'rejected') {
        throw dashboardResult.reason;
      }

      const dashboardPayload = extractDashboardData(dashboardResult.value);
      setDashboardData({ ...dashboardPayload });
    } catch (requestError) {
      setError(requestError.message);
      setDashboardData(null);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadDashboard(arrivalsFilter);
  }, [arrivalsFilter]);

  const stats = useMemo(() => {
    const summary = dashboardData?.summary || dashboardData?.stats || {};
    const shipments = dashboardData?.shipments || [];
    const statusCounts = dashboardData?.shipmentsByStatus || dashboardData?.shipments_by_status || {};
    const arrivingShipments = dashboardData?.arrivingShipments || dashboardData?.arriving_shipments || [];
    const activeShipmentCount =
      summary?.inProgressShipments ??
      summary?.inProgress ??
      dashboardData?.activeShipments ??
      dashboardData?.active_shipments ??
      ['received', 'in_progress', 'prepped'].reduce(
        (count, status) => count + Number(statusCounts?.[status] || 0),
        0
      );
    const unitsPreppedWeek =
      summary?.unitsPreppedWeek ??
      summary?.unitsPrepped ??
      dashboardData?.unitsPreppedWeek ??
      dashboardData?.units_prepped_week ??
      shipments.reduce((sum, shipment) => sum + getStaffUnitsDone(shipment), 0);

    return [
      {
        title: 'ARRIVING TODAY',
        value: formatNumber(
          summary?.arrivalsToday ??
            summary?.arrivals ??
            dashboardData?.arrivalsToday ??
            dashboardData?.arrivals_today ??
            arrivingShipments.length ??
            dashboardData?.arrivals?.length ??
            0
        ),
        subtitle: `${formatNumber(
          summary?.pendingReceipt ??
            summary?.pendingArrivals ??
            dashboardData?.outstandingClientShipments ??
            dashboardData?.outstanding_client_shipments ??
            0
        )} pending receipt`,
        icon: Package,
        iconBg: 'bg-orange-100',
        iconColor: 'text-[#ff6900]',
      },
      {
        title: 'IN PROGRESS',
        value: formatNumber(activeShipmentCount),
        subtitle: `${formatNumber(summary?.preppedToday ?? statusCounts?.prepped ?? 0)} prepped today`,
        icon: Clock,
        iconBg: 'bg-blue-100',
        iconColor: 'text-blue-600',
      },
      {
        title: 'UNITS PREPPED (WEEK)',
        value: formatNumber(unitsPreppedWeek),
        subtitle: `${summary?.unitsTrendPercent ?? 0}% vs last week`,
        icon: TrendingUp,
        iconBg: 'bg-green-100',
        iconColor: 'text-green-600',
        trend: 'up',
      },
      {
        title: 'SHIPMENTS PREPPED',
        value: formatNumber(
          dashboardData?.shipmentsPreppedhisWeek ??
            dashboardData?.shipmentsPreppedThisWeek ??
            0
        ),
        subtitle: 'This week',
        icon: Package,
        iconBg: 'bg-emerald-100',
        iconColor: 'text-emerald-600',
      },
      {
        title: 'SHIPMENTS DISPATCHED',
        value: formatNumber(dashboardData?.shipmentsDispatchedThisWeek ?? 0),
        subtitle: 'This week',
        icon: TrendingUp,
        iconBg: 'bg-indigo-100',
        iconColor: 'text-indigo-600',
      },
      {
        title: 'DISCREPANCIES TODAY',
        value: formatNumber(dashboardData?.discrepanciesFlaggedToday ?? 0),
        subtitle: 'Today',
        icon: AlertTriangle,
        iconBg: 'bg-amber-100',
        iconColor: 'text-amber-600',
      },
      {
        title: 'OUTSTANDING INVOICES',
        value: formatCurrency(
          summary?.outstandingInvoicesAmount ??
            dashboardData?.outstandingInvoicesAmount ??
            dashboardData?.outstanding_invoices_amount ??
            summary?.revenueThisMonth ??
            dashboardData?.revenueThisMonth ??
            dashboardData?.revenue_this_month ??
            0
        ),
        subtitle: `${formatNumber(summary?.overdueInvoices ?? 0)} overdue`,
        icon: FileText,
        iconBg: 'bg-red-100',
        iconColor: 'text-red-600',
      },
    ];
  }, [dashboardData]);

  const weeklyArrivals = useMemo(() => {
    const arrivalsRows =
      dashboardData?.arrivals ||
      dashboardData?.weeklyArrivals ||
      dashboardData?.weekly_arrivals ||
      dashboardData?.arrivingShipments ||
      dashboardData?.arriving_shipments ||
      [];
    const rows = firstNonEmptyRows(arrivalsRows);

    return rows.slice(0, 4).map((item, index) => ({
      id: item?.id || item?.uuid || index,
      reference: item?.reference || item?.shipmentNumber || item?.shipment_number || item?.id || 'N/A',
      client: getClientName(item),
      units: getShipmentUnits(item),
      sku:
        item?.skuCount ||
        item?.skuTotal ||
        item?.sku_count ||
        item?.sku_total ||
        getShipmentItems(item).length ||
        0,
      status: item?.status || 'pending',
    }));
  }, [dashboardData]);

  const alerts = useMemo(() => {
    const rows = dashboardData?.alerts || dashboardData?.flags || dashboardData?.issues || [];

    return rows.slice(0, 3).map((item, index) => ({
      id: item?.id || index,
      description:
        item?.description ||
        item?.message ||
        item?.title ||
        `${item?.reference || 'Alert'} requires attention.`,
      tone:
        item?.severity === 'critical' || item?.type === 'discrepancy'
          ? 'border-red-300 bg-red-50 text-red-700'
          : item?.type === 'invoice'
            ? 'border-blue-300 bg-blue-50 text-blue-700'
            : 'border-amber-300 bg-amber-50 text-amber-700',
    }));
  }, [dashboardData]);

  const prepPipeline = useMemo(() => {
    const rows = firstNonEmptyRows(
      dashboardData?.staffActivity ||
        dashboardData?.staff_activity,
      dashboardData?.prepPipeline ||
        dashboardData?.prep_pipeline,
      dashboardData?.activeWork ||
        dashboardData?.active_work,
      (dashboardData?.shipments || []).filter((shipment) =>
        ['received', 'in_progress', 'prepped'].includes(String(shipment?.status || '').toLowerCase())
      )
    );

    return rows.slice(0, 2).map((item, index) => ({
      id: item?.id || item?.shipmentId || index,
      shipment: item?.reference || item?.shipment || item?.shipmentNumber || item?.shipment_number || 'N/A',
      client: getClientName(item),
      assigned:
        item?.assignedTo?.name ||
        item?.assigned_to?.name ||
        item?.assigned ||
        item?.staffName ||
        item?.staff_name ||
        item?.assigned_to ||
        '-',
      progress: Number(
        item?.progressPercent ??
          item?.progress_percent ??
          item?.progress ??
          item?.unitsDonePercent ??
          item?.units_done_percent ??
          (getShipmentUnits(item) ? Math.round((getStaffUnitsDone(item) / getShipmentUnits(item)) * 100) : 0)
      ),
      status: item?.status || 'progress',
    }));
  }, [dashboardData]);

  const staffUnits = useMemo(() => {
    const rows = firstNonEmptyRows(
      dashboardData?.staffUnitsWeek || dashboardData?.staff_units_week,
      dashboardData?.staffActivity || dashboardData?.staff_activity,
      dashboardData?.staff,
      getStaffUnitRowsFromShipments(dashboardData?.shipments || [])
    );

    return rows.slice(0, 3).map((item, index) => {
      const row = {
        ...item,
        staffId: String(item?.staffId || item?.staff_id || item?.id || '').trim(),
        name: item?.name || item?.staffName || item?.staff_name || item?.assigned || '',
      };

      return {
        id: row.staffId || index,
        name: row.name || `Staff ${row.staffId?.slice(0, 8) || '?'}`,
        units: Number(row?.units ?? row?.unitsDone ?? row?.weeklyUnits ?? 0),
        color:
          index === 0 ? 'bg-[#ff6900]' : index === 1 ? 'bg-orange-400' : 'bg-slate-400',
      };
    });
  }, [dashboardData]);

  const maxStaffUnits = Math.max(...staffUnits.map((item) => item.units), 1);

  return (
    <Layout>
      <FullPageLoader show={isLoading} label="Loading dashboard..." />
      <div className="min-h-screen ">
        <div className="mb-6">
          <h1 className="text-2xl font-semibold text-gray-900">Dashboard</h1>
          <p className="mt-1 text-sm text-gray-500">
            Welcome back, {dashboardData?.adminName || getSession()?.name || 'Admin'}
          </p>
        </div>

        {error ? (
          <p className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            {error}
          </p>
        ) : null}

        <div className="mb-6 grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-4">
          {stats.map((card) => {
            const Icon = card.icon;
            return (
              <div
                key={card.title}
                className="rounded-xl border border-gray-200 bg-white p-6 transition-shadow duration-200 hover:shadow-md"
              >
                <div className="mb-4 flex items-start justify-between">
                  <p className="text-xs font-semibold uppercase tracking-wider text-gray-500">
                    {card.title}
                  </p>
                  <div className={`rounded-lg p-2 ${card.iconBg}`}>
                    <Icon size={20} className={card.iconColor} />
                  </div>
                </div>

                <div>
                  <h3 className="mb-1 text-3xl font-bold text-gray-900">{card.value}</h3>
                  <p
                    className={`text-sm ${
                      card.trend === 'up'
                        ? 'font-medium text-green-600'
                        : card.subtitle.includes('overdue')
                          ? 'text-red-500'
                          : 'text-gray-500'
                    }`}
                  >
                    {card.trend === 'up' ? `↑ ${card.subtitle}` : card.subtitle}
                  </p>
                </div>
              </div>
            );
          })}
        </div>

        <div className="mb-6 grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1.5fr)_minmax(0,0.75fr)]">
          <div className="rounded-xl border border-gray-200 bg-white p-6">
            <div className="mb-4 flex items-center justify-between">
              <h3 className="text-sm font-semibold text-gray-900">Weekly Arrivals</h3>
              <div className="flex items-center gap-2">
                <select
                  value={arrivalsFilter}
                  onChange={(e) => setArrivalsFilter(e.target.value)}
                  className="rounded-lg border border-gray-200 px-3 py-1.5 text-xs font-medium text-gray-700"
                >
                  <option value="today">Today</option>
                  <option value="tomorrow">Tomorrow</option>
                  <option value="this_week">This Week</option>
                </select>
                <button
                  onClick={() => navigate('/shipments')}
                  className="rounded-lg border border-gray-200 px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50"
                >
                  View all
                </button>
              </div>
            </div>

            <table className="w-full">
              <thead>
                <tr className="border-b border-gray-100 text-xs uppercase tracking-wider text-gray-500">
                  <th className="pb-3 text-left font-medium">Reference</th>
                  <th className="pb-3 text-left font-medium">Client</th>
                  <th className="pb-3 text-left font-medium">Units</th>
                  <th className="pb-3 text-left font-medium">SKU</th>
                  <th className="pb-3 text-left font-medium">Status</th>
                </tr>
              </thead>
              <tbody className="text-sm">
                {isLoading ? (
                  <tr>
                    <td colSpan="5" className="py-8 text-center text-sm text-gray-500">
                      <LoadingState label="Loading dashboard..." />
                    </td>
                  </tr>
                ) : weeklyArrivals.length === 0 ? (
                  <tr>
                    <td colSpan="5" className="py-8 text-center text-sm text-gray-500">
                      No arrivals available.
                    </td>
                  </tr>
                ) : (
                  weeklyArrivals.map((item) => (
                    <tr key={item.id} className="border-b border-gray-50 last:border-0">
                      <td className="py-3 text-xs font-medium text-[#ff6900]">{item.reference}</td>
                      <td className="py-3 text-gray-700">{item.client}</td>
                      <td className="py-3 text-gray-700">{item.units}</td>
                      <td className="py-3 text-gray-700">{item.sku}</td>
                      <td className="py-3">
                        <span
                          className={`inline-flex rounded-full px-2 py-1 text-xs font-medium ${normalizeStatusClass(item.status)}`}
                        >
                          {String(item.status).toUpperCase()}
                        </span>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          <div className="rounded-xl border border-gray-200 bg-white p-6">
            <div className="mb-4 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <AlertTriangle size={16} className="text-red-500" />
                <h3 className="text-sm font-semibold text-gray-900">Alerts & Flags</h3>
              </div>
              <span className="rounded-full bg-red-100 px-2 py-0.5 text-xs font-medium text-red-600">
                {alerts.length} Critical
              </span>
            </div>

            <div className="space-y-3">
              {isLoading ? (
                <div className="rounded-lg border border-gray-200 bg-gray-50 px-4 py-3 text-sm text-gray-500">
                  <LoadingState label="Loading alerts..." />
                </div>
              ) : alerts.length === 0 ? (
                <div className="rounded-lg border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-700">
                  No critical alerts right now.
                </div>
              ) : (
                alerts.map((alert) => (
                  <div key={alert.id} className={`rounded-lg border-l-4 px-4 py-3 text-sm ${alert.tone}`}>
                    {alert.description}
                  </div>
                ))
              )}
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1.5fr)_minmax(0,0.75fr)]">
          <div className="rounded-xl border border-gray-200 bg-white p-6">
            <div className="mb-4 flex items-center justify-between">
              <h3 className="text-sm font-semibold text-gray-900">Prep Pipeline</h3>
              <button
                onClick={() => navigate('/shipments')}
                className="rounded-lg border border-gray-200 px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50"
              >
                All shipments
              </button>
            </div>

            <table className="w-full">
              <thead>
                <tr className="border-b border-gray-100 text-xs uppercase tracking-wider text-gray-500">
                  <th className="pb-3 text-left font-medium">Shipment</th>
                  <th className="pb-3 text-left font-medium">Client</th>
                  <th className="pb-3 text-left font-medium">Assigned</th>
                  <th className="pb-3 text-left font-medium">Progress</th>
                  <th className="pb-3 text-left font-medium">Status</th>
                </tr>
              </thead>
              <tbody className="text-sm">
                {isLoading ? (
                  <tr>
                    <td colSpan="5" className="py-8 text-center text-sm text-gray-500">
                      <LoadingState label="Loading pipeline..." />
                    </td>
                  </tr>
                ) : prepPipeline.length === 0 ? (
                  <tr>
                    <td colSpan="5" className="py-8 text-center text-sm text-gray-500">
                      No prep pipeline data available.
                    </td>
                  </tr>
                ) : (
                  prepPipeline.map((item) => (
                    <tr key={item.id} className="border-b border-gray-50 last:border-0">
                      <td className="py-3 text-xs font-medium text-[#ff6900]">{item.shipment}</td>
                      <td className="py-3 text-gray-700">{item.client}</td>
                      <td className="py-3 text-gray-700">{item.assigned}</td>
                      <td className="py-3">
                        <div className="flex items-center gap-2">
                          <div className="h-2 w-20 overflow-hidden rounded-full bg-gray-200">
                            <div
                              className="h-full rounded-full bg-[#ff6900]"
                              style={{ width: `${Math.min(Math.max(item.progress, 0), 100)}%` }}
                            />
                          </div>
                          <span className="text-xs text-gray-500">{item.progress}%</span>
                        </div>
                      </td>
                      <td className="py-3">
                        <span
                          className={`inline-flex rounded-full px-2 py-1 text-xs font-medium ${normalizeStatusClass(item.status)}`}
                        >
                          {String(item.status).toUpperCase()}
                        </span>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          <div className="rounded-xl border border-gray-200 bg-white p-6">
            <h3 className="mb-6 text-sm font-semibold text-gray-900">Staff Units - Week</h3>

            <div className="space-y-6">
              {isLoading ? (
                <div className="text-sm text-gray-500">
                  <LoadingState label="Loading staff activity..." />
                </div>
              ) : staffUnits.length === 0 ? (
                <div className="text-sm text-gray-500">No staff activity available.</div>
              ) : (
                staffUnits.map((staff) => (
                  <div key={staff.id} className="flex items-center gap-4">
                    <div className="flex h-8 w-8 items-center justify-center rounded-full bg-gray-200 text-xs font-semibold text-gray-700">
                      {staff.name
                        .split(' ')
                        .map((part) => part[0])
                        .join('')
                        .slice(0, 2)}
                    </div>
                    <div className="flex-1">
                      <div className="mb-1 flex items-center justify-between">
                        <span className="text-sm font-medium text-gray-900">{staff.name}</span>
                        <span className="text-sm font-semibold text-gray-900">
                          {formatNumber(staff.units)}
                        </span>
                      </div>
                      <div className="h-2 w-full overflow-hidden rounded-full bg-gray-200">
                        <div
                          className={`h-full rounded-full ${staff.color}`}
                          style={{ width: `${(staff.units / maxStaffUnits) * 100}%` }}
                        />
                      </div>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      </div>
    </Layout>
  );
};

export default Dashboard;
