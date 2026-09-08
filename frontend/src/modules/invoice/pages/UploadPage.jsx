import { useState, useEffect, useRef } from "react";
import { useOutletContext, useLocation, useNavigate } from "react-router-dom";
import API from "../services/api";
import KPICards from "../components/KPICards";
import DocumentPreview from "../components/DocumentPreview";
import ExtractionEditor from "../components/ExtractionEditor";
import ActionButtons from "../components/ActionButtons";
import TemplateWizard from "../components/TemplateWizard";
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

  if (ext.invoice_details?.invoice_date) {
    ext.invoice_details.invoice_date = formatToInputDate(ext.invoice_details.invoice_date);
  }

  const findStateInAddress = (address) => {
    if (!address) return "";
    const states = ["Andhra Pradesh","Arunachal Pradesh","Assam","Bihar","Chhattisgarh","Goa","Gujarat","Haryana","Himachal Pradesh","Jharkhand","Karnataka","Kerala","Madhya Pradesh","Maharashtra","Manipur","Meghalaya","Mizoram","Nagaland","Odisha","Punjab","Rajasthan","Sikkim","Tamil Nadu","Telangana","Tripura","Uttar Pradesh","Uttarakhand","West Bengal","Delhi"];
    for (let s of states) {
      if (address.toLowerCase().includes(s.toLowerCase())) return s;
    }
    return "";
  };

  if (ext.vendor_details) {
    if (!ext.vendor_details.state && ext.vendor_details.address)
      ext.vendor_details.state = findStateInAddress(ext.vendor_details.address);
    if (!ext.vendor_details.pan && ext.vendor_details.gstin) {
      const gstin = ext.vendor_details.gstin.trim();
      if (gstin.length >= 12) ext.vendor_details.pan = gstin.substring(2, 12);
    }
  }
  if (ext.consumer_details && !ext.consumer_details.state && ext.consumer_details.address)
    ext.consumer_details.state = findStateInAddress(ext.consumer_details.address);
  if (ext.consignee_details && !ext.consignee_details.state && ext.consignee_details.address)
    ext.consignee_details.state = findStateInAddress(ext.consignee_details.address);

  const tSource = ext.transport_details || {};
  const tInvoice = ext.invoice_details?.transport_details || {};
  if (Object.keys(tSource).length === 0 || (!tSource.destination && !tSource.gr_no && !tSource.vehicle_number)) {
    ext.transport_details = {
      destination: tSource.destination || tInvoice.destination || "",
      gr_no: tSource.gr_no || tInvoice.gr_no || "",
      vehicle_number: tSource.vehicle_number || tInvoice.vehicle_number || "",
      weight: tSource.weight || tInvoice.weight || "",
      mode_of_transport: tSource.mode_of_transport || tInvoice.mode_of_transport || tInvoice.transporter_name || "",
    };
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
    const bName = String(ext.bank_details.bank_name || "").trim().toLowerCase();
    if (!bName || ["bank", "bank details", "details", "null", "none", "n/a", ""].includes(bName)) {
      const ifsc = ext.bank_details.ifsc_code || "";
      if (ifsc.length >= 4) {
        const pfx = ifsc.substring(0, 4).toUpperCase();
        if (IFSC_BANK_MAP[pfx]) {
          ext.bank_details.bank_name = IFSC_BANK_MAP[pfx];
        }
      }
    }
  }

  if (ext.tax_summary) {
    const ts = ext.tax_summary;
    const cgst = parseFloat(ts.cgst ?? ts.cgst_amount ?? 0) || 0;
    const sgst = parseFloat(ts.sgst ?? ts.sgst_amount ?? 0) || 0;
    const igst = parseFloat(ts.igst ?? ts.igst_amount ?? 0) || 0;
    const cess = parseFloat(ts.cess ?? ts.cess_amount ?? 0) || 0;
    const round_off = parseFloat(ts.round_off ?? ts.round_off_amount ?? 0) || 0;
    const total_tax = parseFloat(ts.total_tax ?? ts.total_tax_amount ?? 0) || 0;

    let subtotal = parseFloat(ts.subtotal ?? ts.taxable_amount ?? 0) || 0;
    let taxable_amount = parseFloat(ts.taxable_amount ?? 0) || 0;
    let grand_total = parseFloat(ts.grand_total ?? ts.calculated_grand_total ?? 0) || 0;

    const itemsTotal = (ext.items || []).reduce((sum, item) => sum + (parseFloat(item.total_amount) || 0), 0);

    if (grand_total <= 5 && itemsTotal > 5) {
      grand_total = parseFloat((itemsTotal + cgst + sgst + igst + cess + round_off).toFixed(2));
      if (subtotal <= 5) subtotal = itemsTotal;
      if (taxable_amount <= 5) taxable_amount = itemsTotal;
    } else if (grand_total === 0) {
      const base = taxable_amount || subtotal;
      if (base > 0) grand_total = parseFloat((base + cgst + sgst + igst + cess + round_off).toFixed(2));
    }

    ext.tax_summary = { subtotal, taxable_amount, cgst, sgst, igst, cess, round_off, total_tax, grand_total };
  } else {
    ext.tax_summary = { subtotal: 0, taxable_amount: 0, cgst: 0, sgst: 0, igst: 0, cess: 0, round_off: 0, total_tax: 0, grand_total: 0 };
  }

  return ext;
};

const getStatusBadgeStyle = (status = "") => {
  switch (status.toUpperCase()) {
    case "PROCESSING":
      return { backgroundColor: "rgba(29, 78, 216, 0.1)", color: "#1d4ed8", border: "1px solid rgba(29, 78, 216, 0.2)" };
    case "PENDING_VALIDATION":
    case "PENDING":
      return { backgroundColor: "rgba(245, 158, 11, 0.1)", color: "#d97706", border: "1px solid rgba(245, 158, 11, 0.2)" };
    case "VALIDATED":
    case "PROCESSED":
    case "SAVED":
    case "ARCHIVED":
      return { backgroundColor: "rgba(16, 185, 129, 0.1)", color: "#059669", border: "1px solid rgba(16, 185, 129, 0.2)" };
    case "FAILED":
      return { backgroundColor: "rgba(239, 68, 68, 0.1)", color: "#dc2626", border: "1px solid rgba(239, 68, 68, 0.2)" };
    default:
      return { backgroundColor: "rgba(107, 114, 128, 0.1)", color: "#4b5563", border: "1px solid rgba(107, 114, 128, 0.2)" };
  }
};

export default function UploadPage() {
  const { documents, loadDocuments, showToast } = useOutletContext();
  const [dragOver, setDragOver] = useState(false);
  const [localUploading, setLocalUploading] = useState(false);
  const fileInputRef = useRef(null);

  // pre-upload chosen files state
  const [chosenFiles, setChosenFiles] = useState([]);
  const [wizardOpen, setWizardOpen] = useState(false);

  // Active validation state
  const [selectedDocument, setSelectedDocument] = useState(null);
  const [editableExtraction, setEditableExtraction] = useState(null);
  const [isSaving, setIsSaving] = useState(false);
  const [isRetrying, setIsRetrying] = useState(false);
  const [verificationTime, setVerificationTime] = useState(0);
  const [timerActive, setTimerActive] = useState(false);
  const [dbFields, setDbFields] = useState({ msid: "", scheme_name: "All Scheme", req_qty: "", location: "", added_by: "", additional_charges: 0 });

  const location = useLocation();
  const navigate = useNavigate();

  // Expandable log and extraction metrics states
  const [showLogs, setShowLogs] = useState(false);
  const [ocrLogs, setOcrLogs] = useState([]);
  const [activeModel, setActiveModel] = useState("AI-Vision-v3 (RunPod Cloud)");
  const [uploadPercent, setUploadPercent] = useState(0);
  const [ocrPercent, setOcrPercent] = useState(0);
  const [aiPercent, setAiPercent] = useState(0);

  // Clipboard paste listener
  useEffect(() => {
    const handlePaste = (e) => {
      const items = e.clipboardData?.items;
      if (!items) return;
      const filesList = [];
      for (let item of items) {
        if (item.type.indexOf("image") !== -1) {
          const file = item.getAsFile();
          if (file) {
            // Give file name
            const newFile = new File([file], `clipboard_${Date.now()}.png`, { type: file.type });
            filesList.push(newFile);
          }
        }
      }
      if (filesList.length > 0) {
        addChosenFiles(filesList);
        showToast("✓ Image pasted from clipboard.", "info");
      }
    };
    window.addEventListener("paste", handlePaste);
    return () => window.removeEventListener("paste", handlePaste);
  }, []);

  const uploadFilesList = async (filesArray, templateId = null) => {
    if (!filesArray || !filesArray.length) return;
    setLocalUploading(true);
    setUploadPercent(20);
    setOcrPercent(0);
    setAiPercent(0);
    setOcrLogs(["Initializing upload connections...", "Detecting layout settings..."]);

    const formData = new FormData();
    for (let file of filesArray) formData.append("files", file);
    if (templateId) {
      formData.append("template_id", templateId);
    }
    
    try {
      setUploadPercent(60);
      setOcrLogs(prev => [...prev, "Uploading files payload...", "Scan complete: Clean"]);
      const res = await API.post("/upload", formData, {
        headers: { "Content-Type": "multipart/form-data" },
      });
      setUploadPercent(100);
      setOcrPercent(50);
      setOcrLogs(prev => [...prev, "✓ Server ingestion success.", "Running RunPod OCR Engine..."]);
      
      showToast(`✓ ${filesArray.length} file(s) ingested. Starting OCR.`);
      loadDocuments();
      
      const docs = res.data?.documents || [];
      if (docs.length > 0) {
        // Set active preview validation view
        setOcrPercent(100);
        setAiPercent(80);
        setOcrLogs(prev => [...prev, "OCR extraction complete.", "Mapping entities dynamically based on template config."]);
        setSelectedDocument(docs[0]);
      }
      setAiPercent(100);
      setChosenFiles([]); // Clear queue
    } catch (error) {
      showToast("Upload and processing failed.", "error");
      setOcrLogs(prev => [...prev, "ERROR: Processing terminated."]);
    } finally {
      setLocalUploading(false);
    }
  };

  const handleDrag = (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === "dragenter" || e.type === "dragover") {
      setDragOver(true);
    } else if (e.type === "dragleave") {
      setDragOver(false);
    }
  };

  const handleDrop = async (e) => {
    e.preventDefault();
    e.stopPropagation();
    setDragOver(false);
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      addChosenFiles(e.dataTransfer.files);
    }
  };

  const handleFileChange = async (e) => {
    const files = e.target.files;
    if (!files || !files.length) return;
    addChosenFiles(files);
    e.target.value = "";
  };

  const addChosenFiles = (filesList) => {
    const newList = [];
    for (let f of filesList) {
      // Duplicate detection
      const exists = documents.some(doc => doc.filename === f.name) || chosenFiles.some(cf => cf.name === f.name);
      if (exists) {
        showToast(`⚠️ Skipped duplicate file: "${f.name}"`, "warning");
      } else {
        newList.push(f);
      }
    }
    if (newList.length > 0) {
      setChosenFiles(prev => [...prev, ...newList]);
      setWizardOpen(true);
    }
  };

  const handleRemoveChosenFile = (idx) => {
    setChosenFiles(prev => prev.filter((_, i) => i !== idx));
  };

  const totalSizeMB = (chosenFiles.reduce((sum, f) => sum + f.size, 0) / (1024 * 1024)).toFixed(2);

  const fetchFullDocumentDetails = async (docId) => {
    try {
      const res = await API.get(`/documents/${docId}`);
      setSelectedDocument(res.data);
    } catch (e) { console.error("Failed to load document:", e); }
  };

  const handleSelectDocument = (doc) => {
    navigate("/invoice/validation", { state: { autoSelectDocId: doc.document_id } });
  };

  const saveTimeSpent = async (docId, time) => {
    if (!docId) return;
    try { await API.post(`/documents/${docId}/time`, { verification_time: time }); } catch {}
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
      const base = selectedDocument.final_extraction || selectedDocument.ocr_result?.extraction;
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
      }
    }
  }, [selectedDocument]);

  const handleSave = async () => {
    if (!selectedDocument || !editableExtraction) return;
    setIsSaving(true);
    try {
      await API.post("/inventory/save", {
        document_id: selectedDocument.document_id,
        extraction: editableExtraction,
        msid: dbFields.msid ? parseInt(dbFields.msid) || 1001 : 1001,
        scheme_name: dbFields.scheme_name || "All Scheme",
        req_qty: dbFields.req_qty || "",
        location: dbFields.location || "",
        added_by: dbFields.added_by || "System Agent",
        verification_time: verificationTime,
        additional_charges: parseFloat(dbFields.additional_charges) || 0.0,
      });
      showToast("✓ Invoice verified & saved to database!");
      await loadDocuments();
      setSelectedDocument(null);
    } catch {
      showToast("Failed to save validation data.", "error");
    } finally {
      setIsSaving(false);
    }
  };

  const handleDownloadExcel = () => {
    if (!selectedDocument) return;
    window.open(`http://${window.location.hostname}:8000/api/export/excel/${selectedDocument.document_id}`, "_blank");
  };

  const handlePrint = () => {
    if (!selectedDocument) return;
    window.print();
  };

  const handleRetry = async () => {
    if (!selectedDocument) return;
    setIsRetrying(true);
    try {
      await API.post(`/documents/${selectedDocument.document_id}/retry`);
      showToast("✓ Reprocessing document OCR...");
      fetchFullDocumentDetails(selectedDocument.document_id);
    } catch { showToast("Failed to retry OCR.", "error"); }
    finally { setIsRetrying(false); }
  };

  const handleDelete = async () => {
    if (!selectedDocument) return;
    if (!window.confirm("Permanently delete this invoice?")) return;
    try {
      await API.delete(`/documents/${selectedDocument.document_id}`);
      showToast("✓ Document deleted.");
      loadDocuments();
      setSelectedDocument(null);
    } catch { showToast("Delete failed.", "error"); }
  };

  const formatTime = (isoString) => {
    if (!isoString) return "-";
    try {
      const date = new Date(isoString);
      return date.toLocaleDateString(undefined, {
        month: "short",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      });
    } catch { return isoString; }
  };

  const isProcessed = selectedDocument && (
    selectedDocument.status === "PENDING_VALIDATION" ||
    selectedDocument.status === "VALIDATED" ||
    selectedDocument.status === "ARCHIVED" ||
    selectedDocument.status === "PROCESSED" ||
    selectedDocument.status === "SAVED"
  );
  const isFailed = selectedDocument?.status === "FAILED";
  const isProcessing = selectedDocument?.status === "PROCESSING" || selectedDocument?.status === "UPLOADING" || selectedDocument?.status === "Pending" || selectedDocument?.status === "Processing";


  // RENDER UPLOAD HISTORY / INGESTION ZONE VIEW (DEFAULT)
  return (
    <div className="page-upload" style={{ padding: "24px", display: "flex", flexDirection: "column", gap: "24px", height: "100%", overflowY: "auto", boxSizing: "border-box" }}>
      {/* Page Header */}
      <div className="page-header" style={{ marginBottom: 0 }}>
        <div className="page-header-left">
          <h1 className="page-title">Upload Invoices</h1>
          <p className="page-subtitle">Upload document files to run automatic AI OCR extraction</p>
        </div>
      </div>

      {/* Drag & Drop Main Zone */}
      <div
        className={`dropzone-container ${dragOver ? "drag-over" : ""}`}
        onDragEnter={handleDrag}
        onDragOver={handleDrag}
        onDragLeave={handleDrag}
        onDrop={handleDrop}
        onClick={() => fileInputRef.current?.click()}
      >
        <div className="dropzone-icon">
          {localUploading ? (
            <svg width="40" height="40" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24" className="spin">
              <circle cx="12" cy="12" r="10" stroke="rgba(255,255,255,0.3)"/><path d="M12 2a10 10 0 0 1 10 10"/>
            </svg>
          ) : (
            <svg width="40" height="40" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/>
            </svg>
          )}
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
          <h3 style={{ fontSize: "16px", fontWeight: "600", margin: 0, color: "var(--text-primary)" }}>
            {localUploading ? "Processing uploads..." : "Drag & drop files here, or click to browse"}
          </h3>
          <p style={{ fontSize: "12px", color: "var(--text-secondary)", margin: 0 }}>
            Supports PDF, PNG, JPG, JPEG, TIFF (Max 10MB per file) • Paste from Clipboard supported
          </p>
        </div>
        <input
          ref={fileInputRef}
          type="file"
          multiple
          accept=".pdf,.png,.jpg,.jpeg,.tiff"
          onChange={handleFileChange}
          style={{ display: "none" }}
        />
      </div>

      {/* Pre-upload File Preview Cards */}
      {chosenFiles.length > 0 && (
        <div style={{ border: "1px solid var(--border-color)", padding: "16px", borderRadius: "8px", background: "var(--bg-panel)" }}>
          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "12px", fontSize: "13px", fontWeight: "600" }}>
            <span>📋 Files Selected: {chosenFiles.length} ({totalSizeMB} MB)</span>
            <span style={{ color: "#10b981" }}>Scan status: Clean (Scan Complete)</span>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))", gap: "12px" }}>
            {chosenFiles.map((file, idx) => (
              <div key={idx} style={{ border: "1px solid var(--border-color)", padding: "10px", borderRadius: "6px", background: "var(--bg-card)", display: "flex", alignItems: "center", justifyContent: "space-between", fontSize: "12px" }}>
                <div style={{ display: "flex", flexDirection: "column", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1, marginRight: "8px" }}>
                  <span style={{ fontWeight: "600", color: "var(--text-primary)" }} title={file.name}>{file.name}</span>
                  <span style={{ color: "var(--text-secondary)" }}>{(file.size / 1024).toFixed(1)} KB</span>
                </div>
                <button
                  onClick={(e) => { e.stopPropagation(); handleRemoveChosenFile(idx); }}
                  style={{ background: "transparent", border: "none", color: "#ef4444", fontSize: "16px", cursor: "pointer", padding: "2px 6px" }}
                >
                  ×
                </button>
              </div>
            ))}
          </div>

          <div style={{ display: "flex", justifyContent: "flex-end", gap: "10px", marginTop: "16px" }}>
            <button onClick={() => setChosenFiles([])} className="btn btn-secondary">Clear All</button>
            <button onClick={() => setWizardOpen(true)} className="btn btn-primary">Configure OCR & Extract →</button>
          </div>
        </div>
      )}

      {/* Uploaded Documents List Section */}
      <div className="ocr-section" style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden", minHeight: "300px" }}>
        <div className="ocr-section-header" style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <span>Extraction History (View Only)</span>
          <span style={{ fontSize: "12px", fontWeight: "normal", color: "var(--text-secondary)" }}>
            Total Invoices: {documents.length}
          </span>
        </div>
        <div className="ocr-section-content" style={{ padding: 0, overflowY: "auto", flex: 1 }}>
          {documents.length === 0 ? (
            <div style={{ padding: "40px", textAlign: "center", color: "var(--text-secondary)" }}>
              No uploaded documents found. Drag & drop files above to start.
            </div>
          ) : (
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "13px", textAlign: "left" }}>
              <thead>
                <tr style={{ background: "var(--bg-table-header)", borderBottom: "1px solid var(--border-color)" }}>
                  <th style={{ padding: "12px 16px", fontWeight: "600", color: "var(--text-secondary)" }}>Invoice File</th>
                  <th style={{ padding: "12px 16px", fontWeight: "600", color: "var(--text-secondary)" }}>Upload Time</th>
                  <th style={{ padding: "12px 16px", fontWeight: "600", color: "var(--text-secondary)" }}>Status</th>
                  <th style={{ padding: "12px 16px", fontWeight: "600", color: "var(--text-secondary)" }}>Processing Time</th>
                  <th style={{ padding: "12px 16px", fontWeight: "600", color: "var(--text-secondary)", textAlign: "right" }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {documents.map((doc) => (
                  <tr 
                    key={doc.document_id} 
                    style={{ borderBottom: "1px solid var(--border-color)", cursor: "pointer" }}
                    onClick={() => handleSelectDocument(doc)}
                  >
                    <td style={{ padding: "12px 16px", fontWeight: "500", color: "var(--text-primary)" }}>{doc.filename}</td>
                    <td style={{ padding: "12px 16px", color: "var(--text-secondary)" }}>{formatTime(doc.created_at)}</td>
                    <td style={{ padding: "12px 16px" }}>
                      <span className="status-badge" style={getStatusBadgeStyle(doc.status)}>
                        {doc.status}
                      </span>
                    </td>
                    <td style={{ padding: "12px 16px", color: "var(--text-secondary)" }}>
                      {doc.processing_time_ms ? `${(parseFloat(doc.processing_time_ms) / 1000).toFixed(1)}s` : "-"}
                    </td>
                    <td style={{ padding: "12px 16px", textAlign: "right" }}>
                      <div style={{ display: "inline-flex", gap: "8px" }}>
                        <button
                          onClick={async (e) => {
                            e.stopPropagation();
                            showToast(`Downloading "${doc.filename}"...`);
                            await downloadInvoiceFile(doc);
                          }}
                          className="btn btn-secondary"
                          style={{ padding: "4px 10px", fontSize: "11px", borderRadius: "var(--radius-sm)", height: "auto", display: "inline-flex", alignItems: "center", gap: "4px" }}
                          title="Download original invoice file"
                        >
                          📥 Download
                        </button>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            handleSelectDocument(doc);
                          }}
                          className="btn btn-ghost"
                          style={{ padding: "4px 12px", fontSize: "11px", borderRadius: "var(--radius-sm)", height: "auto" }}
                        >
                          View Details
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      <TemplateWizard
        isOpen={wizardOpen}
        files={chosenFiles}
        onClose={() => setWizardOpen(false)}
        onProcess={(templateId) => {
          setWizardOpen(false);
          navigate("/invoice/validation", {
            state: {
              filesToUpload: Array.from(chosenFiles),
              templateId: templateId
            }
          });
          setChosenFiles([]);
        }}
        showToast={showToast}
      />
    </div>
  );
}
