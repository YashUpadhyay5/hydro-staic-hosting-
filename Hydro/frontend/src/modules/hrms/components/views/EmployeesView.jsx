
const getLocationCalendarsFromStorage = () => {
    try {
        const saved = localStorage.getItem('hrms_location_holiday_calendars');
        if (saved) {
            const parsed = JSON.parse(saved);
            if (Array.isArray(parsed) && parsed.length > 0) {
                return parsed;
            }
        }
    } catch {}
    return [];
};
import React, { useState, useEffect, useRef } from 'react';
import { api } from '../../services/api';
import { getFullUrl, forceDownload, formatDate } from '../../utils/helpers';
import LeaveAdjustmentModal from './LeaveAdjustmentModal';

const COUNTRY_CODES = [
    { code: '+91', label: 'IN (+91)' },
    { code: '+1', label: 'US/CA (+1)' },
    { code: '+44', label: 'UK (+44)' },
    { code: '+971', label: 'AE (+971)' },
    { code: '+61', label: 'AU (+61)' },
    { code: '+65', label: 'SG (+65)' },
    { code: '+92', label: 'PK (+92)' },
    { code: '+880', label: 'BD (+880)' },
    { code: '+977', label: 'NP (+977)' },
    { code: '+966', label: 'SA (+966)' },
];

const SYSTEM_CUSTOM_FIELD_KEYS = new Set([
    'panNumber', 'pan', 'uanNumber', 'pfUan', 'pfNumber', 'pf_number',
    'esiNumber', 'esicNumber', 'esiNo', 'bankAccountNo',
    'accountNumber', 'bankIfscCode', 'ifscCode', 'aadhaarNumber',
    'aadharNumber', 'aadhaar', 'aadhar', 'highestQualification',
    'openingLeaveBalance', 'earnedLeaves'
]);

const ALL_INDIAN_STATES = [
    { stateCode: 'AP', stateName: 'Andhra Pradesh', maxAnnualPt: 2500 },
    { stateCode: 'AS', stateName: 'Assam', maxAnnualPt: 2500 },
    { stateCode: 'BR', stateName: 'Bihar', maxAnnualPt: 2500 },
    { stateCode: 'CH', stateName: 'Chandigarh (Exempt)', maxAnnualPt: 0 },
    { stateCode: 'CG', stateName: 'Chhattisgarh', maxAnnualPt: 2500 },
    { stateCode: 'DL', stateName: 'Delhi (Exempt)', maxAnnualPt: 0 },
    { stateCode: 'GA', stateName: 'Goa (Exempt)', maxAnnualPt: 0 },
    { stateCode: 'GJ', stateName: 'Gujarat', maxAnnualPt: 2400 },
    { stateCode: 'HR', stateName: 'Haryana (Exempt)', maxAnnualPt: 0 },
    { stateCode: 'HP', stateName: 'Himachal Pradesh (Exempt)', maxAnnualPt: 0 },
    { stateCode: 'JK', stateName: 'Jammu & Kashmir (Exempt)', maxAnnualPt: 0 },
    { stateCode: 'JH', stateName: 'Jharkhand', maxAnnualPt: 2500 },
    { stateCode: 'KA', stateName: 'Karnataka', maxAnnualPt: 2400 },
    { stateCode: 'KL', stateName: 'Kerala', maxAnnualPt: 2500 },
    { stateCode: 'MP', stateName: 'Madhya Pradesh', maxAnnualPt: 2500 },
    { stateCode: 'MH', stateName: 'Maharashtra', maxAnnualPt: 2500 },
    { stateCode: 'OD', stateName: 'Odisha', maxAnnualPt: 2500 },
    { stateCode: 'PB', stateName: 'Punjab (Exempt / Optional)', maxAnnualPt: 2400 },
    { stateCode: 'RJ', stateName: 'Rajasthan (Exempt)', maxAnnualPt: 0 },
    { stateCode: 'TN', stateName: 'Tamil Nadu', maxAnnualPt: 2500 },
    { stateCode: 'TS', stateName: 'Telangana', maxAnnualPt: 2500 },
    { stateCode: 'UP', stateName: 'Uttar Pradesh (Exempt)', maxAnnualPt: 0 },
    { stateCode: 'UK', stateName: 'Uttarakhand (Exempt)', maxAnnualPt: 0 },
    { stateCode: 'WB', stateName: 'West Bengal', maxAnnualPt: 2500 }
];

export default function EmployeesView({ employees, onSelectEmployee, refreshEmployees }) {
    const [latestFootprints, setLatestFootprints] = useState({});
    const [todayDistances, setTodayDistances] = useState({});
    
    // Add Employee Form State
    const [showAddForm, setShowAddForm] = useState(false);
    const [showLeaveAdjustmentModal, setShowLeaveAdjustmentModal] = useState(false);
    const [leaveAdjustmentEmpId, setLeaveAdjustmentEmpId] = useState(null);

    // Fullscreen Image Lightbox Preview State
    const [previewImage, setPreviewImage] = useState(null); // { url, title, subtitle }

    useEffect(() => {
        const handleKeyDown = (e) => {
            if (e.key === 'Escape') setPreviewImage(null);
        };
        if (previewImage) {
            window.addEventListener('keydown', handleKeyDown);
        }
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [previewImage]);
    const [profileTab, setProfileTab] = useState('PROFILE');
    const [financeSubTab, setFinanceSubTab] = useState('SALARY');
    const isScrollingRef = useRef(false);
    const scrollTimeoutRef = useRef(null);

    const changeProfileTab = (tabId) => {
        setProfileTab(tabId);
        if (isEditing) {
            const container = document.getElementById('profile-scroll-container');
            let targetId = 'section-profile';
            if (tabId === 'JOB') targetId = 'section-job';
            else if (tabId === 'POLICIES') targetId = 'section-policies';
            else if (tabId === 'FINANCES') targetId = 'section-finances';
            else if (tabId === 'DOCUMENTS') targetId = 'section-documents';

            const targetElement = document.getElementById(targetId);
            if (container && targetElement) {
                isScrollingRef.current = true;
                if (scrollTimeoutRef.current) clearTimeout(scrollTimeoutRef.current);
                
                const targetTop = targetElement.offsetTop - container.offsetTop;
                container.scrollTo({
                    top: Math.max(0, targetTop - 10),
                    behavior: 'smooth'
                });

                scrollTimeoutRef.current = setTimeout(() => {
                    isScrollingRef.current = false;
                }, 700);
            }
        }
    };

    const handleFormScroll = (e) => {
        if (!isEditing || isScrollingRef.current) return;
        const container = e.currentTarget;
        const scrollTop = container.scrollTop;
        const containerOffset = container.offsetTop;

        const sections = [
            { id: 'PROFILE', el: document.getElementById('section-profile') },
            { id: 'JOB', el: document.getElementById('section-job') },
            { id: 'POLICIES', el: document.getElementById('section-policies') },
            { id: 'FINANCES', el: document.getElementById('section-finances') },
            { id: 'DOCUMENTS', el: document.getElementById('section-documents') }
        ];

        let currentActive = 'PROFILE';
        for (let i = 0; i < sections.length; i++) {
            const sec = sections[i];
            if (sec.el) {
                const secTop = sec.el.offsetTop - containerOffset;
                if (scrollTop >= secTop - 100) {
                    currentActive = sec.id;
                }
            }
        }
        if (currentActive !== profileTab) {
            setProfileTab(currentActive);
        }
    };
    const [loading, setLoading] = useState(false);
    const [formStep, setFormStep] = useState(1);
    
    // Step 1: Personal Details
    const [name, setName] = useState('');
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [gender, setGender] = useState('Male');
    const [dob, setDob] = useState('');
    const [empCode, setEmpCode] = useState('');
    const [nationality, setNationality] = useState('Indian');
    const [phoneNo, setPhoneNo] = useState('');
    const [countryCode, setCountryCode] = useState('+91');
    const [fatherName, setFatherName] = useState('');
    const [presentAddress, setPresentAddress] = useState('');
    const [permanentAddress, setPermanentAddress] = useState('');
    const [emergencyContact, setEmergencyContact] = useState('');
    const [designation, setDesignation] = useState('FIELD');
    const [role, setRole] = useState('EMPLOYEE');
    const [allowedLeaves, setAllowedLeaves] = useState(0);
    
    // Step 5: Bank & Statutory Numbers
    const [bankName, setBankName] = useState('');
    const [bankAccountNo, setBankAccountNo] = useState('');
    const [bankIfscCode, setBankIfscCode] = useState('');
    const [bankBranchName, setBankBranchName] = useState('');
    const [aadhaarNumber, setAadhaarNumber] = useState('');
    const [highestQualLevel, setHighestQualLevel] = useState('');
    const [highestQualStream, setHighestQualStream] = useState('');
    const [highestQualInstitution, setHighestQualInstitution] = useState('');
    const [highestQualYear, setHighestQualYear] = useState('');
    const [highestQualPercent, setHighestQualPercent] = useState('');
    const [panNumber, setPanNumber] = useState('');
    const [uanNumber, setUanNumber] = useState('');
    const [pfNumber, setPfNumber] = useState('');
    const [esiNumber, setEsiNumber] = useState('');
    
    // Step 2: Job Details
    const [joiningDate, setJoiningDate] = useState('');
    const [jobTitle, setJobTitle] = useState('Design Engineer');
    const [customJobTitle, setCustomJobTitle] = useState('');
    const [isCustomJobTitle, setIsCustomJobTitle] = useState(false);
    const [jobTitles, setJobTitles] = useState([
        'Design Engineer', 'Account Executive', 'Account cum Office Mgr', 'Customer Care Executive', 
        'Director', 'Engineer IT', 'Field Executive', 'Field Manager', 'Field Staff', 'Helper', 
        'Intern', 'Jr. R&D Scientist', 'Junior Engineer', 'Managing Director', 'Product Development Engineer', 
        'Project Assistant', 'Project Coordinator', 'RO Technician', 'Sr Manager HR', 'Technology Intern'
    ]);
    
    const [legalEntity, setLegalEntity] = useState('Hydromaterials Private Limited');
    
    const [department, setDepartment] = useState('Company');
    const [customDepartment, setCustomDepartment] = useState('');
    const [isCustomDepartment, setIsCustomDepartment] = useState(false);
    const [departments, setDepartments] = useState(['Engineering', 'HR', 'Finance', 'Sales', 'Company']);
    
    const [locationCalendars, setLocationCalendars] = useState(() => getLocationCalendarsFromStorage());
    const [location, setLocation] = useState(() => {
        const cals = getLocationCalendarsFromStorage();
        return cals.length > 0 ? (cals[0].location || cals[0].name) : 'Headquarters';
    });
    const [customLocation, setCustomLocation] = useState('');
    const [isCustomLocation, setIsCustomLocation] = useState(false);
    const [locations, setLocations] = useState(() => {
        const cals = getLocationCalendarsFromStorage();
        return cals.length > 0 ? cals.map(c => c.location || c.name) : ['Headquarters'];
    });
    
    const [reportingManager, setReportingManager] = useState('');
    const [placeOfDuty, setPlaceOfDuty] = useState('');

    // Step 3: Employment Terms
    const [probationPolicy, setProbationPolicy] = useState('Permanent Employee');
    const [noticePeriod, setNoticePeriod] = useState('1 Month');

    // Step 4: Work Details
    const [leaveSetting, setLeaveSetting] = useState('Paid Leaves');
    const [leaveTypes, setLeaveTypes] = useState([
        'Paid Leaves', 'Emergency Leave', 'Medical Leave', 'Casual Leave', 'Sick Leave'
    ]);
    const [isAddingLeaveType, setIsAddingLeaveType] = useState(false);
    const [newLeaveType, setNewLeaveType] = useState('');
    const [showLeaveDropdown, setShowLeaveDropdown] = useState(false);
    
    const [siteCalendars, setSiteCalendars] = useState({
        'Chennai': ['New Year', 'Pongal', 'Tamil New Year', 'Diwali'],
        'Noida': ['New Year', 'Holi', 'Dussehra', 'Diwali'],
        'Amritsar': ['New Year', 'Lohri', 'Baisakhi', 'Diwali']
    });
    const [holidayDetails, setHolidayDetails] = useState('Chennai');
    const [isAddingNewSite, setIsAddingNewSite] = useState(false);
    const [newSiteName, setNewSiteName] = useState('');
    const [newHolidayName, setNewHolidayName] = useState('');
    
    const [weeklyOffs, setWeeklyOffs] = useState('Sunday');
    const [attendanceSetting, setAttendanceSetting] = useState('9-5:30'); // '9-5:30', 'Flexible', or 'Other'
    const [startTime, setStartTime] = useState('09:00');
    const [endTime, setEndTime] = useState('17:30');
    const [overtime, setOvertime] = useState('Eligible for overtime');

    // Step 5: Expense & Compensation Settings
    const [expensePolicies, setExpensePolicies] = useState('Standard travel and food reimbursement policy');
    const [compensationGross, setCompensationGross] = useState(240000);
    const [pfEligible, setPfEligible] = useState(true);
    const [pfAmount, setPfAmount] = useState('');
    const [showEditPf, setShowEditPf] = useState(false);
    const [vpfEligible, setVpfEligible] = useState(false);
    const [vpfAmount, setVpfAmount] = useState('');
    const [esiEligible, setEsiEligible] = useState(true);
    const [lwfEligible, setLwfEligible] = useState(true);
    const [lwfAmount, setLwfAmount] = useState(60);
    const [showEditLwf, setShowEditLwf] = useState(false);
    const [ptStatesList, setPtStatesList] = useState([]);
    const [ptEligible, setPtEligible] = useState(true);
    const [ptStateCode, setPtStateCode] = useState('TN');
    const [ptExemption, setPtExemption] = useState(false);
    const [ptExemptionType, setPtExemptionType] = useState('NONE');
    const [ptExemptionReason, setPtExemptionReason] = useState('');
    const [ptAmount, setPtAmount] = useState('');
    const [showEditPt, setShowEditPt] = useState(false);
    const [taxRegime, setTaxRegime] = useState('New Regime (Section 115BAC)');
    const [dynamicFields, setDynamicFields] = useState({});

    useEffect(() => {
        api.getPTStates().then(data => {
            if (data && Array.isArray(data)) {
                setPtStatesList(data);
            }
        }).catch(err => console.error('Error fetching PT states:', err));
    }, []);

    // Edit & View Employee Form State
    const [viewingEmployee, setViewingEmployee] = useState(null);
    const [isEditing, setIsEditing] = useState(false);

    const getHolidaysForLocation = (locName) => {
        const cals = locationCalendars || [];
        const matched = cals.find(c => (c.location && c.location.toLowerCase() === String(locName || '').toLowerCase()) || (c.name && c.name.toLowerCase().includes(String(locName || '').toLowerCase())));
        if (matched && matched.holidays) {
            return matched.holidays.map(h => typeof h === 'string' ? h : h.title);
        }
        if (siteCalendars && siteCalendars[locName]) {
            return siteCalendars[locName];
        }
        return ['New Year'];
    };

    useEffect(() => {
        const cals = getLocationCalendarsFromStorage();
        setLocationCalendars(cals);
        if (cals.length > 0) {
            const locNames = cals.map(c => c.location || c.name);
            setLocations(locNames);
            if (!location || location === 'Headquarters') {
                setLocation(locNames[0]);
                setHolidayDetails(locNames[0]);
            }
        }
    }, [showAddForm, isEditing]);

    // Fetch Documents for Viewing Employee
    useEffect(() => {
        if (viewingEmployee) {
            fetchEmployeeDocuments(viewingEmployee);
        } else {
            setEmployeeDocuments([]);
        }
    }, [viewingEmployee]);
    const [editName, setEditName] = useState('');
    const [editEmail, setEditEmail] = useState('');
    const [editPassword, setEditPassword] = useState('');
    const [editDob, setEditDob] = useState('');
    const [editGender, setEditGender] = useState('Male');
    const [editEmpCode, setEditEmpCode] = useState('');
    const [editNationality, setEditNationality] = useState('');
    const [editPhoneNo, setEditPhoneNo] = useState('');
    const [editCountryCode, setEditCountryCode] = useState('+91');
    const [editDesignation, setEditDesignation] = useState('FIELD');
    const [editRole, setEditRole] = useState('EMPLOYEE');
    const [editStatus, setEditStatus] = useState('ACTIVE');
    const [editAllowedLeaves, setEditAllowedLeaves] = useState(15);

    // Exit Modal States
    const [showExitModal, setShowExitModal] = useState(false);
    const [exitEmployeeId, setExitEmployeeId] = useState(null);
    const [exitEmployeeName, setExitEmployeeName] = useState('');
    const [exitEmployeeDesignation, setExitEmployeeDesignation] = useState('');
    const [exitEmployeeDept, setExitEmployeeDept] = useState('');
    const [exitEmployeeJoining, setExitEmployeeJoining] = useState('');

    const [exitReason, setExitReason] = useState('Employee wants to resign');
    const [exitDiscussed, setExitDiscussed] = useState(true);
    const [exitDiscussionSummary, setExitDiscussionSummary] = useState('');
    const [exitTerminationReason, setExitTerminationReason] = useState('Performance Issue');
    const [exitNoticeDate, setExitNoticeDate] = useState(new Date().toISOString().split('T')[0]);
    const [exitComments, setExitComments] = useState('');
    const [exitDate, setExitDate] = useState(new Date().toISOString().split('T')[0]);
    const [employeeDocuments, setEmployeeDocuments] = useState([]);
    const [docPreviewModal, setDocPreviewModal] = useState(null);
    const [docFilterTab, setDocFilterTab] = useState('EMPLOYEE');
    const [docHistoryModal, setDocHistoryModal] = useState(null); // Group object with versions // ALL, EMPLOYEE, ADMIN
    const [empDocsLoading, setEmpDocsLoading] = useState(false);
    const [editBankName, setEditBankName] = useState('');
    const [editBankAccountNo, setEditBankAccountNo] = useState('');
    const [editBankIfscCode, setEditBankIfscCode] = useState('');
    const [editBankBranchName, setEditBankBranchName] = useState('');
    const [editFatherName, setEditFatherName] = useState('');
    const [editPresentAddress, setEditPresentAddress] = useState('');
    const [editPermanentAddress, setEditPermanentAddress] = useState('');
    const [editEmergencyContact, setEditEmergencyContact] = useState('');
    const [editAadhaarNumber, setEditAadhaarNumber] = useState('');
    const [editHighestQualLevel, setEditHighestQualLevel] = useState('');
    const [editHighestQualStream, setEditHighestQualStream] = useState('');
    const [editHighestQualInstitution, setEditHighestQualInstitution] = useState('');
    const [editHighestQualYear, setEditHighestQualYear] = useState('');
    const [editHighestQualPercent, setEditHighestQualPercent] = useState('');
    const [editPanNumber, setEditPanNumber] = useState('');
    const [editUanNumber, setEditUanNumber] = useState('');
    const [editPfNumber, setEditPfNumber] = useState('');
    const [editEsiNumber, setEditEsiNumber] = useState('');
    const [editJoiningDate, setEditJoiningDate] = useState('');
    const [editJobTitle, setEditJobTitle] = useState('');
    const [editLegalEntity, setEditLegalEntity] = useState('');
    const [editDepartment, setEditDepartment] = useState('');
    const [editLocation, setEditLocation] = useState('');
    const [editPlaceOfDuty, setEditPlaceOfDuty] = useState('');
    const [editReportingManager, setEditReportingManager] = useState('');
    const [editProbationPolicy, setEditProbationPolicy] = useState('');
    const [editNoticePeriod, setEditNoticePeriod] = useState('');
    const [editLeaveSetting, setEditLeaveSetting] = useState('Paid Leaves');
    const [isEditAddingLeaveType, setIsEditAddingLeaveType] = useState(false);
    const [editNewLeaveType, setEditNewLeaveType] = useState('');
    const [showEditLeaveDropdown, setShowEditLeaveDropdown] = useState(false);
    const [editWeeklyOffs, setEditWeeklyOffs] = useState('');
    const [editAttendanceSetting, setEditAttendanceSetting] = useState('9-5:30');
    const [editStartTime, setEditStartTime] = useState('09:00');
    const [editEndTime, setEditEndTime] = useState('17:30');
    const [editOvertime, setEditOvertime] = useState('');
    const [editHolidayDetails, setEditHolidayDetails] = useState('Chennai');
    const [isEditAddingNewSite, setIsEditAddingNewSite] = useState(false);
    const [editNewSiteName, setEditNewSiteName] = useState('');
    const [editNewHolidayName, setEditNewHolidayName] = useState('');
    const [editExpensePolicies, setEditExpensePolicies] = useState('');
    const [editCompensationGross, setEditCompensationGross] = useState(240000);
    const [editPfEligible, setEditPfEligible] = useState(true);
    const [editPfAmount, setEditPfAmount] = useState('');
    const [showEditEditPf, setShowEditEditPf] = useState(false);
    const [editVpfEligible, setEditVpfEligible] = useState(false);
    const [editVpfAmount, setEditVpfAmount] = useState('');
    const [editEsiEligible, setEditEsiEligible] = useState(true);
    const [editLwfEligible, setEditLwfEligible] = useState(true);
    const [editLwfAmount, setEditLwfAmount] = useState(60);
    const [showEditEditLwf, setShowEditEditLwf] = useState(false);
    const [editPtEligible, setEditPtEligible] = useState(true);
    const [editPtStateCode, setEditPtStateCode] = useState('TN');
    const [editPtExemption, setEditPtExemption] = useState(false);
    const [editPtExemptionType, setEditPtExemptionType] = useState('NONE');
    const [editPtExemptionReason, setEditPtExemptionReason] = useState('');
    const [editPtAmount, setEditPtAmount] = useState('');
    const [showEditEditPt, setShowEditEditPt] = useState(false);
    const [editTaxRegime, setEditTaxRegime] = useState('New Regime (Section 115BAC)');
    const [editDynamicFields, setEditDynamicFields] = useState({});

    const getNextMonthFirst = () => {
        const d = new Date();
        const nextMonth = new Date(d.getFullYear(), d.getMonth() + 1, 1);
        const y = nextMonth.getFullYear();
        const m = String(nextMonth.getMonth() + 1).padStart(2, '0');
        return `${y}-${m}-01`;
    };

    const [editRevisionEffectiveDate, setEditRevisionEffectiveDate] = useState(getNextMonthFirst());
    const [editRevisionReason, setEditRevisionReason] = useState('Annual Appraisal');
    const [salaryHistoryData, setSalaryHistoryData] = useState(null);
    const [loadingSalaryHistory, setLoadingSalaryHistory] = useState(false);

    const fetchSalaryHistory = async (empId) => {
        if (!empId) return;
        setLoadingSalaryHistory(true);
        try {
            const res = await api.getSalaryHistory(empId);
            if (res && res.success) {
                setSalaryHistoryData(res);
            } else {
                setSalaryHistoryData(null);
            }
        } catch (err) {
            console.error('Error fetching salary history:', err);
            setSalaryHistoryData(null);
        } finally {
            setLoadingSalaryHistory(false);
        }
    };

    useEffect(() => {
        if (viewingEmployee && profileTab === 'FINANCES' && financeSubTab === 'REVISIONS') {
            fetchSalaryHistory(viewingEmployee.id);
        }
    }, [viewingEmployee, profileTab, financeSubTab]);

    const handleCloseProfile = () => {
        setViewingEmployee(null);
        setIsEditing(false);
        setSalaryHistoryData(null);
        localStorage.removeItem('viewingEmployeeId');
        localStorage.removeItem('isEditingEmployee');
    };

    // Restore viewing employee state on refresh / mount
    useEffect(() => {
        const storedId = localStorage.getItem('viewingEmployeeId');
        if (storedId && employees.length > 0) {
            const emp = employees.find(e => String(e.id) === String(storedId));
            if (emp) {
                setViewingEmployee(emp);
                setEditName(emp.name || '');
                setEditEmail(emp.email || '');
                setEditPassword('');
                setEditDob(emp.dob || '');
                setEditGender(emp.gender || 'Male');
                setEditEmpCode(emp.empCode || emp.id || '');
                setEditNationality(emp.nationality || 'Indian');
                let parsedPhone = emp.phoneNo || '';
                let parsedCode = '+91';
                if (parsedPhone.startsWith('+')) {
                    const spaceIdx = parsedPhone.indexOf(' ');
                    if (spaceIdx > 0) {
                        parsedCode = parsedPhone.substring(0, spaceIdx);
                        parsedPhone = parsedPhone.substring(spaceIdx + 1);
                    } else {
                        const matchingCode = COUNTRY_CODES.find(c => parsedPhone.startsWith(c.code));
                        if (matchingCode) {
                            parsedCode = matchingCode.code;
                            parsedPhone = parsedPhone.substring(matchingCode.code.length);
                        }
                    }
                }
                setEditCountryCode(parsedCode);
                setEditPhoneNo(parsedPhone);
                setEditDesignation(emp.designation || 'FIELD');
                setEditRole(emp.role || 'EMPLOYEE');
                setEditStatus(emp.status || 'ACTIVE');
                setEditAllowedLeaves(emp.allowedLeaves !== undefined ? emp.allowedLeaves : 15);
                setEditBankName(emp.bankName || '');
                setEditBankAccountNo(emp.bankAccountNo || '');
                setEditBankIfscCode(emp.bankIfscCode || '');
                setEditBankBranchName(emp.bankBranchName || '');
                setEditJoiningDate(emp.joiningDate || '');
                setEditJobTitle(emp.jobTitle || 'Design Engineer');
                setEditLegalEntity(emp.legalEntity || 'Hydromaterials Private Limited');
                setEditDepartment(emp.department || 'Company');
                setEditLocation(emp.location || 'Headquarters');
                setEditPlaceOfDuty(emp.placeOfDuty || emp.place_of_duty || '');
                setEditReportingManager(emp.reportingManager || '');
                setEditProbationPolicy(emp.probationPolicy || 'Permanent Employee');
                setEditNoticePeriod(emp.noticePeriod || '1 Month');
                setEditLeaveSetting(emp.leaveSetting || 'Paid Leaves');
                setEditWeeklyOffs(emp.weeklyOffs || 'Sunday');
                let rawAtt1 = emp.attendanceSetting || '9-5:30';
                if (rawAtt1 === '9-6') rawAtt1 = '9-5:30';
                let sTime1 = emp.startTime || '09:00';
                let eTime1 = emp.endTime || '17:30';
                if (rawAtt1.startsWith('Other') || (!['9-5:30', 'Flexible'].includes(rawAtt1) && rawAtt1.includes('-'))) {
                    setEditAttendanceSetting('Other');
                    const match1 = rawAtt1.match(/(\d{1,2}:\d{2})\s*[-–to]+\s*(\d{1,2}:\d{2})/);
                    if (match1) {
                        sTime1 = match1[1].padStart(5, '0');
                        eTime1 = match1[2].padStart(5, '0');
                    }
                } else {
                    setEditAttendanceSetting(rawAtt1);
                }
                setEditStartTime(sTime1);
                setEditEndTime(eTime1);
                setEditOvertime(emp.overtime || 'Eligible for overtime');
                setEditHolidayDetails(emp.holidayDetails || 'New Year');
                setEditCompensationGross(emp.compensationGross !== undefined ? emp.compensationGross : 240000);
                setEditRevisionEffectiveDate(getNextMonthFirst());
                setEditRevisionReason('Annual Appraisal');
                setEditPfEligible(emp.pfEligible !== undefined ? emp.pfEligible : true);
                setEditPfAmount(emp.pfAmount !== undefined && emp.pfAmount !== null ? emp.pfAmount : '');
                setShowEditEditPf(false);
                setEditVpfEligible(emp.vpfEligible !== undefined ? emp.vpfEligible : (emp.vpfAmount > 0));
                setEditVpfAmount(emp.vpfAmount !== undefined && emp.vpfAmount !== null && emp.vpfAmount !== 0 ? String(emp.vpfAmount) : '');
                setEditEsiEligible(emp.esiEligible !== undefined ? emp.esiEligible : true);
                setEditLwfEligible(emp.lwfEligible !== undefined ? emp.lwfEligible : true);
                setEditPtEligible(emp.ptEligible !== undefined ? emp.ptEligible : true);
                setEditPtStateCode(emp.ptStateCode || 'TN');
                setEditPtExemption(emp.ptExemption || false);
                setEditPtExemptionType(emp.ptExemptionType || 'NONE');
                setEditPtExemptionReason(emp.ptExemptionReason || '');
                const isLegacyDefault = emp.ptAmount === 208 || emp.ptAmount === '208';
                setEditPtAmount(emp.ptAmount !== undefined && emp.ptAmount !== null && !isLegacyDefault ? emp.ptAmount : '');
                setShowEditEditLwf(false);
                setEditTaxRegime(emp.taxRegime || 'New Regime (Section 115BAC)');
                const cleanDynFields = {};
                if (emp.customFields && typeof emp.customFields === 'object') {
                    Object.entries(emp.customFields).forEach(([k, v]) => {
                        if (!SYSTEM_CUSTOM_FIELD_KEYS.has(k)) {
                            cleanDynFields[k] = v;
                        }
                    });
                }
                setEditDynamicFields(cleanDynFields);
                setEditFatherName(emp.fatherName || emp.father_name || '');
                setEditPresentAddress(emp.presentAddress || emp.present_address || '');
                setEditPermanentAddress(emp.permanentAddress || emp.permanent_address || '');
                setEditEmergencyContact(emp.emergencyContact || emp.emergency_contact || '');
                setEditAadhaarNumber(emp.aadhaarNumber || emp.aadharNumber || emp.aadhaar || emp.aadhar || emp.customFields?.aadhaarNumber || emp.customFields?.aadharNumber || '');
                let hq1 = emp.highestQualification;
                if (typeof hq1 === 'string') { try { hq1 = JSON.parse(hq1); } catch (e) { hq1 = {}; } }
                hq1 = hq1 || emp.customFields?.highestQualification || {};
                setEditHighestQualLevel(hq1?.level || '');
                setEditHighestQualStream(hq1?.stream || '');
                setEditHighestQualInstitution(hq1?.institution || '');
                setEditHighestQualYear(hq1?.year || '');
                setEditHighestQualPercent(hq1?.percentage || hq1?.percent || '');
                setEditPanNumber(emp.panNumber || emp.pan || '');
                setEditUanNumber(emp.uanNumber || emp.pfUan || '');
                setEditPfNumber(emp.pfNumber || emp.pf_number || '');
                setEditEsiNumber(emp.esiNumber || emp.esicNumber || emp.esiNo || '');
                
                const storedEditing = localStorage.getItem('isEditingEmployee') === 'true';
                setIsEditing(storedEditing);
            }
        }
    }, [employees]);

    const handleEditClick = (emp) => {
        setViewingEmployee(emp);
        setIsEditing(false);
        localStorage.setItem('viewingEmployeeId', emp.id);
        localStorage.setItem('isEditingEmployee', 'false');
        setEditName(emp.name || '');
        setEditEmail(emp.email || '');
        setEditPassword('');
        setEditDob(emp.dob || '');
        setEditGender(emp.gender || 'Male');
        setEditEmpCode(emp.empCode || emp.id || '');
        setEditNationality(emp.nationality || 'Indian');
        let parsedPhone = emp.phoneNo || '';
        let parsedCode = '+91';
        if (parsedPhone.startsWith('+')) {
            const spaceIdx = parsedPhone.indexOf(' ');
            if (spaceIdx > 0) {
                parsedCode = parsedPhone.substring(0, spaceIdx);
                parsedPhone = parsedPhone.substring(spaceIdx + 1);
            } else {
                const matchingCode = COUNTRY_CODES.find(c => parsedPhone.startsWith(c.code));
                if (matchingCode) {
                    parsedCode = matchingCode.code;
                    parsedPhone = parsedPhone.substring(matchingCode.code.length);
                }
            }
        }
        setEditCountryCode(parsedCode);
        setEditPhoneNo(parsedPhone);
        setEditDesignation(emp.designation || 'FIELD');
        setEditRole(emp.role || 'EMPLOYEE');
        setEditStatus(emp.status || 'ACTIVE');
        setEditAllowedLeaves(emp.allowedLeaves !== undefined ? emp.allowedLeaves : 0);
        setEditBankName(emp.bankName || '');
        setEditBankAccountNo(emp.bankAccountNo || '');
        setEditBankIfscCode(emp.bankIfscCode || '');
        setEditBankBranchName(emp.bankBranchName || '');
        setEditFatherName(emp.fatherName || emp.father_name || '');
        setEditPresentAddress(emp.presentAddress || emp.present_address || '');
        setEditPermanentAddress(emp.permanentAddress || emp.permanent_address || '');
        setEditEmergencyContact(emp.emergencyContact || emp.emergency_contact || '');
        const cleanDynFieldsOnEdit = {};
        if (emp.customFields && typeof emp.customFields === 'object') {
            Object.entries(emp.customFields).forEach(([k, v]) => {
                if (!SYSTEM_CUSTOM_FIELD_KEYS.has(k)) {
                    cleanDynFieldsOnEdit[k] = v;
                }
            });
        }
        setEditDynamicFields(cleanDynFieldsOnEdit);
        setEditAadhaarNumber(emp.aadhaarNumber || emp.aadharNumber || emp.aadhaar || emp.aadhar || emp.customFields?.aadhaarNumber || emp.customFields?.aadharNumber || '');
        let hq2 = emp.highestQualification;
        if (typeof hq2 === 'string') { try { hq2 = JSON.parse(hq2); } catch (e) { hq2 = {}; } }
        hq2 = hq2 || emp.customFields?.highestQualification || {};
        setEditHighestQualLevel(hq2?.level || '');
        setEditHighestQualStream(hq2?.stream || '');
        setEditHighestQualInstitution(hq2?.institution || '');
        setEditHighestQualYear(hq2?.year || '');
        setEditHighestQualPercent(hq2?.percentage || hq2?.percent || '');
        setEditPanNumber(emp.panNumber || emp.pan || '');
        setEditUanNumber(emp.uanNumber || emp.pfUan || '');
        setEditPfNumber(emp.pfNumber || emp.pf_number || '');
        setEditEsiNumber(emp.esiNumber || emp.esicNumber || emp.esiNo || '');
        setEditJoiningDate(emp.joiningDate || '');
        setEditJobTitle(emp.jobTitle || 'Design Engineer');
        setEditLegalEntity(emp.legalEntity || 'Hydromaterials Private Limited');
        setEditDepartment(emp.department || 'Company');
        setEditLocation(emp.location || 'Headquarters');
        setEditPlaceOfDuty(emp.placeOfDuty || emp.place_of_duty || '');
        setEditReportingManager(emp.reportingManager || '');
        setEditProbationPolicy(emp.probationPolicy || 'Permanent Employee');
        setEditNoticePeriod(emp.noticePeriod || '1 Month');
        setEditLeaveSetting(emp.leaveSetting || 'Paid Leaves');
        setEditWeeklyOffs(emp.weeklyOffs || 'Sunday');
        let rawAtt2 = emp.attendanceSetting || '9-5:30';
        if (rawAtt2 === '9-6') rawAtt2 = '9-5:30';
        let sTime2 = emp.startTime || '09:00';
        let eTime2 = emp.endTime || '17:30';
        if (rawAtt2.startsWith('Other') || (!['9-5:30', 'Flexible'].includes(rawAtt2) && rawAtt2.includes('-'))) {
            setEditAttendanceSetting('Other');
            const match2 = rawAtt2.match(/(\d{1,2}:\d{2})\s*[-–to]+\s*(\d{1,2}:\d{2})/);
            if (match2) {
                sTime2 = match2[1].padStart(5, '0');
                eTime2 = match2[2].padStart(5, '0');
            }
        } else {
            setEditAttendanceSetting(rawAtt2);
        }
        setEditStartTime(sTime2);
        setEditEndTime(eTime2);
        setEditOvertime(emp.overtime || 'Eligible for overtime');
        setEditHolidayDetails(emp.holidayDetails || 'New Year');
        setEditExpensePolicies(emp.expensePolicies || 'Standard travel and food reimbursement policy');
        setEditCompensationGross(emp.compensationGross !== undefined ? emp.compensationGross : 240000);
        setEditRevisionEffectiveDate(getNextMonthFirst());
        setEditRevisionReason('Annual Appraisal');
        setEditPfEligible(emp.pfEligible !== undefined ? emp.pfEligible : true);
        setEditPfAmount(emp.pfAmount !== undefined && emp.pfAmount !== null ? emp.pfAmount : '');
        setShowEditEditPf(false);
        setEditVpfEligible(emp.vpfEligible !== undefined ? emp.vpfEligible : (emp.vpfAmount > 0));
        setEditVpfAmount(emp.vpfAmount !== undefined && emp.vpfAmount !== null && emp.vpfAmount !== 0 ? String(emp.vpfAmount) : '');
        setEditEsiEligible(emp.esiEligible !== undefined ? emp.esiEligible : true);
        setEditLwfEligible(emp.lwfEligible !== undefined ? emp.lwfEligible : true);
        setEditPtEligible(emp.ptEligible !== undefined ? emp.ptEligible : true);
        setEditPtStateCode(emp.ptStateCode || 'TN');
        setEditPtExemption(emp.ptExemption || false);
        setEditPtExemptionType(emp.ptExemptionType || 'NONE');
        setEditPtExemptionReason(emp.ptExemptionReason || '');
        const isLegacyDefaultClick = emp.ptAmount === 208 || emp.ptAmount === '208';
        setEditPtAmount(emp.ptAmount !== undefined && emp.ptAmount !== null && !isLegacyDefaultClick ? emp.ptAmount : '');
        setShowEditEditLwf(false);
        setShowEditEditPt(false);
        setEditTaxRegime(emp.taxRegime || 'New Regime (Section 115BAC)');
        const cleanDynFieldsClick = {};
        if (emp.customFields && typeof emp.customFields === 'object') {
            Object.entries(emp.customFields).forEach(([k, v]) => {
                if (!SYSTEM_CUSTOM_FIELD_KEYS.has(k)) {
                    cleanDynFieldsClick[k] = v;
                }
            });
        }
        setEditDynamicFields(cleanDynFieldsClick);
        setShowAddForm(false); // Hide add form if open
    };

    const handleUpdateEmployee = async (e) => {
        e.preventDefault();
        if (!editName || !editEmail) {
            return alert("Name and email are required.");
        }

        setLoading(true);
        try {
            const updated = await api.updateEmployee(viewingEmployee.id, {
                name: editName,
                email: editEmail,
                password: editPassword || undefined,
                designation: editDesignation,
                role: editRole,
                status: editStatus,
                allowedLeaves: Number(editAllowedLeaves),
                dob: editDob,
                gender: editGender || 'Male',
                empCode: editEmpCode,
                nationality: editNationality,
                phoneNo: editPhoneNo.startsWith('+') ? editPhoneNo : `${editCountryCode} ${editPhoneNo}`,
                joiningDate: editJoiningDate,
                jobTitle: editJobTitle,
                legalEntity: editLegalEntity,
                department: editDepartment,
                location: editLocation,
                placeOfDuty: editPlaceOfDuty,
                reportingManager: editReportingManager,
                probationPolicy: editProbationPolicy,
                noticePeriod: editNoticePeriod,
                leaveSetting: editLeaveSetting,
                weeklyOffs: editWeeklyOffs,
                attendanceSetting: editAttendanceSetting === 'Other' ? `Other (${editStartTime} - ${editEndTime})` : editAttendanceSetting,
                startTime: editAttendanceSetting === 'Other' ? editStartTime : (editAttendanceSetting === '9-5:30' ? '09:00' : ''),
                endTime: editAttendanceSetting === 'Other' ? editEndTime : (editAttendanceSetting === '9-5:30' ? '17:30' : ''),
                overtime: editOvertime,
                holidayDetails: editHolidayDetails,
                expensePolicies: editExpensePolicies,
                compensationGross: Number(editCompensationGross),
                revisionEffectiveDate: editRevisionEffectiveDate,
                revisionReason: editRevisionReason,
                pfEligible: editPfEligible,
                pfAmount: editPfEligible ? (editPfAmount !== '' && editPfAmount !== null && !isNaN(Number(editPfAmount)) ? Number(editPfAmount) : null) : 0,
                vpfEligible: editVpfEligible,
                vpfAmount: editVpfEligible ? (Number(editVpfAmount) || 0) : 0,
                esiEligible: editEsiEligible,
                lwfEligible: editLwfEligible,
                lwfAmount: editLwfEligible ? (Number(editLwfAmount) >= 0 && editLwfAmount !== '' ? Number(editLwfAmount) : 60) : 0,
                ptEligible: editPtEligible,
                ptAmount: editPtEligible && editPtAmount !== '' ? Number(editPtAmount) : null,
                ptStateCode: editPtStateCode,
                ptExemption: editPtExemption,
                ptExemptionType: editPtExemption ? editPtExemptionType : 'NONE',
                ptExemptionReason: editPtExemption ? editPtExemptionReason : '',
                taxRegime: editTaxRegime,
                customFields: editDynamicFields,
                bankName: editBankName,
                bankAccountNo: editBankAccountNo,
                bankIfscCode: editBankIfscCode,
                bankBranchName: editBankBranchName,
                fatherName: editFatherName,
                presentAddress: editPresentAddress,
                permanentAddress: editPermanentAddress,
                emergencyContact: editEmergencyContact,
                highestQualification: {
                    level: editHighestQualLevel,
                    stream: editHighestQualStream,
                    institution: editHighestQualInstitution,
                    year: editHighestQualYear,
                    percentage: editHighestQualPercent
                },
                aadhaarNumber: editAadhaarNumber,
                panNumber: editPanNumber,
                uanNumber: editUanNumber,
                pfNumber: editPfNumber,
                esiNumber: editEsiNumber
            });

            if (updated) {
                setViewingEmployee(updated);
                setEditFatherName(updated.fatherName || updated.father_name || '');
                setEditPresentAddress(updated.presentAddress || updated.present_address || '');
                setEditPermanentAddress(updated.permanentAddress || updated.permanent_address || '');
                setEditEmergencyContact(updated.emergencyContact || updated.emergency_contact || '');
                setEditAadhaarNumber(updated.aadhaarNumber || updated.aadharNumber || '');
                setEditPanNumber(updated.panNumber || updated.pan || '');
                setEditUanNumber(updated.uanNumber || updated.pfUan || '');
                setEditPfNumber(updated.pfNumber || updated.pf_number || '');
                setEditEsiNumber(updated.esiNumber || updated.esicNumber || '');
                setEditPlaceOfDuty(updated.placeOfDuty || updated.place_of_duty || '');
                if (updated.id) {
                    localStorage.setItem('viewingEmployeeId', updated.id);
                }
            }

            setIsEditing(false);
            localStorage.setItem('isEditingEmployee', 'false');
            window.dispatchEvent(new CustomEvent('employee-updated', { detail: updated }));

            // Background sync without freezing UI
            if (refreshEmployees) {
                refreshEmployees().catch(() => {});
            }

            alert("Employee profile updated successfully!");
        } catch (err) {
            alert(err.message || "Failed to update employee.");
        } finally {
            setLoading(false);
        }
    };

    const handleDeleteEmployee = async (id, name) => {
        if (!window.confirm(`Are you sure you want to delete employee "${name}"?`)) {
            return;
        }

        setLoading(true);
        try {
            await api.deleteEmployee(id);
            alert("Employee deleted successfully!");
            if (refreshEmployees) {
                await refreshEmployees();
            }
            window.dispatchEvent(new CustomEvent('employee-updated', { detail: { id, action: 'delete' } }));
        } catch (err) {
            alert(err.message || "Failed to delete employee.");
        } finally {
            setLoading(false);
        }
    };

    const handleToggleStatus = async (id, currentStatus) => {
        if (currentStatus === 'ACTIVE') {
            const emp = employees.find(e => e.id === id);
            if (emp) {
                setExitEmployeeId(id);
                setExitEmployeeName(emp.name);
                setExitEmployeeDesignation(emp.designation || 'OFFICE');
                setExitEmployeeDept(emp.department || 'Company');
                setExitEmployeeJoining(emp.joiningDate || '');
                
                // Reset form values
                setExitReason('Employee wants to resign');
                setExitDiscussed(true);
                setExitDiscussionSummary('');
                setExitTerminationReason('Performance Issue');
                setExitNoticeDate(new Date().toISOString().split('T')[0]);
                setExitDate(new Date().toISOString().split('T')[0]);
                setExitComments('');

                setShowExitModal(true);
            }
            return;
        }

        // Activate past employee directly
        if (!window.confirm("Are you sure you want to activate this past employee?")) {
            return;
        }

        setLoading(true);
        try {
            await api.updateEmployee(id, { 
                status: 'ACTIVE',
                exitReason: null,
                exitDiscussed: null,
                exitDiscussionSummary: null,
                exitTerminationReason: null,
                exitNoticeDate: null,
                exitComments: null,
                exitDate: null
            });
            alert("Employee activated successfully!");
            if (refreshEmployees) {
                await refreshEmployees();
            }
            window.dispatchEvent(new CustomEvent('employee-updated', { detail: { id, action: 'activate' } }));
        } catch (err) {
            alert(err.message || "Failed to activate employee.");
        } finally {
            setLoading(false);
        }
    };

    const submitExitProcess = async () => {
        setLoading(true);
        try {
            await api.updateEmployee(exitEmployeeId, {
                status: 'PAST',
                exitReason,
                exitDiscussed,
                exitDiscussionSummary,
                exitTerminationReason: exitReason === 'Company decides to terminate' ? exitTerminationReason : null,
                exitNoticeDate,
                exitComments: exitReason === 'Company decides to terminate' ? exitComments : null,
                exitDate
            });

            alert(`Employee exit process initiated successfully.`);
            setShowExitModal(false);
            if (refreshEmployees) {
                await refreshEmployees();
            }
            window.dispatchEvent(new CustomEvent('employee-updated', { detail: { id: exitEmployeeId, action: 'exit' } }));
        } catch (err) {
            alert(err.message || "Failed to process exit.");
        } finally {
            setLoading(false);
        }
    };

    const fetchEmployeeDocuments = async (targetEmp) => {
        const emp = targetEmp || viewingEmployee;
        if (!emp) return;
        setEmpDocsLoading(true);
        try {
            const empId = String(emp.id || '').trim().toLowerCase();
            const empCode = String(emp.empCode || '').trim().toLowerCase();
            const empName = String(emp.name || '').trim().toLowerCase();

            const data = await api.getDocuments();
            const allDocs = Array.isArray(data) ? data : [];

            const filtered = allDocs.filter(d => {
                if (!d) return false;
                if (!d.uploaderId && !d.uploaderName && !d.targetUserId && !d.targetUserName) return false;

                const uploaderId = String(d.uploaderId || '').trim().toLowerCase();
                const uploaderName = String(d.uploaderName || '').trim().toLowerCase();
                const targetUserId = String(d.targetUserId || '').trim().toLowerCase();
                const targetUserName = String(d.targetUserName || '').trim().toLowerCase();

                const isUploader = (uploaderId && (uploaderId === empId || uploaderId === empCode || (empName === 'aman' && uploaderId === 'emp1'))) ||
                                   (uploaderName && uploaderName !== 'admin' && uploaderName !== 'system admin' && (uploaderName === empName || (uploaderName.length > 2 && empName.includes(uploaderName))));

                const isTarget = (targetUserId && (targetUserId === empId || targetUserId === empCode)) ||
                                 (targetUserName && (targetUserName === empName || (targetUserName.length > 2 && empName.includes(targetUserName))));

                return isUploader || isTarget;
            });

            setEmployeeDocuments(filtered);
        } catch (err) {
            console.error("Failed to fetch employee documents:", err);
            setEmployeeDocuments([]);
        } finally {
            setEmpDocsLoading(false);
        }
    };

    const handleEmployeeDocUpload = async (e) => {
        const file = e.target.files[0];
        if (!file || !viewingEmployee) return;

        const titlePrompt = prompt("Enter a title/name for this document:", file.name);
        if (titlePrompt === null) return;
        const title = titlePrompt.trim() || file.name;

        const formData = new FormData();
        formData.append('file', file);
        formData.append('title', title);
        formData.append('uploaderId', 'admin');
        formData.append('uploaderName', 'Admin');
        formData.append('targetType', 'INDIVIDUAL');
        formData.append('targetUserId', viewingEmployee.id);
        formData.append('targetUserName', viewingEmployee.name);

        try {
            await api.uploadDocument(formData);
            alert("Document uploaded successfully!");
            await fetchEmployeeDocuments(viewingEmployee.id);
        } catch (err) {
            alert(err.message || "Failed to upload document.");
        }
    };

    const handleDeleteEmployeeDoc = async (docId) => {
        if (!window.confirm("Are you sure you want to delete this document?")) return;
        try {
            await api.request(`/documents/${docId}`, { method: 'DELETE' });
            alert("Document deleted successfully!");
            if (viewingEmployee) {
                await fetchEmployeeDocuments(viewingEmployee.id);
            }
        } catch (err) {
            alert(err.message || "Failed to delete document.");
        }
    };

    const handleProfilePhotoChange = async (e) => {
        const file = e.target.files[0];
        if (!file || !viewingEmployee) return;

        const formData = new FormData();
        formData.append('profilePhoto', file);

        try {
            const updated = await api.uploadProfilePhoto(viewingEmployee.id, formData);
            alert("Profile photo updated successfully!");
            setViewingEmployee(updated);
            if (refreshEmployees) {
                await refreshEmployees();
            }
        } catch (err) {
            alert(err.message || "Failed to upload profile photo.");
        }
    };

    const handleProfilePhotoDelete = async () => {
        if (!viewingEmployee || !window.confirm("Are you sure you want to delete this profile photo?")) return;
        try {
            const updated = await api.deleteProfilePhoto(viewingEmployee.id);
            alert("Profile photo deleted successfully!");
            setViewingEmployee(updated);
            if (refreshEmployees) {
                await refreshEmployees();
            }
        } catch (err) {
            alert(err.message || "Failed to delete profile photo.");
        }
    };



    // Search and Filter State
    const [searchTerm, setSearchTerm] = useState('');
    const [filterDesignation, setFilterDesignation] = useState('ALL');
    const [activeStatusTab, setActiveStatusTab] = useState('ACTIVE');

    useEffect(() => {
        const fetchStatus = async () => {
            try {
                const [footprints, attendance] = await Promise.all([
                    api.getLatestAllFootprints(),
                    api.getAttendance()
                ]);

                // Map employee names to all userIds they have used in attendance
                const employeeIdsMap = {};
                employees.forEach(emp => {
                    const ids = new Set([emp.id]);
                    attendance.forEach(r => {
                        if (r.userName && r.userName.toLowerCase() === emp.name.toLowerCase()) {
                            ids.add(r.userId);
                        }
                    });
                    employeeIdsMap[emp.id] = Array.from(ids);
                });

                const latest = {};
                employees.forEach(emp => {
                    const associatedIds = employeeIdsMap[emp.id];
                    let latestF = null;
                    footprints.forEach(f => {
                        if (associatedIds.includes(f.userId)) {
                            if (!latestF || Number(f.timestamp) > Number(latestF.timestamp)) {
                                latestF = f;
                            }
                        }
                    });
                    if (latestF) {
                        latest[emp.id] = latestF;
                    }
                });
                setLatestFootprints(latest);

                // Calculate today's GPS-only distance for each employee
                const todayStr = new Date().toISOString().split('T')[0];
                const distances = {};

                employees.forEach(emp => {
                    const associatedIds = employeeIdsMap[emp.id];
                    const empFootprints = footprints.filter(f => 
                        associatedIds.includes(f.userId) && 
                        f.date === todayStr && 
                        f.latitude && 
                        f.longitude && 
                        f.trackingMethod === 'GPS'
                    ).sort((a, b) => Number(a.timestamp) - Number(b.timestamp));

                    const toRad = (x) => (x * Math.PI) / 180;
                    let total = 0;
                    for (let i = 0; i < empFootprints.length - 1; i++) {
                        const lat1 = parseFloat(empFootprints[i].latitude);
                        const lon1 = parseFloat(empFootprints[i].longitude);
                        const lat2 = parseFloat(empFootprints[i + 1].latitude);
                        const lon2 = parseFloat(empFootprints[i + 1].longitude);
                        
                        const R = 6371; // Earth radius in km
                        const dLat = toRad(lat2 - lat1);
                        const dLon = toRad(lon2 - lon1);
                        const a =
                            Math.sin(dLat / 2) * Math.sin(dLat / 2) +
                            Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
                        const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
                        total += R * c;
                    }
                    distances[emp.id] = total.toFixed(2);
                });
                setTodayDistances(distances);
            } catch (err) {
                console.error("Failed to fetch footprints for employee status:", err);
            }
        };
        fetchStatus();
    }, [employees]);

    const getGpsIcon = (userId) => {
        const f = latestFootprints[userId];
        if (!f) return <span style={{ color: '#9ca3af', fontSize: '0.85rem' }}>No Data</span>;
        
        const enabled = f.locationEnabled !== false; // Default to true if not explicitly false
        const color = enabled ? "#10b981" : "#ef4444";
        
        return (
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', color }}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M12 2a8 8 0 0 0-8 8c0 5.25 8 12 8 12s8-6.75 8-12a8 8 0 0 0-8-8z"/>
                    <circle cx="12" cy="10" r="3"/>
                </svg>
                <span style={{ fontSize: '0.85rem', fontWeight: 500 }}>{enabled ? 'Active' : 'Off'}</span>
            </div>
        );
    };

    const formatLastUpdateTime = (timestamp) => {
        if (!timestamp) return '';
        const date = new Date(Number(timestamp));
        const today = new Date();
        const isToday = date.toDateString() === today.toDateString();
        
        const timeOptions = { hour: '2-digit', minute: '2-digit', hour12: true };
        const timeStr = date.toLocaleTimeString([], timeOptions);
        
        if (isToday) {
            return timeStr;
        } else {
            const dateStr = date.toLocaleDateString([], { day: '2-digit', month: 'short' });
            return `${dateStr} ${timeStr}`;
        }
    };

    const getBatteryIcon = (userId) => {
        const f = latestFootprints[userId];
        if (!f || f.batteryLevel === null || f.batteryLevel === undefined) {
            return <span style={{ color: '#9ca3af', fontSize: '0.85rem' }}>No Data</span>;
        }

        let level = Number(f.batteryLevel);
        if (level > 1.0) {
            level = level / 100;
        }
        const pct = Math.round(level * 100);
        const color = level < 0.2 ? "#ef4444" : level < 0.5 ? "#f59e0b" : "#10b981";
        const updateTime = formatLastUpdateTime(f.timestamp);

        return (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <svg width="22" height="12" viewBox="0 0 24 14" fill="none" xmlns="http://www.w3.org/2000/svg" style={{ color }}>
                        <rect x="1" y="1" width="18" height="12" rx="2" stroke="currentColor" strokeWidth="2"/>
                        <path d="M21 4V10" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
                        <rect x="3" y="3" width={Math.max(1, Math.min(14, 14 * level))} height="8" rx="1" fill="currentColor"/>
                    </svg>
                    <span style={{ fontSize: '0.85rem', fontWeight: 600, color }}>{pct}%</span>
                </div>
                {updateTime && (
                    <span style={{ fontSize: '0.7rem', color: '#64748b', fontWeight: 500, paddingLeft: '2px' }}>
                        {updateTime}
                    </span>
                )}
            </div>
        );
    };

    const handleAddEmployee = async (e) => {
        if (e) e.preventDefault();
        if (!name || !email) {
            return alert("Name and email are required.");
        }

        setLoading(true);
        try {
            const customFieldsSubmit = {};
            Object.entries(dynamicFields).forEach(([label, field]) => {
                customFieldsSubmit[label] = field.value;
            });

            await api.createEmployee({
                name,
                email,
                password: (password && password.trim() && password !== '.') ? password : 'Employee@123',
                designation,
                role,
                allowedLeaves: Number(allowedLeaves),
                dob,
                gender: gender || 'Male',
                empCode,
                nationality,
                phoneNo: phoneNo.startsWith('+') ? phoneNo : `${countryCode} ${phoneNo}`,
                joiningDate,
                jobTitle,
                legalEntity,
                department,
                location,
                placeOfDuty,
                reportingManager,
                probationPolicy,
                noticePeriod,
                leaveSetting,
                holidayDetails,
                weeklyOffs,
                attendanceSetting: attendanceSetting === 'Other' ? `Other (${startTime} - ${endTime})` : attendanceSetting,
                startTime: attendanceSetting === 'Other' ? startTime : (attendanceSetting === '9-5:30' ? '09:00' : ''),
                endTime: attendanceSetting === 'Other' ? endTime : (attendanceSetting === '9-5:30' ? '17:30' : ''),
                overtime,
                expensePolicies,
                compensationGross: Number(compensationGross),
                pfEligible,
                pfAmount: pfEligible ? (pfAmount !== '' && pfAmount !== null && !isNaN(Number(pfAmount)) ? Number(pfAmount) : null) : 0,
                vpfEligible,
                vpfAmount: vpfEligible ? (Number(vpfAmount) || 0) : 0,
                esiEligible,
                lwfEligible,
                lwfAmount: lwfEligible ? (Number(lwfAmount) >= 0 && lwfAmount !== '' ? Number(lwfAmount) : 60) : 0,
                ptEligible,
                ptAmount: ptEligible && ptAmount !== '' ? Number(ptAmount) : null,
                ptStateCode,
                ptExemption,
                ptExemptionType: ptExemption ? ptExemptionType : 'NONE',
                ptExemptionReason: ptExemption ? ptExemptionReason : '',
                taxRegime,
                customFields: customFieldsSubmit,
                bankName,
                bankAccountNo,
                bankIfscCode,
                bankBranchName,
                fatherName,
                presentAddress,
                permanentAddress,
                emergencyContact,
                highestQualification: {
                    level: highestQualLevel,
                    stream: highestQualStream,
                    institution: highestQualInstitution,
                    year: highestQualYear,
                    percentage: highestQualPercent
                },
                aadhaarNumber,
                panNumber,
                uanNumber,
                pfNumber,
                esiNumber
            });

            alert("Employee added successfully!");
            
            // Reset form
            setName('');
            setEmail('');
            setPassword('');
            setDob('');
            setFatherName('');
            setPresentAddress('');
            setPermanentAddress('');
            setEmergencyContact('');
            setHighestQualLevel('');
            setHighestQualStream('');
            setHighestQualInstitution('');
            setHighestQualYear('');
            setHighestQualPercent('');
            setAadhaarNumber('');
            setPanNumber('');
            setUanNumber('');
            setPfNumber('');
            setEsiNumber('');
            setEmpCode('');
            setBankName('');
            setBankAccountNo('');
            setBankIfscCode('');
            setBankBranchName('');
            setNationality('Indian');
            setPhoneNo('');
            setCountryCode('+91');
            setDesignation('FIELD');
            setRole('EMPLOYEE');
            setAllowedLeaves(0);
            setJoiningDate('');
            setJobTitle('Design Engineer');
            setLegalEntity('Hydromaterials Private Limited');
            setDepartment('Company');
            setLocation('Headquarters');
            setReportingManager('');
            setProbationPolicy('Permanent Employee');
            setNoticePeriod('1 Month');
            setLeaveSetting('Paid Leaves');
            setHolidayDetails('Chennai');
            setWeeklyOffs('Sunday');
            setAttendanceSetting('9-5:30');
            setStartTime('09:00');
            setEndTime('17:30');
            setOvertime('Eligible for overtime');
            setExpensePolicies('Standard travel and food reimbursement policy');
            setCompensationGross(240000);
            setPfEligible(true);
            setPfAmount('');
            setShowEditPf(false);
            setVpfEligible(false);
            setVpfAmount('');
            setEsiEligible(true);
            setLwfEligible(true);
            setLwfAmount(60);
            setShowEditLwf(false);
            setPtEligible(true);
            setPtAmount(208);
            setShowEditPt(false);
            setTaxRegime('New Regime (Section 115BAC)');
            setDynamicFields({});
            
            setFormStep(1);
            setShowAddForm(false);
            setActiveStatusTab('ACTIVE');
            setSearchTerm('');
            setFilterDesignation('ALL');

            if (refreshEmployees) {
                await refreshEmployees();
            }
            window.dispatchEvent(new CustomEvent('employee-updated', { detail: { action: 'add' } }));
        } catch (err) {
            alert(err.message || "Failed to add employee.");
        } finally {
            setLoading(false);
        }
    };

    // Filter employees based on search queries and type filter selection
    const filteredEmployees = employees.filter(emp => {
        // Exclude system admin from status filtering or keep under Active
        const empStatus = emp.status || 'ACTIVE';
        if (emp.id === 'admin') {
            if (activeStatusTab !== 'ACTIVE') return false;
        } else {
            if (empStatus !== activeStatusTab) return false;
        }

        const term = searchTerm.toLowerCase();
        const matchesSearch = 
            (emp.name && emp.name.toLowerCase().includes(term)) || 
            (emp.email && emp.email.toLowerCase().includes(term)) || 
            (emp.role && emp.role.toLowerCase().includes(term)) || 
            (emp.empCode && emp.empCode.toLowerCase().includes(term)) ||
            (emp.id && String(emp.id).toLowerCase().includes(term));

        const matchesType = 
            filterDesignation === 'ALL' || 
            emp.designation === filterDesignation;

        return matchesSearch && matchesType;
    });
    // Dynamic Compensation Breakdown Calculations
    const salary = Number(compensationGross) || 0;
    const monthlyGross = Math.round(salary / 12);
    
    // Earnings breakdown: Basic (50%), HRA (30%), Other Allowance (20%)
    const annualBasic = Math.round(salary * 0.5);
    const monthlyBasic = Math.round(monthlyGross * 0.5);
    
    const annualHra = Math.round(salary * 0.3);
    const monthlyHra = Math.round(monthlyGross * 0.3);
    
    const annualOther = salary - annualBasic - annualHra;
    const monthlyOther = monthlyGross - monthlyBasic - monthlyHra;
    
    // Deductions:
    const pfWage = monthlyBasic + monthlyOther; // Equivalent to (monthlyGross - monthlyHra)
    const defaultMonthlyPf = pfWage < 15000 ? Math.round(pfWage * 0.12) : 1800;
    const monthlyPf = pfEligible ? (pfAmount !== '' && pfAmount !== null && !isNaN(Number(pfAmount)) ? Number(pfAmount) : defaultMonthlyPf) : 0;
    const annualPf = monthlyPf * 12;

    const monthlyVpf = vpfEligible ? (Number(vpfAmount) || 0) : 0;
    const annualVpf = monthlyVpf * 12;
    
    const monthlyEsi = esiEligible ? Math.round(monthlyGross * 0.0075) : 0;
    const annualEsi = monthlyEsi * 12;
    
    const annualLwf = lwfEligible ? (Number(lwfAmount) >= 0 && lwfAmount !== '' ? Number(lwfAmount) : 60) : 0;
    const monthlyLwf = lwfEligible ? Math.round(annualLwf / 12) : 0;

    const calculateClientSidePT = (grossMonthly, stateCode, statesList, isExempt, manualOverride, empGender = 'MALE') => {
        if (isExempt) return 0;
        if (manualOverride !== '' && manualOverride !== undefined && manualOverride !== null && !isNaN(Number(manualOverride)) && Number(manualOverride) >= 0) {
            return Number(manualOverride);
        }
        if (!stateCode) return 0;

        // Check dynamic rules from statesList if loaded
        const matchedState = statesList && statesList.find(s => s.stateCode === stateCode || s.id === stateCode);
        if (matchedState && Array.isArray(matchedState.rules) && matchedState.rules.length > 0) {
            const activeRules = matchedState.rules.filter(r => r.isActive !== false && r.status === 'ACTIVE');
            const matchedRule = activeRules.find(r => {
                const salaryMatch = grossMonthly >= Number(r.salaryFrom) && grossMonthly <= Number(r.salaryTo);
                const genderMatch = !r.gender || r.gender === 'ALL' || r.gender.toUpperCase() === (empGender || 'ALL').toUpperCase();
                return salaryMatch && genderMatch;
            });
            if (matchedRule) {
                return Number(matchedRule.ptAmount) || 0;
            }
        }

        // Standard statutory rules fallback
        switch (stateCode) {
            case 'TN': // Tamil Nadu (Monthly statutory slabs on Monthly Gross)
                if (grossMonthly <= 3500) return 0;
                if (grossMonthly <= 5000) return 20;
                if (grossMonthly <= 7500) return 50;
                if (grossMonthly <= 10000) return 100;
                if (grossMonthly <= 12500) return 150;
                return 208;
            case 'AP': // Andhra Pradesh
            case 'TS': // Telangana
                if (grossMonthly <= 15000) return 0;
                if (grossMonthly <= 20000) return 150;
                return 200;
            case 'KA': // Karnataka
                return grossMonthly >= 15000 ? 200 : 0;
            case 'GJ': // Gujarat
                if (grossMonthly < 6000) return 0;
                if (grossMonthly < 9000) return 80;
                if (grossMonthly < 12000) return 150;
                return 200;
            case 'MH': // Maharashtra
                if (empGender && empGender.toUpperCase() === 'FEMALE') {
                    return grossMonthly > 25000 ? 200 : 0;
                }
                if (grossMonthly <= 7500) return 0;
                if (grossMonthly <= 10000) return 175;
                return 200;
            case 'WB': // West Bengal
                if (grossMonthly <= 10000) return 0;
                if (grossMonthly <= 15000) return 110;
                if (grossMonthly <= 25000) return 130;
                if (grossMonthly <= 40000) return 150;
                return 200;
            case 'MP': // Madhya Pradesh
                if (grossMonthly <= 18750) return 0;
                if (grossMonthly <= 25000) return 125;
                if (grossMonthly <= 33333) return 167;
                return 208;
            case 'DL': // Delhi (Exempt)
                return 0;
            default:
                return 0;
        }
    };

    const monthlyPt = ptEligible ? calculateClientSidePT(monthlyGross, ptStateCode, ptStatesList, ptExemption, ptAmount, gender) : 0;
    const annualPt = monthlyPt * 12;
    
    const totalDeductionsMonthly = monthlyPf + monthlyVpf + monthlyEsi + monthlyLwf + monthlyPt;
    const totalDeductionsAnnual = annualPf + annualVpf + annualEsi + annualLwf + annualPt;
    
    const monthlyNet = monthlyGross - totalDeductionsMonthly;
    const annualNet = salary - totalDeductionsAnnual;

    // Dynamic Compensation Breakdown Calculations for EDIT
    const editSalary = Number(editCompensationGross) || 0;
    const editMonthlyGross = Math.round(editSalary / 12);
    const editAnnualBasic = Math.round(editSalary * 0.5);
    const editMonthlyBasic = Math.round(editMonthlyGross * 0.5);
    const editAnnualHra = Math.round(editSalary * 0.3);
    const editMonthlyHra = Math.round(editMonthlyGross * 0.3);
    const editAnnualOther = editSalary - editAnnualBasic - editAnnualHra;
    const editMonthlyOther = editMonthlyGross - editMonthlyBasic - editMonthlyHra;
    
    const editPfWage = editMonthlyBasic + editMonthlyOther; // Equivalent to (editMonthlyGross - editMonthlyHra)
    const editDefaultMonthlyPf = editPfWage < 15000 ? Math.round(editPfWage * 0.12) : 1800;
    const editMonthlyPf = editPfEligible ? (editPfAmount !== '' && editPfAmount !== null && !isNaN(Number(editPfAmount)) ? Number(editPfAmount) : editDefaultMonthlyPf) : 0;
    const editAnnualPf = editMonthlyPf * 12;

    const editMonthlyVpf = editVpfEligible ? (Number(editVpfAmount) || 0) : 0;
    const editAnnualVpf = editMonthlyVpf * 12;

    const editMonthlyEsi = editEsiEligible ? Math.round(editMonthlyGross * 0.0075) : 0;
    const editAnnualEsi = editMonthlyEsi * 12;

    const editAnnualLwf = editLwfEligible ? (Number(editLwfAmount) >= 0 && editLwfAmount !== '' ? Number(editLwfAmount) : 60) : 0;
    const editMonthlyLwf = editLwfEligible ? Math.round(editAnnualLwf / 12) : 0;

    const editMonthlyPt = editPtEligible ? calculateClientSidePT(editMonthlyGross, editPtStateCode, ptStatesList, editPtExemption, editPtAmount, viewingEmployee?.gender) : 0;
    const editAnnualPt = editMonthlyPt * 12;
    
    const editTotalDeductionsMonthly = editMonthlyPf + editMonthlyVpf + editMonthlyEsi + editMonthlyLwf + editMonthlyPt;
    const editTotalDeductionsAnnual = editAnnualPf + editAnnualVpf + editAnnualEsi + editAnnualLwf + editAnnualPt;
    const editMonthlyNet = editMonthlyGross - editTotalDeductionsMonthly;
    const editAnnualNet = editSalary - editTotalDeductionsAnnual;

    const formatCurrency = (val) => {
        return new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 }).format(val);
    };

    return (
        <div id="employees-view" className="view active" style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
            {/* Header Control panel - Shown ONLY in Directory view when not adding employee and not viewing profile */}
            {!viewingEmployee && !showAddForm && (
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div>
                        <h2 style={{ margin: 0, fontSize: '1.3rem', fontWeight: 700, color: 'var(--text-primary)' }}>Company Employees</h2>
                        <p style={{ margin: '2px 0 0 0', fontSize: '0.75rem', color: 'var(--text-muted)' }}>Manage employee profiles, designations, tracking and compensation structures.</p>
                    </div>
                    <button 
                        className="btn btn-primary"
                        onClick={() => {
                            setShowAddForm(true);
                            setViewingEmployee(null);
                            setIsEditing(false);
                            setFormStep(1);
                        }}
                        style={{
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: '8px',
                            padding: '8px 18px',
                            height: '38px',
                            borderRadius: '8px',
                            fontSize: '0.85rem',
                            fontWeight: 600,
                            cursor: 'pointer',
                            transition: 'all 0.2s ease'
                        }}
                    >
                        <span style={{ fontSize: '1.1rem', lineHeight: 1 }}>+</span>
                        Add Employee
                    </button>
                </div>
            )}

            {/* Expandable Form Panel */}
            {showAddForm && (
                <div className="glass" style={{ padding: '18px 22px', borderRadius: '12px' }}>
                    {/* Header inside registration form with right-aligned Cancel button */}
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px', paddingBottom: '12px', borderBottom: '1px solid #e2e8f0' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                            <div style={{ width: '34px', height: '34px', borderRadius: '8px', background: '#eff6ff', color: '#2563eb', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '1.1rem', fontWeight: 700 }}>
                                👤
                            </div>
                            <div>
                                <h3 style={{ margin: 0, fontSize: '1.1rem', fontWeight: 700, color: '#0f172a' }}>New Employee Registration</h3>
                                <p style={{ margin: '2px 0 0 0', fontSize: '0.74rem', color: '#64748b' }}>Complete all onboarding steps to add employee into the company database.</p>
                            </div>
                        </div>

                        <button 
                            type="button"
                            className="btn btn-outline"
                            onClick={() => {
                                setShowAddForm(false);
                                setFormStep(1);
                            }}
                            style={{
                                height: '34px',
                                padding: '6px 14px',
                                borderRadius: '8px',
                                fontSize: '0.8rem',
                                fontWeight: 600,
                                color: '#dc2626',
                                border: '1px solid #fca5a5',
                                background: '#fff',
                                display: 'inline-flex',
                                alignItems: 'center',
                                gap: '6px',
                                cursor: 'pointer',
                                transition: 'all 0.15s ease'
                            }}
                            title="Cancel and return to employee directory"
                        >
                            <span style={{ fontSize: '1.1rem', lineHeight: 1 }}>×</span> Cancel Registration
                        </button>
                    </div>
                    
                    {/* Step Indicators */}
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '24px', position: 'relative', overflowX: 'auto', WebkitOverflowScrolling: 'touch', paddingBottom: '6px' }}>
                        <div style={{ position: 'absolute', top: '15px', left: '10%', right: '10%', height: '2px', backgroundColor: '#e2e8f0', zIndex: 1 }}></div>
                        {[1, 2, 3, 4, 5, 6].map((step) => {
                            const labels = ['Personal', 'Job Details', 'Employment Terms', 'Work Details', 'Bank Details', 'Expense & Comp'];
                            const isActive = formStep === step;
                            const isCompleted = formStep > step;
                            return (
                                <div key={step} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', zIndex: 2, flex: 1, cursor: 'pointer' }} onClick={() => setFormStep(step)}>
                                    <div style={{
                                        width: '32px',
                                        height: '32px',
                                        borderRadius: '50%',
                                        backgroundColor: isCompleted ? '#10b981' : isActive ? '#4f46e5' : '#f1f5f9',
                                        color: isCompleted || isActive ? 'white' : '#64748b',
                                        display: 'flex',
                                        alignItems: 'center',
                                        justifyContent: 'center',
                                        fontWeight: 600,
                                        fontSize: '0.85rem',
                                        border: isActive ? '3px solid #e0e7ff' : 'none',
                                        transition: 'all 0.3s ease'
                                    }}>
                                        {isCompleted ? '✓' : step}
                                    </div>
                                    <span style={{ fontSize: '0.72rem', fontWeight: isActive ? 600 : 500, color: isActive ? '#4f46e5' : '#64748b', marginTop: '6px', textAlign: 'center' }}>
                                        {labels[step - 1]}
                                    </span>
                                </div>
                            );
                        })}
                    </div>

                    <form onSubmit={(e) => {
                        e.preventDefault();
                        if (formStep === 6) {
                            handleAddEmployee(e);
                        } else {
                            setFormStep(prev => prev + 1);
                        }
                    }} style={{ display: 'flex', flexDirection: 'column', gap: '15px' }}>
                        
                        {/* STEP 1: PERSONAL DETAILS */}
                        {formStep === 1 && (
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '15px' }}>
                                <h4 style={{ margin: 0, color: '#4f46e5', borderBottom: '1px solid #e2e8f0', paddingBottom: '8px' }}>Step 1: Personal Details</h4>
                                <div style={{ display: 'flex', gap: '20px', flexWrap: 'wrap' }}>
                                    <div className="form-group" style={{ flex: 1, minWidth: '220px', margin: 0 }}>
                                        <label style={{ fontWeight: 600, fontSize: '0.82rem' }}>Full Name *</label>
                                        <input type="text" value={name} onChange={(e) => setName(e.target.value)} placeholder="Enter full name" required style={{ width: '100%', padding: '10px 14px', borderRadius: '8px', border: '1px solid #d1d5db', outline: 'none' }} />
                                    </div>
                                    <div className="form-group" style={{ flex: 1, minWidth: '220px', margin: 0 }}>
                                        <label style={{ fontWeight: 600, fontSize: '0.82rem' }}>Email Address *</label>
                                        <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="email@company.com" required style={{ width: '100%', padding: '10px 14px', borderRadius: '8px', border: '1px solid #d1d5db', outline: 'none' }} />
                                    </div>
                                    <div className="form-group" style={{ flex: 1, minWidth: '220px', margin: 0 }}>
                                        <label style={{ fontWeight: 600, fontSize: '0.82rem' }}>Password (Optional)</label>
                                        <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Leave blank for default (or enter .)" style={{ width: '100%', padding: '10px 14px', borderRadius: '8px', border: '1px solid #d1d5db', outline: 'none' }} />
                                    </div>
                                </div>

                                <div style={{ display: 'flex', gap: '20px', flexWrap: 'wrap' }}>
                                    <div className="form-group" style={{ flex: 1, minWidth: '200px', margin: 0 }}>
                                        <label style={{ fontWeight: 600, fontSize: '0.82rem' }}>Track</label>
                                        <select value={designation} onChange={(e) => setDesignation(e.target.value)} style={{ width: '100%', padding: '10px 14px', borderRadius: '8px', border: '1px solid #d1d5db', outline: 'none' }} >
                                            <option value="FIELD">Field Employee (GPS Tracking active)</option>
                                            <option value="OFFICE">Office Employee</option>
                                        </select>
                                    </div>
                                    <div className="form-group" style={{ flex: 1, minWidth: '200px', margin: 0 }}>
                                        <label style={{ fontWeight: 600, fontSize: '0.82rem' }}>Access Role</label>
                                        <select value={role} onChange={(e) => setRole(e.target.value)} style={{ width: '100%', padding: '10px 14px', borderRadius: '8px', border: '1px solid #d1d5db', outline: 'none' }} >
                                            <option value="EMPLOYEE">Employee (Mobile App Only)</option>
                                            <option value="ADMIN">Administrator (Full Access)</option>
                                            <option value="TRACKING_MANAGER">Tracking Manager (Tracking & Attendance)</option>
                                            <option value="FIELD_INVOICE_MANAGER">Field & Invoice Manager (Tracking & Invoicing)</option>
                                        </select>
                                    </div>
                                    <div className="form-group" style={{ flex: 1, minWidth: '200px', margin: 0 }}>
                                        <label style={{ fontWeight: 600, fontSize: '0.82rem' }}>Allowed Leaves (Yearly)</label>
                                        <input type="number" value={allowedLeaves} onChange={(e) => setAllowedLeaves(e.target.value)} min="0" style={{ width: '100%', padding: '10px 14px', borderRadius: '8px', border: '1px solid #d1d5db', outline: 'none' }} />
                                    </div>
                                </div>

                                <div style={{ display: 'flex', gap: '20px', flexWrap: 'wrap' }}>
                                    <div className="form-group" style={{ flex: 1, minWidth: '200px', margin: 0 }}>
                                        <label style={{ fontWeight: 600, fontSize: '0.82rem' }}>Date of Birth (DOB) *</label>
                                        <input type="date" value={dob} onChange={(e) => setDob(e.target.value)} required style={{ width: '100%', padding: '10px 14px', borderRadius: '8px', border: '1px solid #d1d5db', outline: 'none' }} />
                                    </div>
                                    <div className="form-group" style={{ flex: 1, minWidth: '200px', margin: 0 }}>
                                        <label style={{ fontWeight: 600, fontSize: '0.82rem' }}>EMP Code / ID</label>
                                        <input type="text" value={empCode} onChange={(e) => setEmpCode(e.target.value)} placeholder="e.g. EMP0042" style={{ width: '100%', padding: '10px 14px', borderRadius: '8px', border: '1px solid #d1d5db', outline: 'none' }} />
                                    </div>
                                    <div className="form-group" style={{ flex: 1, minWidth: '200px', margin: 0 }}>
                                        <label style={{ fontWeight: 600, fontSize: '0.82rem' }}>Nationality</label>
                                        <input type="text" value={nationality} onChange={(e) => setNationality(e.target.value)} placeholder="e.g. Indian" style={{ width: '100%', padding: '10px 14px', borderRadius: '8px', border: '1px solid #d1d5db', outline: 'none' }} />
                                    </div>
                                    <div className="form-group" style={{ flex: 1, minWidth: '200px', margin: 0 }}>
                                        <label style={{ fontWeight: 600, fontSize: '0.82rem' }}>Phone Number</label>
                                        <div style={{ display: 'flex', gap: '8px' }}>
                                            <select 
                                                value={countryCode} 
                                                onChange={(e) => setCountryCode(e.target.value)} 
                                                style={{ 
                                                    width: '105px', 
                                                    padding: '10px 12px', 
                                                    borderRadius: '8px', 
                                                    border: '1px solid var(--border-glass)', 
                                                    outline: 'none',
                                                    backgroundColor: 'var(--input-bg)',
                                                    color: 'var(--text-primary)',
                                                    cursor: 'pointer',
                                                    fontSize: '0.82rem'
                                                }}
                                            >
                                                {COUNTRY_CODES.map(c => (
                                                    <option key={c.code} value={c.code}>{c.label}</option>
                                                ))}
                                            </select>
                                            <input 
                                                type="tel" 
                                                value={phoneNo} 
                                                onChange={(e) => setPhoneNo(e.target.value.replace(/\D/g, ''))} 
                                                placeholder="9876543210" 
                                                style={{ 
                                                    flex: 1, 
                                                    padding: '10px 14px', 
                                                    borderRadius: '8px', 
                                                    border: '1px solid #d1d5db', 
                                                    outline: 'none' 
                                                }} 
                                            />
                                        </div>
                                    </div>
                                </div>

                                <div style={{ display: 'flex', gap: '20px', flexWrap: 'wrap' }}>
                                    <div className="form-group" style={{ flex: 1, minWidth: '220px', margin: 0 }}>
                                        <label style={{ fontWeight: 600, fontSize: '0.82rem' }}>Father / Spouse Name</label>
                                        <input type="text" value={fatherName} onChange={(e) => setFatherName(e.target.value)} placeholder="Father or Spouse Name" style={{ width: '100%', padding: '10px 14px', borderRadius: '8px', border: '1px solid #d1d5db', outline: 'none' }} />
                                    </div>
                                    <div className="form-group" style={{ flex: 1, minWidth: '150px', margin: 0 }}>
                                        <label style={{ fontWeight: 600, fontSize: '0.82rem' }}>Gender</label>
                                        <select value={gender} onChange={(e) => setGender(e.target.value)} style={{ width: '100%', padding: '10px 14px', borderRadius: '8px', border: '1px solid #d1d5db', outline: 'none' }}>
                                            <option value="Male">Male</option>
                                            <option value="Female">Female</option>
                                            <option value="Other">Other</option>
                                        </select>
                                    </div>
                                    <div className="form-group" style={{ flex: 2, minWidth: '300px', margin: 0 }}>
                                        <label style={{ fontWeight: 600, fontSize: '0.82rem' }}>Present Residential Address</label>
                                        <input type="text" value={presentAddress} onChange={(e) => setPresentAddress(e.target.value)} placeholder="Full street address, city, state" style={{ width: '100%', padding: '10px 14px', borderRadius: '8px', border: '1px solid #d1d5db', outline: 'none' }} />
                                    </div>
                                </div>

                                <div style={{ display: 'flex', gap: '20px', flexWrap: 'wrap' }}>
                                    <div className="form-group" style={{ flex: 2, minWidth: '300px', margin: 0 }}>
                                        <label style={{ fontWeight: 600, fontSize: '0.82rem' }}>Permanent Address</label>
                                        <input type="text" value={permanentAddress} onChange={(e) => setPermanentAddress(e.target.value)} placeholder="Permanent residential address" style={{ width: '100%', padding: '10px 14px', borderRadius: '8px', border: '1px solid #d1d5db', outline: 'none' }} />
                                    </div>
                                    <div className="form-group" style={{ flex: 1, minWidth: '220px', margin: 0 }}>
                                        <label style={{ fontWeight: 600, fontSize: '0.82rem' }}>Emergency Contact (Person & Phone)</label>
                                        <input type="text" value={emergencyContact} onChange={(e) => setEmergencyContact(e.target.value)} placeholder="e.g. Father: +91 9876543210" style={{ width: '100%', padding: '10px 14px', borderRadius: '8px', border: '1px solid #d1d5db', outline: 'none' }} />
                                    </div>
                                </div>

                                <div style={{ borderTop: '1px solid #e2e8f0', paddingTop: '14px', marginTop: '4px' }}>
                                    <h5 style={{ margin: '0 0 12px 0', fontSize: '0.85rem', fontWeight: 700, color: '#4f46e5', textTransform: 'uppercase', letterSpacing: '0.04em' }}>Highest Qualification</h5>
                                    <div style={{ display: 'flex', gap: '16px', flexWrap: 'wrap' }}>
                                        <div className="form-group" style={{ flex: 1, minWidth: '200px', margin: 0 }}>
                                            <label style={{ fontWeight: 600, fontSize: '0.82rem' }}>Qualification / Degree</label>
                                            <select 
                                                value={highestQualLevel} 
                                                onChange={(e) => setHighestQualLevel(e.target.value)} 
                                                style={{ width: '100%', padding: '10px 14px', borderRadius: '8px', border: '1px solid #d1d5db', outline: 'none' }}
                                            >
                                                <option value="">Select Qualification</option>
                                                <option value="10th / Secondary">10th / Secondary</option>
                                                <option value="12th / Higher Secondary">12th / Higher Secondary</option>
                                                <option value="Diploma">Diploma / Polytechnic</option>
                                                <option value="Bachelor's Degree">Bachelor's Degree (B.E / B.Tech / B.Sc / B.Com / B.A / etc.)</option>
                                                <option value="Master's Degree">Master's Degree (M.E / M.Tech / M.Sc / M.Com / MBA / etc.)</option>
                                                <option value="Doctorate / Ph.D">Doctorate / Ph.D</option>
                                                <option value="Other">Other</option>
                                            </select>
                                        </div>
                                        <div className="form-group" style={{ flex: 1, minWidth: '200px', margin: 0 }}>
                                            <label style={{ fontWeight: 600, fontSize: '0.82rem' }}>Field of Study / Specialization</label>
                                            <input 
                                                type="text" 
                                                value={highestQualStream} 
                                                onChange={(e) => setHighestQualStream(e.target.value)} 
                                                placeholder="e.g. Mechanical Engg, Computer Science" 
                                                style={{ width: '100%', padding: '10px 14px', borderRadius: '8px', border: '1px solid #d1d5db', outline: 'none' }} 
                                            />
                                        </div>
                                    </div>
                                    <div style={{ display: 'flex', gap: '16px', flexWrap: 'wrap', marginTop: '12px' }}>
                                        <div className="form-group" style={{ flex: 2, minWidth: '240px', margin: 0 }}>
                                            <label style={{ fontWeight: 600, fontSize: '0.82rem' }}>College / University / Board</label>
                                            <input 
                                                type="text" 
                                                value={highestQualInstitution} 
                                                onChange={(e) => setHighestQualInstitution(e.target.value)} 
                                                placeholder="e.g. Anna University, IIT Madras, CBSE" 
                                                style={{ width: '100%', padding: '10px 14px', borderRadius: '8px', border: '1px solid #d1d5db', outline: 'none' }} 
                                            />
                                        </div>
                                        <div className="form-group" style={{ flex: 1, minWidth: '120px', margin: 0 }}>
                                            <label style={{ fontWeight: 600, fontSize: '0.82rem' }}>Year of Passing</label>
                                            <input 
                                                type="number" 
                                                min="1950" 
                                                max="2035" 
                                                value={highestQualYear} 
                                                onChange={(e) => setHighestQualYear(e.target.value)} 
                                                placeholder="e.g. 2022" 
                                                style={{ width: '100%', padding: '10px 14px', borderRadius: '8px', border: '1px solid #d1d5db', outline: 'none' }} 
                                            />
                                        </div>
                                        <div className="form-group" style={{ flex: 1, minWidth: '120px', margin: 0 }}>
                                            <label style={{ fontWeight: 600, fontSize: '0.82rem' }}>Percentage / CGPA</label>
                                            <input 
                                                type="text" 
                                                value={highestQualPercent} 
                                                onChange={(e) => setHighestQualPercent(e.target.value)} 
                                                placeholder="e.g. 82% or 8.5" 
                                                style={{ width: '100%', padding: '10px 14px', borderRadius: '8px', border: '1px solid #d1d5db', outline: 'none' }} 
                                            />
                                        </div>
                                    </div>
                                </div>
                            </div>
                        )}

                        {/* STEP 2: JOB DETAILS */}
                        {formStep === 2 && (
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '15px' }}>
                                <h4 style={{ margin: 0, color: '#4f46e5', borderBottom: '1px solid #e2e8f0', paddingBottom: '8px' }}>Step 2: Job Details</h4>
                                <div style={{ display: 'flex', gap: '20px', flexWrap: 'wrap' }}>
                                    <div className="form-group" style={{ flex: 1, minWidth: '220px', margin: 0 }}>
                                        <label style={{ fontWeight: 600, fontSize: '0.82rem' }}>Joining Date *</label>
                                        <input type="date" value={joiningDate} onChange={(e) => setJoiningDate(e.target.value)} required style={{ width: '100%', padding: '10px 14px', borderRadius: '8px', border: '1px solid #d1d5db', outline: 'none' }} />
                                    </div>
                                    <div className="form-group" style={{ flex: 1, minWidth: '220px', margin: 0 }}>
                                        <label style={{ fontWeight: 600, fontSize: '0.82rem' }}>Legal Entity</label>
                                        <input type="text" value={legalEntity} onChange={(e) => setLegalEntity(e.target.value)} placeholder="Enter legal entity name" style={{ width: '100%', padding: '10px 14px', borderRadius: '8px', border: '1px solid #d1d5db', outline: 'none' }} />
                                    </div>
                                    <div className="form-group" style={{ flex: 1, minWidth: '220px', margin: 0 }}>
                                        <label style={{ fontWeight: 600, fontSize: '0.82rem' }}>Reporting Manager</label>
                                        <input type="text" value={reportingManager} onChange={(e) => setReportingManager(e.target.value)} placeholder="Manager's Name or ID" style={{ width: '100%', padding: '10px 14px', borderRadius: '8px', border: '1px solid #d1d5db', outline: 'none' }} />
                                    </div>
                                </div>

                                <div style={{ display: 'flex', gap: '20px', flexWrap: 'wrap' }}>
                                    {/* Designation Dropdown with Add New */}
                                    <div className="form-group" style={{ flex: 1, minWidth: '220px', margin: 0 }}>
                                        <label style={{ fontWeight: 600, fontSize: '0.82rem' }}>Designation</label>
                                        <select 
                                            value={isCustomJobTitle ? 'ADD_NEW' : jobTitle} 
                                            onChange={(e) => {
                                                if (e.target.value === 'ADD_NEW') {
                                                    setIsCustomJobTitle(true);
                                                } else {
                                                    setIsCustomJobTitle(false);
                                                    setJobTitle(e.target.value);
                                                }
                                            }}
                                            style={{ width: '100%', padding: '10px 14px', borderRadius: '8px', border: '1px solid #d1d5db', outline: 'none' }}
                                        >
                                            {jobTitles.map(t => <option key={t} value={t}>{t}</option>)}
                                            <option value="ADD_NEW">+ Add New Job Title</option>
                                        </select>
                                        {isCustomJobTitle && (
                                            <div style={{ display: 'flex', gap: '8px', marginTop: '8px' }}>
                                                <input 
                                                    type="text" 
                                                    placeholder="Type new job title" 
                                                    value={customJobTitle} 
                                                    onChange={(e) => setCustomJobTitle(e.target.value)} 
                                                    style={{ flex: 1, padding: '8px 12px', borderRadius: '6px', border: '1px solid #d1d5db', fontSize: '0.85rem' }}
                                                />
                                                <button type="button" className="btn btn-outline" style={{ padding: '6px 12px', fontSize: '0.8rem' }} onClick={() => {
                                                    if (customJobTitle.trim()) {
                                                        setJobTitles(prev => [...prev, customJobTitle.trim()]);
                                                        setJobTitle(customJobTitle.trim());
                                                        setIsCustomJobTitle(false);
                                                        setCustomJobTitle('');
                                                    }
                                                }}>Add</button>
                                            </div>
                                        )}
                                    </div>

                                    {/* Department Dropdown with Add New */}
                                    <div className="form-group" style={{ flex: 1, minWidth: '220px', margin: 0 }}>
                                        <label style={{ fontWeight: 600, fontSize: '0.82rem' }}>Department</label>
                                        <select 
                                            value={isCustomDepartment ? 'ADD_NEW' : department} 
                                            onChange={(e) => {
                                                if (e.target.value === 'ADD_NEW') {
                                                    setIsCustomDepartment(true);
                                                } else {
                                                    setIsCustomDepartment(false);
                                                    setDepartment(e.target.value);
                                                }
                                            }}
                                            style={{ width: '100%', padding: '10px 14px', borderRadius: '8px', border: '1px solid #d1d5db', outline: 'none' }}
                                        >
                                            {departments.map(d => <option key={d} value={d}>{d}</option>)}
                                            <option value="ADD_NEW">+ Add New Department</option>
                                        </select>
                                        {isCustomDepartment && (
                                            <div style={{ display: 'flex', gap: '8px', marginTop: '8px' }}>
                                                <input 
                                                    type="text" 
                                                    placeholder="Type new department" 
                                                    value={customDepartment} 
                                                    onChange={(e) => setCustomDepartment(e.target.value)} 
                                                    style={{ flex: 1, padding: '8px 12px', borderRadius: '6px', border: '1px solid #d1d5db', fontSize: '0.85rem' }}
                                                />
                                                <button type="button" className="btn btn-outline" style={{ padding: '6px 12px', fontSize: '0.8rem' }} onClick={() => {
                                                    if (customDepartment.trim()) {
                                                        setDepartments(prev => [...prev, customDepartment.trim()]);
                                                        setDepartment(customDepartment.trim());
                                                        setIsCustomDepartment(false);
                                                        setCustomDepartment('');
                                                    }
                                                }}>Add</button>
                                            </div>
                                        )}
                                    </div>

                                    {/* Location Dropdown with Add New */}
                                    <div className="form-group" style={{ flex: 1, minWidth: '220px', margin: 0 }}>
                                        <label style={{ fontWeight: 600, fontSize: '0.82rem' }}>
                                            Location (Holiday Calendar Attached)
                                        </label>
                                        <select 
                                            value={isCustomLocation ? 'ADD_NEW' : location} 
                                            onChange={(e) => {
                                                if (e.target.value === 'ADD_NEW') {
                                                    setIsCustomLocation(true);
                                                } else {
                                                    setIsCustomLocation(false);
                                                    const chosenLoc = e.target.value;
                                                    setLocation(chosenLoc);
                                                    setHolidayDetails(chosenLoc);
                                                }
                                            }}
                                            style={{ width: '100%', padding: '10px 14px', borderRadius: '8px', border: '1px solid var(--border-glass)', outline: 'none', background: 'var(--input-bg)', color: 'var(--text-primary)' }}
                                        >
                                            {locationCalendars && locationCalendars.length > 0 ? (
                                                locationCalendars.map(c => (
                                                    <option key={c.id || c.location} value={c.location || c.name}>
                                                        📍 {c.location || c.name} ({(c.holidays || []).length} Holidays)
                                                    </option>
                                                ))
                                            ) : (
                                                locations.map(l => <option key={l} value={l}>📍 {l}</option>)
                                            )}
                                            <option value="ADD_NEW">+ Add New Location / Calendar</option>
                                        </select>
                                        {isCustomLocation && (
                                            <div style={{ display: 'flex', gap: '8px', marginTop: '8px' }}>
                                                <input 
                                                    type="text" 
                                                    placeholder="Type new location (e.g. Kolkata Hub)" 
                                                    value={customLocation} 
                                                    onChange={(e) => setCustomLocation(e.target.value)} 
                                                    style={{ flex: 1, padding: '8px 12px', borderRadius: '6px', border: '1px solid #d1d5db', fontSize: '0.85rem' }}
                                                />
                                                <button type="button" className="btn btn-outline" style={{ padding: '6px 12px', fontSize: '0.8rem', background: '#10b981', color: '#fff', border: 'none' }} onClick={() => {
                                                    const trimmed = customLocation.trim();
                                                    if (trimmed) {
                                                        const newLocCal = {
                                                            id: `cal-custom-${Date.now()}`,
                                                            name: `${trimmed} Calendar 2026`,
                                                            location: trimmed,
                                                            state: trimmed,
                                                            year: 2026,
                                                            isDefault: false,
                                                            holidays: []
                                                        };
                                                        const existing = getLocationCalendarsFromStorage();
                                                        const updated = [...existing, newLocCal];
                                                        localStorage.setItem('hrms_location_holiday_calendars', JSON.stringify(updated));
                                                        setLocationCalendars(updated);
                                                        setLocations(updated.map(c => c.location || c.name));
                                                        setLocation(trimmed);
                                                        setHolidayDetails(trimmed);
                                                        setIsCustomLocation(false);
                                                        setCustomLocation('');
                                                    }
                                                }}>Add Location</button>
                                                <button type="button" className="btn btn-outline" style={{ padding: '6px 12px', fontSize: '0.8rem' }} onClick={() => {
                                                    setIsCustomLocation(false);
                                                    setCustomLocation('');
                                                }}>Cancel</button>
                                            </div>
                                        )}
                                    </div>

                                    {/* Place of Duty */}
                                    <div className="form-group" style={{ flex: 1, minWidth: '220px', margin: 0 }}>
                                        <label style={{ fontWeight: 600, fontSize: '0.82rem' }}>
                                            Place of Duty
                                        </label>
                                        <input 
                                            type="text" 
                                            placeholder="e.g. Noida / Chennai / Client Site" 
                                            value={placeOfDuty} 
                                            onChange={(e) => setPlaceOfDuty(e.target.value)} 
                                            style={{ width: '100%', padding: '10px 14px', borderRadius: '8px', border: '1px solid #d1d5db', outline: 'none' }} 
                                        />
                                    </div>
                                </div>
                            </div>
                        )}

                        {/* STEP 3: EMPLOYMENT TERMS */}
                        {formStep === 3 && (
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '15px' }}>
                                <h4 style={{ margin: 0, color: '#4f46e5', borderBottom: '1px solid #e2e8f0', paddingBottom: '8px' }}>Step 3: Employment Terms</h4>
                                <div style={{ display: 'flex', gap: '20px', flexWrap: 'wrap' }}>
                                    <div className="form-group" style={{ flex: 1, minWidth: '220px', margin: 0 }}>
                                        <label style={{ fontWeight: 600, fontSize: '0.82rem' }}>Probation Policy</label>
                                        <select 
                                            value={probationPolicy} 
                                            onChange={(e) => {
                                                const val = e.target.value;
                                                setProbationPolicy(val);
                                                if (val === 'Permanent Employee') {
                                                    setNoticePeriod('1 Month');
                                                } else if (val === '6-Months Probation') {
                                                    setNoticePeriod('15 Days');
                                                }
                                            }} 
                                            style={{ width: '100%', padding: '10px 14px', borderRadius: '8px', border: '1px solid #d1d5db', outline: 'none' }}
                                        >
                                            <option value="Permanent Employee">Permanent Employee</option>
                                            <option value="6-Months Probation">6-Months Probation</option>
                                        </select>
                                    </div>
                                    <div className="form-group" style={{ flex: 1, minWidth: '220px', margin: 0 }}>
                                        <label style={{ fontWeight: 600, fontSize: '0.82rem' }}>Notice Period</label>
                                        <select 
                                            value={noticePeriod} 
                                            onChange={(e) => setNoticePeriod(e.target.value)} 
                                            style={{ width: '100%', padding: '10px 14px', borderRadius: '8px', border: '1px solid #d1d5db', outline: 'none' }}
                                        >
                                            <option value="1 Month">1 Month</option>
                                            <option value="15 Days">15 Days</option>
                                        </select>
                                    </div>
                                </div>
                            </div>
                        )}

                        {/* STEP 4: WORK DETAILS */}
                        {formStep === 4 && (
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '15px' }}>
                                <h4 style={{ margin: 0, color: '#4f46e5', borderBottom: '1px solid #e2e8f0', paddingBottom: '8px' }}>Step 4: Work Details</h4>
                                <div style={{ display: 'flex', gap: '20px', flexWrap: 'wrap' }}>
                                    <div className="form-group" style={{ flex: 1, minWidth: '220px', margin: 0, position: 'relative' }}>
                                        <label style={{ fontWeight: 600, fontSize: '0.82rem' }}>Leave Setting</label>
                                        <div 
                                            onClick={() => setShowLeaveDropdown(!showLeaveDropdown)}
                                            style={{ 
                                                width: '100%', 
                                                padding: '10px 14px', 
                                                borderRadius: '8px', 
                                                border: '1px solid var(--border-glass)', 
                                                backgroundColor: 'var(--input-bg)', 
                                                cursor: 'pointer',
                                                fontSize: '0.85rem',
                                                color: leaveSetting ? 'var(--text-primary)' : 'var(--text-muted)',
                                                minHeight: '40px',
                                                display: 'flex',
                                                alignItems: 'center',
                                                justifyContent: 'space-between'
                                            }}
                                        >
                                            <span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: '90%' }}>
                                                {leaveSetting || 'Select Leaves'}
                                            </span>
                                            <span style={{ fontSize: '0.6rem', color: 'var(--text-muted)' }}>▼</span>
                                        </div>

                                        {showLeaveDropdown && (
                                            <>
                                                <div 
                                                    onClick={() => setShowLeaveDropdown(false)} 
                                                    style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, zIndex: 998 }} 
                                                />
                                                <div 
                                                    style={{ 
                                                        position: 'absolute', 
                                                        top: '100%', 
                                                        left: 0, 
                                                        right: 0, 
                                                        backgroundColor: 'var(--bg-glass)', 
                                                        border: '1px solid var(--border-glass)', 
                                                        borderRadius: '8px', 
                                                        boxShadow: 'var(--shadow-md)', 
                                                        padding: '12px', 
                                                        zIndex: 999, 
                                                        marginTop: '4px',
                                                        display: 'flex',
                                                        flexDirection: 'column',
                                                        gap: '8px'
                                                    }}
                                                >
                                                    <div style={{ maxHeight: '150px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '8px' }}>
                                                        {leaveTypes.map(type => {
                                                            const selectedArray = leaveSetting ? leaveSetting.split(',').map(s => s.trim()).filter(Boolean) : [];
                                                            const isChecked = selectedArray.includes(type);
                                                            return (
                                                                <label key={type} style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-start', gap: '8px', fontSize: '0.85rem', cursor: 'pointer', margin: 0, fontWeight: 500, color: 'var(--text-primary)', textAlign: 'left', width: '100%' }}>
                                                                    <input 
                                                                        type="checkbox" 
                                                                        checked={isChecked} 
                                                                        onChange={(e) => {
                                                                            let updated;
                                                                            if (e.target.checked) {
                                                                                updated = [...selectedArray, type];
                                                                            } else {
                                                                                updated = selectedArray.filter(t => t !== type);
                                                                            }
                                                                            setLeaveSetting(updated.join(', '));
                                                                        }}
                                                                        style={{ cursor: 'pointer', flexShrink: 0 }}
                                                                    />
                                                                    <span>{type}</span>
                                                                </label>
                                                            );
                                                        })}
                                                    </div>

                                                    <div style={{ borderTop: '1px solid var(--border-glass)', paddingTop: '8px', display: 'flex', flexDirection: 'column', gap: '6px' }}>
                                                        {!isAddingLeaveType ? (
                                                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                                                <button type="button" className="btn btn-outline" style={{ padding: '4px 8px', fontSize: '0.75rem' }} onClick={(e) => { e.stopPropagation(); setIsAddingLeaveType(true); }}>
                                                                    + Custom Type
                                                                </button>
                                                                <button type="button" className="btn btn-primary" style={{ padding: '4px 10px', fontSize: '0.75rem' }} onClick={() => setShowLeaveDropdown(false)}>
                                                                    OK
                                                                </button>
                                                            </div>
                                                        ) : (
                                                            <div style={{ display: 'flex', gap: '6px' }}>
                                                                <input 
                                                                    type="text" 
                                                                    placeholder="New leave name" 
                                                                    value={newLeaveType} 
                                                                    onChange={(e) => setNewLeaveType(e.target.value)} 
                                                                    style={{ flex: 1, padding: '4px 8px', borderRadius: '4px', border: '1px solid var(--border-glass)', background: 'var(--input-bg)', color: 'var(--text-primary)', fontSize: '0.75rem' }}
                                                                />
                                                                <button type="button" className="btn btn-outline" style={{ padding: '4px 8px', fontSize: '0.75rem' }} onClick={(e) => {
                                                                    e.stopPropagation();
                                                                    const trimmed = newLeaveType.trim();
                                                                    if (trimmed) {
                                                                        if (!leaveTypes.includes(trimmed)) {
                                                                            setLeaveTypes(prev => [...prev, trimmed]);
                                                                        }
                                                                        const selectedArray = leaveSetting ? leaveSetting.split(',').map(s => s.trim()).filter(Boolean) : [];
                                                                        if (!selectedArray.includes(trimmed)) {
                                                                            setLeaveSetting([...selectedArray, trimmed].join(', '));
                                                                        }
                                                                        setIsAddingLeaveType(false);
                                                                        setNewLeaveType('');
                                                                    }
                                                                }}>Add</button>
                                                                <button type="button" className="btn btn-outline" style={{ padding: '4px 8px', fontSize: '0.75rem', color: '#ef4444' }} onClick={(e) => { e.stopPropagation(); setIsAddingLeaveType(false); setNewLeaveType(''); }}>Cancel</button>
                                                            </div>
                                                        )}
                                                    </div>
                                                </div>
                                            </>
                                        )}
                                    </div>
                                    <div className="form-group" style={{ flex: 1, minWidth: '220px', margin: 0 }}>
                                        <label style={{ fontWeight: 600, fontSize: '0.82rem' }}>Weekly Offs</label>
                                        <input type="text" value={weeklyOffs} onChange={(e) => setWeeklyOffs(e.target.value)} placeholder="Sunday" style={{ width: '100%', padding: '10px 14px', borderRadius: '8px', border: '1px solid #d1d5db', outline: 'none' }} />
                                    </div>
                                    <div className="form-group" style={{ flex: 1, minWidth: '220px', margin: 0 }}>
                                        <label style={{ fontWeight: 600, fontSize: '0.82rem' }}>Attendance Setting</label>
                                        <select value={attendanceSetting} onChange={(e) => setAttendanceSetting(e.target.value)} style={{ width: '100%', padding: '10px 14px', borderRadius: '8px', border: '1px solid #d1d5db', outline: 'none' }} >
                                            <option value="9-5:30">9 to 5:30 Fixed Work Hours</option>
                                            <option value="Flexible">Flexible Work Hours</option>
                                            <option value="Other">Other (Custom Hours)</option>
                                        </select>
                                        {attendanceSetting === 'Other' && (
                                            <div style={{ display: 'flex', gap: '10px', marginTop: '8px' }}>
                                                <div style={{ flex: 1 }}>
                                                    <label style={{ fontWeight: 600, fontSize: '0.78rem', color: '#6b7280' }}>Start Time</label>
                                                    <input type="time" value={startTime} onChange={(e) => setStartTime(e.target.value)} style={{ width: '100%', padding: '8px 10px', borderRadius: '6px', border: '1px solid #d1d5db', outline: 'none' }} />
                                                </div>
                                                <div style={{ flex: 1 }}>
                                                    <label style={{ fontWeight: 600, fontSize: '0.78rem', color: '#6b7280' }}>End Time</label>
                                                    <input type="time" value={endTime} onChange={(e) => setEndTime(e.target.value)} style={{ width: '100%', padding: '8px 10px', borderRadius: '6px', border: '1px solid #d1d5db', outline: 'none' }} />
                                                </div>
                                            </div>
                                        )}
                                    </div>
                                    <div className="form-group" style={{ flex: 1, minWidth: '220px', margin: 0 }}>
                                        <label style={{ fontWeight: 600, fontSize: '0.82rem' }}>Overtime Setting</label>
                                        <input type="text" value={overtime} onChange={(e) => setOvertime(e.target.value)} placeholder="Eligible for overtime" style={{ width: '100%', padding: '10px 14px', borderRadius: '8px', border: '1px solid #d1d5db', outline: 'none' }} />
                                    </div>
                                </div>
                            </div>
                        )}

                        {/* STEP 5: BANK DETAILS */}
                        {formStep === 5 && (
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '15px' }}>
                                <h4 style={{ margin: 0, color: '#4f46e5', borderBottom: '1px solid #e2e8f0', paddingBottom: '8px' }}>Step 5: Bank & Statutory Details</h4>
                                <div style={{ display: 'flex', gap: '20px', flexWrap: 'wrap' }}>
                                    <div className="form-group" style={{ flex: 1, minWidth: '220px', margin: 0 }}>
                                        <label style={{ fontWeight: 600, fontSize: '0.82rem' }}>Bank Name</label>
                                        <input type="text" value={bankName} onChange={(e) => setBankName(e.target.value)} placeholder="e.g. State Bank of India" style={{ width: '100%', padding: '10px 14px', borderRadius: '8px', border: '1px solid #d1d5db', outline: 'none' }} />
                                    </div>
                                    <div className="form-group" style={{ flex: 1, minWidth: '220px', margin: 0 }}>
                                        <label style={{ fontWeight: 600, fontSize: '0.82rem' }}>Account Number</label>
                                        <input type="text" value={bankAccountNo} onChange={(e) => setBankAccountNo(e.target.value)} placeholder="e.g. 12345678901" style={{ width: '100%', padding: '10px 14px', borderRadius: '8px', border: '1px solid #d1d5db', outline: 'none' }} />
                                    </div>
                                </div>
                                <div style={{ display: 'flex', gap: '20px', flexWrap: 'wrap' }}>
                                    <div className="form-group" style={{ flex: 1, minWidth: '220px', margin: 0 }}>
                                        <label style={{ fontWeight: 600, fontSize: '0.82rem' }}>IFSC Code</label>
                                        <input type="text" value={bankIfscCode} onChange={(e) => setBankIfscCode(e.target.value)} placeholder="e.g. SBIN0001234" style={{ width: '100%', padding: '10px 14px', borderRadius: '8px', border: '1px solid #d1d5db', outline: 'none' }} />
                                    </div>
                                    <div className="form-group" style={{ flex: 1, minWidth: '220px', margin: 0 }}>
                                        <label style={{ fontWeight: 600, fontSize: '0.82rem' }}>Branch Name</label>
                                        <input type="text" value={bankBranchName} onChange={(e) => setBankBranchName(e.target.value)} placeholder="e.g. Noida Sector 62" style={{ width: '100%', padding: '10px 14px', borderRadius: '8px', border: '1px solid #d1d5db', outline: 'none' }} />
                                    </div>
                                </div>
                                <div style={{ display: 'flex', gap: '20px', flexWrap: 'wrap' }}>
                                    <div className="form-group" style={{ flex: 1, minWidth: '200px', margin: 0 }}>
                                        <label style={{ fontWeight: 600, fontSize: '0.82rem' }}>Aadhaar Card Number</label>
                                        <input type="text" value={aadhaarNumber} onChange={(e) => setAadhaarNumber(e.target.value)} placeholder="e.g. 1234 5678 9012" maxLength={16} style={{ width: '100%', padding: '10px 14px', borderRadius: '8px', border: '1px solid #d1d5db', outline: 'none' }} />
                                    </div>
                                    <div className="form-group" style={{ flex: 1, minWidth: '200px', margin: 0 }}>
                                        <label style={{ fontWeight: 600, fontSize: '0.82rem' }}>PAN Card Number</label>
                                        <input type="text" value={panNumber} onChange={(e) => setPanNumber(e.target.value.toUpperCase())} placeholder="e.g. ABCDE1234F" style={{ width: '100%', padding: '10px 14px', borderRadius: '8px', border: '1px solid #d1d5db', outline: 'none' }} />
                                    </div>
                                    <div className="form-group" style={{ flex: 1, minWidth: '200px', margin: 0 }}>
                                        <label style={{ fontWeight: 600, fontSize: '0.82rem' }}>EPF UAN Number</label>
                                        <input type="text" value={uanNumber} onChange={(e) => setUanNumber(e.target.value)} placeholder="e.g. 100123456789" style={{ width: '100%', padding: '10px 14px', borderRadius: '8px', border: '1px solid #d1d5db', outline: 'none' }} />
                                    </div>
                                    <div className="form-group" style={{ flex: 1, minWidth: '200px', margin: 0 }}>
                                        <label style={{ fontWeight: 600, fontSize: '0.82rem' }}>PF Number / Member ID</label>
                                        <input type="text" value={pfNumber} onChange={(e) => setPfNumber(e.target.value)} placeholder="e.g. MH/BAN/0012345/000/0000123" style={{ width: '100%', padding: '10px 14px', borderRadius: '8px', border: '1px solid #d1d5db', outline: 'none' }} />
                                    </div>
                                    <div className="form-group" style={{ flex: 1, minWidth: '200px', margin: 0 }}>
                                        <label style={{ fontWeight: 600, fontSize: '0.82rem' }}>ESIC Number / IP No</label>
                                        <input type="text" value={esiNumber} onChange={(e) => setEsiNumber(e.target.value)} placeholder="e.g. 3100123456" style={{ width: '100%', padding: '10px 14px', borderRadius: '8px', border: '1px solid #d1d5db', outline: 'none' }} />
                                    </div>
                                </div>
                            </div>
                        )}

                        {/* STEP 6: EXPENSE & COMPENSATION SETTINGS */}
                        {formStep === 6 && (
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '15px' }}>
                                <h4 style={{ margin: 0, color: '#4f46e5', borderBottom: '1px solid #e2e8f0', paddingBottom: '8px' }}>Step 6: Expense & Compensation Settings</h4>
                                
                                <div style={{ display: 'flex', gap: '30px', flexWrap: 'wrap' }}>
                                    {/* Left Column: Form Settings */}
                                    <div style={{ flex: 1, minWidth: '300px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
                                        <div className="form-group" style={{ margin: 0 }}>
                                            <label style={{ fontWeight: 600, fontSize: '0.82rem' }}>Expense Policies Description</label>
                                            <input type="text" value={expensePolicies} onChange={(e) => setExpensePolicies(e.target.value)} placeholder="Standard travel and food reimbursement policy" style={{ width: '100%', padding: '10px 14px', borderRadius: '8px', border: '1px solid #d1d5db', outline: 'none' }} />
                                        </div>
                                        
                                        <div className="form-group" style={{ margin: 0 }}>
                                            <label style={{ fontWeight: 600, fontSize: '0.82rem' }}>Annual Gross Compensation (INR)</label>
                                            <input type="number" value={compensationGross} onChange={(e) => setCompensationGross(e.target.value)} min="0" style={{ width: '100%', padding: '10px 14px', borderRadius: '8px', border: '1px solid #d1d5db', outline: 'none', fontWeight: 600, fontSize: '1rem', color: '#111827' }} />
                                        </div>

                                        {/* Statutory Settings */}
                                        <div style={{ border: '1px solid var(--border-glass)', padding: '16px', borderRadius: '8px', backgroundColor: 'var(--bg-glass)' }}>
                                            <h5 style={{ margin: '0 0 12px 0', fontSize: '0.85rem', fontWeight: 600, color: 'var(--text-primary)' }}>Statutory Settings</h5>
                                            
                                            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                                                {/* PF */}
                                                <div>
                                                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                                                        <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '0.82rem', fontWeight: 500, color: 'var(--text-primary)', cursor: 'pointer', margin: 0 }}>
                                                            <input type="checkbox" checked={pfEligible} onChange={(e) => setPfEligible(e.target.checked)} style={{ cursor: 'pointer' }} />
                                                            Provident Fund (PF) eligible {pfEligible && <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', fontWeight: 400 }}>(₹{monthlyPf}/month)</span>}
                                                        </label>
                                                        {pfEligible && (
                                                            <button
                                                                type="button"
                                                                onClick={(e) => { e.preventDefault(); setShowEditPf(!showEditPf); }}
                                                                title="Edit PF Amount"
                                                                style={{ background: 'var(--input-bg)', border: '1px solid var(--border-glass)', borderRadius: '4px', padding: '2px 8px', fontSize: '0.72rem', color: 'var(--accent-primary)', cursor: 'pointer', fontWeight: 600 }}
                                                            >
                                                                {showEditPf ? 'Done' : '✏️ Edit'}
                                                            </button>
                                                        )}
                                                    </div>
                                                    {pfEligible && showEditPf && (
                                                        <div style={{ marginTop: '6px', marginLeft: '24px' }}>
                                                            <label style={{ display: 'block', fontSize: '0.72rem', fontWeight: 600, color: 'var(--accent-primary)', marginBottom: '2px' }}>
                                                                Override PF Monthly Amount (₹)
                                                            </label>
                                                            <input 
                                                                type="number" 
                                                                value={pfAmount} 
                                                                onChange={(e) => setPfAmount(e.target.value)} 
                                                                placeholder={String(defaultMonthlyPf)} 
                                                                min="0"
                                                                autoFocus
                                                                style={{ width: '100%', maxWidth: '220px', padding: '6px 10px', borderRadius: '6px', border: '1px solid var(--border-glass)', outline: 'none', fontSize: '0.82rem', backgroundColor: 'var(--input-bg)', color: 'var(--text-primary)' }} 
                                                            />
                                                        </div>
                                                    )}
                                                </div>

                                                {/* VPF (Voluntary PF) with expanding input */}
                                                <div>
                                                    <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '0.82rem', fontWeight: 500, color: 'var(--text-primary)', cursor: 'pointer' }}>
                                                        <input 
                                                            type="checkbox" 
                                                            checked={vpfEligible} 
                                                            onChange={(e) => {
                                                                setVpfEligible(e.target.checked);
                                                                if (!e.target.checked) setVpfAmount('');
                                                            }} 
                                                            style={{ cursor: 'pointer' }} 
                                                        />
                                                        Voluntary Provident Fund (VPF) eligible
                                                    </label>
                                                    {vpfEligible && (
                                                        <div style={{ marginTop: '8px', marginLeft: '24px' }}>
                                                            <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 600, color: 'var(--accent-primary)', marginBottom: '4px' }}>
                                                                VPF Monthly Contribution (₹)
                                                            </label>
                                                            <input 
                                                                type="number" 
                                                                value={vpfAmount} 
                                                                onChange={(e) => setVpfAmount(e.target.value)} 
                                                                placeholder="Enter monthly VPF amount (e.g. 1000)" 
                                                                min="0"
                                                                autoFocus
                                                                style={{ width: '100%', maxWidth: '280px', padding: '8px 12px', borderRadius: '6px', border: '1px solid var(--border-glass)', outline: 'none', fontSize: '0.85rem', backgroundColor: 'var(--input-bg)', color: 'var(--text-primary)' }} 
                                                            />
                                                        </div>
                                                    )}
                                                </div>

                                                <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '0.82rem', fontWeight: 500, color: 'var(--text-primary)', cursor: 'pointer' }}>
                                                    <input type="checkbox" checked={esiEligible} onChange={(e) => setEsiEligible(e.target.checked)} style={{ cursor: 'pointer' }} />
                                                    ESI eligible
                                                </label>

                                                {/* LWF */}
                                                <div>
                                                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                                                        <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '0.82rem', fontWeight: 500, color: 'var(--text-primary)', cursor: 'pointer', margin: 0 }}>
                                                            <input type="checkbox" checked={lwfEligible} onChange={(e) => setLwfEligible(e.target.checked)} style={{ cursor: 'pointer' }} />
                                                            LWF eligible <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', fontWeight: 400 }}>(₹{lwfAmount !== '' ? lwfAmount : 60}/year)</span>
                                                        </label>
                                                        {lwfEligible && (
                                                            <button
                                                                type="button"
                                                                onClick={(e) => { e.preventDefault(); setShowEditLwf(!showEditLwf); }}
                                                                title="Edit LWF Amount"
                                                                style={{ background: 'var(--input-bg)', border: '1px solid var(--border-glass)', borderRadius: '4px', padding: '2px 8px', fontSize: '0.72rem', color: 'var(--accent-primary)', cursor: 'pointer', fontWeight: 600 }}
                                                            >
                                                                {showEditLwf ? 'Done' : '✏️ Edit'}
                                                            </button>
                                                        )}
                                                    </div>
                                                    {lwfEligible && showEditLwf && (
                                                        <div style={{ marginTop: '6px', marginLeft: '24px' }}>
                                                            <label style={{ display: 'block', fontSize: '0.72rem', fontWeight: 600, color: 'var(--accent-primary)', marginBottom: '2px' }}>
                                                                Override LWF Yearly Amount (₹)
                                                            </label>
                                                            <input 
                                                                type="number" 
                                                                value={lwfAmount} 
                                                                onChange={(e) => setLwfAmount(e.target.value)} 
                                                                placeholder="60" 
                                                                min="0"
                                                                autoFocus
                                                                style={{ width: '100%', maxWidth: '220px', padding: '6px 10px', borderRadius: '6px', border: '1px solid var(--border-glass)', outline: 'none', fontSize: '0.82rem', backgroundColor: 'var(--input-bg)', color: 'var(--text-primary)' }} 
                                                            />
                                                        </div>
                                                    )}
                                                </div>

                                                {/* Professional Tax (PT) */}
                                                <div>
                                                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                                                        <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '0.82rem', fontWeight: 500, color: 'var(--text-primary)', cursor: 'pointer', margin: 0 }}>
                                                            <input type="checkbox" checked={ptEligible} onChange={(e) => setPtEligible(e.target.checked)} style={{ cursor: 'pointer' }} />
                                                            Professional Tax (PT) Applicable
                                                        </label>
                                                    </div>

                                                    {ptEligible && (
                                                        <div style={{ marginTop: '8px', marginLeft: '24px', display: 'flex', flexDirection: 'column', gap: '8px', background: 'var(--input-bg)', padding: '10px 12px', borderRadius: '8px', border: '1px solid var(--border-glass)' }}>
                                                            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '10px' }}>
                                                                <div>
                                                                    <label style={{ display: 'block', fontSize: '0.72rem', fontWeight: 600, color: 'var(--accent-primary)', marginBottom: '2px' }}>
                                                                        PT State Jurisdiction *
                                                                    </label>
                                                                    <select
                                                                        value={ptStateCode}
                                                                        onChange={(e) => {
                                                                            setPtStateCode(e.target.value);
                                                                            setPtAmount('');
                                                                        }}
                                                                        style={{ width: '100%', padding: '6px 10px', borderRadius: '6px', border: '1px solid var(--border-glass)', outline: 'none', fontSize: '0.82rem', backgroundColor: 'var(--bg-glass)', color: 'var(--text-primary)' }}
                                                                    >
                                                                        {(ptStatesList.length > 0 ? ptStatesList : ALL_INDIAN_STATES)
                                                                            .slice()
                                                                            .sort((a, b) => (a.stateName || '').localeCompare(b.stateName || ''))
                                                                            .map(s => (
                                                                                <option key={s.id || s.stateCode} value={s.stateCode}>
                                                                                    {s.stateName} ({s.stateCode}) {s.maxAnnualPt > 0 ? `[Max ₹${s.maxAnnualPt}/yr]` : '[Exempt]'}
                                                                                </option>
                                                                            ))
                                                                        }
                                                                    </select>
                                                                </div>

                                                                <div>
                                                                    <label style={{ display: 'block', fontSize: '0.72rem', fontWeight: 600, color: 'var(--accent-primary)', marginBottom: '2px' }}>
                                                                        Manual Monthly Override (₹)
                                                                    </label>
                                                                    <input 
                                                                        type="number" 
                                                                        value={ptAmount} 
                                                                        onChange={(e) => setPtAmount(e.target.value)} 
                                                                        placeholder="Leave empty for dynamic slabs" 
                                                                        min="0"
                                                                        style={{ width: '100%', padding: '6px 10px', borderRadius: '6px', border: '1px solid var(--border-glass)', outline: 'none', fontSize: '0.82rem', backgroundColor: 'var(--bg-glass)', color: 'var(--text-primary)' }} 
                                                                    />
                                                                </div>
                                                            </div>

                                                            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginTop: '2px' }}>
                                                                <input
                                                                    type="checkbox"
                                                                    id="ptExemptionCheck"
                                                                    checked={ptExemption}
                                                                    onChange={(e) => setPtExemption(e.target.checked)}
                                                                    style={{ cursor: 'pointer' }}
                                                                />
                                                                <label htmlFor="ptExemptionCheck" style={{ fontSize: '0.75rem', fontWeight: 600, color: '#ef4444', cursor: 'pointer', margin: 0 }}>
                                                                    Exempt this employee from Professional Tax
                                                                </label>
                                                            </div>

                                                            {ptExemption && (
                                                                <div style={{ display: 'grid', gridTemplateColumns: '1fr 2fr', gap: '8px', marginTop: '4px' }}>
                                                                    <div>
                                                                        <label style={{ display: 'block', fontSize: '0.7rem', color: 'var(--text-muted)', fontWeight: 600, marginBottom: '2px' }}>Exemption Type</label>
                                                                        <select
                                                                            value={ptExemptionType}
                                                                            onChange={(e) => setPtExemptionType(e.target.value)}
                                                                            style={{ width: '100%', padding: '5px 8px', borderRadius: '6px', border: '1px solid var(--border-glass)', fontSize: '0.75rem', backgroundColor: 'var(--bg-glass)', color: 'var(--text-primary)' }}
                                                                        >
                                                                            <option value="DISABILITY">Disability (Physically Challenged)</option>
                                                                            <option value="AGE">Senior Citizen / Age</option>
                                                                            <option value="GENDER">Gender Exemption</option>
                                                                            <option value="CUSTOM">Custom Statutory Order</option>
                                                                        </select>
                                                                    </div>
                                                                    <div>
                                                                        <label style={{ display: 'block', fontSize: '0.7rem', color: 'var(--text-muted)', fontWeight: 600, marginBottom: '2px' }}>Exemption Reason / Order Ref</label>
                                                                        <input
                                                                            type="text"
                                                                            value={ptExemptionReason}
                                                                            onChange={(e) => setPtExemptionReason(e.target.value)}
                                                                            placeholder="e.g. Disability certificate ref #123"
                                                                            style={{ width: '100%', padding: '5px 8px', borderRadius: '6px', border: '1px solid var(--border-glass)', fontSize: '0.75rem', backgroundColor: 'var(--bg-glass)', color: 'var(--text-primary)' }}
                                                                        />
                                                                    </div>
                                                                </div>
                                                            )}
                                                        </div>
                                                    )}
                                                </div>
                                            </div>
                                        </div>

                                        {/* Tax Regime */}
                                        <div className="form-group" style={{ margin: 0 }}>
                                            <label style={{ fontWeight: 600, fontSize: '0.82rem' }}>Tax Regime to Consider</label>
                                            <select value={taxRegime} onChange={(e) => setTaxRegime(e.target.value)} style={{ width: '100%', padding: '10px 14px', borderRadius: '8px', border: '1px solid #d1d5db', outline: 'none' }}>
                                                <option value="New Regime (Section 115BAC)">New Regime (Section 115BAC)</option>
                                                <option value="Old Regime (Regular Tax Slab)">Old Regime (Regular Tax Slab)</option>
                                            </select>
                                        </div>
                                    </div>

                                    {/* Right Column: Keka-Style Salary Breakdown Table */}
                                    <div style={{ flex: 1.2, minWidth: '350px', border: '1px solid #e5e7eb', borderRadius: '8px', overflow: 'hidden' }}>
                                        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.82rem', textAlign: 'left' }}>
                                            <thead>
                                                <tr style={{ backgroundColor: 'var(--table-header)', borderBottom: '1px solid var(--border-glass)' }}>
                                                    <th style={{ padding: '10px 12px', fontWeight: 600, color: 'var(--text-muted)' }}>DETAILS</th>
                                                    <th style={{ padding: '10px 12px', fontWeight: 600, color: 'var(--text-muted)', textAlign: 'right' }}>MONTHLY</th>
                                                    <th style={{ padding: '10px 12px', fontWeight: 600, color: 'var(--text-muted)', textAlign: 'right' }}>ANNUALLY</th>
                                                </tr>
                                            </thead>
                                            <tbody>
                                                <tr style={{ borderBottom: '1px solid var(--border-glass)' }}>
                                                    <td style={{ padding: '10px 12px', color: 'var(--text-primary)', fontWeight: 500 }}>Basic</td>
                                                    <td style={{ padding: '10px 12px', textAlign: 'right', color: 'var(--text-primary)' }}>{formatCurrency(monthlyBasic)}</td>
                                                    <td style={{ padding: '10px 12px', textAlign: 'right', color: 'var(--text-primary)' }}>{formatCurrency(annualBasic)}</td>
                                                </tr>
                                                <tr style={{ borderBottom: '1px solid var(--border-glass)' }}>
                                                    <td style={{ padding: '10px 12px', color: 'var(--text-primary)', fontWeight: 500 }}>HRA</td>
                                                    <td style={{ padding: '10px 12px', textAlign: 'right', color: 'var(--text-primary)' }}>{formatCurrency(monthlyHra)}</td>
                                                    <td style={{ padding: '10px 12px', textAlign: 'right', color: 'var(--text-primary)' }}>{formatCurrency(annualHra)}</td>
                                                </tr>
                                                <tr style={{ borderBottom: '1px solid var(--border-glass)' }}>
                                                    <td style={{ padding: '10px 12px', color: 'var(--text-primary)', fontWeight: 500 }}>Other Allowance</td>
                                                    <td style={{ padding: '10px 12px', textAlign: 'right', color: 'var(--text-primary)' }}>{formatCurrency(monthlyOther)}</td>
                                                    <td style={{ padding: '10px 12px', textAlign: 'right', color: 'var(--text-primary)' }}>{formatCurrency(annualOther)}</td>
                                                </tr>
                                                <tr style={{ borderBottom: '1px solid var(--border-glass)', backgroundColor: 'var(--input-bg)', fontWeight: 700 }}>
                                                    <td style={{ padding: '10px 12px', color: 'var(--text-primary)' }}>TOTAL</td>
                                                    <td style={{ padding: '10px 12px', textAlign: 'right', color: 'var(--accent-primary)' }}>INR {formatCurrency(monthlyGross)}</td>
                                                    <td style={{ padding: '10px 12px', textAlign: 'right', color: 'var(--accent-primary)' }}>INR {formatCurrency(salary)}</td>
                                                </tr>
                                                
                                                {/* Deductions Header */}
                                                <tr style={{ backgroundColor: 'var(--table-header)', borderBottom: '1px solid var(--border-glass)' }}>
                                                    <td colSpan="3" style={{ padding: '8px 12px', fontWeight: 600, color: 'var(--text-muted)', fontSize: '0.75rem' }}>DEDUCTIONS</td>
                                                </tr>
                                                <tr style={{ borderBottom: '1px solid var(--border-glass)' }}>
                                                    <td style={{ padding: '10px 12px', color: 'var(--text-primary)' }}>PF Employee</td>
                                                    <td style={{ padding: '10px 12px', textAlign: 'right', color: 'var(--text-primary)' }}>{monthlyPf > 0 ? formatCurrency(monthlyPf) : '-'}</td>
                                                    <td style={{ padding: '10px 12px', textAlign: 'right', color: 'var(--text-primary)' }}>{annualPf > 0 ? formatCurrency(annualPf) : '-'}</td>
                                                </tr>
                                                {vpfEligible && monthlyVpf > 0 && (
                                                    <tr style={{ borderBottom: '1px solid var(--border-glass)', backgroundColor: 'rgba(124, 58, 237, 0.08)' }}>
                                                        <td style={{ padding: '10px 12px', color: '#a78bfa', fontWeight: 500 }}>VPF Employee</td>
                                                        <td style={{ padding: '10px 12px', textAlign: 'right', color: '#a78bfa', fontWeight: 600 }}>{formatCurrency(monthlyVpf)}</td>
                                                        <td style={{ padding: '10px 12px', textAlign: 'right', color: '#a78bfa', fontWeight: 600 }}>{formatCurrency(annualVpf)}</td>
                                                    </tr>
                                                )}
                                                <tr style={{ borderBottom: '1px solid var(--border-glass)' }}>
                                                    <td style={{ padding: '10px 12px', color: 'var(--text-primary)' }}>ESI Employee</td>
                                                    <td style={{ padding: '10px 12px', textAlign: 'right', color: 'var(--text-primary)' }}>{monthlyEsi > 0 ? formatCurrency(monthlyEsi) : '-'}</td>
                                                    <td style={{ padding: '10px 12px', textAlign: 'right', color: 'var(--text-primary)' }}>{annualEsi > 0 ? formatCurrency(annualEsi) : '-'}</td>
                                                </tr>
                                                {lwfEligible && (
                                                    <tr style={{ borderBottom: '1px solid var(--border-glass)' }}>
                                                        <td style={{ padding: '10px 12px', color: 'var(--text-primary)' }}>LWF Employee</td>
                                                        <td style={{ padding: '10px 12px', textAlign: 'right', color: 'var(--text-primary)' }}>{formatCurrency(monthlyLwf)}</td>
                                                        <td style={{ padding: '10px 12px', textAlign: 'right', color: 'var(--text-primary)' }}>{formatCurrency(annualLwf)}</td>
                                                    </tr>
                                                )}
                                                {ptEligible && (
                                                    <tr style={{ borderBottom: '1px solid var(--border-glass)' }}>
                                                        <td style={{ padding: '10px 12px', color: 'var(--text-primary)' }}>Professional Tax (PT)</td>
                                                        <td style={{ padding: '10px 12px', textAlign: 'right', color: 'var(--text-primary)' }}>{formatCurrency(monthlyPt)}</td>
                                                        <td style={{ padding: '10px 12px', textAlign: 'right', color: 'var(--text-primary)' }}>{formatCurrency(annualPt)}</td>
                                                    </tr>
                                                )}
                                                <tr style={{ backgroundColor: 'rgba(37, 99, 235, 0.1)', fontWeight: 700, borderTop: '1px solid var(--border-glass)' }}>
                                                    <td style={{ padding: '11px 12px', color: 'var(--accent-primary)' }}>NET PAY</td>
                                                    <td style={{ padding: '11px 12px', textAlign: 'right', color: 'var(--accent-primary)' }}>INR {formatCurrency(monthlyNet)}</td>
                                                    <td style={{ padding: '11px 12px', textAlign: 'right', color: 'var(--accent-primary)' }}>INR {formatCurrency(annualNet)}</td>
                                                </tr>
                                            </tbody>
                                        </table>
                                    </div>
                                </div>
                            </div>
                        )}

                        {/* Dynamic Custom Fields Section for Each Page */}
                        <div style={{ marginTop: '20px', borderTop: '1px dashed #e2e8f0', paddingTop: '15px' }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
                                <span style={{ fontSize: '0.85rem', fontWeight: 600, color: '#4b5563' }}>Dynamic Custom Fields (Step {formStep})</span>
                                <button 
                                    type="button" 
                                    className="btn btn-outline" 
                                    style={{ padding: '6px 12px', fontSize: '0.78rem', border: '1px solid #4f46e5', color: '#4f46e5', background: 'none', borderRadius: '6px', cursor: 'pointer', fontWeight: 600 }}
                                    onClick={() => {
                                        const label = prompt("Enter Custom Field Label/Name (e.g., Blood Group, Secondary Phone):");
                                        if (label && label.trim()) {
                                            setDynamicFields(prev => ({
                                                ...prev,
                                                [label.trim()]: { step: formStep, value: '' }
                                            }));
                                        }
                                    }}
                                >
                                    + Add New Field
                                </button>
                            </div>
                            
                            <div style={{ display: 'flex', gap: '20px', flexWrap: 'wrap' }}>
                                {Object.entries(dynamicFields)
                                    .filter(([_, field]) => field.step === formStep)
                                    .map(([label, field]) => (
                                        <div key={label} className="form-group" style={{ flex: '1 1 220px', margin: 0, position: 'relative' }}>
                                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
                                                <label style={{ fontWeight: 600, fontSize: '0.82rem', color: '#4b5563' }}>{label}</label>
                                                <button 
                                                    type="button" 
                                                    style={{ background: 'none', border: 'none', color: '#ef4444', cursor: 'pointer', fontSize: '0.75rem', padding: 0 }}
                                                    onClick={() => {
                                                        const copy = { ...dynamicFields };
                                                        delete copy[label];
                                                        setDynamicFields(copy);
                                                    }}
                                                >
                                                    Remove
                                                </button>
                                            </div>
                                            <input 
                                                type="text" 
                                                value={field.value} 
                                                onChange={(e) => {
                                                    setDynamicFields(prev => ({
                                                        ...prev,
                                                        [label]: { ...prev[label], value: e.target.value }
                                                    }));
                                                }} 
                                                placeholder={`Enter value for ${label}`}
                                                style={{ width: '100%', padding: '10px 14px', borderRadius: '8px', border: '1px solid #d1d5db', outline: 'none' }} 
                                            />
                                        </div>
                                    ))
                                }
                                {Object.entries(dynamicFields).filter(([_, field]) => field.step === formStep).length === 0 && (
                                    <span style={{ fontSize: '0.78rem', color: '#9ca3af', fontStyle: 'italic' }}>No custom fields added yet. Click "+ Add New Field" to add fields dynamically.</span>
                                )}
                            </div>
                        </div>

                        {/* Navigation Buttons */}
                        <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '20px', borderTop: '1px solid #e2e8f0', paddingTop: '15px' }}>
                            <button 
                                type="button" 
                                className="btn btn-secondary"
                                disabled={formStep === 1}
                                onClick={() => setFormStep(prev => Math.max(1, prev - 1))}
                                style={{ padding: '10px 20px', borderRadius: '8px', fontSize: '0.88rem', fontWeight: 600, opacity: formStep === 1 ? 0.5 : 1, cursor: formStep === 1 ? 'not-allowed' : 'pointer' }}
                            >
                                Back
                            </button>
                            
                            <button 
                                type="submit" 
                                className="btn btn-primary"
                                disabled={loading}
                                style={{ padding: '10px 24px', borderRadius: '8px', fontSize: '0.88rem', fontWeight: 600 }}
                            >
                                {formStep === 6 ? (loading ? 'Registering...' : 'Register Employee') : 'Next'}
                            </button>
                        </div>
                    </form>
                </div>
            )}

            {/* View / Edit Employee Details Modal Panel */}
            {viewingEmployee && (
                <div style={{ height: 'calc(100vh - 140px)', display: 'flex', flexDirection: 'column', overflow: 'hidden', gap: '12px' }}>
                    
                    {/* Consolidated Compact SaaS Profile Banner & Header */}
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', flexShrink: 0 }}>
                        <div style={{ background: 'linear-gradient(135deg, #1e1b4b 0%, #312e81 100%)', borderRadius: '10px', padding: '10px 16px', boxShadow: '0 4px 12px rgba(0, 0, 0, 0.08)', flexShrink: 0 }}>
                            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '10px' }}>
                                {/* Left Group: Back Button + Avatar + Identity */}
                                <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
                                    <button 
                                        type="button"
                                        onClick={handleCloseProfile}
                                        style={{ background: 'rgba(255, 255, 255, 0.15)', border: '1px solid rgba(255, 255, 255, 0.25)', borderRadius: '6px', color: '#ffffff', padding: '4px 10px', fontSize: '0.75rem', fontWeight: 600, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: '6px' }}
                                        title="Return to Employee Directory"
                                    >
                                        <i className="fa-solid fa-arrow-left"></i> Directory
                                    </button>

                                     {(() => {
                                         const rawPhoto = viewingEmployee.profilePhotoUrl || viewingEmployee.avatar;
                                         const photoUrl = rawPhoto ? getFullUrl(rawPhoto) : null;
                                         return (
                                             <div style={{ position: 'relative', width: '42px', height: '42px', flexShrink: 0 }}>
                                                 {photoUrl ? (
                                                     <img 
                                                         src={photoUrl} 
                                                         alt={viewingEmployee.name}
                                                         onClick={() => setPreviewImage({ url: photoUrl, title: viewingEmployee.name, subtitle: viewingEmployee.jobTitle || 'Employee Profile' })}
                                                         title="Click to view full photo in same tab"
                                                         style={{ width: '42px', height: '42px', borderRadius: '50%', objectFit: 'cover', border: '2px solid rgba(255, 255, 255, 0.6)', cursor: 'pointer' }}
                                                         onError={(e) => {
                                                             e.currentTarget.onerror = null;
                                                             e.currentTarget.style.display = 'none';
                                                             if (e.currentTarget.nextSibling) {
                                                                 e.currentTarget.nextSibling.style.display = 'flex';
                                                             }
                                                         }}
                                                         style={{ width: '42px', height: '42px', borderRadius: '50%', objectFit: 'cover', border: '2px solid rgba(255, 255, 255, 0.6)' }}
                                                     />
                                                 ) : null}
                                                 <div style={{ 
                                                     width: '42px', 
                                                     height: '42px', 
                                                     borderRadius: '50%', 
                                                     background: '#4338ca', 
                                                     color: '#ffffff', 
                                                     display: photoUrl ? 'none' : 'flex', 
                                                     alignItems: 'center', 
                                                     justifyContent: 'center', 
                                                     fontSize: '1.15rem', 
                                                     fontWeight: 800, 
                                                     border: '2px solid rgba(255, 255, 255, 0.6)', 
                                                     textTransform: 'uppercase' 
                                                 }}>
                                                     {viewingEmployee.name ? viewingEmployee.name.charAt(0) : 'E'}
                                                 </div>

                                                 <label 
                                                     title="Upload or Change Profile Photo"
                                                     style={{
                                                         position: 'absolute',
                                                         bottom: '-2px',
                                                         right: '-2px',
                                                         background: '#4f46e5',
                                                         color: '#ffffff',
                                                         borderRadius: '50%',
                                                         width: '18px',
                                                         height: '18px',
                                                         display: 'flex',
                                                         alignItems: 'center',
                                                         justify: 'center',
                                                         cursor: 'pointer',
                                                         fontSize: '9px',
                                                         border: '1.5px solid #ffffff',
                                                         boxShadow: '0 2px 5px rgba(0,0,0,0.3)',
                                                         zIndex: 10
                                                     }}
                                                 >
                                                     <i className="fa-solid fa-camera"></i>
                                                     <input 
                                                         type="file" 
                                                         accept="image/*" 
                                                         onChange={async (e) => {
                                                             const file = e.target.files?.[0];
                                                             if (!file || !viewingEmployee) return;
                                                             try {
                                                                 const targetId = viewingEmployee.id;
                                                                 let res;
                                                                 if (api.uploadEmployeeProfilePhoto) {
                                                                     res = await api.uploadEmployeeProfilePhoto(targetId, file).catch(() => api.uploadEmployeeAvatar(targetId, file));
                                                                 } else if (api.uploadEmployeeAvatar) {
                                                                     res = await api.uploadEmployeeAvatar(targetId, file);
                                                                 }
                                                                 const newPhotoUrl = res?.profilePhotoUrl || res?.avatar || res?.url;
                                                                 if (newPhotoUrl) {
                                                                     setViewingEmployee(prev => ({
                                                                         ...prev,
                                                                         profilePhotoUrl: newPhotoUrl,
                                                                         avatar: newPhotoUrl
                                                                     }));
                                                                     setEmployees(prev => prev.map(emp => {
                                                                         if (emp.id === targetId) {
                                                                             return { ...emp, profilePhotoUrl: newPhotoUrl, avatar: newPhotoUrl };
                                                                         }
                                                                         return emp;
                                                                     }));
                                                                 }
                                                             } catch (err) {
                                                                 console.error('Failed to upload profile photo:', err);
                                                                 alert('Upload error: ' + (err.message || 'Unknown error'));
                                                             }
                                                         }} 
                                                         style={{ display: 'none' }} 
                                                     />
                                                 </label>
                                             </div>
                                         );
                                     })()}

                                    <div>
                                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                            <h3 style={{ margin: 0, fontSize: '1.15rem', fontWeight: 800, color: '#ffffff', letterSpacing: '-0.01em' }}>
                                                {viewingEmployee.name}
                                            </h3>
                                            <span style={{ background: 'rgba(255, 255, 255, 0.18)', color: '#ffffff', fontSize: '0.72rem', fontWeight: 700, padding: '2px 8px', borderRadius: '12px' }}>
                                                {viewingEmployee.jobTitle || 'Field Staff'}
                                            </span>
                                            {viewingEmployee.role === 'ADMIN' && (
                                                <span style={{ background: 'rgba(234, 179, 8, 0.25)', color: '#fef08a', border: '1px solid rgba(234, 179, 8, 0.4)', fontSize: '0.7rem', fontWeight: 800, padding: '2px 8px', borderRadius: '12px' }}>
                                                    👑 Administrator
                                                </span>
                                            )}
                                            {viewingEmployee.role === 'TRACKING_MANAGER' && (
                                                <span style={{ background: 'rgba(56, 189, 248, 0.25)', color: '#e0f2fe', border: '1px solid rgba(56, 189, 248, 0.4)', fontSize: '0.7rem', fontWeight: 800, padding: '2px 8px', borderRadius: '12px' }}>
                                                    📍 Tracking Manager
                                                </span>
                                            )}
                                            {viewingEmployee.role === 'FIELD_INVOICE_MANAGER' && (
                                                <span style={{ background: 'rgba(249, 115, 22, 0.25)', color: '#ffedd5', border: '1px solid rgba(249, 115, 22, 0.4)', fontSize: '0.7rem', fontWeight: 800, padding: '2px 8px', borderRadius: '12px' }}>
                                                    💼 Field & Invoice Manager
                                                </span>
                                            )}
                                            <span style={{ background: '#dcfce7', color: '#15803d', fontSize: '0.7rem', fontWeight: 800, padding: '2px 8px', borderRadius: '12px' }}>
                                                ● PRESENT
                                            </span>
                                        </div>

                                        {/* Compact Metadata Strip */}
                                        <div style={{ display: 'flex', gap: '14px', flexWrap: 'wrap', marginTop: '3px', fontSize: '0.74rem', color: '#e0e7ff', fontWeight: 500 }}>
                                            <span>✉️ <strong style={{ color: '#ffffff' }}>{viewingEmployee.email}</strong></span>
                                            <span>📞 <strong style={{ color: '#ffffff' }}>{viewingEmployee.phoneNo || '-'}</strong></span>
                                            <span>📍 <strong style={{ color: '#ffffff' }}>{viewingEmployee.location || 'Headquarters'}</strong></span>
                                            <span>🪪 ID: <strong style={{ color: '#38bdf8' }}>{viewingEmployee.empCode || viewingEmployee.id}</strong></span>
                                            <span>🏢 Dept: <strong style={{ color: '#ffffff' }}>{viewingEmployee.department || 'Operations'}</strong></span>
                                            <span>👤 Mgr: <strong style={{ color: '#ffffff' }}>{viewingEmployee.reportingManager || 'Admin'}</strong></span>
                                        </div>
                                    </div>
                                </div>

                                {/* Right Actions */}
                                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                    <button 
                                        type="button"
                                        onClick={() => {
                                            setLeaveAdjustmentEmpId(viewingEmployee.id || viewingEmployee.empCode);
                                            setShowLeaveAdjustmentModal(true);
                                        }}
                                        style={{ background: '#059669', color: '#ffffff', border: '1px solid rgba(255,255,255,0.3)', padding: '6px 14px', borderRadius: '6px', fontSize: '0.78rem', fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: '6px', cursor: 'pointer', boxShadow: '0 2px 6px rgba(0,0,0,0.2)' }}
                                    >
                                        + Add Opening Balance
                                    </button>
                                    <button 
                                        type="button"
                                        onClick={() => setIsEditing(!isEditing)}
                                        style={{ background: '#4f46e5', color: '#ffffff', border: '1px solid rgba(255,255,255,0.3)', padding: '6px 14px', borderRadius: '6px', fontSize: '0.78rem', fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: '6px', cursor: 'pointer', boxShadow: '0 2px 6px rgba(0,0,0,0.2)' }}
                                    >
                                        {isEditing ? 'Cancel Edit' : '✏️ Edit Profile'}
                                    </button>
                                    <button 
                                        type="button"
                                        onClick={handleCloseProfile}
                                        style={{ background: 'none', border: 'none', fontSize: '1.4rem', cursor: 'pointer', color: '#cbd5e1', padding: '0 4px', lineHeight: 1 }}
                                        title="Close Profile"
                                    >
                                        &times;
                                    </button>
                                </div>
                            </div>
                        </div>

                        {/* Streamlined Tab Strip with Inline Sub-Tabs */}
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: 'var(--bg-glass)', border: '1px solid var(--border-glass)', borderRadius: '8px', padding: '4px 8px', flexWrap: 'wrap', gap: '8px' }}>
                            <div style={{ display: 'flex', gap: '6px' }}>
                                {[
                                    { id: 'PROFILE', label: 'PROFILE' },
                                    { id: 'JOB', label: 'JOB' },
                                    { id: 'POLICIES', label: 'POLICIES & TERMS' },
                                    { id: 'FINANCES', label: 'FINANCES' },
                                    { id: 'DOCUMENTS', label: 'DOCUMENTS' }
                                ].map(t => (
                                    <button
                                        key={t.id}
                                        type="button"
                                        onClick={() => changeProfileTab(t.id)}
                                        style={{
                                            padding: '6px 14px',
                                            border: 'none',
                                            background: profileTab === t.id ? 'var(--accent-primary)' : 'transparent',
                                            borderRadius: '6px',
                                            color: profileTab === t.id ? '#ffffff' : 'var(--text-muted)',
                                            fontWeight: profileTab === t.id ? 700 : 600,
                                            fontSize: '0.78rem',
                                            boxShadow: profileTab === t.id ? '0 2px 8px rgba(79, 70, 229, 0.35)' : 'none',
                                            cursor: 'pointer',
                                            transition: 'all 0.15s ease'
                                        }}
                                    >
                                        {t.label}
                                    </button>
                                ))}
                            </div>

                            {/* If Finances Tab Active, Show Inline Sub-Tabs */}
                            {profileTab === 'FINANCES' && (
                                <div style={{ display: 'flex', gap: '4px', background: 'var(--input-bg)', padding: '2px 6px', borderRadius: '6px', border: '1px solid var(--border-glass)' }}>
                                    <button
                                        type="button"
                                        onClick={() => setFinanceSubTab('SALARY')}
                                        style={{
                                            padding: '4px 10px',
                                            border: 'none',
                                            background: financeSubTab === 'SALARY' ? 'var(--accent-primary)' : 'transparent',
                                            borderRadius: '4px',
                                            color: financeSubTab === 'SALARY' ? '#ffffff' : 'var(--text-muted)',
                                            fontWeight: 700,
                                            fontSize: '0.72rem',
                                            cursor: 'pointer'
                                        }}
                                    >
                                        Salary Structure
                                    </button>
                                    <button
                                        type="button"
                                        onClick={() => setFinanceSubTab('REVISIONS')}
                                        style={{
                                            padding: '4px 10px',
                                            border: 'none',
                                            background: financeSubTab === 'REVISIONS' ? 'var(--accent-primary)' : 'transparent',
                                            borderRadius: '4px',
                                            color: financeSubTab === 'REVISIONS' ? '#ffffff' : 'var(--text-muted)',
                                            fontWeight: 700,
                                            fontSize: '0.72rem',
                                            cursor: 'pointer'
                                        }}
                                    >
                                        Revision History
                                    </button>
                                </div>
                            )}
                        </div>
                    </div>

                    {!isEditing ? (
                        /* READ-ONLY TABBED PROFILE HUB */
                        <div id="profile-scroll-container" className="custom-scrollbar" style={{ flex: 1, minHeight: 0, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '12px', marginTop: '4px', paddingRight: '4px', paddingBottom: '16px' }}>
                            
                            {/* TAB 1: PROFILE DETAILS */}
                            {profileTab === 'PROFILE' && (
                                <div id="section-profile" style={{ display: 'flex', flexDirection: 'column', gap: '12px', width: '100%' }}>
                                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: '14px', width: '100%' }}>
                                        {/* Personal Details Card */}
                                        <div style={{ border: '1px solid var(--border-glass)', padding: '14px 16px', borderRadius: '10px', backgroundColor: 'var(--bg-glass)', boxShadow: 'var(--shadow-sm)', minWidth: 0 }}>
                                            <h4 style={{ margin: '0 0 12px 0', fontSize: '0.88rem', fontWeight: 700, color: 'var(--text-primary)', borderLeft: '3px solid var(--accent-primary)', paddingLeft: '8px', display: 'flex', alignItems: 'center', gap: '6px' }}>
                                                👤 Personal Information
                                            </h4>
                                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
                                                <div style={{ background: 'var(--input-bg)', border: '1px solid var(--border-glass)', padding: '8px 12px', borderRadius: '6px', minWidth: 0 }}>
                                                    <span style={{ display: 'block', color: 'var(--text-muted)', fontWeight: 700, fontSize: '0.68rem', letterSpacing: '0.04em', marginBottom: '2px' }}>FULL NAME</span>
                                                    <div style={{ color: 'var(--text-primary)', fontWeight: 600, fontSize: '0.84rem', wordBreak: 'break-word' }}>{viewingEmployee.name}</div>
                                                </div>
                                                <div style={{ background: 'var(--input-bg)', border: '1px solid var(--border-glass)', padding: '8px 12px', borderRadius: '6px', minWidth: 0 }}>
                                                    <span style={{ display: 'block', color: 'var(--text-muted)', fontWeight: 700, fontSize: '0.68rem', letterSpacing: '0.04em', marginBottom: '2px' }}>FATHER / SPOUSE NAME</span>
                                                    <div style={{ color: 'var(--text-primary)', fontWeight: 600, fontSize: '0.84rem', wordBreak: 'break-word' }}>{viewingEmployee.fatherName || viewingEmployee.father_name || viewingEmployee.spouseName || '-'}</div>
                                                </div>
                                                <div style={{ background: 'var(--input-bg)', border: '1px solid var(--border-glass)', padding: '8px 12px', borderRadius: '6px', minWidth: 0 }}>
                                                    <span style={{ display: 'block', color: 'var(--text-muted)', fontWeight: 700, fontSize: '0.68rem', letterSpacing: '0.04em', marginBottom: '2px' }}>GENDER</span>
                                                    <div style={{ color: 'var(--text-primary)', fontWeight: 600, fontSize: '0.84rem' }}>{viewingEmployee.gender || 'Male'}</div>
                                                </div>
                                                <div style={{ background: 'var(--input-bg)', border: '1px solid var(--border-glass)', padding: '8px 12px', borderRadius: '6px', minWidth: 0 }}>
                                                    <span style={{ display: 'block', color: 'var(--text-muted)', fontWeight: 700, fontSize: '0.68rem', letterSpacing: '0.04em', marginBottom: '2px' }}>DATE OF BIRTH</span>
                                                    <div style={{ color: 'var(--text-primary)', fontWeight: 600, fontSize: '0.84rem' }}>{formatDate(viewingEmployee.dob) || '-'}</div>
                                                </div>
                                                <div style={{ background: 'var(--input-bg)', border: '1px solid var(--border-glass)', padding: '8px 12px', borderRadius: '6px', minWidth: 0 }}>
                                                    <span style={{ display: 'block', color: 'var(--text-muted)', fontWeight: 700, fontSize: '0.68rem', letterSpacing: '0.04em', marginBottom: '2px' }}>NATIONALITY</span>
                                                    <div style={{ color: 'var(--text-primary)', fontWeight: 600, fontSize: '0.84rem' }}>{viewingEmployee.nationality || 'Indian'}</div>
                                                </div>
                                                <div style={{ background: 'var(--input-bg)', border: '1px solid var(--border-glass)', padding: '8px 12px', borderRadius: '6px', minWidth: 0 }}>
                                                    <span style={{ display: 'block', color: 'var(--text-muted)', fontWeight: 700, fontSize: '0.68rem', letterSpacing: '0.04em', marginBottom: '2px' }}>PRIMARY PHONE</span>
                                                    <div style={{ color: 'var(--text-primary)', fontWeight: 600, fontSize: '0.84rem' }}>{viewingEmployee.phoneNo || '-'}</div>
                                                </div>
                                                <div style={{ background: 'var(--input-bg)', border: '1px solid var(--border-glass)', padding: '8px 12px', borderRadius: '6px', minWidth: 0 }}>
                                                    <span style={{ display: 'block', color: 'var(--text-muted)', fontWeight: 700, fontSize: '0.68rem', letterSpacing: '0.04em', marginBottom: '2px' }}>ALT PHONE NUMBER</span>
                                                    <div style={{ color: 'var(--text-primary)', fontWeight: 600, fontSize: '0.84rem' }}>{viewingEmployee.altPhoneNo || '-'}</div>
                                                </div>
                                                <div style={{ background: 'var(--input-bg)', border: '1px solid var(--border-glass)', padding: '8px 12px', borderRadius: '6px', minWidth: 0 }}>
                                                    <span style={{ display: 'block', color: 'var(--text-muted)', fontWeight: 700, fontSize: '0.68rem', letterSpacing: '0.04em', marginBottom: '2px' }}>PRIMARY EMAIL ADDRESS</span>
                                                    <div style={{ color: 'var(--text-primary)', fontWeight: 600, fontSize: '0.84rem', wordBreak: 'break-all' }}>{viewingEmployee.email}</div>
                                                </div>
                                            </div>
                                        </div>

                                        {/* Address & Emergency Contacts Card */}
                                        <div style={{ border: '1px solid var(--border-glass)', padding: '14px 16px', borderRadius: '10px', backgroundColor: 'var(--bg-glass)', boxShadow: 'var(--shadow-sm)', minWidth: 0 }}>
                                            <h4 style={{ margin: '0 0 12px 0', fontSize: '0.88rem', fontWeight: 700, color: 'var(--text-primary)', borderLeft: '3px solid var(--accent-primary)', paddingLeft: '8px', display: 'flex', alignItems: 'center', gap: '6px' }}>
                                                🏠 Address & Emergency Contacts
                                            </h4>
                                            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                                                <div style={{ background: 'var(--input-bg)', border: '1px solid var(--border-glass)', padding: '8px 12px', borderRadius: '6px', minWidth: 0 }}>
                                                    <span style={{ display: 'block', color: 'var(--text-muted)', fontWeight: 700, fontSize: '0.68rem', letterSpacing: '0.04em', marginBottom: '2px' }}>CURRENT RESIDENTIAL ADDRESS</span>
                                                    <div style={{ color: 'var(--text-primary)', fontWeight: 600, fontSize: '0.84rem', wordBreak: 'break-word' }}>{viewingEmployee.presentAddress || viewingEmployee.present_address || viewingEmployee.currentAddress || viewingEmployee.address || '-'}</div>
                                                </div>
                                                <div style={{ background: 'var(--input-bg)', border: '1px solid var(--border-glass)', padding: '8px 12px', borderRadius: '6px', minWidth: 0 }}>
                                                    <span style={{ display: 'block', color: 'var(--text-muted)', fontWeight: 700, fontSize: '0.68rem', letterSpacing: '0.04em', marginBottom: '2px' }}>PERMANENT ADDRESS</span>
                                                    <div style={{ color: 'var(--text-primary)', fontWeight: 600, fontSize: '0.84rem', wordBreak: 'break-word' }}>{viewingEmployee.permanentAddress || viewingEmployee.permanent_address || viewingEmployee.presentAddress || viewingEmployee.present_address || 'Same as current address'}</div>
                                                </div>
                                                <div style={{ background: 'var(--input-bg)', border: '1px solid var(--border-glass)', padding: '8px 12px', borderRadius: '6px', minWidth: 0 }}>
                                                    <span style={{ display: 'block', color: 'var(--text-muted)', fontWeight: 700, fontSize: '0.68rem', letterSpacing: '0.04em', marginBottom: '2px' }}>EMERGENCY CONTACT PERSON & RELATION</span>
                                                    <div style={{ color: 'var(--text-primary)', fontWeight: 600, fontSize: '0.84rem', wordBreak: 'break-word' }}>{viewingEmployee.emergencyContact || viewingEmployee.emergency_contact || '-'}</div>
                                                </div>
                                            </div>
                                        </div>

                                        {/* Highest Qualification Card */}
                                        {(() => {
                                            let hqView = viewingEmployee.highestQualification;
                                            if (typeof hqView === 'string') {
                                                try { hqView = JSON.parse(hqView); } catch (e) { hqView = {}; }
                                            }
                                            hqView = hqView || viewingEmployee.customFields?.highestQualification || {};
                                            return (
                                                <div style={{ border: '1px solid var(--border-glass)', padding: '14px 16px', borderRadius: '10px', backgroundColor: 'var(--bg-glass)', boxShadow: 'var(--shadow-sm)', minWidth: 0 }}>
                                                    <h4 style={{ margin: '0 0 12px 0', fontSize: '0.88rem', fontWeight: 700, color: 'var(--text-primary)', borderLeft: '3px solid var(--accent-primary)', paddingLeft: '8px', display: 'flex', alignItems: 'center', gap: '6px' }}>
                                                        🎓 Highest Educational Qualification
                                                    </h4>
                                                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
                                                        <div style={{ background: 'var(--input-bg)', border: '1px solid var(--border-glass)', padding: '8px 12px', borderRadius: '6px', minWidth: 0 }}>
                                                            <span style={{ display: 'block', color: 'var(--text-muted)', fontWeight: 700, fontSize: '0.68rem', letterSpacing: '0.04em', marginBottom: '2px' }}>QUALIFICATION / DEGREE</span>
                                                            <div style={{ color: 'var(--text-primary)', fontWeight: 600, fontSize: '0.84rem', wordBreak: 'break-word' }}>{hqView.level || '-'}</div>
                                                        </div>
                                                        <div style={{ background: 'var(--input-bg)', border: '1px solid var(--border-glass)', padding: '8px 12px', borderRadius: '6px', minWidth: 0 }}>
                                                            <span style={{ display: 'block', color: 'var(--text-muted)', fontWeight: 700, fontSize: '0.68rem', letterSpacing: '0.04em', marginBottom: '2px' }}>FIELD OF STUDY / STREAM</span>
                                                            <div style={{ color: 'var(--text-primary)', fontWeight: 600, fontSize: '0.84rem', wordBreak: 'break-word' }}>{hqView.stream || '-'}</div>
                                                        </div>
                                                        <div style={{ background: 'var(--input-bg)', border: '1px solid var(--border-glass)', padding: '8px 12px', borderRadius: '6px', minWidth: 0, gridColumn: '1 / -1' }}>
                                                            <span style={{ display: 'block', color: 'var(--text-muted)', fontWeight: 700, fontSize: '0.68rem', letterSpacing: '0.04em', marginBottom: '2px' }}>COLLEGE / UNIVERSITY / BOARD</span>
                                                            <div style={{ color: 'var(--text-primary)', fontWeight: 600, fontSize: '0.84rem', wordBreak: 'break-word' }}>{hqView.institution || '-'}</div>
                                                        </div>
                                                        <div style={{ background: 'var(--input-bg)', border: '1px solid var(--border-glass)', padding: '8px 12px', borderRadius: '6px', minWidth: 0 }}>
                                                            <span style={{ display: 'block', color: 'var(--text-muted)', fontWeight: 700, fontSize: '0.68rem', letterSpacing: '0.04em', marginBottom: '2px' }}>YEAR OF PASSING</span>
                                                            <div style={{ color: 'var(--text-primary)', fontWeight: 600, fontSize: '0.84rem' }}>{hqView.year || '-'}</div>
                                                        </div>
                                                        <div style={{ background: 'var(--input-bg)', border: '1px solid var(--border-glass)', padding: '8px 12px', borderRadius: '6px', minWidth: 0 }}>
                                                            <span style={{ display: 'block', color: 'var(--text-muted)', fontWeight: 700, fontSize: '0.68rem', letterSpacing: '0.04em', marginBottom: '2px' }}>PERCENTAGE / CGPA</span>
                                                            <div style={{ color: 'var(--text-primary)', fontWeight: 600, fontSize: '0.84rem' }}>{hqView.percentage || hqView.percent || '-'}</div>
                                                        </div>
                                                    </div>
                                                </div>
                                            );
                                        })()}
                                    </div>
                                </div>
                            )}

                            {/* TAB 2: JOB DETAILS */}
                            {profileTab === 'JOB' && (
                                <div id="section-job" style={{ display: 'flex', flexDirection: 'column', gap: '12px', width: '100%' }}>
                                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: '12px', width: '100%' }}>
                                        {/* Employment Information */}
                                        <div style={{ border: '1px solid var(--border-glass)', padding: '14px 16px', borderRadius: '10px', backgroundColor: 'var(--bg-glass)', boxShadow: 'var(--shadow-sm)' }}>
                                            <h4 style={{ margin: '0 0 12px 0', fontSize: '0.88rem', fontWeight: 700, color: 'var(--text-primary)', borderLeft: '3px solid var(--accent-primary)', paddingLeft: '8px', display: 'flex', alignItems: 'center', gap: '6px' }}>
                                                💼 Job & Workplace Details
                                            </h4>
                                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
                                                <div style={{ background: 'var(--input-bg)', border: '1px solid var(--border-glass)', padding: '8px 12px', borderRadius: '6px' }}>
                                                    <span style={{ display: 'block', color: 'var(--text-muted)', fontWeight: 700, fontSize: '0.68rem', letterSpacing: '0.04em', marginBottom: '2px' }}>JOINING DATE</span>
                                                    <div style={{ color: 'var(--text-primary)', fontWeight: 600, fontSize: '0.84rem' }}>{formatDate(viewingEmployee.joiningDate) || '-'}</div>
                                                </div>
                                                <div style={{ background: 'var(--input-bg)', border: '1px solid var(--border-glass)', padding: '8px 12px', borderRadius: '6px' }}>
                                                    <span style={{ display: 'block', color: 'var(--text-muted)', fontWeight: 700, fontSize: '0.68rem', letterSpacing: '0.04em', marginBottom: '2px' }}>DESIGNATION</span>
                                                    <div style={{ color: 'var(--text-primary)', fontWeight: 600, fontSize: '0.84rem' }}>{viewingEmployee.jobTitle || 'Field Staff'}</div>
                                                </div>
                                                <div style={{ background: 'var(--input-bg)', border: '1px solid var(--border-glass)', padding: '8px 12px', borderRadius: '6px' }}>
                                                    <span style={{ display: 'block', color: 'var(--text-muted)', fontWeight: 700, fontSize: '0.68rem', letterSpacing: '0.04em', marginBottom: '2px' }}>DEPARTMENT</span>
                                                    <div style={{ color: 'var(--text-primary)', fontWeight: 600, fontSize: '0.84rem' }}>{viewingEmployee.department || 'Field Operations'}</div>
                                                </div>
                                                <div style={{ background: 'var(--input-bg)', border: '1px solid var(--border-glass)', padding: '8px 12px', borderRadius: '6px' }}>
                                                    <span style={{ display: 'block', color: 'var(--text-muted)', fontWeight: 700, fontSize: '0.68rem', letterSpacing: '0.04em', marginBottom: '2px' }}>WORK LOCATION</span>
                                                    <div style={{ color: 'var(--text-primary)', fontWeight: 600, fontSize: '0.84rem' }}>{viewingEmployee.location || 'Headquarters'}</div>
                                                </div>
                                                <div style={{ background: 'var(--input-bg)', border: '1px solid var(--border-glass)', padding: '8px 12px', borderRadius: '6px' }}>
                                                    <span style={{ display: 'block', color: 'var(--text-muted)', fontWeight: 700, fontSize: '0.68rem', letterSpacing: '0.04em', marginBottom: '2px' }}>PLACE OF DUTY</span>
                                                    <div style={{ color: 'var(--text-primary)', fontWeight: 600, fontSize: '0.84rem' }}>{viewingEmployee.placeOfDuty || viewingEmployee.place_of_duty || '-'}</div>
                                                </div>
                                                <div style={{ background: 'var(--input-bg)', border: '1px solid var(--border-glass)', padding: '8px 12px', borderRadius: '6px' }}>
                                                    <span style={{ display: 'block', color: 'var(--text-muted)', fontWeight: 700, fontSize: '0.68rem', letterSpacing: '0.04em', marginBottom: '2px' }}>LEGAL ENTITY</span>
                                                    <div style={{ color: 'var(--text-primary)', fontWeight: 600, fontSize: '0.84rem' }}>{viewingEmployee.legalEntity || 'Hydromaterials Private Limited'}</div>
                                                </div>
                                                <div style={{ background: 'var(--input-bg)', border: '1px solid var(--border-glass)', padding: '8px 12px', borderRadius: '6px' }}>
                                                    <span style={{ display: 'block', color: 'var(--text-muted)', fontWeight: 700, fontSize: '0.68rem', letterSpacing: '0.04em', marginBottom: '2px' }}>REPORTING MANAGER</span>
                                                    <div style={{ color: 'var(--text-primary)', fontWeight: 600, fontSize: '0.84rem' }}>{viewingEmployee.reportingManager || 'Admin'}</div>
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            )}

                            {/* TAB 3: POLICIES & TERMS */}
                            {profileTab === 'POLICIES' && (
                                <div id="section-policies" style={{ display: 'flex', flexDirection: 'column', gap: '12px', width: '100%' }}>
                                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: '12px', width: '100%' }}>
                                        <div style={{ border: '1px solid var(--border-glass)', padding: '14px 16px', borderRadius: '10px', backgroundColor: 'var(--bg-glass)', boxShadow: 'var(--shadow-sm)' }}>
                                            <h4 style={{ margin: '0 0 12px 0', fontSize: '0.88rem', fontWeight: 700, color: 'var(--text-primary)', borderLeft: '3px solid var(--accent-primary)', paddingLeft: '8px', display: 'flex', alignItems: 'center', gap: '6px' }}>
                                                📋 Company Terms & Policies
                                            </h4>
                                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
                                                <div style={{ background: 'var(--input-bg)', border: '1px solid var(--border-glass)', padding: '8px 12px', borderRadius: '6px' }}>
                                                    <span style={{ display: 'block', color: 'var(--text-muted)', fontWeight: 700, fontSize: '0.68rem', letterSpacing: '0.04em', marginBottom: '2px' }}>PROBATION POLICY</span>
                                                    <div style={{ color: 'var(--text-primary)', fontWeight: 600, fontSize: '0.84rem' }}>{viewingEmployee.probationPolicy || 'Permanent Employee'}</div>
                                                </div>
                                                <div style={{ background: 'var(--input-bg)', border: '1px solid var(--border-glass)', padding: '8px 12px', borderRadius: '6px' }}>
                                                    <span style={{ display: 'block', color: 'var(--text-muted)', fontWeight: 700, fontSize: '0.68rem', letterSpacing: '0.04em', marginBottom: '2px' }}>NOTICE PERIOD</span>
                                                    <div style={{ color: 'var(--text-primary)', fontWeight: 600, fontSize: '0.84rem' }}>{viewingEmployee.noticePeriod || '1 Month'}</div>
                                                </div>
                                                <div style={{ background: 'var(--input-bg)', border: '1px solid var(--border-glass)', padding: '8px 12px', borderRadius: '6px' }}>
                                                    <span style={{ display: 'block', color: 'var(--text-muted)', fontWeight: 700, fontSize: '0.68rem', letterSpacing: '0.04em', marginBottom: '2px' }}>ATTENDANCE SCHEME</span>
                                                    <div style={{ color: 'var(--text-primary)', fontWeight: 600, fontSize: '0.84rem' }}>
                                                        {viewingEmployee.attendanceSetting === '9-6' || viewingEmployee.attendanceSetting === '9-5:30' 
                                                            ? '9 to 5:30 Fixed Work Hours' 
                                                            : (viewingEmployee.attendanceSetting || '9 to 5:30 Fixed Work Hours')}
                                                    </div>
                                                </div>
                                                <div style={{ background: 'var(--input-bg)', border: '1px solid var(--border-glass)', padding: '8px 12px', borderRadius: '6px' }}>
                                                    <span style={{ display: 'block', color: 'var(--text-muted)', fontWeight: 700, fontSize: '0.68rem', letterSpacing: '0.04em', marginBottom: '2px' }}>WEEKLY OFFS</span>
                                                    <div style={{ color: 'var(--text-primary)', fontWeight: 600, fontSize: '0.84rem' }}>{viewingEmployee.weeklyOffs || 'Saturday, Sunday'}</div>
                                                </div>
                                            </div>
                                        </div>

                                        {/* Leave Balances Card */}
                                        <div style={{ border: '1px solid var(--border-glass)', padding: '14px 16px', borderRadius: '10px', backgroundColor: 'var(--bg-glass)', boxShadow: 'var(--shadow-sm)' }}>
                                            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '12px' }}>
                                                <h4 style={{ margin: 0, fontSize: '0.88rem', fontWeight: 700, color: 'var(--text-primary)', borderLeft: '3px solid #10b981', paddingLeft: '8px', display: 'flex', alignItems: 'center', gap: '6px' }}>
                                                    🏖️ Earned Leave Balance & Quotas
                                                </h4>
                                                <button
                                                    type="button"
                                                    onClick={() => {
                                                        setLeaveAdjustmentEmpId(viewingEmployee.id || viewingEmployee.empCode);
                                                        setShowLeaveAdjustmentModal(true);
                                                    }}
                                                    style={{
                                                        background: '#4f46e5',
                                                        color: '#ffffff',
                                                        border: 'none',
                                                        borderRadius: '6px',
                                                        padding: '5px 12px',
                                                        fontSize: '0.74rem',
                                                        fontWeight: 600,
                                                        cursor: 'pointer'
                                                    }}
                                                >
                                                    + Adjust Balance
                                                </button>
                                            </div>
                                            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(110px, 1fr))', gap: '8px' }}>
                                                <div style={{ background: 'var(--input-bg)', border: '1px solid var(--border-glass)', padding: '8px 12px', borderRadius: '6px', textAlign: 'center' }}>
                                                    <span style={{ display: 'block', color: 'var(--text-muted)', fontWeight: 700, fontSize: '0.65rem', textTransform: 'uppercase' }}>{viewingEmployee.leaveBalance ? `Earned since ${viewingEmployee.leaveBalance.ledgerStartMonth}` : 'Annual Quota'}</span>
                                                    <div style={{ color: 'var(--text-primary)', fontWeight: 700, fontSize: '0.95rem', marginTop: '2px' }}>{viewingEmployee.leaveBalance ? Math.round((viewingEmployee.leaveBalance.credited - viewingEmployee.leaveBalance.opening) * 100) / 100 : (viewingEmployee.allowedLeaves || 0)} d</div>
                                                </div>
                                                <div style={{ background: 'var(--input-bg)', border: '1px solid var(--border-glass)', padding: '8px 12px', borderRadius: '6px', textAlign: 'center' }}>
                                                    <span style={{ display: 'block', color: '#4f46e5', fontWeight: 700, fontSize: '0.65rem', textTransform: 'uppercase' }}>Opening / Migrated</span>
                                                    <div style={{ color: '#4f46e5', fontWeight: 700, fontSize: '0.95rem', marginTop: '2px' }}>{viewingEmployee.leaveBalance ? viewingEmployee.leaveBalance.opening : (viewingEmployee.openingLeaveBalance || viewingEmployee.earnedLeaves || 0)} d</div>
                                                </div>
                                                <div style={{ background: 'var(--input-bg)', border: '1px solid var(--border-glass)', padding: '8px 12px', borderRadius: '6px', textAlign: 'center' }}>
                                                    <span style={{ display: 'block', color: '#ef4444', fontWeight: 700, fontSize: '0.65rem', textTransform: 'uppercase' }}>Consumed</span>
                                                    <div style={{ color: '#ef4444', fontWeight: 700, fontSize: '0.95rem', marginTop: '2px' }}>{viewingEmployee.leaveBalance ? viewingEmployee.leaveBalance.consumed : (viewingEmployee.consumedLeaves || 0)} d</div>
                                                </div>
                                                <div style={{ background: '#ecfdf5', border: '1px solid #a7f3d0', padding: '8px 12px', borderRadius: '6px', textAlign: 'center' }}>
                                                    <span style={{ display: 'block', color: '#047857', fontWeight: 700, fontSize: '0.65rem', textTransform: 'uppercase' }}>Net Available</span>
                                                    <div style={{ color: '#059669', fontWeight: 800, fontSize: '1rem', marginTop: '2px' }}>
                                                        {viewingEmployee.availableLeaves !== undefined 
                                                            ? viewingEmployee.availableLeaves 
                                                            : Math.max(0, (Number(viewingEmployee.allowedLeaves || 0) + Number(viewingEmployee.openingLeaveBalance || viewingEmployee.earnedLeaves || 0)) - Number(viewingEmployee.consumedLeaves || 0))} d
                                                    </div>
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            )}

                            {/* TAB 4: FINANCES */}
                            {profileTab === 'FINANCES' && (
                                <div id="section-finances" style={{ display: 'flex', flexDirection: 'column', gap: '12px', width: '100%' }}>
                                    {financeSubTab === 'SALARY' ? (
                                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: '12px', width: '100%' }}>
                                            {/* Bank Details Card */}
                                            <div style={{ border: '1px solid var(--border-glass)', padding: '14px 16px', borderRadius: '10px', backgroundColor: 'var(--bg-glass)', boxShadow: 'var(--shadow-sm)' }}>
                                                <h4 style={{ margin: '0 0 12px 0', fontSize: '0.88rem', fontWeight: 700, color: 'var(--text-primary)', borderLeft: '3px solid var(--accent-primary)', paddingLeft: '8px', display: 'flex', alignItems: 'center', gap: '6px' }}>
                                                    🏦 Bank Information
                                                </h4>
                                                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
                                                    <div style={{ background: 'var(--input-bg)', border: '1px solid var(--border-glass)', padding: '8px 12px', borderRadius: '6px' }}>
                                                        <span style={{ display: 'block', color: 'var(--text-muted)', fontWeight: 700, fontSize: '0.68rem', letterSpacing: '0.04em', marginBottom: '2px' }}>BANK NAME</span>
                                                        <div style={{ color: 'var(--text-primary)', fontWeight: 600, fontSize: '0.84rem' }}>{viewingEmployee.bankName || 'HDFC Bank'}</div>
                                                    </div>
                                                    <div style={{ background: 'var(--input-bg)', border: '1px solid var(--border-glass)', padding: '8px 12px', borderRadius: '6px' }}>
                                                        <span style={{ display: 'block', color: 'var(--text-muted)', fontWeight: 700, fontSize: '0.68rem', letterSpacing: '0.04em', marginBottom: '2px' }}>ACCOUNT NUMBER</span>
                                                        <div style={{ color: 'var(--text-primary)', fontWeight: 600, fontSize: '0.84rem' }}>{viewingEmployee.bankAccountNo || '-'}</div>
                                                    </div>
                                                    <div style={{ background: 'var(--input-bg)', border: '1px solid var(--border-glass)', padding: '8px 12px', borderRadius: '6px' }}>
                                                        <span style={{ display: 'block', color: 'var(--text-muted)', fontWeight: 700, fontSize: '0.68rem', letterSpacing: '0.04em', marginBottom: '2px' }}>IFSC CODE</span>
                                                        <div style={{ color: 'var(--text-primary)', fontWeight: 600, fontSize: '0.84rem' }}>{viewingEmployee.bankIfscCode || '-'}</div>
                                                    </div>
                                                    <div style={{ background: 'var(--input-bg)', border: '1px solid var(--border-glass)', padding: '8px 12px', borderRadius: '6px' }}>
                                                        <span style={{ display: 'block', color: 'var(--text-muted)', fontWeight: 700, fontSize: '0.68rem', letterSpacing: '0.04em', marginBottom: '2px' }}>BRANCH</span>
                                                        <div style={{ color: 'var(--text-primary)', fontWeight: 600, fontSize: '0.84rem' }}>{viewingEmployee.bankBranchName || '-'}</div>
                                                    </div>
                                                    <div style={{ background: 'var(--input-bg)', border: '1px solid var(--border-glass)', padding: '8px 12px', borderRadius: '6px' }}>
                                                        <span style={{ display: 'block', color: 'var(--text-muted)', fontWeight: 700, fontSize: '0.68rem', letterSpacing: '0.04em', marginBottom: '2px' }}>AADHAAR CARD NUMBER</span>
                                                        <div style={{ color: 'var(--text-primary)', fontWeight: 600, fontSize: '0.84rem' }}>{viewingEmployee.aadhaarNumber || viewingEmployee.aadharNumber || viewingEmployee.customFields?.aadhaarNumber || '-'}</div>
                                                    </div>
                                                    <div style={{ background: 'var(--input-bg)', border: '1px solid var(--border-glass)', padding: '8px 12px', borderRadius: '6px' }}>
                                                        <span style={{ display: 'block', color: 'var(--text-muted)', fontWeight: 700, fontSize: '0.68rem', letterSpacing: '0.04em', marginBottom: '2px' }}>PAN CARD NUMBER</span>
                                                        <div style={{ color: 'var(--text-primary)', fontWeight: 600, fontSize: '0.84rem' }}>{viewingEmployee.panNumber || viewingEmployee.pan || '-'}</div>
                                                    </div>
                                                    <div style={{ background: 'var(--input-bg)', border: '1px solid var(--border-glass)', padding: '8px 12px', borderRadius: '6px' }}>
                                                        <span style={{ display: 'block', color: 'var(--text-muted)', fontWeight: 700, fontSize: '0.68rem', letterSpacing: '0.04em', marginBottom: '2px' }}>EPF UAN NUMBER</span>
                                                        <div style={{ color: 'var(--text-primary)', fontWeight: 600, fontSize: '0.84rem' }}>{viewingEmployee.uanNumber || viewingEmployee.pfUan || '-'}</div>
                                                    </div>
                                                    <div style={{ background: 'var(--input-bg)', border: '1px solid var(--border-glass)', padding: '8px 12px', borderRadius: '6px' }}>
                                                        <span style={{ display: 'block', color: 'var(--text-muted)', fontWeight: 700, fontSize: '0.68rem', letterSpacing: '0.04em', marginBottom: '2px' }}>PF NUMBER / MEMBER ID</span>
                                                        <div style={{ color: 'var(--text-primary)', fontWeight: 600, fontSize: '0.84rem' }}>{viewingEmployee.pfNumber || viewingEmployee.pf_number || '-'}</div>
                                                    </div>
                                                    <div style={{ background: 'var(--input-bg)', border: '1px solid var(--border-glass)', padding: '8px 12px', borderRadius: '6px' }}>
                                                        <span style={{ display: 'block', color: 'var(--text-muted)', fontWeight: 700, fontSize: '0.68rem', letterSpacing: '0.04em', marginBottom: '2px' }}>ESIC NUMBER / IP NO</span>
                                                        <div style={{ color: 'var(--text-primary)', fontWeight: 600, fontSize: '0.84rem' }}>{viewingEmployee.esiNumber || viewingEmployee.esicNumber || '-'}</div>
                                                    </div>
                                                </div>
                                            </div>

                                            {/* Finances Breakdown Card */}
                                            {(() => {
                                                const viewSalary = Number(viewingEmployee.compensationGross || viewingEmployee.salary || 0);
                                                const viewMonthlyGross = Math.round(viewSalary / 12);
                                                const viewAnnualBasic = Math.round(viewSalary * 0.5);
                                                const viewMonthlyBasic = Math.round(viewMonthlyGross * 0.5);
                                                const viewAnnualHra = Math.round(viewSalary * 0.3);
                                                const viewMonthlyHra = Math.round(viewMonthlyGross * 0.3);
                                                const viewAnnualOther = viewSalary - viewAnnualBasic - viewAnnualHra;
                                                const viewMonthlyOther = viewMonthlyGross - viewMonthlyBasic - viewMonthlyHra;

                                                const viewPfWage = viewMonthlyBasic + viewMonthlyOther;
                                                const viewDefaultMonthlyPf = viewPfWage < 15000 ? Math.round(viewPfWage * 0.12) : 1800;
                                                const viewMonthlyPf = viewingEmployee.pfEligible !== false ? (viewingEmployee.pfAmount !== '' && viewingEmployee.pfAmount !== null && !isNaN(Number(viewingEmployee.pfAmount)) ? Number(viewingEmployee.pfAmount) : viewDefaultMonthlyPf) : 0;
                                                const viewAnnualPf = viewMonthlyPf * 12;

                                                const viewMonthlyVpf = viewingEmployee.vpfEligible ? (Number(viewingEmployee.vpfAmount) || 0) : 0;
                                                const viewAnnualVpf = viewMonthlyVpf * 12;

                                                const viewMonthlyEsi = viewingEmployee.esiEligible ? Math.round(viewMonthlyGross * 0.0075) : 0;
                                                const viewAnnualEsi = viewMonthlyEsi * 12;

                                                const viewAnnualLwf = viewingEmployee.lwfEligible ? (Number(viewingEmployee.lwfAmount) >= 0 && viewingEmployee.lwfAmount !== '' && viewingEmployee.lwfAmount !== null ? Number(viewingEmployee.lwfAmount) : 60) : 0;
                                                const viewMonthlyLwf = viewingEmployee.lwfEligible ? Math.round(viewAnnualLwf / 12) : 0;

                                                const viewMonthlyPt = viewingEmployee.ptEligible !== false ? calculateClientSidePT(viewMonthlyGross, viewingEmployee.ptStateCode || 'TN', ptStatesList, viewingEmployee.ptExemption, viewingEmployee.ptAmount, viewingEmployee.gender) : 0;
                                                const viewAnnualPt = viewMonthlyPt * 12;

                                                const viewTotalDeductionsMonthly = viewMonthlyPf + viewMonthlyVpf + viewMonthlyEsi + viewMonthlyLwf + viewMonthlyPt;
                                                const viewTotalDeductionsAnnual = viewAnnualPf + viewAnnualVpf + viewAnnualEsi + viewAnnualLwf + viewAnnualPt;

                                                const viewMonthlyNet = viewMonthlyGross - viewTotalDeductionsMonthly;
                                                const viewAnnualNet = viewSalary - viewTotalDeductionsAnnual;

                                                return (
                                                    <div style={{ border: '1px solid var(--border-glass)', padding: '14px 16px', borderRadius: '10px', backgroundColor: 'var(--bg-glass)', boxShadow: 'var(--shadow-sm)' }}>
                                                        <h4 style={{ margin: '0 0 12px 0', fontSize: '0.88rem', fontWeight: 700, color: 'var(--text-primary)', borderLeft: '3px solid var(--accent-primary)', paddingLeft: '8px', display: 'flex', alignItems: 'center', gap: '6px' }}>
                                                            💵 Compensation & CTC Breakdown
                                                        </h4>
                                                        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.8rem', textAlign: 'left' }}>
                                                            <thead>
                                                                <tr style={{ backgroundColor: 'var(--table-header)', borderBottom: '1px solid var(--border-glass)' }}>
                                                                    <th style={{ padding: '8px 10px', fontWeight: 600, color: 'var(--text-muted)' }}>DETAILS</th>
                                                                    <th style={{ padding: '8px 10px', fontWeight: 600, color: 'var(--text-muted)', textAlign: 'right' }}>MONTHLY</th>
                                                                    <th style={{ padding: '8px 10px', fontWeight: 600, color: 'var(--text-muted)', textAlign: 'right' }}>ANNUALLY</th>
                                                                </tr>
                                                            </thead>
                                                            <tbody>
                                                                <tr style={{ borderBottom: '1px solid var(--border-glass)' }}>
                                                                    <td style={{ padding: '6px 10px', color: 'var(--text-primary)', fontWeight: 500 }}>Basic Salary</td>
                                                                    <td style={{ padding: '6px 10px', textAlign: 'right', color: 'var(--text-primary)' }}>INR {formatCurrency(viewMonthlyBasic)}</td>
                                                                    <td style={{ padding: '6px 10px', textAlign: 'right', color: 'var(--text-primary)' }}>INR {formatCurrency(viewAnnualBasic)}</td>
                                                                </tr>
                                                                <tr style={{ borderBottom: '1px solid var(--border-glass)' }}>
                                                                    <td style={{ padding: '6px 10px', color: 'var(--text-primary)', fontWeight: 500 }}>HRA Allowance</td>
                                                                    <td style={{ padding: '6px 10px', textAlign: 'right', color: 'var(--text-primary)' }}>INR {formatCurrency(viewMonthlyHra)}</td>
                                                                    <td style={{ padding: '6px 10px', textAlign: 'right', color: 'var(--text-primary)' }}>INR {formatCurrency(viewAnnualHra)}</td>
                                                                </tr>
                                                                <tr style={{ borderBottom: '1px solid var(--border-glass)' }}>
                                                                    <td style={{ padding: '6px 10px', color: 'var(--text-primary)', fontWeight: 500 }}>Other Allowance</td>
                                                                    <td style={{ padding: '6px 10px', textAlign: 'right', color: 'var(--text-primary)' }}>INR {formatCurrency(viewMonthlyOther)}</td>
                                                                    <td style={{ padding: '6px 10px', textAlign: 'right', color: 'var(--text-primary)' }}>INR {formatCurrency(viewAnnualOther)}</td>
                                                                </tr>
                                                                <tr style={{ borderBottom: '1px solid var(--border-glass)', backgroundColor: 'rgba(79, 70, 229, 0.12)', fontWeight: 700 }}>
                                                                    <td style={{ padding: '8px 10px', color: 'var(--accent-primary)' }}>TOTAL GROSS</td>
                                                                    <td style={{ padding: '8px 10px', textAlign: 'right', color: 'var(--accent-primary)' }}>INR {formatCurrency(viewMonthlyGross)}</td>
                                                                    <td style={{ padding: '8px 10px', textAlign: 'right', color: 'var(--accent-primary)' }}>INR {formatCurrency(viewSalary)}</td>
                                                                </tr>

                                                                {/* Deductions Header */}
                                                                <tr style={{ backgroundColor: 'var(--table-header)', borderBottom: '1px solid var(--border-glass)' }}>
                                                                    <td colSpan="3" style={{ padding: '6px 10px', fontWeight: 700, color: 'var(--text-muted)', fontSize: '0.72rem', letterSpacing: '0.04em' }}>STATUTORY DEDUCTIONS</td>
                                                                </tr>
                                                                <tr style={{ borderBottom: '1px solid var(--border-glass)' }}>
                                                                    <td style={{ padding: '6px 10px', color: 'var(--text-primary)' }}>PF Employee</td>
                                                                    <td style={{ padding: '6px 10px', textAlign: 'right', color: 'var(--text-primary)' }}>{viewMonthlyPf > 0 ? `INR ${formatCurrency(viewMonthlyPf)}` : '-'}</td>
                                                                    <td style={{ padding: '6px 10px', textAlign: 'right', color: 'var(--text-primary)' }}>{viewAnnualPf > 0 ? `INR ${formatCurrency(viewAnnualPf)}` : '-'}</td>
                                                                </tr>
                                                                {viewingEmployee.vpfEligible && viewMonthlyVpf > 0 && (
                                                                    <tr style={{ borderBottom: '1px solid var(--border-glass)', backgroundColor: 'rgba(79, 70, 229, 0.08)' }}>
                                                                        <td style={{ padding: '6px 10px', color: 'var(--accent-primary)', fontWeight: 500 }}>VPF Employee</td>
                                                                        <td style={{ padding: '6px 10px', textAlign: 'right', color: 'var(--accent-primary)', fontWeight: 600 }}>INR {formatCurrency(viewMonthlyVpf)}</td>
                                                                        <td style={{ padding: '6px 10px', textAlign: 'right', color: 'var(--accent-primary)', fontWeight: 600 }}>INR {formatCurrency(viewAnnualVpf)}</td>
                                                                    </tr>
                                                                )}
                                                                <tr style={{ borderBottom: '1px solid var(--border-glass)' }}>
                                                                    <td style={{ padding: '6px 10px', color: 'var(--text-primary)' }}>ESI Employee</td>
                                                                    <td style={{ padding: '6px 10px', textAlign: 'right', color: 'var(--text-primary)' }}>{viewMonthlyEsi > 0 ? `INR ${formatCurrency(viewMonthlyEsi)}` : '-'}</td>
                                                                    <td style={{ padding: '6px 10px', textAlign: 'right', color: 'var(--text-primary)' }}>{viewAnnualEsi > 0 ? `INR ${formatCurrency(viewAnnualEsi)}` : '-'}</td>
                                                                </tr>
                                                                {viewingEmployee.lwfEligible && (
                                                                    <tr style={{ borderBottom: '1px solid var(--border-glass)' }}>
                                                                        <td style={{ padding: '6px 10px', color: 'var(--text-primary)' }}>LWF Employee</td>
                                                                        <td style={{ padding: '6px 10px', textAlign: 'right', color: 'var(--text-primary)' }}>INR {formatCurrency(viewMonthlyLwf)}</td>
                                                                        <td style={{ padding: '6px 10px', textAlign: 'right', color: 'var(--text-primary)' }}>INR {formatCurrency(viewAnnualLwf)}</td>
                                                                    </tr>
                                                                )}
                                                                {viewingEmployee.ptEligible !== false && (
                                                                    <tr style={{ borderBottom: '1px solid var(--border-glass)' }}>
                                                                        <td style={{ padding: '6px 10px', color: 'var(--text-primary)' }}>
                                                                            Professional Tax ({viewingEmployee.ptStateCode || 'TN'})
                                                                        </td>
                                                                        <td style={{ padding: '6px 10px', textAlign: 'right', color: 'var(--text-primary)' }}>INR {formatCurrency(viewMonthlyPt)}</td>
                                                                        <td style={{ padding: '6px 10px', textAlign: 'right', color: 'var(--text-primary)' }}>INR {formatCurrency(viewAnnualPt)}</td>
                                                                    </tr>
                                                                )}
                                                                <tr style={{ backgroundColor: 'rgba(16, 185, 129, 0.12)', fontWeight: 700, borderTop: '1px solid rgba(16, 185, 129, 0.25)' }}>
                                                                    <td style={{ padding: '9px 10px', color: 'var(--success)' }}>NET PAY</td>
                                                                    <td style={{ padding: '9px 10px', textAlign: 'right', color: 'var(--success)' }}>INR {formatCurrency(viewMonthlyNet)}</td>
                                                                    <td style={{ padding: '9px 10px', textAlign: 'right', color: 'var(--success)' }}>INR {formatCurrency(viewAnnualNet)}</td>
                                                                </tr>
                                                            </tbody>
                                                        </table>
                                                    </div>
                                                );
                                            })()}
                                        </div>
                                    ) : (
                                        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px', width: '100%' }}>
                                            {/* Header Bar */}
                                            <div style={{
                                                display: 'flex',
                                                justifyContent: 'space-between',
                                                alignItems: 'center',
                                                padding: '12px 16px',
                                                borderRadius: '10px',
                                                backgroundColor: 'var(--bg-glass)',
                                                border: '1px solid var(--border-glass)',
                                                boxShadow: 'var(--shadow-sm)',
                                                flexWrap: 'wrap',
                                                gap: '12px'
                                            }}>
                                                <div>
                                                    <h4 style={{ margin: 0, fontSize: '0.95rem', fontWeight: 700, color: 'var(--text-primary)', display: 'flex', alignItems: 'center', gap: '8px' }}>
                                                        📈 Salary Revision & Increment History
                                                    </h4>
                                                    <p style={{ margin: '4px 0 0 0', fontSize: '0.78rem', color: 'var(--text-muted)' }}>
                                                        Complete audit trail of compensation adjustments, promotions, and appraisal milestones.
                                                    </p>
                                                </div>
                                                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                                    <button
                                                        type="button"
                                                        onClick={() => fetchSalaryHistory(viewingEmployee.id)}
                                                        disabled={loadingSalaryHistory}
                                                        style={{
                                                            display: 'inline-flex',
                                                            alignItems: 'center',
                                                            gap: '6px',
                                                            padding: '6px 12px',
                                                            fontSize: '0.78rem',
                                                            fontWeight: 600,
                                                            borderRadius: '6px',
                                                            border: '1px solid var(--border-glass)',
                                                            backgroundColor: 'var(--input-bg)',
                                                            color: 'var(--text-primary)',
                                                            cursor: loadingSalaryHistory ? 'not-allowed' : 'pointer'
                                                        }}
                                                    >
                                                        <span style={{ display: 'inline-block', transform: loadingSalaryHistory ? 'rotate(180deg)' : 'none', transition: 'transform 0.5s' }}>🔄</span>
                                                        {loadingSalaryHistory ? 'Refreshing...' : 'Refresh History'}
                                                    </button>
                                                </div>
                                            </div>

                                            {loadingSalaryHistory ? (
                                                <div style={{ padding: '36px', textAlign: 'center', backgroundColor: 'var(--bg-glass)', borderRadius: '10px', border: '1px solid var(--border-glass)' }}>
                                                    <div style={{ fontSize: '1.2rem', marginBottom: '8px' }}>⏳</div>
                                                    <div style={{ fontSize: '0.85rem', color: 'var(--text-muted)', fontWeight: 500 }}>Loading salary revision history...</div>
                                                </div>
                                            ) : (() => {
                                                const summary = salaryHistoryData?.summary;
                                                const history = salaryHistoryData?.history || [];
                                                const empCompensation = Number(viewingEmployee.compensationGross || viewingEmployee.salary || 0);
                                                const currentCtcVal = summary?.currentCtc || empCompensation;
                                                const initialCtcVal = summary?.initialCtc || currentCtcVal;
                                                const growthAmt = summary?.totalGrowthAmount !== undefined ? summary.totalGrowthAmount : (currentCtcVal - initialCtcVal);
                                                const growthPct = summary?.totalGrowthPercent !== undefined ? summary.totalGrowthPercent : (initialCtcVal > 0 ? Number(((growthAmt / initialCtcVal) * 100).toFixed(2)) : 0);

                                                const todayStr = new Date().toISOString().split('T')[0];

                                                return (
                                                    <>
                                                        {/* Upcoming Revision Scheduled Callout Banner */}
                                                        {summary?.hasUpcomingRevision && summary?.upcomingRevision && (
                                                            <div style={{
                                                                padding: '14px 18px',
                                                                borderRadius: '10px',
                                                                backgroundColor: 'rgba(59, 130, 246, 0.07)',
                                                                border: '1.5px solid rgba(59, 130, 246, 0.35)',
                                                                display: 'flex',
                                                                alignItems: 'center',
                                                                justifyContent: 'space-between',
                                                                flexWrap: 'wrap',
                                                                gap: '12px',
                                                                boxShadow: 'var(--shadow-sm)'
                                                            }}>
                                                                <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                                                                    <span style={{ fontSize: '1.6rem' }}>📅</span>
                                                                    <div>
                                                                        <div style={{ fontWeight: 800, fontSize: '0.92rem', color: '#1e40af', display: 'flex', alignItems: 'center', gap: '8px' }}>
                                                                            <span>Upcoming Salary Revision Scheduled for Next Month</span>
                                                                            <span style={{ fontSize: '0.68rem', fontWeight: 700, padding: '2px 8px', borderRadius: '10px', backgroundColor: '#3b82f6', color: '#ffffff' }}>
                                                                                EFFECTIVE {summary.upcomingRevision.effectiveDate}
                                                                            </span>
                                                                        </div>
                                                                        <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)', marginTop: '3px' }}>
                                                                            Annual CTC will revise to <strong style={{ color: 'var(--text-primary)' }}>INR {formatCurrency(summary.upcomingRevision.newCtc)}</strong> ({summary.upcomingRevision.diffAmount >= 0 ? `+INR ${formatCurrency(summary.upcomingRevision.diffAmount)}` : `-INR ${formatCurrency(Math.abs(summary.upcomingRevision.diffAmount))}`} / {summary.upcomingRevision.diffPercent >= 0 ? `+${summary.upcomingRevision.diffPercent}%` : `${summary.upcomingRevision.diffPercent}%`}) for <em>{summary.upcomingRevision.reason}</em>.
                                                                        </div>
                                                                    </div>
                                                                </div>
                                                                <div style={{ fontSize: '0.74rem', color: '#1e40af', fontWeight: 600, background: '#ffffff', padding: '6px 12px', borderRadius: '6px', border: '1px solid rgba(59, 130, 246, 0.25)' }}>
                                                                    Current month payroll locked at INR {formatCurrency(currentCtcVal)}
                                                                </div>
                                                            </div>
                                                        )}

                                                        {/* Executive KPI Summary Row */}
                                                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '12px' }}>
                                                            <div style={{ padding: '12px 14px', borderRadius: '10px', backgroundColor: 'var(--bg-glass)', border: '1px solid var(--border-glass)', boxShadow: 'var(--shadow-sm)' }}>
                                                                <span style={{ fontSize: '0.68rem', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>Current Active Annual CTC</span>
                                                                <div style={{ fontSize: '1.15rem', fontWeight: 800, color: 'var(--accent-primary)', marginTop: '4px' }}>
                                                                    INR {formatCurrency(currentCtcVal)}
                                                                </div>
                                                                <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>Monthly Gross: INR {formatCurrency(Math.round(currentCtcVal / 12))}</span>
                                                            </div>

                                                            <div style={{ padding: '12px 14px', borderRadius: '10px', backgroundColor: 'var(--bg-glass)', border: '1px solid var(--border-glass)', boxShadow: 'var(--shadow-sm)' }}>
                                                                <span style={{ fontSize: '0.68rem', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>Starting / Initial CTC</span>
                                                                <div style={{ fontSize: '1.15rem', fontWeight: 800, color: 'var(--text-primary)', marginTop: '4px' }}>
                                                                    INR {formatCurrency(initialCtcVal)}
                                                                </div>
                                                                <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>Effective from joining</span>
                                                            </div>

                                                            <div style={{ padding: '12px 14px', borderRadius: '10px', backgroundColor: 'var(--bg-glass)', border: '1px solid var(--border-glass)', boxShadow: 'var(--shadow-sm)' }}>
                                                                <span style={{ fontSize: '0.68rem', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>Career Growth</span>
                                                                <div style={{
                                                                    fontSize: '1.15rem',
                                                                    fontWeight: 800,
                                                                    color: growthAmt > 0 ? '#10b981' : growthAmt < 0 ? '#ef4444' : 'var(--text-primary)',
                                                                    marginTop: '4px',
                                                                    display: 'flex',
                                                                    alignItems: 'center',
                                                                    gap: '6px'
                                                                }}>
                                                                    {growthAmt >= 0 ? `+INR ${formatCurrency(growthAmt)}` : `-INR ${formatCurrency(Math.abs(growthAmt))}`}
                                                                    <span style={{
                                                                        fontSize: '0.72rem',
                                                                        fontWeight: 700,
                                                                        padding: '2px 6px',
                                                                        borderRadius: '12px',
                                                                        backgroundColor: growthAmt >= 0 ? 'rgba(16, 185, 129, 0.15)' : 'rgba(239, 68, 68, 0.15)',
                                                                        color: growthAmt >= 0 ? '#10b981' : '#ef4444'
                                                                    }}>
                                                                        {growthAmt >= 0 ? `+${growthPct}%` : `${growthPct}%`}
                                                                    </span>
                                                                </div>
                                                                <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>Cumulative increment delta</span>
                                                            </div>

                                                            <div style={{ padding: '12px 14px', borderRadius: '10px', backgroundColor: 'var(--bg-glass)', border: '1px solid var(--border-glass)', boxShadow: 'var(--shadow-sm)' }}>
                                                                <span style={{ fontSize: '0.68rem', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>Total Revisions</span>
                                                                <div style={{ fontSize: '1.15rem', fontWeight: 800, color: 'var(--text-primary)', marginTop: '4px' }}>
                                                                    {history.length > 0 ? history.length : (summary?.totalRevisions || 1)}
                                                                </div>
                                                                <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>
                                                                    {summary?.lastRevisionDate ? `Last: ${summary.lastRevisionDate}` : `Since ${viewingEmployee.joiningDate || 'Joining'}`}
                                                                </span>
                                                            </div>
                                                        </div>

                                                        {/* Timeline & Revisions Breakdown */}
                                                        {history.length === 0 ? (
                                                            <div style={{ border: '1px solid var(--border-glass)', padding: '24px', borderRadius: '10px', backgroundColor: 'var(--bg-glass)', textAlign: 'center' }}>
                                                                <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)', margin: 0 }}>
                                                                    No historical revisions recorded yet. When this employee's salary is revised via Edit Employee, versions and increment percentages will appear here automatically.
                                                                </p>
                                                            </div>
                                                        ) : (
                                                            <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                                                                {/* Version cards timeline */}
                                                                <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                                                                    {[...history].reverse().map((rev, idx) => {
                                                                        const isScheduled = rev.isScheduled || rev.status === 'SCHEDULED' || (rev.effectiveFrom && rev.effectiveFrom > todayStr);
                                                                        const isActive = !isScheduled && (rev.isCurrentActive || rev.status === 'ACTIVE');
                                                                        const isSuperseded = !isScheduled && !isActive;

                                                                        const annualCtcVal = Number(rev.annualCtc || rev.ctc || rev.grossSalary || 0);
                                                                        const monthlyGrossVal = Number(rev.monthlyGross || Math.round(annualCtcVal / 12) || 0);
                                                                        const incAmt = rev.diffAmount !== undefined ? Number(rev.diffAmount) : Number(rev.incrementAmount || 0);
                                                                        const incPct = rev.diffPercent !== undefined ? Number(rev.diffPercent) : Number(rev.incrementPercentage || 0);
                                                                        const hasIncrement = incAmt !== 0;
                                                                        const isPositive = incAmt >= 0;
                                                                        const basicVal = Math.round(annualCtcVal * 0.5);
                                                                        const hraVal = Math.round(annualCtcVal * 0.3);
                                                                        const otherVal = Math.max(0, annualCtcVal - basicVal - hraVal);

                                                                        return (
                                                                            <div
                                                                                key={rev.id || idx}
                                                                                style={{
                                                                                    border: isScheduled ? '1.5px dashed #3b82f6' : isActive ? '1.5px solid var(--accent-primary)' : '1px solid var(--border-glass)',
                                                                                    borderRadius: '10px',
                                                                                    padding: '14px 18px',
                                                                                    backgroundColor: isScheduled ? 'rgba(59, 130, 246, 0.04)' : isActive ? 'rgba(99, 102, 241, 0.04)' : 'var(--bg-glass)',
                                                                                    boxShadow: 'var(--shadow-sm)',
                                                                                    position: 'relative'
                                                                                }}
                                                                            >
                                                                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '10px', marginBottom: '10px' }}>
                                                                                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
                                                                                        <span style={{
                                                                                            padding: '3px 8px',
                                                                                            borderRadius: '6px',
                                                                                            fontSize: '0.75rem',
                                                                                            fontWeight: 700,
                                                                                            backgroundColor: isScheduled ? '#3b82f6' : isActive ? 'var(--accent-primary)' : 'var(--input-bg)',
                                                                                            color: (isScheduled || isActive) ? '#ffffff' : 'var(--text-muted)',
                                                                                            border: (isScheduled || isActive) ? 'none' : '1px solid var(--border-glass)'
                                                                                        }}>
                                                                                            {rev.revisionLabel || `Revision ${rev.version}`}
                                                                                        </span>
                                                                                        <span style={{
                                                                                            padding: '2px 8px',
                                                                                            borderRadius: '12px',
                                                                                            fontSize: '0.7rem',
                                                                                            fontWeight: 700,
                                                                                            backgroundColor: isScheduled ? 'rgba(59, 130, 246, 0.15)' : isActive ? 'rgba(16, 185, 129, 0.15)' : 'rgba(156, 163, 175, 0.15)',
                                                                                            color: isScheduled ? '#2563eb' : isActive ? '#10b981' : 'var(--text-muted)'
                                                                                        }}>
                                                                                            {isScheduled ? `📅 SCHEDULED (EFFECTIVE ${rev.effectiveFrom})` : isActive ? '● CURRENT ACTIVE' : 'SUPERSEDED'}
                                                                                        </span>
                                                                                        <span style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--text-primary)' }}>
                                                                                            {rev.revisionReason || (idx === history.length - 1 ? 'Initial Joining Salary' : 'Salary Revision')}
                                                                                        </span>
                                                                                    </div>

                                                                                    <div style={{ fontSize: '0.76rem', color: 'var(--text-muted)' }}>
                                                                                        Effective: <strong style={{ color: 'var(--text-primary)' }}>{rev.effectiveFrom || '-'}</strong>
                                                                                        {rev.effectiveTo ? (
                                                                                            <> to <strong style={{ color: 'var(--text-primary)' }}>{rev.effectiveTo}</strong></>
                                                                                        ) : isScheduled ? (
                                                                                            <span style={{ color: '#2563eb', fontWeight: 600 }}> (Upcoming Next Month)</span>
                                                                                        ) : (
                                                                                            <span style={{ color: '#10b981', fontWeight: 600 }}> (Present)</span>
                                                                                        )}
                                                                                    </div>
                                                                                </div>

                                                                                {/* Metrics Row */}
                                                                                <div style={{
                                                                                    display: 'grid',
                                                                                    gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))',
                                                                                    gap: '8px',
                                                                                    background: 'var(--input-bg)',
                                                                                    border: '1px solid var(--border-glass)',
                                                                                    padding: '10px 14px',
                                                                                    borderRadius: '8px',
                                                                                    marginBottom: '10px'
                                                                                }}>
                                                                                    <div>
                                                                                        <div style={{ fontSize: '0.68rem', color: 'var(--text-muted)', fontWeight: 600 }}>ANNUAL CTC</div>
                                                                                        <div style={{ fontSize: '0.95rem', fontWeight: 700, color: 'var(--text-primary)' }}>
                                                                                            INR {formatCurrency(annualCtcVal)}
                                                                                        </div>
                                                                                    </div>
                                                                                    <div>
                                                                                        <div style={{ fontSize: '0.68rem', color: 'var(--text-muted)', fontWeight: 600 }}>MONTHLY GROSS</div>
                                                                                        <div style={{ fontSize: '0.95rem', fontWeight: 700, color: 'var(--text-primary)' }}>
                                                                                            INR {formatCurrency(monthlyGrossVal)}
                                                                                        </div>
                                                                                    </div>
                                                                                    <div>
                                                                                        <div style={{ fontSize: '0.68rem', color: 'var(--text-muted)', fontWeight: 600 }}>INCREMENT (₹)</div>
                                                                                        <div style={{
                                                                                            fontSize: '0.95rem',
                                                                                            fontWeight: 700,
                                                                                            color: hasIncrement ? (isPositive ? '#10b981' : '#ef4444') : 'var(--text-muted)'
                                                                                        }}>
                                                                                            {hasIncrement ? (isPositive ? `+INR ${formatCurrency(incAmt)}` : `-INR ${formatCurrency(Math.abs(incAmt))}`) : '—'}
                                                                                        </div>
                                                                                    </div>
                                                                                    <div>
                                                                                        <div style={{ fontSize: '0.68rem', color: 'var(--text-muted)', fontWeight: 600 }}>INCREMENT (%)</div>
                                                                                        <div style={{
                                                                                            fontSize: '0.95rem',
                                                                                            fontWeight: 700,
                                                                                            color: hasIncrement ? (isPositive ? '#10b981' : '#ef4444') : 'var(--text-muted)'
                                                                                        }}>
                                                                                            {hasIncrement ? (isPositive ? `+${incPct}%` : `${incPct}%`) : '—'}
                                                                                        </div>
                                                                                    </div>
                                                                                </div>

                                                                                {/* Components Breakdown pill row */}
                                                                                <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', fontSize: '0.73rem', color: 'var(--text-muted)' }}>
                                                                                    <span style={{ padding: '3px 8px', borderRadius: '4px', background: 'var(--bg-glass)', border: '1px solid var(--border-glass)' }}>
                                                                                        Basic: <strong style={{ color: 'var(--text-primary)' }}>INR {formatCurrency(basicVal)}</strong>
                                                                                    </span>
                                                                                    <span style={{ padding: '3px 8px', borderRadius: '4px', background: 'var(--bg-glass)', border: '1px solid var(--border-glass)' }}>
                                                                                        HRA: <strong style={{ color: 'var(--text-primary)' }}>INR {formatCurrency(hraVal)}</strong>
                                                                                    </span>
                                                                                    <span style={{ padding: '3px 8px', borderRadius: '4px', background: 'var(--bg-glass)', border: '1px solid var(--border-glass)' }}>
                                                                                        Allowances: <strong style={{ color: 'var(--text-primary)' }}>INR {formatCurrency(otherVal)}</strong>
                                                                                    </span>
                                                                                </div>
                                                                            </div>
                                                                        );
                                                                    })}
                                                                </div>

                                                                {/* Comparison Table */}
                                                                <div style={{ border: '1px solid var(--border-glass)', borderRadius: '10px', backgroundColor: 'var(--bg-glass)', overflow: 'hidden' }}>
                                                                    <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--border-glass)', fontWeight: 700, fontSize: '0.85rem', color: 'var(--text-primary)' }}>
                                                                        📊 Detailed Revision Audit Log
                                                                    </div>
                                                                    <div style={{ overflowX: 'auto' }}>
                                                                        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.78rem', textAlign: 'left' }}>
                                                                            <thead>
                                                                                <tr style={{ backgroundColor: 'var(--table-header)', borderBottom: '1px solid var(--border-glass)' }}>
                                                                                    <th style={{ padding: '8px 12px', fontWeight: 600, color: 'var(--text-muted)' }}>VERSION</th>
                                                                                    <th style={{ padding: '8px 12px', fontWeight: 600, color: 'var(--text-muted)' }}>EFFECTIVE FROM</th>
                                                                                    <th style={{ padding: '8px 12px', fontWeight: 600, color: 'var(--text-muted)' }}>EFFECTIVE TO</th>
                                                                                    <th style={{ padding: '8px 12px', fontWeight: 600, color: 'var(--text-muted)' }}>REASON / EVENT</th>
                                                                                    <th style={{ padding: '8px 12px', fontWeight: 600, color: 'var(--text-muted)', textAlign: 'right' }}>ANNUAL CTC</th>
                                                                                    <th style={{ padding: '8px 12px', fontWeight: 600, color: 'var(--text-muted)', textAlign: 'right' }}>MONTHLY</th>
                                                                                    <th style={{ padding: '8px 12px', fontWeight: 600, color: 'var(--text-muted)', textAlign: 'right' }}>CHANGE (₹)</th>
                                                                                    <th style={{ padding: '8px 12px', fontWeight: 600, color: 'var(--text-muted)', textAlign: 'right' }}>CHANGE (%)</th>
                                                                                    <th style={{ padding: '8px 12px', fontWeight: 600, color: 'var(--text-muted)', textAlign: 'center' }}>STATUS</th>
                                                                                </tr>
                                                                            </thead>
                                                                            <tbody>
                                                                                {history.map((rev, idx) => {
                                                                                    const isScheduled = rev.isScheduled || rev.status === 'SCHEDULED' || (rev.effectiveFrom && rev.effectiveFrom > todayStr);
                                                                                    const isActive = !isScheduled && (rev.isCurrentActive || rev.status === 'ACTIVE');
                                                                                    const isSuperseded = !isScheduled && !isActive;

                                                                                    const annualCtcVal = Number(rev.annualCtc || rev.ctc || rev.grossSalary || 0);
                                                                                    const monthlyGrossVal = Number(rev.monthlyGross || Math.round(annualCtcVal / 12) || 0);
                                                                                    const incAmt = rev.diffAmount !== undefined ? Number(rev.diffAmount) : Number(rev.incrementAmount || 0);
                                                                                    const incPct = rev.diffPercent !== undefined ? Number(rev.diffPercent) : Number(rev.incrementPercentage || 0);
                                                                                    const hasIncrement = incAmt !== 0;
                                                                                    const isPositive = incAmt >= 0;
                                                                                    return (
                                                                                        <tr key={rev.id || idx} style={{ borderBottom: '1px solid var(--border-glass)' }}>
                                                                                            <td style={{ padding: '8px 12px', fontWeight: 600, color: 'var(--text-primary)' }}>
                                                                                                {rev.versionLabel || `v${rev.version}`}
                                                                                            </td>
                                                                                            <td style={{ padding: '8px 12px', color: 'var(--text-primary)' }}>{rev.effectiveFrom || '-'}</td>
                                                                                            <td style={{ padding: '8px 12px', color: 'var(--text-muted)' }}>{rev.effectiveTo || (isScheduled ? 'Future' : 'Present')}</td>
                                                                                            <td style={{ padding: '8px 12px', color: 'var(--text-primary)' }}>{rev.revisionReason || '-'}</td>
                                                                                            <td style={{ padding: '8px 12px', textAlign: 'right', fontWeight: 600, color: 'var(--text-primary)' }}>
                                                                                                INR {formatCurrency(annualCtcVal)}
                                                                                            </td>
                                                                                            <td style={{ padding: '8px 12px', textAlign: 'right', color: 'var(--text-primary)' }}>
                                                                                                INR {formatCurrency(monthlyGrossVal)}
                                                                                            </td>
                                                                                            <td style={{
                                                                                                padding: '8px 12px',
                                                                                                textAlign: 'right',
                                                                                                fontWeight: 600,
                                                                                                color: hasIncrement ? (isPositive ? '#10b981' : '#ef4444') : 'var(--text-muted)'
                                                                                            }}>
                                                                                                {hasIncrement ? (isPositive ? `+INR ${formatCurrency(incAmt)}` : `-INR ${formatCurrency(Math.abs(incAmt))}`) : '-'}
                                                                                            </td>
                                                                                            <td style={{
                                                                                                padding: '8px 12px',
                                                                                                textAlign: 'right',
                                                                                                fontWeight: 600,
                                                                                                color: hasIncrement ? (isPositive ? '#10b981' : '#ef4444') : 'var(--text-muted)'
                                                                                            }}>
                                                                                                {hasIncrement ? (isPositive ? `+${incPct}%` : `${incPct}%`) : '-'}
                                                                                            </td>
                                                                                            <td style={{ padding: '8px 12px', textAlign: 'center' }}>
                                                                                                <span style={{
                                                                                                    display: 'inline-block',
                                                                                                    padding: '2px 8px',
                                                                                                    borderRadius: '10px',
                                                                                                    fontSize: '0.68rem',
                                                                                                    fontWeight: 700,
                                                                                                    backgroundColor: isScheduled ? 'rgba(59, 130, 246, 0.15)' : isActive ? 'rgba(16, 185, 129, 0.15)' : 'rgba(156, 163, 175, 0.15)',
                                                                                                    color: isScheduled ? '#2563eb' : isActive ? '#10b981' : 'var(--text-muted)'
                                                                                                }}>
                                                                                                    {isScheduled ? 'Scheduled' : isActive ? 'Active' : 'Superseded'}
                                                                                                </span>
                                                                                            </td>
                                                                                        </tr>
                                                                                    );
                                                                                })}
                                                                            </tbody>
                                                                        </table>
                                                                    </div>
                                                                </div>
                                                            </div>
                                                        )}
                                                    </>
                                                );
                                            })()}
                                        </div>
                                    )}
                                </div>
                            )}

                            {/* TAB 5: DOCUMENTS */}
                            {profileTab === 'DOCUMENTS' && (() => {
                                const employeeName = viewingEmployee?.name || 'Employee';
                                const empShortName = employeeName.split(' ')[0];
                                
                                const empUploadedDocs = employeeDocuments.filter(doc => {
                                    const isIssuedByAdmin = String(doc.uploaderId || '').toLowerCase() === 'admin' || (doc.targetUserId && (doc.targetUserId === viewingEmployee.id || doc.targetUserId === viewingEmployee.empCode));
                                    return !isIssuedByAdmin;
                                });

                                const adminIssuedDocs = employeeDocuments.filter(doc => {
                                    const isIssuedByAdmin = String(doc.uploaderId || '').toLowerCase() === 'admin' || (doc.targetUserId && (doc.targetUserId === viewingEmployee.id || doc.targetUserId === viewingEmployee.empCode));
                                    return isIssuedByAdmin;
                                });

                                const displayedDocs = docFilterTab === 'EMPLOYEE' 
                                    ? empUploadedDocs 
                                    : docFilterTab === 'ADMIN' 
                                        ? adminIssuedDocs 
                                        : employeeDocuments;

                                return (
                                    <div id="section-documents" style={{ display: 'flex', flexDirection: 'column', gap: '20px', width: '100%' }}>
                                        <div style={{ border: '1px solid var(--border-glass)', padding: '24px', borderRadius: '12px', backgroundColor: 'var(--bg-glass)', boxShadow: 'var(--shadow-sm)' }}>
                                            
                                            {/* Two Primary Document Option Buttons */}
                                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '16px', marginBottom: '24px', borderBottom: '1px solid var(--border-glass)', paddingBottom: '16px' }}>
                                                
                                                {/* Left Option Tabs */}
                                                <div style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
                                                    <button
                                                        type="button"
                                                        onClick={() => setDocFilterTab('EMPLOYEE')}
                                                        style={{
                                                            display: 'inline-flex',
                                                            alignItems: 'center',
                                                            gap: '8px',
                                                            padding: '10px 20px',
                                                            borderRadius: '8px',
                                                            border: docFilterTab === 'EMPLOYEE' ? '2px solid var(--accent-primary)' : '1px solid var(--border-glass)',
                                                            fontSize: '0.9rem',
                                                            fontWeight: 700,
                                                            cursor: 'pointer',
                                                            background: docFilterTab === 'EMPLOYEE' ? 'var(--accent-primary)' : 'var(--input-bg)',
                                                            color: docFilterTab === 'EMPLOYEE' ? '#ffffff' : 'var(--text-muted)',
                                                            boxShadow: docFilterTab === 'EMPLOYEE' ? '0 2px 8px rgba(79, 70, 229, 0.35)' : 'none',
                                                            transition: 'all 0.15s ease'
                                                        }}
                                                    >
                                                        <span style={{ fontSize: '1.1rem' }}>📤</span>
                                                        <span>Uploaded by Employee</span>
                                                        <span style={{ 
                                                            padding: '2px 8px', 
                                                            borderRadius: '12px', 
                                                            fontSize: '0.75rem', 
                                                            fontWeight: 800,
                                                            background: docFilterTab === 'EMPLOYEE' ? 'rgba(255,255,255,0.2)' : 'rgba(0,0,0,0.06)',
                                                            color: docFilterTab === 'EMPLOYEE' ? '#ffffff' : 'var(--text-primary)'
                                                        }}>
                                                            {empUploadedDocs.length}
                                                        </span>
                                                    </button>

                                                    <button
                                                        type="button"
                                                        onClick={() => setDocFilterTab('ADMIN')}
                                                        style={{
                                                            display: 'inline-flex',
                                                            alignItems: 'center',
                                                            gap: '8px',
                                                            padding: '10px 20px',
                                                            borderRadius: '8px',
                                                            border: docFilterTab === 'ADMIN' ? '2px solid var(--accent-primary)' : '1px solid var(--border-glass)',
                                                            fontSize: '0.9rem',
                                                            fontWeight: 700,
                                                            cursor: 'pointer',
                                                            background: docFilterTab === 'ADMIN' ? 'var(--accent-primary)' : 'var(--input-bg)',
                                                            color: docFilterTab === 'ADMIN' ? '#ffffff' : 'var(--text-muted)',
                                                            boxShadow: docFilterTab === 'ADMIN' ? '0 2px 8px rgba(79, 70, 229, 0.35)' : 'none',
                                                            transition: 'all 0.15s ease'
                                                        }}
                                                    >
                                                        <span style={{ fontSize: '1.1rem' }}>📥</span>
                                                        <span>Uploaded by Admin</span>
                                                        <span style={{ 
                                                            padding: '2px 8px', 
                                                            borderRadius: '12px', 
                                                            fontSize: '0.75rem', 
                                                            fontWeight: 800,
                                                            background: docFilterTab === 'ADMIN' ? 'rgba(255,255,255,0.2)' : 'rgba(0,0,0,0.06)',
                                                            color: docFilterTab === 'ADMIN' ? '#ffffff' : 'var(--text-primary)'
                                                        }}>
                                                            {adminIssuedDocs.length}
                                                        </span>
                                                    </button>

                                                    <button
                                                        type="button"
                                                        onClick={() => setDocFilterTab('ALL')}
                                                        style={{
                                                            padding: '10px 16px',
                                                            borderRadius: '8px',
                                                            border: docFilterTab === 'ALL' ? '2px solid var(--accent-primary)' : '1px solid var(--border-glass)',
                                                            fontSize: '0.86rem',
                                                            fontWeight: 600,
                                                            cursor: 'pointer',
                                                            background: docFilterTab === 'ALL' ? 'var(--accent-primary)' : 'var(--input-bg)',
                                                            color: docFilterTab === 'ALL' ? '#ffffff' : 'var(--text-muted)',
                                                            transition: 'all 0.15s ease'
                                                        }}
                                                    >
                                                        All ({employeeDocuments.length})
                                                    </button>
                                                </div>

                                                <div style={{ fontSize: '0.84rem', color: 'var(--text-muted)', fontWeight: 600 }}>
                                                    {docFilterTab === 'EMPLOYEE' ? `Files submitted by ${employeeName}` : docFilterTab === 'ADMIN' ? `Files & Payslips issued to ${employeeName} by Admin` : `All ${employeeDocuments.length} files`}
                                                </div>
                                            </div>

                                            {/* Document Content Area */}
                                            {empDocsLoading ? (
                                                <div style={{ textAlign: 'center', padding: '60px 20px', color: 'var(--text-muted)' }}>
                                                    <i className="fa-solid fa-spinner fa-spin" style={{ fontSize: '2rem', color: 'var(--accent-primary)', marginBottom: '12px' }}></i>
                                                    <div style={{ fontWeight: 600, fontSize: '0.92rem' }}>Loading documents...</div>
                                                </div>
                                            ) : displayedDocs.length === 0 ? (
                                                <div style={{ textAlign: 'center', padding: '50px 20px', background: 'var(--input-bg)', borderRadius: '12px', border: '1px dashed var(--border-glass)' }}>
                                                    <div style={{ fontSize: '2.5rem', marginBottom: '10px' }}>
                                                        {docFilterTab === 'EMPLOYEE' ? '📤' : '📥'}
                                                    </div>
                                                    <h5 style={{ margin: '0 0 6px 0', fontSize: '1rem', fontWeight: 700, color: 'var(--text-primary)' }}>
                                                        {docFilterTab === 'EMPLOYEE' ? `No documents uploaded by ${employeeName} yet` : `No documents uploaded by Admin for ${employeeName} yet`}
                                                    </h5>
                                                    <p style={{ margin: 0, fontSize: '0.84rem', color: 'var(--text-muted)' }}>
                                                        {docFilterTab === 'EMPLOYEE' ? 'Identity proofs, bank passbooks, and certificates submitted by employee will appear here.' : 'Payslips, contracts, and company notices issued by admin will appear here.'}
                                                    </p>
                                                </div>
                                            ) : (
                                                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(310px, 1fr))', gap: '18px' }}>
                                                    {displayedDocs.map((doc, idx) => {
                                                        const isIssuedByAdmin = String(doc.uploaderId || '').toLowerCase() === 'admin' || (doc.targetUserId && (doc.targetUserId === viewingEmployee.id || doc.targetUserId === viewingEmployee.empCode));
                                                        const isPdf = doc.fileType === 'pdf' || String(doc.filePath || '').endsWith('.pdf') || String(doc.filePath || '').endsWith('.html');
                                                        const fullUrl = `${getFullUrl(doc.filePath)}?_t=${Date.now()}`;

                                                        return (
                                                             <div 
                                                                key={doc.id || idx} 
                                                                style={{ 
                                                                    border: '1px solid var(--border-glass)', 
                                                                    borderRadius: '12px', 
                                                                    padding: '18px', 
                                                                    backgroundColor: 'var(--bg-glass)', 
                                                                    display: 'flex', 
                                                                    flexDirection: 'column', 
                                                                    justifyContent: 'space-between', 
                                                                    gap: '14px',
                                                                    boxShadow: 'var(--shadow-sm)',
                                                                    transition: 'transform 0.15s ease, box-shadow 0.15s ease'
                                                                }}
                                                            >
                                                                <div>
                                                                    {/* Header Info */}
                                                                    <div style={{ display: 'flex', alignItems: 'flex-start', gap: '12px' }}>
                                                                        <div style={{ 
                                                                            width: '44px', 
                                                                            height: '44px', 
                                                                            borderRadius: '10px', 
                                                                            backgroundColor: isPdf ? 'rgba(239, 68, 68, 0.15)' : 'rgba(79, 70, 229, 0.15)', 
                                                                            color: isPdf ? '#f87171' : 'var(--accent-primary)', 
                                                                            display: 'flex', 
                                                                            alignItems: 'center', 
                                                                            justifyContent: 'center', 
                                                                            fontSize: '1.35rem', 
                                                                            flexShrink: 0 
                                                                        }}>
                                                                            {isPdf ? '📄' : '🖼️'}
                                                                        </div>
                                                                        <div style={{ flex: 1, minWidth: 0 }}>
                                                                            <h5 style={{ margin: 0, fontSize: '0.98rem', fontWeight: 700, color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={doc.title}>
                                                                                {doc.title || 'Untitled Document'}
                                                                            </h5>
                                                                            <div style={{ fontSize: '0.76rem', color: 'var(--text-muted)', fontWeight: 600, textTransform: 'uppercase', marginTop: '2px' }}>
                                                                                {doc.fileType || (isPdf ? 'PDF' : 'IMAGE')} • {doc.fileSize ? `${Math.round(doc.fileSize / 1024)} KB` : 'Ready'}
                                                                            </div>
                                                                        </div>
                                                                    </div>

                                                                    {/* Metadata Pill */}
                                                                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '14px', background: 'var(--input-bg)', border: '1px solid var(--border-glass)', padding: '8px 12px', borderRadius: '8px', fontSize: '0.78rem' }}>
                                                                        <span style={{ 
                                                                            fontWeight: 700, 
                                                                            padding: '3px 10px', 
                                                                            borderRadius: '12px', 
                                                                            backgroundColor: isIssuedByAdmin ? 'rgba(59, 130, 246, 0.15)' : 'rgba(16, 185, 129, 0.15)', 
                                                                            color: isIssuedByAdmin ? '#60a5fa' : '#34d399',
                                                                            border: isIssuedByAdmin ? '1px solid rgba(59, 130, 246, 0.3)' : '1px solid rgba(16, 185, 129, 0.3)'
                                                                        }}>
                                                                            {isIssuedByAdmin ? '📥 Uploaded by Admin' : '📤 Uploaded by Employee'}
                                                                        </span>
                                                                        <span style={{ color: 'var(--text-muted)', fontWeight: 500 }}>
                                                                            {doc.uploadedAt ? new Date(doc.uploadedAt).toLocaleDateString('en-GB') : (doc.createdAt ? new Date(doc.createdAt).toLocaleDateString('en-GB') : '-')}
                                                                        </span>
                                                                    </div>
                                                                </div>

                                                                {/* Action Buttons */}
                                                                <div style={{ display: 'flex', gap: '8px', borderTop: '1px solid var(--border-glass)', paddingTop: '12px' }}>
                                                                    <button 
                                                                        type="button"
                                                                        onClick={() => setDocPreviewModal({ url: fullUrl, title: doc.title, isPdf })}
                                                                        className="btn btn-outline" 
                                                                        style={{ 
                                                                            flex: 1, 
                                                                            padding: '8px 14px', 
                                                                            fontSize: '0.84rem', 
                                                                            fontWeight: 600, 
                                                                            borderRadius: '8px', 
                                                                            cursor: 'pointer', 
                                                                            display: 'flex', 
                                                                            alignItems: 'center', 
                                                                            justifyContent: 'center', 
                                                                            gap: '6px',
                                                                            background: 'var(--input-bg)',
                                                                            border: '1px solid var(--border-glass)',
                                                                            color: 'var(--text-primary)'
                                                                        }}
                                                                    >
                                                                        👁️ View
                                                                    </button>
                                                                    <button 
                                                                        type="button"
                                                                        onClick={() => forceDownload(fullUrl, doc.title || 'document')}
                                                                        className="btn btn-primary" 
                                                                        style={{ 
                                                                            flex: 1, 
                                                                            padding: '8px 14px', 
                                                                            fontSize: '0.84rem', 
                                                                            fontWeight: 600, 
                                                                            borderRadius: '8px', 
                                                                            cursor: 'pointer', 
                                                                            display: 'flex', 
                                                                            alignItems: 'center', 
                                                                            justifyContent: 'center', 
                                                                            gap: '6px',
                                                                            background: 'var(--accent-primary)',
                                                                            border: 'none',
                                                                            color: '#ffffff'
                                                                        }}
                                                                    >
                                                                        ⬇️ Download
                                                                    </button>
                                                                </div>
                                                            </div>
                                                        );
                                                    })}
                                                </div>
                                            )}
                                        </div>
                                    </div>
                                );
                            })()}

                        </div>
                    ) : (
                        
                        <form id="profile-scroll-container" onSubmit={handleUpdateEmployee} onScroll={handleFormScroll} className="custom-scrollbar" style={{ flex: 1, minHeight: 0, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '20px', marginTop: '10px', paddingRight: '6px', paddingBottom: '20px', scrollBehavior: 'smooth' }}>
{/* Personal Details */}
                            <div id="section-profile" style={{ border: '1px solid #e2e8f0', padding: '16px', borderRadius: '8px' }}>
                                <h4 style={{ margin: '0 0 15px 0', color: '#4f46e5', borderBottom: '1px solid #e2e8f0', paddingBottom: '6px' }}>Edit Personal Details</h4>
                                <div style={{ display: 'flex', gap: '20px', flexWrap: 'wrap' }}>
                                    <div className="form-group" style={{ flex: 1, minWidth: '220px', margin: 0 }}>
                                        <label style={{ fontWeight: 600, fontSize: '0.82rem' }}>Full Name *</label>
                                        <input type="text" value={editName} onChange={(e) => setEditName(e.target.value)} required style={{ width: '100%', padding: '10px 14px', borderRadius: '8px', border: '1px solid #d1d5db', outline: 'none' }} />
                                    </div>
                                    <div className="form-group" style={{ flex: 1, minWidth: '220px', margin: 0 }}>
                                        <label style={{ fontWeight: 600, fontSize: '0.82rem' }}>Email Address *</label>
                                        <input type="email" value={editEmail} onChange={(e) => setEditEmail(e.target.value)} required style={{ width: '100%', padding: '10px 14px', borderRadius: '8px', border: '1px solid #d1d5db', outline: 'none' }} />
                                    </div>
                                    <div className="form-group" style={{ flex: 1, minWidth: '220px', margin: 0 }}>
                                        <label style={{ fontWeight: 600, fontSize: '0.82rem' }}>Password (Leave blank to keep same)</label>
                                        <input type="password" value={editPassword} onChange={(e) => setEditPassword(e.target.value)} placeholder="••••••••" style={{ width: '100%', padding: '10px 14px', borderRadius: '8px', border: '1px solid #d1d5db', outline: 'none' }} />
                                    </div>
                                </div>

                                <div style={{ display: 'flex', gap: '20px', flexWrap: 'wrap', marginTop: '12px' }}>
                                    <div className="form-group" style={{ flex: 1, minWidth: '150px', margin: 0 }}>
                                        <label style={{ fontWeight: 600, fontSize: '0.82rem' }}>DOB</label>
                                        <input type="date" value={editDob} onChange={(e) => setEditDob(e.target.value)} style={{ width: '100%', padding: '10px 14px', borderRadius: '8px', border: '1px solid #d1d5db', outline: 'none' }} />
                                    </div>
                                    <div className="form-group" style={{ flex: 1, minWidth: '150px', margin: 0 }}>
                                        <label style={{ fontWeight: 600, fontSize: '0.82rem' }}>Gender</label>
                                        <select value={editGender} onChange={(e) => setEditGender(e.target.value)} style={{ width: '100%', padding: '10px 14px', borderRadius: '8px', border: '1px solid #d1d5db', outline: 'none' }}>
                                            <option value="Male">Male</option>
                                            <option value="Female">Female</option>
                                            <option value="Other">Other</option>
                                        </select>
                                    </div>
                                    <div className="form-group" style={{ flex: 1, minWidth: '150px', margin: 0 }}>
                                        <label style={{ fontWeight: 600, fontSize: '0.82rem' }}>EMP Code</label>
                                        <input type="text" value={editEmpCode} onChange={(e) => setEditEmpCode(e.target.value)} style={{ width: '100%', padding: '10px 14px', borderRadius: '8px', border: '1px solid #d1d5db', outline: 'none' }} />
                                    </div>
                                    <div className="form-group" style={{ flex: 1, minWidth: '150px', margin: 0 }}>
                                        <label style={{ fontWeight: 600, fontSize: '0.82rem' }}>Nationality</label>
                                        <input type="text" value={editNationality} onChange={(e) => setEditNationality(e.target.value)} style={{ width: '100%', padding: '10px 14px', borderRadius: '8px', border: '1px solid #d1d5db', outline: 'none' }} />
                                    </div>
                                    <div className="form-group" style={{ flex: 1, minWidth: '150px', margin: 0 }}>
                                        <label style={{ fontWeight: 600, fontSize: '0.82rem' }}>Phone No</label>
                                        <div style={{ display: 'flex', gap: '8px' }}>
                                            <select 
                                                value={editCountryCode} 
                                                onChange={(e) => setEditCountryCode(e.target.value)} 
                                                style={{ 
                                                    width: '105px', 
                                                    padding: '10px 12px', 
                                                    borderRadius: '8px', 
                                                    border: '1px solid var(--border-glass)', 
                                                    outline: 'none',
                                                    backgroundColor: 'var(--input-bg)',
                                                    color: 'var(--text-primary)',
                                                    cursor: 'pointer',
                                                    fontSize: '0.82rem'
                                                }}
                                            >
                                                {COUNTRY_CODES.map(c => (
                                                    <option key={c.code} value={c.code}>{c.label}</option>
                                                ))}
                                            </select>
                                            <input 
                                                type="tel" 
                                                value={editPhoneNo} 
                                                onChange={(e) => setEditPhoneNo(e.target.value.replace(/\D/g, ''))} 
                                                style={{ 
                                                    flex: 1, 
                                                    padding: '10px 14px', 
                                                    borderRadius: '8px', 
                                                    border: '1px solid #d1d5db', 
                                                    outline: 'none' 
                                                }} 
                                            />
                                        </div>
                                    </div>
                                    <div className="form-group" style={{ flex: 1, minWidth: '150px', margin: 0 }}>
                                        <label style={{ fontWeight: 600, fontSize: '0.82rem' }}>Leaves (Yearly)</label>
                                        <input type="number" value={editAllowedLeaves} onChange={(e) => setEditAllowedLeaves(e.target.value)} min="0" style={{ width: '100%', padding: '10px 14px', borderRadius: '8px', border: '1px solid #d1d5db', outline: 'none' }} />
                                    </div>
                                </div>
                                <div style={{ display: 'flex', gap: '20px', flexWrap: 'wrap', marginTop: '12px' }}>
                                    <div className="form-group" style={{ flex: 1, minWidth: '220px', margin: 0 }}>
                                        <label style={{ fontWeight: 600, fontSize: '0.82rem' }}>Father / Spouse Name</label>
                                        <input type="text" value={editFatherName} onChange={(e) => setEditFatherName(e.target.value)} placeholder="Father or Spouse Name" style={{ width: '100%', padding: '10px 14px', borderRadius: '8px', border: '1px solid #d1d5db', outline: 'none' }} />
                                    </div>
                                    <div className="form-group" style={{ flex: 2, minWidth: '280px', margin: 0 }}>
                                        <label style={{ fontWeight: 600, fontSize: '0.82rem' }}>Present Residential Address</label>
                                        <input type="text" value={editPresentAddress} onChange={(e) => setEditPresentAddress(e.target.value)} placeholder="e.g. Flat 101, Galaxy Apts, Sector 62, Noida" style={{ width: '100%', padding: '10px 14px', borderRadius: '8px', border: '1px solid #d1d5db', outline: 'none' }} />
                                    </div>
                                </div>
                                <div style={{ display: 'flex', gap: '20px', flexWrap: 'wrap', marginTop: '12px' }}>
                                    <div className="form-group" style={{ flex: 2, minWidth: '280px', margin: 0 }}>
                                        <label style={{ fontWeight: 600, fontSize: '0.82rem' }}>Permanent Address</label>
                                        <input type="text" value={editPermanentAddress} onChange={(e) => setEditPermanentAddress(e.target.value)} placeholder="Permanent Address (Leave blank if same as residential)" style={{ width: '100%', padding: '10px 14px', borderRadius: '8px', border: '1px solid #d1d5db', outline: 'none' }} />
                                    </div>
                                    <div className="form-group" style={{ flex: 1, minWidth: '220px', margin: 0 }}>
                                        <label style={{ fontWeight: 600, fontSize: '0.82rem' }}>Emergency Contact Person & Phone</label>
                                        <input type="text" value={editEmergencyContact} onChange={(e) => setEditEmergencyContact(e.target.value)} placeholder="e.g. Dinesh Mishra (+91-9876543210)" style={{ width: '100%', padding: '10px 14px', borderRadius: '8px', border: '1px solid #d1d5db', outline: 'none' }} />
                                    </div>
                                </div>

                                {/* Highest Qualification Subsection */}
                                <div style={{ borderTop: '1px solid #e2e8f0', paddingTop: '14px', marginTop: '14px' }}>
                                    <h5 style={{ margin: '0 0 12px 0', fontSize: '0.85rem', fontWeight: 700, color: '#4f46e5', textTransform: 'uppercase', letterSpacing: '0.04em', display: 'flex', alignItems: 'center', gap: '6px' }}>
                                        Highest Qualification Details
                                    </h5>
                                    <div style={{ display: 'flex', gap: '20px', flexWrap: 'wrap' }}>
                                        <div className="form-group" style={{ flex: 1, minWidth: '220px', margin: 0 }}>
                                            <label style={{ fontWeight: 600, fontSize: '0.82rem' }}>Highest Qualification / Degree</label>
                                            <select 
                                                value={editHighestQualLevel} 
                                                onChange={(e) => setEditHighestQualLevel(e.target.value)} 
                                                style={{ width: '100%', padding: '10px 14px', borderRadius: '8px', border: '1px solid #d1d5db', outline: 'none' }}
                                            >
                                                <option value="">Select Qualification</option>
                                                <option value="10th / Secondary">10th / Secondary</option>
                                                <option value="12th / Higher Secondary">12th / Higher Secondary</option>
                                                <option value="Diploma">Diploma / Polytechnic</option>
                                                <option value="Bachelor's Degree">Bachelor's Degree (B.E / B.Tech / B.Sc / B.Com / B.A / etc.)</option>
                                                <option value="Master's Degree">Master's Degree (M.E / M.Tech / M.Sc / M.Com / MBA / etc.)</option>
                                                <option value="Doctorate / Ph.D">Doctorate / Ph.D</option>
                                                <option value="Other">Other</option>
                                            </select>
                                        </div>
                                        <div className="form-group" style={{ flex: 1, minWidth: '220px', margin: 0 }}>
                                            <label style={{ fontWeight: 600, fontSize: '0.82rem' }}>Field of Study / Specialization</label>
                                            <input 
                                                type="text" 
                                                value={editHighestQualStream} 
                                                onChange={(e) => setEditHighestQualStream(e.target.value)} 
                                                placeholder="e.g. Mechanical Engineering, Computer Science" 
                                                style={{ width: '100%', padding: '10px 14px', borderRadius: '8px', border: '1px solid #d1d5db', outline: 'none' }} 
                                            />
                                        </div>
                                    </div>
                                    <div style={{ display: 'flex', gap: '20px', flexWrap: 'wrap', marginTop: '12px' }}>
                                        <div className="form-group" style={{ flex: 2, minWidth: '280px', margin: 0 }}>
                                            <label style={{ fontWeight: 600, fontSize: '0.82rem' }}>College / University / Board</label>
                                            <input 
                                                type="text" 
                                                value={editHighestQualInstitution} 
                                                onChange={(e) => setEditHighestQualInstitution(e.target.value)} 
                                                placeholder="e.g. Anna University, IIT Madras, CBSE" 
                                                style={{ width: '100%', padding: '10px 14px', borderRadius: '8px', border: '1px solid #d1d5db', outline: 'none' }} 
                                            />
                                        </div>
                                        <div className="form-group" style={{ flex: 1, minWidth: '140px', margin: 0 }}>
                                            <label style={{ fontWeight: 600, fontSize: '0.82rem' }}>Year of Passing</label>
                                            <input 
                                                type="number" 
                                                min="1950" 
                                                max="2035" 
                                                value={editHighestQualYear} 
                                                onChange={(e) => setEditHighestQualYear(e.target.value)} 
                                                placeholder="e.g. 2022" 
                                                style={{ width: '100%', padding: '10px 14px', borderRadius: '8px', border: '1px solid #d1d5db', outline: 'none' }} 
                                            />
                                        </div>
                                        <div className="form-group" style={{ flex: 1, minWidth: '140px', margin: 0 }}>
                                            <label style={{ fontWeight: 600, fontSize: '0.82rem' }}>Percentage / CGPA</label>
                                            <input 
                                                type="text" 
                                                value={editHighestQualPercent} 
                                                onChange={(e) => setEditHighestQualPercent(e.target.value)} 
                                                placeholder="e.g. 82% or 8.5" 
                                                style={{ width: '100%', padding: '10px 14px', borderRadius: '8px', border: '1px solid #d1d5db', outline: 'none' }} 
                                            />
                                        </div>
                                    </div>
                                </div>
                            </div>

                            {/* Job Details */}
                            <div id="section-job" style={{ border: '1px solid #e2e8f0', padding: '16px', borderRadius: '8px' }}>
                                <h4 style={{ margin: '0 0 15px 0', color: '#4f46e5', borderBottom: '1px solid #e2e8f0', paddingBottom: '6px' }}>Edit Job & Workplace Settings</h4>
                                <div style={{ display: 'flex', gap: '20px', flexWrap: 'wrap' }}>
                                    <div className="form-group" style={{ flex: 1, minWidth: '200px', margin: 0 }}>
                                        <label style={{ fontWeight: 600, fontSize: '0.82rem' }}>Track</label>
                                        <select value={editDesignation} onChange={(e) => setEditDesignation(e.target.value)} style={{ width: '100%', padding: '10px 14px', borderRadius: '8px', border: '1px solid #d1d5db', outline: 'none' }}>
                                            <option value="FIELD">Field Employee (GPS Tracking active)</option>
                                            <option value="OFFICE">Office Employee</option>
                                        </select>
                                    </div>
                                    <div className="form-group" style={{ flex: 1, minWidth: '200px', margin: 0 }}>
                                        <label style={{ fontWeight: 600, fontSize: '0.82rem' }}>Access Role</label>
                                        <select value={editRole} onChange={(e) => setEditRole(e.target.value)} style={{ width: '100%', padding: '10px 14px', borderRadius: '8px', border: '1px solid #d1d5db', outline: 'none' }}>
                                            <option value="EMPLOYEE">Employee (Mobile App Only)</option>
                                            <option value="ADMIN">Administrator (Full Access)</option>
                                            <option value="TRACKING_MANAGER">Tracking Manager (Tracking & Attendance)</option>
                                            <option value="FIELD_INVOICE_MANAGER">Field & Invoice Manager (Tracking & Invoicing)</option>
                                        </select>
                                    </div>
                                    <div className="form-group" style={{ flex: 1, minWidth: '200px', margin: 0 }}>
                                        <label style={{ fontWeight: 600, fontSize: '0.82rem' }}>Employment Status</label>
                                        <select value={editStatus} onChange={(e) => setEditStatus(e.target.value)} style={{ width: '100%', padding: '10px 14px', borderRadius: '8px', border: '1px solid #d1d5db', outline: 'none' }}>
                                            <option value="ACTIVE">Active (Working)</option>
                                            <option value="PAST">Past / Inactive (Resigned/Terminated)</option>
                                        </select>
                                    </div>
                                    <div className="form-group" style={{ flex: 1, minWidth: '200px', margin: 0 }}>
                                        <label style={{ fontWeight: 600, fontSize: '0.82rem' }}>Joining Date</label>
                                        <input type="date" value={editJoiningDate} onChange={(e) => setEditJoiningDate(e.target.value)} style={{ width: '100%', padding: '10px 14px', borderRadius: '8px', border: '1px solid #d1d5db', outline: 'none' }} />
                                    </div>
                                </div>

                                <div style={{ display: 'flex', gap: '20px', flexWrap: 'wrap', marginTop: '12px' }}>
                                    <div className="form-group" style={{ flex: 1, minWidth: '200px', margin: 0 }}>
                                        <label style={{ fontWeight: 600, fontSize: '0.82rem' }}>Designation</label>
                                        <input type="text" value={editJobTitle} onChange={(e) => setEditJobTitle(e.target.value)} style={{ width: '100%', padding: '10px 14px', borderRadius: '8px', border: '1px solid #d1d5db', outline: 'none' }} />
                                    </div>
                                    <div className="form-group" style={{ flex: 1, minWidth: '200px', margin: 0 }}>
                                        <label style={{ fontWeight: 600, fontSize: '0.82rem' }}>Department</label>
                                        <input type="text" value={editDepartment} onChange={(e) => setEditDepartment(e.target.value)} style={{ width: '100%', padding: '10px 14px', borderRadius: '8px', border: '1px solid #d1d5db', outline: 'none' }} />
                                    </div>
                                    <div className="form-group" style={{ flex: 1, minWidth: '200px', margin: 0 }}>
                                        <label style={{ fontWeight: 600, fontSize: '0.82rem' }}>
                                            Location (Holiday Calendar Attached)
                                        </label>
                                        <select 
                                            value={editLocation || ''} 
                                            onChange={(e) => {
                                                const chosenLoc = e.target.value;
                                                setEditLocation(chosenLoc);
                                                setEditHolidayDetails(chosenLoc);
                                            }} 
                                            style={{ width: '100%', padding: '10px 14px', borderRadius: '8px', border: '1px solid var(--border-glass)', outline: 'none', background: 'var(--input-bg)', color: 'var(--text-primary)', cursor: 'pointer' }}
                                        >
                                            {locationCalendars && locationCalendars.length > 0 ? (
                                                locationCalendars.map(c => (
                                                    <option key={c.id || c.location} value={c.location || c.name}>
                                                        📍 {c.location || c.name} ({(c.holidays || []).length} Holidays)
                                                    </option>
                                                ))
                                            ) : (
                                                <option value={editLocation || 'Headquarters'}>
                                                    📍 {editLocation || 'Headquarters'}
                                                </option>
                                            )}
                                        </select>
                                    </div>
                                    <div className="form-group" style={{ flex: 1, minWidth: '200px', margin: 0 }}>
                                        <label style={{ fontWeight: 600, fontSize: '0.82rem' }}>Reporting Manager</label>
                                        <input type="text" value={editReportingManager} onChange={(e) => setEditReportingManager(e.target.value)} style={{ width: '100%', padding: '10px 14px', borderRadius: '8px', border: '1px solid #d1d5db', outline: 'none' }} />
                                    </div>
                                    <div className="form-group" style={{ flex: 1, minWidth: '200px', margin: 0 }}>
                                        <label style={{ fontWeight: 600, fontSize: '0.82rem' }}>Place of Duty</label>
                                        <input 
                                            type="text" 
                                            value={editPlaceOfDuty} 
                                            onChange={(e) => setEditPlaceOfDuty(e.target.value)} 
                                            placeholder="e.g. Noida / Chennai / Client Site" 
                                            style={{ width: '100%', padding: '10px 14px', borderRadius: '8px', border: '1px solid #d1d5db', outline: 'none' }} 
                                        />
                                    </div>
                                </div>
                            </div>

                            {/* Terms & Work Details */}
                            <div id="section-policies" style={{ border: '1px solid #e2e8f0', padding: '16px', borderRadius: '8px' }}>
                                <h4 style={{ margin: '0 0 15px 0', color: '#4f46e5', borderBottom: '1px solid #e2e8f0', paddingBottom: '6px' }}>Edit Policies & Terms</h4>
                                <div style={{ display: 'flex', gap: '20px', flexWrap: 'wrap' }}>
                                    <div className="form-group" style={{ flex: 1, minWidth: '220px', margin: 0 }}>
                                        <label style={{ fontWeight: 600, fontSize: '0.82rem' }}>Probation Policy</label>
                                        <select 
                                            value={editProbationPolicy} 
                                            onChange={(e) => {
                                                const val = e.target.value;
                                                setEditProbationPolicy(val);
                                                if (val === 'Permanent Employee') {
                                                    setEditNoticePeriod('1 Month');
                                                } else if (val === '6-Months Probation') {
                                                    setEditNoticePeriod('15 Days');
                                                }
                                            }} 
                                            style={{ width: '100%', padding: '10px 14px', borderRadius: '8px', border: '1px solid #d1d5db', outline: 'none' }}
                                        >
                                            <option value="Permanent Employee">Permanent Employee</option>
                                            <option value="6-Months Probation">6-Months Probation</option>
                                        </select>
                                    </div>
                                    <div className="form-group" style={{ flex: 1, minWidth: '220px', margin: 0 }}>
                                        <label style={{ fontWeight: 600, fontSize: '0.82rem' }}>Notice Period</label>
                                        <select 
                                            value={editNoticePeriod} 
                                            onChange={(e) => setEditNoticePeriod(e.target.value)} 
                                            style={{ width: '100%', padding: '10px 14px', borderRadius: '8px', border: '1px solid #d1d5db', outline: 'none' }}
                                        >
                                            <option value="1 Month">1 Month</option>
                                            <option value="15 Days">15 Days</option>
                                        </select>
                                    </div>
                                    <div className="form-group" style={{ flex: 1, minWidth: '220px', margin: 0 }}>
                                        <label style={{ fontWeight: 600, fontSize: '0.82rem' }}>Attendance Setting</label>
                                        <select value={editAttendanceSetting} onChange={(e) => setEditAttendanceSetting(e.target.value)} style={{ width: '100%', padding: '10px 14px', borderRadius: '8px', border: '1px solid #d1d5db', outline: 'none' }}>
                                            <option value="9-5:30">9 to 5:30 Fixed Work Hours</option>
                                            <option value="Flexible">Flexible Work Hours</option>
                                            <option value="Other">Other (Custom Hours)</option>
                                        </select>
                                        {editAttendanceSetting === 'Other' && (
                                            <div style={{ display: 'flex', gap: '10px', marginTop: '8px' }}>
                                                <div style={{ flex: 1 }}>
                                                    <label style={{ fontWeight: 600, fontSize: '0.78rem', color: '#6b7280' }}>Start Time</label>
                                                    <input 
                                                        type="time" 
                                                        value={editStartTime} 
                                                        onChange={(e) => setEditStartTime(e.target.value)} 
                                                        style={{ width: '100%', padding: '8px 10px', borderRadius: '6px', border: '1px solid #d1d5db', outline: 'none' }} 
                                                    />
                                                </div>
                                                <div style={{ flex: 1 }}>
                                                    <label style={{ fontWeight: 600, fontSize: '0.78rem', color: '#6b7280' }}>End Time</label>
                                                    <input 
                                                        type="time" 
                                                        value={editEndTime} 
                                                        onChange={(e) => setEditEndTime(e.target.value)} 
                                                        style={{ width: '100%', padding: '8px 10px', borderRadius: '6px', border: '1px solid #d1d5db', outline: 'none' }} 
                                                    />
                                                </div>
                                            </div>
                                        )}
                                    </div>
                                </div>
                                <div style={{ display: 'flex', gap: '20px', flexWrap: 'wrap', marginTop: '12px' }}>
                                    <div className="form-group" style={{ flex: 1, minWidth: '220px', margin: 0, position: 'relative' }}>
                                        <label style={{ fontWeight: 600, fontSize: '0.82rem' }}>Leave Setting</label>
                                        <div 
                                            onClick={() => setShowEditLeaveDropdown(!showEditLeaveDropdown)}
                                            style={{ 
                                                width: '100%', 
                                                padding: '10px 14px', 
                                                borderRadius: '8px', 
                                                border: '1px solid var(--border-glass)', 
                                                backgroundColor: 'var(--input-bg)', 
                                                cursor: 'pointer',
                                                fontSize: '0.85rem',
                                                color: editLeaveSetting ? 'var(--text-primary)' : 'var(--text-muted)',
                                                minHeight: '40px',
                                                display: 'flex',
                                                alignItems: 'center',
                                                justifyContent: 'space-between'
                                            }}
                                        >
                                            <span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: '90%' }}>
                                                {editLeaveSetting || 'Select Leaves'}
                                            </span>
                                            <span style={{ fontSize: '0.6rem', color: 'var(--text-muted)' }}>▼</span>
                                        </div>

                                        {showEditLeaveDropdown && (
                                            <>
                                                <div 
                                                    onClick={() => setShowEditLeaveDropdown(false)} 
                                                    style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, zIndex: 998 }} 
                                                />
                                                <div 
                                                    style={{ 
                                                        position: 'absolute', 
                                                        top: '100%', 
                                                        left: 0, 
                                                        right: 0, 
                                                        backgroundColor: 'var(--bg-glass)', 
                                                        border: '1px solid var(--border-glass)', 
                                                        borderRadius: '8px', 
                                                        boxShadow: 'var(--shadow-md)', 
                                                        padding: '12px', 
                                                        zIndex: 999, 
                                                        marginTop: '4px',
                                                        display: 'flex',
                                                        flexDirection: 'column',
                                                        gap: '8px'
                                                    }}
                                                >
                                                    <div style={{ maxHeight: '150px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '8px' }}>
                                                        {leaveTypes.map(type => {
                                                            const selectedArray = editLeaveSetting ? editLeaveSetting.split(',').map(s => s.trim()).filter(Boolean) : [];
                                                            const isChecked = selectedArray.includes(type);
                                                            return (
                                                                <label key={type} style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-start', gap: '8px', fontSize: '0.85rem', cursor: 'pointer', margin: 0, fontWeight: 500, color: 'var(--text-primary)', textAlign: 'left', width: '100%' }}>
                                                                    <input 
                                                                        type="checkbox" 
                                                                        checked={isChecked} 
                                                                        onChange={(e) => {
                                                                            let updated;
                                                                            if (e.target.checked) {
                                                                                updated = [...selectedArray, type];
                                                                            } else {
                                                                                updated = selectedArray.filter(t => t !== type);
                                                                            }
                                                                            setEditLeaveSetting(updated.join(', '));
                                                                        }}
                                                                        style={{ cursor: 'pointer', flexShrink: 0 }}
                                                                    />
                                                                    <span>{type}</span>
                                                                </label>
                                                            );
                                                        })}
                                                    </div>

                                                    <div style={{ borderTop: '1px solid var(--border-glass)', paddingTop: '8px', display: 'flex', flexDirection: 'column', gap: '6px' }}>
                                                        {!isEditAddingLeaveType ? (
                                                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                                                <button type="button" className="btn btn-outline" style={{ padding: '4px 8px', fontSize: '0.75rem' }} onClick={(e) => { e.stopPropagation(); setIsEditAddingLeaveType(true); }}>
                                                                    + Custom Type
                                                                </button>
                                                                <button type="button" className="btn btn-primary" style={{ padding: '4px 10px', fontSize: '0.75rem' }} onClick={() => setShowEditLeaveDropdown(false)}>
                                                                    OK
                                                                </button>
                                                            </div>
                                                        ) : (
                                                            <div style={{ display: 'flex', gap: '6px' }}>
                                                                <input 
                                                                    type="text" 
                                                                    placeholder="New leave name" 
                                                                    value={editNewLeaveType} 
                                                                    onChange={(e) => setEditNewLeaveType(e.target.value)} 
                                                                    style={{ flex: 1, padding: '4px 8px', borderRadius: '4px', border: '1px solid var(--border-glass)', background: 'var(--input-bg)', color: 'var(--text-primary)', fontSize: '0.75rem' }}
                                                                />
                                                                <button type="button" className="btn btn-outline" style={{ padding: '4px 8px', fontSize: '0.75rem' }} onClick={(e) => {
                                                                    e.stopPropagation();
                                                                    const trimmed = editNewLeaveType.trim();
                                                                    if (trimmed) {
                                                                        if (!leaveTypes.includes(trimmed)) {
                                                                            setLeaveTypes(prev => [...prev, trimmed]);
                                                                        }
                                                                        const selectedArray = editLeaveSetting ? editLeaveSetting.split(',').map(s => s.trim()).filter(Boolean) : [];
                                                                        if (!selectedArray.includes(trimmed)) {
                                                                            setEditLeaveSetting([...selectedArray, trimmed].join(', '));
                                                                        }
                                                                        setIsEditAddingLeaveType(false);
                                                                        setEditNewLeaveType('');
                                                                    }
                                                                }}>Add</button>
                                                                <button type="button" className="btn btn-outline" style={{ padding: '4px 8px', fontSize: '0.75rem', color: '#ef4444' }} onClick={(e) => { e.stopPropagation(); setIsEditAddingLeaveType(false); setEditNewLeaveType(''); }}>Cancel</button>
                                                            </div>
                                                        )}
                                                    </div>
                                                </div>
                                            </>
                                        )}
                                    </div>
                                    <div className="form-group" style={{ flex: 1, minWidth: '220px', margin: 0 }}>
                                        <label style={{ fontWeight: 600, fontSize: '0.82rem' }}>Weekly Offs</label>
                                        <input type="text" value={editWeeklyOffs} onChange={(e) => setEditWeeklyOffs(e.target.value)} style={{ width: '100%', padding: '10px 14px', borderRadius: '8px', border: '1px solid #d1d5db', outline: 'none' }} />
                                    </div>
                                </div>
                            </div>

                            {/* Bank Details */}
                            <div id="section-finances" style={{ border: '1px solid #e2e8f0', padding: '16px', borderRadius: '8px' }}>
                                <h4 style={{ margin: '0 0 15px 0', color: '#4f46e5', borderBottom: '1px solid #e2e8f0', paddingBottom: '6px' }}>Edit Bank & Statutory Details</h4>
                                <div style={{ display: 'flex', gap: '20px', flexWrap: 'wrap' }}>
                                    <div className="form-group" style={{ flex: 1, minWidth: '220px', margin: 0 }}>
                                        <label style={{ fontWeight: 600, fontSize: '0.82rem' }}>Bank Name</label>
                                        <input type="text" value={editBankName} onChange={(e) => setEditBankName(e.target.value)} style={{ width: '100%', padding: '10px 14px', borderRadius: '8px', border: '1px solid #d1d5db', outline: 'none' }} />
                                    </div>
                                    <div className="form-group" style={{ flex: 1, minWidth: '220px', margin: 0 }}>
                                        <label style={{ fontWeight: 600, fontSize: '0.82rem' }}>Account Number</label>
                                        <input type="text" value={editBankAccountNo} onChange={(e) => setEditBankAccountNo(e.target.value)} style={{ width: '100%', padding: '10px 14px', borderRadius: '8px', border: '1px solid #d1d5db', outline: 'none' }} />
                                    </div>
                                </div>
                                <div style={{ display: 'flex', gap: '20px', flexWrap: 'wrap', marginTop: '12px' }}>
                                    <div className="form-group" style={{ flex: 1, minWidth: '220px', margin: 0 }}>
                                        <label style={{ fontWeight: 600, fontSize: '0.82rem' }}>IFSC Code</label>
                                        <input type="text" value={editBankIfscCode} onChange={(e) => setEditBankIfscCode(e.target.value)} style={{ width: '100%', padding: '10px 14px', borderRadius: '8px', border: '1px solid #d1d5db', outline: 'none' }} />
                                    </div>
                                    <div className="form-group" style={{ flex: 1, minWidth: '220px', margin: 0 }}>
                                        <label style={{ fontWeight: 600, fontSize: '0.82rem' }}>Branch Name</label>
                                        <input type="text" value={editBankBranchName} onChange={(e) => setEditBankBranchName(e.target.value)} style={{ width: '100%', padding: '10px 14px', borderRadius: '8px', border: '1px solid #d1d5db', outline: 'none' }} />
                                    </div>
                                </div>
                                <div style={{ display: 'flex', gap: '20px', flexWrap: 'wrap', marginTop: '12px' }}>
                                    <div className="form-group" style={{ flex: 1, minWidth: '200px', margin: 0 }}>
                                        <label style={{ fontWeight: 600, fontSize: '0.82rem' }}>Aadhaar Card Number</label>
                                        <input type="text" value={editAadhaarNumber} onChange={(e) => setEditAadhaarNumber(e.target.value)} placeholder="e.g. 1234 5678 9012" maxLength={16} style={{ width: '100%', padding: '10px 14px', borderRadius: '8px', border: '1px solid #d1d5db', outline: 'none' }} />
                                    </div>
                                    <div className="form-group" style={{ flex: 1, minWidth: '200px', margin: 0 }}>
                                        <label style={{ fontWeight: 600, fontSize: '0.82rem' }}>PAN Card Number</label>
                                        <input type="text" value={editPanNumber} onChange={(e) => setEditPanNumber(e.target.value.toUpperCase())} placeholder="e.g. ABCDE1234F" style={{ width: '100%', padding: '10px 14px', borderRadius: '8px', border: '1px solid #d1d5db', outline: 'none' }} />
                                    </div>
                                    <div className="form-group" style={{ flex: 1, minWidth: '200px', margin: 0 }}>
                                        <label style={{ fontWeight: 600, fontSize: '0.82rem' }}>EPF UAN Number</label>
                                        <input type="text" value={editUanNumber} onChange={(e) => setEditUanNumber(e.target.value)} placeholder="e.g. 100123456789" style={{ width: '100%', padding: '10px 14px', borderRadius: '8px', border: '1px solid #d1d5db', outline: 'none' }} />
                                    </div>
                                    <div className="form-group" style={{ flex: 1, minWidth: '200px', margin: 0 }}>
                                        <label style={{ fontWeight: 600, fontSize: '0.82rem' }}>PF Number / Member ID</label>
                                        <input type="text" value={editPfNumber} onChange={(e) => setEditPfNumber(e.target.value)} placeholder="e.g. MH/BAN/0012345/000/0000123" style={{ width: '100%', padding: '10px 14px', borderRadius: '8px', border: '1px solid #d1d5db', outline: 'none' }} />
                                    </div>
                                    <div className="form-group" style={{ flex: 1, minWidth: '200px', margin: 0 }}>
                                        <label style={{ fontWeight: 600, fontSize: '0.82rem' }}>ESIC Number / IP No</label>
                                        <input type="text" value={editEsiNumber} onChange={(e) => setEditEsiNumber(e.target.value)} placeholder="e.g. 3100123456" style={{ width: '100%', padding: '10px 14px', borderRadius: '8px', border: '1px solid #d1d5db', outline: 'none' }} />
                                    </div>
                                </div>
                            </div>

                            {/* Compensation & Statutory */}
                            <div style={{ border: '1px solid #e2e8f0', padding: '16px', borderRadius: '8px' }}>
                                <h4 style={{ margin: '0 0 15px 0', color: '#4f46e5', borderBottom: '1px solid #e2e8f0', paddingBottom: '6px' }}>Edit Compensation & Salary Details</h4>
                                <div style={{ display: 'flex', gap: '30px', flexWrap: 'wrap' }}>
                                    <div style={{ flex: 1, minWidth: '250px', display: 'flex', flexDirection: 'column', gap: '15px' }}>
                                        <div className="form-group" style={{ margin: 0 }}>
                                            <label style={{ fontWeight: 600, fontSize: '0.82rem' }}>Annual Gross Salary (INR)</label>
                                            <input type="number" value={editCompensationGross} onChange={(e) => setEditCompensationGross(e.target.value)} style={{ width: '100%', padding: '10px 14px', borderRadius: '8px', border: '1px solid #d1d5db', outline: 'none', fontWeight: 600 }} />
                                        </div>
                                        {Number(editCompensationGross) !== Number(viewingEmployee?.compensationGross || 0) && (
                                            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', background: 'rgba(79, 70, 229, 0.04)', border: '1px solid rgba(79, 70, 229, 0.25)', padding: '12px 14px', borderRadius: '8px' }}>
                                                {/* Date Selector Header & Presets */}
                                                <div>
                                                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
                                                        <label style={{ fontWeight: 700, fontSize: '0.74rem', color: 'var(--accent-primary)', margin: 0 }}>
                                                            Revision Effective Date
                                                        </label>
                                                        <div style={{ display: 'flex', gap: '6px' }}>
                                                            <button
                                                                type="button"
                                                                onClick={() => setEditRevisionEffectiveDate(getNextMonthFirst())}
                                                                style={{
                                                                    padding: '2px 8px',
                                                                    fontSize: '0.68rem',
                                                                    fontWeight: 600,
                                                                    borderRadius: '4px',
                                                                    border: editRevisionEffectiveDate === getNextMonthFirst() ? '1px solid var(--accent-primary)' : '1px solid #d1d5db',
                                                                    backgroundColor: editRevisionEffectiveDate === getNextMonthFirst() ? 'var(--accent-primary)' : '#ffffff',
                                                                    color: editRevisionEffectiveDate === getNextMonthFirst() ? '#ffffff' : 'var(--text-primary)',
                                                                    cursor: 'pointer'
                                                                }}
                                                            >
                                                                📅 1st of Next Month
                                                            </button>
                                                            <button
                                                                type="button"
                                                                onClick={() => setEditRevisionEffectiveDate(new Date().toISOString().split('T')[0])}
                                                                style={{
                                                                    padding: '2px 8px',
                                                                    fontSize: '0.68rem',
                                                                    fontWeight: 600,
                                                                    borderRadius: '4px',
                                                                    border: editRevisionEffectiveDate === new Date().toISOString().split('T')[0] ? '1px solid var(--accent-primary)' : '1px solid #d1d5db',
                                                                    backgroundColor: editRevisionEffectiveDate === new Date().toISOString().split('T')[0] ? 'var(--accent-primary)' : '#ffffff',
                                                                    color: editRevisionEffectiveDate === new Date().toISOString().split('T')[0] ? '#ffffff' : 'var(--text-primary)',
                                                                    cursor: 'pointer'
                                                                }}
                                                            >
                                                                ⚡ Today
                                                            </button>
                                                        </div>
                                                    </div>
                                                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
                                                        <input 
                                                            type="date" 
                                                            value={editRevisionEffectiveDate} 
                                                            onChange={(e) => setEditRevisionEffectiveDate(e.target.value)} 
                                                            style={{ width: '100%', padding: '8px 10px', borderRadius: '6px', border: '1px solid #d1d5db', outline: 'none', fontSize: '0.82rem' }} 
                                                        />
                                                        <select 
                                                            value={editRevisionReason} 
                                                            onChange={(e) => setEditRevisionReason(e.target.value)} 
                                                            style={{ width: '100%', padding: '8px 10px', borderRadius: '6px', border: '1px solid #d1d5db', outline: 'none', fontSize: '0.82rem' }}
                                                        >
                                                            <option value="Annual Appraisal">Annual Appraisal</option>
                                                            <option value="Promotion / Role Change">Promotion / Role Change</option>
                                                            <option value="Market Correction">Market Correction</option>
                                                            <option value="Performance Adjustment">Performance Adjustment</option>
                                                            <option value="Salary Revision">Salary Revision</option>
                                                        </select>
                                                    </div>
                                                </div>

                                                {/* Informative Schedule Alert */}
                                                {(() => {
                                                    const todayStr = new Date().toISOString().split('T')[0];
                                                    const isFuture = editRevisionEffectiveDate > todayStr;
                                                    const curSalary = Number(viewingEmployee?.compensationGross || 0);
                                                    const newSalary = Number(editCompensationGross || 0);
                                                    let effMonthName = 'Next Month';
                                                    try {
                                                        effMonthName = new Date(editRevisionEffectiveDate + 'T00:00:00').toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
                                                    } catch (e) {}
                                                    const curMonthName = new Date().toLocaleDateString('en-US', { month: 'long', year: 'numeric' });

                                                    return (
                                                        <div style={{
                                                            padding: '8px 12px',
                                                            borderRadius: '6px',
                                                            fontSize: '0.72rem',
                                                            lineHeight: 1.45,
                                                            backgroundColor: isFuture ? 'rgba(59, 130, 246, 0.08)' : 'rgba(16, 185, 129, 0.08)',
                                                            border: isFuture ? '1px solid rgba(59, 130, 246, 0.25)' : '1px solid rgba(16, 185, 129, 0.25)',
                                                            color: isFuture ? '#1e40af' : '#065f46'
                                                        }}>
                                                            {isFuture ? (
                                                                <>
                                                                    <div style={{ fontWeight: 700, display: 'flex', alignItems: 'center', gap: '4px', marginBottom: '3px' }}>
                                                                        <span>📅</span> <span>Scheduled for Next Month (Effective {editRevisionEffectiveDate}):</span>
                                                                    </div>
                                                                    <div>
                                                                        • <strong>{curMonthName}</strong> payroll remains locked at current CTC of <strong>INR {formatCurrency(curSalary)}</strong>.
                                                                        <br />
                                                                        • <strong>{effMonthName}</strong> payroll will automatically transition to revised CTC of <strong>INR {formatCurrency(newSalary)}</strong>.
                                                                    </div>
                                                                </>
                                                            ) : (
                                                                <>
                                                                    <div style={{ fontWeight: 700, display: 'flex', alignItems: 'center', gap: '4px', marginBottom: '3px' }}>
                                                                        <span>⚡</span> <span>Immediate Revision (Effective {editRevisionEffectiveDate}):</span>
                                                                    </div>
                                                                    <div>
                                                                        This revision takes effect immediately from {editRevisionEffectiveDate} and applies to the current payroll cycle.
                                                                    </div>
                                                                </>
                                                            )}
                                                        </div>
                                                    );
                                                })()}
                                            </div>
                                        )}
                                        <div className="form-group" style={{ margin: 0 }}>
                                            <label style={{ fontWeight: 600, fontSize: '0.82rem' }}>Tax Regime</label>
                                            <select value={editTaxRegime} onChange={(e) => setEditTaxRegime(e.target.value)} style={{ width: '100%', padding: '10px 14px', borderRadius: '8px', border: '1px solid #d1d5db', outline: 'none' }}>
                                                <option value="New Regime (Section 115BAC)">New Regime (Section 115BAC)</option>
                                                <option value="Old Regime (Regular Tax Slab)">Old Regime (Regular Tax Slab)</option>
                                            </select>
                                        </div>
                                        <div style={{ border: '1px solid var(--border-glass)', padding: '12px', borderRadius: '8px', backgroundColor: 'var(--bg-glass)' }}>
                                            <span style={{ fontSize: '0.82rem', fontWeight: 600, color: 'var(--text-primary)', display: 'block', marginBottom: '8px' }}>Statutory Checks</span>
                                            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                                                {/* PF */}
                                                <div>
                                                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                                        <label style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '0.8rem', color: 'var(--text-primary)', cursor: 'pointer', margin: 0 }}>
                                                            <input type="checkbox" checked={editPfEligible} onChange={(e) => setEditPfEligible(e.target.checked)} /> Provident Fund (PF) eligible {editPfEligible && <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>(₹{editMonthlyPf}/month)</span>}
                                                        </label>
                                                        {editPfEligible && (
                                                            <button
                                                                type="button"
                                                                onClick={(e) => { e.preventDefault(); setShowEditEditPf(!showEditEditPf); }}
                                                                title="Edit PF Amount"
                                                                style={{ background: 'var(--input-bg)', border: '1px solid var(--border-glass)', borderRadius: '4px', padding: '1px 6px', fontSize: '0.7rem', color: 'var(--accent-primary)', cursor: 'pointer', fontWeight: 600 }}
                                                            >
                                                                {showEditEditPf ? 'Done' : '✏️ Edit'}
                                                            </button>
                                                        )}
                                                    </div>
                                                    {editPfEligible && showEditEditPf && (
                                                        <div style={{ marginTop: '4px', marginLeft: '20px' }}>
                                                            <label style={{ display: 'block', fontSize: '0.7rem', fontWeight: 600, color: 'var(--accent-primary)', marginBottom: '2px' }}>
                                                                Override PF Monthly Amount (₹)
                                                            </label>
                                                            <input 
                                                                type="number" 
                                                                value={editPfAmount} 
                                                                onChange={(e) => setEditPfAmount(e.target.value)} 
                                                                placeholder={String(editDefaultMonthlyPf)} 
                                                                min="0"
                                                                autoFocus
                                                                style={{ width: '100%', maxWidth: '200px', padding: '5px 8px', borderRadius: '6px', border: '1px solid var(--border-glass)', outline: 'none', fontSize: '0.78rem', backgroundColor: 'var(--input-bg)', color: 'var(--text-primary)' }} 
                                                            />
                                                        </div>
                                                    )}
                                                </div>

                                                <div>
                                                    <label style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '0.8rem', color: 'var(--text-primary)', cursor: 'pointer' }}>
                                                        <input 
                                                            type="checkbox" 
                                                            checked={editVpfEligible} 
                                                            onChange={(e) => {
                                                                setEditVpfEligible(e.target.checked);
                                                                if (!e.target.checked) setEditVpfAmount('');
                                                            }} 
                                                        />
                                                        Voluntary Provident Fund (VPF) eligible
                                                    </label>
                                                    {editVpfEligible && (
                                                        <div style={{ marginTop: '6px', marginLeft: '20px' }}>
                                                            <label style={{ display: 'block', fontSize: '0.72rem', fontWeight: 600, color: 'var(--accent-primary)', marginBottom: '2px' }}>
                                                                VPF Monthly Amount (₹)
                                                            </label>
                                                            <input 
                                                                type="number" 
                                                                value={editVpfAmount} 
                                                                onChange={(e) => setEditVpfAmount(e.target.value)} 
                                                                placeholder="Monthly VPF amount"
                                                                min="0"
                                                                style={{ width: '100%', maxWidth: '220px', padding: '6px 10px', borderRadius: '6px', border: '1px solid var(--border-glass)', outline: 'none', fontSize: '0.8rem', backgroundColor: 'var(--input-bg)', color: 'var(--text-primary)' }} 
                                                            />
                                                        </div>
                                                    )}
                                                </div>

                                                <label style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '0.8rem', color: 'var(--text-primary)', cursor: 'pointer' }}>
                                                    <input type="checkbox" checked={editEsiEligible} onChange={(e) => setEditEsiEligible(e.target.checked)} /> ESI eligible
                                                </label>

                                                {/* LWF */}
                                                <div>
                                                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                                        <label style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '0.8rem', color: 'var(--text-primary)', cursor: 'pointer', margin: 0 }}>
                                                            <input type="checkbox" checked={editLwfEligible} onChange={(e) => setEditLwfEligible(e.target.checked)} /> LWF eligible <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>(₹{editLwfAmount !== '' ? editLwfAmount : 60}/year)</span>
                                                        </label>
                                                        {editLwfEligible && (
                                                            <button
                                                                type="button"
                                                                onClick={(e) => { e.preventDefault(); setShowEditEditLwf(!showEditEditLwf); }}
                                                                title="Edit LWF Amount"
                                                                style={{ background: 'var(--input-bg)', border: '1px solid var(--border-glass)', borderRadius: '4px', padding: '1px 6px', fontSize: '0.7rem', color: 'var(--accent-primary)', cursor: 'pointer', fontWeight: 600 }}
                                                            >
                                                                {showEditEditLwf ? 'Done' : '✏️ Edit'}
                                                            </button>
                                                        )}
                                                    </div>
                                                    {editLwfEligible && showEditEditLwf && (
                                                        <div style={{ marginTop: '4px', marginLeft: '20px' }}>
                                                            <label style={{ display: 'block', fontSize: '0.7rem', fontWeight: 600, color: 'var(--accent-primary)', marginBottom: '2px' }}>
                                                                Override LWF Yearly Amount (₹)
                                                            </label>
                                                            <input 
                                                                type="number" 
                                                                value={editLwfAmount} 
                                                                onChange={(e) => setEditLwfAmount(e.target.value)} 
                                                                placeholder="60" 
                                                                min="0"
                                                                autoFocus
                                                                style={{ width: '100%', maxWidth: '200px', padding: '5px 8px', borderRadius: '6px', border: '1px solid var(--border-glass)', outline: 'none', fontSize: '0.78rem', backgroundColor: 'var(--input-bg)', color: 'var(--text-primary)' }} 
                                                            />
                                                        </div>
                                                    )}
                                                </div>

                                                {/* PT */}
                                                <div>
                                                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                                        <label style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '0.8rem', color: 'var(--text-primary)', cursor: 'pointer', margin: 0 }}>
                                                            <input type="checkbox" checked={editPtEligible} onChange={(e) => setEditPtEligible(e.target.checked)} /> Professional Tax (PT) Applicable
                                                        </label>
                                                    </div>

                                                    {editPtEligible && (
                                                        <div style={{ marginTop: '6px', marginLeft: '16px', display: 'flex', flexDirection: 'column', gap: '8px', background: 'var(--input-bg)', padding: '8px 10px', borderRadius: '6px', border: '1px solid var(--border-glass)' }}>
                                                            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: '8px' }}>
                                                                <div>
                                                                    <label style={{ display: 'block', fontSize: '0.7rem', fontWeight: 600, color: 'var(--accent-primary)', marginBottom: '2px' }}>
                                                                        PT State Jurisdiction *
                                                                    </label>
                                                                    <select
                                                                        value={editPtStateCode}
                                                                        onChange={(e) => {
                                                                            setEditPtStateCode(e.target.value);
                                                                            setEditPtAmount('');
                                                                        }}
                                                                        style={{ width: '100%', padding: '5px 8px', borderRadius: '4px', border: '1px solid var(--border-glass)', outline: 'none', fontSize: '0.78rem', backgroundColor: 'var(--bg-glass)', color: 'var(--text-primary)' }}
                                                                    >
                                                                        {(ptStatesList.length > 0 ? ptStatesList : ALL_INDIAN_STATES)
                                                                            .slice()
                                                                            .sort((a, b) => (a.stateName || '').localeCompare(b.stateName || ''))
                                                                            .map(s => (
                                                                                <option key={s.id || s.stateCode} value={s.stateCode}>
                                                                                    {s.stateName} ({s.stateCode}) {s.maxAnnualPt > 0 ? `[Max ₹${s.maxAnnualPt}/yr]` : '[Exempt]'}
                                                                                </option>
                                                                            ))
                                                                        }
                                                                    </select>
                                                                </div>

                                                                <div>
                                                                    <label style={{ display: 'block', fontSize: '0.7rem', fontWeight: 600, color: 'var(--accent-primary)', marginBottom: '2px' }}>
                                                                        Manual Monthly Override (₹)
                                                                    </label>
                                                                    <input 
                                                                        type="number" 
                                                                        value={editPtAmount} 
                                                                        onChange={(e) => setEditPtAmount(e.target.value)} 
                                                                        placeholder="Leave empty for dynamic slabs" 
                                                                        min="0"
                                                                        style={{ width: '100%', padding: '5px 8px', borderRadius: '4px', border: '1px solid var(--border-glass)', outline: 'none', fontSize: '0.78rem', backgroundColor: 'var(--bg-glass)', color: 'var(--text-primary)' }} 
                                                                    />
                                                                </div>
                                                            </div>

                                                            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginTop: '2px' }}>
                                                                <input
                                                                    type="checkbox"
                                                                    id="editPtExemptionCheck"
                                                                    checked={editPtExemption}
                                                                    onChange={(e) => setEditPtExemption(e.target.checked)}
                                                                    style={{ cursor: 'pointer' }}
                                                                />
                                                                <label htmlFor="editPtExemptionCheck" style={{ fontSize: '0.72rem', fontWeight: 600, color: '#ef4444', cursor: 'pointer', margin: 0 }}>
                                                                    Exempt this employee from Professional Tax
                                                                </label>
                                                            </div>

                                                            {editPtExemption && (
                                                                <div style={{ display: 'grid', gridTemplateColumns: '1fr 2fr', gap: '6px', marginTop: '2px' }}>
                                                                    <div>
                                                                        <label style={{ display: 'block', fontSize: '0.68rem', color: 'var(--text-muted)', fontWeight: 600, marginBottom: '2px' }}>Exemption Type</label>
                                                                        <select
                                                                            value={editPtExemptionType}
                                                                            onChange={(e) => setEditPtExemptionType(e.target.value)}
                                                                            style={{ width: '100%', padding: '4px 6px', borderRadius: '4px', border: '1px solid var(--border-glass)', fontSize: '0.72rem', backgroundColor: 'var(--bg-glass)', color: 'var(--text-primary)' }}
                                                                        >
                                                                            <option value="DISABILITY">Disability (Physically Challenged)</option>
                                                                            <option value="AGE">Senior Citizen / Age</option>
                                                                            <option value="GENDER">Gender Exemption</option>
                                                                            <option value="CUSTOM">Custom Statutory Order</option>
                                                                        </select>
                                                                    </div>
                                                                    <div>
                                                                        <label style={{ display: 'block', fontSize: '0.68rem', color: 'var(--text-muted)', fontWeight: 600, marginBottom: '2px' }}>Exemption Reason / Ref</label>
                                                                        <input
                                                                            type="text"
                                                                            value={editPtExemptionReason}
                                                                            onChange={(e) => setEditPtExemptionReason(e.target.value)}
                                                                            placeholder="e.g. Order ref / disability cert"
                                                                            style={{ width: '100%', padding: '4px 6px', borderRadius: '4px', border: '1px solid var(--border-glass)', fontSize: '0.72rem', backgroundColor: 'var(--bg-glass)', color: 'var(--text-primary)' }}
                                                                        />
                                                                    </div>
                                                                </div>
                                                            )}
                                                        </div>
                                                    )}
                                                </div>
                                            </div>
                                        </div>
                                    </div>

                                    {/* Breakdown Preview during Editing */}
                                    <div style={{ flex: 1.2, minWidth: '320px', border: '1px solid #e5e7eb', borderRadius: '8px', overflow: 'hidden' }}>
                                        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.8rem', textAlign: 'left' }}>
                                            <thead>
                                                <tr style={{ backgroundColor: 'var(--table-header)', borderBottom: '1px solid var(--border-glass)' }}>
                                                    <th style={{ padding: '8px 10px', color: 'var(--text-muted)', fontWeight: 600 }}>DETAILS</th>
                                                    <th style={{ padding: '8px 10px', color: 'var(--text-muted)', fontWeight: 600, textAlign: 'right' }}>MONTHLY</th>
                                                    <th style={{ padding: '8px 10px', color: 'var(--text-muted)', fontWeight: 600, textAlign: 'right' }}>ANNUALLY</th>
                                                </tr>
                                            </thead>
                                            <tbody>
                                                <tr style={{ borderBottom: '1px solid var(--border-glass)' }}>
                                                    <td style={{ padding: '8px 10px', color: 'var(--text-primary)' }}>Basic</td>
                                                    <td style={{ padding: '8px 10px', textAlign: 'right', color: 'var(--text-primary)' }}>{formatCurrency(editMonthlyBasic)}</td>
                                                    <td style={{ padding: '8px 10px', textAlign: 'right', color: 'var(--text-primary)' }}>{formatCurrency(editAnnualBasic)}</td>
                                                </tr>
                                                <tr style={{ borderBottom: '1px solid var(--border-glass)' }}>
                                                    <td style={{ padding: '8px 10px', color: 'var(--text-primary)' }}>HRA</td>
                                                    <td style={{ padding: '8px 10px', textAlign: 'right', color: 'var(--text-primary)' }}>{formatCurrency(editMonthlyHra)}</td>
                                                    <td style={{ padding: '8px 10px', textAlign: 'right', color: 'var(--text-primary)' }}>{formatCurrency(editAnnualHra)}</td>
                                                </tr>
                                                <tr style={{ borderBottom: '1px solid var(--border-glass)' }}>
                                                    <td style={{ padding: '8px 10px', color: 'var(--text-primary)' }}>Other Allowance</td>
                                                    <td style={{ padding: '8px 10px', textAlign: 'right', color: 'var(--text-primary)' }}>{formatCurrency(editMonthlyOther)}</td>
                                                    <td style={{ padding: '8px 10px', textAlign: 'right', color: 'var(--text-primary)' }}>{formatCurrency(editAnnualOther)}</td>
                                                </tr>
                                                <tr style={{ borderBottom: '1px solid var(--border-glass)', backgroundColor: 'var(--input-bg)', fontWeight: 600 }}>
                                                    <td style={{ padding: '8px 10px', color: 'var(--text-primary)' }}>TOTAL GROSS</td>
                                                    <td style={{ padding: '8px 10px', textAlign: 'right', color: 'var(--accent-primary)' }}>INR {formatCurrency(editMonthlyGross)}</td>
                                                    <td style={{ padding: '8px 10px', textAlign: 'right', color: 'var(--accent-primary)' }}>INR {formatCurrency(editSalary)}</td>
                                                </tr>

                                                {/* Deductions */}
                                                <tr style={{ backgroundColor: 'var(--table-header)', borderBottom: '1px solid var(--border-glass)' }}>
                                                    <td colSpan="3" style={{ padding: '6px 10px', fontWeight: 600, color: 'var(--text-muted)', fontSize: '0.72rem' }}>DEDUCTIONS</td>
                                                </tr>
                                                <tr style={{ borderBottom: '1px solid var(--border-glass)' }}>
                                                    <td style={{ padding: '8px 10px', color: 'var(--text-primary)' }}>PF Employee</td>
                                                    <td style={{ padding: '8px 10px', textAlign: 'right', color: 'var(--text-primary)' }}>{editMonthlyPf > 0 ? formatCurrency(editMonthlyPf) : '-'}</td>
                                                    <td style={{ padding: '8px 10px', textAlign: 'right', color: 'var(--text-primary)' }}>{editAnnualPf > 0 ? formatCurrency(editAnnualPf) : '-'}</td>
                                                </tr>
                                                {editVpfEligible && editMonthlyVpf > 0 && (
                                                    <tr style={{ borderBottom: '1px solid var(--border-glass)', backgroundColor: 'rgba(124, 58, 237, 0.08)' }}>
                                                        <td style={{ padding: '8px 10px', color: '#a78bfa', fontWeight: 500 }}>VPF Employee</td>
                                                        <td style={{ padding: '8px 10px', textAlign: 'right', color: '#a78bfa', fontWeight: 600 }}>{formatCurrency(editMonthlyVpf)}</td>
                                                        <td style={{ padding: '8px 10px', textAlign: 'right', color: '#a78bfa', fontWeight: 600 }}>{formatCurrency(editAnnualVpf)}</td>
                                                    </tr>
                                                )}
                                                <tr style={{ borderBottom: '1px solid var(--border-glass)' }}>
                                                    <td style={{ padding: '8px 10px', color: 'var(--text-primary)' }}>ESI Employee</td>
                                                    <td style={{ padding: '8px 10px', textAlign: 'right', color: 'var(--text-primary)' }}>{editMonthlyEsi > 0 ? formatCurrency(editMonthlyEsi) : '-'}</td>
                                                    <td style={{ padding: '8px 10px', textAlign: 'right', color: 'var(--text-primary)' }}>{editAnnualEsi > 0 ? formatCurrency(editAnnualEsi) : '-'}</td>
                                                </tr>
                                                {editLwfEligible && (
                                                    <tr style={{ borderBottom: '1px solid var(--border-glass)' }}>
                                                        <td style={{ padding: '8px 10px', color: 'var(--text-primary)' }}>LWF Employee</td>
                                                        <td style={{ padding: '8px 10px', textAlign: 'right', color: 'var(--text-primary)' }}>{formatCurrency(editMonthlyLwf)}</td>
                                                        <td style={{ padding: '8px 10px', textAlign: 'right', color: 'var(--text-primary)' }}>{formatCurrency(editAnnualLwf)}</td>
                                                    </tr>
                                                )}
                                                {editPtEligible && (
                                                    <tr style={{ borderBottom: '1px solid var(--border-glass)' }}>
                                                        <td style={{ padding: '8px 10px', color: 'var(--text-primary)' }}>Professional Tax (PT)</td>
                                                        <td style={{ padding: '8px 10px', textAlign: 'right', color: 'var(--text-primary)' }}>{formatCurrency(editMonthlyPt)}</td>
                                                        <td style={{ padding: '8px 10px', textAlign: 'right', color: 'var(--text-primary)' }}>{formatCurrency(editAnnualPt)}</td>
                                                    </tr>
                                                )}

                                                <tr style={{ backgroundColor: 'rgba(37, 99, 235, 0.1)', fontWeight: 700, borderTop: '1px solid var(--border-glass)' }}>
                                                    <td style={{ padding: '9px 10px', color: 'var(--accent-primary)' }}>NET PAY</td>
                                                    <td style={{ padding: '9px 10px', textAlign: 'right', color: 'var(--accent-primary)' }}>INR {formatCurrency(editMonthlyNet)}</td>
                                                    <td style={{ padding: '9px 10px', textAlign: 'right', color: 'var(--accent-primary)' }}>INR {formatCurrency(editAnnualNet)}</td>
                                                </tr>
                                            </tbody>
                                        </table>
                                    </div>
                                </div>
                            </div>

                            {/* Custom Fields Edit */}
                            <div style={{ border: '1px solid #e2e8f0', padding: '16px', borderRadius: '8px' }}>
                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
                                    <h4 style={{ margin: 0, color: '#4f46e5' }}>Edit Dynamic Custom Fields</h4>
                                    <button 
                                        type="button" 
                                        className="btn btn-outline" 
                                        style={{ padding: '4px 10px', fontSize: '0.78rem', border: '1px solid #4f46e5', color: '#4f46e5', background: 'none', borderRadius: '6px', cursor: 'pointer' }}
                                        onClick={() => {
                                            const label = prompt("Enter Custom Field Label/Name (e.g. Blood Group):");
                                            if (label && label.trim()) {
                                                setEditDynamicFields(prev => ({
                                                    ...prev,
                                                    [label.trim()]: ''
                                                }));
                                            }
                                        }}
                                    >
                                        + Add Field
                                    </button>
                                </div>
                                <div style={{ display: 'flex', gap: '15px', flexWrap: 'wrap' }}>
                                    {Object.entries(editDynamicFields).filter(([lbl]) => !SYSTEM_CUSTOM_FIELD_KEYS.has(lbl)).map(([lbl, val]) => (
                                        <div key={lbl} className="form-group" style={{ flex: '1 1 200px', margin: 0 }}>
                                            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '4px' }}>
                                                <label style={{ fontWeight: 600, fontSize: '0.8rem' }}>{lbl}</label>
                                                <button 
                                                    type="button" 
                                                    style={{ background: 'none', border: 'none', color: '#ef4444', cursor: 'pointer', fontSize: '0.75rem', padding: 0 }}
                                                    onClick={() => {
                                                        const copy = { ...editDynamicFields };
                                                        delete copy[lbl];
                                                        setEditDynamicFields(copy);
                                                    }}
                                                >
                                                    Remove
                                                </button>
                                            </div>
                                            <input 
                                                type="text" 
                                                value={val} 
                                                onChange={(e) => {
                                                    setEditDynamicFields(prev => ({
                                                        ...prev,
                                                        [lbl]: e.target.value
                                                    }));
                                                }}
                                                style={{ width: '100%', padding: '10px 14px', borderRadius: '8px', border: '1px solid #d1d5db', outline: 'none' }}
                                            />
                                        </div>
                                    ))}
                                    {Object.entries(editDynamicFields).filter(([lbl]) => !SYSTEM_CUSTOM_FIELD_KEYS.has(lbl)).length === 0 && (
                                        <span style={{ fontStyle: 'italic', color: '#9ca3af', fontSize: '0.8rem' }}>No custom fields added.</span>
                                    )}
                                </div>
                            </div>

                            {/* Submit & Cancel Buttons */}
                            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px' }}>
                                <button 
                                    type="button" 
                                    className="btn btn-secondary" 
                                    onClick={() => {
                                        setIsEditing(false);
                                        localStorage.setItem('isEditingEmployee', 'false');
                                    }}
                                    style={{ padding: '10px 20px', borderRadius: '8px', fontSize: '0.88rem', fontWeight: 600, cursor: 'pointer' }}
                                >
                                    Cancel Edit
                                </button>
                                <button 
                                    type="submit" 
                                    className="btn btn-primary" 
                                    disabled={loading} 
                                    style={{ padding: '10px 30px', borderRadius: '8px', fontSize: '0.88rem', fontWeight: 600 }}
                                >
                                    {loading ? 'Saving...' : 'Save Profile Changes'}
                                </button>
                            </div>
                        </form>
                    )}
                </div>
            )}

            
            {/* Directory Table View - Hidden when Editing / Viewing an Employee */}
            {!viewingEmployee && !showAddForm && (
            <>
            {/* Unified Enterprise Single-Row Toolbar (Keka & Zoho People Benchmark) */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '10px', background: 'var(--bg-glass)', border: '1px solid var(--border-glass)', padding: '6px 12px', borderRadius: '10px', boxShadow: 'var(--shadow-sm)', margin: '0 0 10px 0' }}>
                {/* Left: Status Filter Pills */}
                <div style={{ display: 'flex', background: 'var(--input-bg)', padding: '3px', borderRadius: '8px', gap: '3px', border: '1px solid var(--border-glass)' }}>
                    <button
                        type="button"
                        onClick={() => setActiveStatusTab('ACTIVE')}
                        style={{
                            padding: '4px 12px',
                            height: '30px',
                            border: activeStatusTab === 'ACTIVE' ? '1px solid var(--border-glass)' : 'none',
                            borderRadius: '6px',
                            background: activeStatusTab === 'ACTIVE' ? 'var(--bg-glass)' : 'transparent',
                            color: activeStatusTab === 'ACTIVE' ? 'var(--accent-primary)' : 'var(--text-muted)',
                            fontWeight: activeStatusTab === 'ACTIVE' ? 700 : 500,
                            fontSize: '0.78rem',
                            cursor: 'pointer',
                            boxShadow: activeStatusTab === 'ACTIVE' ? 'var(--shadow-sm)' : 'none',
                            transition: 'all 0.15s ease',
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: '6px'
                        }}
                    >
                        <span>🟢 Active</span>
                        <span style={{ fontSize: '0.7rem', background: activeStatusTab === 'ACTIVE' ? 'var(--accent-light)' : 'rgba(255,255,255,0.06)', color: activeStatusTab === 'ACTIVE' ? 'var(--accent-primary)' : 'var(--text-muted)', padding: '1px 6px', borderRadius: '10px', fontWeight: 700 }}>
                            {employees.filter(e => (e.status || 'ACTIVE') === 'ACTIVE').length}
                        </span>
                    </button>
                    <button
                        type="button"
                        onClick={() => setActiveStatusTab('PAST')}
                        style={{
                            padding: '4px 12px',
                            height: '30px',
                            border: activeStatusTab === 'PAST' ? '1px solid var(--border-glass)' : 'none',
                            borderRadius: '6px',
                            background: activeStatusTab === 'PAST' ? 'var(--bg-glass)' : 'transparent',
                            color: activeStatusTab === 'PAST' ? '#f87171' : 'var(--text-muted)',
                            fontWeight: activeStatusTab === 'PAST' ? 700 : 500,
                            fontSize: '0.78rem',
                            cursor: 'pointer',
                            boxShadow: activeStatusTab === 'PAST' ? 'var(--shadow-sm)' : 'none',
                            transition: 'all 0.15s ease',
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: '6px'
                        }}
                    >
                        <span>⚫ Past / Inactive</span>
                        <span style={{ fontSize: '0.7rem', background: activeStatusTab === 'PAST' ? 'rgba(239, 68, 68, 0.15)' : 'rgba(255,255,255,0.06)', color: activeStatusTab === 'PAST' ? '#f87171' : 'var(--text-muted)', padding: '1px 6px', borderRadius: '10px', fontWeight: 700 }}>
                            {employees.filter(e => e.status === 'PAST').length}
                        </span>
                    </button>
                </div>

                {/* Right: Search + Role Filter */}
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flex: 1, justifyContent: 'flex-end' }}>
                    <div style={{ position: 'relative', flex: '1 1 180px', minWidth: '150px' }}>
                        <i className="fa fa-search" style={{ position: 'absolute', left: '10px', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)', fontSize: '0.75rem' }}></i>
                        <input 
                            type="text"
                            placeholder="Search name, email, ID..."
                            value={searchTerm}
                            onChange={(e) => setSearchTerm(e.target.value)}
                            style={{
                                width: '100%',
                                height: '32px',
                                padding: '4px 10px 4px 28px',
                                borderRadius: '6px',
                                border: '1px solid var(--border-glass)',
                                fontSize: '0.78rem',
                                outline: 'none',
                                backgroundColor: 'var(--input-bg)',
                                color: 'var(--text-primary)'
                            }}
                        />
                    </div>

                    <select
                        value={filterDesignation}
                        onChange={(e) => setFilterDesignation(e.target.value)}
                        style={{
                            height: '32px',
                            padding: '4px 10px',
                            borderRadius: '6px',
                            border: '1px solid var(--border-glass)',
                            fontSize: '0.78rem',
                            outline: 'none',
                            backgroundColor: 'var(--input-bg)',
                            color: 'var(--text-primary)'
                        }}
                    >
                        <option value="ALL">All Roles</option>
                        <option value="FIELD">Field Officer</option>
                        <option value="OFFICE">Office Officer</option>
                    </select>
                </div>
            </div>

            {/* Table Panel */}
            <div className="table-container glass" style={{ marginTop: 0 }}>
                <div className="desktop-table-view">
                    <table id="employees-table">
                    <thead>
                        {activeStatusTab === 'PAST' ? (
                            <tr>
                                <th>ID</th>
                                <th>Name</th>
                                <th>Department</th>
                                <th>Contact Number</th>
                                <th>Notice Date</th>
                                <th>Effective Date</th>
                                <th>Exit Type</th>
                                <th>Actions</th>
                            </tr>
                        ) : (
                            <tr>
                                <th>ID</th>
                                <th>Name</th>
                                <th>Email</th>
                                <th>Type</th>
                                <th>Actions</th>
                            </tr>
                        )}
                    </thead>
                    <tbody>
                        {filteredEmployees.length === 0 ? (
                            <tr>
                                <td colSpan="5" style={{ textAlign: 'center', padding: '30px', color: '#9ca3af' }}>No employees matched the search filter criteria.</td>
                            </tr>
                        ) : (
                            filteredEmployees.map(emp => (
                                <tr 
                                    key={emp.id} 
                                    onClick={() => {
                                        if (activeStatusTab === 'PAST') {
                                            handleEditClick(emp);
                                        }
                                    }} 
                                    style={{ cursor: activeStatusTab === 'PAST' ? 'pointer' : 'default' }}
                                    title={activeStatusTab === 'PAST' ? "View Profile & Details" : ""}
                                >
                                    <td style={{ fontWeight: 600 }}>{emp.empCode || emp.id}</td>
                                    <td style={{ fontWeight: 500 }}>
                                        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                                            {(emp.profilePhotoUrl || emp.avatar) && getFullUrl(emp.profilePhotoUrl || emp.avatar) ? (
                                                <img 
                                                    src={getFullUrl(emp.profilePhotoUrl || emp.avatar)} 
                                                    alt={emp.name} 
                                                    onError={(e) => {
                                                        e.currentTarget.onerror = null;
                                                        e.currentTarget.style.display = 'none';
                                                        if (e.currentTarget.nextSibling) {
                                                            e.currentTarget.nextSibling.style.display = 'flex';
                                                        }
                                                    }}
                                                    style={{ width: '32px', height: '32px', borderRadius: '50%', objectFit: 'cover', border: '1px solid #cbd5e1' }}
                                                />
                                            ) : null}
                                            <div style={{ 
                                                width: '32px', 
                                                height: '32px', 
                                                borderRadius: '50%', 
                                                backgroundColor: '#6366f1', 
                                                color: '#fff', 
                                                display: ((emp.profilePhotoUrl || emp.avatar) && getFullUrl(emp.profilePhotoUrl || emp.avatar)) ? 'none' : 'flex', 
                                                alignItems: 'center', 
                                                justifyContent: 'center', 
                                                fontWeight: 600,
                                                fontSize: '0.82rem'
                                            }}>
                                                {emp.name ? emp.name.charAt(0).toUpperCase() : '?'}
                                            </div>
                                            {emp.name}
                                        </div>
                                    </td>
                                    
                                    {activeStatusTab === 'PAST' ? (
                                        <>
                                            <td style={{ color: 'var(--text-secondary)' }}>{emp.department || '-'}</td>
                                            <td style={{ color: 'var(--text-secondary)' }}>{emp.phoneNo ? `${emp.countryCode || '+91'} ${emp.phoneNo}` : '-'}</td>
                                            <td style={{ color: 'var(--text-secondary)' }}>{emp.exitNoticeDate || '-'}</td>
                                            <td style={{ color: 'var(--text-secondary)' }}>{emp.exitDate || '-'}</td>
                                            <td>
                                                {emp.exitReason ? (
                                                    <span style={{
                                                        padding: '4px 8px',
                                                        borderRadius: '6px',
                                                        fontSize: '0.75rem',
                                                        fontWeight: 600,
                                                        backgroundColor: emp.exitReason === 'Company decides to terminate' ? 'rgba(239, 68, 68, 0.15)' : 'rgba(2, 132, 199, 0.15)',
                                                        color: emp.exitReason === 'Company decides to terminate' ? '#f87171' : '#38bdf8',
                                                        border: emp.exitReason === 'Company decides to terminate' ? '1px solid rgba(239, 68, 68, 0.3)' : '1px solid rgba(2, 132, 199, 0.3)'
                                                    }}>
                                                        {emp.exitReason === 'Company decides to terminate' ? 'Terminated' : 'Resigned'}
                                                    </span>
                                                ) : (
                                                    '-'
                                                )}
                                            </td>
                                        </>
                                    ) : (
                                        <>
                                            <td style={{ color: 'var(--text-secondary)' }}>{emp.email}</td>
                                            <td>
                                                <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
                                                    <span style={{ 
                                                        padding: '3px 8px', 
                                                        borderRadius: '6px', 
                                                        fontSize: '0.74rem', 
                                                        fontWeight: 600,
                                                        backgroundColor: emp.designation === 'FIELD' ? 'rgba(37, 99, 235, 0.15)' : 'rgba(255, 255, 255, 0.06)',
                                                        color: emp.designation === 'FIELD' ? '#60a5fa' : 'var(--text-secondary)',
                                                        border: emp.designation === 'FIELD' ? '1px solid rgba(37, 99, 235, 0.3)' : '1px solid var(--border-glass)'
                                                    }}>
                                                        {emp.designation === 'FIELD' ? 'Field Officer' : 'Office Officer'}
                                                    </span>
                                                    {emp.role === 'ADMIN' && (
                                                        <span style={{ padding: '3px 7px', borderRadius: '6px', fontSize: '0.7rem', fontWeight: 700, backgroundColor: 'rgba(147, 51, 234, 0.15)', color: '#c084fc', border: '1px solid rgba(147, 51, 234, 0.35)' }}>
                                                            👑 Admin
                                                        </span>
                                                    )}
                                                    {emp.role === 'TRACKING_MANAGER' && (
                                                        <span style={{ padding: '3px 7px', borderRadius: '6px', fontSize: '0.7rem', fontWeight: 700, backgroundColor: 'rgba(6, 182, 212, 0.15)', color: '#22d3ee', border: '1px solid rgba(6, 182, 212, 0.35)' }}>
                                                            📍 Tracking Mgr
                                                        </span>
                                                    )}
                                                    {emp.role === 'FIELD_INVOICE_MANAGER' && (
                                                        <span style={{ padding: '3px 7px', borderRadius: '6px', fontSize: '0.7rem', fontWeight: 700, backgroundColor: 'rgba(245, 158, 11, 0.15)', color: '#fbbf24', border: '1px solid rgba(245, 158, 11, 0.35)' }}>
                                                            💼 Field Mgr
                                                        </span>
                                                    )}
                                                </div>
                                            </td>
                                        </>
                                    )}
                                    
                                    <td>
                                        <div style={{ display: 'flex', gap: '8px' }} onClick={(e) => e.stopPropagation()}>
                                            <button 
                                                className="btn btn-secondary"
                                                onClick={() => handleEditClick(emp)}
                                                style={{
                                                    padding: '6px 12px',
                                                    borderRadius: '6px',
                                                    fontSize: '0.8rem',
                                                    fontWeight: 600,
                                                    cursor: 'pointer',
                                                    backgroundColor: 'var(--input-bg)',
                                                    color: 'var(--text-primary)',
                                                    border: '1px solid var(--border-glass)'
                                                }}
                                            >
                                                View
                                            </button>
                                            <button 
                                                className="btn btn-secondary"
                                                onClick={() => handleToggleStatus(emp.id, emp.status || 'ACTIVE')}
                                                style={{
                                                    padding: '6px 12px',
                                                    borderRadius: '6px',
                                                    fontSize: '0.8rem',
                                                    fontWeight: 600,
                                                    cursor: 'pointer',
                                                    backgroundColor: (emp.status || 'ACTIVE') === 'ACTIVE' ? 'rgba(245, 158, 11, 0.15)' : 'rgba(16, 185, 129, 0.15)',
                                                    color: (emp.status || 'ACTIVE') === 'ACTIVE' ? '#fbbf24' : '#34d399',
                                                    border: (emp.status || 'ACTIVE') === 'ACTIVE' ? '1px solid rgba(245, 158, 11, 0.3)' : '1px solid rgba(16, 185, 129, 0.3)'
                                                }}
                                            >
                                                {(emp.status || 'ACTIVE') === 'ACTIVE' ? 'Deactivate' : 'Activate'}
                                            </button>
                                        </div>
                                    </td>
                                </tr>
                            ))
                        )}
                    </tbody>
                </table>

                </div>

                {/* Mobile Cards View */}
                <div className="mobile-cards-only">
                    {filteredEmployees.length === 0 ? (
                        <div style={{ textAlign: 'center', padding: '30px', color: '#9ca3af', background: 'var(--card-bg)', borderRadius: '12px' }}>
                            No employees matched the search filter criteria.
                        </div>
                    ) : (
                        filteredEmployees.map(emp => (
                            <div 
                                key={emp.id} 
                                className="mobile-record-card"
                                onClick={() => {
                                    if (activeStatusTab === 'PAST') handleEditClick(emp);
                                }}
                            >
                                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px' }}>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                                        {(emp.profilePhotoUrl || emp.avatar) && getFullUrl(emp.profilePhotoUrl || emp.avatar) ? (
                                            <img 
                                                src={getFullUrl(emp.profilePhotoUrl || emp.avatar)} 
                                                alt={emp.name} 
                                                style={{ width: '36px', height: '36px', borderRadius: '50%', objectFit: 'cover' }}
                                                onError={(e) => { e.currentTarget.style.display = 'none'; }}
                                            />
                                        ) : (
                                            <div style={{ width: '36px', height: '36px', borderRadius: '50%', backgroundColor: '#6366f1', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 600, fontSize: '0.9rem' }}>
                                                {emp.name ? emp.name.charAt(0).toUpperCase() : '?'}
                                            </div>
                                        )}
                                        <div>
                                            <h4 style={{ margin: 0, fontSize: '14px', fontWeight: 700, color: 'var(--text-primary)' }}>{emp.name}</h4>
                                            <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>{emp.empCode || emp.id}</span>
                                        </div>
                                    </div>

                                    <span style={{
                                        padding: '3px 8px',
                                        borderRadius: '6px',
                                        fontSize: '11px',
                                        fontWeight: 600,
                                        backgroundColor: (emp.status || 'ACTIVE') === 'ACTIVE' ? 'rgba(16, 185, 129, 0.15)' : 'rgba(239, 68, 68, 0.15)',
                                        color: (emp.status || 'ACTIVE') === 'ACTIVE' ? '#10b981' : '#ef4444'
                                    }}>
                                        {(emp.status || 'ACTIVE')}
                                    </span>
                                </div>

                                <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap', fontSize: '12px' }}>
                                    <span style={{
                                        padding: '2px 7px',
                                        borderRadius: '4px',
                                        fontSize: '11px',
                                        fontWeight: 600,
                                        backgroundColor: emp.designation === 'FIELD' ? 'rgba(37, 99, 235, 0.15)' : 'rgba(255, 255, 255, 0.08)',
                                        color: emp.designation === 'FIELD' ? '#3b82f6' : 'var(--text-secondary)'
                                    }}>
                                        {emp.designation === 'FIELD' ? 'Field Officer' : 'Office Officer'}
                                    </span>
                                    {emp.role === 'ADMIN' && <span style={{ padding: '2px 6px', borderRadius: '4px', fontSize: '10.5px', fontWeight: 700, background: 'rgba(147, 51, 234, 0.15)', color: '#c084fc' }}>👑 Admin</span>}
                                    {emp.role === 'TRACKING_MANAGER' && <span style={{ padding: '2px 6px', borderRadius: '4px', fontSize: '10.5px', fontWeight: 700, background: 'rgba(6, 182, 212, 0.15)', color: '#22d3ee' }}>📍 Tracking Mgr</span>}
                                    {emp.department && <span style={{ color: 'var(--text-muted)' }}>• {emp.department}</span>}
                                </div>

                                {activeStatusTab === 'PAST' ? (
                                    <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
                                        Exit: {emp.exitDate || '-'} ({emp.exitReason || 'Resigned'})
                                    </div>
                                ) : (
                                    <div style={{ fontSize: '12px', color: 'var(--text-muted)', wordBreak: 'break-all' }}>
                                        {emp.email}
                                    </div>
                                )}

                                <div style={{ display: 'flex', gap: '8px', paddingTop: '8px', borderTop: '1px solid var(--border-glass, #e2e8f0)' }}>
                                    <button 
                                        type="button"
                                        className="btn btn-secondary"
                                        onClick={() => handleEditClick(emp)}
                                        style={{ flex: 1, minHeight: '38px', borderRadius: '8px', fontSize: '12px', fontWeight: 600, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                                    >
                                        View Profile
                                    </button>
                                    {activeStatusTab !== 'PAST' && (
                                        <button 
                                            type="button"
                                            className="btn btn-secondary"
                                            onClick={() => handleToggleStatus(emp.id, emp.status || 'ACTIVE')}
                                            style={{
                                                flex: 1,
                                                minHeight: '38px',
                                                borderRadius: '8px',
                                                fontSize: '12px',
                                                fontWeight: 600,
                                                cursor: 'pointer',
                                                display: 'flex',
                                                alignItems: 'center',
                                                justifyContent: 'center',
                                                backgroundColor: (emp.status || 'ACTIVE') === 'ACTIVE' ? 'rgba(245, 158, 11, 0.12)' : 'rgba(16, 185, 129, 0.12)',
                                                color: (emp.status || 'ACTIVE') === 'ACTIVE' ? '#d97706' : '#10b981'
                                            }}
                                        >
                                            {(emp.status || 'ACTIVE') === 'ACTIVE' ? 'Deactivate' : 'Activate'}
                                        </button>
                                    )}
                                </div>
                            </div>
                        ))
                    )}
                </div>
            </div>
            </>
            )}


            {/* Inline Full-Screen Document Preview Modal */}
            {docPreviewModal && (
                <div 
                    style={{
                        position: 'fixed',
                        top: 0,
                        left: 0,
                        width: '100vw',
                        height: '100vh',
                        backgroundColor: 'rgba(15, 23, 42, 0.75)',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        zIndex: 99999,
                        backdropFilter: 'blur(4px)'
                    }}
                    onClick={() => setDocPreviewModal(null)}
                >
                    <div 
                        style={{
                            position: 'relative',
                            width: '88%',
                            maxWidth: '900px',
                            height: '85vh',
                            backgroundColor: 'var(--bg-glass)',
                            border: '1px solid var(--border-glass)',
                            borderRadius: '16px',
                            overflow: 'hidden',
                            display: 'flex',
                            flexDirection: 'column',
                            boxShadow: 'var(--shadow-xl)'
                        }}
                        onClick={e => e.stopPropagation()}
                    >
                        {/* Preview Header */}
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '14px 20px', borderBottom: '1px solid var(--border-glass)', background: 'var(--table-header)' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                                <span style={{ fontSize: '1.2rem' }}>{docPreviewModal.isPdf ? '📄' : '🖼️'}</span>
                                <h4 style={{ margin: 0, fontSize: '1rem', fontWeight: 700, color: 'var(--text-primary)' }}>{docPreviewModal.title || 'Document Preview'}</h4>
                            </div>
                            <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
                                <button 
                                    onClick={() => forceDownload(docPreviewModal.url, docPreviewModal.title || 'document')}
                                    className="btn btn-primary"
                                    style={{ padding: '6px 14px', fontSize: '0.8rem', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '6px' }}
                                >
                                    ⬇️ Download
                                </button>
                                <button 
                                    onClick={() => window.open(docPreviewModal.url, '_blank')}
                                    className="btn btn-outline"
                                    style={{ padding: '6px 14px', fontSize: '0.8rem', fontWeight: 600 }}
                                >
                                    ↗️ Open in New Tab
                                </button>
                                <button 
                                    onClick={() => setDocPreviewModal(null)}
                                    style={{ background: 'none', border: 'none', fontSize: '1.8rem', cursor: 'pointer', color: 'var(--text-muted)', padding: '0 8px', lineHeight: 1 }}
                                >
                                    &times;
                                </button>
                            </div>
                        </div>

                        {/* Preview Body */}
                        <div style={{ flex: 1, backgroundColor: 'var(--input-bg)', display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }}>
                            {docPreviewModal.isPdf ? (
                                <iframe 
                                    src={docPreviewModal.url} 
                                    title={docPreviewModal.title}
                                    style={{ width: '100%', height: '100%', border: 'none' }}
                                />
                            ) : (
                                <img 
                                    src={docPreviewModal.url} 
                                    alt={docPreviewModal.title} 
                                    style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain', padding: '16px' }}
                                />
                            )}
                        </div>
                    </div>
                </div>
            )}


            {/* INITIATE EXIT MODAL */}
            {showExitModal && (
                <div style={{
                    position: 'fixed',
                    top: 0,
                    left: 0,
                    right: 0,
                    bottom: 0,
                    backgroundColor: 'rgba(15, 23, 42, 0.45)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    zIndex: 9999,
                    backdropFilter: 'blur(4px)'
                }}>
                    <div className="glass" style={{
                        backgroundColor: 'var(--bg-glass)',
                        border: '1px solid var(--border-glass)',
                        borderRadius: '16px',
                        width: '90%',
                        maxWidth: '550px',
                        padding: '24px',
                        boxShadow: 'var(--shadow-xl)',
                        display: 'flex',
                        flexDirection: 'column',
                        gap: '20px'
                    }}>
                        {/* Modal Header */}
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid var(--border-glass)', paddingBottom: '12px' }}>
                            <h3 style={{ margin: 0, fontSize: '1.2rem', fontWeight: 700, color: 'var(--text-primary)' }}>Initiate exit - {exitEmployeeName}</h3>
                            <button 
                                onClick={() => setShowExitModal(false)}
                                style={{ background: 'none', border: 'none', fontSize: '1.3rem', cursor: 'pointer', color: 'var(--text-muted)' }}
                            >
                                &times;
                            </button>
                        </div>

                        {/* Employee Meta Summary */}
                        <div style={{ display: 'flex', gap: '15px', alignItems: 'center', backgroundColor: 'var(--input-bg)', padding: '12px 16px', borderRadius: '12px', border: '1px solid var(--border-glass)' }}>
                            <div style={{
                                width: '48px',
                                height: '48px',
                                borderRadius: '50%',
                                backgroundColor: 'var(--accent-primary)',
                                color: '#ffffff',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                fontWeight: 700,
                                fontSize: '1.1rem'
                            }}>
                                {exitEmployeeName ? exitEmployeeName.charAt(0) : '?'}
                            </div>
                            <div>
                                <h4 style={{ margin: 0, fontSize: '0.95rem', fontWeight: 700, color: 'var(--text-primary)' }}>{exitEmployeeName}</h4>
                                <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)', fontWeight: 500 }}>
                                    {exitEmployeeDesignation === 'FIELD' ? 'Field Staff' : 'Office Staff'}
                                </span>
                            </div>
                            <div style={{ marginLeft: 'auto', textAlign: 'right', fontSize: '0.78rem', color: 'var(--text-muted)' }}>
                                <div><strong style={{ color: 'var(--text-primary)' }}>Dept:</strong> {exitEmployeeDept || '-'}</div>
                                <div><strong style={{ color: '#475569' }}>DOJ:</strong> {formatDate(exitEmployeeJoining) || '-'}</div>
                            </div>
                        </div>

                        {/* Form Inputs */}
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '15px', maxHeight: '400px', overflowY: 'auto', paddingRight: '4px' }}>
                            
                            {/* Question 1: Exit Reason */}
                            <div className="form-group" style={{ margin: 0 }}>
                                <label style={{ fontWeight: 600, fontSize: '0.82rem', display: 'block', marginBottom: '8px' }}>What is the reason for initiating this exit?</label>
                                <div style={{ display: 'flex', gap: '20px' }}>
                                    <label style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '0.85rem', cursor: 'pointer' }}>
                                        <input 
                                            type="radio" 
                                            name="exitReason" 
                                            checked={exitReason === 'Employee wants to resign'} 
                                            onChange={() => setExitReason('Employee wants to resign')}
                                        /> Employee wants to resign
                                    </label>
                                    <label style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '0.85rem', cursor: 'pointer' }}>
                                        <input 
                                            type="radio" 
                                            name="exitReason" 
                                            checked={exitReason === 'Company decides to terminate'} 
                                            onChange={() => setExitReason('Company decides to terminate')}
                                        /> Company decides to terminate
                                    </label>
                                </div>
                            </div>

                            {/* Question 2: Discussed with Employee */}
                            <div className="form-group" style={{ margin: 0 }}>
                                <label style={{ fontWeight: 600, fontSize: '0.82rem', display: 'block', marginBottom: '8px' }}>Did you have discussion with employee regarding this?</label>
                                <div style={{ display: 'flex', gap: '20px' }}>
                                    <label style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '0.85rem', cursor: 'pointer' }}>
                                        <input 
                                            type="radio" 
                                            name="exitDiscussed" 
                                            checked={exitDiscussed === true} 
                                            onChange={() => setExitDiscussed(true)}
                                        /> Yes
                                    </label>
                                    <label style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '0.85rem', cursor: 'pointer' }}>
                                        <input 
                                            type="radio" 
                                            name="exitDiscussed" 
                                            checked={exitDiscussed === false} 
                                            onChange={() => setExitDiscussed(false)}
                                        /> No
                                    </label>
                                </div>
                            </div>

                            {/* Question 3: Discussion Summary */}
                            <div className="form-group" style={{ margin: 0 }}>
                                <label style={{ fontWeight: 600, fontSize: '0.82rem', display: 'block', marginBottom: '4px' }}>Discussion Summary</label>
                                <textarea 
                                    rows="2"
                                    placeholder="Type here" 
                                    value={exitDiscussionSummary}
                                    onChange={(e) => setExitDiscussionSummary(e.target.value)}
                                    style={{ width: '100%', padding: '10px 14px', borderRadius: '8px', border: '1px solid #d1d5db', outline: 'none', resize: 'vertical', fontSize: '0.85rem' }}
                                />
                            </div>

                            {/* Date Field - dynamically labeled */}
                            <div className="form-group" style={{ margin: 0 }}>
                                <label style={{ fontWeight: 600, fontSize: '0.82rem', display: 'block', marginBottom: '4px' }}>
                                    {exitReason === 'Company decides to terminate' ? 'Termination notice date' : 'Resignation date'}
                                </label>
                                <input 
                                    type="date"
                                    value={exitNoticeDate}
                                    onChange={(e) => setExitNoticeDate(e.target.value)}
                                    style={{ width: '100%', padding: '10px 14px', borderRadius: '8px', border: '1px solid #d1d5db', outline: 'none', fontSize: '0.85rem' }}
                                />
                            </div>

                            {/* Effective deactivation / exit date */}
                            <div className="form-group" style={{ margin: 0 }}>
                                <label style={{ fontWeight: 600, fontSize: '0.82rem', display: 'block', marginBottom: '4px' }}>
                                    Deactivation Effective Date (Last Working Day)
                                </label>
                                <input 
                                    type="date"
                                    value={exitDate}
                                    onChange={(e) => setExitDate(e.target.value)}
                                    style={{ width: '100%', padding: '10px 14px', borderRadius: '8px', border: '1px solid #d1d5db', outline: 'none', fontSize: '0.85rem' }}
                                />
                            </div>

                            {/* Conditional termination fields */}
                            {exitReason === 'Company decides to terminate' && (
                                <>
                                    {/* Termination Reason */}
                                    <div className="form-group" style={{ margin: 0 }}>
                                        <label style={{ fontWeight: 600, fontSize: '0.82rem', display: 'block', marginBottom: '4px' }}>Reason for termination</label>
                                        <select 
                                            value={exitTerminationReason}
                                            onChange={(e) => setExitTerminationReason(e.target.value)}
                                            style={{ width: '100%', padding: '10px 14px', borderRadius: '8px', border: '1px solid #d1d5db', outline: 'none', fontSize: '0.85rem' }}
                                        >
                                            <option value="Absconding">Absconding</option>
                                            <option value="Death">Death</option>
                                            <option value="Medical Condition">Medical Condition</option>
                                            <option value="Misconduct">Misconduct</option>
                                            <option value="Performance Issue">Performance Issue</option>
                                        </select>
                                    </div>

                                    {/* Additional Comments */}
                                    <div className="form-group" style={{ margin: 0 }}>
                                        <label style={{ fontWeight: 600, fontSize: '0.82rem', display: 'block', marginBottom: '4px' }}>Additional comments</label>
                                        <textarea 
                                            rows="2"
                                            placeholder="Type here" 
                                            value={exitComments}
                                            onChange={(e) => setExitComments(e.target.value)}
                                            style={{ width: '100%', padding: '10px 14px', borderRadius: '8px', border: '1px solid #d1d5db', outline: 'none', resize: 'vertical', fontSize: '0.85rem' }}
                                        />
                                    </div>
                                </>
                            )}
                        </div>

                        {/* Modal Actions */}
                        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '12px', borderTop: '1px solid #e2e8f0', paddingTop: '15px', marginTop: '5px' }}>
                            <button 
                                type="button" 
                                className="btn btn-secondary" 
                                onClick={() => setShowExitModal(false)}
                                style={{ padding: '8px 16px', borderRadius: '8px', fontSize: '0.85rem', fontWeight: 600, cursor: 'pointer' }}
                            >
                                Cancel
                            </button>
                            <button 
                                type="button" 
                                className="btn btn-primary"
                                onClick={submitExitProcess}
                                disabled={loading}
                                style={{
                                    padding: '8px 24px', 
                                    borderRadius: '8px', 
                                    fontSize: '0.85rem', 
                                    fontWeight: 600, 
                                    backgroundColor: '#ef4444',
                                    borderColor: '#ef4444',
                                    color: '#ffffff',
                                    cursor: 'pointer'
                                }}
                            >
                                {loading ? 'Processing...' : 'Initiate exit'}
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Fullscreen Image Preview Lightbox Modal (Same Tab, Cut / Close Option) */}
            {previewImage && (
                <div 
                    onClick={() => setPreviewImage(null)}
                    style={{
                        position: 'fixed',
                        top: 0,
                        left: 0,
                        right: 0,
                        bottom: 0,
                        backgroundColor: 'rgba(15, 23, 42, 0.88)',
                        backdropFilter: 'blur(10px)',
                        zIndex: 99999,
                        display: 'flex',
                        flexDirection: 'column',
                        alignItems: 'center',
                        justify: 'center',
                        padding: '24px',
                        animation: 'fadeIn 0.2s ease-out'
                    }}
                >
                    <div 
                        onClick={(e) => e.stopPropagation()}
                        style={{
                            position: 'relative',
                            maxHeight: '85vh',
                            maxWidth: '90vw',
                            display: 'flex',
                            flexDirection: 'column',
                            alignItems: 'center',
                            gap: '16px',
                            background: 'rgba(30, 41, 59, 0.95)',
                            border: '1px solid rgba(255, 255, 255, 0.2)',
                            borderRadius: '20px',
                            padding: '28px 36px',
                            boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.6)'
                        }}
                    >
                        {/* Close / Cut ('✕') Button */}
                        <button
                            type="button"
                            onClick={() => setPreviewImage(null)}
                            style={{
                                position: 'absolute',
                                top: '14px',
                                right: '14px',
                                width: '36px',
                                height: '36px',
                                borderRadius: '50%',
                                background: 'rgba(255, 255, 255, 0.15)',
                                border: '1px solid rgba(255, 255, 255, 0.25)',
                                color: '#ffffff',
                                fontSize: '18px',
                                fontWeight: '800',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                cursor: 'pointer',
                                transition: 'all 0.2s ease',
                                zIndex: 10
                            }}
                            title="Close Preview (Esc)"
                            onMouseEnter={(e) => { e.currentTarget.style.background = '#ef4444'; e.currentTarget.style.borderColor = '#ef4444'; }}
                            onMouseLeave={(e) => { e.currentTarget.style.background = 'rgba(255, 255, 255, 0.15)'; e.currentTarget.style.borderColor = 'rgba(255, 255, 255, 0.25)'; }}
                        >
                            ✕
                        </button>

                        {/* Full Size Preview Image */}
                        <img 
                            src={previewImage.url} 
                            alt={previewImage.title || 'Profile Photo'} 
                            style={{
                                maxHeight: '60vh',
                                maxWidth: '75vw',
                                borderRadius: '14px',
                                objectFit: 'contain',
                                border: '3px solid rgba(255, 255, 255, 0.3)',
                                boxShadow: '0 15px 30px rgba(0,0,0,0.4)'
                            }}
                        />

                        {/* Title & Info */}
                        {previewImage.title && (
                            <div style={{ textAlign: 'center' }}>
                                <h3 style={{ margin: '0 0 4px 0', fontSize: '1.25rem', fontWeight: 800, color: '#ffffff', letterSpacing: '-0.01em' }}>
                                    {previewImage.title}
                                </h3>
                                {previewImage.subtitle && (
                                    <span style={{ fontSize: '0.85rem', color: '#94a3b8', fontWeight: 600 }}>
                                        {previewImage.subtitle}
                                    </span>
                                )}
                            </div>
                        )}
                    </div>
                </div>
            )}

            {/* Leave Balance Adjustment Modal */}
            <LeaveAdjustmentModal
                isOpen={showLeaveAdjustmentModal}
                onClose={() => {
                    setShowLeaveAdjustmentModal(false);
                    setLeaveAdjustmentEmpId(null);
                }}
                employees={employees}
                defaultEmployeeId={leaveAdjustmentEmpId}
                onSuccess={async (updatedEmp) => {
                    if (refreshEmployees) {
                        await refreshEmployees();
                    }
                    if (viewingEmployee && updatedEmp && (viewingEmployee.id === updatedEmp.id || viewingEmployee.empCode === updatedEmp.empCode)) {
                        setViewingEmployee(prev => ({
                            ...prev,
                            openingLeaveBalance: updatedEmp.openingLeaveBalance,
                            earnedLeaves: updatedEmp.openingLeaveBalance,
                            allowedLeaves: updatedEmp.allowedLeaves,
                            availableLeaves: updatedEmp.availableLeaves,
                            leaveBalance: updatedEmp.leaveBalance
                        }));
                    }
                }}
            />
        </div>
    );
}
