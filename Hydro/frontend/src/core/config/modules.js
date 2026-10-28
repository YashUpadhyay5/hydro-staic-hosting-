export const modulesConfig = [
  {
    id: "hrms",
    name: "HRMS",
    description: "Manage Employees, Attendance, Payroll, and organization structures.",
    icon: "👥",
    path: "/hrms",
    roles: ["ADMIN", "HR", "MANAGER", "EMPLOYEE", "TRACKING_MANAGER", "FIELD_INVOICE_MANAGER"]
  },
  {
    id: "invoice",
    name: "Invoice Extractor",
    description: "Extract Invoice Data using high-accuracy OCR & AI Models.",
    icon: "📄",
    path: "/invoice",
    roles: ["ADMIN", "FINANCE", "FIELD_INVOICE_MANAGER"]
  }
];
