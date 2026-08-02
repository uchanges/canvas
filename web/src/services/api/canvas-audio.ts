import { requestDeeix, streamDeeix } from "./deeix";

export type DeeixAudioModel = {
    platformModelName: string;
    kindsJSON: string;
    description?: string;
    available: boolean;
};

export type CanvasAudioTask = {
    nodeId: string;
    model: string;
    prompt: string;
    options?: Record<string, unknown>;
};

export type CanvasAudioTaskFile = {
    file_id: string;
    file_name: string;
    mime_type: string;
    size_bytes: number;
};

type CanvasAudioStreamEvent = {
    type?: string;
    run_id?: string;
    stage?: string;
    error_msg?: string;
    platform_model_name?: string;
    files?: CanvasAudioTaskFile[];
};

let modelsPromise: Promise<DeeixAudioModel[]> | null = null;

export function listDeeixAudioModels() {
    if (!modelsPromise) {
        modelsPromise = requestDeeix<DeeixAudioModel[]>("models")
            .then((models) => models.filter((model) => model.available && hasAudioCapability(model.kindsJSON)))
            .catch((error) => {
                modelsPromise = null;
                throw error;
            });
    }
    return modelsPromise;
}

export async function resolveCanvasAudioModel(value?: string) {
    const models = await listDeeixAudioModels();
    const model = models.find((item) => item.platformModelName === value) || models[0];
    if (!model) throw new Error("DEEIX 暂无可用的音频模型");
    return model;
}

export async function streamCanvasAudioTask(projectId: string, task: CanvasAudioTask, signal?: AbortSignal, onProgress?: (event: { runId?: string; stage?: string }) => void) {
    let completed = false;
    let model = task.model;
    let runId = "";
    let files: CanvasAudioTaskFile[] = [];
    await streamDeeix<CanvasAudioStreamEvent>(
        `canvas/projects/${encodeURIComponent(projectId)}/tasks/audio/stream`,
        {
            method: "POST",
            body: JSON.stringify({
                node_id: task.nodeId,
                model: task.model,
                prompt: task.prompt,
                options: task.options || {},
            }),
            signal,
        },
        (event, payload) => {
            const type = payload.type || event;
            if (payload.run_id) runId = payload.run_id;
            if (type === "error") throw new Error(payload.error_msg || "DEEIX 音频生成失败");
            if (type === "completed") {
                completed = true;
                model = payload.platform_model_name || model;
                files = payload.files || [];
                return;
            }
            onProgress?.({ runId: payload.run_id, stage: payload.stage || type });
        },
    );
    if (signal?.aborted) throw new Error("请求已取消");
    if (!completed) throw new Error("DEEIX 音频任务未完成");
    if (!files.length) throw new Error("DEEIX 音频任务没有返回文件");
    return { runId, model, files };
}

function hasAudioCapability(kindsJSON: string) {
    try {
        return JSON.parse(kindsJSON || "[]").includes("audio");
    } catch {
        return false;
    }
}
