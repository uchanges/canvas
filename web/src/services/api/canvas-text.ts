import { requestDeeix, streamDeeix } from "./deeix";

export type DeeixTextModel = {
    platformModelName: string;
    kindsJSON: string;
    description?: string;
    available: boolean;
};

export type CanvasTextTask = {
    nodeId: string;
    model: string;
    prompt: string;
    fileIds?: string[];
    options?: Record<string, unknown>;
};

type CanvasTextStreamEvent = {
    type?: string;
    delta?: string;
    error_msg?: string;
    platform_model_name?: string;
};

let modelsPromise: Promise<DeeixTextModel[]> | null = null;

export function listDeeixTextModels() {
    if (!modelsPromise) {
        modelsPromise = requestDeeix<DeeixTextModel[]>("models")
            .then((models) => models.filter((model) => model.available && hasChatCapability(model.kindsJSON)))
            .catch((error) => {
                modelsPromise = null;
                throw error;
            });
    }
    return modelsPromise;
}

export async function resolveCanvasTextModel(value?: string) {
    const models = await listDeeixTextModels();
    const model = models.find((item) => item.platformModelName === value) || models[0];
    if (!model) throw new Error("DEEIX 暂无可用的文本模型");
    return model;
}

export async function streamCanvasTextTask(projectId: string, task: CanvasTextTask, signal: AbortSignal | undefined, onDelta: (text: string) => void) {
    let text = "";
    let completed = false;
    let model = task.model;
    await streamDeeix<CanvasTextStreamEvent>(
        `canvas/projects/${encodeURIComponent(projectId)}/tasks/text/stream`,
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
            if (type === "delta") {
                text += payload.delta || "";
                onDelta(text);
                return;
            }
            if (type === "error") throw new Error(payload.error_msg || "DEEIX 文本生成失败");
            if (type === "completed") {
                completed = true;
                model = payload.platform_model_name || model;
            }
        },
    );
    if (signal?.aborted) throw new Error("请求已取消");
    if (!completed) throw new Error("DEEIX 文本任务未完成");
    return { content: text, model };
}

function hasChatCapability(kindsJSON: string) {
    try {
        return JSON.parse(kindsJSON || "[]").includes("chat");
    } catch {
        return false;
    }
}
