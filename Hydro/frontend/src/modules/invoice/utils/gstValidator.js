/**
 * Official Indian State / UT Census Codes for GSTIN
 */
export const GST_STATE_CODES = {
  "01": "Jammu & Kashmir",
  "02": "Himachal Pradesh",
  "03": "Punjab",
  "04": "Chandigarh",
  "05": "Uttarakhand",
  "06": "Haryana",
  "07": "Delhi",
  "08": "Rajasthan",
  "09": "Uttar Pradesh",
  "10": "Bihar",
  "11": "Sikkim",
  "12": "Arunachal Pradesh",
  "13": "Nagaland",
  "14": "Manipur",
  "15": "Mizoram",
  "16": "Tripura",
  "17": "Meghalaya",
  "18": "Assam",
  "19": "West Bengal",
  "20": "Jharkhand",
  "21": "Odisha",
  "22": "Chhattisgarh",
  "23": "Madhya Pradesh",
  "24": "Gujarat",
  "25": "Daman & Diu",
  "26": "Dadra & Nagar Haveli",
  "27": "Maharashtra",
  "28": "Andhra Pradesh (Old)",
  "29": "Karnataka",
  "30": "Goa",
  "31": "Lakshadweep",
  "32": "Kerala",
  "33": "Tamil Nadu",
  "34": "Puducherry",
  "35": "Andaman & Nicobar Islands",
  "36": "Telangana",
  "37": "Andhra Pradesh",
  "38": "Ladakh",
  "97": "Other Territory",
  "99": "Centre Jurisdiction"
};

export const PAN_ENTITY_TYPES = {
  C: "Company",
  P: "Individual / Person",
  H: "HUF (Hindu Undivided Family)",
  F: "Firm / LLP",
  A: "Association of Persons (AOP)",
  T: "Trust",
  B: "Body of Individuals (BOI)",
  L: "Local Authority",
  J: "Artificial Juridical Person",
  G: "Government Agency"
};

/**
 * Calculates the official Indian GSTIN Luhn Mod-36 Check Digit
 * @param {string} gstin14 - First 14 characters of GSTIN
 * @returns {string} Expected 15th check character (0-9, A-Z)
 */
export function calculateGstCheckDigit(gstin14) {
  if (!gstin14 || gstin14.length < 14) return null;
  const chars = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ";
  const str = gstin14.substring(0, 14).toUpperCase();
  
  let factor = 1;
  let sum = 0;
  const modulus = 36;

  for (let i = 0; i < str.length; i++) {
    const codePoint = chars.indexOf(str[i]);
    if (codePoint === -1) return null;

    let addend = factor * codePoint;
    factor = factor === 2 ? 1 : 2;
    addend = Math.floor(addend / modulus) + (addend % modulus);
    sum += addend;
  }

  const remainder = sum % modulus;
  const checkCodePoint = (modulus - remainder) % modulus;
  return chars[checkCodePoint];
}

/**
 * Comprehensive Multi-Level Indian GSTIN Validator & Structural Parser
 * @param {string} gstinInput - The raw GSTIN string to validate
 * @param {string} [declaredState] - Optional invoice state to cross-verify against
 * @returns {Object} Full breakdown and validation result
 */
export function validateGSTIN(gstinInput, declaredState = null) {
  if (!gstinInput || String(gstinInput).trim() === "") {
    return {
      hasValue: false,
      isValid: true,
      length: 0,
      errors: [],
      breakdown: null
    };
  }

  const clean = String(gstinInput).trim().toUpperCase();
  const len = clean.length;
  const errors = [];

  // Level 1: Length Check
  if (len !== 15) {
    errors.push(`Length is ${len}/15 characters (must be exactly 15).`);
  }

  // Character Set Check
  if (!/^[0-9A-Z]+$/.test(clean)) {
    errors.push("Contains invalid special characters or spaces.");
  }

  // Level 2: State Code Check (Positions 1-2)
  const stateCode = clean.substring(0, 2);
  const stateName = GST_STATE_CODES[stateCode] || null;
  let stateMismatch = null;

  if (len >= 2) {
    if (!stateName) {
      errors.push(`Invalid State Code '${stateCode}' (must be a valid 2-digit Indian State code 01-38).`);
    } else if (declaredState && String(declaredState).trim()) {
      const cleanDeclared = String(declaredState).trim().toLowerCase();
      const cleanStateName = stateName.toLowerCase();
      if (!cleanDeclared.includes(cleanStateName) && !cleanStateName.includes(cleanDeclared)) {
        stateMismatch = `GSTIN is registered in ${stateName} (${stateCode}), but invoice state is '${declaredState}'.`;
      }
    }
  }

  // Level 3: Embedded PAN Check (Positions 3-12)
  const pan = len >= 12 ? clean.substring(2, 12) : null;
  const panRegex = /^[A-Z]{5}[0-9]{4}[A-Z]{1}$/;
  let isPanValid = false;
  let entityType = null;

  if (pan) {
    isPanValid = panRegex.test(pan);
    if (!isPanValid) {
      errors.push(`Invalid embedded PAN '${pan}' (must be 5 letters + 4 digits + 1 letter).`);
    } else {
      const entityChar = pan[3];
      entityType = PAN_ENTITY_TYPES[entityChar] || "Entity";
    }
  }

  // Level 4: Entity / Registration Digit (Position 13)
  const entityNumber = len >= 13 ? clean[12] : null;
  const isEntityNumValid = len >= 13 ? /^[1-9A-Z]$/.test(entityNumber) : false;
  if (len >= 13 && !isEntityNumValid) {
    errors.push(`Invalid entity registration character '${entityNumber}' at position 13.`);
  }

  // Level 5: 14th Character 'Z' Check
  const char14 = len >= 14 ? clean[13] : null;
  const isZValid = char14 === "Z";
  if (len >= 14 && !isZValid) {
    errors.push(`14th character must be 'Z' (found '${char14}').`);
  }

  // Level 6: Checksum Digit Verification (Position 15)
  const actualCheckDigit = len === 15 ? clean[14] : null;
  let expectedCheckDigit = null;
  let isChecksumValid = false;
  let correctedGstin = clean;

  if (len === 15) {
    expectedCheckDigit = calculateGstCheckDigit(clean.substring(0, 14));
    if (expectedCheckDigit) {
      correctedGstin = clean.substring(0, 14) + expectedCheckDigit;
      isChecksumValid = (actualCheckDigit === expectedCheckDigit);
    }
  }

  // Structural validity: Valid 15 chars, valid State Code, valid PAN format, 14th char 'Z'
  const isStructuralValid = len === 15 && Boolean(stateName) && isPanValid && isZValid;
  const isValid = isStructuralValid;

  return {
    hasValue: true,
    isValid,
    isChecksumValid,
    correctedGstin,
    length: len,
    cleanGstin: clean,
    errors,
    stateMismatch,
    breakdown: {
      stateCode: stateCode || null,
      stateName: stateName || "Unknown State",
      pan: pan || null,
      entityType: entityType || "Unknown",
      entityNumber: entityNumber || null,
      isZValid,
      actualCheckDigit,
      expectedCheckDigit,
      isChecksumValid
    }
  };
}

export default {
  GST_STATE_CODES,
  PAN_ENTITY_TYPES,
  calculateGstCheckDigit,
  validateGSTIN
};
