import type { Socket } from 'socket.io';
import type { Match } from './queue.js';
import { readFile } from 'node:fs/promises';
import { randomInt } from 'node:crypto';
import {
    createGameState, finishRound, getPlayerView, skipClue, startRound, submitGuess,
    CLUES, type GameState,
} from './game.js';
import { prepareClueAudio } from './audio.js';
import { resolve } from "node:path";
import { fileURLToPath } from 'node:url';
import { songSuggestions } from './song-catalog.js';

type Payload = Record<string, unknown>;
function isPayload(value: unknown): value is Payload {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

interface Song {
    "song-id": number,
    "song-name": string,
    "song-link": string
}
const backendDirectory = fileURLToPath(
    new URL("../", import.meta.url),
);
//Creates a List of songs
const songs: Song[] = JSON.parse(await readFile(
    new URL("../music/music-stub.json", import.meta.url), "utf-8",
));
const songIDs = [...new Set(songs.map(song => String(song["song-id"])))];
if (songIDs.length < 2) {
    throw new Error("The catalog needs at least two distinct songs to change songs each round.");
}

export function selectSongFromCatalog(_roundNumber: number, previousSongId?: string): string {
    const candidates = songIDs.filter(id => id !== previousSongId);
    return candidates[randomInt(candidates.length)]!;
}

async function loadSongAudio(songId: string): Promise<readonly Buffer[]> {
    const song = songs.find(song => String(song['song-id']) === songId);
    if (!song) throw new Error('Selected song is missing');
    return prepareClueAudio(resolve(backendDirectory, '.' + song['song-link']));
}

export function createGameManager(
    connectedPlayers: Map<string, Socket>,
    selectSong: (roundNumber: number, previousSongId?: string) => string = selectSongFromCatalog,
    roundDuration = 120_000,
    revealDuration = 3_000,
    loadAudio: (songId: string) => Promise<readonly Buffer[]> = loadSongAudio,
) {
    // Private to this backend process. Neither map is exposed through socket events.
    const games = new Map<string, GameState>();
    const assignments = new Map<string, string>();
    const timers = new Map<string, ReturnType<typeof setTimeout>>();
    // One private set of five clips per song, reused across players and matches.
    const clips = new Map<string, Promise<readonly Buffer[]>>();

    function getSongAudio(songId: string): Promise<readonly Buffer[]> {
        let preparation = clips.get(songId);
        if (!preparation) {
            preparation = Promise.resolve().then(() => loadAudio(songId)).then(audio => {
                if (audio.length !== CLUES.length || audio.some(clip => !Buffer.isBuffer(clip) || !clip.length)) {
                    throw new Error('Audio preparation must return all five clue clips.');
                }
                return audio;
            });
            clips.set(songId, preparation);
            const pending = preparation;
            void pending.catch(() => {
                // A failed preparation is retryable, without evicting a newer one.
                if (clips.get(songId) === pending) clips.delete(songId);
            });
        }
        return preparation;
    }

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
                const nextSongId = selectSong(game.roundNumber + 1, game.correctSongId);
                startRound(game, nextSongId, roundDuration);
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
        async prepareAudio() {
            // Startup warm-up is sequential to avoid spawning FFmpeg for the
            // entire catalog at once. No game audio is sent to clients here.
            for (const songId of songIDs) await getSongAudio(songId);
        },
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

            socket.on('getSongCatalog', (data: unknown) => {
                const game = findGame(data);
                if (game) socket.emit('songCatalog', { roomId: game.roomId, songs: songSuggestions });
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

            socket.on('getClueAudio', async (data: unknown) => {
                if (!isPayload(data) || !Number.isSafeInteger(data.roundNumber) ||
                    !Number.isSafeInteger(data.clueIndex)) {
                    reject('Invalid audio request.');
                    return;
                }
                const game = findGame(data);
                if (!game) return;
                const roundNumber = data.roundNumber as number;
                const clueIndex = data.clueIndex as number;
                const identity = { roomId: game.roomId, roundNumber, clueIndex };
                const isCurrent = () => {
                    const player = game.players[playerID]!;
                    return games.get(game.roomId) === game &&
                        connectedPlayers.get(playerID) === socket && socket.connected &&
                        assignments.get(playerID) === game.roomId && socket.rooms.has(game.roomId) &&
                        game.status === 'playing' && game.roundPhase === 'guessing' &&
                        game.roundNumber === roundNumber && Date.now() < game.roundEndsAt &&
                        !player.finishedRound && player.clueIndex === clueIndex;
                };
                if (!isCurrent()) {
                    socket.emit('clueAudioError', { ...identity, message: 'This clue is no longer available.' });
                    return;
                }
                try {
                    const audio = await getSongAudio(game.correctSongId);
                    const bytes = audio[clueIndex]!;
                    // The player may have skipped, disconnected, or finished during FFmpeg.
                    if (!isCurrent()) return;
                    socket.emit('clueAudio', {
                        ...identity, seconds: CLUES[clueIndex]!.seconds,
                        mimeType: 'audio/wav', audio: bytes,
                    });
                } catch (error) {
                    console.error('Could not prepare clue audio:', error);
                    if (isCurrent()) socket.emit('clueAudioError', {
                        ...identity, message: 'Could not load your clue. Please retry.',
                    });
                }
            });
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
            clips.clear();
        },
    };
}
