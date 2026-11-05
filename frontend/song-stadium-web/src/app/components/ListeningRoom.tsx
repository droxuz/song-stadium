import Link from "next/link";
import type { ReactNode } from "react";
import "./listening-room.css";

export function ListeningRoom({ children, inGame = false, connection }: {
    children: ReactNode;
    inGame?: boolean;
    connection: string;
}) {
    return <div className="listening-room">
        <header className="lr-nav">
            <Link href="/" className="lr-wordmark" aria-label="Song Stadium home">
                <svg viewBox="0 0 28 28" aria-hidden="true"><path d="M3 17V11M8 22V6M14 26V2M20 22V6M25 17V11" /></svg>
                The 6ix Sense<span>.</span>
            </Link>
            <nav aria-label="Main navigation">
                <Link href="/" aria-current={!inGame ? "page" : undefined}>Lobby</Link>
            </nav>
            <span className="lr-connection" data-connection={connection} role="status">
                <i aria-hidden="true" />{connection}
            </span>
        </header>
        <main className="lr-main">{children}</main>
        <footer className="lr-footer">
            <span>TORONTO ROOTS. WORLDWIDE EARS.</span>
            <span>THE 6IX SENSE © 2026</span>
        </footer>
    </div>;
}

export function RecordArtwork({ sleeve = false }: { sleeve?: boolean }) {
    const record = <div className="lr-record"><div className="lr-record-label"><span>THE 6IX SENSE</span><b></b><small>TORONTO CLASSICS</small></div></div>;
    return <div className={sleeve ? "lr-record-scene" : "lr-record-art"} aria-hidden="true">
        {sleeve && <div className="lr-sleeve"><span>THE<br />6IX</span><b>VOL.01</b></div>}
        {record}
    </div>;
}

export function ClueWaveform() {
    return <div className="lr-waveform" aria-hidden="true">{Array.from({ length: 54 }, (_, i) =>
        <i key={i} style={{ height: `${15 + Math.round(Math.abs(Math.sin(i * 1.7) * Math.cos(i * 0.43)) * 72)}%` }} />,
    )}</div>;
}
