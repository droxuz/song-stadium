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

To try it, start Compose and the frontend, open two tabs, and click **Join Queue** in each. Both should display the same room ID and `Players: 2 / 2`. Closing one tab returns the other to an idle state with a cancellation message. There is no round or ready-up logic yet.

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

To run the backend outside Docker, use `npm run dev` in `backend` with a reachable Redis URL. The TypeScript runner resolves the `.js` module imports to source `.ts` files; Docker uses the compiled JavaScript instead.
