import type { Socket } from 'socket.io';
import { randomUUID } from 'node:crypto';

interface RedisScriptClient {
    eval(script: string, options: { keys: string[]; arguments: string[] }): Promise<unknown>;
}


const JOIN_QUEUE = `
if redis.call('HEXISTS', KEYS[3], ARGV[1]) == 1 then
    return 0
end
if redis.call('ZSCORE', KEYS[1], ARGV[1]) then
    return 0
end
local metadataType = redis.call('TYPE', KEYS[2]).ok
if metadataType ~= 'none' and metadataType ~= 'hash' then
    return redis.error_reply('Queue metadata must be a hash')
end
redis.call('ZADD', KEYS[1], ARGV[3], ARGV[1])
redis.call('HSET', KEYS[2], 'joinedAt', ARGV[3], 'elo', ARGV[2], 'region', ARGV[4])
return 1
`;


const LEAVE_QUEUE = `
-- A queue cancellation must not erase an active match's metadata.
if redis.call('HEXISTS', KEYS[3], ARGV[1]) == 1 then
    return 0
end
local removed = redis.call('ZREM', KEYS[1], ARGV[1])
redis.call('DEL', KEYS[2])
return removed
`;

const MATCHMAKE = `
local players = redis.call('ZRANGE', KEYS[1], 0, 1)
if #players < 2 then
    return {}
end
-- Validate hash types before writing: Lua atomicity is not error rollback.
for i = 2, 3 do
    local keyType = redis.call('TYPE', KEYS[i]).ok
    if keyType ~= 'none' and keyType ~= 'hash' then
        return redis.error_reply('Match state must be a hash')
    end
end
for _, playerID in ipairs(players) do
    if redis.call('HEXISTS', KEYS[2], playerID) == 1 then
        return redis.error_reply('Queued player already has a match')
    end
end
redis.call('HSET', KEYS[3], ARGV[1], cjson.encode(players))
redis.call('HSET', KEYS[2], players[1], ARGV[1], players[2], ARGV[1])
redis.call('ZREM', KEYS[1], players[1], players[2])
return {ARGV[1], players[1], players[2]}
`;

const GET_MATCH = `
local roomID = redis.call('HGET', KEYS[1], ARGV[1])
if not roomID then return {} end
local record = redis.call('HGET', KEYS[2], roomID)
if not record then return redis.error_reply('Match record is missing') end
local players = cjson.decode(record)
return {roomID, players[1], players[2]}
`;

const RELEASE_MATCH = `
local record = redis.call('HGET', KEYS[2], ARGV[1])
if not record then return 0 end
local players = cjson.decode(record)
if players[1] ~= ARGV[2] or players[2] ~= ARGV[3] then
    return redis.error_reply('Match players do not match')
end
-- Only clear assignments still owned by this match.
redis.call('HLEN', KEYS[1])
for i = 1, 2 do
    if redis.call('HGET', KEYS[1], players[i]) == ARGV[1] then
        redis.call('HDEL', KEYS[1], players[i])
        redis.call('DEL', KEYS[i + 2])
    end
end
redis.call('HDEL', KEYS[2], ARGV[1])
return 1
`;

export interface Match {
    roomId: string;
    playerIDs: [string, string];
}

function parseMatch(result: unknown): Match | null {
    if (!Array.isArray(result) || !result.every((value): value is string => typeof value === 'string')) {
        throw new Error('Unexpected matchmaking result');
    }
    if (result.length === 0) return null;
    const [roomId, first, second] = result;
    if (result.length !== 3 || !roomId || !first || !second || first === second) {
        throw new Error('Unexpected matchmaking result');
    }
    return { roomId, playerIDs: [first, second] };
}

export interface QueueStore {
    join(playerID: string, elo: number, joinedAt: number): Promise<boolean>;
    leave(playerID: string): Promise<boolean>;
    matchmake(): Promise<Match | null>;
    getMatch(playerID: string): Promise<Match | null>;
    releaseMatch(match: Match): Promise<boolean>;
}

export function createQueueStore(
    redis: RedisScriptClient,
    queueKey = 'matchmaking:na-east:ranked',
    metadataPrefix = 'matchmaking:player:',
): QueueStore {
    const assignmentsKey = `${queueKey}:assignments`;
    const matchesKey = `${queueKey}:matches`;
    return {
        async join(playerID, elo, joinedAt) {
            if (!Number.isFinite(elo) || !Number.isFinite(joinedAt)) {
                throw new Error('Queue rating and timestamp must be finite numbers');
            }
            const result = await redis.eval(JOIN_QUEUE, {
                keys: [queueKey, `${metadataPrefix}${playerID}`, assignmentsKey],
                arguments: [playerID, String(elo), String(joinedAt), 'na-east'],
            });
            return result === 1;
        },
        async leave(playerID) {
            const result = await redis.eval(LEAVE_QUEUE, {
                keys: [queueKey, `${metadataPrefix}${playerID}`, assignmentsKey],
                arguments: [playerID],
            });
            return result === 1;
        },

        async matchmake() {
            const result = await redis.eval(MATCHMAKE, {
                keys: [queueKey, assignmentsKey, matchesKey],
                arguments: [`match:${randomUUID()}`],
            });
            return parseMatch(result);
        },
        async getMatch(playerID) {
            return parseMatch(await redis.eval(GET_MATCH, {
                keys: [assignmentsKey, matchesKey],
                arguments: [playerID],
            }));
        },
        async releaseMatch(match) {
            const result = await redis.eval(RELEASE_MATCH, {
                keys: [assignmentsKey, matchesKey, ...match.playerIDs.map(id => `${metadataPrefix}${id}`)],
                arguments: [match.roomId, ...match.playerIDs],
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
    lifecycle: {
        onQueued?: () => Promise<void>;
        onDisconnected?: (playerID: string) => Promise<void>;
    } = {},
) {
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
                message: joined ? 'Successfully joined the queue.' : 'Already queued or assigned to a match',
            });
            if (joined) {
                try {
                    await lifecycle.onQueued?.();
                } catch (error) {
                    console.error('Matchmaking failed:', error);
                    if (socket.connected) socket.emit('queueError', { message: 'Matchmaking is temporarily unavailable.' });
                }
            }
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
        schedule(async () => {
            await queue.leave(playerID);
            await lifecycle.onDisconnected?.(playerID);
        }, 'Could not clean up the queue.');
    });

    return { whenIdle: () => pending };
}
