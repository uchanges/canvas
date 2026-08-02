import { requestDeeix, streamDeeix } from "./deeix";

export type DeeixVideoModel = {
    platformModelName: string;
    kindsJSON: string;
    description?: string;
    available: boolean;
};

export type CanvasVideoTask = {
    nodeId: string;
    model: string;
    prompt: string;
    fileIds?: string[];
    options?: Record<string, unknown>;
};

export type CanvasVideoTaskFile = {
    file_id: string;
    file_name: string;
    mime_type: string;
    size_bytes: number;
};

type CanvasVideoStreamEvent = {
    type?: string;
    run_id?: string;
    stage?: string;
    error_msg?: string;
    platform_model_name?: string;
    files?: CanvasVideoTaskFile[];
};

let modelsPromise: Promise<DeeixVideoModel[]> | null = null;

export function listDeeixVideoModels() {
    if (!modelsPromise) {
        modelsPromise = requestDeeix<DeeixVideoModel[]>("models")
            .then((models) => models.filter((model) => model.available && hasVideoCapability(model.kindsJSON)))
            .catch((error) => {
                modelsPromise = null;
                throw error;
            });
    }
    return modelsPromise;
}

export async function resolveCanvasVideoModel(value?: string) {
    const models = await listDeeixVideoModels();
    const model = models.find((item) => item.platformModelName === value) || models[0];
    if (!model) throw new Error("DEEIX 暂无可用的视频模型");
    return model;
}

export async function streamCanvasVideoTask(projectId: string, task: CanvasVideoTask, signal?: AbortSignal, onProgress?: (event: { runId?: string; stage?: string }) => void) {
    let completed = false;
    let model = task.model;
    let runId = "";
    let files: CanvasVideoTaskFile[] = [];
    await streamDeeix<CanvasVideoStreamEvent>(
        `canvas/projects/${encodeURIComponent(projectId)}/tasks/video/stream`,
        {
            method: "POST",
            body: JSON.stringify({
                node_id: task.nodeId,
                model: task.model,
                prompt: task.prompt,
                file_ids: task.fileIds || [],
                options: task.options || {},
            }),
            signal,
        },
        (event, payload) => {
            const type = payload.type || event;
            if (payload.run_id) runId = payload.run_id;
            if (type === "error") throw new Error(payload.error_msg || "DEEIX 视频生成失败");
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
    if (!completed) throw new Error("DEEIX 视频任务未完成");
    if (!files.length) throw new Error("DEEIX 视频任务没有返回文件");
    return { runId, model, files };
}

function hasVideoCapability(kindsJSON: string) {
    try {
        return JSON.parse(kindsJSON || "[]").includes("video_gen");
    } catch {
        return false;
    }
}
