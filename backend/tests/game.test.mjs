import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createGameState, startRound, finishRound, submitGuess, skipClue } from '../src/game.ts';

const createGame = (room = 'room-A') => createGameState(room, ['a', 'b'], 'song-1', 30_000);

test('round transitions preserve scores and reset progress', () => {
    const game = createGame();
    assert.equal(game.roundNumber, 1);
    assert.equal(startRound(game, 'song-2', 30_000).accepted, false);
    assert.equal(finishRound(game, 1).accepted, false);
    assert.deepEqual(submitGuess(game, 'a', 'wrong', 1), { accepted: true, correct: false, score: 0 });
    assert.equal(submitGuess(game, 'a', 'song-1', 1).score, 400);
    assert.equal(finishRound(game, 1).accepted, false);
    assert.equal(submitGuess(game, 'b', 'song-1', 1).score, 500);
    const result = finishRound(game, 1);
    assert.equal(result.accepted, true);
    assert.deepEqual(result.scores, { a: 400, b: 500 });
    assert.equal(result.matchFinished, false);
    assert.equal(finishRound(game, 1).accepted, false);
    assert.equal(submitGuess(game, 'a', 'song-1', 1).accepted, false);
    assert.equal(skipClue(game, 'a', 1).accepted, false);

    const started = startRound(game, 'song-2', 30_000);
    assert.equal(started.accepted, true);
    assert.equal('correctSongId' in started, false);
    assert.equal(game.roundNumber, 2);
    assert.equal(game.correctSongId, 'song-2');
    assert.deepEqual(game.players.a, { score: 400, clueIndex: 0, finishedRound: false });
    assert.equal(submitGuess(game, 'a', 'song-2', 2).score, 500);
    assert.equal(game.players.a.score, 900);
    assert.equal(submitGuess(game, 'b', 'song-1', 1).accepted, false);
    assert.equal(skipClue(game, 'b', 1).accepted, false);
    assert.equal(finishRound(game, 1).accepted, false);
    assert.deepEqual(result.scores, { a: 400, b: 500 });
});

test('one correct player and one exhausted player complete the round', () => {
    const game = createGame();
    submitGuess(game, 'a', 'song-1', 1);
    for (let i = 0; i < 4; i++) skipClue(game, 'b', 1);
    assert.equal(game.players.b.clueIndex, 4);
    assert.equal(game.players.b.finishedRound, false);
    assert.equal(finishRound(game, 1).accepted, false);
    submitGuess(game, 'b', 'wrong', 1);
    assert.equal(game.players.b.finishedRound, true);
    assert.equal(game.players.b.score, 0);
    assert.equal(finishRound(game, 1).accepted, true);
});

test('deadline closes a round with no guesses and rejects late actions', t => {
    const game = createGame();
    t.mock.method(Date, 'now', () => game.roundEndsAt);
    assert.equal(submitGuess(game, 'a', 'song-1', 1).accepted, false);
    assert.equal(skipClue(game, 'b', 1).accepted, false);
    assert.equal(finishRound(game, 1).accepted, true);
    assert.equal(game.players.a.finishedRound, true);
    assert.equal(game.players.b.finishedRound, true);
    assert.equal(game.players.a.score, 0);
});

test('five rounds finish the match with cumulative scores', () => {
    const game = createGame();
    for (let round = 1; round <= 5; round++) {
        for (const player of ['a', 'b']) submitGuess(game, player, game.correctSongId, round);
        assert.equal(finishRound(game, round).matchFinished, round === 5);
        if (round < 5) assert.equal(startRound(game, `song-${round + 1}`, 30_000).accepted, true);
    }
    assert.equal(game.players.a.score, 2500);
    assert.equal(game.status, 'finished');
    assert.equal(startRound(game, 'song-6', 30_000).accepted, false);
    assert.equal(finishRound(game, 5).accepted, false);
});

test('lobbies maintain independent scores and round progress', () => {
    const first = createGame();
    const second = createGame('room-B');
    const before = structuredClone(second);
    for (const player of ['a', 'b']) submitGuess(first, player, 'song-1', 1);
    finishRound(first, 1);
    startRound(first, 'song-2', 30_000);
    assert.deepEqual(second, before);
});

test('invalid round configuration does not mutate state', () => {
    const game = createGame();
    for (const player of ['a', 'b']) submitGuess(game, player, 'song-1', 1);
    finishRound(game, 1);
    const before = structuredClone(game);
    for (const duration of [0, -1, NaN, Infinity]) {
        assert.throws(() => startRound(game, 'song-2', duration));
    }
    assert.throws(() => startRound(game, ' ', 30_000));
    assert.deepEqual(game, before);
});
