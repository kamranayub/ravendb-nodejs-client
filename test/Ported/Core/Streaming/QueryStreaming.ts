import { testContext, disposeTestDocumentStore } from "../../../Utils/TestUtil";

import {
    AbstractCsharpIndexCreationTask,
    IDocumentStore,
    StreamQueryStatistics,
    StreamResult, TimeSeriesRawResult,
} from "../../../../src";
import * as assert from "assert";
import { User } from "../../../Assets/Entities";
import * as StreamUtil from "../../../../src/Utility/StreamUtil";
import { CONSTANTS } from "../../../../src/Constants";
import { parseJsonVerbose } from "../../../Utils/Json";
import { getStringWritable } from "../../../Utils/Streams";
import { assertThat } from "../../../Utils/AssertExtensions";

describe("query streaming", function () {

    let store: IDocumentStore;

    beforeEach(async function () {
        store = await testContext.getDocumentStore();
    });

    let usersByNameIndex: Users_ByName;

    beforeEach(function () {
        usersByNameIndex = new Users_ByName();
    });

    afterEach(async () =>
        await disposeTestDocumentStore(store));

    function argError(): never {
        throw new Error("Arg is required.");
    }

    async function prepareData(n: number = argError(), withTimeSeries: boolean = false) {
        const session = store.openSession();

        for (let i = 0; i < n; i++) {
            const user = Object.assign(new User(), {
                name: "jon" + i,
                lastName: "snow" + i
            });
            await session.store(user);

            if (withTimeSeries) {
                session.timeSeriesFor(user, "Heartrate")
                    .append(new Date(), i);
            }
        }
        await session.saveChanges();
    }

    function assertStreamResultEntry<T extends object>(
        entry: StreamResult<T>, docAssert: (doc: T) => void) {
        assert.ok(entry);
        assert.strictEqual(entry.constructor.name, Object.name);
        assert.ok(entry.changeVector);
        assert.ok(entry.id);
        assert.ok(entry.metadata);
        assert.ok(entry.metadata[CONSTANTS.Documents.Metadata.ID]);
        assert.ok(entry.metadata[CONSTANTS.Documents.Metadata.RAVEN_JS_TYPE]);
        assert.ok(entry.metadata[CONSTANTS.Documents.Metadata.LAST_MODIFIED]);

        const doc = entry.document;
        assert.ok(doc);
        docAssert(doc);
    }

    if (/^1\d\./.test(process.versions.node)) {
        it("can use for-await-of on nodejs > 10");
    }

    it("can stream query results", async () => {
        await prepareData(200);

        await usersByNameIndex.execute(store);

        await testContext.waitForIndexing(store);

        {
            const session = store.openSession();
            const query = session.query<User>({
                index: Users_ByName
            });

            const queryStream = await session.advanced.stream(query);

            const items = [];
            queryStream.on("data", item => {
                items.push(item);
                assertStreamResultEntry<User>(item, doc => {
                    assert.ok(doc instanceof User);
                    assert.ok(doc.name);
                    assert.ok(doc.lastName);
                });
            });

            await StreamUtil.finishedAsync(queryStream);

            assert.strictEqual(items.length, 200);
        }
    });

    it.skip("can stream query results with time series", async () => {
        await prepareData(200, true);

        await usersByNameIndex.execute(store);

        await testContext.waitForIndexing(store);

        {
            const session = store.openSession();
            const query = session.query({ documentType: User })
                .selectTimeSeries(x => x.raw("from Heartrate"), TimeSeriesRawResult);

            const queryStream = await session.advanced.stream(query);

            const items = [];
            queryStream.on("data", item => {
                assertThat(item.document instanceof TimeSeriesRawResult)
                    .isTrue();
                const result = item.document as TimeSeriesRawResult;
                assertThat(result.results)
                    .hasSize(1);
                assertThat(result.results[0].value)
                    .isEqualTo(items.length);

                items.push(item);
            });

            await StreamUtil.finishedAsync(queryStream);

            assert.strictEqual(items.length, 200);
        }
    });

    it("can stream query results with query statistics", async () => {
        await Promise.all([
            prepareData(100),
            await usersByNameIndex.execute(store)
        ]);

        await testContext.waitForIndexing(store);

        {
            const session = store.openSession();
            const query = session.query(User, Users_ByName);

            let statsFromCallback;
            const reader = await session.advanced.stream(query, s => statsFromCallback = s);

            const items = [];
            reader.on("data", item => {
                items.push(item);
                assertStreamResultEntry<User>(item, doc => {
                    assert.ok(doc.name);
                    assert.ok(doc.lastName);
                });
            });

            let statsFromEvent: StreamQueryStatistics;
            reader.on("stats", s => statsFromEvent = s);

            await StreamUtil.finishedAsync(reader);
            
            assert.strictEqual(items.length, 100);
            
            // eslint-disable-next-line no-inner-declarations
            function assertStats(stats) {
                assert.ok(stats);
                assert.strictEqual(stats.indexName, "Users/ByName");
                assert.strictEqual(stats.totalResults, 100);
                assert.ok(stats.indexTimestamp instanceof Date);
                assert.strictEqual(stats.indexTimestamp.toDateString(), new Date().toDateString());
            }

            assertStats(statsFromEvent);
            assertStats(statsFromCallback);
            assert.equal(statsFromCallback, statsFromEvent);

            items.forEach(x => assertStreamResultEntry<User>(x, doc => {
                assert.ok(doc instanceof User);
                assert.ok(doc.name);
                assert.ok(doc.lastName);
            }));
        }
    });

    it("can stream raw query results", async () => {
        await Promise.all([
            prepareData(200),
            await usersByNameIndex.execute(store)
        ]);

        await testContext.waitForIndexing(store);

        {
            const session = store.openSession();
            const query = session.advanced.rawQuery<User>("from index 'Users/ByName'");
            const queryStream = await session.advanced.stream(query);

            const items = [];
            queryStream.on("data", item => {
                items.push(item);
                assertStreamResultEntry<User>(item, doc => {
                    assert.ok(doc instanceof User);
                    assert.ok(doc.name);
                    assert.ok(doc.lastName);
                });
            });

            await StreamUtil.finishedAsync(queryStream);
            assert.strictEqual(items.length, 200);
        }

    });

    it("can stream raw query results with query statistics", async () => {
        await Promise.all([
            prepareData(100),
            await usersByNameIndex.execute(store)
        ]);

        await testContext.waitForIndexing(store);

        {
            const session = store.openSession();
            const query = session.advanced.rawQuery<User>("from index 'Users/ByName'");

            let stats = null as StreamQueryStatistics;
            const queryStream = await session.advanced.stream(query, s => stats = s);
            const items = [];
            queryStream.on("data", item => {
                items.push(item);
                assertStreamResultEntry<User>(item, doc => {
                    assert.ok(doc instanceof User);
                    assert.ok(doc.name);
                    assert.ok(doc.lastName);
                });
            });

            await StreamUtil.finishedAsync(queryStream);
            assert.strictEqual(items.length, 100);

            assert.ok(stats);
            assert.strictEqual(stats.indexName, "Users/ByName");
            assert.strictEqual(stats.totalResults, 100);
            assert.ok(stats.indexTimestamp instanceof Date);
            assert.strictEqual(stats.indexTimestamp.toDateString(), new Date().toDateString());
        }
    });

    it("can stream raw query into stream", async () => {
        await Promise.all([
            prepareData(10),
            await usersByNameIndex.execute(store)
        ]);

        await testContext.waitForIndexing(store);

        {
            const session = store.openSession();
            const query = session.advanced.rawQuery<User>("from index 'Users/ByName'");

            const targetStream = getStringWritable();
            session.advanced.streamInto(query, targetStream);
            await StreamUtil.finishedAsync(targetStream);

            const result: string = targetStream["string"];
            assert.ok(result);
            const json = parseJsonVerbose(result);
            assert.ok(json);
            const res = json.results;
            assert.ok(res);
            assert.strictEqual(json.indexName, "Users/ByName");
            assert.ok(json.indexTimestamp);
            assert.strictEqual(json.isStale, false);
            assert.ok("resultEtag" in json);
        }
    });
});

class Users_ByName extends AbstractCsharpIndexCreationTask {
    public constructor() {
        super();

        this.map = "from u in docs.Users select new { u.name, lastName = u.lastName.Boost(10) }";
        this.index("name", "Search");
        this.indexSuggestions.add("name");
        this.store("name", "Yes");
    }
}
