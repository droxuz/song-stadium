import type { Socket } from 'socket.io';

interface RedisScriptClient {
    eval(script: string, options: { keys: string[]; arguments: string[] }): Promise<unknown>;
}


const JOIN_QUEUE = `
if redis.call('ZSCORE', KEYS[1], ARGV[1]) then
    return 0
end
local metadataType = redis.call('TYPE', KEYS[2]).ok
if metadataType ~= 'none' and metadataType ~= 'hash' then
    return redis.error_reply('Queue metadata must be a hash')
end
redis.call('ZADD', KEYS[1], ARGV[2], ARGV[1])
redis.call('HSET', KEYS[2], 'joinedAt', ARGV[3], 'region', ARGV[4])
return 1
`;


const LEAVE_QUEUE = `
local removed = redis.call('ZREM', KEYS[1], ARGV[1])
redis.call('DEL', KEYS[2])
return removed
`;

export interface QueueStore {
    join(playerID: string, elo: number, joinedAt: number): Promise<boolean>;
    leave(playerID: string): Promise<boolean>;
}

export function createQueueStore(
    redis: RedisScriptClient,
    queueKey = 'matchmaking:na-east:ranked',
    metadataPrefix = 'matchmaking:player:',
): QueueStore {
    return {
        async join(playerID, elo, joinedAt) {
            if (!Number.isFinite(elo) || !Number.isFinite(joinedAt)) {
                throw new Error('Queue rating and timestamp must be finite numbers');
            }
            const result = await redis.eval(JOIN_QUEUE, {
                keys: [queueKey, `${metadataPrefix}${playerID}`],
                arguments: [playerID, String(elo), String(joinedAt), 'na-east'],
            });
            return result === 1;
        },
        async leave(playerID) {
            const result = await redis.eval(LEAVE_QUEUE, {
                keys: [queueKey, `${metadataPrefix}${playerID}`],
                arguments: [playerID],
            });
            return result === 1;
        },
    };
}

export function registerQueueHandlers(
    socket: Socket,
    playerID: string,
    elo: number,
    queue: QueueStore,
) {
    // Serialize this connection's join, leave, and disconnect operations.
    // Catch each failure so it cannot prevent later requests or cleanup.
    let pending = Promise.resolve();
    function schedule(work: () => Promise<void>, failureMessage: string) {
        pending = pending.then(work).catch((error: unknown) => {
            console.error(`Queue operation failed for ${playerID}:`, error);
            if (socket.connected) {
                socket.emit('queueError', { message: failureMessage });
            }
        });
    }

    socket.on('joinQueue', () => {
        schedule(async () => {
            if (!socket.connected) return;
            const joined = await queue.join(playerID, elo, Date.now());
            if (!socket.connected) return;
            socket.emit(joined ? 'queueJoined' : 'queueError', {
                message: joined ? 'Successfully joined the queue.' : 'Already in Queue',
            });
        }, 'Could not connect to queue. Please try again.');
    });

    socket.on('leaveQueue', () => {
        schedule(async () => {
            if (!socket.connected) return;
            const left = await queue.leave(playerID);
            if (!socket.connected) return;
            socket.emit(left ? 'queueLeft' : 'queueError', {
                message: left ? 'Successfully left the queue.' : 'Not in queue',
            });
        }, 'Could not leave the Queue. Please try again.');
    });

    socket.on('disconnect', () => {
        // Runs after any write already in flight, preventing ghost entries.
        // Pending joins skip their writes once socket.connected is false.
        schedule(async () => {
            await queue.leave(playerID);
        }, 'Could not clean up the queue.');
    });

    return { whenIdle: () => pending };
}
