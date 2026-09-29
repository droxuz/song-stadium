"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { useSocket } from "../../SocketProvider";

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
            <main className="mx-auto w-full max-w-3xl px-6 py-10">
                <p role="alert">This game link is invalid.</p>
                <Link href="/" className="mt-4 inline-block underline">Back to home</Link>
            </main>
        );
    }
    // Reset page state for a different room, preserving the shared socket.
    return <GameRoom key={roomId} roomId={roomId} />;
}

function GameRoom({ roomId }: { roomId: string }) {
    const socket = useSocket();
    const [game, setGame] = useState<PlayerGameView | null>(null);
    const [songId, setSongId] = useState("");
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
        }

        function handleGameState(data: PlayerGameView) {
            if (data.roomId !== roomId) return;
            clearTimeout(stateTimeout);
            if (data.roundNumber !== currentRound.current) {
                currentRound.current = data.roundNumber;
                setSongId("");
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
    const buttonClass = "rounded-lg border border-zinc-300 px-5 py-3 font-medium hover:bg-zinc-100 disabled:cursor-not-allowed disabled:opacity-40 dark:border-zinc-700 dark:hover:bg-zinc-800";
    const phaseMessage = !game ? "Loading your game…"
        : game.status === "finished" ? "Game finished. Final scores are below."
        : game.roundPhase === "reveal" ? "Round complete. The next round will start shortly."
        : game.finishedRound ? "Your round is complete. Waiting for your opponent."
        : secondsLeft === 0 ? "Time is up. Waiting for the server to end the round."
        : "Guess the song or skip for a longer clue.";

    return (
        <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-6 px-6 py-10 text-zinc-950 dark:text-zinc-50">
            <header className="flex flex-wrap items-center justify-between gap-3">
                <div>
                    <p className="text-sm text-zinc-500">Song Stadium</p>
                    <h1 className="text-3xl font-semibold">{game ? `Round ${game.roundNumber}` : "Your game"}</h1>
                </div>
                <span className="text-sm text-zinc-500">{connection}</span>
            </header>

            {error ? (
                <section className="rounded-xl border border-amber-400 p-5" aria-label="Game unavailable">
                    <p role="alert">{error}</p>
                    {!cancelled && (
                        <button type="button" className={`${buttonClass} mt-4`} disabled={!socket?.connected}
                            onClick={() => setRequestVersion(version => version + 1)}>
                            Load game again
                        </button>
                    )}
                </section>
            ) : (
                <p role="status" aria-live="polite">{phaseMessage}</p>
            )}

            {game && (
                <>
                    <section aria-label="Scores" className="grid grid-cols-2 gap-4">
                        {Object.entries(game.scores)
                            .sort(([a], [b]) => a === game.playerID ? -1 : b === game.playerID ? 1 : 0)
                            .map(([id, score]) => (
                            <div key={id} className="rounded-xl border border-zinc-200 p-5 dark:border-zinc-800">
                                <h2 className="text-sm text-zinc-500">{id === game.playerID ? "You" : "Opponent"}</h2>
                                <p className="mt-1 text-3xl font-semibold tabular-nums">{score} <span className="text-sm font-normal">points</span></p>
                            </div>
                        ))}
                    </section>

                    {game.status === "playing" && (
                        <section className="rounded-xl border border-zinc-200 p-6 dark:border-zinc-800" aria-label="Song clue">
                            <div className="flex items-center justify-between gap-4">
                                <h2 className="text-lg font-medium">Clue {game.clueIndex + 1} · {game.clueSeconds} seconds</h2>
                                <span role="timer" aria-label="Time remaining" className="tabular-nums">
                                    {game.roundPhase === "guessing" ? `${secondsLeft}s left` : "Round complete"}
                                </span>
                            </div>
                            <p className="mt-3 text-sm text-zinc-500">Audio and song search are not connected yet. Enter a song ID to test guessing.</p>
                            <form onSubmit={handleSubmitGuess} className="mt-6 flex flex-col gap-3">
                                <label htmlFor="song-guess" className="font-medium">Your guess</label>
                                <input id="song-guess" value={songId} onChange={event => setSongId(event.target.value)}
                                    placeholder="Enter a song ID" maxLength={200} required autoComplete="off" disabled={!canAct}
                                    className="w-full rounded-lg border border-zinc-300 bg-transparent px-4 py-3 disabled:opacity-40 dark:border-zinc-700" />
                                <div className="flex flex-wrap gap-3">
                                    <button type="submit" disabled={!canAct || !songId.trim()} className={buttonClass}>Submit guess</button>
                                    <button type="button" disabled={!canAct} onClick={() => sendAction("skipClue")} className={buttonClass}>Skip clue</button>
                                </div>
                            </form>
                        </section>
                    )}
                    <p role="status" aria-live="polite" className="min-h-6">{feedback}</p>
                </>
            )}

            <footer className="mt-auto flex flex-col gap-3 pt-6 text-sm text-zinc-500">
                <p className="break-all">Room: {roomId}</p>
                <Link href="/" className="w-fit underline underline-offset-4">Back to home</Link>
            </footer>
        </main>
    );
}
