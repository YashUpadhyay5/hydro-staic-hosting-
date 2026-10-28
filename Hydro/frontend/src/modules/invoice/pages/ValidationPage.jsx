import { useState, useEffect, useRef } from "react";
import { useOutletContext, useLocation, useNavigate } from "react-router-dom";
import API from "../services/api";
import KPICards from "../components/KPICards";
import DocumentPreview from "../components/DocumentPreview";
import ExtractionEditor from "../components/ExtractionEditor";
import ActionButtons from "../components/ActionButtons";
import ExcelDateRangeModal from "../components/ExcelDateRangeModal";
import GuidedStepperBar from "../components/GuidedStepperBar";
import VerificationDiffPopup from "../components/VerificationDiffPopup";
import { downloadInvoiceFile } from "../utils/constants";
import { extractTextFromRegion } from "../utils/ocrCropper";

const formatToInputDate = (dateStr) => {
  if (!dateStr) return "";
  if (/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return dateStr;
  const match = dateStr.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/);
  if (match) {
    const [_, day, month, year] = match;
    return `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
  }
  return "";
};

const normalizeExtraction = (rawExtraction) => {
  if (!rawExtraction || typeof rawExtraction !== "object") return null;
  let ext;
  try {
    ext = JSON.parse(JSON.stringify(rawExtraction));
  } catch {
    return null;
  }

  // Ensure default structures exist so React forms don't crash on undefined values
  if (!ext.invoice_details) ext.invoice_details = {};
  if (!ext.vendor_details) ext.vendor_details = {};
  if (!ext.consumer_details) ext.consumer_details = {};
  if (!ext.consignee_details) ext.consignee_details = {};
  if (!ext.transport_details) ext.transport_details = {};
  if (!ext.bank_details) ext.bank_details = {};
  if (!ext.items) ext.items = [];
  if (!ext.additional_charges) ext.additional_charges = [];

  // Normalize vendor GSTIN from all possible candidate locations
  const vGst = ext.vendor_details.gstin || ext.vendor_details.gst_number || ext.vendor_details.gst || ext.supplier_details?.gstin || ext.supplier_details?.gst_number || ext.vendor_gstin || ext.vendor_gst || "";
  if (vGst) {
    let clean = String(vGst).trim().replace(/[^0-9A-Za-z]/g, "").toUpperCase();
    if (clean.length === 16) {
      const test15 = clean.substring(0, 15);
      if (/^\d{2}[A-Z]{5}\d{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$/.test(test15)) {
        clean = test15;
      }
    }
    ext.vendor_details.gstin = clean;
  }

  // Normalize consumer GSTIN from all possible candidate locations
  const cGst = ext.consumer_details.gstin || ext.consumer_details.gst_number || ext.consumer_details.gst || ext.customer_details?.gstin || ext.buyer_details?.gstin || ext.consumer_gstin || ext.consumer_gst || "";
  if (cGst) {
    let clean = String(cGst).trim().replace(/[^0-9A-Za-z]/g, "").toUpperCase();
    if (clean.length === 16) {
      const test15 = clean.substring(0, 15);
      if (/^\d{2}[A-Z]{5}\d{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$/.test(test15)) {
        clean = test15;
      }
    }
    ext.consumer_details.gstin = clean;
  }

  // Autofill PAN from GSTIN if present
  ["vendor_details", "consumer_details", "consignee_details"].forEach(party => {
    if (ext[party]) {
      const gstin = String(ext[party].gstin || "").trim();
      if (gstin.length >= 12 && !ext[party].pan) {
        ext[party].pan = gstin.substring(2, 12);
      }
    }
  });
  if (!ext.tax_summary) {
    ext.tax_summary = { subtotal: 0, taxable_amount: 0, cgst: 0, sgst: 0, igst: 0, cess: 0, round_off: 0, total_tax: 0, grand_total: 0 };
  }

  // Ensure bank_details is properly populated from all candidate objects
  const vBank = ext.vendor_details?.bank_details || ext.supplier_details?.bank_details || ext.payment_details?.bank_details || {};
  ext.bank_details = {
    ...vBank,
    ...ext.bank_details,
    bank_name: ext.bank_details?.bank_name || vBank.bank_name || ext.bank_name || ext.vendor_details?.bank_name || "",
    account_number: ext.bank_details?.account_number || ext.bank_details?.account_no || vBank.account_number || vBank.account_no || ext.account_number || ext.account_no || "",
    ifsc_code: ext.bank_details?.ifsc_code || ext.bank_details?.ifsc || vBank.ifsc_code || vBank.ifsc || ext.ifsc_code || ext.ifsc || "",
    branch: ext.bank_details?.branch || ext.bank_details?.branch_name || vBank.branch || vBank.branch_name || ext.branch || "",
  };

  // Normalize bank details and IFSC code
  if (ext.bank_details && typeof ext.bank_details === "object") {
    const ifscVal = ext.bank_details.ifsc_code || ext.bank_details.ifsc || ext.bank_details.ifscCode || ext.bank_details.bank_ifsc || ext.bank_details.ifs_code || ext.bank_details.rtgs_ifsc || "";
    if (ifscVal) {
      let ifscStr = String(ifscVal).trim().replace(/\s+/g, "").toUpperCase();
      if (ifscStr.length === 11 && /^[A-Z]{4}[O0Qq][A-Z0-9]{6}$/.test(ifscStr)) {
        ifscStr = ifscStr.substring(0, 4) + '0' + ifscStr.substring(5);
      }
      ext.bank_details.ifsc_code = ifscStr;
      ext.bank_details.ifsc = ifscStr;
    }
    const accVal = ext.bank_details.account_number || ext.bank_details.account_no || ext.bank_details.acc_no || ext.bank_details.account || ext.bank_details.bank_account || "";
    if (accVal) {
      const accStr = String(accVal).trim().replace(/\s+/g, "");
      ext.bank_details.account_number = accStr;
      ext.bank_details.account_no = accStr;
    }
    const bankNameVal = ext.bank_details.bank_name || ext.bank_details.bank || ext.bank_details.name_of_bank || "";
    if (bankNameVal) {
      ext.bank_details.bank_name = String(bankNameVal).trim();
    }
    const branchVal = ext.bank_details.branch || ext.bank_details.branch_name || "";
    if (branchVal) {
      ext.bank_details.branch = String(branchVal).trim();
    }

    // Auto-derive bank name from IFSC prefix if bank_name is generic/missing
    const IFSC_BANK_MAP = {
      "SBIN": "State Bank of India",
      "HDFC": "HDFC Bank",
      "ICIC": "ICICI Bank",
      "UTIB": "Axis Bank",
      "PUNB": "Punjab National Bank",
      "BARB": "Bank of Baroda",
      "CNRB": "Canara Bank",
      "UBIN": "Union Bank of India",
      "KKBK": "Kotak Mahindra Bank",
      "INDB": "IndusInd Bank",
      "YESB": "Yes Bank",
      "IDFB": "IDFC FIRST Bank",
      "FDRL": "Federal Bank",
      "IOBA": "Indian Overseas Bank",
      "IDIB": "Indian Bank",
      "MAHB": "Bank of Maharashtra",
      "PSIB": "Punjab & Sind Bank",
      "UCBA": "UCO Bank",
      "CBIN": "Central Bank of India",
      "SCBL": "Standard Chartered Bank",
      "HSBC": "HSBC Bank",
      "CITI": "Citibank",
      "RBLN": "RBL Bank",
      "BDBL": "Bandhan Bank",
      "AUBL": "AU Small Finance Bank",
      "ESFB": "Equitas Small Finance Bank",
      "UJJV": "Ujjivan Small Finance Bank",
      "KVBL": "Karur Vysya Bank",
      "SIBL": "South Indian Bank",
      "CSBK": "CSB Bank",
      "TMBL": "Tamilnad Mercantile Bank",
      "DCBL": "DCB Bank",
      "DLXB": "Dhanlaxmi Bank",
      "JAKA": "Jammu & Kashmir Bank",
      "KBLX": "Karnataka Bank",
      "COSB": "Cosmos Co-operative Bank",
      "SVCB": "SVC Co-operative Bank",
      "TNSC": "Tamil Nadu State Apex Co-op Bank",
      "SARB": "Saraswat Bank",
      "DEUT": "Deutsche Bank",
      "DBSS": "DBS Bank India"
    };

    const bName = String(ext.bank_details.bank_name || "").toLowerCase().trim();
    if (!bName || ["bank", "bank details", "null", "none", "n/a"].includes(bName)) {
      if (ext.bank_details.ifsc_code && ext.bank_details.ifsc_code.length >= 4) {
        const prefix = ext.bank_details.ifsc_code.substring(0, 4).toUpperCase();
        if (IFSC_BANK_MAP[prefix]) {
          ext.bank_details.bank_name = IFSC_BANK_MAP[prefix];
        }
      }
    }
  }

  // Format dates for HTML date input compatibility if present
  if (ext.invoice_details.invoice_date) {
    ext.invoice_details.invoice_date = formatToInputDate(ext.invoice_details.invoice_date);
  }

  return ext;
};

const getStatusBadgeStyle = (status = "") => {
  switch (status.toUpperCase()) {
    case "PROCESSING":
      return { backgroundColor: "rgba(29, 78, 216, 0.1)", color: "#1d4ed8", border: "1px solid rgba(29, 78, 216, 0.2)" };
    case "PENDING_VALIDATION":
      return { backgroundColor: "rgba(245, 158, 11, 0.1)", color: "#d97706", border: "1px solid rgba(245, 158, 11, 0.2)" };
    case "VALIDATED":
      return { backgroundColor: "rgba(16, 185, 129, 0.1)", color: "#065f46", border: "1px solid rgba(16, 185, 129, 0.2)" };
    case "FAILED":
      return { backgroundColor: "rgba(239, 68, 68, 0.1)", color: "#991b1b", border: "1px solid rgba(239, 68, 68, 0.2)" };
    case "ARCHIVED":
      return { backgroundColor: "rgba(71, 85, 105, 0.1)", color: "#475569", border: "1px solid rgba(71, 85, 105, 0.2)" };
    default:
      return { backgroundColor: "rgba(245, 158, 11, 0.1)", color: "#d97706", border: "1px solid rgba(245, 158, 11, 0.2)" };
  }
};

const formatTime = (isoString) => {
  if (!isoString) return "-";
  try {
    const date = new Date(isoString);
    return date.toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return isoString;
  }
};

export default function ValidationPage() {
  const { documents, loadDocuments, showToast } = useOutletContext();
  const [selectedDocument, setSelectedDocument] = useState(null);
  const [mockDocument, setMockDocument] = useState(null);
  const [showExcelModal, setShowExcelModal] = useState(false);
  const [showRetryModal, setShowRetryModal] = useState(false);
  const [editableExtraction, setEditableExtraction] = useState(null);
  const [isSaving, setIsSaving] = useState(false);
  const [isRetrying, setIsRetrying] = useState(false);
  const [verificationTime, setVerificationTime] = useState(0);
  const [timerActive, setTimerActive] = useState(false);
  const [dbFields, setDbFields] = useState({ msid: "", scheme_name: "All Scheme", req_qty: "", location: "", added_by: "", additional_charges: 0 });

  // Guided step-by-step verification workflow states
  const [activeStep, setActiveStep] = useState(1);
  const [fieldsList, setFieldsList] = useState([]);
  const [verifiedFields, setVerifiedFields] = useState({});
  const [diffPopupState, setDiffPopupState] = useState({
    isOpen: false,
    position: null,
    currentValue: "",
    detectedValue: "",
    isLoading: false,
    activeFieldInfo: null,
  });

  const activeDocument = selectedDocument || mockDocument;

  const handleRegionSelected = async ({ boundsPct, cropBase64, pageIndex = 0, clientCoords }) => {
    if (!fieldsList || fieldsList.length === 0) return;
    const currentField = fieldsList[activeStep - 1] || fieldsList[0];
    if (!currentField) return;

    let currentVal = "";
    if (editableExtraction) {
      if (currentField.isItemField || currentField.rowIndex !== undefined) {
        const items = editableExtraction.items || editableExtraction.item_details || [];
        const item = items[currentField.rowIndex] || {};
        currentVal = item[currentField.fieldKey] ?? "";
      } else if (editableExtraction[currentField.sectionId]) {
        currentVal = editableExtraction[currentField.sectionId][currentField.fieldKey] ?? "";
      }
    }

    setDiffPopupState({
      isOpen: true,
      position: clientCoords,
      currentValue: String(currentVal),
      detectedValue: "",
      isLoading: true,
      activeFieldInfo: {
        label: currentField.label,
        sectionName: currentField.sectionName,
        fieldKey: currentField.fieldKey,
        sectionId: currentField.sectionId,
        boxNumber: currentField.boxNumber,
        rowIndex: currentField.rowIndex,
        isItemField: currentField.isItemField,
        pageIndex: pageIndex,
      },
    });

    const targetDocId = selectedDocument?.document_id || activeDocument?.document_id;
    const res = await extractTextFromRegion(targetDocId, boundsPct, cropBase64, {
      fieldKey: currentField.fieldKey,
      currentValue: String(currentVal),
      label: currentField.label,
      pageIndex: pageIndex,
    });

    setDiffPopupState((prev) => ({
      ...prev,
      detectedValue: res.text || "",
      isLoading: false,
    }));
  };

  const handleApplyDiff = (finalValue) => {
    if (!diffPopupState.activeFieldInfo) return;
    const { sectionId, fieldKey, boxNumber, rowIndex, isItemField } = diffPopupState.activeFieldInfo;

    setEditableExtraction((prev) => {
      if (!prev) return prev;
      if (isItemField || rowIndex !== undefined) {
        const items = [...(prev.items || prev.item_details || [])];
        if (items[rowIndex]) {
          const updatedItem = { ...items[rowIndex], [fieldKey]: finalValue };

          // Auto recalculate mathematical fields for line item
          const quantity = parseFloat(updatedItem.quantity) || 0;
          const unitPrice = parseFloat(updatedItem.unit_price) || 0;
          const discAmt = parseFloat(updatedItem.discount_amount) || 0;
          const rawTaxRate = String(updatedItem.tax_rate ?? "").trim().toLowerCase();
          const isExemptOrZero = ["0", "0%", "0.0", "0.00%", "nil", "exempt", "zero", "nill", "na", "n/a"].includes(rawTaxRate);
          const taxRateNum = isExemptOrZero ? 0 : (parseFloat(rawTaxRate.replace(/[^\d.-]/g, "")) || 0);

          if (fieldKey === "quantity" || fieldKey === "unit_price" || fieldKey === "discount_amount") {
            const calculatedTaxable = parseFloat(Math.max(0, (quantity * unitPrice) - discAmt).toFixed(2));
            updatedItem.taxable_amount = calculatedTaxable;
            if (taxRateNum > 0) {
              updatedItem.tax_amount = parseFloat((calculatedTaxable * taxRateNum / 100).toFixed(2));
            }
            updatedItem.total_amount = parseFloat((calculatedTaxable + (parseFloat(updatedItem.tax_amount) || 0)).toFixed(2));
          } else if (fieldKey === "tax_rate") {
            const taxable = parseFloat(updatedItem.taxable_amount) || parseFloat(Math.max(0, (quantity * unitPrice) - discAmt).toFixed(2));
            if (taxRateNum > 0) {
              updatedItem.tax_amount = parseFloat((taxable * taxRateNum / 100).toFixed(2));
            } else {
              updatedItem.tax_amount = 0;
            }
            updatedItem.total_amount = parseFloat((taxable + (parseFloat(updatedItem.tax_amount) || 0)).toFixed(2));
          } else if (fieldKey === "taxable_amount") {
            const taxable = parseFloat(finalValue) || 0;
            if (taxRateNum > 0) {
              updatedItem.tax_amount = parseFloat((taxable * taxRateNum / 100).toFixed(2));
            }
            updatedItem.total_amount = parseFloat((taxable + (parseFloat(updatedItem.tax_amount) || 0)).toFixed(2));
          }

          items[rowIndex] = updatedItem;
        }
        return {
          ...prev,
          items: items,
          item_details: items,
          [sectionId]: items,
        };
      }

      const secData = prev[sectionId] || {};
      return {
        ...prev,
        [sectionId]: {
          ...secData,
          [fieldKey]: finalValue,
        },
      };
    });

    const verifyKey = (isItemField || rowIndex !== undefined)
      ? `${sectionId}[${rowIndex}].${fieldKey}`
      : `${sectionId}.${fieldKey}`;

    setVerifiedFields((prev) => ({
      ...prev,
      [verifyKey]: true,
    }));

    setDiffPopupState((prev) => ({ ...prev, isOpen: false }));
    showToast(`✓ Box ${boxNumber}: ${diffPopupState.activeFieldInfo.label} applied & verified!`);

    if (boxNumber < fieldsList.length) {
      setActiveStep(boxNumber + 1);
    }
  };

  const handleCancelDiff = () => {
    setDiffPopupState((prev) => ({ ...prev, isOpen: false }));
  };

  const handleMarkFieldVerified = (sectionId, fieldKey, rowIndex) => {
    const verifyKey = rowIndex !== undefined
      ? `${sectionId}[${rowIndex}].${fieldKey}`
      : `${sectionId}.${fieldKey}`;
    setVerifiedFields((prev) => ({
      ...prev,
      [verifyKey]: true,
    }));
  };

  // KPI card filtering states
  const [activeFilter, setActiveFilter] = useState(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(24);
  const [tablePage, setTablePage] = useState(1);
  const [tablePageSize, setTablePageSize] = useState(25);

  useEffect(() => {
    setCurrentPage(1);
    setTablePage(1);
  }, [searchQuery, activeFilter]);

  const location = useLocation();
  const navigate = useNavigate();
  const processedStateRef = useRef(null);

  // Instant Upload triggered from UploadPage
  useEffect(() => {
    if (location.state?.filesToUpload && processedStateRef.current !== location.state) {
      processedStateRef.current = location.state;
      const files = location.state.filesToUpload;
      const templateId = location.state.templateId;
      navigate(location.pathname, { replace: true, state: {} });
      uploadAndProcessFiles(files, templateId);
    }
  }, [location]);

  // Handle redirect from Extraction History in UploadPage
  useEffect(() => {
    if (location.state?.autoSelectDocId) {
      const docId = location.state.autoSelectDocId;
      // Clear route state to prevent repeating on refresh
      navigate(location.pathname, { replace: true, state: {} });
      fetchFullDocumentDetails(docId);
    }
  }, [location]);



  // Handle forced reset from sidebar navigation
  useEffect(() => {
    const handleReset = () => {
      setSelectedDocument(null);
      setActiveFilter(null);
    };
    window.addEventListener("reset-validation-dashboard", handleReset);
    return () => window.removeEventListener("reset-validation-dashboard", handleReset);
  }, []);

  const uploadAndProcessFiles = async (files, templateId) => {
    if (!files || !files.length) return;
    
    // Set mock loading state
    setMockDocument({
      document_id: "temp-uploading",
      filename: files[0].name,
      status: "PROCESSING",
      ocr_result: null,
      final_extraction: null
    });

    const formData = new FormData();
    for (let file of files) formData.append("files", file);
    if (templateId) {
      formData.append("template_id", templateId);
    }

    try {
      const res = await API.post("/upload", formData, {
        headers: { "Content-Type": "multipart/form-data" },
      });
      showToast(`✓ ${files.length} document(s) uploaded successfully!`);
      loadDocuments();
      const docs = res.data?.documents || [];
      if (docs.length > 0) {
        setSelectedDocument(docs[0]);
      }
    } catch {
      showToast("Upload and processing failed.", "error");
      setMockDocument(prev => prev ? { ...prev, status: "FAILED", error: "Upload failed" } : null);
    } finally {
      setMockDocument(null);
    }
  };

  // Local polling status update loop
  useEffect(() => {
    let interval = null;
    const isProcessing = selectedDocument && (
      selectedDocument.status === "PROCESSING" ||
      selectedDocument.status === "UPLOADING" ||
      selectedDocument.status === "Pending" ||
      selectedDocument.status === "Processing"
    );
    if (isProcessing) {
      interval = setInterval(() => {
        fetchFullDocumentDetails(selectedDocument.document_id);
        loadDocuments();
      }, 2500);
    }
    return () => clearInterval(interval);
  }, [selectedDocument]);

  const getFilteredDocuments = () => {
    let list = documents || [];
    
    // Apply KPI filter
    if (activeFilter === "all") {
      list = list.filter((d) => d.status !== "DELETED");
    } else if (activeFilter === "failed") {
      list = list.filter((d) => d.status === "FAILED");
    } else if (activeFilter === "archived") {
      list = list.filter((d) => d.status === "ARCHIVED" || d.status === "Saved");
    } else if (activeFilter === "validated") {
      list = list.filter((d) => d.status === "VALIDATED" || d.status === "ARCHIVED" || d.status === "Saved");
    } else if (activeFilter === "pending") {
      list = list.filter((d) => d.status === "PENDING_VALIDATION" || d.status === "LocalPending");
    } else if (activeFilter === "processing") {
      list = list.filter((d) => d.status === "PROCESSING" || d.status === "Processing" || d.status === "Pending" || d.status === "UPLOADING");
    }
    
    // Apply search query filter
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase().trim();
      list = list.filter((d) => {
        const filename = d.filename?.toLowerCase() || "";
        const status = d.status?.toLowerCase() || "";
        const ext = d.final_extraction || d.ocr_result?.extraction || {};
        const invoiceNum = ext.invoice_details?.invoice_number?.toLowerCase() || "";
        const vendorName = ext.vendor_details?.name?.toLowerCase() || "";
        
        return filename.includes(q) || status.includes(q) || invoiceNum.includes(q) || vendorName.includes(q);
      });
    }
    
    return list;
  };

  const renderPaginationControls = (currPage, totPages, setPageFn, currPageSize, setPageSizeFn, totalCount, sizeOptions = [12, 24, 48, 96, "All"]) => {
    if (totalCount === 0) return null;
    const startItem = currPageSize === "All" ? 1 : (currPage - 1) * parseInt(currPageSize, 10) + 1;
    const endItem = currPageSize === "All" ? totalCount : Math.min(currPage * parseInt(currPageSize, 10), totalCount);

    const pages = [];
    const maxVisiblePages = 5;
    let startPage = Math.max(1, currPage - 2);
    let endPage = Math.min(totPages, startPage + maxVisiblePages - 1);
    if (endPage - startPage < maxVisiblePages - 1) {
      startPage = Math.max(1, endPage - maxVisiblePages + 1);
    }
    for (let p = startPage; p <= endPage; p++) {
      pages.push(p);
    }

    return (
      <div style={{
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
        padding: "12px 16px",
        background: "var(--bg-panel)",
        border: "1px solid var(--border-color)",
        borderRadius: "var(--radius-md)",
        marginTop: "16px",
        flexWrap: "wrap",
        gap: "12px",
        fontSize: "13px"
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: "12px", color: "var(--text-secondary)" }}>
          <span>
            Showing <strong style={{ color: "var(--text-primary)" }}>{startItem}–{endItem}</strong> of <strong style={{ color: "var(--text-primary)" }}>{totalCount}</strong> documents
          </span>
          <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
            <span>Per page:</span>
            <select
              value={currPageSize}
              onChange={(e) => {
                const val = e.target.value === "All" ? "All" : parseInt(e.target.value, 10);
                setPageSizeFn(val);
                setPageFn(1);
              }}
              style={{
                padding: "4px 8px",
                borderRadius: "var(--radius-sm)",
                border: "1px solid var(--border-color)",
                background: "var(--bg-card, var(--bg-panel))",
                color: "var(--text-primary)",
                fontSize: "12px",
                cursor: "pointer",
                outline: "none"
              }}
            >
              {sizeOptions.map(opt => (
                <option key={opt} value={opt}>{opt}</option>
              ))}
            </select>
          </div>
        </div>

        {totPages > 1 && currPageSize !== "All" && (
          <div style={{ display: "flex", alignItems: "center", gap: "4px" }}>
            <button
              onClick={() => setPageFn(1)}
              disabled={currPage === 1}
              className="btn btn-secondary"
              style={{ padding: "4px 8px", fontSize: "12px", height: "30px", opacity: currPage === 1 ? 0.4 : 1, cursor: currPage === 1 ? "not-allowed" : "pointer" }}
              title="First Page"
            >
              ««
            </button>
            <button
              onClick={() => setPageFn(p => Math.max(1, p - 1))}
              disabled={currPage === 1}
              className="btn btn-secondary"
              style={{ padding: "4px 10px", fontSize: "12px", height: "30px", opacity: currPage === 1 ? 0.4 : 1, cursor: currPage === 1 ? "not-allowed" : "pointer" }}
            >
              ‹ Prev
            </button>
            {pages.map(p => (
              <button
                key={p}
                onClick={() => setPageFn(p)}
                style={{
                  padding: "4px 10px",
                  fontSize: "12px",
                  height: "30px",
                  minWidth: "32px",
                  borderRadius: "var(--radius-sm)",
                  border: p === currPage ? "1px solid var(--primary-color)" : "1px solid var(--border-color)",
                  background: p === currPage ? "var(--primary-color)" : "var(--bg-card, transparent)",
                  color: p === currPage ? "#ffffff" : "var(--text-primary)",
                  fontWeight: p === currPage ? "700" : "500",
                  cursor: "pointer",
                  transition: "var(--transition)"
                }}
              >
                {p}
              </button>
            ))}
            <button
              onClick={() => setPageFn(p => Math.min(totPages, p + 1))}
              disabled={currPage === totPages}
              className="btn btn-secondary"
              style={{ padding: "4px 10px", fontSize: "12px", height: "30px", opacity: currPage === totPages ? 0.4 : 1, cursor: currPage === totPages ? "not-allowed" : "pointer" }}
            >
              Next ›
            </button>
            <button
              onClick={() => setPageFn(totPages)}
              disabled={currPage === totPages}
              className="btn btn-secondary"
              style={{ padding: "4px 8px", fontSize: "12px", height: "30px", opacity: currPage === totPages ? 0.4 : 1, cursor: currPage === totPages ? "not-allowed" : "pointer" }}
              title="Last Page"
            >
              »»
            </button>
          </div>
        )}
      </div>
    );
  };

  const getFilterTitle = (filter) => {
    switch (filter) {
      case "all": return "Total Scanned Documents";
      case "failed": return "Failed Invoices";
      case "archived": return "Archived Invoices";
      case "validated": return "Validated Invoices";
      case "pending": return "Pending Validation";
      case "processing": return "Active Processing Invoices";
      default: return "Filtered Invoices";
    }
  };

  const verificationTimeRef = useRef(0);
  const selectedDocRef = useRef(null);

  useEffect(() => { verificationTimeRef.current = verificationTime; }, [verificationTime]);
  useEffect(() => { selectedDocRef.current = selectedDocument; }, [selectedDocument]);

  const saveTimeSpent = async (docId, time) => {
    if (!docId) return;
    try { await API.post(`/documents/${docId}/time`, { verification_time: time }); } catch {}
  };

  useEffect(() => {
    let interval = null;
    if (timerActive) {
      interval = setInterval(() => setVerificationTime(t => t + 1), 1000);
    }
    return () => clearInterval(interval);
  }, [timerActive]);

  useEffect(() => {
    const onVisibilityChange = () => {
      const doc = selectedDocRef.current;
      const isProcessed = doc && (doc.status === "PENDING_VALIDATION" || doc.status === "ARCHIVED");
      if (document.hidden) {
        setTimerActive(false);
        if (doc) saveTimeSpent(doc.document_id, verificationTimeRef.current);
      } else if (isProcessed) setTimerActive(true);
    };
    const onUnload = () => {
      if (selectedDocRef.current) {
        const baseUrl = (import.meta.env && import.meta.env.VITE_API_URL) 
          ? import.meta.env.VITE_API_URL.replace(/\/$/, '') 
          : `/api`;
        const url = `${baseUrl}/documents/${selectedDocRef.current.document_id}/time`;
        const blob = new Blob([JSON.stringify({ verification_time: verificationTimeRef.current })], { type: "application/json" });
        navigator.sendBeacon(url, blob);
      }
    };

    document.addEventListener("visibilitychange", onVisibilityChange);
    window.addEventListener("pagehide", onUnload);
    return () => {
      document.removeEventListener("visibilitychange", onVisibilityChange);
      window.removeEventListener("pagehide", onUnload);
    };
  }, []);

  // Keyboard Shortcuts Hook
  useEffect(() => {
    const handleKeyDown = (event) => {
      if (isSaving) return;

      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s") {
        event.preventDefault();
        const s = selectedDocument?.status;
        const isProcessed = selectedDocument && (
          s === "PENDING_VALIDATION" ||
          s === "VALIDATED" ||
          s === "ARCHIVED"
        );
        if (selectedDocument && editableExtraction && isProcessed) {
          handleSave();
        } else {
          showToast("No active pending invoice data to save.", "warning");
        }
      }

      if (event.key === "ArrowRight" || event.key === "ArrowLeft") {
        const activeEl = document.activeElement;
        const isTyping = activeEl && (
          activeEl.tagName === "INPUT" || 
          activeEl.tagName === "TEXTAREA" || 
          activeEl.isContentEditable
        );
        if (isTyping) return;

        const queueDocs = documents || [];
        if (queueDocs.length <= 1) return;

        const currentIndex = selectedDocument
          ? queueDocs.findIndex(d => d.document_id === selectedDocument.document_id)
          : -1;

        let nextIndex = -1;
        if (event.key === "ArrowRight") {
          nextIndex = currentIndex + 1;
          if (nextIndex >= queueDocs.length) nextIndex = 0;
        } else if (event.key === "ArrowLeft") {
          nextIndex = currentIndex - 1;
          if (nextIndex < 0) nextIndex = queueDocs.length - 1;
        }

        if (nextIndex !== -1 && queueDocs[nextIndex]) {
          event.preventDefault();
          handleSelectDocument(queueDocs[nextIndex]);
          showToast(`Navigated: ${queueDocs[nextIndex].filename}`, "info");
        }
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [selectedDocument, editableExtraction, documents, isSaving, dbFields]);

  const fetchFullDocumentDetails = async (docId) => {
    try {
      const res = await API.get(`/documents/${docId}`);
      setSelectedDocument(res.data);
    } catch (e) { console.error("Failed to load document:", e); }
  };

  const handleSelectDocument = async (doc) => {
    if (selectedDocument && selectedDocument.document_id !== doc.document_id) {
      await saveTimeSpent(selectedDocument.document_id, verificationTime);
    }
    await fetchFullDocumentDetails(doc.document_id);
  };

  // Sync selected document when documents list updates
  useEffect(() => {
    if (selectedDocument) {
      const updated = documents.find(d => d.document_id === selectedDocument.document_id);
      if (updated && updated.status !== selectedDocument.status) {
        fetchFullDocumentDetails(selectedDocument.document_id);
      }
    }
  }, [documents]);

  // Load extraction when selected document changes
  useEffect(() => {
    if (selectedDocument) {
      setVerificationTime(selectedDocument.verification_time || 0);
      const base = selectedDocument.final_extraction || selectedDocument.ocr_result?.extraction || selectedDocument.extracted_data;
      if (base) {
        const norm = normalizeExtraction(base);
        setEditableExtraction(norm);
        const s = selectedDocument.status;
        setTimerActive(s === "PENDING_VALIDATION" || s === "Processed" || s === "Saved");
        setVerifiedFields({});

        setDbFields({
          msid: base.msid || selectedDocument.msid || "",
          scheme_name: base.scheme_name || selectedDocument.scheme_name || "All Scheme",
          req_qty: base.req_qty || selectedDocument.req_qty || "",
          location: base.location || selectedDocument.location || "",
          added_by: base.added_by || selectedDocument.added_by || "",
          additional_charges: base.additional_charges || 0,
        });
      } else {
        setEditableExtraction(null);
        setVerifiedFields({});
        setTimerActive(false);
      }
    } else {
      setEditableExtraction(null);
      setVerifiedFields({});
      setVerificationTime(0);
      setTimerActive(false);
    }
  }, [selectedDocument]);

  const handleSave = async () => {
    if (!selectedDocument || !editableExtraction) return;
    setIsSaving(true);
    const savedDocId = selectedDocument.document_id;
    const currentList = getFilteredDocuments();
    const currentIndex = currentList.findIndex(d => d.document_id === savedDocId);

    const payload = {
      document_id: savedDocId,
      extraction: editableExtraction,
      msid: dbFields.msid ? parseInt(dbFields.msid) || 1001 : 1001,
      scheme_name: dbFields.scheme_name || "All Scheme",
      req_qty: dbFields.req_qty || "",
      location: dbFields.location || "",
      added_by: dbFields.added_by || "System Agent",
      verification_time: verificationTime,
      additional_charges: parseFloat(dbFields.additional_charges) || 0.0,
    };
    try {
      await API.post("/inventory/save", payload);
      setTimerActive(false);
      showToast("✓ Invoice verified & saved to database!");
      await loadDocuments();
      setSelectedDocument(null);
    } catch (error) {
      const errMsg = error.response?.data?.detail || "Save failed. Please check details.";
      showToast(errMsg, "error");
    } finally {
      setIsSaving(false);
    }
  };

  const handleDelete = async (docIdParam) => {
    const targetId = (typeof docIdParam === "string" && docIdParam) ? docIdParam : (selectedDocument?.document_id || selectedDocument?.id);
    if (!targetId) return;

    if (!window.confirm("Are you sure you want to delete this invoice record?")) return;
    try {
      await API.delete(`/documents/${targetId}`);
      showToast("Invoice deleted successfully.");
      setSelectedDocument(null);
      await loadDocuments();
    } catch {
      showToast("Failed to delete invoice.", "error");
    }
  };

  const handleRetry = async () => {
    if (!selectedDocument) return;
    setIsRetrying(true);
    setShowRetryModal(false);
    try {
      await API.post(`/documents/${selectedDocument.document_id}/retry`);
      showToast("Invoice submitted to RunPod OCR for re-extraction…");
      setSelectedDocument(prev => ({
        ...prev,
        status: "PROCESSING",
        error: null,
        ocr_result: null,
        final_extraction: null
      }));
      setEditableExtraction(null);
      await loadDocuments();
    } catch (error) {
      const errMsg = error.response?.data?.detail || "Re-upload / Retry failed.";
      showToast(`Cannot retry: ${errMsg}`, "error");
    } finally {
      setIsRetrying(false);
    }
  };

  const handleDownloadExcel = () => {
    setShowExcelModal(true);
  };

  const handlePrint = () => {
    if (!selectedDocument) return;
    const token = localStorage.getItem("token") || "";
    window.open(`/api/export/summary/${selectedDocument.document_id}?token=${token}`, "_blank");
  };

  const isProcessed = activeDocument && (
    activeDocument.status === "PENDING_VALIDATION" ||
    activeDocument.status === "VALIDATED" ||
    activeDocument.status === "ARCHIVED" ||
    activeDocument.status === "PROCESSED" ||
    activeDocument.status === "SAVED"
  );
  const isFailed = activeDocument?.status === "FAILED";
  const isProcessing = activeDocument && (
    activeDocument.status === "PROCESSING" ||
    activeDocument.status === "UPLOADING" ||
    activeDocument.status === "Pending" ||
    activeDocument.status === "Processing"
  );
  const printData = activeDocument?.final_extraction || activeDocument?.ocr_result?.extraction || {};

  if (activeFilter !== null && !activeDocument) {
    return (
      <div className="page-validation" style={{ display: "flex", flexDirection: "column", height: "100%", padding: "24px", boxSizing: "border-box" }}>
        {/* Header */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "16px", flexShrink: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: "16px" }}>
            <button
              className="btn btn-secondary"
              onClick={() => setActiveFilter(null)}
              style={{
                width: "36px",
                height: "36px",
                padding: 0,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                borderRadius: "50%",
                border: "1px solid var(--border-color)",
                background: "var(--bg-panel)",
                cursor: "pointer",
                color: "var(--text-primary)",
                transition: "var(--transition)"
              }}
              title="Back to Dashboard"
            >
              <svg width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24">
                <line x1="19" y1="12" x2="5" y2="12"/><polyline points="12 19 5 12 12 5"/>
              </svg>
            </button>
            <div>
              <h1 className="page-title" style={{ margin: 0, fontSize: "20px", fontWeight: "700" }}>{getFilterTitle(activeFilter)}</h1>
              <p className="page-subtitle" style={{ margin: "2px 0 0", fontSize: "12px", color: "var(--text-secondary)" }}>Showing filtered matching records ({getFilteredDocuments().length} found)</p>
            </div>
          </div>
          <div style={{ position: "relative", width: "260px" }}>
            <input
              type="text"
              placeholder="Search these records..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              style={{
                width: "100%",
                padding: "8px 12px 8px 32px",
                borderRadius: "var(--radius-sm)",
                border: "1px solid var(--border-color)",
                background: "var(--bg-panel)",
                color: "var(--text-primary)",
                outline: "none",
                boxSizing: "border-box",
                height: "36px"
              }}
            />
          </div>
        </div>

        {/* Records Table */}
        {(() => {
          const tableDocs = getFilteredDocuments();
          const tTotal = tableDocs.length;
          const effSize = tablePageSize === "All" ? tTotal || 1 : parseInt(tablePageSize, 10);
          const tPages = Math.max(1, Math.ceil(tTotal / effSize));
          const sPage = Math.min(Math.max(1, tablePage), tPages);
          const pageItems = tablePageSize === "All" ? tableDocs : tableDocs.slice((sPage - 1) * effSize, sPage * effSize);

          return (
            <>
              <div className="ocr-section-content" style={{ padding: 0, flex: 1, minHeight: 0, overflowY: "auto", background: "var(--bg-panel)", borderRadius: "var(--radius-md)", border: "1px solid var(--border-color)" }}>
                {tTotal === 0 ? (
                  <div style={{ padding: "40px", textAlign: "center", color: "var(--text-secondary)" }}>
                    No matching records found.
                  </div>
                ) : (
                  <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "13px", textAlign: "left" }}>
                    <thead style={{ position: "sticky", top: 0, zIndex: 10, background: "var(--bg-table-header)" }}>
                      <tr style={{ background: "var(--bg-table-header)", borderBottom: "2px solid var(--border-color)" }}>
                        <th style={{ padding: "12px 16px", fontWeight: "600", color: "var(--text-secondary)" }}>Document Name</th>
                        <th style={{ padding: "12px 16px", fontWeight: "600", color: "var(--text-secondary)" }}>Upload/Create Time</th>
                        <th style={{ padding: "12px 16px", fontWeight: "600", color: "var(--text-secondary)" }}>Status</th>
                        <th style={{ padding: "12px 16px", fontWeight: "600", color: "var(--text-secondary)" }}>OCR Confidence</th>
                        <th style={{ padding: "12px 16px", fontWeight: "600", color: "var(--text-secondary)" }}>Grand Total</th>
                        <th style={{ padding: "12px 16px", fontWeight: "600", color: "var(--text-secondary)", textAlign: "right" }}>Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {pageItems.map((doc) => {
                        const ext = doc.final_extraction || doc.ocr_result?.extraction || {};
                        const total = ext.tax_summary?.grand_total || "N/A";
                        const conf = doc.ocr_result?.confidence ? `${doc.ocr_result.confidence}%` : "N/A";
                        return (
                          <tr
                            key={doc.document_id}
                            style={{ borderBottom: "1px solid var(--border-color)", cursor: "pointer" }}
                            onClick={() => handleSelectDocument(doc)}
                          >
                            <td style={{ padding: "12px 16px", fontWeight: "600", color: "var(--text-primary)" }}>{doc.filename}</td>
                            <td style={{ padding: "12px 16px", color: "var(--text-secondary)" }}>{formatTime(doc.created_at)}</td>
                            <td style={{ padding: "12px 16px" }}>
                              <span className="badge" style={{ ...getStatusBadgeStyle(doc.status), padding: "4px 10px", borderRadius: "100px", fontSize: "11px", fontWeight: "600" }}>
                                {doc.status}
                              </span>
                            </td>
                            <td style={{ padding: "12px 16px", color: "var(--text-secondary)" }}>{conf}</td>
                            <td style={{ padding: "12px 16px", fontWeight: "600", color: "var(--text-primary)" }}>{total !== "N/A" ? `₹${total}` : total}</td>
                            <td style={{ padding: "12px 16px", textAlign: "right" }} onClick={(e) => e.stopPropagation()}>
                              <button
                                onClick={() => handleSelectDocument(doc)}
                                className="btn btn-ghost"
                                style={{ padding: "4px 12px", fontSize: "11px", borderRadius: "var(--radius-sm)", height: "auto" }}
                              >
                                View & Verify
                              </button>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                )}
              </div>
              {renderPaginationControls(sPage, tPages, setTablePage, tablePageSize, setTablePageSize, tTotal, [25, 50, 100, "All"])}
            </>
          );
        })()}
      </div>
    );
  }

  const applyAutoFix = (fixAction) => {
    if (!fixAction || !setEditableExtraction) return;
    setEditableExtraction((prev) => {
      if (!prev) return prev;
      const updated = JSON.parse(JSON.stringify(prev));
      if (fixAction.type === 'SET_FIELD') {
        const { section, key, value } = fixAction;
        if (!updated[section]) updated[section] = {};
        updated[section][key] = value;
      } else if (fixAction.type === 'UPDATE_ITEM') {
        const { rowIndex, field, value } = fixAction;
        const items = [...(updated.items || updated.item_details || [])];
        if (items[rowIndex]) {
          const item = { ...items[rowIndex], [field]: value };
          // Recalculate item taxable / total if quantity or rate changed
          const q = parseFloat(item.quantity) || 0;
          const r = parseFloat(item.unit_price) || 0;
          const disc = parseFloat(item.discount_amount) || 0;
          const rawTaxRate = String(item.tax_rate ?? "").trim().toLowerCase();
          const isExemptOrZero = ["0", "0%", "0.0", "0.00%", "nil", "exempt", "zero", "nill", "na", "n/a"].includes(rawTaxRate);
          const taxRateNum = isExemptOrZero ? 0 : (parseFloat(rawTaxRate.replace(/[^\d.-]/g, "")) || 0);

          if (field === "quantity" || field === "unit_price" || field === "discount_amount") {
            const calculatedTaxable = parseFloat(Math.max(0, (q * r) - disc).toFixed(2));
            item.taxable_amount = calculatedTaxable;
            if (taxRateNum > 0) {
              item.tax_amount = parseFloat((calculatedTaxable * taxRateNum / 100).toFixed(2));
            }
            item.total_amount = parseFloat((calculatedTaxable + (parseFloat(item.tax_amount) || 0)).toFixed(2));
          } else if (field === "taxable_amount") {
            const taxable = parseFloat(value) || 0;
            item.taxable_amount = taxable;
            if (taxRateNum > 0) {
              item.tax_amount = parseFloat((taxable * taxRateNum / 100).toFixed(2));
            }
            item.total_amount = parseFloat((taxable + (parseFloat(item.tax_amount) || 0)).toFixed(2));
          }
          items[rowIndex] = item;
          updated.items = items;
          updated.item_details = items;
        }
      } else if (fixAction.type === 'SPLIT_IGST_TO_CGST_SGST') {
        const { igst } = fixAction;
        const half = parseFloat((igst / 2).toFixed(2));
        if (!updated.tax_summary) updated.tax_summary = {};
        updated.tax_summary.igst = 0;
        updated.tax_summary.cgst = half;
        updated.tax_summary.sgst = half;
      }
      return updated;
    });
    showToast(`⚡ Auto-Fix applied: ${fixAction.description || 'Updated extraction'}`);
  };

  const handleJumpToField = (sectionId, fieldKey, rowIndex) => {
    let matchIndex = -1;

    if (fieldsList && fieldsList.length > 0) {
      matchIndex = fieldsList.findIndex(f => {
        if (sectionId && (f.sectionId !== sectionId && f.sectionId !== "items" && f.sectionId !== "item_details")) return false;
        if (fieldKey && f.fieldKey !== fieldKey) return false;
        if (rowIndex !== undefined && f.rowIndex !== rowIndex) return false;
        return true;
      });

      if (matchIndex === -1 && fieldKey) {
        matchIndex = fieldsList.findIndex(f => f.fieldKey === fieldKey);
      }
    }

    if (matchIndex !== -1) {
      const targetStep = matchIndex + 1;
      setActiveStep(targetStep);
      setTimeout(() => {
        const el = document.querySelector(`[data-box-step="${targetStep}"]`) ||
                   (rowIndex !== undefined ? document.querySelector(`[data-row-index="${rowIndex}"][data-col-key="${fieldKey}"]`) : null);
        if (el) {
          el.scrollIntoView({ behavior: "smooth", block: "center" });
          const input = el.tagName === "INPUT" ? el : el.querySelector("input, textarea");
          if (input) {
            input.focus({ preventScroll: true });
            input.style.boxShadow = "0 0 0 4px rgba(37, 99, 235, 0.5)";
            setTimeout(() => {
              input.style.boxShadow = "";
            }, 2000);
          }
        }
      }, 50);
    } else if (rowIndex !== undefined && fieldKey) {
      setTimeout(() => {
        const el = document.querySelector(`[data-row-index="${rowIndex}"][data-col-key="${fieldKey}"]`) ||
                   document.querySelector(`tr:nth-child(${rowIndex + 1}) input`);
        if (el) {
          el.scrollIntoView({ behavior: "smooth", block: "center" });
          const input = el.tagName === "INPUT" ? el : el.querySelector("input, textarea");
          if (input) {
            input.focus({ preventScroll: true });
            input.style.boxShadow = "0 0 0 4px rgba(37, 99, 235, 0.5)";
            setTimeout(() => {
              input.style.boxShadow = "";
            }, 2000);
          }
        }
      }, 50);
    }
  };

  return (
    <div className="page-validation" style={{ padding: "20px 24px", height: "100%", overflowY: "auto", boxSizing: "border-box", display: "flex", flexDirection: "column", gap: "16px" }}>
      {/* Page Header */}
      <div className="page-header" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexShrink: 0 }}>
        <div className="page-header-left" style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: "16px" }}>
          {activeDocument && (
            <button
              className="btn btn-secondary"
              onClick={async () => {
                if (selectedDocument) await saveTimeSpent(selectedDocument.document_id, verificationTime);
                setSelectedDocument(null);
                setMockDocument(null);
              }}
              style={{
                width: "36px",
                height: "36px",
                padding: 0,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                borderRadius: "50%",
                border: "1px solid var(--border-color)",
                background: "var(--bg-panel)",
                cursor: "pointer",
                color: "var(--text-primary)",
                transition: "var(--transition)"
              }}
              title="Back to Overview"
            >
              <svg width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24">
                <line x1="19" y1="12" x2="5" y2="12"/><polyline points="12 19 5 12 12 5"/>
              </svg>
            </button>
          )}
          <div>
            <h1 className="page-title" style={{ margin: 0, fontSize: "20px", fontWeight: "700" }}>Invoice Validation</h1>
            <p className="page-subtitle" style={{ margin: "2px 0 0", fontSize: "12px", color: "var(--text-secondary)" }}>
              {activeDocument 
                ? `Verify OCR details for: ${activeDocument.filename}`
                : "Review and verify OCR-extracted invoice data"
              }
            </p>
          </div>
        </div>
      </div>

      {/* KPI Stats */}
      {(activeFilter === null || activeDocument) && (
        <KPICards
          selectedDocument={activeDocument}
          documents={documents}
          localExtraction={editableExtraction}
          dbFields={dbFields}
          onCardClick={setActiveFilter}
          onJumpToField={handleJumpToField}
          onAutoFix={applyAutoFix}
        />
      )}

      {/* Main Screen Layout */}
      {!activeDocument ? (() => {
          const gridDocs = getFilteredDocuments();
          const gTotal = gridDocs.length;
          const effGridSize = pageSize === "All" ? gTotal || 1 : parseInt(pageSize, 10);
          const gPages = Math.max(1, Math.ceil(gTotal / effGridSize));
          const sGridPage = Math.min(Math.max(1, currentPage), gPages);
          const paginatedGridDocs = pageSize === "All" ? gridDocs : gridDocs.slice((sGridPage - 1) * effGridSize, sGridPage * effGridSize);

          return (
            <div className="validation-overview-queue" style={{ display: "flex", flexDirection: "column", gap: "16px", marginTop: "24px" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
                  <h3 style={{ margin: 0, fontSize: "16px", fontWeight: "700" }}>{activeFilter ? getFilterTitle(activeFilter) : "All Scanned Documents"}</h3>
                  <span style={{
                    fontSize: "12px",
                    fontWeight: "600",
                    background: "rgba(79, 70, 229, 0.1)",
                    color: "var(--primary-color)",
                    padding: "2px 8px",
                    borderRadius: "12px",
                    border: "1px solid rgba(79, 70, 229, 0.2)"
                  }}>
                    {gTotal} Documents
                  </span>
                </div>
                <div style={{ position: "relative", width: "240px" }}>
                  <input
                    type="text"
                    placeholder="Search queue..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    style={{
                      width: "100%",
                      padding: "8px 12px 8px 32px",
                      borderRadius: "var(--radius-sm)",
                      border: "1px solid var(--border-color)",
                      background: "var(--bg-panel)",
                      color: "var(--text-primary)",
                      outline: "none",
                      boxSizing: "border-box",
                      height: "36px"
                    }}
                  />
                  {searchQuery && (
                    <button
                      onClick={() => setSearchQuery("")}
                      style={{
                        position: "absolute",
                        right: "10px",
                        top: "50%",
                        transform: "translateY(-50%)",
                        background: "none",
                        border: "none",
                        color: "var(--text-secondary)",
                        cursor: "pointer",
                        padding: "2px",
                        display: "flex",
                        alignItems: "center"
                      }}
                    >
                      <svg width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24">
                        <line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line>
                      </svg>
                    </button>
                  )}
                </div>
              </div>

              <div className="ocr-section-content" style={{ padding: 0, overflowY: "auto", flex: 1, background: "var(--bg-panel)", borderRadius: "var(--radius-md)", border: "1px solid var(--border-color)" }}>
                {gTotal === 0 ? (
                  <div style={{ padding: "40px", textAlign: "center", color: "var(--text-secondary)", fontSize: "14px" }}>
                    No matching documents found.
                  </div>
                ) : (
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(320px, 1fr))", gap: "16px", padding: "16px" }}>
                    {paginatedGridDocs.map((doc) => {
                      const ext = doc.final_extraction || doc.ocr_result?.extraction || {};
                      let vendorName = ext.vendor_details?.name || "";
                      let invoiceNum = ext.invoice_details?.invoice_number || "";
                      
                      if (!vendorName || vendorName === "Unknown Vendor" || vendorName === "N/A") {
                        if (doc.filename) {
                          const parts = doc.filename.split(" - ");
                          if (parts.length >= 2) {
                            vendorName = parts[0].trim();
                            if (!invoiceNum || invoiceNum === "N/A") {
                              invoiceNum = parts.slice(1).join(" - ").trim();
                            }
                          } else {
                            vendorName = doc.filename.replace(/\.[^/.]+$/, "").trim();
                          }
                        }
                      }
                      
                      if (!vendorName) vendorName = "Unknown Vendor";
                      const title = invoiceNum && invoiceNum !== "N/A" ? `${vendorName} - ${invoiceNum}` : vendorName;
                      return (
                        <div
                          key={doc.document_id}
                          onClick={() => handleSelectDocument(doc)}
                          className="kpi-card"
                          style={{
                            padding: "20px",
                            cursor: "pointer",
                            display: "flex",
                            flexDirection: "column",
                            gap: "16px",
                            justifyContent: "space-between",
                            minHeight: "130px",
                            background: "var(--bg-panel)",
                            border: "1px solid var(--border-color)",
                            borderRadius: "var(--radius-md)",
                            boxShadow: "var(--shadow-sm)",
                            transition: "var(--transition)"
                          }}
                        >
                          <div style={{ fontSize: "15px", fontWeight: "700", color: "var(--text-primary)", wordBreak: "break-word", lineHeight: "1.4" }}>
                            {title}
                          </div>
                          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                            <span className="badge" style={{ ...getStatusBadgeStyle(doc.status), padding: "4px 10px", borderRadius: "100px", fontSize: "11px", fontWeight: "600" }}>
                              {doc.status}
                            </span>
                            <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  downloadInvoiceFile(doc);
                                }}
                                title="Download invoice file"
                                className="btn btn-secondary"
                                style={{ padding: "3px 8px", fontSize: "11px", height: "24px", display: "inline-flex", alignItems: "center", gap: "4px" }}
                              >
                                📥 Download
                              </button>
                              <span style={{ fontSize: "12px", color: "var(--text-secondary)" }}>
                                {formatTime(doc.created_at)}
                              </span>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
              {renderPaginationControls(sGridPage, gPages, setCurrentPage, pageSize, setPageSize, gTotal, [12, 24, 48, 96, "All"])}
            </div>
          );
        })() : (
        /* Main Layout */
        <div className="main-layout" style={{ display: "flex", gap: "20px", flex: 1, minHeight: 0, overflow: "hidden" }}>
          {/* Left: Document Preview */}
          <DocumentPreview
            document={activeDocument}
            verificationTime={verificationTime}
            timerActive={timerActive}
            documents={documents}
            onSelect={handleSelectDocument}
            activeFieldInfo={fieldsList[activeStep - 1] || null}
            onRegionSelected={handleRegionSelected}
          />

          {/* Right: Editor + Actions */}
          <div className="content-area" style={{ width: "60%", display: "flex", flexDirection: "column", height: "100%", overflow: "hidden", position: "relative" }}>
            {isProcessing ? (
              <div className="editor-panel" style={{ width: "100%", padding: "0", display: "flex", flexDirection: "column", height: "100%", overflow: "hidden", position: "relative" }}>
                {/* Floating Processing Alert Overlay */}
                <div style={{
                  position: "absolute",
                  top: "24px",
                  left: "50%",
                  transform: "translateX(-50%)",
                  background: "var(--bg-panel)",
                  border: "1px solid var(--border-color)",
                  borderRadius: "var(--radius-md)",
                  boxShadow: "var(--shadow-lg)",
                  padding: "16px 24px",
                  display: "flex",
                  alignItems: "center",
                  gap: "16px",
                  zIndex: 10,
                  width: "80%",
                  maxWidth: "400px"
                }}>
                  <svg width="32" height="32" fill="none" stroke="var(--primary-color)" strokeWidth="3" viewBox="0 0 24 24" style={{ animation: "spin 1.5s linear infinite", flexShrink: 0 }}>
                    <circle cx="12" cy="12" r="10" stroke="var(--border-color)"/><path d="M12 2a10 10 0 0 1 10 10" strokeLinecap="round"/>
                  </svg>
                  <div style={{ display: "flex", flexDirection: "column", gap: "2px" }}>
                    <span style={{ fontWeight: "700", fontSize: "14px", color: "var(--text-primary)" }}>AI Extraction Running</span>
                    <span style={{ fontSize: "12px", color: "var(--text-secondary)" }}>Status: <strong style={{ color: "var(--primary-color)" }}>{activeDocument.status}</strong></span>
                  </div>
                </div>

                {/* Skeleton Forms */}
                <div className="skeleton-container" style={{ opacity: 0.45, pointerEvents: "none", userSelect: "none" }}>
                  <div className="skeleton-title skeleton-pulse"></div>
                  <div className="skeleton-row">
                    <div className="skeleton-field skeleton-pulse"></div>
                    <div className="skeleton-field skeleton-pulse"></div>
                  </div>
                  <div className="skeleton-row">
                    <div className="skeleton-field skeleton-pulse"></div>
                    <div className="skeleton-field skeleton-pulse"></div>
                  </div>
                  <div className="skeleton-title skeleton-pulse" style={{ marginTop: "16px", width: "20%" }}></div>
                  <div className="skeleton-row">
                    <div className="skeleton-field skeleton-pulse"></div>
                    <div className="skeleton-field skeleton-pulse"></div>
                  </div>
                  <div className="skeleton-table-header skeleton-pulse"></div>
                  <div className="skeleton-table-row skeleton-pulse"></div>
                  <div className="skeleton-table-row skeleton-pulse"></div>
                </div>
              </div>
            ) : isFailed ? (
              <div className="editor-panel" style={{ width: "100%", alignItems: "center", justifyContent: "center", padding: "40px", color: "#b91c1c" }}>
                <svg width="48" height="48" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24" style={{ marginBottom: "16px" }}>
                  <circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/>
                </svg>
                <h3 style={{ margin: "0 0 8px" }}>OCR Processing Failed</h3>
                <p style={{ color: "var(--text-secondary)", fontSize: "13px", textAlign: "center", maxWidth: "320px", marginBottom: "16px" }}>
                  Error: <code>{activeDocument.error || "Unknown error"}</code>
                </p>
                <button
                  className="btn btn-primary"
                  onClick={() => setShowRetryModal(true)}
                  style={{
                    backgroundColor: "#dc2626",
                    borderColor: "#b91c1c",
                    color: "#ffffff",
                    padding: "8px 18px",
                    fontSize: "13px",
                    fontWeight: "600",
                    borderRadius: "6px"
                  }}
                >
                  🔄 Re-upload & Retry with RunPod
                </button>
              </div>
            ) : (
              <>
                {fieldsList.length > 0 && (
                  <GuidedStepperBar
                    totalFields={fieldsList.length}
                    activeStep={activeStep}
                    activeFieldInfo={fieldsList[activeStep - 1] || {}}
                    verifiedCount={Object.keys(verifiedFields).length}
                    onPrev={() => setActiveStep(s => Math.max(1, s - 1))}
                    onNext={() => setActiveStep(s => Math.min(fieldsList.length, s + 1))}
                    onSkip={() => setActiveStep(s => Math.min(fieldsList.length, s + 1))}
                    onSave={handleSave}
                  />
                )}
                <ExtractionEditor
                  document={activeDocument}
                  extraction={editableExtraction}
                  onExtractionChange={setEditableExtraction}
                  dbFields={dbFields}
                  onDbFieldsChange={setDbFields}
                  activeStep={activeStep}
                  onActiveStepChange={setActiveStep}
                  verifiedFields={verifiedFields}
                  onMarkFieldVerified={handleMarkFieldVerified}
                  onFieldsListGenerated={setFieldsList}
                  onSave={handleSave}
                />
              </>
            )}

            {selectedDocument && (
              <ActionButtons
                onSave={handleSave}
                onDownloadExcel={handleDownloadExcel}
                onPrint={handlePrint}
                onRetry={() => setShowRetryModal(true)}
                onOpenRetryModal={() => setShowRetryModal(true)}
                onDelete={handleDelete}
                selectedDocument={selectedDocument}
                isSaving={isSaving}
                isRetrying={isRetrying}
                isProcessed={isProcessed}
                isFailed={isFailed}
                isSaved={selectedDocument?.status === "VALIDATED" || selectedDocument?.status === "ARCHIVED" || selectedDocument?.saved}
                verificationTime={verificationTime}
                timerActive={timerActive}
              />
            )}
          </div>
        </div>
      )}

      {/* Verification Diff Pop-up Modal */}
      <VerificationDiffPopup
        isOpen={diffPopupState.isOpen}
        position={diffPopupState.position}
        currentValue={diffPopupState.currentValue}
        detectedValue={diffPopupState.detectedValue}
        activeFieldInfo={diffPopupState.activeFieldInfo || {}}
        onApply={handleApplyDiff}
        onCancel={handleCancelDiff}
        isLoading={diffPopupState.isLoading}
      />

      {/* Date Range Modal for Excel Export */}
      <ExcelDateRangeModal
        isOpen={showExcelModal}
        onClose={() => setShowExcelModal(false)}
        showToast={showToast}
      />

      {/* Red Confirmation Modal for Re-upload / Retry Extraction */}
      {showRetryModal && selectedDocument && (
        <div
          className="modal-backdrop"
          style={{
            position: "fixed",
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            backgroundColor: "rgba(15, 23, 42, 0.65)",
            backdropFilter: "blur(4px)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 9999,
            animation: "fadeIn 0.15s ease-out"
          }}
          onClick={() => !isRetrying && setShowRetryModal(false)}
        >
          <div
            className="modal-content"
            style={{
              backgroundColor: "#ffffff",
              borderRadius: "12px",
              boxShadow: "0 20px 25px -5px rgba(0, 0, 0, 0.2), 0 10px 10px -5px rgba(0, 0, 0, 0.1)",
              width: "100%",
              maxWidth: "480px",
              overflow: "hidden",
              border: "1px solid #fee2e2",
              animation: "scaleUp 0.15s ease-out"
            }}
            onClick={(e) => e.stopPropagation()}
          >
            {/* Red Modal Header */}
            <div
              style={{
                backgroundColor: "#fef2f2",
                borderBottom: "1px solid #fecaca",
                padding: "16px 20px",
                display: "flex",
                alignItems: "center",
                gap: "12px"
              }}
            >
              <div
                style={{
                  width: "36px",
                  height: "36px",
                  borderRadius: "50%",
                  backgroundColor: "#fee2e2",
                  color: "#dc2626",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  flexShrink: 0,
                  fontSize: "18px"
                }}
              >
                ⚠️
              </div>
              <div>
                <h3 style={{ margin: 0, fontSize: "16px", fontWeight: "700", color: "#991b1b" }}>
                  Re-upload & Re-extract Invoice
                </h3>
                <p style={{ margin: "2px 0 0", fontSize: "12px", color: "#b91c1c" }}>
                  RunPod AI Optical Character Recognition
                </p>
              </div>
            </div>

            {/* Modal Body */}
            <div style={{ padding: "20px" }}>
              <p style={{ margin: "0 0 14px", fontSize: "14px", color: "#334155", lineHeight: "1.5" }}>
                Are you sure you want to <strong>re-upload and re-process</strong> this invoice with RunPod AI?
              </p>

              {/* Invoice Info Card */}
              <div
                style={{
                  backgroundColor: "#f8fafc",
                  border: "1px solid #e2e8f0",
                  borderRadius: "8px",
                  padding: "12px 14px",
                  marginBottom: "16px"
                }}
              >
                <div style={{ fontSize: "12px", color: "#64748b", marginBottom: "4px" }}>Target Invoice:</div>
                <div style={{ fontSize: "13px", fontWeight: "600", color: "#0f172a", wordBreak: "break-all" }}>
                  📄 {selectedDocument.filename}
                </div>
                <div style={{ display: "flex", gap: "12px", marginTop: "6px", fontSize: "11px", color: "#64748b" }}>
                  <span>Status: <strong style={{ color: "#334155" }}>{selectedDocument.status}</strong></span>
                </div>
              </div>

              {/* Warning Callout */}
              <div
                style={{
                  backgroundColor: "#fffbeb",
                  border: "1px solid #fde68a",
                  borderRadius: "6px",
                  padding: "10px 12px",
                  fontSize: "12px",
                  color: "#92400e",
                  display: "flex",
                  gap: "8px",
                  alignItems: "flex-start"
                }}
              >
                <span style={{ fontSize: "14px", lineHeight: "1" }}>ℹ️</span>
                <span>
                  This will re-send the original invoice file to the RunPod OCR pipeline to re-extract all vendor information, invoice fields, tax calculations, and line items.
                </span>
              </div>
            </div>

            {/* Red Action Footer */}
            <div
              style={{
                padding: "12px 20px",
                backgroundColor: "#f8fafc",
                borderTop: "1px solid #e2e8f0",
                display: "flex",
                justifyContent: "flex-end",
                gap: "10px"
              }}
            >
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => setShowRetryModal(false)}
                disabled={isRetrying}
                style={{ padding: "8px 16px", fontSize: "13px" }}
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleRetry}
                disabled={isRetrying}
                style={{
                  backgroundColor: "#dc2626",
                  borderColor: "#b91c1c",
                  color: "#ffffff",
                  padding: "8px 18px",
                  fontSize: "13px",
                  fontWeight: "600",
                  borderRadius: "6px",
                  border: "none",
                  cursor: isRetrying ? "not-allowed" : "pointer",
                  display: "inline-flex",
                  alignItems: "center",
                  gap: "6px",
                  boxShadow: "0 1px 2px rgba(220, 38, 38, 0.3)"
                }}
              >
                {isRetrying ? (
                  <>
                    <svg width="14" height="14" fill="none" viewBox="0 0 24 24" style={{ animation: "spin 1s linear infinite" }}>
                      <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" style={{ opacity: 0.25 }}></circle>
                      <path fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                    </svg>
                    <span>Submitting to RunPod…</span>
                  </>
                ) : (
                  <>
                    <svg width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                      <polyline points="1 4 1 10 7 10"></polyline>
                      <path d="M3.51 15a9 9 0 1 0 .49-3.5"></path>
                    </svg>
                    <span>Yes, Re-upload & Extract</span>
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
