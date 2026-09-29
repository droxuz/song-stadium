import type { Socket } from 'socket.io';
import type { Match } from './queue.js';
import {
    createGameState, finishRound, getPlayerView, skipClue, startRound, submitGuess,
    type GameState,
} from './game.js';

type Payload = Record<string, unknown>;
function isPayload(value: unknown): value is Payload {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function createGameManager(
    connectedPlayers: Map<string, Socket>,
    selectSong: (roundNumber: number) => string,
    roundDuration = 60_000,
    revealDuration = 3_000,
) {
    // Private to this backend process. Neither map is exposed through socket events.
    const games = new Map<string, GameState>();
    const assignments = new Map<string, string>();
    const timers = new Map<string, ReturnType<typeof setTimeout>>();

    function clearTimer(roomId: string) {
        const timer = timers.get(roomId);
        if (timer) clearTimeout(timer);
        timers.delete(roomId);
    }

    function publish(game: GameState) {
        for (const playerID of Object.keys(game.players)) {
            const socket = connectedPlayers.get(playerID);
            if (socket?.connected && socket.rooms.has(game.roomId)) {
                socket.emit('gameState', getPlayerView(game, playerID));
            }
        }
    }

    function scheduleDeadline(game: GameState) {
        const roundNumber = game.roundNumber;
        clearTimer(game.roomId);
        const timer = setTimeout(() => {
            if (games.get(game.roomId) !== game || game.roundNumber !== roundNumber) return;
            if (Date.now() < game.roundEndsAt) {
                scheduleDeadline(game);
                return;
            }
            completeRound(game);
        }, Math.max(0, game.roundEndsAt - Date.now()));
        timer.unref();
        timers.set(game.roomId, timer);
    }

    function completeRound(game: GameState) {
        const result = finishRound(game, game.roundNumber);
        if (!result.accepted) return;
        clearTimer(game.roomId);
        // finishRound returns the answer for server use; only the public view is emitted.
        publish(game);
        if (game.status === 'finished') return;

        const timer = setTimeout(() => {
            if (games.get(game.roomId) !== game) return;
            try {
                startRound(game, selectSong(game.roundNumber + 1), roundDuration);
                scheduleDeadline(game);
            } catch (error) {
                console.error('Could not start the next round:', error);
                clearTimer(game.roomId);
                game.status = 'finished';
                for (const playerID of Object.keys(game.players)) {
                    connectedPlayers.get(playerID)?.emit('gameError', {
                        message: 'The game ended because the next round could not be started.',
                    });
                }
            }
            publish(game);
        }, revealDuration);
        timer.unref();
        timers.set(game.roomId, timer);
    }

    function removeMatch(match: Match) {
        clearTimer(match.roomId);
        games.delete(match.roomId);
        for (const id of match.playerIDs) {
            if (assignments.get(id) === match.roomId) assignments.delete(id);
        }
    }

    return {
        startMatch(match: Match) {
            if (games.has(match.roomId)) return;
            if (match.playerIDs.some(id => assignments.has(id))) {
                throw new Error('A player already has an active game.');
            }
            const game = createGameState(match.roomId, match.playerIDs, selectSong(1), roundDuration);
            games.set(match.roomId, game);
            for (const id of match.playerIDs) assignments.set(id, match.roomId);
            scheduleDeadline(game);
        },
        removeMatch,
        registerHandlers(socket: Socket, playerID: string) {
            function reject(message: string) {
                socket.emit('gameError', { message });
            }

            function findGame(data: unknown): GameState | null {
                if (!isPayload(data) || typeof data.roomId !== 'string') {
                    reject('Invalid game request.');
                    return null; 
                }
                const roomId = assignments.get(playerID);
                const game = roomId ? games.get(roomId) : undefined;
                if (!socket.connected || connectedPlayers.get(playerID) !== socket ||
                    !game || roomId !== data.roomId || !socket.rooms.has(game.roomId) ||
                    !Object.hasOwn(game.players, playerID)) {
                    reject('You are not a player in this game.');
                    return null;
                }
                return game;
            }

            socket.on('getGameState', (data: unknown) => {
                const game = findGame(data);
                if (!game) return;
                completeRound(game);
                socket.emit('gameState', getPlayerView(game, playerID));
            });

            function handleAction(data: unknown, guess: boolean) {
                if (!isPayload(data) || !Number.isSafeInteger(data.roundNumber) ||
                    (data.roundNumber as number) < 1 ||
                    (guess && (typeof data.songId !== 'string' ||
                        !data.songId.trim() || data.songId.length > 200))) {
                    reject('Invalid game action.');
                    return;
                }
                const game = findGame(data);
                if (!game) return;
                const result = guess
                    ? submitGuess(game, playerID, data.songId as string, data.roundNumber as number)
                    : skipClue(game, playerID, data.roundNumber as number);
                socket.emit(guess ? 'guessResult' : 'clueResult', {
                    roomId: game.roomId, roundNumber: game.roundNumber, ...result,
                });
                completeRound(game);
                if (result.accepted) publish(game);
            }

            socket.on('submitGuess', (data: unknown) => handleAction(data, true));
            socket.on('skipClue', (data: unknown) => handleAction(data, false));
            // Creation, round completion, and score updates have no client handlers.
            socket.on('disconnect', () => {
                const roomId = assignments.get(playerID);
                const game = roomId ? games.get(roomId) : undefined;
                if (game) removeMatch({ roomId: game.roomId, playerIDs: Object.keys(game.players) as [string, string] });
            });
        },
        dispose() {
            for (const roomId of timers.keys()) clearTimer(roomId);
            games.clear();
            assignments.clear();
        },
    };
}
