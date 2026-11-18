# netresx

View and edit .NET RESX resource families in a VS Code editor tab. Open a saved resource file and click **Open Translation Grid** in the editor toolbar, or run **RESX: Open Translation Grid** from the Command Palette. The grid opens in the current editor group.

For example, opening `AppResources/Labels.hu.resx` shows keys from `Labels.resx`, `Labels.en.resx`, `Labels.hu.resx`, and other locale siblings in the same directory. The grid refreshes when resource files change.

- Search resource keys and stored values across all locales. The grid marks missing, empty, whitespace-only, and type or .NET format-placeholder mismatches.
- Click a value to edit it inline. Double-click a key or press F2 on it to rename it across the family. Press Enter to apply, Shift+Enter for a newline in a value, or Escape to cancel.
- Use **Add key** and enter a name to add an empty entry to the default RESX. Select rows by clicking their keys, using Ctrl/Cmd to toggle individual rows or Shift to select a range.
- **Delete selected keys** removes those keys across the family. **Duplicate selected keys** copies each selected row across its locales under the next available numeric suffix.
- **Sort files by key** reorders resource entries in each file. **Save files** saves the edited RESX documents through VS Code. Press Ctrl+S (Cmd+S on macOS) in the grid to save. You can rebind **RESX: Save Resource Grid** in VS Code’s Keyboard Shortcuts.
- **Revert unsaved changes** appears before Save while backing RESX files are dirty. Confirm it to reload the resource family from disk. Closing the grid tab leaves applied edits in the backing documents, which follow VS Code’s Hot Exit setting when the window closes.

## Create RESX files

Right-click a folder or RESX file in Explorer and select **Create RESX Files**. Enter cultures such as `en, hu, pt-BR`. Starting from a folder also creates the default file if needed. When a neutral file is available, you can copy its string values or leave entries missing for .NET fallback. The command skips existing files.

## Configure the C# designer

Right-click a RESX file and select **Configure Designer Generation**. Review the configuration for the neutral resource and apply it to the enclosing SDK-style `.csproj`. A normal `dotnet build` generates `ResourceFile.Designer.cs` beside the neutral RESX so it can be tracked in Git. Run the command again to migrate an earlier netresx configuration that generated into the intermediate output directory. The command supports standard embedded-resource naming and flags conflicting designer metadata before changing the project.

## Development

Run `pnpm install`, then press **F5** to launch the Extension Development Host with the TypeScript and esbuild watchers. The webview uses HTML, CSS, and JavaScript. Use `pnpm run compile` for a one-off type check, lint, and build.

## Roadmap

- [x] **Grid navigation and validation.** Open a compact grid in its own editor tab, search resource keys and values across locales, and flag missing entries, blank values, and mismatched .NET format placeholders.
- [x] **Grid editing and organization.** Add empty keys to the neutral resource, edit values inline, duplicate or delete selected keys, and sort entries by key. Use targeted VS Code edits, refresh from file changes, and reject edits made against stale data.
- [x] **Locale scaffolding.** Add an Explorer action to create schema-based RESX files for selected cultures. Offer to copy string values from the neutral file as a starting point. Leave untranslated keys absent by default and protect existing files from overwrite.
- [x] **Strongly typed C# resources.** Resolve the SDK-style C# project that owns the neutral resource. Preview a repeatable project XML change, then verify a clean build exposes the static resource class and resolves localized values.
