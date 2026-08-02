import { requestDeeix, requestDeeixResponse } from "./deeix";

export type DeeixFile = {
    fileId: string;
    fileName: string;
    mimeType: string;
    detectedMIME: string;
    sizeBytes: number;
};

export type CanvasMediaFile = {
    fileId?: string;
    url: string;
    bytes: number;
    mimeType: string;
    width: number;
    height: number;
    durationMs?: number;
};

const objectUrls = new Map<string, string>();

export async function uploadCanvasFile(input: Blob | string, fileName = "canvas-media"): Promise<CanvasMediaFile> {
    const blob = typeof input === "string" ? await (await fetch(input)).blob() : input;
    const form = new FormData();
    form.set("purpose", "canvas");
    form.set("file", blob, fileNameWithExtension(input instanceof File ? input.name : fileName, blob.type));
    const result = await requestDeeix<{ file: DeeixFile }>("files", { method: "POST", body: form });
    const url = URL.createObjectURL(blob);
    objectUrls.set(result.file.fileId, url);
    const metadata = await readMediaMetadata(url, blob.type || result.file.detectedMIME || result.file.mimeType);
    return { fileId: result.file.fileId, url, bytes: result.file.sizeBytes, mimeType: result.file.detectedMIME || result.file.mimeType || blob.type, width: metadata.width || 0, height: metadata.height || 0, durationMs: metadata.durationMs };
}

export async function resolveCanvasFileUrl(fileId: string, fallback = "") {
    if (!fileId) return fallback;
    const cached = objectUrls.get(fileId);
    if (cached) return cached;
    const url = URL.createObjectURL(await getCanvasFileBlob(fileId));
    objectUrls.set(fileId, url);
    return url;
}

export async function resolveCanvasMediaFile(fileId: string, mimeType = "", bytes = 0): Promise<CanvasMediaFile> {
    const url = await resolveCanvasFileUrl(fileId);
    const metadata = await readMediaMetadata(url, mimeType);
    return { fileId, url, bytes, mimeType, width: metadata.width || 0, height: metadata.height || 0, durationMs: metadata.durationMs };
}

export async function getCanvasFileBlob(fileId: string) {
    const response = await requestDeeixResponse(`files/${encodeURIComponent(fileId)}/content`);
    return response.blob();
}

export function releaseCanvasFileUrls(fileIds?: Iterable<string>) {
    const keys = fileIds ? Array.from(new Set(fileIds)) : Array.from(objectUrls.keys());
    keys.forEach((fileId) => {
        const url = objectUrls.get(fileId);
        if (url) URL.revokeObjectURL(url);
        objectUrls.delete(fileId);
    });
}

export function collectCanvasFileIds(value: unknown, fileIds = new Set<string>()) {
    if (!value || typeof value !== "object") return fileIds;
    if ("fileId" in value && typeof value.fileId === "string" && value.fileId) fileIds.add(value.fileId);
    Object.values(value).forEach((item) => (Array.isArray(item) ? item.forEach((child) => collectCanvasFileIds(child, fileIds)) : collectCanvasFileIds(item, fileIds)));
    return fileIds;
}

function fileNameWithExtension(fileName: string, mimeType: string) {
    if (fileName.includes(".")) return fileName;
    const extension = mimeType.includes("png") ? "png" : mimeType.includes("jpeg") ? "jpg" : mimeType.includes("webp") ? "webp" : mimeType.includes("gif") ? "gif" : mimeType.includes("mp4") ? "mp4" : mimeType.includes("webm") ? "webm" : mimeType.includes("wav") ? "wav" : mimeType.includes("mpeg") ? "mp3" : "bin";
    return `${fileName}.${extension}`;
}

async function readMediaMetadata(url: string, mimeType: string): Promise<Partial<Pick<CanvasMediaFile, "width" | "height" | "durationMs">>> {
    if (mimeType.startsWith("image/")) return readImageMetadata(url, mimeType);
    if (mimeType.startsWith("video/")) return readVideoMetadata(url);
    if (mimeType.startsWith("audio/")) return readAudioMetadata(url);
    return {};
}

function readImageMetadata(url: string, mimeType: string) {
    return new Promise<{ width: number; height: number }>((resolve) => {
        const image = new Image();
        const done = () => resolve({ width: image.naturalWidth || 1024, height: image.naturalHeight || 1024 });
        image.onload = done;
        image.onerror = done;
        image.src = url;
    });
}

function readVideoMetadata(url: string) {
    return new Promise<{ width: number; height: number; durationMs?: number }>((resolve) => {
        const video = document.createElement("video");
        const done = () => resolve({ width: video.videoWidth || 1280, height: video.videoHeight || 720, durationMs: Number.isFinite(video.duration) ? Math.round(video.duration * 1000) : undefined });
        video.onloadedmetadata = done;
        video.onerror = done;
        video.src = url;
    });
}

function readAudioMetadata(url: string) {
    return new Promise<{ durationMs?: number }>((resolve) => {
        const audio = document.createElement("audio");
        const done = () => resolve({ durationMs: Number.isFinite(audio.duration) ? Math.round(audio.duration * 1000) : undefined });
        audio.onloadedmetadata = done;
        audio.onerror = done;
        audio.src = url;
    });
}
