import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFile } from 'node:fs/promises';
import { songSuggestions } from '../src/song-catalog.ts';
import { searchSongs } from '../../frontend/song-stadium-web/src/lib/song-search.ts';

test('public catalog includes every playable title with its actual scoring ID, without audio paths', async () => {
    const playable = JSON.parse(await readFile(new URL('../music/music-stub.json', import.meta.url), 'utf8'));
    assert.ok(songSuggestions.length >= 300);
    assert.equal(new Set(songSuggestions.map(song => song.id)).size, songSuggestions.length);
    for (const song of playable) {
        const suggestion = songSuggestions.find(item => item.title === song['song-name']);
        assert.equal(suggestion?.id, String(song['song-id']));
    }
    for (const song of songSuggestions) assert.deepEqual(Object.keys(song).sort(), ['artist', 'id', 'title']);
});

test('lexical search finds titles with case, punctuation, spaces, and artist tokens', () => {
    assert.equal(searchSongs(songSuggestions, 'PASSION')[0].id, '1');
    assert.equal(searchSongs(songSuggestions, 'plot twist')[0].id, '2');
    assert.equal(searchSongs(songSuggestions, 'gods plan')[0].title, "God's Plan");
    assert.ok(searchSongs(songSuggestions, 'drake passion').some(song => song.id === '1'));
    assert.ok(searchSongs(songSuggestions, '100 catch').some(song => song.title.includes('Catch Up')));
    assert.deepEqual(searchSongs(songSuggestions, '  '), []);
    assert.deepEqual(searchSongs(songSuggestions, 'no such song xyz'), []);
    assert.ok(searchSongs(songSuggestions, 'a').length <= 8);
    assert.equal(searchSongs(songSuggestions, 'passionfruit')[0].title, 'Passionfruit');
});
