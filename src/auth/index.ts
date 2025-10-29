// Re-export the provided auth context/components from project root
// Paths are relative to this file; the originals live at ralphTV/auth-*.{js,jsx}
// These files are JS/JSX; tsconfig allows JS imports.
export { AuthProvider, useAuth, LoginComponent } from '../../auth-context.jsx';

