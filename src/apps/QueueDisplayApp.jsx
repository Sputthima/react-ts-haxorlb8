import React, { useState, useEffect, useCallback } from "react";
import { supabase, today } from "../lib/supabase";
import { T } from "../theme";

function Clock() {
  const [t, setT] = useState(new Date());
  useEffect(() => { const id = setInterval(() => setT(new Date()), 1000); return () => clearInterval(id); }, []);
  return (
    <div style={{ textAlign: "right" }}>
      <div style={{ fontSize: 32, fontWeight: 900, color: T.gold, fontFamily: "monospace", letterSpacing: 3 }}>
        {t.toLocaleTimeString("th-TH", { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false })}
      </div>
      <div style={{ fontSize: 11, color: "rgba(255,255,255,.45)", marginTop: 2 }}>
        {t.toLocaleDateString("th-TH", { weekday: "short", day: "numeric", month: "short", year: "numeric" })}
      </div>
    </div>
  );
}

export default function QueueDisplayApp({ user, onBack }) {
  const [calling, setCalling]   = useState([]);
  const [recent, setRecent]     = useState([]);
  const [upcoming, setUpcoming] = useState([]);
  const [config, setConfig]     = useState({});
  const [pulse, setPulse]       = useState(false);

  const loadData = useCallback(async () => {
    const [{ data: qLog }, { data: bk }, { data: cfg }] = await Promise.all([
      supabase.from("queue_log").select("*")
        .in("queue_status", ["CALLING", "CALLED", "COMPLETED"])
        .eq("booking_date", today())
        .order("called_at", { ascending: false }),
      supabase.from("bookings").select("*")
        .eq("booking_date", today())
        .eq("status", "RESERVED")
        .order("booking_hour"),
      supabase.from("config").select("*"),
    ]);

    const logs = qLog || [];
    setCalling(logs.filter(q => q.queue_status === "CALLING"));
    setRecent(logs.filter(q => q.queue_status !== "CALLING").slice(0, 8));
    setUpcoming((bk || []).slice(0, 10));
    if (cfg) {
      const m = {};
      cfg.forEach(r => { m[r.key] = r.value; });
      setConfig(m);
    }
  }, []);

  useEffect(() => { loadData(); }, [loadData]);

  useEffect(() => {
    const ch = supabase.channel("queue_display_live")
      .on("postgres_changes", { event: "*", schema: "public", table: "queue_log" }, () => {
        setPulse(true);
        setTimeout(() => setPulse(false), 2000);
        loadData();
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "bookings" }, loadData)
      .subscribe(s => { if (s === "CHANNEL_ERROR") console.warn("queue display realtime error"); });
    return () => { try { supabase.removeChannel(ch); } catch (e) {} };
  }, [loadData]);

  const hasCalling = calling.length > 0;

  return (
    <div style={{
      minHeight: "100vh",
      background: "linear-gradient(160deg,#07091a 0%,#0d1535 60%,#12214a 100%)",
      color: T.white,
      fontFamily: "'Segoe UI', system-ui, sans-serif",
      display: "flex", flexDirection: "column",
    }}>
      {/* ── HEADER ── */}
      <div style={{
        background: "linear-gradient(90deg,#3b0d7a,#5b21b6,#7c3aed)",
        borderBottom: `4px solid ${T.gold}`,
        padding: "14px 28px",
        display: "flex", alignItems: "center", gap: 16,
      }}>
        {onBack && (
          <button onClick={onBack} style={{
            border: "1px solid rgba(255,255,255,.2)", background: "rgba(255,255,255,.1)",
            color: T.white, borderRadius: 8, padding: "5px 12px",
            cursor: "pointer", fontSize: 12, fontWeight: 700,
          }}>← Back</button>
        )}
        <span style={{ fontSize: 28 }}>🔔</span>
        <div>
          <div style={{ fontSize: 22, fontWeight: 900, letterSpacing: -.3 }}>Queue Display</div>
          <div style={{ fontSize: 12, color: "rgba(255,255,255,.5)" }}>{config.SITE_NAME || "YCH Ladkrabang Plant"}</div>
        </div>

        {/* Realtime indicator */}
        <div style={{ display: "flex", alignItems: "center", gap: 6, marginLeft: 16 }}>
          <div style={{
            width: 10, height: 10, borderRadius: "50%",
            background: pulse ? "#fbbf24" : "#4ade80",
            boxShadow: `0 0 0 4px ${pulse ? "rgba(251,191,36,.3)" : "rgba(74,222,128,.2)"}`,
            transition: "all .3s",
          }}/>
          <span style={{ fontSize: 11, color: "rgba(255,255,255,.5)", fontWeight: 700 }}>LIVE</span>
        </div>

        <div style={{ marginLeft: "auto" }}><Clock /></div>
      </div>

      {/* ── BODY ── */}
      <div style={{ flex: 1, display: "grid", gridTemplateColumns: "1fr 380px", gap: 0 }}>

        {/* LEFT — Calling + Recent */}
        <div style={{ padding: "20px 20px 20px 24px", borderRight: "1px solid rgba(255,255,255,.06)" }}>

          {/* CALLING */}
          <div style={{
            background: hasCalling
              ? `linear-gradient(135deg,rgba(245,168,0,.15),rgba(245,168,0,.05))`
              : "rgba(255,255,255,.03)",
            border: hasCalling ? `2px solid ${T.gold}` : "1px solid rgba(255,255,255,.08)",
            borderRadius: 20, padding: "20px 24px", marginBottom: 20,
            minHeight: 180, transition: "all .5s",
          }}>
            {hasCalling ? (
              <>
                <div style={{ fontSize: 12, fontWeight: 800, color: T.gold, letterSpacing: 2, marginBottom: 16, textTransform: "uppercase" }}>
                  📢 กำลังเรียก
                </div>
                <div style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
                  {calling.map(q => (
                    <div key={q.id} style={{
                      background: `linear-gradient(135deg,${T.gold},${T.goldDark})`,
                      borderRadius: 16, padding: "20px 28px",
                      textAlign: "center", minWidth: 180,
                      animation: "pulse-gold 2s infinite",
                      boxShadow: "0 8px 32px rgba(245,168,0,.4)",
                    }}>
                      <div style={{ fontSize: 11, color: T.navyDark, fontWeight: 800, marginBottom: 4, opacity: .7 }}>🚛 MON</div>
                      <div style={{ fontSize: 36, fontWeight: 900, color: T.navy, fontFamily: "monospace", letterSpacing: 4 }}>
                        {q.truck_plate || "—"}
                      </div>
                      <div style={{ fontSize: 20, fontWeight: 800, color: T.navy, marginTop: 6 }}>
                        Dock {q.dock_no}
                      </div>
                      <div style={{ fontSize: 12, color: T.navyDark, marginTop: 4, opacity: .75 }}>
                        {q.subcon_name || q.subcon_code || ""} • {String(q.booking_hour || "").slice(0, 5)}
                      </div>
                    </div>
                  ))}
                </div>
              </>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", height: 140, gap: 12 }}>
                <div style={{ fontSize: 48, opacity: .25 }}>🔔</div>
                <div style={{ fontSize: 16, color: "rgba(255,255,255,.3)", fontWeight: 700 }}>Waiting for queue call...</div>
              </div>
            )}
          </div>

          {/* RECENTLY CALLED */}
          <div>
            <div style={{ fontSize: 11, fontWeight: 800, color: "rgba(255,255,255,.4)", letterSpacing: 2, marginBottom: 12, textTransform: "uppercase" }}>
              Recently Called
            </div>
            {recent.length === 0 ? (
              <div style={{ textAlign: "center", color: "rgba(255,255,255,.2)", padding: "24px 0", fontSize: 14 }}>No records yet</div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {recent.map((q, i) => (
                  <div key={q.id} style={{
                    display: "flex", alignItems: "center", gap: 16,
                    padding: "10px 16px", borderRadius: 12,
                    background: i === 0 ? "rgba(255,255,255,.07)" : "rgba(255,255,255,.03)",
                    border: "1px solid rgba(255,255,255,.05)",
                    opacity: 1 - i * 0.1,
                  }}>
                    <div style={{ fontFamily: "monospace", fontSize: 18, fontWeight: 900, letterSpacing: 2, minWidth: 100 }}>
                      {q.truck_plate || "—"}
                    </div>
                    <div style={{ fontSize: 14, color: T.gold, fontWeight: 700, minWidth: 60 }}>Dock {q.dock_no}</div>
                    <div style={{ fontSize: 13, color: "rgba(255,255,255,.5)", flex: 1 }}>{q.subcon_name || q.subcon_code || ""}</div>
                    <div style={{ fontSize: 12, color: "rgba(255,255,255,.4)", fontFamily: "monospace" }}>
                      {q.called_at ? new Date(q.called_at).toLocaleTimeString("th-TH", { hour: "2-digit", minute: "2-digit" }) : "—"}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* RIGHT — Upcoming Queue */}
        <div style={{ padding: "20px 20px 20px 16px" }}>
          <div style={{ fontSize: 11, fontWeight: 800, color: "rgba(255,255,255,.4)", letterSpacing: 2, marginBottom: 16, textTransform: "uppercase" }}>
            Upcoming Queue
          </div>
          {upcoming.length === 0 ? (
            <div style={{ textAlign: "center", color: "rgba(255,255,255,.2)", padding: "40px 0", fontSize: 14 }}>No upcoming bookings</div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {upcoming.map((b, i) => (
                <div key={b.booking_id} style={{
                  display: "flex", alignItems: "center", gap: 12,
                  padding: "10px 14px", borderRadius: 12,
                  background: "rgba(255,255,255,.04)",
                  border: "1px solid rgba(255,255,255,.06)",
                }}>
                  <div style={{
                    width: 28, height: 28, borderRadius: 8,
                    background: T.navy, border: `1px solid ${T.gold}44`,
                    display: "flex", alignItems: "center", justifyContent: "center",
                    fontSize: 11, fontWeight: 900, color: T.gold, flexShrink: 0,
                  }}>{i + 1}</div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontFamily: "monospace", fontSize: 16, fontWeight: 900, letterSpacing: 1 }}>
                      {b.truck_plate || "—"}
                    </div>
                    <div style={{ fontSize: 11, color: "rgba(255,255,255,.4)", marginTop: 2 }}>
                      {b.subcon_name || b.subcon_code || ""}
                    </div>
                  </div>
                  <div style={{ textAlign: "right", flexShrink: 0 }}>
                    <div style={{ fontSize: 15, fontWeight: 800, color: T.gold }}>
                      {String(b.booking_hour || "").slice(0, 5)}
                    </div>
                    <div style={{ fontSize: 11, color: "rgba(255,255,255,.4)" }}>D{b.dock_no}</div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      <style>{`
        @keyframes pulse-gold {
          0%,100% { box-shadow: 0 8px 32px rgba(245,168,0,.4); }
          50%      { box-shadow: 0 8px 48px rgba(245,168,0,.7); }
        }
      `}</style>
    </div>
  );
}
