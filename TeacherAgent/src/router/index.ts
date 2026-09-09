import { createRouter, createWebHashHistory } from "vue-router"

export const router = createRouter({
  history: createWebHashHistory(),
  routes: [
    {
      path: "/",
      name: "chat",
      component: () => import("../views/ChatView.vue")
    },
    {
      path: "/practice",
      name: "practice",
      component: () => import("../views/PracticeView.vue")
    },
    {
      path: "/dashboard",
      name: "dashboard",
      component: () => import("../views/DashboardView.vue")
    },
    {
      path: "/knowledge-graph",
      name: "knowledge-graph",
      component: () => import("../views/KnowledgeGraphView.vue")
    },
    {
      path: "/settings",
      name: "settings",
      component: () => import("../views/SettingsView.vue")
    },
    {
      path: "/alerttime-sync",
      name: "alerttime-sync",
      component: () => import("../views/AlertTimeSyncView.vue")
    }
  ]
})
