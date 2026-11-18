import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { CLUES } from "./game.js";

const runFile = promisify(execFile);

async function encodeWav(args: string[]): Promise<Buffer> {
    const { stdout } = await runFile("ffmpeg", args, {
        encoding: "buffer",
        maxBuffer: 2 * 1024 * 1024,
        timeout: 10_000,
        windowsHide: true,
    });
    return stdout;
}

// FFmpeg decodes only the longest clue, once. All shorter clues are exact PCM
// prefixes with their own valid WAV headers, not additional FFmpeg invocations.
export async function prepareClueAudio(
    filePath: string,
    start: number = 0,
    runFFmpeg: (args: string[]) => Promise<Buffer> = encodeWav,
): Promise<readonly Buffer[]> {
    if (!Number.isFinite(start) || start < 0){
        throw new Error("Clip start must be non-negative")
    }

    //Obtain stdout from using FFMPEG and backend node services
    const longest = Math.max(...CLUES.map(clue => clue.seconds));
    const wav = await runFFmpeg(
        [
            "-hide_banner",
            "-loglevel","error",
            "-nostdin",
            "-ss", String(start),
            "-i", filePath,
            "-t", String(longest),
            "-map","0:a:0",
            "-map_metadata", "-1",
            "-map_metadata:s:a", "-1",
            "-map_chapters", "-1",
            // Preserve the input channel layout and sample rate. WAV adds no lossy encode.
            "-c:a", "pcm_s16le",
            "-f", "wav",
            "pipe:1",
        ],
    );

    if (wav.length < 12 || wav.toString("ascii", 0, 4) !== "RIFF" || wav.toString("ascii", 8, 12) !== "WAVE") {
        throw new Error("FFmpeg did not produce a WAV file");
    }
    let sampleRate = 0;
    let blockAlign = 0;
    let dataOffset = 0;
    let dataBytes = 0;
    for (let offset = 12; offset + 8 <= wav.length;) {
        const type = wav.toString("ascii", offset, offset + 4);
        const size = wav.readUInt32LE(offset + 4);
        const begin = offset + 8;
        if (type === "fmt ") {
            if (size < 16 || begin + size > wav.length) throw new Error("Invalid WAV format");
            const format = wav.readUInt16LE(begin);
            const pcm = format === 1 || (format === 0xfffe && size >= 40 && wav.readUInt32LE(begin + 24) === 1);
            const channels = wav.readUInt16LE(begin + 2);
            sampleRate = wav.readUInt32LE(begin + 4);
            blockAlign = wav.readUInt16LE(begin + 12);
            if (!pcm || wav.readUInt16LE(begin + 14) !== 16 || !channels || blockAlign !== channels * 2) {
                throw new Error("Expected 16-bit PCM audio");
            }
        } else if (type === "data") {
            dataOffset = begin;
            // Piped FFmpeg WAV files use 0xffffffff when the size is not known.
            dataBytes = Math.min(size, wav.length - begin);
            break;
        }
        if (begin + size > wav.length) throw new Error("Truncated WAV chunk");
        offset = begin + size + (size % 2);
    }
    if (!sampleRate || !blockAlign || !dataOffset) throw new Error("WAV audio data is missing");
    if (dataBytes < Math.round(longest * sampleRate) * blockAlign) {
        throw new Error("Source audio is shorter than the longest clue");
    }

    return CLUES.map(({ seconds }) => {
        const bytes = Math.round(seconds * sampleRate) * blockAlign;
        const clip = Buffer.concat([wav.subarray(0, dataOffset), wav.subarray(dataOffset, dataOffset + bytes)]);
        clip.writeUInt32LE(clip.length - 8, 4);
        clip.writeUInt32LE(bytes, dataOffset - 4);
        return clip;
    });
}
