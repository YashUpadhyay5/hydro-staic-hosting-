const sequelize = require('../../config/database');
const Employee = require('./Employee');
const SalaryStructure = require('./SalaryStructure');
const SalaryComponent = require('./SalaryComponent');
const EmployeeSalaryComponent = require('./EmployeeSalaryComponent');
const PayrollRun = require('./PayrollRun');
const PayrollItem = require('./PayrollItem');
const Loan = require('./Loan');
const LoanRepayment = require('./LoanRepayment');
const Reimbursement = require('./Reimbursement');
const TaxRecord = require('./TaxRecord');
const Payslip = require('./Payslip');
const Leave = require('./Leave');
const Attendance = require('./Attendance');
const Document = require('./Document');
const DeviceToken = require('./DeviceToken');
const Notification = require('./Notification');
const NotificationLog = require('./NotificationLog');
const Footprint = require('./Footprint');
const Setting = require('./Setting');
const Acknowledgment = require('./Acknowledgment');
const SettingAuditLog = require('./SettingAuditLog');
const NotificationSetting = require('./NotificationSetting');
const NotificationRecipient = require('./NotificationRecipient');
const WhatsAppNotificationLog = require('./WhatsAppNotificationLog');
const HolidayCalendar = require('./HolidayCalendar');
const ProfessionalTaxState = require('./ProfessionalTaxState');
const ProfessionalTaxRule = require('./ProfessionalTaxRule');
const ProfessionalTaxAuditLog = require('./ProfessionalTaxAuditLog');
const EmployeeGeofenceTrackingState = require('./EmployeeGeofenceTrackingState');

// Chat Models
const Chat = require('./Chat');
const ChatMember = require('./ChatMember');
const Message = require('./Message');
const Attachment = require('./Attachment');
const ReadReceipt = require('./ReadReceipt');
const PinnedChat = require('./PinnedChat');
const ArchivedChat = require('./ArchivedChat');

// Associations
Employee.hasMany(SalaryStructure, { foreignKey: 'employeeId', as: 'salaryStructures' });
SalaryStructure.belongsTo(Employee, { foreignKey: 'employeeId', as: 'employee' });

Employee.hasMany(EmployeeSalaryComponent, { foreignKey: 'employeeId', as: 'salaryComponentOverrides' });
EmployeeSalaryComponent.belongsTo(Employee, { foreignKey: 'employeeId', as: 'employee' });

Employee.hasMany(PayrollItem, { foreignKey: 'employeeId', as: 'payrollItems' });
PayrollItem.belongsTo(Employee, { foreignKey: 'employeeId', as: 'employee' });

PayrollRun.hasMany(PayrollItem, { foreignKey: 'payrollRunId', as: 'items' });
PayrollItem.belongsTo(PayrollRun, { foreignKey: 'payrollRunId', as: 'payrollRun' });

Employee.hasMany(Loan, { foreignKey: 'employeeId', as: 'loans' });
Loan.belongsTo(Employee, { foreignKey: 'employeeId', as: 'employee' });

Loan.hasMany(LoanRepayment, { foreignKey: 'loanId', as: 'repayments' });
LoanRepayment.belongsTo(Loan, { foreignKey: 'loanId', as: 'loan' });

LoanRepayment.belongsTo(PayrollItem, { foreignKey: 'payrollItemId', as: 'payrollItem', constraints: false });
PayrollItem.hasMany(LoanRepayment, { foreignKey: 'payrollItemId', as: 'loanRepayments', constraints: false });

Employee.hasMany(Reimbursement, { foreignKey: 'employeeId', as: 'reimbursements' });
Reimbursement.belongsTo(Employee, { foreignKey: 'employeeId', as: 'employee' });

Employee.hasMany(TaxRecord, { foreignKey: 'employeeId', as: 'taxRecords' });
TaxRecord.belongsTo(Employee, { foreignKey: 'employeeId', as: 'employee' });

Employee.hasMany(Payslip, { foreignKey: 'employeeId', as: 'payslips' });
Payslip.belongsTo(Employee, { foreignKey: 'employeeId', as: 'employee' });

Payslip.belongsTo(PayrollItem, { foreignKey: 'payrollItemId', as: 'payrollItem' });
PayrollItem.hasOne(Payslip, { foreignKey: 'payrollItemId', as: 'payslip' });

Employee.hasMany(DeviceToken, { foreignKey: 'employeeId', as: 'deviceTokens' });
DeviceToken.belongsTo(Employee, { foreignKey: 'employeeId', as: 'employee' });

Notification.hasMany(NotificationLog, { foreignKey: 'notificationId', as: 'logs' });
NotificationLog.belongsTo(Notification, { foreignKey: 'notificationId', as: 'notification' });

Employee.hasMany(NotificationLog, { foreignKey: 'employeeId', as: 'notificationLogs' });
NotificationLog.belongsTo(Employee, { foreignKey: 'employeeId', as: 'employee' });

Notification.belongsTo(Employee, { foreignKey: 'createdBy', as: 'creator', constraints: false });

// Chat Associations
Chat.hasMany(ChatMember, { foreignKey: 'chat_id', as: 'members' });
ChatMember.belongsTo(Chat, { foreignKey: 'chat_id', as: 'chat' });

Employee.hasMany(ChatMember, { foreignKey: 'employee_id', as: 'memberships' });
ChatMember.belongsTo(Employee, { foreignKey: 'employee_id', as: 'employee' });

Chat.hasMany(Message, { foreignKey: 'chat_id', as: 'messages' });
Message.belongsTo(Chat, { foreignKey: 'chat_id', as: 'chat' });

Employee.hasMany(Message, { foreignKey: 'sender_id', as: 'sentMessages' });
Message.belongsTo(Employee, { foreignKey: 'sender_id', as: 'sender' });

Message.hasMany(Attachment, { foreignKey: 'message_id', as: 'attachments' });
Attachment.belongsTo(Message, { foreignKey: 'message_id', as: 'message' });

Message.belongsTo(Message, { foreignKey: 'parent_message_id', as: 'parentMessage' });

Message.hasMany(ReadReceipt, { foreignKey: 'message_id', as: 'readReceipts' });
ReadReceipt.belongsTo(Message, { foreignKey: 'message_id', as: 'message' });

// Professional Tax Associations
ProfessionalTaxState.hasMany(ProfessionalTaxAuditLog, { foreignKey: 'stateId', as: 'auditLogs' });
ProfessionalTaxAuditLog.belongsTo(ProfessionalTaxState, { foreignKey: 'stateId', as: 'state' });

module.exports = {
  sequelize,
  Employee,
  SalaryStructure,
  SalaryComponent,
  EmployeeSalaryComponent,
  PayrollRun,
  PayrollItem,
  Loan,
  LoanRepayment,
  Reimbursement,
  TaxRecord,
  Payslip,
  Leave,
  Attendance,
  Document,
  DeviceToken,
  Notification,
  NotificationLog,
  Chat,
  ChatMember,
  Message,
  Attachment,
  ReadReceipt,
  PinnedChat,
  ArchivedChat,
  Footprint,
  Setting,
  Acknowledgment,
  SettingAuditLog,
  NotificationSetting,
  NotificationRecipient,
  WhatsAppNotificationLog,
  HolidayCalendar,
  ProfessionalTaxState,
  ProfessionalTaxRule,
  ProfessionalTaxAuditLog,
  EmployeeGeofenceTrackingState
};
