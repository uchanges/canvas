import { saveAs } from "file-saver";

import { createZip } from "@/lib/zip";
import { collectCanvasFileIds, getCanvasFileBlob } from "@/services/api/deeix-files";
import type { CanvasExportAsset, CanvasExportFile } from "@/types/canvas-export";
import type { CanvasProject } from "@/stores/canvas/use-canvas-store";
import { CanvasNodeType, type CanvasNodeData } from "@/types/canvas";

export async function exportCanvasProjects(projects: CanvasProject[], fileName = "无限画布") {
    const zipFiles: { name: string; data: BlobPart }[] = [];
    const exportedProjects = await Promise.all(
        projects.map(async (project) => {
            const files: CanvasExportAsset[] = [];
            await Promise.all(
                Array.from(collectCanvasFileIds(project)).map(async (fileId) => {
                    const blob = await readCanvasFile(fileId);
                    if (!blob) return;
                    const path = `projects/${project.id}/files/${safeFileName(fileId)}.${fileExtension(blob.type)}`;
                    files.push({ fileId, path, mimeType: blob.type || "application/octet-stream", bytes: blob.size });
                    zipFiles.push({ name: path, data: blob });
                }),
            );
            return { project: exportProject(project), files };
        }),
    );

    const data: CanvasExportFile = { app: "infinite-canvas", version: 4, exportedAt: new Date().toISOString(), projects: exportedProjects };
    const zip = await createZip([{ name: "projects.json", data: JSON.stringify(data, null, 2) }, ...zipFiles]);
    saveAs(zip, `${safeFileName(fileName)}.zip`);
}

export async function exportCanvasNodes(nodes: CanvasNodeData[], fileName = "画布元素") {
    const zipFiles: { name: string; data: BlobPart }[] = [];
    const used = new Set<string>();
    const uniqueName = (base: string, ext: string) => {
        const safe = safeFileName(base) || "元素";
        let name = `${safe}.${ext}`;
        for (let i = 1; used.has(name); i += 1) name = `${safe}-${i}.${ext}`;
        used.add(name);
        return name;
    };

    await Promise.all(
        nodes.map(async (node) => {
            const title = node.title || node.type;
            const fileId = node.metadata?.fileId;
            if (fileId) {
                const blob = await readCanvasFile(fileId);
                if (blob) return void zipFiles.push({ name: uniqueName(title, fileExtension(blob.type)), data: blob });
            }
            if (node.type === CanvasNodeType.Text) return void zipFiles.push({ name: uniqueName(title, "txt"), data: node.metadata?.content || node.metadata?.prompt || "" });
            zipFiles.push({ name: uniqueName(title, "json"), data: JSON.stringify(node, null, 2) });
        }),
    );

    const zip = await createZip(zipFiles);
    saveAs(zip, `${safeFileName(fileName)}.zip`);
}

function safeFileName(value: string) {
    return value.replace(/[\\/:*?"<>|]/g, "_");
}

function fileExtension(mimeType: string) {
    if (mimeType.includes("png")) return "png";
    if (mimeType.includes("jpeg")) return "jpg";
    if (mimeType.includes("webp")) return "webp";
    if (mimeType.includes("gif")) return "gif";
    if (mimeType.includes("mp4")) return "mp4";
    if (mimeType.includes("webm")) return "webm";
    if (mimeType.includes("mpeg") || mimeType.includes("mp3")) return "mp3";
    if (mimeType.includes("wav")) return "wav";
    if (mimeType.includes("ogg")) return "ogg";
    return "bin";
}

async function readCanvasFile(fileId: string) {
    try {
        return await getCanvasFileBlob(fileId);
    } catch {
        return null;
    }
}

function exportProject(project: CanvasProject): CanvasProject {
    return {
        ...project,
        nodes: project.nodes.map((node) => {
            if (!node.metadata) return node;
            const { content, storageKey: _storageKey, references, ...metadata } = node.metadata as typeof node.metadata & { storageKey?: unknown };
            const nextMetadata = { ...metadata, references: references?.filter((reference) => !reference.startsWith("data:") && !reference.startsWith("blob:")) };
            return [CanvasNodeType.Image, CanvasNodeType.Video, CanvasNodeType.Audio].includes(node.type as CanvasNodeType) ? { ...node, metadata: nextMetadata } : { ...node, metadata: { ...nextMetadata, content } };
        }),
        chatSessions: project.chatSessions.map((session) => ({
            ...session,
            messages: session.messages.map((message) => ({
                ...message,
                references: message.references?.map((reference) => {
                    const { dataUrl: _dataUrl, storageKey: _storageKey, ...next } = reference as typeof reference & { storageKey?: unknown };
                    return next;
                }),
            })),
        })),
    };
}
