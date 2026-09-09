import "vuetify/styles"
import { createVuetify } from "vuetify"
import { aliases, mdi } from "vuetify/iconsets/mdi"

import * as components from "vuetify/components"
import * as directives from "vuetify/directives"

export const vuetify = createVuetify({
  components,
  directives,
  icons: {
    defaultSet: "mdi",
    aliases,
    sets: {
      mdi
    }
  },
  theme: {
    defaultTheme: "teacherLight",
    themes: {
      teacherLight: {
        dark: false,
        colors: {
          primary: "#4a90d9",
          secondary: "#475467",
          background: "#f4f6f8",
          surface: "#ffffff",
          error: "#b42318",
          info: "#026aa2",
          success: "#027a48",
          warning: "#b54708"
        }
      }
    }
  },
  defaults: {
    VBtn: {
      rounded: "lg"
    },
    VCard: {
      rounded: "lg"
    },
    VTextField: {
      variant: "outlined",
      density: "comfortable"
    },
    VTextarea: {
      variant: "outlined",
      density: "comfortable"
    }
  }
})
