export const PASSWORD_RULE = 'At least 8 characters.'

export function emailError(email: string): string | undefined {
  if (!email.trim()) return 'Enter your email'
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) return 'Enter a valid email address, like name@example.com'
}

export function passwordError(password: string): string | undefined {
  if (!password) return 'Enter your password'
  if (password.length < 8) return 'Password must be at least 8 characters'
}
