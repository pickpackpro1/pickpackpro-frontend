// Keep in sync with lib/boxConstraints.ts in the backend.
export const MAX_FBA_BOX_WEIGHT_KG = 23;
export const HEAVY_PACKAGE_THRESHOLD_KG = 15;

export const BOX_WEIGHT_ERROR_CODES = ['BOX_WEIGHT_REQUIRED', 'BOX_WEIGHT_OVER_LIMIT'];

export const getBoxWeightErrorDetails = (error) =>
  error?.payload?.details || error?.payload?.data?.details || {};

export const getBoxWeightErrorCode = (error) => String(getBoxWeightErrorDetails(error)?.code || '');
