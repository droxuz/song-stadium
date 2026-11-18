import Link from "next/link";
import type { ReactNode } from "react";
import "./listening-room.css";

export function ListeningRoom({ children, inGame = false }: {
    children: ReactNode;
    inGame?: boolean;
}) {
    return <div className="listening-room">
        <header className="lr-nav">
            <Link href="/" className="lr-wordmark" aria-label="The 6ix Sense home">
                The 6ix Sense<span>.</span>
            </Link>
        </header>
        <main className="lr-main">{children}</main>
    </div>;
}

export function ConnectionStatus({ connection }: { connection: string }) {
    return <span className="lr-connection" data-connection={connection} role="status">
        <i aria-hidden="true" />{connection}
    </span>;
}

export function RecordArtwork({ sleeve = false }: { sleeve?: boolean }) {
    const record = <div className="lr-record"><div className="lr-record-label"><span>THE 6IX SENSE</span><b></b><small>TORONTO CLASSICS</small></div></div>;
    return <div className={sleeve ? "lr-record-scene" : "lr-record-art"} aria-hidden="true">
        {sleeve && <div className="lr-sleeve"><span>THE<br />6IX</span><b>VOL.01</b></div>}
        {record}
    </div>;
}
