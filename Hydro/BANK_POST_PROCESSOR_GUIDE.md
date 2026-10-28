# 🏛️ Bank Details Post-Processor & Production Setup Guide

This document explains how to automatically populate **Bank Name**, **Account Number**, and **IFSC Code** from uploaded invoices without retraining your AI vision model, and provides a production-grade deployment plan.

---

## 🛠️ Section 1: Rule-Based Bank Details Post-Processor (Node.js & Static Code)

If an AI OCR model extracts invoice headers, line items, and tax totals cleanly but returns empty bank details (`0% confidence`), you can run this **Rule-Based Post-Processor** directly on your backend or static hosting environment.

### 📋 Node.js / JavaScript Post-Processor Code

```javascript
// Bank Name Lookup Map derived from 4-letter IFSC Prefixes
const IFSC_BANK_MAP = {
  'HDFC': 'HDFC BANK',
  'ICIC': 'ICICI BANK',
  'SBIN': 'STATE BANK OF INDIA',
  'UTIB': 'AXIS BANK',
  'KKBK': 'KOTAK MAHINDRA BANK',
  'PUNB': 'PUNJAB NATIONAL BANK',
  'CNRB': 'CANARA BANK',
  'BARB': 'BANK OF BARODA',
  'YESB': 'YES BANK',
  'UBIN': 'UNION BANK OF INDIA'
};

/**
 * Enriches extraction JSON payload with Bank Details via Regex Post-Processing
 * @param {Object} payload - The raw JSON output returned by AI OCR model
 * @param {string} rawText - Document text or base64 data string
 * @returns {Object} Enriched JSON payload with populated bank_details
 */
function enrichBankDetails(payload, rawText = '') {
  if (!payload) return payload;
  if (!payload.bank_details) payload.bank_details = {};

  const bank = payload.bank_details;

  // 1. Extract 11-character Indian IFSC Code
  if (!bank.ifsc_code || bank.ifsc_code === 'null' || bank.ifsc_code === '') {
    const ifscMatch = rawText.match(/([A-Z]{4}0[A-Z0-9]{6})/i);
    if (ifscMatch) {
      bank.ifsc_code = ifscMatch[1].toUpperCase();
    }
  }

  // 2. Infer Bank Name from 4-letter IFSC Prefix
  if (!bank.bank_name || bank.bank_name === 'null' || bank.bank_name === '') {
    if (bank.ifsc_code && bank.ifsc_code.length >= 4) {
      const prefix = bank.ifsc_code.substring(0, 4).toUpperCase();
      if (IFSC_BANK_MAP[prefix]) {
        bank.bank_name = IFSC_BANK_MAP[prefix];
      }
    }

    if (!bank.bank_name) {
      const bankMatch = rawText.match(/(HDFC BANK|ICICI BANK|STATE BANK OF INDIA|AXIS BANK|KOTAK MAHINDRA BANK|PUNJAB NATIONAL BANK|CANARA BANK|BANK OF BARODA|YES BANK)/i);
      if (bankMatch) {
        bank.bank_name = bankMatch[1].toUpperCase();
      }
    }
  }

  // 3. Extract 9-18 Digit Bank Account Number
  if (!bank.account_number || bank.account_number === 'null' || bank.account_number === '') {
    const accMatch = rawText.match(/(?:A\/C|Account|Acct|Acc)(?:\s*No|\s*Number|\s*#)?[\s:-]*([0-9]{9,18})/i);
    if (accMatch) {
      bank.account_number = accMatch[1].trim();
    }
  }

  payload.bank_details = bank;
  return payload;
}

module.exports = { enrichBankDetails };
```

---

## 🚀 Section 2: Production-Level Architecture & Deployment Plan

To run this application at production scale with high speed, zero downtime, and complete data safety:

### 1. Backend Web Service (Render / AWS Elastic Beanstalk / Docker)
* **Environment Variables**: Ensure `DATABASE_URL` (Neon PostgreSQL), `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`, `CLOUDINARY_API_SECRET`, `RUNPOD_API_KEY`, and `RUNPOD_ENDPOINT_ID` are configured.
* **Auto-Scaling & Health Checks**: Configure health check endpoint `/health` returning HTTP 200 OK.
* **Connection Pooling**: Use Neon Cloud PostgreSQL connection pooling (`sslmode=require`).

### 2. RunPod Serverless AI OCR Pipeline
* **Request Mode**: Use `https://api.runpod.ai/v2/${RUNPOD_ENDPOINT_ID}/runsync` for low-latency (<15s) inference.
* **Fallback Status Polling**: Enable `/v1/${endpointId}/status/${jobId}` polling for heavy queue bursts.
* **Zero Model Retraining**: Rely on the **Regex Post-Processor** (`enrichBankDetails`) to handle missing bank/tax fields.

### 3. Frontend Application (Render Static Site / Vercel / Netlify)
* **Build Command**: `npm run build`
* **Publish Directory**: `dist`
* **Environment Variable**: `VITE_API_URL=https://hydro-backend-api.onrender.com`

---

## 🔒 Security Best Practices
1. **Never hardcode secrets** (`RUNPOD_API_KEY`, `CLOUDINARY_API_SECRET`) inside static client-side frontend code. Always process AI model calls through the Express backend proxy.
2. **CORS Configuration**: Restrict backend origins to `https://hydro-hrms-app.onrender.com` and authorized domains.
3. **Database SSL**: Enforce `sslmode=require` on Neon PostgreSQL database connections.
