import { useState, useEffect, useCallback, useMemo } from "react";
import "@/App.css";
import { format, startOfMonth, endOfMonth, eachDayOfInterval, isSameMonth, isSameDay, addMonths, subMonths, getDay } from "date-fns";
import { toZonedTime, formatInTimeZone } from "date-fns-tz";
import { Calendar as CalendarIcon, Calculator, ChevronLeft, ChevronRight, Plus, X, Trash2, Edit } from "lucide-react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";

const TIMEZONE = "America/Toronto";

// Symbol configuration
const SYMBOLS = {
  MNQ: { name: "MNQ", valuePerPoint: 2, unit: "points" },
  MES: { name: "MES", valuePerPoint: 5, unit: "points" },
  "MGC1!": { name: "MGC1!", valuePerPoint: 10, unit: "price" },
  BTCUSD: { name: "BTCUSD", valuePerPoint: 1, unit: "usd" }
};

// Market sessions (all times in ET)
const SESSIONS = [
  { name: "Asia Range", start: 20, end: 24 }, // 8:00 PM - 12:00 AM (end is midnight = 24)
  { name: "London Killzone", start: 2, end: 5 }, // 2:00 AM - 5:00 AM
  { name: "NY Killzone", start: 9.5, end: 11 }, // 9:30 AM - 11:00 AM
  { name: "Post Trade", start: 11, end: 20 } // 11:00 AM - 8:00 PM
];

// LocalStorage keys
const STORAGE_KEYS = {
  JOURNAL: "crtv_journal",
  SYMBOL: "crtv_symbol",
  CALCULATOR: "crtv_calculator",
  CALENDAR_MONTH: "crtv_calendar_month"
};

// Helper functions
const getETTime = () => toZonedTime(new Date(), TIMEZONE);

const formatETTime = (date) => formatInTimeZone(date, TIMEZONE, "HH:mm");

const isWeekend = () => {
  const now = getETTime();
  const day = now.getDay();
  const hour = now.getHours();
  const minute = now.getMinutes();
  const currentTime = hour + minute / 60;

  // Weekend: Friday 5PM ET to Sunday 6PM ET
  if (day === 5 && currentTime >= 17) return true; // Friday after 5PM
  if (day === 6) return true; // All Saturday
  if (day === 0 && currentTime < 18) return true; // Sunday before 6PM
  return false;
};

const getSessionStatus = (session, now) => {
  const hour = now.getHours();
  const minute = now.getMinutes();
  const currentTime = hour + minute / 60;

  let isOpen = false;
  if (session.end > session.start) {
    isOpen = currentTime >= session.start && currentTime < session.end;
  } else {
    // Overnight session (Asia Range)
    isOpen = currentTime >= session.start || currentTime < session.end;
  }

  return { isOpen, currentTime };
};

const getCountdown = (session, now) => {
  const hour = now.getHours();
  const minute = now.getMinutes();
  const currentTime = hour + minute / 60;
  const { isOpen } = getSessionStatus(session, now);

  let targetTime;
  if (isOpen) {
    // Calculate time until close
    targetTime = session.end;
    if (session.end <= session.start && currentTime >= session.start) {
      targetTime = 24 + session.end;
    }
  } else {
    // Calculate time until open
    targetTime = session.start;
    if (currentTime >= session.start && session.end <= session.start) {
      targetTime = 24 + session.start;
    } else if (currentTime > session.end && session.end <= session.start) {
      targetTime = session.start;
    } else if (currentTime >= session.end) {
      targetTime = session.start < session.end ? 24 + session.start : session.start;
    }
  }

  let diff = targetTime - currentTime;
  if (diff < 0) diff += 24;

  const hours = Math.floor(diff);
  const minutes = Math.floor((diff - hours) * 60);

  return { hours, minutes, isOpen };
};

const formatTime12h = (hour) => {
  const h = Math.floor(hour);
  const m = Math.round((hour - h) * 60);
  const ampm = h >= 12 && h < 24 ? "PM" : "AM";
  const displayHour = h === 0 ? 12 : h > 12 ? h - 12 : h;
  return m > 0 ? `${displayHour}:${m.toString().padStart(2, "0")} ${ampm}` : `${displayHour}:00 ${ampm}`;
};

// Components
const GlassPanel = ({ children, className = "" }) => (
  <div className={`glass-panel p-4 ${className}`}>{children}</div>
);

const Header = ({ symbol, onSymbolChange, currentTime, isWeekendMode }) => (
  <div className="flex items-center justify-between mb-4" data-testid="header">
    <h1 className="text-3xl font-squids tracking-wider" data-testid="app-title">CRTV</h1>
    <div className="flex items-center gap-2">
      <Select value={symbol} onValueChange={onSymbolChange}>
        <SelectTrigger 
          className="h-8 w-auto px-3 bg-black/20 border-white/10 text-white/90 text-xs font-mono rounded-full"
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
              data-testid={`symbol-option-${sym}`}
            >
              {sym} • ${SYMBOLS[sym].valuePerPoint}/{SYMBOLS[sym].unit === "points" ? "pt" : "1.0"}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {isWeekendMode && (
        <span className="px-2 py-1 bg-crtv-warning/20 text-crtv-warning text-xs font-mono rounded-full" data-testid="weekend-badge">
          Weekend
        </span>
      )}
    </div>
  </div>
);

const formatTimeSimple = (hour) => {
  const h = Math.floor(hour);
  const m = Math.round((hour - h) * 60);
  const ampm = h >= 12 && h < 24 ? " PM" : " AM";
  const displayHour = h === 0 ? 12 : h > 12 ? h - 12 : h;
  return m > 0 ? `${displayHour}:${m.toString().padStart(2, "0")}${ampm}` : `${displayHour}${ampm}`;
};

const SessionCard = ({ session, now, isWeekendMode }) => {
  const { isOpen } = getSessionStatus(session, now);
  const displayOpen = isWeekendMode ? false : isOpen;

  return (
    <div 
      className="flex items-center justify-between py-2.5 px-3 bg-black/20 border border-white/[0.04] rounded-xl"
      data-testid={`session-${session.name.replace(/\s+/g, '-').toLowerCase()}`}
    >
      <div className="flex items-center gap-3">
        <div 
          className={`w-2.5 h-2.5 rounded-full ${displayOpen ? "bg-crtv-success shadow-[0_0_6px_rgba(40,230,165,0.5)]" : "bg-crtv-loss shadow-[0_0_6px_rgba(255,77,109,0.3)]"}`}
          data-testid={`session-dot-${session.name.replace(/\s+/g, '-').toLowerCase()}`}
        />
        <div>
          <p className="text-sm font-medium text-white/90">{session.name}</p>
          <p className="text-xs text-white/50 font-mono">
            {formatTimeSimple(session.start)}–{formatTimeSimple(session.end === 24 ? 0 : session.end)}
          </p>
        </div>
      </div>
      <div 
        className={`px-3 py-1 rounded-lg border text-xs font-medium ${
          displayOpen 
            ? "bg-crtv-success/10 border-crtv-success/20 text-crtv-success" 
            : "bg-crtv-loss/10 border-crtv-loss/20 text-crtv-loss"
        }`}
      >
        {displayOpen ? "OPEN" : "CLOSED"}
      </div>
    </div>
  );
};

const MarketSessions = ({ currentTime, isWeekendMode }) => {
  const now = getETTime();

  return (
    <GlassPanel className="mb-3 py-3" data-testid="market-sessions-card">
      {/* Clock pill at top */}
      <div className="flex justify-center mb-3">
        <div className="px-5 py-1.5 bg-black/30 border border-white/10 rounded-full">
          <span className="text-lg font-mono text-white/90" data-testid="current-time">ET {currentTime}</span>
        </div>
      </div>
      
      {/* Session cards - minimal gap */}
      <div className="space-y-1">
        {SESSIONS.map((session) => (
          <SessionCard key={session.name} session={session} now={now} isWeekendMode={isWeekendMode} />
        ))}
      </div>
    </GlassPanel>
  );
};

const CalculatorTab = ({ symbol }) => {
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
    if (totalRisk < 50) return { dot: "bg-white/50", label: "Very low risk (0-50)." };
    if (totalRisk <= 500) return { dot: "bg-crtv-success", label: "Risk OK (50-500)." };
    if (totalRisk <= 1500) return { dot: "bg-crtv-warning", label: "High risk (500-1500)." };
    return { dot: "bg-crtv-loss", label: "Too much risk (1500+)." };
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
    <div className="space-y-4" data-testid="calculator-tab">
      <GlassPanel>
        <div className="space-y-4">
          <div>
            <label className="text-xs text-white/50 uppercase tracking-wider mb-2 block">Risk ($)</label>
            <input
              type="number"
              value={risk}
              onChange={(e) => setRisk(e.target.value)}
              className="w-full h-12 bg-black/20 border border-white/10 rounded-xl px-4 text-white font-mono text-lg focus:border-crtv-blue/50 focus:outline-none transition-colors"
              data-testid="risk-input"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-white/50 uppercase tracking-wider mb-2 block">Stop ({unitLabel})</label>
              <input
                type="number"
                value={stop}
                onChange={(e) => setStop(e.target.value)}
                className="w-full h-12 bg-black/20 border border-white/10 rounded-xl px-4 text-white font-mono text-lg focus:border-crtv-blue/50 focus:outline-none transition-colors"
                data-testid="stop-input"
              />
            </div>
            <div>
              <label className="text-xs text-white/50 uppercase tracking-wider mb-2 block">Take Profit ({unitLabel})</label>
              <input
                type="number"
                value={tp}
                onChange={(e) => setTp(e.target.value)}
                className="w-full h-12 bg-black/20 border border-white/10 rounded-xl px-4 text-white font-mono text-lg focus:border-crtv-blue/50 focus:outline-none transition-colors"
                data-testid="tp-input"
              />
            </div>
          </div>
        </div>
      </GlassPanel>

      <GlassPanel>
        <div className="space-y-4">
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
            <span className={`text-xl font-mono font-semibold ${riskTier.color}`} data-testid="total-risk-output">
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
          <div className="px-4 py-3 bg-black/20 border border-white/8 rounded-xl flex items-center gap-3">
            <div className={`w-4 h-4 rounded-full ${riskTier.dot}`} />
            <span className="text-sm font-mono text-white/90" data-testid="risk-tier">{riskTier.label}</span>
          </div>
        </div>
      </GlassPanel>

      {/* Reset button in its own box */}
      <div className="flex justify-end mt-3">
        <button
          onClick={handleReset}
          className="px-5 py-3 bg-black/20 border border-white/8 rounded-xl text-sm font-mono text-white/70 hover:text-white hover:bg-white/5 transition-colors"
          data-testid="reset-button"
        >
          Reset Inputs
        </button>
      </div>
    </div>
  );
};

const CalendarTab = ({ journalEntries, onAddEntry, onEditEntry, onDeleteEntry }) => {
  const [currentMonth, setCurrentMonth] = useState(() => {
    const saved = localStorage.getItem(STORAGE_KEYS.CALENDAR_MONTH);
    return saved ? new Date(saved) : new Date();
  });
  const [selectedDate, setSelectedDate] = useState(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingEntry, setEditingEntry] = useState(null);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEYS.CALENDAR_MONTH, currentMonth.toISOString());
  }, [currentMonth]);

  const monthStart = startOfMonth(currentMonth);
  const monthEnd = endOfMonth(currentMonth);
  const days = eachDayOfInterval({ start: monthStart, end: monthEnd });
  const startDayOfWeek = getDay(monthStart);

  const getEntryForDate = (date) => {
    const dateStr = format(date, "yyyy-MM-dd");
    return journalEntries.find((e) => e.date === dateStr);
  };

  const getDotColor = (result) => {
    switch (result) {
      case "win": return "bg-crtv-success";
      case "loss": return "bg-crtv-loss";
      case "be": return "bg-crtv-blue";
      case "missed": return "bg-crtv-warning";
      default: return "bg-white/30";
    }
  };

  const getProfitColor = (entry) => {
    if (!entry) return "";
    if (entry.result === "win" || entry.profit > 0) return "text-crtv-success";
    if (entry.result === "loss" || entry.profit < 0) return "text-crtv-loss";
    if (entry.result === "be") return "text-crtv-blue";
    if (entry.result === "missed") return "text-crtv-warning";
    return "text-white/50";
  };

  const formatProfit = (profit) => {
    if (profit === 0 || profit === undefined) return "";
    const absProfit = Math.abs(profit);
    const sign = profit > 0 ? "+" : "-";
    
    if (absProfit >= 1000000) {
      return `${sign}$${(absProfit / 1000000).toFixed(1)}M`;
    } else if (absProfit >= 1000) {
      const k = absProfit / 1000;
      return `${sign}$${k >= 10 ? Math.round(k) : k.toFixed(1)}k`;
    }
    return `${sign}$${absProfit.toFixed(0)}`;
  };

  // Calculate monthly stats
  const monthlyStats = useMemo(() => {
    const monthStr = format(currentMonth, "yyyy-MM");
    const monthEntries = journalEntries.filter(e => e.date.startsWith(monthStr));
    return {
      wins: monthEntries.filter(e => e.result === "win" || (e.profit > 0 && e.result !== "loss")).length,
      losses: monthEntries.filter(e => e.result === "loss" || (e.profit < 0 && e.result !== "win")).length
    };
  }, [journalEntries, currentMonth]);

  // Calculate all-time stats
  const allTimeStats = useMemo(() => {
    return {
      wins: journalEntries.filter(e => e.result === "win" || (e.profit > 0 && e.result !== "loss")).length,
      losses: journalEntries.filter(e => e.result === "loss" || (e.profit < 0 && e.result !== "win")).length
    };
  }, [journalEntries]);

  const handleDayClick = (day) => {
    setSelectedDate(day);
    const entry = getEntryForDate(day);
    if (entry) {
      setEditingEntry(entry);
    } else {
      setEditingEntry(null);
    }
    setIsModalOpen(true);
  };

  const handleSaveEntry = (entryData) => {
    if (editingEntry) {
      onEditEntry({ ...editingEntry, ...entryData });
    } else {
      onAddEntry({ ...entryData, date: format(selectedDate, "yyyy-MM-dd") });
    }
    setIsModalOpen(false);
    setEditingEntry(null);
  };

  const handleDeleteEntry = () => {
    if (editingEntry) {
      onDeleteEntry(editingEntry.id);
      setIsModalOpen(false);
      setEditingEntry(null);
    }
  };

  return (
    <div data-testid="calendar-tab">
      <GlassPanel className="p-5">
        <div className="flex items-center justify-between mb-5">
          <button
            onClick={() => setCurrentMonth(subMonths(currentMonth, 1))}
            className="p-2 hover:bg-white/5 rounded-lg transition-colors"
            data-testid="prev-month-btn"
          >
            <ChevronLeft className="w-5 h-5 text-white/60" />
          </button>
          <h2 className="text-lg font-heading font-semibold" data-testid="current-month-title">
            {format(currentMonth, "MMMM yyyy")}
          </h2>
          <button
            onClick={() => setCurrentMonth(addMonths(currentMonth, 1))}
            className="p-2 hover:bg-white/5 rounded-lg transition-colors"
            data-testid="next-month-btn"
          >
            <ChevronRight className="w-5 h-5 text-white/60" />
          </button>
        </div>

        {/* Day headers */}
        <div className="grid grid-cols-7 gap-1.5 mb-3">
          {["S", "M", "T", "W", "T", "F", "S"].map((day, i) => (
            <div key={i} className="text-center text-xs text-white/40 font-medium py-2">
              {day}
            </div>
          ))}
        </div>

        {/* Calendar grid */}
        <div className="grid grid-cols-7 gap-1.5">
          {/* Empty cells for days before month start */}
          {Array.from({ length: startDayOfWeek }).map((_, i) => (
            <div key={`empty-${i}`} className="aspect-square" />
          ))}
          {/* Days of the month */}
          {days.map((day) => {
            const entry = getEntryForDate(day);
            const isToday = isSameDay(day, new Date());
            // Determine color based on result type, not profit value
            const profitColor = entry ? (entry.result === "win" ? "text-crtv-success" : entry.result === "loss" ? "text-crtv-loss" : "text-white/50") : "";
            // Format profit - show absolute value with sign based on result
            const displayProfit = entry && entry.profit !== 0 ? (
              entry.result === "loss" 
                ? `-$${Math.abs(entry.profit) >= 1000 ? (Math.abs(entry.profit) / 1000).toFixed(1) + 'k' : Math.abs(entry.profit)}`
                : `+$${Math.abs(entry.profit) >= 1000 ? (Math.abs(entry.profit) / 1000).toFixed(1) + 'k' : Math.abs(entry.profit)}`
            ) : null;
            return (
              <button
                key={day.toISOString()}
                onClick={() => handleDayClick(day)}
                className={`aspect-square flex flex-col items-center justify-center rounded-lg transition-colors hover:bg-white/5 ${
                  isToday ? "bg-white/10 border border-white/20" : ""
                }`}
                data-testid={`calendar-day-${format(day, "yyyy-MM-dd")}`}
              >
                <span className={`text-sm ${isToday ? "text-white font-medium" : "text-white/70"}`}>
                  {format(day, "d")}
                </span>
                {displayProfit && (
                  <span className={`text-[8px] font-mono font-medium leading-none mt-0.5 ${profitColor}`}>
                    {displayProfit}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </GlassPanel>

      {/* Stats Section */}
      <GlassPanel className="mt-3 p-4">
        <div className="space-y-3">
          {/* Monthly Stats */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="text-xs text-white/40 font-mono uppercase">This Month</span>
            </div>
            <div className="flex items-center gap-4">
              <div className="flex items-center gap-2">
                <span className="text-sm font-mono text-crtv-success/80">{monthlyStats.wins}</span>
                <span className="text-xs text-white/30">wins</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-sm font-mono text-crtv-loss/80">{monthlyStats.losses}</span>
                <span className="text-xs text-white/30">losses</span>
              </div>
            </div>
          </div>
          
          <div className="h-px bg-white/5" />
          
          {/* All-Time Stats */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="text-xs text-white/40 font-mono uppercase">All Time</span>
            </div>
            <div className="flex items-center gap-4">
              <div className="flex items-center gap-2">
                <span className="text-sm font-mono text-crtv-success/80">{allTimeStats.wins}</span>
                <span className="text-xs text-white/30">wins</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-sm font-mono text-crtv-loss/80">{allTimeStats.losses}</span>
                <span className="text-xs text-white/30">losses</span>
              </div>
            </div>
          </div>
        </div>
      </GlassPanel>

      {/* Journal Entry Modal */}
      <JournalEntryModal
        isOpen={isModalOpen}
        onClose={() => { setIsModalOpen(false); setEditingEntry(null); }}
        onSave={handleSaveEntry}
        onDelete={handleDeleteEntry}
        entry={editingEntry}
        date={selectedDate}
      />
    </div>
  );
};

const JournalEntryModal = ({ isOpen, onClose, onSave, onDelete, entry, date }) => {
  const [symbol, setSymbol] = useState(entry?.symbol || "MNQ");
  const [result, setResult] = useState(entry?.result || "win");
  const [profit, setProfit] = useState(entry?.profit?.toString() || "");
  const [notes, setNotes] = useState(entry?.notes || "");

  useEffect(() => {
    if (entry) {
      setSymbol(entry.symbol || "MNQ");
      setResult(entry.result || "win");
      setProfit(entry.profit?.toString() || "");
      setNotes(entry.notes || "");
    } else {
      setSymbol("MNQ");
      setResult("win");
      setProfit("");
      setNotes("");
    }
  }, [entry]);

  const handleSubmit = (e) => {
    e.preventDefault();
    onSave({
      symbol,
      result,
      profit: parseFloat(profit) || 0,
      notes
    });
  };

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="bg-[#1a1a1a] border-white/10 text-white max-w-md" data-testid="journal-modal">
        <DialogHeader>
          <DialogTitle className="text-white font-heading">
            {entry ? "Edit Entry" : "Add Entry"}
          </DialogTitle>
          <DialogDescription className="text-white/50">
            {date && format(date, "MMMM d, yyyy")}
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4 mt-4">
          <div>
            <label className="text-xs text-white/50 uppercase tracking-wider mb-2 block">Symbol</label>
            <Select value={symbol} onValueChange={setSymbol}>
              <SelectTrigger className="w-full bg-black/20 border-white/10 text-white" data-testid="journal-symbol-select">
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="bg-[#1a1a1a] border-white/10 text-white">
                {Object.keys(SYMBOLS).map((sym) => (
                  <SelectItem key={sym} value={sym} className="text-white/90 focus:bg-white/10 focus:text-white">
                    {sym}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div>
            <label className="text-xs text-white/50 uppercase tracking-wider mb-2 block">Result</label>
            <div className="grid grid-cols-4 gap-2">
              {[
                { value: "win", label: "Win", color: "crtv-success" },
                { value: "loss", label: "Loss", color: "crtv-loss" },
                { value: "be", label: "BE", color: "crtv-blue" },
                { value: "missed", label: "Missed", color: "crtv-warning" }
              ].map((opt) => (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => setResult(opt.value)}
                  className={`py-2 px-3 rounded-lg text-xs font-medium transition-colors ${
                    result === opt.value
                      ? `bg-${opt.color}/20 text-${opt.color} border border-${opt.color}/30`
                      : "bg-black/20 text-white/50 border border-white/5 hover:bg-white/5"
                  }`}
                  style={{
                    backgroundColor: result === opt.value ? `var(--${opt.color}-bg, rgba(255,255,255,0.1))` : undefined,
                    color: result === opt.value ? 
                      opt.color === "crtv-success" ? "#28E6A5" :
                      opt.color === "crtv-loss" ? "#FF4D6D" :
                      opt.color === "crtv-blue" ? "#4D9FFF" :
                      "#FFD34D" : undefined,
                    borderColor: result === opt.value ?
                      opt.color === "crtv-success" ? "rgba(40,230,165,0.3)" :
                      opt.color === "crtv-loss" ? "rgba(255,77,109,0.3)" :
                      opt.color === "crtv-blue" ? "rgba(77,159,255,0.3)" :
                      "rgba(255,211,77,0.3)" : undefined
                  }}
                  data-testid={`result-${opt.value}-btn`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="text-xs text-white/50 uppercase tracking-wider mb-2 block">Profit/Loss ($)</label>
            <input
              type="number"
              value={profit}
              onChange={(e) => setProfit(e.target.value)}
              className="w-full h-12 bg-black/20 border border-white/10 rounded-xl px-4 text-white font-mono focus:border-crtv-blue/50 focus:outline-none transition-colors"
              data-testid="journal-profit-input"
            />
          </div>

          <div>
            <label className="text-xs text-white/50 uppercase tracking-wider mb-2 block">Notes</label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={3}
              className="w-full bg-black/20 border border-white/10 rounded-xl px-4 py-3 text-white text-sm focus:border-crtv-blue/50 focus:outline-none transition-colors resize-none"
              data-testid="journal-notes-input"
            />
          </div>

          <div className="flex gap-2 pt-2">
            {entry && (
              <button
                type="button"
                onClick={onDelete}
                className="p-3 bg-crtv-loss/10 text-crtv-loss rounded-xl hover:bg-crtv-loss/20 transition-colors"
                data-testid="delete-entry-btn"
              >
                <Trash2 className="w-5 h-5" />
              </button>
            )}
            <button
              type="submit"
              className="flex-1 h-12 bg-crtv-blue text-white font-semibold rounded-xl hover:bg-crtv-blue/90 transition-colors"
              data-testid="save-entry-btn"
            >
              {entry ? "Update" : "Save Entry"}
            </button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
};

const BottomNav = ({ activeTab, onTabChange }) => (
  <div className="fixed bottom-0 left-0 right-0 flex justify-center z-[9999]" data-testid="bottom-nav">
    <div className="w-full max-w-[560px] bg-[#191919]/95 backdrop-blur-xl border-t border-white/5 flex justify-around py-3 px-6">
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
        onClick={() => onTabChange("calendar")}
        className={`flex flex-col items-center gap-0.5 px-4 py-1.5 rounded-lg transition-colors ${
          activeTab === "calendar" 
            ? "bg-white/5 text-crtv-blue" 
            : "text-white/40 hover:text-white/60"
        }`}
        data-testid="nav-calendar-btn"
      >
        <CalendarIcon className="w-4 h-4" />
        <span className="text-[10px] font-medium">Calendar</span>
      </button>
    </div>
  </div>
);

// Main App
function App() {
  const [activeTab, setActiveTab] = useState("calculator");
  const [symbol, setSymbol] = useState(() => localStorage.getItem(STORAGE_KEYS.SYMBOL) || "MNQ");
  const [currentTime, setCurrentTime] = useState(formatETTime(new Date()));
  const [isWeekendMode, setIsWeekendMode] = useState(isWeekend());
  const [journalEntries, setJournalEntries] = useState(() => {
    const saved = localStorage.getItem(STORAGE_KEYS.JOURNAL);
    return saved ? JSON.parse(saved) : [];
  });

  // Update time every second for real-time tracking
  useEffect(() => {
    const updateTime = () => {
      setCurrentTime(formatETTime(new Date()));
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

  // Save journal entries to localStorage
  useEffect(() => {
    localStorage.setItem(STORAGE_KEYS.JOURNAL, JSON.stringify(journalEntries));
  }, [journalEntries]);

  const handleAddEntry = useCallback((entry) => {
    setJournalEntries((prev) => [...prev, { ...entry, id: Date.now().toString() }]);
  }, []);

  const handleEditEntry = useCallback((updatedEntry) => {
    setJournalEntries((prev) =>
      prev.map((e) => (e.id === updatedEntry.id ? updatedEntry : e))
    );
  }, []);

  const handleDeleteEntry = useCallback((id) => {
    setJournalEntries((prev) => prev.filter((e) => e.id !== id));
  }, []);

  return (
    <div className="min-h-screen bg-[#191919] flex justify-center" data-testid="app-root">
      <div className="w-full max-w-[560px] min-h-screen px-5 pt-8 pb-40">
        <Header
          symbol={symbol}
          onSymbolChange={setSymbol}
          currentTime={currentTime}
          isWeekendMode={isWeekendMode}
        />
        
        {activeTab === "calculator" ? (
          <>
            <MarketSessions currentTime={currentTime} isWeekendMode={isWeekendMode} />
            <CalculatorTab symbol={symbol} />
          </>
        ) : (
          <CalendarTab
            journalEntries={journalEntries}
            onAddEntry={handleAddEntry}
            onEditEntry={handleEditEntry}
            onDeleteEntry={handleDeleteEntry}
          />
        )}
        
        <BottomNav activeTab={activeTab} onTabChange={setActiveTab} />
      </div>
    </div>
  );
}

export default App;
