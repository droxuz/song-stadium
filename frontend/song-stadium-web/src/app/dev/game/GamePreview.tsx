"use client";

import { useEffect, useState } from "react";
import GameRoom from "../../game/[roomId]/GameRoom";
import { DEFAULT_SETTINGS, PREVIEW_ROOM, PreviewConnection, type PreviewScene } from "./preview-connection";
import "./preview.css";

export default function GamePreview() {
    const [connection] = useState(() => new PreviewConnection());
    const [settings, setSettings] = useState({ ...DEFAULT_SETTINGS });
    const [revision, setRevision] = useState(0);

    useEffect(() => { connection.configure(settings); }, [connection, settings]);
    useEffect(() => {
        const timer = setInterval(() => connection.tick(), 250);
        return () => clearInterval(timer);
    }, [connection]);

    function reset() {
        setSettings({ ...DEFAULT_SETTINGS });
        setRevision(value => value + 1);
    }

    return <>
        <aside className="game-preview-tools" aria-label="Game preview controls">
            <div className="game-preview-title">
                <strong>Game preview</strong>
                <span>Local sample data · no backend or second player</span>
                <button type="button" onClick={reset}>Reset preview</button>
            </div>
            <div className="game-preview-fields">
                <label>Screen
                    <select value={settings.scene} onChange={event => setSettings(current => ({ ...current, scene: event.target.value as PreviewScene }))}>
                        <option value="playing">Playing</option>
                        <option value="waiting">Waiting for opponent</option>
                        <option value="reveal">Round complete</option>
                        <option value="finished">Final results</option>
                        <option value="opponent-left">Opponent left</option>
                        <option value="disconnected">Connection lost</option>
                        <option value="error">Game error</option>
                    </select>
                </label>
                <label>Round
                    <select value={settings.roundNumber} onChange={event => setSettings(current => ({ ...current, roundNumber: Number(event.target.value) }))}>
                        <option value={1}>1</option><option value={2}>2</option>
                    </select>
                </label>
                <label>Clue
                    <select value={settings.clueIndex} onChange={event => setSettings(current => ({ ...current, clueIndex: Number(event.target.value) }))}>
                        {[0.1, 0.2, 0.5, 1, 5].map((seconds, index) => <option key={seconds} value={index}>{index + 1} · {seconds}s</option>)}
                    </select>
                </label>
                <label>Seconds left
                    <input type="number" min={0} max={60} value={settings.secondsLeft} onChange={event => setSettings(current => ({ ...current, secondsLeft: Math.max(0, Math.min(60, Number(event.target.value))) }))} />
                </label>
                <label>Your score
                    <input type="number" min={0} max={999999} value={settings.yourScore} onChange={event => setSettings(current => ({ ...current, yourScore: Math.max(0, Number(event.target.value)) }))} />
                </label>
                <label>Opponent score
                    <input type="number" min={0} max={999999} value={settings.opponentScore} onChange={event => setSettings(current => ({ ...current, opponentScore: Math.max(0, Number(event.target.value)) }))} />
                </label>
                <label className="game-preview-check"><input type="checkbox" checked={settings.freezeTimer} onChange={event => setSettings(current => ({ ...current, freezeTimer: event.target.checked }))} />Freeze timer</label>
                <label className="game-preview-check"><input type="checkbox" checked={settings.audioError} onChange={event => setSettings(current => ({ ...current, audioError: event.target.checked }))} />Audio error</label>
            </div>
            <p>Guess Passionfruit for a correct answer, or skip clues. Audio is a generated tone. Requeue resets this preview.</p>
        </aside>
        <GameRoom key={`${settings.scene}:${settings.audioError}:${revision}`} roomId={PREVIEW_ROOM}
            connection={connection} onRequeue={reset} />
    </>;
}
