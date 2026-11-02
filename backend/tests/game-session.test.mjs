import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { test } from 'node:test';
import { Server } from 'socket.io';
import { io as connectClient } from 'socket.io-client';
import { createGameManager, selectSongFromCatalog } from '../src/game-session.ts';
import { readFile } from 'node:fs/promises';
import { createGameState, getPlayerView, TOTAL_ROUNDS } from '../src/game.ts';
import { createLobbyManager } from '../src/lobby.ts';

function nextEvent(socket, event) {
    return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
            socket.off(event, receive);
            reject(new Error(`Timed out waiting for ${event}`));
        }, 3000);
        function receive(data) { clearTimeout(timer); resolve(data); }
        socket.once(event, receive);
    });
}

async function setup(t, options = {}) {
    const http = createServer();
    const io = new Server(http);
    const players = new Map();
    const clients = [];
    const manager = createGameManager(
        players, options.selectSong ?? (round => `secret-song-${round}`),
        options.duration ?? 60_000, options.revealDuration ?? 3_000,
        options.loadAudio,
    );
    io.on('connection', socket => {
        const id = `player-${players.size + 1}`;
        players.set(id, socket);
        manager.registerHandlers(socket, id);
    });
    await new Promise(resolve => http.listen(0, '127.0.0.1', resolve));
    t.after(async () => {
        for (const client of clients) client.disconnect();
        manager.dispose();
        await new Promise(resolve => io.close(resolve));
    });
    async function connect() {
        const client = connectClient(`http://127.0.0.1:${http.address().port}`, {
            autoConnect: false, reconnection: false,
        });
        clients.push(client);
        const connected = nextEvent(client, 'connect');
        client.connect();
        await connected;
        return client;
    }
    const first = await connect();
    const second = await connect();
    const match = { roomId: 'room-A', playerIDs: ['player-1', 'player-2'] };
    if (options.start !== false) {
        for (const socket of players.values()) await socket.join(match.roomId);
        manager.startMatch(match);
    }
    return { io, manager, players, first, second, match, connect };
}

async function request(socket, event, data, response) {
    const result = nextEvent(socket, response);
    socket.emit(event, data);
    return result;
}

test('public view is an explicit copy without the answer or future private fields', () => {
    const game = createGameState('room-A', ['a', 'b'], 'secret-answer', 60_000);
    game.privateSongUrl = '/secret-answer/full-song.mp3';
    const view = getPlayerView(game, 'a');
    assert.deepEqual(Object.keys(view).sort(), [
        'roomId', 'status', 'roundPhase', 'roundNumber', 'roundEndsAt', 'playerID',
        'clueIndex', 'clueSeconds', 'finishedRound', 'scores',
    ].sort());
    assert.equal(JSON.stringify(view).includes('secret-answer'), false);
    view.scores.a = 999999;
    assert.equal(game.players.a.score, 0);
    assert.equal(getPlayerView(game, 'outsider'), null);
    assert.equal(getPlayerView(game, '__proto__'), null);
});

test('only the assigned player in the actual socket room can read game state', async t => {
    const app = await setup(t);
    const view = await request(app.first, 'getGameState', { roomId: 'room-A' }, 'gameState');
    assert.equal(view.playerID, 'player-1');
    assert.equal(JSON.stringify(view).includes('secret-song'), false);
    const outsider = await app.connect();
    for (const [client, data] of [
        [outsider, { roomId: 'room-A', playerID: 'player-1' }],
        [app.first, { roomId: 'room-B' }],
        [app.first, null],
    ]) {
        assert.ok((await request(client, 'getGameState', data, 'gameError')).message);
    }
    await app.players.get('player-1').leave('room-A');
    assert.ok((await request(app.first, 'getGameState', { roomId: 'room-A' }, 'gameError')).message);
});

test('song suggestions are private to the requester and selected playable IDs score correctly', async t => {
    const app = await setup(t, { selectSong: () => '1' });
    const received = [];
    app.second.on('songCatalog', data => received.push(data));
    const catalog = await request(app.first, 'getSongCatalog', { roomId: 'room-A' }, 'songCatalog');
    assert.ok(catalog.songs.length >= 300);
    const passionfruit = catalog.songs.find(song => song.title === 'Passionfruit');
    assert.equal(passionfruit.id, '1');
    assert.equal(JSON.stringify(catalog).includes('song-link'), false);
    const result = await request(app.first, 'submitGuess', {
        roomId: 'room-A', roundNumber: 1, songId: passionfruit.id,
    }, 'guessResult');
    assert.equal(result.correct, true);
    assert.ok(result.score > 0);
    assert.deepEqual(received, []);
});

test('guesses ignore forged identities and scores, and award points only once', async t => {
    const app = await setup(t);
    const data = {
        roomId: 'room-A', roundNumber: 1, songId: 'secret-song-1',
        playerID: 'player-2', score: 999999, clueIndex: 4, multiplier: 1000,
        timeMultiplier: 999999, roundStartedAt: 0, elapsedMs: 0,
    };
    const responses = [];
    app.first.on('guessResult', result => responses.push(result));
    for (let i = 0; i < 20; i++) app.first.emit('submitGuess', data);
    // Events on this socket are ordered; this response follows all twenty guesses.
    const view = await request(app.first, 'getGameState', { roomId: 'room-A' }, 'gameState');
    assert.equal(responses.filter(result => result.accepted).length, 1);
    assert.ok(responses[0].timeMultiplier >= 1 && responses[0].timeMultiplier <= 2);
    assert.equal(responses[0].score, Math.round(500 * responses[0].timeMultiplier));
    assert.equal(view.scores['player-1'], responses[0].score);
    assert.equal(view.scores['player-2'], 0);
});

test('malformed, stale, and foreign-room actions cannot advance a player', async t => {
    const app = await setup(t);
    for (const data of [null, {}, [], { roomId: 'room-A', roundNumber: 1, songId: 42 },
        { roomId: 'room-A', roundNumber: 1, songId: 'x'.repeat(201) },
        { roomId: 'room-A', roundNumber: '1', songId: 'wrong' },
        { roomId: 'room-B', roundNumber: 1, songId: 'wrong' }]) {
        assert.ok((await request(app.first, 'submitGuess', data, 'gameError')).message);
    }
    const stale = await request(app.first, 'skipClue', { roomId: 'room-A', roundNumber: 2 }, 'clueResult');
    assert.equal(stale.accepted, false);
    const wrong = await request(app.first, 'submitGuess', {
        roomId: 'room-A', roundNumber: 1, songId: 'wrong',
    }, 'guessResult');
    assert.equal(wrong.correct, false);
    const first = await request(app.first, 'getGameState', { roomId: 'room-A' }, 'gameState');
    const second = await request(app.second, 'getGameState', { roomId: 'room-A' }, 'gameState');
    assert.equal(first.clueIndex, 1);
    assert.equal(second.clueIndex, 0);
});

test('clients cannot create, reset, or finish a game, and round completion keeps answers private', async t => {
    const app = await setup(t);
    const received = [];
    app.first.onAny((event, data) => received.push({ event, data }));
    app.first.emit('createGameState', { roomID: 'room-A', playerIDs: ['player-1', 'intruder'] });
    app.first.emit('finishRound', { roomId: 'room-A', roundNumber: 1 });
    const initial = await request(app.first, 'getGameState', { roomId: 'room-A' }, 'gameState');
    assert.equal(initial.roundPhase, 'guessing');
    assert.deepEqual(Object.keys(initial.scores), ['player-1', 'player-2']);
    for (const socket of [app.first, app.second]) {
        await request(socket, 'submitGuess', {
            roomId: 'room-A', roundNumber: 1, songId: 'secret-song-1',
        }, 'guessResult');
    }
    const finished = await request(app.first, 'getGameState', { roomId: 'room-A' }, 'gameState');
    assert.equal(finished.roundPhase, 'reveal');
    assert.equal(JSON.stringify(received).includes('secret-song'), false);
});

test('deadline ends the round without a client finish event and rejects late guesses', async t => {
    const app = await setup(t, { duration: 100 });
    const view = await nextEvent(app.first, 'gameState');
    assert.equal(view.roundPhase, 'reveal');
    const late = await request(app.first, 'submitGuess', {
        roomId: 'room-A', roundNumber: 1, songId: 'secret-song-1',
    }, 'guessResult');
    assert.equal(late.accepted, false);
});

test('lobby lifecycle starts a private game and cancellation removes it', async t => {
    const app = await setup(t, { start: false });
    let waiting = app.match;
    const queue = {
        async matchmake() { const match = waiting; waiting = null; return match; },
        async getMatch() { return app.match; },
        async releaseMatch() { return true; },
    };
    const lobbies = createLobbyManager(app.io, app.players, queue, {
        onCreated: app.manager.startMatch, onCancelled: app.manager.removeMatch,
    });
    const found = nextEvent(app.first, 'matchFound');
    await lobbies.matchWaitingPlayers();
    await found;
    const initial = await request(app.first, 'getGameState', { roomId: 'room-A' }, 'gameState');
    assert.equal(initial.roundNumber, 1);
    await lobbies.playerDisconnected('player-2');
    assert.ok((await request(app.first, 'getGameState', { roomId: 'room-A' }, 'gameError')).message);
});

test('the server selects a new song each round and stops at the final result', async t => {
    const selections = [];
    const app = await setup(t, {
        revealDuration: 10,
        selectSong(round, previousSongId) {
            selections.push([round, previousSongId]);
            return `secret-song-${round}`;
        },
    });
    let expectedScore = 0;
    for (let round = 1; round <= TOTAL_ROUNDS; round++) {
        const transition = new Promise((resolve, reject) => {
            const timeout = setTimeout(() => {
                app.first.off('gameState', receive);
                reject(new Error('Round did not transition'));
            }, 3000);
            function receive(view) {
                if ((round < TOTAL_ROUNDS && view.roundNumber === round + 1 && view.roundPhase === 'guessing') ||
                    (round === TOTAL_ROUNDS && view.status === 'finished')) {
                    clearTimeout(timeout);
                    app.first.off('gameState', receive);
                    resolve(view);
                }
            }
            app.first.on('gameState', receive);
        });
        for (const socket of [app.first, app.second]) {
            const result = await request(socket, 'submitGuess', {
                roomId: 'room-A', roundNumber: round, songId: `secret-song-${round}`,
            }, 'guessResult');
            assert.equal(result.accepted, true);
            if (socket === app.first) expectedScore += result.score;
        }
        const view = await transition;
        assert.equal(view.scores['player-1'], expectedScore);
        assert.equal(JSON.stringify(view).includes('secret-song'), false);
    }
    assert.deepEqual(selections, Array.from({ length: TOTAL_ROUNDS }, (_, index) => [
        index + 1, index === 0 ? undefined : `secret-song-${index}`,
    ]));
});

test('random selection stays in the catalog and excludes each game\'s previous song', async () => {
    const catalog = JSON.parse(await readFile(new URL('../music/music-stub.json', import.meta.url), 'utf8'));
    const ids = new Set(catalog.map(song => String(song['song-id'])));
    let firstGamePrevious;
    let secondGamePrevious;
    for (let round = 1; round <= 20; round++) {
        const first = selectSongFromCatalog(round, firstGamePrevious);
        const second = selectSongFromCatalog(round, secondGamePrevious);
        assert.ok(ids.has(first));
        assert.ok(ids.has(second));
        assert.notEqual(first, firstGamePrevious);
        assert.notEqual(second, secondGamePrevious);
        firstGamePrevious = first;
        secondGamePrevious = second;
    }
});

test('disconnect immediately removes the private game', async t => {
    const app = await setup(t);
    const disconnected = nextEvent(app.players.get('player-2'), 'disconnect');
    app.second.disconnect();
    await disconnected;
    assert.ok((await request(app.first, 'getGameState', { roomId: 'room-A' }, 'gameError')).message);
});

test('audio uses only the requesting player’s clue and matching scoring multiplier', async t => {
    const calls = [];
    const app = await setup(t, { loadAudio: async (songId, seconds) => {
        calls.push({ songId, seconds });
        return Buffer.from(`clip:${seconds}`);
    } });
    const otherAudio = [];
    app.second.on('clueAudio', data => otherAudio.push(data));
    const durations = [0.1, 0.2, 0.5, 1, 5];
    for (let clueIndex = 0; clueIndex < durations.length; clueIndex++) {
        const clip = await request(app.first, 'getClueAudio', {
            roomId: 'room-A', roundNumber: 1, clueIndex,
            seconds: 999, songId: 'forged', playerID: 'player-2', filePath: '/full.mp3',
        }, 'clueAudio');
        assert.equal(clip.seconds, durations[clueIndex]);
        assert.equal(clip.audio.toString(), `clip:${durations[clueIndex]}`);
        assert.equal(clip.mimeType, 'audio/wav');
        assert.equal('songId' in clip, false);
        if (clueIndex < durations.length - 1) {
            await request(app.first, 'skipClue', { roomId: 'room-A', roundNumber: 1 }, 'clueResult');
        }
    }
    assert.deepEqual(calls.map(call => call.seconds), durations);
    assert.ok(calls.every(call => call.songId === 'secret-song-1'));
    const own = await request(app.first, 'submitGuess', {
        roomId: 'room-A', roundNumber: 1, songId: 'secret-song-1',
    }, 'guessResult');
    assert.equal(own.score, Math.round(500 * 0.2 * own.timeMultiplier));
    const opponent = await request(app.second, 'submitGuess', {
        roomId: 'room-A', roundNumber: 1, songId: 'secret-song-1',
    }, 'guessResult');
    assert.equal(opponent.score, Math.round(500 * opponent.timeMultiplier));
    assert.deepEqual(otherAudio, []);
});

test('foreign, future, stale, and finished audio requests never invoke the loader', async t => {
    let loads = 0;
    const app = await setup(t, { loadAudio: async () => { loads++; return Buffer.from('clip'); } });
    const outsider = await app.connect();
    const identity = { roomId: 'room-A', roundNumber: 1, clueIndex: 0 };
    assert.ok((await request(outsider, 'getClueAudio', identity, 'gameError')).message);
    assert.ok((await request(app.first, 'getClueAudio', { ...identity, roomId: 'room-B' }, 'gameError')).message);
    for (const data of [{ ...identity, clueIndex: 4 }, { ...identity, clueIndex: -1 },
        { ...identity, roundNumber: 2 }]) {
        assert.ok((await request(app.first, 'getClueAudio', data, 'clueAudioError')).message);
    }
    await request(app.first, 'skipClue', { roomId: 'room-A', roundNumber: 1 }, 'clueResult');
    assert.ok((await request(app.first, 'getClueAudio', identity, 'clueAudioError')).message);
    await request(app.first, 'submitGuess', {
        roomId: 'room-A', roundNumber: 1, songId: 'secret-song-1',
    }, 'guessResult');
    assert.ok((await request(app.first, 'getClueAudio', { ...identity, clueIndex: 1 }, 'clueAudioError')).message);
    assert.equal(loads, 0);
});

test('delayed audio is discarded after a skip and cached work is shared', async t => {
    let resolveAudio;
    let notifyStarted;
    let loads = 0;
    const started = new Promise(resolve => { notifyStarted = resolve; });
    const app = await setup(t, { loadAudio: () => {
        loads++;
        notifyStarted();
        return new Promise(resolve => { resolveAudio = resolve; });
    } });
    const identity = { roomId: 'room-A', roundNumber: 1, clueIndex: 0 };
    const firstAudio = [];
    app.first.on('clueAudio', data => firstAudio.push(data));
    app.first.emit('getClueAudio', identity);
    await started;
    // This ordered response also ensures the second request has reached the server.
    app.second.emit('getClueAudio', identity);
    await request(app.second, 'getGameState', { roomId: 'room-A' }, 'gameState');
    await request(app.first, 'skipClue', { roomId: 'room-A', roundNumber: 1 }, 'clueResult');
    const received = nextEvent(app.second, 'clueAudio');
    resolveAudio(Buffer.from('clip'));
    await received;
    await request(app.first, 'getGameState', { roomId: 'room-A' }, 'gameState');
    assert.equal(loads, 1);
    assert.deepEqual(firstAudio, []);
});

test('failed audio can be retried without changing progress or score', async t => {
    let attempts = 0;
    const app = await setup(t, { loadAudio: async () => {
        if (++attempts === 1) throw new Error('test decoder failure');
        return Buffer.from('clip');
    } });
    const identity = { roomId: 'room-A', roundNumber: 1, clueIndex: 0 };
    assert.ok((await request(app.first, 'getClueAudio', identity, 'clueAudioError')).message);
    assert.equal((await request(app.first, 'getClueAudio', identity, 'clueAudio')).audio.toString(), 'clip');
    const view = await request(app.first, 'getGameState', { roomId: 'room-A' }, 'gameState');
    assert.equal(view.clueIndex, 0);
    assert.equal(view.scores['player-1'], 0);
});

test('a new round loads its own song and rejects the previous round’s audio', async t => {
    const app = await setup(t, {
        revealDuration: 10,
        loadAudio: async songId => Buffer.from(songId),
    });
    const identity = { roomId: 'room-A', roundNumber: 1, clueIndex: 0 };
    const initial = await request(app.first, 'getClueAudio', identity, 'clueAudio');
    assert.equal(initial.audio.toString(), 'secret-song-1');
    const nextRound = new Promise(resolve => {
        function receive(view) {
            if (view.roundNumber !== 2) return;
            app.first.off('gameState', receive);
            resolve();
        }
        app.first.on('gameState', receive);
    });
    for (const client of [app.first, app.second]) {
        await request(client, 'submitGuess', {
            roomId: 'room-A', roundNumber: 1, songId: 'secret-song-1',
        }, 'guessResult');
    }
    await nextRound;
    assert.ok((await request(app.first, 'getClueAudio', identity, 'clueAudioError')).message);
    const next = await request(app.first, 'getClueAudio', { ...identity, roundNumber: 2 }, 'clueAudio');
    assert.equal(next.audio.toString(), 'secret-song-2');
});
