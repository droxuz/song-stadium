"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { ListeningRoom } from "../../components/ListeningRoom";
import GameRoom from "./GameRoom";

export default function GamePage() {
    const { roomId: routeRoomId } = useParams<{ roomId: string }>();
    let roomId: string;
    try {
        roomId = decodeURIComponent(routeRoomId);
    } catch {
        return (
            <ListeningRoom inGame>
                <section className="lr-error">
                    <p role="alert">This game link is invalid.</p>
                    <Link href="/" className="lr-text-button">Back to the lobby</Link>
                </section>
            </ListeningRoom>
        );
    }
    // Reset page state for a different room, preserving the shared socket.
    return <GameRoom key={roomId} roomId={roomId} />;
}
