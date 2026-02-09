# War Council

War Council is a local Node.js + Express MVP for running an Imperial War Council scene in Warhammer Fantasy.

## Requirements

- Node.js 18+
- An `OPENAI_API_KEY` environment variable

## Run

```bash
npm install
npm run dev
```

Then visit:

- GM console: http://localhost:3000/gm
- Player view: http://localhost:3000/player

## Data files

Editable data lives under `data/` and `config.json`:

- `config.json` for model and TTS settings
- `data/council/*.json` for councilor biographies
- `data/world.json`, `data/threats.json`, `data/armies.json` for world state

Runtime state persists to `data/session_state.json`.
