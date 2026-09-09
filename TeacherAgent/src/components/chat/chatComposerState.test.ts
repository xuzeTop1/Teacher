import { describe, expect, it } from "vitest"

import { canSendDraft, getSendRequestAction, isSendButtonDisabled } from "./chatComposerState"

describe("canSendDraft", () => {
  it("does not allow sending empty or whitespace-only drafts", () => {
    expect(canSendDraft("", false)).toBe(false)
    expect(canSendDraft("   \n\t", false)).toBe(false)
  })

  it("enables send only when the draft has content and no send is in progress", () => {
    expect(canSendDraft("什么是极限？", false)).toBe(true)
    expect(canSendDraft("什么是极限？", true)).toBe(false)
  })
})

describe("composer send button state", () => {
  it("keeps the button clickable for empty drafts so the composer can focus the input", () => {
    expect(isSendButtonDisabled(false)).toBe(false)
    expect(getSendRequestAction("", false)).toBe("focus_input")
    expect(getSendRequestAction("   \n\t", false)).toBe("focus_input")
  })

  it("disables the button only while a send is in progress", () => {
    expect(isSendButtonDisabled(true)).toBe(true)
    expect(getSendRequestAction("什么是极限？", true)).toBe("blocked_sending")
  })

  it("sends when the draft has content and no send is in progress", () => {
    expect(isSendButtonDisabled(false)).toBe(false)
    expect(getSendRequestAction("什么是极限？", false)).toBe("send")
  })

  it("allows send with attachments even when draft is empty", () => {
    expect(canSendDraft("", false, 1)).toBe(true)
    expect(getSendRequestAction("", false, 1)).toBe("send")
  })

  it("allows send with both text and attachments", () => {
    expect(canSendDraft("看图", false, 2)).toBe(true)
    expect(getSendRequestAction("看图", false, 2)).toBe("send")
  })

  it("blocks send with attachments while sending", () => {
    expect(canSendDraft("", true, 1)).toBe(false)
    expect(getSendRequestAction("", true, 1)).toBe("blocked_sending")
  })

  it("focuses input when no text and no attachments", () => {
    expect(canSendDraft("", false, 0)).toBe(false)
    expect(getSendRequestAction("", false, 0)).toBe("focus_input")
  })
})
