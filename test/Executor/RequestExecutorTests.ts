import * as BluebirdPromise from "bluebird";
import * as assert from "assert";
import { testContext, disposeTestDocumentStore } from "../Utils/TestUtil";

import {
    RequestExecutor,
    DocumentConventions,
    GetDatabaseTopologyCommand,
    RavenErrorType,
    GetNextOperationIdCommand ,
    GetDatabaseNamesOperation,
    ServerNode,
    IDocumentStore
} from "../../src";

describe("Request executor", function () {

    describe("with server online", () => {

        let store: IDocumentStore;
        let executor: RequestExecutor;
        let documentConventions: DocumentConventions;

        beforeEach(async function () {
            store = await testContext.getDocumentStore();
            documentConventions = new DocumentConventions();
        });

        afterEach(async () =>
            await disposeTestDocumentStore(store));

        it("failures do not block connection pool", async function () {
            try {
                executor = RequestExecutor.create(store.urls, "no_such_db", {
                    documentConventions
                });
 
                let errorsCount = 0;

                for (let i = 0; i < 40; i++) {
                    try {
                        const cmd = new GetNextOperationIdCommand();
                        await executor.execute(cmd);
                    } catch (err) {
                        errorsCount++;
                    }
                }
                assert.equal(errorsCount, 40);

                try {
                    const databaseNamesOperation = new GetDatabaseNamesOperation(0, 20);
                    const command = databaseNamesOperation.getCommand(documentConventions);
                    await executor.execute(command);
                    assert.fail("Should have thrown.");
                } catch (err) {
                    assert.equal(err.name, "DatabaseDoesNotExistException");
                }

            } finally {
                executor.dispose();
            }
        });

        it("can issue many requests", async () => {
            try {
                executor = RequestExecutor.create(store.urls, store.database, {
                    documentConventions
                });
                for (let i = 0; i < 50; i++) {
                    const databaseNamesOperation = new GetDatabaseNamesOperation(0, 20);
                    const command = databaseNamesOperation.getCommand(documentConventions);
                    await executor.execute(command);
                }
            } finally {
                executor.dispose();
            }
        });

        it("can fetch database names", async () => {
            try {
                executor = RequestExecutor.create(store.urls, store.database, {
                    documentConventions
                });
                const databaseNamesOperation = new GetDatabaseNamesOperation(0, 20);
                const command = databaseNamesOperation.getCommand(documentConventions);
                await executor.execute(command);

                assert.ok(command.result.indexOf(store.database) !== -1);
            } finally {
                executor.dispose();
            }
        });

        it("throws when updating topology of not existing db", async () => {
            try {
                executor = RequestExecutor.create(store.urls, store.database, {
                    documentConventions
                });
                const serverNode = new ServerNode({ 
                    url: store.urls[0], 
                    database: "nope" });
                
                try {
                    await executor.updateTopology(serverNode, 5000);
                    assert.fail("Should have thrown");
                } catch (err) {
                    assert.equal(err.name, "DatabaseDoesNotExistException", err.stack);
                }
            } finally {
                executor.dispose();
            }
        });

        it("can create single node request executor", async () => {
            try {
                executor = RequestExecutor.createForSingleNodeWithoutConfigurationUpdates(
                    store.urls[0], store.database, { documentConventions });

                const nodes = executor.getTopologyNodes();
                assert.equal(nodes.length, 1);

                const serverNode = nodes[0];
                assert.equal(serverNode.url, store.urls[0]);
                assert.equal(serverNode.database, store.database);

                const command = new GetNextOperationIdCommand();
                await executor.execute(command);
                assert.ok(command.result);
            } finally {
                executor.dispose();
            }
        });

        it("can choose online node", async () => {
            const url = store.urls[0];
            const dbName = store.database;

            try {
                executor = RequestExecutor.create([ 
                    "http://no_such_host:8080", 
                    "http://another_offlilne:8080",
                    url
                ],
                dbName,
                { documentConventions });

                const command = new GetNextOperationIdCommand();
                await executor.execute(command);
                assert.ok(command.result);

                const nodes = executor.getTopologyNodes();
                assert.equal(nodes.length, 1);
                assert.equal(nodes[0].url, url);
                assert.equal(executor.getUrl(), url);
            } finally {
                executor.dispose();
            }
        });

    });
    
    it("fails when server is offline", function () {
        const documentConventions = new DocumentConventions();
        const executor = RequestExecutor.create(["http://no_such_host:8081"], "db1", {
            documentConventions
        });
        const getTopology = new GetDatabaseTopologyCommand();
        return BluebirdPromise.resolve()
            .then(() => executor.execute(getTopology))
            .then(() => assert.fail("Should have failed with 'AllTopologyNodesDownException'."),
                err => {
                    assert.ok(err);
                    assert.equal(err.name, "AllTopologyNodesDownException" as RavenErrorType, err.stack);
                })
            .finally(() => {
                executor.dispose();
            });
    });
});
