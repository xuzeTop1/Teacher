export function canSendDraft(value: string, isSending: boolean, attachmentCount = 0): boolean {
  return (value.trim().length > 0 || attachmentCount > 0) && !isSending
}

export function isSendButtonDisabled(isSending: boolean): boolean {
  return isSending
}

export function getSendRequestAction(value: string, isSending: boolean, attachmentCount = 0): "send" | "focus_input" | "blocked_sending" {
  if (isSending) {
    return "blocked_sending"
  }

  if (!value.trim() && attachmentCount === 0) {
    return "focus_input"
  }

  return "send"
}
