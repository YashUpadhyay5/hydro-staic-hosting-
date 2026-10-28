/**
 * Universal entity matcher across location_employees, Attendances, location_leaves
 */
export const matchesEmp = (record, emp) => {
  if (!record || !emp) return false;
  const rUser = String(record.userId || record.user_id || record.userName || record.user_name || record.employeeId || record.employee_id || '').trim().toLowerCase();
  const rName = String(record.userName || record.user_name || '').trim().toLowerCase();

  const empId = String(emp.id || '').trim().toLowerCase();
  const empCode = String(emp.empCode || emp.emp_code || emp.employeeId || emp.employee_id || emp.code || '').trim().toLowerCase();
  const empName = String(emp.name || emp.fullName || '').trim().toLowerCase();

  if (!rUser && !rName) return false;

  return (
    (empId && rUser === empId) ||
    (empCode && rUser === empCode) ||
    (empName && rName === empName) ||
    (empName && rUser === empName) ||
    (empId && rName === empId) ||
    (empCode && rName === empCode)
  );
};
