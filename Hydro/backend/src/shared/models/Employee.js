const { DataTypes } = require('sequelize');
const sequelize = require('../../config/database');

const Employee = sequelize.define('Employee', {
  id: {
    type: DataTypes.STRING,
    primaryKey: true,
  },
  name: {
    type: DataTypes.STRING,
    allowNull: false,
  },
  email: {
    type: DataTypes.STRING,
    allowNull: false,
    unique: true,
  },
  password: {
    type: DataTypes.STRING(255),
    allowNull: false,
  },
  role: {
    type: DataTypes.STRING,
    allowNull: false,
    defaultValue: 'EMPLOYEE', // 'ADMIN' or 'EMPLOYEE'
  },
  designation: {
    type: DataTypes.STRING,
    allowNull: false,
    defaultValue: 'OFFICE', // 'OFFICE' or 'FIELD'
  },
  status: {
    type: DataTypes.STRING,
    allowNull: false,
    defaultValue: 'ACTIVE', // 'ACTIVE' or 'PAST'
  },
  allowedLeaves: {
    type: DataTypes.INTEGER,
    field: 'allowed_leaves',
    allowNull: false,
    defaultValue: 0,
  },
  consumedLeaves: {
    type: DataTypes.INTEGER,
    field: 'consumed_leaves',
    allowNull: false,
    defaultValue: 0,
  },
  openingLeaveBalance: {
    type: DataTypes.DOUBLE,
    field: 'opening_leave_balance',
    allowNull: false,
    defaultValue: 0,
  },
  earnedLeaves: {
    type: DataTypes.DOUBLE,
    field: 'earned_leaves',
    allowNull: false,
    defaultValue: 0,
  },
  dob: {
    type: DataTypes.STRING,
    allowNull: true,
  },
  fatherName: {
    type: DataTypes.STRING,
    field: 'father_name',
    allowNull: true,
  },
  spouseName: {
    type: DataTypes.STRING,
    field: 'spouse_name',
    allowNull: true,
  },
  presentAddress: {
    type: DataTypes.TEXT,
    field: 'present_address',
    allowNull: true,
  },
  permanentAddress: {
    type: DataTypes.TEXT,
    field: 'permanent_address',
    allowNull: true,
  },
  emergencyContact: {
    type: DataTypes.STRING,
    field: 'emergency_contact',
    allowNull: true,
  },
  empCode: {
    type: DataTypes.STRING,
    field: 'emp_code',
    allowNull: true,
  },
  nationality: {
    type: DataTypes.STRING,
    allowNull: true,
  },
  phoneNo: {
    type: DataTypes.STRING,
    allowNull: true,
  },
  joiningDate: {
    type: DataTypes.STRING,
    allowNull: true,
  },
  jobTitle: {
    type: DataTypes.STRING,
    allowNull: true,
  },
  legalEntity: {
    type: DataTypes.STRING,
    allowNull: true,
    defaultValue: 'Hydromaterials Private Limited',
  },
  department: {
    type: DataTypes.STRING,
    allowNull: true,
  },
  location: {
    type: DataTypes.STRING,
    allowNull: true,
  },
  placeOfDuty: {
    type: DataTypes.STRING,
    field: 'place_of_duty',
    allowNull: true,
  },
  reportingManager: {
    type: DataTypes.STRING,
    allowNull: true,
  },
  probationPolicy: {
    type: DataTypes.STRING,
    allowNull: true,
  },
  noticePeriod: {
    type: DataTypes.STRING,
    allowNull: true,
  },
  leaveSetting: {
    type: DataTypes.STRING,
    allowNull: true,
  },
  holidayDetails: {
    type: DataTypes.STRING,
    allowNull: true,
  },
  weeklyOffs: {
    type: DataTypes.STRING,
    allowNull: true,
    defaultValue: 'Sunday',
  },
  attendanceSetting: {
    type: DataTypes.STRING,
    allowNull: true,
  },
  overtime: {
    type: DataTypes.STRING,
    allowNull: true,
  },
  expensePolicies: {
    type: DataTypes.STRING,
    allowNull: true,
  },
  compensationGross: {
    type: DataTypes.DOUBLE,
    allowNull: true,
  },
  lastRevisionDate: {
    type: DataTypes.STRING,
    field: 'last_revision_date',
    allowNull: true,
  },
  pfEligible: {
    type: DataTypes.BOOLEAN,
    allowNull: true,
    defaultValue: true,
  },
  pfAmount: {
    type: DataTypes.DOUBLE,
    allowNull: true,
  },
  pfNumber: {
    type: DataTypes.STRING,
    field: 'pf_number',
    allowNull: true,
  },
  esiEligible: {
    type: DataTypes.BOOLEAN,
    allowNull: true,
    defaultValue: true,
  },
  esicNumber: {
    type: DataTypes.STRING,
    field: 'esic_number',
    allowNull: true,
  },
  lwfEligible: {
    type: DataTypes.BOOLEAN,
    allowNull: true,
    defaultValue: true,
  },
  lwfAmount: {
    type: DataTypes.DOUBLE,
    allowNull: true,
    defaultValue: 60,
  },
  vpfEligible: {
    type: DataTypes.BOOLEAN,
    allowNull: true,
    defaultValue: false,
  },
  vpfAmount: {
    type: DataTypes.DOUBLE,
    allowNull: true,
    defaultValue: 0,
  },
  ptEligible: {
    type: DataTypes.BOOLEAN,
    allowNull: true,
    defaultValue: true,
  },
  ptAmount: {
    type: DataTypes.DOUBLE,
    allowNull: true,
  },
  ptStateId: {
    type: DataTypes.STRING,
    field: 'pt_state_id',
    allowNull: true,
  },
  ptStateCode: {
    type: DataTypes.STRING,
    field: 'pt_state_code',
    allowNull: true,
  },
  ptExemption: {
    type: DataTypes.BOOLEAN,
    field: 'pt_exemption',
    allowNull: true,
    defaultValue: false,
  },
  ptExemptionType: {
    type: DataTypes.STRING,
    field: 'pt_exemption_type',
    allowNull: true,
  },
  ptExemptionReason: {
    type: DataTypes.STRING,
    field: 'pt_exemption_reason',
    allowNull: true,
  },
  ptEffectiveDate: {
    type: DataTypes.STRING,
    field: 'pt_effective_date',
    allowNull: true,
  },
  taxRegime: {
    type: DataTypes.STRING,
    allowNull: true,
    defaultValue: 'New Regime (Section 115BAC)',
  },
  bankName: {
    type: DataTypes.STRING,
    allowNull: true,
  },
  bankAccountNo: {
    type: DataTypes.STRING,
    allowNull: true,
  },
  bankIfscCode: {
    type: DataTypes.STRING,
    allowNull: true,
  },
  bankBranchName: {
    type: DataTypes.STRING,
    allowNull: true,
  },
  aadhaarNumber: {
    type: DataTypes.STRING,
    field: 'aadhaar_number',
    allowNull: true,
  },
  highestQualification: {
    type: DataTypes.TEXT,
    field: 'highest_qualification',
    allowNull: true,
  },
  panNumber: {
    type: DataTypes.STRING,
    field: 'pan_number',
    allowNull: true,
  },
  uanNumber: {
    type: DataTypes.STRING,
    field: 'uan_number',
    allowNull: true,
  },
  esiNumber: {
    type: DataTypes.STRING,
    field: 'esi_number',
    allowNull: true,
  },
  exitReason: {
    type: DataTypes.STRING,
    field: 'exit_reason',
    allowNull: true,
  },
  exitDiscussed: {
    type: DataTypes.BOOLEAN,
    field: 'exit_discussed',
    allowNull: true,
  },
  exitDiscussionSummary: {
    type: DataTypes.TEXT,
    field: 'exit_discussion_summary',
    allowNull: true,
  },
  exitTerminationReason: {
    type: DataTypes.STRING,
    field: 'exit_termination_reason',
    allowNull: true,
  },
  exitNoticeDate: {
    type: DataTypes.STRING,
    field: 'exit_notice_date',
    allowNull: true,
  },
  exitComments: {
    type: DataTypes.TEXT,
    field: 'exit_comments',
    allowNull: true,
  },
  exitDate: {
    type: DataTypes.STRING,
    field: 'exit_date',
    allowNull: true,
  },
  profilePhotoUrl: {
    type: DataTypes.STRING,
    field: 'profile_photo_url',
    allowNull: true,
  },
  currentToken: {
    type: DataTypes.TEXT,
    field: 'current_token',
    allowNull: true,
  },
  fcmToken: {
    type: DataTypes.STRING,
    field: 'fcm_token',
    allowNull: true,
  },
  primaryWorkMode: {
    type: DataTypes.STRING,
    field: 'primary_work_mode',
    allowNull: false,
    defaultValue: 'office',
  },
  canSwitchMode: {
    type: DataTypes.BOOLEAN,
    field: 'can_switch_mode',
    allowNull: false,
    defaultValue: true,
  },
  clockInBypassApproved: {
    type: DataTypes.BOOLEAN,
    field: 'clock_in_bypass_approved',
    allowNull: false,
    defaultValue: false,
  },
  gender: {
    type: DataTypes.STRING,
    allowNull: true,
    defaultValue: 'Male',
  },
  avatar: {
    type: DataTypes.TEXT,
    allowNull: true,
  },
  isOnline: {
    type: DataTypes.BOOLEAN,
    field: 'is_online',
    defaultValue: false,
  },
  lastSeen: {
    type: DataTypes.DATE,
    field: 'last_seen',
    defaultValue: DataTypes.NOW,
  },
  isSystemAccount: {
    type: DataTypes.BOOLEAN,
    field: 'is_system_account',
    defaultValue: false,
  },
  customFields: {
    type: DataTypes.TEXT,
    allowNull: true,
    defaultValue: '{}',
    get() {
      const val = this.getDataValue('customFields');
      return val ? JSON.parse(val) : {};
    },
    set(val) {
      this.setDataValue('customFields', JSON.stringify(val));
    }
  }
}, {
  tableName: 'location_employees',
  timestamps: true,
  underscored: true,
  hooks: {
    beforeCreate: async (employee) => {
      if (employee.password && !employee.password.startsWith('$2a$') && !employee.password.startsWith('$2b$') && !employee.password.startsWith('$2y$')) {
        const bcrypt = require('bcryptjs');
        const salt = await bcrypt.genSalt(10);
        employee.password = await bcrypt.hash(employee.password, salt);
      }
    },
    beforeUpdate: async (employee) => {
      if (employee.changed('password') && employee.password && !employee.password.startsWith('$2a$') && !employee.password.startsWith('$2b$') && !employee.password.startsWith('$2y$')) {
        const bcrypt = require('bcryptjs');
        const salt = await bcrypt.genSalt(10);
        employee.password = await bcrypt.hash(employee.password, salt);
      }
    }
  }
});

module.exports = Employee;
