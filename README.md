# SharpResX

View and edit .NET RESX resource families in a VS Code editor tab. Open a saved resource file and click **Open Translation Grid** in the editor toolbar, or run **SharpResX: Open Translation Grid** from the Command Palette. The grid opens in the current editor group.

For example, opening `AppResources/Labels.hu.resx` shows keys from `Labels.resx`, `Labels.en.resx`, `Labels.hu.resx`, and other locale siblings in the same directory. The grid refreshes when resource files change.

- Search resource keys and stored values across all locales. The grid marks missing, empty, whitespace-only, and type or .NET format-placeholder mismatches.
- Click a value to edit it inline. Double-click a key or press F2 on it to rename it across the family. Press Enter to apply, Shift+Enter for a newline in a value, or Escape to cancel.
- Use **Add key** and enter a name to add an empty entry to the default RESX. Select rows by clicking their keys, using Ctrl/Cmd to toggle individual rows or Shift to select a range.
- **Delete selected keys** removes those keys across the family. **Duplicate selected keys** copies each selected row across its locales under the next available numeric suffix.
- **Sort files by key** reorders resource entries in each file. **Save files** saves the edited RESX documents through VS Code. Press Ctrl+S (Cmd+S on macOS) in the grid to save. You can rebind **SharpResX: Save Resource Grid** in VS Code’s Keyboard Shortcuts.
- **Revert unsaved changes** appears before Save while backing RESX files are dirty. Confirm it to reload the resource family from disk. Closing the grid tab leaves applied edits in the backing documents, which follow VS Code’s Hot Exit setting when the window closes.

## Create RESX files

Right-click a folder or RESX file in Explorer and select **Create RESX Files**. Enter cultures such as `en, hu, pt-BR`. Starting from a folder also creates the default file if needed. When a neutral file is available, you can copy its string values or leave entries missing for .NET fallback. The command skips existing files.

## Configure the C# designer

Right-click a RESX file and select **Configure Designer Generation**. Review the configuration for the neutral resource and apply it to the enclosing SDK-style `.csproj`. A normal `dotnet build` generates `ResourceFile.Designer.cs` beside the neutral RESX so it can be tracked in Git. Run the command again to migrate an earlier configuration that generated into the intermediate output directory. The command supports standard embedded-resource naming and flags conflicting designer metadata before changing the project.

## Install from source

Use Node.js 24 or newer, pnpm 12, and VS Code 1.146 or newer. Run these commands from a terminal with the VS Code `code` command on your PATH.

```sh
git clone https://github.com/benditorok/sharpresx.git
cd sharpresx
pnpm install --frozen-lockfile
pnpm dlx @vscode/vsce@4.1.1 package --no-dependencies --skip-license --out sharpresx.vsix
code --install-extension sharpresx.vsix
```

You can also install the generated package in VS Code using **Extensions: Install from VSIX…**.

## Development

Open the checkout in VS Code and press **F5** to launch the Extension Development Host. Run `pnpm run compile` for a type check, lint, and build, or `pnpm test` for the extension tests.
