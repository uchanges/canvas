import { CanvasNodeType, type CanvasAssistantSession, type CanvasConnection, type CanvasNodeData, type ViewportTransform } from "@/types/canvas";
import type { CanvasBackgroundMode } from "@/lib/canvas-theme";
import { requestDeeix } from "./deeix";

export type RemoteCanvasScene = {
    nodes: CanvasNodeData[];
    connections: CanvasConnection[];
    chatSessions: CanvasAssistantSession[];
    activeChatId: string | null;
    backgroundMode: CanvasBackgroundMode;
    showImageInfo: boolean;
    viewport: ViewportTransform;
};

export type RemoteCanvasProject = RemoteCanvasScene & {
    id: string;
    title: string;
    description: string;
    status: "active" | "archived";
    thumbnailFileId?: string;
    sceneVersion: number;
    sceneRevision: number;
    createdAt: string;
    updatedAt: string;
};

type ApiCanvasProject = {
    id: string;
    title: string;
    description: string;
    status: "active" | "archived";
    thumbnail_file_id?: string;
    scene_version: number;
    scene_revision: number;
    scene: RemoteCanvasScene;
    created_at: string;
    updated_at: string;
};

function projectFromApi(project: ApiCanvasProject): RemoteCanvasProject {
    return {
        ...project.scene,
        id: project.id,
        title: project.title,
        description: project.description,
        status: project.status,
        thumbnailFileId: project.thumbnail_file_id,
        sceneVersion: project.scene_version,
        sceneRevision: project.scene_revision,
        createdAt: project.created_at,
        updatedAt: project.updated_at,
    };
}

export async function listCanvasProjects() {
    const page = await requestDeeix<{ total: number; results: ApiCanvasProject[] }>("canvas/projects?page=1&page_size=100");
    return { total: page.total, results: page.results.map(projectFromApi) };
}

export async function getCanvasProject(id: string) {
    return projectFromApi(await requestDeeix<ApiCanvasProject>(`canvas/projects/${encodeURIComponent(id)}`));
}

export async function createCanvasProject(title: string) {
    return projectFromApi(await requestDeeix<ApiCanvasProject>("canvas/projects", { method: "POST", body: JSON.stringify({ title, solution_key: "blank" }) }));
}

export async function renameCanvasProject(id: string, title: string) {
    return projectFromApi(await requestDeeix<ApiCanvasProject>(`canvas/projects/${encodeURIComponent(id)}`, { method: "PATCH", body: JSON.stringify({ title }) }));
}

export async function deleteCanvasProject(id: string) {
    await requestDeeix(`canvas/projects/${encodeURIComponent(id)}`, { method: "DELETE" });
}

export async function saveCanvasScene(id: string, project: Pick<RemoteCanvasProject, keyof RemoteCanvasScene | "sceneVersion" | "sceneRevision">) {
    const { nodes, connections, chatSessions, activeChatId, backgroundMode, showImageInfo, viewport } = project;
    return projectFromApi(
        await requestDeeix<ApiCanvasProject>(`canvas/projects/${encodeURIComponent(id)}/scene`, {
            method: "PUT",
            body: JSON.stringify({
                base_revision: project.sceneRevision,
                scene_version: project.sceneVersion,
                scene: { nodes: nodes.map(persistNode), connections, chatSessions: chatSessions.map(persistSession), activeChatId, backgroundMode, showImageInfo, viewport },
            }),
        }),
    );
}

function persistNode(node: CanvasNodeData): CanvasNodeData {
    if (!node.metadata) return node;
    const { content, storageKey: _storageKey, references, ...metadata } = node.metadata as typeof node.metadata & { storageKey?: unknown };
    const safeReferences = references?.filter((reference) => !reference.startsWith("data:") && !reference.startsWith("blob:"));
    const nextMetadata = { ...metadata, references: safeReferences };
    return node.metadata.fileId || [CanvasNodeType.Image, CanvasNodeType.Video, CanvasNodeType.Audio].includes(node.type as CanvasNodeType) ? { ...node, metadata: nextMetadata } : { ...node, metadata: { ...nextMetadata, content } };
}

function persistSession(session: CanvasAssistantSession): CanvasAssistantSession {
    return {
        ...session,
        messages: session.messages.map((message) => ({
            ...message,
            references: message.references?.map((reference) => {
                const { dataUrl: _dataUrl, storageKey: _storageKey, ...next } = reference as typeof reference & { storageKey?: unknown };
                return next;
            }),
        })),
    };
}
