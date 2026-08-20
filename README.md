# Thesis-Bot

HexaHive is a Discord bot built to support a game-theory themed vulnerability trading simulation. It provides commands for reporting, trading, and managing virtual exploits, shops, player profiles, and server announcements. The project was created as part of a thesis project and is implemented in Node.js.

## Getting Started

Requirements:

- Node.js LTS (16+ recommended)
- A Discord bot token and a configured database (e.g., MongoDB)

Quick start:

1. Install dependencies:

```bash
npm install
```

2. Copy `.env.example` to `.env`, then set `DISCORD_TOKEN`, `DISCORD_APP_ID`, and `MONGO_URI`.

3. Run the bot locally:

```bash
npm start
```

Before committing changes, run the repository checks:

```bash
npm run check
```

## Player workflow

Players begin with `/verify`, use `/search` and `/info` to find opportunities, then choose whether to `/report` or `/exploit`. The `/help` command provides the full guided flow inside Discord.
