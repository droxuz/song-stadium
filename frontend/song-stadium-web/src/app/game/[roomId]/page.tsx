"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { useSocket } from "../../SocketProvider";
import ClueAudio from "./ClueAudio";
import SongSearch from "./SongSearch";
import type { SongOption } from "@/lib/song-search";
import { ListeningRoom, RecordArtwork, ClueWaveform } from "../../components/ListeningRoom";

// Public response only. The correct song and private state stay on the backend.
interface PlayerGameView {
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

interface ActionResult {
    roomId: string;
    roundNumber: number;
    accepted: boolean;
    correct?: boolean;
    score?: number;
    finishedRound?: boolean;
}

export default function GamePage() {
    const { roomId: routeRoomId } = useParams<{ roomId: string }>();
    let roomId: string;
    try {
        roomId = decodeURIComponent(routeRoomId);
    } catch {
        return (
            <ListeningRoom inGame connection="Invalid game link">
                <section className="lr-error">
                    <p role="alert">This game link is invalid.</p>
                    <Link href="/" className="lr-text-button">Back to the lobby</Link>
                </section>
            </ListeningRoom>
        );
    }
    // Reset page state for a different room, preserving the shared socket.
    return <GameRoom key={roomId} roomId={roomId} />;
}

function GameRoom({ roomId }: { roomId: string }) {
    const socket = useSocket();
    const [game, setGame] = useState<PlayerGameView | null>(null);
    const [songId, setSongId] = useState("");
    const [songQuery, setSongQuery] = useState("");
    const [songs, setSongs] = useState<SongOption[]>([]);
    const [volume, setVolume] = useState(0.7);
    const [connection, setConnection] = useState("Connecting to the server…");
    const [error, setError] = useState<string | null>(null);
    const [feedback, setFeedback] = useState("");
    const [pending, setPending] = useState(false);
    const [cancelled, setCancelled] = useState(false);
    const [requestVersion, setRequestVersion] = useState(0);
    const [now, setNow] = useState(() => Date.now());
    const currentRound = useRef(0);
    const actionPending = useRef(false);

    useEffect(() => {
        if (!socket) return;
        let stateTimeout: ReturnType<typeof setTimeout> | undefined;

        function handleGetState() {
            if (!socket?.connected) return;
            setConnection("Connected");
            setError(null);
            clearTimeout(stateTimeout);
            stateTimeout = setTimeout(() => {
                setGame(null);
                setError("The game did not respond. Try loading it again.");
            }, 8000);
            socket.emit("getGameState", { roomId });
            socket.emit("getSongCatalog", { roomId });
        }

        function handleGameState(data: PlayerGameView) {
            if (data.roomId !== roomId) return;
            clearTimeout(stateTimeout);
            if (data.roundNumber !== currentRound.current) {
                currentRound.current = data.roundNumber;
                setSongId("");
                setSongQuery("");
                setFeedback("");
                actionPending.current = false;
                setPending(false);
            }
            setGame(data);
            setError(null);
            setNow(Date.now());
        }

        function handleResult(data: ActionResult, isGuess: boolean) {
            if (data.roomId !== roomId) return;
            actionPending.current = false;
            setPending(false);
            if (data.roundNumber !== currentRound.current || !data.accepted) {
                setFeedback("That action is no longer available. Updating the game…");
                handleGetState();
                return;
            }
            if (isGuess) {
                setSongId("");
                setSongQuery("");
                setFeedback(data.correct
                    ? `Correct! You earned ${data.score ?? 0} points.`
                    : "Incorrect. Try another song or skip to a longer clue.");
            } else {
                setFeedback(data.finishedRound
                    ? "No clues left. Waiting for the round to finish."
                    : "Your next clue is ready.");
            }
        }

        const handleGuessResult = (data: ActionResult) => handleResult(data, true);
        const handleClueResult = (data: ActionResult) => handleResult(data, false);

        function handleCatalog(data: { roomId: string; songs: SongOption[] }) {
            if (data.roomId === roomId) setSongs(data.songs);
        }

        function handleGameError(data: { message: string }) {
            clearTimeout(stateTimeout);
            actionPending.current = false;
            setPending(false);
            setGame(null);
            setError(data.message);
        }

        function handleCancelled(data: { roomId: string; message: string }) {
            if (data.roomId !== roomId) return;
            handleGameError(data);
            setCancelled(true);
        }

        function handleDisconnect() {
            clearTimeout(stateTimeout);
            actionPending.current = false;
            setPending(false);
            setGame(null);
            setConnection("Disconnected");
            setError("Connection lost. Your current match cannot be restored automatically.");
        }

        function handleConnectError() {
            handleDisconnect();
            setError("Cannot reach the server. Reconnecting…");
        }

        // Listen before requesting the initial state.
        socket.on("gameState", handleGameState);
        socket.on("songCatalog", handleCatalog);
        socket.on("guessResult", handleGuessResult);
        socket.on("clueResult", handleClueResult);
        socket.on("gameError", handleGameError);
        socket.on("matchCancelled", handleCancelled);
        socket.on("connect", handleGetState);
        socket.on("disconnect", handleDisconnect);
        socket.on("connect_error", handleConnectError);
        if (socket.connected) handleGetState();

        return () => {
            clearTimeout(stateTimeout);
            socket.off("gameState", handleGameState);
            socket.off("songCatalog", handleCatalog);
            socket.off("guessResult", handleGuessResult);
            socket.off("clueResult", handleClueResult);
            socket.off("gameError", handleGameError);
            socket.off("matchCancelled", handleCancelled);
            socket.off("connect", handleGetState);
            socket.off("disconnect", handleDisconnect);
            socket.off("connect_error", handleConnectError);
        };
    }, [socket, roomId, requestVersion]);

    useEffect(() => {
        const timer = setInterval(() => setNow(Date.now()), 250);
        return () => clearInterval(timer);
    }, []);

    useEffect(() => {
        if (!pending) return;
        const timeout = setTimeout(() => {
            actionPending.current = false;
            setPending(false);
            setGame(null);
            setError("No response received. Load the game again before submitting another action.");
        }, 8000);
        return () => clearTimeout(timeout);
    }, [pending]);

    const canAct = Boolean(socket?.connected && game && !error && !cancelled && !pending &&
        game.status === "playing" && game.roundPhase === "guessing" &&
        !game.finishedRound && now < game.roundEndsAt);

    function sendAction(event: "submitGuess" | "skipClue") {
        if (!socket?.connected || !game || !canAct || actionPending.current) return;
        if (event === "submitGuess" && !songId.trim()) return;
        actionPending.current = true;
        setPending(true);
        setFeedback("Waiting for the server…");
        socket.emit(event, {
            roomId,
            roundNumber: game.roundNumber,
            ...(event === "submitGuess" ? { songId: songId.trim() } : {}),
        });
    }

    function handleSubmitGuess(event: FormEvent<HTMLFormElement>) {
        event.preventDefault();
        sendAction("submitGuess");
    }

    const secondsLeft = game ? Math.max(0, Math.ceil((game.roundEndsAt - now) / 1000)) : 0;
    const phaseMessage = !game ? "Loading your game…"
        : game.status === "finished" ? "Game finished. Final scores are ready."
        : game.roundPhase === "reveal" ? "Round complete. The next round will start shortly."
        : game.finishedRound ? "Your round is complete. Waiting for your opponent."
        : secondsLeft === 0 ? "Time is up. Waiting for the server to end the round."
        : "Guess the song or skip for a longer clue.";

    return (
        <ListeningRoom inGame connection={connection}>
            <header className="lr-game-heading">
                <div>
                    <span className="lr-eyebrow">Drop the needle. Trust your ears.</span>
                    <h1>{game?.status === "finished" ? "That's a wrap." : "Does this ring a bell?"}</h1>
                </div>
                <div className="lr-clock" role="timer" aria-label="Time remaining">
                    <span>{game?.roundPhase === "guessing" ? "TIME LEFT" : "THE MATCH"}</span>
                    <b>{game?.roundPhase === "guessing" ? `00:${String(secondsLeft).padStart(2, "0")}` : "—"}</b>
                    <span>{game ? `ROUND ${game.roundNumber} / 02` : "CONNECTING"}</span>
                </div>
            </header>

            {error ? (
                <section className="lr-error" aria-label="Game unavailable">
                    <p role="alert">{error}</p>
                    {!cancelled && (
                        <button type="button" className="lr-secondary" disabled={!socket?.connected}
                            onClick={() => setRequestVersion(version => version + 1)}>
                            Load game again
                        </button>
                    )}
                </section>
            ) : (
                <p className="lr-phase" role="status" aria-live="polite">{phaseMessage}</p>
            )}

            {game && (
                <div className="lr-game-grid">
                    {game.status === "playing" ? (
                        <section className="lr-player" aria-label="Song clue">
                            <div className="lr-card-heading">
                                <h2 className="lr-eyebrow">Your audio clue · {game.clueIndex + 1} of 5</h2>
                                <span className="lr-pill">{game.clueSeconds} SECONDS</span>
                            </div>
                            <div className="lr-player-art"><RecordArtwork /><ClueWaveform /></div>
                            <div className="lr-playback">
                                {socket?.connected && !error && !cancelled && game.roundPhase === "guessing" &&
                                    !game.finishedRound && secondsLeft > 0 && (
                                    <ClueAudio key={`${game.roundNumber}:${game.clueIndex}`} socket={socket}
                                        roomId={roomId} roundNumber={game.roundNumber} clueIndex={game.clueIndex}
                                        disabled={pending} volume={volume} />
                                )}
                                <label className="lr-volume" htmlFor="clue-volume">
                                    <span>Volume</span>
                                    <input id="clue-volume" type="range" min="0" max="100" step="1"
                                        value={Math.round(volume * 100)} aria-valuetext={`${Math.round(volume * 100)} percent`}
                                        onChange={event => setVolume(Number(event.target.value) / 100)} />
                                    <span>{Math.round(volume * 100)}%</span>
                                </label>
                            </div>
                            <div className="lr-clues" aria-label={`Clue ${game.clueIndex + 1} of 5`}>
                                {[0.1, 0.2, 0.5, 1, 5].map((seconds, index) => (
                                    <div key={seconds} className={index <= game.clueIndex ? "unlocked" : undefined}>
                                        <i aria-hidden="true" /><span>{seconds}s</span>
                                    </div>
                                ))}
                            </div>
                            <p className="lr-instructions">Listen closely, then choose your song. A longer clue gives you more to go on, but fewer available points.</p>
                            <form onSubmit={handleSubmitGuess}>
                                <SongSearch songs={songs} query={songQuery} selectedId={songId} disabled={!canAct}
                                    onChange={(query, id) => { setSongQuery(query); setSongId(id); }} />
                                <div className="lr-guess-actions">
                                    <button type="submit" disabled={!canAct || !songId.trim()} className="lr-primary">Lock in guess <span aria-hidden="true">↗</span></button>
                                    <button type="button" disabled={!canAct} onClick={() => sendAction("skipClue")} className="lr-text-button">Skip for a longer clue →</button>
                                </div>
                            </form>
                            <p role="status" aria-live="polite" className="lr-feedback">{feedback}</p>
                        </section>
                    ) : (
                        <section className="lr-player lr-results" aria-label="Match complete">
                            <h2>Good listening.</h2>
                            <p>Two rounds, a few familiar notes, and a friendly rivalry. Your final scores are on the board.</p>
                            <Link href="/" className="lr-primary">Back to the lobby <span aria-hidden="true">↗</span></Link>
                        </section>
                    )}
                    <aside className="lr-scoreboard" aria-label="Scores">
                        <div className="lr-score-heading"><span className="lr-eyebrow">{game.status === "finished" ? "Final scores" : "The match"}</span><span>ROUND {game.roundNumber} / 02</span></div>
                        {Object.entries(game.scores)
                            .sort(([a], [b]) => a === game.playerID ? -1 : b === game.playerID ? 1 : 0)
                            .map(([id, score]) => (
                            <div key={id} className="lr-score">
                                <span className="lr-score-avatar" aria-hidden="true">{id === game.playerID ? "YOU" : "OP"}</span>
                                <div><h2>{id === game.playerID ? "You" : "Opponent"}</h2><small>{id === game.playerID ? "YOUR SCORE" : "THE OTHER LISTENER"}</small></div>
                                <strong aria-label={`${score} points`}>{score.toLocaleString()}</strong>
                            </div>
                        ))}
                        <div className="lr-score-note"><span className="lr-eyebrow">A little reminder</span><p>The shorter the clue,<br />the sweeter the score.</p></div>
                        <p className="lr-room-label">Room: {roomId}</p>
                    </aside>
                </div>
            )}
        </ListeningRoom>
    );
}
