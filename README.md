# Poker Chips

Play poker with real cards and bet on your phones. Each phone is a stack of chips; every phone shows the same pot, bets and turn. One player (the moderator, who opens the table) starts each hand and names the winner at showdown; the app pays out, including side pots. Two to ten players.

The app never knows the cards. It enforces the betting: button, blinds, turn order, minimum raise, all-ins.

## How a night goes

1. One player opens a table and shows the QR code (or reads out the 6-character code).
2. Everyone joins. The moderator arranges the seats clockwise as you actually sit, sets the starting stack and blinds, and starts the table. Nobody can join after that.
3. The moderator starts each hand. Phones show whose turn it is; the phone of the player to act turns bright.
4. At showdown the moderator taps the winner of each pot (two or more names to split).
5. Between hands the moderator can add chips (rebuys), move chips to fix a mistake, change blinds, or sit a player out. A misdealt hand can be cancelled at any time.
6. Closing the table shows who pays whom.

## Development

```
npm install
npm run dev      # the app; /dev/?n=6 shows several phones side by side over an in-memory network
npm test         # engine, 10-phone session and long-night tests
npm run check
npm run deploy:gh
```

- `src/engine/`: pure betting engine (no cards). `applyMove` is the single reducer.
- `src/app/session.svelte.ts`: wraps `@yujun/game-net` (MQTT beacons, room codes, resume after refresh).
- `src/ui/`: phone screens.

Limits worth knowing: the roster is fixed when the table starts; phones need an internet connection (public MQTT brokers, or your own via `.env`, see `.env.example`); a phone that loses its browser storage mid-night re-downloads the whole move log, which grows to roughly 1.3 KB per hand.
