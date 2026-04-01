import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { formatInTimeZone, toZonedTime } from 'date-fns-tz';
import './App.css';

const TZ = 'America/Toronto';

// ── Symbol Definitions ────────────────────────────────────────────────────────
const SYMBOLS = [
    { value: 'NQ',     label: 'NQ • $20/pt',    pointValue: 20,  isCrypto: false },
    { value: 'ES',     label: 'ES • $50/pt',    pointValue: 50,  isCrypto: false },
    { value: 'YM1!',   label: 'YM1! • $5/pt',   pointValue: 5,   isCrypto: false, wholeNumberOnly: true },
    { value: 'MNQ',    label: 'MNQ • $2/pt',    pointValue: 2,   isCrypto: false },
    { value: 'MES',    label: 'MES • $5/pt',    pointValue: 5,   isCrypto: false },
    { value: 'MGC1!',  label: 'MGC1! • $10/1.0',pointValue: 10,  isCrypto: false },
    { value: 'BTCUSD', label: 'BTCUSD • $1/1.0', pointValue: 1,  isCrypto: true  },
];

// ── Calculation Logic ──────────────────────────────────────────────────────────
const calculateRiskAndProfit = (symbolValue, riskAmount, stopPoints, tpPoints) => {
    const sym = SYMBOLS.find(s => s.value === symbolValue);
    if (!sym) return { contracts: 0, totalRisk: 0, tpProfit: 0 };

    let sp = parseFloat(stopPoints) || 0;
    const tp = parseFloat(tpPoints) || 0;
    const risk = parseFloat(riskAmount) || 0;

    if (sp <= 0 || risk <= 0) return { contracts: 0, totalRisk: 0, tpProfit: 0 };

    // YM moves in whole numbers — normalise decimal stop entries
    if (sym.wholeNumberOnly) sp = Math.round(sp);

    const riskPerContract = sp * sym.pointValue;
    if (riskPerContract <= 0) return { contracts: 0, totalRisk: 0, tpProfit: 0 };

    let contracts;
    if (sym.isCrypto) {
        contracts = Math.floor((risk / riskPerContract) * 10) / 10; // 1 decimal for crypto
    } else {
        contracts = Math.floor(risk / riskPerContract);
    }

    if (!sym.isCrypto && contracts > 40) contracts = 40;

    const totalRisk = sym.isCrypto
        ? contracts * riskPerContract
        : contracts * sp * sym.pointValue;
    const tpProfit = contracts * tp * sym.pointValue;

    return { contracts, totalRisk, tpProfit };
};

// ── Market Sessions ────────────────────────────────────────────────────────────
const SESSIONS = [
    { name: 'Asia Range',       start: 20, end: 24 },
    { name: 'London Killzone',  start: 2,  end: 5  },
    { name: 'NY Killzone',      start: 9.5,end: 11 },
    { name: 'Post Trade',       start: 11, end: 20 },
];

function getSessionStatus(session, now) {
    const h = now.getHours() + now.getMinutes() / 60;
    const { start, end } = session;
    const isOpen = h >= start && h < end;

    let diffMins;
    if (isOpen) {
        diffMins = Math.round((end - h) * 60);
    } else {
        let opensAt = start;
        if (h >= end) opensAt = start + 24;
        diffMins = Math.round((opensAt - h) * 60);
        if (diffMins < 0) diffMins += 24 * 60;
    }
    const hh = Math.floor(diffMins / 60);
    const mm = diffMins % 60;
    const countdown = hh > 0 ? `${hh}h ${mm}m` : `${mm}m`;
    return { isOpen, countdown };
}

// ── Checklist Data ─────────────────────────────────────────────────────────────
const CHECKLIST_SESSIONS = [
    {
        key: 'lock',
        label: 'Lock',
        items: [
            { id: 'l1', text: 'Review overnight price action' },
            { id: 'l2', text: 'Mark key HTF levels' },
            { id: 'l3', text: 'Check economic calendar' },
            { id: 'l4', text: 'Set risk parameters for the day' },
        ],
    },
    {
        key: 'pre',
        label: 'Pre',
        items: [
            { id: 'p1', text: 'Identify Asia high/low range' },
            { id: 'p2', text: 'Mark London open levels' },
            { id: 'p3', text: 'Define session bias' },
            { id: 'p4', text: 'Confirm entry criteria' },
        ],
    },
    {
        key: 'kz',
        label: 'KZ',
        items: [
            { id: 'k1', text: 'Wait for killzone window' },
            { id: 'k2', text: 'Confirm displacement or sweep' },
            { id: 'k3', text: 'Execute only with valid setup' },
            { id: 'k4', text: 'Set stop at structural invalidation' },
        ],
    },
    {
        key: 'post',
        label: 'Post',
        items: [
            { id: 'pt1', text: 'Review trade outcome' },
            { id: 'pt2', text: 'Screenshot entry & exit' },
            { id: 'pt3', text: 'Log result in journal' },
            { id: 'pt4', text: 'Identify improvement areas' },
        ],
    },
];

// ── localStorage Hook ──────────────────────────────────────────────────────────
function useLocalStorage(key, initialValue) {
    const [storedValue, setStoredValue] = useState(() => {
        try {
            const item = window.localStorage.getItem(key);
            return item ? JSON.parse(item) : initialValue;
        } catch {
            return initialValue;
        }
    });
    const setValue = useCallback((value) => {
        try {
            const valueToStore = typeof value === 'function' ? value(storedValue) : value;
            setStoredValue(valueToStore);
            window.localStorage.setItem(key, JSON.stringify(valueToStore));
        } catch {
            // ignore
        }
    }, [key, storedValue]);
    return [storedValue, setValue];
}

// ── Risk Tier ──────────────────────────────────────────────────────────────────
function getRiskTier(totalRisk) {
    if (totalRisk <= 0)    return null;
    if (totalRisk <= 500)  return { label: 'Low',    color: '#28E6A5' };
    if (totalRisk <= 1500) return { label: 'Medium', color: '#FFD34D' };
    return                        { label: 'High',   color: '#FF4D6D' };
}

// ── Format helpers ─────────────────────────────────────────────────────────────
function fmtCurrency(n) {
    if (!n && n !== 0) return '$0';
    const abs = Math.abs(n);
    const prefix = n < 0 ? '-$' : '$';
    if (abs >= 1000) return `${prefix}${(abs / 1000).toFixed(1)}k`;
    return `${prefix}${abs.toFixed(0)}`;
}

// ══════════════════════════════════════════════════════════════════════════════
// Main App Component
// ══════════════════════════════════════════════════════════════════════════════
export default function App() {
    // ── Tab ──────────────────────────────────────────────────────────────────
    const [activeTab, setActiveTab] = useLocalStorage('yasser_tab', 'calculator');

    // ── Time ─────────────────────────────────────────────────────────────────
    const [now, setNow] = useState(() => toZonedTime(new Date(), TZ));
    useEffect(() => {
        const id = setInterval(() => setNow(toZonedTime(new Date(), TZ)), 30_000);
        return () => clearInterval(id);
    }, []);
    const timeStr = formatInTimeZone(new Date(), TZ, 'h:mm a');

    // ── Calculator State ──────────────────────────────────────────────────────
    const [symbol, setSymbol]         = useLocalStorage('yasser_symbol', 'MNQ');
    const [riskAmount, setRiskAmount] = useLocalStorage('yasser_risk', '');
    const [stopPoints, setStopPoints] = useLocalStorage('yasser_stop', '');
    const [tpPoints, setTpPoints]     = useLocalStorage('yasser_tp', '');

    const calc = useMemo(
        () => calculateRiskAndProfit(symbol, riskAmount, stopPoints, tpPoints),
        [symbol, riskAmount, stopPoints, tpPoints]
    );

    const riskTier = getRiskTier(calc.totalRisk);

    const handleReset = () => {
        setRiskAmount('');
        setStopPoints('');
        setTpPoints('');
    };

    // ── Checklist State ───────────────────────────────────────────────────────
    const [clSession, setClSession] = useLocalStorage('yasser_cl_session', 'lock');
    const [clChecked, setClChecked] = useLocalStorage('yasser_cl_checked', {});

    const toggleCheck = (id) => {
        setClChecked(prev => ({ ...prev, [id]: !prev[id] }));
    };

    const currentCl = CHECKLIST_SESSIONS.find(s => s.key === clSession) || CHECKLIST_SESSIONS[0];
    const checkedCount = currentCl.items.filter(i => clChecked[i.id]).length;

    // ── Weekend detection ─────────────────────────────────────────────────────
    const dayOfWeek = now.getDay(); // 0=Sun, 6=Sat
    const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;

    // ── Render ────────────────────────────────────────────────────────────────
    return (
        <div style={{ minHeight: '100vh', background: '#0f0f0f', color: 'rgba(255,255,255,0.92)', display: 'flex', justifyContent: 'center', fontFamily: 'Inter, sans-serif' }}>
            <div style={{ width: '100%', maxWidth: 560, minHeight: '100vh', position: 'relative', paddingBottom: 100, paddingLeft: 20, paddingRight: 20, paddingTop: 32, display: 'flex', flexDirection: 'column', gap: 20 }}>

                {/* ── Calculator Tab ────────────────────────────────────────── */}
                {activeTab === 'calculator' && (
                    <>
                        {/* Header */}
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                            <h1 className="font-squids" style={{ fontSize: 28, letterSpacing: '0.15em', color: '#fff' }} data-testid="app-title">Y$ER</h1>
                            <select
                                data-testid="symbol-selector"
                                value={symbol}
                                onChange={e => setSymbol(e.target.value)}
                                style={{
                                    background: 'rgba(0,0,0,0.3)',
                                    border: '1px solid rgba(255,255,255,0.08)',
                                    borderRadius: 12,
                                    color: '#fff',
                                    padding: '8px 12px',
                                    fontFamily: 'JetBrains Mono, monospace',
                                    fontSize: 13,
                                    cursor: 'pointer',
                                    outline: 'none',
                                }}
                            >
                                {SYMBOLS.map(s => (
                                    <option key={s.value} value={s.value} style={{ background: '#1a1a1a' }}>
                                        {s.label}
                                    </option>
                                ))}
                            </select>
                        </div>

                        {/* Market Sessions */}
                        <div className="glass-panel" style={{ padding: 16 }}>
                            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
                                <span style={{ fontSize: 11, fontWeight: 600, letterSpacing: '0.08em', color: 'rgba(255,255,255,0.4)', textTransform: 'uppercase' }}>Market Sessions</span>
                                <span className="glass-pill" style={{ padding: '4px 10px', fontSize: 12, fontFamily: 'JetBrains Mono, monospace', color: 'rgba(255,255,255,0.7)' }} data-testid="et-clock">
                                    {timeStr} ET{isWeekend ? ' • Weekend' : ''}
                                </span>
                            </div>
                            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                                {SESSIONS.map(session => {
                                    const { isOpen, countdown } = getSessionStatus(session, now);
                                    return (
                                        <div key={session.name} className={`glass-card ${isOpen ? 'session-card-open' : ''}`} style={{ padding: '10px 14px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                                            <span style={{ fontSize: 13, color: isOpen ? '#fff' : 'rgba(255,255,255,0.5)' }}>{session.name}</span>
                                            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                                <span style={{ fontSize: 11, fontFamily: 'JetBrains Mono, monospace', color: 'rgba(255,255,255,0.4)' }}>
                                                    {isOpen ? `Closes in ${countdown}` : `Opens in ${countdown}`}
                                                </span>
                                                <span style={{
                                                    fontSize: 10, fontWeight: 700, letterSpacing: '0.06em',
                                                    padding: '2px 8px', borderRadius: 6,
                                                    background: isOpen ? 'rgba(40,230,165,0.12)' : 'rgba(255,255,255,0.04)',
                                                    color: isOpen ? '#28E6A5' : 'rgba(255,255,255,0.3)',
                                                    border: `1px solid ${isOpen ? 'rgba(40,230,165,0.2)' : 'rgba(255,255,255,0.06)'}`,
                                                }}>
                                                    {isOpen ? 'OPEN' : 'CLOSED'}
                                                </span>
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                        </div>

                        {/* Calculator */}
                        <div className="glass-panel" style={{ padding: 20 }}>
                            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
                                <span style={{ fontSize: 11, fontWeight: 600, letterSpacing: '0.08em', color: 'rgba(255,255,255,0.4)', textTransform: 'uppercase' }}>Position Size</span>
                                {riskTier && (
                                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                                        <span style={{ width: 7, height: 7, borderRadius: '50%', background: riskTier.color, boxShadow: `0 0 6px ${riskTier.color}` }} />
                                        <span style={{ fontSize: 11, fontWeight: 600, color: riskTier.color }}>{riskTier.label} Risk</span>
                                    </div>
                                )}
                            </div>

                            {/* Inputs */}
                            <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 16 }}>
                                <div>
                                    <label style={{ fontSize: 11, color: 'rgba(255,255,255,0.4)', marginBottom: 4, display: 'block' }}>Risk ($)</label>
                                    <input
                                        data-testid="risk-input"
                                        type="number"
                                        placeholder="0"
                                        value={riskAmount}
                                        onChange={e => setRiskAmount(e.target.value)}
                                        className="glass-input"
                                        style={{ width: '100%', height: 48, padding: '0 16px', color: '#fff', fontSize: 16, outline: 'none', fontFamily: 'JetBrains Mono, monospace' }}
                                    />
                                </div>
                                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                                    <div>
                                        <label style={{ fontSize: 11, color: 'rgba(255,255,255,0.4)', marginBottom: 4, display: 'block' }}>Stop (PTS)</label>
                                        <input
                                            data-testid="stop-input"
                                            type="number"
                                            placeholder="0"
                                            value={stopPoints}
                                            onChange={e => setStopPoints(e.target.value)}
                                            className="glass-input"
                                            style={{ width: '100%', height: 48, padding: '0 16px', color: '#fff', fontSize: 16, outline: 'none', fontFamily: 'JetBrains Mono, monospace' }}
                                        />
                                    </div>
                                    <div>
                                        <label style={{ fontSize: 11, color: 'rgba(255,255,255,0.4)', marginBottom: 4, display: 'block' }}>TP (PTS)</label>
                                        <input
                                            data-testid="tp-input"
                                            type="number"
                                            placeholder="0"
                                            value={tpPoints}
                                            onChange={e => setTpPoints(e.target.value)}
                                            className="glass-input"
                                            style={{ width: '100%', height: 48, padding: '0 16px', color: '#fff', fontSize: 16, outline: 'none', fontFamily: 'JetBrains Mono, monospace' }}
                                        />
                                    </div>
                                </div>
                            </div>

                            {/* Results */}
                            <div className="glass-card" style={{ padding: 16, marginBottom: 12 }}>
                                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12 }}>
                                    <div style={{ textAlign: 'center' }}>
                                        <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.4)', marginBottom: 4 }}>Contracts</div>
                                        <div data-testid="contracts-result" style={{ fontSize: 22, fontWeight: 700, fontFamily: 'JetBrains Mono, monospace', color: '#fff' }}>
                                            {calc.contracts}
                                        </div>
                                    </div>
                                    <div style={{ textAlign: 'center' }}>
                                        <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.4)', marginBottom: 4 }}>Total Risk</div>
                                        <div data-testid="total-risk-result" style={{ fontSize: 22, fontWeight: 700, fontFamily: 'JetBrains Mono, monospace', color: '#FF4D6D' }}>
                                            {fmtCurrency(calc.totalRisk)}
                                        </div>
                                    </div>
                                    <div style={{ textAlign: 'center' }}>
                                        <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.4)', marginBottom: 4 }}>TP Profit</div>
                                        <div data-testid="tp-profit-result" style={{ fontSize: 22, fontWeight: 700, fontFamily: 'JetBrains Mono, monospace', color: '#28E6A5' }}>
                                            {fmtCurrency(calc.tpProfit)}
                                        </div>
                                    </div>
                                </div>
                            </div>

                            {/* Reset */}
                            <div className="glass-card" style={{ padding: 8 }}>
                                <button
                                    data-testid="reset-btn"
                                    onClick={handleReset}
                                    style={{
                                        width: '100%', height: 36, background: 'transparent',
                                        border: 'none', cursor: 'pointer', borderRadius: 10,
                                        fontSize: 12, color: 'rgba(255,77,109,0.7)', fontWeight: 600, letterSpacing: '0.04em',
                                    }}
                                >
                                    Reset Inputs
                                </button>
                            </div>
                        </div>
                    </>
                )}

                {/* ── Checklist Tab ─────────────────────────────────────────── */}
                {activeTab === 'checklist' && (
                    <>
                        {/* Clock pill */}
                        <div style={{ display: 'flex', justifyContent: 'center' }}>
                            <span className="glass-pill" style={{ padding: '6px 16px', fontSize: 13, fontFamily: 'JetBrains Mono, monospace', color: 'rgba(255,255,255,0.7)' }}>
                                {timeStr} ET{isWeekend ? ' • Weekend' : ''}
                            </span>
                        </div>

                        {/* Session tabs */}
                        <div className="glass-panel" style={{ padding: 16 }}>
                            <div style={{ display: 'flex', gap: 6, marginBottom: 16 }}>
                                {CHECKLIST_SESSIONS.map(s => (
                                    <button
                                        key={s.key}
                                        data-testid={`cl-tab-${s.key}`}
                                        onClick={() => setClSession(s.key)}
                                        style={{
                                            flex: 1, height: 36, borderRadius: 10, border: 'none', cursor: 'pointer', fontSize: 12, fontWeight: 600,
                                            background: clSession === s.key ? 'rgba(77,159,255,0.2)' : 'rgba(255,255,255,0.03)',
                                            color: clSession === s.key ? '#4D9FFF' : 'rgba(255,255,255,0.4)',
                                            borderWidth: 1, borderStyle: 'solid',
                                            borderColor: clSession === s.key ? 'rgba(77,159,255,0.3)' : 'rgba(255,255,255,0.04)',
                                        }}
                                    >
                                        {s.label}
                                    </button>
                                ))}
                            </div>

                            {/* Progress */}
                            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
                                <span style={{ fontSize: 12, color: 'rgba(255,255,255,0.5)' }}>{currentCl.label} Checklist</span>
                                <span style={{ fontSize: 12, fontFamily: 'JetBrains Mono, monospace', color: checkedCount === currentCl.items.length ? '#28E6A5' : 'rgba(255,255,255,0.4)' }}>
                                    {checkedCount}/{currentCl.items.length}
                                </span>
                            </div>

                            {/* Items */}
                            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                                {currentCl.items.map(item => (
                                    <button
                                        key={item.id}
                                        data-testid={`cl-item-${item.id}`}
                                        onClick={() => toggleCheck(item.id)}
                                        className="glass-card"
                                        style={{
                                            padding: '12px 14px', display: 'flex', alignItems: 'center', gap: 12,
                                            background: clChecked[item.id] ? 'rgba(40,230,165,0.06)' : 'rgba(255,255,255,0.02)',
                                            border: `1px solid ${clChecked[item.id] ? 'rgba(40,230,165,0.15)' : 'rgba(255,255,255,0.04)'}`,
                                            borderRadius: 14, cursor: 'pointer', textAlign: 'left', width: '100%',
                                        }}
                                    >
                                        <div style={{
                                            width: 18, height: 18, borderRadius: 6, flexShrink: 0,
                                            border: `1.5px solid ${clChecked[item.id] ? '#28E6A5' : 'rgba(255,255,255,0.2)'}`,
                                            background: clChecked[item.id] ? 'rgba(40,230,165,0.25)' : 'transparent',
                                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                                        }}>
                                            {clChecked[item.id] && (
                                                <svg width="10" height="8" viewBox="0 0 10 8" fill="none">
                                                    <path d="M1 4L3.5 6.5L9 1" stroke="#28E6A5" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                                                </svg>
                                            )}
                                        </div>
                                        <span style={{ fontSize: 13, color: clChecked[item.id] ? 'rgba(255,255,255,0.5)' : 'rgba(255,255,255,0.85)', textDecoration: clChecked[item.id] ? 'line-through' : 'none' }}>
                                            {item.text}
                                        </span>
                                    </button>
                                ))}
                            </div>
                        </div>
                    </>
                )}

            </div>

            {/* ── Bottom Navigation ──────────────────────────────────────────── */}
            <nav style={{
                position: 'fixed', bottom: 0, left: '50%', transform: 'translateX(-50%)',
                width: '100%', maxWidth: 560,
                background: 'rgba(15,15,15,0.92)', backdropFilter: 'blur(20px)',
                borderTop: '1px solid rgba(255,255,255,0.05)',
                display: 'flex', justifyContent: 'space-around', padding: '10px 0 16px',
                zIndex: 50,
            }}>
                <button
                    data-testid="nav-calculator-btn"
                    onClick={() => setActiveTab('calculator')}
                    style={{
                        background: 'none', border: 'none', cursor: 'pointer',
                        display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4,
                        color: activeTab === 'calculator' ? '#4D9FFF' : 'rgba(255,255,255,0.35)',
                        fontSize: 10, fontWeight: 600, letterSpacing: '0.04em',
                    }}
                >
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                        <rect x="4" y="2" width="16" height="20" rx="2" />
                        <line x1="8" y1="6" x2="16" y2="6" />
                        <line x1="8" y1="10" x2="16" y2="10" />
                        <line x1="8" y1="14" x2="12" y2="14" />
                    </svg>
                    CALC
                </button>
                <button
                    data-testid="nav-checklist-btn"
                    onClick={() => setActiveTab('checklist')}
                    style={{
                        background: 'none', border: 'none', cursor: 'pointer',
                        display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4,
                        color: activeTab === 'checklist' ? '#4D9FFF' : 'rgba(255,255,255,0.35)',
                        fontSize: 10, fontWeight: 600, letterSpacing: '0.04em',
                    }}
                >
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                        <polyline points="9 11 12 14 22 4" />
                        <path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" />
                    </svg>
                    LIST
                </button>
            </nav>
        </div>
    );
}
