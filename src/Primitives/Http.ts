import fetch, { Request, RequestInit, Response } from "node-fetch";

export type HttpRequestParameters = RequestInit & {
  uri: string;
  fetcher?: typeof fetch;
};
export type HttpRequestParametersWithoutUri = RequestInit & {
  fetcher?: typeof fetch;
};
export type HttpResponse = Response;
export type HttpRequest = Request;
