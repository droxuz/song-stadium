import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { test } from 'node:test';
import { createClient } from 'redis';
import { createQueueStore, registerQueueHandlers } from '../src/queue.ts';

class TestSocket extends EventEmitter {
    connected = true;
    responses = [];

    constructor() {
        super();
        for (const event of ['queueJoined', 'queueLeft', 'queueError']) {
            this.on(event, (data) => this.responses.push({ event, ...data }));
        }
    }

    disconnect() {
        this.connected = false;
        this.emit('disconnect');
    }
}

const redisUrl = process.env.TEST_REDIS_URL;

test('queue coordination against Redis', {
    skip: !redisUrl && 'Set TEST_REDIS_URL to run the Redis integration tests',
    timeout: 20000,
}, async (t) => {
    const first = createClient({ url: redisUrl, socket: { reconnectStrategy: false } });
    const second = first.duplicate();
    first.on('error', () => {});
    second.on('error', () => {});
    t.after(() => {
        if (first.isOpen) first.destroy();
        if (second.isOpen) second.destroy();
    });
    await Promise.all([first.connect(), second.connect()]);

    function scenario(subtest) {
        const prefix = `test:queue:${randomUUID()}:`;
        const queueKey = `${prefix}ranked`;
        const metadataPrefix = `${prefix}player:`;
        subtest.after(async () => {
            const keys = await first.keys(`${prefix}*`);
            if (keys.length) await first.del(keys);
        });
        return {
            queueKey,
            metadataPrefix,
            store: createQueueStore(first, queueKey, metadataPrefix),
            otherStore: createQueueStore(second, queueKey, metadataPrefix),
        };
    }

    await t.test('50 simultaneous joins across two clients commit once and preserve queue time', async (t) => {
        const { queueKey, metadataPrefix, store, otherStore } = scenario(t);
        const results = await Promise.all(Array.from({ length: 50 }, (_, index) =>
            (index % 2 ? store : otherStore).join('player', 150 + index, 1000 + index),
        ));
        const winner = results.indexOf(true);
        assert.equal(results.filter(Boolean).length, 1);
        assert.equal(await first.zCard(queueKey), 1);
        assert.equal(await first.zScore(queueKey, 'player'), 1000 + winner);
        assert.equal(await first.hGet(`${metadataPrefix}player`, 'elo'), String(150 + winner));
        assert.equal(await first.hGet(`${metadataPrefix}player`, 'joinedAt'), String(1000 + winner));
    });

    await t.test('50 simultaneous leaves report only one removal', async (t) => {
        const { queueKey, metadataPrefix, store, otherStore } = scenario(t);
        await store.join('player', 150, 1000);
        const results = await Promise.all(Array.from({ length: 50 }, (_, index) =>
            (index % 2 ? store : otherStore).leave('player'),
        ));
        assert.equal(results.filter(Boolean).length, 1);
        assert.equal(await first.zCard(queueKey), 0);
        assert.equal(await first.exists(`${metadataPrefix}player`), 0);
    });

    await t.test('independent players can join and leave concurrently', async (t) => {
        const { queueKey, store } = scenario(t);
        const players = Array.from({ length: 30 }, (_, i) => `player-${i}`);
        assert.ok((await Promise.all(players.map(id => store.join(id, 150, 1000)))).every(Boolean));
        assert.equal(await first.zCard(queueKey), 30);
        assert.ok((await Promise.all(players.map(id => store.leave(id)))).every(Boolean));
        assert.equal(await first.zCard(queueKey), 0);
    });

    await t.test('mixed joins and leaves keep membership and metadata consistent', async (t) => {
        const { queueKey, metadataPrefix, store, otherStore } = scenario(t);
        await Promise.all(Array.from({ length: 80 }, (_, i) =>
            i % 2 ? store.join('player', 150, i) : otherStore.leave('player'),
        ));
        assert.equal(await first.zScore(queueKey, 'player') !== null,
            Boolean(await first.exists(`${metadataPrefix}player`)));
    });

    await t.test('rapid socket join/join/leave/leave/join is processed in order', async (t) => {
        const { queueKey, store } = scenario(t);
        const socket = new TestSocket();
        const operations = registerQueueHandlers(socket, 'player', 150, store);
        for (const event of ['joinQueue', 'joinQueue', 'leaveQueue', 'leaveQueue', 'joinQueue']) {
            socket.emit(event);
        }
        await operations.whenIdle();
        assert.deepEqual(socket.responses.map(r => r.event), [
            'queueJoined', 'queueError', 'queueLeft', 'queueError', 'queueJoined',
        ]);
        assert.equal(await first.zCard(queueKey), 1);
    });

    await t.test('disconnect during a blocked join cleans up after the write', async (t) => {
        const { queueKey, metadataPrefix, store } = scenario(t);
        const started = Promise.withResolvers();
        const release = Promise.withResolvers();
        const socket = new TestSocket();
        const operations = registerQueueHandlers(socket, 'player', 150, {
            async join(...args) {
                started.resolve();
                await release.promise;
                return store.join(...args);
            },
            leave: store.leave,
        });
        socket.emit('joinQueue');
        await started.promise;
        socket.emit('joinQueue');
        socket.emit('leaveQueue');
        socket.disconnect();
        release.resolve();
        await operations.whenIdle();
        assert.equal(await first.zCard(queueKey), 0);
        assert.equal(await first.exists(`${metadataPrefix}player`), 0);
        assert.deepEqual(socket.responses, []);
    });

    await t.test('disconnect before queued work starts skips the join', async (t) => {
        const { store, queueKey } = scenario(t);
        const socket = new TestSocket();
        let joins = 0;
        const operations = registerQueueHandlers(socket, 'player', 150, {
            join(...args) { joins++; return store.join(...args); },
            leave: store.leave,
        });
        socket.emit('joinQueue');
        socket.disconnect();
        await operations.whenIdle();
        assert.equal(joins, 0);
        assert.equal(await first.zCard(queueKey), 0);
    });

    await t.test('failed joins do not block subsequent requests', async (t) => {
        const { store, queueKey } = scenario(t);
        const socket = new TestSocket();
        let attempts = 0;
        const operations = registerQueueHandlers(socket, 'player', 150, {
            async join(...args) {
                if (++attempts === 1) throw new Error('Simulated Redis failure');
                return store.join(...args);
            },
            leave: store.leave,
        });
        socket.emit('joinQueue');
        socket.emit('joinQueue');
        socket.emit('leaveQueue');
        await operations.whenIdle();
        assert.deepEqual(socket.responses.map(r => r.event), ['queueError', 'queueJoined', 'queueLeft']);
        assert.equal(await first.zCard(queueKey), 0);
    });

    await t.test('invalid metadata type cannot leave a partial join', async (t) => {
        const { store, queueKey, metadataPrefix } = scenario(t);
        await first.set(`${metadataPrefix}player`, 'wrong type');
        await assert.rejects(store.join('player', 150, 1000), /metadata must be a hash/);
        assert.equal(await first.zScore(queueKey, 'player'), null);
    });

    await t.test('matchmaking claims the longest-waiting pair and blocks requeue', async (t) => {
        const { store, otherStore, queueKey, metadataPrefix } = scenario(t);
        await store.join('newest', 100, 3000);
        await store.join('oldest', 900, 1000);
        assert.equal(await first.zCard(queueKey), 2);
        await store.join('middle', 200, 2000);
        const match = await store.matchmake();
        assert.deepEqual(match.playerIDs, ['oldest', 'middle']);
        assert.deepEqual(await first.zRange(queueKey, 0, -1), ['newest']);
        assert.deepEqual(await otherStore.getMatch('oldest'), match);
        assert.equal(await otherStore.join('oldest', 900, 9999), false);
        assert.equal(await otherStore.leave('oldest'), false);
        assert.equal(await first.exists(`${metadataPrefix}oldest`), 1);
        assert.equal(await store.releaseMatch(match), true);
        assert.equal(await otherStore.releaseMatch(match), false);
        assert.equal(await otherStore.getMatch('oldest'), null);
        assert.equal(await first.exists(`${metadataPrefix}oldest`), 0);
        assert.equal(await otherStore.join('oldest', 900, 9999), true);
    });

    await t.test('concurrent matchmakers cannot claim the same player twice', async (t) => {
        const { store, otherStore, queueKey } = scenario(t);
        for (let i = 0; i < 11; i++) await store.join(`player-${i}`, 150, 1000 + i);
        const matches = (await Promise.all(Array.from({ length: 20 }, (_, i) =>
            (i % 2 ? store : otherStore).matchmake(),
        ))).filter(Boolean);
        assert.equal(matches.length, 5);
        const claimed = matches.flatMap(match => match.playerIDs);
        assert.equal(new Set(claimed).size, 10);
        assert.equal(new Set(matches.map(match => match.roomId)).size, 5);
        assert.deepEqual(await first.zRange(queueKey, 0, -1), ['player-10']);
        for (const match of matches) await store.releaseMatch(match);
    });

    await t.test('fewer than two players leaves the queue unchanged', async (t) => {
        const { store, queueKey } = scenario(t);
        assert.equal(await store.matchmake(), null);
        await store.join('only-player', 150, 1000);
        assert.equal(await store.matchmake(), null);
        assert.deepEqual(await first.zRange(queueKey, 0, -1), ['only-player']);
    });
});
