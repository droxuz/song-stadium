// Refresh public metadata only. No audio or preview URLs are downloaded or stored.
// Print refreshed JSON from backend: node scripts/refresh-song-catalog.mjs
// Review the output before replacing music/drake-songs.json.
import { readFile } from 'node:fs/promises';

const country = 'CA';
const artistId = 271256;
async function lookup(params) {
    const url = new URL('https://itunes.apple.com/lookup');
    url.search = new URLSearchParams({ country, ...params }).toString();
    const response = await fetch(url, { signal: AbortSignal.timeout(30_000) });
    if (!response.ok) throw new Error(`Apple lookup failed: ${response.status}`);
    return response.json();
}
const albums = await lookup({ id: String(artistId), entity: 'album', limit: '200' });
const ids = [...new Set(albums.results.filter(row => row.wrapperType === 'collection').map(row => row.collectionId))];
const songs = new Map();
const normalize = text => text.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
for (let offset = 0; offset < ids.length; offset += 20) {
    const result = await lookup({ id: ids.slice(offset, offset + 20).join(','), entity: 'song', limit: '200' });
    for (const track of result.results) {
        if (track.kind !== 'song' || !(track.artistId === artistId || /\bdrake\b/i.test(`${track.artistName} ${track.trackName}`))) continue;
        const title = track.trackName.replace(/\s*[([]feat\.?[^)\]]*[)\]]/gi, '').trim();
        const key = normalize(title);
        if (!key || songs.has(key)) continue;
        songs.set(key, { id: `drake:${key.replaceAll(' ', '-')}`, title, artist: track.artistName });
    }
}
// The local game catalog is authoritative for available audio, including custom tracks.
const playable = JSON.parse(await readFile(new URL('../music/music-stub.json', import.meta.url), 'utf8'));
for (const song of playable) {
    const key = normalize(song['song-name']);
    if (!songs.has(key)) songs.set(key, { id: `drake:${key.replaceAll(' ', '-')}`, title: song['song-name'], artist: 'Drake' });
}
if (songs.size < 250) throw new Error('Catalog is unexpectedly small; refusing to replace it.');
const catalog = {
    artist: 'Drake',
    source: 'https://music.apple.com/ca/artist/drake/271256',
    sourceApi: 'https://itunes.apple.com/lookup?id=271256&entity=album&limit=200&country=CA',
    retrievedAt: new Date().toISOString().slice(0, 10),
    scope: 'Distinct song titles credited to Drake from up to 200 Canadian Apple catalog releases, including collaborations and featured appearances returned by the lookup. Regional availability and lookup limits apply; not a guarantee of every unreleased or unofficial recording.',
    songs: [...songs.values()].sort((a, b) => a.title.localeCompare(b.title, 'en')),
};
process.stdout.write(JSON.stringify(catalog, null, 2) + '\n');
