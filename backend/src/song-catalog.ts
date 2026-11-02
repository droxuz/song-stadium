import { readFile } from 'node:fs/promises';

interface SongOption { id: string; title: string; artist: string }
interface PlayableSong { 'song-id': number; 'song-name': string }
const catalog: { songs: SongOption[] } = JSON.parse(await readFile(
    new URL('../music/drake-songs.json', import.meta.url), 'utf8',
));
const playable: PlayableSong[] = JSON.parse(await readFile(
    new URL('../music/music-stub.json', import.meta.url), 'utf8',
));
const normalize = (title: string) => title.normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase().replace(/['’‘]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();

// Public suggestions are independent of this round's answer. Only local audio can
// be selected for a round; map its title to the same ID used by server scoring.
const options = new Map(catalog.songs.map(song => [normalize(song.title), {
    id: song.id, title: song.title, artist: song.artist,
}]));
for (const song of playable) {
    const title = song['song-name'];
    options.set(normalize(title), { id: String(song['song-id']), title, artist: 'Drake' });
}

export const songSuggestions = [...options.values()].sort((a, b) => a.title.localeCompare(b.title, 'en'));
