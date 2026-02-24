// Dev runtime — re-exports the production runtime 
// Bun uses jsx-dev-runtime.ts in dev mode for JSX transpilation

import { jsx, jsxs, Fragment } from "./jsx-runtime"

export { jsx, jsxs, Fragment }
export const jsxDEV = jsx
