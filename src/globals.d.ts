/**
 * The path the site is published under, as the build defines it.
 *
 * A site at the root of its host has none; a project published under a
 * subpath — a GitHub Pages project site — has one, and the router has to be
 * told so that it does not read the repository's name as part of the route.
 *
 * Each Vite build defines it: the web build from PAGES_BASE, the app build
 * as empty, because the WebView serves the app from the root of its own
 * origin.
 */
declare const __ROUTER_BASENAME__: string
