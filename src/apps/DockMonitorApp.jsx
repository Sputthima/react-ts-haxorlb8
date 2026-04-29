import React, { useState, useEffect, useCallback } from "react";
import { supabase, today } from "../lib/supabase";
import { T } from "../theme";

// ── elapsed time helper ───────────────────────────────────────────────────────
function elapsed(isoStr) {
  if (!isoStr) return null;
  const diff = Math.floor((Date.now() - new Date(isoStr).getTime()) / 1000);
  const h = Math.floor(diff / 3600);
  const m = Math.floor((diff % 3600) / 60);
  return h > 0 ? `${h}h${m}m` : `${m}m`;
}
function elapsedHours(isoStr) {
  if (!isoStr) return 0;
  return (Date.now() - new Date(isoStr).getTime()) / 3600000;
}

// ── Clock ─────────────────────────────────────────────────────────────────────
function Clock() {
  const [t, setT] = useState(new Date());
  useEffect(() => { const id = setInterval(() => setT(new Date()), 1000); return () => clearInterval(id); }, []);
  const time = t.toLocaleTimeString("th-TH", { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false });
  const date = t.toLocaleDateString("th-TH", { weekday: "short", day: "numeric", month: "short", year: "numeric" });
  return (
    <div style={{ textAlign: "right" }}>
      <div style={{ fontSize: 28, fontWeight: 900, color: T.gold, fontFamily: "monospace", letterSpacing: 2 }}>{time}</div>
      <div style={{ fontSize: 11, color: "rgba(255,255,255,.5)", marginTop: 2 }}>{date}</div>
    </div>
  );
}

// ── Truck Card (Dock) ─────────────────────────────────────────────────────────
function DockCard({ slot, booking }) {
  const occupied = booking && !["COMPLETED","CANCELLED"].includes(booking.status);
  const bg = occupied
    ? booking.status === "TRUCK_DOCKED" || booking.status === "LOADING"
      ? "linear-gradient(160deg,#1a3a1a,#1e5c1e)"
      : "linear-gradient(160deg,#1a2a4a,#1e3a6a)"
    : "linear-gradient(160deg,#0e1a2e,#152240)";
  const border = occupied
    ? booking.status === "TRUCK_DOCKED" || booking.status === "LOADING" ? "#22c55e" : T.gold
    : "rgba(255,255,255,.1)";

  return (
    <div style={{
      background: bg, border: `2px solid ${border}`,
      borderRadius: 14, padding: "14px 12px",
      minHeight: 160, position: "relative", overflow: "hidden",
      flex: "1 1 160px", minWidth: 140, maxWidth: 220,
    }}>
      {/* Dock number */}
      <div style={{ fontSize: 32, fontWeight: 900, color: T.white, lineHeight: 1 }}>{slot}</div>
      <div style={{ fontSize: 10, color: "rgba(255,255,255,.4)", fontWeight: 700, letterSpacing: 2, marginBottom: 10 }}>DOCK</div>

      {occupied ? (
        <>
          {/* Live dot */}
          <div style={{
            position: "absolute", top: 10, right: 10,
            width: 8, height: 8, borderRadius: "50%",
            background: booking.status === "TRUCK_DOCKED" || booking.status === "LOADING" ? "#22c55e" : T.gold,
            boxShadow: `0 0 0 4px ${booking.status === "TRUCK_DOCKED" || booking.status === "LOADING" ? "rgba(34,197,94,.25)" : "rgba(245,168,0,.25)"}`,
          }}/>
          <div style={{ fontSize: 12, color: "rgba(255,255,255,.5)", marginBottom: 4 }}>🚛 MON</div>
          <div style={{ fontSize: 22, fontWeight: 900, color: T.white, fontFamily: "monospace", letterSpacing: 2 }}>
            {booking.truck_plate || "—"}
          </div>
          <div style={{ fontSize: 10, color: "rgba(255,255,255,.5)", fontFamily: "monospace", marginTop: 2 }}>
            {booking.booking_id}
          </div>
          <div style={{ display: "flex", gap: 16, marginTop: 8 }}>
            <div>
              <div style={{ fontSize: 9, color: "rgba(255,255,255,.4)", fontWeight: 700 }}>PLAN</div>
              <div style={{ fontSize: 14, fontWeight: 800, color: T.goldLight }}>
                {String(booking.booking_hour || "").slice(0, 5)}
              </div>
            </div>
            {booking.check_in_time && (
              <div>
                <div style={{ fontSize: 9, color: "rgba(255,255,255,.4)", fontWeight: 700 }}>IN</div>
                <div style={{ fontSize: 14, fontWeight: 800, color: "#86efac" }}>
                  {elapsed(booking.check_in_time)}
                </div>
              </div>
            )}
          </div>
          {/* Status badge */}
          <div style={{
            marginTop: 8, display: "inline-block",
            fontSize: 9, fontWeight: 800, letterSpacing: 1,
            padding: "2px 7px", borderRadius: 999,
            background: "rgba(255,255,255,.1)", color: "rgba(255,255,255,.6)",
          }}>{booking.status}</div>
        </>
      ) : (
        <div style={{
          display: "flex", flexDirection: "column",
          alignItems: "center", justifyContent: "center",
          height: 90, gap: 6,
        }}>
          <div style={{ fontSize: 28, opacity: .2 }}>🟢</div>
          <div style={{ fontSize: 11, color: "rgba(255,255,255,.25)", fontWeight: 700 }}>AVAILABLE</div>
        </div>
      )}
    </div>
  );
}

// ── Yard Truck Card ───────────────────────────────────────────────────────────
function YardCard({ booking, urgency }) {
  const hrs = elapsedHours(booking.check_in_time);
  const bg = urgency === "critical" ? "rgba(180,30,30,.25)" : urgency === "warn" ? "rgba(180,110,0,.2)" : "rgba(30,58,100,.25)";
  const border = urgency === "critical" ? "#ef4444" : urgency === "warn" ? T.gold : "rgba(255,255,255,.15)";
  return (
    <div style={{ background: bg, border: `1.5px solid ${border}`, borderRadius: 12, padding: "12px 14px", minWidth: 150, maxWidth: 200 }}>
      <div style={{ fontSize: 10, color: "rgba(255,255,255,.5)", marginBottom: 4 }}>
        {urgency === "critical" ? "🔴" : urgency === "warn" ? "⚠️" : "🚛"} {elapsed(booking.check_in_time)}
      </div>
      <div style={{ fontSize: 12, color: "rgba(255,255,255,.5)", marginBottom: 2 }}>🚛 MON</div>
      <div style={{ fontSize: 20, fontWeight: 900, color: T.white, fontFamily: "monospace", letterSpacing: 2 }}>
        {booking.truck_plate || "—"}
      </div>
      <div style={{ fontSize: 10, color: "rgba(255,255,255,.4)", fontFamily: "monospace", marginTop: 2 }}>{booking.booking_id}</div>
      <div style={{ display: "flex", gap: 12, marginTop: 8 }}>
        <div>
          <div style={{ fontSize: 9, color: "rgba(255,255,255,.4)" }}>Check In</div>
          <div style={{ fontSize: 12, fontWeight: 800, color: T.goldLight }}>
            {booking.check_in_time ? new Date(booking.check_in_time).toLocaleTimeString("th-TH", { hour: "2-digit", minute: "2-digit" }) : "—"}
          </div>
        </div>
        <div>
          <div style={{ fontSize: 9, color: "rgba(255,255,255,.4)" }}>Plan</div>
          <div style={{ fontSize: 12, fontWeight: 800, color: T.white }}>
            {String(booking.booking_hour || "").slice(0, 5)}
          </div>
        </div>
      </div>
      <div style={{ marginTop: 6, fontSize: 10, fontWeight: 700, color: "rgba(255,255,255,.5)" }}>Status: On Yard</div>
    </div>
  );
}

// ── Main Component ────────────────────────────────────────────────────────────
export default function DockMonitorApp({ user, onBack }) {
  const [bookings, setBookings]   = useState([]);
  const [dockSlots, setDockSlots] = useState([]);
  const [config, setConfig]       = useState({});

  const loadData = useCallback(async () => {
    const [{ data: bk }, { data: slots }, { data: cfg }] = await Promise.all([
      supabase.from("bookings").select("*")
        .eq("booking_date", today())
        .not("status", "in", "(CANCELLED)"),
      supabase.from("dock_slots").select("*").eq("slot_date", today()),
      supabase.from("config").select("*"),
    ]);
    setBookings(bk || []);
    setDockSlots(slots || []);
    if (cfg) {
      const m = {};
      cfg.forEach(r => { m[r.key] = r.value; });
      setConfig(m);
    }
  }, []);

  useEffect(() => { loadData(); }, [loadData]);

  useEffect(() => {
    const ch = supabase.channel("monitor_live")
      .on("postgres_changes", { event: "*", schema: "public", table: "bookings" }, loadData)
      .on("postgres_changes", { event: "*", schema: "public", table: "dock_slots" }, loadData)
      .subscribe(s => { if (s === "CHANNEL_ERROR") console.warn("monitor realtime error"); });
    return () => { try { supabase.removeChannel(ch); } catch (e) {} };
  }, [loadData]);

  // ── Derived data ─────────────────────────────────────────────────────────
  const numDocks = parseInt(config.DOCK_COUNT || "5");
  const dockNums = Array.from({ length: numDocks }, (_, i) => i + 1);

  const bookingByDock = {};
  bookings.forEach(b => {
    if (b.dock_no && !["COMPLETED", "CANCELLED"].includes(b.status)) {
      bookingByDock[b.dock_no] = b;
    }
  });

  const atDock  = bookings.filter(b => ["TRUCK_DOCKED", "LOADING"].includes(b.status));
  const onYard  = bookings.filter(b => b.status === "ON_YARD");
  const booked  = bookings.filter(b => b.status === "RESERVED");
  const done    = bookings.filter(b => b.status === "COMPLETED");
  const active  = bookings.filter(b => !["CANCELLED"].includes(b.status));

  const yardLt1  = onYard.filter(b => elapsedHours(b.check_in_time) < 1);
  const yardGt1  = onYard.filter(b => elapsedHours(b.check_in_time) >= 1 && elapsedHours(b.check_in_time) < 2);
  const yardGt2  = onYard.filter(b => elapsedHours(b.check_in_time) >= 2);

  const statColor = (n, warn, crit) => n >= crit ? "#ef4444" : n >= warn ? T.gold : "#4ade80";

  return (
    <div style={{ minHeight: "100vh", background: "#050e1f", color: T.white, fontFamily: "'Segoe UI', system-ui, sans-serif" }}>

      {/* ── HEADER ── */}
      <div style={{
        background: "linear-gradient(90deg,#060d20,#0d1f3c)",
        borderBottom: `3px solid ${T.gold}`,
        padding: "12px 24px",
        display: "flex", alignItems: "center", gap: 16, flexWrap: "wrap",
      }}>
        {onBack && (
          <button onClick={onBack} style={{
            border: "1px solid rgba(255,255,255,.2)", background: "rgba(255,255,255,.08)",
            color: T.white, borderRadius: 8, padding: "5px 12px",
            cursor: "pointer", fontSize: 12, fontWeight: 700,
          }}>← Back</button>
        )}

        {/* Logo + title */}
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <div style={{
            width: 36, height: 36, background: T.gold, borderRadius: 10,
            display: "flex", alignItems: "center", justifyContent: "center",
            fontWeight: 900, fontSize: 12, color: T.navy,
          }}>YCH</div>
          <div>
            <div style={{ fontSize: 18, fontWeight: 900, letterSpacing: -.3 }}>Dock Monitor</div>
            <div style={{ fontSize: 11, color: "rgba(255,255,255,.4)" }}>{config.SITE_NAME || "YCH Ladkrabang Plant"}</div>
          </div>
        </div>

        {/* KPI pills */}
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginLeft: 16 }}>
          {[
            { label: "AT DOCK", val: atDock.length, w: 1, c: "#4ade80" },
            { label: "ON YARD", val: onYard.length, w: 2, c: T.gold },
            { label: "BOOKED",  val: booked.length, w: 3, c: "#93c5fd" },
            { label: "DONE",    val: done.length,   w: 1, c: "rgba(255,255,255,.4)" },
            { label: "ACTIVE",  val: active.length, w: 2, c: "#f97316" },
          ].map(k => (
            <div key={k.label} style={{ textAlign: "center", minWidth: 48 }}>
              <div style={{ fontSize: 22, fontWeight: 900, color: statColor(k.val, k.w, k.w * 2), fontFamily: "monospace" }}>{k.val}</div>
              <div style={{ fontSize: 9, color: "rgba(255,255,255,.4)", fontWeight: 700, letterSpacing: 1 }}>{k.label}</div>
            </div>
          ))}
        </div>

        <div style={{ marginLeft: "auto" }}><Clock /></div>
      </div>

      <div style={{ padding: "16px 20px", maxWidth: 1400, margin: "0 auto" }}>

        {/* ── DOCK STATUS ── */}
        <div style={{
          background: "rgba(255,255,255,.04)", borderRadius: 14,
          border: "1px solid rgba(255,255,255,.08)", marginBottom: 16, overflow: "hidden",
        }}>
          <div style={{
            background: "rgba(27,58,107,.5)", padding: "10px 18px",
            display: "flex", alignItems: "center", gap: 8,
            borderBottom: "1px solid rgba(255,255,255,.08)",
          }}>
            <span style={{ width: 8, height: 8, borderRadius: "50%", background: "#4ade80", boxShadow: "0 0 0 3px rgba(74,222,128,.25)", display: "inline-block" }}/>
            <span style={{ fontWeight: 800, fontSize: 13, letterSpacing: 1, textTransform: "uppercase" }}>Dock Status — Real Time</span>
          </div>
          <div style={{ padding: "16px", display: "flex", gap: 12, flexWrap: "wrap" }}>
            {dockNums.map(n => (
              <DockCard key={n} slot={n} booking={bookingByDock[n] || null} />
            ))}
          </div>
        </div>

        {/* ── ON YARD SECTIONS ── */}
        {[
          { label: "🚛 ON YARD < 1 HR",   items: yardLt1, urgency: "ok",       bg: "rgba(27,58,107,.3)",  border: "rgba(255,255,255,.08)" },
          { label: "⚠️ ON YARD > 1 HR",   items: yardGt1, urgency: "warn",     bg: "rgba(100,70,0,.3)",   border: `rgba(245,168,0,.3)` },
          { label: "🔴 ON YARD > 2 HRS",  items: yardGt2, urgency: "critical", bg: "rgba(120,20,20,.3)",  border: "rgba(239,68,68,.3)" },
        ].map(section => (
          <div key={section.label} style={{
            background: section.bg, borderRadius: 14,
            border: `1px solid ${section.border}`, marginBottom: 12, overflow: "hidden",
          }}>
            <div style={{
              padding: "9px 18px",
              display: "flex", alignItems: "center", justifyContent: "space-between",
              borderBottom: `1px solid ${section.border}`,
            }}>
              <span style={{ fontWeight: 800, fontSize: 13 }}>{section.label}</span>
              <span style={{
                background: "rgba(255,255,255,.1)", borderRadius: 999,
                padding: "1px 10px", fontSize: 12, fontWeight: 800,
              }}>{section.items.length}</span>
            </div>
            <div style={{ padding: 14 }}>
              {section.items.length === 0 ? (
                <div style={{ textAlign: "center", color: "rgba(255,255,255,.3)", padding: "12px 0", fontSize: 13 }}>
                  ไม่มีรถในช่วงนี้
                </div>
              ) : (
                <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
                  {section.items.map(b => (
                    <YardCard key={b.booking_id} booking={b} urgency={section.urgency} />
                  ))}
                </div>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
