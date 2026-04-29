import React, { useState } from "react";
import { supabase } from "../lib/supabase";
import { Alert } from "../components/UI";
import { T } from "../theme";

export default function Login({ onLogin }) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading]   = useState(false);
  const [error, setError]       = useState("");

  const handleLogin = async (e) => {
    e.preventDefault();
    setLoading(true); setError("");
    try {
      const { data, error: err } = await supabase
        .from("users").select("*")
        .eq("username", username.trim())
        .eq("active", true).single();
      if (err || !data) throw new Error("ไม่พบ username หรือ account ถูกระงับ");
      if (data.password_hash !== password && data.password_hash !== "$2a$10$placeholder")
        throw new Error("Password ไม่ถูกต้อง");
      onLogin(data);
    } catch (e) {
      setError(e.message || "Login failed");
    } finally { setLoading(false); }
  };

  return (
    <div style={{
      minHeight: "100vh",
      display: "flex", flexDirection: "column",
      alignItems: "center", justifyContent: "center",
      background: `linear-gradient(160deg, ${T.navyDark} 0%, ${T.navy} 55%, ${T.navyLight} 100%)`,
      padding: 20,
    }}>
      {/* Decorative gold stripe */}
      <div style={{
        position: "fixed", bottom: 0, left: 0, right: 0, height: 5,
        background: `linear-gradient(90deg, ${T.gold}, ${T.goldLight}, ${T.gold})`,
      }}/>

      {/* Card */}
      <div style={{
        background: T.white,
        borderRadius: 20,
        padding: "36px 32px",
        width: "100%", maxWidth: 400,
        boxShadow: "0 24px 80px rgba(0,0,0,.35)",
        border: `1px solid rgba(255,255,255,.1)`,
      }}>
        {/* Logo area */}
        <div style={{ textAlign: "center", marginBottom: 28 }}>
          <div style={{
            width: 64, height: 64,
            background: T.topbarGrad,
            borderRadius: 18,
            display: "flex", alignItems: "center", justifyContent: "center",
            margin: "0 auto 12px",
            boxShadow: `0 8px 24px rgba(27,58,107,.35)`,
            border: `3px solid ${T.gold}`,
          }}>
            <span style={{ fontSize: 28 }}>🏭</span>
          </div>
          <div style={{
            fontSize: 22, fontWeight: 900, color: T.navy, letterSpacing: -.5,
          }}>
            YCH <span style={{ color: T.gold }}>DMS</span>
          </div>
          <div style={{ fontSize: 12, color: T.textMuted, marginTop: 3 }}>
            Dock Management System
          </div>
          <div style={{
            display: "inline-block", marginTop: 6,
            fontSize: 10, fontWeight: 700,
            color: T.navyLight, letterSpacing: 1,
            textTransform: "uppercase",
          }}>
            where supplychain connects™
          </div>
        </div>

        {error && <Alert type="err" msg={error}/>}

        <form onSubmit={handleLogin}>
          <div style={{ marginBottom: 14 }}>
            <label style={{
              display: "block", fontSize: 12, fontWeight: 700,
              marginBottom: 5, color: T.textSecond,
            }}>Username</label>
            <input
              value={username}
              onChange={e => setUsername(e.target.value)}
              required autoComplete="username"
              style={{
                width: "100%", padding: "11px 14px",
                border: `2px solid ${T.borderDark}`,
                borderRadius: 10, fontSize: 14, outline: "none",
                boxSizing: "border-box", color: T.textPrimary,
                transition: "border-color .15s",
              }}
              onFocus={e => e.target.style.borderColor = T.gold}
              onBlur={e  => e.target.style.borderColor = T.borderDark}
            />
          </div>

          <div style={{ marginBottom: 22 }}>
            <label style={{
              display: "block", fontSize: 12, fontWeight: 700,
              marginBottom: 5, color: T.textSecond,
            }}>Password</label>
            <input
              type="password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              required autoComplete="current-password"
              style={{
                width: "100%", padding: "11px 14px",
                border: `2px solid ${T.borderDark}`,
                borderRadius: 10, fontSize: 14, outline: "none",
                boxSizing: "border-box", color: T.textPrimary,
                transition: "border-color .15s",
              }}
              onFocus={e => e.target.style.borderColor = T.gold}
              onBlur={e  => e.target.style.borderColor = T.borderDark}
            />
          </div>

          <button
            type="submit" disabled={loading}
            style={{
              width: "100%", padding: "12px",
              background: loading ? T.borderDark : T.topbarGrad,
              color: T.white, border: `none`,
              borderRadius: 11, fontWeight: 800, fontSize: 15,
              cursor: loading ? "not-allowed" : "pointer",
              letterSpacing: .3,
              boxShadow: loading ? "none" : `0 4px 16px rgba(27,58,107,.35)`,
              transition: "all .2s",
              position: "relative", overflow: "hidden",
            }}
          >
            {/* Gold bottom border */}
            {!loading && (
              <div style={{
                position: "absolute", bottom: 0, left: 0, right: 0, height: 3,
                background: T.gold, borderRadius: "0 0 11px 11px",
              }}/>
            )}
            {loading ? "กำลังเข้าสู่ระบบ…" : "Sign In"}
          </button>
        </form>

        <p style={{ fontSize: 10, color: T.textMuted, textAlign: "center", marginTop: 20 }}>
          Powered by Supabase + React • YCH Group
        </p>
      </div>
    </div>
  );
}
