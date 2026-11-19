const DEFAULT_INTERVAL_MS = 30000;

function parseIntervalMs(value) {
  if (!value) return DEFAULT_INTERVAL_MS;
  const text = String(value).toLowerCase();
  const digits = text.replace(/[^0-9]/g, '');
  if (!digits) return DEFAULT_INTERVAL_MS;
  const multiplier = (text.includes('hour') || text.includes('hr')) ? 3600 : (text.includes('min') ? 60 : 1);
  const seconds = Number(digits) * multiplier;
  return seconds > 0 ? seconds * 1000 : DEFAULT_INTERVAL_MS;
}

module.exports = {
  parseIntervalMs,
  DEFAULT_INTERVAL_MS
};
