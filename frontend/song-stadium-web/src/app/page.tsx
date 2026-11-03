"use client"
import { ListeningRoom, RecordArtwork } from "./components/ListeningRoom";
import {useEffect, useState} from 'react';
import { useSocket } from './SocketProvider';
import { useRouter } from "next/navigation";

type Match = { roomId: string; playerIDs: [string, string] };
type QueueStatus = 'connecting' | 'idle' | 'queued' | 'matched' | 'disconnected';


export default function Home() {

  const socket = useSocket();
  const router = useRouter();
  const [status, setStatus] = useState<QueueStatus>('connecting');
  const [match, setMatch] = useState<Match | null>(null);
  const [message, setMessage] = useState('Connecting to the server…');

  // Subscribe to the shared socket without owning its connection lifecycle.
  useEffect(() => {
    if (!socket) return;

    const onConnect = () => {
      console.log(`Connected to Server: ${socket.id}`)
      setStatus('idle');
      setMatch(null);
      setMessage('Connected. Join the queue to find an opponent.');
    };

    const onConnectError = (error: Error) => {
      console.error("Failed to connect to server:", error.message)
      setStatus('disconnected');
      setMessage('Cannot connect to the server. Retrying…');
    };

    const onQueueJoined = (data: { message: string }) => {
      console.log(data.message);
      setStatus('queued');
      setMessage('Waiting for another player…');
    };

    const onQueueLeft = (data: { message: string }) => {
      console.log(data.message);
      setStatus('idle');
      setMessage(data.message);
    };

    const onQueueError = (data: { message: string }) => {
      console.log(data.message);
      setMessage(data.message);
    };

    const onMatchFound = (data: Match) => {
      setMatch(data);
      setStatus('matched');
      router.push(`/game/${encodeURIComponent(data.roomId)}`);
      setMessage('Match found! Both players have joined the lobby.');
    };

    const onMatchCancelled = (data: { roomId: string; message: string }) => {
      setMatch(null);
      setStatus('idle');
      setMessage(data.message);
    };

    const onDisconnect = () => {
      setMatch(null);
      setStatus('disconnected');
      setMessage('Disconnected. Reconnect before joining another queue.');
    };

    socket.on('connect', onConnect);
    socket.on('connect_error', onConnectError);
    socket.on('queueJoined', onQueueJoined);
    socket.on('queueLeft', onQueueLeft);
    socket.on('queueError', onQueueError);
    socket.on('matchFound', onMatchFound);
    socket.on('matchCancelled', onMatchCancelled);
    socket.on('disconnect', onDisconnect);

    if (socket.connected) onConnect();

    return() => {
      socket.off('connect', onConnect);
      socket.off('connect_error', onConnectError);
      socket.off('queueJoined', onQueueJoined);
      socket.off('queueLeft', onQueueLeft);
      socket.off('queueError', onQueueError);
      socket.off('matchFound', onMatchFound);
      socket.off('matchCancelled', onMatchCancelled);
      socket.off('disconnect', onDisconnect);
    }
  }, [socket, router]);

  const handleQueueConnection = (): void => {
    if (!socket?.connected) return;
    console.log(`Attempt to join queue`)
    socket.emit("joinQueue"); // Emit joinQueue
  };

  const handleQueueDisconnection = (): void => {
    if (!socket?.connected) return;
    console.log(`Attempt to leave queue`)
    socket.emit("leaveQueue"); // Emit leaveQueue
  };

  return (
    <ListeningRoom connection={status === 'idle' || status === 'queued' || status === 'matched' ? 'Connected' : status === 'connecting' ? 'Connecting…' : 'Disconnected'}>
      <div className="lr-lobby">
        <section className="lr-hero" aria-label="Welcome to Song Stadium">
          <span className="lr-eyebrow">For the ones who know ball</span>
          <h1>A familiar sound.<br /><em>A friendly rivalry.</em></h1>
          <p>From late-night deep cuts to the tracks you know by heart. Put your ears to the test, one match at a time.</p>
          <RecordArtwork sleeve />
          <span className="lr-record-caption"></span>
        </section>
        <section className="lr-match-card" aria-label="Matchmaking">
          <div className="lr-card-heading"><span className="lr-eyebrow">The matchup</span><span className="lr-pill">1 vs 1</span></div>
          <h2>{status === 'queued' ? 'Finding your opponent.' : status === 'matched' ? 'Your table is ready.' : 'Good ears. Better knowledge.'}</h2>
          <p>{status === 'queued' ? 'A little suspense before the first note. We’re finding another listener for your match.' : 'Meet your opponent. Hear a tiny clip. Name the track.'}</p>
          <div className="lr-match-specs"><span><b>02</b>players</span><span><b>05</b>clues per song</span><span><b>60s</b>per round</span></div>
          {status === 'queued' ? (
            <button type="button" className="lr-secondary" onClick={handleQueueDisconnection}>Leave queue <span aria-hidden="true">↗</span></button>
          ) : (
            <button type="button" className="lr-primary" disabled={status !== 'idle'} onClick={handleQueueConnection}>
              {status === 'matched' ? 'Opening your match…' : status === 'connecting' ? 'Connecting…' : status === 'disconnected' ? 'Waiting for connection…' : 'Find a match'}<span aria-hidden="true">↗</span>
            </button>
          )}
          <div className="lr-queue-message" role="status" aria-live="polite">{message}</div>
          {match && <p className="lr-room-label">Room: {match.roomId}<br />Players: {match.playerIDs.length} / 2</p>}
        </section>
      </div>
    </ListeningRoom>
  );
}
