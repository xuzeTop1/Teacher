const SPLASH_COMPOSITE_DELAY_MS = 150

function setBootFailure(message: string) {
  const status = document.getElementById("boot-status")
  if (status) status.textContent = message
}

async function revealMainWindow() {
  // Force style/layout work for the static splash before revealing the native
  // window. Hidden WebView2 windows may suspend requestAnimationFrame, so use a
  // normal timer to give the compositor time to commit the first splash frame.
  document.getElementById("boot-splash")?.getBoundingClientRect()
  await new Promise<void>((resolve) => {
    setTimeout(resolve, SPLASH_COMPOSITE_DELAY_MS)
  })

  const { getCurrentWindow } = await import("@tauri-apps/api/window")
  const window = getCurrentWindow()
  await window.show()
  await window.setFocus()
}

async function bootstrap() {
  try {
    await revealMainWindow()
  } catch (error) {
    // Browser-only Vite preview has no native Tauri window. In Tauri, the Rust
    // fallback still reveals a diagnostic window if the bridge fails.
    console.debug("Native window reveal was unavailable", error)
  }

  try {
    await import("./main")
  } catch (error) {
    console.error("TeacherAgent bootstrap failed", error)
    setBootFailure("启动失败，请关闭后重新打开应用。")
  }
}

void bootstrap()
