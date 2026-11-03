.nojekyll in this folder is copied to the export root by `next build`.

Without it, GitHub Pages runs its Jekyll step and silently drops every path
beginning with an underscore - which is all of _next/. The site then loads as
unstyled HTML with no JavaScript, and nothing in the build output hints at why.
Do not delete it.
