import type { SongOption } from "./song-search";

export interface PlayerGameView {
    roomId: string;
    status: "playing" | "finished";
    roundPhase: "guessing" | "reveal";
    roundNumber: number;
    roundEndsAt: number;
    playerID: string;
    clueIndex: number;
    clueSeconds: number;
    finishedRound: boolean;
    scores: Record<string, number>;
}

export interface ActionResult {
    roomId: string;
    roundNumber: number;
    accepted: boolean;
    correct?: boolean;
    score?: number;
    finishedRound?: boolean;
}

export interface ClueIdentity {
    roomId: string;
    roundNumber: number;
    clueIndex: number;
}

export interface GameEvents {
    gameState: PlayerGameView;
    songCatalog: { roomId: string; songs: SongOption[] };
    guessResult: ActionResult;
    clueResult: ActionResult;
    gameError: { message: string };
    matchCancelled: { roomId: string; message: string };
    clueAudio: ClueIdentity & { audio: ArrayBuffer; mimeType: string };
    clueAudioError: ClueIdentity & { message: string };
    connect: undefined;
    disconnect: undefined;
    connect_error: undefined;
}

export interface GameRequest {
    roomId: string;
    roundNumber?: number;
    clueIndex?: number;
    songId?: string;
}

// The real Socket.IO client and the local preview expose the same small API.
export interface GameConnection {
    readonly connected: boolean;
    on<K extends keyof GameEvents>(event: K, listener: (data: GameEvents[K]) => void): void;
    off<K extends keyof GameEvents>(event: K, listener: (data: GameEvents[K]) => void): void;
    emit(event: "getGameState" | "getSongCatalog" | "submitGuess" | "skipClue" | "getClueAudio", data: GameRequest): void;
}
