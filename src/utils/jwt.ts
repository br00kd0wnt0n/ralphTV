export function decodeJWT(token: string): any {
  try {
    const base64Url = token.split('.')[1];
    const base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/');
    const jsonPayload = decodeURIComponent(
      atob(base64)
        .split('')
        .map((c) => '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2))
        .join('')
    );
    return JSON.parse(jsonPayload);
  } catch (e) {
    console.error('Failed to decode JWT:', e);
    return null;
  }
}

export function getUserFromToken(): { email: string; role: string } | null {
  const token = localStorage.getItem('token');
  if (!token) return null;

  const decoded = decodeJWT(token);
  if (!decoded || !decoded.email) return null;

  return {
    email: decoded.email,
    role: decoded.role || 'user',
  };
}
