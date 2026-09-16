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
