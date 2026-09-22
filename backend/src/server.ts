import express from 'express';
import { createServer } from 'node:http';
import { Server, type Socket } from 'socket.io';
import { randomUUID } from 'node:crypto';
import { createClient } from 'redis';
import { createQueueStore, registerQueueHandlers } from './queue.js';

const app = express();
const server = createServer(app);
const PORT = 3001;
const connectedPlayers = new Map<string, Socket>();

// Creates URLs to listen to
const io = new Server(server, {
    cors: {
        origin: "http://localhost:3000"
    }
})

const redis = createClient({
    url: process.env.REDIS_URL ?? "redis://127.0.0.1:6379",
});
const queue = createQueueStore(redis);

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


// On connection and disconnect
// Matchmaker using Time spent in queue, ELO, and player name
io.on('connection', (socket) => {
    const playerID = randomUUID(); // Temporary guest identity for this connection.
    const elo = 150 // database value
    connectedPlayers.set(playerID, socket)// Creates map element of key playerID, value socket
    console.log(`Player Connected: ${socket.id}`);
    socket.on('disconnect', () =>{  
        console.log(`Disconnecting Player: ${playerID}`)
        if (connectedPlayers.get(playerID) === socket){
            connectedPlayers.delete(playerID)
        }
    });

    registerQueueHandlers(socket, playerID, elo, queue);
});


// Starts the server 
// Redis on port 6379
// Server on port 3001

startServer().catch((error) => {
    console.error(`Error: ${error}`);
    process.exit(1)
});



// So based upon any abitrary number of songs for users to guess, 
// Create a package of song that the server can then divy out to clients 
// The server will then only accept answer from the client and then check answer and respond accordingly





