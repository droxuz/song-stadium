import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { test } from 'node:test';
import { createGameManager } from '../src/game-session.ts';
import { TOTAL_ROUNDS } from '../src/game.ts';
import { createLobbyManager } from '../src/lobby.ts';
import { registerQueueHandlers } from '../src/queue.ts';

// Exercise the real handlers and managers without requiring network access.
class TestSocket extends EventEmitter {
    connected = true;
    rooms = new Set();

    constructor(roomMembers) {
        super();
        this.roomMembers = roomMembers;
    }

    join(roomId) {
        this.rooms.add(roomId);
        if (!this.roomMembers.has(roomId)) this.roomMembers.set(roomId, new Set());
        this.roomMembers.get(roomId).add(this);
    }

    leave(roomId) {
        this.rooms.delete(roomId);
        const members = this.roomMembers.get(roomId);
        members?.delete(this);
        if (!members?.size) this.roomMembers.delete(roomId);
    }

    disconnect() {
        this.connected = false;
        for (const roomId of this.rooms) this.leave(roomId);
        this.emit('disconnect');
    }
}

function nextEvent(socket, event, accepts = () => true) {
    return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
            socket.off(event, receive);
            reject(new Error(`Timed out waiting for ${event}`));
        }, 3000);
        function receive(data) {
            if (!accepts(data)) return;
            clearTimeout(timer);
            socket.off(event, receive);
            resolve(data);
        }
        socket.on(event, receive);
    });
}

async function request(socket, event, data, response) {
    const result = nextEvent(socket, response);
    socket.emit(event, data);
    return result;
}

function setup(t, options = {}) {
    const rooms = new Map();
    const players = new Map([
        ['player-1', new TestSocket(rooms)],
        ['player-2', new TestSocket(rooms)],
    ]);
    const manager = createGameManager(
        players, round => `secret-song-${round}`, 60_000, options.revealDuration ?? 10,
    );
    const io = {
        sockets: { adapter: { rooms } },
        to(roomId) {
            return {
                emit(event, data) {
                    for (const socket of rooms.get(roomId) ?? []) socket.emit(event, data);
                },
            };
        },
    };
    const match = { roomId: 'room-A', playerIDs: [...players.keys()] };
    for (const [id, socket] of players) {
        socket.on('disconnect', () => players.delete(id));
        socket.join(match.roomId);
        manager.registerHandlers(socket, id);
    }
    manager.startMatch(match);
    const [first, second] = [...players.values()];
    t.after(() => {
        first.disconnect();
        second.disconnect();
        manager.dispose();
    });
    return { io, players, manager, first, second, match };
}

test('finished players can queue and play again on the same sockets without cancelling their results', async t => {
    const app = await setup(t, { revealDuration: 10 });
    // Model the queue boundary: an assignment blocks joining until released.
    // Redis script behavior is covered separately in queue.test.mjs.
    let assigned = app.match;
    const waiting = new Set();
    let releases = 0;
    let failRelease = true;
    const queue = {
        async join(id) {
            if (assigned?.playerIDs.includes(id) || waiting.has(id)) return false;
            waiting.add(id);
            return true;
        },
        async leave(id) { return waiting.delete(id); },
        async getMatch(id) { return assigned?.playerIDs.includes(id) ? assigned : null; },
        async releaseMatch(match) {
            if (failRelease) throw new Error('Simulated release failure');
            assert.deepEqual(match, assigned);
            assigned = null;
            releases++;
            return true;
        },
        async matchmake() {
            if (waiting.size < 2) return null;
            assigned = { roomId: 'room-B', playerIDs: [...waiting] };
            waiting.clear();
            return assigned;
        },
    };
    const lobbies = createLobbyManager(app.io, app.players, queue, {
        onCreated: app.manager.startMatch,
        onCancelled: app.manager.removeMatch,
        isFinished: app.manager.isMatchFinished,
        onFinished: app.manager.removeMatch,
    });
    const operations = [...app.players].map(([id, socket]) =>
        registerQueueHandlers(socket, id, 150, queue, {
            beforeJoin: lobbies.releaseFinishedMatch,
            onQueued: lobbies.matchWaitingPlayers,
            onDisconnected: lobbies.playerDisconnected,
        }),
    );
    t.after(async () => {
        await Promise.all(operations.map(operation => operation.whenIdle()));
        await lobbies.whenIdle();
    });
    const cancelled = [];
    for (const client of [app.first, app.second]) client.on('matchCancelled', data => cancelled.push(data));

    // Active matches must keep their assignments, including between rounds.
    assert.equal(app.manager.isMatchFinished(app.match), false);
    await request(app.first, 'joinQueue', undefined, 'queueError');
    assert.equal(releases, 0);
    for (let round = 1; round <= TOTAL_ROUNDS; round++) {
        const transition = nextEvent(app.first, 'gameState', view =>
            round < TOTAL_ROUNDS ? view.roundNumber === round + 1 : view.status === 'finished',
        );
        for (const client of [app.first, app.second]) {
            await request(client, 'submitGuess', {
                roomId: app.match.roomId, roundNumber: round, songId: `secret-song-${round}`,
            }, 'guessResult');
        }
        await transition;
    }
    assert.equal(app.manager.isMatchFinished(app.match), true);
    const final = await request(app.first, 'getGameState', { roomId: app.match.roomId }, 'gameState');
    assert.equal(final.status, 'finished');
    assert.ok(final.scores['player-1'] > 0);

    // A failed Redis release must keep the finished game available for retry.
    await request(app.first, 'joinQueue', undefined, 'queueError');
    assert.equal(app.manager.isMatchFinished(app.match), true);
    assert.deepEqual(assigned, app.match);
    assert.equal(waiting.size, 0);
    failRelease = false;

    const found = [nextEvent(app.first, 'matchFound'), nextEvent(app.second, 'matchFound')];
    await request(app.first, 'joinQueue', undefined, 'queueJoined');
    assert.equal(releases, 1);
    assert.equal(app.io.sockets.adapter.rooms.has(app.match.roomId), false);
    await request(app.first, 'joinQueue', undefined, 'queueError');
    await request(app.second, 'joinQueue', undefined, 'queueJoined');
    const [firstMatch, secondMatch] = await Promise.all(found);
    assert.deepEqual(firstMatch, secondMatch);
    assert.notEqual(firstMatch.roomId, app.match.roomId);
    assert.deepEqual(firstMatch.playerIDs, app.match.playerIDs);
    assert.deepEqual(cancelled, []);
    for (const client of [app.first, app.second]) {
        const view = await request(client, 'getGameState', { roomId: firstMatch.roomId }, 'gameState');
        assert.equal(view.roundNumber, 1);
        assert.equal(view.status, 'playing');
        assert.deepEqual(view.scores, { 'player-1': 0, 'player-2': 0 });
    }
    assert.ok((await request(app.first, 'submitGuess', {
        roomId: app.match.roomId, roundNumber: TOTAL_ROUNDS, songId: 'secret-song-2',
    }, 'gameError')).message);
});

