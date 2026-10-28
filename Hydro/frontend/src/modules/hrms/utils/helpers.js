export function formatTo12HourTime(val) {
    if (!val || val === '-' || val === '—' || val === 'N/A') return '';
    const str = String(val).trim();
    if (!str) return '';

    // If already in 12-hour format e.g. "09:30 AM" or "9:30:00 PM"
    const match12 = str.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(AM|PM)$/i);
    if (match12) {
        let h = parseInt(match12[1], 10);
        const m = match12[2];
        const ampm = match12[4].toUpperCase();
        h = h % 12 || 12;
        return `${String(h).padStart(2, '0')}:${m} ${ampm}`;
    }

    // Try parsing as ISO or timestamp or full date string
    let d = new Date(val);
    if (isNaN(d.getTime()) && !isNaN(Number(val))) {
        d = new Date(Number(val));
    }
    if (!isNaN(d.getTime()) && d.getFullYear() > 2000) {
        let hours = d.getHours();
        const minutes = String(d.getMinutes()).padStart(2, '0');
        const ampm = hours >= 12 ? 'PM' : 'AM';
        hours = hours % 12 || 12;
        return `${String(hours).padStart(2, '0')}:${minutes} ${ampm}`;
    }

    // Try parsing HH:MM:SS or HH:MM 24-hour time string
    const match24 = str.match(/(?:^|\s)(\d{1,2}):(\d{2})(?::(\d{2}))?(?:\s*(AM|PM))?/i);
    if (match24) {
        let hours = parseInt(match24[1], 10);
        const minutes = match24[2];
        let ampm = match24[4] ? match24[4].toUpperCase() : null;
        if (!ampm) {
            ampm = hours >= 12 ? 'PM' : 'AM';
        }
        hours = hours % 12 || 12;
        return `${String(hours).padStart(2, '0')}:${minutes} ${ampm}`;
    }

    return str;
}

export function formatDate(val, includeTime = false) {
    if (!val) return '-';
    const str = String(val).trim();
    if (!str || str === '-' || str === '—' || str === 'N/A') return str;

    // Already in DD/MM/YYYY format
    if (/^\d{2}\/\d{2}\/\d{4}$/.test(str)) return str;

    // ISO format YYYY-MM-DD
    const isoMatch = str.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
    if (isoMatch && !includeTime) {
        return `${isoMatch[3].padStart(2, '0')}/${isoMatch[2].padStart(2, '0')}/${isoMatch[1]}`;
    }

    let d = new Date(val);
    if (isNaN(d.getTime()) && !isNaN(Number(val))) {
        d = new Date(Number(val));
    }
    if (isNaN(d.getTime())) {
        if (includeTime) {
            const formattedTime = formatTo12HourTime(str);
            if (formattedTime) return formattedTime;
        }
        return String(val);
    }

    const dd = String(d.getDate()).padStart(2, '0');
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const yyyy = d.getFullYear();
    const dateStr = `${dd}/${mm}/${yyyy}`;

    if (includeTime) {
        let hours = d.getHours();
        const minutes = String(d.getMinutes()).padStart(2, '0');
        const ampm = hours >= 12 ? 'PM' : 'AM';
        hours = hours % 12 || 12;
        return `${dateStr} ${String(hours).padStart(2, '0')}:${minutes} ${ampm}`;
    }
    return dateStr;
}

export function getFullUrl(filePath) {
    if (!filePath) return '';
    
    // If it's a Cloudinary URL, return it directly
    if (filePath.includes('cloudinary.com')) return filePath;

    let pathOnly = filePath;
    try {
        if (filePath.startsWith('http')) {
            const urlObj = new URL(filePath);
            pathOnly = urlObj.pathname;
        }
    } catch(e) {}

    // Normalize path (remove leading slash)
    let normalizedPath = pathOnly;
    if (normalizedPath.startsWith('/')) {
        normalizedPath = normalizedPath.substring(1);
    }

    // Clean up duplicate storage/storage/ path segments
    if (normalizedPath.startsWith('storage/storage/')) {
        normalizedPath = normalizedPath.substring(8); // Remove first 'storage/'
    }

    // Support new storage structure by prepending 'storage/' if necessary
    if (!normalizedPath.startsWith('static/uploads/') && !normalizedPath.startsWith('storage/')) {
        if (normalizedPath.startsWith('images/') || 
            normalizedPath.startsWith('documents/') || 
            normalizedPath.startsWith('invoices/') || 
            normalizedPath.startsWith('profile/') || 
            normalizedPath.startsWith('attendance/') || 
            normalizedPath.startsWith('payslips/') || 
            normalizedPath.startsWith('temp/')) {
            normalizedPath = 'storage/' + normalizedPath;
        }
    }

    // Resolve server URL dynamically
    const getApiBaseUrl = () => {
        const hostname = window.location.hostname;
        return `http://${hostname}:8000`;      
    };

    let serverUrl = getApiBaseUrl();
    if (serverUrl.endsWith('/api')) serverUrl = serverUrl.substring(0, serverUrl.length - 4);
    if (serverUrl.endsWith('/api/')) serverUrl = serverUrl.substring(0, serverUrl.length - 5);
    if (serverUrl.endsWith('/')) serverUrl = serverUrl.substring(0, serverUrl.length - 1);

    return `${serverUrl}/${normalizedPath}`;
}

export async function forceDownload(url, defaultFilename) {
    try {
        const response = await fetch(url);
        if (!response.ok) throw new Error('Network error');
        const blob = await response.blob();
        const blobUrl = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.style.display = 'none';
        a.href = blobUrl;
        
        let filename = defaultFilename;
        try {
            const urlObj = new URL(url);
            const parts = urlObj.pathname.split('/');
            const last = parts[parts.length - 1];
            if (last && last.includes('.')) filename = last;
        } catch(e) {}
        
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        window.URL.revokeObjectURL(blobUrl);
        document.body.removeChild(a);
    } catch (error) {
        console.error('Blob download failed, falling back to direct navigation:', error);
        const a = document.createElement('a');
        a.href = url;
        a.download = defaultFilename;
        a.target = '_blank';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
    }
}

export async function downloadWithWatermark(url, filename, textLines) {
    try {
        const response = await fetch(url);
        if (!response.ok) throw new Error('Network error');
        const blob = await response.blob();
        const objectUrl = window.URL.createObjectURL(blob);

        const img = new Image();
        img.crossOrigin = 'anonymous'; // Ensure cross-origin images can be read by canvas
        img.onload = () => {
            const canvas = document.createElement('canvas');
            canvas.width = img.width;
            canvas.height = img.height;
            const ctx = canvas.getContext('2d');
            
            ctx.drawImage(img, 0, 0);

            const fontSize = Math.max(20, Math.floor(img.width * 0.05)); 
            const padding = fontSize;
            const lineHeight = fontSize * 1.5;
            const overlayHeight = (textLines.length * lineHeight) + padding;
            
            ctx.fillStyle = 'rgba(0, 0, 0, 0.6)';
            ctx.fillRect(0, img.height - overlayHeight, img.width, overlayHeight);

            ctx.fillStyle = '#ffffff';
            ctx.font = `${fontSize}px sans-serif`;
            ctx.textBaseline = 'top';

            textLines.forEach((line, index) => {
                ctx.fillText(line, padding, img.height - overlayHeight + (padding / 2) + (index * lineHeight));
            });

            canvas.toBlob((watermarkedBlob) => {
                const downloadUrl = window.URL.createObjectURL(watermarkedBlob);
                const a = document.createElement('a');
                a.style.display = 'none';
                a.href = downloadUrl;
                a.download = filename;
                document.body.appendChild(a);
                a.click();
                window.URL.revokeObjectURL(downloadUrl);
                document.body.removeChild(a);
                window.URL.revokeObjectURL(objectUrl);
            }, 'image/jpeg', 0.95);
        };
        img.src = objectUrl;
    } catch (error) {
        console.error('Watermark download failed, falling back to original:', error);
        forceDownload(url, filename);
    }
}

export function parseDateOnly(val, endOfDay = false) {
    if (!val) return null;
    let d;
    if (val instanceof Date) {
        d = new Date(val.getTime());
    } else if (typeof val === 'string') {
        const str = val.trim();
        const parts = str.split('T')[0].split(/[-/]/);
        if (parts.length === 3) {
            d = new Date(parseInt(parts[0], 10), parseInt(parts[1], 10) - 1, parseInt(parts[2], 10));
        } else {
            d = new Date(str);
        }
    } else if (typeof val === 'number') {
        d = new Date(val);
    }
    if (!d || isNaN(d.getTime())) return null;
    if (endOfDay) {
        d.setHours(23, 59, 59, 999);
    } else {
        d.setHours(0, 0, 0, 0);
    }
    return d;
}

// Resigned / deactivated staff (status PAST or exitDate passed) must not appear in live lists, pickers or today's attendance.
export const isActiveEmployee = (e) => {
    if (!e) return false;
    if (['PAST', 'INACTIVE', 'DEACTIVATED'].includes(String(e?.status || '').toUpperCase())) {
        return false;
    }
    const exitVal = e.exitDate || e.exit_date;
    if (exitVal) {
        const exit = parseDateOnly(exitVal, true);
        if (exit && exit < new Date()) {
            return false;
        }
    }
    return true;
};

// Check if an employee was part of the organization during a given date range [periodStart, periodEnd]
export function isEmpActiveForPeriod(emp, periodStartInput, periodEndInput) {
    if (!emp) return false;

    const pStart = parseDateOnly(periodStartInput, false);
    const pEnd = parseDateOnly(periodEndInput, true);

    if (!pStart || !pEnd) {
        return isActiveEmployee(emp);
    }

    // 1. Check Exit Date
    const exitVal = emp.exitDate || emp.exit_date;
    if (exitVal) {
        const exit = parseDateOnly(exitVal, true);
        if (exit && exit < pStart) {
            // Employee exited before this period began
            return false;
        }
    } else if (['PAST', 'INACTIVE', 'DEACTIVATED'].includes(String(emp.status || '').toUpperCase())) {
        // Fallback for PAST employee with no recorded exitDate:
        // Do not include them in current or future periods
        const today = new Date();
        const currentMonthStart = new Date(today.getFullYear(), today.getMonth(), 1, 0, 0, 0, 0);
        if (pStart >= currentMonthStart) {
            return false;
        }
    }

    // 2. Check Joining Date
    const joinVal = emp.joiningDate || emp.joining_date;
    if (joinVal) {
        const join = parseDateOnly(joinVal, false);
        if (join && join > pEnd) {
            // Employee joined after this period ended
            return false;
        }
    }

    return true;
}

// Check if an employee was active on a specific date (on or after joiningDate and on or before exitDate)
export function isEmpActiveOnDate(emp, dateInput) {
    if (!emp) return false;
    const target = parseDateOnly(dateInput, false);
    if (!target) return true;

    // Check exit date
    const exitVal = emp.exitDate || emp.exit_date;
    if (exitVal) {
        const exit = parseDateOnly(exitVal, true);
        if (exit && target > exit) {
            return false;
        }
    } else if (['PAST', 'INACTIVE', 'DEACTIVATED'].includes(String(emp.status || '').toUpperCase())) {
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        if (target >= today) {
            return false;
        }
    }

    // Check joining date
    const joinVal = emp.joiningDate || emp.joining_date;
    if (joinVal) {
        const join = parseDateOnly(joinVal, false);
        if (join && target < join) {
            return false;
        }
    }

    return true;
}
