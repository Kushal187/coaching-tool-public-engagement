import { createBrowserRouter } from "react-router";
import { Layout } from "./components/Layout";
import { Home } from "./components/Home";
import { UnifiedChat } from "./components/UnifiedChat";
import { Reflection } from "./components/Reflection";
import { CaseStudies } from "./components/CaseStudies";
import { CaseStudyDetail } from "./components/CaseStudyDetail";
import { About } from "./components/About";
import { AdminLayout } from "./components/admin/AdminLayout";
import { AdminDashboard } from "./components/admin/AdminDashboard";
import { DocumentExplorer } from "./components/admin/DocumentExplorer";
import { PipelineManager } from "./components/admin/PipelineManager";

export const router = createBrowserRouter([
  {
    path: "/",
    Component: Layout,
    children: [
      { index: true, Component: Home },
      { path: "coach", Component: UnifiedChat },
      { path: "coach/reflection", Component: Reflection },
      { path: "case-studies", Component: CaseStudies },
      { path: "case-studies/:caseStudyId", Component: CaseStudyDetail },
      { path: "about", Component: About },
      {
        path: "admin",
        Component: AdminLayout,
        children: [
          { index: true, Component: AdminDashboard },
          { path: "documents", Component: DocumentExplorer },
          { path: "pipeline", Component: PipelineManager },
        ],
      },
    ],
  },
]);
