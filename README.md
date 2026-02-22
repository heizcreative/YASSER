# CRTV Trading App

A mobile-first trading tool built with React featuring:

- **Market Sessions** – Live countdown timers for Asia, London, NY Killzone, and Post-Trade sessions in ET timezone
- **Position Size Calculator** – Supports MNQ, MES, MGC1!, and BTCUSD with risk-tiered feedback
- **Daily Checklist** – Session-based trading checklists (Lock, Pre, KZ, Post) with localStorage persistence
- **Weekend Mode** – Automatic detection of market closure (Fri 5 PM – Sun 6 PM ET)

## Running Locally

```bash
cd frontend
yarn install
yarn start
```

## Tech Stack

- React 19
- Tailwind CSS + shadcn/ui
- date-fns-tz (ET timezone)
- localStorage for persistence
