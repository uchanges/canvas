import { DEEIX_API_BASE_URL } from "@/constant/runtime-config";

export type DeeixEnvelope<T> = {
    errorMsg: string;
    errorCode?: string;
    details?: unknown;
    requestId?: string;
    data: T;
};

export class DeeixApiError extends Error {
    constructor(
        message: string,
        public readonly status: number,
        public readonly code?: string,
        public readonly details?: unknown,
        public readonly requestId?: string,
    ) {
        super(message);
        this.name = "DeeixApiError";
    }
}

export type DeeixUser = {
    id: number;
    username: string;
    email?: string;
};

type LoginResult = {
    accessToken: string;
    user: DeeixUser;
};

let accessToken: string | null = null;
let refreshPromise: Promise<LoginResult | null> | null = null;

function apiUrl(path: string) {
    const base = DEEIX_API_BASE_URL.replace(/\/+$/, "");
    const suffix = path.replace(/^\/+/, "");
    return `${base}/${suffix}`;
}

async function readEnvelope<T>(response: Response): Promise<T> {
    let body: DeeixEnvelope<T>;
    try {
        body = (await response.json()) as DeeixEnvelope<T>;
    } catch {
        throw new DeeixApiError("DEEIX 服务返回了无效响应", response.status);
    }
    if (!response.ok || body.errorMsg) throw new DeeixApiError(body.errorMsg || "DEEIX 请求失败", response.status, body.errorCode, body.details, body.requestId);
    return body.data;
}

async function refreshSession() {
    try {
        const response = await fetch(apiUrl("auth/refresh"), { method: "POST", credentials: "include" });
        const result = await readEnvelope<LoginResult>(response);
        accessToken = result.accessToken || null;
        return accessToken ? result : null;
    } catch {
        accessToken = null;
        return null;
    }
}

export async function refreshDeeixSession() {
    if (!refreshPromise)
        refreshPromise = refreshSession().finally(() => {
            refreshPromise = null;
        });
    return refreshPromise;
}

export function clearDeeixSession() {
    accessToken = null;
}

export async function requestDeeix<T>(path: string, init: RequestInit = {}, retryOnUnauthorized = true): Promise<T> {
    const response = await fetchDeeix(path, init, retryOnUnauthorized);
    return readEnvelope<T>(response);
}

export async function requestDeeixResponse(path: string, init: RequestInit = {}, retryOnUnauthorized = true) {
    const response = await fetchDeeix(path, init, retryOnUnauthorized);
    if (!response.ok) await readEnvelope<never>(response);
    return response;
}

async function fetchDeeix(path: string, init: RequestInit = {}, retryOnUnauthorized = true) {
    const headers = new Headers(init.headers);
    if (accessToken) headers.set("Authorization", `Bearer ${accessToken}`);
    if (init.body && !(init.body instanceof FormData) && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");

    let response: Response;
    try {
        response = await fetch(apiUrl(path), { ...init, headers, credentials: "include" });
    } catch {
        throw new DeeixApiError("无法连接 DEEIX 服务", 0);
    }
    if (response.status === 401 && retryOnUnauthorized && (await refreshDeeixSession())) return fetchDeeix(path, init, false);
    return response;
}

export async function getDeeixCurrentUser() {
    const data = await requestDeeix<{ user: DeeixUser }>("me");
    return data.user;
}

export function deeixErrorMessage(error: unknown) {
    if (error instanceof DeeixApiError) return error.message;
    return error instanceof Error ? error.message : "DEEIX 请求失败";
}

export async function streamDeeix<T>(path: string, init: RequestInit, onEvent: (event: string, data: T) => void | Promise<void>) {
    const response = await fetchDeeix(path, { ...init, headers: { ...Object.fromEntries(new Headers(init.headers).entries()), Accept: "text/event-stream" } });
    if (!response.ok || !response.body) return readEnvelope<never>(response);

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    while (true) {
        const { done, value } = await reader.read();
        buffer += decoder.decode(value || new Uint8Array(), { stream: !done }).replace(/\r\n/g, "\n");
        let boundary = buffer.indexOf("\n\n");
        while (boundary >= 0) {
            const frame = buffer.slice(0, boundary);
            buffer = buffer.slice(boundary + 2);
            const event = frame.match(/^event:\s*(.+)$/m)?.[1] || "message";
            const text = frame
                .split("\n")
                .filter((line) => line.startsWith("data:"))
                .map((line) => line.slice(5).trimStart())
                .join("\n");
            if (text) {
                try {
                    await onEvent(event, JSON.parse(text) as T);
                } catch (error) {
                    if (error instanceof SyntaxError) throw new DeeixApiError("DEEIX 流式响应格式错误", response.status);
                    throw error;
                }
            }
            boundary = buffer.indexOf("\n\n");
        }
        if (done) break;
    }
}
