import React from "react";
import { T, STATUS_COLORS } from "../theme";

export function StatusBadge({ status, size = 11 }) {
  const c = STATUS_COLORS[status] || STATUS_COLORS.DEFAULT;
  return (
    <span style={{
      background: c.bg, color: c.color,
      border: `1px solid ${c.border}`,
      borderRadius: 999, padding: `2px ${size + 2}px`,
      fontSize: size, fontWeight: 800, whiteSpace: "nowrap", letterSpacing: .3,
    }}>{status}</span>
  );
}

export function Spinner({ size = 22 }) {
  return (
    <div style={{ display: "flex", justifyContent: "center", padding: 24 }}>
      <div style={{
        width: size, height: size,
        border: `3px solid ${T.border}`,
        borderTop: `3px solid ${T.gold}`,
        borderRadius: "50%",
        animation: "spin .7s linear infinite",
      }}/>
      <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
    </div>
  );
}

export function Alert({ type, msg }) {
  const s = {
    ok:   { bg: T.greenBg,  color: T.green,  border: "#BBF7D0", icon: "✅" },
    err:  { bg: T.redBg,    color: T.red,     border: "#FECACA", icon: "❌" },
    warn: { bg: T.amberBg,  color: T.amber,   border: "#FDE68A", icon: "⚠️" },
    info: { bg: T.blueBg,   color: T.blue,    border: "#BFDBFE", icon: "ℹ️" },
  }[type] || { bg: T.blueBg, color: T.blue, border: "#BFDBFE", icon: "ℹ️" };
  return (
    <div style={{
      background: s.bg, color: s.color, border: `1px solid ${s.border}`,
      borderRadius: 10, padding: "10px 14px", marginBottom: 12,
      fontSize: 13, fontWeight: 600, display: "flex", alignItems: "center", gap: 8,
    }}>
      <span>{s.icon}</span><span>{msg}</span>
    </div>
  );
}

export function Topbar({ title, onBack, live = false, right = null }) {
  return (
    <div style={{
      background: T.topbarGrad, color: T.white,
      padding: "13px 18px", display: "flex", alignItems: "center",
      gap: 10, flexWrap: "wrap", position: "sticky", top: 0, zIndex: 40,
      boxShadow: "0 2px 12px rgba(18,40,80,.25)",
      borderBottom: `3px solid ${T.gold}`,
    }}>
      {onBack && (
        <button onClick={onBack} style={{
          border: "1px solid rgba(255,255,255,.25)", background: "rgba(255,255,255,.08)",
          color: T.white, borderRadius: 8, padding: "5px 12px",
          cursor: "pointer", fontSize: 12, fontWeight: 700,
        }}>← Back</button>
      )}
      <div style={{
        width: 28, height: 28, borderRadius: 6, background: T.gold,
        display: "flex", alignItems: "center", justifyContent: "center",
        fontWeight: 900, fontSize: 11, color: T.navy, letterSpacing: -1, flexShrink: 0,
      }}>YCH</div>
      <span style={{ fontWeight: 800, fontSize: 15, letterSpacing: .2 }}>{title}</span>
      <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 10 }}>
        {right}
        {live && <LiveBadge />}
      </div>
    </div>
  );
}

export function Modal({ title, onClose, children, width = 520 }) {
  return (
    <div style={{
      position: "fixed", inset: 0, background: "rgba(15,31,61,.55)",
      backdropFilter: "blur(4px)", display: "flex",
      alignItems: "center", justifyContent: "center", zIndex: 100, padding: 16,
    }} onClick={e => e.target === e.currentTarget && onClose()}>
      <div style={{
        background: T.bgCard, borderRadius: 16,
        width: "100%", maxWidth: width, maxHeight: "90vh", overflowY: "auto",
        boxShadow: "0 20px 60px rgba(27,58,107,.25)", border: `1px solid ${T.border}`,
      }}>
        <div style={{
          display: "flex", alignItems: "center", justifyContent: "space-between",
          padding: "14px 18px", borderBottom: `3px solid ${T.gold}`,
          background: T.topbarGrad, borderRadius: "16px 16px 0 0",
        }}>
          <span style={{ fontWeight: 800, color: T.white, fontSize: 15 }}>{title}</span>
          <button onClick={onClose} style={{
            background: "rgba(255,255,255,.15)", border: "none", color: T.white,
            borderRadius: 8, width: 30, height: 30, cursor: "pointer",
            fontSize: 16, display: "flex", alignItems: "center", justifyContent: "center",
          }}>✕</button>
        </div>
        <div style={{ padding: 18 }}>{children}</div>
      </div>
    </div>
  );
}

export function Card({ children, style = {} }) {
  return (
    <div style={{
      background: T.bgCard, borderRadius: 14, padding: 18, marginBottom: 14,
      boxShadow: T.shadow, border: `1px solid ${T.border}`, ...style,
    }}>{children}</div>
  );
}

export function LiveBadge() {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
      <span style={{
        width: 8, height: 8, borderRadius: "50%", background: "#4ADE80",
        boxShadow: "0 0 0 3px rgba(74,222,128,.25)", display: "inline-block",
      }}/>
      <span style={{ fontSize: 11, fontWeight: 700, color: "#86EFAC" }}>LIVE</span>
    </div>
  );
}

export function SectionHeader({ title, count, onRefresh, action }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <span style={{ fontWeight: 800, color: T.navy, fontSize: 14 }}>{title}</span>
        {count !== undefined && (
          <span style={{
            background: T.goldPale, color: T.goldDark, border: `1px solid ${T.goldLight}`,
            borderRadius: 999, padding: "1px 9px", fontSize: 11, fontWeight: 800,
          }}>{count}</span>
        )}
      </div>
      <div style={{ display: "flex", gap: 6 }}>
        {action}
        {onRefresh && (
          <button onClick={onRefresh} style={{
            background: T.border, color: T.textSecond, border: "none",
            borderRadius: 7, padding: "4px 10px", cursor: "pointer", fontSize: 11, fontWeight: 700,
          }}>↻</button>
        )}
      </div>
    </div>
  );
}

export function Table({ headers, rows, emptyText = "ไม่มีข้อมูล" }) {
  return (
    <div style={{ overflowX: "auto" }}>
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
        <thead>
          <tr style={{ background: T.navy }}>
            {headers.map((h, i) => (
              <th key={i} style={{
                padding: "9px 12px", textAlign: "left",
                color: T.white, fontWeight: 700, fontSize: 12, whiteSpace: "nowrap",
              }}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr><td colSpan={headers.length} style={{ textAlign: "center", padding: 24, color: T.textMuted }}>{emptyText}</td></tr>
          ) : rows.map((row, i) => (
            <tr key={i} style={{ background: i % 2 === 0 ? T.white : "#F8FAFF" }}>
              {row.map((cell, j) => (
                <td key={j} style={{ padding: "9px 12px", borderBottom: `1px solid ${T.border}`, color: T.textPrimary }}>{cell}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
