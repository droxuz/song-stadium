import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { clipAudio } from '../src/audio.ts';
import { CLUES } from '../src/game.ts';

test('invalid clip durations and offsets are rejected before invoking FFmpeg', async () => {
    for (const duration of [0, -1, NaN, Infinity, 5.1]) {
        await assert.rejects(clipAudio('unused.mp3', duration), /duration invalid/);
    }
    for (const start of [-1, NaN, Infinity]) {
        await assert.rejects(clipAudio('unused.mp3', 1, start), /start must be non-negative/);
    }
});

let hasFFmpeg = false;
try { execFileSync('ffmpeg', ['-version'], { stdio: 'ignore', windowsHide: true }); hasFFmpeg = true; } catch {}

test('FFmpeg produces exactly the permitted PCM samples for each clue without song metadata', {
    skip: !hasFFmpeg && 'FFmpeg is not installed on this host',
}, async () => {
    const file = fileURLToPath(new URL('../music/Passionfruit 4.mp3', import.meta.url));
    const { streams: [input] } = JSON.parse(execFileSync('ffprobe', [
        '-v', 'error', '-select_streams', 'a:0', '-show_entries', 'stream=sample_rate,channels', '-of', 'json', file,
    ], { encoding: 'utf8', windowsHide: true }));
    for (const { seconds } of CLUES) {
        const wav = await clipAudio(file, seconds);
        assert.equal(wav.toString('ascii', 0, 4), 'RIFF');
        assert.equal(wav.toString('ascii', 8, 12), 'WAVE');
        let pcmBytes;
        let channels;
        let sampleRate;
        for (let offset = 12; offset + 8 <= wav.length;) {
            const type = wav.toString('ascii', offset, offset + 4);
            const size = wav.readUInt32LE(offset + 4);
            if (type === 'fmt ') {
                channels = wav.readUInt16LE(offset + 10);
                sampleRate = wav.readUInt32LE(offset + 12);
                assert.equal(wav.readUInt16LE(offset + 22), 16);
            }
            if (type === 'data') { pcmBytes = wav.length - offset - 8; break; }
            offset += 8 + size + (size % 2);
        }
        assert.equal(channels, input.channels, 'preserve source channels rather than downmixing');
        assert.equal(sampleRate, Number(input.sample_rate), 'preserve source sample rate');
        assert.equal(pcmBytes, Math.round(sampleRate * seconds) * channels * 2);
        assert.equal(wav.includes(Buffer.from('Passionfruit')), false);
    }
});
