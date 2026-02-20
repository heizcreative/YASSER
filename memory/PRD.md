# CRTV Trading App - PRD

## Original Problem Statement
Build a complete single-page trading application called CRTV with:
- Mobile-first, desktop compact (max 560px)
- Pure dark theme (no white backgrounds)
- Apple Glass aesthetic
- Market Sessions with ET timezone
- Position Size Calculator
- Calendar with Journal entries
- localStorage persistence

## User Persona
Single professional trader who needs:
- Quick position sizing calculations
- Market session awareness
- Trade journaling capabilities

## Core Requirements (Static)
1. Symbol Support: MNQ ($2/pt), MES ($5/pt), MGC1! ($10/1.0), BTCUSD
2. Market Sessions: Asia Range (8PM-12AM), London Killzone (2AM-5AM), NY Killzone (9:30AM-11AM), Post Trade (11AM-8PM)
3. Calculator: Risk/Stop/TP inputs with live calculations
4. Calendar: Monthly view with journal entry dots (Win=green, Loss=red, BE=blue, Missed=yellow)
5. Timezone: America/Toronto (ET)
6. Persistence: localStorage

## What's Been Implemented (Feb 2026)
- [x] Header with CRTV title and symbol selector
- [x] Market Sessions card with live ET time
- [x] Session countdown timers (Opens in / Closes in)
- [x] Position Size Calculator (MNQ/MES/MGC1!/BTCUSD)
- [x] BTCUSD rounds down to 1 decimal
- [x] Max 40 contracts limit for futures
- [x] Risk tier coloring (Low=green ≤$500, Medium=yellow ≤$1500, High=red >$1500)
- [x] Calendar with monthly navigation
- [x] Journal entry CRUD (add/edit/delete)
- [x] Result type buttons (Win/Loss/BE/Missed)
- [x] Colored dots on calendar for entries
- [x] Bottom navigation (Calculator/Calendar tabs)
- [x] Dark theme throughout (#191919)
- [x] Glass panel effects with backdrop blur
- [x] localStorage persistence for all data
- [x] 30-second time update interval
- [x] Weekend detection logic

## Prioritized Backlog
### P0 (Critical) - DONE
- Calculator math ✓
- Session timing ✓
- Journal CRUD ✓

### P1 (Important) - Future
- Weekend mode visual indicator
- Lock session display
- Journal entry search/filter

### P2 (Nice to Have)
- Export journal data to CSV
- Weekly/monthly P&L summary
- Trade statistics dashboard

## Next Tasks
1. Add journal entry filtering by result type
2. Add P&L summary card
3. Add data export functionality
