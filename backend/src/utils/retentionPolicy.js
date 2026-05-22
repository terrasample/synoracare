const DEFAULT_RETENTION_YEARS = 7;

// This table is a baseline policy helper. Organizations should confirm with counsel.
const STATE_RETENTION_YEARS = {
  AK: 7,
  AL: 7,
  AR: 10,
  AZ: 6,
  CA: 7,
  CO: 10,
  CT: 7,
  DC: 6,
  DE: 7,
  FL: 7,
  GA: 10,
  HI: 7,
  IA: 7,
  ID: 7,
  IL: 10,
  IN: 7,
  KS: 10,
  KY: 6,
  LA: 10,
  MA: 7,
  MD: 5,
  ME: 6,
  MI: 7,
  MN: 7,
  MO: 7,
  MS: 7,
  MT: 8,
  NC: 11,
  ND: 7,
  NE: 10,
  NH: 7,
  NJ: 10,
  NM: 6,
  NV: 5,
  NY: 6,
  OH: 7,
  OK: 7,
  OR: 7,
  PA: 7,
  RI: 7,
  SC: 10,
  SD: 7,
  TN: 10,
  TX: 7,
  UT: 7,
  VA: 6,
  VT: 7,
  WA: 7,
  WI: 5,
  WV: 5,
  WY: 7
};

function normalizeStateCode(value) {
  return String(value || '').trim().toUpperCase();
}

function inferRetentionYears(stateCode, overrideYears) {
  const override = Number(overrideYears || 0);
  if (Number.isFinite(override) && override >= 1 && override <= 30) {
    return {
      years: override,
      source: 'organization_override',
      stateCode: normalizeStateCode(stateCode) || 'UNKNOWN'
    };
  }

  const normalized = normalizeStateCode(stateCode);
  const years = STATE_RETENTION_YEARS[normalized] || DEFAULT_RETENTION_YEARS;
  return {
    years,
    source: STATE_RETENTION_YEARS[normalized] ? 'state_baseline' : 'default_baseline',
    stateCode: normalized || 'UNKNOWN'
  };
}

module.exports = {
  inferRetentionYears,
  normalizeStateCode,
  DEFAULT_RETENTION_YEARS
};
