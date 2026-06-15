const humanizeService = (value = '') =>
  String(value || '')
    .trim()
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .toLowerCase()
    .replace(/\b\w/g, (letter) => letter.toUpperCase());

export const SERVICE_CATALOG = [
  { code: 'fnsku_label', label: 'FNSKU Labelling' },
  { code: 'polybag', label: 'Polybag' },
  { code: 'bundling', label: 'Bundling' },
  { code: 'bubble_wrap', label: 'Bubble Wrap' },
  { code: 'leaflet_insertion', label: 'Marketing Leaflet Insertion' },
  { code: 'oversize_surcharge', label: 'Oversize Items' },
  { code: 'medium_box', label: 'Medium Box' },
  { code: 'large_box', label: 'Large Box' },
  { code: 'return_processing', label: 'Return Processing' },
  { code: 'pallet_forwarding', label: 'Pallet Forwarding' },
  { code: 'box_forwarding', label: 'Only Box Forwarding' },
  { code: 'pallet_storage', label: 'Pallet Storage' },
  { code: 'box_receiving_forwarding', label: 'Box Receiving and Forwarding' },
  { code: 'shipping_label_charge', label: 'Shipping Label Charges' },
];

export const SERVICE_SELECT_OPTIONS = [
  ...SERVICE_CATALOG
    .filter((service) =>
      [
        'fnsku_label',
        'bundling',
        'polybag',
        'bubble_wrap',
        'leaflet_insertion',
        'oversize_surcharge',
        'return_processing',
      ].includes(service.code)
    )
    .map((service) => ({ value: service.code, label: service.label })),
  { value: 'OTHER', label: 'Other' },
];

const aliasKey = (value = '') =>
  String(value || '')
    .trim()
    .toLowerCase()
    .replace(/&/g, 'and')
    .replace(/[^a-z0-9]+/g, '');

const SERVICE_ALIASES = new Map();

const addServiceAliases = (code, aliases = []) => {
  const service = SERVICE_CATALOG.find((entry) => entry.code === code);
  [code, service?.label, ...aliases].filter(Boolean).forEach((alias) => {
    SERVICE_ALIASES.set(aliasKey(alias), code);
  });
};

addServiceAliases('fnsku_label', ['FNSKU_LABEL', 'FNSKU_LABELING', 'FNSKU Label', 'FNSKU Labeling']);
addServiceAliases('polybag', ['POLY_BAG', 'poly_bag', 'Poly Bag']);
addServiceAliases('bundling', ['BUNDLING']);
addServiceAliases('bubble_wrap', ['BUBBLE_WRAP', 'Bubblewrap']);
addServiceAliases('leaflet_insertion', ['LEAFLET_INSERTION', 'Leaflet Insertion']);
addServiceAliases('oversize_surcharge', ['OVERSIZE_SURCHARGE', 'Oversize Surcharge']);
addServiceAliases('medium_box', ['MEDIUM_BOX']);
addServiceAliases('large_box', ['LARGE_BOX']);
addServiceAliases('return_processing', ['RETURN_PROCESSING']);
addServiceAliases('pallet_forwarding', ['PALLET_FORWARDING']);
addServiceAliases('box_forwarding', ['BOX_FORWARDING']);
addServiceAliases('pallet_storage', ['PALLET_STORAGE']);
addServiceAliases('box_receiving_forwarding', ['BOX_RECEIVING_FORWARDING']);
addServiceAliases('shipping_label_charge', ['SHIPPING_LABEL_CHARGE']);

export const getServiceRawValue = (value = '') => {
  if (!value || typeof value !== 'object') return String(value || '').trim();

  return String(
    value?.serviceType ||
      value?.service_type ||
      value?.serviceCode ||
      value?.service_code ||
      value?.code ||
      value?.type ||
      value?.value ||
      value?.id ||
      value?.label ||
      value?.name ||
      value?.serviceName ||
      value?.service_name ||
      ''
  ).trim();
};

export const normalizeServiceCode = (value = '') => {
  const rawValue = getServiceRawValue(value);
  if (!rawValue) return '';

  const normalized = SERVICE_ALIASES.get(aliasKey(rawValue));
  return normalized || rawValue;
};

export const getServiceDisplayName = (value = '') => {
  const rawValue = getServiceRawValue(value);
  if (!rawValue) return '';

  const code = normalizeServiceCode(rawValue);
  return SERVICE_CATALOG.find((service) => service.code === code)?.label || humanizeService(rawValue);
};

export const getServiceKey = (value = '') => {
  const normalized = normalizeServiceCode(value);
  return SERVICE_ALIASES.has(aliasKey(normalized)) ? normalizeServiceCode(normalized) : aliasKey(getServiceDisplayName(normalized));
};

export const isSameService = (left = '', right = '') => {
  const leftKey = getServiceKey(left);
  const rightKey = getServiceKey(right);
  return Boolean(leftKey && rightKey && leftKey === rightKey);
};

export const isOtherServiceCode = (value = '') => aliasKey(getServiceRawValue(value)) === 'other';

export const isBundlingService = (value = '') => isSameService(value, 'bundling');

export const isKnownServiceCode = (value = '') => SERVICE_CATALOG.some((service) => service.code === normalizeServiceCode(value));

export const STANDARD_SERVICE_KEYS = new Set(SERVICE_CATALOG.map((service) => service.code));

const flattenServices = (values = []) =>
  values.flatMap((value) => {
    if (Array.isArray(value)) return flattenServices(value);
    if (value && typeof value === 'object') return [getServiceRawValue(value)];
    return String(value || '').split(/[;,|]/);
  });

export const normalizeServiceList = (...values) => {
  const services = [];
  const seen = new Set();

  flattenServices(values)
    .map((service) => normalizeServiceCode(String(service || '').split('/')[0]))
    .filter(Boolean)
    .forEach((service) => {
      const key = getServiceKey(service);
      if (!key || seen.has(key)) return;
      seen.add(key);
      services.push(service);
    });

  return services;
};
