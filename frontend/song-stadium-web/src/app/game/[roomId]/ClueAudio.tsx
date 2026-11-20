"use client";

import { useEffect, useRef, useState } from "react";
import type { ClueIdentity, GameConnection } from "@/lib/game-connection";
import { readClueWaveform, type ClueWaveformData } from "@/lib/clue-waveform";
import ClueWaveform from "./ClueWaveform";

// Mounted with a new key for each clue. URLs and playback belong only to this browser.
export default function ClueAudio({ socket, roomId, roundNumber, clueIndex, disabled, volume, available, onVolumeChange, onSkip }: ClueIdentity & {
    socket: GameConnection;
    disabled: boolean;
    volume: number;
    available: boolean;
    onVolumeChange: (volume: number) => void;
    onSkip: () => void;
}) {
    const audio = useRef<HTMLAudioElement>(null);
    const [source, setSource] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [retry, setRetry] = useState(0);
    const [waveform, setWaveform] = useState<ClueWaveformData | null>(null);
    const [waveformError, setWaveformError] = useState(false);
    const [playing, setPlaying] = useState(false);
    const [progress, setProgress] = useState(0);

    useEffect(() => {
        if (!available) return;
        let objectUrl: string | undefined;
        const element = audio.current;
        const matches = (data: ClueIdentity) => data.roomId === roomId &&
            data.roundNumber === roundNumber && data.clueIndex === clueIndex;
        const timeout = setTimeout(() => setError("Audio took too long to load. Please retry."), 15_000);

        function receive(data: ClueIdentity & { audio: ArrayBuffer; mimeType: string }) {
            if (!matches(data)) return;
            clearTimeout(timeout);
            if (objectUrl) URL.revokeObjectURL(objectUrl);
            objectUrl = URL.createObjectURL(new Blob([data.audio], { type: "audio/wav" }));
            try {
                setWaveform(readClueWaveform(data.audio));
                setWaveformError(false);
            } catch {
                // A display failure must not prevent the user listening/guessing.
                setWaveform(null);
                setWaveformError(true);
            }
            setProgress(0);
            setSource(objectUrl);
            setError(null);
        }

        function receiveError(data: ClueIdentity & { message: string }) {
            if (!matches(data)) return;
            clearTimeout(timeout);
            setError(data.message);
        }

        socket.on("clueAudio", receive);
        socket.on("clueAudioError", receiveError);
        socket.emit("getClueAudio", { roomId, roundNumber, clueIndex });
        return () => {
            clearTimeout(timeout);
            socket.off("clueAudio", receive);
            socket.off("clueAudioError", receiveError);
            element?.pause();
            element?.removeAttribute("src");
            element?.load();
            if (objectUrl) URL.revokeObjectURL(objectUrl);
        };
    }, [socket, roomId, roundNumber, clueIndex, retry, available]);

    useEffect(() => {
        if (!playing) return;
        let frame: number;
        function update() {
            const element = audio.current;
            const duration = waveform?.duration ?? element?.duration ?? 0;
            if (element && Number.isFinite(duration) && duration > 0) {
                setProgress(Math.max(0, Math.min(1, element.currentTime / duration)));
            }
            frame = requestAnimationFrame(update);
        }
        frame = requestAnimationFrame(update);
        return () => cancelAnimationFrame(frame);
    }, [playing, waveform]);

    useEffect(() => {
        if (disabled) audio.current?.pause();
    }, [disabled]);

    useEffect(() => {
        if (audio.current) audio.current.volume = volume;
    }, [volume]);

    async function play() {
        if (!audio.current || !source || disabled) return;
        try {
            setError(null);
            setProgress(0);
            audio.current.currentTime = 0;
            await audio.current.play();
        } catch {
            setError("Could not play this clue. Try playing it again.");
        }
    }

    return (
        <>
            <audio ref={audio} src={source ?? undefined} preload="auto"
                onPlay={() => setPlaying(true)} onPause={() => setPlaying(false)}
                onEnded={() => { setPlaying(false); setProgress(1); }}
                onError={() => { if (available) setError("Could not play this audio. Please retry loading it."); }} />
            <div className="lr-player-art">
                <ClueWaveform data={waveform} progress={progress}
                    unavailable={waveformError || Boolean(error) || !available} />
                <div className="lr-playback">
                    <div className="lr-audio-control" role="group" aria-label="Clue playback">
                        <button type="button" onClick={play} disabled={disabled || !source || !available}
                            className="lr-play" aria-label="Play clue" title="Play clue">
                            <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                                <path d="M8 5v14l11-7z" fill="currentColor" />
                            </svg>
                        </button>
                        <button type="button" onClick={onSkip} disabled={disabled || !available}
                            className="lr-play lr-skip" aria-label="Skip clue" title="Skip clue">
                            <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                                <path d="M5 5v14l10-7z" fill="currentColor" />
                                <path d="M18 5v14" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                            </svg>
                        </button>
                    </div>
                    <label className="lr-volume" htmlFor="clue-volume">
                        <span>Volume</span>
                        <input id="clue-volume" type="range" min="0" max="100" step="1"
                            value={Math.round(volume * 100)} aria-valuetext={`${Math.round(volume * 100)} percent`}
                            onChange={event => onVolumeChange(Number(event.target.value) / 100)} />
                        <span>{Math.round(volume * 100)}%</span>
                    </label>
                </div>
                {available && !source && !error && <p role="status" className="lr-audio-status">Loading audio…</p>}
                {error && available && <div role="alert" className="lr-audio-error">
                    <p>{error}</p>
                    <button type="button" className="lr-text-button" disabled={disabled} onClick={() => {
                        setSource(null);
                        setError(null);
                        setWaveform(null);
                        setWaveformError(false);
                        setProgress(0);
                        setRetry(value => value + 1);
                    }}>Retry loading audio</button>
                </div>}
            </div>
        </>
    );
}
