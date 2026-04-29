import React, { useState } from "react";
import Login from "./apps/Login";
import Launcher, { ROLE_APPS } from "./apps/Launcher";
import OBDApp from "./apps/OBDApp";
import BookingApp from "./apps/BookingApp";
import GateApp from "./apps/GateApp";
import QueueApp from "./apps/QueueApp";
import ManagerApp from "./apps/ManagerApp";
import SupplierApp from "./apps/SupplierApp";
import InboundApp from "./apps/InboundApp";
import AdminApp from "./apps/AdminApp";

export default function App() {
  const [user, setUser] = useState(null);
  const [view, setView] = useState("launcher");

  const handleLogout = () => { setUser(null); setView("launcher"); };
  const handleSelect = (appId) => {
    const allowed = ROLE_APPS[user?.role] || [];
    if (allowed.includes(appId)) setView(appId);
  };
  const back = () => setView("launcher");

  if (!user) return <Login onLogin={u=>{setUser(u);setView("launcher");}}/>;

  return (
    <>
      <style>{`
        @keyframes spin{to{transform:rotate(360deg)}}
        @keyframes pulse{0%,100%{opacity:1}50%{opacity:.6}}
        *{box-sizing:border-box}
        body{margin:0;font-family:'Segoe UI',system-ui,sans-serif}
        button:focus{outline:none}
        input:focus,select:focus,textarea:focus{outline:none}
        code{font-family:monospace;background:#f3f4f6;padding:1px 5px;border-radius:4px;font-size:11px}
      `}</style>
      {view==="launcher" && <Launcher user={user} onSelect={handleSelect} onLogout={handleLogout}/>}
      {view==="obd"      && <OBDApp     user={user} onBack={back}/>}
      {view==="booking"  && <BookingApp user={user} onBack={back}/>}
      {view==="gate"     && <GateApp    user={user} onBack={back}/>}
      {view==="queue"    && <QueueApp   user={user} onBack={back}/>}
      {view==="manager"  && <ManagerApp user={user} onBack={back}/>}
      {view==="supplier" && <SupplierApp user={user} onBack={back}/>}
      {view==="inbound"  && <InboundApp user={user} onBack={back}/>}
      {view==="admin"    && user.role==="admin" && <AdminApp user={user} onBack={back}/>}
    </>
  );
}
