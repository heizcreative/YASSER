import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import "@/App.css";
import { format } from "date-fns";
import { toZonedTime, formatInTimeZone } from "date-fns-tz";
import { Calculator, ClipboardCheck, Check } from "lucide-react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

const TIMEZONE = "America/Toronto";

// Symbol configuration
const SYMBOLS = {
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
      { id: "pre-1", text: "Daily bias", num: 1 },
      { id: "pre-2", text: "High-impact news", num: 2 },
      { id: "pre-3", text: "Asia + London high/low", num: 3 },
      { id: "pre-4", text: "HTF PD arrays", num: 4 },
      { id: "pre-5", text: "One ICT model only", num: 5 }
    ]
  },
  kz: {
    title: "NY KILLZONE TRADING",
    subtitle: "9:30 AM → 11:00 AM",
    items: [
      { id: "kz-1", text: "Wait for confirmation", num: 1 },
      { id: "kz-2", text: "Execute entry", num: 2 },
      { id: "kz-3", text: "Manage trade", num: 3 }
    ]
  },
  post: {
    title: "ICT POST-TRADE REVIEW",
    items: [
      { id: "post-1", text: "Journal setup & outcome", num: 1 },
      { id: "post-2", text: "Chart screenshot", num: 2 },
      { id: "post-3", text: "Emotion check", num: 3 },
      { id: "post-4", text: "Followed ICT rules?", num: 4 }
    ]
  }
};

// LocalStorage keys
const STORAGE_KEYS = {
  SYMBOL: "crtv_symbol",
  CALCULATOR: "crtv_calculator",
  CHECKLIST: "crtv_checklist"
};

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
    const saved = localStorage.getItem(STORAGE_KEYS.CALCULATOR);
    return saved ? JSON.parse(saved).risk || "" : "";
  });
  const [stop, setStop] = useState(() => {
    const saved = localStorage.getItem(STORAGE_KEYS.CALCULATOR);
    return saved ? JSON.parse(saved).stop || "" : "";
  });
  const [tp, setTp] = useState(() => {
    const saved = localStorage.getItem(STORAGE_KEYS.CALCULATOR);
    return saved ? JSON.parse(saved).tp || "" : "";
  });

  useEffect(() => {
    localStorage.setItem(STORAGE_KEYS.CALCULATOR, JSON.stringify({ risk, stop, tp }));
  }, [risk, stop, tp]);

  const calculation = useMemo(() => {
    const riskNum = parseFloat(risk) || 0;
    const stopNum = parseFloat(stop) || 0;
    const tpNum = parseFloat(tp) || 0;
    const symbolData = SYMBOLS[symbol];

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
  const symbolData = SYMBOLS[symbol];
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
          <div className="flex justify-center mb-1">
            <Select value={symbol} onValueChange={onSymbolChange}>
              <SelectTrigger 
                className="h-9 w-auto px-4 glass-card text-white/90 text-sm font-mono rounded-full border-0"
                data-testid="symbol-selector"
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="bg-[#1a1a1a] border-white/10 text-white">
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
        <span className={`text-sm text-white/90 transition-all duration-200 ${checked ? 'line-through text-white/50' : ''}`}>
          {item.text}
        </span>
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
    const saved = localStorage.getItem(STORAGE_KEYS.CHECKLIST);
    if (saved) {
      const data = JSON.parse(saved);
      const todayKey = getETDateKey();
      if (data.dateKey === todayKey) {
        return data.items || {};
      }
    }
    return {};
  });
  const lastResetRef = useRef(null);

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
    </div>
  </div>
);

// Main App
function App() {
  const [activeTab, setActiveTab] = useState("calculator");
  const [symbol, setSymbol] = useState(() => localStorage.getItem(STORAGE_KEYS.SYMBOL) || "MNQ");
  const [currentTime, setCurrentTime] = useState(formatETTime());
  const [isWeekendMode, setIsWeekendMode] = useState(isWeekend());

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
    localStorage.setItem(STORAGE_KEYS.SYMBOL, symbol);
  }, [symbol]);

  return (
    <div className="min-h-screen bg-[#0f0f0f] flex justify-center" data-testid="app-root">
      <div className="w-full max-w-[560px] min-h-screen px-5 pt-4 pb-24">
        {/* App Header */}
        <div className="flex items-center justify-center mb-4">
          <span className="font-squids text-2xl tracking-widest text-white/90" data-testid="app-title">CRTV</span>
        </div>
        {activeTab === "calculator" ? (
          <>
            <MarketSessions currentTime={currentTime} isWeekendMode={isWeekendMode} />
            <CalculatorTab symbol={symbol} onSymbolChange={setSymbol} />
          </>
        ) : (
          <ChecklistTab currentTime={currentTime} isWeekendMode={isWeekendMode} />
        )}
      </div>
      <BottomNav activeTab={activeTab} onTabChange={setActiveTab} />
    </div>
  );
}

export default App;
