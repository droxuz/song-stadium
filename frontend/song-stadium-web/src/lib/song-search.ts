export interface SongOption {
    id: string;
    title: string;
    artist: string;
}

export function normalizeSearch(value: string): string {
    return value.normalize("NFKD").replace(/[\u0300-\u036f]/g, "")
        .toLowerCase().replace(/['’‘]/g, "").replace(/[^a-z0-9]+/g, " ").trim();
}

// Exact title, title prefix, then token matches. No network or fuzzy guessing.
export function searchSongs(songs: SongOption[], query: string, limit = 8): SongOption[] {
    const normalized = normalizeSearch(query);
    if (!normalized) return [];
    const tokens = normalized.split(/\s+/);
    return songs.map(song => {
        const title = normalizeSearch(song.title);
        const haystack = `${title} ${normalizeSearch(song.artist)}`;
        const rank = title === normalized ? 0 : title.startsWith(normalized) ? 1
            : title.includes(normalized) ? 2 : tokens.every(token => haystack.includes(token)) ? 3 : 4;
        return { song, rank };
    }).filter(result => result.rank < 4)
        .sort((a, b) => a.rank - b.rank || a.song.title.localeCompare(b.song.title))
        .slice(0, limit).map(result => result.song);
}
