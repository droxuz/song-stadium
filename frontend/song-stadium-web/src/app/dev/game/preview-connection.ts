import type { GameConnection, GameEvents, GameRequest, PlayerGameView } from "../../../lib/game-connection";
import type { SongOption } from "../../../lib/song-search";

export const PREVIEW_ROOM = "preview-room";
const CLUES = [0.1, 0.2, 0.5, 1, 5];
const SONGS: SongOption[] = [
    { id: "preview-1", title: "Passionfruit", artist: "Drake" },
    { id: "preview-2", title: "Plot Twist", artist: "Drake" },
    { id: "preview-3", title: "God's Plan", artist: "Drake" },
    { id: "preview-4", title: "Hold On, We're Going Home", artist: "Drake" },
];

export type PreviewScene = "playing" | "waiting" | "reveal" | "finished" | "opponent-left" | "disconnected" | "error";

export interface PreviewSettings {
    scene: PreviewScene;
    roundNumber: number;
    clueIndex: number;
    secondsLeft: number;
    yourScore: number;
    opponentScore: number;
    freezeTimer: boolean;
    audioError: boolean;
}

export const DEFAULT_SETTINGS: PreviewSettings = {
    scene: "playing", roundNumber: 1, clueIndex: 0, secondsLeft: 45,
    yourScore: 750, opponentScore: 500, freezeTimer: true, audioError: false,
};

function createView(settings: PreviewSettings): PlayerGameView {
    return {
        roomId: PREVIEW_ROOM, playerID: "you",
        status: settings.scene === "finished" ? "finished" : "playing",
        roundPhase: settings.scene === "reveal" || settings.scene === "finished" ? "reveal" : "guessing",
        roundNumber: settings.roundNumber,
        roundEndsAt: Date.now() + settings.secondsLeft * 1000,
        clueIndex: settings.clueIndex,
        clueSeconds: CLUES[settings.clueIndex]!,
        finishedRound: settings.scene === "waiting" || settings.scene === "reveal" || settings.scene === "finished",
        scores: { you: settings.yourScore, opponent: settings.opponentScore },
    };
}

// A quiet synthetic chord supplies real WAV bytes for the shared audio player
// and waveform, without downloading music or talking to a backend.
function createTone(seconds: number): ArrayBuffer {
    const sampleRate = 22050;
    const frames = Math.round(sampleRate * seconds);
    const bytes = new ArrayBuffer(44 + frames * 2);
    const view = new DataView(bytes);
    const text = (offset: number, value: string) => [...value].forEach((char, i) => view.setUint8(offset + i, char.charCodeAt(0)));
    text(0, "RIFF"); view.setUint32(4, bytes.byteLength - 8, true);
    text(8, "WAVEfmt "); view.setUint32(16, 16, true);
    view.setUint16(20, 1, true); view.setUint16(22, 1, true);
    view.setUint32(24, sampleRate, true); view.setUint32(28, sampleRate * 2, true);
    view.setUint16(32, 2, true); view.setUint16(34, 16, true);
    text(36, "data"); view.setUint32(40, frames * 2, true);
    for (let i = 0; i < frames; i++) {
        const time = i / sampleRate;
        const envelope = Math.min(1, time * 100, (seconds - time) * 100);
        const pulse = 0.6 + 0.4 * Math.sin(2 * Math.PI * 3 * time);
        const chord = Math.sin(2 * Math.PI * 261.63 * time) + Math.sin(2 * Math.PI * 329.63 * time);
        view.setInt16(44 + i * 2, Math.round(chord * envelope * pulse * 2200), true);
    }
    return bytes;
}

export class PreviewConnection implements GameConnection {
    connected = true;
    private settings = { ...DEFAULT_SETTINGS };
    private game = createView(this.settings);
    private listeners = new Map<keyof GameEvents, Map<object, (data: unknown) => void>>();
    private audio = new Map<number, ArrayBuffer>();

    on<K extends keyof GameEvents>(event: K, listener: (data: GameEvents[K]) => void) {
        let callbacks = this.listeners.get(event);
        if (!callbacks) this.listeners.set(event, callbacks = new Map());
        callbacks.set(listener, data => listener(data as GameEvents[K]));
    }

    off<K extends keyof GameEvents>(event: K, listener: (data: GameEvents[K]) => void) {
        this.listeners.get(event)?.delete(listener);
    }

    private notify<K extends keyof GameEvents>(event: K, data: GameEvents[K]) {
        for (const callback of this.listeners.get(event)?.values() ?? []) callback(data);
    }

    configure(settings: PreviewSettings) {
        const wasConnected = this.connected;
        this.settings = { ...settings };
        this.game = createView(settings);
        this.connected = settings.scene !== "disconnected";
        if (!this.connected) this.notify("disconnect", undefined);
        else {
            if (!wasConnected) this.notify("connect", undefined);
            this.publish();
        }
    }

    private publish() {
        if (!this.connected) return;
        if (this.settings.scene === "opponent-left") {
            this.notify("matchCancelled", { roomId: PREVIEW_ROOM, message: "Your opponent disconnected. Join the queue again to find another match." });
        } else if (this.settings.scene === "error") {
            this.notify("gameError", { message: "The game did not respond. Try loading it again." });
        } else {
            this.notify("gameState", { ...this.game, scores: { ...this.game.scores } });
        }
    }

    tick() {
        if (!this.connected || !["playing", "waiting"].includes(this.settings.scene)) return;
        if (this.game.roundPhase !== "guessing") return;
        if (this.settings.freezeTimer) this.game.roundEndsAt = Date.now() + this.settings.secondsLeft * 1000;
        if (Date.now() >= this.game.roundEndsAt) {
            this.game.roundPhase = "reveal";
            this.game.finishedRound = true;
        }
        this.publish();
    }

    emit(event: Parameters<GameConnection["emit"]>[0], data: GameRequest) {
        // Deliver responses after all effects have installed their listeners.
        queueMicrotask(() => this.respond(event, data));
    }

    private respond(event: Parameters<GameConnection["emit"]>[0], data: GameRequest) {
        if (!this.connected || data.roomId !== PREVIEW_ROOM) return;
        if (event === "getGameState") return this.publish();
        if (event === "getSongCatalog") return this.notify("songCatalog", { roomId: PREVIEW_ROOM, songs: SONGS });
        const game = this.game;
        const available = ["playing", "waiting"].includes(this.settings.scene) &&
            game.status === "playing" && game.roundPhase === "guessing" && !game.finishedRound &&
            data.roundNumber === game.roundNumber && Date.now() < game.roundEndsAt;
        if (event === "getClueAudio") {
            if (!available || data.clueIndex !== game.clueIndex) return;
            const identity = { roomId: PREVIEW_ROOM, roundNumber: game.roundNumber, clueIndex: game.clueIndex };
            if (this.settings.audioError) return this.notify("clueAudioError", { ...identity, message: "Preview audio could not load. Turn off Audio error to retry." });
            let audio = this.audio.get(game.clueIndex);
            if (!audio) this.audio.set(game.clueIndex, audio = createTone(game.clueSeconds));
            return this.notify("clueAudio", { ...identity, audio, mimeType: "audio/wav" });
        }
        const result = { roomId: PREVIEW_ROOM, roundNumber: game.roundNumber, accepted: available };
        if (!available) return this.notify(event === "submitGuess" ? "guessResult" : "clueResult", result);
        const correct = event === "submitGuess" && data.songId === "preview-1";
        const score = correct ? Math.round(1000 * [1, 0.8, 0.6, 0.4, 0.2][game.clueIndex]!) : 0;
        if (correct) {
            game.scores.you = (game.scores.you ?? 0) + score;
            game.finishedRound = true;
        } else if (game.clueIndex < CLUES.length - 1) {
            game.clueSeconds = CLUES[++game.clueIndex]!;
        } else game.finishedRound = true;
        if (event === "submitGuess") this.notify("guessResult", { ...result, correct, score });
        else this.notify("clueResult", { ...result, finishedRound: game.finishedRound });
        this.publish();
    }
}
