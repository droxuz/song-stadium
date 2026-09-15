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

This preserves the Redis data volume. `BACKEND_PORT` can override the host port if required; the frontend URL must then use the same port.

# Standalone local Redis

The existing `dockerfile` runs Redis only; `Dockerfile.backend` builds the TypeScript backend. Use the following alternative when running both your TypeScript backend and Next.js frontend directly on your computer.

Start Docker Desktop, then build from the repository root:

```powershell
docker build -f backend/dockerfile -t song-stadium-redis:local backend
```

Create and start the container:

```powershell
docker run -d --name song-stadium-redis -p 127.0.0.1:6379:6379 --mount source=song-stadium-redis-data,target=/data song-stadium-redis:local
```

If a container already has that name, inspect it before changing it. An existing container does not automatically switch to a newly built image.

Check Redis:

```powershell
docker exec song-stadium-redis redis-cli ping
docker inspect --format '{{.State.Health.Status}}' song-stadium-redis
```

Expected results: `PONG`, then `healthy` after the health check runs.

Stop and restart this container:

```powershell
docker stop song-stadium-redis
docker start song-stadium-redis
```

For a backend running directly on your computer, use:

```dotenv
REDIS_URL=redis://127.0.0.1:6379
```

The published port is bound to localhost. This is a local development setup without Redis authentication; do not expose it publicly.

The named volume and append-only file preserve Redis data across container replacements. Queue entries therefore need application-managed expiry and cleanup. The `noeviction` policy avoids silently removing queue data; configure a memory budget for deployment, expire song-cache entries, and handle write failures if Redis reaches its limit. Separate key prefixes do not give cache and matchmaking data independent memory policies.
