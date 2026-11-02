import { execFile } from "node:child_process";
import { promisify } from "node:util";

const runFile = promisify(execFile);

export async function clipAudio(filePath: string, durationSeconds: number, start: number = 0): Promise<Buffer>{
    if (!Number.isFinite(durationSeconds) || durationSeconds <= 0 || durationSeconds > 5){
        throw new Error("Clip duration invalid");
    }
    if (!Number.isFinite(start) || start < 0){
        throw new Error("Clip start must be non-negative")
    }

    //Obtain stdout from using FFMPEG and backend node services
    const {stdout} = await runFile(
        "ffmpeg",
        [
            "-hide_banner",
            "-loglevel","error",
            "-nostdin",
            "-ss", String(start),
            "-i", filePath,
            "-t", String(durationSeconds),
            "-map","0:a:0",
            "-map_metadata", "-1",
            "-map_metadata:s:a", "-1",
            "-map_chapters", "-1",
            // Preserve the input channel layout and sample rate. WAV adds no lossy encode.
            "-c:a", "pcm_s16le",
            "-f", "wav",
            "pipe:1",
        ],
        {
            encoding: "buffer",
            maxBuffer: 2 * 1024 * 1024,
            timeout: 10_000,
            windowsHide: true,
        },
    );

    return stdout;
}
