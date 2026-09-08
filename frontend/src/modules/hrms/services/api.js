const getApiBaseUrl = () => {
    if (import.meta.env && import.meta.env.VITE_API_URL) {
        return import.meta.env.VITE_API_URL;
    }
    const hostname = window.location.hostname || '127.0.0.1';
    return `http://${hostname}:8000/api`;
};

const API_BASE_URL = getApiBaseUrl();

class ApiService {
    constructor(baseUrl) {
        this.baseUrl = baseUrl;
    }

    getHeaders(isFormData = false) {
        const token = localStorage.getItem('adminToken');
        const headers = {};
        if (token) headers['Authorization'] = `Bearer ${token}`;
        if (!isFormData) headers['Content-Type'] = 'application/json';
        return headers;
    }

    async request(endpoint, options = {}, isFormData = false) {
        try {
            const response = await fetch(`${this.baseUrl}${endpoint}`, {
                ...options,
                headers: this.getHeaders(isFormData)
            });
            
            // Automatic session timeout redirect removed as per user requirements
            if (response.status === 401 || response.status === 403) {
                console.warn(`[Session Warning] API returned ${response.status} on ${endpoint}, bypassing timeout redirect.`);
            }

            const contentType = response.headers.get('content-type') || '';
            let data;
            if (contentType.includes('application/json')) {
                data = await response.json();
            } else {
                const text = await response.text();
                if (!response.ok) {
                    throw new Error(`Server endpoint error (${response.status}) on ${endpoint}`);
                }
                data = { rawText: text };
            }

            if (!response.ok) {
                throw new Error(data.error || 'API Request Failed');
            }
            return data;
        } catch (error) {
            console.error(`API Error on ${endpoint}:`, error);
            throw error;
        }
    }

    // ==========================================
    // 1. AUTHENTICATION MODULE
    // ==========================================
    login(email, password) {
        return this.request('/auth/login', {
            method: 'POST',
            body: JSON.stringify({ email, password })
        });
    }

    getDashboardSummary() {
        return this.request('/dashboard/summary');
    }

    // ==========================================
    // 2. EMPLOYEES MANAGEMENT
    // ==========================================
    getEmployees(params = {}) {
        const query = new URLSearchParams(params).toString();
        return this.request(`/employees${query ? `?${query}` : ''}`);
    }

    createEmployee(employeeData) {
        return this.request('/employees', {
            method: 'POST',
            body: JSON.stringify(employeeData)
        });
    }

    updateEmployee(id, employeeData) {
        return this.request(`/employees/${id}`, {
            method: 'PUT',
            body: JSON.stringify(employeeData)
        });
    }

    deleteEmployee(id) {
        return this.request(`/employees/${id}`, {
            method: 'DELETE'
        });
    }

    // ==========================================
    // 3. ATTENDANCE & LEAVES
    // ==========================================
    getAttendance(params = {}) {
        let p = params;
        if (typeof p === 'string') {
            p = { date: p };
        }
        const query = new URLSearchParams(p).toString();
        return this.request(`/attendance${query ? `?${query}` : ''}`);
    }

    getLeaves(userId = null) {
        const query = new URLSearchParams();
        if (userId) query.append('userId', userId);
        query.append('_t', Date.now());
        return this.request(`/leaves?${query.toString()}`);
    }

    updateLeaveStatus(leaveId, status) {
        return this.request(`/leaves/${leaveId}/status`, {
            method: 'PATCH',
            body: JSON.stringify({ status })
        });
    }

    // ==========================================
    // 4. GEOFENCING PROTOCOLS
    // ==========================================
    getGeofences() {
        return this.request('/geofence');
    }

    createGeofence(payload) {
        return this.request('/geofence', {
            method: 'POST',
            body: JSON.stringify(payload)
        });
    }

    bulkCreateGeofences(sites) {
        return this.request('/geofence/bulk', {
            method: 'POST',
            body: JSON.stringify({ sites })
        });
    }

    updateGeofence(id, payload) {
        return this.request(`/geofence/${id}`, {
            method: 'PUT',
            body: JSON.stringify(payload)
        });
    }

    deleteGeofence(id) {
        return this.request(`/geofence/${id}`, {
            method: 'DELETE'
        });
    }

    // ==========================================
    // 5. FOOTPRINTS TRACKING SYSTEM
    // ==========================================
    getFootprints(userId, date) {
        let url = '/footprints';
        const params = [];
        if (userId) params.push(`userId=${userId}`);
        if (date) params.push(`date=${date}`);
        if (params.length) url += `?${params.join('&')}`;
        return this.request(url);
    }

    getRouteReplay(userId, date, mode = 'osrm') {
        return this.request(`/footprints/route-replay?userId=${userId}&date=${date}&mode=${mode}`);
    }

    getLiveFootprints() {
        return this.request('/footprints/live');
    }

    getLatestAllFootprints() { // Preserved from v2 extension architecture
        return this.request('/footprints/latest-all');
    }

    getFootprintHistory(userId, date) {
        return this.request(`/footprints/history?userId=${userId}&date=${date}`);
    }

    // ==========================================
    // 6. EXPENSES ENGINE (MULTIPART FORMDATA)
    // ==========================================
    getExpenses() {
        return this.request('/expenses');
    }

    updateExpenseStatus(expenseId, status) {
        return this.request(`/expenses/${expenseId}/status`, {
            method: 'PATCH',
            body: JSON.stringify({ status })
        });
    }

    createExpense(formData) {
        return this.request('/expenses', {
            method: 'POST',
            body: formData
        }, true);
    }

    updateExpense(expenseId, formData) { // Preserved critical action method from v1
        return this.request(`/expenses/${expenseId}`, {
            method: 'PUT',
            body: formData
        }, true);
    }

    // ==========================================
    // 7. LEDGER FINANCIAL ACCOUNTING (v1 MODULE)
    // ==========================================
    getLedgerBalances() {
        return this.request('/ledger/balances');
    }

    uploadBankStatement(formData) {
        return this.request('/ledger/upload', {
            method: 'POST',
            body: formData
        }, true);
    }

    getEmployeeLedger(employeeId) {
        return this.request(`/ledger/employee/${employeeId}`);
    }

    unlinkLedgerEntry(ledgerId) {
        return this.request(`/ledger/${ledgerId}/unlink`, {
            method: 'PATCH'
        });
    }

    getUnmappedLedgers() {
        return this.request('/ledger/unmapped');
    }

    mapLedgerEntry(ledgerId, employeeId) {
        return this.request(`/ledger/${ledgerId}/map`, {
            method: 'PATCH',
            body: JSON.stringify({ employeeId })
        });
    }

    // ==========================================
    // 8. DOCUMENTS & GEOMEDIA OPERATIONS
    // ==========================================
    getDocuments(userId) {
        let url = '/hrms-documents';
        if (userId) url += `?userId=${userId}`;
        return this.request(url);
    }

    uploadDocument(formData) {
        return this.request('/hrms-documents', {
            method: 'POST',
            body: formData
        }, true);
    }

    getMedia(siteId, clusterId) { // Updated structured tracking filter format from v2
        const params = [];
        if (siteId !== undefined && siteId !== '') params.push(`site_id=${siteId}`);
        if (clusterId !== undefined && clusterId !== '') params.push(`cluster_id=${clusterId}`);
        const query = params.length > 0 ? `?${params.join('&')}` : '';
        return this.request(`/media${query}`);
    }

    // ==========================================
    // 9. SITES MANAGEMENT MODULE (v2)
    // ==========================================
    getSites() {
        return this.request('/sites');
    }

    createSite(data) {
        return this.request('/sites', {
            method: 'POST',
            body: JSON.stringify(data)
        });
    }

    updateSite(siteId, data) {
        return this.request(`/sites/${siteId}`, {
            method: 'PUT',
            body: JSON.stringify(data)
        });
    }

    deleteSite(siteId) {
        return this.request(`/sites/${siteId}`, {
            method: 'DELETE'
        });
    }

    // ==========================================
    // 10. CLUSTERING SYSTEM MODULE (v2)
    // ==========================================
    getClusters() {
        return this.request('/clusters');
    }

    getClusterSettings() {
        return this.request('/clusters/settings');
    }

    updateClusterSettings(clusterRadius) {
        return this.request('/clusters/settings', {
            method: 'POST',
            body: JSON.stringify({ clusterRadius })
        });
    }

    updateClusterName(clusterId, name) {
        return this.request(`/clusters/${clusterId}`, {
            method: 'PUT',
            body: JSON.stringify({ name })
        });
    }

    uploadProfilePhoto(employeeId, formData) {
        return this.request(`/employees/${employeeId}/profile-photo`, {
            method: 'POST',
            body: formData
        }, true);
    }

    deleteProfilePhoto(employeeId) {
        return this.request(`/employees/${employeeId}/profile-photo`, {
            method: 'DELETE'
        });
    }

    getRules() {
        return this.request('/rules');
    }

    updateRules(rulesList) {
        return this.request('/rules', {
            method: 'PUT',
            body: JSON.stringify({ rules: rulesList })
        });
    }

    // ==========================================
    // 11. PAYROLL SYSTEMS MODULE
    // ==========================================
    getPayrollDashboard() {
        return this.request('/payroll/dashboard');
    }

    getPayrollRuns() {
        return this.request('/payroll/runs');
    }

    createPayrollRun(month) {
        return this.request('/payroll/run', {
            method: 'POST',
            body: JSON.stringify({ month })
        });
    }

    deletePayrollRun(runId) {
        return this.request(`/payroll/run/${runId}`, {
            method: 'DELETE'
        });
    }

    clearAllPayrollRuns() {
        return this.request('/payroll/runs/clear-all', {
            method: 'DELETE'
        });
    }

    getDeactivatedCheck(month) {
        return this.request(`/payroll/deactivated-check?month=${month}`);
    }

    processPayroll(payrollRunId, options = {}) {
        return this.request('/payroll/process', {
            method: 'POST',
            body: JSON.stringify({ payrollRunId, ...options })
        });
    }

    getPayrollRunItems(runId) {
        return this.request(`/payroll/runs/${runId}/items`);
    }

    approvePayroll(payrollRunId) {
        return this.request('/payroll/approve', {
            method: 'POST',
            body: JSON.stringify({ payrollRunId })
        });
    }

    disbursePayroll(payrollRunId, options = {}) {
        return this.request('/payroll/disburse', {
            method: 'POST',
            body: JSON.stringify({ payrollRunId, ...options })
        });
    }

    getPayRunState(runId) {
        return this.request(`/payroll/run/${runId}/state`);
    }

    savePayRunState(runId, state) {
        return this.request(`/payroll/run/${runId}/state`, {
            method: 'PUT',
            body: JSON.stringify(state)
        });
    }

    savePayRunLop(runId, employeeId, lopDays) {
        return this.request(`/payroll/run/${runId}/lop`, {
            method: 'PUT',
            body: JSON.stringify({ employeeId, lopDays })
        });
    }

    updatePayrollItem(id, payload) {
        return this.request(`/payroll/items/${id}`, {
            method: 'PUT',
            body: JSON.stringify(payload)
        });
    }

    createLoan(payload) {
        return this.request('/payroll/loans', {
            method: 'POST',
            body: JSON.stringify(payload)
        });
    }

    getLoans() {
        return this.request('/payroll/loans');
    }

    createReimbursement(payload) {
        return this.request('/payroll/reimbursements', {
            method: 'POST',
            body: JSON.stringify(payload)
        });
    }

    getReimbursements() {
        return this.request('/payroll/reimbursements');
    }

    updateReimbursementStatus(id, status) {
        return this.request(`/payroll/reimbursements/${id}`, {
            method: 'PUT',
            body: JSON.stringify({ status })
        });
    }

    createSalaryStructure(payload) {
        return this.request('/payroll/structures', {
            method: 'POST',
            body: JSON.stringify(payload)
        });
    }

    getSalaryStructure(employeeId) {
        return this.request(`/payroll/structures/${employeeId}`);
    }

    getSalaryComponents() {
        return this.request('/payroll/components');
    }

    createSalaryComponent(payload) {
        return this.request('/payroll/components', {
            method: 'POST',
            body: JSON.stringify(payload)
        });
    }

    getTaxRecord(employeeId) {
        return this.request(`/payroll/tax/${employeeId}`);
    }

    saveTaxRecord(employeeId, payload) {
        return this.request(`/payroll/tax/${employeeId}`, {
            method: 'POST',
            body: JSON.stringify(payload)
        });
    }

    getPayslips() {
        return this.request('/payroll/payslips');
    }
    dispatchPayslips(month) {
        return this.request('/payroll/dispatch-payslips', {
            method: 'POST',
            body: JSON.stringify({ month })
        });
    }

    uploadPayslip(formData) {
        return this.request('/payroll/payslips/upload', {
            method: 'POST',
            body: formData
        }, true);
    }

    // ==========================================
    // 12. NOTIFICATIONS & ANNOUNCEMENTS MODULE
    // ==========================================
    getNotificationHistory() {
        return this.request('/notifications/history');
    }

    createAnnouncement(title, body, category = 'GENERAL') {
        return this.request('/notifications/send-all', {
            method: 'POST',
            body: JSON.stringify({ title, body, payload: { type: category } })
        });
    }

    sendDirectNotification(employeeId, title, body, payload = {}) {
        return this.request('/notifications/send', {
            method: 'POST',
            body: JSON.stringify({ employeeId, title, body, payload })
        });
    }

    // ==========================================
    // 13. SYSTEM SETTINGS & LEGAL AUDIT MODULE
    // ==========================================
    getSettings() {
        return this.request('/settings');
    }

    updateSettings(settingsData) {
        return this.request('/settings', {
            method: 'PUT',
            body: JSON.stringify(settingsData)
        });
    }

    getAcknowledgments() {
        return this.request('/acknowledgments');
    }

    // ==========================================
    // 14. PROFESSIONAL TAX CONFIGURATION ENGINE
    // ==========================================
    getPTStates() {
        return this.request('/payroll/professional-tax/states');
    }

    createPTState(data) {
        return this.request('/payroll/professional-tax/states', {
            method: 'POST',
            body: JSON.stringify(data)
        });
    }

    getPTState(id) {
        return this.request(`/payroll/professional-tax/states/${id}`);
    }

    updatePTState(id, data) {
        return this.request(`/payroll/professional-tax/states/${id}`, {
            method: 'PUT',
            body: JSON.stringify(data)
        });
    }

    deletePTState(id) {
        return this.request(`/payroll/professional-tax/states/${id}`, {
            method: 'DELETE'
        });
    }

    getPTRules(stateId) {
        return this.request(`/payroll/professional-tax/states/${stateId}/rules`);
    }

    savePTRules(stateId, data) {
        return this.request(`/payroll/professional-tax/states/${stateId}/rules`, {
            method: 'POST',
            body: JSON.stringify(data)
        });
    }

    testPTCalculation(params) {
        return this.request('/payroll/professional-tax/test', {
            method: 'POST',
            body: JSON.stringify(params)
        });
    }

    validatePTSlabs(slabs) {
        return this.request('/payroll/professional-tax/validate', {
            method: 'POST',
            body: JSON.stringify({ slabs })
        });
    }

    getPTHistory(stateId) {
        return this.request(`/payroll/professional-tax/history/${stateId}`);
    }

    exportPTConfig() {
        return this.request('/payroll/professional-tax/export');
    }

    importPTConfig(data) {
        return this.request('/payroll/professional-tax/import', {
            method: 'POST',
            body: JSON.stringify({ data })
        });
    }

    duplicatePTState(id, data) {
        return this.request(`/payroll/professional-tax/states/${id}/duplicate`, {
            method: 'POST',
            body: JSON.stringify(data)
        });
    }
}

export const api = new ApiService(API_BASE_URL);
