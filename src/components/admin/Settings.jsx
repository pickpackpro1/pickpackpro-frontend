import React, { useEffect, useMemo, useState } from 'react';
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
} from 'lucide-react';

const SETTINGS_ACTIVE_TAB_KEY = 'pickpackpro-settings-active-tab';
const PENDING_USER_EDIT_KEY = 'pending-settings-user-edit';
const API_BASE_URL = import.meta.env.DEV
  ? ''
  : (import.meta.env.VITE_API_BASE_URL || 'https://ali-backend.vercel.app');
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

const defaultServiceTypeOptions = [
  { value: 'FNSKU_LABEL', label: 'FNSKU Label' },
  { value: 'POLY_BAG', label: 'Poly Bag' },
  { value: 'BUBBLE_WRAP', label: 'Bubble Wrap' },
  { value: 'BUNDLING', label: 'Bundling' },
  { value: 'CUSTOM_SERVICE', label: 'Custom Service' },
];

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

    throw new Error(message);
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

const getServiceTypeValue = (service) =>
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
      ).trim();

const formatServiceTypeLabel = (value) =>
  String(value || '')
    .replace(/_/g, ' ')
    .toLowerCase()
    .replace(/\b\w/g, (letter) => letter.toUpperCase());

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
    if (value && typeof value === 'object') {
      return {
        ...value,
        serviceType:
          value.serviceType ||
          value.service_type ||
          value.type ||
          value.code ||
          value.value ||
          key,
        label:
          value.label ||
          value.name ||
          value.serviceName ||
          value.service_name ||
          formatServiceTypeLabel(key),
      };
    }

    return {
      serviceType: key,
      label: typeof value === 'string' ? value : formatServiceTypeLabel(key),
    };
  });
};

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
  const [showResendApiKey, setShowResendApiKey] = useState(false);
  const [isSavingSettings, setIsSavingSettings] = useState(false);
  const [isSettingsLoading, setIsSettingsLoading] = useState(false);
  const [usersSearchQuery, setUsersSearchQuery] = useState('');
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
  const [pricingLoading, setPricingLoading] = useState(false);
  const [pricingError, setPricingError] = useState('');
  const [pricingMessage, setPricingMessage] = useState('');
  const [pricingForm, setPricingForm] = useState({
    clientId: '',
    serviceType: 'FNSKU_LABEL',
    pricePerUnit: '',
    tier: 'silver',
    effectiveFrom: '',
    notes: '',
  });

  const [inviteForm, setInviteForm] = useState(initialInviteForm);
  const [autoInviteAfterClientCreate, setAutoInviteAfterClientCreate] = useState(false);

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
      pricingForm.serviceType
        ? {
            value: pricingForm.serviceType,
            label: formatServiceTypeLabel(pricingForm.serviceType),
          }
        : null,
    ].filter(Boolean);
    const seenValues = new Set();

    return mergedOptions.filter((option) => {
      const normalizedValue = String(option.value).toLowerCase();

      if (seenValues.has(normalizedValue)) {
        return false;
      }

      seenValues.add(normalizedValue);
      return true;
    });
  }, [pricingCatalog, pricingForm.serviceType]);

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

      const tierData = tiersPayload?.tiers || tiersPayload?.data || tiersPayload;
      setPricingTiers({
        silver: normalizePricingTier(tierData?.silver, initialPricingTiers.silver),
        gold: normalizePricingTier(tierData?.gold, initialPricingTiers.gold),
        platinum: normalizePricingTier(tierData?.platinum, initialPricingTiers.platinum),
      });

      setPricingCatalog(extractPricingCatalog(pricingPayload));
    } catch (error) {
      setPricingError(error.message);
      setPricingCatalog([]);
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

      if (!pricingForm.serviceType.trim()) {
        throw new Error('Service type is required.');
      }

      if (!pricingForm.pricePerUnit) {
        throw new Error('Price per unit is required.');
      }

      const response = await fetch(`${API_BASE_URL}/api/pricing`, {
        method: 'POST',
        headers: buildHeaders(true),
        body: JSON.stringify({
          clientId: pricingForm.clientId.trim() || undefined,
          serviceType: pricingForm.serviceType.trim(),
          tier: pricingForm.tier,
          pricePerUnit: Number(pricingForm.pricePerUnit || 0),
          notes: pricingForm.notes.trim() || undefined,
        }),
      });
      await parseResponse(response);
      setPricingMessage('Pricing updated successfully.');
      showToast('success', 'Pricing saved successfully.');
      await loadPricingData();
    } catch (error) {
      setPricingError(error.message);
      showToast('error', error.message || 'Failed to save pricing.');
    }
  };

  const filteredUsers = useMemo(() => {
    const query = usersSearchQuery.trim().toLowerCase();

    if (!query) {
      return users;
    }

    return users.filter(
      (user) =>
        user.name.toLowerCase().includes(query) ||
        user.email.toLowerCase().includes(query) ||
        user.role.toLowerCase().includes(query)
    );
  }, [users, usersSearchQuery]);

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
                              <div className="flex items-center gap-2">
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
                        Leave Client UUID empty to update the global default for this service tier.
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
                    <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_170px_160px_160px]">
                      <input
                        type="text"
                        value={pricingForm.clientId}
                        onChange={(e) => setPricingForm({ ...pricingForm, clientId: e.target.value })}
                        className="rounded-lg border border-gray-200 px-3 py-2.5 text-sm focus:border-[#ff9900] focus:outline-none focus:ring-2 focus:ring-orange-100"
                        placeholder="Client UUID optional"
                      />
                      <select
                        value={pricingForm.serviceType}
                        onChange={(e) => setPricingForm({ ...pricingForm, serviceType: e.target.value })}
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
                        className="min-h-20 rounded-lg border border-gray-200 px-3 py-2.5 text-sm focus:border-[#ff9900] focus:outline-none focus:ring-2 focus:ring-orange-100 lg:col-span-4"
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
