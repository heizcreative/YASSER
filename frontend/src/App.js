import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import "@/App.css";
import { format } from "date-fns";
import { toZonedTime, formatInTimeZone } from "date-fns-tz";
import { Calculator, ClipboardCheck, Check, Volume2, VolumeX } from "lucide-react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

const TIMEZONE = "America/New_York";
const MINUTE_IN_MS = 60 * 1000;
const FONT_LOAD_FALLBACK_MS = 1200;
// FLOW RUNNER tuning values: time is in seconds, movement in px/sec unless noted.
const FLOW_RUNNER = {
  maxFrameDelta: 0.033,
  gravity: 2300,
  jumpVelocity: 760,
  jumpHoldForce: 1300,
  jumpHoldMax: 0.16,
  vaultVelocity: 920,
  slideDuration: 0.52,
  vaultDuration: 0.48,
  dashDuration: 0.22,
  dashBoost: 1.55,
  baseSpeed: 350,
  speedRamp: 22,
  flowSpeedFactor: 0.18,
  baseSpawnInterval: 1.25,
  minSpawnInterval: 0.62,
  spawnAcceleration: 0.013,
  flowDecayPerSecond: 5.4,
  scoreDistanceFactor: 0.08,
  scoreFlowFactor: 0.23,
  scoreObstacleBonus: 48,
  deathSlowMoDuration: 0.4,
  deathZoomMax: 1.05
};

// Symbol configuration
const SYMBOLS = {
  NQ: { name: "NQ", valuePerPoint: 20, unit: "points" },
  ES: { name: "ES", valuePerPoint: 50, unit: "points" },
  MNQ: { name: "MNQ", valuePerPoint: 2, unit: "points" },
  MES: { name: "MES", valuePerPoint: 5, unit: "points" },
  "MGC1!": { name: "MGC1!", valuePerPoint: 10, unit: "price" },
  BTCUSD: { name: "BTCUSD", valuePerPoint: 1, unit: "usd" }
};

// Market sessions (all times in ET) - arranged for 2x2 grid
// Row 1: Asia Range, London Killzone
// Row 2: NY Killzone, Post Trade
const SESSIONS = [
  { name: "Asia Range", start: 20, end: 24, timeLabel: "8 PM–12 AM" },
  { name: "London Killzone", start: 2, end: 5, timeLabel: "2 AM–5 AM" },
  { name: "NY Killzone", start: 9.5, end: 11, timeLabel: "9:30 AM–11 AM" },
  { name: "Post Trade", start: 11, end: 20, timeLabel: "11 AM–8 PM" }
];

// Checklist sessions with colors
const CHECKLIST_SESSIONS = {
  lock: { id: "lock", name: "Lock", color: "#FF4D6D", startHour: 20, endHour: 8.5 },
  pre: { id: "pre", name: "Pre", color: "#3D78FF", startHour: 8.5, endHour: 9.5 },
  kz: { id: "kz", name: "KZ", color: "#28E6A5", startHour: 9.5, endHour: 11 },
  post: { id: "post", name: "Post", color: "#FFD34D", startHour: 11, endHour: 20 }
};

// Checklist items for each session
const CHECKLIST_ITEMS = {
  lock: {
    title: "NO-TRADE LOCK (POST-KILLZONE)",
    items: [{ id: "lock-1", text: "Trading locked", num: 1 }]
  },
  pre: {
    title: "NY PRE-MARKET (ICT BIAS)",
    items: [
      { id: "pre-1", text: "HTF expansion", num: 1 },
      { id: "pre-2", text: "Key level hit", num: 2 },
      { id: "pre-3", text: "HOD/LOD context", num: 3 },
      { id: "pre-4", text: "Reversal formation", num: 4 },
      { id: "pre-5", text: "Model present (IRL / ERL / HRLR)", num: 5 },
      { id: "pre-6", text: "Targets clear", num: 6 }
    ]
  },
  kz: {
    title: "NY KILLZONE TRADING",
    subtitle: "9:30 AM → 11:00 AM",
    items: [
      { id: "kz-1", text: "Sweep done", num: 1 },
      { id: "kz-2", text: "Reaction/displacement", num: 2 },
      { id: "kz-3", text: "LTF entry (TTFM)", num: 3 },
      { id: "kz-4", text: "Expansion candles", num: 4 }
    ]
  },
  post: {
    title: "ICT POST-TRADE REVIEW",
    items: [
      { id: "post-1", text: "Rules followed", num: 1 },
      { id: "post-2", text: "Valid entry", num: 2 },
      { id: "post-3", text: "No emotions", num: 3 },
      { id: "post-4", text: "Journal done", num: 4 }
    ]
  }
};

// LocalStorage keys
const STORAGE_KEYS = {
  SYMBOL: "crtv_symbol",
  CALCULATOR: "crtv_calculator",
  CHECKLIST: "crtv_checklist"
};

const DEFAULT_SYMBOL = "MNQ";

const getSafeStoredObject = (storageKey, fallback = {}) => {
  const saved = localStorage.getItem(storageKey);
  if (!saved) return fallback;

  try {
    const parsed = JSON.parse(saved);
    return parsed && typeof parsed === "object" ? parsed : fallback;
  } catch {
    return fallback;
  }
};

const getSafeSymbol = (value) => (typeof value === "string" && SYMBOLS[value] ? value : DEFAULT_SYMBOL);

// Helper functions
const getETTime = () => toZonedTime(new Date(), TIMEZONE);
const formatETTime = () => formatInTimeZone(new Date(), TIMEZONE, "HH:mm");
const getETDateKey = () => formatInTimeZone(new Date(), TIMEZONE, "yyyy-MM-dd");

// Weekend market closure: Friday 5PM ET → Sunday 6PM ET
const isMarketClosed = (etDate) => {
  const day = etDate.getDay();
  const hour = etDate.getHours();
  const minute = etDate.getMinutes();
  const timeDecimal = hour + minute / 60;

  // Friday 5PM onwards
  if (day === 5 && timeDecimal >= 17) return true;
  // All day Saturday
  if (day === 6) return true;
  // Sunday before 6PM
  if (day === 0 && timeDecimal < 18) return true;
  
  return false;
};

// Check if a day is valid for a session
// Asia Range: Sun-Thu evenings (8PM-12AM) - NOT Friday night
// London/NY/Post: Mon-Fri only
const isValidSessionDay = (sessionName, dayOfWeek) => {
  if (sessionName === "Asia Range") {
    // Asia runs Sun, Mon, Tue, Wed, Thu evenings (0, 1, 2, 3, 4)
    // NOT Friday (5) or Saturday (6)
    return dayOfWeek >= 0 && dayOfWeek <= 4;
  } else {
    // London, NY, Post Trade: Monday (1) through Friday (5)
    return dayOfWeek >= 1 && dayOfWeek <= 5;
  }
};

// Create an ET date for a specific day offset and time
const createETDate = (baseDate, dayOffset, hour, minute = 0) => {
  const result = new Date(baseDate);
  result.setDate(result.getDate() + dayOffset);
  result.setHours(hour, minute, 0, 0);
  return result;
};

// Get the next market open time (Sunday 6PM ET)
const getNextMarketOpen = (now) => {
  const day = now.getDay();
  const hour = now.getHours();
  const minute = now.getMinutes();
  const timeDecimal = hour + minute / 60;
  
  let daysToAdd = 0;
  
  if (day === 5 && timeDecimal >= 17) {
    // Friday after 5PM -> Sunday
    daysToAdd = 2;
  } else if (day === 6) {
    // Saturday -> Sunday
    daysToAdd = 1;
  } else if (day === 0 && timeDecimal < 18) {
    // Sunday before 6PM -> same day at 6PM
    daysToAdd = 0;
  }
  
  return createETDate(now, daysToAdd, 18, 0);
};

// Get session times in hours
const getSessionTimes = (session) => {
  const startHour = Math.floor(session.start);
  const startMin = Math.round((session.start % 1) * 60);
  const endHour = session.end === 24 ? 0 : Math.floor(session.end);
  const endMin = session.end === 24 ? 0 : Math.round((session.end % 1) * 60);
  return { startHour, startMin, endHour, endMin };
};

// Main function: Get live session status with proper calendar logic
const getLiveSessionStatus = (session, now) => {
  const day = now.getDay();
  const hour = now.getHours();
  const minute = now.getMinutes();
  const timeDecimal = hour + minute / 60;
  
  const { startHour, startMin, endHour, endMin } = getSessionTimes(session);
  const startDecimal = startHour + startMin / 60;
  const endDecimal = session.end === 24 ? 24 : endHour + endMin / 60;
  
  const marketClosed = isMarketClosed(now);
  const validDay = isValidSessionDay(session.name, day);
  
  // Determine if session is currently OPEN
  let isOpen = false;
  
  if (!marketClosed && validDay) {
    if (session.name === "Asia Range") {
      // Asia: 8PM-12AM (20:00-24:00)
      isOpen = timeDecimal >= startDecimal && timeDecimal < 24;
    } else if (session.end > session.start) {
      // Normal session within same day
      isOpen = timeDecimal >= startDecimal && timeDecimal < endDecimal;
    }
  }
  
  // Special case: Friday Post Trade closes at 5PM, not 8PM
  if (session.name === "Post Trade" && day === 5 && timeDecimal >= 17) {
    isOpen = false;
  }
  
  // Calculate next open or close time
  let targetTime;
  let secondsRemaining;
  
  if (isOpen) {
    // Calculate time until close
    if (session.name === "Post Trade" && day === 5) {
      // Friday: Post Trade closes at 5PM
      targetTime = createETDate(now, 0, 17, 0);
    } else if (session.name === "Asia Range") {
      // Asia closes at midnight (next day 0:00)
      targetTime = createETDate(now, 1, 0, 0);
    } else {
      // Normal close time
      targetTime = createETDate(now, 0, endHour, endMin);
    }
    secondsRemaining = Math.max(0, Math.floor((targetTime - now) / 1000));
  } else {
    // Calculate time until next open
    targetTime = getNextSessionOpen(session, now);
    secondsRemaining = Math.max(0, Math.floor((targetTime - now) / 1000));
  }
  
  // Format countdown (days+hours OR hours+minutes)
  const label = formatCountdown(secondsRemaining, isOpen);
  
  return {
    isOpen,
    secondsRemaining,
    label
  };
};

// Find the next valid open time for a session
const getNextSessionOpen = (session, now) => {
  const day = now.getDay();
  const hour = now.getHours();
  const minute = now.getMinutes();
  const timeDecimal = hour + minute / 60;
  
  const { startHour, startMin } = getSessionTimes(session);
  const startDecimal = startHour + startMin / 60;
  
  // Check if market is in weekend closure (Fri 5PM - Sun 6PM)
  const marketClosed = isMarketClosed(now);
  
  if (session.name === "Asia Range") {
    // Asia Range: Opens Sun-Thu at 8PM
    // Valid days: 0 (Sun), 1 (Mon), 2 (Tue), 3 (Wed), 4 (Thu)
    
    if (marketClosed) {
      // During weekend, next open is Sunday 8PM (but only if after market reopens at 6PM)
      const marketOpen = getNextMarketOpen(now);
      const sundayAsiaOpen = createETDate(now, 0, 20, 0);
      
      // If it's Sunday
      if (day === 0) {
        if (timeDecimal < 18) {
          // Before market opens - Asia opens at 8PM same day
          return createETDate(now, 0, 20, 0);
        } else if (timeDecimal < 20) {
          // Market open but before Asia - opens at 8PM
          return createETDate(now, 0, 20, 0);
        }
      }
      
      // Friday or Saturday - next is Sunday 8PM
      let daysToSunday = (7 - day) % 7;
      if (daysToSunday === 0 && timeDecimal >= 20) daysToSunday = 7;
      return createETDate(now, daysToSunday, 20, 0);
    }
    
    // Not weekend - find next valid evening
    if (timeDecimal < startDecimal && isValidSessionDay(session.name, day)) {
      // Today before 8PM and valid day
      return createETDate(now, 0, startHour, startMin);
    }
    
    // Find next valid day
    for (let i = 1; i <= 7; i++) {
      const nextDay = (day + i) % 7;
      if (isValidSessionDay(session.name, nextDay)) {
        const candidate = createETDate(now, i, startHour, startMin);
        if (!isMarketClosed(candidate)) {
          return candidate;
        }
      }
    }
  } else {
    // London, NY, Post Trade: Opens Mon-Fri
    
    if (marketClosed) {
      // During weekend, find next Monday
      let daysToMonday;
      if (day === 5) {
        daysToMonday = 3; // Fri -> Mon
      } else if (day === 6) {
        daysToMonday = 2; // Sat -> Mon
      } else if (day === 0) {
        daysToMonday = 1; // Sun -> Mon
      } else {
        daysToMonday = (8 - day) % 7;
      }
      return createETDate(now, daysToMonday, startHour, startMin);
    }
    
    // Check if can open today
    if (timeDecimal < startDecimal && isValidSessionDay(session.name, day)) {
      // Today before session start
      return createETDate(now, 0, startHour, startMin);
    }
    
    // Find next valid day
    for (let i = 1; i <= 7; i++) {
      const nextDay = (day + i) % 7;
      if (isValidSessionDay(session.name, nextDay)) {
        const candidate = createETDate(now, i, startHour, startMin);
        if (!isMarketClosed(candidate)) {
          return candidate;
        }
      }
    }
  }
  
  // Fallback (shouldn't reach here)
  return createETDate(now, 1, startHour, startMin);
};

// Format countdown: Xd Yh (if ≥24h) or Xh Ym (if <24h)
const formatCountdown = (totalSeconds, isClosing) => {
  const totalMinutes = Math.floor(totalSeconds / 60);
  const totalHours = Math.floor(totalMinutes / 60);
  const days = Math.floor(totalHours / 24);
  const hours = totalHours % 24;
  const minutes = totalMinutes % 60;
  
  const prefix = isClosing ? "Closes in" : "Opens in";
  
  if (days > 0) {
    // Show days + hours only
    return `${prefix} ${days}d ${hours}h`;
  } else {
    // Show hours + minutes only
    return `${prefix} ${hours}h ${minutes}m`;
  }
};

// Legacy weekend check for checklist (uses different timing)
const isWeekend = () => {
  const now = getETTime();
  const day = now.getDay();
  const hour = now.getHours();
  const minute = now.getMinutes();
  const currentTime = hour + minute / 60;

  // Friday 5PM onwards
  if (day === 5 && currentTime >= 17) return true;
  // All day Saturday
  if (day === 6) return true;
  // Sunday until 6PM (market reopen)
  if (day === 0 && currentTime < 18) return true;
  return false;
};

const getCurrentChecklistSession = () => {
  const now = getETTime();
  const hour = now.getHours();
  const minute = now.getMinutes();
  const currentTime = hour + minute / 60;

  // Lock: 8PM (20) to 8:30AM (8.5) - spans midnight
  if (currentTime >= 20 || currentTime < 8.5) return "lock";
  // Pre: 8:30AM to 9:30AM
  if (currentTime >= 8.5 && currentTime < 9.5) return "pre";
  // KZ: 9:30AM to 11AM
  if (currentTime >= 9.5 && currentTime < 11) return "kz";
  // Post: 11AM to 8PM
  if (currentTime >= 11 && currentTime < 20) return "post";
  
  return "lock";
};

const getMillisecondsToNextMinute = () => {
  const now = getETTime();
  return (60 - now.getSeconds()) * 1000 - now.getMilliseconds();
};

const formatTimeSimple = (hour) => {
  const h = Math.floor(hour);
  const m = Math.round((hour - h) * 60);
  const ampm = h >= 12 && h < 24 ? " PM" : " AM";
  const displayHour = h === 0 ? 12 : h > 12 ? h - 12 : h;
  return m > 0 ? `${displayHour}:${m.toString().padStart(2, "0")}${ampm}` : `${displayHour}${ampm}`;
};

// Components
const GlassPanel = ({ children, className = "" }) => (
  <div className={`glass-panel p-4 ${className}`}>{children}</div>
);

const GlassCard = ({ children, className = "" }) => (
  <div className={`glass-card p-3 ${className}`}>{children}</div>
);

// Compact Session Card for 2x2 Grid
const SessionGridCard = ({ session, now }) => {
  const status = getLiveSessionStatus(session, now);
  
  return (
    <div 
      className={`glass-card p-3 flex flex-col gap-1.5 transition-all duration-300 ${
        status.isOpen ? 'session-card-open' : ''
      }`}
      style={{
        boxShadow: status.isOpen ? '0 0 20px rgba(40, 230, 165, 0.12), inset 0 1px 0 rgba(255,255,255,0.03)' : undefined
      }}
    >
      {/* Top row: Name + Status */}
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium text-white/90 truncate">{session.name}</span>
        <div className={`px-2 py-0.5 rounded-full text-[10px] font-semibold ${
          status.isOpen 
            ? "bg-crtv-success/15 text-crtv-success" 
            : "bg-crtv-loss/15 text-crtv-loss"
        }`}>    
          {status.isOpen ? "OPEN" : "CLOSED"}
        </div>
      </div>
      
      {/* Time range */}
      <span className="text-[10px] text-white/40 font-mono">{session.timeLabel}</span>
      
      {/* Countdown */}
      <span className={`text-[10px] font-mono ${status.isOpen ? 'text-crtv-success/80' : 'text-white/50'}`}>  
        {status.label}
      </span>
    </div>
  );
};


const MarketSessions = ({ currentTime, isWeekendMode }) => {
  const [now, setNow] = useState(getETTime());
  
  // Update every second for live countdown
  useEffect(() => {
    const interval = setInterval(() => {
      setNow(getETTime());
    }, 1000); // Update every second
    return () => clearInterval(interval);
  }, []);

  return (
    <GlassPanel className="mb-4 py-3 px-3" data-testid="market-sessions-card">
      {/* Clock pill */}
      <div className="flex justify-center mb-3">
        <div className="px-5 py-1.5 glass-card rounded-full flex items-center gap-2">
          <span className="text-sm font-mono text-white/90" data-testid="current-time">ET {currentTime}</span>
          {isWeekendMode && (
            <span className="px-2 py-0.5 bg-crtv-warning/20 text-crtv-warning text-[10px] font-mono rounded-full">Weekend</span>
          )}
        </div>
      </div>
      
      {/* 2x2 Grid */}
      <div className="grid grid-cols-2 gap-2">
        {SESSIONS.map((session) => (
          <SessionGridCard 
            key={session.name} 
            session={session} 
            now={now}
          />
        ))}
      </div>
    </GlassPanel>
  );
};

// Calculator Tab Component
const CalculatorTab = ({ symbol, onSymbolChange }) => {
  const [risk, setRisk] = useState(() => {
    const saved = getSafeStoredObject(STORAGE_KEYS.CALCULATOR);
    return saved.risk || "";
  });
  const [stop, setStop] = useState(() => {
    const saved = getSafeStoredObject(STORAGE_KEYS.CALCULATOR);
    return saved.stop || "";
  });
  const [tp, setTp] = useState(() => {
    const saved = getSafeStoredObject(STORAGE_KEYS.CALCULATOR);
    return saved.tp || "";
  });

  useEffect(() => {
    localStorage.setItem(STORAGE_KEYS.CALCULATOR, JSON.stringify({ risk, stop, tp }));
  }, [risk, stop, tp]);

  const calculation = useMemo(() => {
    const riskNum = parseFloat(risk) || 0;
    const stopNum = parseFloat(stop) || 0;
    const tpNum = parseFloat(tp) || 0;
    const symbolData = SYMBOLS[symbol] || SYMBOLS[DEFAULT_SYMBOL];

    if (riskNum <= 0 || stopNum <= 0) {
      return { contracts: 0, totalRisk: 0, profit: 0, isBTC: symbol === "BTCUSD" };
    }

    if (symbol === "BTCUSD") {
      const rawSize = riskNum / stopNum;
      const size = Math.floor(rawSize * 10) / 10;
      const totalRisk = size * stopNum;
      const profit = size * tpNum;
      return { contracts: size, totalRisk, profit, isBTC: true };
    } else {
      let contracts = Math.floor(riskNum / (stopNum * symbolData.valuePerPoint));
      contracts = Math.min(contracts, 40);
      const totalRisk = contracts * stopNum * symbolData.valuePerPoint;
      const profit = contracts * tpNum * symbolData.valuePerPoint;
      return { contracts, totalRisk, profit, isBTC: false };
    }
  }, [risk, stop, tp, symbol]);

  const getRiskTier = (totalRisk) => {
    if (totalRisk < 50) return { dotColor: "bg-white/40", label: "Very low risk (0-50)." };
    if (totalRisk <= 500) return { dotColor: "bg-crtv-success", label: "Risk OK (50-500)." };
    if (totalRisk <= 1500) return { dotColor: "bg-crtv-warning", label: "High risk (500-1500)." };
    return { dotColor: "bg-crtv-loss", label: "Too much risk (1500+)." };
  };

  const riskTier = getRiskTier(calculation.totalRisk);
  const symbolData = SYMBOLS[symbol] || SYMBOLS[DEFAULT_SYMBOL];
  const unitLabel = symbol === "BTCUSD" ? "USD" : symbolData.unit === "points" ? "pts" : "price";

  const handleReset = () => {
    setRisk("");
    setStop("");
    setTp("");
  };

  return (
    <div className="space-y-3" data-testid="calculator-tab">
      <GlassPanel className="py-3">
        <div className="space-y-3">
          {/* Symbol Selector - Centered at top */}
          <div
            className="relative z-20 isolate flex justify-center mb-1 overflow-visible"
            style={{ WebkitTextSizeAdjust: "100%" }}
          >
            <Select value={symbol} onValueChange={onSymbolChange}>
              <SelectTrigger 
                className="h-9 w-auto px-4 rounded-full border border-white/10 bg-black/70 backdrop-blur-md text-white/90 text-base sm:text-sm font-mono shadow-sm"
                data-testid="symbol-selector"
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent
                position="popper"
                sideOffset={8}
                side="bottom"
                align="center"
                className="z-[100] fixed border border-white/10 bg-black/70 text-white/90 backdrop-blur-md shadow-lg"
              >
                {Object.keys(SYMBOLS).map((sym) => (
                  <SelectItem 
                    key={sym} 
                    value={sym}
                    className="text-white/90 focus:bg-white/10 focus:text-white"
                  >
                    {sym} • ${SYMBOLS[sym].valuePerPoint}/{SYMBOLS[sym].unit === "points" ? "pt" : "1.0"}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          
          {/* Risk Input */}
          <div>
            <label className="text-xs text-white/50 uppercase tracking-wider mb-1.5 block">Risk ($)</label>
            <input
              type="number"
              value={risk}
              onChange={(e) => setRisk(e.target.value)}
              className="w-full h-11 glass-input px-4 text-white font-mono text-lg focus:outline-none"
              data-testid="risk-input"
            />
          </div>
          
          {/* Stop & Take Profit */}
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="text-xs text-white/50 uppercase tracking-wider mb-1.5 block">Stop ({unitLabel})</label>
              <input
                type="number"
                value={stop}
                onChange={(e) => setStop(e.target.value)}
                className="w-full h-11 glass-input px-4 text-white font-mono text-lg focus:outline-none"
                data-testid="stop-input"
              />
            </div>
            <div>
              <label className="text-xs text-white/50 uppercase tracking-wider mb-1.5 block">Take Profit ({unitLabel})</label>
              <input
                type="number"
                value={tp}
                onChange={(e) => setTp(e.target.value)}
                className="w-full h-11 glass-input px-4 text-white font-mono text-lg focus:outline-none"
                data-testid="tp-input"
              />
            </div>
          </div>
        </div>
      </GlassPanel>

      <GlassPanel className="py-3">
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-xs text-white/50 uppercase tracking-wider">
              {calculation.isBTC ? "BTC Size" : "Contracts"}
            </span>
            <span className="text-3xl font-mono font-bold text-white" data-testid="contracts-output">
              {calculation.isBTC ? calculation.contracts.toFixed(1) : calculation.contracts}
            </span>
          </div>
          <div className="h-px bg-white/5" />
          <div className="flex items-center justify-between">
            <span className="text-xs text-white/50 uppercase tracking-wider">Total Risk</span>
            <span className="text-xl font-mono font-semibold text-crtv-loss" data-testid="total-risk-output">
              ${calculation.totalRisk.toFixed(2)}
            </span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-xs text-white/50 uppercase tracking-wider">TP Profit</span>
            <span className="text-xl font-mono font-semibold text-crtv-success" data-testid="profit-output">
              ${calculation.profit.toFixed(2)}
            </span>
          </div>
          <div className="h-px bg-white/5" />
          <div className="glass-card px-3 py-2.5 flex items-center gap-3">
            <div className={`w-3.5 h-3.5 rounded-full ${riskTier.dotColor}`} />
            <span className="text-xs font-mono text-white/90" data-testid="risk-tier">{riskTier.label}</span>
          </div>
        </div>
      </GlassPanel>

      <div className="flex justify-end mt-2">
        <button
          onClick={handleReset}
          className="glass-button px-4 py-2 text-xs font-mono text-white/60 hover:text-white"
          data-testid="reset-button"
        >
          Reset Inputs
        </button>
      </div>
    </div>
  );
};

// Checklist Item Component
const ChecklistItem = ({ item, checked, onToggle, sessionColor }) => {
  return (
    <div 
      className={`flex items-center justify-between py-4 px-4 glass-card cursor-pointer transition-all duration-200 ${checked ? 'opacity-70' : ''}`}
      onClick={onToggle}
      data-testid={`checklist-item-${item.id}`}
    >
      <div className="flex items-center gap-3">
        <div 
          className={`w-6 h-6 rounded-lg border-2 flex items-center justify-center transition-all duration-200 ${
            checked 
              ? `border-transparent bg-opacity-20`
              : 'border-white/20 bg-transparent'
          }`}
          style={{ 
            backgroundColor: checked ? `${sessionColor}30` : 'transparent',
            boxShadow: checked ? `0 0 15px ${sessionColor}40` : 'none'
          }}
        >
          {checked && <Check className="w-4 h-4" style={{ color: sessionColor }} />}
        </div>
        <span className={`text-sm text-white/90 transition-all duration-200 ${checked ? 'line-through text-white/50' : ''}`}>{item.text}</span>
      </div>
      <span className="text-xs font-mono text-white/30">{item.num}</span>
    </div>
  );
};

// Weekend Review Component
const WeekendReview = () => (
  <GlassPanel className="mt-4">
    <div className="text-center mb-6">
      <h2 className="text-xl font-heading font-semibold text-white/90 mb-2">Weekend Review</h2>
      <p className="text-sm text-white/50">Plan + improve for next week</p>
    </div>
    <div className="space-y-4">
      <div className="glass-card p-4">
        <div className="flex items-start gap-3">
          <div className="w-2 h-2 rounded-full bg-crtv-success mt-2" />
          <div>
            <p className="text-sm text-white/90">1 best trade + why it worked</p>
          </div>
        </div>
      </div>
      <div className="glass-card p-4">
        <div className="flex items-start gap-3">
          <div className="w-2 h-2 rounded-full bg-crtv-loss mt-2" />
          <div>
            <p className="text-sm text-white/90">1 biggest mistake + fix rule</p>
          </div>
        </div>
      </div>
      <div className="glass-card p-4">
        <div className="flex items-start gap-3">
          <div className="w-2 h-2 rounded-full bg-crtv-blue mt-2" />
          <div>
            <p className="text-sm text-white/90">Backtest goal (20 charts)</p>
          </div>
        </div>
      </div>
    </div>
  </GlassPanel>
);

// Checklist Tab Component
const ChecklistTab = ({ currentTime, isWeekendMode }) => {
  const [activeSession, setActiveSession] = useState(() => getCurrentChecklistSession());
  const [checkedItems, setCheckedItems] = useState(() => {
    const data = getSafeStoredObject(STORAGE_KEYS.CHECKLIST);
    const todayKey = getETDateKey();
    if (data.dateKey === todayKey) {
      return data.items || {};
    }
    return {};
  });
  const lastResetRef = useRef(null);
  const lastAutoSessionRef = useRef(getCurrentChecklistSession());

  // Reset logic at 8PM - but don't auto-switch tabs
  useEffect(() => {
    const checkReset = () => {
      const now = getETTime();
      const hour = now.getHours();
      const minute = now.getMinutes();
      
      // Check for reset at 8PM (20:00)
      if (hour === 20 && minute === 0) {
        const resetKey = `${getETDateKey()}-20`;
        if (lastResetRef.current !== resetKey) {
          lastResetRef.current = resetKey;
          setCheckedItems({});
          localStorage.setItem(STORAGE_KEYS.CHECKLIST, JSON.stringify({
            dateKey: getETDateKey(),
            items: {}
          }));
        }
      }
    };

    checkReset();
    const interval = setInterval(checkReset, 1000);
    return () => clearInterval(interval);
  }, []);

  // Save to localStorage
  useEffect(() => {
    localStorage.setItem(STORAGE_KEYS.CHECKLIST, JSON.stringify({
      dateKey: getETDateKey(),
      items: checkedItems
    }));
  }, [checkedItems]);

  // Live minute-aligned auto-session switching (ET): Lock → Pre → KZ → Post.
  // Manual tab clicks stay fully usable until the next actual session boundary.
  useEffect(() => {
    if (isWeekendMode) return;

    const syncSession = () => {
      const liveSession = getCurrentChecklistSession();
      if (lastAutoSessionRef.current !== liveSession) {
        lastAutoSessionRef.current = liveSession;
        setActiveSession(liveSession);
      }
    };

    let cleanupInterval = null;
    syncSession();
    const alignTimeout = setTimeout(() => {
      syncSession();
      const minuteInterval = setInterval(syncSession, MINUTE_IN_MS);
      cleanupInterval = () => clearInterval(minuteInterval);
    }, getMillisecondsToNextMinute());

    return () => {
      clearTimeout(alignTimeout);
      if (cleanupInterval) cleanupInterval();
    };
  }, [isWeekendMode]);

  const toggleItem = useCallback((itemId) => {
    setCheckedItems(prev => ({
      ...prev,
      [itemId]: !prev[itemId]
    }));
  }, []);

  const getSessionProgress = (sessionId) => {
    const items = CHECKLIST_ITEMS[sessionId].items;
    const checked = items.filter(item => checkedItems[item.id]).length;
    return { checked, total: items.length };
  };

  if (isWeekendMode) {
    return (
      <div data-testid="checklist-tab">
        {/* Clock pill only */}
        <div className="flex justify-center mb-6">
          <div className="px-6 py-2 glass-card rounded-full flex items-center gap-2">
            <span className="text-lg font-mono text-white/90" data-testid="current-time">ET {currentTime}</span>
            <span className="px-2 py-0.5 bg-crtv-warning/20 text-crtv-warning text-xs font-mono rounded-full">Weekend</span>
          </div>
        </div>
        <WeekendReview />
      </div>
    );
  }

  return (
    <div data-testid="checklist-tab">
      {/* Clock pill only */}
      <div className="flex justify-center mb-6">
        <div className="px-6 py-2 glass-card rounded-full">
          <span className="text-lg font-mono text-white/90" data-testid="current-time">ET {currentTime}</span>
        </div>
      </div>

      {/* Session Tabs */}
      <div className="grid grid-cols-4 gap-2 mb-4">
        {Object.values(CHECKLIST_SESSIONS).map((session) => {
          const progress = getSessionProgress(session.id);
          const isActive = activeSession === session.id;
          return (
            <button
              key={session.id}
              onClick={() => setActiveSession(session.id)}
              className={`glass-card py-3 px-2 flex flex-col items-center gap-1.5 transition-all duration-200 ${
                isActive ? 'ring-1 ring-white/20' : ''
              }`}
              style={{
                boxShadow: isActive ? `0 0 20px ${session.color}20` : 'none'
              }}
              data-testid={`session-tab-${session.id}`}
            >
              <div 
                className="w-2.5 h-2.5 rounded-full"
                style={{ backgroundColor: session.color }}
              />
              <span className="text-xs font-medium text-white/80">{session.name}</span>
              <span 
                className="text-[10px] font-mono px-2 py-0.5 rounded-full"
                style={{ 
                  backgroundColor: `${session.color}15`,
                  color: session.color
                }}
              >
                {progress.checked}/{progress.total}
              </span>
            </button>
          );
        })}
      </div>

      {/* Active Checklist */}
      <div
        key={activeSession}
        className="animate-in fade-in zoom-in-95 duration-300 ease-in-out transform-gpu"
      >
        <GlassPanel>
          <div className="mb-4">
            <h3 className="text-sm font-heading font-semibold text-white/90 uppercase tracking-wider">
              {CHECKLIST_ITEMS[activeSession].title}
            </h3>
            {CHECKLIST_ITEMS[activeSession].subtitle && (
              <p className="text-xs text-white/50 font-mono mt-1">
                {CHECKLIST_ITEMS[activeSession].subtitle}
              </p>
            )}
          </div>
          <div className="space-y-3">
            {CHECKLIST_ITEMS[activeSession].items.map((item) => (
              <ChecklistItem
                key={item.id}
                item={item}
                checked={!!checkedItems[item.id]}
                onToggle={() => toggleItem(item.id)}
                sessionColor={CHECKLIST_SESSIONS[activeSession].color}
              />
            ))}
          </div>
        </GlassPanel>
      </div>
    </div>
  );
};

const RunModeIcon = ({ active }) => (
  <div
    className={`w-7 h-7 rounded-[10px] border border-white/15 bg-[#121212] backdrop-blur-xl flex items-center justify-center transition-all ${
      active ? "shadow-[0_0_16px_rgba(61,120,255,0.22)]" : ""
    }`}
  >
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden="true">
      <rect x="2.8" y="3.4" width="12.4" height="11.2" rx="2" stroke="white" strokeOpacity="0.88" strokeWidth="1.1" />
      <path d="M5.4 7.1L7.25 8.95L5.4 10.8" stroke="white" strokeOpacity="0.9" strokeWidth="1.1" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M9 11H12.55" stroke="white" strokeOpacity="0.9" strokeWidth="1.1" strokeLinecap="round" />
      <circle cx="5.2" cy="5.4" r="0.45" fill="white" fillOpacity="0.7" />
      <circle cx="6.8" cy="5.4" r="0.45" fill="white" fillOpacity="0.55" />
    </svg>
  </div>
);

const RunModeTab = () => {
  const [screen, setScreen] = useState("idle");
  const [score, setScore] = useState(0);
  const [finalScore, setFinalScore] = useState(0);
  const [flow, setFlow] = useState(0);
  const [audioEnabled, setAudioEnabled] = useState(false);
  const [gameOverVisible, setGameOverVisible] = useState(false);
  const [perfectMoveFlash, setPerfectMoveFlash] = useState(false);
  const stageRef = useRef(null);
  const canvasRef = useRef(null);
  const rafRef = useRef(null);
  const pointerRef = useRef({ down: false, moved: false, startX: 0, startY: 0, startTime: 0, consumed: false });
  const lastTapRef = useRef(0);
  const audioContextRef = useRef(null);
  const gameRef = useRef({ width: 0, height: 0, elapsed: 0, obstacles: [], spawnTimer: 1, flow: 0, score: 0, dead: false, deathElapsed: 0, phase: 0, player: {} });

  const playSfx = useCallback((kind) => {
    if (!audioEnabled) return;
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx) return;
    if (!audioContextRef.current) audioContextRef.current = new AudioCtx();
    const ctx = audioContextRef.current;
    if (ctx.state === "suspended") ctx.resume().catch(() => {});
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.type = kind === "hit" ? "square" : "triangle";
    const freq = kind === "dash" ? [190, 440] : kind === "perfect" ? [480, 800] : kind === "hit" ? [120, 70] : [330, 180];
    osc.frequency.setValueAtTime(freq[0], now);
    osc.frequency.exponentialRampToValueAtTime(freq[1], now + 0.12);
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(kind === "hit" ? 0.07 : 0.045, now + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.14);
    osc.start(now);
    osc.stop(now + 0.16);
  }, [audioEnabled]);

  const resetGame = useCallback(() => {
    const stage = stageRef.current;
    const rect = stage?.getBoundingClientRect() || { width: 360, height: 520 };
    const width = Math.max(320, rect.width);
    const height = Math.max(430, rect.height);
    gameRef.current = {
      width,
      height,
      elapsed: 0,
      obstacles: [],
      spawnTimer: 0.9,
      flow: 8,
      score: 0,
      dead: false,
      deathElapsed: 0,
      phase: 0,
      player: {
        x: width * 0.25,
        y: height - 160,
        w: Math.max(26, width * 0.06),
        h: Math.max(58, height * 0.14),
        vy: 0,
        onGround: true,
        holdJump: false,
        holdElapsed: 0,
        slideTimer: 0,
        vaultTimer: 0,
        dashTimer: 0
      }
    };
    setScore(0);
    setFlow(8);
    setPerfectMoveFlash(false);
  }, []);

  const startRun = useCallback(() => {
    resetGame();
    setGameOverVisible(false);
    setFinalScore(0);
    setScreen("playing");
  }, [resetGame]);

  const doAction = useCallback((action) => {
    const game = gameRef.current;
    const p = game.player;
    if (game.dead || screen !== "playing") return;
    if (action === "jump" && p.onGround) {
      p.vy = -FLOW_RUNNER.jumpVelocity;
      p.onGround = false;
      p.holdJump = true;
      p.holdElapsed = 0;
      playSfx("jump");
    } else if (action === "slide" && p.onGround) {
      p.slideTimer = FLOW_RUNNER.slideDuration;
    } else if (action === "vault" && p.onGround) {
      p.vaultTimer = FLOW_RUNNER.vaultDuration;
      p.vy = -FLOW_RUNNER.vaultVelocity;
      p.onGround = false;
      playSfx("jump");
    } else if (action === "dash") {
      p.dashTimer = FLOW_RUNNER.dashDuration;
      playSfx("dash");
    }
    const next = game.obstacles.find((o) => !o.cleared && o.x > p.x - 24);
    if (next) {
      const d = next.x - (p.x + p.w);
      if (d < 165 && d > -30 && next.required === action) {
        game.flow = Math.min(100, game.flow + 15);
        setPerfectMoveFlash(true);
        playSfx("perfect");
      } else {
        game.flow = Math.max(0, game.flow - 6);
      }
    }
  }, [playSfx, screen]);

  const triggerHit = useCallback(() => {
    const game = gameRef.current;
    if (game.dead) return;
    game.dead = true;
    game.deathElapsed = 0;
    playSfx("hit");
  }, [playSfx]);

  useEffect(() => {
    if (perfectMoveFlash) {
      const t = setTimeout(() => setPerfectMoveFlash(false), 170);
      return () => clearTimeout(t);
    }
    return undefined;
  }, [perfectMoveFlash]);

  useEffect(() => {
    if (screen === "gameover") {
      const t = setTimeout(() => setGameOverVisible(true), 50);
      return () => clearTimeout(t);
    }
    return undefined;
  }, [screen]);

  useEffect(() => () => audioContextRef.current?.close().catch(() => {}), []);

  useEffect(() => {
    const stage = stageRef.current;
    const canvas = canvasRef.current;
    if (!stage || !canvas) return undefined;
    const ctx = canvas.getContext("2d");
    if (!ctx) return undefined;
    const dpr = window.devicePixelRatio || 1;
    const resize = () => {
      const rect = stage.getBoundingClientRect();
      canvas.width = Math.floor(Math.max(320, rect.width) * dpr);
      canvas.height = Math.floor(Math.max(430, rect.height) * dpr);
      canvas.style.width = `${Math.max(320, rect.width)}px`;
      canvas.style.height = `${Math.max(430, rect.height)}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();
    window.addEventListener("resize", resize);
    return () => window.removeEventListener("resize", resize);
  }, []);

  useEffect(() => {
    if (screen !== "playing") return undefined;
    const canvas = canvasRef.current;
    if (!canvas) return undefined;
    const ctx = canvas.getContext("2d");
    if (!ctx) return undefined;
    resetGame();

    const intersects = (a, b) => a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
    const spawn = (game) => {
      const diff = Math.min(1, game.elapsed / 80);
      const pool = [{ kind: "low-wall", required: "jump" }, { kind: "high-wall", required: "vault" }, { kind: "barrier", required: "slide" }, { kind: "gap", required: "jump" }, { kind: "moving-hazard", required: "dash" }];
      const pick = pool[Math.floor(Math.random() * pool.length)];
      const p = game.player;
      const gy = game.height - 84;
      const x = game.width + 40;
      if (pick.kind === "low-wall") game.obstacles.push({ ...pick, x, y: gy - (p.h * 0.58), w: p.w * 1.35, h: p.h * 0.58, points: FLOW_RUNNER.scoreObstacleBonus, cleared: false });
      if (pick.kind === "high-wall") game.obstacles.push({ ...pick, x, y: gy - (p.h * 0.96), w: p.w * 1.56, h: p.h * 0.96, points: FLOW_RUNNER.scoreObstacleBonus + 12, cleared: false });
      if (pick.kind === "barrier") game.obstacles.push({ ...pick, x, y: gy - p.h * 0.76, w: p.w * 1.9, h: 18, points: FLOW_RUNNER.scoreObstacleBonus + 8, cleared: false });
      if (pick.kind === "gap") game.obstacles.push({ ...pick, x, y: gy, w: Math.max(72, game.width * (0.12 + diff * 0.07)), h: 56, points: FLOW_RUNNER.scoreObstacleBonus + 15, cleared: false });
      if (pick.kind === "moving-hazard") game.obstacles.push({ ...pick, x, y: gy - p.h * 0.68, w: 28, h: 28, wave: Math.random() * Math.PI * 2, points: FLOW_RUNNER.scoreObstacleBonus + 18, cleared: false });
    };

    let prev = 0;
    const loop = (ts) => {
      const game = gameRef.current;
      if (!prev) prev = ts;
      const raw = Math.min(FLOW_RUNNER.maxFrameDelta, (ts - prev) / 1000);
      prev = ts;
      const slow = game.dead ? Math.max(0.08, 1 - game.deathElapsed / FLOW_RUNNER.deathSlowMoDuration) : 1;
      const dt = raw * slow;
      const p = game.player;
      const gy = game.height - 84;
      const speed = (FLOW_RUNNER.baseSpeed + game.elapsed * FLOW_RUNNER.speedRamp) * (1 + (game.flow / 100) * FLOW_RUNNER.flowSpeedFactor) * (p.dashTimer > 0 ? FLOW_RUNNER.dashBoost : 1);

      if (!game.dead) {
        game.elapsed += dt;
        game.spawnTimer -= dt;
        if (game.spawnTimer <= 0) {
          spawn(game);
          game.spawnTimer = Math.max(FLOW_RUNNER.minSpawnInterval, FLOW_RUNNER.baseSpawnInterval - game.elapsed * FLOW_RUNNER.spawnAcceleration) + Math.random() * 0.2;
        }
        if (!p.onGround) {
          p.vy += FLOW_RUNNER.gravity * dt;
          if (p.holdJump && p.holdElapsed < FLOW_RUNNER.jumpHoldMax) {
            p.vy -= FLOW_RUNNER.jumpHoldForce * dt;
            p.holdElapsed += dt;
          }
          p.y += p.vy * dt;
        }
        if (p.y >= gy - p.h) { p.y = gy - p.h; p.vy = 0; p.onGround = true; p.holdJump = false; }
        p.slideTimer = Math.max(0, p.slideTimer - dt);
        p.vaultTimer = Math.max(0, p.vaultTimer - dt);
        p.dashTimer = Math.max(0, p.dashTimer - dt);
      } else {
        game.deathElapsed += raw;
      }

      const ph = p.h * (p.slideTimer > 0 ? 0.56 : 1);
      const pw = p.w * (p.dashTimer > 0 ? 1.16 : 1);
      const pb = { x: p.x, y: p.y + (p.h - ph), w: pw, h: ph };
      for (const o of game.obstacles) {
        o.x -= speed * dt;
        if (o.kind === "moving-hazard") { o.wave += dt * 4; o.y += Math.sin(o.wave) * 0.6; }
        if (!o.cleared) {
          if (o.kind === "gap") {
            const overlap = pb.x + pb.w > o.x + 8 && pb.x < o.x + o.w - 8;
            if (overlap && pb.y + pb.h >= gy - 3) triggerHit();
          } else if (o.kind === "barrier") {
            if (intersects(pb, o) && p.slideTimer <= 0 && p.dashTimer <= 0) triggerHit();
          } else if (o.kind === "high-wall") {
            if (intersects(pb, o) && p.vaultTimer <= 0 && p.dashTimer <= 0) triggerHit();
          } else if (intersects(pb, o) && p.dashTimer <= 0) triggerHit();
          if (o.x + o.w < p.x - 8) { o.cleared = true; game.score += o.points; game.flow = Math.min(100, game.flow + 2); }
        }
      }
      game.obstacles = game.obstacles.filter((o) => o.x + o.w > -80);
      game.flow = Math.max(0, game.flow - FLOW_RUNNER.flowDecayPerSecond * dt);
      game.score += speed * dt * FLOW_RUNNER.scoreDistanceFactor + game.flow * dt * FLOW_RUNNER.scoreFlowFactor;
      game.phase += dt * (0.9 + speed * 0.002);

      ctx.clearRect(0, 0, game.width, game.height);
      ctx.fillStyle = "rgba(8,11,14,0.96)";
      ctx.fillRect(0, 0, game.width, game.height);
      ctx.strokeStyle = "rgba(88,238,220,0.07)";
      for (let i = -1; i < 12; i += 1) {
        const x = ((i * 92 - game.phase * 60) % (game.width + 92)) - 40;
        ctx.beginPath(); ctx.moveTo(x, gy - 140); ctx.lineTo(x + 35, gy - 220); ctx.stroke();
      }
      ctx.strokeStyle = "rgba(130,230,214,0.32)";
      ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(0, gy); ctx.lineTo(game.width, gy); ctx.stroke();
      for (const o of game.obstacles) {
        if (o.kind === "gap") { ctx.fillStyle = "rgba(0,0,0,0.75)"; ctx.fillRect(o.x, gy + 1, o.w, o.h); continue; }
        ctx.fillStyle = "rgba(232,240,246,0.12)";
        ctx.strokeStyle = o.required === "dash" ? "rgba(76,184,255,0.45)" : "rgba(88,238,220,0.28)";
        ctx.lineWidth = o.required === "dash" ? 1.8 : 1.3;
        ctx.beginPath();
        if (ctx.roundRect) ctx.roundRect(o.x, o.y, o.w, o.h, 8);
        else ctx.rect(o.x, o.y, o.w, o.h);
        ctx.fill();
        ctx.stroke();
      }
      if (game.flow > 65 || p.dashTimer > 0) { ctx.fillStyle = "rgba(68,210,255,0.24)"; ctx.fillRect(pb.x - 18, pb.y + pb.h * 0.4, 20, 8); }
      ctx.fillStyle = "rgba(240,248,255,0.9)";
      ctx.strokeStyle = `rgba(95,220,255,${0.35 + Math.max(0.2, game.flow / 100) * 0.35})`;
      ctx.lineWidth = 1.4;
      ctx.beginPath();
      if (ctx.roundRect) ctx.roundRect(pb.x, pb.y, pb.w, pb.h, 8);
      else ctx.rect(pb.x, pb.y, pb.w, pb.h);
      ctx.fill();
      ctx.stroke();

      if (game.dead && game.deathElapsed >= FLOW_RUNNER.deathSlowMoDuration) {
        const end = Math.floor(game.score);
        setFinalScore(end);
        setScore(end);
        setFlow(Math.round(game.flow));
        setScreen("gameover");
      } else {
        setScore(Math.floor(game.score));
        setFlow(Math.round(game.flow));
      }
      rafRef.current = requestAnimationFrame(loop);
    };

    rafRef.current = requestAnimationFrame(loop);
    return () => { if (rafRef.current) cancelAnimationFrame(rafRef.current); };
  }, [resetGame, screen, triggerHit]);

  const handlePointerDown = (event) => {
    if (screen === "idle") { startRun(); return; }
    if (screen !== "playing") return;
    pointerRef.current = { down: true, moved: false, startX: event.clientX, startY: event.clientY, startTime: performance.now(), consumed: false };
  };

  const handlePointerMove = (event) => {
    if (screen !== "playing" || !pointerRef.current.down) return;
    const p = pointerRef.current;
    const dx = event.clientX - p.startX;
    const dy = event.clientY - p.startY;
    if (Math.abs(dx) > 8 || Math.abs(dy) > 8) p.moved = true;
    if (!p.consumed && Math.abs(dy) > 32 && Math.abs(dy) > Math.abs(dx) + 8) {
      p.consumed = true;
      if (dy > 0) doAction("slide"); else doAction("vault");
      return;
    }
    if (!p.consumed && performance.now() - p.startTime > 120) {
      p.consumed = true;
      doAction("jump");
    }
  };

  const handlePointerUp = () => {
    if (screen !== "playing") return;
    const p = pointerRef.current;
    if (!p.down) return;
    const now = performance.now();
    if (!p.consumed && !p.moved && now - p.startTime < 240) {
      if (now - lastTapRef.current < 260) { doAction("dash"); lastTapRef.current = 0; }
      else { lastTapRef.current = now; doAction("jump"); }
    }
    gameRef.current.player.holdJump = false;
    pointerRef.current.down = false;
  };

  return (
    <div
      ref={stageRef}
      className="relative overflow-hidden rounded-3xl border border-white/10 bg-black/45 backdrop-blur-xl min-h-[68vh] shadow-[0_14px_40px_rgba(0,0,0,0.45),inset_0_1px_0_rgba(255,255,255,0.04)]"
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerUp}
      onPointerLeave={handlePointerUp}
      data-testid="run-mode-tab"
    >
      {(screen === "playing" || screen === "gameover") && <canvas ref={canvasRef} className="absolute inset-0 w-full h-full touch-none" />}

      {(screen === "playing" || screen === "gameover") && (
        <>
          <div className="absolute top-4 right-4 z-30">
            <button type="button" onClick={(e) => { e.stopPropagation(); setAudioEnabled((v) => !v); }} className="glass-button h-9 w-9 rounded-xl border border-white/10 flex items-center justify-center text-white/80 active:scale-95 transition-transform" aria-label={audioEnabled ? "Disable audio" : "Enable audio"}>
              {audioEnabled ? <Volume2 className="w-4 h-4" /> : <VolumeX className="w-4 h-4" />}
            </button>
          </div>
          <div className="absolute top-4 left-1/2 -translate-x-1/2 z-20 flex flex-col items-center gap-2 w-[72%] max-w-[280px]">
            <div className="glass-card px-5 py-1.5 rounded-full border border-white/10">
              <span className="text-[11px] text-white/60 uppercase tracking-[0.2em] mr-2">Score</span>
              <span className="text-lg font-mono text-white/95">{score}</span>
            </div>
            <div className="w-full h-1.5 rounded-full bg-white/10 overflow-hidden border border-white/10">
              <div className="h-full transition-all duration-150" style={{ width: `${Math.max(0, Math.min(100, flow))}%`, background: "linear-gradient(90deg, rgba(63,194,255,0.8), rgba(86,252,209,0.85))", boxShadow: flow > 70 ? "0 0 10px rgba(86,252,209,0.45)" : "none" }} />
            </div>
          </div>
          {perfectMoveFlash && <div className="absolute top-20 left-1/2 -translate-x-1/2 text-[11px] uppercase tracking-[0.2em] text-[#83ffe1]/85 z-20 animate-pulse">Perfect Move</div>}
        </>
      )}

      {screen === "idle" && (
        <div className="absolute inset-0 flex flex-col items-center justify-center px-6 text-center">
          <div className="glass-card w-full max-w-[360px] p-7 border border-white/10">
            <p className="text-[11px] uppercase tracking-[0.32em] text-white/45 mb-3">FLOW RUNNER</p>
            <h2 className="text-2xl font-heading font-semibold text-white/92 mb-3">Tap to Run</h2>
            <p className="text-sm text-white/55 mb-6">Tap, hold, swipe, and dash to stay in flow.</p>
            <button onClick={startRun} className="glass-button w-full py-3 rounded-2xl text-base font-semibold text-white hover:text-white/95 border border-white/12 active:scale-[0.98] transition-transform" data-testid="run-start-btn">Start Run</button>
            <div className="mt-5 h-[2px] rounded-full bg-white/10 overflow-hidden">
              <div className="h-full w-1/3 bg-gradient-to-r from-transparent via-[#5af0ff]/70 to-transparent animate-[pulse_1.7s_ease-in-out_infinite]" />
            </div>
          </div>
        </div>
      )}

      {screen === "gameover" && (
        <div className={`absolute inset-0 flex items-center justify-center px-6 backdrop-blur-sm bg-black/45 transition-opacity duration-300 ${gameOverVisible ? "opacity-100" : "opacity-0"}`}>
          <div className="glass-card w-full max-w-[340px] p-7 text-center border border-white/12">
            <p className="text-xs uppercase tracking-[0.25em] text-white/45 mb-2">RUN COMPLETE</p>
            <p className="text-sm text-white/65">Final score</p>
            <p className="text-4xl font-mono text-white/95 mb-6 mt-1">{finalScore}</p>
            <button onClick={startRun} className="glass-button w-full py-3 rounded-2xl text-base font-semibold text-white border border-white/12 active:scale-[0.98] transition-transform" data-testid="run-again-btn">Run Again</button>
          </div>
        </div>
      )}
    </div>
  );
};

// Bottom Navigation
const BottomNav = ({ activeTab, onTabChange }) => (
  <div className="fixed bottom-0 left-0 right-0 flex justify-center z-[9999]" data-testid="bottom-nav">
    <div className="w-full max-w-[560px] bg-[#0f0f0f] border-t border-white/[0.06] flex justify-around py-3 px-6">
      <button
        onClick={() => onTabChange("calculator")}
        className={`flex flex-col items-center gap-0.5 px-4 py-1.5 rounded-lg transition-colors ${
          activeTab === "calculator" 
            ? "bg-white/5 text-crtv-blue" 
            : "text-white/40 hover:text-white/60"
        }`}
        data-testid="nav-calculator-btn"
      >
        <Calculator className="w-4 h-4" />
        <span className="text-[10px] font-medium">Calculator</span>
      </button>
      <button
        onClick={() => onTabChange("checklist")}
        className={`flex flex-col items-center gap-0.5 px-4 py-1.5 rounded-lg transition-colors ${
          activeTab === "checklist" 
            ? "bg-white/5 text-crtv-blue" 
            : "text-white/40 hover:text-white/60"
        }`}
        data-testid="nav-checklist-btn"
      >
        <ClipboardCheck className="w-4 h-4" />
        <span className="text-[10px] font-medium">Checklist</span>
      </button>
      <button
        onClick={() => onTabChange("run")}
        className={`flex flex-col items-center gap-0.5 px-4 py-1.5 rounded-lg transition-colors ${
          activeTab === "run"
            ? "bg-white/5 text-crtv-blue"
            : "text-white/40 hover:text-white/60"
        }`}
        data-testid="nav-run-btn"
      >
        <RunModeIcon active={activeTab === "run"} />
        <span className="text-[10px] font-medium">Run</span>
      </button>
    </div>
  </div>
);

// Main App
function App() {
  const [activeTab, setActiveTab] = useState("calculator");
  const [symbol, setSymbol] = useState(() => getSafeSymbol(localStorage.getItem(STORAGE_KEYS.SYMBOL)));
  const [currentTime, setCurrentTime] = useState(formatETTime());
  const [isWeekendMode, setIsWeekendMode] = useState(isWeekend());
  const [isSquidsFontReady, setIsSquidsFontReady] = useState(false);

  // Update time every second
  useEffect(() => {
    const updateTime = () => {
      setCurrentTime(formatETTime());
      setIsWeekendMode(isWeekend());
    };

    updateTime();
    const interval = setInterval(updateTime, 1000);
    return () => clearInterval(interval);
  }, []);

  // Save symbol to localStorage
  useEffect(() => {
    localStorage.setItem(STORAGE_KEYS.SYMBOL, getSafeSymbol(symbol));
  }, [symbol]);

  // Avoid thin->bold header flash: wait for Anton to be ready, then reveal title
  useEffect(() => {
    let mounted = true;
    const fallbackTimer = setTimeout(() => {
      if (mounted) setIsSquidsFontReady(true);
    }, FONT_LOAD_FALLBACK_MS);

    const prepareFont = async () => {
      try {
        if (document.fonts?.load) {
          const fontLoads = [
            document.fonts.load("400 24px Anton"),
            document.fonts.load("400 30px Anton"),
            document.fonts.ready
          ];
          await Promise.all(fontLoads);
        }
      } catch {
        // Fallback timer handles reveal if font loading API fails
      } finally {
        if (mounted) setIsSquidsFontReady(true);
        clearTimeout(fallbackTimer);
      }
    };

    prepareFont();
    return () => {
      mounted = false;
      clearTimeout(fallbackTimer);
    };
  }, []);

  const handleSymbolChange = useCallback((nextSymbol) => {
    if (!SYMBOLS[nextSymbol]) return;
    setSymbol(nextSymbol);
  }, []);

  return (
    <div className="min-h-screen bg-[#0f0f0f] flex justify-center" data-testid="app-root" data-active-tab={activeTab}>
      <div className="w-full max-w-[560px] min-h-screen px-5 pt-4 pb-24">
        {/* App Header */}
        <div className="flex items-center justify-center mb-4 min-h-[40px]">
          <span
            className="font-squids text-2xl tracking-widest leading-none text-white/90 inline-flex items-center justify-center"
            style={{ opacity: isSquidsFontReady ? 1 : 0 }}
            data-testid="app-title"
          >
            Y<span className="text-3xl -mt-1 inline-block">$</span>ER
          </span>
        </div>
        {activeTab === "calculator" ? (
          <>
            <MarketSessions currentTime={currentTime} isWeekendMode={isWeekendMode} />
            <CalculatorTab symbol={symbol} onSymbolChange={handleSymbolChange} />
          </>
        ) : activeTab === "checklist" ? (
          <ChecklistTab currentTime={currentTime} isWeekendMode={isWeekendMode} />
        ) : (
          <RunModeTab />
        )}
      </div>
      <BottomNav activeTab={activeTab} onTabChange={setActiveTab} />
    </div>
  );
}

export default App;
