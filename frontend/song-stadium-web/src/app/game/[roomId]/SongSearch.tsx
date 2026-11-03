"use client";

import { useId, useState, type KeyboardEvent } from "react";
import { searchSongs, type SongOption } from "@/lib/song-search";

export default function SongSearch({ songs, query, selectedId, disabled, onChange }: {
    songs: SongOption[];
    query: string;
    selectedId: string;
    disabled: boolean;
    onChange: (query: string, id: string) => void;
}) {
    const listId = useId();
    const [open, setOpen] = useState(false);
    const [activeIndex, setActiveIndex] = useState(0);
    const matches = searchSongs(songs, query);
    const visible = open && !disabled && query.trim().length > 0;

    function choose(song: SongOption) {
        onChange(song.title, song.id);
        setOpen(false);
    }

    function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
        if (event.key === "Escape") { setOpen(false); return; }
        if (event.key === "ArrowDown" || event.key === "ArrowUp") {
            event.preventDefault();
            setOpen(true);
            setActiveIndex(index => Math.max(0, Math.min(matches.length - 1,
                index + (event.key === "ArrowDown" ? 1 : -1))));
        }
        if (event.key === "Enter" && visible && matches[activeIndex]) {
            event.preventDefault();
            choose(matches[activeIndex]);
        }
    }

    return <div className="lr-song-search">
        <label htmlFor="song-guess">What’s on the turntable?</label>
        <input id="song-guess" role="combobox" aria-autocomplete="list" aria-expanded={visible}
            aria-controls={listId} aria-activedescendant={visible && matches[activeIndex] ? `${listId}-${activeIndex}` : undefined}
            aria-describedby={`${listId}-help`} value={query} maxLength={200} autoComplete="off"
            placeholder={songs.length ? "Search Drake songs…" : "Loading song catalog…"}
            disabled={disabled || !songs.length} onKeyDown={onKeyDown}
            onFocus={() => { if (!selectedId) setOpen(true); }}
            onBlur={() => setOpen(false)}
            onChange={event => {
                onChange(event.target.value, "");
                setActiveIndex(0);
                setOpen(true);
            }}
            className="lr-song-input" />
        {visible && <ul id={listId} role="listbox" aria-label="Matching songs"
            className="lr-song-options">
            {matches.map((song, index) => <li key={song.id} id={`${listId}-${index}`} role="option"
                aria-selected={activeIndex === index} onMouseDown={event => event.preventDefault()}
                onMouseEnter={() => setActiveIndex(index)} onClick={() => choose(song)}
                className={activeIndex === index ? "is-active" : undefined}>
                <strong>{song.title}</strong>
                <small>{song.artist}</small>
            </li>)}
            {!matches.length && <li>No matching songs. Try another title.</li>}
        </ul>}
        <p id={`${listId}-help`} className="lr-song-help" aria-live="polite">
            {selectedId ? `Selected: ${query}` : "Choose a suggestion, then submit your guess. Use arrow keys and Enter to select."}
        </p>
    </div>;
}
