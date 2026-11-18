# SharpResX

SharpResX (`sharpresx`) is a VS Code extension for editing .NET RESX resource families. A family can include a neutral file such as `AppResources/Labels.resx` and same-directory locale siblings such as `Labels.en.resx`, `Labels.hu.resx`, and `Labels.pt-BR.resx`. See [README.md](README.md) for user-facing workflows and source installation.

## Development

- Use Node.js 24+, pnpm 12, and VS Code 1.146+. Run `pnpm install --frozen-lockfile` from the repository root.
- Use TypeScript 6 for compilation and ESLint. esbuild bundles the extension host. The webview uses plain HTML, CSS, and JavaScript.
- Press F5 for the Extension Development Host. The launch configuration starts esbuild and TypeScript watch tasks. The esbuild matcher is defined in `.vscode/tasks.json`.
- Run `pnpm run compile` for type-checking, lint, and a development build. Run `pnpm test` for the VS Code extension suite and `pnpm run package` for the production bundle. After changing dependencies, verify the lockfile and run `pnpm audit`.

## Code map

- `package.json` declares the `sharpresx.*` commands, menus, and save binding scoped to `sharpresx.translationGrid`.
- `src/extension.ts` owns the webview lifecycle, family loading, file watchers, revision checks, and VS Code document edits.
- `src/grid.ts` prepares grid data, validation warnings, and webview markup. `media/grid.js` and `media/grid.css` handle grid interaction and layout.
- `src/resx.ts` handles resource discovery and edits. `src/xml.ts` provides Saxes-based parsing, XML escaping, and source ranges.
- `src/scaffold.ts` creates schema-backed locale files. `src/designer.ts` configures strongly typed resources in SDK-style C# projects.
- `src/test/extension.test.ts` covers parsing and editing, resource families, scaffolding, designer metadata, and opening the grid.

## Behavior to preserve

- The editor toolbar opens one grid tab per family in the current editor group. Keep the grid compact, with icon actions at the top, search on the right, and stable column widths during inline editing.
- A single click on a key selects its row. Double-click or F2 renames the key across the family. Ctrl/Cmd-click toggles rows and Shift-click selects a range. Delete and Duplicate use the selection across the family. Duplicates use the next available numeric suffix.
- Add starts with an empty entry in the neutral RESX. Keep missing entries distinct from empty values because missing entries can use .NET resource fallback. Preserve warning strips for missing, blank, and mismatched entries.
- Apply targeted `WorkspaceEdit` text ranges and check document revisions before mutating. Preserve unrelated XML, resource comments, line endings, and typed resource data. Keep file writes and validation in the extension host.
- Ctrl+S and Cmd+S save the backing RESX documents through VS Code. Revert reloads dirty family files from disk after inline confirmation. Applied edits follow VS Code’s Hot Exit behavior. Keep successful grid actions quiet and show errors beside Save.
- Scaffolding protects existing files and can optionally copy neutral string values. Designer configuration edits the enclosing `.csproj`. MSBuild generates `ResourceFile.Designer.cs` beside the neutral RESX. The generated item stays available to design-time analysis and is compiled once in a normal build.

## Packaging

The manifest’s `files` allowlist restricts the VSIX to the bundled extension entry point and the webview assets, alongside the README and package metadata. Follow the README to build and install a VSIX locally with `pnpm dlx @vscode/vsce`. A Marketplace publisher ID and project license have yet to be set.
