import { useState } from "react";
import { useNavigate } from "react-router-dom";
import API from "../services/api";

export default function LoginPage() {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError("");
    setLoading(true);

    try {
      const res = await API.post("/login", { username, password });
      if (res.data?.token) {
        localStorage.setItem("token", res.data.token);
        localStorage.setItem("username", res.data.username);
        navigate("/uploads");
      } else {
        setError("Something went wrong. Please try again.");
      }
    } catch (err) {
      if (err.response?.status === 401) {
        setError("Invalid username or password.");
      } else {
        setError("Cannot connect to server. Ensure backend is running.");
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div
      style={{
        display: "flex",
        justifyContent: "center",
        alignItems: "center",
        minHeight: "100vh",
        background: "radial-gradient(circle at top right, var(--accent-bg), transparent), var(--bg)",
        padding: "20px",
        boxSizing: "border-box"
      }}
    >
      <div
        style={{
          width: "100%",
          maxWidth: "420px",
          background: "var(--bg-panel, rgba(255, 255, 255, 0.03))",
          backdropFilter: "blur(12px)",
          border: "1px solid var(--border)",
          borderRadius: "16px",
          padding: "40px 32px",
          boxShadow: "var(--shadow)",
          textAlign: "left",
          boxSizing: "border-box"
        }}
      >
        <div style={{ textAlign: "center", marginBottom: "32px" }}>
          <div
            style={{
              width: "48px",
              height: "48px",
              background: "var(--accent-bg)",
              borderRadius: "12px",
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              marginBottom: "16px",
              border: "1px solid var(--accent-border)",
              color: "var(--accent)"
            }}
          >
            <svg width="24" height="24" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24">
              <rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect>
              <path d="M7 11V7a5 5 0 0 1 10 0v4"></path>
            </svg>
          </div>
          <h2 style={{ fontSize: "28px", fontWeight: "700", margin: "0 0 8px", color: "var(--text-h)" }}>Welcome Back</h2>
          <p style={{ fontSize: "14px", color: "var(--text-secondary, #9ca3af)", margin: 0 }}>
            Login to access your Invoice OCR System
          </p>
        </div>

        {error && (
          <div
            style={{
              background: "rgba(239, 68, 68, 0.1)",
              border: "1px solid rgba(239, 68, 68, 0.2)",
              color: "#ef4444",
              padding: "12px",
              borderRadius: "8px",
              fontSize: "13px",
              marginBottom: "24px",
              display: "flex",
              alignItems: "center",
              gap: "8px"
            }}
          >
            <svg width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24">
              <circle cx="12" cy="12" r="10"></circle>
              <line x1="12" y1="8" x2="12" y2="12"></line>
              <line x1="12" y1="16" x2="12.01" y2="16"></line>
            </svg>
            <span>{error}</span>
          </div>
        )}

        <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: "20px" }}>
          <div>
            <label
              style={{
                display: "block",
                fontSize: "13px",
                fontWeight: "600",
                marginBottom: "8px",
                color: "var(--text-h)"
              }}
            >
              Username
            </label>
            <input
              type="text"
              required
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="Enter username"
              style={{
                width: "100%",
                padding: "12px 16px",
                borderRadius: "8px",
                border: "1px solid var(--border)",
                background: "var(--bg-card, transparent)",
                color: "var(--text-h)",
                fontSize: "14px",
                boxSizing: "border-box",
                outline: "none",
                transition: "border-color 0.2s"
              }}
              onFocus={(e) => (e.target.style.borderColor = "var(--accent)")}
              onBlur={(e) => (e.target.style.borderColor = "var(--border)")}
            />
          </div>

          <div>
            <label
              style={{
                display: "block",
                fontSize: "13px",
                fontWeight: "600",
                marginBottom: "8px",
                color: "var(--text-h)"
              }}
            >
              Password
            </label>
            <input
              type="password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Enter password"
              style={{
                width: "100%",
                padding: "12px 16px",
                borderRadius: "8px",
                border: "1px solid var(--border)",
                background: "var(--bg-card, transparent)",
                color: "var(--text-h)",
                fontSize: "14px",
                boxSizing: "border-box",
                outline: "none",
                transition: "border-color 0.2s"
              }}
              onFocus={(e) => (e.target.style.borderColor = "var(--accent)")}
              onBlur={(e) => (e.target.style.borderColor = "var(--border)")}
            />
          </div>

          <button
            type="submit"
            disabled={loading}
            style={{
              width: "100%",
              padding: "12px",
              borderRadius: "8px",
              border: "none",
              background: "var(--accent, #aa3bff)",
              color: "#fff",
              fontSize: "14px",
              fontWeight: "600",
              cursor: "pointer",
              transition: "opacity 0.2s, transform 0.1s",
              display: "flex",
              justifyContent: "center",
              alignItems: "center",
              gap: "8px",
              marginTop: "12px"
            }}
            onMouseEnter={(e) => (e.target.style.opacity = "0.9")}
            onMouseLeave={(e) => (e.target.style.opacity = "1")}
            onMouseDown={(e) => (e.target.style.transform = "scale(0.98)")}
            onMouseUp={(e) => (e.target.style.transform = "scale(1)")}
          >
            {loading ? (
              <svg width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24" className="spin">
                <circle cx="12" cy="12" r="10" stroke="rgba(255,255,255,0.3)"/>
                <path d="M12 2a10 10 0 0 1 10 10"/>
              </svg>
            ) : (
              "Sign In"
            )}
          </button>
        </form>
      </div>
    </div>
  );
}
