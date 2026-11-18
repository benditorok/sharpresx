import * as path from 'node:path';
import * as vscode from 'vscode';
import { renderGrid } from './grid';
import { findResourceFamily, parseResx } from './resx';

export function activate(context: vscode.ExtensionContext) {
	const panels = new Map<string, vscode.WebviewPanel>();
	const media = vscode.Uri.joinPath(context.extensionUri, 'media');

	context.subscriptions.push(vscode.commands.registerCommand('netresx.openTranslationGrid', async (uri?: vscode.Uri) => {
		const resource = uri ?? vscode.window.activeTextEditor?.document.uri;
		if (!resource?.path.endsWith('.resx') || vscode.workspace.fs.isWritableFileSystem(resource.scheme) === undefined) {
			void vscode.window.showInformationMessage('Open a .resx file to view its translation grid.');
			return;
		}

		try {
			const folder = vscode.Uri.joinPath(resource, '..');
			const siblings = await vscode.workspace.fs.readDirectory(folder);
			const fileNames = siblings.filter(([, type]) => type & vscode.FileType.File).map(([name]) => name);
			const family = findResourceFamily(path.posix.basename(resource.path), fileNames);
			if (!family.files.length) {
				throw new Error('No matching resource files found.');
			}
			const columns = await Promise.all(family.files.map(async file => {
				try {
					const document = await vscode.workspace.openTextDocument(vscode.Uri.joinPath(folder, file.fileName));
					return { ...file, entries: parseResx(document.getText()) };
				} catch (error) {
					throw new Error(`${file.fileName}: ${error instanceof Error ? error.message : String(error)}`);
				}
			}));

			const key = vscode.Uri.joinPath(folder, family.name + '.resx').toString();
			let panel = panels.get(key);
			if (panel) {
				panel.reveal();
			} else {
				panel = vscode.window.createWebviewPanel('netresx.translationGrid', `${family.name} Translations`,
					vscode.ViewColumn.Beside, { localResourceRoots: [media] });
				panels.set(key, panel);
				panel.onDidDispose(() => panels.delete(key));
			}

			const stylesheet = panel.webview.asWebviewUri(vscode.Uri.joinPath(media, 'grid.css')).toString();
			panel.webview.html = renderGrid(family.name, columns, stylesheet, panel.webview.cspSource);
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			void vscode.window.showErrorMessage(`Could not open the RESX translation grid: ${message}`);
		}
	}));
	context.subscriptions.push({ dispose: () => {
		for (const panel of panels.values()) {
			panel.dispose();
		}
	} });
}
