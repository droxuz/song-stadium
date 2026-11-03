"use client";

import { useEffect, useRef, useState } from "react";
import type { Socket } from "socket.io-client";

interface ClueIdentity {
    roomId: string;
    roundNumber: number;
    clueIndex: number;
}

// Mounted with a new key for each clue. URLs and playback belong only to this browser.
export default function ClueAudio({ socket, roomId, roundNumber, clueIndex, disabled, volume }: ClueIdentity & {
    socket: Socket;
    disabled: boolean;
    volume: number;
}) {
    const audio = useRef<HTMLAudioElement>(null);
    const [source, setSource] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [retry, setRetry] = useState(0);

    useEffect(() => {
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
    }, [socket, roomId, roundNumber, clueIndex, retry]);

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
            audio.current.currentTime = 0;
            await audio.current.play();
        } catch {
            setError("Could not play this clue. Try playing it again.");
        }
    }

    return (
        <div className="lr-audio-control">
            <audio ref={audio} src={source ?? undefined} preload="auto"
                onError={() => setError("Could not play this audio. Please retry loading it.")} />
            <button type="button" onClick={play} disabled={disabled || !source}
                className="lr-play">
                <span aria-hidden="true">▶</span>
                {source ? "Play / replay clue" : "Loading audio…"}
            </button>
            {error && <div role="alert" className="lr-audio-error">
                <p>{error}</p>
                <button type="button" className="lr-text-button" disabled={disabled} onClick={() => {
                    setSource(null);
                    setError(null);
                    setRetry(value => value + 1);
                }}>Retry loading audio</button>
            </div>}
        </div>
    );
}
