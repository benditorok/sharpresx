# netresx

View .NET RESX translations side by side in VS Code. Open a saved resource file and click **Open Translation Grid** in the editor toolbar, or run **RESX: Open Translation Grid** from the Command Palette.

For example, opening `AppResources/Labels.hu.resx` shows keys from `Labels.resx`, `Labels.en.resx`, `Labels.hu.resx`, and other locale siblings in the same directory. The preview labels missing and explicitly empty entries separately. Run the command again to refresh the grid from the current documents.

## Development

Run `pnpm install`, then press **F5** to launch the Extension Development Host with the TypeScript and esbuild watchers. The webview uses HTML and CSS. Use `pnpm run compile` for a one-off type check, lint, and build.

## Roadmap

1. **Grid preview.** Open one grid per resource family from the editor toolbar or Command Palette.
2. **Translation editing.** Edit string cells and add missing entries using targeted VS Code document edits. Refresh after source changes and detect stale edits. Preserve comments, whitespace, encoding, and non-string entries.
3. **Locale scaffolding.** Add an Explorer action to choose cultures and create sibling files from the RESX schema and headers. When scaffolding from an existing family, offer to seed keys from the neutral file. Leave untranslated keys absent by default so .NET fallback still works, and protect existing files from overwrite.
4. **Strongly typed C# resources.** Add an explicit action for the neutral resource after verifying a build-time approach on a sample SDK-style C# project. Resolve the `.csproj` that owns the resource and preview an idempotent `EmbeddedResource` metadata change for MSBuild’s `GenerateResource`. Verify that a clean `dotnet build` exposes the static resource class and still resolves localized values.
