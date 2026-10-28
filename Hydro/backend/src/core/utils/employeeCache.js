const Employee = require('../../shared/models/Employee');

let cachedEmployees = null;
let cachedEmpMap = null;
let cachedEmpAliasesMap = null;
let lastCacheTime = 0;
const CACHE_TTL = 30000; // 30 seconds

async function getCachedEmployees() {
  const now = Date.now();
  if (cachedEmployees && cachedEmpMap && (now - lastCacheTime < CACHE_TTL)) {
    return { employees: cachedEmployees, empMap: cachedEmpMap, empAliasesMap: cachedEmpAliasesMap };
  }

  const employees = await Employee.findAll({ raw: true });
  const empMap = new Map();
  const empAliasesMap = new Map();

  employees.forEach(emp => {
    const aliases = new Set();
    [emp.id, emp.empCode, emp.emp_code, emp.name, emp.email, emp.phone, emp.phone_no, emp.phoneNo, emp.mobile].filter(Boolean).forEach(v => {
      const s = String(v).trim();
      aliases.add(s);
      aliases.add(s.toLowerCase());
      aliases.add(s.toUpperCase());
    });

    // Dynamically extract legacy codes and aliases from employee customFields
    let legacyList = [];
    try {
      const rawCf = emp.customFields || emp.custom_fields || {};
      const cf = typeof rawCf === 'string' ? JSON.parse(rawCf) : rawCf;
      if (Array.isArray(cf.legacyCodes)) legacyList.push(...cf.legacyCodes);
      if (Array.isArray(cf.aliases)) legacyList.push(...cf.aliases);
      if (cf.legacyId) legacyList.push(cf.legacyId);
      if (cf.oldCode) legacyList.push(cf.oldCode);
    } catch (e) {}

    legacyList.filter(Boolean).forEach(v => {
      const s = String(v).trim();
      aliases.add(s);
      aliases.add(s.toLowerCase());
      aliases.add(s.toUpperCase());
      empMap.set(s.toLowerCase(), emp);
    });

    if (emp.id) empMap.set(String(emp.id).toLowerCase(), emp);
    if (emp.empCode) empMap.set(String(emp.empCode).toLowerCase(), emp);
    if (emp.emp_code) empMap.set(String(emp.emp_code).toLowerCase(), emp);
    if (emp.name) empMap.set(String(emp.name).toLowerCase(), emp);
    if (emp.email) empMap.set(String(emp.email).toLowerCase(), emp);
    if (emp.phone) empMap.set(String(emp.phone).toLowerCase(), emp);
    if (emp.phone_no) empMap.set(String(emp.phone_no).toLowerCase(), emp);
    if (emp.phoneNo) empMap.set(String(emp.phoneNo).toLowerCase(), emp);
    if (emp.mobile) empMap.set(String(emp.mobile).toLowerCase(), emp);

    const aliasArr = Array.from(aliases);
    aliasArr.forEach(a => empAliasesMap.set(a.toLowerCase(), aliasArr));
  });

  cachedEmployees = employees;
  cachedEmpMap = empMap;
  cachedEmpAliasesMap = empAliasesMap;
  lastCacheTime = now;

  return { employees, empMap, empAliasesMap };
}

/**
 * Dynamically resolves any raw identifier (legacy code, alias, name, ID)
 * to its authoritative canonical employee representation.
 *
 * @param {string} rawId - e.g. 'EMP0128', 'HMPL39', 'D04'
 * @param {Map} [empMap] - optional preloaded empMap from getCachedEmployees()
 * @returns {Promise<{ employee: Object, canonicalId: string, canonicalName: string } | null>}
 */
async function resolveCanonicalEmployee(rawId, empMap = null) {
  if (!rawId) return null;
  const key = String(rawId).trim().toLowerCase();

  let map = empMap;
  if (!map) {
    const cached = await getCachedEmployees();
    map = cached.empMap;
  }

  let emp = map.get(key);
  if (!emp) {
    // Try refreshing cache if key was not found
    const cached = await getCachedEmployees();
    emp = cached.empMap.get(key);
  }

  if (!emp) return null;

  const canonicalId = String(emp.empCode || emp.emp_code || emp.id).trim();
  const canonicalName = String(emp.name || '').trim();

  return {
    employee: emp,
    canonicalId,
    canonicalName
  };
}

function invalidateEmployeeCache() {
  cachedEmployees = null;
  cachedEmpMap = null;
  cachedEmpAliasesMap = null;
  lastCacheTime = 0;
}

module.exports = {
  getCachedEmployees,
  resolveCanonicalEmployee,
  invalidateEmployeeCache
};
