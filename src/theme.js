// ─────────────────────────────────────────────
//  YCH Brand Theme  —  "where supplychain connects"
//  Primary: Navy #1B3A6B   Accent: Gold #F5A800
// ─────────────────────────────────────────────

export const T = {
  // ── Brand colours ──────────────────────────
  navy:        "#1B3A6B",
  navyDark:    "#122850",
  navyLight:   "#2A5298",
  gold:        "#F5A800",
  goldDark:    "#D48F00",
  goldLight:   "#FFD04D",
  goldPale:    "#FFF8E1",

  // ── Neutrals ───────────────────────────────
  white:       "#FFFFFF",
  bg:          "#F4F6FB",
  bgCard:      "#FFFFFF",
  border:      "#E2E8F0",
  borderDark:  "#CBD5E1",
  textPrimary: "#0F1F3D",
  textSecond:  "#4A5568",
  textMuted:   "#94A3B8",

  // ── Semantic ───────────────────────────────
  green:       "#16A34A",
  greenBg:     "#DCFCE7",
  red:         "#DC2626",
  redBg:       "#FEE2E2",
  amber:       "#D97706",
  amberBg:     "#FEF3C7",
  blue:        "#1D4ED8",
  blueBg:      "#DBEAFE",
  purple:      "#7C3AED",
  purpleBg:    "#EDE9FE",

  // ── Topbar gradient ────────────────────────
  topbarGrad:  "linear-gradient(135deg, #122850 0%, #1B3A6B 60%, #2A5298 100%)",
  topbarGold:  "linear-gradient(135deg, #D48F00 0%, #F5A800 60%, #FFD04D 100%)",

  // ── Card / shadow ──────────────────────────
  shadow:      "0 4px 24px rgba(27,58,107,.10)",
  shadowSm:    "0 2px 10px rgba(27,58,107,.08)",
  radius:      "14px",
  radiusSm:    "10px",
  radiusXs:    "7px",
};

// ── Status badge colours ────────────────────
export const STATUS_COLORS = {
  RESERVED:        { bg:"#EFF6FF", color:"#1D4ED8", border:"#BFDBFE" },
  ON_YARD:         { bg:"#FEF9C3", color:"#92400E", border:"#FDE68A" },
  CALLED_TO_DOCK:  { bg:"#FFF7ED", color:"#C2410C", border:"#FED7AA" },
  TRUCK_DOCKED:    { bg:"#F5F3FF", color:"#5B21B6", border:"#DDD6FE" },
  LOADING:         { bg:"#EFF6FF", color:"#1E40AF", border:"#BFDBFE" },
  UNLOADING:       { bg:"#EFF6FF", color:"#1E40AF", border:"#BFDBFE" },
  COMPLETED:       { bg:"#F0FDF4", color:"#15803D", border:"#BBF7D0" },
  CANCELLED:       { bg:"#FEF2F2", color:"#B91C1C", border:"#FECACA" },
  AVAILABLE:       { bg:"#F0FDF4", color:"#15803D", border:"#BBF7D0" },
  BOOKED:          { bg:"#FEF9C3", color:"#92400E", border:"#FDE68A" },
  MAINTENANCE:     { bg:"#F9FAFB", color:"#4B5563", border:"#E5E7EB" },
  ACTIVE:          { bg:"#F0FDF4", color:"#15803D", border:"#BBF7D0" },
  INACTIVE:        { bg:"#F9FAFB", color:"#6B7280", border:"#E5E7EB" },
  DEFAULT:         { bg:"#F1F5F9", color:"#475569", border:"#E2E8F0" },
};

// ── Shared button styles ────────────────────
export const BTN = {
  primary: {
    background: T.gold,
    color: T.navy,
    border: "none",
    borderRadius: T.radiusSm,
    fontWeight: 800,
    cursor: "pointer",
    fontSize: 13,
  },
  secondary: {
    background: T.navy,
    color: T.white,
    border: "none",
    borderRadius: T.radiusSm,
    fontWeight: 700,
    cursor: "pointer",
    fontSize: 13,
  },
  ghost: {
    background: T.border,
    color: T.textPrimary,
    border: "none",
    borderRadius: T.radiusXs,
    fontWeight: 700,
    cursor: "pointer",
    fontSize: 12,
  },
  danger: {
    background: T.redBg,
    color: T.red,
    border: `1px solid #FECACA`,
    borderRadius: T.radiusXs,
    fontWeight: 700,
    cursor: "pointer",
    fontSize: 12,
  },
};

// ── Topbar component style ──────────────────
export function topbarStyle(extra = {}) {
  return {
    background: T.topbarGrad,
    color: T.white,
    padding: "13px 18px",
    display: "flex",
    alignItems: "center",
    gap: 10,
    flexWrap: "wrap",
    position: "sticky",
    top: 0,
    zIndex: 40,
    boxShadow: "0 2px 12px rgba(18,40,80,.25)",
    borderBottom: `3px solid ${T.gold}`,
    ...extra,
  };
}

// ── Card style ──────────────────────────────
export function cardStyle(extra = {}) {
  return {
    background: T.bgCard,
    borderRadius: T.radius,
    padding: 18,
    marginBottom: 14,
    boxShadow: T.shadow,
    border: `1px solid ${T.border}`,
    ...extra,
  };
}

// ── Input style ─────────────────────────────
export function inputStyle(extra = {}) {
  return {
    padding: "11px 14px",
    border: `2px solid ${T.borderDark}`,
    borderRadius: T.radiusSm,
    fontSize: 14,
    outline: "none",
    background: T.white,
    color: T.textPrimary,
    width: "100%",
    boxSizing: "border-box",
    transition: "border-color .15s",
    ...extra,
  };
}
