import { useState, useEffect, useMemo } from "react";
import { useOutletContext, useNavigate } from "react-router-dom";
import API from "../services/api";

/* ── Dynamic field extraction helper ── */
const getDocDetails = (doc) => {
  if (!doc) return { vendorName: "Unknown Vendor", invoiceNo: "N/A", invoiceDate: "N/A", grandTotal: 0 };
  const ext = doc.final_extraction || doc.ocr_result?.extraction || {};

  let vendorName = ext.vendor_details?.name || "";
  let invoiceNo = ext.invoice_details?.invoice_number || "";
  let invoiceDate = ext.invoice_details?.invoice_date || "";

  if (!vendorName || vendorName === "Unknown Vendor" || vendorName === "N/A") {
    if (doc.filename) {
      const parts = doc.filename.split(" - ");
      if (parts.length >= 2) {
        vendorName = parts[0].trim();
        if (!invoiceNo || invoiceNo === "N/A") invoiceNo = parts.slice(1).join(" - ").trim();
      } else {
        vendorName = doc.filename.trim();
      }
    }
  }
  if (!vendorName) vendorName = "Unknown Vendor";
  if (!invoiceNo) invoiceNo = "N/A";

  if (!invoiceDate || invoiceDate === "N/A") {
    if (doc.created_at) {
      try { invoiceDate = doc.created_at.split("T")[0]; } catch { invoiceDate = "N/A"; }
    }
  }

  const grandTotal = parseFloat(doc.grand_total) || parseFloat(ext.tax_summary?.grand_total) || 0;
  return { vendorName, invoiceNo, invoiceDate, grandTotal };
};

/* ── Stat Card Component ── */
function StatCard({ title, value, subtitle, color, icon, trend, onClick, animateValue }) {
  const [displayValue, setDisplayValue] = useState(0);

  useEffect(() => {
    if (!animateValue || typeof value !== "number") {
      setDisplayValue(value);
      return;
    }
    const duration = 800;
    const steps = 30;
    const stepTime = duration / steps;
    const increment = value / steps;
    let current = 0;
    const timer = setInterval(() => {
      current += increment;
      if (current >= value) {
        setDisplayValue(value);
        clearInterval(timer);
      } else {
        setDisplayValue(Math.round(current));
      }
    }, stepTime);
    return () => clearInterval(timer);
  }, [value, animateValue]);

  return (
    <div
      className="analytics-stat-card"
      style={{ "--card-accent": color, cursor: onClick ? "pointer" : "default" }}
      onClick={onClick}
    >
      <div className="analytics-stat-header">
        <div className="analytics-stat-icon" style={{ background: color + "20", color }}>
          {icon}
        </div>
        {trend !== undefined && (
          <span className={`analytics-trend ${trend >= 0 ? "up" : "down"}`}>
            {trend >= 0 ? "↑" : "↓"} {Math.abs(trend)}%
          </span>
        )}
      </div>
      <div className="analytics-stat-value">{animateValue ? displayValue : value}</div>
      <div className="analytics-stat-title">{title}</div>
      {subtitle && <div className="analytics-stat-sub">{subtitle}</div>}
    </div>
  );
}

/* ── Horizontal Bar Component ── */
function SimpleBar({ label, value, max, color, suffix = "" }) {
  const pct = max > 0 ? Math.min((value / max) * 100, 100) : 0;
  return (
    <div className="bar-item">
      <div className="bar-label">
        <span>{label}</span>
        <span className="bar-value">{typeof value === "number" ? value.toLocaleString("en-IN") : value}{suffix}</span>
      </div>
      <div className="bar-track">
        <div className="bar-fill" style={{ width: `${pct}%`, background: color, transition: "width 0.6s ease" }} />
      </div>
    </div>
  );
}

/* ── Mini Sparkline Bar Chart Component ── */
function SparklineChart({ data, color, height = 120 }) {
  const maxVal = Math.max(...data.map(d => d.value), 1);
  return (
    <div style={{ display: "flex", alignItems: "flex-end", gap: "3px", height: `${height}px`, padding: "0 4px" }}>
      {data.map((d, i) => {
        const h = Math.max((d.value / maxVal) * (height - 20), 2);
        return (
          <div key={i} style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: "4px" }}>
            <span style={{ fontSize: "9px", color: "var(--text-secondary)", fontWeight: "600" }}>{d.value > 0 ? d.value : ""}</span>
            <div
              style={{
                width: "100%",
                height: `${h}px`,
                background: color,
                borderRadius: "3px 3px 0 0",
                opacity: 0.85,
                transition: "height 0.5s ease",
                minWidth: "8px",
              }}
              title={`${d.label}: ${d.value}`}
            />
            <span style={{ fontSize: "8px", color: "var(--text-muted)", whiteSpace: "nowrap" }}>{d.label}</span>
          </div>
        );
      })}
    </div>
  );
}

/* ═══════════════════════════════════ MAIN PAGE ═══════════════════════════════════ */
export default function AnalyticsPage() {
  const { documents } = useOutletContext();
  const navigate = useNavigate();
  const [timeRange, setTimeRange] = useState("all");
  const [selectedStatusFilter, setSelectedStatusFilter] = useState(null);

  /* ── Dynamic Time Filter ── */
  const filteredDocuments = useMemo(() => {
    if (timeRange === "all") return documents;
    const now = new Date();
    const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    let cutoff;
    switch (timeRange) {
      case "today":
        cutoff = startOfDay;
        break;
      case "week":
        cutoff = new Date(startOfDay);
        cutoff.setDate(cutoff.getDate() - cutoff.getDay()); // start of week (Sunday)
        break;
      case "month":
        cutoff = new Date(now.getFullYear(), now.getMonth(), 1);
        break;
      default:
        return documents;
    }
    return documents.filter(d => {
      if (!d.created_at) return false;
      return new Date(d.created_at) >= cutoff;
    });
  }, [documents, timeRange]);

  /* ── Core Metrics ── */
  const total = filteredDocuments.length;
  const archived = filteredDocuments.filter(d => d.status === "ARCHIVED");
  const failed = filteredDocuments.filter(d => d.status === "FAILED");
  const pending = filteredDocuments.filter(d => d.status === "PENDING_VALIDATION");
  const processing = filteredDocuments.filter(d => d.status === "PROCESSING" || d.status === "UPLOADING");
  const readyDocs = filteredDocuments.filter(d => d.status === "ARCHIVED" || d.status === "PENDING_VALIDATION");

  const totalRevenue = readyDocs.reduce((sum, d) => {
    const { grandTotal } = getDocDetails(d);
    return sum + grandTotal;
  }, 0);

  const avgVerificationTime = archived.length > 0
    ? Math.round(archived.reduce((s, d) => s + (d.verification_time || 0), 0) / archived.length)
    : 0;

  const successRate = total > 0 ? Math.round((archived.length / total) * 100) : 0;
  const failRate = total > 0 ? Math.round((failed.length / total) * 100) : 0;

  /* ── Trend calculation (compare current vs previous period) ── */
  const trend = useMemo(() => {
    if (timeRange === "all" || documents.length === 0) return {};
    const now = new Date();
    const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    let currentStart, prevStart, prevEnd;
    switch (timeRange) {
      case "today":
        currentStart = startOfDay;
        prevStart = new Date(startOfDay);
        prevStart.setDate(prevStart.getDate() - 1);
        prevEnd = startOfDay;
        break;
      case "week":
        currentStart = new Date(startOfDay);
        currentStart.setDate(currentStart.getDate() - currentStart.getDay());
        prevStart = new Date(currentStart);
        prevStart.setDate(prevStart.getDate() - 7);
        prevEnd = currentStart;
        break;
      case "month":
        currentStart = new Date(now.getFullYear(), now.getMonth(), 1);
        prevStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);
        prevEnd = currentStart;
        break;
      default:
        return {};
    }
    const prevDocs = documents.filter(d => {
      if (!d.created_at) return false;
      const date = new Date(d.created_at);
      return date >= prevStart && date < prevEnd;
    });
    const prevReady = prevDocs.filter(d => d.status === "ARCHIVED" || d.status === "PENDING_VALIDATION");
    const prevTotal = prevDocs.length;
    const prevRevenue = prevReady.reduce((s, d) => s + getDocDetails(d).grandTotal, 0);

    return {
      totalTrend: prevTotal > 0 ? Math.round(((total - prevTotal) / prevTotal) * 100) : 0,
      successTrend: prevReady.length > 0 ? Math.round(((readyDocs.length - prevReady.length) / prevReady.length) * 100) : 0,
      revenueTrend: prevRevenue > 0 ? Math.round(((totalRevenue - prevRevenue) / prevRevenue) * 100) : 0,
    };
  }, [documents, filteredDocuments, timeRange, total, readyDocs.length, totalRevenue]);

  /* ── Vendor Distribution ── */
  const vendorMap = {};
  readyDocs.forEach(d => {
    const { vendorName } = getDocDetails(d);
    vendorMap[vendorName] = (vendorMap[vendorName] || 0) + 1;
  });
  const topVendors = Object.entries(vendorMap).sort((a, b) => b[1] - a[1]).slice(0, 6);

  /* ── Vendor Revenue Distribution ── */
  const vendorRevenueMap = {};
  readyDocs.forEach(d => {
    const { vendorName, grandTotal } = getDocDetails(d);
    vendorRevenueMap[vendorName] = (vendorRevenueMap[vendorName] || 0) + grandTotal;
  });
  const topVendorsByRevenue = Object.entries(vendorRevenueMap).sort((a, b) => b[1] - a[1]).slice(0, 6);

  /* ── State Distribution ── */
  const stateMap = {};
  readyDocs.forEach(d => {
    const ext = d.final_extraction || d.ocr_result?.extraction || {};
    const state = ext.vendor_details?.state || "Unknown";
    stateMap[state] = (stateMap[state] || 0) + 1;
  });
  const topStates = Object.entries(stateMap).sort((a, b) => b[1] - a[1]).slice(0, 6);

  /* ── Amount Distribution ── */
  const amountBuckets = { "< ₹1K": 0, "₹1K–10K": 0, "₹10K–1L": 0, "₹1L–10L": 0, "> ₹10L": 0 };
  readyDocs.forEach(d => {
    const { grandTotal } = getDocDetails(d);
    if (grandTotal < 1000) amountBuckets["< ₹1K"]++;
    else if (grandTotal < 10000) amountBuckets["₹1K–10K"]++;
    else if (grandTotal < 100000) amountBuckets["₹10K–1L"]++;
    else if (grandTotal < 1000000) amountBuckets["₹1L–10L"]++;
    else amountBuckets["> ₹10L"]++;
  });

  /* ── Daily Processing Trend (last 7 days) ── */
  const dailyTrend = useMemo(() => {
    const days = [];
    const now = new Date();
    for (let i = 6; i >= 0; i--) {
      const d = new Date(now);
      d.setDate(d.getDate() - i);
      const dateStr = d.toISOString().split("T")[0];
      const dayLabel = d.toLocaleDateString(undefined, { weekday: "short" });
      const count = documents.filter(doc => {
        if (!doc.created_at) return false;
        return doc.created_at.startsWith(dateStr);
      }).length;
      days.push({ label: dayLabel, value: count });
    }
    return days;
  }, [documents]);

  /* ── Monthly Revenue Trend (last 6 months) ── */
  const monthlyRevenue = useMemo(() => {
    const months = [];
    const now = new Date();
    for (let i = 5; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const monthLabel = d.toLocaleDateString(undefined, { month: "short" });
      const year = d.getFullYear();
      const month = d.getMonth();
      const rev = documents
        .filter(doc => {
          if (!doc.created_at || (doc.status !== "ARCHIVED" && doc.status !== "PENDING_VALIDATION")) return false;
          const docDate = new Date(doc.created_at);
          return docDate.getFullYear() === year && docDate.getMonth() === month;
        })
        .reduce((sum, doc) => sum + getDocDetails(doc).grandTotal, 0);
      months.push({ label: monthLabel, value: Math.round(rev / 1000) }); // in thousands
    }
    return months;
  }, [documents]);

  /* ── Recent Activity ── */
  const recentActivity = [...readyDocs]
    .sort((a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0))
    .slice(0, 10);

  /* ── Chart Helpers ── */
  const maxVendor = topVendors.length > 0 ? topVendors[0][1] : 1;
  const maxVendorRevenue = topVendorsByRevenue.length > 0 ? topVendorsByRevenue[0][1] : 1;
  const maxState = topStates.length > 0 ? topStates[0][1] : 1;
  const maxBucket = Math.max(...Object.values(amountBuckets), 1);

  const barColors = ["#4f46e5", "#7c3aed", "#2563eb", "#0891b2", "#059669", "#d97706"];

  const statusSegments = [
    { label: "Archived", count: archived.length, color: "#10b981", filter: "ARCHIVED" },
    { label: "Pending", count: pending.length, color: "#f59e0b", filter: "PENDING_VALIDATION" },
    { label: "Processing", count: processing.length, color: "#4f46e5", filter: "PROCESSING" },
    { label: "Failed", count: failed.length, color: "#ef4444", filter: "FAILED" },
  ];

  /* ── Time range label ── */
  const timeRangeLabel = { all: "All Time", today: "Today", week: "This Week", month: "This Month" }[timeRange];

  /* ── Export CSV ── */
  const handleExportCSV = () => {
    const header = "Vendor,Invoice No,Date,Grand Total,Status,Verification Time\n";
    const rows = archived.map(doc => {
      const { vendorName, invoiceNo, invoiceDate, grandTotal } = getDocDetails(doc);
      return `"${vendorName}","${invoiceNo}","${invoiceDate}",${grandTotal},"${doc.status}",${doc.verification_time || 0}`;
    }).join("\n");
    const blob = new Blob([header + rows], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `analytics_export_${new Date().toISOString().split("T")[0]}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="page-analytics">
      {/* Page Header */}
      <div className="page-header">
        <div className="page-header-left">
          <h1 className="page-title">Analytics & Reports</h1>
          <p className="page-subtitle">
            Real-time operational insights · <strong>{timeRangeLabel}</strong> · {total} documents
          </p>
        </div>
        <div className="page-header-right" style={{ display: "flex", gap: "8px", alignItems: "center" }}>
          <button className="btn btn-ghost" onClick={handleExportCSV} title="Export CSV">
            <svg width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>
            </svg>
            Export
          </button>
          <select className="btn btn-ghost" value={timeRange} onChange={e => setTimeRange(e.target.value)} style={{ cursor: "pointer" }}>
            <option value="all">All Time</option>
            <option value="today">Today</option>
            <option value="week">This Week</option>
            <option value="month">This Month</option>
          </select>
        </div>
      </div>

      {/* KPI Cards */}
      <div className="analytics-kpi-grid">
        <StatCard
          title="Total Processed"
          value={total}
          subtitle={`${archived.length} verified`}
          color="#4f46e5"
          trend={trend.totalTrend}
          animateValue={true}
          icon={<svg width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>}
        />
        <StatCard
          title="Success Rate"
          value={`${successRate}%`}
          subtitle={`${archived.length} of ${total} invoices`}
          color="#10b981"
          trend={trend.successTrend}
          icon={<svg width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>}
        />
        <StatCard
          title="Total Revenue"
          value={`₹${(totalRevenue / 100000).toFixed(2)}L`}
          subtitle={`₹${totalRevenue.toLocaleString("en-IN", { minimumFractionDigits: 2 })}`}
          color="#f59e0b"
          trend={trend.revenueTrend}
          icon={<svg width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg>}
        />
        <StatCard
          title="Avg. Verification"
          value={`${avgVerificationTime}s`}
          subtitle="Per invoice"
          color="#8b5cf6"
          icon={<svg width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>}
        />
        <StatCard
          title="Pending Queue"
          value={pending.length}
          subtitle={`${processing.length} processing`}
          color="#0891b2"
          animateValue={true}
          onClick={() => navigate("/invoice/validation")}
          icon={<svg width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>}
        />
        <StatCard
          title="Failed / Error"
          value={failed.length}
          subtitle={`${failRate}% failure rate`}
          color="#ef4444"
          animateValue={true}
          icon={<svg width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>}
        />
      </div>

      {/* Charts Grid */}
      <div className="analytics-charts-grid">
        {/* Status Distribution with interactive donut */}
        <div className="analytics-chart-card">
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "4px" }}>
            <h3>Status Distribution</h3>
            {selectedStatusFilter && (
              <button
                className="btn btn-ghost"
                style={{ padding: "2px 8px", fontSize: "11px", height: "auto" }}
                onClick={() => setSelectedStatusFilter(null)}
              >
                Clear Filter
              </button>
            )}
          </div>
          <div className="status-donut">
            <div className="donut-rings">
              {statusSegments.map(item => (
                <div
                  key={item.label}
                  className={`donut-item ${selectedStatusFilter === item.filter ? "active" : ""}`}
                  onClick={() => setSelectedStatusFilter(selectedStatusFilter === item.filter ? null : item.filter)}
                  style={{ cursor: "pointer", padding: "6px 8px", borderRadius: "6px", transition: "background 0.2s", background: selectedStatusFilter === item.filter ? item.color + "15" : "transparent" }}
                >
                  <div className="donut-color" style={{ background: item.color }} />
                  <span className="donut-label">{item.label}</span>
                  <span className="donut-count">{item.count}</span>
                  <span className="donut-pct">{total > 0 ? Math.round((item.count / total) * 100) : 0}%</span>
                </div>
              ))}
            </div>
            <div className="donut-visual">
              <div className="donut-center">
                <span className="donut-big">{total}</span>
                <span className="donut-small">Total</span>
              </div>
              <svg viewBox="0 0 42 42" width="120" height="120">
                {(() => {
                  const circumference = 2 * Math.PI * 15.9;
                  let offset = 0;
                  return statusSegments.map((seg, i) => {
                    const pct = total > 0 ? (seg.count / total) : 0;
                    const dash = pct * circumference;
                    const gap = circumference - dash;
                    const isSelected = selectedStatusFilter === seg.filter;
                    const el = (
                      <circle
                        key={i}
                        cx="21" cy="21" r="15.9"
                        fill="none"
                        stroke={seg.color}
                        strokeWidth={isSelected ? "5" : "3.5"}
                        strokeDasharray={`${dash} ${gap}`}
                        strokeDashoffset={-offset + circumference * 0.25}
                        transform="rotate(-90 21 21)"
                        style={{ cursor: "pointer", transition: "stroke-width 0.3s ease", opacity: selectedStatusFilter && !isSelected ? 0.3 : 1 }}
                        onClick={() => setSelectedStatusFilter(selectedStatusFilter === seg.filter ? null : seg.filter)}
                      />
                    );
                    offset += dash;
                    return el;
                  });
                })()}
              </svg>
            </div>
          </div>
        </div>

        {/* Daily Processing Trend */}
        <div className="analytics-chart-card">
          <h3>Daily Processing (Last 7 Days)</h3>
          <div style={{ marginTop: "8px" }}>
            <SparklineChart data={dailyTrend} color="#4f46e5" height={130} />
          </div>
          <div style={{ marginTop: "12px", fontSize: "12px", color: "var(--text-secondary)", textAlign: "center" }}>
            Total this week: <strong style={{ color: "var(--text-primary)" }}>{dailyTrend.reduce((s, d) => s + d.value, 0)}</strong> documents
          </div>
        </div>

        {/* Monthly Revenue Trend */}
        <div className="analytics-chart-card">
          <h3>Monthly Revenue Trend (₹K)</h3>
          <div style={{ marginTop: "8px" }}>
            <SparklineChart data={monthlyRevenue} color="#f59e0b" height={130} />
          </div>
          <div style={{ marginTop: "12px", fontSize: "12px", color: "var(--text-secondary)", textAlign: "center" }}>
            6-month total: <strong style={{ color: "var(--text-primary)" }}>₹{(monthlyRevenue.reduce((s, d) => s + d.value, 0)).toLocaleString("en-IN")}K</strong>
          </div>
        </div>

        {/* Top Vendors by Count */}
        <div className="analytics-chart-card">
          <h3>Top Vendors (by Invoice Count)</h3>
          {topVendors.length === 0 ? (
            <div className="chart-empty">No data yet</div>
          ) : (
            <div className="bars-list">
              {topVendors.map(([vendor, count], i) => (
                <SimpleBar key={vendor} label={vendor} value={count} max={maxVendor} color={barColors[i % barColors.length]} />
              ))}
            </div>
          )}
        </div>

        {/* Top Vendors by Revenue */}
        <div className="analytics-chart-card">
          <h3>Top Vendors (by Revenue)</h3>
          {topVendorsByRevenue.length === 0 ? (
            <div className="chart-empty">No data yet</div>
          ) : (
            <div className="bars-list">
              {topVendorsByRevenue.map(([vendor, rev], i) => (
                <SimpleBar key={vendor} label={vendor} value={rev} max={maxVendorRevenue} color={barColors[i % barColors.length]} suffix="" />
              ))}
            </div>
          )}
        </div>

        {/* Amount Distribution */}
        <div className="analytics-chart-card">
          <h3>Invoice Value Distribution</h3>
          <div className="bars-list">
            {Object.entries(amountBuckets).map(([bucket, count], i) => (
              <SimpleBar key={bucket} label={bucket} value={count} max={maxBucket} color={barColors[i % barColors.length]} />
            ))}
          </div>
        </div>

        {/* Top States */}
        <div className="analytics-chart-card">
          <h3>Top States (by Vendor)</h3>
          {topStates.length === 0 ? (
            <div className="chart-empty">No data yet</div>
          ) : (
            <div className="bars-list">
              {topStates.map(([state, count], i) => (
                <SimpleBar key={state} label={state} value={count} max={maxState} color={barColors[i % barColors.length]} />
              ))}
            </div>
          )}
        </div>

        {/* Processing Performance */}
        <div className="analytics-chart-card">
          <h3>Performance Metrics</h3>
          <div style={{ display: "flex", flexDirection: "column", gap: "16px", padding: "8px 0" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "10px 12px", background: "var(--bg-hover)", borderRadius: "8px" }}>
              <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                <div style={{ width: "36px", height: "36px", borderRadius: "8px", background: "#10b98120", display: "flex", alignItems: "center", justifyContent: "center" }}>
                  <svg width="18" height="18" fill="none" stroke="#10b981" strokeWidth="2" viewBox="0 0 24 24"><polyline points="20 6 9 17 4 12"/></svg>
                </div>
                <div>
                  <div style={{ fontSize: "13px", fontWeight: "600", color: "var(--text-primary)" }}>Success Rate</div>
                  <div style={{ fontSize: "11px", color: "var(--text-secondary)" }}>{archived.length} verified of {total}</div>
                </div>
              </div>
              <span style={{ fontSize: "20px", fontWeight: "700", color: "#10b981" }}>{successRate}%</span>
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "10px 12px", background: "var(--bg-hover)", borderRadius: "8px" }}>
              <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                <div style={{ width: "36px", height: "36px", borderRadius: "8px", background: "#ef444420", display: "flex", alignItems: "center", justifyContent: "center" }}>
                  <svg width="18" height="18" fill="none" stroke="#ef4444" strokeWidth="2" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>
                </div>
                <div>
                  <div style={{ fontSize: "13px", fontWeight: "600", color: "var(--text-primary)" }}>Failure Rate</div>
                  <div style={{ fontSize: "11px", color: "var(--text-secondary)" }}>{failed.length} errors of {total}</div>
                </div>
              </div>
              <span style={{ fontSize: "20px", fontWeight: "700", color: "#ef4444" }}>{failRate}%</span>
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "10px 12px", background: "var(--bg-hover)", borderRadius: "8px" }}>
              <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                <div style={{ width: "36px", height: "36px", borderRadius: "8px", background: "#8b5cf620", display: "flex", alignItems: "center", justifyContent: "center" }}>
                  <svg width="18" height="18" fill="none" stroke="#8b5cf6" strokeWidth="2" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
                </div>
                <div>
                  <div style={{ fontSize: "13px", fontWeight: "600", color: "var(--text-primary)" }}>Avg. Verification</div>
                  <div style={{ fontSize: "11px", color: "var(--text-secondary)" }}>Time per invoice</div>
                </div>
              </div>
              <span style={{ fontSize: "20px", fontWeight: "700", color: "#8b5cf6" }}>{avgVerificationTime}s</span>
            </div>
          </div>
        </div>
      </div>

      {/* Recent Activity Table */}
      <div className="analytics-activity-card">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "12px" }}>
          <h3 style={{ margin: 0 }}>Recent Invoices</h3>
          <span style={{ fontSize: "12px", color: "var(--text-secondary)" }}>
            Showing latest {recentActivity.length} of {readyDocs.length} processed
          </span>
        </div>
        {recentActivity.length === 0 ? (
          <div className="chart-empty" style={{ padding: "40px 0" }}>No processed invoices yet.</div>
        ) : (
          <table className="activity-table">
            <thead>
              <tr>
                <th>Vendor</th>
                <th>Invoice No.</th>
                <th>Invoice Date</th>
                <th>Grand Total</th>
                <th>Verification Time</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {recentActivity.map(doc => {
                const { vendorName, invoiceNo, invoiceDate, grandTotal } = getDocDetails(doc);
                return (
                  <tr
                     key={doc.document_id}
                     style={{ cursor: "pointer", transition: "background 0.2s" }}
                     onClick={() => navigate("/invoice/archive")}
                     onMouseEnter={e => e.currentTarget.style.background = "var(--bg-hover)"}
                     onMouseLeave={e => e.currentTarget.style.background = "transparent"}
                  >
                    <td><strong>{vendorName}</strong></td>
                    <td>{invoiceNo}</td>
                    <td>{invoiceDate}</td>
                    <td className="amount-cell">₹{grandTotal.toLocaleString("en-IN", { minimumFractionDigits: 2 })}</td>
                    <td>{doc.verification_time || 0}s</td>
                    <td>
                      <span
                        className={`status-badge ${doc.status === "ARCHIVED" ? "archived" : "pending"}`}
                        style={doc.status !== "ARCHIVED" ? { background: "rgba(245, 158, 11, 0.15)", color: "#d97706" } : {}}
                      >
                        {doc.status === "ARCHIVED" ? "✓ Verified" : "Pending"}
                      </span>
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
