import { Request, RequestInit, Response, default as fetch } from "node-fetch";

export type HttpRequestParameters = RequestInit & {
  uri: string;
  fetcher?: typeof fetch;
};
export type HttpRequestParametersWithoutUri = RequestInit & {
  fetcher?: typeof fetch;
};
export type HttpResponse = Response;
export type HttpRequest = Request;
