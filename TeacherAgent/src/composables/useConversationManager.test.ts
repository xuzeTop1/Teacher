import { beforeEach, describe, expect, it, vi } from "vitest"
import { useConversationManager } from "./useConversationManager"
import type { LocalConversation, StoredMessage } from "../services/tauri/commands"

const mocks = vi.hoisted(() => ({
  listMessages: vi.fn(), ensureDefaultConversation:vi.fn(),
  app:{selectedSubject:"math",setDatabaseStatus:vi.fn(),setProviderConfigs:vi.fn(),setCustomSubjects:vi.fn()},
}))
vi.mock("../stores/app",()=>({useAppStore:()=>mocks.app}))
vi.mock("../services/knowledge/knowledgeIndexer",()=>({seedAllKnowledgeNodes:vi.fn().mockResolvedValue(undefined)}))
vi.mock("../services/tauri/commands",async(importOriginal)=>({
  ...await importOriginal<typeof import("../services/tauri/commands")>(),
  listMessages:mocks.listMessages,ensureDefaultConversation:mocks.ensureDefaultConversation,
  initializeDatabase:vi.fn().mockResolvedValue({}),listConversations:vi.fn().mockResolvedValue([]),
  listProviderConfigs:vi.fn().mockResolvedValue([]),listCustomSubjects:vi.fn().mockResolvedValue([]),
}))
function deferred<T>() { let resolve!:(value:T)=>void;let reject!:(reason:Error)=>void;const promise=new Promise<T>((r,j)=>{resolve=r;reject=j});return{promise,resolve,reject} }
const conversation=(id:string)=>({conversationId:id,studentId:"test",subjectCode:"math"} as LocalConversation)
const message=(id:string)=>({id,role:"student",content:id} as StoredMessage)
beforeEach(()=>{vi.clearAllMocks();mocks.app.selectedSubject="math"})

describe("conversation selection ordering",()=>{
  it("keeps the last selected conversation when older history completes later",async()=>{
    const a=deferred<StoredMessage[]>(),b=deferred<StoredMessage[]>()
    mocks.listMessages.mockImplementation((id)=>id==="A"?a.promise:b.promise)
    const manager=useConversationManager()
    const first=manager.loadConversation(conversation("A")),last=manager.loadConversation(conversation("B"))
    b.resolve([message("B")]);await last
    a.resolve([message("A")]);await first
    expect(manager.conversationId.value).toBe("B")
    expect(manager.messages.value[0].id).toBe("B")
  })
  it("does not let a stale failure clear loading or mark the active conversation unsaved",async()=>{
    const a=deferred<StoredMessage[]>(),b=deferred<StoredMessage[]>()
    mocks.listMessages.mockImplementation((id)=>id==="A"?a.promise:b.promise)
    const manager=useConversationManager();manager.persistenceStatus.value="sqlite"
    const first=manager.loadConversation(conversation("A")),last=manager.loadConversation(conversation("B"))
    a.reject(new Error("old load failed"));await first
    expect(manager.isLoadingHistory.value).toBe(true)
    expect(manager.persistenceStatus.value).toBe("sqlite")
    b.resolve([message("B")]);await last
    expect(manager.isLoadingHistory.value).toBe(false)
  })
  it("does not apply an initialization from a subject that the user has left",async()=>{
    const a=deferred<LocalConversation>(),b=deferred<LocalConversation>()
    mocks.ensureDefaultConversation.mockImplementation((subject)=>subject==="math"?a.promise:b.promise)
    mocks.listMessages.mockResolvedValue([])
    const manager=useConversationManager(),old=manager.initializeConversation()
    await vi.waitFor(()=>expect(mocks.ensureDefaultConversation).toHaveBeenCalledWith("math"))
    mocks.app.selectedSubject="physics"
    const current=manager.initializeConversation()
    await vi.waitFor(()=>expect(mocks.ensureDefaultConversation).toHaveBeenCalledWith("physics"))
    b.resolve({...conversation("B"),subjectCode:"physics"});await current
    a.resolve(conversation("A"));await old
    expect(manager.conversationId.value).toBe("B")
  })
})
