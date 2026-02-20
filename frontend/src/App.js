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
  // Sunday until 8PM (20:00)
  if (day === 0 && currentTime < 20) return true;
  return false;
};

// Check if we're in Friday special mode (5PM-8PM Friday where Post Trade is still open)
const isFridayPostTradeWindow = () => {
  const now = getETTime();
  const day = now.getDay();
  const hour = now.getHours();
  const minute = now.getMinutes();
  const currentTime = hour + minute / 60;
  
  // Friday between 5PM and 8PM - Post Trade still open, others closed
  return day === 5 && currentTime >= 17 && currentTime < 20;
};

// Get live session status with Friday rule and weekend mode
const getLiveSessionStatus = (session, now) => {
  const day = now.getDay();
  const hour = now.getHours();
  const minute = now.getMinutes();
  const second = now.getSeconds();
  const currentTimeInSeconds = hour * 3600 + minute * 60 + second;
  
  const startSeconds = Math.floor(session.start) * 3600 + Math.round((session.start % 1) * 60) * 60;
  const endSeconds = session.end === 24 ? 24 * 3600 : Math.floor(session.end) * 3600 + Math.round((session.end % 1) * 60) * 60;
  
  // Check weekend mode (Friday 5PM to Sunday 8PM)
  const currentTime = hour + minute / 60;
  const isWeekendPeriod = (day === 5 && currentTime >= 17) || 
                          day === 6 || 
                          (day === 0 && currentTime < 20);
  
  // Friday rule: After 5PM Friday, only Post Trade can be open (until 8PM)
  const isFridayAfter5PM = day === 5 && currentTime >= 17;
  
  let isOpen = false;
  let secondsRemaining = 0;
  
  // Calculate base open status
  if (session.end > session.start) {
    // Normal session (doesn't span midnight)
    isOpen = currentTimeInSeconds >= startSeconds && currentTimeInSeconds < endSeconds;
  } else {
    // Session spans midnight (Asia Range: 20:00 - 24:00)
    isOpen = currentTimeInSeconds >= startSeconds || currentTimeInSeconds < endSeconds;
  }
  
  // Apply Friday rule
  if (isFridayAfter5PM) {
    if (session.name === "Post Trade") {
      // Post Trade stays open until 8PM on Friday
      isOpen = currentTime < 20;
    } else {
      // All other sessions close at 5PM Friday
      isOpen = false;
    }
  }
  
  // Weekend mode - everything closed
  if (isWeekendPeriod && !isFridayAfter5PM) {
    isOpen = false;
  }
  // Sunday after 8PM - normal operations resume, check if Asia should open
  if (day === 0 && currentTime >= 20) {
    if (session.end > session.start) {
      isOpen = currentTimeInSeconds >= startSeconds && currentTimeInSeconds < endSeconds;
    } else {
      isOpen = currentTimeInSeconds >= startSeconds || currentTimeInSeconds < endSeconds;
    }
  }
  
  // Calculate countdown
  if (isWeekendPeriod && session.name !== "Post Trade") {
    // During weekend, show countdown to next Asia Range open (Sunday 8PM)
    if (session.name === "Asia Range") {
      // Calculate time until Sunday 8PM
      let daysUntilSunday = 0;
      if (day === 5) daysUntilSunday = 2;
      else if (day === 6) daysUntilSunday = 1;
      else if (day === 0) daysUntilSunday = 0;
      
      const sundayOpenSeconds = 20 * 3600; // 8PM
      if (day === 0 && currentTimeInSeconds >= sundayOpenSeconds) {
        // It's Sunday after 8PM, calculate normally
        secondsRemaining = 0;
      } else if (day === 0) {
        secondsRemaining = sundayOpenSeconds - currentTimeInSeconds;
      } else {
        secondsRemaining = daysUntilSunday * 24 * 3600 + (sundayOpenSeconds - currentTimeInSeconds + 24 * 3600) % (24 * 3600);
        if (day === 5) {
          secondsRemaining = (24 * 3600 - currentTimeInSeconds) + 24 * 3600 + sundayOpenSeconds;
        } else if (day === 6) {
          secondsRemaining = (24 * 3600 - currentTimeInSeconds) + sundayOpenSeconds;
        }
      }
    } else {
      // Other sessions - show "Weekend"
      secondsRemaining = -1; // Flag for weekend display
    }
  } else if (isOpen) {
    // Calculate time until close
    if (session.end > session.start) {
      secondsRemaining = endSeconds - currentTimeInSeconds;
    } else {
      // Session spans midnight
      if (currentTimeInSeconds >= startSeconds) {
        secondsRemaining = (24 * 3600 - currentTimeInSeconds) + endSeconds;
      } else {
        secondsRemaining = endSeconds - currentTimeInSeconds;
      }
    }
    
    // Friday rule for Post Trade
    if (isFridayAfter5PM && session.name === "Post Trade") {
      const fridayCloseSeconds = 20 * 3600; // 8PM
      secondsRemaining = fridayCloseSeconds - currentTimeInSeconds;
    }
  } else {
    // Calculate time until open
    if (session.end > session.start) {
      if (currentTimeInSeconds < startSeconds) {
        secondsRemaining = startSeconds - currentTimeInSeconds;
      } else {
        secondsRemaining = (24 * 3600 - currentTimeInSeconds) + startSeconds;
      }
    } else {
      // Session spans midnight
      if (currentTimeInSeconds < startSeconds) {
        secondsRemaining = startSeconds - currentTimeInSeconds;
      } else {
        secondsRemaining = startSeconds - currentTimeInSeconds + 24 * 3600;
      }
    }
  }
  
  // Format countdown
  const hours = Math.floor(secondsRemaining / 3600);
  const mins = Math.floor((secondsRemaining % 3600) / 60);
  const secs = secondsRemaining % 60;
  
  let label = "";
  if (secondsRemaining === -1) {
    label = "Weekend";
  } else if (isOpen) {
    label = `Closes in ${hours}h ${mins}m`;
  } else {
    label = `Opens in ${hours}h ${mins}m`;
  }
  
  return {
    isOpen,
    hours,
    mins,
    secs,
    secondsRemaining,
    label
  };
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

const getSessionStatus = (session, now) => {
  const hour = now.getHours();
  const minute = now.getMinutes();
  const currentTime = hour + minute / 60;

  let isOpen = false;
  if (session.end > session.start) {
    isOpen = currentTime >= session.start && currentTime < session.end;
  } else {
    // Session spans midnight (e.g., Asia Range 20:00 - 24:00)
    isOpen = currentTime >= session.start || currentTime < session.end;
  }

  return { isOpen, currentTime };
};

// Calculate countdown to open or close
const getSessionCountdown = (session, now) => {
  const hour = now.getHours();
  const minute = now.getMinutes();
  const currentTimeInMinutes = hour * 60 + minute;
  
  const startMinutes = Math.floor(session.start) * 60 + Math.round((session.start % 1) * 60);
  const endMinutes = session.end === 24 ? 24 * 60 : Math.floor(session.end) * 60 + Math.round((session.end % 1) * 60);
  
  let isOpen = false;
  let minutesRemaining = 0;
  
  if (session.end > session.start) {
    // Normal session (doesn't span midnight)
    isOpen = currentTimeInMinutes >= startMinutes && currentTimeInMinutes < endMinutes;
    
    if (isOpen) {
      // Time until close
      minutesRemaining = endMinutes - currentTimeInMinutes;
    } else if (currentTimeInMinutes < startMinutes) {
      // Time until open (same day)
      minutesRemaining = startMinutes - currentTimeInMinutes;
    } else {
      // Time until open (next day)
      minutesRemaining = (24 * 60 - currentTimeInMinutes) + startMinutes;
    }
  } else {
    // Session spans midnight (Asia Range: 20:00 - 24:00/0:00)
    isOpen = currentTimeInMinutes >= startMinutes || currentTimeInMinutes < endMinutes;
    
    if (isOpen) {
      if (currentTimeInMinutes >= startMinutes) {
        // Currently in evening portion (before midnight)
        minutesRemaining = (24 * 60 - currentTimeInMinutes) + endMinutes;
      } else {
        // Currently in morning portion (after midnight, before end)
        minutesRemaining = endMinutes - currentTimeInMinutes;
      }
    } else {
      // Closed - time until open (session starts at startMinutes)
      if (currentTimeInMinutes < startMinutes) {
        minutesRemaining = startMinutes - currentTimeInMinutes;
      } else {
        minutesRemaining = (24 * 60 - currentTimeInMinutes) + startMinutes;
      }
    }
  }
  
  const hours = Math.floor(minutesRemaining / 60);
  const mins = minutesRemaining % 60;
  
  return {
    isOpen,
    hours,
    mins,
    label: isOpen ? `Closes in ${hours}h ${mins}m` : `Opens in ${hours}h ${mins}m`
  };
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
const SessionGridCard = ({ session, now, isWeekendMode }) => {
  const countdown = getSessionCountdown(session, now);
  const isOpen = isWeekendMode ? false : countdown.isOpen;
  
  return (
    <div 
      className={`glass-card p-3 flex flex-col gap-1.5 transition-all duration-300 ${
        isOpen ? 'session-card-open' : ''
      }`}
      style={{
        boxShadow: isOpen ? '0 0 20px rgba(40, 230, 165, 0.12), inset 0 1px 0 rgba(255,255,255,0.03)' : undefined
      }}
    >
      {/* Top row: Name + Status */}
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium text-white/90 truncate">{session.name}</span>
        <div className={`px-2 py-0.5 rounded-full text-[10px] font-semibold ${
          isOpen 
            ? "bg-crtv-success/15 text-crtv-success" 
            : "bg-crtv-loss/15 text-crtv-loss"
        }`}>
          {isOpen ? "OPEN" : "CLOSED"}
        </div>
      </div>
      
      {/* Time range */}
      <span className="text-[10px] text-white/40 font-mono">{session.timeLabel}</span>
      
      {/* Countdown */}
      <span className={`text-[10px] font-mono ${isOpen ? 'text-crtv-success/80' : 'text-white/50'}`}>
        {isWeekendMode ? 'Weekend' : countdown.label}
      </span>
    </div>
  );
};

const MarketSessions = ({ currentTime, isWeekendMode }) => {
  const [now, setNow] = useState(getETTime());
  
  // Update every minute for countdown accuracy
  useEffect(() => {
    const interval = setInterval(() => {
      setNow(getETTime());
    }, 60000); // Update every minute
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
            isWeekendMode={isWeekendMode} 
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
