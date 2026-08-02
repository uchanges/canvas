import { useEffect, useRef } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { App, Button } from "antd";
import { Download, Plus } from "lucide-react";

import { CanvasDeleteProjectsDialog } from "@/components/canvas/canvas-delete-projects-dialog";
import { CanvasProjectCard } from "@/components/canvas/canvas-project-card";
import { DEEIX_LOGIN_URL } from "@/constant/runtime-config";
import { useCanvasStore } from "@/stores/canvas/use-canvas-store";
import { useCanvasUiStore } from "@/stores/canvas/use-canvas-ui-store";
import { exportCanvasProjects } from "@/lib/canvas/canvas-export";
import { deeixErrorMessage } from "@/services/api/deeix";

export default function CanvasPage() {
    const { message } = App.useApp();
    const navigate = useNavigate();
    const [searchParams] = useSearchParams();
    const autoOpenRef = useRef(false);
    const hydrated = useCanvasStore((state) => state.hydrated);
    const loading = useCanvasStore((state) => state.loading);
    const authRequired = useCanvasStore((state) => state.authRequired);
    const loadError = useCanvasStore((state) => state.loadError);
    const projects = useCanvasStore((state) => state.projects);
    const createProject = useCanvasStore((state) => state.createProject);
    const loadProjects = useCanvasStore((state) => state.loadProjects);
    const selectedIds = useCanvasUiStore((state) => state.selectedProjectIds);
    const setDeleteIds = useCanvasUiStore((state) => state.setDeleteProjectIds);

    const mode = searchParams.get("mode");
    const agentMode = mode === "new" || mode === "recent" || mode === "choose";
    const agentQuery = agentMode ? `?${searchParams.toString()}` : "";
    const enterProject = (id: string) => {
        navigate(`/canvas/${id}${agentQuery}`);
    };
    const createAndEnter = async () => {
        try {
            enterProject(await createProject(`无限画布 ${projects.length + 1}`));
        } catch (error) {
            message.error(deeixErrorMessage(error));
        }
    };

    useEffect(() => {
        void loadProjects();
    }, [loadProjects]);

    useEffect(() => {
        if (!hydrated || authRequired || autoOpenRef.current || (mode !== "new" && mode !== "recent")) return;
        autoOpenRef.current = true;
        void (async () => {
            try {
                enterProject(mode === "new" ? await createProject(`无限画布 ${projects.length + 1}`) : projects[0]?.id || (await createProject(`无限画布 ${projects.length + 1}`)));
            } catch (error) {
                message.error(deeixErrorMessage(error));
            }
        })();
    }, [authRequired, createProject, hydrated, message, mode, projects]);

    if (hydrated && authRequired) {
        return (
            <main className="flex h-full flex-col items-center justify-center gap-4 bg-background text-center">
                <h1 className="text-xl font-semibold">请先登录 DEEIX</h1>
                <p className="text-sm text-stone-500">登录后即可使用账号隔离的云端画布项目。</p>
                <Button type="primary" onClick={() => window.location.assign(DEEIX_LOGIN_URL)}>
                    前往登录
                </Button>
            </main>
        );
    }

    if (hydrated && (mode === "new" || mode === "recent")) return <main className="flex h-full items-center justify-center bg-background text-sm text-stone-500">正在打开画布...</main>;

    return (
        <main className="h-full overflow-auto bg-background text-stone-950 dark:text-stone-100">
            <div className="mx-auto flex w-full max-w-6xl flex-col gap-8 px-6 py-10">
                <header className="flex flex-wrap items-end justify-between gap-4 border-b border-stone-200 pb-6 dark:border-stone-800">
                    <div>
                        <p className="text-xs text-stone-500">画布库</p>
                        <h1 className="mt-3 text-3xl font-semibold">无限画布</h1>
                    </div>
                    <div className="flex items-center gap-2">
                        {selectedIds.length ? (
                            <>
                                <Button disabled={!hydrated} icon={<Download className="size-4" />} onClick={() => void exportCanvasProjects(projects.filter((project) => selectedIds.includes(project.id)), `无限画布-${selectedIds.length}个项目`)}>
                                    导出选中
                                </Button>
                                <Button disabled={!hydrated} onClick={() => setDeleteIds(selectedIds)}>
                                    删除选中
                                </Button>
                            </>
                        ) : null}
                        {projects.length ? (
                            <Button disabled={!hydrated} onClick={() => setDeleteIds(projects.map((project) => project.id))}>
                                删除全部
                            </Button>
                        ) : null}
                        <Button disabled={!hydrated || loading} type="primary" icon={<Plus className="size-4" />} onClick={() => void createAndEnter()}>
                            新建画布
                        </Button>
                    </div>
                </header>

                {!hydrated || loading ? (
                    <section className="flex min-h-[360px] items-center justify-center border-y border-stone-200 text-sm text-stone-500 dark:border-stone-800">正在加载画布...</section>
                ) : loadError ? (
                    <section className="flex min-h-[360px] flex-col items-center justify-center gap-4 border-y border-stone-200 text-sm text-stone-500 dark:border-stone-800">
                        <span>{loadError}</span>
                        <Button onClick={() => void loadProjects()}>重新加载</Button>
                    </section>
                ) : projects.length ? (
                    <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-3">
                        {projects.map((project) => (
                            <CanvasProjectCard key={project.id} project={project} />
                        ))}
                    </div>
                ) : (
                    <section className="flex min-h-[360px] flex-col items-center justify-center border-y border-stone-200 text-center dark:border-stone-800">
                        <h2 className="text-xl font-medium">还没有画布</h2>
                        <p className="mt-3 text-sm text-stone-500">新建一个画布后，就可以独立保存节点、连线和画布外观。</p>
                        <Button type="primary" className="mt-6" icon={<Plus className="size-4" />} onClick={() => void createAndEnter()}>
                            新建画布
                        </Button>
                    </section>
                )}
            </div>
            <CanvasDeleteProjectsDialog />
        </main>
    );
}
