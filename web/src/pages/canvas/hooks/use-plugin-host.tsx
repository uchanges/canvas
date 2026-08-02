import { useCallback, useEffect, useMemo, useState, type Dispatch, type MutableRefObject, type SetStateAction } from "react";

import { createCanvasImageTask, listDeeixImageModels, resolveCanvasImageTask, streamCanvasImageTask } from "@/services/api/canvas-image";
import { listDeeixAudioModels, resolveCanvasAudioModel, streamCanvasAudioTask } from "@/services/api/canvas-audio";
import { listDeeixTextModels, resolveCanvasTextModel, streamCanvasTextTask } from "@/services/api/canvas-text";
import { listDeeixVideoModels, resolveCanvasVideoModel, streamCanvasVideoTask } from "@/services/api/canvas-video";
import { resolveCanvasMediaFile, uploadCanvasFile } from "@/services/api/deeix-files";
import { imageToDataUrl } from "@/services/image-storage";
import { buildNodeContext } from "@/lib/canvas/plugin-node-context";
import { getNodeDefinition } from "@/lib/canvas/node-registry";
import { ensurePluginsLoaded } from "@/lib/canvas/plugin-loader";
import { canvasThemes } from "@/lib/canvas-theme";
import type { CanvasNodeToolbarItem, CanvasPluginAi, CanvasPluginHost, ModelOption, PluginModelCapability } from "@/types/canvas-plugin";
import type { CanvasAgentOp } from "@/lib/canvas/canvas-agent-ops";
import type { CanvasConnection, CanvasNodeData, ViewportTransform } from "@/types/canvas";

type CanvasTheme = (typeof canvasThemes)[keyof typeof canvasThemes];
type ModelOptionsByCapability = Record<PluginModelCapability, ModelOption[]>;

const EMPTY_MODEL_OPTIONS: ModelOptionsByCapability = { image: [], video: [], text: [], audio: [] };

type PluginHostParams = {
    projectId: string;
    ensureProjectPersisted: () => Promise<void>;
    theme: CanvasTheme;
    nodesRef: MutableRefObject<CanvasNodeData[]>;
    connectionsRef: MutableRefObject<CanvasConnection[]>;
    viewportRef: MutableRefObject<ViewportTransform>;
    setNodes: Dispatch<SetStateAction<CanvasNodeData[]>>;
    setDialogNodeId: Dispatch<SetStateAction<string | null>>;
    applyAgentOps: (ops?: CanvasAgentOp[]) => unknown;
};

/**
 * 插件节点宿主能力：把宿主侧的 AI 生成、画布读写、面板开关等封装成插件可调用的 host/ai 对象，
 * 并在挂载时加载已安装的远程插件。返回给画布用于渲染插件面板与工具条。
 */
export function usePluginHost(params: PluginHostParams) {
    const { projectId, ensureProjectPersisted, theme, nodesRef, connectionsRef, viewportRef, setNodes, setDialogNodeId, applyAgentOps } = params;
    const [modelOptions, setModelOptions] = useState<ModelOptionsByCapability>(EMPTY_MODEL_OPTIONS);

    useEffect(() => {
        let active = true;
        void Promise.all([listDeeixImageModels(), listDeeixVideoModels(), listDeeixTextModels(), listDeeixAudioModels()])
            .then(([images, videos, texts, audios]) => {
                if (!active) return;
                setModelOptions({
                    image: images
                        .filter((model) => model.profiles.some((profile) => profile.enabled && profile.accessible && profile.task_types.some((type) => model.task_types.includes(type))))
                        .map((model) => ({ value: model.code, label: model.display_name || model.code })),
                    video: videos.map((model) => ({ value: model.platformModelName, label: model.platformModelName })),
                    text: texts.map((model) => ({ value: model.platformModelName, label: model.platformModelName })),
                    audio: audios.map((model) => ({ value: model.platformModelName, label: model.platformModelName })),
                });
            })
            .catch(() => undefined);
        return () => {
            active = false;
        };
    }, []);

    // 每个插件节点均以自身 nodeId 调用 DEEIX，服务端才能验证项目归属并记录任务审计。
    const createPluginAi = useCallback(
        (nodeId: string): CanvasPluginAi => {
            const uploadReferences = async (references: string[] | undefined, signal?: AbortSignal) => {
                const sources = Array.from(new Set((references || []).filter(Boolean)));
                const files = await Promise.all(
                    sources.map(async (source, index) => {
                        throwIfAborted(signal);
                        const file = await uploadCanvasFile(source, `plugin-reference-${index + 1}.png`);
                        throwIfAborted(signal);
                        if (!file.fileId) throw new Error("插件参考图片上传到 DEEIX 失败");
                        return file.fileId;
                    }),
                );
                return files;
            };
            return {
                generateImage: async (prompt, options) => {
                    await ensureProjectPersisted();
                    const fileIds = await uploadReferences(options?.references, options?.signal);
                    const task = await resolveCanvasImageTask({ nodeId, taskType: fileIds.length ? "image_edit" : "image_generation", model: options?.model, size: options?.size, outputCount: options?.count || 1, prompt, fileIds });
                    const created = await createCanvasImageTask(projectId, task, options?.signal);
                    const result = await streamCanvasImageTask(created.job.id, options?.signal, () => undefined);
                    return { images: await Promise.all(result.outputs.map((output) => imageToDataUrl({ fileId: output.file_id }))) };
                },
                generateVideo: async (prompt, options) => {
                    await ensureProjectPersisted();
                    const model = await resolveCanvasVideoModel(options?.model);
                    const fileIds = await uploadReferences(options?.references, options?.signal);
                    const result = await streamCanvasVideoTask(projectId, { nodeId, model: model.platformModelName, prompt, fileIds, options: videoOptions(options?.seconds, options?.size) }, options?.signal);
                    const output = result.files[0];
                    if (!output) throw new Error("DEEIX 视频任务没有返回文件");
                    const file = await resolveCanvasMediaFile(output.file_id, output.mime_type || "video/mp4", output.size_bytes || 0);
                    return { url: file.url, mimeType: file.mimeType, width: file.width, height: file.height, durationMs: file.durationMs };
                },
                generateText: async (prompt, options) => {
                    await ensureProjectPersisted();
                    const model = await resolveCanvasTextModel(options?.model);
                    const fullPrompt = options?.system?.trim() ? `${options.system.trim()}\n\n${prompt}` : prompt;
                    const result = await streamCanvasTextTask(projectId, { nodeId, model: model.platformModelName, prompt: fullPrompt }, options?.signal, (text) => options?.onDelta?.(text));
                    return { text: result.content };
                },
                generateAudio: async (prompt, options) => {
                    if (options?.references?.length) throw new Error("DEEIX Canvas 音频任务当前仅支持文本输入");
                    await ensureProjectPersisted();
                    const model = await resolveCanvasAudioModel(options?.model);
                    const result = await streamCanvasAudioTask(projectId, { nodeId, model: model.platformModelName, prompt, options: audioOptions(options) }, options?.signal);
                    const output = result.files[0];
                    if (!output) throw new Error("DEEIX 音频任务没有返回文件");
                    const file = await resolveCanvasMediaFile(output.file_id, output.mime_type || "audio/mpeg", output.size_bytes || 0);
                    return { url: file.url, mimeType: file.mimeType, durationMs: file.durationMs };
                },
                listModels: (capability) => (capability ? modelOptions[capability] : Object.values(modelOptions).flat()),
                defaultModel: (capability) => modelOptions[capability][0]?.value || "",
            };
        },
        [ensureProjectPersisted, modelOptions, projectId],
    );

    const pluginHost = useMemo<CanvasPluginHost>(
        () => ({
            getNode: (id) => nodesRef.current.find((node) => node.id === id) || null,
            getNodes: () => nodesRef.current,
            getConnections: () => connectionsRef.current,
            getUpstream: (nodeId) =>
                connectionsRef.current
                    .filter((conn) => conn.toNodeId === nodeId)
                    .map((conn) => nodesRef.current.find((node) => node.id === conn.fromNodeId))
                    .filter((node): node is CanvasNodeData => Boolean(node)),
            getDownstream: (nodeId) =>
                connectionsRef.current
                    .filter((conn) => conn.fromNodeId === nodeId)
                    .map((conn) => nodesRef.current.find((node) => node.id === conn.toNodeId))
                    .filter((node): node is CanvasNodeData => Boolean(node)),
            updateNode: (nodeId, patch) => setNodes((prev) => prev.map((node) => (node.id === nodeId ? { ...node, ...patch } : node))),
            updateMetadata: (nodeId, patch) => setNodes((prev) => prev.map((node) => (node.id === nodeId ? { ...node, metadata: { ...node.metadata, ...patch } } : node))),
            applyOps: (ops) => applyAgentOps(ops),
            ai: createPluginAi,
            openPanel: (nodeId) => setDialogNodeId(nodeId),
            closePanel: () => setDialogNodeId(null),
        }),
        [applyAgentOps, createPluginAi],
    );

    const renderPluginPanel = useCallback(
        (panelNode: CanvasNodeData) => {
            const Panel = getNodeDefinition(panelNode.type)?.Panel;
            if (!Panel) return null;
            const ctx = buildNodeContext(pluginHost, panelNode, theme, viewportRef.current.k);
            return <Panel ctx={ctx} onClose={() => setDialogNodeId(null)} />;
        },
        [pluginHost, theme],
    );

    // 组装节点悬浮工具条按钮:插件自定义 toolbar +(声明 interactionToggle 时)宿主自动注入的「交互 ⇄ 移动」开关
    const buildNodeToolbarItems = useCallback(
        (node: CanvasNodeData): CanvasNodeToolbarItem[] => {
            const definition = getNodeDefinition(node.type);
            const ctx = buildNodeContext(pluginHost, node, theme, viewportRef.current.k);
            const custom = definition?.toolbar?.(ctx) || [];
            // 仅在节点有内容(展示态)且非强制交互态(如编辑态)时提供「交互/移动」开关
            if (!definition?.interactionToggle || !node.metadata?.content || definition.forceInteractive?.(node)) return custom;
            const interactive = Boolean(node.metadata?.interactive);
            const toggle: CanvasNodeToolbarItem = {
                id: "node-interaction-toggle",
                title: interactive ? "当前:交互中。点击切回「移动」——拖动可移动节点" : "当前:可移动。点击切到「交互」——可操作节点内容(如转动全景)",
                label: interactive ? "移动" : "交互",
                icon: interactive ? "✋" : "🖐",
                active: interactive,
                onClick: () => pluginHost.updateMetadata(node.id, { interactive: !interactive }),
            };
            return [toggle, ...custom];
        },
        [pluginHost, theme],
    );

    // 启动时加载已安装的远程插件
    useEffect(() => {
        void ensurePluginsLoaded();
    }, []);

    return { pluginHost, renderPluginPanel, buildNodeToolbarItems };
}

function throwIfAborted(signal?: AbortSignal) {
    if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
}

function videoOptions(seconds?: string, size?: string) {
    const durationSeconds = Math.floor(Number(seconds));
    return { ...(durationSeconds > 0 ? { durationSeconds } : {}), ...(size ? { size } : {}) };
}

function audioOptions(options: { voice?: string; format?: string; speed?: number; instructions?: string } | undefined) {
    const instructions = options?.instructions?.trim();
    return {
        ...(options?.voice ? { voice: options.voice } : {}),
        ...(options?.format ? { response_format: options.format } : {}),
        ...(Number.isFinite(options?.speed) ? { speed: options?.speed } : {}),
        ...(instructions ? { instructions } : {}),
    };
}
