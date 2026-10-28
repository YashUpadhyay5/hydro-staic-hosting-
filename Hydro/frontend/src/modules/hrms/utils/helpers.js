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
    if (isNaN(d.getTime())) return String(val);

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

// Resigned / deactivated staff (status PAST) must not appear in live lists, pickers or today's attendance.
export const isActiveEmployee = (e) => !(['PAST', 'INACTIVE', 'DEACTIVATED'].includes(String(e?.status || '').toUpperCase()));
