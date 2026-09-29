"use client"
import Image from "next/image";
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
  }, [socket]);

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
    <div className="flex flex-col flex-1 items-center justify-center bg-zinc-50 font-sans dark:bg-black">
      <main className="flex flex-1 w-full max-w-3xl flex-col items-center justify-between py-32 px-16 bg-white dark:bg-black sm:items-start">
        <Image
          className="dark:invert h-5 w-[100px]"
          src="/next.svg"
          alt="Next.js logo"
          width={100}
          height={20}
          priority
        />
        <div className="flex flex-col items-center gap-6 text-center sm:items-start sm:text-left">
          <h1 className="max-w-xs text-3xl font-semibold leading-10 tracking-tight text-black dark:text-zinc-50">
            To get started, edit the{" "}
            <code className="rounded bg-black/[.06] px-1.5 py-0.5 font-mono text-[0.9em] dark:bg-white/[.08]">
              page.tsx
            </code>{" "}
            file.
          </h1>
          <p className="max-w-md text-lg leading-8 text-zinc-600 dark:text-zinc-400">
            Looking for a starting point or more instructions? Head over to{" "}
            <a
              href="https://vercel.com/templates?framework=next.js&utm_source=create-next-app&utm_medium=appdir-template-tw&utm_campaign=create-next-app"
              className="font-medium text-zinc-950 dark:text-zinc-50"
            >
              Templates
            </a>{" "}
            or the{" "}
            <a
              href="https://nextjs.org/learn?utm_source=create-next-app&utm_medium=appdir-template-tw&utm_campaign=create-next-app"
              className="font-medium text-zinc-950 dark:text-zinc-50"
            >
              Learning
            </a>{" "}
            center.
          </p>
        </div>
        <section className="w-full rounded-xl border border-zinc-300 p-5 dark:border-zinc-700" aria-label="Matchmaking">
          <p role="status" aria-live="polite">{message}</p>
          {match && (
            <div className="mt-3">
              <h2 className="text-lg font-semibold">Game lobby</h2>
              <p className="break-all text-sm">Room: {match.roomId}</p>
              <p className="text-sm">Players: {match.playerIDs.length} / 2</p>
            </div>
          )}
        </section>
        <div className="flex flex-col gap-4 text-base font-medium sm:flex-row">
          <a
            className="flex h-12 w-full items-center justify-center gap-2 rounded-full bg-foreground px-5 text-background transition-colors hover:bg-[#383838] dark:hover:bg-[#ccc] md:w-[158px]"
            href="https://vercel.com/new?utm_source=create-next-app&utm_medium=appdir-template-tw&utm_campaign=create-next-app"
            target="_blank"
            rel="noopener noreferrer"
          >
            <Image
              className="dark:invert h-[14px] w-4"
              src="/vercel.svg"
              alt="Vercel logomark"
              width={16}
              height={14}
            />
            Deploy Now
          </a>
          <a
            className="flex h-12 w-full items-center justify-center rounded-full border border-solid border-black/[.08] px-5 transition-colors hover:border-transparent hover:bg-black/[.04] dark:border-white/[.145] dark:hover:bg-[#1a1a1a] md:w-[158px]"
            href="https://nextjs.org/docs?utm_source=create-next-app&utm_medium=appdir-template-tw&utm_campaign=create-next-app"
            target="_blank"
            rel="noopener noreferrer"
          >
            Documentation
          </a>
          <button
          disabled={status !== 'idle'}
          className="flex h-12 w-full items-center justify-center rounded-full border border-solid border-black/[.08] px-5 transition-colors hover:border-transparent hover:bg-black/[.04] disabled:cursor-not-allowed disabled:opacity-50 dark:border-white/[.145] dark:hover:bg-[#1a1a1a] md:w-[158px]"
          onClick={handleQueueConnection}>
            Join Queue
          </button>

          <button disabled={status !== 'queued'} className = "flex h-12 w-full items-center justify-center rounded-full border border-solid border-black/[.08] px-5 transition-colors hover:border-transparent hover:bg-black/[.04] disabled:cursor-not-allowed disabled:opacity-50 dark:border-white/[.145] dark:hover:bg-[#1a1a1a] md:w-[158px]"
          onClick={handleQueueDisconnection}>
            Leave Queue
          </button>
        </div>
      </main>
    </div>
  );
}
