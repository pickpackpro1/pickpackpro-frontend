import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import Layout from './adminlayout/Layout';
import LoadingState from '../common/LoadingState';
import FullPageLoader from '../common/FullPageLoader';
import { getSession } from '../../utils/auth';
import {
  Building2,
  Users,
  Tag,
  Bell,
  Plus,
  X,
  Edit3,
  RefreshCw,
  Save,
  Search,
  Info,
  Check,
  ChevronDown,
} from 'lucide-react';
import {
  SERVICE_SELECT_OPTIONS,
  getServiceDisplayName,
  getServiceKey,
  normalizeServiceCode,
} from '../../utils/serviceCatalog';

const SETTINGS_ACTIVE_TAB_KEY = 'pickpackpro-settings-active-tab';
const PENDING_USER_EDIT_KEY = 'pending-settings-user-edit';
const API_BASE_URL = '';
const SETTINGS_TAB_IDS = ['general', 'users', 'pricing', 'notifications'];

const getInitialSettingsTab = () => {
  const savedTab = localStorage.getItem(SETTINGS_ACTIVE_TAB_KEY);

  return SETTINGS_TAB_IDS.includes(savedTab) ? savedTab : 'general';
};

const notificationTriggers = [
  {
    id: 1,
    label: 'Client submits shipment',
    recipient: 'Warehouse Manager',
    emailEnabled: true,
    inAppEnabled: true,
  },
  {
    id: 2,
    label: 'Shipment received (no discrepancy)',
    recipient: 'Customer, Logistics Lead',
    emailEnabled: true,
    inAppEnabled: true,
  },
  {
    id: 3,
    label: 'Shipment received with discrepancy',
    recipient: 'Warehouse Manager, Support',
    emailEnabled: true,
    inAppEnabled: true,
  },
  {
    id: 4,
    label: 'FBA label uploaded by client',
    recipient: 'Floor Supervisor',
    emailEnabled: true,
    inAppEnabled: false,
  },
  {
    id: 5,
    label: 'Shipment dispatched',
    recipient: 'Customer',
    emailEnabled: true,
    inAppEnabled: true,
  },
  {
    id: 6,
    label: 'Invoice sent',
    recipient: 'Customer Billing',
    emailEnabled: true,
    inAppEnabled: false,
  },
  {
    id: 7,
    label: 'Invoice overdue reminder',
    recipient: 'Customer Billing, Finance Manager',
    emailEnabled: true,
    inAppEnabled: true,
  },
];

const initialInviteForm = {
  fullName: '',
  email: '',
  clientEmail: '',
  role: 'staff',
  clientId: '',
  active: true,
};

const initialCompanyDetails = {
  companyName: '',
  vatNumber: '',
  companyAddress: '',
  invoicePaymentTermsDays: '',
  bankName: '',
  sortCode: '',
  accountNumber: '',
};

const initialEmailConfig = {
  fromName: '',
  fromEmail: '',
  replyToEmail: '',
  resendApiKey: '',
};

const initialPricingTiers = {
  silver: { minUnits: '0', invoiceMin: '0' },
  gold: { minUnits: '0', invoiceMin: '0' },
  platinum: { minUnits: '0', invoiceMin: '' },
};

const defaultServiceTypeOptions = SERVICE_SELECT_OPTIONS.filter((option) => option.value !== 'OTHER');

const initialWorkingDays = {
  monday: true,
  tuesday: true,
  wednesday: true,
  thursday: true,
  friday: true,
  saturday: false,
  sunday: false,
};

const roleStyles = {
  admin: 'bg-orange-100 text-orange-700',
  staff: 'bg-blue-100 text-blue-700',
  client: 'bg-purple-100 text-purple-700',
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
    const message =
      getErrorText(payload?.message) ||
        getErrorText(payload?.error) ||
        getErrorText(payload?.details) ||
        getErrorText(payload?.errors) ||
        getErrorText(payload?.issues) ||
        (typeof payload === 'string' ? payload : '') ||
        `Request failed with status ${response.status}`;

    const error = new Error(message);
    error.status = response.status;
    error.payload = payload;
    throw error;
  }

  return payload;
};

const extractUsers = (payload) => {
  if (Array.isArray(payload)) {
    return payload;
  }

  if (Array.isArray(payload?.users)) {
    return payload.users;
  }

  if (Array.isArray(payload?.data)) {
    return payload.data;
  }

  if (Array.isArray(payload?.results)) {
    return payload.results;
  }

  return [];
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

const normalizeEmail = (value = '') => String(value || '').trim().toLowerCase();

const isValidEmail = (value = '') => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value).trim());

const getErrorText = (value) => {
  if (!value) return '';
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) return value.map(getErrorText).filter(Boolean).join(', ');
  if (typeof value === 'object') return Object.values(value).map(getErrorText).filter(Boolean).join(', ');
  return String(value);
};

const getUserIdentityId = (user = {}) =>
  String(
    user?.id ||
      user?.uuid ||
      user?.userId ||
      user?.user_id ||
      user?.rawUser?.id ||
      user?.rawUser?.uuid ||
      user?.rawUser?.userId ||
      user?.rawUser?.user_id ||
      ''
  ).trim();

const getUserIdentityEmail = (user = {}) =>
  normalizeEmail(user?.email || user?.rawUser?.email || '');

const isSameUserIdentity = (leftUser = {}, rightUser = {}) => {
  const leftId = getUserIdentityId(leftUser);
  const rightId = getUserIdentityId(rightUser);

  if (leftId && rightId) {
    return leftId === rightId;
  }

  const leftEmail = getUserIdentityEmail(leftUser);
  const rightEmail = getUserIdentityEmail(rightUser);

  return Boolean(leftEmail && rightEmail && leftEmail === rightEmail);
};

const isExistingInviteMessage = (message = '') =>
  /already\s+exists|already\s+registered|user\s+exists/i.test(String(message));

const getClientEmail = (client) =>
  client?.contactEmail ||
  client?.contact_email ||
  client?.email ||
  client?.contact?.email ||
  '';

const getClientId = (client) =>
  client?.id || client?.uuid || client?.clientId || client?.client_id || '';

const getClientName = (client = {}) =>
  client?.companyName ||
  client?.company_name ||
  client?.company ||
  client?.businessName ||
  client?.business_name ||
  client?.name ||
  client?.contactName ||
  client?.contact_name ||
  '';

const getClientDisplayLabel = (client = {}) => {
  const name = String(getClientName(client) || '').trim();
  const email = String(getClientEmail(client) || '').trim();
  const id = String(getClientId(client) || '').trim();

  if (name && email) return `${name} - ${email}`;
  return name || email || id || 'Unnamed Client';
};

const getServiceTypeValue = (service) =>
  normalizeServiceCode(
    typeof service === 'string'
      ? service.trim()
      : String(
          service?.serviceType ||
            service?.service_type ||
            service?.type ||
            service?.code ||
            service?.value ||
            service?.id ||
            service?.name ||
            service?.label ||
            ''
        ).trim()
  );

const formatServiceTypeLabel = (value) => getServiceDisplayName(value);

const formatPricePerUnit = (value) => {
  const amount = Number(value);

  if (!Number.isFinite(amount)) {
    return '-';
  }

  return new Intl.NumberFormat('en-GB', {
    style: 'currency',
    currency: 'GBP',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount);
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

const firstFilledValue = (...values) => {
  const value = values.find((item) => item !== undefined && item !== null && item !== '');
  return value === undefined || value === null ? '' : value;
};

const toObjectValue = (value) => {
  const parsed = parseJsonValue(value, {});
  return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
};

const extractPricingCatalog = (payload) => {
  const source =
    payload?.service_catalog ||
    payload?.serviceCatalog ||
    payload?.services ||
    payload?.catalog ||
    payload?.rows ||
    payload?.data?.service_catalog ||
    payload?.data?.serviceCatalog ||
    payload?.data?.services ||
    payload?.data?.catalog ||
    payload?.data?.rows ||
    payload?.data ||
    payload;

  if (Array.isArray(source)) {
    return source;
  }

  if (!source || typeof source !== 'object') {
    return [];
  }

  return Object.entries(source).map(([key, value]) => {
    const serviceType = normalizeServiceCode(
      value?.serviceType ||
        value?.service_type ||
        value?.type ||
        value?.code ||
        value?.value ||
        key
    );

    if (value && typeof value === 'object') {
      return {
        ...value,
        serviceType,
        label:
          value.label ||
          value.name ||
          value.serviceName ||
          value.service_name ||
          formatServiceTypeLabel(serviceType),
      };
    }

    return {
      serviceType,
      label: typeof value === 'string' ? value : formatServiceTypeLabel(serviceType),
    };
  });
};

const extractPricingClientPrices = (payload) => {
  const source =
    payload?.clientPrices ||
    payload?.client_prices ||
    payload?.client_price_lists ||
    payload?.prices ||
    payload?.data?.clientPrices ||
    payload?.data?.client_prices ||
    payload?.data?.client_price_lists ||
    payload?.data?.prices ||
    [];

  return Array.isArray(source) ? source : [];
};

const getPricingServiceValue = (price = {}) =>
  normalizeServiceCode(
    String(
      price?.serviceType ||
        price?.service_type ||
        price?.serviceCode ||
        price?.service_code ||
        price?.service?.code ||
        price?.service?.serviceType ||
        price?.service?.service_type ||
        price?.code ||
        price?.type ||
        ''
    ).trim()
  );

const getPricingTierValue = (price = {}) =>
  String(price?.tier || price?.pricingTier || price?.pricing_tier || '').trim();

const getPricingAmountValue = (price = {}) =>
  price?.pricePerUnit ??
  price?.price_per_unit ??
  price?.rate ??
  price?.unitRate ??
  price?.unit_rate ??
  price?.price ??
  '';

const getPricingNotes = (price = {}) =>
  price?.notes || price?.description || price?.reason || '';

const getPricingClientId = (price = {}) =>
  price?.clientId || price?.client_id || price?.client?.id || price?.client?.uuid || '';

const toDisplayRole = (role = '') => {
  const normalizedRole = String(role).toLowerCase();

  if (!normalizedRole) {
    return 'Unknown';
  }

  return normalizedRole.charAt(0).toUpperCase() + normalizedRole.slice(1);
};

const getInitials = (name = '') =>
  name
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? '')
    .join('') || 'NA';

const formatDateTime = (value) => {
  if (!value) {
    return '-';
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return String(value);
  }

  return date.toLocaleString('en-GB', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
};

const normalizeUser = (user) => {
  const role = String(user?.role || 'staff').toLowerCase();
  const isActive = user?.active !== false;
  const clientName =
    user?.client?.companyName ||
    user?.client?.name ||
    user?.clientName ||
    user?.companyName ||
    '';

  return {
    id: user?.id || user?.uuid || user?.userId || user?.user_id || '',
    name: user?.name || user?.fullName || user?.full_name || 'Unnamed User',
    email: user?.email || '',
    role,
    lastLogin:
      user?.lastLoginAt ||
      user?.lastLogin ||
      user?.lastSeenAt ||
      user?.updatedAt ||
      user?.createdAt ||
      '',
    lastLoginDisplay: formatDateTime(
      user?.lastLoginAt ||
        user?.lastLogin ||
        user?.lastSeenAt ||
        user?.updatedAt ||
        user?.createdAt
    ),
    active: isActive,
    status: isActive ? 'Active' : 'Inactive',
    clientId: user?.clientId || user?.client_id || user?.client?.id || '',
    clientEmail:
      user?.clientEmail ||
      user?.client_email ||
      user?.contactEmail ||
      user?.contact_email ||
      user?.client?.contactEmail ||
      user?.client?.contact_email ||
      user?.client?.email ||
      '',
    clientName,
    initials: getInitials(user?.name || user?.fullName || user?.full_name || ''),
  };
};

const toastStyles = {
  success: 'border-green-200 bg-green-50 text-green-700',
  error: 'border-red-200 bg-red-50 text-red-700',
};

const Settings = () => {
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState(getInitialSettingsTab);
  const [showInviteModal, setShowInviteModal] = useState(false);
  const [triggers, setTriggers] = useState(notificationTriggers);
  const [users, setUsers] = useState([]);
  const [isUsersLoading, setIsUsersLoading] = useState(false);
  const [isSubmittingUser, setIsSubmittingUser] = useState(false);
  const [usersError, setUsersError] = useState('');
  const [usersMessage, setUsersMessage] = useState('');
  const [authProfile, setAuthProfile] = useState(null);
  const [authError, setAuthError] = useState('');
  const [healthStatus, setHealthStatus] = useState(null);
  const [healthError, setHealthError] = useState('');
  const [isHealthLoading, setIsHealthLoading] = useState(false);
  const [toast, setToast] = useState(null);
  const [editingUserId, setEditingUserId] = useState('');
  const [permanentDeleteUser, setPermanentDeleteUser] = useState(null);
  const [permanentDeleteConfirmation, setPermanentDeleteConfirmation] = useState('');
  const [isPermanentDeleting, setIsPermanentDeleting] = useState(false);
  const [showResendApiKey, setShowResendApiKey] = useState(false);
  const [isSavingSettings, setIsSavingSettings] = useState(false);
  const [isSettingsLoading, setIsSettingsLoading] = useState(false);
  const [usersSearchQuery, setUsersSearchQuery] = useState('');
  const [debouncedUsersSearchQuery, setDebouncedUsersSearchQuery] = useState('');
  const [missingClientEmail, setMissingClientEmail] = useState('');
  const [showClientEmailRequiredPopup, setShowClientEmailRequiredPopup] = useState(false);
  const [workingDays, setWorkingDays] = useState(initialWorkingDays);
  const [dispatchLeadTimeHours, setDispatchLeadTimeHours] = useState('72');

  // General Settings
  const [companyDetails, setCompanyDetails] = useState(initialCompanyDetails);

  const [emailConfig, setEmailConfig] = useState(initialEmailConfig);

  // Pricing Tiers
  const [pricingTiers, setPricingTiers] = useState(initialPricingTiers);
  const [pricingCatalog, setPricingCatalog] = useState([]);
  const [pricingClientPrices, setPricingClientPrices] = useState([]);
  const [pricingClients, setPricingClients] = useState([]);
  const [pricingClientSearch, setPricingClientSearch] = useState('');
  const [debouncedPricingClientSearch, setDebouncedPricingClientSearch] = useState('');
  const [isPricingClientDropdownOpen, setIsPricingClientDropdownOpen] = useState(false);
  const [pricingLoading, setPricingLoading] = useState(false);
  const [pricingError, setPricingError] = useState('');
  const [pricingMessage, setPricingMessage] = useState('');
  const [pricingForm, setPricingForm] = useState({
    clientId: '',
    serviceType: 'fnsku_label',
    customServiceType: '',
    pricePerUnit: '',
    tier: 'silver',
    effectiveFrom: '',
    notes: '',
  });
  const pricingClientDropdownRef = useRef(null);

  const [inviteForm, setInviteForm] = useState(initialInviteForm);
  const [autoInviteAfterClientCreate, setAutoInviteAfterClientCreate] = useState(false);

  const currentSession = getSession();
  const isCurrentUserAdmin =
    String(authProfile?.role || currentSession?.role || currentSession?.rawUser?.role || '').toLowerCase() === 'admin';

  const isCurrentUser = (user) =>
    isSameUserIdentity(user, authProfile || {}) ||
    isSameUserIdentity(user, currentSession || {}) ||
    isSameUserIdentity(user, currentSession?.rawUser || {});

  const canShowPermanentDelete = (user) =>
    Boolean(isCurrentUserAdmin && getUserIdentityId(user) && !isCurrentUser(user));

  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedUsersSearchQuery(usersSearchQuery);
    }, 250);
    return () => clearTimeout(timer);
  }, [usersSearchQuery]);

  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedPricingClientSearch(pricingClientSearch);
    }, 250);
    return () => clearTimeout(timer);
  }, [pricingClientSearch]);

  const serviceTypeOptions = useMemo(() => {
    const normalizedPricingCatalog = Array.isArray(pricingCatalog)
      ? pricingCatalog
      : extractPricingCatalog(pricingCatalog);
    const catalogOptions = normalizedPricingCatalog
      .map((service) => {
        const value = getServiceTypeValue(service);

        if (!value) {
          return null;
        }

        return {
          value,
          label:
            service?.label ||
            service?.name ||
            service?.serviceName ||
            service?.service_name ||
            formatServiceTypeLabel(value),
        };
      })
      .filter(Boolean);
    const mergedOptions = [
      ...catalogOptions,
      ...defaultServiceTypeOptions,
      { value: 'OTHER', label: 'Others' },
      pricingForm.serviceType
        ? {
            value: normalizeServiceCode(pricingForm.serviceType),
            label: formatServiceTypeLabel(pricingForm.serviceType),
          }
        : null,
    ].filter(Boolean);
    const seenValues = new Set();

    return mergedOptions.filter((option) => {
      const normalizedValue = getServiceKey(option.value);

      if (seenValues.has(normalizedValue)) {
        return false;
      }

      seenValues.add(normalizedValue);
      return true;
    });
  }, [pricingCatalog, pricingForm.serviceType]);
  const isPricingOtherServiceSelected = String(pricingForm.serviceType || '').trim().toUpperCase() === 'OTHER';

  const pricingClientOptions = useMemo(
    () =>
      pricingClients
        .map((client) => ({
          value: getClientId(client),
          label: getClientDisplayLabel(client),
          email: getClientEmail(client),
          name: getClientName(client),
        }))
        .filter((client) => client.value)
        .sort((left, right) => left.label.localeCompare(right.label)),
    [pricingClients]
  );

  const filteredPricingClientOptions = useMemo(() => {
    const query = debouncedPricingClientSearch.trim().toLowerCase();
    if (!query) return pricingClientOptions;

    return pricingClientOptions.filter((client) =>
      [client.label, client.email, client.name, client.value]
        .join(' ')
        .toLowerCase()
        .includes(query)
    );
  }, [pricingClientOptions, debouncedPricingClientSearch]);

  const selectedPricingClient = useMemo(
    () => pricingClientOptions.find((client) => client.value === pricingForm.clientId) || null,
    [pricingClientOptions, pricingForm.clientId]
  );

  const handleSelectPricingClient = (clientId = '') => {
    setPricingForm((currentForm) => ({ ...currentForm, clientId }));
    setPricingClientSearch('');
    setIsPricingClientDropdownOpen(false);
  };

  const pricingDisplayRows = useMemo(() => {
    const clientLabelLookup = new Map(
      pricingClientOptions.map((client) => [String(client.value), client.label])
    );

    const normalizedGlobalCatalog = [];
    const seenGlobalServiceKeys = new Set();

    pricingCatalog.forEach((service) => {
      const serviceType = getServiceTypeValue(service);
      const serviceKey = getServiceKey(serviceType || service?.label || service?.name);

      if (!serviceKey || seenGlobalServiceKeys.has(serviceKey)) {
        return;
      }

      seenGlobalServiceKeys.add(serviceKey);
      normalizedGlobalCatalog.push(service);
    });

    const globalRows = normalizedGlobalCatalog.flatMap((service) => {
      const serviceType = getServiceTypeValue(service);
      const serviceLabel =
        formatServiceTypeLabel(serviceType) ||
        service?.label ||
        service?.name ||
        service?.serviceName ||
        service?.service_name;
      const tierPricing = toObjectValue(
        service?.default_tier_pricing ||
          service?.defaultTierPricing ||
          service?.tierPricing ||
          service?.tier_pricing ||
          service?.tierPrices ||
          service?.tier_prices ||
          service?.tiers
      );
      const tierRows = ['silver', 'gold', 'platinum']
        .filter((tier) => tierPricing[tier] !== undefined && tierPricing[tier] !== null && tierPricing[tier] !== '')
        .map((tier) => ({
          key: `global-${serviceType || serviceLabel}-${tier}`,
          scope: 'Global default',
          client: 'All clients',
          service: serviceLabel || formatServiceTypeLabel(serviceType),
          tier: formatServiceTypeLabel(tier),
          price: tierPricing[tier],
          notes: getPricingNotes(service),
        }));

      if (tierRows.length) return tierRows;

      const directPrice = firstFilledValue(tierPricing.rate, getPricingAmountValue(service));
      if (directPrice === '') return [];

      return [
        {
          key: `global-${serviceType || serviceLabel}`,
          scope: 'Global default',
          client: 'All clients',
          service: serviceLabel || formatServiceTypeLabel(serviceType),
          tier: formatServiceTypeLabel(getPricingTierValue(service) || 'default'),
          price: directPrice,
          notes: getPricingNotes(service),
        },
      ];
    });

    const seenClientPriceKeys = new Set();
    const clientRows = pricingClientPrices.flatMap((price, index) => {
      const clientId = String(getPricingClientId(price) || '').trim();
      const clientLabel =
        price?.clientName ||
        price?.client_name ||
        price?.companyName ||
        price?.company_name ||
        price?.clientEmail ||
        price?.client_email ||
        price?.client?.companyName ||
        price?.client?.company_name ||
        price?.client?.name ||
        price?.client?.email ||
        clientLabelLookup.get(clientId) ||
        clientId ||
        'Selected client';
      const serviceType = getPricingServiceValue(price);
      const tier = getPricingTierValue(price) || 'default';
      const rowKey = `${clientId || 'global'}:${getServiceKey(serviceType)}:${String(tier).toLowerCase()}`;

      if (seenClientPriceKeys.has(rowKey)) {
        return [];
      }

      seenClientPriceKeys.add(rowKey);

      return {
        key: price?.id || price?.uuid || `client-${clientId}-${serviceType}-${getPricingTierValue(price)}-${index}`,
        scope: 'Client special',
        client: clientLabel,
        service: formatServiceTypeLabel(serviceType),
        tier: formatServiceTypeLabel(tier),
        price: getPricingAmountValue(price),
        notes: getPricingNotes(price),
      };
    });

    return [...clientRows, ...globalRows];
  }, [pricingCatalog, pricingClientOptions, pricingClientPrices]);

  useEffect(() => {
    if (!isPricingClientDropdownOpen) return undefined;

    const closePricingClientDropdown = (event) => {
      if (pricingClientDropdownRef.current?.contains(event.target)) return;
      setPricingClientSearch('');
      setIsPricingClientDropdownOpen(false);
    };

    const handleDropdownKeyDown = (event) => {
      if (event.key !== 'Escape') return;
      setPricingClientSearch('');
      setIsPricingClientDropdownOpen(false);
    };

    document.addEventListener('mousedown', closePricingClientDropdown);
    document.addEventListener('keydown', handleDropdownKeyDown);

    return () => {
      document.removeEventListener('mousedown', closePricingClientDropdown);
      document.removeEventListener('keydown', handleDropdownKeyDown);
    };
  }, [isPricingClientDropdownOpen]);

  const normalizeTierThreshold = (value, fallback = '0') =>
    value === null || value === undefined || value === '' ? fallback : String(value);

  const normalizePricingTier = (tier = {}, fallback = initialPricingTiers.silver) => ({
    minUnits: normalizeTierThreshold(tier?.minUnits ?? tier?.min_units, fallback.minUnits),
    invoiceMin: normalizeTierThreshold(
      tier?.invoiceMin ?? tier?.invoice_min ?? tier?.maxUnits ?? tier?.max_units,
      fallback.invoiceMin
    ),
  });

  const showToast = (type, message) => {
    setToast({ type, message });
  };

  useEffect(() => {
    if (!toast) {
      return undefined;
    }

    const timeoutId = window.setTimeout(() => {
      setToast(null);
    }, 3000);

    return () => window.clearTimeout(timeoutId);
  }, [toast]);

  const toggleTrigger = (id, field) => {
    setTriggers(
      triggers.map((trigger) =>
        trigger.id === id ? { ...trigger, [field]: !trigger[field] } : trigger
      )
    );
  };

  const closeUserModal = () => {
    setShowInviteModal(false);
    setEditingUserId('');
    setInviteForm(initialInviteForm);
    setMissingClientEmail('');
    setShowClientEmailRequiredPopup(false);
    setAutoInviteAfterClientCreate(false);
  };

  const findClientByEmail = async (email) => {
    const payloads = await Promise.all(
      ['true', 'false'].map(async (isActive) => {
        const response = await fetch(`${API_BASE_URL}/api/clients?isActive=${isActive}`, {
          method: 'GET',
          headers: buildHeaders(),
        });

        return parseResponse(response);
      })
    );
    const normalizedTargetEmail = normalizeEmail(email);

    return payloads.flatMap(extractClients).find(
      (client) => normalizeEmail(getClientEmail(client)) === normalizedTargetEmail
    );
  };

  const resolveClientCompanyEmail = () =>
    String(inviteForm.clientEmail || inviteForm.email || '').trim();

  const goToClientCreate = (emailOverride = '') => {
    const explicitEmail = typeof emailOverride === 'string' ? emailOverride : '';
    const email = String(explicitEmail || missingClientEmail || resolveClientCompanyEmail()).trim();

    if (!email || email === '[object Object]') {
      setShowClientEmailRequiredPopup(true);
      return;
    }

    sessionStorage.setItem(
      PENDING_USER_EDIT_KEY,
      JSON.stringify({
        editingUserId,
        mode: editingUserId ? 'edit' : 'create',
        autoInviteAfterClientCreate: !editingUserId,
        inviteForm: {
          ...inviteForm,
          role: 'client',
          clientEmail: email,
        },
      })
    );

    closeUserModal();
    sessionStorage.setItem('pending-client-create-email', email);
    navigate('/clients');
    window.setTimeout(() => {
      window.dispatchEvent(new CustomEvent('open-client-create', { detail: { email } }));
    }, 0);
  };

  const loadAuthProfile = async () => {
    try {
      setAuthError('');
      const response = await fetch(`${API_BASE_URL}/api/auth/me`, {
        method: 'GET',
        headers: buildHeaders(),
      });
      const payload = await parseResponse(response);
      setAuthProfile(payload?.user || payload?.data || payload);
    } catch (error) {
      setAuthError(error.message);
    }
  };

  const loadHealthStatus = async () => {
    try {
      setIsHealthLoading(true);
      setHealthError('');
      const response = await fetch(`${API_BASE_URL}/api/health`, {
        method: 'GET',
      });
      const payload = await parseResponse(response);
      setHealthStatus(payload?.data || payload);
      showToast('success', 'API health check successful.');
    } catch (error) {
      setHealthError(error.message);
      setHealthStatus(null);
      showToast('error', error.message || 'API health check failed.');
    } finally {
      setIsHealthLoading(false);
    }
  };

  const applySettingsPayload = (payload) => {
    const settings =
      payload?.settings ||
      payload?.data?.settings ||
      payload?.data ||
      payload ||
      {};

    const address = settings?.companyAddress || settings?.address || {};
    const bankDetails = settings?.bankDetails || settings?.bank_details || {};
    const emailConfiguration =
      settings?.emailConfiguration ||
      settings?.emailConfig ||
      settings?.email_configuration ||
      {};
    const notificationToggles =
      settings?.notificationToggles ||
      settings?.notification_settings ||
      settings?.notifications ||
      {};
    const backendWorkingDays = settings?.workingDays || settings?.working_days || {};

    const addressParts = [
      address?.street,
      address?.city,
      address?.postcode,
      address?.country,
    ].filter(Boolean);

    setCompanyDetails({
      companyName: settings?.companyName || settings?.company_name || '',
      vatNumber: settings?.vatNumber || settings?.vat_number || '',
      companyAddress: addressParts.join(', '),
      invoicePaymentTermsDays: String(
        settings?.invoicePaymentTermsDays ||
          settings?.invoice_payment_terms_days ||
          ''
      ),
      bankName: bankDetails?.bankName || bankDetails?.bank_name || '',
      sortCode: bankDetails?.sortCode || bankDetails?.sort_code || '',
      accountNumber: bankDetails?.accountNumber || bankDetails?.account_number || '',
    });

    setEmailConfig({
      fromName: emailConfiguration?.fromName || emailConfiguration?.from_name || '',
      fromEmail: emailConfiguration?.fromEmail || emailConfiguration?.from_email || '',
      replyToEmail:
        emailConfiguration?.replyToEmail || emailConfiguration?.reply_to_email || '',
      resendApiKey:
        emailConfiguration?.resendApiKey || emailConfiguration?.resend_api_key || '',
    });

    setWorkingDays({
      monday: backendWorkingDays?.monday ?? initialWorkingDays.monday,
      tuesday: backendWorkingDays?.tuesday ?? initialWorkingDays.tuesday,
      wednesday: backendWorkingDays?.wednesday ?? initialWorkingDays.wednesday,
      thursday: backendWorkingDays?.thursday ?? initialWorkingDays.thursday,
      friday: backendWorkingDays?.friday ?? initialWorkingDays.friday,
      saturday: backendWorkingDays?.saturday ?? initialWorkingDays.saturday,
      sunday: backendWorkingDays?.sunday ?? initialWorkingDays.sunday,
    });

    setDispatchLeadTimeHours(
      String(settings?.dispatchLeadTimeHours ?? settings?.dispatch_lead_time_hours ?? '72')
    );

    setTriggers((current) =>
      current.map((trigger) => {
        const normalizedLabel = trigger.label.toLowerCase();

        if (normalizedLabel === 'client submits shipment') {
          return {
            ...trigger,
            emailEnabled: Boolean(notificationToggles?.clientSubmitsShipment),
            inAppEnabled: Boolean(notificationToggles?.clientSubmitsShipment),
          };
        }

        if (normalizedLabel === 'shipment received (no discrepancy)') {
          return {
            ...trigger,
            emailEnabled: Boolean(notificationToggles?.shipmentReceived),
            inAppEnabled: Boolean(notificationToggles?.shipmentReceived),
          };
        }

        if (normalizedLabel === 'shipment received with discrepancy') {
          return {
            ...trigger,
            emailEnabled: Boolean(notificationToggles?.discrepancyDetected),
            inAppEnabled: Boolean(notificationToggles?.discrepancyDetected),
          };
        }

        if (normalizedLabel === 'invoice sent') {
          return {
            ...trigger,
            emailEnabled: Boolean(notificationToggles?.invoiceSent),
            inAppEnabled: Boolean(notificationToggles?.invoiceSent),
          };
        }

        if (normalizedLabel === 'invoice overdue reminder') {
          return {
            ...trigger,
            emailEnabled: Boolean(notificationToggles?.invoiceOverdue),
            inAppEnabled: Boolean(notificationToggles?.invoiceOverdue),
          };
        }

        return trigger;
      })
    );
  };

  const loadSettings = async () => {
    try {
      setIsSettingsLoading(true);
      const response = await fetch(`${API_BASE_URL}/api/settings`, {
        method: 'GET',
        headers: buildHeaders(),
      });
      const payload = await parseResponse(response);
      applySettingsPayload(payload);
    } catch (error) {
      showToast('error', error.message || 'Failed to load settings.');
    } finally {
      setIsSettingsLoading(false);
    }
  };

  const buildSettingsPayload = () => ({
    companyName: companyDetails.companyName.trim() || undefined,
    companyAddress: companyDetails.companyAddress.trim()
      ? {
          street: companyDetails.companyAddress.trim(),
          city: '',
          postcode: '',
          country: '',
        }
      : undefined,
    vatNumber: companyDetails.vatNumber.trim() || undefined,
    bankDetails: {
      bankName: companyDetails.bankName.trim() || undefined,
      accountName: companyDetails.companyName.trim() || undefined,
      sortCode: companyDetails.sortCode.trim() || undefined,
      accountNumber: companyDetails.accountNumber.trim() || undefined,
    },
    workingDays,
    dispatchLeadTimeHours: dispatchLeadTimeHours
      ? Number(dispatchLeadTimeHours)
      : undefined,
    invoicePaymentTermsDays: companyDetails.invoicePaymentTermsDays
      ? Number(companyDetails.invoicePaymentTermsDays)
      : undefined,
    notificationToggles: {
      shipmentReceived: Boolean(
        triggers.find((trigger) => trigger.label === 'Shipment received (no discrepancy)')
          ?.emailEnabled ||
          triggers.find((trigger) => trigger.label === 'Shipment received with discrepancy')
            ?.emailEnabled
      ),
      invoiceSent: Boolean(
        triggers.find((trigger) => trigger.label === 'Invoice sent')?.emailEnabled
      ),
      discrepancyDetected: Boolean(
        triggers.find((trigger) => trigger.label === 'Shipment received with discrepancy')
          ?.emailEnabled
      ),
      clientSubmitsShipment: Boolean(
        triggers.find((trigger) => trigger.label === 'Client submits shipment')?.emailEnabled
      ),
      invoiceOverdue: Boolean(
        triggers.find((trigger) => trigger.label === 'Invoice overdue reminder')?.emailEnabled
      ),
    },
    emailConfiguration: {
      fromName: emailConfig.fromName.trim() || undefined,
      fromEmail: emailConfig.fromEmail.trim() || undefined,
      replyToEmail: emailConfig.replyToEmail.trim() || undefined,
      resendApiKey: emailConfig.resendApiKey.trim() || undefined,
    },
  });

  const handleSaveSettings = async (sourceLabel = 'Settings') => {
    try {
      setIsSavingSettings(true);
      const response = await fetch(`${API_BASE_URL}/api/settings`, {
        method: 'PATCH',
        headers: buildHeaders(true),
        body: JSON.stringify(buildSettingsPayload()),
      });
      await parseResponse(response);
      showToast('success', `${sourceLabel} updated successfully.`);
    } catch (error) {
      showToast('error', error.message || `Failed to update ${sourceLabel.toLowerCase()}.`);
    } finally {
      setIsSavingSettings(false);
    }
  };

  const loadUsers = async () => {
    try {
      setIsUsersLoading(true);
      setUsersError('');
      const response = await fetch(`${API_BASE_URL}/api/users`, {
        method: 'GET',
        headers: buildHeaders(),
      });
      const payload = await parseResponse(response);
      setUsers(extractUsers(payload).map(normalizeUser));
    } catch (error) {
      setUsersError(error.message);
      setUsers([]);
    } finally {
      setIsUsersLoading(false);
    }
  };

  useEffect(() => {
    loadSettings();
    loadHealthStatus();
    loadAuthProfile();
    loadUsers();
  }, []);

  useEffect(() => {
    const pendingUserEdit = sessionStorage.getItem(PENDING_USER_EDIT_KEY);

    if (!pendingUserEdit) {
      return;
    }

    sessionStorage.removeItem(PENDING_USER_EDIT_KEY);

    try {
      const parsedEdit = JSON.parse(pendingUserEdit);

      if (!parsedEdit?.inviteForm) {
        return;
      }

      setActiveTab('users');
      localStorage.setItem(SETTINGS_ACTIVE_TAB_KEY, 'users');
      setUsersMessage('');
      setUsersError('');
      setMissingClientEmail('');
      setShowClientEmailRequiredPopup(false);
      setEditingUserId(parsedEdit.editingUserId || '');
      setInviteForm({
        ...initialInviteForm,
        ...parsedEdit.inviteForm,
        role: 'client',
        clientEmail:
          parsedEdit.inviteForm.clientEmail ||
          parsedEdit.inviteForm.email ||
          '',
      });
      setShowInviteModal(true);
      if (parsedEdit.autoInviteAfterClientCreate && !parsedEdit.editingUserId) {
        setAutoInviteAfterClientCreate(true);
        showToast('success', 'Client created. Sending invite...');
      } else {
        showToast(
          'success',
          parsedEdit.editingUserId
            ? 'Client created. You can now update this user.'
            : 'Client created. You can now invite this user.'
        );
      }
    } catch {
      sessionStorage.removeItem(PENDING_USER_EDIT_KEY);
    }
  }, []);

  const loadPricingData = async () => {
    try {
      setPricingLoading(true);
      setPricingError('');

      const [tiersResponse, pricingResponse] = await Promise.all([
        fetch(`${API_BASE_URL}/api/pricing/tiers`, {
          method: 'GET',
          headers: buildHeaders(),
        }),
        fetch(`${API_BASE_URL}/api/pricing`, {
          method: 'GET',
          headers: buildHeaders(),
        }),
      ]);

      const tiersPayload = await parseResponse(tiersResponse);
      const pricingPayload = await parseResponse(pricingResponse);
      console.log('[PickPackPro][Settings][GET /api/pricing]', pricingPayload);

      const tierData = tiersPayload?.tiers || tiersPayload?.data || tiersPayload;
      setPricingTiers({
        silver: normalizePricingTier(tierData?.silver, initialPricingTiers.silver),
        gold: normalizePricingTier(tierData?.gold, initialPricingTiers.gold),
        platinum: normalizePricingTier(tierData?.platinum, initialPricingTiers.platinum),
      });

      setPricingCatalog(extractPricingCatalog(pricingPayload));
      setPricingClientPrices(extractPricingClientPrices(pricingPayload));

      try {
        const clientsResponse = await fetch(`${API_BASE_URL}/api/clients`, {
          method: 'GET',
          headers: buildHeaders(),
        });
        const clientsPayload = await parseResponse(clientsResponse);
        setPricingClients(extractClients(clientsPayload));
      } catch {
        setPricingClients([]);
      }
    } catch (error) {
      setPricingError(error.message);
      setPricingCatalog([]);
      setPricingClientPrices([]);
      setPricingClients([]);
    } finally {
      setPricingLoading(false);
    }
  };

  useEffect(() => {
    if (activeTab === 'pricing') {
      loadPricingData();
    }
  }, [activeTab]);

  const handleSavePricing = async () => {
    try {
      setPricingError('');
      setPricingMessage('');

      const selectedServiceType = isPricingOtherServiceSelected
        ? pricingForm.customServiceType.trim()
        : pricingForm.serviceType.trim();

      if (!selectedServiceType) {
        throw new Error('Service type is required.');
      }

      if (!pricingForm.pricePerUnit) {
        throw new Error('Price per unit is required.');
      }

      const pricingPayload = {
        clientId: pricingForm.clientId.trim() || undefined,
        serviceType: normalizeServiceCode(selectedServiceType),
        tier: pricingForm.tier,
        pricePerUnit: Number(pricingForm.pricePerUnit || 0),
        notes: pricingForm.notes.trim() || undefined,
      };
      console.log('[PickPackPro][Settings][POST /api/pricing request]', pricingPayload);

      const response = await fetch(`${API_BASE_URL}/api/pricing`, {
        method: 'POST',
        headers: buildHeaders(true),
        body: JSON.stringify(pricingPayload),
      });
      const savedPricingPayload = await parseResponse(response);
      console.log('[PickPackPro][Settings][POST /api/pricing response]', savedPricingPayload);
      setPricingMessage('Pricing updated successfully.');
      showToast('success', 'Pricing saved successfully.');
      await loadPricingData();
    } catch (error) {
      setPricingError(error.message);
      showToast('error', error.message || 'Failed to save pricing.');
    }
  };

  const filteredUsers = useMemo(() => {
    const query = debouncedUsersSearchQuery.trim().toLowerCase();

    if (!query) {
      return users;
    }

    return users.filter(
      (user) =>
        user.name.toLowerCase().includes(query) ||
        user.email.toLowerCase().includes(query) ||
        user.role.toLowerCase().includes(query)
    );
  }, [users, debouncedUsersSearchQuery]);

  const openCreateModal = () => {
    setUsersMessage('');
    setUsersError('');
    setShowClientEmailRequiredPopup(false);
    setEditingUserId('');
    setInviteForm(initialInviteForm);
    setShowInviteModal(true);
  };

  const openEditModal = (user) => {
    setUsersMessage('');
    setUsersError('');
    setShowClientEmailRequiredPopup(false);
    setEditingUserId(user.id);
    setInviteForm({
      fullName: user.name,
      email: user.email,
      clientEmail: user.clientEmail || user.email || '',
      role: user.role,
      clientId: user.clientId || '',
      active: user.active,
    });
    setShowInviteModal(true);
  };

  const handleInvite = async () => {
    if (!inviteForm.fullName.trim() || !inviteForm.email.trim()) {
      const message = 'Full name and email are required.';
      setUsersError(message);
      showToast('error', message);
      return;
    }

    if (!isValidEmail(inviteForm.email)) {
      const message = 'Enter a valid invite email address.';
      setUsersError(message);
      showToast('error', message);
      return;
    }

    if (inviteForm.role === 'client' && !isValidEmail(resolveClientCompanyEmail())) {
      const message = 'Enter a valid client company email address.';
      setUsersError(message);
      showToast('error', message);
      return;
    }

    try {
      setIsSubmittingUser(true);
      setUsersError('');
      setUsersMessage('');
      setMissingClientEmail('');

      if (editingUserId) {
        const patchPayload = {
          name: inviteForm.fullName.trim(),
          role: inviteForm.role,
          active: Boolean(inviteForm.active),
        };

        if (inviteForm.role === 'client') {
          const clientEmail = inviteForm.clientEmail.trim() || inviteForm.email.trim();
          patchPayload.clientCompanyEmail = clientEmail || null;
        } else {
          patchPayload.clientCompanyEmail = null;
        }

        const response = await fetch(`${API_BASE_URL}/api/users/${editingUserId}`, {
          method: 'PATCH',
          headers: buildHeaders(true),
          body: JSON.stringify(patchPayload),
        });

        await parseResponse(response);
        const successMessage = 'User updated successfully.';
        setUsersMessage(successMessage);
        showToast('success', successMessage);
      } else {
        const inviteEmail = inviteForm.email.trim();
        const payload = {
          email: inviteEmail,
          name: inviteForm.fullName.trim(),
          role: inviteForm.role,
        };

        if (inviteForm.role === 'client') {
          const clientEmail = (inviteForm.clientEmail.trim() || inviteForm.email.trim());
          const linkedClient = await findClientByEmail(clientEmail);

          if (!linkedClient) {
            setMissingClientEmail(clientEmail);
            showToast('error', 'No client company found with that email. Create the client company first.');
            goToClientCreate(clientEmail);
            return;
          }

          payload.clientCompanyEmail = clientEmail;
        }

        const response = await fetch(`${API_BASE_URL}/api/auth/invite`, {
          method: 'POST',
          headers: buildHeaders(true),
          body: JSON.stringify(payload),
        });

        await parseResponse(response);
        const successMessage = 'Invite sent! The user will receive an email to set their password.';
        setUsersMessage(successMessage);
        showToast('success', successMessage);
      }

      closeUserModal();
      await loadUsers();
      await loadAuthProfile();
    } catch (error) {
      if (!editingUserId && isExistingInviteMessage(error.message)) {
        const successMessage = 'Invite sent! The user will receive an email to set their password.';
        setUsersError('');
        setUsersMessage(successMessage);
        showToast('success', successMessage);
        closeUserModal();
        await loadUsers();
        await loadAuthProfile();
        return;
      }

      setUsersError(error.message);
      showToast('error', error.message || 'Failed to send invite.');
    } finally {
      setIsSubmittingUser(false);
    }
  };

  useEffect(() => {
    if (!autoInviteAfterClientCreate || !showInviteModal || isSubmittingUser) {
      return undefined;
    }

    const timeoutId = window.setTimeout(() => {
      setAutoInviteAfterClientCreate(false);
      handleInvite();
    }, 0);

    return () => window.clearTimeout(timeoutId);
  }, [autoInviteAfterClientCreate, showInviteModal, isSubmittingUser]);

  const handleDeactivate = async (userId) => {
    try {
      setUsersError('');
      setUsersMessage('');
      const response = await fetch(`${API_BASE_URL}/api/users/${userId}`, {
        method: 'DELETE',
        headers: buildHeaders(),
      });
      await parseResponse(response);
      setUsersMessage('User deactivated successfully.');
      await loadUsers();
    } catch (error) {
      setUsersError(error.message);
    }
  };

  const openPermanentDeleteModal = (user) => {
    setUsersError('');
    setUsersMessage('');
    setPermanentDeleteConfirmation('');
    setPermanentDeleteUser(user);
  };

  const closePermanentDeleteModal = () => {
    if (isPermanentDeleting) {
      return;
    }

    setPermanentDeleteUser(null);
    setPermanentDeleteConfirmation('');
  };

  const getPermanentDeleteErrorMessage = (error) => {
    const status = Number(error?.status);

    if (status === 401 || status === 403) {
      return 'You do not have permission to delete this user.';
    }

    if (status === 422) {
      return error?.message || 'Could not delete user.';
    }

    return error?.message || 'Could not delete user.';
  };

  const handlePermanentDelete = async () => {
    const userId = getUserIdentityId(permanentDeleteUser || {});

    if (!userId) {
      const message = 'Could not delete user.';
      setUsersError(message);
      showToast('error', message);
      return;
    }

    try {
      setIsPermanentDeleting(true);
      setUsersError('');
      setUsersMessage('');

      const response = await fetch(`${API_BASE_URL}/api/users/${encodeURIComponent(userId)}?permanent=true`, {
        method: 'DELETE',
        headers: buildHeaders(),
      });
      await parseResponse(response);

      setUsers((currentUsers) =>
        currentUsers.filter((user) => getUserIdentityId(user) !== userId)
      );
      setUsersMessage('User permanently deleted.');
      showToast('success', 'User permanently deleted.');
      setPermanentDeleteUser(null);
      setPermanentDeleteConfirmation('');
    } catch (error) {
      const message = getPermanentDeleteErrorMessage(error);
      setUsersError(message);
      showToast('error', message);
    } finally {
      setIsPermanentDeleting(false);
    }
  };

  const tabs = [
    { id: 'general', label: 'General', icon: Building2 },
    { id: 'users', label: 'Users', icon: Users },
    { id: 'pricing', label: 'Pricing Tiers', icon: Tag },
    { id: 'notifications', label: 'Notifications', icon: Bell },
  ];

  const handleTabChange = (tabId) => {
    setActiveTab(tabId);
    localStorage.setItem(SETTINGS_ACTIVE_TAB_KEY, tabId);
  };

  return (
    <Layout>
      <FullPageLoader
        show={isSettingsLoading || isUsersLoading || pricingLoading || isHealthLoading}
        label="Loading settings..."
      />
      <div className="p-6 bg-gray-50 min-h-screen">
        {toast ? (
          <div className="fixed right-4 top-4 z-50">
            <div className={`rounded-lg border px-4 py-3 text-sm shadow-lg ${toastStyles[toast.type] || toastStyles.error}`}>
              {toast.message}
            </div>
          </div>
        ) : null}

        <div className="mb-6">
          <h1 className="text-2xl font-semibold text-gray-900">Settings</h1>
          <p className="text-sm text-gray-500 mt-1">
            Manage your account and application settings.
          </p>
        </div>

        <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
          <div className="border-b border-gray-200">
            <div className="flex">
              {tabs.map((tab) => {
                const Icon = tab.icon;
                return (
                  <button
                    key={tab.id}
                    onClick={() => handleTabChange(tab.id)}
                    className={`flex items-center gap-2 px-6 py-3 text-sm font-medium border-b-2 transition-colors ${
                      activeTab === tab.id
                        ? 'border-[#ff6900] text-[#ff6900]'
                        : 'border-transparent text-gray-500 hover:text-gray-700'
                    }`}
                  >
                    <Icon size={16} />
                    {tab.label}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="p-6">
            {activeTab === 'general' && (
              <div className="space-y-6">
                {isSettingsLoading ? (
                  <div className="rounded-lg border border-blue-100 bg-blue-50 px-4 py-3 text-sm text-blue-700">
                    <LoadingState label="Loading saved settings..." />
                  </div>
                ) : null}

                <div className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1fr)_380px]">
                  <div className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">
                    <div className="border-b border-gray-200 px-6 py-5">
                      <h3 className="text-2xl font-semibold text-[#132347]">Company Details</h3>
                      <p className="mt-1 text-sm text-gray-500">
                        Global business information and legal records
                      </p>
                    </div>
                    <div className="space-y-5 px-6 py-5">
                      <div>
                        <label className="mb-1 block text-xs font-semibold uppercase tracking-wider text-gray-600">
                          Company Name
                        </label>
                        <input
                          type="text"
                          value={companyDetails.companyName}
                          onChange={(e) =>
                            setCompanyDetails({ ...companyDetails, companyName: e.target.value })
                          }
                          placeholder="Pick Pack Pro Ltd"
                          className="w-full rounded-lg border border-gray-200 px-3 py-2.5 text-sm focus:border-[#ff6900] focus:outline-none focus:ring-2 focus:ring-orange-100"
                        />
                      </div>

                      <div>
                        <label className="mb-1 block text-xs font-semibold uppercase tracking-wider text-gray-600">
                          VAT Number
                        </label>
                        <input
                          type="text"
                          value={companyDetails.vatNumber}
                          onChange={(e) =>
                            setCompanyDetails({ ...companyDetails, vatNumber: e.target.value })
                          }
                          placeholder="GB 123 456 789"
                          className="w-full rounded-lg border border-gray-200 px-3 py-2.5 text-sm focus:border-[#ff6900] focus:outline-none focus:ring-2 focus:ring-orange-100"
                        />
                      </div>

                      <div>
                        <label className="mb-1 block text-xs font-semibold uppercase tracking-wider text-gray-600">
                          Company Address
                        </label>
                        <textarea
                          value={companyDetails.companyAddress}
                          onChange={(e) =>
                            setCompanyDetails({
                              ...companyDetails,
                              companyAddress: e.target.value,
                            })
                          }
                          placeholder="Unit 4, Commerce Park, Luton, LU1 3BX, United Kingdom"
                          className="min-h-24 w-full rounded-lg border border-gray-200 px-3 py-2.5 text-sm focus:border-[#ff6900] focus:outline-none focus:ring-2 focus:ring-orange-100"
                        />
                      </div>

                      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                        <div>
                          <label className="mb-1 block text-xs font-semibold uppercase tracking-wider text-gray-600">
                            Invoice Payment Terms (Days)
                          </label>
                          <input
                            type="number"
                            value={companyDetails.invoicePaymentTermsDays}
                            onChange={(e) =>
                              setCompanyDetails({
                                ...companyDetails,
                                invoicePaymentTermsDays: e.target.value,
                              })
                            }
                            placeholder="14"
                            className="w-full rounded-lg border border-gray-200 px-3 py-2.5 text-sm focus:border-[#ff6900] focus:outline-none focus:ring-2 focus:ring-orange-100"
                          />
                        </div>
                        <div>
                          <label className="mb-1 block text-xs font-semibold uppercase tracking-wider text-gray-600">
                            Bank Name
                          </label>
                          <input
                            type="text"
                            value={companyDetails.bankName}
                            onChange={(e) =>
                              setCompanyDetails({ ...companyDetails, bankName: e.target.value })
                            }
                            placeholder="Barclays UK"
                            className="w-full rounded-lg border border-gray-200 px-3 py-2.5 text-sm focus:border-[#ff6900] focus:outline-none focus:ring-2 focus:ring-orange-100"
                          />
                        </div>
                        <div>
                          <label className="mb-1 block text-xs font-semibold uppercase tracking-wider text-gray-600">
                            Sort Code
                          </label>
                          <input
                            type="text"
                            value={companyDetails.sortCode}
                            onChange={(e) =>
                              setCompanyDetails({ ...companyDetails, sortCode: e.target.value })
                            }
                            placeholder="40-01-02"
                            className="w-full rounded-lg border border-gray-200 px-3 py-2.5 text-sm focus:border-[#ff6900] focus:outline-none focus:ring-2 focus:ring-orange-100"
                          />
                        </div>
                        <div>
                          <label className="mb-1 block text-xs font-semibold uppercase tracking-wider text-gray-600">
                            Account No
                          </label>
                          <input
                            type="text"
                            value={companyDetails.accountNumber}
                            onChange={(e) =>
                              setCompanyDetails({
                                ...companyDetails,
                                accountNumber: e.target.value,
                              })
                            }
                            placeholder="12345678"
                            className="w-full rounded-lg border border-gray-200 px-3 py-2.5 text-sm focus:border-[#ff6900] focus:outline-none focus:ring-2 focus:ring-orange-100"
                          />
                        </div>
                      </div>
                    </div>
                    <div className="flex justify-end border-t border-gray-200 bg-gray-50 px-6 py-5">
                      <button
                        type="button"
                        onClick={() => handleSaveSettings('Company details')}
                        disabled={isSavingSettings}
                        className="inline-flex items-center gap-2 rounded-lg bg-[#ff9900] px-5 py-2.5 text-sm font-semibold text-white hover:bg-[#ea8b00] disabled:opacity-60"
                      >
                        <Save size={15} />
                        {isSavingSettings ? 'Saving...' : 'Save Changes'}
                      </button>
                    </div>
                  </div>

                  <div className="space-y-6">
                    <div className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">
                      <div className="border-b border-gray-200 px-6 py-5">
                        <h3 className="text-2xl font-semibold text-[#132347]">Email Configuration</h3>
                        <p className="mt-1 text-sm text-gray-500">
                          SMTP and sender identity for outbound communication
                        </p>
                      </div>
                      <div className="space-y-5 px-6 py-5">
                        <div>
                          <label className="mb-1 block text-xs font-semibold uppercase tracking-wider text-gray-600">
                            From Name
                          </label>
                          <input
                            type="text"
                            value={emailConfig.fromName}
                            onChange={(e) =>
                              setEmailConfig({ ...emailConfig, fromName: e.target.value })
                            }
                            placeholder="Pick Pack Pro"
                            className="w-full rounded-lg border border-gray-200 px-3 py-2.5 text-sm focus:border-[#ff6900] focus:outline-none focus:ring-2 focus:ring-orange-100"
                          />
                        </div>
                        <div>
                          <label className="mb-1 block text-xs font-semibold uppercase tracking-wider text-gray-600">
                            From Email
                          </label>
                          <input
                            type="email"
                            value={emailConfig.fromEmail}
                            onChange={(e) =>
                              setEmailConfig({ ...emailConfig, fromEmail: e.target.value })
                            }
                            placeholder="noreply@pickpackpro.co.uk"
                            className="w-full rounded-lg border border-gray-200 px-3 py-2.5 text-sm focus:border-[#ff6900] focus:outline-none focus:ring-2 focus:ring-orange-100"
                          />
                        </div>
                        <div>
                          <label className="mb-1 block text-xs font-semibold uppercase tracking-wider text-gray-600">
                            Reply-To Email
                          </label>
                          <input
                            type="email"
                            value={emailConfig.replyToEmail}
                            onChange={(e) =>
                              setEmailConfig({ ...emailConfig, replyToEmail: e.target.value })
                            }
                            placeholder="hello@pickpackpro.co.uk"
                            className="w-full rounded-lg border border-gray-200 px-3 py-2.5 text-sm focus:border-[#ff6900] focus:outline-none focus:ring-2 focus:ring-orange-100"
                          />
                        </div>
                        {/* <div>
                          <div className="mb-1 flex items-center justify-between gap-3">
                            <label className="block text-xs font-semibold uppercase tracking-wider text-gray-600">
                              Resend API Key
                            </label>
                            <button
                              type="button"
                              onClick={() => setShowResendApiKey((current) => !current)}
                              className="text-xs font-semibold text-[#ff9900] hover:text-[#ea8b00]"
                            >
                              {showResendApiKey ? 'Hide Key' : 'Reveal Key'}
                            </button>
                          </div>
                          <input
                            type={showResendApiKey ? 'text' : 'password'}
                            value={emailConfig.resendApiKey}
                            onChange={(e) =>
                              setEmailConfig({ ...emailConfig, resendApiKey: e.target.value })
                            }
                            placeholder="Enter Resend API key"
                            className="w-full rounded-lg border border-gray-200 px-3 py-2.5 text-sm focus:border-[#ff6900] focus:outline-none focus:ring-2 focus:ring-orange-100"
                          />
                        </div> */}
                      </div>
                      <div className="flex items-center justify-between border-t border-gray-200 bg-gray-50 px-6 py-5">
                        <button
                          type="button"
                          onClick={() => showToast('success', 'Test email trigger coming next.')}
                          className="rounded-lg border border-gray-300 bg-white px-4 py-2.5 text-sm font-medium text-gray-700 hover:bg-gray-100"
                        >
                          Send Test Email
                        </button>
                        <button
                          type="button"
                          onClick={() => handleSaveSettings('Email configuration')}
                          disabled={isSavingSettings}
                          className="rounded-lg bg-[#ff9900] px-5 py-2.5 text-sm font-semibold text-white hover:bg-[#ea8b00] disabled:opacity-60"
                        >
                          {isSavingSettings ? 'Saving...' : 'Save'}
                        </button>
                      </div>
                    </div>

                    <div className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">
                      <div className="border-b border-gray-200 px-6 py-5">
                        <div className="flex items-center justify-between gap-4">
                      
                          <button
                            type="button"
                            onClick={loadHealthStatus}
                            className="inline-flex items-center gap-2 rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-100"
                          >
                            <RefreshCw size={15} />
                            Refresh
                          </button>
                        </div>
                      </div>
                      <div className="space-y-3 px-6 py-5">
                        <div
                          className={`flex items-center justify-between rounded-lg border px-4 py-3 text-sm ${
                            healthError
                              ? 'border-red-200 bg-red-50 text-red-700'
                              : 'border-green-200 bg-green-50 text-green-700'
                          }`}
                        >
                          <div className="flex items-center gap-3">
                            <span
                              className={`h-2.5 w-2.5 rounded-full ${
                                healthError ? 'bg-red-500' : 'bg-green-500'
                              }`}
                            />
                            <span>Email Gateway</span>
                          </div>
                          <span className="rounded bg-white/70 px-2 py-1 text-xs font-semibold uppercase">
                            {isHealthLoading ? 'CHECKING' : healthError ? 'OFFLINE' : 'ONLINE'}
                          </span>
                        </div>

                        <div className="flex items-center justify-between rounded-lg border border-gray-200 bg-gray-50 px-4 py-3 text-sm text-gray-500">
                          <div className="flex items-center gap-3">
                            <span className="h-2.5 w-2.5 rounded-full bg-gray-300" />
                            <span>SMS Gateway</span>
                          </div>
                          <span className="rounded bg-white px-2 py-1 text-xs font-semibold uppercase text-gray-500">
                            DISABLED
                          </span>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {activeTab === 'users' && (
              <div>
                <div className="mb-6 flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
                  <div className="relative w-full max-w-sm">
                    <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
                    <input
                      type="text"
                      value={usersSearchQuery}
                      onChange={(e) => setUsersSearchQuery(e.target.value)}
                      placeholder="Search staff members..."
                      className="w-full rounded-lg border border-gray-200 bg-white py-2.5 pl-9 pr-4 text-sm text-gray-700 focus:border-[#ff6900] focus:outline-none focus:ring-2 focus:ring-orange-100"
                    />
                  </div>
                  <button
                    onClick={openCreateModal}
                    className="inline-flex items-center justify-center gap-2 rounded-lg bg-[#ff9900] px-4 py-2.5 text-sm font-semibold text-white hover:bg-[#ea8b00]"
                  >
                    <Plus size={16} />
                    Invite User
                  </button>
                </div>

                <div className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">
                  <table className="w-full">
                    <thead className="bg-gray-50/80">
                      <tr className="border-b border-gray-200">
                        <th className="px-6 py-4 text-left text-xs font-semibold uppercase tracking-wider text-gray-500">Name</th>
                        <th className="px-6 py-4 text-left text-xs font-semibold uppercase tracking-wider text-gray-500">Email</th>
                        <th className="px-6 py-4 text-left text-xs font-semibold uppercase tracking-wider text-gray-500">Role</th>
                        <th className="px-6 py-4 text-left text-xs font-semibold uppercase tracking-wider text-gray-500">Last Login</th>
                        <th className="px-6 py-4 text-left text-xs font-semibold uppercase tracking-wider text-gray-500">Status</th>
                        <th className="px-6 py-4 text-left text-xs font-semibold uppercase tracking-wider text-gray-500">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {isUsersLoading ? (
                        <tr>
                          <td colSpan="6" className="px-6 py-8 text-center text-sm text-gray-500">
                            <LoadingState label="Loading users..." />
                          </td>
                        </tr>
                      ) : filteredUsers.length === 0 ? (
                        <tr>
                          <td colSpan="6" className="px-6 py-8 text-center text-sm text-gray-500">
                            No users found from API.
                          </td>
                        </tr>
                      ) : (
                        filteredUsers.map((user) => (
                          <tr key={user.id} className="hover:bg-gray-50">
                            <td className="px-6 py-4">
                              <div className="flex items-center gap-3">
                                <div className="flex h-9 w-9 items-center justify-center rounded-full bg-slate-100 text-xs font-semibold text-slate-600">
                                  {user.initials}
                                </div>
                                <span className="block text-sm font-semibold text-gray-900">{user.name}</span>
                              </div>
                            </td>
                            <td className="px-6 py-4 text-sm text-gray-500">{user.email || '-'}</td>
                            <td className="px-6 py-4">
                              <span
                                className={`inline-flex rounded-full px-2.5 py-1 text-xs font-medium ${
                                  user.role === 'admin'
                                    ? 'bg-orange-100 text-orange-700'
                                    : 'bg-slate-100 text-slate-600'
                                }`}
                              >
                                {toDisplayRole(user.role)}
                              </span>
                            </td>
                            <td className="px-6 py-4 text-sm text-gray-500">
                              {user.lastLoginDisplay}
                            </td>
                            <td className="px-6 py-4">
                              <span
                                className={`inline-flex rounded-full px-2.5 py-1 text-xs font-medium ${
                                  user.active
                                    ? 'bg-green-100 text-green-700'
                                    : 'bg-red-100 text-red-700'
                                }`}
                              >
                                {user.active ? 'Active' : 'Inactive'}
                              </span>
                            </td>
                            <td className="px-6 py-4">
                              <div className="flex flex-wrap items-center gap-2">
                                <button
                                  type="button"
                                  onClick={() => openEditModal(user)}
                                  className="inline-flex items-center gap-1 rounded-lg border border-gray-300 px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-100"
                                >
                                  <Edit3 size={14} />
                                  Edit
                                </button>
                                {user.active ? (
                                  <button
                                    type="button"
                                    onClick={() => handleDeactivate(user.id)}
                                    className="rounded-lg border border-red-200 px-3 py-1.5 text-xs font-medium text-red-600 hover:bg-red-50"
                                  >
                                    Deactivate
                                  </button>
                                ) : (
                                  <button
                                    type="button"
                                    onClick={() =>
                                      openEditModal({ ...user, active: true, status: 'Active' })
                                    }
                                    className="rounded-lg border border-green-200 px-3 py-1.5 text-xs font-medium text-green-700 hover:bg-green-50"
                                  >
                                    Activate
                                  </button>
                                )}
                                {canShowPermanentDelete(user) ? (
                                  <button
                                    type="button"
                                    onClick={() => openPermanentDeleteModal(user)}
                                    className="rounded-lg border border-red-300 px-3 py-1.5 text-xs font-semibold text-red-700 hover:bg-red-50"
                                  >
                                    Delete permanently
                                  </button>
                                ) : null}
                              </div>
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>

                <div className="flex items-center justify-between border-x border-b border-gray-200 bg-white px-6 py-4 text-sm text-gray-500 shadow-sm rounded-b-xl">
                  <span>Showing {filteredUsers.length} staff members</span>
                  <div className="flex items-center gap-2">
                    <button className="rounded border border-gray-200 px-3 py-1.5 text-gray-400" disabled>
                      Previous
                    </button>
                    <button className="rounded border border-gray-200 px-3 py-1.5 text-gray-500" disabled>
                      Next
                    </button>
                  </div>
                </div>

                {showInviteModal && (
                  <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
                    <div className="flex max-h-[90vh] w-full max-w-sm flex-col overflow-hidden rounded-2xl bg-white shadow-xl">
                      <div className="flex items-center justify-between border-b border-gray-200 px-5 py-4">
                        <h3 className="text-base font-semibold text-gray-900">
                          {editingUserId ? 'Edit User' : 'Invite User'}
                        </h3>
                        <button
                          onClick={closeUserModal}
                          className="rounded-lg p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600"
                        >
                          <X size={20} />
                        </button>
                      </div>

                      <div className="space-y-4 overflow-y-auto p-5">
                        {usersError ? (
                          <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                            {usersError}
                          </div>
                        ) : null}
                        <div>
                          <label className="mb-1 block text-[11px] font-medium text-gray-700">
                            Full Name <span className="text-red-500">*</span>
                          </label>
                          <input
                            type="text"
                            value={inviteForm.fullName}
                            onChange={(e) =>
                              setInviteForm({ ...inviteForm, fullName: e.target.value })
                            }
                            className="w-full rounded border border-gray-200 px-3 py-2 text-sm focus:border-[#ff9900] focus:outline-none focus:ring-2 focus:ring-orange-100"
                            placeholder="e.g. Lucy Palmer"
                          />
                        </div>
                        <div>
                          <label className="mb-1 block text-[11px] font-medium text-gray-700">
                            Email <span className="text-red-500">*</span>
                          </label>
                          <input
                            type="email"
                            value={inviteForm.email}
                            disabled={Boolean(editingUserId)}
                            onChange={(e) => {
                              const nextEmail = e.target.value;
                              setInviteForm({
                                ...inviteForm,
                                email: nextEmail,
                                clientEmail:
                                  inviteForm.role === 'client' &&
                                  (!inviteForm.clientEmail || inviteForm.clientEmail === inviteForm.email)
                                    ? nextEmail
                                    : inviteForm.clientEmail,
                              });
                            }}
                            className="w-full rounded border border-gray-200 px-3 py-2 text-sm disabled:bg-gray-100 disabled:text-gray-500 focus:border-[#ff9900] focus:outline-none focus:ring-2 focus:ring-orange-100"
                            placeholder="lucy@pickpackpro.co.uk"
                          />
                          {!editingUserId ? (
                            <p className="mt-1 text-xs text-gray-400">
                              An invite email will be sent to this address. The user will set their own password.
                            </p>
                          ) : null}
                        </div>
                        <div>
                          <label className="mb-1 block text-[11px] font-medium text-gray-700">Role</label>
                          <select
                            value={inviteForm.role}
                            onChange={(e) => {
                              setMissingClientEmail('');
                              setShowClientEmailRequiredPopup(false);
                              const nextRole = e.target.value;
                              setInviteForm({
                                ...inviteForm,
                                role: nextRole,
                                clientEmail:
                                  nextRole === 'client'
                                    ? inviteForm.clientEmail || inviteForm.email
                                    : '',
                                clientId: nextRole === 'client' ? inviteForm.clientId : '',
                              });
                            }}
                            className="w-full rounded border border-gray-200 px-3 py-2 text-sm focus:border-[#ff9900] focus:outline-none focus:ring-2 focus:ring-orange-100"
                          >
                            <option value="staff">Staff</option>
                            <option value="admin">Admin</option>
                            <option value="client">Client</option>
                          </select>
                        </div>
                        {inviteForm.role === 'client' ? (
                          <>
                            <div>
                              <label className="mb-1 block text-[11px] font-medium text-gray-700">
                                Client Company Email
                              </label>
                              <input
                                type="email"
                                value={inviteForm.clientEmail}
                                onChange={(e) => {
                                  setMissingClientEmail('');
                                  setShowClientEmailRequiredPopup(false);
                                  setInviteForm({ ...inviteForm, clientEmail: e.target.value });
                                }}
                                className="w-full rounded border border-gray-200 px-3 py-2 text-sm focus:border-[#ff9900] focus:outline-none focus:ring-2 focus:ring-orange-100"
                                placeholder="client@company.com"
                              />
                              <p className="mt-1 text-xs text-gray-400">
                                Leave blank to use the invite email for client linking.
                              </p>
                            </div>
                            
                          </>
                        ) : null}

                        {editingUserId ? (
                          <div>
                            <label className="mb-1 block text-[11px] font-medium text-gray-700">
                              Status
                            </label>
                            <select
                              value={inviteForm.active ? 'active' : 'inactive'}
                              onChange={(e) =>
                                setInviteForm({
                                  ...inviteForm,
                                  active: e.target.value === 'active',
                                })
                              }
                              className="w-full rounded border border-gray-200 px-3 py-2 text-sm focus:border-[#ff9900] focus:outline-none focus:ring-2 focus:ring-orange-100"
                            >
                              <option value="active">Active</option>
                              <option value="inactive">Inactive</option>
                            </select>
                          </div>
                        ) : null}
                      </div>

                      <div className="flex items-center justify-end gap-3 border-t border-gray-200 bg-gray-50 px-5 py-4 rounded-b-2xl">
                        <button
                          onClick={closeUserModal}
                          className="px-4 py-2 text-sm font-medium text-gray-600 hover:text-gray-900"
                        >
                          Cancel
                        </button>
                        <button
                          onClick={handleInvite}
                          disabled={isSubmittingUser}
                          className="rounded bg-[#ff9900] px-4 py-2 text-sm font-semibold text-white hover:bg-[#ea8b00] disabled:opacity-60"
                        >
                          {isSubmittingUser
                            ? editingUserId
                              ? 'Saving...'
                              : 'Sending...'
                            : editingUserId
                              ? 'Update User'
                              : 'Send Invite'}
                        </button>
                      </div>
                    </div>
                  </div>
                )}

                {permanentDeleteUser ? (
                  <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 p-4">
                    <div className="w-full max-w-md rounded-2xl bg-white shadow-xl">
                      <div className="border-b border-gray-200 px-6 py-5">
                        <h3 className="text-lg font-semibold text-gray-900">
                          Delete user permanently?
                        </h3>
                      </div>
                      <div className="space-y-4 px-6 py-5">
                        <p className="text-sm leading-6 text-gray-600">
                          This will permanently delete this user from the app and Supabase Auth. The same email can be invited again after deletion. This action cannot be undone.
                        </p>
                        <div className="rounded-lg border border-red-100 bg-red-50 px-4 py-3 text-sm text-red-700">
                          <p className="font-semibold text-red-800">
                            {permanentDeleteUser.name || 'Unnamed User'}
                          </p>
                          <p className="mt-1 break-all">{permanentDeleteUser.email || '-'}</p>
                        </div>
                        <div>
                          <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-gray-500">
                            Type DELETE to confirm
                          </label>
                          <input
                            type="text"
                            value={permanentDeleteConfirmation}
                            onChange={(event) => setPermanentDeleteConfirmation(event.target.value)}
                            className="w-full rounded-lg border border-gray-200 px-3 py-2.5 text-sm focus:border-red-400 focus:outline-none focus:ring-2 focus:ring-red-100"
                            autoComplete="off"
                          />
                        </div>
                      </div>
                      <div className="flex items-center justify-end gap-3 rounded-b-2xl border-t border-gray-200 bg-gray-50 px-6 py-4">
                        <button
                          type="button"
                          onClick={closePermanentDeleteModal}
                          disabled={isPermanentDeleting}
                          className="px-4 py-2 text-sm font-medium text-gray-600 hover:text-gray-900 disabled:opacity-60"
                        >
                          Cancel
                        </button>
                        <button
                          type="button"
                          onClick={handlePermanentDelete}
                          disabled={permanentDeleteConfirmation !== 'DELETE' || isPermanentDeleting}
                          className="rounded-lg bg-red-600 px-4 py-2 text-sm font-semibold text-white hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          Delete permanently
                        </button>
                      </div>
                    </div>
                  </div>
                ) : null}

                {missingClientEmail ? (
                  <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 p-4">
                    <div className="w-full max-w-md rounded-lg border border-orange-200 bg-orange-50 p-4 shadow-xl">
                      <div className="flex items-start justify-between gap-4">
                        <div className="text-sm text-orange-800">
                          <h4 className="text-base font-semibold">Client record required</h4>
                          <p className="mt-2 leading-6">
                            Create a client with {missingClientEmail} first, then come back and {editingUserId ? 'update' : 'invite'} this user.
                          </p>
                        </div>
                        <button
                          type="button"
                          onClick={() => setMissingClientEmail('')}
                          className="rounded p-1 text-orange-700 hover:bg-orange-100"
                          aria-label="Close client required popup"
                        >
                          <X size={18} />
                        </button>
                      </div>
                      <div className="mt-4 flex items-center gap-3">
                        <button
                          type="button"
                          onClick={() => goToClientCreate()}
                          className="rounded bg-[#ff9900] px-4 py-2 text-sm font-semibold text-white hover:bg-[#ea8b00]"
                        >
                          Go to Clients
                        </button>
                      </div>
                    </div>
                  </div>
                ) : null}

                {showClientEmailRequiredPopup ? (
                  <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 p-4">
                    <div className="w-full max-w-md rounded-lg border border-orange-200 bg-orange-50 p-4 shadow-xl">
                      <div className="flex items-start justify-between gap-4">
                        <div className="text-sm text-orange-800">
                          <h4 className="text-base font-semibold">Client record required</h4>
                          <p className="mt-2 leading-6">
                            Create a client with {inviteForm.email || 'this email'} first, then come back and invite this user.
                          </p>
                        </div>
                        <button
                          type="button"
                          onClick={() => setShowClientEmailRequiredPopup(false)}
                          className="rounded p-1 text-orange-700 hover:bg-orange-100"
                          aria-label="Close client email required popup"
                        >
                          <X size={18} />
                        </button>
                      </div>
                      <div className="mt-4 flex items-center gap-3">
                        <button
                          type="button"
                          onClick={() => goToClientCreate(inviteForm.email)}
                          className="rounded bg-[#ff9900] px-4 py-2 text-sm font-semibold text-white hover:bg-[#ea8b00]"
                        >
                          Go to Clients
                        </button>
                      </div>
                    </div>
                  </div>
                ) : null}
              </div>
            )}

            {activeTab === 'pricing' && (
              <div className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">
                <div className="border-b border-gray-200 px-6 py-4">
                  <h3 className="text-xs font-semibold uppercase tracking-[0.18em] text-gray-500">
                    Pricing Tier Thresholds
                  </h3>
                </div>
                <div className="space-y-8 px-6 py-6">
                  

                  <div className="space-y-8">
                    <div className="grid grid-cols-1 gap-6 md:grid-cols-[120px_minmax(0,1fr)_minmax(0,1fr)] md:items-center">
                      <div className="flex items-center gap-3">
                        <span className="h-3 w-3 rounded-full bg-slate-300" />
                        <span className="text-2xl font-semibold text-slate-800">Silver</span>
                      </div>
                      <div>
                        <label className="mb-1 block text-xs font-semibold uppercase tracking-wider text-gray-500">
                          Min Units/Month
                        </label>
                        <input
                          type="text"
                          inputMode="numeric"
                          value={pricingTiers.silver.minUnits}
                          readOnly
                          className="w-full cursor-not-allowed rounded-lg border border-gray-200 bg-gray-50 px-3 py-2.5 text-sm text-gray-500"
                        />
                      </div>
                      <div>
                        <label className="mb-1 block text-xs font-semibold uppercase tracking-wider text-gray-500">
                          Max Units/Month
                        </label>
                        <input
                          type="text"
                          inputMode="numeric"
                          value={pricingTiers.silver.invoiceMin}
                          readOnly
                          className="w-full cursor-not-allowed rounded-lg border border-gray-200 bg-gray-50 px-3 py-2.5 text-sm text-gray-500"
                        />
                      </div>
                    </div>

                    <div className="grid grid-cols-1 gap-6 md:grid-cols-[120px_minmax(0,1fr)_minmax(0,1fr)] md:items-center">
                      <div className="flex items-center gap-3">
                        <span className="h-3 w-3 rounded-full bg-amber-400" />
                        <span className="text-2xl font-semibold text-slate-800">Gold</span>
                      </div>
                      <div>
                        <label className="mb-1 block text-xs font-semibold uppercase tracking-wider text-gray-500">
                          Min Units/Month
                        </label>
                        <input
                          type="text"
                          inputMode="numeric"
                          value={pricingTiers.gold.minUnits}
                          readOnly
                          className="w-full cursor-not-allowed rounded-lg border border-gray-200 bg-gray-50 px-3 py-2.5 text-sm text-gray-500"
                        />
                      </div>
                      <div>
                        <label className="mb-1 block text-xs font-semibold uppercase tracking-wider text-gray-500">
                          Max Units/Month
                        </label>
                        <input
                          type="text"
                          inputMode="numeric"
                          value={pricingTiers.gold.invoiceMin}
                          readOnly
                          className="w-full cursor-not-allowed rounded-lg border border-gray-200 bg-gray-50 px-3 py-2.5 text-sm text-gray-500"
                        />
                      </div>
                    </div>

                    <div className="grid grid-cols-1 gap-6 md:grid-cols-[120px_minmax(0,1fr)_minmax(0,1fr)] md:items-center">
                      <div className="flex items-center gap-3">
                        <span className="h-3 w-3 rounded-full bg-slate-800" />
                        <span className="text-2xl font-semibold text-slate-800">Platinum</span>
                      </div>
                      <div>
                        <label className="mb-1 block text-xs font-semibold uppercase tracking-wider text-gray-500">
                          Min Units/Month
                        </label>
                        <input
                          type="text"
                          inputMode="numeric"
                          value={pricingTiers.platinum.minUnits}
                          readOnly
                          className="w-full cursor-not-allowed rounded-lg border border-gray-200 bg-gray-50 px-3 py-2.5 text-sm text-gray-500"
                        />
                      </div>
                      <div>
                        <label className="mb-1 block text-xs font-semibold uppercase tracking-wider text-gray-500">
                          Max Units/Month
                        </label>
                        <input
                          type="text"
                          inputMode="numeric"
                          value={pricingTiers.platinum.invoiceMin}
                          readOnly
                          className="w-full cursor-not-allowed rounded-lg border border-gray-200 bg-gray-50 px-3 py-2.5 text-sm text-gray-500"
                          placeholder="Unlimited"
                        />
                      </div>
                    </div>
                  </div>

                  <p className="rounded-lg border border-amber-100 bg-amber-50 px-4 py-3 text-sm text-amber-800">
                    These thresholds are system defaults. Contact support to change them.
                  </p>

                  <div className="border-t border-gray-200 pt-6">
                    <div className="mb-4">
                      <h4 className="text-sm font-semibold text-gray-900">Set Service Price</h4>
                      <p className="mt-1 text-sm text-gray-500">
                        Use global default or choose a client by company/email for a special rate.
                      </p>
                    </div>
                    {pricingError ? (
                      <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                        {pricingError}
                      </div>
                    ) : null}
                    {pricingMessage ? (
                      <div className="mb-4 rounded-lg border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-700">
                        {pricingMessage}
                      </div>
                    ) : null}
                    <div className={`grid grid-cols-1 items-start gap-4 ${
                      isPricingOtherServiceSelected
                        ? 'lg:grid-cols-[minmax(280px,1.4fr)_170px_minmax(190px,1fr)_160px_160px]'
                        : 'lg:grid-cols-[minmax(280px,1.4fr)_170px_160px_160px]'
                    }`}>
                      <div ref={pricingClientDropdownRef} className="relative">
                        <button
                          type="button"
                          onClick={() => setIsPricingClientDropdownOpen((isOpen) => !isOpen)}
                          className="flex w-full items-center justify-between gap-3 rounded-lg border border-gray-200 bg-white px-3 py-2.5 text-left text-sm focus:border-[#ff9900] focus:outline-none focus:ring-2 focus:ring-orange-100"
                          aria-expanded={isPricingClientDropdownOpen}
                          aria-haspopup="listbox"
                        >
                          <span className="truncate">
                            {selectedPricingClient?.label || 'Global default (all clients)'}
                          </span>
                          <ChevronDown
                            size={16}
                            className={`shrink-0 text-gray-400 transition-transform ${isPricingClientDropdownOpen ? 'rotate-180' : ''}`}
                          />
                        </button>

                        {isPricingClientDropdownOpen ? (
                          <div className="absolute left-0 right-0 z-30 mt-2 overflow-hidden rounded-lg border border-gray-200 bg-white shadow-lg">
                            <div className="border-b border-gray-100 p-2">
                              <div className="relative">
                                <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                                <input
                                  type="search"
                                  value={pricingClientSearch}
                                  onChange={(e) => setPricingClientSearch(e.target.value)}
                                  className="w-full rounded-lg border border-gray-200 py-2.5 pl-9 pr-3 text-sm focus:border-[#ff9900] focus:outline-none focus:ring-2 focus:ring-orange-100"
                                  placeholder="Search client name or email"
                                  aria-label="Search clients for pricing"
                                />
                              </div>
                            </div>
                            <div className="max-h-64 overflow-y-auto p-1" role="listbox">
                              <button
                                type="button"
                                onClick={() => handleSelectPricingClient('')}
                                className={`flex w-full items-center justify-between gap-3 rounded-md px-3 py-2 text-left text-sm hover:bg-orange-50 ${
                                  pricingForm.clientId ? 'text-gray-700' : 'bg-orange-50 text-[#ff6900]'
                                }`}
                                role="option"
                                aria-selected={!pricingForm.clientId}
                              >
                                <span className="truncate">Global default (all clients)</span>
                                {!pricingForm.clientId ? <Check size={15} className="shrink-0" /> : null}
                              </button>
                              {filteredPricingClientOptions.map((client) => {
                                const isSelected = pricingForm.clientId === client.value;

                                return (
                                  <button
                                    key={client.value}
                                    type="button"
                                    onClick={() => handleSelectPricingClient(client.value)}
                                    className={`flex w-full items-center justify-between gap-3 rounded-md px-3 py-2 text-left text-sm hover:bg-orange-50 ${
                                      isSelected ? 'bg-orange-50 text-[#ff6900]' : 'text-gray-700'
                                    }`}
                                    role="option"
                                    aria-selected={isSelected}
                                  >
                                    <span className="truncate">{client.label}</span>
                                    {isSelected ? <Check size={15} className="shrink-0" /> : null}
                                  </button>
                                );
                              })}
                              {!filteredPricingClientOptions.length ? (
                                <div className="px-3 py-3 text-sm text-gray-500">No clients found.</div>
                              ) : null}
                            </div>
                          </div>
                        ) : null}
                      </div>
                      <select
                        value={pricingForm.serviceType}
                        onChange={(e) => {
                          const nextServiceType = normalizeServiceCode(e.target.value);
                          setPricingForm({
                            ...pricingForm,
                            serviceType: nextServiceType,
                            customServiceType: String(nextServiceType || '').toUpperCase() === 'OTHER' ? pricingForm.customServiceType : '',
                          });
                        }}
                        className="rounded-lg border border-gray-200 bg-white px-3 py-2.5 text-sm focus:border-[#ff9900] focus:outline-none focus:ring-2 focus:ring-orange-100"
                        aria-label="Service Type"
                      >
                        <option value="">Service Type</option>
                        {serviceTypeOptions.map((option) => (
                          <option key={option.value} value={option.value}>
                            {option.label}
                          </option>
                        ))}
                      </select>
                      {isPricingOtherServiceSelected ? (
                        <input
                          type="text"
                          value={pricingForm.customServiceType}
                          onChange={(e) => setPricingForm({ ...pricingForm, customServiceType: e.target.value })}
                          className="rounded-lg border border-gray-200 px-3 py-2.5 text-sm focus:border-[#ff9900] focus:outline-none focus:ring-2 focus:ring-orange-100"
                          placeholder="Other service name"
                          aria-label="Other service name"
                        />
                      ) : null}
                      <select
                        value={pricingForm.tier}
                        onChange={(e) => setPricingForm({ ...pricingForm, tier: e.target.value })}
                        className="rounded-lg border border-gray-200 bg-white px-3 py-2.5 text-sm focus:border-[#ff9900] focus:outline-none focus:ring-2 focus:ring-orange-100"
                      >
                        <option value="silver">Silver</option>
                        <option value="gold">Gold</option>
                        <option value="platinum">Platinum</option>
                        <option value="others">Others</option>
                      </select>
                      <input
                        type="number"
                        step="0.01"
                        value={pricingForm.pricePerUnit}
                        onChange={(e) => setPricingForm({ ...pricingForm, pricePerUnit: e.target.value })}
                        className="rounded-lg border border-gray-200 px-3 py-2.5 text-sm focus:border-[#ff9900] focus:outline-none focus:ring-2 focus:ring-orange-100"
                        placeholder="0.45"
                      />
                      <textarea
                        value={pricingForm.notes}
                        onChange={(e) => setPricingForm({ ...pricingForm, notes: e.target.value })}
                        className={`min-h-20 rounded-lg border border-gray-200 px-3 py-2.5 text-sm focus:border-[#ff9900] focus:outline-none focus:ring-2 focus:ring-orange-100 ${isPricingOtherServiceSelected ? 'lg:col-span-5' : 'lg:col-span-4'}`}
                        placeholder="Special rate agreed with client"
                      />
                    </div>
                    <div className="mt-4 flex justify-end">
                      <button
                        onClick={handleSavePricing}
                        disabled={pricingLoading}
                        className="inline-flex items-center gap-2 rounded-lg bg-[#ff9900] px-5 py-2.5 text-sm font-semibold text-white hover:bg-[#ea8b00] disabled:opacity-60"
                      >
                        <Save size={15} />
                        Save Price
                      </button>
                    </div>

                    <div className="mt-6 overflow-hidden rounded-lg border border-gray-200">
                      <div className="border-b border-gray-200 bg-gray-50 px-4 py-3">
                        <h4 className="text-sm font-semibold text-gray-900">Saved Pricing</h4>
                      </div>
                      <div className="overflow-x-auto">
                        <table className="w-full">
                          <thead>
                            <tr className="border-b border-gray-100 bg-white">
                              <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-gray-500">Type</th>
                              <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-gray-500">Client</th>
                              <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-gray-500">Service</th>
                              <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-gray-500">Tier</th>
                              <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-gray-500">Price / Unit</th>
                              <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-gray-500">Notes</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-gray-50">
                            {pricingLoading ? (
                              <tr>
                                <td colSpan={6} className="px-4 py-8 text-center">
                                  <LoadingState label="Loading pricing..." />
                                </td>
                              </tr>
                            ) : pricingDisplayRows.length ? (
                              pricingDisplayRows.map((row) => (
                                <tr key={row.key}>
                                  <td className="px-4 py-3 text-sm">
                                    <span
                                      className={`inline-flex rounded-full px-2.5 py-1 text-xs font-semibold ${
                                        row.scope === 'Client special'
                                          ? 'bg-orange-50 text-[#ff6900]'
                                          : 'bg-gray-100 text-gray-600'
                                      }`}
                                    >
                                      {row.scope}
                                    </span>
                                  </td>
                                  <td className="max-w-[260px] px-4 py-3 text-sm text-gray-700">
                                    <span className="block truncate">{row.client}</span>
                                  </td>
                                  <td className="px-4 py-3 text-sm font-medium text-gray-900">{row.service || '-'}</td>
                                  <td className="px-4 py-3 text-sm text-gray-600">{row.tier || '-'}</td>
                                  <td className="px-4 py-3 text-sm font-semibold text-gray-900">{formatPricePerUnit(row.price)}</td>
                                  <td className="max-w-[320px] px-4 py-3 text-sm text-gray-600">
                                    <span className="block truncate">{row.notes || '-'}</span>
                                  </td>
                                </tr>
                              ))
                            ) : (
                              <tr>
                                <td colSpan={6} className="px-4 py-8 text-center text-sm text-gray-500">
                                  No saved pricing returned by backend.
                                </td>
                              </tr>
                            )}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  </div>
                </div>

 
              </div>
            )}

            {activeTab === 'notifications' && (
              <div className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">
                <div className="border-b border-gray-200 px-6 py-5">
                  <h3 className="text-2xl font-semibold text-[#132347]">Email Notification Triggers</h3>
                  <p className="mt-1 text-sm text-gray-500">
                    Define which events trigger automated communications to stakeholders.
                  </p>
                </div>

                <div className="border-b border-gray-200 px-6 py-5">
                  <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_220px]">
                    <div>
                      <p className="mb-3 text-xs font-semibold uppercase tracking-wider text-gray-500">
                        Working Days
                      </p>
                      <div className="flex flex-wrap gap-2">
                        {Object.entries(workingDays).map(([day, enabled]) => (
                          <button
                            key={day}
                            type="button"
                            onClick={() =>
                              setWorkingDays((current) => ({
                                ...current,
                                [day]: !current[day],
                              }))
                            }
                            className={`rounded-full px-3 py-1.5 text-xs font-semibold transition-colors ${
                              enabled
                                ? 'bg-[#ff9900] text-white'
                                : 'bg-gray-100 text-gray-500'
                            }`}
                          >
                            {day.slice(0, 3).toUpperCase()}
                          </button>
                        ))}
                      </div>
                    </div>

                    <div>
                      <label className="mb-1 block text-xs font-semibold uppercase tracking-wider text-gray-500">
                        Dispatch Lead Time (Hours)
                      </label>
                      <input
                        type="number"
                        value={dispatchLeadTimeHours}
                        onChange={(e) => setDispatchLeadTimeHours(e.target.value)}
                        className="w-full rounded-lg border border-gray-200 px-3 py-2.5 text-sm focus:border-[#ff9900] focus:outline-none focus:ring-2 focus:ring-orange-100"
                      />
                    </div>
                  </div>
                </div>

                <div className="overflow-x-auto">
                  <table className="w-full">
                    <thead className="bg-gray-50/80">
                      <tr className="border-b border-gray-200">
                        <th className="px-6 py-4 text-left text-xs font-semibold uppercase tracking-wider text-gray-500">Event</th>
                        <th className="px-6 py-4 text-left text-xs font-semibold uppercase tracking-wider text-gray-500">Recipient</th>
                        <th className="px-6 py-4 text-center text-xs font-semibold uppercase tracking-wider text-gray-500">Email</th>
                        <th className="px-6 py-4 text-center text-xs font-semibold uppercase tracking-wider text-gray-500">In-App</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {triggers.map((trigger) => (
                        <tr key={trigger.id}>
                          <td className="px-6 py-4 text-sm font-semibold text-gray-900">{trigger.label}</td>
                          <td className="px-6 py-4 text-sm text-gray-500">{trigger.recipient}</td>
                          <td className="px-6 py-4 text-center">
                            <button
                              type="button"
                              onClick={() => toggleTrigger(trigger.id, 'emailEnabled')}
                              className={`inline-flex h-4 w-4 items-center justify-center rounded border ${
                                trigger.emailEnabled
                                  ? 'border-[#ff9900] bg-[#ff9900] text-white'
                                  : 'border-gray-300 bg-white text-transparent'
                              }`}
                              aria-pressed={trigger.emailEnabled}
                              aria-label={`Toggle email for ${trigger.label}`}
                            >
                              <Check size={12} strokeWidth={3} />
                            </button>
                          </td>
                          <td className="px-6 py-4 text-center">
                            <button
                              type="button"
                              onClick={() => toggleTrigger(trigger.id, 'inAppEnabled')}
                              className={`inline-flex h-4 w-4 items-center justify-center rounded border ${
                                trigger.inAppEnabled
                                  ? 'border-[#ff9900] bg-[#ff9900] text-white'
                                  : 'border-gray-300 bg-white text-transparent'
                              }`}
                              aria-pressed={trigger.inAppEnabled}
                              aria-label={`Toggle in-app for ${trigger.label}`}
                            >
                              <Check size={12} strokeWidth={3} />
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                <div className="flex justify-end border-t border-gray-200 bg-white px-6 py-5">
                  <button
                    type="button"
                    onClick={() => handleSaveSettings('Notification settings')}
                    disabled={isSavingSettings}
                    className="rounded-lg bg-[#ff9900] px-5 py-2.5 text-sm font-semibold text-white hover:bg-[#ea8b00] disabled:opacity-60"
                  >
                    {isSavingSettings ? 'Saving...' : 'Save Settings'}
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </Layout>
  );
};

export default Settings;
