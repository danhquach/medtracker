import { useEffect, useState } from 'react'
import { markEmailLinkShown, pendingEmailLink, type EmailLink } from './emailLink'

export default function EmailLinkNotice({ email, guest = false }: { email?: string; guest?: boolean }) {
  const [link, setLink] = useState<EmailLink>(pendingEmailLink)
  useEffect(() => {
    if (link) markEmailLinkShown(link)
  }, [link])

  if (!link) return null
  const dismiss = (
    <button type="button" className="link" onClick={() => setLink(null)}>
      Dismiss
    </button>
  )
  // Only with a signed-in email: the link's hash alone is not proof (anyone can craft one).
  if (link === 'verified')
    return email ? (
      <p role="status" className="notice">
        Email verified. You’re signed in as {email}. {dismiss}
      </p>
    ) : null
  const next = guest
    ? 'To get a new link, add your email again in Settings.'
    : email
      ? ''
      : 'To get a new link, use Create a profile again with the same email. Already confirmed? Sign in.'
  return (
    <p role="alert" className="notice notice-error">
      This email link has expired or was already used. {next} {dismiss}
    </p>
  )
}
