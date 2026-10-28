/**
 * Pre-compression build utility with Zstandard (Zstd) Priority
 * Generates maximum-compression Zstandard (.zst), Brotli (.br), and Gzip (.gz) versions.
 */
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const DIST_DIR = path.resolve(__dirname, '../dist');

function compressFile(filePath) {
    const ext = path.extname(filePath).toLowerCase();
    if (!['.js', '.css', '.html', '.svg', '.json', '.map'].includes(ext)) {
        return;
    }

    const content = fs.readFileSync(filePath);
    if (content.length < 512) return; // Skip tiny files

    // 1. Generate maximum Zstandard (.zst) - Ultra-fast decompression & superior ratios
    const zstPath = filePath + '.zst';
    const zstContent = zlib.zstdCompressSync(content, {
        params: {
            [zlib.constants.ZSTD_c_compressionLevel]: 19 // Level 19 maximum static ratio
        }
    });
    fs.writeFileSync(zstPath, zstContent);

    // 2. Generate maximum Brotli (.br)
    const brPath = filePath + '.br';
    const brContent = zlib.brotliCompressSync(content, {
        params: {
            [zlib.constants.BROTLI_PARAM_QUALITY]: 11,
            [zlib.constants.BROTLI_PARAM_MODE]: zlib.constants.BROTLI_MODE_TEXT
        }
    });
    fs.writeFileSync(brPath, brContent);

    // 3. Generate fallback Gzip (.gz)
    const gzPath = filePath + '.gz';
    const gzContent = zlib.gzipSync(content, { level: 9 });
    fs.writeFileSync(gzPath, gzContent);

    const originalKb = (content.length / 1024).toFixed(1);
    const zstKb = (zstContent.length / 1024).toFixed(1);
    const brKb = (brContent.length / 1024).toFixed(1);
    const gzKb = (gzContent.length / 1024).toFixed(1);
    const savingPct = Math.round((1 - zstContent.length / content.length) * 100);

    console.log(`[Pre-Compress] ${path.basename(filePath)}: ${originalKb} KB -> zst: ${zstKb} KB | br: ${brKb} KB | gz: ${gzKb} KB (-${savingPct}%)`);
}

function walkDir(dir) {
    if (!fs.existsSync(dir)) return;
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            walkDir(fullPath);
        } else if (entry.isFile() && !entry.name.endsWith('.gz') && !entry.name.endsWith('.br') && !entry.name.endsWith('.zst')) {
            compressFile(fullPath);
        }
    }
}

console.log('=== Starting Ultra-Compression Pipeline (Zstandard + Brotli + Gzip) ===');
walkDir(DIST_DIR);
console.log('=== Pre-Compression Completed Successfully ===');
