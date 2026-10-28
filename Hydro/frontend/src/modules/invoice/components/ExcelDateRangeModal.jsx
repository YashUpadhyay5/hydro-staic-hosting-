import React, { useState } from "react";

export default function ExcelDateRangeModal({ isOpen, onClose, showToast }) {
  const getTodayStr = () => new Date().toISOString().split("T")[0];
  const getFirstDayOfMonthStr = () => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`;
  };
  const getStartOfWeekStr = () => {
    const d = new Date();
    const day = d.getDay();
    const diff = d.getDate() - day + (day === 0 ? -6 : 1);
    const monday = new Date(d.setDate(diff));
    return monday.toISOString().split("T")[0];
  };
  const getLast30DaysStr = () => {
    const d = new Date();
    d.setDate(d.getDate() - 30);
    return d.toISOString().split("T")[0];
  };

  const [startDate, setStartDate] = useState(getFirstDayOfMonthStr());
  const [endDate, setEndDate] = useState(getTodayStr());
  const [isExporting, setIsExporting] = useState(false);

  if (!isOpen) return null;

  const handlePreset = (preset) => {
    const today = getTodayStr();
    if (preset === "TODAY") {
      setStartDate(today);
      setEndDate(today);
    } else if (preset === "THIS_WEEK") {
      setStartDate(getStartOfWeekStr());
      setEndDate(today);
    } else if (preset === "THIS_MONTH") {
      setStartDate(getFirstDayOfMonthStr());
      setEndDate(today);
    } else if (preset === "LAST_30_DAYS") {
      setStartDate(getLast30DaysStr());
      setEndDate(today);
    } else if (preset === "ALL") {
      setStartDate("");
      setEndDate("");
    }
  };

  const handleDownload = () => {
    if (startDate && endDate && startDate > endDate) {
      if (showToast) showToast("Start Date cannot be after End Date.", "error");
      else alert("Start Date cannot be after End Date.");
      return;
    }

    setIsExporting(true);
    const token = localStorage.getItem("token") || "";
    
    let url = `http://${window.location.hostname}:8000/api/export/excel?`;
    const params = [];
    if (startDate) params.push(`start_date=${encodeURIComponent(startDate)}`);
    if (endDate) params.push(`end_date=${encodeURIComponent(endDate)}`);
    if (token) params.push(`token=${encodeURIComponent(token)}`);
    
    url += params.join("&");
    
    window.open(url, "_blank");
    
    if (showToast) {
      const msg = startDate && endDate 
        ? `✓ Downloading Excel for invoices uploaded from ${startDate} to ${endDate}`
        : startDate 
        ? `✓ Downloading Excel for invoices uploaded from ${startDate}`
        : endDate
        ? `✓ Downloading Excel for invoices uploaded up to ${endDate}`
        : "✓ Downloading full Excel report...";
      showToast(msg);
    }

    setTimeout(() => {
      setIsExporting(false);
      onClose();
    }, 500);
  };

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        backgroundColor: "rgba(0, 0, 0, 0.75)",
        backdropFilter: "blur(6px)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 9999,
        padding: "16px",
        animation: "fadeIn 0.2s ease-out"
      }}
      onClick={onClose}
    >
      <div
        style={{
          background: "var(--bg-panel, #1e293b)",
          border: "1px solid var(--border-color, #334155)",
          borderRadius: "16px",
          width: "100%",
          maxWidth: "480px",
          boxShadow: "0 25px 50px -12px rgba(0, 0, 0, 0.5)",
          overflow: "hidden",
          color: "var(--text-primary, #f8fafc)",
          display: "flex",
          flexDirection: "column"
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div
          style={{
            padding: "20px 24px",
            borderBottom: "1px solid var(--border-color, #334155)",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            background: "linear-gradient(to right, rgba(37, 99, 235, 0.08), rgba(16, 185, 129, 0.08))"
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
            <div
              style={{
                width: "42px",
                height: "42px",
                borderRadius: "12px",
                background: "linear-gradient(135deg, #10b981 0%, #059669 100%)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                color: "#fff",
                fontSize: "18px",
                boxShadow: "0 4px 12px rgba(16, 185, 129, 0.35)"
              }}
            >
              📊
            </div>
            <div>
              <h3 style={{ margin: 0, fontSize: "17px", fontWeight: "700" }}>
                Export Invoices to Excel
              </h3>
              <p style={{ margin: 0, fontSize: "12px", color: "var(--text-secondary, #94a3b8)" }}>
                Filter report by Invoice Upload Date (<code>created_at</code>)
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            style={{
              background: "none",
              border: "none",
              color: "var(--text-secondary, #94a3b8)",
              cursor: "pointer",
              fontSize: "20px",
              padding: "4px",
              display: "flex",
              alignItems: "center",
              justifyContent: "center"
            }}
          >
            ✕
          </button>
        </div>

        {/* Body */}
        <div style={{ padding: "24px", display: "flex", flexDirection: "column", gap: "18px" }}>
          {/* Presets */}
          <div>
            <label style={{ fontSize: "12px", fontWeight: "700", color: "var(--text-secondary, #94a3b8)", textTransform: "uppercase", letterSpacing: "0.5px", display: "block", marginBottom: "8px" }}>
              Quick Presets
            </label>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: "8px" }}>
              {[
                { label: "Today", id: "TODAY" },
                { label: "This Week", id: "THIS_WEEK" },
                { label: "This Month", id: "THIS_MONTH" },
                { label: "All Time", id: "ALL" }
              ].map((p) => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => handlePreset(p.id)}
                  style={{
                    padding: "8px 4px",
                    borderRadius: "8px",
                    border: "1px solid var(--border-color, #334155)",
                    background: "rgba(255, 255, 255, 0.03)",
                    color: "var(--text-primary, #f8fafc)",
                    fontSize: "12px",
                    fontWeight: "600",
                    cursor: "pointer",
                    transition: "all 0.15s ease"
                  }}
                  onMouseOver={(e) => {
                    e.currentTarget.style.background = "#2563eb";
                    e.currentTarget.style.borderColor = "#2563eb";
                    e.currentTarget.style.color = "#fff";
                  }}
                  onMouseOut={(e) => {
                    e.currentTarget.style.background = "rgba(255, 255, 255, 0.03)";
                    e.currentTarget.style.borderColor = "var(--border-color, #334155)";
                    e.currentTarget.style.color = "var(--text-primary, #f8fafc)";
                  }}
                >
                  {p.label}
                </button>
              ))}
            </div>
          </div>

          {/* Date Inputs */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "14px" }}>
            <div>
              <label style={{ fontSize: "12px", fontWeight: "600", color: "var(--text-primary, #f8fafc)", display: "block", marginBottom: "6px" }}>
                From Upload Date:
              </label>
              <input
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                style={{
                  width: "100%",
                  padding: "10px 12px",
                  borderRadius: "8px",
                  border: "1px solid var(--border-color, #334155)",
                  background: "var(--bg-app, #0f172a)",
                  color: "var(--text-primary, #f8fafc)",
                  fontSize: "13px",
                  outline: "none",
                  boxSizing: "border-box"
                }}
              />
            </div>

            <div>
              <label style={{ fontSize: "12px", fontWeight: "600", color: "var(--text-primary, #f8fafc)", display: "block", marginBottom: "6px" }}>
                To Upload Date:
              </label>
              <input
                type="date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                style={{
                  width: "100%",
                  padding: "10px 12px",
                  borderRadius: "8px",
                  border: "1px solid var(--border-color, #334155)",
                  background: "var(--bg-app, #0f172a)",
                  color: "var(--text-primary, #f8fafc)",
                  fontSize: "13px",
                  outline: "none",
                  boxSizing: "border-box"
                }}
              />
            </div>
          </div>

          {/* Helper info */}
          <div
            style={{
              padding: "12px 14px",
              borderRadius: "10px",
              background: "rgba(16, 185, 129, 0.08)",
              border: "1px solid rgba(16, 185, 129, 0.2)",
              fontSize: "12px",
              color: "#10b981",
              display: "flex",
              alignItems: "center",
              gap: "8px"
            }}
          >
            <span>💡</span>
            <span>
              {startDate && endDate
                ? `Only invoices uploaded between ${startDate} and ${endDate} will be exported.`
                : startDate
                ? `Invoices uploaded on or after ${startDate} will be exported.`
                : endDate
                ? `Invoices uploaded up to ${endDate} will be exported.`
                : "All historical invoices will be included in the export."}
            </span>
          </div>
        </div>

        {/* Footer */}
        <div
          style={{
            padding: "16px 24px",
            borderTop: "1px solid var(--border-color, #334155)",
            display: "flex",
            justifyContent: "flex-end",
            gap: "10px",
            background: "rgba(0, 0, 0, 0.15)"
          }}
        >
          <button
            type="button"
            onClick={onClose}
            style={{
              padding: "9px 18px",
              borderRadius: "8px",
              border: "1px solid var(--border-color, #334155)",
              background: "transparent",
              color: "var(--text-secondary, #94a3b8)",
              fontSize: "13px",
              fontWeight: "600",
              cursor: "pointer"
            }}
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleDownload}
            disabled={isExporting}
            style={{
              padding: "9px 20px",
              borderRadius: "8px",
              border: "none",
              background: "#10b981",
              color: "#fff",
              fontSize: "13px",
              fontWeight: "700",
              cursor: isExporting ? "not-allowed" : "pointer",
              display: "flex",
              alignItems: "center",
              gap: "8px",
              boxShadow: "0 4px 12px rgba(16, 185, 129, 0.35)"
            }}
          >
            {isExporting ? "Generating..." : "Download Filtered Excel"}
          </button>
        </div>
      </div>
    </div>
  );
}
