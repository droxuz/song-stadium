import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import { Server } from 'socket.io';
import { createGameManager } from '../src/game-session.ts';
const http = createServer();
const io = new Server(http, { cors: { origin: 'http://localhost:3000' } });
const players = new Map();
const waiting = new Set();
const matches = new Map();
const games = createGameManager(players, () => 'preview-song', 60_000);
io.on('connection', socket => {
    const id = randomUUID();
    players.set(id, socket);
    games.registerHandlers(socket, id);
    socket.on('joinQueue', async () => {
        if (matches.has(id)) return;
        waiting.add(id);
        socket.emit('queueJoined', { message: 'Queued' });
        if (waiting.size < 2) return;
        const playerIDs = [...waiting].slice(0, 2);
        playerIDs.forEach(player => waiting.delete(player));
        const match = { roomId: `preview-${randomUUID()}`, playerIDs };
        for (const player of playerIDs) {
            matches.set(player, match);
            await players.get(player).join(match.roomId);
        }
        games.startMatch(match);
        io.to(match.roomId).emit('matchFound', match);
    });
    socket.on('disconnect', () => {
        waiting.delete(id);
        const match = matches.get(id);
        if (match) {
            games.removeMatch(match);
            io.to(match.roomId).emit('matchCancelled', {
                roomId: match.roomId, message: 'Your opponent disconnected. Join the queue again to find another match.',
            });
            for (const player of match.playerIDs) matches.delete(player);
        }
        players.delete(id);
    });
});
http.listen(3001, '127.0.0.1', () => console.log('Temporary game UI test backend on 3001'));
