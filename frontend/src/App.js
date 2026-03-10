import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { toZonedTime } from 'date-fns-tz';

const ET_TZ = 'America/New_York';

// --- Session Configuration ---
const SESSIONS = [
  { id: 'asia',   label: 'Asia Range',  startH: 20, startM: 0,  endH: 0,  endM: 0,  crossesMidnight: true,  checklistKey: 'lock' },
  { id: 'london', label: 'London KZ',   startH: 2,  startM: 0,  endH: 5,  endM: 0,  crossesMidnight: false, checklistKey: 'pre'  },
  { id: 'ny',     label: 'NY Killzone', startH: 9,  startM: 30, endH: 11, endM: 0,  crossesMidnight: false, checklistKey: 'kz'   },
  { id: 'post',   label: 'Post Trade',  startH: 11, startM: 0,  endH: 20, endM: 0,  crossesMidnight: false, checklistKey: 'post' },
];

// --- Checklist Configuration ---
const CHECKLIST_GROUPS = {
  lock: {
    label: 'Lock',
    items: [
      { id: 'lock-1', text: 'Review daily bias & trade plan' },
      { id: 'lock-2', text: 'Set price alerts for key levels' },
      { id: 'lock-3', text: 'Check overnight news & events' },
      { id: 'lock-4', text: 'Mark support & resistance zones' },
      { id: 'lock-5', text: 'Set max daily loss limit' },
    ],
  },
  pre: {
    label: 'Pre',
    items: [
      { id: 'pre-1', text: 'Review Asia session range & levels' },
      { id: 'pre-2', text: 'Mark London open liquidity zones' },
      { id: 'pre-3', text: 'Check early London news events' },
      { id: 'pre-4', text: 'Confirm overall BIAS direction' },
      { id: 'pre-5', text: 'Identify London KZ entry zones' },
    ],
  },
  kz: {
    label: 'KZ',
    items: [
      { id: 'kz-1', text: 'Mark NY opening range & levels' },
      { id: 'kz-2', text: 'Identify displacement & FVG zones' },
      { id: 'kz-3', text: 'Confirm BIAS alignment with higher TF' },
      { id: 'kz-4', text: 'Locate optimal trade entry zones' },
      { id: 'kz-5', text: 'Execute trades per plan & manage risk' },
    ],
  },
  post: {
    label: 'Post',
    items: [
      { id: 'post-1', text: 'Review all trades taken today' },
      { id: 'post-2', text: 'Mark entries & exits on chart' },
      { id: 'post-3', text: 'Journal trade outcome & notes' },
      { id: 'post-4', text: 'Calculate & record daily P&L' },
      { id: 'post-5', text: 'Note key lessons & improvements' },
    ],
  },
};

// --- Symbol Configuration ---
const SYMBOLS_CONFIG = {
  MNQ:     { label: 'MNQ',   multiplier: 2,  decimalPlaces: 0, contractFactor: 1 },
  MES:     { label: 'MES',   multiplier: 5,  decimalPlaces: 0, contractFactor: 1 },
  'MGC1!': { label: 'MGC1!', multiplier: 10, decimalPlaces: 0, contractFactor: 1 },
  BTCUSD:  { label: 'BTC',   multiplier: 1,  decimalPlaces: 1, contractFactor: 10 },
};

// --- Helper Functions ---
function getEtNow() {
  return toZonedTime(new Date(), ET_TZ);
}

function checkIsWeekend(etNow) {
  const dow = etNow.getDay();
  const totalMins = etNow.getHours() * 60 + etNow.getMinutes();
  return (
    dow === 6 ||
    (dow === 5 && totalMins >= 17 * 60) ||
    (dow === 0 && totalMins < 18 * 60)
  );
}

function computeSessionOpen(session, etNow) {
  const totalMins = etNow.getHours() * 60 + etNow.getMinutes();
  if (session.crossesMidnight) {
    return totalMins >= session.startH * 60 + session.startM;
  }
  const startMins = session.startH * 60 + session.startM;
  const endMins = session.endH * 60 + session.endM;
  return totalMins >= startMins && totalMins < endMins;
}

function computeSecsUntilChange(session, isOpen, etNow) {
  const totalSecs = etNow.getHours() * 3600 + etNow.getMinutes() * 60 + etNow.getSeconds();
  const startSecs = session.startH * 3600 + session.startM * 60;
  const endSecs = session.crossesMidnight ? 24 * 3600 : session.endH * 3600 + session.endM * 60;

  if (isOpen) {
    return Math.max(0, endSecs - totalSecs);
  }
  if (totalSecs < startSecs) {
    return startSecs - totalSecs;
  }
  return 24 * 3600 - totalSecs + startSecs;
}

function formatDuration(totalSecs) {
  if (totalSecs <= 0) return '0:00';
  const h = Math.floor(totalSecs / 3600);
  const m = Math.floor((totalSecs % 3600) / 60);
  const s = totalSecs % 60;
  if (h > 0) {
    return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  }
  return `${m}:${String(s).padStart(2, '0')}`;
}

function formatEtTime(etNow) {
  const h = etNow.getHours();
  const m = etNow.getMinutes();
  const s = etNow.getSeconds();
  const ampm = h >= 12 ? 'PM' : 'AM';
  const h12 = h % 12 || 12;
  return `${h12}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')} ${ampm} ET`;
}

function getRiskTier(totalRisk) {
  if (!totalRisk || totalRisk <= 0) return null;
  if (totalRisk <= 500) return { label: 'LOW', color: '#28E6A5' };
  if (totalRisk <= 1500) return { label: 'MED', color: '#FFD34D' };
  return { label: 'HIGH', color: '#FF4D6D' };
}

function buildSessionStates(etNow) {
  const weekend = checkIsWeekend(etNow);
  return SESSIONS.map(s => {
    const isOpen = !weekend && computeSessionOpen(s, etNow);
    const secsUntilChange = weekend ? null : computeSecsUntilChange(s, isOpen, etNow);
    return { ...s, isOpen, secsUntilChange };
  });
}

function getActiveChecklistKey(etNow) {
  if (checkIsWeekend(etNow)) return null;
  for (const s of SESSIONS) {
    if (computeSessionOpen(s, etNow)) return s.checklistKey;
  }
  return null;
}

// --- Main App Component ---
export default function App() {
  const [etNow, setEtNow] = useState(getEtNow);
  const [sessionStates, setSessionStates] = useState(() => buildSessionStates(getEtNow()));

  // Track previous open states for diff (ref avoids triggering re-renders)
  const prevIsOpenRef = useRef(null);

  // Activating sessions (CSS activation animation)
  const [activatingSessions, setActivatingSessions] = useState(() => new Set());

  // Active tab
  const [activeTab, setActiveTab] = useState('calculator');

  // Checklist group — initialize from active session or localStorage
  const [checklistGroup, setChecklistGroup] = useState(() => {
    const stored = localStorage.getItem('crtv-checklist-group');
    if (stored && CHECKLIST_GROUPS[stored]) return stored;
    const now = getEtNow();
    return getActiveChecklistKey(now) || 'kz';
  });

  // Checked items (persisted)
  const [checkedItems, setCheckedItems] = useState(() => {
    try {
      const stored = localStorage.getItem('crtv-checklist-items');
      return stored ? JSON.parse(stored) : {};
    } catch {
      return {};
    }
  });

  // Calculator state (persisted)
  const [symbol, setSymbol] = useState(() => localStorage.getItem('crtv-symbol') || 'MNQ');
  const [risk, setRisk] = useState(() => localStorage.getItem('crtv-risk') || '');
  const [stop, setStop] = useState(() => localStorage.getItem('crtv-stop') || '');
  const [tp, setTp] = useState(() => localStorage.getItem('crtv-tp') || '');

  const weekendMode = checkIsWeekend(etNow);

  // 1-second tick: update clock + session states, detect transitions
  useEffect(() => {
    // Seed the previous-state ref on mount
    prevIsOpenRef.current = buildSessionStates(getEtNow()).map(s => s.isOpen);

    const tick = () => {
      const now = getEtNow();
      const newStates = buildSessionStates(now);
      const prevIsOpen = prevIsOpenRef.current;

      if (prevIsOpen) {
        // Detect sessions that just opened
        const newlyOpened = newStates.filter((s, i) => s.isOpen && !prevIsOpen[i]);

        if (newlyOpened.length > 0) {
          const openingIds = newlyOpened.map(s => s.id);

          // Trigger activation animation
          setActivatingSessions(prev => new Set([...prev, ...openingIds]));
          setTimeout(() => {
            setActivatingSessions(prev => {
              const next = new Set(prev);
              openingIds.forEach(id => next.delete(id));
              return next;
            });
          }, 380);

          // Auto-switch checklist to first newly-opened session
          const newKey = newlyOpened[0].checklistKey;
          setChecklistGroup(newKey);
          localStorage.setItem('crtv-checklist-group', newKey);
        }
      }

      prevIsOpenRef.current = newStates.map(s => s.isOpen);
      setEtNow(now);
      setSessionStates(newStates);
    };

    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
    // Empty deps: interval is set up once on mount; dynamic values are read via
    // prevIsOpenRef (a ref) and stable useState setters — no stale closures.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Persist calculator inputs
  useEffect(() => { localStorage.setItem('crtv-symbol', symbol); }, [symbol]);
  useEffect(() => { localStorage.setItem('crtv-risk', risk); }, [risk]);
  useEffect(() => { localStorage.setItem('crtv-stop', stop); }, [stop]);
  useEffect(() => { localStorage.setItem('crtv-tp', tp); }, [tp]);

  // Persist checklist items
  useEffect(() => {
    localStorage.setItem('crtv-checklist-items', JSON.stringify(checkedItems));
  }, [checkedItems]);

  // Calculator result
  const calcResult = useMemo(() => {
    const riskAmt = parseFloat(risk) || 0;
    const stopPts = parseFloat(stop) || 0;
    const tpPts = parseFloat(tp) || 0;
    if (!riskAmt || !stopPts) return null;

    const symCfg = SYMBOLS_CONFIG[symbol];
    const riskPerContract = stopPts * symCfg.multiplier;
    if (riskPerContract === 0) return null;

    let rawContracts = riskAmt / riskPerContract;
    let contracts;
    if (symCfg.contractFactor > 1) {
      contracts = Math.floor(rawContracts * symCfg.contractFactor) / symCfg.contractFactor;
    } else {
      contracts = Math.floor(rawContracts);
    }
    contracts = Math.min(contracts, 40);
    if (contracts <= 0) return null;

    const totalRisk = contracts * riskPerContract;
    const tpProfit = tpPts > 0 ? contracts * tpPts * symCfg.multiplier : 0;
    const rr = totalRisk > 0 && tpProfit > 0 ? (tpProfit / totalRisk).toFixed(2) : null;

    return { contracts, totalRisk, tpProfit, rr };
  }, [symbol, risk, stop, tp]);

  const riskTier = calcResult ? getRiskTier(calcResult.totalRisk) : null;

  const handleChecklistTabClick = useCallback((key) => {
    setChecklistGroup(key);
    localStorage.setItem('crtv-checklist-group', key);
  }, []);

  const handleItemToggle = useCallback((itemId) => {
    setCheckedItems(prev => ({ ...prev, [itemId]: !prev[itemId] }));
  }, []);

  const handleReset = useCallback(() => {
    setRisk('');
    setStop('');
    setTp('');
    localStorage.removeItem('crtv-risk');
    localStorage.removeItem('crtv-stop');
    localStorage.removeItem('crtv-tp');
  }, []);

  const etTimeStr = formatEtTime(etNow);
  const currentGroup = CHECKLIST_GROUPS[checklistGroup];
  const checkedCount = currentGroup.items.filter(it => checkedItems[it.id]).length;
  const progress = Math.round((checkedCount / currentGroup.items.length) * 100);

  return (
    <div style={{
      minHeight: '100vh',
      background: '#191919',
      color: 'rgba(255,255,255,0.92)',
      display: 'flex',
      justifyContent: 'center',
      fontFamily: "'Inter', -apple-system, BlinkMacSystemFont, sans-serif",
      WebkitFontSmoothing: 'antialiased',
    }}>
      <div style={{
        width: '100%',
        maxWidth: '560px',
        minHeight: '100vh',
        position: 'relative',
        paddingBottom: '96px',
        paddingLeft: '20px',
        paddingRight: '20px',
        paddingTop: '32px',
        display: 'flex',
        flexDirection: 'column',
        gap: '20px',
      }}>

        {/* ── Header ── */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h1 className="font-squids" data-testid="app-title" style={{ fontSize: '24px', color: 'white' }}>
            CRTV
          </h1>
          <div
            className="glass-pill"
            data-testid="et-clock"
            style={{
              padding: '6px 14px',
              fontSize: '12px',
              fontFamily: "'JetBrains Mono', monospace",
              color: 'rgba(255,255,255,0.65)',
            }}
          >
            {etTimeStr}
          </div>
        </div>

        {/* ══ CALCULATOR TAB ══ */}
        {activeTab === 'calculator' && (
          <>
            {/* Market Sessions Panel */}
            <div className="glass-panel" style={{ padding: '16px' }}>
              <div style={{
                marginBottom: '12px',
                fontSize: '10px',
                fontWeight: 600,
                letterSpacing: '0.1em',
                color: 'rgba(255,255,255,0.35)',
                textTransform: 'uppercase',
              }}>
                Market Sessions
              </div>

              {weekendMode ? (
                <div style={{
                  textAlign: 'center',
                  padding: '18px 0',
                  color: 'rgba(255,255,255,0.3)',
                  fontSize: '13px',
                }}>
                  Market Closed · Opens Sun 6 PM ET
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  {sessionStates.map(session => {
                    const isActivating = activatingSessions.has(session.id);
                    return (
                      <div
                        key={session.id}
                        data-testid={`session-card-${session.id}`}
                        className={[
                          'glass-card',
                          'session-card',
                          session.isOpen ? 'session-card-open' : '',
                          isActivating ? 'session-card-activating' : '',
                        ].filter(Boolean).join(' ')}
                        style={{
                          padding: '11px 14px',
                          display: 'flex',
                          justifyContent: 'space-between',
                          alignItems: 'center',
                        }}
                      >
                        <div>
                          <div style={{
                            fontSize: '13px',
                            fontWeight: 600,
                            color: session.isOpen ? 'rgba(255,255,255,0.95)' : 'rgba(255,255,255,0.55)',
                          }}>
                            {session.label}
                          </div>
                          <div style={{
                            fontSize: '11px',
                            color: 'rgba(255,255,255,0.3)',
                            marginTop: '2px',
                            fontFamily: "'JetBrains Mono', monospace",
                          }}>
                            {session.secsUntilChange != null
                              ? session.isOpen
                                ? `Closes in ${formatDuration(session.secsUntilChange)}`
                                : `Opens in ${formatDuration(session.secsUntilChange)}`
                              : '\u2014'}
                          </div>
                        </div>

                        {/* Crossfade OPEN / CLOSED badge */}
                        <div style={{ position: 'relative', width: '52px', height: '16px', flexShrink: 0 }}>
                          <span style={{
                            position: 'absolute',
                            inset: 0,
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'flex-end',
                            fontSize: '10px',
                            fontWeight: 700,
                            letterSpacing: '0.06em',
                            color: '#28E6A5',
                            opacity: session.isOpen ? 1 : 0,
                            transition: 'opacity 280ms cubic-bezier(.2,.9,.2,1)',
                            pointerEvents: 'none',
                          }}>OPEN</span>
                          <span style={{
                            position: 'absolute',
                            inset: 0,
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'flex-end',
                            fontSize: '10px',
                            fontWeight: 700,
                            letterSpacing: '0.06em',
                            color: 'rgba(255,255,255,0.28)',
                            opacity: session.isOpen ? 0 : 1,
                            transition: 'opacity 280ms cubic-bezier(.2,.9,.2,1)',
                            pointerEvents: 'none',
                          }}>CLOSED</span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Position Calculator Panel */}
            <div className="glass-panel" style={{ padding: '16px' }}>
              <div style={{
                marginBottom: '12px',
                fontSize: '10px',
                fontWeight: 600,
                letterSpacing: '0.1em',
                color: 'rgba(255,255,255,0.35)',
                textTransform: 'uppercase',
              }}>
                Position Calculator
              </div>

              {/* Symbol selector */}
              <div style={{ display: 'flex', gap: '6px', marginBottom: '14px' }}>
                {Object.entries(SYMBOLS_CONFIG).map(([key, sym]) => (
                  <button
                    key={key}
                    data-testid={`symbol-${key}`}
                    onClick={() => setSymbol(key)}
                    className="glass-button"
                    style={{
                      flex: 1,
                      padding: '8px 4px',
                      fontSize: '12px',
                      fontWeight: 600,
                      cursor: 'pointer',
                      color: symbol === key ? '#4D9FFF' : 'rgba(255,255,255,0.45)',
                      border: `1px solid ${symbol === key ? 'rgba(77,159,255,0.3)' : 'rgba(255,255,255,0.04)'}`,
                      background: symbol === key ? 'rgba(77,159,255,0.08)' : 'rgba(255,255,255,0.02)',
                      borderRadius: '10px',
                    }}
                  >
                    {sym.label}
                  </button>
                ))}
              </div>

              {/* Inputs */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                <div>
                  <label style={{ fontSize: '11px', color: 'rgba(255,255,255,0.35)', marginBottom: '4px', display: 'block' }}>
                    Risk ($)
                  </label>
                  <input
                    type="number"
                    data-testid="input-risk"
                    className="glass-input"
                    value={risk}
                    onChange={e => setRisk(e.target.value)}
                    placeholder="500"
                    style={{ width: '100%', padding: '10px 14px', color: 'white', fontSize: '15px', fontFamily: "'JetBrains Mono', monospace", outline: 'none' }}
                  />
                </div>
                <div style={{ display: 'flex', gap: '10px' }}>
                  <div style={{ flex: 1 }}>
                    <label style={{ fontSize: '11px', color: 'rgba(255,255,255,0.35)', marginBottom: '4px', display: 'block' }}>
                      Stop (pts)
                    </label>
                    <input
                      type="number"
                      data-testid="input-stop"
                      className="glass-input"
                      value={stop}
                      onChange={e => setStop(e.target.value)}
                      placeholder="10"
                      style={{ width: '100%', padding: '10px 14px', color: 'white', fontSize: '15px', fontFamily: "'JetBrains Mono', monospace", outline: 'none' }}
                    />
                  </div>
                  <div style={{ flex: 1 }}>
                    <label style={{ fontSize: '11px', color: 'rgba(255,255,255,0.35)', marginBottom: '4px', display: 'block' }}>
                      TP (pts)
                    </label>
                    <input
                      type="number"
                      data-testid="input-tp"
                      className="glass-input"
                      value={tp}
                      onChange={e => setTp(e.target.value)}
                      placeholder="20"
                      style={{ width: '100%', padding: '10px 14px', color: 'white', fontSize: '15px', fontFamily: "'JetBrains Mono', monospace", outline: 'none' }}
                    />
                  </div>
                </div>
              </div>

              {/* Calculation Results */}
              {calcResult && (
                <div
                  className="glass-card"
                  data-testid="calc-results"
                  style={{ marginTop: '14px', padding: '14px', display: 'flex', flexDirection: 'column', gap: '10px' }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                    <div>
                      <div style={{ fontSize: '10px', color: 'rgba(255,255,255,0.35)', marginBottom: '3px', letterSpacing: '0.06em' }}>
                        CONTRACTS
                      </div>
                      <div style={{ fontSize: '24px', fontWeight: 700, fontFamily: "'JetBrains Mono', monospace" }}>
                        {calcResult.contracts}
                      </div>
                    </div>
                    <div style={{ textAlign: 'right' }}>
                      <div style={{ fontSize: '10px', color: 'rgba(255,255,255,0.35)', marginBottom: '3px', letterSpacing: '0.06em' }}>
                        RISK
                      </div>
                      <div style={{ fontSize: '24px', fontWeight: 700, fontFamily: "'JetBrains Mono', monospace", color: '#FF4D6D' }}>
                        ${calcResult.totalRisk.toLocaleString()}
                      </div>
                    </div>
                  </div>

                  {calcResult.tpProfit > 0 && (
                    <div style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'flex-start',
                      borderTop: '1px solid rgba(255,255,255,0.05)',
                      paddingTop: '10px',
                    }}>
                      <div>
                        <div style={{ fontSize: '10px', color: 'rgba(255,255,255,0.35)', marginBottom: '3px', letterSpacing: '0.06em' }}>
                          TP PROFIT
                        </div>
                        <div style={{ fontSize: '20px', fontWeight: 700, color: '#28E6A5', fontFamily: "'JetBrains Mono', monospace" }}>
                          ${calcResult.tpProfit.toLocaleString()}
                        </div>
                      </div>
                      {calcResult.rr && (
                        <div style={{ textAlign: 'right' }}>
                          <div style={{ fontSize: '10px', color: 'rgba(255,255,255,0.35)', marginBottom: '3px', letterSpacing: '0.06em' }}>
                            R:R
                          </div>
                          <div style={{ fontSize: '20px', fontWeight: 700, fontFamily: "'JetBrains Mono', monospace" }}>
                            1:{calcResult.rr}
                          </div>
                        </div>
                      )}
                    </div>
                  )}

                  {/* Risk Tier indicator */}
                  {riskTier && (
                    <div style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '8px',
                      borderTop: '1px solid rgba(255,255,255,0.05)',
                      paddingTop: '10px',
                    }}>
                      <div style={{
                        width: '8px',
                        height: '8px',
                        borderRadius: '50%',
                        background: riskTier.color,
                        boxShadow: `0 0 8px ${riskTier.color}55`,
                        flexShrink: 0,
                      }} />
                      <span style={{ fontSize: '12px', fontWeight: 600, color: riskTier.color }}>
                        {riskTier.label} RISK
                      </span>
                    </div>
                  )}
                </div>
              )}

              {/* Reset button */}
              <div style={{ marginTop: '10px' }}>
                <button
                  data-testid="btn-reset"
                  onClick={handleReset}
                  className="glass-button"
                  style={{
                    width: '100%',
                    padding: '8px',
                    fontSize: '12px',
                    color: 'rgba(255,255,255,0.35)',
                    cursor: 'pointer',
                    border: '1px solid rgba(255,255,255,0.04)',
                  }}
                >
                  Reset Inputs
                </button>
              </div>
            </div>
          </>
        )}

        {/* ══ CHECKLIST TAB ══ */}
        {activeTab === 'checklist' && (
          <>
            {/* Session group tabs */}
            <div className="glass-panel" style={{ padding: '6px' }}>
              <div style={{ display: 'flex', gap: '4px' }}>
                {Object.entries(CHECKLIST_GROUPS).map(([key, group]) => {
                  const isActive = checklistGroup === key;
                  const relatedSession = sessionStates.find(s => s.checklistKey === key);
                  const sessionOpen = relatedSession ? relatedSession.isOpen : false;
                  return (
                    <button
                      key={key}
                      data-testid={`checklist-tab-${key}`}
                      onClick={() => handleChecklistTabClick(key)}
                      style={{
                        flex: 1,
                        padding: '10px 6px',
                        borderRadius: '10px',
                        fontSize: '12px',
                        fontWeight: 700,
                        letterSpacing: '0.04em',
                        cursor: 'pointer',
                        background: isActive
                          ? 'rgba(77,159,255,0.12)'
                          : sessionOpen
                            ? 'rgba(40,230,165,0.05)'
                            : 'transparent',
                        color: isActive
                          ? '#4D9FFF'
                          : sessionOpen
                            ? '#28E6A5'
                            : 'rgba(255,255,255,0.4)',
                        border: isActive
                          ? '1px solid rgba(77,159,255,0.25)'
                          : sessionOpen
                            ? '1px solid rgba(40,230,165,0.18)'
                            : '1px solid transparent',
                        transition: 'background 200ms ease, color 200ms ease, border-color 200ms ease',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        gap: '5px',
                      }}
                    >
                      {group.label}
                      {sessionOpen && (
                        <span style={{
                          width: '5px',
                          height: '5px',
                          borderRadius: '50%',
                          background: '#28E6A5',
                          flexShrink: 0,
                          display: 'inline-block',
                        }} />
                      )}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Checklist Items */}
            <div className="glass-panel" style={{ padding: '16px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
                <div style={{ fontSize: '13px', fontWeight: 600, color: 'rgba(255,255,255,0.7)' }}>
                  {currentGroup.label} Checklist
                </div>
                <div style={{ fontSize: '12px', color: 'rgba(255,255,255,0.35)', fontFamily: "'JetBrains Mono', monospace" }}>
                  {checkedCount}/{currentGroup.items.length}
                </div>
              </div>

              {/* Progress bar */}
              <div style={{
                height: '2px',
                background: 'rgba(255,255,255,0.06)',
                borderRadius: '1px',
                marginBottom: '14px',
                overflow: 'hidden',
              }}>
                <div style={{
                  height: '100%',
                  background: '#28E6A5',
                  width: `${progress}%`,
                  borderRadius: '1px',
                  transition: 'width 300ms ease',
                }} />
              </div>

              {/* Items */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '7px' }}>
                {currentGroup.items.map(item => {
                  const checked = !!checkedItems[item.id];
                  return (
                    <button
                      key={item.id}
                      data-testid={`checklist-item-${item.id}`}
                      onClick={() => handleItemToggle(item.id)}
                      className="glass-card"
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: '12px',
                        padding: '11px 13px',
                        textAlign: 'left',
                        cursor: 'pointer',
                        width: '100%',
                        background: checked ? 'rgba(40,230,165,0.04)' : 'rgba(255,255,255,0.02)',
                        border: `1px solid ${checked ? 'rgba(40,230,165,0.12)' : 'rgba(255,255,255,0.04)'}`,
                        transition: 'background 180ms ease, border-color 180ms ease',
                      }}
                    >
                      {/* Checkbox */}
                      <div style={{
                        width: '19px',
                        height: '19px',
                        borderRadius: '5px',
                        border: `1.5px solid ${checked ? '#28E6A5' : 'rgba(255,255,255,0.18)'}`,
                        background: checked ? '#28E6A5' : 'transparent',
                        flexShrink: 0,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        transition: 'background 180ms ease, border-color 180ms ease',
                      }}>
                        {checked && (
                          <svg width="11" height="11" viewBox="0 0 11 11" fill="none">
                            <path d="M2 5.5L4.5 8L9 3" stroke="#191919" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                          </svg>
                        )}
                      </div>
                      <span style={{
                        fontSize: '13px',
                        fontWeight: 500,
                        color: checked ? 'rgba(255,255,255,0.35)' : 'rgba(255,255,255,0.8)',
                        textDecoration: checked ? 'line-through' : 'none',
                        transition: 'color 180ms ease',
                        flex: 1,
                        lineHeight: '1.4',
                      }}>
                        {item.text}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          </>
        )}
      </div>

      {/* ── Bottom Navigation ── */}
      <nav
        data-testid="bottom-nav"
        style={{
          position: 'fixed',
          bottom: 0,
          left: '50%',
          transform: 'translateX(-50%)',
          width: '100%',
          maxWidth: '560px',
          background: 'rgba(25,25,25,0.94)',
          backdropFilter: 'blur(20px)',
          WebkitBackdropFilter: 'blur(20px)',
          borderTop: '1px solid rgba(255,255,255,0.05)',
          display: 'flex',
          justifyContent: 'space-around',
          padding: '10px 0 22px',
          zIndex: 50,
        }}
      >
        <button
          data-testid="nav-calculator"
          onClick={() => setActiveTab('calculator')}
          style={{
            background: 'none',
            border: 'none',
            cursor: 'pointer',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: '4px',
            padding: '4px 28px',
          }}
        >
          {/* Calculator icon */}
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none"
            stroke={activeTab === 'calculator' ? '#4D9FFF' : 'rgba(255,255,255,0.3)'}
            strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <rect x="4" y="2" width="16" height="20" rx="2" />
            <line x1="8" y1="6" x2="16" y2="6" />
            <line x1="8" y1="10" x2="10" y2="10" />
            <line x1="14" y1="10" x2="16" y2="10" />
            <line x1="8" y1="14" x2="10" y2="14" />
            <line x1="14" y1="14" x2="16" y2="14" />
            <line x1="8" y1="18" x2="10" y2="18" />
            <line x1="14" y1="18" x2="16" y2="18" />
          </svg>
          <span style={{
            fontSize: '10px',
            fontWeight: 600,
            color: activeTab === 'calculator' ? '#4D9FFF' : 'rgba(255,255,255,0.3)',
          }}>Calculator</span>
        </button>

        <button
          data-testid="nav-checklist"
          onClick={() => setActiveTab('checklist')}
          style={{
            background: 'none',
            border: 'none',
            cursor: 'pointer',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: '4px',
            padding: '4px 28px',
          }}
        >
          {/* Checklist icon */}
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none"
            stroke={activeTab === 'checklist' ? '#4D9FFF' : 'rgba(255,255,255,0.3)'}
            strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <path d="M9 11l3 3L22 4" />
            <path d="M21 12v7a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h11" />
          </svg>
          <span style={{
            fontSize: '10px',
            fontWeight: 600,
            color: activeTab === 'checklist' ? '#4D9FFF' : 'rgba(255,255,255,0.3)',
          }}>Checklist</span>
        </button>
      </nav>
    </div>
  );
}
