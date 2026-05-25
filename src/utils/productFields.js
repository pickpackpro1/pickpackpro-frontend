const isPresent = (value) => value !== null && value !== undefined && String(value).trim() !== '';

const toFiniteNumber = (value) => {
  if (!isPresent(value)) return null;
  const number = Number(String(value).replace(/[^\d.-]/g, ''));
  return Number.isFinite(number) ? number : null;
};

const isUsefulValue = (value) => {
  if (!isPresent(value)) return false;
  const number = toFiniteNumber(value);
  return number === null ? true : number > 0;
};

const firstPresent = (...values) => values.find(isPresent) ?? '';

const formatValue = (value) => {
  const number = toFiniteNumber(value);
  if (number === null) return String(value).trim();
  return Number.isInteger(number) ? String(number) : String(Number(number.toFixed(2)));
};

const getNestedValue = (source, keys = []) => {
  if (!source || typeof source !== 'object') return '';
  return firstPresent(...keys.map((key) => source?.[key]));
};

const parseDimensionString = (value) => {
  if (typeof value !== 'string') return null;
  const parts = value.match(/[\d.]+/g);
  if (!parts || parts.length < 3) return null;

  return {
    length: parts[0],
    width: parts[1],
    height: parts[2],
  };
};

const dimensionSources = (product = {}) => [
  product?.dimensions,
  product?.dimension,
  product?.dims,
  product?.packageDimensions,
  product?.package_dimensions,
  product?.metadata?.dimensions,
  product?.meta?.dimensions,
].filter(Boolean);

export const getProductDimensionParts = (product = {}) => {
  const dimensionObject = dimensionSources(product).find((source) => source && typeof source === 'object') || {};
  const dimensionString = dimensionSources(product).find((source) => typeof source === 'string');
  const parsedDimensions = parseDimensionString(dimensionString) || {};

  const length = firstPresent(
    product?.lengthCm,
    product?.lengthCM,
    product?.length_cm,
    product?.length,
    product?.lengthCmValue,
    product?.packageLengthCm,
    product?.package_length_cm,
    product?.packageLength,
    product?.package_length,
    product?.dimension_l,
    product?.l,
    getNestedValue(dimensionObject, ['lengthCm', 'length_cm', 'length', 'l']),
    parsedDimensions.length
  );

  const width = firstPresent(
    product?.widthCm,
    product?.widthCM,
    product?.width_cm,
    product?.width,
    product?.packageWidthCm,
    product?.package_width_cm,
    product?.packageWidth,
    product?.package_width,
    product?.dimension_w,
    product?.w,
    getNestedValue(dimensionObject, ['widthCm', 'width_cm', 'width', 'w']),
    parsedDimensions.width
  );

  const height = firstPresent(
    product?.heightCm,
    product?.heightCM,
    product?.height_cm,
    product?.height,
    product?.packageHeightCm,
    product?.package_height_cm,
    product?.packageHeight,
    product?.package_height,
    product?.dimension_h,
    product?.h,
    getNestedValue(dimensionObject, ['heightCm', 'height_cm', 'height', 'h']),
    parsedDimensions.height
  );

  return {
    length: isPresent(length) ? formatValue(length) : '',
    width: isPresent(width) ? formatValue(width) : '',
    height: isPresent(height) ? formatValue(height) : '',
  };
};

export const getProductDimensionsText = (product = {}) => {
  const stringDimensions = dimensionSources(product).find((source) => typeof source === 'string');
  const parsedDimensions = parseDimensionString(stringDimensions);

  if (stringDimensions && !parsedDimensions && isUsefulValue(stringDimensions)) {
    return stringDimensions.trim();
  }

  const { length, width, height } = getProductDimensionParts(product);
  const parts = [length, width, height];

  if (!parts.some(isUsefulValue)) return '';

  return parts.map((value) => (isUsefulValue(value) ? formatValue(value) : '-')).join(' x ');
};

export const getProductWeightValue = (product = {}) => {
  const weight = firstPresent(
    product?.weightKg,
    product?.weight_kg,
    product?.weight,
    product?.grossWeightKg,
    product?.gross_weight_kg,
    product?.grossWeight,
    product?.gross_weight,
    product?.packageWeightKg,
    product?.package_weight_kg,
    product?.packageWeight,
    product?.package_weight,
    product?.unitWeightKg,
    product?.unit_weight_kg,
    product?.unitWeight,
    product?.unit_weight,
    product?.dimensions?.weight,
    product?.metadata?.weightKg,
    product?.metadata?.weight_kg,
    product?.metadata?.weight,
    product?.meta?.weightKg,
    product?.meta?.weight_kg,
    product?.meta?.weight
  );

  return isPresent(weight) ? formatValue(weight) : '';
};

export const getProductWeightText = (product = {}) => {
  const weight = getProductWeightValue(product);
  if (!isUsefulValue(weight)) return '';

  const text = formatValue(weight);
  return /\b(kg|g|lb|lbs)\b/i.test(text) ? text : `${text} kg`;
};

const truthyValue = (value) => {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value > 0;
  if (typeof value === 'string') return ['true', '1', 'yes', 'y'].includes(value.trim().toLowerCase());
  return Boolean(value);
};

const anyTruthy = (...values) => values.some(truthyValue);

const toTitle = (value) =>
  String(value || '')
    .replace(/[_-]+/g, ' ')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .trim()
    .replace(/\s+/g, ' ')
    .replace(/\b\w/g, (letter) => letter.toUpperCase());

const addFlag = (flags, label) => {
  if (!label) return;
  const normalized = toTitle(label);
  if (normalized && !flags.some((flag) => flag.toLowerCase() === normalized.toLowerCase())) {
    flags.push(normalized);
  }
};

const addRawFlags = (flags, rawFlags) => {
  if (Array.isArray(rawFlags)) {
    rawFlags.forEach((flag) => addFlag(flags, flag?.label || flag?.name || flag?.type || flag));
    return;
  }

  if (typeof rawFlags === 'string') {
    rawFlags.split(/[,|]/).forEach((flag) => addFlag(flags, flag));
    return;
  }

  if (rawFlags && typeof rawFlags === 'object') {
    Object.entries(rawFlags).forEach(([key, value]) => {
      if (truthyValue(value)) addFlag(flags, key);
    });
  }
};

const explicitFalse = (value) => {
  if (value === false) return true;
  if (value === 0) return true;
  if (typeof value === 'string') return ['false', '0', 'no', 'inactive'].includes(value.trim().toLowerCase());
  return false;
};

export const getProductFlags = (product = {}) => {
  const flags = [];

  addRawFlags(flags, product?.flags);
  addRawFlags(flags, product?.productFlags);
  addRawFlags(flags, product?.product_flags);
  addRawFlags(flags, product?.tags);
  addRawFlags(flags, product?.metadata?.flags);
  addRawFlags(flags, product?.meta?.flags);

  if (anyTruthy(product?.hazmatFlag, product?.hazmat_flag, product?.hazmat, product?.isHazmat, product?.is_hazmat)) {
    addFlag(flags, 'Hazmat');
  }

  if (anyTruthy(product?.dangerousGoods, product?.dangerous_goods, product?.isDangerousGoods, product?.is_dangerous_goods)) {
    addFlag(flags, 'Dangerous Goods');
  }

  if (anyTruthy(product?.fragile, product?.isFragile, product?.is_fragile)) addFlag(flags, 'Fragile');
  if (anyTruthy(product?.oversize, product?.oversized, product?.isOversize, product?.is_oversize)) addFlag(flags, 'Oversize');
  if (anyTruthy(product?.expiryTracked, product?.expiry_tracked)) addFlag(flags, 'Expiry Tracked');
  if (anyTruthy(product?.lotTracked, product?.lot_tracked)) addFlag(flags, 'Lot Tracked');
  if (anyTruthy(product?.needsBundling, product?.needs_bundling)) addFlag(flags, 'Needs Bundling');

  return flags;
};

export const getProductActiveStatus = (product = {}) =>
  !explicitFalse(product?.active) &&
  !explicitFalse(product?.isActive) &&
  !explicitFalse(product?.is_active) &&
  String(product?.status || '').toLowerCase() !== 'inactive';
