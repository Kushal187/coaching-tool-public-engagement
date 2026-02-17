import { createBrowserRouter } from "react-router";
import { Layout } from "./components/Layout";
import { Home } from "./components/Home";
import { Coach } from "./components/Coach";
import { CaseStudies } from "./components/CaseStudies";
import { CaseStudyDetail } from "./components/CaseStudyDetail";

export const router = createBrowserRouter([
  {
    path: "/",
    Component: Layout,
    children: [
      { index: true, Component: Home },
      { path: "coach", Component: Coach },
      { path: "case-studies", Component: CaseStudies },
      { path: "case-studies/:caseStudyId", Component: CaseStudyDetail },
    ],
  },
]);
