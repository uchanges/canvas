import { create } from "zustand";

import { createCanvasProject, deleteCanvasProject, getCanvasProject, listCanvasProjects, renameCanvasProject, saveCanvasScene, type RemoteCanvasProject, type RemoteCanvasScene } from "@/services/api/canvas";
import { DeeixApiError, deeixErrorMessage, getDeeixCurrentUser, refreshDeeixSession, type DeeixUser } from "@/services/api/deeix";

export type CanvasProject = RemoteCanvasProject;
export type CanvasProjectPatch = Partial<RemoteCanvasScene>;
export type CanvasSaveStatus = "saved" | "saving" | "error" | "conflict";

type CanvasStore = {
    hydrated: boolean;
    loading: boolean;
    authRequired: boolean;
    currentUser: DeeixUser | null;
    loadError: string | null;
    projects: CanvasProject[];
    saveStates: Record<string, CanvasSaveStatus>;
    saveErrors: Record<string, string | undefined>;
    loadProjects: () => Promise<void>;
    loadProject: (id: string) => Promise<CanvasProject | null>;
    createProject: (title?: string) => Promise<string>;
    openProject: (id: string) => CanvasProject | null;
    renameProject: (id: string, title: string) => Promise<void>;
    deleteProjects: (ids: string[]) => Promise<void>;
    updateProject: (id: string, patch: CanvasProjectPatch) => void;
    retrySaveProject: (id: string) => void;
};

type SaveTask = {
    timer: ReturnType<typeof setTimeout> | null;
    saving: boolean;
    version: number;
};

const saveTasks = new Map<string, SaveTask>();
const SAVE_DELAY = 800;

function taskFor(id: string) {
    let task = saveTasks.get(id);
    if (!task) {
        task = { timer: null, saving: false, version: 0 };
        saveTasks.set(id, task);
    }
    return task;
}

function setSaveState(id: string, status: CanvasSaveStatus, error?: string) {
    useCanvasStore.setState((state) => ({
        saveStates: { ...state.saveStates, [id]: status },
        saveErrors: { ...state.saveErrors, [id]: error },
    }));
}

function queueSave(id: string, delay = SAVE_DELAY) {
    const task = taskFor(id);
    if (task.timer) clearTimeout(task.timer);
    task.timer = setTimeout(() => {
        task.timer = null;
        void flushSave(id);
    }, delay);
}

async function flushSave(id: string) {
    const task = taskFor(id);
    if (task.saving) return;
    const project = useCanvasStore.getState().projects.find((item) => item.id === id);
    if (!project || useCanvasStore.getState().saveStates[id] === "conflict") return;

    const version = task.version;
    task.saving = true;
    setSaveState(id, "saving");
    try {
        const saved = await saveCanvasScene(id, project);
        const changedWhileSaving = task.version !== version;
        useCanvasStore.setState((state) => ({
            projects: state.projects.map((item) =>
                item.id !== id
                    ? item
                    : changedWhileSaving
                      ? { ...item, sceneVersion: saved.sceneVersion, sceneRevision: saved.sceneRevision, updatedAt: saved.updatedAt }
                      : { ...saved, title: item.title, description: item.description, status: item.status },
            ),
        }));
        task.saving = false;
        if (changedWhileSaving) {
            queueSave(id, 0);
        } else {
            setSaveState(id, "saved");
        }
    } catch (error) {
        task.saving = false;
        if (error instanceof DeeixApiError && (error.status === 409 || error.code === "canvas_scene_revision_conflict")) {
            setSaveState(id, "conflict", "画布已在其他位置更新，请重新打开后处理冲突。");
            return;
        }
        setSaveState(id, "error", deeixErrorMessage(error));
    }
}

export const useCanvasStore = create<CanvasStore>((set, get) => ({
    hydrated: false,
    loading: false,
    authRequired: false,
    currentUser: null,
    loadError: null,
    projects: [],
    saveStates: {},
    saveErrors: {},
    loadProjects: async () => {
        if (get().loading) return;
        set({ loading: true, loadError: null, authRequired: false });
        try {
            if (!(await refreshDeeixSession())) throw new DeeixApiError("请先登录 DEEIX", 401);
            const [currentUser, page] = await Promise.all([getDeeixCurrentUser(), listCanvasProjects()]);
            set({ currentUser, projects: page.results, hydrated: true });
        } catch (error) {
            const authRequired = error instanceof DeeixApiError && error.status === 401;
            set({ authRequired, loadError: deeixErrorMessage(error), hydrated: true, projects: [] });
        } finally {
            set({ loading: false });
        }
    },
    loadProject: async (id) => {
        try {
            const project = await getCanvasProject(id);
            set((state) => ({ projects: [project, ...state.projects.filter((item) => item.id !== id)] }));
            return project;
        } catch (error) {
            set({ loadError: deeixErrorMessage(error) });
            return null;
        }
    },
    createProject: async (title = "未命名画布") => {
        const project = await createCanvasProject(title);
        set((state) => ({ projects: [project, ...state.projects], saveStates: { ...state.saveStates, [project.id]: "saved" } }));
        return project.id;
    },
    openProject: (id) => get().projects.find((item) => item.id === id) || null,
    renameProject: async (id, title) => {
        const project = await renameCanvasProject(id, title.trim());
        set((state) => ({ projects: state.projects.map((item) => (item.id === id ? { ...item, ...project } : item)) }));
    },
    deleteProjects: async (ids) => {
        const deleted: string[] = [];
        for (const id of ids) {
            await deleteCanvasProject(id);
            deleted.push(id);
            const task = saveTasks.get(id);
            if (task?.timer) clearTimeout(task.timer);
            saveTasks.delete(id);
        }
        set((state) => ({
            projects: state.projects.filter((item) => !deleted.includes(item.id)),
            saveStates: Object.fromEntries(Object.entries(state.saveStates).filter(([id]) => !deleted.includes(id))),
            saveErrors: Object.fromEntries(Object.entries(state.saveErrors).filter(([id]) => !deleted.includes(id))),
        }));
    },
    updateProject: (id, patch) => {
        const task = taskFor(id);
        task.version += 1;
        set((state) => ({
            projects: state.projects.map((project) => (project.id === id ? { ...project, ...patch, updatedAt: new Date().toISOString() } : project)),
        }));
        if (get().saveStates[id] !== "conflict") queueSave(id);
    },
    retrySaveProject: (id) => {
        if (get().saveStates[id] === "conflict") return;
        queueSave(id, 0);
    },
}));
