import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DEFAULT_SETTINGS, PREVIEW_ROOM, PreviewConnection } from '../../frontend/song-stadium-web/src/app/dev/game/preview-connection.ts';
import { readClueWaveform } from '../../frontend/song-stadium-web/src/lib/clue-waveform.ts';

async function request(connection, event, data, response) {
    const received = [];
    const listener = payload => received.push(payload);
    connection.on(response, listener);
    connection.emit(event, { roomId: PREVIEW_ROOM, ...data });
    await Promise.resolve();
    connection.off(response, listener);
    assert.equal(received.length, 1, `Expected one ${response}`);
    return received[0];
}

test('preview fixtures provide playing, waiting, reveal, results, and cancellation without a server', async () => {
    const connection = new PreviewConnection();
    for (const scene of ['playing', 'waiting', 'reveal', 'finished']) {
        connection.configure({ ...DEFAULT_SETTINGS, scene, yourScore: 12345, opponentScore: 67890 });
        const view = await request(connection, 'getGameState', {}, 'gameState');
        assert.deepEqual(view.scores, { you: 12345, opponent: 67890 });
        assert.equal(view.finishedRound, scene !== 'playing');
        assert.equal(view.status, scene === 'finished' ? 'finished' : 'playing');
        assert.equal(view.roundPhase, ['reveal', 'finished'].includes(scene) ? 'reveal' : 'guessing');
    }
    connection.configure({ ...DEFAULT_SETTINGS, scene: 'opponent-left' });
    assert.match((await request(connection, 'getGameState', {}, 'matchCancelled')).message, /opponent disconnected/);
    connection.configure({ ...DEFAULT_SETTINGS, scene: 'error' });
    assert.match((await request(connection, 'getGameState', {}, 'gameError')).message, /did not respond/);
});

test('preview actions advance only the current clue and a correct answer scores once', async () => {
    const connection = new PreviewConnection();
    const catalog = await request(connection, 'getSongCatalog', {}, 'songCatalog');
    const song = catalog.songs.find(song => song.title === 'Passionfruit');
    assert.ok(song);
    assert.equal((await request(connection, 'skipClue', { roundNumber: 2 }, 'clueResult')).accepted, false);
    await request(connection, 'skipClue', { roundNumber: 1 }, 'clueResult');
    const skipped = await request(connection, 'getGameState', {}, 'gameState');
    assert.equal(skipped.clueIndex, 1);
    assert.equal(skipped.clueSeconds, 0.2);
    const correct = await request(connection, 'submitGuess', { roundNumber: 1, songId: song.id }, 'guessResult');
    assert.equal(correct.correct, true);
    assert.equal((await request(connection, 'submitGuess', { roundNumber: 1, songId: song.id }, 'guessResult')).accepted, false);
    const finished = await request(connection, 'getGameState', {}, 'gameState');
    assert.equal(finished.scores.you, DEFAULT_SETTINGS.yourScore + correct.score);
    assert.equal(finished.finishedRound, true);
});

test('preview supplies valid WAV audio and waveforms for every clue and can simulate audio failure', async () => {
    const connection = new PreviewConnection();
    for (const [clueIndex, seconds] of [0.1, 0.2, 0.5, 1, 5].entries()) {
        connection.configure({ ...DEFAULT_SETTINGS, clueIndex });
        const clip = await request(connection, 'getClueAudio', { roundNumber: 1, clueIndex }, 'clueAudio');
        assert.equal(clip.mimeType, 'audio/wav');
        assert.equal(readClueWaveform(clip.audio).duration, seconds);
    }
    connection.configure({ ...DEFAULT_SETTINGS, audioError: true });
    assert.match((await request(connection, 'getClueAudio', { roundNumber: 1, clueIndex: 0 }, 'clueAudioError')).message, /could not load/);
});

test('preview can freeze the deadline or let it expire and reject late actions', async t => {
    t.mock.timers.enable({ apis: ['Date'], now: 100000 });
    const connection = new PreviewConnection();
    t.mock.timers.tick(100000);
    connection.tick();
    assert.equal((await request(connection, 'getGameState', {}, 'gameState')).roundEndsAt - Date.now(), 45000);
    connection.configure({ ...DEFAULT_SETTINGS, freezeTimer: false });
    t.mock.timers.tick(45000);
    connection.tick();
    assert.equal((await request(connection, 'getGameState', {}, 'gameState')).roundPhase, 'reveal');
    assert.equal((await request(connection, 'skipClue', { roundNumber: 1 }, 'clueResult')).accepted, false);
});

test('disconnect and reset restore the connection while removed listeners stay removed', async () => {
    const connection = new PreviewConnection();
    const events = [];
    const listener = () => events.push('state');
    connection.on('gameState', listener);
    connection.off('gameState', listener);
    connection.on('disconnect', () => events.push('disconnect'));
    connection.on('connect', () => events.push('connect'));
    connection.configure({ ...DEFAULT_SETTINGS, scene: 'disconnected' });
    assert.equal(connection.connected, false);
    connection.configure(DEFAULT_SETTINGS);
    assert.equal(connection.connected, true);
    assert.deepEqual(events, ['disconnect', 'connect']);
    assert.equal((await request(connection, 'getGameState', {}, 'gameState')).finishedRound, false);
});
