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

function invalidateEmployeeCache() {
  cachedEmployees = null;
  cachedEmpMap = null;
  cachedEmpAliasesMap = null;
  lastCacheTime = 0;
}

module.exports = {
  getCachedEmployees,
  invalidateEmployeeCache
};
