import React, { useState } from "react";
import { supabase } from "../lib/supabase";
import { Alert } from "../components/UI";

export default function Login({ onLogin }) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const handleLogin = async (e) => {
    e.preventDefault();
    setLoading(true); setError("");
    try {
      const { data, error: err } = await supabase
        .from("users").select("*")
        .eq("username", username.trim())
        .eq("active", true).single();
      if (err || !data) throw new Error("ไม่พบ username หรือ password ไม่ถูกต้อง");
      // TODO: เปลี่ยนเป็น bcrypt verify เมื่อ setup Supabase Auth
      if (data.password_hash !== password && data.password_hash !== "$2a$10$placeholder")
        throw new Error("Password ไม่ถูกต้อง");
      onLogin(data);
    } catch (e) {
      setError(e.message || "Login failed");
    } finally { setLoading(false); }
  };

  return (
    <div style={{minHeight:"100vh",display:"flex",alignItems:"center",justifyContent:"center",background:"linear-gradient(135deg,#060d2e,#0a2a6e,#1d4ed8)"}}>
      <div style={{background:"#fff",borderRadius:20,padding:"32px 28px",width:"100%",maxWidth:400,boxShadow:"0 20px 60px rgba(0,0,0,.3)"}}>
        <div style={{fontSize:32,textAlign:"center",marginBottom:8}}>🏭</div>
        <h2 style={{fontSize:22,fontWeight:900,color:"#0a2a6e",textAlign:"center",marginBottom:4}}>DMS</h2>
        <p style={{fontSize:12,color:"#6b7280",textAlign:"center",marginBottom:24}}>Dock Management System</p>
        {error && <Alert type="err" msg={error}/>}
        <form onSubmit={handleLogin}>
          <div style={{marginBottom:12}}>
            <label style={{display:"block",fontSize:12,fontWeight:700,marginBottom:5,color:"#374151"}}>Username</label>
            <input value={username} onChange={e=>setUsername(e.target.value)} required autoComplete="username"
              style={{width:"100%",padding:"10px 12px",border:"1.5px solid #e5e7eb",borderRadius:10,fontSize:13,outline:"none",boxSizing:"border-box"}}/>
          </div>
          <div style={{marginBottom:16}}>
            <label style={{display:"block",fontSize:12,fontWeight:700,marginBottom:5,color:"#374151"}}>Password</label>
            <input type="password" value={password} onChange={e=>setPassword(e.target.value)} required autoComplete="current-password"
              style={{width:"100%",padding:"10px 12px",border:"1.5px solid #e5e7eb",borderRadius:10,fontSize:13,outline:"none",boxSizing:"border-box"}}/>
          </div>
          <button type="submit" disabled={loading}
            style={{width:"100%",padding:"10px",background:"#0f4bd7",color:"#fff",border:"none",borderRadius:10,fontWeight:700,fontSize:14,cursor:"pointer",opacity:loading?.6:1}}>
            {loading ? "กำลังเข้าสู่ระบบ…" : "Sign In"}
          </button>
        </form>
        <p style={{fontSize:10,color:"#9ca3af",textAlign:"center",marginTop:16}}>Powered by Supabase + React</p>
      </div>
    </div>
  );
}
