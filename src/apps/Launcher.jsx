import React from "react";
import { T } from "../theme";

export const ROLE_APPS = {
  cs:        ["obd","booking"],
  gate:      ["gate"],
  warehouse: ["gate"],
  queue:     ["queue"],
  manager:   ["obd","booking","gate","queue","manager"],
  admin:     ["obd","booking","gate","queue","manager","supplier","inbound","admin"],
  supplier:  ["supplier"],
};

export const APPS = [
  { id:"obd",      icon:"📦", name:"OBD & Group",        role:"CS",        color:T.navyLight,  desc:"สร้าง OBD และ Group สินค้า" },
  { id:"booking",  icon:"📅", name:"Dock Booking",        role:"Subcon/CS", color:T.purple,     desc:"จองช่วง Dock สำหรับรถบรรทุก" },
  { id:"gate",     icon:"🏭", name:"Gate & Warehouse",    role:"Gate/WH",   color:T.amber,      desc:"Check-in รถ และจัดการ Order" },
  { id:"queue",    icon:"🔔", name:"Queue Operator",      role:"Operator",  color:T.gold,       desc:"เรียก Queue และ SMS แจ้งเตือน" },
  { id:"manager",  icon:"📊", name:"Manager Dashboard",   role:"Manager",   color:T.blue,       desc:"ภาพรวม KPI และ SLA ประจำวัน" },
  { id:"supplier", icon:"🚚", name:"Supplier Portal",     role:"Supplier",  color:T.green,      desc:"ส่ง ASN และติดตามสถานะ" },
  { id:"inbound",  icon:"⬇️", name:"Inbound Gate & WH",  role:"Gate/WH",   color:T.green,    desc:"รับสินค้าขาเข้าและ Unloading" },
  { id:"admin",    icon:"⚙️", name:"Admin Panel",         role:"Admin",     color:T.red,        desc:"จัดการผู้ใช้ Slot และ Config" },
];

export default function Launcher({ user, onSelect, onLogout }) {
  const allowed = ROLE_APPS[user.role] || [];
  const visible = APPS.filter(a => allowed.includes(a.id));
  const now = new Date().toLocaleDateString("th-TH", {
    weekday:"long", day:"numeric", month:"long", year:"numeric",
  });

  return (
    <div style={{ minHeight: "100vh", background: T.topbarGrad, position: "relative", overflow: "hidden" }}>

      {/* Background decoration */}
      <div style={{
        position: "absolute", bottom: -80, right: -80,
        width: 400, height: 400, borderRadius: "50%",
        background: "rgba(245,168,0,.06)", pointerEvents: "none",
      }}/>
      <div style={{
        position: "absolute", top: -60, left: -60,
        width: 300, height: 300, borderRadius: "50%",
        background: "rgba(255,255,255,.03)", pointerEvents: "none",
      }}/>

      {/* Gold top stripe */}
      <div style={{ height: 4, background: `linear-gradient(90deg,${T.gold},${T.goldLight},${T.gold})` }}/>

      {/* Header */}
      <div style={{
        padding: "18px 28px",
        display: "flex", alignItems: "center", justifyContent: "space-between",
        flexWrap: "wrap", gap: 12,
        borderBottom: "1px solid rgba(255,255,255,.08)",
      }}>
        {/* Brand */}
        <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
          <div style={{
            width: 48, height: 48,
            background: T.gold,
            borderRadius: 14,
            display: "flex", alignItems: "center", justifyContent: "center",
            fontWeight: 900, fontSize: 14, color: T.navy,
            letterSpacing: -1, flexShrink: 0,
            boxShadow: `0 4px 16px rgba(245,168,0,.4)`,
          }}>YCH</div>
          <div>
            <div style={{ fontSize: 17, fontWeight: 900, color: T.white, letterSpacing: -.3 }}>
              Dock Management System
            </div>
            <div style={{ fontSize: 11, color: "rgba(255,255,255,.45)", marginTop: 2 }}>
              YCH Ladkrabang • {now}
            </div>
          </div>
        </div>

        {/* User info + logout */}
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <div style={{ textAlign: "right" }}>
            <div style={{ fontSize: 13, color: T.white, fontWeight: 700 }}>{user.full_name}</div>
            <div style={{
              display: "inline-block", fontSize: 10,
              background: `${T.gold}33`, color: T.goldLight,
              border: `1px solid ${T.gold}55`,
              borderRadius: 999, padding: "2px 8px", marginTop: 2, fontWeight: 700,
            }}>{user.role.toUpperCase()}</div>
          </div>
          <button
            onClick={onLogout}
            style={{
              border: "1px solid rgba(255,255,255,.2)",
              background: "rgba(255,255,255,.08)",
              color: T.white, borderRadius: 9,
              padding: "8px 16px", cursor: "pointer",
              fontSize: 12, fontWeight: 700,
            }}
            onMouseEnter={e => e.currentTarget.style.background = "rgba(255,255,255,.18)"}
            onMouseLeave={e => e.currentTarget.style.background = "rgba(255,255,255,.08)"}
          >Logout</button>
        </div>
      </div>

      {/* App Grid */}
      <div style={{
        padding: "28px 24px",
        display: "grid",
        gridTemplateColumns: "repeat(auto-fill, minmax(210px, 1fr))",
        gap: 16,
        maxWidth: 1300, margin: "0 auto",
      }}>
        {visible.map(app => (
          <button
            key={app.id}
            onClick={() => onSelect(app.id)}
            style={{
              background: "rgba(255,255,255,.07)",
              backdropFilter: "blur(20px)",
              border: "1px solid rgba(255,255,255,.12)",
              borderRadius: 18,
              padding: "22px 20px",
              textAlign: "left",
              cursor: "pointer",
              color: T.white,
              position: "relative",
              overflow: "hidden",
              transition: "all .22s ease",
              boxShadow: "0 4px 20px rgba(0,0,0,.18)",
            }}
            onMouseEnter={e => {
              e.currentTarget.style.background = "rgba(255,255,255,.14)";
              e.currentTarget.style.transform = "translateY(-5px)";
              e.currentTarget.style.boxShadow = "0 12px 32px rgba(0,0,0,.25)";
            }}
            onMouseLeave={e => {
              e.currentTarget.style.background = "rgba(255,255,255,.07)";
              e.currentTarget.style.transform = "none";
              e.currentTarget.style.boxShadow = "0 4px 20px rgba(0,0,0,.18)";
            }}
          >
            {/* Colour stripe top */}
            <div style={{
              position: "absolute", top: 0, left: 0, right: 0, height: 3,
              background: `linear-gradient(90deg,${app.color},${app.color}88)`,
              borderRadius: "18px 18px 0 0",
            }}/>

            {/* Icon */}
            <div style={{
              width: 48, height: 48,
              background: `${app.color}22`,
              borderRadius: 14,
              display: "flex", alignItems: "center", justifyContent: "center",
              fontSize: 22, marginBottom: 14,
              border: `1.5px solid ${app.color}44`,
            }}>{app.icon}</div>

            <div style={{ fontSize: 15, fontWeight: 800, marginBottom: 3 }}>{app.name}</div>
            <div style={{ fontSize: 10, color: "rgba(255,255,255,.4)", fontWeight: 700, textTransform: "uppercase", letterSpacing: 1, marginBottom: 8 }}>
              {app.role}
            </div>
            <div style={{ fontSize: 11, color: "rgba(255,255,255,.55)", marginBottom: 12, lineHeight: 1.5 }}>
              {app.desc}
            </div>

            {/* Open arrow */}
            <div style={{
              display: "inline-flex", alignItems: "center", gap: 4,
              fontSize: 11, color: app.color, fontWeight: 800,
              background: `${app.color}18`,
              border: `1px solid ${app.color}33`,
              borderRadius: 999, padding: "3px 10px",
            }}>Open →</div>
          </button>
        ))}
      </div>

      {/* Footer */}
      <div style={{
        textAlign: "center", padding: "16px",
        fontSize: 10, color: "rgba(255,255,255,.25)",
        borderTop: "1px solid rgba(255,255,255,.06)",
      }}>
        YCH DMS v2.0 • Powered by Supabase + React • where supplychain connects™
      </div>
    </div>
  );
}
