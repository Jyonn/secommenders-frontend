# Secommenders Frontend

Frontend dashboard for browsing experiment results stored by `secommenders-backend`.

## Features

- Runtime overview from `/stats/runtime-hours`
- Leaderboard view from `/evaluations/leaderboard`
- Filterable evaluation list from `/evaluations/`
- Evaluation detail drill-down from `/evaluations/<signature>`
- Per-experiment log viewer from `/experiments/log`

## Quick Start

```bash
npm install
npm run dev
```

By default the frontend calls `/api/*`, and the Vite dev server proxies that
traffic to `http://127.0.0.1:8000`.

If your backend runs elsewhere:

```bash
VITE_BACKEND_TARGET=http://your-host:8000 npm run dev
```

If you want the built frontend to call a deployed API directly:

```bash
VITE_API_BASE_URL=http://your-host:8000 npm run build
```
