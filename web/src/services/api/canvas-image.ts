import { requestDeeix, streamDeeix } from "./deeix";

export type DeeixImageTaskType = "image_generation" | "image_edit";

export type DeeixImageModel = {
    code: string;
    display_name: string;
    task_types: DeeixImageTaskType[];
    profiles: Array<{
        resolution: {
            key: string;
            label: string;
            default: boolean;
            sizes: Array<{ aspect_ratio: string; size: string }>;
        };
        default_options: Record<string, unknown>;
        accessible: boolean;
        task_types: DeeixImageTaskType[];
        enabled: boolean;
        output_count: { mode: string; max_per_request: number; max_per_batch: number };
    }>;
};

export type CanvasImageTaskDraft = {
    nodeId: string;
    taskType: DeeixImageTaskType;
    model?: string;
    quality?: string;
    size?: string;
    outputCount: number;
    prompt: string;
    negativePrompt?: string;
    fileIds?: string[];
    maskFileId?: string;
    parentTaskId?: string;
    parentImageId?: string;
};

export type ResolvedCanvasImageTask = Omit<CanvasImageTaskDraft, "model" | "quality" | "size" | "outputCount"> & {
    model: string;
    resolutionKey: string;
    aspectRatio: string;
    outputCount: number;
    options: Record<string, unknown>;
};

export type CanvasImageJob = {
    id: string;
    source_node_id: string;
    status: "queued" | "running" | "succeeded" | "failed" | "canceled" | string;
    stage: string;
    error_message?: string;
    outputs: Array<{ file_id: string; mime_type: string; width: number; height: number; output_index: number }>;
};

type CreateCanvasImageTaskResponse = {
    job: Pick<CanvasImageJob, "id" | "source_node_id" | "status" | "stage">;
    run_id: string;
};

let modelsPromise: Promise<DeeixImageModel[]> | null = null;

export function listDeeixImageModels() {
    if (!modelsPromise) {
        modelsPromise = requestDeeix<DeeixImageModel[]>("image/models").catch((error) => {
            modelsPromise = null;
            throw error;
        });
    }
    return modelsPromise;
}

export async function resolveCanvasImageTask(draft: CanvasImageTaskDraft): Promise<ResolvedCanvasImageTask> {
    const models = await listDeeixImageModels();
    const candidates = models.filter((model) => model.task_types.includes(draft.taskType));
    const model = candidates.find((item) => item.code === draft.model) || candidates[0];
    if (!model) throw new Error("DEEIX 暂无可用的图片模型");

    const profiles = model.profiles.filter((profile) => profile.enabled && profile.accessible && profile.task_types.includes(draft.taskType));
    const profile = chooseProfile(profiles, draft.quality);
    if (!profile) throw new Error(`图片模型「${model.display_name}」当前不可用`);

    const resolution = profile.resolution;
    const aspectRatio = chooseAspectRatio(resolution.sizes, draft.size);
    const maximum = profile.output_count.max_per_request || 1;
    return {
        ...draft,
        model: model.code,
        resolutionKey: resolution.key,
        aspectRatio,
        outputCount: Math.max(1, Math.min(Math.floor(draft.outputCount) || 1, maximum)),
        options: profile.default_options || {},
    };
}

export async function createCanvasImageTask(projectId: string, task: ResolvedCanvasImageTask, signal?: AbortSignal) {
    return requestDeeix<CreateCanvasImageTaskResponse>(`canvas/projects/${encodeURIComponent(projectId)}/tasks/image`, {
        method: "POST",
        body: JSON.stringify({
            node_id: task.nodeId,
            task_type: task.taskType,
            model: task.model,
            resolution_key: task.resolutionKey,
            aspect_ratio: task.aspectRatio,
            output_count: task.outputCount,
            prompt: task.prompt,
            negative_prompt: task.negativePrompt || "",
            options: task.options,
            file_ids: task.fileIds || [],
            mask_file_id: task.maskFileId || "",
            parent_task_id: task.parentTaskId || "",
            parent_image_id: task.parentImageId || "",
            idempotency_key: crypto.randomUUID(),
        }),
        signal,
    });
}

export async function streamCanvasImageTask(jobId: string, signal: AbortSignal | undefined, onStatus: (job: CanvasImageJob) => void) {
    let latest: CanvasImageJob | null = null;
    await streamDeeix<CanvasImageJob>(`image/jobs/${encodeURIComponent(jobId)}/stream`, { signal }, (event, job) => {
        if (event !== "status") return;
        latest = job;
        onStatus(job);
    });
    const result = latest as CanvasImageJob | null;
    if (!result) throw new Error("DEEIX 图片任务未返回状态");
    if (result.status !== "succeeded") throw new Error(result.error_message || (result.status === "canceled" ? "图片任务已取消" : "图片生成失败"));
    return result;
}

export async function cancelCanvasImageTask(jobId: string) {
    await requestDeeix(`image/jobs/${encodeURIComponent(jobId)}/cancel`, { method: "POST" });
}

function chooseProfile(profiles: DeeixImageModel["profiles"], quality = "") {
    const candidates = [quality, quality === "low" ? "1k" : quality === "medium" ? "2k" : quality === "high" ? "4k" : ""].map((value) => value.trim().toLowerCase()).filter(Boolean);
    return profiles.find((profile) => candidates.includes(profile.resolution.key.toLowerCase()) || candidates.includes(profile.resolution.label.toLowerCase())) || profiles.find((profile) => profile.resolution.default) || profiles[0];
}

function chooseAspectRatio(sizes: Array<{ aspect_ratio: string }>, size = "") {
    if (!sizes.length) throw new Error("DEEIX 图片模型未提供可用尺寸");
    const requested = ratioFromSize(size);
    if (!requested) return sizes[0].aspect_ratio;
    return sizes.reduce((best, item) => (Math.abs(ratioValue(item.aspect_ratio) - requested) < Math.abs(ratioValue(best.aspect_ratio) - requested) ? item : best)).aspect_ratio;
}

function ratioFromSize(size: string) {
    const match = size.trim().match(/^(\d+)\s*(?::|x)\s*(\d+)$/i);
    return match ? Number(match[1]) / Number(match[2]) : 0;
}

function ratioValue(value: string) {
    return ratioFromSize(value) || 1;
}
