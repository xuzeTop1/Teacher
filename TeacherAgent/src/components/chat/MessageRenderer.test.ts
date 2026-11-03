// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { createApp, h, nextTick, ref, type App } from "vue"
import MessageRenderer from "./MessageRenderer.vue"
import { renderMessageContent } from "../../services/rendering/messageRenderer"

vi.mock("../../services/rendering/messageRenderer",()=>({renderMessageContent:vi.fn()}))
let app:App|undefined
beforeEach(()=>{vi.mocked(renderMessageContent).mockReset();document.body.innerHTML="<div id='test'></div>"})
afterEach(()=>{app?.unmount();app=undefined;vi.useRealTimers()})
function deferred(){let resolve!:(html:string)=>void;const promise=new Promise<string>(r=>{resolve=r});return{promise,resolve}}
async function settle(){await Promise.resolve();await nextTick()}
describe("message render ordering",()=>{
  it("does not let a slow old render overwrite the latest content",async()=>{
    const old=deferred(),newest=deferred(),content=ref("old")
    vi.mocked(renderMessageContent).mockImplementation(text=>text==="old"?old.promise:newest.promise)
    app=createApp({setup:()=>()=>h(MessageRenderer,{content:content.value})});app.mount("#test")
    content.value="new";await nextTick()
    newest.resolve("<p>new</p>");await settle()
    old.resolve("<p>old</p>");await settle()
    expect(document.body.textContent).toBe("new")
  })
  it("renders the final streaming state even when content stays unchanged",async()=>{
    vi.useFakeTimers();const streaming=ref(true)
    vi.mocked(renderMessageContent).mockResolvedValue("<p>ready</p>")
    app=createApp({setup:()=>()=>h(MessageRenderer,{content:"same",streaming:streaming.value})});app.mount("#test")
    await vi.advanceTimersByTimeAsync(100);await settle()
    streaming.value=false;await nextTick();await settle()
    expect(renderMessageContent).toHaveBeenLastCalledWith("same",{streaming:false})
    expect(renderMessageContent).toHaveBeenCalledTimes(2)
  })
  it("clears the pending render when the component is unmounted",async()=>{
    vi.useFakeTimers()
    app=createApp({render:()=>h(MessageRenderer,{content:"pending",streaming:true})});app.mount("#test")
    app.unmount();app=undefined
    await vi.advanceTimersByTimeAsync(100)
    expect(renderMessageContent).not.toHaveBeenCalled()
    expect(vi.getTimerCount()).toBe(0)
  })
})
