import * as stream from "readable-stream";
import { RavenCommand } from "../../Http/RavenCommand";
import { 
    RavenCommandResponsePipeline 
} from "../../Http/RavenCommandResponsePipeline";
import { ServerNode } from "../../Http/ServerNode";
import { HttpRequestParameters } from "../../Primitives/Http";
import { getHeaders } from "../../Utility/HttpUtil";
import { IRavenObject } from "../..";
import { TypeUtil } from "../../Utility/TypeUtil";
import { JsonSerializer } from "../../Mapping/Json/Serializer";
import { throwError } from "../../Exceptions";
import { CollectResultStreamOptions } from "../../Mapping/Json/Streams/CollectResultStream";
import { getIgnoreKeyCaseTransformKeysFromDocumentMetadata } from "../../Mapping/Json/Docs/index";
import { IRavenCommandResponsePipelineResult } from "../../Http/RavenCommandResponsePipeline";
import { DocumentConventions } from "../Conventions/DocumentConventions";

export interface GetDocumentsCommandOptionsBase {
    conventions: DocumentConventions;
}

export interface GetDocumentsByIdCommandOptions
    extends GetDocumentsCommandOptionsBase {
    id: string;
    includes?: string[];
    metadataOnly?: boolean;
}

export interface GetDocumentsByIdsCommandOptions 
    extends GetDocumentsCommandOptionsBase {
    ids: string[];
    includes?: string[];
    metadataOnly?: boolean;
}

export interface GetDocumentsStartingWithOptions 
    extends GetDocumentsCommandOptionsBase {
    start: number;
    pageSize: number;
    startsWith?: string;
    startsAfter?: string;
    matches?: string;
    exclude?: string;
    metadataOnly?: boolean;
}

export interface DocumentsResult {
    includes: IRavenObject;
    results: any[];
}
export interface GetDocumentsResult extends DocumentsResult {
    nextPageStart: number;
}

const LOAD_DOCS_JSON_PATH = [ /^(Results|Includes)$/, { emitPath: true } ];

export class GetDocumentsCommand extends RavenCommand<GetDocumentsResult> {

    private _id: string;

    private _ids: string[];
    private _includes: string[];

    private _metadataOnly: boolean;

    private _startsWith: string;
    private _matches: string;
    private _start: number;
    private _pageSize: number;
    private _exclude: string;
    private _startAfter: string;

    private _conventions: DocumentConventions;

    public constructor(
        opts: GetDocumentsByIdCommandOptions | GetDocumentsByIdsCommandOptions | GetDocumentsStartingWithOptions) {
        super();

        this._conventions = opts.conventions;

        if (opts.hasOwnProperty("id")) {
            opts = opts as GetDocumentsByIdCommandOptions;
            if (!opts.id) {
                throwError("InvalidArgumentException", "id cannot be null");
            }
            this._id = opts.id;
            this._includes = opts.includes;
            this._metadataOnly = opts.metadataOnly;
        } else if (opts.hasOwnProperty("ids")) {
            opts = opts as GetDocumentsByIdsCommandOptions;
            if (!opts.ids || opts.ids.length === 0) {
                throwError("InvalidArgumentException", "Please supply at least one id");
            }
            this._ids = opts.ids;
            this._includes = opts.includes;
            this._metadataOnly = opts.metadataOnly;
        } else if (opts.hasOwnProperty("start") && opts.hasOwnProperty("pageSize")) {
            opts = opts as GetDocumentsStartingWithOptions;
            this._start = opts.start;
            this._pageSize = opts.pageSize;

            if (opts.hasOwnProperty("startsWith")) {
                if (!opts.startsWith) {
                    throwError("InvalidArgumentException", "startWith cannot be null");
                }
                this._startsWith = opts.startsWith;
                this._startAfter = opts.startsAfter;
                this._matches = opts.matches;
                this._exclude = opts.exclude;
                this._metadataOnly = opts.metadataOnly;
            }
        }
    }

    public createRequest(node: ServerNode): HttpRequestParameters {
        const uriPath = `${node.url}/databases/${node.database}/docs?`;

        let query = "";
        if (!TypeUtil.isNullOrUndefined(this._start)) {
            query += `&start=${this._start}`;
        }

        if (this._pageSize) {
            query += `&pageSize=${this._pageSize}`;
        }

        if (this._metadataOnly) {
            query += "&metadataOnly=true";
        }

        if (this._startsWith) {
            query += `&startsWith=${encodeURIComponent(this._startsWith)}`;

            if (this._matches) {
                query += `&matches=${this._matches}`;
            }

            if (this._exclude) {
                query += `&exclude=${this._exclude}`;
            }

            if (this._startAfter) {
                query += `&startAfter=${this._startAfter}`;
            }
        }

        if (this._includes) {
            for (const include of this._includes) {
                query += `&include=${include}`;
            }
        }

        let request: HttpRequestParameters = { method: "GET", uri: uriPath + query };

        if (this._id) {
            request.uri += `&id=${encodeURIComponent(this._id)}`;
        } else if (this._ids) {
            request = this.prepareRequestWithMultipleIds(request, this._ids);
        }

        return request;
    }

    public prepareRequestWithMultipleIds(request: HttpRequestParameters, ids: string[]): HttpRequestParameters {
        const uniqueIds = new Set<string>(ids); 

        // if it is too big, we fallback to POST (note that means that we can't use the HTTP cache any longer)
        // we are fine with that, requests to load > 1024 items are going to be rare
        const isGet: boolean = Array.from(uniqueIds)
                            .map(x => x.length)
                            .reduce((result, next) => result + next, 0) < 1024;

        let newUri = request.uri;
        if (isGet) {
            uniqueIds.forEach(x => {
                if (x) {
                    newUri += `&id=${encodeURIComponent(x)}`;
                }
            });

            return { method: "GET", uri: newUri };
        } else {
            const body = this._serializer
                .serialize({ ids: [...uniqueIds] });
            return {
                uri: newUri,
                method: "POST",
                headers: getHeaders() 
                    .withContentTypeJson()
                    .build(),
                body
            };
        }
    }

    protected get _serializer(): JsonSerializer {
        const serializer = super._serializer;
        return serializer;
    }

    public async setResponseAsync(bodyStream: stream.Stream, fromCache: boolean): Promise<string> {
        if (!bodyStream) {
            this.result = null;
            return;
        }
        
        const collectResultOpts: CollectResultStreamOptions<DocumentsResult> = {
            reduceResults: (result: DocumentsResult, chunk: { path: string | any[], value: object }) => {
                const doc = chunk.value;
                const path = chunk.path;

                const metadata = doc["@metadata"];
                if (!metadata) {
                    throwError("InvalidArgumentException", "Document must have @metadata.");
                }

                const docId = metadata["@id"];
                if (!docId) {
                    throwError("InvalidArgumentException", "Document must have @id in @metadata.");
                }

                if (path[0] === "Results") {
                    result.results.push(doc);
                } else if (path[0] === "Includes") {
                    result.includes[docId] = doc;
                }

                return result;
            },
            initResult: { results: [], includes: {} } as DocumentsResult
        };

        return RavenCommandResponsePipeline.create()
            .collectBody()
            .parseJsonAsync(LOAD_DOCS_JSON_PATH)
            .streamKeyCaseTransform({
                targetKeyCaseConvention: this._conventions.entityFieldNameConvention,
                extractIgnorePaths: (e) => [ ...getIgnoreKeyCaseTransformKeysFromDocumentMetadata(e), /@metadata\./ ],
                ignoreKeys: [ /^@/ ]
            })
            .restKeyCaseTransform({ targetKeyCaseConvention: "camel" })
            .collectResult(collectResultOpts)
            .process(bodyStream)
            .then((result: IRavenCommandResponsePipelineResult<DocumentsResult>) => {
                this.result = Object.assign(result.result, result.rest) as GetDocumentsResult;
                return result.body;
            });
    }

    public get isReadRequest(): boolean {
        return true;
    }
}
