import { createBrowserRouter, Navigate, Outlet } from "react-router-dom";

import { AnalyticsTracker } from "@/components/layout/analytics-tracker";
import UserLayout from "@/layouts/user-layout";
import CanvasPage from "@/pages/canvas";
import CanvasProjectPage from "@/pages/canvas/project";

export const router = createBrowserRouter([
    {
        element: (
            <UserLayout>
                <AnalyticsTracker />
                <Outlet />
            </UserLayout>
        ),
        children: [
            { index: true, element: <Navigate to="/canvas" replace /> },
            { path: "/canvas", element: <CanvasPage /> },
            { path: "/canvas/:id", element: <CanvasProjectPage /> },
            { path: "*", element: <Navigate to="/canvas" replace /> },
        ],
    },
], { basename: import.meta.env.BASE_URL });
