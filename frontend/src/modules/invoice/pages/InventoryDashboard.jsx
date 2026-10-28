import { useState, useEffect, useRef } from "react";
import API from "../services/api";
import KPICards from "../components/KPICards";
import DocumentPreview from "../components/DocumentPreview";
import ExtractionEditor from "../components/ExtractionEditor";
import ActionButtons from "../components/ActionButtons";
import ExcelDateRangeModal from "../components/ExcelDateRangeModal";

const formatToInputDate = (dateStr) => {
  if (!dateStr) return "";
  if (/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return dateStr;
  
  const match = dateStr.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/);
  if (match) {
    const [_, day, month, year] = match;
    return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
  }
  return "";
};

const normalizeExtraction = (rawExtraction) => {
  if (!rawExtraction) return null;
  const ext = JSON.parse(JSON.stringify(rawExtraction));

  // 1. Date normalization (DD/MM/YYYY -> YYYY-MM-DD)
  if (ext.invoice_details && ext.invoice_details.invoice_date) {
    ext.invoice_details.invoice_date = formatToInputDate(ext.invoice_details.invoice_date);
  }

  // Helper for state auto-fill
  const findStateInAddress = (address) => {
    if (!address) return "";
    const states = ["Andhra Pradesh", "Arunachal Pradesh", "Assam", "Bihar", "Chhattisgarh", "Goa", "Gujarat", "Haryana", "Himachal Pradesh", "Jharkhand", "Karnataka", "Kerala", "Madhya Pradesh", "Maharashtra", "Manipur", "Meghalaya", "Mizoram", "Nagaland", "Odisha", "Punjab", "Rajasthan", "Sikkim", "Tamil Nadu", "Telangana", "Tripura", "Uttar Pradesh", "Uttarakhand", "West Bengal", "Delhi"];
    for (let s of states) {
      if (address.toLowerCase().includes(s.toLowerCase())) {
        return s;
      }
    }
    return "";
  };

  // 2. Auto-fill States from addresses
  if (ext.vendor_details) {
    if (!ext.vendor_details.state && ext.vendor_details.address) {
      ext.vendor_details.state = findStateInAddress(ext.vendor_details.address);
    }
    if (!ext.vendor_details.pan && ext.vendor_details.gstin) {
      const gstin = ext.vendor_details.gstin.trim();
      if (gstin.length >= 12) {
        ext.vendor_details.pan = gstin.substring(2, 12);
      }
    }
  }
  
  if (ext.consumer_details && !ext.consumer_details.state && ext.consumer_details.address) {
    ext.consumer_details.state = findStateInAddress(ext.consumer_details.address);
  }
  
  if (ext.consignee_details && !ext.consignee_details.state && ext.consignee_details.address) {
    ext.consignee_details.state = findStateInAddress(ext.consignee_details.address);
  }

  // 3. Transport details fallback (copy from invoice_details.transport_details if root empty)
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

  // 4. Normalize Tax Summary keys
  if (ext.tax_summary) {
    const ts = ext.tax_summary;
    const cgst = parseFloat(ts.cgst !== undefined ? ts.cgst : (ts.cgst_amount !== undefined ? ts.cgst_amount : 0)) || 0;
    const sgst = parseFloat(ts.sgst !== undefined ? ts.sgst : (ts.sgst_amount !== undefined ? ts.sgst_amount : 0)) || 0;
    const igst = parseFloat(ts.igst !== undefined ? ts.igst : (ts.igst_amount !== undefined ? ts.igst_amount : 0)) || 0;
    const cess = parseFloat(ts.cess !== undefined ? ts.cess : (ts.cess_amount !== undefined ? ts.cess_amount : 0)) || 0;
    const round_off = parseFloat(ts.round_off !== undefined ? ts.round_off : (ts.round_off_amount !== undefined ? ts.round_off_amount : 0)) || 0;
    const total_tax = parseFloat(ts.total_tax !== undefined ? ts.total_tax : (ts.total_tax_amount !== undefined ? ts.total_tax_amount : 0)) || 0;

    let subtotal = parseFloat(ts.subtotal !== undefined ? ts.subtotal : (ts.taxable_amount || 0)) || 0;
    let taxable_amount = parseFloat(ts.taxable_amount !== undefined ? ts.taxable_amount : 0) || 0;
    let grand_total = parseFloat(ts.grand_total !== undefined ? ts.grand_total : (ts.calculated_grand_total !== undefined ? ts.calculated_grand_total : 0)) || 0;

    // Calculate sum of line item total amounts
    const itemsTotal = (ext.items || []).reduce((sum, item) => sum + (parseFloat(item.total_amount) || 0), 0);

    // Smart auto-correction: if grand_total is abnormally small (<= 5) but the sum of line items is significant (> 5),
    // calculate the true totals using the sum of line items.
    if (grand_total <= 5 && itemsTotal > 5) {
      grand_total = parseFloat((itemsTotal + cgst + sgst + igst + cess + round_off).toFixed(2));
      if (subtotal <= 5) subtotal = itemsTotal;
      if (taxable_amount <= 5) taxable_amount = itemsTotal;
    } else if (grand_total === 0) {
      const base = taxable_amount || subtotal;
      if (base > 0) {
        grand_total = parseFloat((base + cgst + sgst + igst + cess + round_off).toFixed(2));
      }
    }

    ext.tax_summary = { subtotal, taxable_amount, cgst, sgst, igst, cess, round_off, total_tax, grand_total };
  } else {
    ext.tax_summary = {
      subtotal: 0,
      taxable_amount: 0,
      cgst: 0,
      sgst: 0,
      igst: 0,
      cess: 0,
      round_off: 0,
      total_tax: 0,
      grand_total: 0,
    };
  }

  return ext;
};

function InventoryDashboard() {
  const [theme, setTheme] = useState(() => {
    return localStorage.getItem("theme") || "light";
  });

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
    localStorage.setItem("theme", theme);
  }, [theme]);

  const toggleTheme = () => {
    setTheme((t) => (t === "light" ? "dark" : "light"));
  };

  const [documents, setDocuments] = useState([]);
  const [selectedDocument, setSelectedDocument] = useState(null);
  const [editableExtraction, setEditableExtraction] = useState(null);
  const [isSaving, setIsSaving] = useState(false);
  const [isRetrying, setIsRetrying] = useState(false);
  const [notification, setNotification] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [showExcelModal, setShowExcelModal] = useState(false);

  const [verificationTime, setVerificationTime] = useState(0);
  const [timerActive, setTimerActive] = useState(false);

  const verificationTimeRef = useRef(0);
  const selectedDocRef = useRef(null);

  useEffect(() => {
    verificationTimeRef.current = verificationTime;
  }, [verificationTime]);

  useEffect(() => {
    selectedDocRef.current = selectedDocument;
  }, [selectedDocument]);

  const saveTimeSpent = async (docId, time) => {
    if (!docId) return;
    setDocuments((prevDocs) =>
      prevDocs.map((doc) =>
        doc.document_id === docId ? { ...doc, verification_time: time } : doc
      )
    );
    try {
      await API.post(`/documents/${docId}/time`, { verification_time: time });
    } catch (error) {
      console.error("Failed to save verification time:", error);
    }
  };

  useEffect(() => {
    let interval = null;
    if (timerActive) {
      interval = setInterval(() => {
        setVerificationTime((t) => t + 1);
      }, 1000);
    } else {
      clearInterval(interval);
    }
    return () => clearInterval(interval);
  }, [timerActive]);

  useEffect(() => {
    const handleVisibilityChange = () => {
      const currentDoc = selectedDocRef.current;
      const isProcessed = currentDoc && (currentDoc.status === "Processed" || currentDoc.status === "Saved");
      if (document.hidden) {
        setTimerActive(false);
        if (currentDoc) {
          saveTimeSpent(currentDoc.document_id, verificationTimeRef.current);
        }
      } else if (isProcessed) {
        setTimerActive(true);
      }
    };
    const handleUnload = () => {
      if (selectedDocRef.current) {
        const url = `/api/documents/${selectedDocRef.current.document_id}/time`;
        const headers = { type: 'application/json' };
        const blob = new Blob([JSON.stringify({ verification_time: verificationTimeRef.current })], headers);
        navigator.sendBeacon(url, blob);
      }
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);
    window.addEventListener("pagehide", handleUnload);

    return () => {
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      window.removeEventListener("pagehide", handleUnload);
    };
  }, []);

  const fetchFullDocumentDetails = async (docId) => {
    try {
      const response = await API.get(`/documents/${docId}`);
      setSelectedDocument(response.data);
    } catch (error) {
      console.error("Failed to load document details:", error);
    }
  };

  const handleSelectDocument = async (doc) => {
    if (selectedDocument && selectedDocument.document_id !== doc.document_id) {
      await saveTimeSpent(selectedDocument.document_id, verificationTime);
    }
    await fetchFullDocumentDetails(doc.document_id);
  };

  // DB integration fields
  const [dbFields, setDbFields] = useState({
    msid: "",
    scheme_name: "All Scheme",
    req_qty: "",
    location: "",
    added_by: "",
    additional_charges: 0,
  });

  // Fetch documents from API
  const loadDocuments = async () => {
    try {
      const response = await API.get("/documents");
      setDocuments(response.data || []);
    } catch (error) {
      console.error("Failed to load documents:", error);
    }
  };

  // Poll documents every 60 seconds when idle
  useEffect(() => {
    loadDocuments();
    const interval = setInterval(loadDocuments, 60000);
    return () => clearInterval(interval);
  }, []);

  // Sync selected document when background state changes (e.g. Pending -> Processed)
  useEffect(() => {
    if (selectedDocument) {
      const updatedDoc = documents.find(
        (d) => d.document_id === selectedDocument.document_id
      );
      if (updatedDoc) {
        // If status changed in the horizontal queue, fetch full details to get results
        if (updatedDoc.status !== selectedDocument.status) {
          fetchFullDocumentDetails(selectedDocument.document_id);
        }
      }
    }
  }, [documents, selectedDocument]);

  // Load extraction data when selected document changes
  useEffect(() => {
    if (selectedDocument) {
      setVerificationTime(selectedDocument.verification_time || 0);
    } else {
      setVerificationTime(0);
    }

    const baseExtraction = selectedDocument?.final_extraction || selectedDocument?.ocr_result?.extraction;
    if (selectedDocument && baseExtraction) {
      setEditableExtraction(
        normalizeExtraction(baseExtraction)
      );
      // Only auto-start timer for Processed or Saved documents
      const docStatus = selectedDocument.status;
      if (docStatus === "Processed" || docStatus === "Saved") {
        setTimerActive(true);
      } else {
        setTimerActive(false);
      }
      
      // Load DB fields from baseExtraction (which is final_extraction or ocr_result.extraction)
      // or fall back to selectedDocument fields or defaults
      setDbFields({
        msid: baseExtraction.msid || selectedDocument.msid || "",
        scheme_name: baseExtraction.scheme_name || selectedDocument.scheme_name || "All Scheme",
        req_qty: baseExtraction.req_qty || selectedDocument.req_qty || "",
        location: baseExtraction.location || selectedDocument.location || "",
        added_by: baseExtraction.added_by || selectedDocument.added_by || "",
        additional_charges: baseExtraction.additional_charges || 0,
      });
    } else {
      setEditableExtraction(null);
      setTimerActive(false);
    }
  }, [selectedDocument]);

  // Handle uploading files
  const handleUpload = async (event) => {
    const files = event.target.files;
    if (!files.length) return;

    setUploading(true);
    const formData = new FormData();
    for (let file of files) {
      formData.append("files", file);
    }

    try {
      const response = await API.post("/upload", formData, {
        headers: {
          "Content-Type": "multipart/form-data",
        },
      });

      showToast(`Uploaded ${files.length} file(s) successfully!`);
      loadDocuments();

      // Automatically select the first uploaded document to show progress
      if (response.data && response.data.documents && response.data.documents.length > 0) {
        setSelectedDocument(response.data.documents[0]);
      }
    } catch (error) {
      console.error(error);
      alert("Invoice upload failed. Please try again.");
    } finally {
      setUploading(false);
      event.target.value = ""; // clear input
    }
  };

  // Toast notification system
  const showToast = (message) => {
    setNotification(message);
    setTimeout(() => {
      setNotification(null);
    }, 4000);
  };

  // Save changes to Database
  const handleSave = async () => {
    if (!selectedDocument || !editableExtraction) return;

    setIsSaving(true);
    
    // Construct payload matching backend expectation
    const payload = {
      document_id: selectedDocument.document_id,
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
      
      showToast("Invoice data verified & successfully saved to the database!");
      
      // Load updated documents and auto-navigate
      const response = await API.get("/documents");
      const updatedDocs = response.data || [];
      setDocuments(updatedDocs);

      const savedDocId = selectedDocument.document_id;
      const currentIndex = documents.findIndex((d) => d.document_id === savedDocId);
      let nextDoc = null;

      if (currentIndex !== -1 && documents.length > 0) {
        for (let i = currentIndex + 1; i < documents.length; i++) {
          const cand = updatedDocs.find((d) => d.document_id === documents[i].document_id);
          if (cand && cand.status === "PENDING_VALIDATION" && cand.document_id !== savedDocId) {
            nextDoc = cand;
            break;
          }
        }
        if (!nextDoc) {
          for (let i = 0; i < currentIndex; i++) {
            const cand = updatedDocs.find((d) => d.document_id === documents[i].document_id);
            if (cand && cand.status === "PENDING_VALIDATION" && cand.document_id !== savedDocId) {
              nextDoc = cand;
              break;
            }
          }
        }
      }

      if (!nextDoc) {
        nextDoc = updatedDocs.find((d) => d.status === "PENDING_VALIDATION" && d.document_id !== savedDocId);
      }

      if (nextDoc) {
        fetchFullDocumentDetails(nextDoc.document_id);
      } else {
        setSelectedDocument(null);
      }
    } catch (error) {
      console.error(error);
      const errMsg = error.response?.data?.detail || "Save failed. Please check details.";
      alert(`Error saving to database: ${errMsg}`);
    } finally {
      setIsSaving(false);
    }
  };

  // Delete Invoice function
  const handleDelete = async (docId) => {
    if (!docId) return;

    if (!window.confirm("Are you sure you want to delete this invoice? This action cannot be undone.")) {
      return;
    }

    try {
      await API.delete(`/documents/${docId}`);
      showToast("Invoice Deleted Successfully");

      const response = await API.get("/documents");
      const updatedDocs = response.data || [];
      setDocuments(updatedDocs);

      if (selectedDocument?.document_id === docId) {
        const nextPending = updatedDocs.find((d) => d.status === "PENDING_VALIDATION");
        if (nextPending) {
          fetchFullDocumentDetails(nextPending.document_id);
        } else {
          setSelectedDocument(null);
        }
      }
    } catch (error) {
      console.error(error);
      alert("Failed to delete the invoice. Please try again.");
    }
  };

  // Download Excel inventory report
  const handleDownloadExcel = () => {
    setShowExcelModal(true);
  };

  // Print Summary Page
  const handlePrint = () => {
    if (!selectedDocument) return;
    window.print();
  };

  // Retry OCR for a Failed document
  const handleRetry = async () => {
    if (!selectedDocument || selectedDocument.status !== "FAILED") return;
    setIsRetrying(true);
    try {
      await API.post(`/documents/${selectedDocument.document_id}/retry`);
      showToast("Invoice re-queued for OCR processing. Please wait…");
      // Reset local state so the UI shows PROCESSING
      setSelectedDocument((prev) => ({ ...prev, status: "PROCESSING", error: null, ocr_result: null }));
      loadDocuments();
    } catch (error) {
      const errMsg = error.response?.data?.detail || "Retry failed. The original file may no longer be available.";
      alert(`Cannot retry: ${errMsg}`);
    } finally {
      setIsRetrying(false);
    }
  };

  const isProcessed = selectedDocument && (selectedDocument.status === "PENDING_VALIDATION" || selectedDocument.status === "VALIDATED" || selectedDocument.status === "ARCHIVED");
  const isFailed = selectedDocument?.status === "FAILED";
  const printData = selectedDocument?.final_extraction || selectedDocument?.ocr_result?.extraction || {};

  return (
    <div className="dashboard">
      
      {/* Top Header Bar */}
      <div className="top-bar">
        <div className="top-bar-left">
          <svg width="24" height="24" fill="none" stroke="var(--primary-color)" strokeWidth="2.5" viewBox="0 0 24 24" style={{ verticalAlign: "middle" }}>
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
            <polyline points="14 2 14 8 20 8"></polyline>
            <line x1="16" y1="13" x2="8" y2="13"></line>
            <line x1="16" y1="17" x2="8" y2="17"></line>
            <polyline points="10 9 9 9 8 9"></polyline>
          </svg>
          <h1>Invoice OCR & Inventory Portal</h1>
        </div>

        <div className="top-bar-right">
          {/* Theme Toggle Button */}
          <button 
            className="btn btn-secondary" 
            onClick={toggleTheme} 
            title={`Switch to ${theme === "light" ? "dark" : "light"} theme`}
            style={{ padding: "8px 12px", display: "inline-flex", alignItems: "center", border: "1px solid var(--border-color)", background: "var(--bg-panel)", color: "var(--text-primary)", cursor: "pointer", borderRadius: "var(--radius-sm)" }}
          >
            {theme === "light" ? (
              <svg width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24">
                <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"></path>
              </svg>
            ) : (
              <svg width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24">
                <circle cx="12" cy="12" r="5"></circle>
                <line x1="12" y1="1" x2="12" y2="3"></line>
                <line x1="12" y1="21" x2="12" y2="23"></line>
                <line x1="4.22" y1="4.22" x2="5.64" y2="5.64"></line>
                <line x1="18.36" y1="18.36" x2="19.78" y2="19.78"></line>
                <line x1="1" y1="12" x2="3" y2="12"></line>
                <line x1="21" y1="12" x2="23" y2="12"></line>
                <line x1="4.22" y1="19.07" x2="5.64" y2="17.64"></line>
                <line x1="18.36" y1="5.64" x2="19.78" y2="4.22"></line>
              </svg>
            )}
          </button>

          {/* Upload Button */}
          <div className="file-upload-btn-wrapper">
            <button className="btn btn-primary" disabled={uploading}>
              {uploading ? (
                <>Uploading...</>
              ) : (
                <>
                  <svg width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
                    <polyline points="17 8 12 3 7 8"></polyline>
                    <line x1="12" y1="3" x2="12" y2="15"></line>
                  </svg>
                  Upload Invoices
                </>
              )}
            </button>
            <input
              type="file"
              multiple
              accept=".pdf,.png,.jpg,.jpeg"
              onChange={handleUpload}
              disabled={uploading}
            />
          </div>
        </div>
      </div>



      {/* KPI Stats Panel */}
      <KPICards 
        selectedDocument={selectedDocument} 
        documents={documents} 
        localExtraction={editableExtraction} 
        dbFields={dbFields}
      />

      {/* Main Layout Area */}
      <div className="main-layout">
        
        {/* Left Side: Invoice Preview (35%) */}
        <DocumentPreview 
          document={selectedDocument} 
          verificationTime={verificationTime}
          timerActive={timerActive}
          documents={documents}
          onSelect={handleSelectDocument}
        />

        {/* Right Side: Scrollable Forms and Action Bar (65%) */}
        <div className="content-area" style={{ width: "65%", display: "flex", flexDirection: "column", height: "100%", overflow: "hidden", position: "relative" }}>
          {!selectedDocument ? (
            <div className="editor-panel" style={{ width: "100%", display: "flex", flexDirection: "column", justifyContent: "center", alignItems: "center" }}>
              <div className="empty-state">
                <div style={{ marginBottom: "20px", color: "var(--text-muted)" }}>
                  <svg width="64" height="64" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24">
                    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
                    <polyline points="14 2 14 8 20 8"></polyline>
                    <line x1="16" y1="13" x2="8" y2="13"></line>
                    <line x1="16" y1="17" x2="8" y2="17"></line>
                    <polyline points="10 9 9 9 8 9"></polyline>
                  </svg>
                </div>
                <h2>Select an Invoice</h2>
                <p>
                  Click an invoice in the queue above to review and verify the extracted OCR data.
                </p>
              </div>
            </div>
          ) : selectedDocument.status === "Pending" || selectedDocument.status === "Processing" ? (
            <div className="editor-panel" style={{ width: "100%", alignItems: "center", justifyContent: "center", padding: "40px" }}>
              <svg width="48" height="48" fill="none" stroke="var(--primary-color)" strokeWidth="3" viewBox="0 0 24 24" style={{ animation: "spin 1.5s linear infinite", marginBottom: "16px" }}>
                <circle cx="12" cy="12" r="10" stroke="var(--border-color)"></circle>
                <path d="M12 2a10 10 0 0 1 10 10" strokeLinecap="round"></path>
              </svg>
              <h3 style={{ margin: "0 0 8px" }}>AI Processing Active</h3>
              <p style={{ color: "var(--text-secondary)", fontSize: "13px", textAlign: "center" }}>
                The invoice is currently in status <strong>{selectedDocument.status}</strong>.<br />
                Extracted details will appear here shortly.
              </p>
            </div>
          ) : selectedDocument.status === "Failed" ? (
            <div className="editor-panel" style={{ width: "100%", alignItems: "center", justifyContent: "center", padding: "40px", color: "#b91c1c" }}>
              <svg width="48" height="48" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24" style={{ marginBottom: "16px" }}>
                <circle cx="12" cy="12" r="10"></circle>
                <line x1="15" y1="9" x2="9" y2="15"></line>
                <line x1="9" y1="9" x2="15" y2="15"></line>
              </svg>
              <h3 style={{ margin: "0 0 8px" }}>OCR Processing Failed</h3>
              <p style={{ color: "var(--text-secondary)", fontSize: "13px", textAlign: "center", maxWidth: "320px" }}>
                Error details: <code>{selectedDocument.error || "Unknown error"}</code>
              </p>
            </div>
          ) : (
            <ExtractionEditor
              document={selectedDocument}
              extraction={editableExtraction}
              onExtractionChange={setEditableExtraction}
              dbFields={dbFields}
              onDbFieldsChange={setDbFields}
            />
          )}

          {/* Bottom Sticky Action Bar */}
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
        </div>
      </div>

      {/* Success Notification Toast */}
      {notification && (
        <div className="notification-toast">
          <svg width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24">
            <polyline points="20 6 9 17 4 12"></polyline>
          </svg>
          {notification}
        </div>
      )}

      {/* Print-only Invoice Summary Layout */}
      {isProcessed && selectedDocument && (
        <div className="print-header" style={{ fontFamily: "Inter, sans-serif", color: "#000", padding: "10px", fontSize: "9pt", lineHeight: "1.3" }}>
          
          {/* Header Section */}
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", borderBottom: "2px solid #000", paddingBottom: "8px", marginBottom: "15px" }}>
            <div>
              <h1 style={{ margin: 0, fontSize: "16pt", fontWeight: "800", letterSpacing: "-0.5px" }}>INVENTORY AUDIT SHEET</h1>
              <span style={{ fontSize: "8pt", color: "#555" }}>Database Verified Record</span>
            </div>
            <div style={{ textAlign: "right" }}>
              <div style={{ fontWeight: "700", fontSize: "10pt" }}>
                Status: <span style={{ color: selectedDocument.saved ? "#047857" : "#b91c1c" }}>{selectedDocument.saved ? "VERIFIED & SAVED" : "DRAFT (UNSAVED)"}</span>
              </div>
              <div style={{ fontSize: "8pt", color: "#555" }}>
                Group ID: {selectedDocument.document_id}<br />
                Date Printed: {new Date().toLocaleDateString()}
              </div>
            </div>
          </div>

          {/* Metadata & Audit Stats Grid */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: "8px 12px", background: "#f8fafc", padding: "10px", borderRadius: "4px", border: "1px solid #e2e8f0", marginBottom: "15px" }}>
            <div>
              <strong style={{ color: "#475569", fontSize: "7.5pt" }}>INVOICE NUMBER</strong>
              <div style={{ fontWeight: "600" }}>{printData.invoice_details?.invoice_number || "N/A"}</div>
            </div>
            <div>
              <strong style={{ color: "#475569", fontSize: "7.5pt" }}>INVOICE DATE</strong>
              <div style={{ fontWeight: "600" }}>{printData.invoice_details?.invoice_date || "N/A"}</div>
            </div>
            <div>
              <strong style={{ color: "#475569", fontSize: "7.5pt" }}>VERIFICATION TIME</strong>
              <div style={{ fontWeight: "600" }}>{selectedDocument.verification_time || 0} seconds</div>
            </div>
            <div>
              <strong style={{ color: "#475569", fontSize: "7.5pt" }}>RECORDED BY</strong>
              <div style={{ fontWeight: "600" }}>{printData.added_by || (selectedDocument.saved ? "System Agent" : "Pending Review")}</div>
            </div>
            
            {/* Database Integration Fields (Row 2) */}
            <div>
              <strong style={{ color: "#475569", fontSize: "7.5pt" }}>MSID</strong>
              <div style={{ fontWeight: "600" }}>{printData.msid || "N/A"}</div>
            </div>
            <div>
              <strong style={{ color: "#475569", fontSize: "7.5pt" }}>SCHEME NAME</strong>
              <div style={{ fontWeight: "600" }}>{printData.scheme_name || "N/A"}</div>
            </div>
            <div>
              <strong style={{ color: "#475569", fontSize: "7.5pt" }}>REQ QTY</strong>
              <div style={{ fontWeight: "600" }}>{printData.req_qty || "N/A"}</div>
            </div>
            <div>
              <strong style={{ color: "#475569", fontSize: "7.5pt" }}>LOCATION</strong>
              <div style={{ fontWeight: "600" }}>{printData.location || "N/A"}</div>
            </div>
          </div>

          {/* Details Grid (Vendor, Consumer, Consignee, Transport, Bank) */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "15px", marginBottom: "15px" }}>
            
            {/* Left Column: Vendor & Consumer */}
            <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
              {/* Vendor */}
              <div style={{ border: "1px solid #cbd5e1", borderRadius: "4px", padding: "8px" }}>
                <h3 style={{ margin: "0 0 6px 0", fontSize: "9.5pt", borderBottom: "1px solid #e2e8f0", paddingBottom: "4px", fontWeight: "700" }}>Vendor Details</h3>
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "8.5pt" }}>
                  <tbody>
                    <tr>
                      <td style={{ width: "65px", color: "#64748b", padding: "2px 0" }}>Name:</td>
                      <td style={{ fontWeight: "600" }}>{printData.vendor_details?.name || "N/A"}</td>
                    </tr>
                    <tr>
                      <td style={{ color: "#64748b", padding: "2px 0" }}>GSTIN:</td>
                      <td>{printData.vendor_details?.gstin || "N/A"}</td>
                    </tr>
                    <tr>
                      <td style={{ color: "#64748b", padding: "2px 0" }}>PAN:</td>
                      <td>{printData.vendor_details?.pan || "N/A"}</td>
                    </tr>
                    <tr>
                      <td style={{ color: "#64748b", padding: "2px 0" }}>State:</td>
                      <td>{printData.vendor_details?.state || "N/A"}</td>
                    </tr>
                    <tr>
                      <td style={{ color: "#64748b", padding: "2px 0", verticalAlign: "top" }}>Address:</td>
                      <td style={{ fontSize: "8pt" }}>{printData.vendor_details?.address || "N/A"}</td>
                    </tr>
                  </tbody>
                </table>
              </div>

              {/* Consumer */}
              <div style={{ border: "1px solid #cbd5e1", borderRadius: "4px", padding: "8px" }}>
                <h3 style={{ margin: "0 0 6px 0", fontSize: "9.5pt", borderBottom: "1px solid #e2e8f0", paddingBottom: "4px", fontWeight: "700" }}>Consumer Details</h3>
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "8.5pt" }}>
                  <tbody>
                    <tr>
                      <td style={{ width: "65px", color: "#64748b", padding: "2px 0" }}>Name:</td>
                      <td style={{ fontWeight: "600" }}>{printData.consumer_details?.name || "N/A"}</td>
                    </tr>
                    <tr>
                      <td style={{ color: "#64748b", padding: "2px 0" }}>GSTIN:</td>
                      <td>{printData.consumer_details?.gstin || "N/A"}</td>
                    </tr>
                    <tr>
                      <td style={{ color: "#64748b", padding: "2px 0" }}>State:</td>
                      <td>{printData.consumer_details?.state || "N/A"}</td>
                    </tr>
                    <tr>
                      <td style={{ color: "#64748b", padding: "2px 0", verticalAlign: "top" }}>Address:</td>
                      <td style={{ fontSize: "8pt" }}>{printData.consumer_details?.address || "N/A"}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>

            {/* Right Column: Consignee, Transport, Bank */}
            <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
              {/* Consignee & Transport */}
              <div style={{ border: "1px solid #cbd5e1", borderRadius: "4px", padding: "8px" }}>
                <h3 style={{ margin: "0 0 6px 0", fontSize: "9.5pt", borderBottom: "1px solid #e2e8f0", paddingBottom: "4px", fontWeight: "700" }}>Consignee & Transport</h3>
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "8.5pt" }}>
                  <tbody>
                    <tr>
                      <td style={{ width: "75px", color: "#64748b", padding: "2px 0" }}>Consignee:</td>
                      <td style={{ fontWeight: "600" }}>{printData.consignee_details?.name || "N/A"}</td>
                    </tr>
                    <tr>
                      <td style={{ color: "#64748b", padding: "2px 0" }}>Vehicle No:</td>
                      <td>{printData.transport_details?.vehicle_number || "N/A"}</td>
                    </tr>
                    <tr>
                      <td style={{ color: "#64748b", padding: "2px 0" }}>GR Number:</td>
                      <td>{printData.transport_details?.gr_no || "N/A"}</td>
                    </tr>
                    <tr>
                      <td style={{ color: "#64748b", padding: "2px 0" }}>Mode/Dest:</td>
                      <td>
                        {(printData.transport_details?.mode_of_transport || "N/A")} / {(printData.transport_details?.destination || "N/A")}
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>

              {/* Bank Details */}
              <div style={{ border: "1px solid #cbd5e1", borderRadius: "4px", padding: "8px" }}>
                <h3 style={{ margin: "0 0 6px 0", fontSize: "9.5pt", borderBottom: "1px solid #e2e8f0", paddingBottom: "4px", fontWeight: "700" }}>Bank Details</h3>
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "8.5pt" }}>
                  <tbody>
                    <tr>
                      <td style={{ width: "75px", color: "#64748b", padding: "2px 0" }}>Bank Name:</td>
                      <td style={{ fontWeight: "600" }}>{printData.bank_details?.bank_name || printData.bank_details?.name || "N/A"}</td>
                    </tr>
                    <tr>
                      <td style={{ color: "#64748b", padding: "2px 0" }}>Account No:</td>
                      <td>{printData.bank_details?.account_number || printData.bank_details?.account_no || "N/A"}</td>
                    </tr>
                    <tr>
                      <td style={{ color: "#64748b", padding: "2px 0" }}>IFSC Code:</td>
                      <td>{printData.bank_details?.ifsc_code || printData.bank_details?.ifsc || "N/A"}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>

          </div>

          {/* Line Items Table */}
          <div style={{ marginBottom: "15px" }}>
            <h3 style={{ margin: "0 0 6px 0", fontSize: "9.5pt", borderBottom: "1px solid #000", paddingBottom: "4px", fontWeight: "700" }}>
              Line Items ({printData.items?.length || 0} rows)
            </h3>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "8pt" }}>
              <thead>
                <tr style={{ borderBottom: "1.5px solid #000", textAlign: "left", background: "#f1f5f9" }}>
                  <th style={{ padding: "4px", fontWeight: "700" }}>Description of Goods</th>
                  <th style={{ padding: "4px", fontWeight: "700" }}>Description</th>
                  <th style={{ padding: "4px", fontWeight: "700" }}>HSN Code</th>
                  <th style={{ padding: "4px", fontWeight: "700", textAlign: "right" }}>Qty</th>
                  <th style={{ padding: "4px", fontWeight: "700" }}>Unit</th>
                  <th style={{ padding: "4px", fontWeight: "700", textAlign: "right" }}>Rate</th>
                  <th style={{ padding: "4px", fontWeight: "700", textAlign: "right" }}>CGST Amt</th>
                  <th style={{ padding: "4px", fontWeight: "700", textAlign: "right" }}>SGST Amt</th>
                  <th style={{ padding: "4px", fontWeight: "700", textAlign: "right" }}>IGST Amt</th>
                  <th style={{ padding: "4px", fontWeight: "700", textAlign: "right" }}>Total</th>
                </tr>
              </thead>
              <tbody>
                {(printData.items || []).map((item, idx) => (
                  <tr key={idx} style={{ borderBottom: "1px solid #e2e8f0" }}>
                    <td style={{ padding: "4px", fontWeight: "500" }}>{item.description_of_goods || "N/A"}</td>
                    <td style={{ padding: "4px", color: "#334155" }}>{item.description || "N/A"}</td>
                    <td style={{ padding: "4px" }}>{item.hsn_code || "N/A"}</td>
                    <td style={{ padding: "4px", textAlign: "right" }}>{item.quantity}</td>
                    <td style={{ padding: "4px" }}>{item.unit}</td>
                    <td style={{ padding: "4px", textAlign: "right" }}>₹{parseFloat(item.unit_price || 0).toFixed(2)}</td>
                    <td style={{ padding: "4px", textAlign: "right" }}>₹{parseFloat(item.cgst_amount || 0).toFixed(2)}</td>
                    <td style={{ padding: "4px", textAlign: "right" }}>₹{parseFloat(item.sgst_amount || 0).toFixed(2)}</td>
                    <td style={{ padding: "4px", textAlign: "right" }}>₹{parseFloat(item.igst_amount || 0).toFixed(2)}</td>
                    <td style={{ padding: "4px", textAlign: "right", fontWeight: "700" }}>₹{parseFloat(item.total_amount || 0).toFixed(2)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Bottom Summary Block */}
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: "40px", pageBreakInside: "avoid" }}>
            
            {/* Audit & Notes */}
            <div style={{ flex: 1, border: "1px solid #e2e8f0", borderRadius: "4px", padding: "8px", background: "#f8fafc" }}>
              <strong style={{ fontSize: "7.5pt", color: "#475569" }}>AUDIT REMARKS</strong>
              <div style={{ fontSize: "8pt", marginTop: "4px", color: "#334155" }}>
                {selectedDocument.saved ? (
                  <>✓ This document was verified by an operator and committed to the postgres inventory database successfully.</>
                ) : (
                  <>⚠ Draft copy. Review and click "Save to Database" to finalize.</>
                )}
              </div>
            </div>

            {/* Calculations Totals */}
            <div style={{ width: "240px", border: "1px solid #cbd5e1", borderRadius: "4px", padding: "8px" }}>
              <table style={{ width: "100%", fontSize: "8.5pt", borderCollapse: "collapse" }}>
                <tbody>
                  <tr>
                    <td style={{ padding: "2px 0", color: "#64748b" }}>Taxable Subtotal:</td>
                    <td style={{ textAlign: "right", fontWeight: "600" }}>₹{parseFloat(printData.tax_summary?.taxable_amount || 0).toFixed(2)}</td>
                  </tr>
                  <tr>
                    <td style={{ padding: "2px 0", color: "#64748b" }}>Total Tax:</td>
                    <td style={{ textAlign: "right", fontWeight: "600" }}>₹{parseFloat(printData.tax_summary?.total_tax || 0).toFixed(2)}</td>
                  </tr>
                  <tr>
                    <td style={{ padding: "2px 0", color: "#64748b" }}>Additional Charges:</td>
                    <td style={{ textAlign: "right", fontWeight: "600" }}>₹{parseFloat(printData.additional_charges || 0).toFixed(2)}</td>
                  </tr>
                  <tr>
                    <td style={{ padding: "2px 0", color: "#64748b" }}>Round Off:</td>
                    <td style={{ textAlign: "right" }}>₹{parseFloat(printData.tax_summary?.round_off || 0).toFixed(2)}</td>
                  </tr>
                  <tr style={{ borderTop: "1.5px solid #000", fontSize: "10pt", fontWeight: "800" }}>
                    <td style={{ padding: "6px 0 0 0" }}>GRAND TOTAL:</td>
                    <td style={{ textAlign: "right", padding: "6px 0 0 0" }}>₹{parseFloat(printData.tax_summary?.grand_total || 0).toFixed(2)}</td>
                  </tr>
                </tbody>
              </table>
            </div>

          <div style={{ textAlign: "center", fontSize: "7pt", color: "#94a3b8", marginTop: "25px", borderTop: "1px dashed #cbd5e1", paddingTop: "6px" }}>
            This summary document was generated automatically by the Inventory OCR Portal from authenticated database records.
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

export default InventoryDashboard;
