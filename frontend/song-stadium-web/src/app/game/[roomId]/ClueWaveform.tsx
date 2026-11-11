"use client";

import { useId } from "react";
import type { ClueWaveformData } from "@/lib/clue-waveform";

export default function ClueWaveform({ data, progress, unavailable }: {
    data: ClueWaveformData | null;
    progress: number;
    unavailable: boolean;
}) {
    const clipId = useId();
    if (!data) return <div className="lr-waveform-placeholder" role="status">
        {unavailable ? "Waveform unavailable" : "Loading your clue’s waveform…"}
    </div>;
    const width = 768;
    const step = width / data.peaks.length;
    const position = Math.max(0, Math.min(1, progress)) * width;
    const bars = data.peaks.map(({ min, max }, index) => <rect key={index}
        x={index * step} y={50 - max * 45} width={Math.max(1, step - 2)} height={(max - min) * 45} />);
    return <div className="lr-waveform-display">
        <svg className="lr-waveform" viewBox={`0 0 ${width} 100`} preserveAspectRatio="none"
            role="img" aria-label={`Audio amplitude waveform of your ${data.duration}-second clue`}>
            <title>Actual clue audio, from left to right. Only the unlocked clip is shown.</title>
            <defs><clipPath id={clipId}><rect x="0" y="0" width={position} height="100" /></clipPath></defs>
            <line className="lr-waveform-baseline" x1="0" x2={width} y1="50" y2="50" />
            <g className="lr-waveform-unplayed">{bars}</g>
            <g className="lr-waveform-played" clipPath={`url(#${clipId})`}>{bars}</g>
            {progress > 0 && <line className="lr-waveform-playhead" x1={position} x2={position} y1="0" y2="100" />}
        </svg>
        <div className="lr-waveform-time"><span>0s</span><span>Current clue only</span><span>{data.duration}s</span></div>
    </div>;
}
