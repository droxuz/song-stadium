import { skip } from "node:test";

export interface GameState {
    roomId: string;
    status: "playing" | "finished";
    roundPhase: "guessing" | "reveal";
    roundNumber: number;
    correctSongId: string; // Server 
    roundStartedAt: number;
    roundEndsAt: number;
    players: Record<string, {
        score: number;
        clueIndex: number;
        finishedRound: boolean;
    }>;
};

const TOTAL_ROUNDS = 5;

const clueIndex = [
    {seconds: 0.1, multiplier: 1.0},
    {seconds: 0.2, multiplier: 0.80},
    {seconds: 0.5, multiplier: 0.6},
    {seconds: 1, multiplier: 0.4},
    {seconds: 5, multiplier: 0.2}
]

// Explicitly select public fields. Never serialize the full GameState to a client.
export function getPlayerView(game: GameState, playerID: string) {
    if (!Object.hasOwn(game.players, playerID)) return null;
    const player = game.players[playerID]!;
    return {
        roomId: game.roomId,
        status: game.status,
        roundPhase: game.roundPhase,
        roundNumber: game.roundNumber,
        roundEndsAt: game.roundEndsAt,
        playerID,
        clueIndex: player.clueIndex,
        clueSeconds: clueIndex[player.clueIndex]!.seconds,
        finishedRound: player.finishedRound,
        scores: Object.fromEntries(
            Object.entries(game.players).map(([id, state]) => [id, state.score]),
        ),
    };
}

export function createGameState(
    roomId: string,
    playerIDs: [string, string],
    correctSongId: string,
    roundDuration: number,
): GameState {
    const game: GameState = {
        roomId,
        status: "playing",
        roundPhase: "reveal",
        roundNumber: 0,
        correctSongId,
        roundStartedAt: 0,
        roundEndsAt: 0,
        players: Object.fromEntries(playerIDs.map(playerID => [
            playerID, { score: 0, clueIndex: 0, finishedRound: false },
        ])),
    };
    startRound(game, correctSongId, roundDuration);
    return game;
}

// The caller selects the song. Duration is in milliseconds.
export function startRound(game: GameState, songId: string, roundDuration: number) {
    if (game.status !== "playing" || game.roundPhase !== "reveal" || game.roundNumber >= TOTAL_ROUNDS) {
        return { accepted: false } as const;
    }
    if (!songId.trim() || !Number.isFinite(roundDuration) || roundDuration <= 0) {
        throw new Error("A round needs a song ID and a positive, finite duration.");
    }

    game.roundNumber++;
    game.correctSongId = songId;
    game.roundStartedAt = Date.now();
    game.roundEndsAt = game.roundStartedAt + roundDuration;
    game.roundPhase = "guessing";
    for (const player of Object.values(game.players)) {
        player.clueIndex = 0;
        player.finishedRound = false;
    }

    // Safe to send to players: the correct song stays on the server.
    return { accepted: true, roundNumber: game.roundNumber, roundEndsAt: game.roundEndsAt } as const;
}

// Call after player actions and from the deadline timer, using its captured round number.
export function finishRound(game: GameState, roundNumber: number) {
    if (game.status !== "playing" || game.roundPhase !== "guessing" || game.roundNumber !== roundNumber) {
        return { accepted: false } as const;
    }
    const everyoneFinished = Object.values(game.players).every(player => player.finishedRound);
    if (!everyoneFinished && Date.now() < game.roundEndsAt) {
        return { accepted: false } as const;
    }

    game.roundPhase = "reveal";
    for (const player of Object.values(game.players)) {
        player.finishedRound = true;
    }
    if (game.roundNumber >= TOTAL_ROUNDS) {
        game.status = "finished";
    }

    return {
        accepted: true,
        roundNumber: game.roundNumber,
        correctSongId: game.correctSongId,
        scores: Object.fromEntries(Object.entries(game.players).map(([id, player]) => [id, player.score])),
        matchFinished: game.status === "finished",
    } as const;
}

export function submitGuess(game: GameState, playerID: string, song: string, roundNumber: number) {
    if (!Object.hasOwn(game.players, playerID)) return { accepted: false };
    const player = game.players[playerID];
    const now = Date.now();
    if (!player || game.status !== "playing" || game.roundPhase !== "guessing" || game.roundNumber !== roundNumber || now >= game.roundEndsAt || player.finishedRound) {
        return { accepted: false };
    }
    if (song !== game.correctSongId) {
        skipClue(game, playerID, roundNumber)
        return { accepted: true, correct: false, score: 0 };
    }
    // Use server time since the round began; guesses and skips never reset it.
    // A full round remaining gives 2x, falling linearly toward 1x at the deadline.
    const duration = game.roundEndsAt - game.roundStartedAt;
    const remainingFraction = Math.max(0, Math.min(1, (game.roundEndsAt - now) / duration));
    const timeMultiplier = 1 + remainingFraction;
    const score = Math.round(500 * clueIndex[player.clueIndex]!.multiplier * timeMultiplier);
    player.score += score;
    player.finishedRound = true;
    return { accepted: true, correct: true, score, timeMultiplier };
}

// An incorrect guess or skip advances the clue, or finishes the player's final attempt.
export function skipClue(game: GameState, playerID: string, roundNumber: number) {
    if (!Object.hasOwn(game.players, playerID)) return { accepted: false } as const;
    const player = game.players[playerID];
    if (!player || game.status !== "playing" || game.roundPhase !== "guessing" || game.roundNumber !== roundNumber || Date.now() >= game.roundEndsAt || player.finishedRound) {
        return { accepted: false } as const;
    }
    if (player.clueIndex < clueIndex.length - 1) {
        player.clueIndex++;
    } else {
        player.finishedRound = true;
    }
    return { accepted: true, clueIndex: player.clueIndex, finishedRound: player.finishedRound } as const;
}
