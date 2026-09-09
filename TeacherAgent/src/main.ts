import { createApp } from "vue"
import { createPinia } from "pinia"
import "@mdi/font/css/materialdesignicons.css"
import "katex/dist/katex.min.css"
import "./styles/main.css"

import App from "./App.vue"
import { router } from "./router"
import { vuetify } from "./plugins/vuetify"

createApp(App).use(createPinia()).use(router).use(vuetify).mount("#app")

void router.isReady()
  .then(() => {
    requestAnimationFrame(() => {
      document.getElementById("boot-splash")?.remove()
    })
  })
  .catch((error) => {
    console.error("TeacherAgent startup failed", error)
    const status = document.getElementById("boot-status")
    if (status) status.textContent = "启动失败，请关闭后重新打开应用。"
  })
