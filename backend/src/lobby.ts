import type { Server, Socket } from 'socket.io';
import type { Match, QueueStore } from './queue.js';

export function createLobbyManager(
    io: Server,
    connectedPlayers: Map<string, Socket>,
    queue: QueueStore,
) {
    let pending = Promise.resolve();
    function schedule(work: () => Promise<void>): Promise<void> {
        const operation = pending.then(work);
        pending = operation.catch(() => {});
        return operation;
    }

    async function cancelMatch(match: Match, message: string) {
        const players = match.playerIDs.map(id => connectedPlayers.get(id));
        await Promise.all(players.map(socket => socket?.leave(match.roomId)));
        if (await queue.releaseMatch(match)) {
            for (const socket of players) {
                if (socket?.connected) {
                    socket.emit('matchCancelled', { roomId: match.roomId, message });
                }
            }
        }
    }

    async function createRoom(match: Match) {
        const first = connectedPlayers.get(match.playerIDs[0]);
        const second = connectedPlayers.get(match.playerIDs[1]);
        const cancelledMessage = 'A player disconnected. Join the queue again to find another match.';
        if (!first?.connected || !second?.connected) {
            await cancelMatch(match, cancelledMessage);
            return;
        }

        try {
            const joins = await Promise.allSettled([
                Promise.resolve().then(() => first.join(match.roomId)),
                Promise.resolve().then(() => second.join(match.roomId)),
            ]);
            if (joins.some(result => result.status === 'rejected')) {
                await cancelMatch(match, 'Could not create the lobby. Please join the queue again.');
                return;
            }
            if (!first.connected || !second.connected) {
                await cancelMatch(match, cancelledMessage);
                return;
            }

            io.to(match.roomId).emit('matchFound', match);
            console.log(`Lobby created: ${match.roomId}`);
        } catch (error) {
            await cancelMatch(match, 'Could not create the lobby. Please join the queue again.');
            throw error;
        }
    }

    return {
        matchWaitingPlayers() {
            return schedule(async () => {
                for (;;) {
                    const match = await queue.matchmake();
                    if (!match) return;
                    await createRoom(match);
                }
            });
        },
        playerDisconnected(playerID: string) {
            return schedule(async () => {
                const match = await queue.getMatch(playerID);
                if (match) {
                    await cancelMatch(match, 'Your opponent disconnected. Join the queue again to find another match.');
                }
            });
        },
        whenIdle: () => pending,
    };
}
