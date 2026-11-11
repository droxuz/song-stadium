export interface WaveformPeak { min: number; max: number }
export interface ClueWaveformData { peaks: WaveformPeak[]; duration: number }

// Read the server's 16-bit PCM WAV directly: no microphone, audio device, volume
// adjustment, or full-song download is needed to display the actual samples.
export function readClueWaveform(bytes: ArrayBuffer, barCount = 128): ClueWaveformData {
    if (!Number.isInteger(barCount) || barCount < 1 || barCount > 1024) {
        throw new Error("Invalid waveform resolution");
    }
    const view = new DataView(bytes);
    const text = (offset: number, length: number) => String.fromCharCode(
        ...new Uint8Array(bytes, offset, length),
    );
    if (bytes.byteLength < 12 || text(0, 4) !== "RIFF" || text(8, 4) !== "WAVE") {
        throw new Error("Expected a PCM WAV clue");
    }
    let channels = 0;
    let sampleRate = 0;
    let blockAlign = 0;
    let dataOffset = 0;
    let dataBytes = 0;
    for (let offset = 12; offset + 8 <= bytes.byteLength;) {
        const type = text(offset, 4);
        const size = view.getUint32(offset + 4, true);
        const start = offset + 8;
        if (type === "fmt ") {
            if (size < 16 || start + size > bytes.byteLength) throw new Error("Invalid WAV format");
            const format = view.getUint16(start, true);
            const isPCM = format === 1 || (format === 0xfffe && size >= 40 &&
                view.getUint32(start + 24, true) === 1);
            if (!isPCM || view.getUint16(start + 14, true) !== 16) {
                throw new Error("Expected 16-bit PCM samples");
            }
            channels = view.getUint16(start + 2, true);
            sampleRate = view.getUint32(start + 4, true);
            blockAlign = view.getUint16(start + 12, true);
        } else if (type === "data") {
            dataOffset = start;
            // FFmpeg piping WAV to stdout uses an unknown-length 0xffffffff header.
            dataBytes = Math.min(size, bytes.byteLength - start);
            break;
        }
        if (start + size > bytes.byteLength) throw new Error("Truncated WAV chunk");
        offset = start + size + (size % 2);
    }
    if (!channels || !sampleRate || blockAlign !== channels * 2 || !dataOffset) {
        throw new Error("Invalid PCM clue");
    }
    const frames = Math.floor(dataBytes / blockAlign);
    if (!frames) throw new Error("Clue contains no samples");
    const count = Math.min(barCount, frames);
    const peaks = Array.from({ length: count }, (_, index) => {
        const first = Math.floor(index * frames / count);
        const end = Math.floor((index + 1) * frames / count);
        let min = 1;
        let max = -1;
        for (let frame = first; frame < end; frame++) {
            // Preserve peaks across channels instead of averaging stereo, which
            // could hide a sound whose left/right channels have opposite phase.
            for (let channel = 0; channel < channels; channel++) {
                const sample = view.getInt16(dataOffset + frame * blockAlign + channel * 2, true) / 32768;
                min = Math.min(min, sample);
                max = Math.max(max, sample);
            }
        }
        return { min, max };
    });
    return { peaks, duration: frames / sampleRate };
}
