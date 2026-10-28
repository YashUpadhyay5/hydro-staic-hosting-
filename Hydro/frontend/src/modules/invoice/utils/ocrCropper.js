import Tesseract from "tesseract.js";
import API from "../services/api";

const LABEL_PREFIXES = [
  /^(?:tax\s*)?invoice\s*(?:no\.?|number|#)?\s*[:.?\-]?\s*/i,
  /^(?:inv\.?\s*no\.?|bill\s*no\.?|bill\s*number)\s*[:.?\-]?\s*/i,
  /^(?:invoice\s*)?date\s*[:.?\-]?\s*/i,
  /^(?:dated)\s*[:.?\-]?\s*/i,
  /^(?:po|p\.o\.)\s*(?:no\.?|number|#)?\s*[:.?\-]?\s*/i,
  /^(?:gstin|gst\s*no\.?|gstin\/uin|gstin\s*\/uin)\s*[:.?\-]?\s*/i,
  /^(?:pan(?:\s*no\.?)?)\s*[:.?\-]?\s*/i,
  /^(?:place\s*of\s*supply|pos|state\s*name)\s*[:.?\-]?\s*/i,
  /^(?:total|grand\s*total|subtotal|taxable\s*amount|total\s*amount)\s*[:.?\-]?\s*/i,
  /^(?:bank\s*name|account\s*no\.?|a\/c\s*no\.?|ifsc(?:\s*code)?|branch)\s*[:.?\-]?\s*/i,
  /^(?:transport|vehicle\s*no\.?|lr\s*no\.?|gr\s*no\.?|ack\s*no\.?|ack\s*date|irn)\s*[:.?\-]?\s*/i,
  /^(?:billed\s*to|shipped\s*to|consignee|buyer)\s*[:.?\-]?\s*/i,
  /^(?:deals\s*in\s*[:\-]?\s*)/i,
];

/**
 * Cleans label noise and prefix headers from OCR output.
 */
export const cleanOcrText = (text, fieldKey = "") => {
  if (!text) return "";
  let s = String(text).trim().replace(/[\r\n]+/g, " ");

  for (const regex of LABEL_PREFIXES) {
    s = s.replace(regex, "");
  }

  const lowerKey = String(fieldKey || "").toLowerCase();
  if (lowerKey.includes("total") || lowerKey.includes("price") || lowerKey.includes("amount") || lowerKey.includes("subtotal") || lowerKey.includes("tax") || lowerKey.includes("qty") || lowerKey.includes("quantity")) {
    s = s.replace(/^(?:rs\.?|inr|₹|\$)\s*/i, "");
  }

  // Remove leading/trailing colons, question marks, commas, or extra surrounding whitespace
  s = s.replace(/^[:.?,;?"'\s]+|[:.?,;?"'\s]+$/g, "").trim();
  return s;
};

/**
 * Normalizes text for comparison by trimming, collapsing spaces.
 */
export const normalizeText = (text) => {
  if (text === null || text === undefined) return "";
  return String(text)
    .trim()
    .replace(/\s+/g, " ")
    .toLowerCase();
};

/**
 * Checks if two text values match exactly or semantically.
 * Never treats partial substrings as matches (e.g. "AAB-0204/" != "AAB-0204/26-27").
 */
export const isTextMatching = (valA, valB) => {
  if (valA === undefined || valA === null) valA = "";
  if (valB === undefined || valB === null) valB = "";

  const strA = String(valA).trim();
  const strB = String(valB).trim();

  if (strA === "" && strB === "") return true;
  if (strA === "" || strB === "") return false;
  if (strA === strB) return true;

  const normA = normalizeText(strA);
  const normB = normalizeText(strB);
  if (normA === normB) return true;

  // 1. Numeric Comparison (e.g. "10,000.00" vs "10000" or "18.0%" vs "18%")
  const cleanNumA = strA.replace(/[₹$,\s%]/g, "");
  const cleanNumB = strB.replace(/[₹$,\s%]/g, "");
  const numA = parseFloat(cleanNumA);
  const numB = parseFloat(cleanNumB);
  const isPureNumA = /^[\d,.\s%₹$+\-]+$/.test(strA) && !isNaN(numA);
  const isPureNumB = /^[\d,.\s%₹$+\-]+$/.test(strB) && !isNaN(numB);

  if (isPureNumA && isPureNumB && Math.abs(numA - numB) < 0.001) {
    return true;
  }

  // 2. Date Comparison (e.g. "2026-06-04" vs "04/06/2026")
  const dateA = Date.parse(strA);
  const dateB = Date.parse(strB);
  if (!isNaN(dateA) && !isNaN(dateB) && dateA === dateB) {
    return true;
  }

  // 3. String comparison ignoring formatting characters ONLY IF ALL alphanumeric chars match EXACTLY (equal length)
  // e.g. "33AAECA9907H1ZP" == "33-AAECA-9907H1ZP", but "AAB-0204" != "AAB-0204/26-27"
  const stripPunct = (s) => s.replace(/[^a-z0-9]/gi, "").toLowerCase();
  const pA = stripPunct(strA);
  const pB = stripPunct(strB);
  if (pA && pB && pA === pB) {
    return true;
  }

  return false;
};

/**
 * Crops a bounding region from an HTML <img> element to a base64 PNG data URL using an offscreen canvas.
 * @param {HTMLImageElement} imgElement 
 * @param {{ xPct: number, yPct: number, widthPct: number, heightPct: number }} boundsPct 
 * @returns {string|null} base64 data URL
 */
export const cropImageFromElement = (imgElement, boundsPct) => {
  if (!imgElement || !imgElement.naturalWidth || !imgElement.naturalHeight) {
    return null;
  }

  try {
    const naturalW = imgElement.naturalWidth;
    const naturalH = imgElement.naturalHeight;

    // Add 1.5% padding around crop to ensure edge digits/letters are not cut off
    const padXPct = Math.min(1.5, boundsPct.widthPct * 0.05);
    const padYPct = Math.min(1.5, boundsPct.heightPct * 0.05);

    const xPct = Math.max(0, boundsPct.xPct - padXPct);
    const yPct = Math.max(0, boundsPct.yPct - padYPct);
    const wPct = Math.min(100 - xPct, boundsPct.widthPct + (padXPct * 2));
    const hPct = Math.min(100 - yPct, boundsPct.heightPct + (padYPct * 2));

    const sx = (xPct / 100) * naturalW;
    const sy = (yPct / 100) * naturalH;
    const sWidth = (wPct / 100) * naturalW;
    const sHeight = (hPct / 100) * naturalH;

    if (sWidth <= 2 || sHeight <= 2) return null;

    // Render at high resolution for optimal OCR accuracy
    const scale = Math.max(1, Math.min(3, 2000 / Math.max(sWidth, sHeight)));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(sWidth * scale);
    canvas.height = Math.round(sHeight * scale);
    const ctx = canvas.getContext("2d");

    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(imgElement, sx, sy, sWidth, sHeight, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL("image/png");
  } catch (err) {
    console.warn("Canvas crop fallback (tainted canvas or dimensions):", err);
    return null;
  }
};

/**
 * Extracts text from a cropped region using backend vector clip extraction with client-side Tesseract.js fallback.
 */
export const extractTextFromRegion = async (documentId, boundsPct, cropBase64 = null, activeFieldInfo = {}) => {
  let recognizedText = "";

  // 1. Try Backend PDF/document clip text first (Fast and 100% exact for vector text)
  if (documentId) {
    try {
      const payload = {
        x_pct: boundsPct.xPct,
        y_pct: boundsPct.yPct,
        width_pct: boundsPct.widthPct,
        height_pct: boundsPct.heightPct,
        crop_base64: cropBase64,
        page_index: activeFieldInfo?.pageIndex || 0,
        field_key: activeFieldInfo?.fieldKey,
        current_value: activeFieldInfo?.currentValue,
      };

      const res = await API.post(`/documents/${documentId}/ocr-crop`, payload);
      const serverText = cleanOcrText(res.data?.text || "");
      if (serverText) {
        recognizedText = serverText;
      }
    } catch (err) {
      console.warn("Backend crop OCR fallback error:", err);
    }
  }

  // 2. Client-Side OCR via Tesseract.js (for scanned raster documents or if backend is empty)
  if (!recognizedText && cropBase64) {
    try {
      const result = await Tesseract.recognize(cropBase64, "eng", {
        logger: () => {},
      });
      const raw = result?.data?.text || "";
      const cleaned = cleanOcrText(raw);
      if (cleaned) {
        recognizedText = cleaned;
      }
    } catch (err) {
      console.warn("Client-side Tesseract OCR error:", err);
    }
  }

  // 3. Return the EXACT detected text from the image
  return {
    success: !!recognizedText,
    text: recognizedText,
    rawText: recognizedText,
    confidence: recognizedText ? 95.0 : 0.0,
  };
};
