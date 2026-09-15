import express from 'express';
import { createServer } from 'node:http';
import { Server, Socket } from 'socket.io';
import { randomUUID } from 'node:crypto';
import { createClient } from 'redis';

const app = express();
const server = createServer(app);
const PORT = 3001;

// Creates URLs to listen to
const io = new Server(server, {
    cors: {
        origin: "http://localhost:3000"
    }
})
const redis = createClient({
    url: process.env.REDIS_URL ?? "redis://127.0.0.1:6379",
});

redis.on('error', (error) => {
    console.error(`Redis Error ${error}`)
});

app.get('/health', (_req, res) => {
    res.status(redis.isReady ? 200 : 503).json({ ready: redis.isReady });
});

async function startServer() {
    await redis.connect();
    console.log("Redis Connected: ", await redis.ping());
    server.listen(PORT, () => {
        console.log(`Server running: ${PORT}`);
    });
}

io.on('connection', (socket) => {
    console.log(`Player Connected ${socket.id}`);
});


// Starts the server 
// Redis on port 6379
// Server on port 3001

startServer().catch((error) => {
    console.error(`Error: ${error}`);
    process.exit(1)
});

// Matchmaker using Redis sorted sets



