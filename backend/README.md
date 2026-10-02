# Backend and Redis with Docker Compose

From the repository root, start both services:

```powershell
docker compose up --build --wait
```

Compose waits for Redis's health check before starting the backend. The backend connects to `redis://redis:6379`, and only starts listening after connecting to Redis. TypeScript is compiled when the backend image is built.

Keep running the Next.js frontend locally on `http://localhost:3000`. It connects to the backend at `http://localhost:3001`.

Stop any backend you previously launched on port 3001 before starting Compose. Redis in this stack has no published host port, so it can coexist with your standalone Redis container. Compose uses its own named data volume; it does not import data from that standalone container.

Check the services and logs:

```powershell
docker compose ps
docker compose logs -f backend
docker compose exec redis redis-cli ping
```

The backend readiness endpoint is `http://localhost:3001/health`.

After editing backend code, rerun `docker compose up --build --wait`. Stop the stack with:

```powershell
docker compose down
```

## Queue coordination

`src/queue.ts` uses Redis Lua scripts so membership checks and writes execute atomically. The sorted-set score is the queue-entry timestamp; Elo remains in player metadata. Duplicate joins preserve the original timestamp and Elo; duplicate leaves cannot report a second successful removal. Each socket's operations run in arrival order, and disconnect cleanup runs after pending writes. Leaving the queue keeps the socket connected.

## Two-player lobbies

After a successful `joinQueue`, the server calls the lobby manager in `src/lobby.ts`. Matchmaking takes the two longest-waiting players, removes them from the queue, and records their match assignments in one Redis script. Assigned players cannot queue again until their lobby has been released. This currently matches by waiting time only; it does not filter by Elo.

The lobby manager looks up both sockets in `connectedPlayers`, joins them to the generated `match:<UUID>` room, and sends both clients `matchFound` with `{ roomId, playerIDs }`. The frontend displays the lobby in place, retaining the socket connection. No client `matchmake` event is needed.

If a socket disconnects during creation or while in a lobby, the server cancels that lobby, clears its assignments and metadata, and sends the remaining player `matchCancelled`. That player can click **Join Queue** again. Room creation failures also cancel partial room membership. Lobby creation and cancellation are coordinated within this one backend process; running multiple backends will require shared presence/routing and a Socket.IO adapter.

To try matchmaking, start Compose and the frontend, open two tabs, and click **Join Queue** in each. Both receive the same room ID. Closing one tab cancels the lobby. The backend starts rounds automatically; the game screen still needs to consume the game events below.

When migrating a development queue previously scored by Elo, let its players leave and rejoin before testing time ordering. Changing the script does not convert previously persisted scores.

Player IDs are still temporary UUIDs per connection. This handles repeated events for the same ID, not one account opening several tabs. A server crash or Redis outage can still leave stale entries; queue leases/reconciliation and authenticated session ownership are separate work. The current key layout targets the standalone Redis instance in Compose, not Redis Cluster.

Run the concurrency tests against a reachable Redis instance (the tests create and remove only keys with a unique `test:queue:` prefix):

```powershell
cd backend
$env:TEST_REDIS_URL = 'redis://127.0.0.1:6379'
npm test
npm run typecheck
```

Without `TEST_REDIS_URL`, Redis integration tests are explicitly skipped. Compose's Redis is internal; use a separate local test container or an existing localhost Redis for this command.

## Server-owned game state

`src/game-session.ts` owns the private games map. A successful lobby creation starts a game before `matchFound` is sent. Clients cannot create games or finish rounds. Each action is checked against the server-assigned player ID, current socket, assigned game, and actual socket room membership. Answer checking and scoring run synchronously with no await between validation and mutation.

The game page can use these events through the shared socket:

| Client event | Payload | Server response |
| --- | --- | --- |
| `getGameState` | `{ roomId }` | `gameState` with the requesting player's public view |
| `submitGuess` | `{ roomId, roundNumber, songId }` | `guessResult`, followed by updated `gameState` for accepted actions |
| `skipClue` | `{ roomId, roundNumber }` | `clueResult`, followed by updated `gameState` for accepted actions |

Invalid requests or membership produce `gameError` with `{ message }`. Expired, stale-round, or already-finished actions return `{ accepted: false }` in their action response. Listen before requesting state when the game page mounts. `gameState` includes the room, round phase/number/deadline, the player's ID and clue progress, and public scores. It never contains `correctSongId` or the full private state. Player-specific views are sent individually, not broadcast as one shared object.

There are two rounds, each with a 60-second deadline and a three-second pause between rounds. Both players finishing also ends a round. Correct guesses earn `round(500 * clueMultiplier * timeMultiplier)`, where `timeMultiplier = 1 + remainingRoundTime / roundDuration`, clamped between 1 and 2. For the first clue in a 60-second round, an immediate answer earns 1,000 points, an answer after 15 seconds earns 875, and after 30 seconds earns 750. The backend uses its own round start and answer-receipt times; client timestamps and multipliers are ignored. Wrong guesses and skips do not reset the clock, and guesses at or after the deadline are rejected. Each new round resets the speed bonus. Successful `guessResult` responses include the awarded `score` and `timeMultiplier`.

The server loads `music/music-stub.json` once at startup and randomly selects a song ID for each round, excluding that game's previous song. Both players share the selected answer. With two songs, each game has a random starting song and then alternates; larger catalogs allow a random choice among all remaining candidates. Numeric catalog IDs are converted to strings (`"1"`, `"2"`) for guesses. The runtime Docker image includes the JSON catalog. Audio delivery remains to be implemented; only permitted audio clips should be served, without answer-revealing URLs or metadata.

Disconnects and cancelled lobbies delete the game and its timers. Finished game state remains available until disconnect/cancellation. State is in memory in one server process and does not survive a restart; stable identities, reconnection recovery, shared game storage, and rate limiting are not implemented here.

Game logic and socket tests run without Redis:

```powershell
node --import tsx --test tests/game.test.mjs tests/game-session.test.mjs
```

To run the backend outside Docker, use `npm run dev` in `backend` with a reachable Redis URL. The TypeScript runner resolves the `.js` module imports to source `.ts` files; Docker uses the compiled JavaScript instead.
