const getApiBaseUrl = () => {
    if (import.meta.env && import.meta.env.VITE_API_URL) {
        return import.meta.env.VITE_API_URL;
    }
    return '/api';
};

const API_BASE_URL = getApiBaseUrl();

class ApiService {
    constructor(baseUrl) {
        this.baseUrl = baseUrl;
        this.cache = new Map();
    }

    getHeaders(isFormData = false) {
        const token = localStorage.getItem('adminToken');
        const headers = {};
        if (token) headers['Authorization'] = `Bearer ${token}`;
        if (!isFormData) headers['Content-Type'] = 'application/json';
        return headers;
    }

    clearCache() {
        this.cache.clear();
        try {
            if (typeof sessionStorage !== 'undefined') {
                const keysToRemove = [];
                for (let i = 0; i < sessionStorage.length; i++) {
                    const k = sessionStorage.key(i);
                    if (k && k.startsWith('swr:')) keysToRemove.push(k);
                }
                keysToRemove.forEach(k => sessionStorage.removeItem(k));
            }
        } catch (e) {}
    }

    clearCacheMatching(filterFn) {
        for (const [key] of this.cache) {
            if (filterFn(key)) {
                this.cache.delete(key);
            }
        }
        try {
            if (typeof sessionStorage !== 'undefined') {
                const keysToRemove = [];
                for (let i = 0; i < sessionStorage.length; i++) {
                    const k = sessionStorage.key(i);
                    if (k && k.startsWith('swr:') && filterFn(k.replace('swr:', ''))) {
                        keysToRemove.push(k);
                    }
                }
                keysToRemove.forEach(k => sessionStorage.removeItem(k));
            }
        } catch (e) {}
    }

    invalidateCacheForEndpoint(endpoint) {
        const cleanEp = String(endpoint || '').split('?')[0].replace(/^\//, '');
        const baseModule = cleanEp.split('/')[0];

        // Background telemetry mutations shouldn't invalidate business entity caches
        if (['footprints', 'footprint', 'media'].includes(baseModule)) {
            this.clearCacheMatching(key => key.includes('footprint') || key.includes('media'));
            return;
        }

        if (baseModule) {
            this.clearCacheMatching(key => key.includes(baseModule) || key.includes('dashboard'));
        } else {
            this.clearCache();
        }
    }

    getCached(endpoint, method = 'GET') {
        const cacheKey = `${method.toUpperCase()}:${endpoint}`;
        // 1. Fast in-memory lookup (0ms)
        if (this.cache.has(cacheKey)) {
            const entry = this.cache.get(cacheKey);
            const ttl = entry.ttl || 60000;
            if (Date.now() - entry.timestamp < ttl) {
                return JSON.parse(JSON.stringify(entry.data));
            }
        }
        // 2. Persistent sessionStorage fallback (survives hard refresh Ctrl+F5)
        try {
            if (typeof sessionStorage !== 'undefined') {
                const raw = sessionStorage.getItem('swr:' + cacheKey);
                if (raw) {
                    const parsed = JSON.parse(raw);
                    const ttl = parsed.ttl || 300000;
                    if (Date.now() - parsed.timestamp < ttl) {
                        this.cache.set(cacheKey, parsed);
                        return parsed.data;
                    }
                }
            }
        } catch (e) {}
        return null;
    }

    setCached(endpoint, data, ttl = 60000, method = 'GET') {
        const cacheKey = `${method.toUpperCase()}:${endpoint}`;
        const entry = { timestamp: Date.now(), data, ttl };
        this.cache.set(cacheKey, entry);
        try {
            if (typeof sessionStorage !== 'undefined') {
                const json = JSON.stringify(entry);
                if (json.length < 600000) {
                    sessionStorage.setItem('swr:' + cacheKey, json);
                }
            }
        } catch (e) {}
    }

    async request(endpoint, options = {}, isFormData = false) {
        const method = (options.method || 'GET').toUpperCase();
        const ttl = options.ttl !== undefined ? options.ttl : (method === 'GET' ? 60000 : 0);
        const cacheKey = `${method}:${endpoint}`;

        // 0ms In-Memory or Persistent SWR Cache Lookup for read requests
        if (method === 'GET' && ttl > 0) {
            const cached = this.getCached(endpoint, method);
            if (cached !== null) {
                return cached;
            }
        }

        // On state mutation, invalidate read caches targeted to the affected resource
        if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(method)) {
            this.invalidateCacheForEndpoint(endpoint);
        }

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
                const apiError = new Error(data.error || 'API Request Failed');
                apiError.status = response.status;
                apiError.data = data;
                throw apiError;
            }

            if (method === 'GET' && ttl > 0) {
                this.setCached(endpoint, data, ttl, method);
            }

            return data;
        } catch (error) {
            if (error.name === 'AbortError') {
                // Request cancelled intentionally by user unmount/navigation
                return null;
            }
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

    getDashboardSummary(force = false) {
        return this.request('/dashboard/summary', { ttl: force ? 0 : 30000 });
    }

    // ==========================================
    // 2. EMPLOYEES MANAGEMENT
    // ==========================================
    getEmployees(params = {}) {
        const query = new URLSearchParams(params).toString();
        return this.request(`/employees${query ? `?${query}` : ''}`, { ttl: 30000 });
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

    getSalaryHistory(id) {
        return this.request(`/employees/${id}/salary-history`);
    }

    deleteEmployee(id) {
        return this.request(`/employees/${id}`, {
            method: 'DELETE'
        });
    }

    uploadEmployeeAvatar(id, file) {
        const formData = new FormData();
        formData.append('avatar', file);
        return this.request(`/employees/${id}/avatar`, {
            method: 'POST',
            body: formData
        }, true);
    }

    uploadEmployeeProfilePhoto(id, file) {
        const formData = new FormData();
        formData.append('profilePhoto', file);
        return this.request(`/employees/${id}/profile-photo`, {
            method: 'POST',
            body: formData
        }, true);
    }

    // ==========================================
    // 3. ATTENDANCE & LEAVES
    // ==========================================
    getAttendance(params = {}, options = {}) {
        let p = params;
        if (typeof p === 'string') {
            p = { date: p };
        }
        const query = new URLSearchParams(p).toString();
        return this.request(`/attendance${query ? `?${query}` : ''}`, { ttl: 20000, ...options });
    }

    getLeaves(userId = null, options = {}) {
        const query = new URLSearchParams();
        if (userId) query.append('userId', userId);
        const qStr = query.toString();
        return this.request(`/leaves${qStr ? `?${qStr}` : ''}`, { ttl: 30000, ...options });
    }

    updateLeaveStatus(leaveId, status, actionBy = null) {
        return this.request(`/leaves/${leaveId}/status`, {
            method: 'PATCH',
            body: JSON.stringify({ status, ...(actionBy ? { actionBy } : {}) })
        });
    }

    adjustLeaveBalance(payload) {
        return this.request('/leaves/adjust-balance', {
            method: 'POST',
            body: JSON.stringify(payload)
        });
    }

    getLeaveAdjustments(employeeId = null) {
        const query = new URLSearchParams();
        if (employeeId) query.append('employeeId', employeeId);
        const qStr = query.toString();
        return this.request(`/leaves/adjustments${qStr ? `?${qStr}` : ''}`, { ttl: 30000 });
    }

    // Leave Balances module. Balance reads are never cached so a refresh always shows saved data.
    getLeaveBalanceMeta() {
        return this.request('/leaves/balances/meta', { ttl: 60000 });
    }

    getLeaveBalances(params = {}, options = {}) {
        const query = new URLSearchParams();
        Object.entries(params).forEach(([k, v]) => {
            if (v !== undefined && v !== null && v !== '') query.append(k, v);
        });
        return this.request(`/leaves/balances?${query.toString()}`, { ttl: 0, ...options });
    }

    getEmployeeLeaveLedger(employeeId, year, options = {}) {
        return this.request(`/leaves/balances/${encodeURIComponent(employeeId)}?year=${encodeURIComponent(year)}`, { ttl: 0, ...options });
    }

    getSpecialEarnedDates(employeeId, year, month) {
        return this.request(`/leaves/balances/${encodeURIComponent(employeeId)}/special-dates?year=${year}&month=${month}`, { ttl: 0 });
    }

    previewLeaveImport(file) {
        const form = new FormData();
        form.append('file', file);
        return this.request('/leaves/balances/import/preview', { method: 'POST', body: form }, true);
    }

    applyLeaveImport(file, expectedHash) {
        const form = new FormData();
        form.append('file', file);
        form.append('expectedHash', expectedHash);
        return this.request('/leaves/balances/import', { method: 'POST', body: form }, true);
    }

    submitLeaveLedgerChanges(employeeId, payload) {
        return this.request(`/leaves/balances/${encodeURIComponent(employeeId)}/submit`, {
            method: 'POST',
            body: JSON.stringify(payload)
        });
    }

    // ==========================================
    // 4. GEOFENCING PROTOCOLS
    // ==========================================
    getGeofences() {
        return this.request('/geofence', { ttl: 60000 });
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
    getFootprints(userId, date, options = {}) {
        let url = '/footprints';
        const params = [];
        if (userId) params.push(`userId=${userId}`);
        if (date) params.push(`date=${date}`);
        if (params.length) url += `?${params.join('&')}`;
        return this.request(url, { ttl: 30000, ...options });
    }

    getRouteReplay(userId, date, mode = 'osrm', options = {}) {
        return this.request(`/footprints/route-replay?userId=${userId}&date=${date}&mode=${mode}`, { ttl: 120000, ...options });
    }

    getLiveFootprints(options = {}) {
        return this.request('/footprints/live', options);
    }

    getLatestAllFootprints(options = {}) { // Preserved from v2 extension architecture
        return this.request('/footprints/latest-all', { ttl: 10000, ...options });
    }

    getFootprintHistory(userId, date, options = {}) {
        return this.request(`/footprints/history?userId=${userId}&date=${date}`, { ttl: 30000, ...options });
    }

    // ==========================================
    // 6. EXPENSES ENGINE (MULTIPART FORMDATA)
    // ==========================================
    getExpenses() {
        return this.request('/expenses', { ttl: 30000 });
    }

    updateExpenseStatus(expenseId, status, actionBy = null) {
        return this.request(`/expenses/${expenseId}/status`, {
            method: 'PATCH',
            body: JSON.stringify({ status, ...(actionBy ? { actionBy } : {}) })
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
    getDocuments(userId, options = {}) {
        let url = '/hrms-documents';
        if (userId) url += `?userId=${userId}`;
        return this.request(url, { ttl: 30000, ...options });
    }

    async downloadDocumentsZip(userId = null, documentIds = []) {
        const query = new URLSearchParams();
        if (userId) query.append('userId', userId);
        if (documentIds && documentIds.length) query.append('ids', documentIds.join(','));
        const token = this.token || (typeof localStorage !== 'undefined' ? localStorage.getItem('token') : '');
        const url = `${this.baseUrl}/hrms-documents/download-zip?${query.toString()}`;
        
        const response = await fetch(url, {
            headers: {
                'Authorization': token ? `Bearer ${token}` : ''
            }
        });
        if (!response.ok) throw new Error('ZIP download failed');
        const blob = await response.blob();
        const downloadUrl = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = downloadUrl;
        a.download = `hrms_documents_${Date.now()}.zip`;
        document.body.appendChild(a);
        a.click();
        window.URL.revokeObjectURL(downloadUrl);
        document.body.removeChild(a);
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
        return this.request('/sites', { ttl: 60000 });
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
        return this.request('/clusters', { ttl: 60000 });
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
        return this.request('/rules', { ttl: 60000 });
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

    // Server-side salary calculation for the wizard; pass the in-progress wizard state to preview unsaved edits
    previewPayRun(runId, wizardState) {
        return this.request(`/payroll/run/${runId}/preview`, {
            method: 'POST',
            body: JSON.stringify(wizardState ? { wizardState } : {})
        });
    }

    savePayRunLop(runId, employeeId, lopDays) {
        return this.request(`/payroll/run/${runId}/lop`, {
            method: 'PUT',
            body: JSON.stringify({ employeeId, lopDays })
        });
    }

    savePayRunWorkingDays(runId, employeeId, workingDays) {
        return this.request(`/payroll/run/${runId}/working-days`, {
            method: 'PUT',
            body: JSON.stringify({ employeeId, workingDays })
        });
    }

    savePayRunLeaves(runId, employeeId, leaves) {
        return this.request(`/payroll/run/${runId}/leaves`, {
            method: 'PUT',
            body: JSON.stringify({ employeeId, leaves })
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

    async downloadPayslipsArchive({ month, employeeId = null }) {
        const query = new URLSearchParams();
        if (month) query.append('month', month);
        if (employeeId && employeeId !== 'ALL') query.append('employeeId', employeeId);

        const token = this.token || (typeof localStorage !== 'undefined' ? (localStorage.getItem('token') || localStorage.getItem('adminToken')) : '');
        const url = `${this.baseUrl}/payroll/payslips/download-archive?${query.toString()}`;

        const response = await fetch(url, {
            headers: {
                'Authorization': token ? `Bearer ${token}` : ''
            }
        });

        if (!response.ok) {
            const errData = await response.json().catch(() => ({}));
            throw new Error(errData.error || 'Failed to download payslip archive');
        }

        let filename = employeeId && employeeId !== 'ALL' ? `Payslip_${employeeId}_${month}.pdf` : `Payslips_All_Employees_${month}.zip`;
        const disposition = response.headers.get('Content-Disposition');
        if (disposition && disposition.includes('filename=')) {
            const matches = /filename[^;=\n]*=((['"]).*?\2|[^;\n]*)/.exec(disposition);
            if (matches && matches[1]) {
                filename = matches[1].replace(/['"]/g, '').trim();
            }
        }

        const blob = await response.blob();
        const downloadUrl = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.style.display = 'none';
        a.href = downloadUrl;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        window.URL.revokeObjectURL(downloadUrl);
        document.body.removeChild(a);
    }

    // ==========================================
    // 12. NOTIFICATIONS & ANNOUNCEMENTS MODULE
    // ==========================================
    getNotificationStats() {
        return this.request('/notifications/stats');
    }

    getNotificationHistory(params = {}) {
        const query = new URLSearchParams(params).toString();
        return this.request(`/notifications/history${query ? `?${query}` : ''}`, { ttl: 60000 });
    }

    getNotificationLogs() {
        return this.request('/notifications/logs');
    }

    getWhatsAppSettings() {
        return this.request('/notifications/whatsapp/settings');
    }

    getWhatsAppLogs() {
        return this.request('/notifications/whatsapp/logs');
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
        return this.request('/settings', { ttl: 60000 });
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
