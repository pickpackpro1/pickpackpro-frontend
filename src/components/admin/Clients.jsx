import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import Layout from './adminlayout/Layout';
import LoadingState from '../common/LoadingState';
import FullPageLoader from '../common/FullPageLoader';
import { getSession } from '../../utils/auth';
import {
  Search,
  Plus,
  X,
  Mail,
  Phone,
  MapPin,
  Package,
  TrendingUp,
  DollarSign,
  Calendar,
  Pencil,
  Trash2,
  RefreshCw,
} from 'lucide-react';

const SETTINGS_ACTIVE_TAB_KEY = 'pickpackpro-settings-active-tab';
const PENDING_USER_EDIT_KEY = 'pending-settings-user-edit';
const API_BASE_URL = '';

const initialClientForm = {
  companyName: '',
  contactName: '',
  contactEmail: '',
  contactPhone: '',
  pricingTier: 'silver',
  billingStreet: '',
  billingCity: '',
  billingPostcode: '',
  billingCountry: 'UK',
  vatRegistered: true,
  vatNumber: '',
  status: 'active',
};

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

const extractClients = (payload) => {
  if (Array.isArray(payload)) {
    return payload;
  }

  if (Array.isArray(payload?.clients)) {
    return payload.clients;
  }

  if (Array.isArray(payload?.data)) {
    return payload.data;
  }

  if (Array.isArray(payload?.results)) {
    return payload.results;
  }

  return [];
};

const mergeClientsById = (clientGroups = []) => {
  const seenClientKeys = new Set();

  return clientGroups.flat().filter((client) => {
    const key =
      client?.id ||
      client?.uuid ||
      client?.clientId ||
      client?.client_id ||
      client?.contactEmail ||
      client?.contact_email ||
      client?.email ||
      '';

    if (!key || seenClientKeys.has(key)) {
      return false;
    }

    seenClientKeys.add(key);
    return true;
  });
};

const getAddressString = (address) =>
  [address?.street, address?.city, address?.postcode, address?.country].filter(Boolean).join(', ');

const getTierStyles = (tier = '') => {
  switch (String(tier).toLowerCase()) {
    case 'silver':
      return 'bg-slate-100 text-slate-700';
    case 'gold':
      return 'bg-yellow-100 text-yellow-700';
    case 'platinum':
      return 'bg-purple-100 text-purple-700';
    default:
      return 'bg-gray-100 text-gray-600';
  }
};

const getStatusStyles = (status = '') =>
  String(status).toLowerCase() === 'active'
    ? 'bg-green-100 text-green-700'
    : 'bg-red-100 text-red-700';

const normalizeClientStatus = (status) =>
  String(status || '').toLowerCase() === 'inactive' ? 'suspended' : status;

const isActiveClientStatus = (status = '') => String(status || '').toLowerCase() === 'active';

const formatDate = (value) => {
  if (!value) {
    return '-';
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return String(value);
  }

  return date.toLocaleDateString('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
};

const getInitials = (value = '') =>
  value
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? '')
    .join('') || 'CL';

const getClientCompanyName = (client) =>
  client?.companyName ||
  client?.company_name ||
  client?.company ||
  client?.clientName ||
  client?.client_name ||
  client?.name ||
  'Unnamed Client';

const normalizeTierValue = (value) => {
  const normalized = String(value || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '_');

  if (!normalized) {
    return 'others';
  }

  if (normalized === 'other') {
    return 'others';
  }

  return normalized;
};

const isKnownTierValue = (value) =>
  ['silver', 'gold', 'platinum', 'others', 'other'].includes(normalizeTierValue(value));

const extractTierFromObject = (value) => {
  if (!value || typeof value !== 'object') {
    return '';
  }

  const directCandidate =
    value?.name ||
    value?.label ||
    value?.tier ||
    value?.value ||
    value?.pricingTier ||
    value?.pricing_tier ||
    value?.pricingTierOverride ||
    value?.pricing_tier_override ||
    '';

  if (directCandidate && isKnownTierValue(directCandidate)) {
    return directCandidate;
  }

  for (const nestedValue of Object.values(value)) {
    if (typeof nestedValue === 'string' && isKnownTierValue(nestedValue)) {
      return nestedValue;
    }

    if (nestedValue && typeof nestedValue === 'object') {
      const nestedTier = extractTierFromObject(nestedValue);

      if (nestedTier) {
        return nestedTier;
      }
    }
  }

  return '';
};

const getPricingTierValue = (client) => {
  const rawTierCandidate =
    client?.pricing_tier_override ||
    client?.pricingTierOverride ||
    client?.tier_override ||
    client?.pricingTier ||
    client?.pricing_tier ||
    client?.tier ||
    client?.clientTier ||
    client?.client_tier ||
    client?.tierName ||
    client?.tier_name ||
    client?.pricingTierName ||
    client?.pricing_tier_name ||
    client?.pricing?.tier ||
    client?.pricing?.tier_override ||
    client?.pricing?.pricing_tier_override ||
    client?.pricing?.name ||
    client?.pricing?.label ||
    client?.pricing?.value ||
    client?.pricing?.pricingTier ||
    client?.pricing?.pricing_tier ||
    client?.settings?.pricingTier ||
    client?.settings?.pricing_tier ||
    client?.settings?.pricing_tier_override ||
    client?.metadata?.pricingTier ||
    client?.metadata?.pricing_tier ||
    client?.metadata?.pricing_tier_override ||
    client?.pricingPlan ||
    client?.pricing_plan ||
    client?.plan ||
    client?.pricing;

  if (typeof rawTierCandidate === 'string' && rawTierCandidate.trim()) {
    return normalizeTierValue(rawTierCandidate);
  }

  if (rawTierCandidate && typeof rawTierCandidate === 'object') {
    const nestedTier = extractTierFromObject(rawTierCandidate);

    if (nestedTier) {
      return normalizeTierValue(nestedTier);
    }
  }

  for (const [key, value] of Object.entries(client || {})) {
    if (!/tier/i.test(key)) {
      continue;
    }

    if (typeof value === 'string' && isKnownTierValue(value)) {
      return normalizeTierValue(value);
    }

    if (value && typeof value === 'object') {
      const nestedTier = extractTierFromObject(value);

      if (nestedTier) {
        return normalizeTierValue(nestedTier);
      }
    }
  }

  return 'others';
};

const getPricingTierLabel = (tier) => {
  const normalized = normalizeTierValue(tier);

  if (normalized === 'others') {
    return 'Others';
  }

  return normalized
    .split('_')
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
};

const normalizeClient = (client) => {
  const shipments = client?.shipments || client?.recentShipments || [];
  const invoices = client?.invoices || [];
  const billingAddress =
    client?.billingAddress || client?.billing_address || client?.address || {};
  const pricingTier = getPricingTierValue(client);
  const status =
    normalizeClientStatus(client?.status) ||
    (client?.isActive === false || client?.is_active === false ? 'suspended' : 'active');

  return {
    id: client?.id || client?.uuid || '',
    company: getClientCompanyName(client),
    initials: getInitials(getClientCompanyName(client)),
    email: client?.contactEmail || client?.contact_email || client?.email || '-',
    phone: client?.contactPhone || client?.contact_phone || client?.phone || '-',
    contactName:
      client?.contactName ||
      client?.contact_name ||
      client?.contact?.name ||
      '-',
    tier: pricingTier,
    tierLabel: getPricingTierLabel(pricingTier),
    tierColor: getTierStyles(pricingTier),
    ships: client?.shipmentCount || shipments.length || 0,
    units:
      client?.totalUnits ||
      shipments.reduce(
        (sum, shipment) =>
          sum +
          Number(
            shipment?.units ||
              shipment?.totalUnits ||
              shipment?.items?.reduce((itemSum, item) => itemSum + Number(item?.expectedQty || 0), 0) ||
              0
          ),
        0
      ),
    revenue:
      client?.revenue ||
      client?.totalRevenue ||
      invoices.reduce((sum, invoice) => sum + Number(invoice?.amount || invoice?.total || 0), 0),
    outstanding:
      client?.outstandingBalance ||
      client?.outstanding_balance ||
      client?.balanceDue ||
      client?.balance_due ||
      client?.outstanding ||
      0,
    status,
    statusColor: getStatusStyles(status),
    address: getAddressString(billingAddress) || '-',
    vatNo: client?.vatNumber || client?.vatNo || '-',
    pricingPlan: pricingTier,
    joinedDate: formatDate(client?.createdAt || client?.created_at),
  };
};

const buildClientPayload = (formData, includeStatus = false, options = {}) => {
  const payload = {
    companyName: formData.companyName.trim(),
    contactName: formData.contactName.trim() || undefined,
    contactEmail: formData.contactEmail.trim() || undefined,
    contactPhone: formData.contactPhone.trim() || undefined,
    pricingTier: formData.pricingTier || undefined,
    billingAddress:
      formData.billingStreet.trim() ||
      formData.billingCity.trim() ||
      formData.billingPostcode.trim() ||
      formData.billingCountry.trim()
        ? {
            street: formData.billingStreet.trim() || undefined,
            city: formData.billingCity.trim() || undefined,
            postcode: formData.billingPostcode.trim() || undefined,
            country: formData.billingCountry.trim() || undefined,
          }
        : undefined,
    vatRegistered: Boolean(formData.vatRegistered),
    vatNumber: formData.vatNumber.trim() || undefined,
  };

  if (includeStatus) {
    payload.status = formData.status;
  }

  if (options.suppressInvite) {
    payload.sendInvite = false;
    payload.send_invite = false;
    payload.inviteUser = false;
    payload.invite_user = false;
    payload.skipInvite = true;
    payload.skip_invite = true;
    payload.suppressInvite = true;
    payload.suppress_invite = true;
    payload.suppressInviteEmail = true;
    payload.suppress_invite_email = true;
  }

  return payload;
};

const mapClientToForm = (client) => {
  const billingAddress =
    client?.billingAddress || client?.billing_address || client?.address || {};

  return {
    companyName: getClientCompanyName(client) === 'Unnamed Client' ? '' : getClientCompanyName(client),
    contactName: client?.contactName || client?.contact_name || '',
    contactEmail: client?.contactEmail || client?.contact_email || '',
    contactPhone: client?.contactPhone || client?.contact_phone || '',
    pricingTier: getPricingTierValue(client) || 'silver',
    billingStreet: billingAddress?.street || '',
    billingCity: billingAddress?.city || '',
    billingPostcode: billingAddress?.postcode || '',
    billingCountry: billingAddress?.country || 'UK',
    vatRegistered: client?.vatRegistered ?? true,
    vatNumber: client?.vatNumber || client?.vat_number || client?.vatNo || '',
    status: normalizeClientStatus(client?.status) || (client?.isActive === false || client?.is_active === false ? 'suspended' : 'active'),
  };
};

const currencyFormatter = new Intl.NumberFormat('en-GB', {
  style: 'currency',
  currency: 'GBP',
  maximumFractionDigits: 0,
});

const Clients = () => {
  const navigate = useNavigate();
  const [clients, setClients] = useState([]);
  const [showAddModal, setShowAddModal] = useState(false);
  const [showViewModal, setShowViewModal] = useState(false);
  const [selectedClient, setSelectedClient] = useState(null);
  const [selectedClientSummary, setSelectedClientSummary] = useState(null);
  const [isDetailLoading, setIsDetailLoading] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [tierFilter, setTierFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState('all');
  const [formData, setFormData] = useState(initialClientForm);
  const [isEditing, setIsEditing] = useState(false);
  const [editingClientId, setEditingClientId] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [currentPage, setCurrentPage] = useState(1);
  const pageSize = 10;

  const loadClients = async () => {
    try {
      setIsLoading(true);
      setError('');

      const buildClientUrl = (isActiveValue) => {
        const query = new URLSearchParams();

        if (tierFilter !== 'all') {
          query.set('tier', tierFilter);
        }

        if (isActiveValue !== null) {
          query.set('isActive', isActiveValue);
        }

        return `${API_BASE_URL}/api/clients${query.toString() ? `?${query.toString()}` : ''}`;
      };

      const activeFilters =
        statusFilter === 'all'
          ? ['true', 'false']
          : [statusFilter === 'active' ? 'true' : 'false'];
      const clientGroups = await Promise.all(
        activeFilters.map(async (isActiveValue) => {
          const response = await fetch(buildClientUrl(isActiveValue), {
            method: 'GET',
            headers: buildHeaders(),
          });
          const payload = await parseResponse(response);
          return extractClients(payload);
        })
      );

      setClients(mergeClientsById(clientGroups).map(normalizeClient));
    } catch (requestError) {
      setError(requestError.message);
      setClients([]);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadClients();
  }, [tierFilter, statusFilter]);

  useEffect(() => {
    const handleOpenCreateClient = (event) => {
      const rawPendingEmail =
        event?.detail?.email || sessionStorage.getItem('pending-client-create-email') || '';
      const pendingEmail =
        typeof rawPendingEmail === 'string' && rawPendingEmail !== '[object Object]'
          ? rawPendingEmail
          : '';
      let pendingInviteForm = null;

      try {
        pendingInviteForm = JSON.parse(
          sessionStorage.getItem(PENDING_USER_EDIT_KEY) || 'null'
        )?.inviteForm || null;
      } catch {
        pendingInviteForm = null;
      }

      if (pendingEmail) {
        sessionStorage.removeItem('pending-client-create-email');
      }

      setError('');
      setMessage('');
      setFormData({
        ...initialClientForm,
        contactName: pendingInviteForm?.fullName || '',
        contactEmail: pendingEmail,
      });
      setEditingClientId('');
      setIsEditing(false);
      setShowAddModal(true);
    };

    window.addEventListener('open-client-create', handleOpenCreateClient);

    if (sessionStorage.getItem('pending-client-create-email')) {
      handleOpenCreateClient();
    }

    return () => {
      window.removeEventListener('open-client-create', handleOpenCreateClient);
    };
  }, []);

  const filteredClients = useMemo(() => {
    const query = searchTerm.trim().toLowerCase();

    return clients.filter((client) => {
      const matchesSearch =
        !query ||
        client.company.toLowerCase().includes(query) ||
        client.email.toLowerCase().includes(query) ||
        client.contactName.toLowerCase().includes(query);
      const matchesStatus =
        statusFilter === 'all' ||
        (statusFilter === 'active'
          ? isActiveClientStatus(client.status)
          : !isActiveClientStatus(client.status));

      return matchesSearch && matchesStatus;
    });
  }, [clients, searchTerm, statusFilter]);

  const totalPages = Math.max(1, Math.ceil(filteredClients.length / pageSize));
  const paginatedClients = useMemo(() => {
    const safePage = Math.min(currentPage, totalPages);
    const startIndex = (safePage - 1) * pageSize;
    return filteredClients.slice(startIndex, startIndex + pageSize);
  }, [currentPage, filteredClients, totalPages]);

  useEffect(() => {
    setCurrentPage(1);
  }, [searchTerm, tierFilter, statusFilter]);

  useEffect(() => {
    if (currentPage > totalPages) {
      setCurrentPage(totalPages);
    }
  }, [currentPage, totalPages]);

  const closeAddModal = () => {
    setShowAddModal(false);
    setEditingClientId('');
    setIsEditing(false);
    setFormData(initialClientForm);
  };

  const handleInputChange = (field, value) => {
    setFormData((prev) => ({
      ...prev,
      [field]: value,
    }));
  };

  const handleAddClient = async () => {
    try {
      if (!formData.companyName.trim()) {
        throw new Error('Company name is required.');
      }

      setIsSaving(true);
      setError('');
      setMessage('');

      const shouldSuppressClientInvite = !isEditing && Boolean(sessionStorage.getItem(PENDING_USER_EDIT_KEY));
      const payload = buildClientPayload(formData, isEditing, {
        suppressInvite: shouldSuppressClientInvite,
      });
      const endpoint = isEditing
        ? `${API_BASE_URL}/api/clients/${editingClientId}`
        : `${API_BASE_URL}/api/clients`;
      const method = isEditing ? 'PATCH' : 'POST';

      const response = await fetch(endpoint, {
        method,
        headers: buildHeaders(true),
        body: JSON.stringify(payload),
      });

      const result = await parseResponse(response);
      const clientData = result?.data || result;

      if (isEditing) {
        setMessage('Client updated successfully.');
      } else if (clientData?.inviteError) {
        setMessage(
          'Client created successfully. However, the invite email failed to send. ' +
            'Go to Settings → Users to manually invite this client.'
        );
      } else if (shouldSuppressClientInvite) {
        setMessage('Client created successfully. Sending user invite from Settings...');
      } else {
        const emailSentTo = formData.contactEmail?.trim();
        setMessage(
          `Client created successfully.${emailSentTo ? ` An invite email has been sent to ${emailSentTo}.` : ''}`
        );
      }

      closeAddModal();

      if (!isEditing && sessionStorage.getItem(PENDING_USER_EDIT_KEY)) {
        localStorage.setItem(SETTINGS_ACTIVE_TAB_KEY, 'users');
        navigate('/settings');
        return;
      }

      await loadClients();
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setIsSaving(false);
    }
  };

  const handleViewClient = async (client) => {
    try {
      setIsDetailLoading(true);
      setError('');
      setSelectedClientSummary(client);
      setShowViewModal(true);

      const response = await fetch(`${API_BASE_URL}/api/clients/${client.id}`, {
        method: 'GET',
        headers: buildHeaders(),
      });
      const payload = await parseResponse(response);
      setSelectedClient(payload?.client || payload?.data || payload);
    } catch (requestError) {
      setError(requestError.message);
      setSelectedClient(null);
    } finally {
      setIsDetailLoading(false);
    }
  };

  const handleEditClient = () => {
    const mergedClient = {
      ...(selectedClientSummary || {}),
      ...(selectedClient || {}),
      companyName:
        selectedClient?.companyName ||
        selectedClientSummary?.companyName ||
        selectedClientSummary?.company ||
        selectedClient?.company,
      contactName:
        selectedClient?.contactName ||
        selectedClient?.contact_name ||
        selectedClientSummary?.contactName,
      contactEmail:
        selectedClient?.contactEmail ||
        selectedClient?.contact_email ||
        selectedClientSummary?.email ||
        selectedClientSummary?.contactEmail,
      contactPhone:
        selectedClient?.contactPhone ||
        selectedClient?.contact_phone ||
        selectedClientSummary?.phone ||
        selectedClientSummary?.contactPhone,
      vatNumber:
        selectedClient?.vatNumber ||
        selectedClient?.vat_number ||
        selectedClientSummary?.vatNo ||
        selectedClientSummary?.vatNumber,
      pricing_tier_override:
        selectedClient?.pricing_tier_override ||
        selectedClientSummary?.tier ||
        selectedClientSummary?.pricingPlan,
    };

    setFormData(mapClientToForm(mergedClient));
    setEditingClientId(mergedClient?.id || selectedClientSummary?.id || '');
    setIsEditing(true);
    setShowViewModal(false);
    setShowAddModal(true);
  };

  const handleDeleteClient = async () => {
    const clientId = selectedClient?.id || selectedClientSummary?.id;

    if (!clientId) {
      return;
    }

    try {
      setIsDeleting(true);
      setError('');
      setMessage('');

      const response = await fetch(`${API_BASE_URL}/api/clients/${clientId}`, {
        method: 'DELETE',
        headers: buildHeaders(),
      });

      await parseResponse(response);
      setMessage('Client deleted successfully.');
      setShowViewModal(false);
      setSelectedClient(null);
      setSelectedClientSummary(null);
      await loadClients();
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setIsDeleting(false);
    }
  };

  const detailClient = selectedClient || selectedClientSummary;
  const detailShipments = selectedClient?.shipments || [];
  const detailInvoices = selectedClient?.invoices || [];
  const detailUsers = selectedClient?.users || [];
  const detailRevenue = detailInvoices.reduce(
    (sum, invoice) => sum + Number(invoice?.amount || invoice?.total || 0),
    0
  );
  const detailTierValue = getPricingTierValue(selectedClient || detailClient || {});
  const detailTierLabel = getPricingTierLabel(detailTierValue);
  const detailTierColor = getTierStyles(detailTierValue);
  const detailCompanyName =
    getClientCompanyName(selectedClient) ||
    getClientCompanyName(selectedClientSummary) ||
    detailClient?.company ||
    detailClient?.companyName ||
    detailClient?.company_name ||
    'Client';
  const detailEmail =
    detailClient?.email ||
    detailClient?.contactEmail ||
    detailClient?.contact_email ||
    selectedClient?.email ||
    selectedClient?.contactEmail ||
    selectedClient?.contact_email ||
    selectedClientSummary?.email ||
    selectedClientSummary?.contactEmail ||
    selectedClientSummary?.contact_email ||
    '-';
  const detailPhone =
    detailClient?.phone ||
    detailClient?.contactPhone ||
    detailClient?.contact_phone ||
    selectedClient?.phone ||
    selectedClient?.contactPhone ||
    selectedClient?.contact_phone ||
    selectedClientSummary?.phone ||
    selectedClientSummary?.contactPhone ||
    selectedClientSummary?.contact_phone ||
    '-';
  const detailAddress =
    getAddressString(
      detailClient?.billingAddress ||
        detailClient?.billing_address ||
        detailClient?.address ||
        selectedClient?.billingAddress ||
        selectedClient?.billing_address ||
        selectedClient?.address ||
        selectedClientSummary?.billingAddress ||
        selectedClientSummary?.billing_address ||
        selectedClientSummary?.address
    ) || '-';
  const detailJoined =
    formatDate(
      detailClient?.createdAt ||
        detailClient?.created_at ||
        selectedClient?.createdAt ||
        selectedClient?.created_at ||
        selectedClientSummary?.createdAt ||
        selectedClientSummary?.created_at
    ) ||
    detailClient?.joinedDate ||
    '-';
  const detailContactName =
    detailClient?.contactName ||
    detailClient?.contact_name ||
    selectedClient?.contactName ||
    selectedClient?.contact_name ||
    selectedClientSummary?.contactName ||
    selectedClientSummary?.contact_name ||
    '-';
  const detailVatNumber =
    detailClient?.vatNumber ||
    detailClient?.vat_number ||
    detailClient?.vatNo ||
    selectedClient?.vatNumber ||
    selectedClient?.vat_number ||
    selectedClient?.vatNo ||
    selectedClientSummary?.vatNumber ||
    selectedClientSummary?.vat_number ||
    selectedClientSummary?.vatNo ||
    '-';

  return (
    <Layout>
      <FullPageLoader show={isLoading || isDetailLoading} label="Loading client data..." />
      <div className="p-6 bg-gray-50 min-h-screen">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-semibold text-gray-900">Client Directory</h1>

          </div>
          <button
            onClick={() => {
              setFormData(initialClientForm);
              setIsEditing(false);
              setEditingClientId('');
              setShowAddModal(true);
            }}
            className="flex items-center gap-2 px-4 py-2 bg-[#ff6900] text-white rounded-lg text-sm font-medium hover:bg-[#e55d00] transition-colors"
          >
            <Plus size={16} />
            Add Client
          </button>
        </div>

        {message ? <p className="mb-4 rounded-lg border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-700">{message}</p> : null}
        {error ? <p className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p> : null}

        <div className="bg-white rounded-lg border border-gray-200 p-4 mb-6">
          <div className="flex flex-wrap items-center gap-3">
            <div className="relative max-w-md flex-1 min-w-[220px]">
              <Search
                size={16}
                className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400"
              />
              <input
                type="text"
                placeholder="Search clients..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="pl-9 pr-4 py-2 w-full border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#ff6900] focus:border-transparent"
              />
            </div>
            <select
              value={tierFilter}
              onChange={(e) => setTierFilter(e.target.value)}
              className="rounded-lg border border-gray-200 px-3 py-2 text-sm text-gray-700"
            >
              <option value="all">All tiers</option>
              <option value="silver">Silver</option>
              <option value="gold">Gold</option>
              <option value="platinum">Platinum</option>
              <option value="others">Others</option>
            </select>
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="rounded-lg border border-gray-200 px-3 py-2 text-sm text-gray-700"
            >
              <option value="active">Active</option>
              <option value="inactive">Suspended</option>
              <option value="all">All statuses</option>
            </select>
            <button
              onClick={loadClients}
              className="inline-flex items-center gap-2 rounded-lg border border-gray-200 bg-white px-4 py-2 text-sm text-gray-700 hover:bg-gray-50"
            >
              <RefreshCw size={14} />
              Refresh
            </button>
          </div>
        </div>

        <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-gray-200 bg-gray-50">
                  <th className="text-left py-3 px-6 text-xs font-semibold text-gray-500 uppercase tracking-wider">Company</th>
                  <th className="text-left py-3 px-6 text-xs font-semibold text-gray-500 uppercase tracking-wider">Contact</th>
                  <th className="text-left py-3 px-6 text-xs font-semibold text-gray-500 uppercase tracking-wider">Email</th>
                  <th className="text-left py-3 px-6 text-xs font-semibold text-gray-500 uppercase tracking-wider">Tier</th>
                  <th className="text-left py-3 px-6 text-xs font-semibold text-gray-500 uppercase tracking-wider">Shipments</th>
                  <th className="text-left py-3 px-6 text-xs font-semibold text-gray-500 uppercase tracking-wider">Outstanding</th>
                  <th className="text-left py-3 px-6 text-xs font-semibold text-gray-500 uppercase tracking-wider">Status</th>
                  <th className="text-center py-3 px-6 text-xs font-semibold text-gray-500 uppercase tracking-wider">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {isLoading ? (
                  <tr>
                    <td colSpan="8" className="px-6 py-12 text-center text-sm text-gray-500">
                      <LoadingState label="Loading clients..." />
                    </td>
                  </tr>
                ) : paginatedClients.map((client) => (
                  <tr key={client.id} className="hover:bg-gray-50 transition-colors">
                    <td className="py-3.5 px-6">
                      <div className="flex items-center gap-3">
                        <div className="flex h-8 w-8 items-center justify-center rounded-md bg-orange-50 text-[11px] font-semibold text-[#ff6900]">
                          {client.initials}
                        </div>
                        <span className="text-sm font-medium text-gray-900">{client.company}</span>
                      </div>
                    </td>
                    <td className="py-3.5 px-6 text-sm text-gray-700">{client.contactName}</td>
                    <td className="py-3.5 px-6 text-sm text-gray-500">{client.email}</td>
                    <td className="py-3.5 px-6">
                      <span className={`inline-flex px-2.5 py-1 rounded-full text-xs font-medium ${client.tierColor}`}>
                        {client.tierLabel}
                      </span>
                    </td>
                    <td className="py-3.5 px-6 text-sm text-gray-700">{client.ships}</td>
                    <td className="py-3.5 px-6 text-sm font-medium text-gray-900">
                      {currencyFormatter.format(Number(client.outstanding || 0))}
                    </td>
                    <td className="py-3.5 px-6">
                      <span className="inline-flex items-center gap-2 text-sm text-gray-700">
                        <span
                          className={`h-2 w-2 rounded-full ${
                            String(client.status).toLowerCase() === 'active' ? 'bg-green-500' : 'bg-red-500'
                          }`}
                        />
                        {client.status}
                      </span>
                    </td>
                    <td className="py-3.5 px-6 text-center">
                      <button
                        onClick={() => handleViewClient(client)}
                        className="text-sm font-medium text-[#ff6900] transition-colors hover:text-[#e55d00]"
                        title="View Client Details"
                      >
                        View
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {!isLoading && filteredClients.length === 0 ? (
            <div className="text-center py-12">
              <p className="text-sm text-gray-500">No clients found</p>
            </div>
          ) : !isLoading ? (
            <div className="flex items-center justify-between border-t border-gray-200 px-6 py-4 text-sm">
              <p className="text-gray-500">
                Showing {filteredClients.length ? (currentPage - 1) * pageSize + 1 : 0} to{' '}
                {Math.min(currentPage * pageSize, filteredClients.length)} of {filteredClients.length} clients
              </p>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setCurrentPage((page) => Math.max(1, page - 1))}
                  disabled={currentPage === 1}
                  className="rounded border border-gray-200 px-3 py-1.5 text-xs text-gray-500 disabled:cursor-not-allowed disabled:opacity-50 hover:bg-gray-50"
                >
                  Previous
                </button>
                {Array.from({ length: totalPages }, (_, index) => index + 1)
                  .slice(Math.max(0, currentPage - 2), Math.max(3, Math.min(totalPages, currentPage + 1)))
                  .map((pageNumber) => (
                    <button
                      key={pageNumber}
                      onClick={() => setCurrentPage(pageNumber)}
                      className={`h-7 min-w-7 rounded px-2 text-xs font-medium ${
                        currentPage === pageNumber
                          ? 'bg-[#ff6900] text-white'
                          : 'border border-gray-200 text-gray-600 hover:bg-gray-50'
                      }`}
                    >
                      {pageNumber}
                    </button>
                  ))}
                <button
                  onClick={() => setCurrentPage((page) => Math.min(totalPages, page + 1))}
                  disabled={currentPage === totalPages}
                  className="rounded border border-gray-200 px-3 py-1.5 text-xs text-gray-500 disabled:cursor-not-allowed disabled:opacity-50 hover:bg-gray-50"
                >
                  Next
                </button>
              </div>
            </div>
          ) : null}
        </div>

        {showAddModal ? (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
            <div className="bg-white rounded-xl shadow-xl w-full max-w-3xl">
              <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200">
                <h2 className="text-lg font-semibold text-gray-900">
                  {isEditing ? 'Update Client' : 'Add New Client'}
                </h2>
                <button
                  onClick={closeAddModal}
                  className="p-1 rounded-lg hover:bg-gray-100 text-gray-400 hover:text-gray-600"
                >
                  <X size={20} />
                </button>
              </div>

              <div className="px-6 py-5">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-medium text-gray-700 mb-1">
                      Company Name <span className="text-red-500">*</span>
                    </label>
                    <input
                      type="text"
                      value={formData.companyName}
                      onChange={(e) => handleInputChange('companyName', e.target.value)}
                      className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#ff6900] focus:border-transparent"
                      placeholder="Test Seller Ltd"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-medium text-gray-700 mb-1">Contact Name</label>
                    <input
                      type="text"
                      value={formData.contactName}
                      onChange={(e) => handleInputChange('contactName', e.target.value)}
                      className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#ff6900] focus:border-transparent"
                      placeholder="John Doe"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-medium text-gray-700 mb-1">Contact Email</label>
                    <input
                      type="email"
                      value={formData.contactEmail}
                      onChange={(e) => handleInputChange('contactEmail', e.target.value)}
                      className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#ff6900] focus:border-transparent"
                      placeholder="john@testseller.com"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-medium text-gray-700 mb-1">Contact Phone</label>
                    <input
                      type="text"
                      value={formData.contactPhone}
                      onChange={(e) => handleInputChange('contactPhone', e.target.value)}
                      className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#ff6900] focus:border-transparent"
                      placeholder="+44 7700 900000"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-medium text-gray-700 mb-1">Pricing Tier</label>
                    <select
                      value={formData.pricingTier}
                      onChange={(e) => handleInputChange('pricingTier', e.target.value)}
                      className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#ff6900] focus:border-transparent bg-white"
                    >
                      <option value="silver">Silver</option>
                      <option value="gold">Gold</option>
                      <option value="platinum">Platinum</option>
                      <option value="others">Others</option>
                    </select>
                  </div>

                  <div>
                    <label className="block text-xs font-medium text-gray-700 mb-1">VAT Number</label>
                    <input
                      type="text"
                      value={formData.vatNumber}
                      onChange={(e) => handleInputChange('vatNumber', e.target.value)}
                      className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#ff6900] focus:border-transparent"
                      placeholder="GB123456789"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-medium text-gray-700 mb-1">Street</label>
                    <input
                      type="text"
                      value={formData.billingStreet}
                      onChange={(e) => handleInputChange('billingStreet', e.target.value)}
                      className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#ff6900] focus:border-transparent"
                      placeholder="1 Test Street"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-medium text-gray-700 mb-1">City</label>
                    <input
                      type="text"
                      value={formData.billingCity}
                      onChange={(e) => handleInputChange('billingCity', e.target.value)}
                      className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#ff6900] focus:border-transparent"
                      placeholder="London"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-medium text-gray-700 mb-1">Postcode</label>
                    <input
                      type="text"
                      value={formData.billingPostcode}
                      onChange={(e) => handleInputChange('billingPostcode', e.target.value)}
                      className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#ff6900] focus:border-transparent"
                      placeholder="E1 1AA"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-medium text-gray-700 mb-1">Country</label>
                    <input
                      type="text"
                      value={formData.billingCountry}
                      onChange={(e) => handleInputChange('billingCountry', e.target.value)}
                      className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#ff6900] focus:border-transparent"
                      placeholder="UK"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-medium text-gray-700 mb-1">VAT Registered</label>
                    <select
                      value={String(formData.vatRegistered)}
                      onChange={(e) => handleInputChange('vatRegistered', e.target.value === 'true')}
                      className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#ff6900] focus:border-transparent bg-white"
                    >
                      <option value="true">Yes</option>
                      <option value="false">No</option>
                    </select>
                  </div>

                  {isEditing ? (
                    <div>
                      <label className="block text-xs font-medium text-gray-700 mb-1">Status</label>
                      <select
                        value={formData.status}
                        onChange={(e) => handleInputChange('status', e.target.value)}
                        className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#ff6900] focus:border-transparent bg-white"
                      >
                        <option value="active">active</option>
                        <option value="suspended">suspended</option>
                      </select>
                    </div>
                  ) : null}
                </div>
              </div>

              <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-gray-200 bg-gray-50 rounded-b-xl">
                <button
                  onClick={closeAddModal}
                  className="px-4 py-2 border border-gray-300 text-gray-700 rounded-lg text-sm font-medium hover:bg-gray-100 transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={handleAddClient}
                  disabled={isSaving}
                  className="px-4 py-2 bg-[#ff6900] text-white rounded-lg text-sm font-medium hover:bg-[#e55d00] transition-colors disabled:opacity-60"
                >
                  {isSaving ? 'Saving...' : isEditing ? 'Update Client' : 'Add Client'}
                </button>
              </div>
            </div>
          </div>
        ) : null}

        {showViewModal && detailClient ? (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
            <div className="bg-white rounded-xl shadow-xl w-full max-w-3xl max-h-[82vh] overflow-hidden">
              <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 bg-gradient-to-br from-orange-400 to-orange-600 rounded-lg flex items-center justify-center text-white font-bold text-sm">
                    {getInitials(detailCompanyName)}
                  </div>
                  <div>
                    <h2 className="text-lg font-semibold text-gray-900">{detailCompanyName}</h2>
                    <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${detailClient.statusColor || getStatusStyles(detailClient.status)}`}>
                      {detailClient.status}
                    </span>
                  </div>
                </div>
                <button
                  onClick={() => {
                    setShowViewModal(false);
                    setSelectedClient(null);
                    setSelectedClientSummary(null);
                  }}
                  className="p-1 rounded-lg hover:bg-gray-100 text-gray-400 hover:text-gray-600"
                >
                  <X size={20} />
                </button>
              </div>

              <div className="max-h-[calc(82vh-140px)] overflow-y-auto p-6">
                {isDetailLoading ? (
                  <div className="py-16 text-center text-sm text-gray-500">
                    <LoadingState label="Loading client details..." size="lg" />
                  </div>
                ) : (
                  <>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
                      <div className="flex items-center gap-3">
                        <Mail size={16} className="text-gray-400" />
                        <div>
                          <p className="text-xs text-gray-500">Email</p>
                          <p className="text-sm font-medium text-gray-900">{detailEmail}</p>
                        </div>
                      </div>
                      <div className="flex items-center gap-3">
                        <Phone size={16} className="text-gray-400" />
                        <div>
                          <p className="text-xs text-gray-500">Phone</p>
                          <p className="text-sm font-medium text-gray-900">{detailPhone}</p>
                        </div>
                      </div>
                      <div className="flex items-center gap-3">
                        <MapPin size={16} className="text-gray-400" />
                        <div>
                          <p className="text-xs text-gray-500">Address</p>
                          <p className="text-sm font-medium text-gray-900">{detailAddress}</p>
                        </div>
                      </div>
                      <div className="flex items-center gap-3">
                        <Calendar size={16} className="text-gray-400" />
                        <div>
                          <p className="text-xs text-gray-500">Joined</p>
                          <p className="text-sm font-medium text-gray-900">{detailJoined}</p>
                        </div>
                      </div>
                    </div>

                    <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
                      <div className="bg-orange-50 rounded-lg p-3 text-center">
                        <Package size={18} className="mx-auto text-[#ff6900] mb-1" />
                        <p className="text-lg font-bold text-gray-900">{detailShipments.length || detailClient.ships}</p>
                        <p className="text-xs text-gray-500">Shipments</p>
                      </div>
                      <div className="bg-blue-50 rounded-lg p-3 text-center">
                        <TrendingUp size={18} className="mx-auto text-blue-600 mb-1" />
                        <p className="text-lg font-bold text-gray-900">
                          {Number(detailClient.units || 0).toLocaleString()}
                        </p>
                        <p className="text-xs text-gray-500">Units</p>
                      </div>
                      <div className="bg-green-50 rounded-lg p-3 text-center">
                        <DollarSign size={18} className="mx-auto text-green-600 mb-1" />
                        <p className="text-lg font-bold text-gray-900">
                          {currencyFormatter.format(detailRevenue || Number(detailClient.revenue || 0))}
                        </p>
                        <p className="text-xs text-gray-500">Revenue</p>
                      </div>
                      <div className="bg-purple-50 rounded-lg p-3 text-center">
                        <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${detailTierColor}`}>
                          {detailTierLabel}
                        </span>
                        <p className="text-xs text-gray-500 mt-1">Tier</p>
                      </div>
                    </div>

                    <div className="mb-6 grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div className="rounded-lg border border-gray-200 p-4">
                        <p className="text-xs text-gray-500">Contact Name</p>
                        <p className="mt-1 text-sm font-medium text-gray-900">{detailContactName}</p>
                      </div>
                      <div className="rounded-lg border border-gray-200 p-4">
                        <p className="text-xs text-gray-500">VAT Number</p>
                        <p className="mt-1 text-sm font-medium text-gray-900">{detailVatNumber}</p>
                      </div>
                    
                      <div className="rounded-lg border border-gray-200 p-4">
                        <p className="text-xs text-gray-500">Invoices</p>
                        <p className="mt-1 text-sm font-medium text-gray-900">{detailInvoices.length}</p>
                      </div>
                    </div>

                    {detailShipments.length ? (
                      <div>
                        <h3 className="text-sm font-semibold text-gray-900 mb-3">Recent Shipments</h3>
                        <div className="border border-gray-200 rounded-lg overflow-hidden">
                          <table className="w-full">
                            <thead>
                              <tr className="bg-gray-50 border-b border-gray-200">
                                <th className="text-left py-2 px-4 text-xs font-semibold text-gray-500">Reference</th>
                                <th className="text-left py-2 px-4 text-xs font-semibold text-gray-500">Date</th>
                                <th className="text-left py-2 px-4 text-xs font-semibold text-gray-500">Units</th>
                                <th className="text-left py-2 px-4 text-xs font-semibold text-gray-500">Status</th>
                              </tr>
                            </thead>
                            <tbody>
                              {detailShipments.slice(0, 5).map((shipment, index) => (
                                <tr key={shipment?.id || shipment?.uuid || index} className="border-b border-gray-100 last:border-0">
                                  <td className="py-2 px-4 text-sm font-medium text-gray-900">
                                    {shipment?.reference || shipment?.shipmentNumber || shipment?.id || '-'}
                                  </td>
                                  <td className="py-2 px-4 text-sm text-gray-500">
                                    {formatDate(shipment?.expectedArrivalDate || shipment?.createdAt)}
                                  </td>
                                  <td className="py-2 px-4 text-sm text-gray-700">
                                    {shipment?.units || shipment?.totalUnits || 0}
                                  </td>
                                  <td className="py-2 px-4">
                                    <span className="inline-flex px-2 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-700">
                                      {shipment?.status || 'draft'}
                                    </span>
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    ) : (
                      <div className="text-center py-8">
                        <Package size={32} className="mx-auto text-gray-300 mb-2" />
                        <p className="text-sm text-gray-500">No recent shipments</p>
                      </div>
                    )}
                  </>
                )}
              </div>

              <div className="flex items-center justify-between gap-3 px-6 py-4 border-t border-gray-200 bg-gray-50 rounded-b-xl">
                <div className="flex items-center gap-3">
                  <button
                    onClick={handleEditClient}
                    className="inline-flex items-center gap-2 px-4 py-2 border border-gray-300 text-gray-700 rounded-lg text-sm font-medium hover:bg-gray-100 transition-colors"
                  >
                    <Pencil size={14} />
                    Edit
                  </button>
                  <button
                    onClick={handleDeleteClient}
                    disabled={isDeleting}
                    className="inline-flex items-center gap-2 px-4 py-2 border border-red-200 text-red-600 rounded-lg text-sm font-medium hover:bg-red-50 transition-colors disabled:opacity-60"
                  >
                    <Trash2 size={14} />
                    {isDeleting ? 'Deleting...' : 'Delete'}
                  </button>
                </div>
                <button
                  onClick={() => {
                    setShowViewModal(false);
                    setSelectedClient(null);
                    setSelectedClientSummary(null);
                  }}
                  className="px-4 py-2 border border-gray-300 text-gray-700 rounded-lg text-sm font-medium hover:bg-gray-100 transition-colors"
                >
                  Close
                </button>
              </div>
            </div>
          </div>
        ) : null}
      </div>
    </Layout>
  );
};

export default Clients;
