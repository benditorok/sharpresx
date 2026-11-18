# netresx

View and edit .NET RESX resource families side by side in VS Code. Open a saved resource file and click **Open Translation Grid** in the editor toolbar, or run **RESX: Open Translation Grid** from the Command Palette.

For example, opening `AppResources/Labels.hu.resx` shows keys from `Labels.resx`, `Labels.en.resx`, `Labels.hu.resx`, and other locale siblings in the same directory. The grid refreshes when resource files change.

- Search resource keys and stored values across all locales. The grid marks missing, empty, whitespace-only, and type or .NET format-placeholder mismatches.
- Click a value to edit it. **Add key** writes entries to the files for which you provide a value. **Delete** removes the key across the family after confirmation.
- **Sort files by key** reorders resource entries in each file. **Save files** saves the edited RESX documents through VS Code.

## Create RESX files

Right-click a folder or RESX file in Explorer and select **Create RESX Files**. Enter cultures such as `en, hu, pt-BR`. Starting from a folder also creates the default file if needed. When a neutral file is available, you can copy its string values or leave entries missing for .NET fallback. The command skips existing files.

## Configure the C# designer

Right-click a RESX file and select **Configure Designer Generation**. Review the configuration for the neutral resource and apply it to the enclosing SDK-style `.csproj`. A normal `dotnet build` generates `ResourceFile.Designer.cs` in the project's intermediate output directory and compiles it into the project. The command supports standard embedded-resource naming and flags conflicting designer metadata before changing the project.

## Development

Run `pnpm install`, then press **F5** to launch the Extension Development Host with the TypeScript and esbuild watchers. The webview uses HTML, CSS, and JavaScript. Use `pnpm run compile` for a one-off type check, lint, and build.

## Roadmap

- [x] **Grid navigation and validation.** Use the family name as the title, search resource keys and values across locales, and flag missing entries, blank values, and mismatched .NET format placeholders.
- [x] **Grid editing and organization.** Add keys where a locale value is supplied, edit string cells, delete keys across the family, and sort each file's entries by key. Use targeted VS Code edits, refresh from file changes, and reject edits made against stale data.
- [x] **Locale scaffolding.** Add an Explorer action to create schema-based RESX files for selected cultures. Offer to copy string values from the neutral file as a starting point. Leave untranslated keys absent by default and protect existing files from overwrite.
- [x] **Strongly typed C# resources.** Resolve the SDK-style C# project that owns the neutral resource. Preview a repeatable project XML change, then verify a clean build exposes the static resource class and resolves localized values.
