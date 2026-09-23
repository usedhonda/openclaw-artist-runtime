# Producer Console UI

This UI is intentionally thin. It should call plugin API routes and never publish directly to Suno or social platforms.

## Build

```bash
npm run build
```

The built output lands in `ui/dist/` and is served by the plugin route at `/plugins/artist-runtime`.
