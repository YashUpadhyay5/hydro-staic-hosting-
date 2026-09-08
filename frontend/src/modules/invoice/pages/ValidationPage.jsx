import { useState, useEffect, useRef } from "react";
import { useOutletContext, useLocation, useNavigate } from "react-router-dom";
import API from "../services/api";
import KPICards from "../components/KPICards";
import DocumentPreview from "../components/DocumentPreview";
import ExtractionEditor from "../components/ExtractionEditor";
import ActionButtons from "../components/ActionButtons";
import ExcelDateRangeModal from "../components/ExcelDateRangeModal";
import { downloadInvoiceFile } from "../utils/constants";

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

  // Autofill PAN from GSTIN if present
  ["vendor_details", "consumer_details", "consignee_details"].forEach(party => {
    if (ext[party]) {
      const gstin = String(ext[party].gstin || "").trim();
      if (gstin.length >= 12 && !ext[party].pan) {
        ext[party].pan = gstin.substring(2, 12);
      }
    }
  });

  // Ensure default structures exist so React forms don't crash on undefined values
  if (!ext.invoice_details) ext.invoice_details = {};
  if (!ext.vendor_details) ext.vendor_details = {};
  if (!ext.consumer_details) ext.consumer_details = {};
  if (!ext.consignee_details) ext.consignee_details = {};
  if (!ext.transport_details) ext.transport_details = {};
  if (!ext.bank_details) ext.bank_details = {};
  if (!ext.items) ext.items = [];
  if (!ext.additional_charges) ext.additional_charges = [];
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
  const [editableExtraction, setEditableExtraction] = useState(null);
  const [isSaving, setIsSaving] = useState(false);
  const [isRetrying, setIsRetrying] = useState(false);
  const [verificationTime, setVerificationTime] = useState(0);
  const [timerActive, setTimerActive] = useState(false);
  const [dbFields, setDbFields] = useState({ msid: "", scheme_name: "All Scheme", req_qty: "", location: "", added_by: "", additional_charges: 0 });

  const activeDocument = selectedDocument || mockDocument;

  // KPI card filtering states
  const [activeFilter, setActiveFilter] = useState(null);
  const [searchQuery, setSearchQuery] = useState("");

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
      list = list.filter((d) => d.status === "ARCHIVED");
    } else if (activeFilter === "validated") {
      list = list.filter((d) => d.status === "VALIDATED" || d.status === "ARCHIVED");
    } else if (activeFilter === "pending") {
      list = list.filter((d) => d.status === "PENDING_VALIDATION");
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
          : `http://${window.location.hostname}:8000/api`;
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
        setEditableExtraction(normalizeExtraction(base));
        const s = selectedDocument.status;
        setTimerActive(s === "PENDING_VALIDATION" || s === "Processed" || s === "Saved");
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
        setTimerActive(false);
      }
    } else {
      setEditableExtraction(null);
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
    if (!selectedDocument || selectedDocument.status !== "FAILED") return;
    setIsRetrying(true);
    try {
      await API.post(`/documents/${selectedDocument.document_id}/retry`);
      showToast("Invoice re-queued for OCR processing…");
      setSelectedDocument(prev => ({ ...prev, status: "PROCESSING", error: null, ocr_result: null }));
      loadDocuments();
    } catch (error) {
      const errMsg = error.response?.data?.detail || "Retry failed.";
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
    window.open(`http://${window.location.hostname}:8000/api/export/summary/${selectedDocument.document_id}?token=${token}`, "_blank");
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
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "20px" }}>
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
              <h1 className="page-title" style={{ margin: 0, fontSize: "20px" }}>{getFilterTitle(activeFilter)}</h1>
              <p className="page-subtitle" style={{ margin: 0, fontSize: "12px" }}>Showing filtered matching records ({getFilteredDocuments().length} found)</p>
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
        <div className="ocr-section-content" style={{ padding: 0, flex: 1, overflowY: "auto", background: "var(--bg-panel)", borderRadius: "var(--radius-md)", border: "1px solid var(--border-color)" }}>
          {getFilteredDocuments().length === 0 ? (
            <div style={{ padding: "40px", textAlign: "center", color: "var(--text-secondary)" }}>
              No matching records found.
            </div>
          ) : (
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "13px", textAlign: "left" }}>
              <thead>
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
                {getFilteredDocuments().map((doc) => {
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
      </div>
    );
  }

  return (
    <div className="page-validation" style={!activeDocument ? { padding: "24px", height: "100%", overflowY: "auto", boxSizing: "border-box", display: "flex", flexDirection: "column", gap: "24px" } : {}}>
      {/* Page Header */}
      <div className="page-header">
        <div className="page-header-left" style={activeDocument ? { display: "flex", flexDirection: "row", alignItems: "center", gap: "16px" } : {}}>
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
            <h1 className="page-title">Invoice Validation</h1>
            <p className="page-subtitle">
              {activeDocument 
                ? `Verify OCR details for: ${activeDocument.filename}`
                : "Review and verify OCR-extracted invoice data"
              }
            </p>
          </div>
        </div>
      </div>

      {/* KPI Stats */}
      {activeFilter === null && (
        <KPICards
          selectedDocument={activeDocument}
          documents={documents}
          localExtraction={editableExtraction}
          dbFields={dbFields}
          onCardClick={setActiveFilter}
        />
      )}

      {/* Main Screen Layout */}
      {!activeDocument ? (
        /* Grid of Queue Cards when no document is active */
        <div className="validation-overview-queue" style={{ display: "flex", flexDirection: "column", gap: "16px", marginTop: "24px" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <h3 style={{ margin: 0, fontSize: "16px", fontWeight: "700" }}>{activeFilter ? getFilterTitle(activeFilter) : "All Scanned Documents"}</h3>
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
            {getFilteredDocuments().length === 0 ? (
              <div style={{ padding: "40px", textAlign: "center", color: "var(--text-secondary)", fontSize: "14px" }}>
                No matching documents found.
              </div>
            ) : (
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(320px, 1fr))", gap: "16px", padding: "16px" }}>
                 {getFilteredDocuments().map((doc) => {
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
        </div>
      ) : (
        /* Main Layout */
        <div className="main-layout" style={{ display: "flex", gap: "20px", marginTop: "24px", height: "calc(100vh - 180px)", overflow: "hidden" }}>
          {/* Left: Document Preview */}
          <DocumentPreview
            document={activeDocument}
            verificationTime={verificationTime}
            timerActive={timerActive}
            documents={documents}
            onSelect={handleSelectDocument}
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
                <p style={{ color: "var(--text-secondary)", fontSize: "13px", textAlign: "center", maxWidth: "320px" }}>
                  Error: <code>{activeDocument.error || "Unknown error"}</code>
                </p>
              </div>
            ) : (
              <ExtractionEditor
                document={activeDocument}
                extraction={editableExtraction}
                onExtractionChange={setEditableExtraction}
                dbFields={dbFields}
                onDbFieldsChange={setDbFields}
              />
            )}

            {selectedDocument && (
              <ActionButtons
                onSave={handleSave}
                onDownloadExcel={handleDownloadExcel}
                onPrint={handlePrint}
                onRetry={handleRetry}
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

      {/* Date Range Modal for Excel Export */}
      <ExcelDateRangeModal
        isOpen={showExcelModal}
        onClose={() => setShowExcelModal(false)}
        showToast={showToast}
      />
    </div>
  );
}
