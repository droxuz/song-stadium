import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readClueWaveform } from '../../frontend/song-stadium-web/src/lib/clue-waveform.ts';

function wav(frames, { streaming = false, trailingSamples = [] } = {}) {
    const channels = frames[0].length;
    const size = frames.length * channels * 2;
    const bytes = new ArrayBuffer(44 + size + trailingSamples.length * 2);
    const view = new DataView(bytes);
    const text = (offset, value) => [...value].forEach((char, i) => view.setUint8(offset + i, char.charCodeAt(0)));
    text(0, 'RIFF'); view.setUint32(4, streaming ? 0xffffffff : 36 + size, true);
    text(8, 'WAVE'); text(12, 'fmt '); view.setUint32(16, 16, true);
    view.setUint16(20, 1, true); view.setUint16(22, channels, true);
    view.setUint32(24, 48000, true); view.setUint32(28, 48000 * channels * 2, true);
    view.setUint16(32, channels * 2, true); view.setUint16(34, 16, true);
    text(36, 'data'); view.setUint32(40, streaming ? 0xffffffff : size, true);
    [...frames.flat(), ...trailingSamples].forEach((sample, i) => view.setInt16(44 + i * 2, sample, true));
    return bytes;
}

test('waveform follows actual amplitude, timing, and positive/negative transients', () => {
    const audio = wav([[0], [32767], [-32768], [0], [8192], [-8192], [100], [-100]]);
    const result = readClueWaveform(audio, 4);
    assert.equal(result.duration, 8 / 48000);
    assert.deepEqual(result.peaks, [
        { min: 0, max: 32767 / 32768 }, { min: -1, max: 0 },
        { min: -0.25, max: 0.25 }, { min: -100 / 32768, max: 100 / 32768 },
    ]);
    assert.notDeepEqual(result.peaks, readClueWaveform(wav(Array.from({ length: 8 }, () => [0])), 4).peaks);
    assert.deepEqual(readClueWaveform(audio, 4), result, 'replays produce the same identifiable shape');
});

test('stereo peaks do not cancel when left and right have opposite phase', () => {
    const result = readClueWaveform(wav([[32767, -32768], [-32768, 32767]]), 1);
    assert.deepEqual(result.peaks, [{ min: -1, max: 32767 / 32768 }]);
});

test('silence remains flat, short buffers have no fabricated bars, and the final sample is included', () => {
    assert.deepEqual(readClueWaveform(wav([[0], [0]]), 128).peaks, [{ min: 0, max: 0 }, { min: 0, max: 0 }]);
    const result = readClueWaveform(wav([[0], [0], [0], [0], [32767]]), 2);
    assert.equal(result.peaks.at(-1).max, 32767 / 32768);
});

test('FFmpeg streaming WAV headers work; declared data lengths exclude trailing bytes', () => {
    assert.deepEqual(readClueWaveform(wav([[100], [-100]], { streaming: true }), 1).peaks,
        [{ min: -100 / 32768, max: 100 / 32768 }]);
    const clipped = readClueWaveform(wav([[100]], { trailingSamples: [32767, -32768] }), 1);
    assert.equal(clipped.duration, 1 / 48000);
    assert.deepEqual(clipped.peaks, [{ min: 100 / 32768, max: 100 / 32768 }]);
});

test('invalid WAV and invalid resolutions fail instead of showing invented audio', () => {
    assert.throws(() => readClueWaveform(new ArrayBuffer(10)), /PCM WAV/);
    for (const count of [0, -1, 1.5, NaN, Infinity, 1025]) {
        assert.throws(() => readClueWaveform(wav([[0]]), count), /resolution/);
    }
    const truncated = wav([[0]]);
    new DataView(truncated).setUint32(16, 9999, true);
    assert.throws(() => readClueWaveform(truncated), /Invalid WAV/);
});
