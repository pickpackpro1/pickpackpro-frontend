export const toTitleCase = (value = '') =>
  String(value)
    .replaceAll('_', ' ')
    .replaceAll('-', ' ')
    .split(' ')
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join(' ');

const firstPresent = (...values) =>
  values.find((value) => {
    if (value === undefined || value === null) {
      return false;
    }

    if (typeof value === 'object') {
      return false;
    }

    return String(value).trim() !== '';
  });

const getNestedClient = (source) => source?.client || source?.clients || source?.customer || source?.account || null;

const getTierValue = (source) =>
  firstPresent(
    source?.pricingTierOverride,
    source?.pricing_tier_override,
    source?.tierOverride,
    source?.tier_override,
    source?.pricingTier,
    source?.pricing_tier,
    source?.clientTier,
    source?.client_tier,
    source?.tierName,
    source?.tier_name,
    source?.pricingTierName,
    source?.pricing_tier_name,
    source?.tier,
    source?.pricingPlan,
    source?.pricing_plan,
    source?.plan,
    source?.pricing,
    source?.pricing?.tier,
    source?.pricing?.pricingTier,
    source?.pricing?.pricing_tier,
    source?.settings?.tier,
    source?.settings?.pricingTier,
    source?.settings?.pricing_tier,
    source?.metadata?.tier,
    source?.metadata?.pricingTier,
    source?.metadata?.pricing_tier
  );

export const getClientTierFromSources = (...sources) => {
  for (const source of sources) {
    const tier = getTierValue(source);

    if (tier) {
      return toTitleCase(tier);
    }

    const nestedTier = getTierValue(getNestedClient(source));

    if (nestedTier) {
      return toTitleCase(nestedTier);
    }
  }

  return '';
};

export const getClientIdFromSources = (...sources) => {
  for (const source of sources) {
    const nestedClient = getNestedClient(source);
    const clientId = firstPresent(
      source?.clientId,
      source?.client_id,
      source?.clientUuid,
      source?.client_uuid,
      source?.customerId,
      source?.customer_id,
      nestedClient?.id,
      nestedClient?.uuid,
      nestedClient?.clientId,
      nestedClient?.client_id
    );

    if (clientId) {
      return String(clientId);
    }
  }

  return '';
};
