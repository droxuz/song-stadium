import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import { test } from 'node:test';
import { createClient } from 'redis';
import { Server } from 'socket.io';
import { io as connectClient } from 'socket.io-client';
import { createQueueStore, registerQueueHandlers } from '../src/queue.ts';
import { createLobbyManager } from '../src/lobby.ts';

function nextEvent(socket, event) {
    return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
            socket.off(event, receive);
            reject(new Error(`Timed out waiting for ${event}`));
        }, 5000);
        function receive(data) { clearTimeout(timer); resolve(data); }
        socket.once(event, receive);
    });
}

async function setup(t) {
    const prefix = `test:queue:${randomUUID()}:`;
    const redis = createClient({ url: process.env.TEST_REDIS_URL, socket: { reconnectStrategy: false } });
    redis.on('error', () => {});
    await redis.connect();
    const http = createServer();
    const io = new Server(http);
    const connectedPlayers = new Map();
    const queueKey = `${prefix}ranked`;
    const queue = createQueueStore(redis, queueKey, `${prefix}player:`);
    const lobbies = createLobbyManager(io, connectedPlayers, queue);
    const operations = [];
    const clients = [];
    io.on('connection', socket => {
        const playerID = randomUUID();
        connectedPlayers.set(playerID, socket);
        socket.on('disconnect', () => connectedPlayers.delete(playerID));
        operations.push(registerQueueHandlers(socket, playerID, 150, queue, {
            onQueued: lobbies.matchWaitingPlayers,
            onDisconnected: lobbies.playerDisconnected,
        }));
    });
    await new Promise(resolve => http.listen(0, '127.0.0.1', resolve));
    t.after(async () => {
        for (const client of clients) client.disconnect();
        io.disconnectSockets(true);
        await Promise.all(operations.map(operation => operation.whenIdle()));
        await lobbies.whenIdle();
        await new Promise(resolve => io.close(resolve));
        const keys = await redis.keys(`${prefix}*`);
        if (keys.length) await redis.del(keys);
        redis.destroy();
    });
    return {
        io, redis, queue, queueKey, lobbies, connectedPlayers,
        async connect() {
            const client = connectClient(`http://127.0.0.1:${http.address().port}`, {
                autoConnect: false, reconnection: false, timeout: 3000,
            });
            clients.push(client);
            const connected = nextEvent(client, 'connect');
            client.connect();
            await connected;
            return client;
        },
        async join(client) {
            const joined = nextEvent(client, 'queueJoined');
            client.emit('joinQueue');
            await joined;
        },
        serverSocket(client) {
            return [...connectedPlayers.values()].find(socket => socket.id === client.id);
        },
    };
}

const options = {
    skip: !process.env.TEST_REDIS_URL && 'Set TEST_REDIS_URL to run lobby integration tests',
    timeout: 20000,
};

test('queue joins automatically create one shared room and matched players cannot requeue', options, async t => {
    const app = await setup(t);
    const first = await app.connect();
    const second = await app.connect();
    const firstMatch = nextEvent(first, 'matchFound');
    const secondMatch = nextEvent(second, 'matchFound');
    await app.join(first);
    assert.equal(await app.redis.zCard(app.queueKey), 1);
    await app.join(second);
    const [a, b] = await Promise.all([firstMatch, secondMatch]);
    assert.deepEqual(a, b);
    assert.equal(a.playerIDs.length, 2);
    assert.equal(app.io.sockets.adapter.rooms.get(a.roomId).size, 2);
    assert.equal(await app.redis.zCard(app.queueKey), 0);
    const duplicate = nextEvent(first, 'queueError');
    first.emit('joinQueue');
    await duplicate;
    const leaveError = nextEvent(first, 'queueError');
    first.emit('leaveQueue');
    await leaveError;
    assert.equal(await app.redis.zCard(app.queueKey), 0);
    assert.equal(app.io.sockets.adapter.rooms.get(a.roomId).size, 2);
    assert.deepEqual(await app.queue.getMatch(a.playerIDs[0]), a);
});

test('12 simultaneous players receive six separate two-player rooms', options, async t => {
    const app = await setup(t);
    const clients = await Promise.all(Array.from({ length: 12 }, () => app.connect()));
    const found = clients.map(client => nextEvent(client, 'matchFound'));
    await Promise.all(clients.map(client => app.join(client)));
    const matches = await Promise.all(found);
    const rooms = new Set(matches.map(match => match.roomId));
    assert.equal(rooms.size, 6);
    for (const roomId of rooms) {
        assert.equal(matches.filter(match => match.roomId === roomId).length, 2);
        assert.equal(app.io.sockets.adapter.rooms.get(roomId).size, 2);
    }
    assert.equal(new Set(matches.flatMap(match => match.playerIDs)).size, 12);
    assert.equal(await app.redis.zCard(app.queueKey), 0);
});

test('disconnect cancels a lobby and the remaining player can match again', options, async t => {
    const app = await setup(t);
    const first = await app.connect();
    const second = await app.connect();
    const found = nextEvent(second, 'matchFound');
    await app.join(first);
    await app.join(second);
    const oldMatch = await found;
    const cancelled = nextEvent(second, 'matchCancelled');
    first.disconnect();
    assert.equal((await cancelled).roomId, oldMatch.roomId);
    assert.equal(app.io.sockets.adapter.rooms.has(oldMatch.roomId), false);
    for (const playerID of oldMatch.playerIDs) assert.equal(await app.queue.getMatch(playerID), null);
    const third = await app.connect();
    const newMatch = nextEvent(second, 'matchFound');
    await app.join(second);
    await app.join(third);
    assert.notEqual((await newMatch).roomId, oldMatch.roomId);
});

test('disconnect during room creation releases both claims and cancels partial membership', options, async t => {
    const app = await setup(t);
    const first = await app.connect();
    const second = await app.connect();
    const socket = app.serverSocket(first);
    const originalJoin = socket.join.bind(socket);
    const started = Promise.withResolvers();
    const release = Promise.withResolvers();
    socket.join = async room => {
        await originalJoin(room);
        started.resolve(room);
        await release.promise;
    };
    t.after(() => release.resolve());
    const cancelled = nextEvent(second, 'matchCancelled');
    await app.join(first);
    await app.join(second);
    const roomId = await started.promise;
    socket.disconnect(true);
    release.resolve();
    assert.equal((await cancelled).roomId, roomId);
    assert.equal(app.io.sockets.adapter.rooms.has(roomId), false);
    assert.equal(await app.redis.hLen(`${app.queueKey}:assignments`), 0);
    assert.equal(await app.redis.hLen(`${app.queueKey}:matches`), 0);
    await app.join(second);
    assert.equal(await app.redis.zCard(app.queueKey), 1);
});

test('failed room join waits for the other join before cancelling and allows retry', options, async t => {
    const app = await setup(t);
    const first = await app.connect();
    const second = await app.connect();
    const firstSocket = app.serverSocket(first);
    const secondSocket = app.serverSocket(second);
    const originalJoin = secondSocket.join.bind(secondSocket);
    const started = Promise.withResolvers();
    const release = Promise.withResolvers();
    firstSocket.join = () => { throw new Error('Simulated adapter failure'); };
    secondSocket.join = async room => {
        started.resolve();
        await release.promise;
        await originalJoin(room);
    };
    t.after(() => release.resolve());
    const cancelled = nextEvent(second, 'matchCancelled');
    await app.join(first);
    await app.join(second);
    await started.promise;
    release.resolve();
    const result = await cancelled;
    assert.equal(app.io.sockets.adapter.rooms.has(result.roomId), false);
    assert.equal(await app.redis.hLen(`${app.queueKey}:assignments`), 0);
    await app.join(second);
    assert.equal(await app.redis.zCard(app.queueKey), 1);
});
