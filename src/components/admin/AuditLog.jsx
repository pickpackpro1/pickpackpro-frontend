import React, { useEffect, useMemo, useState } from 'react';
import Layout from './adminlayout/Layout';
import LoadingState from '../common/LoadingState';
import FullPageLoader from '../common/FullPageLoader';
import { getSession } from '../../utils/auth';
import {
  Search,
  Filter,
  FileText,
  Clock3,
  RefreshCw,
  Calendar,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
} from 'lucide-react';

const ACTION_DESCRIPTIONS = {
  'user.invited': 'Admin invited a new staff/client/admin',
  'user.role_changed': 'User role was changed',
  'user.deactivated': 'User account was deactivated',
  'user.reactivated': 'User account was reactivated',
  'client.created': 'New client company was created',
  'client.updated': 'Client details were updated',
  'client.suspended': 'Client account was suspended',
  'client.soft_delete': 'Client was deleted from the system',
  'client.pricing_override': 'Custom pricing was set for a client',
  'shipment.created': 'New shipment was created',
  'shipment.submitted': 'Shipment was submitted for processing',
  'shipment.status_changed': 'Shipment was moved to a new status',
  'shipment.received': 'Shipment was marked as received at warehouse',
  'shipment.assigned': 'Shipment was assigned to a staff member',
  'shipment.discrepancy_flagged': 'Quantity mismatch found during receiving',
  'shipment.dispatched': 'Shipment was dispatched to Amazon',
  'shipment.completed': 'Shipment was marked as completed',
  'service.status_changed': 'A service was marked in-progress or done',
  'box.created': 'Outbound box was added to shipment',
  'box.dispatched': 'Box was sealed and marked dispatched',
  'box.label_uploaded': 'FBA shipping label was uploaded for a box',
  'invoice.generated': 'Invoice was generated (monthly or ad-hoc)',
  'invoice.status_changed': 'Invoice status was updated',
  'invoice.sent': 'Invoice was emailed to the client',
  'invoice.marked_paid': 'Invoice was marked as paid',
  'invoice.cancelled': 'Invoice was cancelled',
  'product.created': 'New product was added',
  'product.updated': 'Product details were updated',
  'product.soft_delete': 'Product was deleted from the system',
  'settings.updated': 'Company settings were changed',
  'service_catalog.updated': 'Service rate or visibility was changed',
};

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

const extractUsers = (payload) => {
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload?.users)) return payload.users;
  if (Array.isArray(payload?.data)) return payload.data;
  return [];
};

const normalizeUser = (user) => ({
  id: user?.id || user?.uuid || user?.userId || '',
  email: user?.email || user?.contactEmail || user?.contact_email || '',
  name:
    user?.name ||
    user?.fullName ||
    user?.full_name ||
    user?.email ||
    user?.contactEmail ||
    user?.contact_email ||
    'Unknown User',
  role: String(user?.role || '').toLowerCase(),
});

const extractAuditPayload = (payload) => {
  const source = payload?.data || payload || {};
  const logs =
    source?.logs ||
    source?.auditLogs ||
    source?.audit_logs ||
    source?.rows ||
    source?.items ||
    (Array.isArray(source) ? source : []);

  return {
    logs: Array.isArray(logs) ? logs : [],
    total: Number(source?.total ?? source?.count ?? logs?.length ?? 0),
    page: Number(source?.page ?? 1),
    limit: Number(source?.limit ?? 50),
  };
};

const formatDateTime = (value) => {
  if (!value) return '-';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleString('en-GB');
};

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * Extracts a short human-readable reference from an audit log row.
 * Looks inside after_value first, then before_value, then falls back to entityId.
 */
const getEntityReference = (log) => {
  const parse = (value) => {
    if (!value || typeof value !== 'string') return value;
    try {
      return JSON.parse(value);
    } catch {
      return value;
    }
  };

  const after = parse(log?.after_value ?? log?.afterValue);
  const before = parse(log?.before_value ?? log?.beforeValue);
  const entityType = String(log?.entity_type ?? log?.entityType ?? '').toLowerCase();

  const REFERENCE_KEYS_BY_TYPE = {
    shipment: ['reference', 'shipmentNumber', 'shipment_number'],
    invoice: ['invoiceNumber', 'invoice_number', 'reference'],
    client: ['companyName', 'company_name', 'name'],
    product: ['productName', 'product_name', 'sku', 'name'],
    user: ['email', 'name', 'fullName'],
    box: ['boxLabel', 'label', 'reference'],
    service: ['serviceCode', 'service_code', 'name'],
    settings: [],
  };

  const keys = REFERENCE_KEYS_BY_TYPE[entityType] ?? ['name', 'reference', 'email'];

  for (const source of [after, before]) {
    if (source && typeof source === 'object') {
      for (const key of keys) {
        const value = source[key];
        if (value && !UUID_PATTERN.test(String(value))) return String(value);
      }
    }
  }

  if (entityType === 'settings') return 'System Settings';

  return '-';
};

const parseMaybeJson = (value) => {
  if (typeof value !== 'string') {
    return value;
  }

  const trimmedValue = value.trim();

  if (!trimmedValue || !['{', '['].includes(trimmedValue[0])) {
    return value;
  }

  try {
    return JSON.parse(trimmedValue);
  } catch {
    return value;
  }
};

const isIdLikeValue = (value) => {
  const text = String(value || '').trim();
  return UUID_PATTERN.test(text) || /^[0-9a-f]{24}$/i.test(text);
};

const toTitleCase = (value) =>
  String(value || '')
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\b\w/g, (letter) => letter.toUpperCase());

const normalizeDisplayToken = (value) => {
  if (value === null || value === undefined || value === '') {
    return '';
  }

  const text = String(value).trim();

  if (isIdLikeValue(text)) {
    return '';
  }

  return text;
};

const getFirstReadableValue = (source, keys) => {
  if (!source || typeof source !== 'object') {
    return '';
  }

  for (const key of keys) {
    const value = normalizeDisplayToken(source[key]);

    if (value) {
      return value;
    }
  }

  return '';
};

const getReadableValue = (value) => {
  const parsedValue = parseMaybeJson(value);

  if (Array.isArray(parsedValue)) {
    const readableItems = parsedValue
      .map(getReadableValue)
      .filter((item) => item && item !== '-');

    return readableItems.length ? readableItems.join(', ') : '-';
  }

  if (parsedValue && typeof parsedValue === 'object') {
    const directValue = getFirstReadableValue(parsedValue, [
      'status',
      'newStatus',
      'oldStatus',
      'state',
      'value',
      'name',
      'title',
      'companyName',
      'company_name',
      'clientName',
      'client_name',
      'productName',
      'product_name',
      'reference',
      'shipmentNumber',
      'shipment_number',
      'invoiceNumber',
      'invoice_number',
      'orderNumber',
      'order_number',
      'sku',
      'email',
    ]);

    if (directValue) {
      return directValue;
    }

    const changedFields = Object.entries(parsedValue)
      .filter(([key, entryValue]) => !/id$/i.test(key) && key !== 'id' && normalizeDisplayToken(entryValue))
      .slice(0, 2)
      .map(([key, entryValue]) => `${toTitleCase(key)}: ${normalizeDisplayToken(entryValue)}`);

    return changedFields.length ? changedFields.join(', ') : '-';
  }

  const text = normalizeDisplayToken(parsedValue);
  return text || '-';
};

const compactValue = (value) => {
  const readableValue = getReadableValue(value);
  if (readableValue === '-') return '-';
  const text = typeof readableValue === 'string' ? readableValue : JSON.stringify(readableValue);
  return text.length > 90 ? `${text.slice(0, 90)}...` : text;
};

const getEntityLabel = (log, entityType, entityId) => {
  const directEntityName =
    log?.entity_name ||
    log?.entityName ||
    log?.resource_name ||
    log?.resourceName ||
    log?.entity?.name ||
    log?.entity?.title;
  const readableEntityValue = getReadableValue(
    directEntityName ||
      log?.reference ||
      log?.shipmentNumber ||
      log?.shipment_number ||
      log?.invoiceNumber ||
      log?.invoice_number ||
      log?.sku ||
      entityId
  );
  const entityTypeLabel = entityType !== '-' ? toTitleCase(entityType) : 'Entity';

  return readableEntityValue !== '-' ? `${entityTypeLabel}: ${readableEntityValue}` : entityTypeLabel;
};

/**
 * The backend now always sends a proper dot-notation action code like
 * "shipment.received" or "product.created". We use it directly.
 * We only fall back to inference if the action is a bare HTTP verb or empty.
 */
const getActionLabel = (action = '', entityType = '') => {
  const normalized = String(action || '').trim().toLowerCase();
  if (!normalized || normalized === '-') return '-';

  if (normalized.includes('.')) return normalized;

  const entity = String(entityType || 'item').trim().toLowerCase();
  if (normalized === 'post') return `${entity}.created`;
  if (normalized === 'patch') return `${entity}.updated`;
  if (normalized === 'put') return `${entity}.updated`;
  if (normalized === 'delete') return `${entity}.deleted`;

  return normalized.replace(/[:\s]+/g, '.');
};

const getDisplayRole = (role, matchedUser) => {
  const normalizedRole = String(role || '').trim().toLowerCase();
  const userRole = String(matchedUser?.role || '').trim().toLowerCase();
  const resolvedRole = normalizedRole && normalizedRole !== 'user' ? normalizedRole : userRole;

  return resolvedRole ? toTitleCase(resolvedRole) : '-';
};

const getRoleColor = (role = '') => {
  switch (String(role).toLowerCase()) {
    case 'admin':
      return 'bg-orange-100 text-orange-700';
    case 'staff':
      return 'bg-blue-100 text-blue-700';
    case 'client':
      return 'bg-purple-100 text-purple-700';
    default:
      return 'bg-gray-100 text-gray-600';
  }
};

const getActionColor = (action = '') => {
  const a = String(action).toLowerCase();

  if (
    a.includes('delete') ||
    a.includes('soft_delete') ||
    a.includes('suspended') ||
    a.includes('cancelled') ||
    a.includes('deactivated')
  ) return 'bg-red-100 text-red-700';

  if (
    a.includes('created') ||
    a.includes('invited') ||
    a.includes('reactivated') ||
    a.includes('generated') ||
    a.includes('submitted')
  ) return 'bg-green-100 text-green-700';

  if (
    a.includes('updated') ||
    a.includes('changed') ||
    a.includes('override') ||
    a.includes('role_changed')
  ) return 'bg-amber-100 text-amber-700';

  if (
    a.includes('dispatched') ||
    a.includes('completed') ||
    a.includes('sent') ||
    a.includes('marked_paid')
  ) return 'bg-blue-100 text-blue-700';

  if (a.includes('discrepancy') || a.includes('flagged')) return 'bg-orange-100 text-orange-700';

  if (a.includes('received') || a.includes('assigned') || a.includes('label_uploaded')) {
    return 'bg-teal-100 text-teal-700';
  }

  return 'bg-slate-100 text-slate-700';
};

const normalizeAuditLog = (log, index, users = []) => {
  const action = log?.action || log?.event || log?.operation || '-';
  const entityType = log?.entity_type || log?.entityType || log?.resource_type || log?.resourceType || '-';
  const entityId = log?.entity_id || log?.entityId || log?.resource_id || log?.resourceId || '-';
  const rawUserId = log?.user_id || log?.userId || log?.actor_id || log?.actorId || '';
  const rawUser =
    log?.user_email ||
    log?.userEmail ||
    log?.actor_email ||
    log?.actorEmail ||
    log?.user?.email ||
    log?.user?.name ||
    rawUserId ||
    '-';
  const matchedUser = users.find((userEntry) => {
    const userId = String(userEntry.id || '').toLowerCase();
    const userName = String(userEntry.name || '').toLowerCase();
    const userEmail = String(userEntry.email || '').toLowerCase();
    const rawUserText = String(rawUser || '').toLowerCase();
    const rawUserIdText = String(rawUserId || '').toLowerCase();

    return (
      (rawUserIdText && userId === rawUserIdText) ||
      (rawUserText && (userId === rawUserText || userName === rawUserText || userEmail === rawUserText))
    );
  });
  const user = matchedUser?.name || (isIdLikeValue(rawUser) ? 'System User' : rawUser);
  const role = getDisplayRole(log?.user_role || log?.userRole || log?.role || log?.user?.role, matchedUser);
  const before = compactValue(log?.before_value ?? log?.beforeValue ?? log?.before ?? log?.oldValue ?? log?.old_value);
  const after = compactValue(log?.after_value ?? log?.afterValue ?? log?.after ?? log?.newValue ?? log?.new_value);
  const actionLabel = getActionLabel(action, entityType);
  const entry = getEntityLabel(log, entityType, entityId);
  const entityReference = getEntityReference(log);

  return {
    id: log?.id || log?.uuid || `${entityType}-${entityId}-${index}`,
    timestamp: formatDateTime(log?.timestamp || log?.createdAt || log?.created_at),
    user,
    role,
    roleColor: getRoleColor(role),
    action: actionLabel,
    actionColor: getActionColor(actionLabel),
    entry,
    entityReference,
    before,
    after,
    ip:
      log?.ip_address ||
      log?.ipAddress ||
      log?.request_ip ||
      log?.requestIp ||
      log?.ip ||
      '-',
    afterColor: 'text-gray-600',
    searchable: [
      user,
      role,
      action,
      entityType,
      entityId,
      log?.ip_address || log?.ipAddress || log?.request_ip || log?.requestIp || log?.ip,
      compactValue(log?.before_value ?? log?.beforeValue ?? log?.before),
      compactValue(log?.after_value ?? log?.afterValue ?? log?.after),
      entityReference,
    ]
      .join(' ')
      .toLowerCase(),
  };
};

const formatHours = (value) => {
  const number = Number(value || 0);
  return Number.isFinite(number) ? `${number.toFixed(1)} hrs` : '0.0 hrs';
};

const getSummaryValue = (payload, keys) => {
  for (const key of keys) {
    if (payload?.[key] != null) {
      return payload[key];
    }
  }
  return 0;
};

const AuditLog = () => {
  const [searchTerm, setSearchTerm] = useState('');
  const [actionFilter, setActionFilter] = useState('');
  const [entityTypeFilter, setEntityTypeFilter] = useState('All');
  const [entityIdFilter, setEntityIdFilter] = useState('');
  const [userFilter, setUserFilter] = useState('All');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [logs, setLogs] = useState([]);
  const [totalLogs, setTotalLogs] = useState(0);
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(50);
  const [users, setUsers] = useState([]);
  const [timeSummary, setTimeSummary] = useState(null);
  const [isLoadingLogs, setIsLoadingLogs] = useState(false);
  const [isLoadingSummary, setIsLoadingSummary] = useState(false);
  const [error, setError] = useState('');

  const actions = [
    '',
    'user.invited',
    'user.role_changed',
    'user.deactivated',
    'user.reactivated',
    'client.created',
    'client.updated',
    'client.suspended',
    'client.soft_delete',
    'client.pricing_override',
    'shipment.created',
    'shipment.submitted',
    'shipment.status_changed',
    'shipment.received',
    'shipment.assigned',
    'shipment.discrepancy_flagged',
    'shipment.dispatched',
    'shipment.completed',
    'service.status_changed',
    'box.created',
    'box.dispatched',
    'box.label_uploaded',
    'invoice.generated',
    'invoice.status_changed',
    'invoice.sent',
    'invoice.marked_paid',
    'invoice.cancelled',
    'product.created',
    'product.updated',
    'product.soft_delete',
    'settings.updated',
    'service_catalog.updated',
  ];
  const actionGroups = [
    { label: 'User Management', values: actions.filter((action) => action.startsWith('user.')) },
    { label: 'Client Management', values: actions.filter((action) => action.startsWith('client.')) },
    { label: 'Shipment Activity', values: actions.filter((action) => action.startsWith('shipment.')) },
    { label: 'Service Execution', values: actions.filter((action) => action.startsWith('service.')) },
    { label: 'Outbound Boxes', values: actions.filter((action) => action.startsWith('box.')) },
    { label: 'Invoice Activity', values: actions.filter((action) => action.startsWith('invoice.')) },
    { label: 'Product Management', values: actions.filter((action) => action.startsWith('product.')) },
    { label: 'System Settings', values: actions.filter((action) => action.startsWith('settings.') || action.startsWith('service_catalog.')) },
  ];
  const entityTypes = ['All', 'client', 'product', 'shipment', 'user', 'invoice', 'box', 'service', 'settings'];

  useEffect(() => {
    const loadUsers = async () => {
      try {
        const response = await fetch(`${API_BASE_URL}/api/users`, {
          method: 'GET',
          headers: buildHeaders(),
        });
        const payload = await parseResponse(response);
        const mappedUsers = extractUsers(payload)
          .map(normalizeUser)
          .filter((user) => user.id);
        setUsers(mappedUsers);
      } catch (requestError) {
        setError(requestError.message);
      }
    };

    loadUsers();
  }, []);

  const loadAuditLogs = async (nextPage = page) => {
    try {
      setIsLoadingLogs(true);
      setError('');
      const query = new URLSearchParams({
        page: String(nextPage),
        limit: String(limit),
      });

      if (userFilter !== 'All') query.set('userId', userFilter);
      if (entityTypeFilter !== 'All') query.set('entityType', entityTypeFilter);
      if (entityIdFilter.trim()) query.set('entityId', entityIdFilter.trim());
      if (actionFilter.trim()) query.set('action', actionFilter.trim());
      if (dateFrom) query.set('from', dateFrom);
      if (dateTo) query.set('to', dateTo);

      const response = await fetch(`${API_BASE_URL}/api/audit-logs?${query.toString()}`, {
        method: 'GET',
        headers: buildHeaders(),
      });
      const payload = await parseResponse(response);
      const auditPayload = extractAuditPayload(payload);
      setLogs(auditPayload.logs.map((log, index) => normalizeAuditLog(log, index, users)));
      setTotalLogs(auditPayload.total);
      setPage(auditPayload.page || nextPage);
      setLimit(auditPayload.limit || limit);
    } catch (requestError) {
      setError(requestError.message);
      setLogs([]);
      setTotalLogs(0);
    } finally {
      setIsLoadingLogs(false);
    }
  };

  useEffect(() => {
    loadAuditLogs(1);
  }, [userFilter, entityTypeFilter, actionFilter, entityIdFilter, dateFrom, dateTo, limit, users]);

  useEffect(() => {
    const selectedUser = users.find((user) => user.id === userFilter);

    if (!selectedUser) {
      setTimeSummary(null);
      return;
    }

    const loadSummary = async () => {
      try {
        setIsLoadingSummary(true);
        setError('');
        const response = await fetch(`${API_BASE_URL}/api/users/${selectedUser.id}/time-summary`, {
          method: 'GET',
          headers: buildHeaders(),
        });
        const payload = await parseResponse(response);
        setTimeSummary(payload?.data || payload?.summary || payload);
      } catch (requestError) {
        setError(requestError.message);
        setTimeSummary(null);
      } finally {
        setIsLoadingSummary(false);
      }
    };

    loadSummary();
  }, [userFilter, users]);

  const filteredLogs = logs.filter((log) => {
    const query = searchTerm.trim().toLowerCase();
    return !query || log.searchable.includes(query);
  });

  const userOptions = useMemo(
    () => [
      { id: 'All', name: 'All Users' },
      ...users,
    ],
    [users]
  );
  const totalPages = Math.max(1, Math.ceil(totalLogs / Math.max(limit, 1)));
  const showingFrom = filteredLogs.length === 0 ? 0 : (page - 1) * limit + 1;
  const showingTo = filteredLogs.length === 0 ? 0 : showingFrom + filteredLogs.length - 1;
  const paginationPages = useMemo(() => {
    const pages = new Set([1, totalPages, page - 1, page, page + 1]);

    return [...pages]
      .filter((pageNumber) => pageNumber >= 1 && pageNumber <= totalPages)
      .sort((firstPage, secondPage) => firstPage - secondPage);
  }, [page, totalPages]);

  const handlePageChange = (nextPage) => {
    const safePage = Math.min(Math.max(nextPage, 1), totalPages);

    if (safePage !== page && !isLoadingLogs) {
      loadAuditLogs(safePage);
    }
  };

  return (
    <Layout>
      <FullPageLoader show={isLoadingLogs || isLoadingSummary} label="Loading audit data..." />
      <div className="min-h-screen min-w-0 overflow-x-hidden bg-gray-50 p-6">
        <div className="mb-6 flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-semibold text-gray-900">
              Audit Log — <span className="text-gray-500">{totalLogs.toLocaleString()} entries</span>
            </h1>
            <p className="mt-1 text-sm text-gray-500">Track all system changes and user activity.</p>
          </div>
        </div>

        {error ? (
          <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            {error}
          </div>
        ) : null}

        {userFilter !== 'All' ? (
          <div className="mb-6 rounded-lg border border-gray-200 bg-white p-4">
            <div className="mb-3 flex items-center gap-2">
              <Clock3 size={16} className="text-[#ff6900]" />
              <h2 className="text-sm font-semibold text-gray-900">Staff Hours Summary</h2>
            </div>
            {isLoadingSummary ? (
              <p className="text-sm text-gray-500">
                <LoadingState label="Loading staff hours summary..." />
              </p>
            ) : timeSummary ? (
              <div className="grid grid-cols-1 gap-4 md:grid-cols-4">
                <div className="rounded-lg border border-gray-200 bg-gray-50 p-4">
                  <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">Today</p>
                  <p className="mt-2 text-lg font-semibold text-gray-900">
                    {formatHours(getSummaryValue(timeSummary, ['todayHours', 'today_hours', 'today']))}
                  </p>
                </div>
                <div className="rounded-lg border border-gray-200 bg-gray-50 p-4">
                  <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">This Week</p>
                  <p className="mt-2 text-lg font-semibold text-gray-900">
                    {formatHours(getSummaryValue(timeSummary, ['weekHours', 'week_hours', 'thisWeekHours', 'this_week_hours']))}
                  </p>
                </div>
                <div className="rounded-lg border border-gray-200 bg-gray-50 p-4">
                  <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">This Month</p>
                  <p className="mt-2 text-lg font-semibold text-gray-900">
                    {formatHours(getSummaryValue(timeSummary, ['monthHours', 'month_hours', 'thisMonthHours', 'this_month_hours']))}
                  </p>
                </div>
                <div className="rounded-lg border border-gray-200 bg-gray-50 p-4">
                  <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">Total Units</p>
                  <p className="mt-2 text-lg font-semibold text-gray-900">
                    {getSummaryValue(timeSummary, ['unitsDone', 'units_done', 'totalUnits', 'total_units']) || 0}
                  </p>
                </div>
              </div>
            ) : (
              <p className="text-sm text-gray-500">No summary found for the selected user.</p>
            )}
          </div>
        ) : null}

        <div className="mb-6 rounded-lg border border-gray-200 bg-white p-4">
          <div className="flex flex-col items-start gap-4 xl:flex-row xl:items-center">
            <div className="relative max-w-md flex-1">
              <Search
                size={16}
                className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400"
              />
              <input
                type="text"
                placeholder="Search entries..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="w-full rounded-lg border border-gray-200 py-2 pl-9 pr-4 text-sm focus:border-transparent focus:outline-none focus:ring-2 focus:ring-[#ff6900]"
              />
            </div>

            <div className="flex flex-wrap items-center gap-3">
              <div className="flex items-center gap-2">
                <Filter size={14} className="text-gray-400" />
                <select
                  value={actionFilter}
                  onChange={(e) => setActionFilter(e.target.value)}
                  className="rounded-lg border border-gray-200 px-3 py-2 text-sm focus:border-transparent focus:outline-none focus:ring-2 focus:ring-[#ff6900]"
                >
                  <option value="">All Actions</option>
                  {actionGroups.map((group) => (
                    <optgroup key={group.label} label={group.label}>
                      {group.values.map((action) => (
                        <option key={action} value={action}>
                          {action}
                        </option>
                      ))}
                    </optgroup>
                  ))}
                </select>
              </div>

              <select
                value={userFilter}
                onChange={(e) => setUserFilter(e.target.value)}
                className="rounded-lg border border-gray-200 px-3 py-2 text-sm focus:border-transparent focus:outline-none focus:ring-2 focus:ring-[#ff6900]"
              >
                {userOptions.map((user) => (
                  <option key={user.id} value={user.id}>
                    {user.name}
                  </option>
                ))}
              </select>

              <button className="flex items-center gap-1.5 rounded-lg border border-gray-200 px-3 py-2 text-sm text-gray-600 hover:bg-gray-50">
                <Calendar size={14} />
                Date Range
                <ChevronDown size={14} />
              </button>
            </div>
          </div>
          <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-[170px_minmax(0,1fr)_150px_150px_110px_auto]">
            <select
              value={entityTypeFilter}
              onChange={(e) => setEntityTypeFilter(e.target.value)}
              className="rounded-lg border border-gray-200 px-3 py-2 text-sm focus:border-transparent focus:outline-none focus:ring-2 focus:ring-[#ff6900]"
            >
              {entityTypes.map((entityType) => (
                <option key={entityType} value={entityType}>
                  {entityType === 'All' ? 'All Entities' : entityType}
                </option>
              ))}
            </select>
            <input
              type="text"
              value={entityIdFilter}
              onChange={(e) => setEntityIdFilter(e.target.value)}
              className="rounded-lg border border-gray-200 px-3 py-2 text-sm focus:border-transparent focus:outline-none focus:ring-2 focus:ring-[#ff6900]"
              placeholder="Entity UUID"
            />
            <input
              type="date"
              value={dateFrom}
              onChange={(e) => setDateFrom(e.target.value)}
              className="rounded-lg border border-gray-200 px-3 py-2 text-sm focus:border-transparent focus:outline-none focus:ring-2 focus:ring-[#ff6900]"
            />
            <input
              type="date"
              value={dateTo}
              onChange={(e) => setDateTo(e.target.value)}
              className="rounded-lg border border-gray-200 px-3 py-2 text-sm focus:border-transparent focus:outline-none focus:ring-2 focus:ring-[#ff6900]"
            />
            <select
              value={limit}
              onChange={(e) => setLimit(Number(e.target.value))}
              className="rounded-lg border border-gray-200 px-3 py-2 text-sm focus:border-transparent focus:outline-none focus:ring-2 focus:ring-[#ff6900]"
            >
              <option value={25}>25</option>
              <option value={50}>50</option>
              <option value={100}>100</option>
            </select>
            <button
              type="button"
              onClick={() => loadAuditLogs(page)}
              className="inline-flex items-center justify-center gap-2 rounded-lg border border-gray-200 bg-white px-4 py-2 text-sm text-gray-700 hover:bg-gray-50"
            >
              <RefreshCw size={15} />
              Refresh
            </button>
          </div>
        </div>

        <div className="min-w-0 overflow-hidden rounded-lg border border-gray-200 bg-white">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[1245px] table-fixed">
              <colgroup>
                <col className="w-[150px]" />
                <col className="w-[160px]" />
                <col className="w-[100px]" />
                <col className="w-[185px]" />
                <col className="w-[120px]" />
                <col className="w-[140px]" />
                <col className="w-[140px]" />
                <col className="w-[140px]" />
                <col className="w-[110px]" />
              </colgroup>
              <thead>
                <tr className="border-b border-gray-200 bg-gray-50">
                  <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-gray-500">Timestamp</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-gray-500">User</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-gray-500">Role</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-gray-500">Action</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-gray-500">Entity</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-gray-500">Entity Ref</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-gray-500">Before</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-gray-500">After</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-gray-500">IP</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {isLoadingLogs ? (
                  <tr>
                    <td colSpan="9" className="px-4 py-10 text-center text-sm text-gray-500">
                      <LoadingState label="Loading audit logs..." />
                    </td>
                  </tr>
                ) : filteredLogs.map((log) => (
                  <tr key={log.id} className="transition-colors hover:bg-gray-50">
                    <td className="px-4 py-3.5">
                      <span className="whitespace-nowrap text-sm text-gray-500">{log.timestamp}</span>
                    </td>
                    <td className="px-4 py-3.5">
                      <span className="block truncate text-sm font-medium text-gray-900" title={log.user}>
                        {log.user}
                      </span>
                    </td>
                    <td className="px-4 py-3.5">
                      <span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-medium ${log.roleColor}`}>
                        {log.role}
                      </span>
                    </td>
                    <td className="px-4 py-3.5">
                      <span
                        className={`inline-flex rounded-full px-2.5 py-1 text-xs font-medium ${log.actionColor}`}
                        title={ACTION_DESCRIPTIONS[log.action] ?? log.action}
                      >
                        {log.action}
                      </span>
                    </td>
                    <td className="px-4 py-3.5">
                      <span className="block break-words font-mono text-xs text-gray-900" title={log.entry}>
                        {log.entry}
                      </span>
                    </td>
                    <td className="px-4 py-3.5">
                      <span
                        className="block truncate font-mono text-xs font-semibold text-gray-800"
                        title={log.entityReference}
                      >
                        {log.entityReference}
                      </span>
                    </td>
                    <td className="px-4 py-3.5">
                      <span className="block max-h-12 overflow-hidden break-words text-sm text-gray-500" title={log.before}>
                        {log.before}
                      </span>
                    </td>
                    <td className="px-4 py-3.5">
                      <span className={`block max-h-12 overflow-hidden break-words text-sm ${log.afterColor}`} title={log.after}>
                        {log.after}
                      </span>
                    </td>
                    <td className="px-4 py-3.5">
                      <span className="block truncate font-mono text-xs text-gray-600" title={log.ip}>
                        {log.ip}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {!isLoadingLogs && filteredLogs.length === 0 ? (
            <div className="py-12 text-center">
              <FileText size={40} className="mx-auto mb-3 text-gray-300" />
              <p className="text-sm text-gray-500">No audit entries found</p>
            </div>
          ) : null}

          <div className="flex flex-col gap-3 border-t border-gray-200 bg-gray-50 px-6 py-3 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-sm text-gray-500">
              Showing <span className="font-medium text-gray-900">{showingFrom}</span> to{' '}
              <span className="font-medium text-gray-900">{showingTo}</span> of{' '}
              <span className="font-medium text-gray-900">{totalLogs}</span> logs
            </p>
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => handlePageChange(page - 1)}
                disabled={page === 1 || isLoadingLogs}
                className="inline-flex h-8 w-8 items-center justify-center rounded border border-gray-200 bg-white text-gray-500 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
                aria-label="Previous page"
              >
                <ChevronLeft size={16} />
              </button>
              {paginationPages.map((pageNumber, index) => {
                const previousPage = paginationPages[index - 1];
                const showGap = previousPage && pageNumber - previousPage > 1;

                return (
                  <React.Fragment key={pageNumber}>
                    {showGap ? <span className="px-1 text-sm text-gray-400">...</span> : null}
                    <button
                      type="button"
                      onClick={() => handlePageChange(pageNumber)}
                      disabled={isLoadingLogs}
                      className={`h-8 min-w-8 rounded px-2 text-sm font-medium ${
                        page === pageNumber
                          ? 'bg-[#ff6900] text-white'
                          : 'border border-gray-200 bg-white text-gray-600 hover:bg-gray-50'
                      } disabled:cursor-not-allowed disabled:opacity-50`}
                    >
                      {pageNumber}
                    </button>
                  </React.Fragment>
                );
              })}
              <button
                type="button"
                onClick={() => handlePageChange(page + 1)}
                disabled={page === totalPages || isLoadingLogs}
                className="inline-flex h-8 w-8 items-center justify-center rounded border border-gray-200 bg-white text-gray-500 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
                aria-label="Next page"
              >
                <ChevronRight size={16} />
              </button>
            </div>
          </div>
        </div>
      </div>
    </Layout>
  );
};

export default AuditLog;
