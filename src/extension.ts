import * as path from 'node:path';
import * as vscode from 'vscode';
import { configureDesigner } from './designer';
import { gridData, renderGrid, type GridColumn } from './grid';
import {
	deleteResource, duplicateResources, findResourceFamily, listResourceFiles, planDuplicateKeys, readResx, renameResource, setResource, sortResources,
} from './resx';
import { createResourceFiles, scaffoldResx } from './scaffold';
import type { XmlEdit } from './xml';

interface OpenColumn extends GridColumn {
	document: vscode.TextDocument;
	xml: string;
	version: number;
}

type GridChange =
	| { type: 'set'; key: string; file: string; value: string }
	| { type: 'add'; key: string }
	| { type: 'rename'; key: string; newKey: string }
	| { type: 'delete' | 'duplicate'; keys: string[] }
	| { type: 'sort' | 'save' | 'revert' };

function errorText(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

async function siblingNames(folder: vscode.Uri): Promise<string[]> {
	const siblings = await vscode.workspace.fs.readDirectory(folder);
	return siblings.filter(([, type]) => type & vscode.FileType.File).map(([name]) => name);
}

async function openColumns(folder: vscode.Uri, family: string): Promise<OpenColumn[]> {
	const files = listResourceFiles(family, await siblingNames(folder));
	return Promise.all(files.map(async file => {
		const document = await vscode.workspace.openTextDocument(vscode.Uri.joinPath(folder, file.fileName));
		const xml = document.getText();
		const column = { ...file, document, xml, version: document.version };
		try {
			return { ...column, resource: readResx(xml) };
		} catch (error) {
			return { ...column, error: errorText(error) };
		}
	}));
}

function object(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null;
}

function readChange(message: Record<string, unknown>): GridChange {
	const { type, key, keys, file, value, newKey } = message;
	if (type === 'sort' || type === 'save' || type === 'revert') {
		return { type };
	}
	if ((type === 'delete' || type === 'duplicate') && Array.isArray(keys) && keys.length && keys.every(key => typeof key === 'string')) {
		return { type, keys: [...new Set(keys)] };
	}
	if (typeof key === 'string') {
		if (type === 'add' && key.trim()) {
			return { type, key };
		}
		if (type === 'rename' && typeof newKey === 'string' && newKey.trim()) {
			return { type, key, newKey };
		}
		if (type === 'set' && typeof file === 'string' && typeof value === 'string') {
			return { type, key, file, value };
		}
	}
	throw new Error('Invalid resource edit.');
}

function sameResources(first: OpenColumn[], second: OpenColumn[]): boolean {
	return first.length === second.length && first.every((column, index) => {
		const current = second[index];
		return column.fileName === current.fileName && column.xml === current.xml;
	});
}

async function applyGridChange(columns: OpenColumn[], change: GridChange, neutralUri: vscode.Uri): Promise<void> {
	if (change.type === 'save') {
		const unsaved: string[] = [];
		for (const { document, fileName } of columns) {
			if (document.isDirty && !await document.save()) {
				unsaved.push(fileName);
			}
		}
		if (unsaved.length) {
			throw new Error('Could not save ' + unsaved.join(', ') + '.');
		}
		return;
	}

	if (!columns.length || columns.some(column => !column.resource)) {
		throw new Error('Fix the invalid RESX files before making changes in the grid.');
	}
	const newKey = change.type === 'add' ? change.key
		: change.type === 'rename' && change.key !== change.newKey ? change.newKey : undefined;
	if (newKey !== undefined && columns.some(column => column.resource!.entries.has(newKey))) {
		throw new Error(`"${newKey}" already exists.`);
	}
	if (change.type === 'set' && !columns.some(column => column.fileName === change.file)) {
		throw new Error('The target file is no longer part of this resource family.');
	}

	const duplicates = change.type === 'duplicate'
		? planDuplicateKeys(change.keys, new Set(columns.flatMap(column => [...column.resource!.entries.keys()])))
		: undefined;
	const edit = new vscode.WorkspaceEdit();
	let createdNeutral = false;
	if (change.type === 'add' && !columns.some(column => !column.culture)) {
		const xml = scaffoldResx();
		const [entry] = setResource(xml, readResx(xml), change.key, '');
		const contents = Buffer.from(xml.slice(0, entry.start) + entry.text + xml.slice(entry.end), 'utf8');
		edit.createFile(neutralUri, { contents, overwrite: false });
		createdNeutral = true;
	}

	for (const { document, xml, resource, fileName, version, culture } of columns) {
		if (document.isClosed || document.version !== version) {
			throw new Error('Resources changed. Try the edit again.');
		}
		let changes: XmlEdit[] = [];
		if (change.type === 'add' && !culture) {
			changes = setResource(xml, resource!, change.key, '');
		} else if (change.type === 'set' && change.file === fileName) {
			changes = setResource(xml, resource!, change.key, change.value);
		} else if (change.type === 'rename') {
			changes = renameResource(xml, resource!, change.key, change.newKey);
		} else if (change.type === 'delete') {
			changes = change.keys.flatMap(key => deleteResource(xml, resource!, key));
		} else if (duplicates) {
			changes = duplicateResources(xml, resource!, duplicates);
		} else if (change.type === 'sort') {
			changes = sortResources(xml, resource!);
		}
		for (const { start, end, text } of changes) {
			edit.replace(document.uri, new vscode.Range(document.positionAt(start), document.positionAt(end)), text);
		}
	}
	if ((edit.size || createdNeutral) && !await vscode.workspace.applyEdit(edit)) {
		throw new Error('VS Code could not apply the resource edits.');
	}
}

async function revertGridChanges(columns: OpenColumn[], viewColumn: vscode.ViewColumn | undefined): Promise<void> {
	const existingTabs = new Set(vscode.window.tabGroups.all.flatMap(group => group.tabs));
	const openedTabs: vscode.Tab[] = [];
	try {
		for (const { document, version, fileName } of columns) {
			if (!document.isDirty) {
				continue;
			}
			// The built-in Revert File command targets the active text editor.
			const editor = await vscode.window.showTextDocument(document, { viewColumn, preview: false });
			const tab = vscode.window.tabGroups.activeTabGroup.activeTab;
			if (tab?.input instanceof vscode.TabInputText &&
				tab.input.uri.toString() === document.uri.toString() && !existingTabs.has(tab)) {
				openedTabs.push(tab);
			}
			if (vscode.window.activeTextEditor !== editor || document.version !== version) {
				throw new Error('Resources changed. Review the remaining edits before reverting.');
			}
			await vscode.commands.executeCommand('workbench.action.files.revert');
			if (document.isDirty) {
				throw new Error(`Could not revert ${fileName}.`);
			}
		}
	} finally {
		const cleanTabs = openedTabs.filter(tab => !tab.isDirty && tab.group.tabs.includes(tab));
		if (cleanTabs.length) {
			await vscode.window.tabGroups.close(cleanTabs, true);
		}
	}
}

function attachGrid(panel: vscode.WebviewPanel, folder: vscode.Uri, family: string, media: vscode.Uri) {
	let columns: OpenColumn[] = [];
	let revision = 0;
	let disposed = false;
	let ready = false;
	let queue = Promise.resolve();
	let timer: NodeJS.Timeout | undefined;
	const writable = vscode.workspace.fs.isWritableFileSystem(folder.scheme) === true;
	const watcher = vscode.workspace.createFileSystemWatcher(new vscode.RelativePattern(folder, '*.resx'));

	async function post(message: object) {
		if (ready && !disposed) {
			await panel.webview.postMessage(message);
		}
	}
	async function publish(next: OpenColumn[]) {
		if (!sameResources(columns, next)) {
			revision++;
		}
		columns = next;
		await post({
			type: 'state', revision, ...gridData(columns),
			editable: writable && columns.length > 0 && columns.every(column => column.resource),
			canSave: writable && columns.some(column => column.document.isDirty),
		});
	}
	function enqueue(operation: () => Promise<void>) {
		queue = queue.then(async () => {
			if (!disposed) {
				await operation();
			}
		}).catch(error => post({ type: 'result', error: errorText(error) }));
	}
	function refresh() {
		enqueue(async () => publish(await openColumns(folder, family)));
	}
	function changed(uri: vscode.Uri) {
		const name = path.posix.basename(uri.path);
		if (vscode.Uri.joinPath(uri, '..').toString() !== folder.toString() ||
			!name.endsWith('.resx') || !name.startsWith(family + '.')) {
			return;
		}
		clearTimeout(timer);
		timer = setTimeout(refresh, 120);
	}
	const subscriptions = [
		watcher, watcher.onDidCreate(changed), watcher.onDidChange(changed), watcher.onDidDelete(changed),
		vscode.workspace.onDidChangeTextDocument(event => changed(event.document.uri)),
		vscode.workspace.onDidSaveTextDocument(document => changed(document.uri)),
		panel.webview.onDidReceiveMessage((input: unknown) => {
			if (!object(input)) {
				return;
			}
			if (input.type === 'ready') {
				ready = true;
				refresh();
				return;
			}
			enqueue(async () => {
				if (!writable) {
					throw new Error('This resource family is read-only.');
				}
				const change = readChange(input);
				const latest = await openColumns(folder, family);
				if (change.type !== 'save' && (input.revision !== revision || !sameResources(columns, latest))) {
					await publish(latest);
					throw new Error('Resources changed. Try the edit again.');
				}
				if (change.type === 'revert') {
					try {
						await revertGridChanges(latest, panel.viewColumn);
					} finally {
						if (!disposed) {
							panel.reveal();
						}
						await publish(await openColumns(folder, family));
					}
				} else {
					await applyGridChange(latest, change, vscode.Uri.joinPath(folder, family + '.resx'));
					await publish(await openColumns(folder, family));
				}
				await post({ type: 'result' });
			});
		}),
	];
	panel.onDidDispose(() => {
		disposed = true;
		clearTimeout(timer);
		for (const subscription of subscriptions) {
			subscription.dispose();
		}
	});
	const asset = (name: string) => panel.webview.asWebviewUri(vscode.Uri.joinPath(media, name)).toString();
	panel.webview.html = renderGrid(family, asset('grid.css'), asset('grid.js'), panel.webview.cspSource);
	return { panel, refresh };
}

export function activate(context: vscode.ExtensionContext) {
	const panels = new Map<string, ReturnType<typeof attachGrid>>();
	const media = vscode.Uri.joinPath(context.extensionUri, 'media');
	context.subscriptions.push(
		vscode.commands.registerCommand('sharpresx.createResourceFiles', createResourceFiles),
		vscode.commands.registerCommand('sharpresx.configureDesigner', configureDesigner),
		vscode.commands.registerCommand('sharpresx.saveGrid', () => {
			const active = [...panels.values()].find(({ panel }) => panel.active);
			return active?.panel.webview.postMessage({ type: 'saveRequested' });
		}),
	);

	context.subscriptions.push(vscode.commands.registerCommand('sharpresx.openTranslationGrid', async (uri?: vscode.Uri) => {
		const resource = uri ?? vscode.window.activeTextEditor?.document.uri;
		const viewColumn = vscode.window.tabGroups.activeTabGroup.viewColumn;
		if (!resource?.path.endsWith('.resx') || vscode.workspace.fs.isWritableFileSystem(resource.scheme) === undefined) {
			void vscode.window.showInformationMessage('Open a .resx file to view its resource grid.');
			return;
		}
		try {
			const folder = vscode.Uri.joinPath(resource, '..');
			const family = findResourceFamily(path.posix.basename(resource.path), await siblingNames(folder));
			if (!family.files.length) {
				throw new Error('No matching resource files found.');
			}
			const key = vscode.Uri.joinPath(folder, family.name + '.resx').toString();
			const existing = panels.get(key);
			if (existing) {
				existing.panel.reveal(viewColumn);
				existing.refresh();
			} else {
				const panel = vscode.window.createWebviewPanel('sharpresx.translationGrid', family.name,
					viewColumn, { enableScripts: true, localResourceRoots: [media] });
				panels.set(key, attachGrid(panel, folder, family.name, media));
				panel.onDidDispose(() => panels.delete(key));
			}
		} catch (error) {
			void vscode.window.showErrorMessage(`Could not open the RESX resource grid: ${errorText(error)}`);
		}
	}));
	context.subscriptions.push({ dispose: () => {
		for (const { panel } of panels.values()) {
			panel.dispose();
		}
	} });
}
