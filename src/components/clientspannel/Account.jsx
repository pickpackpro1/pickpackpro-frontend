import { useEffect, useMemo, useState } from 'react';
import LayoutClient from './clientlayout/LayoutClient';
import LoadingState from '../common/LoadingState';
import FullPageLoader from '../common/FullPageLoader';
import { Eye, EyeOff, Shield, X } from 'lucide-react';
import { getSession, saveSession } from '../../utils/auth';
import { getServiceDisplayName, getServiceKey, normalizeServiceCode } from '../../utils/serviceCatalog';

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

const toTitleCase = (value = '') =>
  String(value)
    .replaceAll('_', ' ')
    .split(' ')
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join(' ');

const formatServiceType = (value = '') => {
  if (!value) {
    return 'Service';
  }

  return getServiceDisplayName(value);
};

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

const formatBillingAddress = (address) => {
  if (!address) {
    return '';
  }

  if (typeof address === 'string') {
    return address;
  }

  return [address?.street, address?.city, address?.postcode, address?.country]
    .filter(Boolean)
    .join(', ');
};

const formatClientSince = (value) => {
  if (!value) {
    return '--';
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return String(value);
  }

  return date.toLocaleDateString('en-GB', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
};

const normalizeClientProfile = (session, authUser, clientRecord) => {
  const source = clientRecord || authUser?.client || authUser || session?.rawUser || {};

  return {
    company:
      source?.companyName ||
      source?.company_name ||
      source?.company ||
      source?.clientName ||
      source?.client_name ||
      source?.name ||
      source?.client?.companyName ||
      source?.client?.company_name ||
      source?.client?.company ||
      authUser?.companyName ||
      authUser?.company_name ||
      authUser?.company ||
      authUser?.clientName ||
      authUser?.client_name ||
      session?.companyName ||
      session?.company_name ||
      session?.company ||
      session?.rawUser?.companyName ||
      session?.rawUser?.company_name ||
      session?.rawUser?.company ||
      'Global Logistics Partners LLC',
    tier: toTitleCase(
      source?.pricingTierOverride ||
        source?.pricing_tier_override ||
        source?.pricingTier ||
        source?.pricing_tier ||
        'platinum'
    ),
    contactName:
      source?.contactName ||
      source?.contact_name ||
      authUser?.name ||
      session?.name ||
      'Marcus Sterling',
    clientSince: formatClientSince(
      source?.createdAt || source?.created_at || authUser?.createdAt || authUser?.created_at
    ),
    email:
      source?.email ||
      source?.contactEmail ||
      source?.contact_email ||
      authUser?.email ||
      session?.email ||
      'm.sterling@logistics-pro.com',
    phone: source?.phone || source?.contactPhone || source?.contact_phone || '+1 (555) 012-3456',
    vatNumber: source?.vatNumber || source?.vat_number || 'GB 123 4567 89',
    billingAddress:
      formatBillingAddress(source?.billingAddress || source?.billing_address) ||
      '122 High Street, North Point Business Park, London, UK, EC1V 4PY',
  };
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

  if (Array.isArray(source)) return source;
  if (!source || typeof source !== 'object') return [];

  return Object.entries(source).map(([key, value]) =>
    value && typeof value === 'object'
      ? {
          ...value,
          serviceType: normalizeServiceCode(
            value?.serviceType ||
              value?.service_type ||
              value?.type ||
              value?.code ||
              value?.value ||
              key
          ),
        }
      : {
          serviceType: normalizeServiceCode(key),
          label: typeof value === 'string' ? value : formatServiceType(key),
        }
  );
};

const findMatchingPrice = (collection, matcher) => {
  if (!Array.isArray(collection)) {
    return null;
  }

  return collection.find(matcher) || null;
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

const toObjectValue = (value) => {
  const parsed = parseJsonValue(value, {});
  return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
};

const resolvePricingRow = (entry, clientId, clientTier) => {
  const tierKey = String(clientTier || '').trim().toLowerCase();
  const clientPrices =
    entry?.clientPrices || entry?.client_prices || entry?.overrides || entry?.priceOverrides || [];
  const tierPrices = toObjectValue(
    entry?.default_tier_pricing ||
    entry?.defaultTierPricing ||
    entry?.tierPrices ||
    entry?.tier_prices ||
    entry?.tiers ||
    {}
  );
  const serviceCode = normalizeServiceCode(
    entry?.serviceType ||
      entry?.service_type ||
      entry?.service ||
      entry?.code ||
      entry?.name ||
      entry?.label
  );

  const matchedClientPrice = findMatchingPrice(
    clientPrices,
    (item) =>
      String(item?.clientId || item?.client_id || '').trim() === String(clientId || '').trim()
  );

  const tierPriceSource =
    (tierKey && (tierPrices?.[tierKey] || tierPrices?.[tierKey.toUpperCase()])) ||
    entry?.[tierKey] ||
    null;

  const resolvedSource =
    matchedClientPrice ||
    tierPriceSource ||
    entry?.defaultPrice ||
    entry?.default_price ||
    entry?.pricing ||
    entry;

  const pricePerUnit =
    resolvedSource?.pricePerUnit ??
    resolvedSource?.price_per_unit ??
    resolvedSource?.unitPrice ??
    resolvedSource?.unit_price ??
    resolvedSource?.rate ??
    resolvedSource?.price ??
    tierPrices?.rate ??
    entry?.pricePerUnit ??
    entry?.price_per_unit ??
    entry?.unitPrice ??
    entry?.unit_price ??
    entry?.price;

  return {
    serviceKey: getServiceKey(serviceCode),
    service: formatServiceType(serviceCode),
    tier:
      toTitleCase(
        matchedClientPrice?.tier ||
          matchedClientPrice?.pricingTier ||
          matchedClientPrice?.pricing_tier ||
          resolvedSource?.tier ||
          resolvedSource?.pricingTier ||
          resolvedSource?.pricing_tier ||
          clientTier ||
          ''
      ) || '-',
    pricePerUnit: formatPricePerUnit(pricePerUnit),
    notes:
      matchedClientPrice?.notes ||
      matchedClientPrice?.description ||
      resolvedSource?.notes ||
      resolvedSource?.description ||
      (matchedClientPrice
        ? 'Client-specific rate'
        : tierKey
          ? `Tier-based rate (${toTitleCase(tierKey)})`
          : 'Default rate'),
  };
};

const normalizePricingRows = (payload, clientId, clientTier) => {
  const seenServices = new Set();

  return extractPricingCatalog(payload)
    .map((entry) => resolvePricingRow(entry, clientId, clientTier))
    .filter((row) => {
      if (!row.service || row.pricePerUnit === '-') return false;
      if (seenServices.has(row.serviceKey)) return false;
      seenServices.add(row.serviceKey);
      return true;
    });
};

const Account = () => {
  const [session] = useState(() => getSession());
  const [showCurrentPassword, setShowCurrentPassword] = useState(false);
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [is2FAEnabled, setIs2FAEnabled] = useState(false);
  const [showEditProfileModal, setShowEditProfileModal] = useState(false);
  const [profileData, setProfileData] = useState(() => normalizeClientProfile(session, null, null));
  const [isLoadingProfile, setIsLoadingProfile] = useState(false);
  const [profileError, setProfileError] = useState('');
  const [isSavingProfile, setIsSavingProfile] = useState(false);
  const [profileSaveError, setProfileSaveError] = useState('');
  const [pricingRates, setPricingRates] = useState([]);
  const [isLoadingPricing, setIsLoadingPricing] = useState(false);
  const [pricingError, setPricingError] = useState('');
  const [passwordForm, setPasswordForm] = useState({
    currentPassword: '',
    newPassword: '',
    confirmPassword: '',
  });

  const profile = useMemo(() => profileData, [profileData]);

  const [profileForm, setProfileForm] = useState({
    company: profile.company,
    contactName: profile.contactName,
    email: profile.email,
    phone: profile.phone,
    vatNumber: profile.vatNumber,
    billingAddress: profile.billingAddress,
  });

  useEffect(() => {
    setProfileForm({
      company: profile.company,
      contactName: profile.contactName,
      email: profile.email,
      phone: profile.phone,
      vatNumber: profile.vatNumber,
      billingAddress: profile.billingAddress,
    });
  }, [profile]);

  useEffect(() => {
    let isMounted = true;

    const loadProfile = async () => {
      try {
        setIsLoadingProfile(true);
        setProfileError('');
        setIsLoadingPricing(true);
        setPricingError('');

        const authResponse = await fetch(`${API_BASE_URL}/api/auth/me`, {
          method: 'GET',
          headers: buildHeaders(),
        });
        const authPayload = await parseResponse(authResponse);
        const authUser = authPayload?.user || authPayload?.data || authPayload || {};
        const clientId =
          authUser?.clientId ||
          authUser?.client_id ||
          authUser?.client?.id ||
          session?.rawUser?.clientId ||
          session?.rawUser?.client_id ||
          session?.rawUser?.client?.id ||
          '';

        const [clientResult, pricingResult] = await Promise.allSettled([
          clientId
            ? fetch(`${API_BASE_URL}/api/clients/${clientId}`, {
                method: 'GET',
                headers: buildHeaders(),
              }).then(parseResponse)
            : Promise.resolve(null),
          fetch(`${API_BASE_URL}/api/pricing`, {
            method: 'GET',
            headers: buildHeaders(),
          }).then(parseResponse),
        ]);

        const clientRecord =
          clientResult.status === 'fulfilled'
            ? clientResult.value?.client || clientResult.value?.data || clientResult.value || null
            : null;

        if (pricingResult.status !== 'fulfilled') {
          throw pricingResult.reason;
        }

        if (!isMounted) {
          return;
        }

        const normalizedProfile = normalizeClientProfile(session, authUser, clientRecord);
        setProfileData(normalizedProfile);
        setPricingRates(
          normalizePricingRows(pricingResult.value, clientId, normalizedProfile.tier)
        );
      } catch (error) {
        if (!isMounted) {
          return;
        }

        setProfileError(error.message || 'Failed to load account details.');
        setProfileData(normalizeClientProfile(session, null, null));
        setPricingRates([]);
        setPricingError(error.message || 'Failed to load pricing rates.');
      } finally {
        if (isMounted) {
          setIsLoadingProfile(false);
          setIsLoadingPricing(false);
        }
      }
    };

    loadProfile();

    return () => {
      isMounted = false;
    };
  }, [session]);

  const handleUpdatePassword = (e) => {
    e.preventDefault();
  };

  const handleOpenEditProfile = () => {
    setProfileForm({
      company: profile.company,
      contactName: profile.contactName,
      email: profile.email,
      phone: profile.phone,
      vatNumber: profile.vatNumber,
      billingAddress: profile.billingAddress,
    });
    setProfileSaveError('');
    setShowEditProfileModal(true);
  };

  const handleSaveProfile = async () => {
    try {
      setIsSavingProfile(true);
      setProfileSaveError('');

      const payload = {
        companyName: String(profileForm.company || '').trim(),
        contactName: String(profileForm.contactName || '').trim(),
        phone: String(profileForm.phone || '').trim(),
        vatNumber: String(profileForm.vatNumber || '').trim(),
        billingAddress: String(profileForm.billingAddress || '').trim(),
      };

      const response = await fetch(`${API_BASE_URL}/api/clients/me`, {
        method: 'PATCH',
        headers: buildHeaders(true),
        body: JSON.stringify(payload),
      });
      const result = await parseResponse(response);
      const updatedClient = result?.data || result?.client || result;
      const normalizedProfile = normalizeClientProfile(session, null, updatedClient);

      setProfileData(normalizedProfile);

      const currentSession = getSession();
      if (currentSession) {
        saveSession({
          ...currentSession,
          companyName: updatedClient?.companyName || updatedClient?.company_name || normalizedProfile.company,
          company_name: updatedClient?.company_name || updatedClient?.companyName || normalizedProfile.company,
          name: updatedClient?.contactName || updatedClient?.contact_name || normalizedProfile.contactName,
          rawUser: {
            ...(currentSession.rawUser || {}),
            companyName: updatedClient?.companyName || updatedClient?.company_name || normalizedProfile.company,
            company_name: updatedClient?.company_name || updatedClient?.companyName || normalizedProfile.company,
            client: {
              ...((currentSession.rawUser || {}).client || {}),
              ...updatedClient,
            },
          },
        });
      }

      setShowEditProfileModal(false);
    } catch (error) {
      setProfileSaveError(error.message || 'Failed to update profile.');
    } finally {
      setIsSavingProfile(false);
    }
  };

  return (
    <LayoutClient>
      <FullPageLoader show={isLoadingProfile || isLoadingPricing} label="Loading account..." />
      <div className="min-h-screen bg-[#f3f6fb]">
        <div className="">
          {profileError ? (
            <div className="mb-6 rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">
              {profileError}
            </div>
          ) : null}

          <div className="">
            <div className="space-y-6">
              <div className="rounded-2xl border border-[#dce5f1] bg-white p-6">
                <div className="mb-6 flex items-center justify-between">
                  <h2 className="text-xs font-semibold uppercase tracking-[0.16em] text-[#64748b]">My Details</h2>
                  <button
                    type="button"
                    onClick={handleOpenEditProfile}
                    className="text-sm font-medium text-[#ff8c2f] hover:text-[#f67d17]"
                  >
                    Edit Profile
                  </button>
                </div>
                <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
                  <div>
                    <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[#94a3b8]">Company</p>
                    <p className="mt-2 text-lg font-semibold text-[#132347]">
                      {isLoadingProfile ? <LoadingState label="Loading..." /> : profile.company}
                    </p>
                  </div>
                  <div>
                    <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[#94a3b8]">Pricing Tier</p>
                    <span className="mt-2 inline-flex rounded-full bg-[#ffb545] px-3 py-1 text-xs font-semibold text-[#132347]">
                      {String(profile.tier).toUpperCase()}
                    </span>
                  </div>
                  <div>
                    <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[#94a3b8]">Contact Name</p>
                    <p className="mt-2 text-sm font-semibold text-[#132347]">{profile.contactName}</p>
                  </div>
                  <div>
                    <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[#94a3b8]">Client Since</p>
                    <p className="mt-2 text-sm font-semibold text-[#132347]">{profile.clientSince}</p>
                  </div>
                  <div>
                    <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[#94a3b8]">Email Address</p>
                    <p className="mt-2 text-sm font-semibold text-[#132347]">{profile.email}</p>
                  </div>
                  <div>
                    <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[#94a3b8]">Phone Number</p>
                    <p className="mt-2 text-sm font-semibold text-[#132347]">{profile.phone}</p>
                  </div>
                  <div>
                    <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[#94a3b8]">VAT Number</p>
                    <p className="mt-2 text-sm font-semibold text-[#132347]">{profile.vatNumber}</p>
                  </div>
                  <div className="md:col-span-2">
                    <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[#94a3b8]">Billing Address</p>
                    <p className="mt-2 max-w-md text-sm font-medium leading-6 text-[#132347]">{profile.billingAddress}</p>
                  </div>
                </div>
              </div>

              <div className="rounded-2xl border border-[#dce5f1] bg-white">
                <div className="border-b border-[#edf2f7] px-6 py-4">
                  <h3 className="text-xs font-semibold uppercase tracking-[0.14em] text-[#64748b]">Pricing - My Rates</h3>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full">
                    <thead>
                      <tr className="border-b border-[#edf2f7] bg-[#f8fbff]">
                        <th className="px-6 py-4 text-left text-xs font-semibold uppercase tracking-wider text-gray-500">Service Type</th>
                        <th className="px-6 py-4 text-left text-xs font-semibold uppercase tracking-wider text-gray-500">Tier</th>
                        <th className="px-6 py-4 text-left text-xs font-semibold uppercase tracking-wider text-gray-500">Price / Unit</th>
                        <th className="px-6 py-4 text-left text-xs font-semibold uppercase tracking-wider text-gray-500">Notes</th>
                      </tr>
                    </thead>
                    <tbody>
                      {isLoadingPricing ? (
                        <tr>
                          <td colSpan="4" className="px-6 py-10 text-center text-sm text-gray-500">
                            <LoadingState label="Loading pricing rates..." />
                          </td>
                        </tr>
                      ) : pricingError ? (
                        <tr>
                          <td colSpan="4" className="px-6 py-10 text-center text-sm text-red-600">
                            {pricingError}
                          </td>
                        </tr>
                      ) : pricingRates.length === 0 ? (
                        <tr>
                          <td colSpan="4" className="px-6 py-10 text-center text-sm text-gray-500">
                            No pricing rates found for this client.
                          </td>
                        </tr>
                      ) : (
                        pricingRates.map((item) => (
                          <tr key={`${item.service}-${item.tier}`} className="border-b border-gray-50 last:border-b-0">
                            <td className="px-6 py-4 text-sm font-semibold text-[#132347]">{item.service}</td>
                            <td className="px-6 py-4 text-sm text-[#475569]">{item.tier}</td>
                            <td className="px-6 py-4 text-sm font-semibold text-[#12b3a6]">{item.pricePerUnit}</td>
                            <td className="px-6 py-4 text-sm text-[#475569]">{item.notes || '-'}</td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
                <div className="px-6 py-4 text-center text-sm font-medium text-[#ff8c2f]">
                  {/* Rates are loaded from the pricing API. */}
                </div>
              </div>
            </div>

            {/* <div className="space-y-6">
              <div className="rounded-2xl border border-[#dce5f1] bg-white p-6">
                <h3 className="mb-6 text-xs font-semibold uppercase tracking-[0.14em] text-[#64748b]">Change Password</h3>
                <form onSubmit={handleUpdatePassword} className="space-y-5">
                  {[
                    ['Current Password', 'currentPassword', showCurrentPassword, setShowCurrentPassword],
                    ['New Password', 'newPassword', showNewPassword, setShowNewPassword],
                    ['Confirm New Password', 'confirmPassword', showConfirmPassword, setShowConfirmPassword],
                  ].map(([label, key, visible, setVisible]) => (
                    <div key={key}>
                      <label className="mb-2 block text-sm font-medium text-[#132347]">{label}</label>
                      <div className="relative">
                        <input
                          type={visible ? 'text' : 'password'}
                          value={passwordForm[key]}
                          onChange={(e) => setPasswordForm((prev) => ({ ...prev, [key]: e.target.value }))}
                          className="w-full rounded-lg border border-[#dce5f1] px-4 py-3 pr-11 text-sm text-[#132347] focus:border-transparent focus:outline-none focus:ring-2 focus:ring-[#ff8c2f]"
                        />
                        <button
                          type="button"
                          onClick={() => setVisible(!visible)}
                          className="absolute right-3 top-1/2 -translate-y-1/2 text-[#94a3b8]"
                        >
                          {visible ? <EyeOff size={16} /> : <Eye size={16} />}
                        </button>
                      </div>
                    </div>
                  ))}
                  <p className="text-xs text-[#94a3b8]">Min. 8 characters with at least one number and one symbol.</p>
                  <button type="submit" className="w-full rounded-lg bg-[#ff8c2f] px-4 py-3 text-sm font-semibold text-white">
                    Update Password
                  </button>
                </form>
              </div>

              <div className="rounded-2xl border border-[#dce5f1] bg-white p-6">
                <div className="flex items-start gap-3">
                  <div className="mt-0.5 rounded-full bg-[#fff7ed] p-2 text-[#ff8c2f]">
                    <Shield size={16} />
                  </div>
                  <div>
                    <h3 className="text-sm font-semibold text-[#132347]">Two-Factor Authentication</h3>
                    <p className="mt-1 text-sm text-[#64748b]">Recommended for additional account security.</p>
                    <button
                      type="button"
                      onClick={() => setIs2FAEnabled(!is2FAEnabled)}
                      className="mt-3 text-sm font-medium text-[#ff8c2f]"
                    >
                      {is2FAEnabled ? 'Disable 2FA' : 'Enable 2FA'}
                    </button>
                  </div>
                </div>
              </div>
            </div> */}
          </div>
        </div>
      </div>

      {showEditProfileModal ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4">
          <div className="w-full max-w-2xl rounded-2xl bg-white shadow-2xl">
            <div className="flex items-center justify-between border-b border-[#ebf0f7] px-6 py-5">
              <div>
                <h2 className="text-2xl font-semibold text-[#132347]">Edit Profile</h2>
                <p className="mt-1 text-sm text-[#7a8ca5]">Update your client account details.</p>
              </div>
              <button
                type="button"
                onClick={() => setShowEditProfileModal(false)}
                className="rounded-full p-2 text-[#94a3b8] hover:bg-[#f8fafc]"
              >
                <X size={18} />
              </button>
            </div>

            <div className="grid grid-cols-1 gap-4 px-6 py-6 md:grid-cols-2">
              <div>
                <label className="mb-2 block text-[10px] font-semibold uppercase tracking-[0.14em] text-[#6b7280]">Company</label>
                <input
                  value={profileForm.company}
                  onChange={(e) => setProfileForm((prev) => ({ ...prev, company: e.target.value }))}
                  className="w-full rounded-lg border border-[#dde6f2] px-4 py-3 text-sm"
                />
              </div>
              <div>
                <label className="mb-2 block text-[10px] font-semibold uppercase tracking-[0.14em] text-[#6b7280]">Contact Name</label>
                <input
                  value={profileForm.contactName}
                  onChange={(e) => setProfileForm((prev) => ({ ...prev, contactName: e.target.value }))}
                  className="w-full rounded-lg border border-[#dde6f2] px-4 py-3 text-sm"
                />
              </div>
              <div>
                <label className="mb-2 block text-[10px] font-semibold uppercase tracking-[0.14em] text-[#6b7280]">Email Address</label>
                <input
                  value={profileForm.email}
                  readOnly
                  className="w-full cursor-not-allowed rounded-lg border border-[#dde6f2] bg-gray-50 px-4 py-3 text-sm text-gray-500"
                />
                <p className="mt-1 text-xs text-[#94a3b8]">Email changes are not supported from the client profile page.</p>
              </div>
              <div>
                <label className="mb-2 block text-[10px] font-semibold uppercase tracking-[0.14em] text-[#6b7280]">Phone Number</label>
                <input
                  value={profileForm.phone}
                  onChange={(e) => setProfileForm((prev) => ({ ...prev, phone: e.target.value }))}
                  className="w-full rounded-lg border border-[#dde6f2] px-4 py-3 text-sm"
                />
              </div>
              <div>
                <label className="mb-2 block text-[10px] font-semibold uppercase tracking-[0.14em] text-[#6b7280]">VAT Number</label>
                <input
                  value={profileForm.vatNumber}
                  onChange={(e) => setProfileForm((prev) => ({ ...prev, vatNumber: e.target.value }))}
                  className="w-full rounded-lg border border-[#dde6f2] px-4 py-3 text-sm"
                />
              </div>
              <div className="md:col-span-2">
                <label className="mb-2 block text-[10px] font-semibold uppercase tracking-[0.14em] text-[#6b7280]">Billing Address</label>
                <textarea
                  value={profileForm.billingAddress}
                  onChange={(e) => setProfileForm((prev) => ({ ...prev, billingAddress: e.target.value }))}
                  className="min-h-[110px] w-full rounded-lg border border-[#dde6f2] px-4 py-3 text-sm"
                />
              </div>
            </div>
            {profileSaveError ? (
              <div className="mx-6 mb-5 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                {profileSaveError}
              </div>
            ) : null}

            <div className="flex items-center justify-end gap-3 border-t border-[#ebf0f7] px-6 py-5">
              <button
                type="button"
                onClick={() => {
                  if (isSavingProfile) return;
                  setShowEditProfileModal(false);
                }}
                disabled={isSavingProfile}
                className="rounded-lg border border-[#d7dfec] bg-white px-5 py-2.5 text-sm font-medium text-[#475569]"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleSaveProfile}
                disabled={isSavingProfile}
                className="rounded-lg bg-[#ff8c2f] px-5 py-2.5 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-60"
              >
                {isSavingProfile ? 'Saving...' : 'Save Changes'}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </LayoutClient>
  );
};

export default Account;
