import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { prepareClueAudio } from '../src/audio.ts';
import { CLUES } from '../src/game.ts';
import { readClueWaveform } from '../../frontend/song-stadium-web/src/lib/clue-waveform.ts';

test('invalid offsets are rejected before invoking FFmpeg', async () => {
    for (const start of [-1, NaN, Infinity]) {
        await assert.rejects(prepareClueAudio('unused.mp3', start), /start must be non-negative/);
    }
});

function pcmWav(seconds = 5, sampleRate = 48000, channels = 2) {
    const dataBytes = Math.round(seconds * sampleRate) * channels * 2;
    const wav = Buffer.alloc(44 + dataBytes);
    wav.write('RIFF', 0); wav.writeUInt32LE(0xffffffff, 4);
    wav.write('WAVEfmt ', 8); wav.writeUInt32LE(16, 16);
    wav.writeUInt16LE(1, 20); wav.writeUInt16LE(channels, 22);
    wav.writeUInt32LE(sampleRate, 24); wav.writeUInt32LE(sampleRate * channels * 2, 28);
    wav.writeUInt16LE(channels * 2, 32); wav.writeUInt16LE(16, 34);
    wav.write('data', 36); wav.writeUInt32LE(0xffffffff, 40);
    for (let offset = 44; offset < wav.length; offset += 2) {
        wav.writeInt16LE((offset * 37) % 65536 - 32768, offset);
    }
    return wav;
}

test('one FFmpeg decode produces all five exact stereo WAV intervals with correct headers', async () => {
    const source = pcmWav();
    let invocations = 0;
    const clips = await prepareClueAudio('private/song.mp3', 0, async args => {
        invocations++;
        assert.equal(args[args.indexOf('-i') + 1], 'private/song.mp3');
        assert.equal(args[args.indexOf('-t') + 1], '5');
        assert.equal(args.includes('-ac'), false);
        assert.equal(args.includes('-ar'), false);
        return source;
    });
    assert.equal(invocations, 1);
    assert.equal(clips.length, 5);
    for (const [index, { seconds }] of CLUES.entries()) {
        const clip = clips[index];
        const expectedBytes = Math.round(seconds * 48000) * 4;
        assert.equal(clip.readUInt32LE(4), clip.length - 8);
        assert.equal(clip.readUInt32LE(40), expectedBytes);
        assert.equal(clip.length, 44 + expectedBytes);
        assert.deepEqual(clip.subarray(44), source.subarray(44, 44 + expectedBytes));
        assert.equal(readClueWaveform(clip.buffer.slice(clip.byteOffset, clip.byteOffset + clip.byteLength)).duration, seconds);
    }
    const before = clips[1][44];
    clips[0][44] ^= 0xff;
    assert.equal(clips[1][44], before, 'each interval owns its WAV bytes');
    assert.equal(source.readUInt32LE(40), 0xffffffff, 'source buffer is unchanged');
});

test('malformed or too-short decoded audio never becomes a partially prepared clue set', async () => {
    await assert.rejects(prepareClueAudio('unused', 0, async () => Buffer.from('bad WAV')), /WAV/);
    await assert.rejects(prepareClueAudio('unused', 0, async () => pcmWav(1)), /shorter than the longest clue/);
    const malformed = pcmWav();
    malformed.writeUInt16LE(24, 34);
    await assert.rejects(prepareClueAudio('unused', 0, async () => malformed), /16-bit PCM/);
});

test('mono audio, odd-sized extra WAV chunks, and nonzero start offsets are preserved', async () => {
    const pcm = pcmWav(5, 44100, 1);
    const junk = Buffer.alloc(12);
    junk.write('JUNK'); junk.writeUInt32LE(3, 4);
    const source = Buffer.concat([pcm.subarray(0, 36), junk, pcm.subarray(36)]);
    const clips = await prepareClueAudio('unused', 3, async args => {
        assert.equal(args[args.indexOf('-ss') + 1], '3');
        return source;
    });
    for (const [index, { seconds }] of CLUES.entries()) {
        const clip = clips[index];
        assert.equal(clip.readUInt16LE(22), 1);
        assert.equal(clip.readUInt32LE(24), 44100);
        assert.equal(clip.readUInt32LE(52), Math.round(seconds * 44100) * 2);
        assert.equal(readClueWaveform(clip.buffer.slice(clip.byteOffset, clip.byteOffset + clip.byteLength)).duration, seconds);
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
    const clips = await prepareClueAudio(file);
    for (const [index, { seconds }] of CLUES.entries()) {
        const wav = clips[index];
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
        const waveform = readClueWaveform(wav.buffer.slice(wav.byteOffset, wav.byteOffset + wav.byteLength));
        assert.equal(waveform.duration, seconds);
        assert.equal(waveform.peaks.length, 128);
    }
});
